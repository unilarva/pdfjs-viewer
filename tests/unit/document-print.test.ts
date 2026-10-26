// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type * as PDFJS from "pdfjs-dist";
import { DocumentPageSources } from "../../src/document-page-sources.js";
import { DocumentPageUsage } from "../../src/document-page-usage.js";
import { DocumentPrint } from "../../src/document-print.js";

/** Controllable physical work, deliberately independent of cancellation requests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Real source admission with fake PDF raster work; stop before native DOM ownership. */
async function sourcePrintFixture(
  sources: readonly number[],
  hooks: {
    render?: (source: number) => Promise<void>;
    config?: (source: number) => Promise<void>;
    getPage?: (source: number) => Promise<void>;
    geometry?: (source: number) => { width: number; height: number; userUnit: number };
  } = {},
) {
  const events: string[] = [];
  const renders: Array<{
    source: number;
    parameters: Parameters<PDFJS.PDFPageProxy["render"]>[0];
  }> = [];
  const configs: Array<{ source: number; intent: string; value: object }> = [];
  const visibility: unknown[][] = [];
  let live = 0;
  let peak = 0;
  let printing = false;
  let drawnSource = -1;
  const makePdf = (source: number, numPages = 1): PDFJS.PDFDocumentProxy => {
    const size = hooks.geometry?.(source) ?? { width: 595.28, height: 841.89, userUnit: 1 };
    const page = {
      view: [0, 0, size.width, size.height],
      rotate: 0,
      userUnit: size.userUnit,
      getAnnotations: async () => [],
      cleanup: () => events.push(`cleanup:${source}`),
      getViewport: ({ scale }: { scale: number }) => ({
        width: size.width * size.userUnit * scale,
        height: size.height * size.userUnit * scale,
      }),
      render: (parameters: Parameters<PDFJS.PDFPageProxy["render"]>[0]) => {
        events.push(`render:${source}`);
        renders.push({ source, parameters });
        drawnSource = source;
        return {
          promise: hooks.render?.(source) ?? Promise.resolve(),
          cancel: () => events.push(`cancel:${source}`),
        };
      },
    } as unknown as PDFJS.PDFPageProxy;
    return {
      numPages,
      isPureXfa: false,
      getPage: async () => {
        if (printing) {
          events.push(`getPage:${source}`);
          await hooks.getPage?.(source);
        }
        return page;
      },
      getPermissions: async () => null,
      getMetadata: async () => ({
        info: { IsAcroFormPresent: false, IsXFAPresent: false, IsSignaturesPresent: false },
        metadata: null,
      }),
      getFieldObjects: async () => null,
      getOptionalContentConfig: async ({ intent }: { intent: string }) => {
        if (printing && source !== 0 && intent === "print") await hooks.config?.(source);
        const value = {
          setVisibility: (...args: unknown[]) => visibility.push([source, ...args]),
        };
        configs.push({ source, intent, value });
        return value;
      },
    } as unknown as PDFJS.PDFDocumentProxy;
  };
  const pdf = makePdf(0, sources.length);
  const baseUsage = new DocumentPageUsage(pdf);
  const pool = new DocumentPageSources(pdf, baseUsage, {
    limits: { maxLiveDocuments: 1 },
    load: async data => {
      const source = data[0]!;
      peak = Math.max(peak, ++live);
      events.push(`open:${source}`);
      return {
        pdf: makePdf(source),
        dispose: async () => {
          events.push(`dispose:${source}`);
          live--;
        },
      };
    },
  });
  for (const source of new Set(sources.filter(Boolean))) {
    const result = await pool.prepare(new Uint8Array([source]));
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("source preparation failed");
    assert.equal(
      (
        await pool.setOverrides(
          sources.flatMap((id, index) =>
            id === source ? [{ page: index + 1, source: result.source, sourcePage: 1 }] : [],
          ),
        )
      ).ok,
      true,
    );
    result.source.release();
  }
  const snapshot = pool.snapshot(sources.map((_, index) => index + 1));
  // Only the immutable print scope retains these mappings and their backing now.
  await pool.setOverrides(sources.map((_, index) => ({ page: index + 1, source: null })));
  events.length = configs.length = visibility.length = 0;
  printing = true;
  let releaseCalls = 0;
  let revoked = false;
  const canvases: Array<{ width: number; height: number }> = [];
  const sentinel = new Error("print DOM boundary");
  const win = {
    URL: {
      createObjectURL: () => {
        events.push("url:create");
        return "blob:print-sheet";
      },
      revokeObjectURL: () => events.push("url:revoke"),
    },
    CSSStyleSheet: class {
      constructor() {
        events.push("dom");
        assert.equal(revoked, true, "snapshot must be revoked before DOM/image readiness");
        assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
        throw sentinel;
      }
    },
    document: {
      adoptedStyleSheets: [],
      createElement: (tag: string) => {
        assert.equal(tag, "canvas");
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            setTransform() {},
            fillRect() {},
            save() {},
            restore() {},
            drawImage: () => events.push(`draw:${drawnSource}`),
          }),
          toBlob: (callback: (blob: Blob) => void) => {
            events.push("encode");
            callback(new Blob(["sheet"]));
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  const owner = new DocumentPrint({
    acquireExclusive: async () => ({ release: () => events.push("exclusive:release") }),
  } as never);
  const job = context(["print-high-quality"], sources.length);
  const formStorageSnapshot = { baseForms: true };
  return {
    owner,
    events,
    renders,
    configs,
    visibility,
    canvases,
    sentinel,
    snapshot,
    pool,
    formStorageSnapshot,
    peak: () => peak,
    live: () => live,
    releaseCalls: () => releaseCalls,
    print: () =>
      owner.print(options({ dpi: 72 }), {
        ...job.context,
        pdf,
        pages: snapshot,
        releasePageSources: () => {
          releaseCalls++;
          if (!revoked) events.push("snapshot:release");
          revoked = true;
          snapshot.release();
        },
        geometry: {
          ...job.context.geometry,
          layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
        },
        layerVisibility: { visibility: { baseLayer: false } },
        formStorageSnapshot,
        window: win,
      } as never),
    close: async () => {
      snapshot.release();
      await pool.close();
      await baseUsage.close();
    },
  };
}

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

test(
  "immutable mixed-source spreads finish with one live reader and isolated Print configs",
  { timeout: 5000 },
  async () => {
    const fixture = await sourcePrintFixture([0, 1, 2, 1]);
    try {
      await assert.rejects(fixture.print(), error => error === fixture.sentinel);
      assert.deepEqual(
        fixture.renders.map(render => render.source),
        [0, 1, 2, 1],
      );
      assert.equal(fixture.peak(), 1, "two auxiliary sources share the same one-reader sheet");
      for (const source of [0, 1, 2]) {
        const draw = fixture.events.indexOf(`draw:${source}`);
        const cleanup = fixture.events.indexOf(`cleanup:${source}`);
        assert.ok(draw >= 0 && cleanup > draw, "page use remains held through sheet draw");
      }
      assert.ok(fixture.events.indexOf("cleanup:0") < fixture.events.indexOf("getPage:1"));
      assert.ok(fixture.events.indexOf("cleanup:2") < fixture.events.lastIndexOf("getPage:1"));
      assert.ok(fixture.events.indexOf("cleanup:2") < fixture.events.lastIndexOf("dispose:2"));
      assert.ok(fixture.events.lastIndexOf("dispose:2") < fixture.events.lastIndexOf("open:1"));
      const printConfigs = fixture.configs.filter(config => config.intent === "print");
      assert.deepEqual(
        printConfigs.map(config => config.source),
        [0, 1, 2, 1],
      );
      assert.notEqual(
        printConfigs[1]!.value,
        printConfigs[3]!.value,
        "reopened source needs its own config",
      );
      assert.deepEqual(fixture.visibility, [[0, "baseLayer", false, true]]);
      for (const [index, { source, parameters }] of fixture.renders.entries()) {
        assert.equal(parameters.intent, "print");
        assert.equal(parameters.annotationMode, 3);
        assert.equal(await parameters.optionalContentConfigPromise, printConfigs[index]!.value);
        assert.notEqual(
          await parameters.optionalContentConfigPromise,
          fixture.configs.find(config => config.source === source && config.intent !== "print")
            ?.value,
          "Display configuration must not be reused for Print",
        );
        if (source === 0)
          assert.equal(parameters.printAnnotationStorage, fixture.formStorageSnapshot);
        else assert.equal(Object.hasOwn(parameters, "printAnnotationStorage"), false);
      }
      const release = fixture.events.indexOf("snapshot:release");
      assert.ok(release > fixture.events.lastIndexOf("draw:1"));
      assert.ok(release < fixture.events.indexOf("dom"));
      assert.equal(fixture.events.filter(event => event === "snapshot:release").length, 1);
      assert.equal(fixture.releaseCalls(), 1, "post-raster release and finally are idempotent");
      await assert.rejects(fixture.snapshot.acquire(1));
      assert.equal(fixture.events.filter(event => event === "encode").length, 2);
      assert.equal(fixture.events.filter(event => event === "url:revoke").length, 2);
      assert.equal(fixture.events.filter(event => event === "exclusive:release").length, 1);
      assert.equal(fixture.owner.state.phase, "idle");
    } finally {
      await fixture.close();
    }
    assert.equal(fixture.live(), 0);
  },
);

test("canonical printing tolerates sub-1e-4 drift but still rejects stale geometry", async () => {
  for (const drift of [0.00005, 0.0002]) {
    const fixture = await sourcePrintFixture([0], {
      geometry: () => ({ width: 595.28 + drift, height: 841.89, userUnit: 1 }),
    });
    try {
      if (drift < 1e-4) {
        await assert.rejects(fixture.print(), error => error === fixture.sentinel);
        assert.equal(fixture.renders.length, 1);
      } else {
        assert.deepEqual(await fixture.print(), { ok: false, reason: "cancelled" });
        assert.equal(fixture.renders.length, 0);
      }
    } finally {
      await fixture.close();
    }
  }
});

test("replacement printing preserves the geometry tolerance accepted by source admission", async () => {
  const fixture = await sourcePrintFixture([0, 1], {
    geometry: source => ({
      width: 595.28 + (source ? 0.00005 : 0),
      height: 841.89,
      userUnit: 1 + (source ? 0.0000005 : 0),
    }),
  });
  try {
    await assert.rejects(fixture.print(), error => error === fixture.sentinel);
    assert.deepEqual(
      fixture.renders.map(render => render.source),
      [0, 1],
    );
    assert.equal(fixture.releaseCalls(), 1);
  } finally {
    await fixture.close();
  }
  assert.equal(fixture.live(), 0);
});

test("source Print configuration and render failures release page, snapshot, and raster resources", async () => {
  for (const phase of ["config", "render"] as const) {
    const failure = new Error(`${phase} failure`);
    const fixture = await sourcePrintFixture([1], {
      [phase]: async () => {
        throw failure;
      },
    });
    try {
      await assert.rejects(fixture.print(), error => error === failure);
      assert.ok(fixture.events.includes("cleanup:1"));
      assert.ok(fixture.events.indexOf("cleanup:1") < fixture.events.indexOf("snapshot:release"));
      assert.ok(
        fixture.events.indexOf("snapshot:release") < fixture.events.indexOf("exclusive:release"),
      );
      assert.equal(
        fixture.releaseCalls(),
        1,
        "finally releases snapshots on failure before raster completion",
      );
      assert.equal(fixture.events.includes("draw:1"), false);
      assert.equal(fixture.events.includes("dom"), false);
      assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
      await assert.rejects(fixture.snapshot.acquire(1));
      assert.equal(fixture.owner.state.phase, "idle");
    } finally {
      await fixture.close();
    }
    assert.equal(fixture.live(), 0);
  }
});

test("internal abort revokes snapshot immediately but holds physical render use until settlement", async () => {
  const entered = deferred<void>();
  const render = deferred<void>();
  const fixture = await sourcePrintFixture([1, 2], {
    render: () => {
      entered.resolve();
      return render.promise;
    },
  });
  const pending = fixture.print();
  try {
    await entered.promise;
    fixture.owner.cancel();
    fixture.owner.cancel();
    assert.equal(fixture.releaseCalls(), 1, "internal abort invokes release once synchronously");
    await assert.rejects(fixture.snapshot.acquire(2));
    assert.ok(fixture.events.includes("snapshot:release"));
    assert.ok(fixture.events.includes("cancel:1"));
    assert.equal(fixture.events.includes("cleanup:1"), false);
    assert.equal(fixture.events.includes("exclusive:release"), false);
    assert.equal(fixture.live(), 1, "revocation cannot dispose an actively rendering PDF");
    let closed = false;
    const closing = fixture.pool.close().then(() => {
      closed = true;
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false, "pool close waits for physical render settlement");
    render.reject(new Error("physical render cancellation settled"));
    assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
    await closing;
    assert.ok(fixture.events.indexOf("snapshot:release") < fixture.events.indexOf("cleanup:1"));
    assert.ok(fixture.events.indexOf("cleanup:1") < fixture.events.indexOf("dispose:1"));
    assert.equal(fixture.renders.length, 1, "no next page can start after cancellation");
    assert.equal(fixture.events.includes("draw:1"), false);
    assert.equal(fixture.events.includes("dom"), false);
    assert.equal(fixture.releaseCalls(), 1, "finally must not repeat the callback after abort");
    assert.equal(fixture.owner.state.phase, "idle");
  } finally {
    render.resolve();
    await pending;
    await fixture.close();
  }
  assert.equal(fixture.live(), 0);
});

test("abort during getPage keeps admitted source alive until the late page is released", async () => {
  const entered = deferred<void>();
  const page = deferred<void>();
  const fixture = await sourcePrintFixture([1], {
    getPage: () => {
      entered.resolve();
      return page.promise;
    },
  });
  const pending = fixture.print();
  try {
    await entered.promise;
    fixture.owner.reset();
    assert.equal(fixture.releaseCalls(), 1);
    assert.equal(fixture.live(), 1);
    assert.equal(fixture.events.includes("cleanup:1"), false);
    assert.equal(fixture.events.includes("exclusive:release"), false);
    let closed = false;
    const closing = fixture.pool.close().then(() => {
      closed = true;
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    page.resolve();
    assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
    await closing;
    assert.ok(fixture.events.indexOf("snapshot:release") < fixture.events.indexOf("cleanup:1"));
    assert.ok(fixture.events.indexOf("cleanup:1") < fixture.events.indexOf("dispose:1"));
    assert.equal(fixture.renders.length, 0);
    assert.equal(fixture.releaseCalls(), 1);
    assert.equal(fixture.owner.state.phase, "idle");
  } finally {
    page.resolve();
    await pending;
    await fixture.close();
  }
  assert.equal(fixture.live(), 0);
});
