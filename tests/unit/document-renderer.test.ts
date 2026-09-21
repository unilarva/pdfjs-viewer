// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  DocumentRenderer,
  settleIndependentPresentations,
  type RenderSurfaceLease,
  type RenderSurfaceRegistry,
  type RenderViewSnapshot,
} from "../../src/document-renderer.js";
import type { PdfjsViewerRenderingProfileSettings } from "../../src/viewer-contracts.js";
import { installTestPlatform } from "./test-platform.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeContext {
  imageSmoothingEnabled = false;
  drawCount = 0;
  drawImageSourceSizes: Array<{ width: number; height: number }> = [];
  transforms: number[][] = [];
  setTransform(...values: number[]): void {
    this.transforms.push(values);
  }
  clearRect(): void {}
  drawImage(source: { width: number; height: number }): void {
    this.drawCount++;
    this.drawImageSourceSizes.push({ width: source.width, height: source.height });
  }
}

class FakeCanvas {
  readonly ownerDocument = globalThis.document;
  width = 0;
  height = 0;
  isConnected = true;
  style: Record<string, string> = {};
  readonly context = new FakeContext();
  getContext(): FakeContext {
    return this.context;
  }
}

class FakeStyle {
  [name: string]: unknown;
  #properties = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.#properties.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.#properties.get(name) ?? "";
  }
}

class FakeWrapper {
  readonly ownerDocument = globalThis.document;
  isConnected = true;
  style = new FakeStyle();
  dataset: Record<string, string> = {};
  querySelector(): null {
    return null;
  }
}

class Surfaces implements RenderSurfaceRegistry {
  #epochs = new Map<number, number>();
  #leases = new Map<number, Readonly<RenderSurfaceLease>>();
  register(
    pageNo: number,
    canvas = new FakeCanvas(),
    wrapper = new FakeWrapper(),
  ): Readonly<RenderSurfaceLease> {
    const registrationEpoch = (this.#epochs.get(pageNo) ?? 0) + 1;
    this.#epochs.set(pageNo, registrationEpoch);
    const lease = Object.freeze({
      pageNo,
      canvas: canvas as unknown as HTMLCanvasElement,
      wrapper: wrapper as unknown as HTMLDivElement,
      registrationEpoch,
    });
    this.#leases.set(pageNo, lease);
    return lease;
  }
  leaseFor(pageNo: number): Readonly<RenderSurfaceLease> | null {
    return this.#leases.get(pageNo) ?? null;
  }
  isCurrent(lease: Readonly<RenderSurfaceLease>): boolean {
    return (
      this.#leases.get(lease.pageNo) === lease &&
      lease.canvas.isConnected &&
      lease.wrapper.isConnected
    );
  }
}

const settings: PdfjsViewerRenderingProfileSettings = {
  memoryLimitMiB: 32,
  thumbnailMemoryLimitMiB: 16,
  maxCanvasPixels: 24_000_000,
  maxCanvasDimension: 8192,
  maxConcurrentRenders: 2,
  maxBufferViewportHeights: 0,
  maxBufferPages: 0,
  bufferViewportHeightsWhenInactive: 0,
  maxRenderDpr: 4,
  minRenderDpr: 0.5,
  allowDprReduction: true,
  allowVisibleDirectRendering: true,
  memoryHysteresis: 0,
  print: {
    maxSheets: 350,
    maxAnnotationCanvasBytesPerPage: 32 * 1024 * 1024,
    estimatedEncodedBytesPerPixel: 0.5,
    encodingOverheadRatio: 1,
    safetyMarginRatio: 0.15,
    maxXfaPages: 350,
    maxXfaNodes: 500_000,
    maxXfaImages: 10_000,
    maxConcurrentImageDecodes: 4,
  },
};

function view(dpr = 1, scale = 1): RenderViewSnapshot {
  return {
    topologyRevision: 1,
    pageGeometryRevision: 1,
    rows: [[1]],
    rowBounds: [{ top: 0, bottom: 120 * scale }],
    viewport: { top: 0, height: 120 * scale },
    visibleRange: { first: 0, last: 0, center: 0 },
    motion: "stationary",
    scale,
    rotation: 0,
    devicePixelRatio: dpr,
    pageBaseSizes: new Map([[1, { width: 100, height: 120 }]]),
    fallbackPageSize: { width: 100, height: 120 },
  };
}

function page(
  renderCount: { value: number },
  taskFactory: () => Deferred<void> | null = () => null,
  options: {
    scaleFactor?: number;
    userUnit?: number;
    rotation?: number;
    cleanup?: { value: number };
    width?: number;
    height?: number;
    renderParams?: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]>;
    annotationCanvasSize?: Readonly<{ width: number; height: number }>;
    annotationCanvasFactory?: (renderCount: number) => HTMLCanvasElement;
  } = {},
) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: (options.width ?? 100) * scale,
      height: (options.height ?? 120) * scale,
      scale: scale * (options.scaleFactor ?? 1),
      userUnit: options.userUnit ?? 1,
      rotation: options.rotation ?? 0,
    }),
    render: (params: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]) => {
      renderCount.value++;
      options.renderParams?.push(params);
      if (
        (options.annotationCanvasSize || options.annotationCanvasFactory) &&
        params.annotationCanvasMap
      ) {
        const canvas =
          options.annotationCanvasFactory?.(renderCount.value) ??
          (new FakeCanvas() as unknown as HTMLCanvasElement);
        if (options.annotationCanvasSize) {
          canvas.width = options.annotationCanvasSize.width;
          canvas.height = options.annotationCanvasSize.height;
        }
        params.annotationCanvasMap.set(
          `annotation-${renderCount.value}`,
          canvas as unknown as HTMLCanvasElement,
        );
      }
      const pending = taskFactory();
      return {
        promise: pending?.promise ?? Promise.resolve(),
        cancel: () => pending?.reject(new Error("cancelled")),
      };
    },
    cleanup: () => {
      if (options.cleanup) options.cleanup.value++;
    },
  } as unknown as import("pdfjs-dist").PDFPageProxy;
}

function pdf(fakePage: import("pdfjs-dist").PDFPageProxy, getCount: { value: number }) {
  return {
    getPage: async () => {
      getCount.value++;
      return fakePage;
    },
  } as unknown as import("pdfjs-dist").PDFDocumentProxy;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function withFakeDocument(run: () => Promise<void>): Promise<void> {
  const platform = installTestPlatform(() => new FakeCanvas() as unknown as Element);
  try {
    await run();
  } finally {
    platform.restore();
  }
}

test("independent presentation starts text while annotation never settles", async () => {
  const annotation = deferred<void>();
  let textStarted = false;
  const settlement = settleIndependentPresentations(
    () => annotation.promise,
    () => {
      textStarted = true;
    },
  );
  await Promise.resolve();
  assert.equal(textStarted, true);
  annotation.resolve();
  await settlement;
});

test("unchanged layout revisions reuse detached topology and geometry", () => {
  const renderer = new DocumentRenderer(new Surfaces(), "test", settings);
  let topologyCopies = 0;
  let geometryCopies = 0;
  const rows = {
    length: 1,
    map(callback: (row: readonly number[]) => readonly number[]) {
      topologyCopies++;
      return [[[1]][0]].map(callback);
    },
  } as unknown as readonly (readonly number[])[];
  const sizes = {
    *[Symbol.iterator]() {
      geometryCopies++;
      yield [1, { width: 100, height: 120 }] as const;
    },
  } as ReadonlyMap<number, Readonly<{ width: number; height: number }>>;
  const snapshot: RenderViewSnapshot = {
    topologyRevision: 1,
    pageGeometryRevision: 1,
    rows,
    rowBounds: [{ top: 0, bottom: 120 }],
    viewport: { top: 0, height: 120 },
    visibleRange: { first: 0, last: 0, center: 0 },
    motion: "stationary",
    scale: 1,
    rotation: 0,
    devicePixelRatio: 1,
    pageBaseSizes: sizes,
    fallbackPageSize: { width: 100, height: 120 },
  };
  renderer.reconcile(snapshot);
  renderer.reconcile({ ...snapshot, devicePixelRatio: 2 });
  assert.equal(topologyCopies, 1);
  assert.equal(geometryCopies, 1);
  renderer.reconcile({ ...snapshot, topologyRevision: 2 });
  assert.equal(topologyCopies, 2);
  assert.equal(geometryCopies, 1, "topology invalidation does not recopy geometry");
});

test("reuses equal and higher-quality output and upgrades lower quality once", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const renders = { value: 0 };
    const gets = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(pdf(page(renders), gets));

    renderer.reconcile(view(2));
    await settle();
    assert.equal(renders.value, 1);
    assert.equal(renderer.snapshot().renderedPageCount, 1);

    renderer.reconcile(view(2));
    renderer.reconcile(view(1));
    await settle();
    assert.equal(renders.value, 1, "equivalent and lower requirements reuse output");

    renderer.reconcile(view(3));
    await settle();
    assert.equal(renders.value, 2, "higher requirement schedules one upgrade");
    assert.equal(gets.value, 2);
  });
});

test("raster revisions reuse equivalent output and give direct and temporary renders exact semantic params", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const renders = { value: 0 };
    const params: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    const presented: Array<import("../../src/document-renderer.js").RenderPresentationContext> = [];
    const optionalContentConfigPromise = Promise.resolve({} as never);
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: context => {
        presented.push(
          context as import("../../src/document-renderer.js").RenderPresentationContext,
        );
      },
    });
    renderer.setRasterState({
      optionalContentRevision: 1,
      annotationMode: 17,
      optionalContentConfigPromise,
    });
    renderer.beginDocument(
      pdf(
        page(renders, () => null, { renderParams: params }),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();

    assert.equal(
      renderer.setRasterState({
        optionalContentRevision: 1,
        annotationMode: 17,
        optionalContentConfigPromise: Promise.resolve({} as never),
      }),
      false,
    );
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    assert.equal(renders.value, 1, "equivalent identity reuses committed output");

    renderer.setRasterState({
      optionalContentRevision: 2,
      annotationMode: 17,
      optionalContentConfigPromise,
    });
    await settle();
    assert.equal(renders.value, 2, "changed revision refreshes retained pixels through staging");
    assert.equal(params[0].intent, "display");
    assert.equal(params[1].intent, "display");
    assert.equal(params[0].annotationMode, 17);
    assert.equal(params[1].annotationMode, 17);
    assert.equal(params[0].optionalContentConfigPromise, optionalContentConfigPromise);
    assert.equal(params[1].optionalContentConfigPromise, optionalContentConfigPromise);
    assert.ok(params[0].annotationCanvasMap instanceof Map);
    assert.ok(params[1].annotationCanvasMap instanceof Map);
    assert.notEqual(params[0].annotationCanvasMap, params[1].annotationCanvasMap);
    assert.equal(presented[0].annotationCanvasMap, params[0].annotationCanvasMap);
    assert.equal(presented.at(-1)?.annotationCanvasMap, params[1].annotationCanvasMap);
    assert.equal(presented.at(-1)?.rasterState.optionalContentRevision, 2);
  });
});

test("accounts and releases exact annotation canvas owners through placeholder replacement and reset", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const renders = { value: 0 };
    const params: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(
      pdf(
        page(renders, () => null, {
          renderParams: params,
          annotationCanvasSize: { width: 10, height: 20 },
        }),
        { value: 0 },
      ),
    );
    renderer.reconcile(view());
    await settle();

    const first = [...params[0].annotationCanvasMap!.values()][0]!;
    assert.equal(renderer.snapshot().committedAnnotationCanvasBytes, 800);
    assert.equal(renderer.snapshot().committedBytes, 48_800);

    const suspension = renderer.suspendAdmission();
    renderer.setRasterState({ optionalContentRevision: 1, annotationMode: 1 });
    assert.equal(renderer.snapshot().placeholderAnnotationCanvasBytes, 800);
    renderer.resumeAdmission(suspension.token);
    await settle();

    assert.equal(first.width, 0);
    assert.equal(first.height, 0);
    const second = [...params[1].annotationCanvasMap!.values()][0]!;
    assert.equal(renderer.snapshot().annotationCanvasBytes, 800);
    renderer.resetDocument();
    assert.equal(second.width, 0);
    assert.equal(second.height, 0);
    assert.equal(renderer.snapshot().annotationCanvasBytes, 0);
  });
});

test("rejects optional post-render annotation overage and releases its exact canvas", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    surfaces.register(2);
    const overbudget = new FakeCanvas();
    overbudget.width = 600;
    overbudget.height = 600;
    const diagnostics: Array<{ event: string; details: Readonly<Record<string, unknown>> }> = [];
    const renderer = new DocumentRenderer(
      surfaces,
      "test",
      {
        ...settings,
        memoryLimitMiB: 1,
        maxConcurrentRenders: 1,
        maxBufferViewportHeights: 2,
        maxBufferPages: 1,
      },
      { diagnostic: value => diagnostics.push(value) },
    );
    const ordinary = page({ value: 0 });
    const annotated = page({ value: 0 }, () => null, {
      annotationCanvasFactory: () => overbudget as unknown as HTMLCanvasElement,
    });
    renderer.beginDocument({
      getPage: async (pageNo: number) => (pageNo === 1 ? ordinary : annotated),
    } as never);
    renderer.reconcile({
      ...view(),
      rows: [[1], [2]],
      rowBounds: [
        { top: 0, bottom: 120 },
        { top: 120, bottom: 240 },
      ],
      pageBaseSizes: new Map([
        [1, { width: 100, height: 120 }],
        [2, { width: 100, height: 120 }],
      ]),
    });
    await settle();
    await settle();
    assert.equal(renderer.snapshot().renderedPageCount, 1);
    assert.equal(overbudget.width, 0);
    assert.equal(overbudget.height, 0);
    assert.ok(
      diagnostics.some(
        value =>
          value.event === "annotation-canvas-admission-rejected" &&
          value.details.mandatoryVisibleOutput === false,
      ),
    );
  });
});

test("preserves mandatory visible output and diagnoses observed annotation overage", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const diagnostics: Array<{ event: string; details: Readonly<Record<string, unknown>> }> = [];
    const renderer = new DocumentRenderer(
      surfaces,
      "test",
      { ...settings, memoryLimitMiB: 1 },
      {
        diagnostic: value => diagnostics.push(value),
      },
    );
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, { annotationCanvasSize: { width: 600, height: 600 } }),
        { value: 0 },
      ),
    );
    renderer.reconcile(view());
    await settle();
    assert.equal(renderer.snapshot().renderedPageCount, 1);
    assert.ok(renderer.snapshot().committedAnnotationCanvasBytes > 1_000_000);
    assert.ok(
      diagnostics.some(
        value =>
          value.event === "annotation-canvas-mandatory-overage" &&
          value.details.mandatoryVisibleOutput === true,
      ),
    );
  });
});

test("retains replaced annotation canvases through presentation settlement and accounts them separately", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const presentation = deferred<void>();
    const params: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    let presentations = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async () => {
        presentations++;
        if (presentations === 1) await presentation.promise;
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, {
          renderParams: params,
          annotationCanvasSize: { width: 10, height: 20 },
        }),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    const first = [...params[0].annotationCanvasMap!.values()][0]!;

    renderer.setRasterState({ optionalContentRevision: 1, annotationMode: 1 });
    await settle();
    const second = [...params[1].annotationCanvasMap!.values()][0]!;
    const replacing = renderer.snapshot();
    assert.equal(replacing.committedAnnotationCanvasBytes, 800);
    assert.equal(replacing.settlingAnnotationCanvasBytes, 800);
    assert.equal(replacing.annotationCanvasBytes, 1_600);
    assert.equal(first.width, 10, "active presentation retains the replaced backing store");

    presentation.resolve();
    await settle();
    assert.equal(first.width, 0);
    assert.equal(renderer.snapshot().settlingAnnotationCanvasBytes, 0);
    renderer.resetDocument();
    assert.equal(second.width, 0);
  });
});

test("shared annotation backing stores are counted once and zeroed by the final exact owner", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const presentation = deferred<void>();
    const shared = new FakeCanvas();
    shared.width = 10;
    shared.height = 20;
    let presentations = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async () => {
        presentations++;
        if (presentations === 1) await presentation.promise;
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, {
          annotationCanvasFactory: () => shared as unknown as HTMLCanvasElement,
        }),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    renderer.setRasterState({ optionalContentRevision: 1, annotationMode: 1 });
    await settle();

    assert.equal(renderer.snapshot().annotationCanvasBytes, 800);
    assert.equal(shared.width, 10);
    presentation.resolve();
    await settle();
    assert.equal(
      shared.width,
      10,
      "replacement output remains an owner after old presentation settles",
    );
    renderer.resetDocument();
    assert.equal(shared.width, 0);
    assert.equal(shared.height, 0);
  });
});

test("changed raster revision rejects a stale direct commit and retries in the new scope", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const first = deferred<void>();
    const renders = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(
      pdf(
        page(renders, () => (renders.value === 1 ? first : null)),
        { value: 0 },
      ),
    );
    renderer.reconcile(view());
    await settle();
    assert.equal(renders.value, 1);

    renderer.setRasterState({ optionalContentRevision: 1, annotationMode: 1 });
    first.resolve();
    await settle();
    assert.equal(renders.value, 2);
    assert.equal(renderer.snapshot().renderedPageCount, 1);
  });
});

test("renderer suspension captures direct-render physical settlement and preserves committed output", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const physical = deferred<void>();
    let cancels = 0;
    const fakePage = {
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({
        width: 100 * scale,
        height: 120 * scale,
        scale,
        rotation: 0,
      }),
      render: () => ({
        promise: physical.promise,
        cancel: () => {
          cancels++;
        },
      }),
      cleanup: () => {},
    } as unknown as import("pdfjs-dist").PDFPageProxy;
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(pdf(fakePage, { value: 0 }));
    renderer.reconcile(view());
    await settle();
    const suspension = renderer.suspendAdmission();
    let drained = false;
    void suspension.settlement.then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert.equal(cancels, 1);
    assert.equal(drained, false);
    physical.resolve();
    await suspension.settlement;
    assert.equal(drained, true);
    renderer.resumeAdmission(suspension.token);
    await settle();
  });
});

test("reset retains active direct-render annotation canvases until physical settlement", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const physical = deferred<void>();
    const annotation = new FakeCanvas();
    annotation.width = 10;
    annotation.height = 20;
    const fakePage = {
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({
        width: 100 * scale,
        height: 120 * scale,
        scale,
        rotation: 0,
      }),
      render: (params: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]) => {
        params.annotationCanvasMap?.set("active", annotation as unknown as HTMLCanvasElement);
        return { promise: physical.promise, cancel() {} };
      },
      cleanup() {},
    } as unknown as import("pdfjs-dist").PDFPageProxy;
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(pdf(fakePage, { value: 0 }));
    renderer.reconcile(view());
    await settle();

    const settlements = renderer.resetDocument();
    assert.equal(annotation.width, 10);
    assert.equal(renderer.snapshot().settlingAnnotationCanvasBytes, 800);
    physical.resolve();
    await Promise.all(settlements);
    assert.equal(annotation.width, 0);
    assert.equal(annotation.height, 0);
    assert.equal(renderer.snapshot().annotationCanvasBytes, 0);
  });
});

test("viewer suspension survives document replacement and resumes the replacement once", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const oldRenders = { value: 0 };
    const replacementRenders = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(pdf(page(oldRenders), { value: 0 }));
    const suspension = renderer.suspendAdmission();
    renderer.reconcile(view());
    assert.equal(oldRenders.value, 0);

    renderer.beginDocument(pdf(page(replacementRenders), { value: 0 }));
    renderer.reconcile(view());
    await settle();
    assert.equal(replacementRenders.value, 0, "replacement remains excluded");

    renderer.resumeAdmission(suspension.token);
    renderer.resumeAdmission(suspension.token);
    await settle();
    assert.equal(replacementRenders.value, 1, "exact token resumes current document once");
  });
});

test("replacement rejects late attached-task completion and balances resources", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const lease = surfaces.register(1);
    const oldTask = deferred<void>();
    const oldRenders = { value: 0 };
    const newRenders = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(
      pdf(
        page(oldRenders, () => oldTask),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    assert.equal(oldRenders.value, 1, "old PDF.js task attached");

    renderer.beginDocument(pdf(page(newRenders), { value: 0 }));
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    oldTask.resolve();
    await settle();
    assert.equal(newRenders.value, 1);
    assert.equal(renderer.snapshot().renderedPageCount, 1);
    assert.equal(renderer.snapshot().admittedRenderCount, 0);
    assert.equal(renderer.snapshot().reservationBytes, 0);
    assert.ok(lease.canvas.width > 0 && lease.canvas.height > 0);
  });
});

test("preserving reflow rebinds exact output while replacement registration rejects it", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const original = surfaces.register(1);
    const renders = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(pdf(page(renders), { value: 0 }));
    renderer.reconcile(view());
    await settle();

    renderer.beginSurfaceReflow({ preserveCommittedOutput: true });
    original.canvas.style.width = "37%";
    original.canvas.style.height = "41%";
    surfaces.register(
      1,
      original.canvas as unknown as FakeCanvas,
      original.wrapper as unknown as FakeWrapper,
    );
    renderer.endSurfaceReflow(view());
    await settle();
    assert.equal(renders.value, 1, "exact preserved bitmap is rebound without repaint");
    assert.equal(original.canvas.style.width, "100px");
    assert.equal(original.canvas.style.height, "120px");

    renderer.beginSurfaceReflow({ preserveCommittedOutput: true });
    surfaces.register(1);
    renderer.endSurfaceReflow(view());
    await settle();
    assert.equal(renders.value, 2, "replacement surface receives fresh output");
  });
});

test("zoom placeholders remain occupied but never satisfy the new plan", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const lease = surfaces.register(1);
    const renders = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(pdf(page(renders), { value: 0 }));
    renderer.reconcile(view(1, 1));
    await settle();
    const committedBytes = renderer.snapshot().committedBytes;

    renderer.invalidateView({ retainPlaceholders: true, graceMs: 10_000 });
    assert.equal(renderer.snapshot().placeholderBytes, committedBytes);
    assert.equal(renderer.snapshot().renderedPageCount, 0);
    assert.equal(lease.canvas.style.width, "100%");
    assert.equal(lease.canvas.style.height, "100%");
    renderer.reconcile(view(1, 1.5));
    await settle();
    assert.equal(renders.value, 2, "placeholder cannot satisfy current progress");
    assert.equal(
      renderer.snapshot().placeholderPageCount,
      0,
      "replacement removes placeholder accounting",
    );
    renderer.resetDocument();
  });
});

test("selected required placeholders survive grace until replacement commit", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const renders = { value: 0 };
    const replacement = deferred<void>();
    let renderAttempt = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      retainPlaceholder: pageNo => pageNo === 1,
    });
    renderer.beginDocument(
      pdf(
        page(renders, () => (++renderAttempt === 2 ? replacement : null)),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(1, 1));
    await settle();

    renderer.invalidateView({ retainPlaceholders: true, graceMs: 1 });
    renderer.reconcile(view(1, 1.5));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(renderer.snapshot().placeholderPageCount, 1);

    replacement.resolve();
    await settle();
    assert.equal(renderer.snapshot().placeholderPageCount, 0);
    assert.equal(renderer.snapshot().renderedPageCount, 1);
    renderer.resetDocument();
  });
});

test("initial readiness is exactly once per renderer document", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const ready: number[] = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      ready: documentId => ready.push(documentId),
    });
    const fakePdf = pdf(page({ value: 0 }), { value: 0 });
    renderer.beginDocument(fakePdf);
    renderer.reconcile(view());
    await settle();
    renderer.reconcile(view());
    await settle();
    assert.equal(ready.length, 1);

    renderer.beginDocument(fakePdf);
    renderer.reconcile(view());
    await settle();
    assert.equal(ready.length, 2);
    assert.notEqual(ready[0], ready[1]);
  });
});

test("publishes exact PDF.js page scale, user-unit, and rotation geometry", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const lease = surfaces.register(1);
    lease.canvas.style.width = "175.125px";
    lease.canvas.style.height = "210.25px";
    lease.wrapper.style.width = "175.125px";
    lease.wrapper.style.height = "210.25px";
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, { scaleFactor: 1, userUnit: 2.5, rotation: -90 }),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(1, 1.75));
    await settle();

    const wrapper = lease.wrapper as unknown as FakeWrapper;
    assert.equal(wrapper.style.getPropertyValue("--scale-factor"), "1.75");
    assert.equal(wrapper.style.getPropertyValue("--user-unit"), "2.5");
    assert.equal(
      wrapper.style.getPropertyValue("--total-scale-factor"),
      "calc(var(--scale-factor) * var(--user-unit))",
    );
    assert.equal(wrapper.style.getPropertyValue("--scale-round-x"), "1px");
    assert.equal(wrapper.style.getPropertyValue("--scale-round-y"), "1px");
    assert.equal(wrapper.dataset.mainRotation, "270");
    assert.equal(lease.canvas.style.width, "175px");
    assert.equal(lease.canvas.style.height, "210px");
    assert.equal(lease.wrapper.style.width, "175.125px");
    assert.equal(lease.wrapper.style.height, "210.25px");
  });
});

test("fractional viewport geometry is resolved once at one uniform render DPR", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const lease = surfaces.register(1);
    lease.wrapper.style.width = "467.962088072px";
    lease.wrapper.style.height = "664.0000189239998px";
    const renderParams: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    const starts: Array<Record<string, unknown>> = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      diagnostic: entry => {
        if (entry.event === "page-render-started") starts.push({ ...entry.details });
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, {
          width: 467.962088072,
          height: 664.0000189239998,
          renderParams,
        }),
        { value: 0 },
      ),
    );
    renderer.reconcile({
      ...view(),
      rowBounds: [{ top: 0, bottom: 664.0000189239998 }],
      viewport: { top: 0, height: 664.0000189239998 },
      pageBaseSizes: new Map([[1, { width: 467.962088072, height: 664.0000189239998 }]]),
      fallbackPageSize: { width: 467.962088072, height: 664.0000189239998 },
    });
    await settle();

    assert.equal(starts.length, 1);
    assert.equal(starts[0]!.cssWidth, 467.962088072);
    assert.equal(starts[0]!.cssHeight, 664.0000189239998);
    assert.equal(starts[0]!.requestedDpr, 1);
    assert.equal(starts[0]!.renderDpr, 1);
    assert.equal(starts[0]!.bufferWidth, 468);
    assert.equal(starts[0]!.bufferHeight, 664);
    assert.equal(lease.canvas.style.width, "468px");
    assert.equal(lease.canvas.style.height, "664px");
    assert.equal(lease.wrapper.style.width, "467.962088072px");
    assert.equal(lease.wrapper.style.height, "664.0000189239998px");
    const context = renderParams[0]!.canvasContext as unknown as FakeContext;
    assert.deepEqual(context.transforms[0], [1, 0, 0, 1, 0, 0]);
    const attached = (lease.canvas as unknown as FakeCanvas).context;
    assert.deepEqual(attached.transforms, [[1, 0, 0, 1, 0, 0]]);
    assert.equal(attached.imageSmoothingEnabled, false);
    assert.deepEqual(attached.drawImageSourceSizes, [{ width: 468, height: 664 }]);
  });
});

test("direct rendering uses the same uniform render DPR geometry", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const lease = surfaces.register(1);
    const renderParams: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, { width: 2000.2, height: 1599.8, renderParams }),
        { value: 0 },
      ),
    );
    renderer.reconcile({
      ...view(1.25),
      rowBounds: [{ top: 0, bottom: 1599.8 }],
      viewport: { top: 0, height: 1599.8 },
      pageBaseSizes: new Map([[1, { width: 2000.2, height: 1599.8 }]]),
      fallbackPageSize: { width: 2000.2, height: 1599.8 },
    });
    await settle();

    const canvas = lease.canvas as unknown as FakeCanvas;
    assert.equal(
      renderParams[0]!.canvasContext,
      canvas.context as unknown as CanvasRenderingContext2D,
    );
    assert.deepEqual(canvas.context.transforms, [[1.25, 0, 0, 1.25, 0, 0]]);
    assert.equal(canvas.context.imageSmoothingEnabled, true);
    assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 2501, height: 2000 });
  });
});

test("canvas-constrained temporary and direct renders retain one uniform transform", async () => {
  await withFakeDocument(async () => {
    const render = async (memoryLimitMiB: number) => {
      const surfaces = new Surfaces();
      const lease = surfaces.register(1);
      const renderParams: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
      const renderer = new DocumentRenderer(surfaces, "test", {
        ...settings,
        memoryLimitMiB,
        maxCanvasPixels: 10_000_000,
        allowDprReduction: false,
      });
      renderer.beginDocument(
        pdf(
          page({ value: 0 }, () => null, { width: 5000, height: 5000, renderParams }),
          { value: 0 },
        ),
      );
      renderer.reconcile({
        ...view(),
        rowBounds: [{ top: 0, bottom: 5000 }],
        viewport: { top: 0, height: 5000 },
        pageBaseSizes: new Map([[1, { width: 5000, height: 5000 }]]),
        fallbackPageSize: { width: 5000, height: 5000 },
      });
      await settle();
      return { lease, renderParams };
    };

    const temporary = await render(128);
    const direct = await render(32);
    const temporaryContext = temporary.renderParams[0]!.canvasContext as unknown as FakeContext;
    const directCanvas = direct.lease.canvas as unknown as FakeCanvas;
    const renderDpr = 3162 / 5000;
    assert.deepEqual(temporaryContext.transforms, [[renderDpr, 0, 0, renderDpr, 0, 0]]);
    assert.deepEqual(directCanvas.context.transforms, [[renderDpr, 0, 0, renderDpr, 0, 0]]);
    assert.deepEqual(
      { width: directCanvas.width, height: directCanvas.height },
      { width: 3162, height: 3162 },
    );
  });
});

test("reentrant geometry observation prevents stale-plan rendering", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const renderParams: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    let renderer!: DocumentRenderer;
    let reconciled = false;
    renderer = new DocumentRenderer(surfaces, "test", settings, {
      observedPageGeometry: () => {
        if (reconciled) return;
        reconciled = true;
        renderer.reconcile({
          ...view(2),
          pageGeometryRevision: 2,
          pageBaseSizes: new Map([[1, { width: 100, height: 120 }]]),
        });
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, { width: 100, height: 120, renderParams }),
        { value: 0 },
      ),
    );
    renderer.reconcile({
      ...view(),
      pageBaseSizes: new Map([[1, { width: 90, height: 110 }]]),
      fallbackPageSize: { width: 90, height: 110 },
    });
    await settle();

    assert.equal(reconciled, true);
    assert.equal(renderParams.length, 1);
    const context = renderParams[0]!.canvasContext as unknown as FakeContext;
    assert.deepEqual(context.transforms, [[2, 0, 0, 2, 0, 0]]);
  });
});

test("presentation is page-backed, releases raster admission, and owns cleanup", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const lease = surfaces.register(1);
    lease.canvas.style.width = "100.5px";
    lease.canvas.style.height = "120.75px";
    lease.wrapper.style.width = "100.5px";
    lease.wrapper.style.height = "120.75px";
    const cleanup = { value: 0 };
    const presentation = deferred<void>();
    let presentedPage: import("pdfjs-dist").PDFPageProxy | null = null;
    const fakePage = page({ value: 0 }, () => null, { cleanup });
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: context => {
        presentedPage = context.page;
        return presentation.promise;
      },
    });
    renderer.beginDocument(pdf(fakePage, { value: 0 }));
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();

    assert.equal(presentedPage, fakePage);
    assert.equal(renderer.snapshot().admittedRenderCount, 0);
    assert.equal(cleanup.value, 0, "cleanup waits for presentation");
    assert.equal(lease.canvas.style.width, "100px");
    assert.equal(lease.canvas.style.height, "120px");
    assert.equal(lease.wrapper.style.width, "100.5px");
    assert.equal(lease.wrapper.style.height, "120.75px");
    const settlements = renderer.resetDocument();
    assert.equal(settlements.length, 1);
    presentation.resolve();
    await Promise.all(settlements);
    assert.equal(cleanup.value, 1);
  });
});

test("compatible text demand does not stale delayed annotations or reacquire the page", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const cleanup = { value: 0 };
    const annotations = deferred<void>();
    const capabilities: Array<{ annotations: boolean; text: boolean }> = [];
    let annotationStillCurrent = false;
    let maximumActive = 0;
    let active = 0;
    const gets = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async context => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        capabilities.push({ ...context.capabilities });
        if (context.capabilities.annotations) {
          await annotations.promise;
          annotationStillCurrent = context.isCurrent("annotations");
        }
        active--;
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, { cleanup }),
        gets,
      ),
    );
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    renderer.reconcile(view(), { annotations: true, textPages: [1] });
    await settle();
    assert.equal(cleanup.value, 0, "one use spans compatible capability passes");
    annotations.resolve();
    await settle();
    assert.equal(annotationStillCurrent, true);
    assert.equal(maximumActive, 1);
    assert.deepEqual(capabilities, [
      { annotations: true, text: false },
      { annotations: false, text: true },
    ]);
    assert.equal(gets.value, 1, "raster transfer supplies the complete presentation lane");
    assert.equal(cleanup.value, 1);
  });
});

test("renewed text demand is not covered by stale active text work", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const blocked = deferred<void>();
    const gets = { value: 0 };
    const cleanup = { value: 0 };
    const currentAfterRelease: boolean[] = [];
    let active = 0;
    let maximumActive = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async context => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        if (!currentAfterRelease.length) await blocked.promise;
        currentAfterRelease.push(context.isCurrent("text"));
        active--;
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => null, { cleanup }),
        gets,
      ),
    );
    renderer.reconcile(view(), { annotations: false, textPages: [1] });
    await settle();
    renderer.reconcile(view(), { annotations: false, textPages: [] });
    renderer.reconcile(view(), { annotations: false, textPages: [1] });
    await settle();
    blocked.resolve();
    await settle();
    assert.deepEqual(currentAfterRelease, [false, true]);
    assert.equal(maximumActive, 1);
    assert.equal(
      gets.value,
      2,
      "renewal adds no acquisition beyond concurrent raster and text uses",
    );
    assert.equal(cleanup.value, 1, "shared proxy cleanup waits for both concurrent uses");
  });
});

test("document replacement reacquires presentation pages after the old lane settles", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const blocked = deferred<void>();
    const oldPage = page({ value: 0 });
    const newPage = page({ value: 0 });
    const presented: import("pdfjs-dist").PDFPageProxy[] = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async context => {
        presented.push(context.page);
        if (context.page === oldPage) await blocked.promise;
      },
    });
    renderer.beginDocument(pdf(oldPage, { value: 0 }));
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    renderer.beginDocument(pdf(newPage, { value: 0 }));
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    blocked.resolve();
    await settle();
    assert.deepEqual(presented, [oldPage, newPage]);
  });
});

test("presentation failure releases its page use and leaves the lane retryable", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const cleanup = { value: 0 };
    const gets = { value: 0 };
    let attempts = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: () => {
        attempts++;
        if (attempts === 1) throw new Error("injected presentation failure");
      },
    });
    renderer.beginDocument(pdf(page(cleanup), gets));
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await settle();
    assert.equal(cleanup.value, 1);

    renderer.reconcile(view(1, 2), { annotations: true, textPages: [] });
    await settle();
    assert.equal(attempts, 2);
    assert.equal(gets.value, 2);
    assert.equal(cleanup.value, 2);
  });
});

test("stale active capabilities do not cover a compatible newer pending target", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const firstPresentation = deferred<void>();
    const secondRender = deferred<void>();
    let renderAttempt = 0;
    const presented: Array<{ scale: number; annotations: boolean; text: boolean }> = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async context => {
        presented.push({ scale: context.viewport.scale, ...context.capabilities });
        if (presented.length === 1) await firstPresentation.promise;
      },
    });
    renderer.beginDocument(
      pdf(
        page({ value: 0 }, () => (++renderAttempt === 2 ? secondRender : null)),
        { value: 0 },
      ),
    );
    renderer.reconcile(view(1, 1), { annotations: true, textPages: [] });
    await settle();
    renderer.reconcile(view(1, 2), { annotations: true, textPages: [1] });
    await settle();
    secondRender.resolve();
    await settle();
    firstPresentation.resolve();
    await settle();
    assert.deepEqual(presented, [
      { scale: 1, annotations: true, text: false },
      { scale: 2, annotations: true, text: true },
    ]);
  });
});

test("same-page presentation is single-flight and keeps only the latest replacement", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const first = deferred<void>();
    const scales: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async context => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        scales.push(context.viewport.scale);
        if (scales.length === 1) await first.promise;
        active--;
      },
    });
    renderer.beginDocument(pdf(page({ value: 0 }), { value: 0 }));
    renderer.reconcile(view(1, 1), { annotations: true, textPages: [] });
    await settle();
    renderer.reconcile(view(1, 2), { annotations: true, textPages: [] });
    await settle();
    renderer.reconcile(view(1, 3), { annotations: true, textPages: [] });
    await settle();
    first.resolve();
    await settle();
    assert.equal(maximumActive, 1);
    assert.deepEqual(scales, [1, 3]);
  });
});

test("text demand presents an adjacent page independently from raster planning", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const textLease = surfaces.register(2);
    textLease.wrapper.style.width = "100px";
    textLease.wrapper.style.height = "120px";
    const presented: Array<{ pageNo: number; annotations: boolean; text: boolean }> = [];
    const observed: Array<{ pageNo: number; width: number; height: number }> = [];
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: context => {
        presented.push({ pageNo: context.pageNo, ...context.capabilities });
      },
      observedPageGeometry: (pageNo, width, height) => {
        observed.push({ pageNo, width, height });
      },
    });
    const acquisitions: number[] = [];
    const rasterPage = page({ value: 0 });
    const textPage = page({ value: 0 }, () => null, { width: 140, height: 180 });
    renderer.beginDocument({
      getPage: async (pageNo: number) => {
        acquisitions.push(pageNo);
        return pageNo === 2 ? textPage : rasterPage;
      },
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);
    renderer.reconcile(
      {
        topologyRevision: 1,
        pageGeometryRevision: 1,
        rows: [[1], [2]],
        rowBounds: [
          { top: 0, bottom: 120 },
          { top: 120, bottom: 240 },
        ],
        viewport: { top: 0, height: 120 },
        visibleRange: { first: 0, last: 0, center: 0 },
        motion: "stationary",
        scale: 1,
        rotation: 0,
        devicePixelRatio: 1,
        pageBaseSizes: new Map([
          [1, { width: 100, height: 120 }],
          [2, { width: 100, height: 120 }],
        ]),
        fallbackPageSize: { width: 100, height: 120 },
      },
      { annotations: true, textPages: [2] },
    );
    await settle();
    assert.equal(
      acquisitions[0],
      1,
      "visible raster acquisition starts before adjacent text demand",
    );
    assert.ok(presented.some(entry => entry.pageNo === 2 && entry.text && !entry.annotations));
    assert.equal(
      renderer.snapshot().renderedPageCount,
      1,
      "adjacent text demand does not require a page-two bitmap",
    );
    assert.ok(
      observed.some(entry => entry.pageNo === 2 && entry.width === 140 && entry.height === 180),
    );
    assert.equal((textLease.wrapper.style as unknown as FakeStyle).width, "100px");
    assert.equal((textLease.wrapper.style as unknown as FakeStyle).height, "120px");
    acquisitions.length = 0;
    renderer.reconcile(
      {
        topologyRevision: 1,
        pageGeometryRevision: 1,
        rows: [[1], [2]],
        rowBounds: [
          { top: 0, bottom: 240 },
          { top: 240, bottom: 480 },
        ],
        viewport: { top: 0, height: 240 },
        visibleRange: { first: 0, last: 0, center: 0 },
        motion: "stationary",
        scale: 2,
        rotation: 0,
        devicePixelRatio: 1,
        pageBaseSizes: new Map([
          [1, { width: 100, height: 120 }],
          [2, { width: 100, height: 120 }],
        ]),
        fallbackPageSize: { width: 100, height: 120 },
      },
      { annotations: true, textPages: [] },
    );
    await settle();
    assert.deepEqual(
      acquisitions,
      [1],
      "zoom without text work acquires only the visible raster page",
    );
  });
});

test("reset returns settlement for rendering blocked before task attachment", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const acquisition = deferred<import("pdfjs-dist").PDFPageProxy>();
    const fakePdf = {
      getPage: () => acquisition.promise,
    } as unknown as import("pdfjs-dist").PDFDocumentProxy;
    const renderer = new DocumentRenderer(surfaces, "test", settings);
    renderer.beginDocument(fakePdf);
    renderer.reconcile(view());
    await Promise.resolve();
    const settlements = renderer.resetDocument();
    assert.equal(settlements.length, 1);
    let settled = false;
    void settlements[0].then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    acquisition.resolve(page({ value: 0 }));
    await Promise.all(settlements);
    assert.equal(renderer.snapshot().renderedPageCount, 0);
  });
});

test("transient acquisition failure retries without another reconciliation", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const diagnostics: string[] = [];
    const ready: number[] = [];
    const renders = { value: 0 };
    let acquisitions = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      diagnostic: entry => diagnostics.push(entry.event),
      ready: documentId => ready.push(documentId),
    });
    renderer.beginDocument({
      getPage: async () => {
        acquisitions++;
        if (acquisitions === 1) throw new Error("transient acquisition failure");
        return page(renders);
      },
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);

    renderer.reconcile(view());
    await settle();

    assert.equal(acquisitions, 2);
    assert.equal(renders.value, 1);
    assert.equal(ready.length, 1);
    assert.ok(diagnostics.includes("page-render-retry"));
  });
});

test("permanent raster failure is bounded and diagnosed without readiness", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const diagnostics: string[] = [];
    let acquisitions = 0;
    let ready = 0;
    let failed = 0;
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      diagnostic: entry => diagnostics.push(entry.event),
      ready: () => {
        ready++;
      },
      failed: () => {
        failed++;
      },
    });
    renderer.beginDocument({
      getPage: async () => {
        acquisitions++;
        throw new Error("permanent acquisition failure");
      },
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);

    renderer.reconcile(view());
    await settle();
    renderer.reconcile(view());
    await settle();

    assert.equal(acquisitions, 3);
    assert.equal(ready, 0);
    assert.equal(failed, 1);
    assert.equal(diagnostics.filter(event => event === "page-render-retry").length, 2);
    assert.equal(diagnostics.filter(event => event === "page-render-terminal-failure").length, 1);
    assert.equal(renderer.snapshot().admittedRenderCount, 0);
  });
});

test("initial readiness excludes speculative buffered pages", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    surfaces.register(2);
    const buffered = deferred<void>();
    const ready: number[] = [];
    const progress: Array<{ complete: number; total: number; done: boolean }> = [];
    const renderer = new DocumentRenderer(
      surfaces,
      "test",
      {
        ...settings,
        maxBufferViewportHeights: "unlimited",
        maxBufferPages: "unlimited",
      },
      {
        ready: documentId => ready.push(documentId),
        progress: (complete, total, done) => progress.push({ complete, total, done }),
      },
    );
    renderer.beginDocument({
      getPage: async (pageNo: number) => page({ value: 0 }, () => (pageNo === 2 ? buffered : null)),
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);
    renderer.reconcile({
      ...view(),
      rows: [[1], [2]],
      rowBounds: [
        { top: 0, bottom: 120 },
        { top: 120, bottom: 240 },
      ],
      pageBaseSizes: new Map([
        [1, { width: 100, height: 120 }],
        [2, { width: 100, height: 120 }],
      ]),
    });
    await settle();

    assert.equal(ready.length, 1);
    assert.ok(progress.some(entry => entry.complete === 1 && entry.total === 1 && entry.done));
    assert.equal(
      renderer.snapshot().inFlightRenderCount,
      1,
      "buffered page may continue after readiness",
    );
    const settlements = renderer.resetDocument();
    await Promise.all(settlements);
  });
});

test("fast navigation preempts admitted speculative work for the new visible page", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    for (let pageNo = 1; pageNo <= 3; pageNo++) surfaces.register(pageNo);
    const starts: number[] = [];
    const pending = new Map<number, Deferred<void>>();
    const renderer = new DocumentRenderer(
      surfaces,
      "test",
      {
        ...settings,
        maxBufferViewportHeights: "unlimited",
        maxBufferPages: "unlimited",
        maxConcurrentRenders: 2,
      },
      {
        diagnostic: entry => {
          if (entry.event === "page-render-started") starts.push(Number(entry.details.pageNo));
        },
      },
    );
    renderer.beginDocument({
      getPage: async (pageNo: number) =>
        page({ value: 0 }, () => {
          const task = deferred<void>();
          pending.set(pageNo, task);
          return task;
        }),
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);
    const base = {
      ...view(),
      rows: [[1], [2], [3]],
      rowBounds: [
        { top: 0, bottom: 120 },
        { top: 120, bottom: 240 },
        { top: 240, bottom: 360 },
      ],
      pageBaseSizes: new Map([
        [1, { width: 100, height: 120 }],
        [2, { width: 100, height: 120 }],
        [3, { width: 100, height: 120 }],
      ]),
    };
    renderer.reconcile(base);
    await settle();
    assert.deepEqual(starts, [1, 2]);

    renderer.reconcile({
      ...base,
      viewport: { top: 240, height: 120 },
      visibleRange: { first: 2, last: 2, center: 2 },
    });
    await settle();
    assert.equal(starts[2], 3);
    assert.ok(renderer.snapshot().admittedRenderCount <= 2);
    const settlements = renderer.resetDocument();
    await Promise.all(settlements);
  });
});

test("settling temporary memory delays canonical work instead of lowering its DPR", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const oldRender = deferred<void>();
    const renders = { value: 0 };
    const fakePage = page(renders) as unknown as {
      getViewport(input: { scale: number }): import("pdfjs-dist").PageViewport;
      render(): import("pdfjs-dist").RenderTask;
      cleanup(): void;
    };
    fakePage.render = () => {
      renders.value++;
      if (renders.value === 1) {
        return { promise: oldRender.promise, cancel: () => {} } as import("pdfjs-dist").RenderTask;
      }
      return { promise: Promise.resolve(), cancel: () => {} } as import("pdfjs-dist").RenderTask;
    };
    const starts: number[] = [];
    const renderer = new DocumentRenderer(
      surfaces,
      "test",
      {
        ...settings,
        memoryLimitMiB: 3.5,
        maxConcurrentRenders: 2,
      },
      {
        diagnostic: entry => {
          if (entry.event === "page-render-started") starts.push(Number(entry.details.renderDpr));
        },
      },
    );
    renderer.beginDocument({
      getPage: async () => fakePage,
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);

    renderer.reconcile(view(3));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(renders.value, 1);

    renderer.invalidateView({ retainPlaceholders: false, graceMs: 0 });
    renderer.reconcile(view(3, 2));
    await Promise.resolve();
    assert.equal(
      renders.value,
      1,
      "canonical replacement waits while stale temporary memory settles",
    );

    oldRender.reject(new Error("cancelled"));
    await settle();
    assert.equal(renders.value, 2);
    assert.deepEqual(starts, [3, 3]);
  });
});

test("exclusive work evicts all settled canvases and repopulates demand after resume", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    const leases = [1, 2, 3].map(pageNo => surfaces.register(pageNo));
    const renders = { value: 0 };
    const renderer = new DocumentRenderer(surfaces, "test", {
      ...settings,
      maxBufferViewportHeights: 10,
      maxBufferPages: 10,
    });
    renderer.beginDocument({
      getPage: async () => page(renders),
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);
    const snapshot: RenderViewSnapshot = {
      ...view(),
      rows: [[1], [2], [3]],
      rowBounds: [
        { top: 0, bottom: 120 },
        { top: 120, bottom: 240 },
        { top: 240, bottom: 360 },
      ],
      pageBaseSizes: new Map([1, 2, 3].map(pageNo => [pageNo, { width: 100, height: 120 }])),
    };
    renderer.reconcile(snapshot);
    await settle();
    await settle();
    assert.deepEqual(
      leases.map(lease => lease.canvas.width > 0),
      [true, true, true],
    );

    const suspension = renderer.suspendAdmission();
    await suspension.settlement;
    assert.deepEqual(renderer.evictOutputsForExclusiveWork(), { count: 3, bytes: 144_000 });
    assert.equal(renderer.rasterBytesForExclusiveWork(), 0);
    assert.deepEqual(
      leases.map(lease => lease.canvas.width > 0),
      [false, false, false],
    );

    renderer.resumeAdmission(suspension.token);
    await settle();
    assert.deepEqual(
      leases.map(lease => lease.canvas.width > 0),
      [true, true, true],
    );
    await Promise.all(renderer.resetDocument());
  });
});

test("exclusive residual accounting includes annotation canvases retained by an active presentation lane", async () => {
  await withFakeDocument(async () => {
    const surfaces = new Surfaces();
    surfaces.register(1);
    const entered = deferred<void>();
    const releasePresentation = deferred<void>();
    const renderer = new DocumentRenderer(surfaces, "test", settings, {
      present: async () => {
        entered.resolve();
        await releasePresentation.promise;
      },
    });
    const renders = { value: 0 };
    renderer.beginDocument({
      getPage: async () =>
        page(renders, () => null, { annotationCanvasSize: { width: 10, height: 20 } }),
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);
    renderer.reconcile(view(), { annotations: true, textPages: [] });
    await entered.promise;

    const suspension = renderer.suspendAdmission();
    await suspension.settlement;
    renderer.evictOutputsForExclusiveWork();
    assert.equal(renderer.rasterBytesForExclusiveWork(), 800);

    releasePresentation.resolve();
    await settle();
    assert.equal(renderer.rasterBytesForExclusiveWork(), 0);
    renderer.resumeAdmission(suspension.token);
    await Promise.all(renderer.resetDocument());
  });
});
