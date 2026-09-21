// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  ViewerFullscreen,
  type ViewerFullscreenFailureResult,
} from "../../src/viewer-fullscreen.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeDocument extends EventTarget {
  public fullscreenElement: Element | null = null;
  public fullscreenEnabled = true;
  public exitCalls = 0;
  public exitImpl: () => Promise<void> = async () => {
    this.fullscreenElement = null;
    this.dispatchEvent(new Event("fullscreenchange"));
  };

  public exitFullscreen(): Promise<void> {
    this.exitCalls++;
    return this.exitImpl();
  }
}

class FakeRoot {
  public requestCalls = 0;
  public requestImpl: () => Promise<void> = async () => {
    this.ownerDocument.fullscreenElement = this as unknown as Element;
    this.ownerDocument.dispatchEvent(new Event("fullscreenchange"));
  };

  public constructor(public readonly ownerDocument: FakeDocument) {}

  public requestFullscreen(): Promise<void> {
    this.requestCalls++;
    return this.requestImpl();
  }
}

function owner(
  options: {
    enabled?: boolean;
    document?: FakeDocument;
    stateChanged?: (active: boolean) => void;
    failed?: (result: ViewerFullscreenFailureResult) => void;
  } = {},
) {
  const document = options.document ?? new FakeDocument();
  const root = new FakeRoot(document);
  const fullscreen = new ViewerFullscreen({
    root: root as unknown as HTMLElement,
    enabled: options.enabled ?? true,
    callbacks: {
      stateChanged: options.stateChanged,
      failed: options.failed,
    },
  });
  return { document, root, fullscreen };
}

test("reports disabled and unavailable fullscreen without browser calls", async () => {
  const disabled = owner({ enabled: false });
  assert.deepEqual(await disabled.fullscreen.enter(), { status: "disabled", active: false });
  assert.equal(Object.isFrozen(await disabled.fullscreen.enter()), true);
  assert.equal(disabled.root.requestCalls, 0);

  const unavailable = owner();
  unavailable.document.fullscreenEnabled = false;
  assert.deepEqual(await unavailable.fullscreen.enter(), { status: "unavailable", active: false });
  assert.equal(unavailable.fullscreen.canEnter, false);
  assert.equal(unavailable.root.requestCalls, 0);
});

test("enters and exits only after exact-root browser state changes", async () => {
  const states: boolean[] = [];
  const { document, fullscreen, root } = owner({ stateChanged: active => states.push(active) });
  assert.equal(fullscreen.canEnter, true);
  assert.deepEqual(await fullscreen.enter(), { status: "active", active: true });
  assert.equal(document.fullscreenElement, root);
  assert.deepEqual(await fullscreen.exit(), { status: "inactive", active: false });
  assert.equal(document.fullscreenElement, null);
  assert.deepEqual(states, [true, false]);
});

test("does not claim fullscreen when another element owns it", async () => {
  const { document, fullscreen, root } = owner();
  const other = {} as Element;
  document.fullscreenElement = other;
  document.dispatchEvent(new Event("fullscreenchange"));
  assert.deepEqual(await fullscreen.enter(), { status: "occupied", active: false });
  assert.deepEqual(await fullscreen.exit(), { status: "inactive", active: false });
  assert.equal(document.exitCalls, 0);
  assert.equal(root.requestCalls, 0);
});

test("normalizes rejected and event-only browser failures", async () => {
  const failures: ViewerFullscreenFailureResult[] = [];
  const rejected = owner({ failed: failure => failures.push(failure) });
  const cause = new DOMException("Denied", "NotAllowedError");
  rejected.root.requestImpl = async () => Promise.reject(cause);
  assert.deepEqual(await rejected.fullscreen.enter(), { status: "denied", active: false, cause });
  assert.deepEqual(failures, [{ status: "denied", active: false, cause }]);
  assert.equal(Object.isFrozen(failures[0]), true);

  const eventOnly = owner({ failed: failure => failures.push(failure) });
  eventOnly.document.dispatchEvent(new Event("fullscreenerror"));
  assert.deepEqual(failures.at(-1), { status: "denied", active: false });
});

test("reports a missing authoritative transition once when the API settles", async () => {
  const failures: ViewerFullscreenFailureResult[] = [];
  const { document, fullscreen, root } = owner({ failed: failure => failures.push(failure) });
  const request = deferred<void>();
  root.requestImpl = () => request.promise;
  const pending = fullscreen.enter();
  document.dispatchEvent(new Event("fullscreenerror"));
  request.resolve();
  assert.deepEqual(await pending, { status: "denied", active: false });
  assert.deepEqual(failures, [{ status: "denied", active: false }]);
});

test("accepts authoritative fullscreenchange one task after the API promise", async () => {
  const states: boolean[] = [];
  const { document, fullscreen, root } = owner({ stateChanged: active => states.push(active) });
  root.requestImpl = async () => {
    setTimeout(() => {
      document.fullscreenElement = root as unknown as Element;
      document.dispatchEvent(new Event("fullscreenchange"));
    }, 0);
  };
  assert.deepEqual(await fullscreen.enter(), { status: "active", active: true });
  assert.deepEqual(states, [true]);
});

test("opposite enter and exit commands serialize toward the latest state", async () => {
  const { document, fullscreen, root } = owner();
  const request = deferred<void>();
  root.requestImpl = () => request.promise;
  const first = fullscreen.enter();
  assert.equal(fullscreen.enter(), first);
  const exit = fullscreen.exit();
  document.fullscreenElement = root as unknown as Element;
  document.dispatchEvent(new Event("fullscreenchange"));
  request.resolve();
  assert.deepEqual(await first, { status: "cancelled", active: false });
  assert.deepEqual(await exit, { status: "inactive", active: false });
  assert.equal(document.exitCalls, 1);
  assert.equal(document.fullscreenElement, null);
});

test("opposite exit and enter commands serialize toward the latest state", async () => {
  const { document, fullscreen, root } = owner();
  document.fullscreenElement = root as unknown as Element;
  document.dispatchEvent(new Event("fullscreenchange"));
  const exiting = deferred<void>();
  document.exitImpl = () => exiting.promise;
  const exit = fullscreen.exit();
  const enter = fullscreen.enter();
  document.fullscreenElement = null;
  document.dispatchEvent(new Event("fullscreenchange"));
  exiting.resolve();
  assert.deepEqual(await exit, { status: "cancelled", active: true });
  assert.deepEqual(await enter, { status: "active", active: true });
  assert.equal(document.exitCalls, 1);
  assert.equal(root.requestCalls, 1);
  assert.equal(document.fullscreenElement, root);
});

test("external fullscreen exits notify presentation coordinators through state changes", async () => {
  const states: boolean[] = [];
  const { document, fullscreen, root } = owner({ stateChanged: active => states.push(active) });
  document.fullscreenElement = root as unknown as Element;
  document.dispatchEvent(new Event("fullscreenchange"));
  document.fullscreenElement = null;
  document.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(fullscreen.active, false);
  assert.deepEqual(states, [true, false]);
});

test("destroy removes listeners and releases a late exact-root entry", async () => {
  const states: boolean[] = [];
  const { document, fullscreen, root } = owner({ stateChanged: active => states.push(active) });
  const request = deferred<void>();
  root.requestImpl = () => request.promise;
  const pending = fullscreen.enter();
  fullscreen.destroy();
  document.fullscreenElement = root as unknown as Element;
  document.dispatchEvent(new Event("fullscreenchange"));
  request.resolve();
  assert.deepEqual(await pending, { status: "cancelled", active: false });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.deepEqual(states, []);
  assert.equal(document.exitCalls, 1);
  assert.equal(document.fullscreenElement, null);
});

test("queued cleanup never exits another root", async () => {
  const { document, fullscreen, root } = owner();
  const request = deferred<void>();
  root.requestImpl = () => request.promise;
  const pending = fullscreen.enter();
  fullscreen.destroy();
  document.fullscreenElement = {} as Element;
  request.resolve();
  assert.deepEqual(await pending, { status: "cancelled", active: false });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(document.exitCalls, 0);
});
