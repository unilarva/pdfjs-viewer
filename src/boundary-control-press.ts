// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pointer press recognizer for previous/next boundary controls.
 *
 * This owner admits one primary-left pointer, distinguishes short and long
 * activation, and suppresses only the long press's following synthetic click.
 * Navigation policy stays with the caller. This emitted module is for package
 * maintainers and is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for its ownership boundary.
 *
 * @packageDocumentation
 * @module boundary-control-press
 */

const MOVE_TOLERANCE_PX = 12;

export interface BoundaryControlPressTimerPlatform {
  setTimeout(callback: () => void, delay: number): number | null;
  clearTimeout(id: number | null): number | null;
}

export interface BoundaryControlPressOptions {
  readonly button: HTMLButtonElement;
  readonly longPressMs: number;
  readonly timers: BoundaryControlPressTimerPlatform;
  readonly canPress: () => boolean;
  readonly onShortPress: () => void;
  readonly onLongPress: () => void;
  readonly listen: (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => void;
}

type ActivePress = Readonly<{
  pointerId: number;
  startX: number;
  startY: number;
  longPressed: boolean;
}>;

/** Owns pointer identity and long-press recognition for one boundary button. */
export class BoundaryControlPress {
  readonly #button: HTMLButtonElement;
  readonly #longPressMs: number;
  readonly #timers: BoundaryControlPressTimerPlatform;
  readonly #canPress: () => boolean;
  readonly #onShortPress: () => void;
  readonly #onLongPress: () => void;
  #activePress: ActivePress | null = null;
  #longPressTimer: number | null = null;
  #suppressSyntheticClick = false;
  #suppressionTimer: number | null = null;

  public constructor(options: BoundaryControlPressOptions) {
    this.#button = options.button;
    this.#longPressMs = options.longPressMs;
    this.#timers = options.timers;
    this.#canPress = options.canPress;
    this.#onShortPress = options.onShortPress;
    this.#onLongPress = options.onLongPress;
    options.listen(this.#button, "pointerdown", event =>
      this.#onPointerDown(event as PointerEvent),
    );
    options.listen(this.#button, "pointermove", event =>
      this.#onPointerMove(event as PointerEvent),
    );
    options.listen(this.#button, "pointerup", event => this.#finishPointer(event as PointerEvent));
    options.listen(this.#button, "pointercancel", event =>
      this.#cancelPointer(event as PointerEvent),
    );
    options.listen(this.#button, "pointerleave", event =>
      this.#cancelPointer(event as PointerEvent),
    );
    options.listen(this.#button, "blur", () => this.reset());
    options.listen(this.#button, "click", event => this.#onClick(event));
  }

  /** Cancels a pending press and any synthetic-click suppression. */
  public reset(): void {
    this.#clearLongPress();
    this.#clearSuppression();
    this.#releasePointerCapture();
    this.#activePress = null;
  }

  /** Alias for callers handling an explicit cancellation lifecycle. */
  public cancel(): void {
    this.reset();
  }

  #onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || !this.#canPress()) return;
    this.reset();
    this.#activePress = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      longPressed: false,
    };
    try {
      this.#button.setPointerCapture(event.pointerId);
    } catch {}
    this.#longPressTimer = this.#timers.setTimeout(() => {
      const press = this.#activePress;
      if (!press || press.pointerId !== event.pointerId || press.longPressed || !this.#canPress())
        return;
      this.#activePress = { ...press, longPressed: true };
      this.#suppressSyntheticClick = true;
      this.#onLongPress();
    }, this.#longPressMs);
  }

  #onPointerMove(event: PointerEvent): void {
    const press = this.#activePress;
    if (!press || press.pointerId !== event.pointerId || press.longPressed) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > MOVE_TOLERANCE_PX)
      this.#cancelPointer(event);
  }

  #finishPointer(event: PointerEvent): void {
    const press = this.#activePress;
    if (!press || press.pointerId !== event.pointerId) return;
    this.#clearLongPress();
    this.#releasePointerCapture(event.pointerId);
    this.#activePress = null;
    if (press.longPressed)
      this.#suppressionTimer = this.#timers.setTimeout(() => this.#clearSuppression(), 0);
  }

  #cancelPointer(event: PointerEvent): void {
    if (!this.#activePress || this.#activePress.pointerId !== event.pointerId) return;
    this.reset();
  }

  #onClick(event: Event): void {
    if (this.#suppressSyntheticClick) {
      this.#clearSuppression();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.#canPress()) this.#onShortPress();
  }

  #clearLongPress(): void {
    this.#longPressTimer = this.#timers.clearTimeout(this.#longPressTimer);
  }

  #clearSuppression(): void {
    this.#suppressionTimer = this.#timers.clearTimeout(this.#suppressionTimer);
    this.#suppressSyntheticClick = false;
  }

  #releasePointerCapture(pointerId = this.#activePress?.pointerId): void {
    if (pointerId === undefined) return;
    try {
      this.#button.releasePointerCapture(pointerId);
    } catch {}
  }
}
