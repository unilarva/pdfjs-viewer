// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { LifecycleScope } from "../../src/lifecycle-scope.js";

test("cancel synchronously owns rafs, timers, listeners, abort, and cleanup hooks", () => {
  const rafs = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  let next = 1;
  const scope = new LifecycleScope({
    requestAnimationFrame: callback => {
      const id = next++;
      rafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame: id => {
      rafs.delete(id);
    },
    setTimeout: callback => {
      const id = next++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: id => {
      timers.delete(id);
    },
  });
  const target = new EventTarget();
  let calls = 0;
  let reset = 0;
  scope.requestAnimationFrame(() => calls++);
  scope.setTimeout(() => calls++, 60_000);
  scope.listen(target, "probe", () => calls++);
  scope.onCancel(() => reset++);
  scope.cancel();
  scope.cancel();
  target.dispatchEvent(new Event("probe"));
  assert.equal(scope.signal.aborted, true);
  assert.equal(scope.active, false);
  assert.equal(rafs.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(calls, 0);
  assert.equal(reset, 1);
  assert.equal(
    scope.requestAnimationFrame(() => calls++),
    null,
  );
});

test("listener disposer removes early and is exactly-once across later cancel", () => {
  class CountingTarget extends EventTarget {
    removals = 0;
    override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
      this.removals++;
      super.removeEventListener(...args);
    }
  }
  const scope = new LifecycleScope();
  const target = new CountingTarget();
  let calls = 0;
  const dispose = scope.listen(target, "probe", () => calls++);
  target.dispatchEvent(new Event("probe"));
  dispose();
  dispose();
  target.dispatchEvent(new Event("probe"));
  scope.cancel();
  assert.equal(calls, 1);
  assert.equal(target.removals, 1);
});

test("clearTimeout releases tracking, prevents firing, and is not cleared again", () => {
  const timers = new Map<number, () => void>();
  const clearCounts = new Map<number, number>();
  const scope = new LifecycleScope({
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: callback => {
      timers.set(7, callback);
      return 7;
    },
    clearTimeout: id => {
      clearCounts.set(id, (clearCounts.get(id) ?? 0) + 1);
      timers.delete(id);
    },
  });
  let calls = 0;
  const id = scope.setTimeout(() => calls++, 100);
  assert.equal(id, 7);
  assert.equal(scope.clearTimeout(id), null);
  assert.equal(timers.has(7), false);
  scope.cancel();
  assert.equal(calls, 0);
  assert.equal(clearCounts.get(7), 1);
});

test("cancel is reentrancy-safe and invokes each registered cleanup once", () => {
  const scope = new LifecycleScope();
  const calls: string[] = [];
  scope.onCancel(() => {
    calls.push("first");
    scope.cancel();
  });
  scope.onCancel(() => calls.push("second"));
  scope.cancel();
  scope.cancel();
  assert.deepEqual(calls, ["first", "second"]);
});
