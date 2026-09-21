// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private owner for presentation-mode input and transient overlay behavior.
 *
 * The facade owns presentation entry/exit and document view transactions. This
 * owner translates pointer, wheel, keyboard, and overlay-control input into
 * semantic callbacks without depending on PDF.js or canonical view state.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. See the [architecture guide](../ARCHITECTURE.md)
 * for its ownership and lifecycle boundary.
 *
 * @packageDocumentation
 * @module presentation-input
 */

import { LifecycleScope } from "./lifecycle-scope.js";
import { BoundaryControlPress } from "./boundary-control-press.js";

const WHEEL_IDLE_MS = 120;
const WHEEL_COOLDOWN_MS = 350;
const WHEEL_THRESHOLD_PX = 90;
const MOUSE_FLING_MIN_PX_PER_MS = 0.25;
const POINTER_MOVE_TOLERANCE_PX = 12;

export interface PresentationInputCallbacks {
  canInteract(): boolean;
  step(delta: -1 | 1): void;
  jump(boundary: "first" | "last"): void;
  exit(): void;
  focusDocument(): void;
  setControlsVisible(visible: boolean): void;
  isTextSelectionTarget(target: EventTarget | null): boolean;
  isFormControlTarget(target: EventTarget | null): boolean;
}

export interface PresentationInputOptions {
  readonly root: HTMLElement;
  readonly container: HTMLElement;
  readonly controls: HTMLElement | null;
  readonly previous: HTMLButtonElement | null;
  readonly next: HTMLButtonElement | null;
  readonly exit: HTMLButtonElement | null;
  readonly longPressMs: number;
  readonly callbacks: PresentationInputCallbacks;
}

type DocumentPointer = {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  startTime: number;
  longPressed: boolean;
};

/** Owns one viewer's presentation-only input state and persistent listeners. */
export class PresentationInputController {
  readonly #root: HTMLElement;
  readonly #container: HTMLElement;
  readonly #controls: HTMLElement | null;
  readonly #previous: HTMLButtonElement | null;
  readonly #next: HTMLButtonElement | null;
  readonly #exit: HTMLButtonElement | null;
  readonly #longPressMs: number;
  readonly #callbacks: PresentationInputCallbacks;
  readonly #document: Document;
  readonly #window: Window & typeof globalThis;
  readonly #lifetime: LifecycleScope;
  #active = false;
  #controlsTimer: number | null = null;
  #longPressTimer: number | null = null;
  #documentPointer: DocumentPointer | null = null;
  #wheelAccumulator = 0;
  #wheelLastTime = 0;
  #wheelCooldownUntil = 0;
  #controlPointerActivation = false;
  #previousControlPress: BoundaryControlPress | null = null;
  #nextControlPress: BoundaryControlPress | null = null;
  #controlsSuppressedUntil = 0;
  #suppressClickUntil = 0;

  public constructor(options: PresentationInputOptions) {
    this.#root = options.root;
    this.#container = options.container;
    this.#controls = options.controls;
    this.#previous = options.previous;
    this.#next = options.next;
    this.#exit = options.exit;
    this.#longPressMs = options.longPressMs;
    this.#callbacks = options.callbacks;
    this.#document = options.root.ownerDocument;
    const ownerWindow = this.#document.defaultView;
    if (!ownerWindow) throw new Error("Presentation input requires an attached owner window");
    this.#window = ownerWindow as Window & typeof globalThis;
    this.#lifetime = new LifecycleScope({
      createAbortController: () => new ownerWindow.AbortController(),
      requestAnimationFrame: callback => ownerWindow.requestAnimationFrame(callback),
      cancelAnimationFrame: id => ownerWindow.cancelAnimationFrame(id),
      setTimeout: (callback, delay) => ownerWindow.setTimeout(callback, delay),
      clearTimeout: id => ownerWindow.clearTimeout(id),
    });
    this.#wire();
    this.setActive(false);
  }

  public setActive(active: boolean): void {
    this.#active = active;
    if (!active) this.#resetTransientState();
    if (!this.#controls) return;
    this.#controls.hidden = !active;
    this.#controls.toggleAttribute("inert", !active);
    this.#controls.setAttribute("aria-hidden", String(!active));
  }

  /** Clears transient input before a document lifetime is replaced. */
  public reset(): void {
    this.#resetTransientState();
  }

  public contains(element: Node | null): boolean {
    return !!element && !!this.#controls?.contains(element);
  }

  public setNavigationAvailability(canPrevious: boolean, canNext: boolean): void {
    this.#setButtonAvailability(this.#previous, canPrevious);
    this.#setButtonAvailability(this.#next, canNext);
  }

  public showControls(force = false): void {
    if (!this.#active) return;
    if (!force && this.#now() < this.#controlsSuppressedUntil) return;
    this.#callbacks.setControlsVisible(true);
    this.#controlsTimer = this.#lifetime.clearTimeout(this.#controlsTimer);
    this.#controlsTimer = this.#lifetime.setTimeout(() => {
      if (this.contains(this.#document.activeElement)) {
        this.showControls(true);
        return;
      }
      this.#callbacks.setControlsVisible(false);
      this.#controlsTimer = null;
    }, 2500);
  }

  public hideControls(): void {
    this.#controlsTimer = this.#lifetime.clearTimeout(this.#controlsTimer);
    this.#callbacks.setControlsVisible(false);
  }

  public suppressControls(): void {
    this.#controlsSuppressedUntil = this.#now() + 400;
    this.hideControls();
  }

  /** Handles presentation navigation after the facade's editable/widget filtering. */
  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.#active) return false;
    const previous =
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp" ||
      event.key === "PageUp" ||
      ((event.key === " " || event.key === "Spacebar") && event.shiftKey);
    const next =
      event.key === "ArrowRight" ||
      event.key === "ArrowDown" ||
      event.key === "PageDown" ||
      ((event.key === " " || event.key === "Spacebar") && !event.shiftKey);
    if (!previous && !next && event.key !== "Home" && event.key !== "End" && event.key !== "Escape")
      return false;
    event.preventDefault();
    if (previous || next) this.#step(previous ? -1 : 1, false);
    else if (event.key === "Home" || event.key === "End") {
      this.#callbacks.jump(event.key === "Home" ? "first" : "last");
      this.suppressControls();
    } else this.#callbacks.exit();
    return true;
  }

  public destroy(): void {
    this.#active = false;
    this.reset();
    this.#lifetime.cancel();
  }

  #wire(): void {
    if (this.#previous) this.#wirePageButton(this.#previous, -1);
    if (this.#next) this.#wirePageButton(this.#next, 1);
    if (this.#exit)
      this.#listen(this.#exit, "click", () => {
        if (this.#active) this.#callbacks.exit();
      });
    if (this.#controls) {
      this.#listen(this.#controls, "pointerdown", () => {
        this.#controlPointerActivation = true;
      });
    }
    for (const target of [this.#root, this.#controls]) {
      if (!target) continue;
      this.#listen(
        target,
        "pointermove",
        event => {
          if ((event as PointerEvent).pointerType !== "touch") this.showControls();
        },
        { passive: true },
      );
      this.#listen(target, "focusin", () => this.showControls(true));
    }
    this.#listen(this.#container, "wheel", event => this.#handleWheel(event as WheelEvent), {
      passive: false,
    });
    this.#wireDocumentPointerNavigation();
  }

  #wirePageButton(button: HTMLButtonElement, direction: -1 | 1): void {
    const press = new BoundaryControlPress({
      button,
      longPressMs: this.#longPressMs,
      timers: this.#lifetime,
      canPress: () => this.#active && !button.disabled && this.#callbacks.canInteract(),
      onShortPress: () => {
        this.#step(direction, true);
        this.#finishControlActivation();
      },
      onLongPress: () => {
        this.#callbacks.jump(direction < 0 ? "first" : "last");
        this.#finishControlActivation();
      },
      listen: (target, type, listener, options) => this.#listen(target, type, listener, options),
    });
    if (direction < 0) this.#previousControlPress = press;
    else this.#nextControlPress = press;
  }

  #handleWheel(event: WheelEvent): void {
    if (!this.#active || this.#isInteractiveTarget(event.target)) return;
    event.preventDefault();
    this.showControls(true);
    if (event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) * 1.25) return;
    const multiplier =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(1, this.#container.clientHeight)
          : 1;
    const delta = event.deltaY * multiplier;
    if (!Number.isFinite(delta) || delta === 0) return;
    const now = this.#now();
    if (
      now - this.#wheelLastTime > WHEEL_IDLE_MS ||
      (this.#wheelAccumulator !== 0 && Math.sign(delta) !== Math.sign(this.#wheelAccumulator))
    )
      this.#wheelAccumulator = 0;
    this.#wheelLastTime = now;
    if (now < this.#wheelCooldownUntil) return;
    this.#wheelAccumulator += delta;
    if (Math.abs(this.#wheelAccumulator) < WHEEL_THRESHOLD_PX) return;
    this.#step(this.#wheelAccumulator < 0 ? -1 : 1, false);
    this.#wheelAccumulator = 0;
    this.#wheelCooldownUntil = now + WHEEL_COOLDOWN_MS;
  }

  #wireDocumentPointerNavigation(): void {
    this.#listen(this.#container, "pointerdown", event => {
      const pointer = event as PointerEvent;
      if (
        !this.#active ||
        !pointer.isPrimary ||
        (pointer.pointerType !== "touch" &&
          pointer.pointerType !== "pen" &&
          pointer.pointerType !== "mouse") ||
        this.#isInteractiveTarget(pointer.target) ||
        this.#callbacks.isTextSelectionTarget(pointer.target) ||
        this.#callbacks.isFormControlTarget(pointer.target)
      )
        return;
      this.#clearLongPress();
      this.#documentPointer = {
        id: pointer.pointerId,
        pointerType: pointer.pointerType,
        startX: pointer.clientX,
        startY: pointer.clientY,
        startTime: this.#now(),
        longPressed: false,
      };
      if (pointer.pointerType === "mouse") pointer.preventDefault();
      try {
        this.#container.setPointerCapture(pointer.pointerId);
      } catch {}
      if (pointer.pointerType !== "mouse") {
        this.#longPressTimer = this.#lifetime.setTimeout(() => {
          if (!this.#documentPointer || this.#documentPointer.id !== pointer.pointerId) return;
          this.#documentPointer.longPressed = true;
          this.showControls(true);
        }, this.#longPressMs);
      }
    });
    this.#listen(this.#container, "pointermove", event => {
      const pointer = event as PointerEvent;
      const active = this.#documentPointer;
      if (!active || active.id !== pointer.pointerId || active.longPressed) return;
      if (
        Math.hypot(pointer.clientX - active.startX, pointer.clientY - active.startY) >
        POINTER_MOVE_TOLERANCE_PX
      )
        this.#clearLongPress();
    });
    const finish = (event: Event, cancelled: boolean): void => {
      const pointer = event as PointerEvent;
      const active = this.#documentPointer;
      if (!active || active.id !== pointer.pointerId) return;
      this.#clearLongPress();
      this.#documentPointer = null;
      if (cancelled || !this.#active) return;
      this.#suppressClickUntil = this.#now() + 500;
      if (active.longPressed) return;
      const dx = pointer.clientX - active.startX;
      const dy = pointer.clientY - active.startY;
      const duration = Math.max(1, this.#now() - active.startTime);
      const mouseFling =
        active.pointerType !== "mouse" || Math.abs(dy) / duration >= MOUSE_FLING_MIN_PX_PER_MS;
      if (mouseFling && Math.abs(dy) >= 40 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        this.#step(dy < 0 ? 1 : -1, false);
        return;
      }
      if (Math.hypot(dx, dy) <= POINTER_MOVE_TOLERANCE_PX) this.#silentZoneStep(pointer.clientY);
    };
    this.#listen(this.#container, "pointerup", event => finish(event, false));
    this.#listen(this.#container, "pointercancel", event => finish(event, true));
    this.#listen(this.#container, "click", event => {
      const mouse = event as MouseEvent;
      if (
        !this.#active ||
        mouse.button !== 0 ||
        this.#now() < this.#suppressClickUntil ||
        this.#isInteractiveTarget(mouse.target)
      )
        return;
      if (this.#silentZoneStep(mouse.clientY)) {
        mouse.preventDefault();
        mouse.stopPropagation();
      }
    });
  }

  #silentZoneStep(clientY: number): boolean {
    const rect = this.#container.getBoundingClientRect();
    if (rect.height <= 0) return false;
    const position = (clientY - rect.top) / rect.height;
    if (position <= 1 / 3) this.#step(-1, false);
    else if (position >= 2 / 3) this.#step(1, false);
    else {
      this.showControls(true);
      return false;
    }
    return true;
  }

  #step(direction: -1 | 1, showControls: boolean): void {
    if (!this.#active || !this.#callbacks.canInteract()) return;
    this.#callbacks.step(direction);
    if (showControls) this.showControls(true);
    else this.suppressControls();
  }

  #finishControlActivation(): void {
    if (!this.#controlPointerActivation || !this.#active) return;
    this.#controlPointerActivation = false;
    this.#callbacks.focusDocument();
    this.showControls(true);
  }

  #setButtonAvailability(button: HTMLButtonElement | null, available: boolean): void {
    if (!button) return;
    button.disabled = !available;
    button.setAttribute("aria-disabled", String(!available));
  }

  #clearLongPress(): void {
    this.#longPressTimer = this.#lifetime.clearTimeout(this.#longPressTimer);
  }

  #resetTransientState(): void {
    this.#controlsTimer = this.#lifetime.clearTimeout(this.#controlsTimer);
    this.#clearLongPress();
    this.#documentPointer = null;
    this.#wheelAccumulator = 0;
    this.#wheelLastTime = 0;
    this.#wheelCooldownUntil = 0;
    this.#controlPointerActivation = false;
    this.#previousControlPress?.reset();
    this.#nextControlPress?.reset();
    this.#controlsSuppressedUntil = 0;
    this.#callbacks.setControlsVisible(false);
  }

  #isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof this.#window.Element)) return false;
    return !!target.closest(
      'a, button, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"]',
    );
  }

  #listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.#lifetime.listen(target, type, listener, options);
  }

  #now(): number {
    return this.#window.Date.now();
  }
}
