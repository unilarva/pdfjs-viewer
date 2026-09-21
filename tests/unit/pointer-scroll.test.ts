// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { PointerScrollController, type PointerScrollHost } from "../../src/pointer-scroll.js";

const pointerPlatform = {
  now: () => performance.now(),
  requestAnimationFrame: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancelAnimationFrame: (id: number) => cancelAnimationFrame(id),
};

// Node has no rAF; stub a controllable queue so fling/auto-scroll steps can
// be driven deterministically in tests.
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
    /** Runs all currently pending frame callbacks once, at the given time. */
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

function fakeHost(): {
  host: PointerScrollHost;
  state: { left: number; top: number; cursor: string; rowFits: boolean };
} {
  const state = { left: 0, top: 0, cursor: "", rowFits: false };
  const host: PointerScrollHost = {
    rowFitsHorizontally: () => state.rowFits,
    normalizeHorizontalScroll: () => {},
    getScrollPosition: () => ({ left: state.left, top: state.top }),
    setScrollPosition: pos => {
      if (pos.left !== undefined) state.left = pos.left;
      if (pos.top !== undefined) state.top = pos.top;
    },
    setCursor: cursor => {
      state.cursor = cursor;
    },
  };
  return { host, state };
}

test("drag updates scroll position and sets grabbing cursor", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host, state } = fakeHost();

  controller.onDragStart(100, 100, host);
  assert.equal(state.cursor, "grabbing");
  assert.equal(controller.isDragging, true);

  controller.onDragMove(90, 80, host);
  assert.equal(state.left, 10); // moved left by 10 -> scrollLeft -= dx(-10)
  assert.equal(state.top, 20);

  controller.onDragEnd(host);
  assert.equal(state.cursor, "");
  assert.equal(controller.isDragging, false);
  raf.step(0);
});

test("horizontal lock suppresses horizontal movement and velocity", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host, state } = fakeHost();
  state.rowFits = true;

  controller.onDragStart(100, 100, host);
  controller.onDragMove(50, 50, host);
  assert.equal(state.left, 0); // horizontal locked, no change
  assert.equal(state.top, 50);
  controller.onDragEnd(host);
  raf.step(0);
});

test("fling decays velocity over time and eventually stops", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host, state } = fakeHost();

  // Simulate a fast drag so release velocity exceeds the fling threshold.
  let now = 1000;
  const originalNow = performance.now;
  (performance as unknown as { now: () => number }).now = () => now;
  try {
    controller.onDragStart(0, 0, host);
    now += 16;
    controller.onDragMove(200, 0, host); // large dx -> high velX
    controller.onDragEnd(host);
    assert.equal(raf.pendingCount(), 1, "fling should schedule a raf step");

    // The first fling frame only establishes the previous timestamp (dt=0),
    // matching the original closure's behavior; the second frame moves it.
    raf.step(now + 16);
    const leftBefore = state.left;
    now += 16;
    raf.step(now + 16);
    assert.notEqual(state.left, leftBefore, "fling step should move scroll position");

    // Keep stepping until velocity decays below threshold and raf stops rescheduling.
    let iterations = 0;
    while (raf.pendingCount() > 0 && iterations < 10_000) {
      now += 16;
      raf.step(now);
      iterations++;
    }
    assert.equal(raf.pendingCount(), 0, "fling should stop once velocity decays");
  } finally {
    (performance as unknown as { now: () => number }).now = originalNow;
  }
});

test("fling retains subpixel distance across quantized scroll writes", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host, state } = fakeHost();
  const setScrollPosition = host.setScrollPosition;
  host.setScrollPosition = position => {
    setScrollPosition({
      ...(position.left === undefined ? {} : { left: Math.round(position.left) }),
      ...(position.top === undefined ? {} : { top: Math.round(position.top) }),
    });
  };

  let now = 1000;
  const originalNow = performance.now;
  (performance as unknown as { now: () => number }).now = () => now;
  try {
    controller.onDragStart(0, 0, host);
    now += 16;
    controller.onDragMove(0, -0.51, host);
    controller.onDragEnd(host);

    raf.step(now + 16); // Establish the first RAF timestamp.
    for (let frame = 0; frame < 4; frame++) {
      now += 16;
      raf.step(now + 16);
    }

    assert.ok(state.top > 1, "retained fractions should produce continued tail movement");
  } finally {
    (performance as unknown as { now: () => number }).now = originalNow;
  }
});

test("middle-mouse auto-scroll starts and stops on mousedown/mouseup", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host, state } = fakeHost();

  controller.onAutoScrollStart(100, 100, host);
  assert.equal(state.cursor, "all-scroll");
  assert.equal(controller.isAutoScrolling, true);
  assert.equal(raf.pendingCount(), 1);

  controller.onAutoScrollMove(110, 130);
  raf.step(0);
  assert.ok(
    state.top > 0,
    "auto-scroll step should move scroll position toward the drag direction",
  );

  controller.onAutoScrollEnd(host);
  assert.equal(state.cursor, "");
  assert.equal(controller.isAutoScrolling, false);
  assert.equal(raf.pendingCount(), 0);
});

test("auto-scroll also stops on mouseleave equivalent (onAutoScrollEnd) without a prior move", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host } = fakeHost();

  controller.onAutoScrollStart(0, 0, host);
  controller.onAutoScrollEnd(host);
  assert.equal(controller.isAutoScrolling, false);
  assert.equal(raf.pendingCount(), 0);
});

test("reset() cancels motion and restores the cursor", () => {
  const raf = installRafStub();
  const controller = new PointerScrollController(pointerPlatform);
  const { host, state } = fakeHost();

  let now = 0;
  const originalNow = performance.now;
  (performance as unknown as { now: () => number }).now = () => now;
  try {
    controller.onDragStart(0, 0, host);
    now += 16;
    controller.onDragMove(500, 0, host);
    controller.onDragEnd(host);
    assert.equal(raf.pendingCount(), 1);

    state.cursor = "grabbing";
    controller.reset(host);
    assert.equal(raf.pendingCount(), 0);
    assert.equal(controller.isDragging, false);
    assert.equal(controller.isAutoScrolling, false);
    assert.equal(state.cursor, "");
  } finally {
    (performance as unknown as { now: () => number }).now = originalNow;
  }
});
