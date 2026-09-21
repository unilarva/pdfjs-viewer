// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  ZoomGestureController,
  WHEEL_ZOOM_MIN_DELTA_PX,
  type ZoomGestureHost,
  type ZoomGesturePlatform,
} from "../../src/zoom-gesture.js";

const zoomPlatform = {
  requestAnimationFrame: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancelAnimationFrame: (id: number) => cancelAnimationFrame(id),
  setTimeout: (callback: () => void, delay: number) =>
    setTimeout(callback, delay) as unknown as number,
  clearTimeout: (id: number | null) => {
    if (id != null) clearTimeout(id);
    return null;
  },
};

// Node has no WheelEvent global; the module reads its DOM_DELTA_* constants
// only at call time (inside `normalizeWheelZoomDelta`), so it's safe to stub
// this after the static import above.
(
  globalThis as unknown as {
    WheelEvent: { DOM_DELTA_PIXEL: number; DOM_DELTA_LINE: number; DOM_DELTA_PAGE: number };
  }
).WheelEvent ??= {
  DOM_DELTA_PIXEL: 0,
  DOM_DELTA_LINE: 1,
  DOM_DELTA_PAGE: 2,
};

// Node has no rAF; stub a controllable queue so scheduled updates can be
// driven deterministically in tests.
type RafCallback = (time: number) => void;
function installRafStub() {
  let nextId = 1;
  const callbacks = new Map<number, RafCallback>();
  (
    globalThis as unknown as { requestAnimationFrame: (cb: RafCallback) => number }
  ).requestAnimationFrame = cb => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  };
  (globalThis as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame =
    id => {
      callbacks.delete(id);
    };
  return {
    step(time: number) {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of pending) cb(time);
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

function inputPlatform(): {
  platform: ZoomGesturePlatform;
  stepFrame(time: number): void;
  fireTimers(): void;
  pendingFrames(): number;
  pendingTimers(): number;
} {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  return {
    platform: {
      requestAnimationFrame: callback => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: id => frames.delete(id),
      setTimeout: callback => {
        const id = nextId++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: id => {
        if (id != null) timers.delete(id);
        return null;
      },
    },
    stepFrame(time) {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(time);
    },
    fireTimers() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, callback] of pending) callback();
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

interface FakeState {
  scrollLeft: number;
  scrollTop: number;
  containerRect: DOMRect;
  containerWidth: number;
  containerHeight: number;
  scale: number;
  minScale: number;
  maxScale: number;
  page: { pageNo: number; rect: DOMRect } | null;
  horizontalEnvelope: { widestRowWidth: number; contentWidth: number; widestRowInset: number };
  contentRect: DOMRect;
  transform: string;
  transformOrigin: string;
  transition: string;
  viewportRectReads: number;
  horizontalEnvelopeReads: number;
  hintDirection: "in" | "out" | null;
}

function fakeHost(): { host: ZoomGestureHost; state: FakeState } {
  const state: FakeState = {
    scrollLeft: 0,
    scrollTop: 0,
    containerRect: rect(0, 0, 800, 600),
    containerWidth: 800,
    containerHeight: 600,
    scale: 1,
    minScale: 0.2,
    maxScale: 4,
    page: { pageNo: 3, rect: rect(0, 0, 800, 1000) },
    horizontalEnvelope: { widestRowWidth: 800, contentWidth: 800, widestRowInset: 0 },
    contentRect: rect(0, 0, 800, 3000),
    transform: "",
    transformOrigin: "",
    transition: "opacity 1s",
    viewportRectReads: 0,
    horizontalEnvelopeReads: 0,
    hintDirection: null,
  };
  const contentEl = {
    getBoundingClientRect: () => state.contentRect,
    style: {
      get transform() {
        return state.transform;
      },
      set transform(v: string) {
        state.transform = v;
      },
      get transformOrigin() {
        return state.transformOrigin;
      },
      set transformOrigin(v: string) {
        state.transformOrigin = v;
      },
      get transition() {
        return state.transition;
      },
      set transition(v: string) {
        state.transition = v;
      },
    },
  } as unknown as HTMLElement;

  const host: ZoomGestureHost = {
    getContentEl: () => contentEl,
    getViewportRect: () => {
      state.viewportRectReads++;
      return {
        left: state.containerRect.left,
        top: state.containerRect.top,
        width: state.containerWidth,
        height: state.containerHeight,
      };
    },
    getScrollPosition: () => ({ left: state.scrollLeft, top: state.scrollTop }),
    setScrollPosition: pos => {
      if (pos.left !== undefined) state.scrollLeft = pos.left;
      if (pos.top !== undefined) state.scrollTop = pos.top;
    },
    getCurrentScale: () => state.scale,
    getZoomLimits: () => ({ min: state.minScale, max: state.maxScale }),
    resolvePageAnchor: () => state.page,
    getHorizontalEnvelope: () => {
      state.horizontalEnvelopeReads++;
      return state.horizontalEnvelope;
    },
    showZoomLimitHint: direction => {
      state.hintDirection = direction;
    },
    hideZoomLimitHint: () => {
      state.hintDirection = null;
    },
  };
  return { host, state };
}

test("start() begins a session, sets transform-origin, and resolves the anchor page", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);

  assert.equal(controller.active, true);
  assert.equal(controller.baseScale, 1);
  assert.equal(controller.targetScale, 1);
  assert.equal(state.transformOrigin, "0 0");
  assert.equal(state.transition, "none");
});

test("session-invariant layout geometry is read once and transient styles are restored", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();
  controller.start({ x: 400, y: 300 }, host);

  controller.update(1.2, { x: 410, y: 305 }, host);
  controller.update(1.4, { x: 420, y: 310 }, host);
  assert.deepEqual(
    {
      viewport: state.viewportRectReads,
      envelope: state.horizontalEnvelopeReads,
    },
    { viewport: 1, envelope: 1 },
  );

  controller.finishSession(host);
  assert.equal(state.transition, "opacity 1s");
});

test("reset without an active session preserves consumer compositor styles", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();
  controller.reset(host);
  assert.equal(state.transition, "opacity 1s");
});

test("update() clamps target scale and shows the limit hint past min/max", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  controller.update(10, { x: 400, y: 300 }, host); // way past maxScale=4
  assert.equal(controller.targetScale, 4);
  assert.equal(state.hintDirection, "in");

  controller.update(2, { x: 400, y: 300 }, host); // back in range
  assert.equal(controller.targetScale, 2);
  assert.equal(state.hintDirection, null);
  assert.ok(state.transform.startsWith("matrix("), "should apply a CSS matrix transform");
});

test("update() preserves an already-centered fitting document at factor one", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();
  state.horizontalEnvelope = { widestRowWidth: 400, contentWidth: 800, widestRowInset: 200 };

  controller.start({ x: 400, y: 300 }, host);
  controller.update(1, { x: 400, y: 300 }, host);

  const match = state.transform.match(/matrix\(([^,]+), 0, 0, ([^,]+), ([^,]+), ([^)]+)\)/);
  assert.ok(match, "expected a matrix transform");
  const translateX = Number(match![3]);
  assert.equal(translateX, 0);
});

test("update() does not clamp a book singleton against its own page edges", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();
  state.horizontalEnvelope = { widestRowWidth: 1220, contentWidth: 1220, widestRowInset: 0 };
  state.contentRect = rect(0, 0, 1220, 3000);
  state.page = { pageNo: 1, rect: rect(310, 0, 600, 800) };

  controller.start({ x: 400, y: 300 }, host);
  controller.update(1, { x: 400, y: 300 }, host);
  assert.equal(state.transform, "matrix(1, 0, 0, 1, 0, 0)");

  controller.update(1.1, { x: 400, y: 300 }, host);
  const match = state.transform.match(/matrix\(([^,]+), 0, 0, ([^,]+), ([^,]+), ([^)]+)\)/);
  assert.ok(match, "expected a matrix transform");
  assert.ok(Math.abs(Number(match[3]) + 40) < 1e-9);
  assert.equal(Number(match[4]), -30);
});

test("schedule()/flush() coalesce pinch samples to one update per frame", () => {
  const raf = installRafStub();
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  controller.schedule(1.5, { x: 400, y: 300 }, host);
  controller.schedule(2, { x: 400, y: 300 }, host); // overwrites pending, still one raf
  assert.equal(raf.pendingCount(), 1);
  assert.equal(state.transform, "", "update should not apply until the frame runs");

  raf.step(0);
  assert.equal(controller.targetScale, 2, "only the latest coalesced sample should apply");
  assert.equal(raf.pendingCount(), 0);
});

test("stepped wheel updates interpolate visual scale but flush the committed target", () => {
  const raf = installRafStub();
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  controller.scheduleSteppedWheelUpdate(2, { x: 400, y: 300 }, host);
  assert.equal(controller.targetScale, 2, "the commit target is available immediately");
  assert.equal(state.transform, "", "the visual transform waits for a frame");

  raf.step(0);
  raf.step(50);
  assert.match(state.transform, /matrix\(1\.5, 0, 0, 1\.5,/);

  const commit = controller.computeCommit(host);
  assert.equal(commit.toScale, 2, "commit flushes the remaining interpolation");
  assert.match(state.transform, /matrix\(2, 0, 0, 2,/);
  assert.equal(raf.pendingCount(), 0);
});

test("flush() applies a pending sample synchronously and cancels the scheduled frame", () => {
  const raf = installRafStub();
  const controller = new ZoomGestureController(zoomPlatform);
  const { host } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  controller.schedule(1.8, { x: 400, y: 300 }, host);
  assert.equal(raf.pendingCount(), 1);

  controller.flush(host);
  assert.equal(controller.targetScale, 1.8);
  assert.equal(raf.pendingCount(), 0);
});

test("computeCommit() resolves clamped before/after scale and anchor, then clears touch lock", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  controller.lockTouchScroll(host);
  assert.equal(controller.touchScrollLocked, true);

  controller.update(6, { x: 400, y: 300 }, host); // clamps to maxScale=4 internally
  const commit = controller.computeCommit(host);

  assert.equal(commit.fromScale, state.scale);
  assert.equal(commit.toScale, 4);
  assert.deepEqual(commit.anchorPage, { pageNo: 3, offset: { x: 400, y: 300 } });
  assert.equal(controller.touchScrollLocked, false, "computeCommit clears the touch-scroll lock");
  assert.equal(state.hintDirection, null, "computeCommit hides the limit hint");
});

test("computeCommit() preserves content-local and nearest-page anchors for a moving gap gesture", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();
  state.scrollLeft = 25;
  state.scrollTop = 75;
  state.contentRect = rect(-25, -75, 800, 3000);
  state.page = { pageNo: 2, rect: rect(100, 100, 200, 100) };

  controller.start({ x: 400, y: 300 }, host);
  controller.update(2, { x: 460, y: 340 }, host);
  const commit = controller.computeCommit(host);

  assert.deepEqual(commit.anchorContent, { x: 425, y: 375 });
  assert.deepEqual(commit.anchorPage, { pageNo: 2, offset: { x: 300, y: 200 } });
  assert.deepEqual(commit.centerClient, { x: 460, y: 340 });
  assert.equal(state.transform, "matrix(2, 0, 0, 2, -365, -335)");
});

test("finishSession() clears session state and resets targetScale to the current scale", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  state.scale = 2; // simulate the facade having committed the scale already
  controller.finishSession(host);

  assert.equal(controller.active, false);
  assert.equal(controller.targetScale, 2);
});

test("syncTouchScrollLock() restores the locked scroll position and reports whether it changed", () => {
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();

  controller.lockTouchScroll(host); // locks at {left:0, top:0}
  assert.equal(controller.syncTouchScrollLock(host), false, "no drift yet");

  state.scrollLeft = 50;
  state.scrollTop = 20;
  assert.equal(controller.syncTouchScrollLock(host), true);
  assert.equal(state.scrollLeft, 0);
  assert.equal(state.scrollTop, 0);

  controller.clearTouchScrollLock();
  state.scrollLeft = 50;
  assert.equal(controller.syncTouchScrollLock(host), false, "no lock active after clearing");
  assert.equal(state.scrollLeft, 50);
});

test("cancelPending() drops a scheduled update without applying it", () => {
  const raf = installRafStub();
  const controller = new ZoomGestureController(zoomPlatform);
  const { host } = fakeHost();

  controller.start({ x: 400, y: 300 }, host);
  controller.schedule(3, { x: 400, y: 300 }, host);
  assert.equal(raf.pendingCount(), 1);

  controller.cancelPending();
  assert.equal(raf.pendingCount(), 0);
  assert.equal(controller.targetScale, 1, "cancelled sample must not apply");
});

test("reset() cancels stale raf and clears transform, hint, session, and touch lock", () => {
  const raf = installRafStub();
  const controller = new ZoomGestureController(zoomPlatform);
  const { host, state } = fakeHost();
  controller.start({ x: 400, y: 300 }, host);
  controller.lockTouchScroll(host);
  controller.update(10, { x: 400, y: 300 }, host);
  controller.schedule(2, { x: 400, y: 300 }, host);
  assert.equal(raf.pendingCount(), 1);
  controller.reset(host);
  assert.equal(raf.pendingCount(), 0);
  assert.equal(controller.active, false);
  assert.equal(controller.touchScrollLocked, false);
  assert.equal(state.transform, "");
  assert.equal(state.transformOrigin, "");
  assert.equal(state.hintDirection, null);
});

test("normalizeWheelZoomDelta() calibrates line/page modes and enforces the minimum-first-sample delta", () => {
  const pixelEvent = { deltaY: 100, deltaMode: 0 } as WheelEvent; // DOM_DELTA_PIXEL
  assert.equal(ZoomGestureController.normalizeWheelZoomDelta(pixelEvent), 100);

  const tinyPixelEvent = { deltaY: 2, deltaMode: 0 } as WheelEvent;
  assert.equal(
    ZoomGestureController.normalizeWheelZoomDelta(tinyPixelEvent),
    WHEEL_ZOOM_MIN_DELTA_PX,
  );

  const lineEvent = { deltaY: 1, deltaMode: 1 } as WheelEvent; // DOM_DELTA_LINE
  assert.equal(ZoomGestureController.normalizeWheelZoomDelta(lineEvent), 40);

  const pageEvent = { deltaY: 1, deltaMode: 2 } as WheelEvent; // DOM_DELTA_PAGE
  assert.equal(ZoomGestureController.normalizeWheelZoomDelta(pageEvent), 40 * 30);

  const negativeEvent = { deltaY: -5, deltaMode: 0 } as WheelEvent;
  assert.equal(
    ZoomGestureController.normalizeWheelZoomDelta(negativeEvent),
    -WHEEL_ZOOM_MIN_DELTA_PX,
  );

  const zeroEvent = { deltaY: 0, deltaMode: 0 } as WheelEvent;
  assert.equal(ZoomGestureController.normalizeWheelZoomDelta(zeroEvent), 0);
});

test("isSteppedWheelZoomEvent() keeps continuous pixel touchpad input direct", () => {
  assert.equal(
    ZoomGestureController.isSteppedWheelZoomEvent({ deltaY: 1, deltaMode: 0 } as WheelEvent),
    false,
  );
  assert.equal(
    ZoomGestureController.isSteppedWheelZoomEvent({ deltaY: 120, deltaMode: 0 } as WheelEvent),
    true,
  );
  assert.equal(
    ZoomGestureController.isSteppedWheelZoomEvent({ deltaY: 1, deltaMode: 1 } as WheelEvent),
    true,
  );
});

test("admitWheelSample() owns accumulation, first sample, compounding, and one idle commit", () => {
  const input = inputPlatform();
  const controller = new ZoomGestureController(input.platform);
  const { host } = fakeHost();
  let starts = 0;
  let commits = 0;
  const start = (center: { x: number; y: number }) => {
    starts++;
    controller.start(center, host);
    return controller.active;
  };
  const commit = () => {
    commits++;
    controller.computeCommit(host);
  };

  controller.admitWheelSample(
    { delta: 1, stepped: false, center: { x: 400, y: 300 } },
    host,
    start,
    commit,
  );
  controller.admitWheelSample(
    { delta: 1, stepped: false, center: { x: 420, y: 320 } },
    host,
    start,
    commit,
  );
  assert.equal(starts, 1);
  assert.equal(input.pendingFrames(), 1);
  input.stepFrame(0);
  assert.ok(controller.targetScale > 1.03, "first frame applies minimum first-sample delta");
  const afterFirst = controller.targetScale;

  controller.admitWheelSample(
    { delta: 10, stepped: false, center: { x: 420, y: 320 } },
    host,
    start,
    commit,
  );
  input.stepFrame(1);
  assert.ok(
    controller.targetScale > afterFirst,
    "later samples compound from the transient target",
  );
  assert.equal(input.pendingTimers(), 1);
  input.fireTimers();
  assert.equal(commits, 1);
  assert.equal(input.pendingTimers(), 0, "commit consumes its own idle timer");
});

test("reset() cancels wheel frame and idle callbacks before they can commit a replacement", () => {
  const input = inputPlatform();
  const controller = new ZoomGestureController(input.platform);
  const { host } = fakeHost();
  let commits = 0;
  const start = (center: { x: number; y: number }) => {
    controller.start(center, host);
    return true;
  };
  controller.admitWheelSample(
    { delta: 100, stepped: false, center: { x: 400, y: 300 } },
    host,
    start,
    () => commits++,
  );
  controller.reset(host);
  input.stepFrame(0);
  input.fireTimers();
  assert.equal(commits, 0);
  assert.equal(controller.active, false);
});

test("computeCommit() cancels a pending wheel frame before canonical settlement", () => {
  const input = inputPlatform();
  const controller = new ZoomGestureController(input.platform);
  const { host } = fakeHost();
  const start = (center: { x: number; y: number }) => {
    controller.start(center, host);
    return true;
  };
  controller.admitWheelSample(
    { delta: 100, stepped: false, center: { x: 400, y: 300 } },
    host,
    start,
    () => assert.fail("cancelled wheel input must not request another commit"),
  );

  controller.computeCommit(host);
  assert.equal(input.pendingFrames(), 0);
  input.stepFrame(0);
  input.fireTimers();
  assert.equal(controller.targetScale, 1);
});

test("pointer pinch owns two-pointer lifecycle and requests exactly one commit", () => {
  const input = inputPlatform();
  const controller = new ZoomGestureController(input.platform);
  const { host } = fakeHost();
  let starts = 0;
  const start = (center: { x: number; y: number }) => {
    starts++;
    controller.start(center, host);
    return true;
  };
  assert.equal(controller.pointerDown({ id: 1, x: 100, y: 100 }, host, start), false);
  assert.equal(controller.pointerDown({ id: 2, x: 200, y: 100 }, host, start), true);
  assert.equal(starts, 1);
  assert.equal(controller.pinchInputActive, true);
  assert.equal(controller.pointerMove({ id: 2, x: 300, y: 100 }, host), true);
  input.stepFrame(0);
  assert.equal(controller.targetScale, 2);
  assert.equal(controller.pointerEnd(2), true);
  assert.equal(controller.pointerEnd(1), false, "a completed pointer session cannot commit twice");
  controller.reset(host);
  assert.equal(controller.pinchInputActive, false);
  assert.equal(controller.touchScrollLocked, false);
});

test("WebKit gestures are exclusive, retain a center fallback, and reset without commit", () => {
  const input = inputPlatform();
  const controller = new ZoomGestureController(input.platform);
  const { host } = fakeHost();
  let resets = 0;
  const start = (center: { x: number; y: number }) => {
    controller.start(center, host);
    return true;
  };
  controller.pointerDown({ id: 1, x: 100, y: 100 }, host, start);
  controller.pointerDown({ id: 2, x: 200, y: 100 }, host, start);
  assert.equal(
    controller.beginWebKitGesture(
      { clientX: 350, clientY: 250, fallbackCenter: { x: 400, y: 300 } },
      host,
      () => {
        resets++;
        controller.reset(host);
      },
      start,
    ),
    true,
  );
  assert.equal(resets, 1);
  assert.equal(controller.webKitGestureActive, true);
  assert.equal(controller.pointerDown({ id: 3, x: 0, y: 0 }, host, start), false);
  controller.admitWheelSample(
    { delta: 100, stepped: false, center: { x: 0, y: 0 } },
    host,
    start,
    () => assert.fail("WebKit ownership must exclude wheel commits"),
  );
  assert.equal(input.pendingFrames(), 0);
  controller.updateWebKitGesture({ scale: 1.5, fallbackCenter: { x: 0, y: 0 } }, host);
  input.stepFrame(0);
  assert.equal(controller.targetScale, 1.5);
  assert.equal(controller.endWebKitGesture(), true);
  controller.reset(host);
  input.stepFrame(1);
  assert.equal(controller.webKitGestureActive, false);
  assert.equal(controller.active, false);
});
