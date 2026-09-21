// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundaryControlPress,
  type BoundaryControlPressTimerPlatform,
} from "../../src/boundary-control-press.js";

class FakeButton extends EventTarget {
  readonly captured = new Set<number>();

  public setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  public releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }
}

function timerPlatform(): {
  platform: BoundaryControlPressTimerPlatform;
  delays: number[];
  run(delay: number): void;
} {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const delays: number[] = [];
  return {
    platform: {
      setTimeout(callback, delay) {
        const id = nextId++;
        delays.push(delay);
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        if (id != null) timers.delete(id);
        return null;
      },
    },
    delays,
    run(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

function pointer(
  type: string,
  pointerId = 1,
  x = 0,
  y = 0,
  options: { primary?: boolean; button?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId,
    clientX: x,
    clientY: y,
    isPrimary: options.primary ?? true,
    button: options.button ?? 0,
  });
  return event;
}

function pressFixture(delay = 275) {
  const button = new FakeButton();
  const timer = timerPlatform();
  const actions: string[] = [];
  let enabled = true;
  const press = new BoundaryControlPress({
    button: button as unknown as HTMLButtonElement,
    longPressMs: delay,
    timers: timer.platform,
    canPress: () => enabled,
    onShortPress: () => actions.push("short"),
    onLongPress: () => actions.push("long"),
    listen: (target, type, listener, options) => target.addEventListener(type, listener, options),
  });
  return { actions, button, enabled: (value: boolean) => (enabled = value), press, timer };
}

test("boundary control recognizes a short click", () => {
  const { actions, button } = pressFixture();
  button.dispatchEvent(pointer("pointerdown"));
  button.dispatchEvent(pointer("pointerup"));
  button.dispatchEvent(new Event("click", { cancelable: true }));
  assert.deepEqual(actions, ["short"]);
});

test("boundary control fires long press once and suppresses its synthetic click", () => {
  const { actions, button, timer } = pressFixture();
  button.dispatchEvent(pointer("pointerdown"));
  timer.run(275);
  timer.run(275);
  button.dispatchEvent(pointer("pointerup"));
  const click = new Event("click", { cancelable: true });
  assert.equal(button.dispatchEvent(click), false);
  assert.deepEqual(actions, ["long"]);
});

test("boundary control cancels when movement exceeds twelve pixels", () => {
  const { actions, button, timer } = pressFixture();
  button.dispatchEvent(pointer("pointerdown", 4, 10, 10));
  button.dispatchEvent(pointer("pointermove", 4, 23, 10));
  timer.run(275);
  button.dispatchEvent(new Event("click"));
  assert.deepEqual(actions, ["short"]);
  assert.equal(button.captured.size, 0);
});

test("boundary control ignores mismatched, non-primary, and non-left pointers", () => {
  const { actions, button, timer } = pressFixture();
  button.dispatchEvent(pointer("pointerdown", 3));
  button.dispatchEvent(pointer("pointerup", 4));
  timer.run(275);
  assert.deepEqual(actions, ["long"]);

  button.dispatchEvent(pointer("pointerdown", 5, 0, 0, { primary: false }));
  button.dispatchEvent(pointer("pointerdown", 6, 0, 0, { button: 2 }));
  timer.run(275);
  assert.deepEqual(actions, ["long"]);
});

test("boundary control resets pending and suppressed presses on cancel, leave, blur, and reset", () => {
  const { actions, button, press, timer } = pressFixture();
  for (const type of ["pointercancel", "pointerleave", "blur"] as const) {
    button.dispatchEvent(pointer("pointerdown"));
    button.dispatchEvent(type === "blur" ? new Event(type) : pointer(type));
    timer.run(275);
  }
  button.dispatchEvent(pointer("pointerdown"));
  press.reset();
  timer.run(275);
  button.dispatchEvent(new Event("click"));
  assert.deepEqual(actions, ["short"]);

  button.dispatchEvent(pointer("pointerdown"));
  timer.run(275);
  button.dispatchEvent(pointer("pointercancel"));
  button.dispatchEvent(new Event("click"));
  assert.deepEqual(actions, ["short", "long", "short"]);
});

test("boundary control uses the configured long-press delay and checks availability at fire time", () => {
  const { actions, button, enabled, timer } = pressFixture(43);
  button.dispatchEvent(pointer("pointerdown"));
  assert.deepEqual(timer.delays, [43]);
  enabled(false);
  timer.run(43);
  assert.deepEqual(actions, []);
});
