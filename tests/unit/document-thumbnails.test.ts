// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentThumbnails } from "../../src/document-thumbnails.js";
import { RasterWorkCoordinator } from "../../src/raster-work-coordinator.js";
import type { PdfjsViewerRenderingProfileSettings } from "../../src/viewer-contracts.js";
import { installTestPlatform } from "./test-platform.js";

class Classes {
  #values = new Set<string>();
  add(value: string): void {
    this.#values.add(value);
  }
  remove(value: string): void {
    this.#values.delete(value);
  }
}

class Element extends EventTarget {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = new Classes();
  children: Element[] = [];
  parent: Element | null = null;
  scrollTop = 0;
  clientHeight = 400;
  textContent = "";
  type = "";
  title = "";
  readonly attributes = new Map<string, string>();
  append(...children: Element[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: Element[]): void {
    this.children = [];
    this.append(...children);
  }
  replaceWith(replacement: Element): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children[index] = replacement;
    replacement.parent = this.parent;
    this.parent = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  getBoundingClientRect(): DOMRect {
    const width = this.className === "pdf-thumbnail-canvas" ? 100 : 200;
    const height = this.className === "pdf-thumbnail-canvas" ? 120 : 400;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON() {},
    };
  }
}

class Canvas extends Element {
  width = 0;
  height = 0;
  readonly context = {
    imageSmoothingEnabled: false,
    setTransform() {},
  };
  getContext(): typeof this.context {
    return this.context;
  }
}

const profile: PdfjsViewerRenderingProfileSettings = {
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

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

for (const diagnostics of [false, true]) {
  test(`thumbnail render timing is ${diagnostics ? "reported separately and logger failures are isolated" : "disabled without a logger"}`, async t => {
    const platform = installTestPlatform(
      tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
      { IntersectionObserver: undefined, ResizeObserver: undefined },
    );
    try {
      let clock = 0;
      const now = t.mock.method(performance, "now", () => (clock += 10));
      const entries: Array<{ event: string; details: Readonly<Record<string, unknown>> }> = [];
      const page = {
        rotate: 0,
        getViewport: ({ scale }: { scale: number }) => ({
          width: 100 * scale,
          height: 120 * scale,
        }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
      } as unknown as import("pdfjs-dist").PDFPageProxy;
      const coordinator = new RasterWorkCoordinator();
      coordinator.setViewActive(true);
      const container = new Element();
      const thumbnails = new DocumentThumbnails(
        {
          scrollContainer: container as unknown as HTMLElement,
          coordinator,
          maxDpr: 2,
          pageLabel: pageNo => `Page ${pageNo}`,
          errorLabel: "Error",
          scrollBehavior: () => "auto",
        },
        profile,
        {
          selectPage() {},
          diagnostic: diagnostics
            ? entry => {
                entries.push(entry);
                throw new Error("consumer logger failure");
              }
            : undefined,
        },
      );
      thumbnails.beginDocument({ acquire: async () => ({ page, release() {} }) }, 1, {
        width: 100,
        height: 120,
      });
      thumbnails.setViewActive(true);
      await settle();
      assert.ok(container.children[0].children[0].hasAttribute("data-pdf-thumbnail-ready"));
      if (diagnostics) {
        assert.equal(entries.length, 1);
        assert.equal(entries[0].event, "thumbnail-render-completed");
        assert.deepEqual(entries[0].details, {
          pageNo: 1,
          elapsedMs: 40,
          pageAcquisitionMs: 10,
          renderTaskMs: 10,
          commitMs: 10,
        });
      } else {
        assert.equal(now.mock.callCount(), 0);
        assert.deepEqual(entries, []);
      }
      await Promise.all(thumbnails.resetDocument());
    } finally {
      platform.restore();
    }
  });
}

test("thumbnail revisions preserve ready pixels and lazily refresh with explicit display configuration", async () => {
  const platform = installTestPlatform(
    tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
    { IntersectionObserver: undefined, ResizeObserver: undefined },
  );
  try {
    const params: Array<Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]> = [];
    const printSnapshots: object[] = [];
    const printAnnotationStorageFor = (_pageNo: number, revision: number) => {
      const snapshot = { revision };
      printSnapshots.push(snapshot);
      return snapshot as unknown as Parameters<
        import("pdfjs-dist").PDFPageProxy["render"]
      >[0]["printAnnotationStorage"];
    };
    const optionalContentConfigPromise = Promise.resolve({} as never);
    const page = {
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 120 * scale }),
      render: (renderParams: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]) => {
        params.push(renderParams);
        return { promise: Promise.resolve(), cancel() {} };
      },
    } as unknown as import("pdfjs-dist").PDFPageProxy;
    const pages = { acquire: async () => ({ page, release() {} }) };
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const thumbnails = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: pageNo => `Page ${pageNo}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      profile,
      { selectPage() {} },
    );
    thumbnails.setRasterState({
      optionalContentRevision: 1,
      formAppearanceRevision: 1,
      annotationMode: 23,
      formAppearanceRevisionFor: () => 1,
      printAnnotationStorageFor,
      optionalContentConfigPromise,
    });
    thumbnails.beginDocument(pages, 1, { width: 100, height: 120 });
    thumbnails.setViewActive(true);
    await settle();
    assert.equal(params.length, 1);
    assert.equal(params[0].intent, "display");
    assert.equal(params[0].annotationMode, 23);
    assert.equal(params[0].optionalContentConfigPromise, optionalContentConfigPromise);
    assert.equal(params[0].printAnnotationStorage, printSnapshots[0]);
    assert.equal(
      printSnapshots.length,
      1,
      "one frozen storage snapshot is created per admitted job",
    );
    const list = container.children[0];
    const item = list.children[0];
    const firstCanvas = item.children[0].children[0] as Canvas;
    assert.ok(firstCanvas.width > 0);

    assert.equal(
      thumbnails.setRasterState({
        optionalContentRevision: 1,
        formAppearanceRevision: 1,
        annotationMode: 23,
        formAppearanceRevisionFor: () => 1,
        printAnnotationStorageFor,
        optionalContentConfigPromise: Promise.resolve({} as never),
      }),
      false,
    );
    await settle();
    assert.equal(params.length, 1, "equivalent thumbnail identity reuses ready output");

    thumbnails.setRasterState({
      optionalContentRevision: 2,
      formAppearanceRevision: 3,
      annotationMode: 23,
      formAppearanceRevisionFor: () => 3,
      printAnnotationStorageFor,
      optionalContentConfigPromise,
    });
    assert.ok(
      firstCanvas.width > 0,
      "non-satisfying ready canvas remains attached during lazy refresh",
    );
    await settle();
    assert.equal(params.length, 2);
    assert.equal(params[1].optionalContentConfigPromise, optionalContentConfigPromise);
    assert.equal(params[1].printAnnotationStorage, printSnapshots[1]);
    assert.equal(printSnapshots.length, 2);
    assert.notEqual(item.children[0].children[0], firstCanvas);
    thumbnails.destroy();
  } finally {
    platform.restore();
  }
});

test("refreshes ready thumbnail aria text in place without scheduling raster work", async () => {
  const platform = installTestPlatform(
    tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
    { IntersectionObserver: undefined, ResizeObserver: undefined },
  );
  try {
    let renders = 0;
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const thumbnails = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: page => `Page ${page}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      profile,
      { selectPage() {} },
    );
    const page = {
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 120 * scale }),
      render: () => {
        renders++;
        return { promise: Promise.resolve(), cancel() {} };
      },
    } as unknown as import("pdfjs-dist").PDFPageProxy;
    thumbnails.beginDocument({ acquire: async () => ({ page, release() {} }) }, 1, {
      width: 100,
      height: 120,
    });
    thumbnails.setViewActive(true);
    await settle();
    const item = container.children[0]!.children[0]!;
    const button = item.children[0]!;
    const canvas = button.children[0]!;
    thumbnails.setUiText(pageNo => `Thumbnail ${pageNo}`, "Broken");
    assert.equal(button.attributes.get("aria-label"), "Thumbnail 1");
    assert.equal(button.children[0], canvas);
    assert.equal(renders, 1);
    thumbnails.destroy();
  } finally {
    platform.restore();
  }
});

test("form appearance revisions invalidate only affected thumbnail pages", async () => {
  const platform = installTestPlatform(
    tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
    { IntersectionObserver: undefined, ResizeObserver: undefined },
  );
  try {
    const revisions = new Map([
      [1, 0],
      [2, 0],
    ]);
    const renderedPages: number[] = [];
    const pages = {
      acquire: async (pageNo: number) => ({
        page: {
          rotate: 0,
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 120 * scale,
          }),
          render: () => {
            renderedPages.push(pageNo);
            return { promise: Promise.resolve(), cancel() {} };
          },
        } as unknown as import("pdfjs-dist").PDFPageProxy,
        release() {},
      }),
    };
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const thumbnails = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: pageNo => `Page ${pageNo}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      profile,
      { selectPage() {} },
    );
    thumbnails.setRasterState({
      optionalContentRevision: 0,
      formAppearanceRevision: 0,
      formAppearanceRevisionFor: pageNo => revisions.get(pageNo) ?? 0,
      annotationMode: 3,
    });
    thumbnails.beginDocument(pages, 2, { width: 100, height: 120 });
    thumbnails.setViewActive(true);
    await settle();
    assert.deepEqual(renderedPages, [1, 2]);
    const list = container.children[0];
    const unaffectedCanvas = list.children[1].children[0].children[0];

    revisions.set(1, 1);
    thumbnails.invalidateFormPages([1]);
    await settle();
    assert.deepEqual(renderedPages, [1, 2, 1]);
    assert.equal(list.children[1].children[0].children[0], unaffectedCanvas);
    thumbnails.destroy();
  } finally {
    platform.restore();
  }
});

test("selective OCG changes retain unrelated thumbnail work and cached canvases across races", async () => {
  const platform = installTestPlatform(
    tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
    { IntersectionObserver: undefined, ResizeObserver: undefined },
  );
  try {
    let resolveFirst!: () => void;
    const first = new Promise<void>(resolve => {
      resolveFirst = resolve;
    });
    let resolveReplacement!: () => void;
    const replacement = new Promise<void>(resolve => {
      resolveReplacement = resolve;
    });
    const renders: number[] = [];
    const configs: unknown[] = [];
    const cancelled: number[] = [];
    const pages = {
      acquire: async (pageNo: number) => ({
        page: {
          rotate: 0,
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 120 * scale,
          }),
          render: (params: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]) => {
            renders.push(pageNo);
            configs.push(params.optionalContentConfigPromise);
            return {
              promise:
                renders.length === 1 ? first : renders.length > 2 ? replacement : Promise.resolve(),
              cancel: () => {
                cancelled.push(pageNo);
              },
            };
          },
        } as unknown as import("pdfjs-dist").PDFPageProxy,
        release() {},
      }),
    };
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const thumbnails = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: pageNo => `Page ${pageNo}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      profile,
      { selectPage() {} },
    );
    thumbnails.beginDocument(pages, 2, { width: 100, height: 120 });
    thumbnails.setViewActive(true);
    await settle();
    assert.deepEqual(renders, [1]);
    const latest = Promise.resolve({} as never);
    thumbnails.setRasterState(
      {
        optionalContentRevision: 1,
        formAppearanceRevision: 0,
        annotationMode: 1,
        optionalContentConfigPromise: latest,
      },
      new Set([2]),
    );
    assert.deepEqual(cancelled, []);
    resolveFirst();
    await settle();
    await settle();
    assert.deepEqual(renders, [1, 2]);
    assert.equal(configs[1], latest);
    const list = container.children[0];
    const firstCanvas = list.children[0].children[0].children[0] as Canvas;
    const secondCanvas = list.children[1].children[0].children[0] as Canvas;
    assert.ok(firstCanvas.width > 0 && secondCanvas.width > 0);
    thumbnails.setRasterState(
      { optionalContentRevision: 2, formAppearanceRevision: 0, annotationMode: 1 },
      new Set([2]),
    );
    await settle();
    assert.deepEqual(renders, [1, 2, 2]);
    assert.equal(
      list.children[1].children[0].children[0],
      secondCanvas,
      "old bitmap retained during replacement",
    );
    const newest = Promise.resolve({} as never);
    thumbnails.setRasterState(
      {
        optionalContentRevision: 3,
        formAppearanceRevision: 0,
        annotationMode: 1,
        optionalContentConfigPromise: newest,
      },
      new Set([2]),
    );
    resolveReplacement();
    await settle();
    await settle();
    assert.deepEqual(cancelled, [2]);
    assert.deepEqual(renders, [1, 2, 2, 2]);
    assert.equal(configs[3], newest);
    assert.equal(list.children[0].children[0].children[0], firstCanvas);
    assert.notEqual(list.children[1].children[0].children[0], secondCanvas);
    thumbnails.destroy();
  } finally {
    platform.restore();
  }
});

for (const invalidation of ["changed page", "global"] as const) {
  test(`content-only visible repaint retains an offscreen writer until ${invalidation} invalidation`, async () => {
    const platform = installTestPlatform(
      tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
      {
        IntersectionObserver: undefined,
        ResizeObserver: undefined,
        requestAnimationFrame: () => 1,
      },
    );
    let thumbnails: DocumentThumbnails | undefined;
    let finish!: () => void;
    const physical = new Promise<void>(resolve => {
      finish = resolve;
    });
    try {
      const renders: number[] = [];
      const cancelled: number[] = [];
      const coordinator = new RasterWorkCoordinator();
      coordinator.setViewActive(true);
      const container = new Element();
      thumbnails = new DocumentThumbnails(
        {
          scrollContainer: container as unknown as HTMLElement,
          coordinator,
          maxDpr: 2,
          pageLabel: pageNo => `Page ${pageNo}`,
          errorLabel: "Error",
          scrollBehavior: () => "auto",
        },
        profile,
        { selectPage() {} },
      );
      thumbnails.beginDocument(
        {
          acquire: async (pageNo: number) => ({
            page: {
              rotate: 0,
              getViewport: ({ scale }: { scale: number }) => ({
                width: 100 * scale,
                height: 120 * scale,
              }),
              render: () => {
                renders.push(pageNo);
                return {
                  promise: renders.length === 2 ? physical : Promise.resolve(),
                  cancel: () => cancelled.push(pageNo),
                };
              },
            } as unknown as import("pdfjs-dist").PDFPageProxy,
            release() {},
          }),
        },
        5,
        { width: 100, height: 120 },
      );
      const list = container.children[0];
      for (const [index, item] of list.children.entries()) {
        item.getBoundingClientRect = () => {
          const top = [20, 500, 2000, 3000, 4000][index];
          return { ...container.getBoundingClientRect(), top, bottom: top + 120, height: 120 };
        };
      }
      thumbnails.setViewActive(true);
      await settle();
      assert.deepEqual(renders, [1, 2]);
      const oldVisibleCanvas = list.children[0].children[0].children[0];
      thumbnails.setRasterState(
        { optionalContentRevision: 1, formAppearanceRevision: 0, annotationMode: 1 },
        new Set([1, 5]),
      );
      thumbnails.notifyAdmissionChanged();
      await settle();
      assert.deepEqual(
        cancelled,
        [],
        "new missing visible work from content alone must not preempt",
      );
      assert.deepEqual(renders, [1, 2], "retained writer is not restarted");
      assert.equal(list.children[0].children[0].children[0], oldVisibleCanvas);
      thumbnails.setRasterState(
        { optionalContentRevision: 2, formAppearanceRevision: 0, annotationMode: 1 },
        invalidation === "changed page" ? new Set([2]) : undefined,
      );
      assert.deepEqual(cancelled, [2], "content retention cannot protect invalid pixels");
      assert.deepEqual(renders, [1, 2]);
      finish();
      await settle();
      await settle();
      assert.deepEqual(renders.slice(0, 4), [1, 2, 1, 2]);
      assert.equal(renders.includes(5), false, "affected offscreen page 5 stays lazy");
      assert.deepEqual(cancelled, [2]);
      await Promise.all(thumbnails.resetDocument());
      assert.equal(coordinator.canStartBackground, true);
    } finally {
      thumbnails?.destroy();
      finish();
      await settle();
      platform.restore();
    }
  });
}

for (const boundary of [
  "scroll",
  "fallback scroll",
  "visible intersection",
  "near intersection",
  "resize",
  "page geometry",
  "reopening",
] as const) {
  for (const position of ["just offscreen", "ahead of motion"] as const) {
    test(`retained thumbnail yields to ${boundary} demand ${position} only after physical settlement`, async t => {
      const intersections: IntersectionObserverCallback[] = [];
      let resize!: ResizeObserverCallback;
      class Intersection {
        constructor(callback: IntersectionObserverCallback) {
          intersections.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      }
      class Resize {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      const platform = installTestPlatform(
        tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
        {
          IntersectionObserver:
            boundary === "fallback scroll"
              ? undefined
              : (Intersection as unknown as typeof IntersectionObserver),
          ResizeObserver: Resize as unknown as typeof ResizeObserver,
          // Demand delivery and physical settlement are controlled, not timed.
          requestAnimationFrame: () => 1,
          cancelAnimationFrame() {},
          setTimeout: (() => 1) as unknown as typeof setTimeout,
          clearTimeout() {},
        },
      );
      let thumbnails: DocumentThumbnails | undefined;
      let finish!: () => void;
      const physical = new Promise<void>(resolve => {
        finish = resolve;
      });
      try {
        const renders: number[] = [];
        const cancelled: number[] = [];
        const released: number[] = [];
        const configs: unknown[] = [];
        const canvases: HTMLCanvasElement[] = [];
        const committed: number[] = [];
        const writerPage = position === "ahead of motion" ? 2 : 1;
        const visiblePage = writerPage === 1 ? 2 : 1;
        const coordinator = new RasterWorkCoordinator();
        coordinator.setViewActive(true);
        const acquire = t.mock.method(coordinator, "acquireBackground");
        const container = new Element();
        container.scrollTop = 100;
        thumbnails = new DocumentThumbnails(
          {
            scrollContainer: container as unknown as HTMLElement,
            coordinator,
            maxDpr: 2,
            pageLabel: pageNo => `Page ${pageNo}`,
            errorLabel: "Error",
            scrollBehavior: () => "auto",
          },
          profile,
          { selectPage() {}, diagnostic: entry => committed.push(Number(entry.details.pageNo)) },
        );
        thumbnails.beginDocument(
          {
            acquire: async (pageNo: number) => ({
              page: {
                rotate: 0,
                getViewport: ({ scale }: { scale: number }) => ({
                  width: 100 * scale,
                  height: 120 * scale,
                }),
                render: (params: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]) => {
                  renders.push(pageNo);
                  configs.push(params.optionalContentConfigPromise);
                  canvases.push(params.canvas!);
                  return {
                    promise: renders.length === 1 ? physical : Promise.resolve(),
                    cancel: () => cancelled.push(pageNo),
                  };
                },
              } as unknown as import("pdfjs-dist").PDFPageProxy,
              release: () => released.push(pageNo),
            }),
          },
          2,
          { width: 100, height: 120 },
        );
        const list = container.children[0];
        let moved = false;
        const initialTops = writerPage === 1 ? [20, 500] : [-500, 20];
        const demandTops = writerPage === 1 ? [-130, 20] : [20, 410];
        for (const [index, item] of list.children.entries()) {
          item.getBoundingClientRect = () => {
            const top = (moved ? demandTops : initialTops)[index];
            return { ...container.getBoundingClientRect(), top, bottom: top + 120, height: 120 };
          };
        }
        thumbnails.setViewActive(true);
        await settle();
        assert.deepEqual(renders, [writerPage]);
        const writer = canvases[0];
        const placeholder = list.children[writerPage - 1].children[0].children[0];
        const latest = Promise.resolve({} as never);
        thumbnails.setRasterState(
          {
            optionalContentRevision: 1,
            formAppearanceRevision: 0,
            annotationMode: 1,
            optionalContentConfigPromise: latest,
          },
          new Set([visiblePage]),
        );
        thumbnails.notifyAdmissionChanged();
        await settle();
        assert.deepEqual(cancelled, [], "content-only reconciliation retains the writer");
        assert.deepEqual(renders, [writerPage]);
        moved = true;
        const deliver = () => {
          if (boundary === "scroll" || boundary === "fallback scroll") {
            container.scrollTop += 10;
            container.dispatchEvent(new Event("scroll"));
          } else if (boundary === "reopening") {
            thumbnails!.setViewActive(false);
            thumbnails!.setViewActive(true);
          } else if (boundary === "page geometry") {
            thumbnails!.observePageGeometry(visiblePage, 100, 121);
          } else if (boundary === "resize") {
            resize(
              [
                {
                  target: list.children[visiblePage - 1].children[0].children[0],
                } as unknown as ResizeObserverEntry,
              ],
              {} as ResizeObserver,
            );
          } else {
            const callback = intersections[boundary === "near intersection" ? 0 : 1];
            callback(
              list.children.map(
                (target, index) =>
                  ({
                    target,
                    isIntersecting: index + 1 === visiblePage,
                  }) as unknown as IntersectionObserverEntry,
              ),
              {} as IntersectionObserver,
            );
          }
        };
        deliver();
        await settle();
        assert.deepEqual(cancelled, [writerPage], "new viewport demand revokes retained authority");
        deliver();
        thumbnails.notifyAdmissionChanged();
        await settle();
        assert.deepEqual(cancelled, [writerPage], "repeated demand does not cancel twice");
        assert.deepEqual(renders, [writerPage], "successor cannot overlap the physical writer");
        assert.deepEqual(released, [], "page use remains leased until settlement");
        assert.equal(acquire.mock.callCount(), 1, "background slot is still owned");
        assert.equal(coordinator.canStartBackground, false);
        assert.ok(writer.width > 0 && writer.height > 0, "active canvas must not be cleared early");
        assert.equal(list.children[writerPage - 1].children[0].children[0], placeholder);
        assert.deepEqual(committed, []);
        // Even a successful late completion has lost commit authority.
        finish();
        await settle();
        await settle();
        assert.equal(renders[1], visiblePage, "visible page wins the next physical slot");
        assert.equal(configs[1], latest);
        assert.equal(writer.width, 0);
        assert.equal(writer.height, 0);
        assert.notEqual(canvases[1], writer);
        assert.equal(committed[0], visiblePage, "stale writer did not commit");
        assert.deepEqual(cancelled, [writerPage]);
        await Promise.all(thumbnails.resetDocument());
        assert.equal(released.length, renders.length, "every acquired page use is released");
        assert.equal(coordinator.canStartBackground, true, "no background lease leaked");
      } finally {
        thumbnails?.destroy();
        finish();
        await settle();
        platform.restore();
      }
    });
  }
}

test("selective OCG invalidation remains lazy while the thumbnail panel is closed", async () => {
  const platform = installTestPlatform(
    tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
    { IntersectionObserver: undefined, ResizeObserver: undefined },
  );
  try {
    const rendered: number[] = [];
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const thumbnails = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: pageNo => `Page ${pageNo}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      profile,
      { selectPage() {} },
    );
    thumbnails.beginDocument(
      {
        acquire: async (pageNo: number) => ({
          page: {
            rotate: 0,
            getViewport: ({ scale }: { scale: number }) => ({
              width: 100 * scale,
              height: 120 * scale,
            }),
            render: () => {
              rendered.push(pageNo);
              return { promise: Promise.resolve(), cancel() {} };
            },
          } as unknown as import("pdfjs-dist").PDFPageProxy,
          release() {},
        }),
      },
      2,
      { width: 100, height: 120 },
    );
    thumbnails.setViewActive(true);
    await settle();
    const list = container.children[0];
    const unaffected = list.children[0].children[0].children[0];
    const affected = list.children[1].children[0].children[0];
    thumbnails.setViewActive(false);
    thumbnails.setRasterState(
      { optionalContentRevision: 1, formAppearanceRevision: 0, annotationMode: 1 },
      new Set([2]),
    );
    await settle();
    assert.deepEqual(rendered, [1, 2]);
    assert.equal(list.children[1].children[0].children[0], affected);
    thumbnails.setViewActive(true);
    await settle();
    assert.deepEqual(rendered, [1, 2, 2]);
    assert.equal(list.children[0].children[0].children[0], unaffected);
    thumbnails.destroy();
  } finally {
    platform.restore();
  }
});
