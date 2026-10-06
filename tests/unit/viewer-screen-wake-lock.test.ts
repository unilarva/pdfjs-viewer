// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { ViewerScreenWakeLock } from "../../src/viewer-screen-wake-lock.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, resolve, reject };
}

class FakeSentinel extends EventTarget {
  public released = false;
  public releaseCalls = 0;
  public listeners = new Set<EventListenerOrEventListenerObject>();
  public releaseImpl: () => Promise<void> = async () => this.browserRelease();

  public override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "release") this.listeners.add(listener);
    super.addEventListener(type, listener);
  }

  public override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "release") this.listeners.delete(listener);
    super.removeEventListener(type, listener);
  }

  public release(): Promise<void> {
    this.releaseCalls++;
    assert.equal(this.listeners.size, 0, "detach observation before deliberate release");
    return this.releaseImpl();
  }

  public browserRelease(): void {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }

  public asSentinel(): WakeLockSentinel {
    return this as unknown as WakeLockSentinel;
  }
}

function fixture() {
  const requests: ReturnType<typeof deferred<WakeLockSentinel>>[] = [];
  const diagnostics: { level: string; event: string; message: string; cause?: unknown }[] = [];
  const api = {
    request(type: string) {
      assert.equal(type, "screen");
      assert.equal(this, api, "preserve the browser API receiver");
      const request = deferred<WakeLockSentinel>();
      requests.push(request);
      return request.promise;
    },
  };
  const navigator = { wakeLock: api } as unknown as Navigator;
  const owner = new ViewerScreenWakeLock(navigator, (level, event, message, cause) => {
    diagnostics.push({ level, event, message, cause });
  });
  return { owner, navigator, api, requests, diagnostics };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

test("reconciles policy-independent eligibility and owns only one sentinel", async () => {
  const { owner, requests } = fixture();
  owner.reconcile(false);
  assert.equal(requests.length, 0);
  owner.reconcile(true);
  owner.reconcile(true);
  assert.equal(requests.length, 1);
  const sentinel = new FakeSentinel();
  requests[0]!.resolve(sentinel.asSentinel());
  await flush();
  assert.equal(sentinel.listeners.size, 1);
  owner.reconcile(true);
  assert.equal(requests.length, 1);
  owner.reconcile(false);
  owner.reconcile(false);
  assert.equal(sentinel.releaseCalls, 1);
  assert.equal(sentinel.listeners.size, 0);
  owner.reconcile(true);
  assert.equal(requests.length, 2);
  owner.destroy();
});

test("releases an acquisition resolved after eligibility becomes false", async () => {
  const { owner, requests } = fixture();
  owner.reconcile(true);
  owner.reconcile(false);
  const sentinel = new FakeSentinel();
  requests[0]!.resolve(sentinel.asSentinel());
  await flush();
  assert.equal(sentinel.releaseCalls, 1);
  assert.equal(sentinel.listeners.size, 0);
  assert.equal(requests.length, 1);
  owner.destroy();
});

for (const completion of ["success", "failure"] as const) {
  test(`serializes false/true races and retries stale ${completion} once`, async () => {
    const { owner, requests } = fixture();
    owner.reconcile(true);
    owner.reconcile(false);
    owner.reconcile(true);
    owner.reconcile(false);
    owner.reconcile(true);
    owner.reconcile(true);
    assert.equal(requests.length, 1);
    const stale = new FakeSentinel();
    if (completion === "success") requests[0]!.resolve(stale.asSentinel());
    else requests[0]!.reject(new Error("stale denial"));
    await flush();
    assert.equal(stale.releaseCalls, completion === "success" ? 1 : 0);
    assert.equal(requests.length, 2);
    requests[1]!.reject(new Error("latest denial"));
    await flush();
    assert.equal(requests.length, 2, "current rejection must not loop");
    owner.reconcile(true);
    assert.equal(requests.length, 3, "a later eligible event may retry");
    owner.destroy();
    requests[2]!.reject(new Error("destroyed denial"));
    await flush();
    assert.equal(requests.length, 3);
  });
}

test("destroy is terminal and idempotent for owned and late sentinels", async () => {
  for (const late of [false, true]) {
    const { owner, requests } = fixture();
    owner.reconcile(true);
    const sentinel = new FakeSentinel();
    if (!late) {
      requests[0]!.resolve(sentinel.asSentinel());
      await flush();
    }
    owner.destroy();
    owner.destroy();
    owner.reconcile(true);
    if (late) requests[0]!.resolve(sentinel.asSentinel());
    await flush();
    assert.equal(sentinel.releaseCalls, 1);
    assert.equal(sentinel.listeners.size, 0);
    sentinel.browserRelease();
    assert.equal(requests.length, 1);
  }
});

test("browser release reacquires while desired and ignores stale release callbacks", async () => {
  const { owner, requests, diagnostics } = fixture();
  owner.reconcile(true);
  const first = new FakeSentinel();
  requests[0]!.resolve(first.asSentinel());
  await flush();
  const staleListener = [...first.listeners][0] as EventListener;
  first.browserRelease();
  assert.equal(requests.length, 2);
  assert.equal(first.releaseCalls, 0);
  assert.equal(first.listeners.size, 0);
  assert.equal(diagnostics[0]?.level, "debug");
  const second = new FakeSentinel();
  requests[1]!.resolve(second.asSentinel());
  await flush();
  staleListener(new Event("release"));
  assert.equal(requests.length, 2);
  assert.equal(second.listeners.size, 1);
  owner.reconcile(false);
  staleListener(new Event("release"));
  assert.equal(second.releaseCalls, 1);
  assert.equal(requests.length, 2);
  owner.destroy();
});

test("already released request results do not create tight reacquisition loops", async () => {
  const { owner, requests, diagnostics } = fixture();
  owner.reconcile(true);
  const sentinel = new FakeSentinel();
  sentinel.browserRelease();
  requests[0]!.resolve(sentinel.asSentinel());
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(sentinel.listeners.size, 0);
  assert.equal(sentinel.releaseCalls, 0);
  assert.equal(diagnostics[0]?.level, "debug");
  owner.reconcile(true);
  assert.equal(requests.length, 2);
  owner.destroy();
});

test("unavailable APIs report debug once using only the supplied navigator", () => {
  for (const navigator of [{}, { wakeLock: {} }]) {
    const diagnostics: string[] = [];
    const owner = new ViewerScreenWakeLock(navigator as Navigator, (level, event) => {
      diagnostics.push(`${level}:${event}`);
    });
    owner.reconcile(true);
    owner.reconcile(true);
    owner.reconcile(false);
    owner.reconcile(true);
    assert.deepEqual(diagnostics, ["debug:screen-wake-lock-unavailable"]);
    owner.destroy();
  }
});

for (const synchronous of [false, true]) {
  test(`contains ${synchronous ? "synchronous" : "asynchronous"} request denial and logger failure`, async () => {
    const cause = new Error("denied");
    let calls = 0;
    const diagnostics: unknown[][] = [];
    const navigator = {
      wakeLock: {
        request() {
          calls++;
          if (synchronous) throw cause;
          return Promise.reject(cause);
        },
      },
    } as unknown as Navigator;
    const owner = new ViewerScreenWakeLock(navigator, (...args) => {
      diagnostics.push(args);
      throw new Error("broken logger");
    });
    assert.doesNotThrow(() => owner.reconcile(true));
    await flush();
    assert.equal(calls, 1);
    assert.equal(diagnostics[0]?.[0], "debug");
    assert.equal(diagnostics[0]?.[3], cause);
    owner.reconcile(true);
    await flush();
    assert.equal(calls, 2);
    owner.destroy();
  });

  test(`contains ${synchronous ? "synchronous" : "asynchronous"} release failure, including after destruction`, async () => {
    const { owner, requests, diagnostics } = fixture();
    const cause = new Error("release failed");
    const sentinel = new FakeSentinel();
    sentinel.releaseImpl = () => {
      if (synchronous) throw cause;
      return Promise.reject(cause);
    };
    owner.reconcile(true);
    owner.destroy();
    requests[0]!.resolve(sentinel.asSentinel());
    await flush();
    assert.equal(sentinel.releaseCalls, 1);
    assert.equal(sentinel.listeners.size, 0);
    assert.equal(diagnostics[0]?.event, "screen-wake-lock-release-failed");
    assert.equal(diagnostics[0]?.cause, cause);
    assert.equal(requests.length, 1);
  });
}

test("independent owners sharing a navigator never release another owner's or an external sentinel", async () => {
  const { owner, navigator, api, requests } = fixture();
  const other = new ViewerScreenWakeLock(navigator, () => {});
  const externalRequest = api.request("screen");
  const external = new FakeSentinel();
  requests[0]!.resolve(external.asSentinel());
  await externalRequest;
  owner.reconcile(true);
  other.reconcile(true);
  const first = new FakeSentinel();
  const second = new FakeSentinel();
  requests[1]!.resolve(first.asSentinel());
  requests[2]!.resolve(second.asSentinel());
  await flush();
  owner.destroy();
  assert.equal(first.releaseCalls, 1);
  assert.equal(second.releaseCalls, 0);
  assert.equal(external.releaseCalls, 0);
  other.destroy();
  assert.equal(second.releaseCalls, 1);
  assert.equal(external.releaseCalls, 0);
});
