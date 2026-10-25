// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type * as PDFJS from "pdfjs-dist";
import { DocumentFonts } from "../../src/document-fonts.js";
import {
  DocumentPageSources,
  type DocumentPageSourcesOptions,
} from "../../src/document-page-sources.js";
import { DocumentPageUsage } from "../../src/document-page-usage.js";
import type { PdfjsViewerPageSource } from "../../src/viewer-contracts.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePage(options: Record<string, unknown> = {}): PDFJS.PDFPageProxy {
  return {
    view: [0, 0, 600, 800],
    rotate: 0,
    userUnit: 1,
    cleanup() {},
    getAnnotations: async () => [],
    ...options,
  } as unknown as PDFJS.PDFPageProxy;
}

function fakePdf(
  pages = [fakePage(), fakePage(), fakePage()],
  options: Record<string, unknown> = {},
): PDFJS.PDFDocumentProxy {
  return {
    numPages: pages.length,
    isPureXfa: false,
    getPage: async (page: number) => pages[page - 1],
    getPermissions: async () => null,
    getMetadata: async () => ({
      info: { IsAcroFormPresent: false, IsXFAPresent: false, IsSignaturesPresent: false },
      metadata: null,
    }),
    getFieldObjects: async () => null,
    getOptionalContentConfig: async () => ({}),
    getDestination: async () => [0, { name: "Fit" }],
    getPageIndex: async () => 0,
    ...options,
  } as unknown as PDFJS.PDFDocumentProxy;
}

function harness(options: Partial<DocumentPageSourcesOptions> = {}, base = fakePdf()) {
  const loads: Uint8Array[] = [];
  let disposed = 0;
  const owner = new DocumentPageSources(base, new DocumentPageUsage(base), {
    load: async data => {
      loads.push(data);
      return {
        pdf: fakePdf(),
        dispose: async () => {
          disposed++;
        },
      };
    },
    ...options,
  });
  return { owner, loads, disposed: () => disposed };
}

async function prepared(owner: DocumentPageSources, byte = 1): Promise<PdfjsViewerPageSource> {
  const result = await owner.prepare(new Uint8Array([byte]));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.source;
}

async function turn(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

test("Blob backing bypasses mutable/subclass methods and reopens into independently transferable bytes", async () => {
  const inputs: number[][] = [];
  const { owner } = harness({
    limits: { maxLiveDocuments: 1 },
    load: async data => {
      inputs.push([...data]);
      data.fill(9);
      structuredClone(data, { transfer: [data.buffer] });
      return { pdf: fakePdf(), dispose: async () => {} };
    },
  });
  class CustomBlob extends Blob {
    override slice(): Blob {
      throw new Error("Consumer slice must not run");
    }
    override arrayBuffer(): Promise<ArrayBuffer> {
      throw new Error("Consumer read must not run");
    }
  }
  const mutable = new Uint8Array([1, 2, 3]);
  const blob = new CustomBlob([mutable]);
  mutable.fill(7);
  const result = await owner.prepare(blob);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source.byteLength, 3);
  await owner.setOverrides([{ page: 1, source: result.source, sourcePage: 1 }]);
  result.source.release();
  await prepared(owner, 4);
  const use = await owner.acquire(1);
  assert.deepEqual(inputs, [[1, 2, 3], [4], [1, 2, 3]]);
  await owner.setOverrides([{ page: 1, source: null }]);
  assert.equal(use.source?.isCurrent(), false);
  use.release();
  await owner.close();
  assert.deepEqual([...new Uint8Array(await Blob.prototype.arrayBuffer.call(blob))], [1, 2, 3]);
});

test("Blob backing and snapshots have separate budgets; live byte admission waits for readers and disposal", async () => {
  const disposal = deferred<void>();
  const { owner, loads } = harness({
    limits: { maxBytes: 2, maxBlobBytes: 6, maxLiveBytes: 3, maxLiveDocuments: 4 },
    load: async data => {
      loads.push(data);
      return {
        pdf: fakePdf(),
        dispose: async () => {
          if (data[0] === 1) await disposal.promise;
        },
      };
    },
  });
  const first = await owner.prepare(new Blob([new Uint8Array([1, 1, 1])]));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await owner.setOverrides([{ page: 1, source: first.source, sourcePage: 1 }]);
  const use = await owner.acquire(1);
  const second = owner.prepare(new Blob([new Uint8Array([2, 2, 2])]));
  await turn();
  assert.equal(loads.length, 1, "byte budget, not the four-document cap, blocks opening");
  assert.deepEqual(await owner.prepare(new Blob([new Uint8Array([3])])), {
    ok: false,
    reason: "resource-limit",
  });
  use.release();
  await turn();
  assert.equal(loads.length, 1, "retiring bytes remain reserved until disposal settles");
  disposal.resolve();
  assert.equal((await second).ok, true);
  assert.equal(
    (await owner.prepare(new Uint8Array([4, 4]))).ok,
    true,
    "Blob bytes do not consume snapshot budget",
  );
  assert.deepEqual(await owner.prepare(new Uint8Array([5])), {
    ok: false,
    reason: "resource-limit",
  });
  first.source.release();
  await owner.setOverrides([{ page: 1, source: null }]);
  assert.equal(
    (await owner.prepare(new Blob([new Uint8Array([6, 6, 6])]))).ok,
    true,
    "retired Blob reservation is returned",
  );
  assert.deepEqual(await owner.prepare(new Blob([new Uint8Array(4)])), {
    ok: false,
    reason: "resource-limit",
  });
  assert.deepEqual(await owner.prepare(new Blob()), { ok: false, reason: "invalid-source" });
  assert.deepEqual(
    await owner.prepare({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) } as Blob),
    { ok: false, reason: "invalid-source" },
  );
  await owner.close();
});

test("closing during Blob materialization waits for the read and never starts a stale loader", async () => {
  const read = deferred<ArrayBuffer>();
  const original = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = () => read.promise;
  const { owner, loads } = harness({ limits: { maxLiveDocuments: 1 } });
  try {
    const pending = owner.prepare(new Blob([new Uint8Array([1])]));
    await turn();
    let settled = false;
    const close = owner.close().then(() => {
      settled = true;
    });
    await turn();
    assert.equal(settled, false);
    read.resolve(new ArrayBuffer(1));
    assert.deepEqual(await pending, { ok: false, reason: "destroyed" });
    await close;
    assert.equal(loads.length, 0);
  } finally {
    Blob.prototype.arrayBuffer = original;
    read.resolve(new ArrayBuffer(1));
    await owner.close();
  }
});

test("failed and cancelled Blob reads return backing, byte and document reservations", async () => {
  const read = deferred<ArrayBuffer>();
  const original = Blob.prototype.arrayBuffer;
  let reads = 0;
  Blob.prototype.arrayBuffer = function () {
    reads++;
    if (reads === 1) return Promise.reject(new Error("Unreadable Blob"));
    if (reads === 2) return read.promise;
    return original.call(this);
  };
  const { owner, loads } = harness({
    limits: { maxSources: 1, maxBlobBytes: 1, maxLiveBytes: 1, maxLiveDocuments: 1 },
  });
  try {
    const blob = new Blob([new Uint8Array([1])]);
    const failed = await owner.prepare(blob);
    assert.equal(!failed.ok && failed.reason, "error");
    const abort = new AbortController();
    const pending = owner.prepare(blob, { signal: abort.signal });
    await turn();
    abort.abort();
    assert.deepEqual(await owner.prepare(blob), { ok: false, reason: "resource-limit" });
    assert.equal(reads, 2, "unsettled read retains admission and cannot start another read");
    read.resolve(new ArrayBuffer(1));
    assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
    assert.equal(loads.length, 0);
    assert.equal((await owner.prepare(blob)).ok, true);
    assert.equal(loads.length, 1);
  } finally {
    Blob.prototype.arrayBuffer = original;
    read.resolve(new ArrayBuffer(1));
    await owner.close();
  }
});

test("hundreds of cold Blob sources publish and reset atomically without increasing the live PDF cap", async () => {
  const count = 320;
  let live = 0;
  let peak = 0;
  const notifications: number[][] = [];
  const { owner } = harness(
    {
      load: async () => {
        peak = Math.max(peak, ++live);
        return {
          pdf: fakePdf([fakePage()]),
          dispose: async () => {
            live--;
          },
        };
      },
      changed: pages => notifications.push([...pages]),
    },
    fakePdf(Array.from({ length: count }, () => fakePage())),
  );
  const sources: PdfjsViewerPageSource[] = [];
  for (let index = 0; index < count; index++) {
    const result = await owner.prepare(new Blob([new Uint8Array([index % 256])]));
    assert.equal(result.ok, true);
    if (result.ok) sources.push(result.source);
  }
  const changes = sources.map((source, index) => ({ page: index + 1, source, sourcePage: 1 }));
  assert.equal((await owner.setOverrides(changes)).ok, true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].length, count);
  const reader = await owner.acquire(1);
  for (const source of sources) source.release();
  const replacements: PdfjsViewerPageSource[] = [];
  for (let index = 0; index < count; index++) {
    const result = await owner.prepare(new Blob([new Uint8Array([1])]));
    assert.equal(result.ok, true, "a complete candidate set fits beside installed sources");
    if (result.ok) replacements.push(result.source);
  }
  assert.deepEqual(await owner.prepare(new Blob([new Uint8Array([1])])), {
    ok: false,
    reason: "resource-limit",
  });
  assert.equal(
    (await owner.setOverrides(changes.map(({ page }) => ({ page, source: null })))).ok,
    true,
  );
  assert.equal(notifications.length, 2);
  for (let page = 1; page <= count; page++) {
    assert.equal(owner.currentSource(page), undefined);
    assert.equal(owner.revision(page), 2);
  }
  assert.equal(reader.source?.isCurrent(), false);
  assert.ok(live >= 1, "old physical reader survives the whole-book reset");
  for (const source of replacements) source.release();
  reader.release();
  await owner.close();
  assert.equal(peak, 4);
  assert.equal(live, 0);
});

for (const kind of ["Uint8Array", "foreign Uint8Array", "Buffer", "Buffer subarray"] as const) {
  test(`${kind} preparation snapshots bytes and reopening cannot detach or mutate the retained snapshot`, async () => {
    const gate = deferred<void>();
    const inputs: number[][] = [];
    const { owner } = harness({
      limits: { maxLiveDocuments: 1 },
      load: async data => {
        await gate.promise;
        assert.equal(data.constructor, Uint8Array);
        assert.equal(Buffer.isBuffer(data), false);
        inputs.push([...data]);
        data.fill(9);
        const transferred = structuredClone(data, { transfer: [data.buffer] });
        assert.deepEqual(
          [...transferred],
          inputs.at(-1)!.map(() => 9),
        );
        assert.equal(data.byteLength, 0);
        return { pdf: fakePdf(), dispose: async () => {} };
      },
    });
    const backing = Buffer.from([99, 1, 2, 3, 88]);
    const bytes =
      kind === "Uint8Array"
        ? new Uint8Array([1, 2, 3])
        : kind === "foreign Uint8Array"
          ? (runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array)
          : kind === "Buffer"
            ? Buffer.from([1, 2, 3])
            : backing.subarray(1, 4);
    const pending = owner.prepare(bytes);
    bytes.fill(7);
    gate.resolve();
    const result = await pending;
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source.byteLength, 3);
    assert.equal(result.source.pageCount, 3);
    assert.equal(Object.isFrozen(result.source), true);
    await owner.setOverrides([{ page: 1, source: result.source, sourcePage: 2 }]);
    await prepared(owner, 4);
    const use = await owner.acquire(1);
    use.release();
    assert.deepEqual(inputs, [[1, 2, 3], [4], [1, 2, 3]]);
    assert.deepEqual([...bytes], [7, 7, 7]);
    if (kind === "Buffer subarray") assert.deepEqual([...backing], [99, 7, 7, 7, 88]);
    await owner.close();
  });
}

test("Buffer views charge only their bytes and cancelled slot waiters return their reservation", async () => {
  const { owner, loads } = harness({ limits: { maxBytes: 4, maxLiveDocuments: 1 } });
  const backing = Buffer.alloc(1024, 1);
  const result = await owner.prepare(backing.subarray(100, 103));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source.byteLength, 3);
  await owner.setOverrides([{ page: 1, source: result.source, sourcePage: 1 }]);
  const use = await owner.acquire(1);
  try {
    assert.deepEqual(await owner.prepare(backing.subarray(0, 2)), {
      ok: false,
      reason: "resource-limit",
    });
    const abort = new AbortController();
    const pending = owner.prepare(backing.subarray(10, 11), { signal: abort.signal });
    await turn();
    assert.deepEqual(await owner.prepare(Buffer.from([2])), {
      ok: false,
      reason: "resource-limit",
    });
    abort.abort();
    assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
    assert.equal(loads.length, 1, "The cancelled Buffer never opened a document");
  } finally {
    use.release();
  }
  const admitted = await owner.prepare(backing.subarray(20, 21));
  assert.equal(admitted.ok, true, "Cancellation returned the one-byte reservation");
  assert.deepEqual(
    loads.map(data => [...data]),
    [[1, 1, 1], [1]],
  );
  await owner.close();
});

test("atomic remapping, no-op, restore, revisions, and immutable physical source selection", async () => {
  const notifications: number[][] = [];
  const { owner, disposed } = harness({ changed: pages => notifications.push([...pages]) });
  const baseUse = await owner.acquire(1);
  assert.equal(baseUse.source?.id, null);
  assert.equal(baseUse.source?.fonts, undefined);
  const source = await prepared(owner);
  assert.deepEqual(
    await owner.setOverrides([
      { page: 1, source, sourcePage: 2 },
      { page: 3, source, sourcePage: 1 },
    ]),
    { ok: true, revision: 1, pages: [1, 3] },
  );
  assert.equal(baseUse.source?.isCurrent(), false);
  baseUse.release();
  const use = await owner.acquire(1);
  assert.equal(use.source?.sourcePage, 2);
  assert.equal(use.source?.logicalPage, 1);
  assert.equal(use.source?.isCurrent(), true);
  assert.deepEqual(await owner.setOverrides([{ page: 1, source, sourcePage: 2 }]), {
    ok: true,
    revision: 1,
    pages: [],
  });
  assert.equal(use.source?.isCurrent(), true);
  source.release();
  source.release();
  assert.equal(disposed(), 0);
  assert.deepEqual(
    await owner.setOverrides([
      { page: 1, source: null },
      { page: 3, source: null },
    ]),
    { ok: true, revision: 2, pages: [1, 3] },
  );
  assert.equal(use.source?.isCurrent(), false);
  assert.equal(disposed(), 0, "old physical lease survives restoration");
  const restored = await owner.acquire(1);
  assert.equal(restored.source?.id, null);
  assert.equal(restored.source?.revision, 2);
  restored.release();
  use.release();
  use.release();
  await owner.close();
  assert.equal(disposed(), 1);
  assert.deepEqual(notifications, [
    [1, 3],
    [1, 3],
  ]);
});

test("rejects duplicate/bounded pages, foreign/released handles, and preserves all prior mappings", async () => {
  const { owner } = harness();
  const { owner: other } = harness();
  const source = await prepared(owner);
  const foreign = await prepared(other);
  await owner.setOverrides([{ page: 1, source, sourcePage: 1 }]);
  for (const page of [0, -1, 4, 1.5, NaN, Infinity]) {
    assert.deepEqual(await owner.setOverrides([{ page, source, sourcePage: 1 }]), {
      ok: false,
      reason: "invalid-page",
    });
  }
  for (const sourcePage of [0, -1, 4, 1.5, NaN, Infinity]) {
    assert.deepEqual(await owner.setOverrides([{ page: 1, source, sourcePage }]), {
      ok: false,
      reason: "invalid-page",
    });
  }
  assert.deepEqual(
    await owner.setOverrides([
      { page: 1, source: null },
      { page: 1, source: null },
    ]),
    { ok: false, reason: "invalid-page" },
  );
  assert.deepEqual(
    await owner.setOverrides([
      { page: 1, source: null },
      { page: 2, source: foreign, sourcePage: 1 },
    ]),
    { ok: false, reason: "invalid-source" },
  );
  source.release();
  assert.deepEqual(await owner.setOverrides([{ page: 2, source, sourcePage: 1 }]), {
    ok: false,
    reason: "invalid-source",
  });
  assert.equal(owner.currentSource(1)?.source, source);
  assert.equal(owner.revision(1), 1);
  await Promise.all([owner.close(), other.close()]);
});

test("all source geometries are finite, positive, normalized, and fixed against base crop/UserUnit/rotation", async () => {
  for (const options of [
    { view: [0, 0, NaN, 800] },
    { view: [0, 0, Infinity, 800] },
    { view: [0, 0, 0, 800] },
    { view: [600, 0, 0, 800] },
    { view: [0, 800, 600, 0] },
    { view: [0, 0, 600] },
    { view: [-1e308, 0, 1e308, 800] },
    { userUnit: 0 },
    { userUnit: -1 },
    { userUnit: Infinity },
    { rotate: NaN },
    { rotate: 45 },
  ]) {
    const { owner } = harness({
      load: async () => ({
        pdf: fakePdf([fakePage(), fakePage(options)]),
        dispose: async () => {},
      }),
    });
    assert.deepEqual(await owner.prepare(new Uint8Array([1])), {
      ok: false,
      reason: "invalid-page",
    });
    await owner.close();
  }
  for (const options of [{ view: [1, 0, 601, 800] }, { userUnit: 2 }, { rotate: 90 }]) {
    const { owner } = harness({
      load: async () => ({ pdf: fakePdf([fakePage(options)]), dispose: async () => {} }),
    });
    const source = await prepared(owner);
    assert.deepEqual(
      await owner.setOverrides([
        { page: 1, source: null },
        { page: 2, source, sourcePage: 1 },
      ]),
      { ok: false, reason: "geometry-mismatch" },
    );
    assert.equal(owner.revision(1), 0);
    await owner.close();
  }
  const { owner } = harness({
    load: async () => ({
      pdf: fakePdf([fakePage({ rotate: -360, userUnit: 1 + 1e-7, view: [0.00001, 0, 600, 800] })]),
      dispose: async () => {},
    }),
  });
  const source = await prepared(owner);
  assert.equal((await owner.setOverrides([{ page: 1, source, sourcePage: 1 }])).ok, true);
  await owner.close();
});

test("read-only document validation fails closed for unsupported APIs, permissions, forms, XFA and signatures", async () => {
  const flags = { IsAcroFormPresent: false, IsXFAPresent: false, IsSignaturesPresent: false };
  const variants: Record<string, unknown>[] = [
    { getPermissions: undefined },
    { getMetadata: undefined },
    { getFieldObjects: undefined },
    { isPureXfa: undefined },
    { isPureXfa: true },
    { getPermissions: async () => [] },
    { getFieldObjects: async () => new Map([["field", []]]) },
    { getFieldObjects: async () => ({}) },
    { getMetadata: async () => ({ info: {} }) },
    ...Object.keys(flags).map(key => ({
      getMetadata: async () => ({ info: { ...flags, [key]: true } }),
    })),
  ];
  for (const variant of variants) {
    let disposed = 0;
    const { owner } = harness({
      load: async () => ({
        pdf: fakePdf(undefined, variant),
        dispose: async () => {
          disposed++;
        },
      }),
    });
    assert.deepEqual(await owner.prepare(new Uint8Array([1])), {
      ok: false,
      reason: "unsupported",
    });
    await owner.close();
    assert.equal(disposed, 1);
  }
  let checks = 0;
  const base = fakePdf(undefined, {
    getPermissions: async () => {
      checks++;
      return [4];
    },
  });
  const { owner } = harness({}, base);
  const source = await prepared(owner);
  assert.deepEqual(await owner.setOverrides([{ page: 1, source, sourcePage: 1 }]), {
    ok: false,
    reason: "unsupported",
  });
  assert.deepEqual(await owner.setOverrides([{ page: 2, source, sourcePage: 1 }]), {
    ok: false,
    reason: "unsupported",
  });
  assert.equal(checks, 1);
  await owner.close();
});

test("source annotations permit ordinary links but reject widgets and executable/OCG/reset actions", async () => {
  for (const annotation of [
    { annotationType: 20 },
    { annotationType: 1 },
    { annotationType: 2, setOCGState: {} },
    { annotationType: 2, resetForm: {} },
    { annotationType: 2, actions: { A: [] } },
    { annotationType: 2, action: "NextPage" },
    { annotationType: 2, unsafeUrl: "javascript:evil()" },
    { annotationType: 2, hasAppearance: true, dest: [0, { name: "Fit" }] },
  ]) {
    const { owner } = harness({
      load: async () => ({
        pdf: fakePdf([fakePage({ getAnnotations: async () => [annotation] })]),
        dispose: async () => {},
      }),
    });
    assert.deepEqual(await owner.prepare(new Uint8Array([1])), {
      ok: false,
      reason: "unsupported",
    });
    await owner.close();
  }
  const { owner } = harness({
    load: async () => ({
      pdf: fakePdf([
        fakePage({
          getAnnotations: async () => [
            { annotationType: 2, dest: [{ num: 1, gen: 0 }, { name: "Fit" }] },
          ],
        }),
      ]),
      dispose: async () => {},
    }),
  });
  assert.deepEqual(await owner.prepare(new Uint8Array([1]), { linkContext: "base" }), {
    ok: false,
    reason: "unsupported",
  });
  assert.equal((await owner.prepare(new Uint8Array([1]))).ok, true);
  await owner.close();
});

test("latest batch wins across async geometry; released handles and cancellation are rechecked", async () => {
  const pending = deferred<PDFJS.PDFPageProxy>();
  const entered = deferred<void>();
  const base = fakePdf(undefined, {
    getPage: async (page: number) => {
      if (page === 1) {
        entered.resolve();
        return pending.promise;
      }
      return fakePage();
    },
  });
  const { owner } = harness({}, base);
  const source = await prepared(owner);
  const older = owner.setOverrides([{ page: 1, source, sourcePage: 1 }]);
  await entered.promise;
  assert.deepEqual(await owner.setOverrides([{ page: 2, source, sourcePage: 2 }]), {
    ok: true,
    revision: 1,
    pages: [2],
  });
  pending.resolve(fakePage());
  assert.deepEqual(await older, { ok: false, reason: "superseded" });
  assert.equal(owner.currentSource(1), undefined);
  const abort = new AbortController();
  const cancelled = owner.setOverrides([{ page: 1, source, sourcePage: 1 }], {
    signal: abort.signal,
  });
  abort.abort();
  assert.deepEqual(await cancelled, { ok: false, reason: "cancelled" });
  const released = owner.setOverrides([{ page: 1, source, sourcePage: 1 }]);
  source.release();
  assert.deepEqual(await released, { ok: false, reason: "invalid-source" });
  await owner.close();
});

test("internal callbacks observe the full commit, may reenter, and callback errors never roll mappings back", async () => {
  let owner!: DocumentPageSources;
  let reentrant!: Promise<unknown>;
  let calls = 0;
  ({ owner } = harness({
    changed: () => {
      calls++;
      if (calls !== 1) return;
      assert.equal(owner.revision(1), 1);
      assert.equal(owner.revision(2), 1);
      reentrant = owner.setOverrides([{ page: 1, source: null }]);
      throw new Error("coordinator failed");
    },
  }));
  const source = await prepared(owner);
  await assert.rejects(
    owner.setOverrides([
      { page: 1, source, sourcePage: 1 },
      { page: 2, source, sourcePage: 2 },
    ]),
    /coordinator failed/,
  );
  await reentrant;
  assert.equal(owner.currentSource(1), undefined);
  assert.equal(owner.currentSource(2)?.source, source);
  assert.equal(owner.revision(1), 2);
  await owner.close();
});

test("live cap waits for leases and destruction; shared cold acquisitions join a single reopen", async () => {
  let live = 0;
  let maximum = 0;
  const events: string[] = [];
  const disposal = deferred<void>();
  let opens = 0;
  const { owner } = harness({
    limits: { maxLiveDocuments: 1 },
    load: async data => {
      const generation = ++opens;
      maximum = Math.max(maximum, ++live);
      events.push(`open:${data[0]}`);
      return {
        pdf: fakePdf(),
        dispose: async () => {
          events.push(`dispose:${data[0]}`);
          if (generation === 1) await disposal.promise;
          live--;
        },
      };
    },
  });
  const a = await prepared(owner, 1);
  await owner.setOverrides([{ page: 1, source: a, sourcePage: 1 }]);
  const first = await owner.acquire(1);
  const second = await owner.acquire(1);
  const bPending = owner.prepare(new Uint8Array([2]));
  await turn();
  assert.deepEqual(events, ["open:1"]);
  first.release();
  await turn();
  assert.deepEqual(events, ["open:1"]);
  second.release();
  await turn();
  assert.deepEqual(events, ["open:1", "dispose:1"]);
  disposal.resolve();
  assert.equal((await bPending).ok, true);
  const [one, two] = await Promise.all([owner.acquire(1), owner.acquire(1)]);
  assert.equal(opens, 3);
  assert.equal(one.source?.pdf, two.source?.pdf);
  one.release();
  two.release();
  await owner.close();
  assert.equal(maximum, 1);
  assert.equal(live, 0);
});

test("LRU ignores caller and mapping retention, and bytes/handle budgets are reclaimed after physical settlement", async () => {
  const { owner, loads } = harness({ limits: { maxLiveDocuments: 2, maxSources: 3, maxBytes: 3 } });
  const a = await prepared(owner, 1);
  await owner.setOverrides([{ page: 1, source: a, sourcePage: 1 }]);
  const b = await prepared(owner, 2);
  const use = await owner.acquire(1);
  use.release();
  await prepared(owner, 3);
  assert.deepEqual(
    loads.map(data => data[0]),
    [1, 2, 3],
  );
  const aUse = await owner.acquire(1);
  aUse.release();
  assert.equal(loads.length, 3, "recently used A remains live; B was the LRU victim");
  assert.deepEqual(await owner.prepare(new Uint8Array([4])), {
    ok: false,
    reason: "resource-limit",
  });
  b.release();
  await turn();
  assert.equal((await owner.prepare(new Uint8Array([4]))).ok, true);
  await owner.close();
});

test("font retention does not block document disposal/reopening but final close waits", async () => {
  const fonts = deferred<void>();
  let fontClosed = 0;
  let disposed = 0;
  const { owner } = harness({
    limits: { maxLiveDocuments: 1 },
    load: async data => ({
      pdf: fakePdf(),
      fonts:
        data[0] === 1
          ? ({
              bindPageUsage() {},
              close: () => {
                fontClosed++;
                return fonts.promise;
              },
            } as unknown as DocumentFonts)
          : undefined,
      dispose: async () => {
        disposed++;
      },
    }),
  });
  await prepared(owner, 1);
  await prepared(owner, 2);
  assert.equal(fontClosed, 1);
  assert.equal(disposed, 1);
  let closed = false;
  const close = owner.close().then(() => {
    closed = true;
  });
  await turn();
  assert.equal(disposed, 2);
  assert.equal(closed, false);
  fonts.resolve();
  await close;
});

for (const stage of ["operators", "dependency", "load"] as const) {
  for (const rejects of [false, true]) {
    test(`cancelled source font ${stage} ${rejects ? "rejection" : "completion"} retains physical page/PDF and copied bytes until settlement`, async () => {
      const gate = deferred<void>();
      const started = deferred<void>();
      let cleanups = 0,
        disposed = 0,
        charged = 0;
      const faces = new Set<unknown>();
      class Face {
        constructor(
          readonly family: string,
          readonly data: ArrayBuffer,
        ) {}
        async load() {
          started.resolve();
          await gate.promise;
          return this;
        }
      }
      const document = { fonts: faces, defaultView: { FontFace: Face } } as unknown as Document;
      const font = {
        loadedName: "physical_source_font",
        data: new Uint8Array(1024),
        disableFontFace: false,
      };
      const page = fakePage({
        pageNumber: 1,
        cleanup: () => {
          cleanups++;
        },
        getOperatorList: async () => {
          if (stage === "operators") {
            started.resolve();
            await gate.promise;
          }
          return { fnArray: [37], argsArray: [["f1", 12]] };
        },
        commonObjs: {
          get: (_id: string, done: (font: unknown) => void) => {
            if (stage === "dependency") {
              started.resolve();
              void gate.promise.then(
                () => done(font),
                () => done(null),
              );
            } else done(font);
          },
        },
      });
      const fonts = new DocumentFonts(document, {
        retainNativeFaces: true,
        geometric: false,
        reserveBytes: bytes => {
          charged += bytes;
          return () => {
            charged -= bytes;
          };
        },
      });
      const { owner } = harness({
        limits: { maxLiveDocuments: 1 },
        load: async () => ({
          pdf: fakePdf([page]),
          fonts,
          dispose: async () => {
            disposed++;
          },
        }),
      });
      const source = await prepared(owner);
      await owner.setOverrides([{ page: 1, source, sourcePage: 1 }]);
      const use = await owner.acquire(1);
      const baseline = cleanups;
      const abort = new AbortController();
      const preparing = fonts.prepare(use.page, 2, abort.signal);
      await started.promise;
      abort.abort();
      await preparing;
      use.release();
      source.release();
      await owner.setOverrides([{ page: 1, source: null }]);
      let closed = false;
      const closing = owner.close().then(() => {
        closed = true;
      });
      await turn();
      assert.equal(
        cleanups,
        baseline,
        "the physical font read/load pins its page after the caller releases",
      );
      assert.equal(disposed, 0, "PDF disposal must not race physical font work");
      assert.equal(closed, false);
      assert.equal(charged, stage === "load" ? 1024 : 0);
      assert.equal(fonts.byteLength, charged);
      if (rejects) gate.reject(new Error("late font work failure"));
      else gate.resolve();
      await closing;
      assert.equal(cleanups, baseline + 1);
      assert.equal(disposed, 1);
      assert.equal(charged, 0);
      assert.equal(fonts.byteLength, 0);
      assert.equal(faces.size, 0, "revoked work never registers late faces");
    });
  }
}

test("close revokes synchronously, waits pending getPage/active uses, and never closes the base owner", async () => {
  const base = fakePdf();
  const baseUsage = new DocumentPageUsage(base);
  const pending = deferred<PDFJS.PDFPageProxy>();
  let block = false;
  let cleanups = 0;
  let disposed = 0;
  const owner = new DocumentPageSources(base, baseUsage, {
    load: async () => ({
      pdf: fakePdf(undefined, { getPage: async () => (block ? pending.promise : fakePage()) }),
      dispose: async () => {
        disposed++;
      },
    }),
  });
  const source = await prepared(owner);
  await owner.setOverrides([{ page: 1, source, sourcePage: 1 }]);
  const active = await owner.acquire(1);
  block = true;
  const acquisition = owner.acquire(1);
  await turn();
  let closed = false;
  const close = owner.close().then(() => {
    closed = true;
  });
  assert.equal(active.source?.isCurrent(), false);
  assert.equal(owner.close(), owner.close());
  await turn();
  assert.equal(closed, false);
  active.release();
  pending.resolve(
    fakePage({
      cleanup: () => {
        cleanups++;
      },
    }),
  );
  await assert.rejects(acquisition, /destroyed/);
  await close;
  assert.equal(disposed, 1);
  assert.equal(cleanups, 1);
  const canonical = await baseUsage.acquire(1);
  canonical.release();
  assert.deepEqual(await owner.prepare(new Uint8Array([1])), { ok: false, reason: "destroyed" });
});

test("close waits an in-flight preparation load; cancellation/rejected loads free budgets without leaks", async () => {
  const load = deferred<{ pdf: PDFJS.PDFDocumentProxy; dispose: () => Promise<void> }>();
  let disposed = 0;
  const { owner } = harness({ load: () => load.promise });
  const preparation = owner.prepare(new Uint8Array([1]));
  await turn();
  let closed = false;
  const close = owner.close().then(() => {
    closed = true;
  });
  await turn();
  assert.equal(closed, false);
  load.resolve({
    pdf: fakePdf(),
    dispose: async () => {
      disposed++;
    },
  });
  assert.deepEqual(await preparation, { ok: false, reason: "destroyed" });
  await close;
  assert.equal(disposed, 1);

  let calls = 0;
  const cancel = new AbortController();
  const { owner: retry } = harness({
    limits: { maxSources: 1, maxLiveDocuments: 1 },
    load: async () => {
      calls++;
      if (calls === 1) throw new Error("bad source");
      if (calls === 2) cancel.abort();
      return { pdf: fakePdf(), dispose: async () => {} };
    },
  });
  const failed = await retry.prepare(new Uint8Array([1]));
  assert.equal(!failed.ok && failed.reason, "error");
  assert.deepEqual(await retry.prepare(new Uint8Array([1]), { signal: cancel.signal }), {
    ok: false,
    reason: "cancelled",
  });
  await turn();
  await prepared(retry);
  await retry.close();
});

test("destination translation remaps named/ref/numeric targets uniquely and rejects stale or ambiguous source links", async () => {
  const dest = deferred<unknown[]>();
  let slow = false;
  const { owner } = harness({
    load: async () => ({
      pdf: fakePdf(undefined, {
        getDestination: async () => (slow ? dest.promise : [{ num: 10, gen: 0 }, { name: "Fit" }]),
        getPageIndex: async () => 1,
      }),
      dispose: async () => {},
    }),
  });
  const source = await prepared(owner);
  await owner.setOverrides([
    { page: 3, source, sourcePage: 1 },
    { page: 1, source, sourcePage: 2 },
  ]);
  assert.deepEqual(await owner.resolveDestination(3, source.id, "named"), [0, { name: "Fit" }]);
  assert.deepEqual(await owner.resolveDestination(3, source.id, [0, { name: "Fit" }]), [
    2,
    { name: "Fit" },
  ]);
  await owner.setOverrides([{ page: 2, source, sourcePage: 2 }]);
  assert.equal(await owner.resolveDestination(3, source.id, "named"), null);
  slow = true;
  const pending = owner.resolveDestination(3, source.id, "named");
  await turn();
  await owner.setOverrides([{ page: 3, source: null }]);
  dest.resolve([0, { name: "Fit" }]);
  assert.equal(await pending, null);
  assert.equal(await owner.resolveDestination(3, source.id, "named"), null);
  assert.equal(await owner.resolveDestination(3, null, "base"), "base");
  assert.equal(await owner.resolveDestination(3, null, [{ num: 2, gen: 0 }]), null);
  await owner.close();
});

test("resource admission bounds bytes, pages, batches and invalid limits without partial publication", async () => {
  const { owner } = harness({ limits: { maxBytes: 2, maxSourcePages: 2, maxBatchPages: 1 } });
  assert.deepEqual(await owner.prepare(new Uint8Array()), { ok: false, reason: "invalid-source" });
  assert.deepEqual(await owner.prepare(new Uint8Array(3)), { ok: false, reason: "resource-limit" });
  assert.deepEqual(await owner.prepare(new Uint8Array([1])), {
    ok: false,
    reason: "resource-limit",
  });
  assert.deepEqual(
    await owner.setOverrides([
      { page: 1, source: null },
      { page: 2, source: null },
    ]),
    { ok: false, reason: "resource-limit" },
  );
  await owner.close();
  const base = fakePdf();
  for (const value of [0, -1, 0.5, Infinity, NaN]) {
    assert.throws(
      () =>
        new DocumentPageSources(base, new DocumentPageUsage(base), {
          load: async () => {
            throw new Error();
          },
          limits: { maxLiveDocuments: value },
        }),
      RangeError,
    );
  }
});

test("a lease selects its mapping before pending getPage and remains physical after remapping", async () => {
  const pending = deferred<PDFJS.PDFPageProxy>();
  let block = false;
  let disposed = 0;
  const { owner } = harness({
    load: async () => ({
      pdf: fakePdf(undefined, { getPage: async () => (block ? pending.promise : fakePage()) }),
      dispose: async () => {
        disposed++;
      },
    }),
  });
  const source = await prepared(owner);
  await owner.setOverrides([{ page: 1, source, sourcePage: 2 }]);
  source.release();
  block = true;
  const acquisition = owner.acquire(1);
  await turn();
  await owner.setOverrides([{ page: 1, source: null }]);
  assert.equal(disposed, 0);
  const page = fakePage();
  pending.resolve(page);
  const use = await acquisition;
  assert.equal(use.page, page);
  assert.equal(use.source?.sourcePage, 2);
  assert.equal(use.source?.id, source.id);
  assert.equal(use.source?.isCurrent(), false);
  assert.equal(disposed, 0);
  use.release();
  await owner.close();
  assert.equal(disposed, 1);
});

test("close waits source validation and destination reads even after their loading job settles", async () => {
  const annotations = deferred<unknown[]>();
  let disposedCount = 0;
  const { owner } = harness({
    load: async () => ({
      pdf: fakePdf([fakePage({ getAnnotations: () => annotations.promise })]),
      dispose: async () => {
        disposedCount++;
      },
    }),
  });
  const preparation = owner.prepare(new Uint8Array([1]));
  await turn();
  let settled = false;
  const close = owner.close().then(() => {
    settled = true;
  });
  await turn();
  assert.equal(settled, false);
  assert.equal(disposedCount, 0);
  annotations.resolve([]);
  assert.deepEqual(await preparation, { ok: false, reason: "destroyed" });
  await close;
  assert.equal(disposedCount, 1);

  const target = deferred<unknown[]>();
  const { owner: links } = harness({
    load: async () => ({
      pdf: fakePdf(undefined, { getDestination: () => target.promise }),
      dispose: async () => {},
    }),
  });
  const source = await prepared(links);
  await links.setOverrides([{ page: 1, source, sourcePage: 1 }]);
  const destination = links.resolveDestination(1, source.id, "target");
  await turn();
  settled = false;
  const closed = links.close().then(() => {
    settled = true;
  });
  await turn();
  assert.equal(settled, false);
  target.resolve([0, { name: "Fit" }]);
  assert.equal(await destination, null);
  await closed;
});

test("cancelled preparations waiting on a live slot do not deadlock or open a document", async () => {
  const { owner, loads } = harness({ limits: { maxLiveDocuments: 1 } });
  const source = await prepared(owner);
  await owner.setOverrides([{ page: 1, source, sourcePage: 1 }]);
  const use = await owner.acquire(1);
  const controller = new AbortController();
  const pending = owner.prepare(new Uint8Array([2]), { signal: controller.signal });
  await turn();
  controller.abort();
  assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
  assert.equal(loads.length, 1);
  use.release();
  await prepared(owner, 3);
  await owner.close();
});

test("base-context sources pass only named/numeric links without consulting foreign document refs", async () => {
  const { owner } = harness({
    load: async () => ({
      pdf: fakePdf([
        fakePage({
          getAnnotations: async () => [
            { annotationType: 2, dest: "base-name" },
            { annotationType: 2, dest: [1, { name: "Fit" }] },
            { annotationType: 2, url: "https://example.test/", unsafeUrl: "https://example.test/" },
          ],
        }),
      ]),
      dispose: async () => {},
    }),
  });
  const result = await owner.prepare(new Uint8Array([1]), { linkContext: "base" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const source = result.source;
  await owner.setOverrides([{ page: 3, source, sourcePage: 1 }]);
  assert.equal(await owner.resolveDestination(3, source.id, "base-name"), "base-name");
  assert.deepEqual(await owner.resolveDestination(3, source.id, [1, { name: "Fit" }]), [
    1,
    { name: "Fit" },
  ]);
  assert.equal(
    await owner.resolveDestination(3, source.id, [{ num: 1, gen: 0 }, { name: "Fit" }]),
    null,
  );
  await owner.close();
});
