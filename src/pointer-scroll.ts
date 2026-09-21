// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private mouse-drag, inertial-fling, and middle-mouse auto-scroll state machine.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * This module owns the gesture state machines, their RAFs, and scroll-position
 * math; it never registers event listeners itself. The facade (`PdfjsViewer`)
 * owns listener lifetimes and motion publication, and forwards
 * raw mouse events into the thin methods below, reading/writing scroll
 * position and cursor through the `PointerScrollHost` capability interface.
 * Document teardown calls {@link PointerScrollController.reset}, which cancels
 * drag, fling, and auto-scroll synchronously and restores the host cursor. This
 * prevents RAF closures from retaining usable callbacks into a replacement.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative gesture
 * controller/facade boundary and document interruption order.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module pointer-scroll
 */

export interface PointerScrollHost {
  /** Whether the current row already fits horizontally (locks horizontal movement/velocity). */
  rowFitsHorizontally(): boolean;
  /** Clamps/normalizes horizontal scroll position after a scroll-affecting mutation. */
  normalizeHorizontalScroll(): void;
  getScrollPosition(): { left: number; top: number };
  setScrollPosition(pos: { left?: number; top?: number }): void;
  setCursor(cursor: string): void;
}

interface PointerScrollPlatform {
  now(): number;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
}

export class PointerScrollController {
  readonly #platform: PointerScrollPlatform;
  // --- Drag + fling state ---
  #isDragging = false;
  #lastX = 0;
  #lastY = 0;
  #lastTime = 0;
  #velX = 0;
  #velY = 0;
  #flingRaf: number | null = null;
  #flingPrevTime: number | null = null;
  #flingResidualX = 0;
  #flingResidualY = 0;

  /** Damping coefficient for fling decay: larger = stronger friction. */
  static readonly FLING_DECAY = 0.0035;

  // --- Middle-mouse auto-scroll state ---
  #autoScrollActive = false;
  #autoOriginX = 0;
  #autoOriginY = 0;
  #autoX = 0;
  #autoY = 0;
  #autoScrollRaf: number | null = null;

  constructor(platform: PointerScrollPlatform) {
    this.#platform = platform;
  }

  /** True while a drag or auto-scroll gesture is in progress. */
  get isDragging(): boolean {
    return this.#isDragging;
  }

  get isAutoScrolling(): boolean {
    return this.#autoScrollActive;
  }

  // --- Mouse Drag Scroll + Fling ---

  /** Call from the facade's `mousedown` listener (button 0 only). */
  onDragStart(clientX: number, clientY: number, host: PointerScrollHost): void {
    this.#cancelFling();

    this.#isDragging = true;
    this.#lastX = clientX;
    this.#lastY = clientY;
    this.#lastTime = this.#platform.now();
    this.#velX = this.#velY = 0;

    host.setCursor("grabbing");
  }

  /** Call from the facade's window-level `mousemove` listener while dragging. */
  onDragMove(clientX: number, clientY: number, host: PointerScrollHost): void {
    if (!this.#isDragging) return;
    const now = this.#platform.now();
    const dt = now - this.#lastTime || 16;
    const dx = clientX - this.#lastX;
    const dy = clientY - this.#lastY;
    const lockX = host.rowFitsHorizontally();

    const pos = host.getScrollPosition();
    const next: { left?: number; top?: number } = { top: pos.top - dy };
    if (!lockX) next.left = pos.left - dx;
    host.setScrollPosition(next);

    this.#velX = lockX ? 0 : (dx / dt) * 16;
    this.#velY = (dy / dt) * 16;
    host.normalizeHorizontalScroll();

    this.#lastX = clientX;
    this.#lastY = clientY;
    this.#lastTime = now;
  }

  /**
   * Call from the facade's window-level `mouseup` listener while dragging.
   * Returns whether a fling should start (facade has already scheduled the
   * raf-driven step via {@link stepFling} if this returns true is handled
   * internally by this class using `requestAnimationFrame`).
   */
  onDragEnd(host: PointerScrollHost): void {
    if (!this.#isDragging) return;
    this.#isDragging = false;
    host.setCursor("");

    if (Math.abs(this.#velX) > 0.5 || Math.abs(this.#velY) > 0.5) {
      this.#startFling(host);
    }
  }

  #startFling(host: PointerScrollHost): void {
    this.#flingPrevTime = null;
    this.#flingResidualX = 0;
    this.#flingResidualY = 0;
    this.#flingRaf = this.#platform.requestAnimationFrame(t => this.#flingStep(t, host));
  }

  #flingStep(t: number, host: PointerScrollHost): void {
    if (this.#flingPrevTime == null) this.#flingPrevTime = t;
    const dt = Math.max(0, t - this.#flingPrevTime);
    this.#flingPrevTime = t;

    const decay = Math.exp(-PointerScrollController.FLING_DECAY * dt);
    this.#velX *= decay;
    this.#velY *= decay;

    if (host.rowFitsHorizontally()) this.#velX = 0;

    const position = host.getScrollPosition();
    const targetLeft = position.left - (this.#velX * dt) / 16 + this.#flingResidualX;
    const targetTop = position.top - (this.#velY * dt) / 16 + this.#flingResidualY;
    host.setScrollPosition({
      left: targetLeft,
      top: targetTop,
    });
    host.normalizeHorizontalScroll();
    const applied = host.getScrollPosition();
    this.#flingResidualX = Math.max(-1, Math.min(1, targetLeft - applied.left));
    this.#flingResidualY = Math.max(-1, Math.min(1, targetTop - applied.top));

    if (Math.abs(this.#velX) > 0.1 || Math.abs(this.#velY) > 0.1) {
      this.#flingRaf = this.#platform.requestAnimationFrame(next => this.#flingStep(next, host));
    } else {
      this.#flingRaf = null;
      this.#flingPrevTime = null;
    }
  }

  #cancelFling(): void {
    if (this.#flingRaf != null) {
      this.#platform.cancelAnimationFrame(this.#flingRaf);
      this.#flingRaf = null;
    }
    this.#flingPrevTime = null;
    this.#flingResidualX = 0;
    this.#flingResidualY = 0;
  }

  // --- Middle Mouse Auto-Scroll ---

  /** Call from the facade's `mousedown` listener (button 1 only). */
  onAutoScrollStart(clientX: number, clientY: number, host: PointerScrollHost): void {
    this.#autoScrollActive = true;
    this.#autoOriginX = clientX;
    this.#autoOriginY = clientY;
    this.#autoX = this.#autoY = 0;
    host.setCursor("all-scroll");

    if (this.#autoScrollRaf == null) {
      this.#autoScrollRaf = this.#platform.requestAnimationFrame(() => this.#autoScrollStep(host));
    }
  }

  /** Call from the facade's `mousemove` listener while auto-scrolling. */
  onAutoScrollMove(clientX: number, clientY: number): void {
    if (!this.#autoScrollActive) return;
    this.#autoX = clientX - this.#autoOriginX;
    this.#autoY = clientY - this.#autoOriginY;
  }

  /** Call from the facade's `mouseup`/`mouseleave` listeners. */
  onAutoScrollEnd(host: PointerScrollHost): void {
    this.#autoScrollActive = false;
    host.setCursor("");
    if (this.#autoScrollRaf != null) {
      this.#platform.cancelAnimationFrame(this.#autoScrollRaf);
      this.#autoScrollRaf = null;
    }
  }

  #autoScrollStep(host: PointerScrollHost): void {
    if (!this.#autoScrollActive) {
      this.#autoScrollRaf = null;
      return;
    }
    const pos = host.getScrollPosition();
    const next: { left?: number; top?: number } = { top: pos.top + this.#autoY * 0.2 };
    if (!host.rowFitsHorizontally()) next.left = pos.left + this.#autoX * 0.2;
    host.setScrollPosition(next);
    host.normalizeHorizontalScroll();
    this.#autoScrollRaf = this.#platform.requestAnimationFrame(() => this.#autoScrollStep(host));
  }

  /**
   * Interrupts all document-relative pointer motion and restores the cursor.
   * Safe before a gesture and on repeated close/replacement/destroy teardown.
   */
  reset(host: PointerScrollHost): void {
    this.#isDragging = false;
    this.#autoScrollActive = false;
    this.#velX = this.#velY = 0;
    this.#cancelFling();
    if (this.#autoScrollRaf != null) {
      this.#platform.cancelAnimationFrame(this.#autoScrollRaf);
      this.#autoScrollRaf = null;
    }
    host.setCursor("");
  }
}
