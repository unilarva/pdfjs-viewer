// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private transient-zoom input state machine: anchor tracking, CSS-transform
 * computation, wheel/WebKit/pointer input sessions, touch-scroll lock, and commit intent.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * This module owns gesture math/state, input-session RAFs/timers, and coalescing;
 * it never registers
 * DOM listeners itself. Session-invariant container and anchor-row geometry is
 * captured once, so ordinary frames read scroll position and write one transform.
 * The facade (`PdfjsViewer`) owns listener lifetime and the
 * cross-cutting "commit" sequencing (re-render, outline, navigation-state
 * sync), calling into this controller through the `ZoomGestureHost`
 * capability interface for the DOM reads/writes the gesture math needs.
 *
 * As a deliberate, narrow exception to "modules never touch the DOM", this
 * controller writes the CSS transform onto the element returned by
 * `host.getContentEl()` while a transient zoom is in progress: that
 * transform *is* the gesture's visual output, computing it without applying
 * it would just move the same DOM write one level up for no benefit. All
 * other style/layout writes stay in the facade. Document interruption calls
 * {@link ZoomGestureController.reset}, which drops pending input without commit,
 * clears session/touch-lock state and transient styles, and hides limit feedback.
 * `DocumentView` commits canonical scale/layout/scroll state; the facade sequences
 * that commit with feature publication. See the
 * [architecture guide](../ARCHITECTURE.md) for the authoritative zoom ownership
 * and commit boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module zoom-gesture
 */

export const WHEEL_ZOOM_MIN_DELTA_PX = 32;
const WHEEL_PIXELS_PER_LINE = 40;
const WHEEL_LINES_PER_PAGE = 30;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const STEPPED_WHEEL_ZOOM_DURATION_MS = 100;
const STEPPED_WHEEL_ZOOM_SENSITIVITY = 0.001;
const TOUCHPAD_PINCH_ZOOM_SENSITIVITY = 0.0011;
const WHEEL_ZOOM_COMMIT_IDLE_MS = 216;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Compares zoom scales with a tiny tolerance to avoid unnecessary rerenders. */
function scalesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4;
}

export interface ZoomGestureHost {
  getContentEl(): HTMLElement | null;
  /** Client-space bounds of the container's scrollport. */
  getViewportRect(): Readonly<{ left: number; top: number; width: number; height: number }>;
  getScrollPosition(): { left: number; top: number };
  setScrollPosition(pos: { left?: number; top?: number }): void;
  getCurrentScale(): number;
  getZoomLimits(): { min: number; max: number };
  /** Resolves a client point to the page underneath it or the geometrically nearest page. */
  resolvePageAnchor(clientPoint: {
    x: number;
    y: number;
  }): { pageNo: number; rect: DOMRect } | null;
  /** Canonical horizontal document envelope at the source scale. */
  getHorizontalEnvelope(): Readonly<{
    widestRowWidth: number;
    contentWidth: number;
    widestRowInset: number;
  }>;
  showZoomLimitHint(direction: "in" | "out"): void;
  hideZoomLimitHint(): void;
}

export interface ZoomGesturePlatform {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number | null): number | null;
}

interface ZoomCommitResult {
  fromScale: number;
  toScale: number;
  /** Content-local coordinate captured at `fromScale` when the session began. */
  anchorContent: Readonly<{ x: number; y: number }>;
  /** Source-scale offset from the exact or nearest page's top-left border edge. */
  anchorPage: Readonly<{ pageNo: number; offset: Readonly<{ x: number; y: number }> }> | null;
  centerClient: { x: number; y: number };
}

export class ZoomGestureController {
  readonly #platform: ZoomGesturePlatform;
  #sessionActive = false;
  #baseScale = 1;
  #targetScale = 1;
  #visualScale = 1;
  #centerClient: { x: number; y: number } | null = null;
  #anchorContent: { x: number; y: number } | null = null;
  #anchorPage: Readonly<{ pageNo: number; offset: Readonly<{ x: number; y: number }> }> | null =
    null;
  #sourceContentRect: Readonly<{ left: number; top: number }> | null = null;
  #sourceScroll: Readonly<{ left: number; top: number }> | null = null;
  #viewportRect: Readonly<{ left: number; top: number; width: number; height: number }> | null =
    null;
  #horizontalEnvelope: Readonly<{
    widestRowWidth: number;
    contentWidth: number;
    widestRowInset: number;
  }> | null = null;
  #previousContentTransition = "";
  #contentStylesCaptured = false;

  #touchScrollLock: { top: number; left: number } | null = null;

  #transientRaf: number | null = null;
  #pendingTransient: { scale: number; center: { x: number; y: number } } | null = null;
  #steppedWheelRaf: number | null = null;
  #steppedWheelStartTime: number | null = null;
  #steppedWheelFromScale = 1;

  // --- Native input-session ownership ---

  #wheelRaf: number | null = null;
  #wheelPendingDelta = 0;
  #wheelStarted = false;
  #wheelIdleTimer: number | null = null;
  #webKitGestureActive = false;
  #webKitStartScale = 1;
  #lastWebKitCenter: { x: number; y: number } | null = null;
  #touchPointers = new Map<number, { x: number; y: number }>();
  #pinchStartDistance = 0;
  #pointerPinchActive = false;

  constructor(platform: ZoomGesturePlatform) {
    this.#platform = platform;
  }

  get active(): boolean {
    return this.#sessionActive;
  }

  get baseScale(): number {
    return this.#baseScale;
  }

  get targetScale(): number {
    return this.#targetScale;
  }

  get touchScrollLocked(): boolean {
    return this.#touchScrollLock != null;
  }

  /** Whether a WebKit gesture stream currently has exclusive pinch ownership. */
  get webKitGestureActive(): boolean {
    return this.#webKitGestureActive;
  }

  /** Whether native pinch input should suppress selection and native touch scrolling. */
  get pinchInputActive(): boolean {
    return this.#webKitGestureActive || this.#touchPointers.size >= 2;
  }

  /** Whether pointer input, rather than another transient source, owns the session. */
  get pointerPinchActive(): boolean {
    return this.#pointerPinchActive;
  }

  /** Pure; safe to call outside a gesture (e.g. before deciding whether to start one). */
  static normalizeWheelZoomDelta(event: WheelEvent): number {
    const deltaY = event.deltaY;
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;

    let pixels = deltaY;
    if (event.deltaMode === WHEEL_DELTA_LINE) {
      pixels *= WHEEL_PIXELS_PER_LINE;
    } else if (event.deltaMode === WHEEL_DELTA_PAGE) {
      pixels *= WHEEL_PIXELS_PER_LINE * WHEEL_LINES_PER_PAGE;
    }

    return Math.sign(pixels) * Math.max(Math.abs(pixels), WHEEL_ZOOM_MIN_DELTA_PX);
  }

  /** Whether this event represents a physical wheel notch rather than continuous touchpad input. */
  static isSteppedWheelZoomEvent(event: WheelEvent): boolean {
    return (
      event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      Math.abs(event.deltaY) >= WHEEL_ZOOM_MIN_DELTA_PX
    );
  }

  /**
   * Accept an already-admitted Ctrl/Meta-wheel sample. The facade supplies only
   * transient-session orchestration and the canonical commit callback; wheel
   * accumulation, first-sample calibration, animation, and idle timing stay here.
   */
  admitWheelSample(
    sample: Readonly<{ delta: number; stepped: boolean; center: { x: number; y: number } }>,
    host: ZoomGestureHost,
    startSession: (center: { x: number; y: number }) => boolean,
    requestCommit: () => void,
  ): void {
    if (this.#webKitGestureActive) return;
    if (!this.#sessionActive) {
      this.#wheelStarted = false;
      if (!startSession(sample.center)) return;
    }
    this.#wheelPendingDelta += sample.delta;
    if (this.#wheelRaf != null) return;
    this.#wheelRaf = this.#platform.requestAnimationFrame(() => {
      this.#wheelRaf = null;
      const pending = this.#wheelPendingDelta;
      this.#wheelPendingDelta = 0;
      const delta = this.#wheelStarted
        ? pending
        : Math.sign(pending) * Math.max(Math.abs(pending), WHEEL_ZOOM_MIN_DELTA_PX);
      this.#wheelStarted = true;
      const sensitivity = sample.stepped
        ? STEPPED_WHEEL_ZOOM_SENSITIVITY
        : TOUCHPAD_PINCH_ZOOM_SENSITIVITY;
      const target = this.#targetScale * Math.exp(delta * sensitivity);
      if (sample.stepped) this.scheduleSteppedWheelUpdate(target, sample.center, host);
      else this.update(target, sample.center, host);

      this.#wheelIdleTimer = this.#platform.clearTimeout(this.#wheelIdleTimer);
      this.#wheelIdleTimer = this.#platform.setTimeout(() => {
        this.#wheelIdleTimer = null;
        requestCommit();
      }, WHEEL_ZOOM_COMMIT_IDLE_MS);
    });
  }

  /** Starts an exclusive WebKit gesture session after facade readiness admission. */
  beginWebKitGesture(
    sample: Readonly<{
      clientX?: number;
      clientY?: number;
      fallbackCenter: { x: number; y: number };
    }>,
    host: ZoomGestureHost,
    resetSession: () => void,
    startSession: (center: { x: number; y: number }) => boolean,
  ): boolean {
    if (this.#sessionActive) resetSession();
    this.#clearInputState();
    this.#webKitGestureActive = true;
    this.#webKitStartScale = host.getCurrentScale();
    const center = this.#webKitCenter(sample);
    this.lockTouchScroll(host);
    if (startSession(center)) return true;
    this.#clearInputState();
    this.clearTouchScrollLock();
    return false;
  }

  /** Coalesces an admitted WebKit gesture update and retains its last valid center. */
  updateWebKitGesture(
    sample: Readonly<{
      scale?: number;
      clientX?: number;
      clientY?: number;
      fallbackCenter: { x: number; y: number };
    }>,
    host: ZoomGestureHost,
  ): boolean {
    if (!this.#webKitGestureActive || !this.#sessionActive) return false;
    const scale = Number(sample.scale) || 1;
    this.schedule(this.#webKitStartScale * scale, this.#webKitCenter(sample), host);
    return true;
  }

  /** Ends the WebKit-exclusive input session and requests one facade commit. */
  endWebKitGesture(): boolean {
    if (!this.#webKitGestureActive) return false;
    this.#webKitGestureActive = false;
    this.#lastWebKitCenter = null;
    return this.#sessionActive;
  }

  /** Tracks an admitted touch pointer and starts a two-pointer pinch when appropriate. */
  pointerDown(
    pointer: Readonly<{ id: number; x: number; y: number }>,
    host: ZoomGestureHost,
    startSession: (center: { x: number; y: number }) => boolean,
  ): boolean {
    if (this.#webKitGestureActive) return false;
    this.#touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.#touchPointers.size !== 2 || this.#pointerPinchActive) return false;
    const [a, b] = [...this.#touchPointers.values()];
    this.#pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.lockTouchScroll(host);
    this.#pointerPinchActive = startSession(center);
    if (!this.#pointerPinchActive) {
      this.#touchPointers.clear();
      this.#pinchStartDistance = 0;
      this.clearTouchScrollLock();
    }
    return this.#pointerPinchActive;
  }

  /** Coalesces an admitted touch-pointer move into the active pinch session. */
  pointerMove(
    pointer: Readonly<{ id: number; x: number; y: number }>,
    host: ZoomGestureHost,
  ): boolean {
    if (!this.#touchPointers.has(pointer.id)) return false;
    this.#touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (
      !this.#pointerPinchActive ||
      this.#touchPointers.size !== 2 ||
      this.#pinchStartDistance <= 0
    )
      return false;
    const [a, b] = [...this.#touchPointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    this.schedule(
      this.#baseScale * (distance / this.#pinchStartDistance),
      {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      },
      host,
    );
    return true;
  }

  /** Releases a touch pointer and requests a single commit when its pinch ends. */
  pointerEnd(pointerId: number): boolean {
    this.#touchPointers.delete(pointerId);
    if (!this.#pointerPinchActive || this.#touchPointers.size >= 2) return false;
    this.#pointerPinchActive = false;
    this.#pinchStartDistance = 0;
    return this.#sessionActive;
  }

  #webKitCenter(
    sample: Readonly<{
      clientX?: number;
      clientY?: number;
      fallbackCenter: { x: number; y: number };
    }>,
  ): { x: number; y: number } {
    if (typeof sample.clientX === "number" && typeof sample.clientY === "number") {
      return (this.#lastWebKitCenter = { x: sample.clientX, y: sample.clientY });
    }
    return this.#lastWebKitCenter ?? (this.#lastWebKitCenter = sample.fallbackCenter);
  }

  /** Captures an exact or nearest page-relative source-layout anchor. */
  #updateAnchorFromPoint(pt: { x: number; y: number }, host: ZoomGestureHost): void {
    const found = host.resolvePageAnchor(pt);
    this.#anchorPage = found
      ? {
          pageNo: found.pageNo,
          offset: { x: pt.x - found.rect.left, y: pt.y - found.rect.top },
        }
      : null;
  }

  /** Begin a transient zoom session (CSS scale on the content element). */
  start(centerClient: { x: number; y: number }, host: ZoomGestureHost): void {
    const contentEl = host.getContentEl();
    if (!contentEl) return;
    const beginningSession = !this.#sessionActive;

    const scroll = host.getScrollPosition();
    const contentRect = contentEl.getBoundingClientRect();

    this.#sessionActive = true;
    this.#baseScale = host.getCurrentScale();
    this.#targetScale = this.#baseScale;
    this.#visualScale = this.#baseScale;
    this.#centerClient = centerClient;
    this.#anchorContent = {
      x: centerClient.x - contentRect.left,
      y: centerClient.y - contentRect.top,
    };
    this.#sourceContentRect = { left: contentRect.left, top: contentRect.top };
    this.#sourceScroll = scroll;
    this.#viewportRect = host.getViewportRect();
    contentEl.style.transformOrigin = "0 0";
    this.#updateAnchorFromPoint(centerClient, host);
    this.#horizontalEnvelope = host.getHorizontalEnvelope();
    if (beginningSession) {
      this.#previousContentTransition = contentEl.style.transition;
      this.#contentStylesCaptured = true;
      contentEl.style.transition = "none";
    }
  }

  /** Update transient target state and report feedback for an attempted scale. */
  #setTargetScale(
    targetScale: number,
    centerClient: { x: number; y: number },
    host: ZoomGestureHost,
  ): void {
    const limits = host.getZoomLimits();
    const clampedTarget = clamp(targetScale, limits.min, limits.max);
    if (!scalesEqual(clampedTarget, targetScale)) {
      host.showZoomLimitHint(targetScale > clampedTarget ? "in" : "out");
    } else {
      host.hideZoomLimitHint();
    }

    this.#targetScale = clampedTarget;
    this.#centerClient = centerClient;
  }

  /** Write the transient CSS transform for a scale already accepted as the target. */
  #applyTransientScale(
    scale: number,
    centerClient: { x: number; y: number },
    host: ZoomGestureHost,
  ): void {
    const contentEl = host.getContentEl();
    if (!contentEl) return;

    this.syncTouchScrollLock(host);

    const anchor = this.#anchorContent;
    const sourceContentRect = this.#sourceContentRect;
    const sourceScroll = this.#sourceScroll;
    if (!anchor || !sourceContentRect || !sourceScroll) return;

    const currentScale = host.getCurrentScale();
    const factor = scale / currentScale;
    const scroll = host.getScrollPosition();
    const contentLeft = sourceContentRect.left + sourceScroll.left - scroll.left;
    const contentTop = sourceContentRect.top + sourceScroll.top - scroll.top;
    let translateX = centerClient.x - contentLeft - factor * anchor.x;
    const translateY = centerClient.y - contentTop - factor * anchor.y;

    // Project against the widest-row document envelope, never the anchor row.
    // A single transform then preserves every row's canonical centering and only
    // clamps at a true document edge.
    const viewportRect = this.#viewportRect;
    const envelope = this.#horizontalEnvelope;
    if (envelope && viewportRect) {
      const targetWidestRowWidth = envelope.widestRowWidth * factor;
      const targetContentWidth = Math.max(viewportRect.width, Math.ceil(targetWidestRowWidth));
      const targetWidestRowInset = (targetContentWidth - targetWidestRowWidth) / 2;
      const targetScrollMax =
        targetWidestRowWidth <= viewportRect.width + 0.5
          ? 0
          : targetContentWidth - viewportRect.width;
      const targetAnchorX =
        factor * anchor.x + targetWidestRowInset - factor * envelope.widestRowInset;
      const targetScroll = clamp(
        viewportRect.left + targetAnchorX - centerClient.x,
        0,
        targetScrollMax,
      );
      translateX =
        viewportRect.left +
        targetWidestRowInset -
        factor * envelope.widestRowInset -
        targetScroll -
        contentLeft;
    }

    contentEl.style.transform = `matrix(${factor}, 0, 0, ${factor}, ${translateX}, ${translateY})`;
    this.#visualScale = scale;
  }

  /** Update the transient CSS scale immediately for continuous pinch or slider input. */
  update(targetScale: number, centerClient: { x: number; y: number }, host: ZoomGestureHost): void {
    this.#cancelSteppedWheelAnimation();
    this.#setTargetScale(targetScale, centerClient, host);
    this.#applyTransientScale(this.#targetScale, centerClient, host);
  }

  /** Smooth one or more discrete mouse-wheel steps without delaying their eventual commit. */
  scheduleSteppedWheelUpdate(
    targetScale: number,
    centerClient: { x: number; y: number },
    host: ZoomGestureHost,
  ): void {
    this.#setTargetScale(targetScale, centerClient, host);
    this.#steppedWheelFromScale = this.#visualScale;
    this.#steppedWheelStartTime = null;
    if (this.#steppedWheelRaf != null) return;
    this.#queueSteppedWheelFrame(host);
  }

  #queueSteppedWheelFrame(host: ZoomGestureHost): void {
    this.#steppedWheelRaf = this.#platform.requestAnimationFrame(time => {
      this.#steppedWheelRaf = null;
      this.#runSteppedWheelFrame(time, host);
    });
  }

  #runSteppedWheelFrame(time: number, host: ZoomGestureHost): void {
    const startTime = this.#steppedWheelStartTime ?? time;
    this.#steppedWheelStartTime = startTime;
    const progress = Math.min(1, (time - startTime) / STEPPED_WHEEL_ZOOM_DURATION_MS);
    const scale =
      this.#steppedWheelFromScale + (this.#targetScale - this.#steppedWheelFromScale) * progress;
    const center = this.#centerClient;
    if (center) this.#applyTransientScale(scale, center, host);

    if (progress < 1 && !scalesEqual(scale, this.#targetScale)) {
      this.#queueSteppedWheelFrame(host);
    } else {
      this.#steppedWheelStartTime = null;
    }
  }

  /** Coalesces high-frequency native pinch samples to one update per frame. */
  schedule(scale: number, center: { x: number; y: number }, host: ZoomGestureHost): void {
    this.#cancelSteppedWheelAnimation();
    this.#pendingTransient = { scale, center };
    if (this.#transientRaf != null) return;
    this.#transientRaf = this.#platform.requestAnimationFrame(() => {
      this.#transientRaf = null;
      const pending = this.#pendingTransient;
      this.#pendingTransient = null;
      if (pending) this.update(pending.scale, pending.center, host);
    });
  }

  /** Cancels a scheduled coalesced update without applying it (e.g. on teardown). */
  cancelPending(): void {
    if (this.#transientRaf != null) {
      this.#platform.cancelAnimationFrame(this.#transientRaf);
      this.#transientRaf = null;
    }
    this.#pendingTransient = null;
    this.#cancelSteppedWheelAnimation();
  }

  /** Applies the latest coalesced pinch sample before the gesture commits. */
  flush(host: ZoomGestureHost): void {
    if (this.#transientRaf != null) {
      this.#platform.cancelAnimationFrame(this.#transientRaf);
      this.#transientRaf = null;
    }
    const pending = this.#pendingTransient;
    this.#pendingTransient = null;
    if (pending) this.update(pending.scale, pending.center, host);
    if (this.#steppedWheelRaf != null) {
      this.#cancelSteppedWheelAnimation();
      const center = this.#centerClient;
      if (center) this.#applyTransientScale(this.#targetScale, center, host);
    }
  }

  /**
   * Resolves the final before/after scale and anchor for a commit. Does not
   * clear the CSS transform, re-render, or touch outline/navigation state:
   * the facade performs that cross-cutting sequencing after reading this
   * result, then calls {@link finishSession}.
   */
  computeCommit(host: ZoomGestureHost): ZoomCommitResult {
    this.#cancelInputCallbacks();
    this.flush(host);
    host.hideZoomLimitHint();
    this.syncTouchScrollLock(host);
    this.clearTouchScrollLock();

    const limits = host.getZoomLimits();
    const anchorContent = this.#anchorContent;
    const centerClient = this.#centerClient;
    if (!anchorContent || !centerClient)
      throw new Error("ZoomGestureController: cannot commit without an active anchor");
    return {
      fromScale: host.getCurrentScale(),
      toScale: clamp(this.#targetScale, limits.min, limits.max),
      anchorContent,
      anchorPage: this.#anchorPage,
      centerClient,
    };
  }

  /** Clears session state after the facade completes the commit sequence. */
  finishSession(host: ZoomGestureHost): void {
    host.hideZoomLimitHint();
    this.clearTouchScrollLock();

    this.#sessionActive = false;
    this.#centerClient = null;
    this.#anchorContent = null;
    this.#anchorPage = null;
    this.#targetScale = host.getCurrentScale();
    this.#visualScale = this.#targetScale;
    this.#clearSessionGeometryAndStyles(host.getContentEl());
  }

  /** Snapshot the native scroll position at the start of a touch pinch. */
  lockTouchScroll(host: Pick<ZoomGestureHost, "getScrollPosition">): void {
    const pos = host.getScrollPosition();
    this.#touchScrollLock = { top: pos.top, left: pos.left };
  }

  /** Keep the native scroll position fixed while touch-pinch zoom is active. */
  syncTouchScrollLock(
    host: Pick<ZoomGestureHost, "getScrollPosition" | "setScrollPosition">,
  ): boolean {
    const lock = this.#touchScrollLock;
    if (!lock) return false;

    const pos = host.getScrollPosition();
    const next: { left?: number; top?: number } = {};
    let changed = false;
    if (pos.top !== lock.top) {
      next.top = lock.top;
      changed = true;
    }
    if (pos.left !== lock.left) {
      next.left = lock.left;
      changed = true;
    }
    if (changed) host.setScrollPosition(next);
    return changed;
  }

  /** Clear the touch-pinch scroll lock once the gesture is done. */
  clearTouchScrollLock(): void {
    this.#touchScrollLock = null;
  }

  /**
   * Aborts a transient session without committing old-document zoom. Pending RAF
   * work is cancelled before styles and state are cleared. Idempotent and safe
   * during close, replacement, destruction, or gesture interruption.
   */
  reset(host: ZoomGestureHost): void {
    this.#cancelInputCallbacks();
    this.#clearInputState();
    this.cancelPending();
    const contentEl = host.getContentEl();
    if (contentEl) {
      contentEl.style.transform = "";
      contentEl.style.transformOrigin = "";
    }
    this.#clearSessionGeometryAndStyles(contentEl);
    host.hideZoomLimitHint();
    this.#touchScrollLock = null;
    this.#sessionActive = false;
    this.#centerClient = null;
    this.#anchorContent = null;
    this.#anchorPage = null;
    this.#baseScale = host.getCurrentScale();
    this.#targetScale = this.#baseScale;
    this.#visualScale = this.#baseScale;
  }

  #cancelSteppedWheelAnimation(): void {
    if (this.#steppedWheelRaf != null) {
      this.#platform.cancelAnimationFrame(this.#steppedWheelRaf);
      this.#steppedWheelRaf = null;
    }
    this.#steppedWheelStartTime = null;
  }

  #cancelInputCallbacks(): void {
    if (this.#wheelRaf != null) {
      this.#platform.cancelAnimationFrame(this.#wheelRaf);
      this.#wheelRaf = null;
    }
    this.#wheelIdleTimer = this.#platform.clearTimeout(this.#wheelIdleTimer);
    this.#wheelPendingDelta = 0;
    this.#wheelStarted = false;
  }

  #clearInputState(): void {
    this.#webKitGestureActive = false;
    this.#webKitStartScale = 1;
    this.#lastWebKitCenter = null;
    this.#touchPointers.clear();
    this.#pinchStartDistance = 0;
    this.#pointerPinchActive = false;
  }

  #clearSessionGeometryAndStyles(contentEl: HTMLElement | null): void {
    if (contentEl && this.#contentStylesCaptured) {
      contentEl.style.transition = this.#previousContentTransition;
    }
    this.#sourceContentRect = null;
    this.#sourceScroll = null;
    this.#viewportRect = null;
    this.#horizontalEnvelope = null;
    this.#previousContentTransition = "";
    this.#contentStylesCaptured = false;
  }
}
