// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentPrint } from "../../src/document-print.js";

const options = (quality: { dpi: number } = { dpi: 300 }) => ({
  pages: "all" as const,
  layout: { mode: "single" as const },
  quality,
  sheet: "a4" as const,
  pageScaling: "fit" as const,
  orientation: "portrait" as const,
});

function context(permissions: readonly ("print" | "print-high-quality")[] | null, pageCount = 1) {
  let pageAcquisitions = 0;
  let configReads = 0;
  let geometryReads = 0;
  return {
    values: {
      get pageAcquisitions() {
        return pageAcquisitions;
      },
      get configReads() {
        return configReads;
      },
      get geometryReads() {
        return geometryReads;
      },
    },
    context: {
      pdf: {
        numPages: pageCount,
        annotationStorage: { print: {} },
        getOptionalContentConfig: async () => {
          configReads++;
          return { setVisibility() {} };
        },
      },
      pages: {
        acquire: async () => {
          pageAcquisitions++;
          throw new Error("must not acquire");
        },
      },
      information: { permissions },
      geometry: {
        revision: 7,
        layout: { mode: "single", gapPt: 0 },
        sizes: Array.from({ length: pageCount }, () => ({ width: 595.28, height: 841.89 })),
        sizeFor: () => {
          geometryReads++;
          return { width: 595.28, height: 841.89 };
        },
      },
      layerVisibility: null,
      formStorageSnapshot: {},
      xfaSnapshot: null,
      revisions: { document: 3, layers: null, forms: 5, geometry: 7 },
      AnnotationMode: { ENABLE_STORAGE: 3 },
      signal: new AbortController().signal,
      window: { navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" } },
      nativeCapabilities: () => ({
        nativePrintSupport: "portrait-and-landscape",
        engine: "chromium",
        browser: "chrome",
        platform: "desktop",
        operatingSystem: "linux",
        sourceFallbackRecommended: false,
      }),
    },
  } as const;
}

test("permission denial and ordinary-quality cap happen before PDF or page work", async () => {
  const raster = {
    acquireExclusive: async () => {
      throw new Error("must not acquire raster");
    },
  };
  const diagnostics: Readonly<Record<string, unknown>>[] = [];
  const owner = new DocumentPrint(
    raster as never,
    { maxSheets: 0.5 },
    { diagnostic: value => diagnostics.push(value) },
  );
  const absent = context([]);
  assert.deepEqual(await owner.print(options(), absent.context as never), {
    ok: false,
    reason: "disabled",
  });
  const ordinary = context(["print"]);
  assert.deepEqual(await owner.print(options({ dpi: 300 }), ordinary.context as never), {
    ok: false,
    reason: "too-many-sheets",
    sheetCount: 1,
    maxSheets: 0.5,
    sourceFallbackAvailable: true,
  });
  assert.equal(diagnostics[0]?.requestedDpi, 150);
  assert.equal(absent.values.configReads + ordinary.values.configReads, 0);
  assert.equal(absent.values.pageAcquisitions + ordinary.values.pageAcquisitions, 0);
});

test("hard sheet preflight rejects long jobs before configuration, raster, or pages", async () => {
  const raster = {
    acquireExclusive: async () => {
      throw new Error("must not acquire raster");
    },
  };
  const owner = new DocumentPrint(raster as never, { maxSheets: 99 });
  const job = context(["print-high-quality"], 100);
  assert.deepEqual(await owner.print(options(), job.context as never), {
    ok: false,
    reason: "too-many-sheets",
    sheetCount: 100,
    maxSheets: 99,
    sourceFallbackAvailable: true,
  });
  assert.equal(job.values.configReads, 0);
  assert.equal(job.values.pageAcquisitions, 0);
  assert.equal(job.values.geometryReads, 0);
});

test("a null PDF.js permission list is unrestricted rather than print-disabled", async () => {
  const raster = {
    acquireExclusive: async () => {
      throw new Error("must not acquire raster");
    },
  };
  const owner = new DocumentPrint(raster as never, { maxSheets: 99 });
  const job = context(null, 100);
  assert.deepEqual(await owner.print(options(), job.context as never), {
    ok: false,
    reason: "too-many-sheets",
    sheetCount: 100,
    maxSheets: 99,
    sourceFallbackAvailable: true,
  });
  assert.equal(job.values.configReads, 0);
  assert.equal(job.values.pageAcquisitions, 0);
  assert.equal(job.values.geometryReads, 0);
});

test("pre-aborted caller and document signals cancel before any print side effects", async () => {
  for (const source of ["options", "document"] as const) {
    let rasterAcquisitions = 0;
    let evictions = 0;
    const events: unknown[] = [];
    const diagnostics: unknown[] = [];
    const raster = {
      acquireExclusive: async () => {
        rasterAcquisitions++;
        throw new Error("must not acquire raster");
      },
    };
    const owner = new DocumentPrint(
      raster as never,
      {},
      {
        event: value => events.push(value),
        diagnostic: value => diagnostics.push(value),
      },
    );
    const job = context(["print-high-quality"]);
    const controller = new AbortController();
    controller.abort();
    const result = await owner.print(
      source === "options" ? { ...options(), signal: controller.signal } : options(),
      {
        ...job.context,
        ...(source === "document" ? { signal: controller.signal } : {}),
        evictMainRasterOutputs: () => {
          evictions++;
          return { count: 0, bytes: 0 };
        },
      } as never,
    );

    assert.deepEqual(result, { ok: false, reason: "cancelled" });
    assert.equal(job.values.configReads, 0);
    assert.equal(job.values.geometryReads, 0);
    assert.equal(job.values.pageAcquisitions, 0);
    assert.equal(rasterAcquisitions, 0);
    assert.equal(evictions, 0);
    assert.deepEqual(events, []);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(owner.state, {
      phase: "idle",
      jobId: null,
      completedSheets: 0,
      totalSheets: 0,
      retainedBytes: 0,
      nativeResourcesRetained: false,
    });
  }
});

test("XFA page limits count selected pages rather than composed sheets", async () => {
  const raster = {
    acquireExclusive: async () => {
      throw new Error("must not acquire raster");
    },
  };
  const owner = new DocumentPrint(raster as never, { maxXfaPages: 1 });
  const job = context(["print-high-quality"], 2);
  const xfaPage = {
    pageNo: 1,
    intent: "print",
    size: { width: 300, height: 400 },
    nodeCount: 1,
    imageCount: 0,
    xfaHtml: { name: "div", children: [] },
  };
  const result = await owner.print(
    { ...options(), layout: { mode: "spread", firstPageSide: "left", gapPt: 0 } },
    {
      ...job.context,
      geometry: {
        ...job.context.geometry,
        layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
      },
      xfaSnapshot: {
        pages: [xfaPage, { ...xfaPage, pageNo: 2 }],
        pageFor: (pageNo: number) => ({ ...xfaPage, pageNo }),
        nodeCount: 2,
        imageCount: 0,
        annotationStorage: { getValue: (_id: string, fallback: object) => fallback },
      },
    } as never,
  );
  assert.deepEqual(result, {
    ok: false,
    reason: "too-large",
    estimatedSheetCount: 1,
    sourceFallbackAvailable: true,
  });
  assert.equal(job.values.configReads, 0);
  assert.equal(job.values.pageAcquisitions, 0);
});

test("portrait-only compatibility admits spread planning before the sheet limit", async () => {
  let capabilities = 0;
  let leases = 0;
  const events: unknown[] = [];
  const owner = new DocumentPrint(
    {
      acquireExclusive: async () => {
        leases++;
        return { release() {} };
      },
    } as never,
    { maxSheets: 0.5 },
    { event: event => events.push(event) },
  );
  const job = context(["print-high-quality"], 2);
  const result = await owner.print(
    {
      ...options(),
      layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
      orientation: "landscape",
    },
    {
      ...job.context,
      geometry: {
        ...job.context.geometry,
        layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
      },
      nativeCapabilities: () => {
        capabilities++;
        return {
          nativePrintSupport: "portrait",
          engine: "chromium",
          browser: "chrome",
          platform: "android",
          operatingSystem: "android",
          sourceFallbackRecommended: false,
        };
      },
    } as never,
  );
  assert.deepEqual(result, {
    ok: false,
    reason: "too-many-sheets",
    sheetCount: 1,
    maxSheets: 0.5,
    sourceFallbackAvailable: true,
  });
  assert.equal(capabilities, 1);
  assert.equal(job.values.configReads, 0);
  assert.equal(job.values.pageAcquisitions, 0);
  assert.equal(leases, 0);
  assert.deepEqual(events, []);
  assert.equal(owner.state.phase, "idle");
});

test("missing XFA rendering support releases exclusive preparation without acquiring raster pages", async () => {
  let releases = 0;
  const owner = new DocumentPrint({
    acquireExclusive: async () => ({
      release: () => {
        releases++;
      },
    }),
  } as never);
  const job = context(["print-high-quality"]);
  const xfaPage = {
    pageNo: 1,
    intent: "print",
    size: { width: 595.28, height: 841.89 },
    nodeCount: 1,
    imageCount: 0,
    xfaHtml: { name: "div", children: [] },
  };
  await assert.rejects(
    owner.print(options(), {
      ...job.context,
      xfaSnapshot: {
        pages: [xfaPage],
        pageFor: () => xfaPage,
        nodeCount: 1,
        imageCount: 0,
        annotationStorage: {},
      },
    } as never),
    /pure-XFA printing requires XfaLayer/,
  );
  assert.equal(job.values.pageAcquisitions, 0);
  assert.equal(releases, 1);
  assert.equal(owner.state.phase, "idle");
});

test("aggregate print-memory admission is distinct from structural impossibility", async () => {
  const raster = {
    acquireExclusive: async () => {
      throw new Error("must not acquire raster");
    },
  };
  const owner = new DocumentPrint(raster as never, { memoryLimitMiB: 0.1 });
  const job = context(["print-high-quality"]);
  assert.deepEqual(
    await owner.print(options(), { ...job.context, sourceFallbackAvailable: false } as never),
    {
      ok: false,
      reason: "memory-limit",
      estimatedSheetCount: 1,
      sourceFallbackAvailable: false,
    },
  );
  assert.equal(job.values.configReads, 0);
  assert.equal(job.values.pageAcquisitions, 0);
});

test("a nonzero residual raster baseline aborts after exclusive eviction and releases the lease", async () => {
  let releases = 0;
  let evictions = 0;
  const diagnostics: Readonly<Record<string, unknown>>[] = [];
  const raster = {
    acquireExclusive: async () => ({
      release: () => {
        releases++;
      },
    }),
  };
  const owner = new DocumentPrint(
    raster as never,
    {},
    { diagnostic: value => diagnostics.push(value) },
  );
  const job = context(["print-high-quality"]);
  const result = await owner.print(options(), {
    ...job.context,
    evictMainRasterOutputs: () => {
      evictions++;
      return { count: 1, bytes: 256 };
    },
    evictThumbnailBackingStores: () => ({ count: 2, bytes: 128 }),
    residualRasterBytes: () => 64,
  } as never);
  assert.deepEqual(result, {
    ok: false,
    reason: "memory-limit",
    estimatedSheetCount: 1,
    sourceFallbackAvailable: true,
  });
  assert.equal(evictions, 1);
  assert.equal(releases, 1);
  assert.equal(diagnostics.at(-1)?.reclaimableRasterBytes, 384);
  assert.equal(diagnostics.at(-1)?.residualRasterBytes, 64);
});

test("replacement admits a successor while stale pre-resource work settles without clearing its state", async () => {
  let oldEntered!: () => void;
  let releaseOld!: () => void;
  const oldConfigEntered = new Promise<void>(resolve => {
    oldEntered = resolve;
  });
  const oldConfigGate = new Promise<void>(resolve => {
    releaseOld = resolve;
  });
  let exclusiveEntered!: () => void;
  let rejectExclusive!: (error: Error) => void;
  const newExclusiveEntered = new Promise<void>(resolve => {
    exclusiveEntered = resolve;
  });
  const exclusiveGate = new Promise<never>((_resolve, reject) => {
    rejectExclusive = reject;
  });
  const owner = new DocumentPrint({
    acquireExclusive: () => {
      exclusiveEntered();
      return exclusiveGate;
    },
  } as never);
  const oldContext = context(["print-high-quality"]);
  const oldPrint = owner.print(options(), {
    ...oldContext.context,
    pdf: {
      ...oldContext.context.pdf,
      getOptionalContentConfig: async () => {
        oldEntered();
        await oldConfigGate;
        return { setVisibility() {} };
      },
    },
  } as never);
  await oldConfigEntered;

  owner.reset();
  const successorContext = context(["print-high-quality"]);
  const successor = owner.print(options(), successorContext.context as never);
  await newExclusiveEntered;
  assert.equal(owner.state.phase, "preflight");

  releaseOld();
  assert.deepEqual(await oldPrint, { ok: false, reason: "cancelled" });
  assert.equal(owner.state.phase, "preflight");

  rejectExclusive(new Error("stop successor"));
  await assert.rejects(successor, /stop successor/);
  assert.equal(owner.state.phase, "idle");
});

test("reentrant preparing-state replacement prevents stale resource allocation and progress", async () => {
  let releases = 0;
  const events: string[] = [];
  let owner!: DocumentPrint;
  owner = new DocumentPrint(
    {
      acquireExclusive: async () => ({
        release: () => {
          releases++;
        },
      }),
    } as never,
    {},
    {
      state: state => {
        if (state.phase === "preparing") owner.reset();
      },
      event: event => events.push(event.type),
    },
  );
  const job = context(["print-high-quality"]);
  const result = await owner.print(options(), job.context as never);

  assert.deepEqual(result, { ok: false, reason: "cancelled" });
  assert.equal(job.values.configReads, 1);
  assert.equal(job.values.pageAcquisitions, 0);
  assert.equal(releases, 1);
  assert.deepEqual(events, ["start", "cleanup"]);
  assert.equal(owner.state.phase, "idle");
});
