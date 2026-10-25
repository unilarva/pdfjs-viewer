// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentThumbnails } from "../../src/document-thumbnails.js";
import { RasterWorkCoordinator } from "../../src/raster-work-coordinator.js";
import type { PdfjsViewerRenderingProfileSettings } from "../../src/viewer-contracts.js";
import { installTestPlatform } from "./test-platform.js";
import { SourceFontError, type DocumentFonts } from "../../src/document-fonts.js";
import type { DocumentPageSourceContext, DocumentPageUse } from "../../src/document-page-usage.js";

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
  cloneNode(): Canvas {
    const clone = this.ownerDocument.createElement("canvas") as unknown as Canvas;
    clone.className = this.className;
    clone.dataset = { ...this.dataset };
    clone.style = { ...this.style };
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    clone.width = this.width;
    clone.height = this.height;
    return clone;
  }
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("CSS width replacement fits around visible bitmaps instead of evicting them for prefetch", async () => {
  let width = 120;
  const platform = installTestPlatform(
    tag => {
      const element = tag === "canvas" ? new Canvas() : new Element();
      element.getBoundingClientRect = () => {
        const pageNo = Number(element.dataset.pdfPageNumber) || 1;
        const canvas = element.className === "pdf-thumbnail-canvas";
        const top = (pageNo - 1) * 330;
        const height = canvas ? (width * 792) / 612 : 310;
        return {
          top,
          bottom: top + height,
          left: 0,
          right: canvas ? width : 260,
          width: canvas ? width : 260,
          height,
          x: 0,
          y: top,
          toJSON() {},
        } as DOMRect;
      };
      return element as unknown as HTMLElement;
    },
    { IntersectionObserver: undefined, ResizeObserver: undefined, devicePixelRatio: 2 },
  );
  const firstReplacement = deferred<void>();
  let owner: DocumentThumbnails | undefined;
  try {
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const counts = new Map<number, number>();
    owner = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: pageNo => `Page ${pageNo}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      { ...profile, thumbnailMemoryLimitMiB: 1 },
      { selectPage() {} },
    );
    owner.beginDocument(
      {
        acquire: async pageNo => ({
          page: {
            rotate: 0,
            getViewport: ({ scale }: { scale: number }) => ({
              width: 612 * scale,
              height: 792 * scale,
            }),
            render: () => {
              const count = (counts.get(pageNo) ?? 0) + 1;
              counts.set(pageNo, count);
              return {
                promise: pageNo === 1 && count === 2 ? firstReplacement.promise : Promise.resolve(),
                cancel() {},
              };
            },
          } as unknown as import("pdfjs-dist").PDFPageProxy,
          release() {},
        }),
      },
      3,
      { width: 612, height: 792 },
    );
    owner.setViewActive(true);
    for (let i = 0; i < 4; i++) await settle();
    const oldFirst = thumbnailCanvas(container);
    const oldSecond = thumbnailCanvas(container, 2);
    assert.ok(oldFirst.width > 0 && oldSecond.width > 0);
    width = 220;
    owner.notifyAdmissionChanged();
    await settle();
    assert.equal(thumbnailCanvas(container), oldFirst);
    assert.ok(
      oldFirst.width > 0,
      "current old pixels survive while their larger render is pending",
    );
    assert.ok(
      oldSecond.width > 0,
      "another visible thumbnail is not evicted to reserve full requested DPR",
    );
    firstReplacement.resolve();
    for (let i = 0; i < 5; i++) await settle();
    assert.ok(
      thumbnailCanvas(container).width >= 220,
      "prefetch cannot evict the completed visible replacement",
    );
    assert.ok(thumbnailCanvas(container, 2).width >= 220);
    assert.ok(owner.rasterBytesForExclusiveWork() <= 1024 * 1024);
    assert.deepEqual([...counts.values()], [2, 2, 2]);
  } finally {
    firstReplacement.resolve();
    await Promise.allSettled(owner?.resetDocument() ?? []);
    platform.restore();
  }
});

test("a reduced prefetched thumbnail is promoted when it becomes visible and memory is reclaimable", async () => {
  let scrollTop = 0;
  const platform = installTestPlatform(
    tag => {
      const element = tag === "canvas" ? new Canvas() : new Element();
      element.getBoundingClientRect = () => {
        const top = ((Number(element.dataset.pdfPageNumber) || 1) - 1) * 330 - scrollTop;
        const width = element.className === "pdf-thumbnail-canvas" ? 220 : 260;
        const height = element.className === "pdf-thumbnail-canvas" ? (220 * 792) / 612 : 310;
        return {
          top,
          bottom: top + height,
          left: 0,
          right: width,
          width,
          height,
          x: 0,
          y: top,
          toJSON() {},
        } as DOMRect;
      };
      return element as unknown as HTMLElement;
    },
    { IntersectionObserver: undefined, ResizeObserver: undefined, devicePixelRatio: 2 },
  );
  const upgrade = deferred<void>();
  let owner: DocumentThumbnails | undefined;
  try {
    const coordinator = new RasterWorkCoordinator();
    coordinator.setViewActive(true);
    const container = new Element();
    const counts = new Map<number, number>();
    owner = new DocumentThumbnails(
      {
        scrollContainer: container as unknown as HTMLElement,
        coordinator,
        maxDpr: 2,
        pageLabel: pageNo => `Page ${pageNo}`,
        errorLabel: "Error",
        scrollBehavior: () => "auto",
      },
      { ...profile, thumbnailMemoryLimitMiB: 1 },
      { selectPage() {} },
    );
    owner.beginDocument(
      {
        acquire: async pageNo => ({
          page: {
            rotate: 0,
            getViewport: ({ scale }: { scale: number }) => ({
              width: 612 * scale,
              height: 792 * scale,
            }),
            render: () => {
              const count = (counts.get(pageNo) ?? 0) + 1;
              counts.set(pageNo, count);
              return {
                promise: pageNo === 3 && count === 2 ? upgrade.promise : Promise.resolve(),
                cancel() {},
              };
            },
          } as unknown as import("pdfjs-dist").PDFPageProxy,
          release() {},
        }),
      },
      3,
      { width: 612, height: 792 },
    );
    owner.setViewActive(true);
    for (let i = 0; i < 5; i++) await settle();
    assert.deepEqual([...counts.values()], [1, 1, 1]);
    const prefetched = thumbnailCanvas(container, 3);
    assert.ok(prefetched.width > 0 && prefetched.width < 220);
    scrollTop = 660;
    owner.notifyAdmissionChanged();
    for (let i = 0; i < 3; i++) await settle();
    assert.equal(
      counts.get(3),
      2,
      "revealed cached output is upgraded after offscreen peers become evictable",
    );
    assert.equal(thumbnailCanvas(container, 3), prefetched);
    assert.ok(
      prefetched.width > 0,
      "old pixels remain readable while the quality upgrade is pending",
    );
    upgrade.resolve();
    for (let i = 0; i < 5; i++) await settle();
    assert.ok(thumbnailCanvas(container, 3).width >= 220);
    assert.equal(prefetched.width, 0);
    assert.ok(owner.rasterBytesForExclusiveWork() <= 1024 * 1024);
    const completed = counts.get(3);
    owner.notifyAdmissionChanged();
    for (let i = 0; i < 3; i++) await settle();
    assert.equal(
      counts.get(3),
      completed,
      "unchanged available quality does not trigger repeated renders",
    );
  } finally {
    upgrade.resolve();
    await Promise.allSettled(owner?.resetDocument() ?? []);
    platform.restore();
  }
});

function sourceFixture() {
  const revisions = new Map<number, number>();
  const uses = new Map<number, DocumentPageUse>();
  const params: Array<{
    pageNo: number;
    revision: number;
    input: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0];
  }> = [];
  const releases: number[][] = [];
  return {
    params,
    releases,
    revision: (pageNo: number) => revisions.get(pageNo) ?? 0,
    acquire: async (pageNo: number): Promise<DocumentPageUse> => {
      const use = uses.get(pageNo);
      assert.ok(use);
      return use;
    },
    install(
      pageNo: number,
      options: Partial<DocumentPageSourceContext> = {},
      physical?: Promise<void>,
      cancel: () => void = () => {},
    ) {
      const revision = (revisions.get(pageNo) ?? 0) + 1;
      revisions.set(pageNo, revision);
      const page = {
        rotate: 0,
        getViewport: ({ scale }: { scale: number }) => ({
          width: 100 * scale,
          height: 120 * scale,
        }),
        render: (input: Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]) => {
          params.push({ pageNo, revision, input });
          return { promise: physical ?? Promise.resolve(), cancel };
        },
      } as unknown as import("pdfjs-dist").PDFPageProxy;
      const source: DocumentPageSourceContext = {
        id: `source-${revision}`,
        revision,
        logicalPage: pageNo,
        sourcePage: 1,
        pdf: {} as import("pdfjs-dist").PDFDocumentProxy,
        linkContext: "source",
        isCurrent: () => revisions.get(pageNo) === revision,
        ...options,
      };
      const use = {
        page,
        source,
        release: () => {
          releases.push([pageNo, revision]);
        },
      };
      uses.set(pageNo, use);
      return use;
    },
  };
}

async function withSourceThumbnails(run: () => Promise<void>) {
  const platform = installTestPlatform(
    tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
    { IntersectionObserver: undefined, ResizeObserver: undefined },
  );
  try {
    await run();
  } finally {
    platform.restore();
  }
}

function thumbnailOwner(
  container: Element,
  callbacks: ConstructorParameters<typeof DocumentThumbnails>[2] = { selectPage() {} },
  settings = profile,
) {
  const coordinator = new RasterWorkCoordinator();
  coordinator.setViewActive(true);
  const owner = new DocumentThumbnails(
    {
      scrollContainer: container as unknown as HTMLElement,
      coordinator,
      maxDpr: 1,
      pageLabel: pageNo => `Page ${pageNo}`,
      errorLabel: "Error",
      scrollBehavior: () => "auto",
    },
    settings,
    callbacks,
  );
  return { owner, coordinator };
}

function thumbnailCanvas(container: Element, pageNo = 1): Canvas {
  return container.children[0].children[pageNo - 1].children[0].children[0] as Canvas;
}

for (const active of [true, false]) {
  test(`evicted thumbnail retires its painted host and rerenders with correct resize ownership: active=${active}`, async () => {
    const observed = new Set<unknown>();
    let resize!: ResizeObserverCallback;
    class Observer {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(target: unknown): void {
        observed.add(target);
      }
      unobserve(target: unknown): void {
        observed.delete(target);
      }
      disconnect(): void {
        observed.clear();
      }
    }
    const platform = installTestPlatform(
      tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
      {
        IntersectionObserver: undefined,
        ResizeObserver: Observer as unknown as typeof ResizeObserver,
      },
    );
    let owner: DocumentThumbnails | undefined;
    try {
      const sources = sourceFixture();
      sources.install(1);
      const container = new Element();
      ({ owner } = thumbnailOwner(container));
      owner.beginDocument(sources, 1, { width: 100, height: 120 });
      owner.setViewActive(true);
      await settle();
      const painted = thumbnailCanvas(container);
      const button = painted.parent!;
      const number = button.children[1];
      const geometry = painted.getBoundingClientRect();
      painted.setAttribute("data-consumer-marker", "preserved");
      assert.ok(painted.width > 0 && observed.has(painted));
      const suspension = owner.suspendAdmission();
      await suspension.settlement;
      if (!active) owner.setViewActive(false);
      const bytes = owner.rasterBytesForExclusiveWork();
      assert.deepEqual(owner.evictBackingStoresForExclusiveWork(), { count: 1, bytes });
      const placeholder = thumbnailCanvas(container);
      assert.notEqual(
        placeholder,
        painted,
        "pixel eviction must also retire the painted canvas host",
      );
      assert.equal(painted.parent, null);
      assert.deepEqual(
        [painted.width, painted.height, placeholder.width, placeholder.height],
        [0, 0, 0, 0],
      );
      assert.equal(placeholder.parent, button);
      assert.equal(button.children[1], number);
      assert.equal(placeholder.className, painted.className);
      assert.deepEqual(placeholder.dataset, painted.dataset);
      assert.deepEqual(placeholder.style, painted.style);
      assert.equal(placeholder.attributes.get("data-consumer-marker"), "preserved");
      const nextGeometry = placeholder.getBoundingClientRect();
      assert.deepEqual(
        [nextGeometry.top, nextGeometry.left, nextGeometry.width, nextGeometry.height],
        [geometry.top, geometry.left, geometry.width, geometry.height],
      );
      assert.ok(!observed.has(painted));
      assert.ok(!observed.has(placeholder), "fresh observation waits for the next demand frame");
      owner.setViewActive(active);
      assert.ok(!observed.has(placeholder), "same-frame demand cannot bypass queued observation");
      await settle();
      assert.equal(observed.has(placeholder), active, "inactive canvases must not be re-observed");
      assert.equal(owner.rasterBytesForExclusiveWork(), 0);
      assert.deepEqual(owner.evictBackingStoresForExclusiveWork(), { count: 0, bytes: 0 });
      assert.equal(
        thumbnailCanvas(container),
        placeholder,
        "empty placeholders are not retired again",
      );
      resize([{ target: painted } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      assert.equal(
        thumbnailCanvas(container),
        placeholder,
        "late resize delivery cannot restore the old host",
      );
      if (!active) owner.setViewActive(true);
      owner.resumeAdmission(suspension.token);
      await settle();
      await settle();
      const rerendered = thumbnailCanvas(container);
      assert.notEqual(rerendered, placeholder);
      assert.ok(rerendered.width > 0 && observed.has(rerendered));
      assert.ok(!observed.has(placeholder));
      assert.equal(button.children[1], number);
      assert.equal(sources.params.length, 2);
      assert.equal(sources.releases.length, 2);
      assert.ok(
        owner.rasterBytesForExclusiveWork() <= profile.thumbnailMemoryLimitMiB * 1024 * 1024,
      );
    } finally {
      await Promise.allSettled(owner?.resetDocument() ?? []);
      owner?.destroy();
      platform.restore();
    }
  });
}

for (const boundary of ["reset", "deactivate", "rerender"] as const) {
  test(`deferred thumbnail observation rejects retired canvas identity across ${boundary}`, async () => {
    const observed = new Set<unknown>();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    class Observer {
      observe(target: unknown): void {
        observed.add(target);
      }
      unobserve(target: unknown): void {
        observed.delete(target);
      }
      disconnect(): void {
        observed.clear();
      }
    }
    const platform = installTestPlatform(
      tag => (tag === "canvas" ? new Canvas() : new Element()) as unknown as HTMLElement,
      {
        IntersectionObserver: undefined,
        ResizeObserver: Observer as unknown as typeof ResizeObserver,
        requestAnimationFrame: callback => {
          frames.set(++nextFrame, callback);
          return nextFrame;
        },
        cancelAnimationFrame: id => {
          frames.delete(id);
        },
      },
    );
    let owner: DocumentThumbnails | undefined;
    try {
      const sources = sourceFixture();
      sources.install(1);
      const container = new Element();
      ({ owner } = thumbnailOwner(container));
      owner.beginDocument(sources, 1, { width: 100, height: 120 });
      owner.setViewActive(true);
      await settle();
      for (const [id, callback] of frames) {
        frames.delete(id);
        callback(0);
      }
      const suspension = owner.suspendAdmission();
      await suspension.settlement;
      owner.evictBackingStoresForExclusiveWork();
      const placeholder = thumbnailCanvas(container);
      const lateFrames = [...frames.values()];
      assert.equal(lateFrames.length, 1);
      assert.ok(!observed.has(placeholder));
      if (boundary === "reset") owner.beginDocument(sources, 1, { width: 100, height: 120 });
      else if (boundary === "deactivate") owner.setViewActive(false);
      else {
        owner.resumeAdmission(suspension.token);
        await settle();
        await settle();
        assert.notEqual(thumbnailCanvas(container), placeholder);
        assert.ok(
          !observed.has(thumbnailCanvas(container)),
          "a fast rerender cannot bypass the frame",
        );
      }
      // Deliver even a cancelled old callback to exercise authority guards, not timer luck.
      for (const callback of lateFrames) callback(0);
      assert.ok(!observed.has(placeholder));
      if (boundary === "rerender") assert.ok(observed.has(thumbnailCanvas(container)));
    } finally {
      await Promise.allSettled(owner?.resetDocument() ?? []);
      owner?.destroy();
      platform.restore();
    }
  });
}

test("late thumbnail cleanup cannot retire a successor document's current placeholder", async () => {
  await withSourceThumbnails(async () => {
    const oldSources = sourceFixture();
    oldSources.install(1);
    const container = new Element();
    const { owner, coordinator } = thumbnailOwner(container);
    const physical = deferred<void>();
    try {
      owner.beginDocument(oldSources, 1, { width: 100, height: 120 });
      owner.setViewActive(true);
      await settle();
      const old = thumbnailCanvas(container);
      old.cloneNode = () => assert.fail("stale-item cleanup must not register a retired host");
      oldSources.install(1, {}, physical.promise);
      owner.invalidatePageSources(new Set([1]));
      await settle();
      const temporary = oldSources.params[1].input.canvas!;
      const sources = sourceFixture();
      sources.install(1);
      owner.beginDocument(sources, 1, { width: 100, height: 120 });
      owner.setViewActive(true);
      const placeholder = thumbnailCanvas(container);
      assert.notEqual(placeholder, old);
      assert.ok(old.width > 0 && temporary.width > 0, "stale physical writers retain ownership");
      assert.equal(coordinator.canStartBackground, false);
      assert.equal(sources.params.length, 0);
      physical.resolve();
      await settle();
      await settle();
      assert.equal(old.width, 0);
      assert.equal(temporary.width, 0);
      const current = thumbnailCanvas(container);
      assert.notEqual(current, placeholder);
      assert.ok(current.width > 0);
      assert.equal(sources.params.length, 1);
      assert.equal(coordinator.canStartBackground, true);
    } finally {
      physical.resolve();
      await Promise.allSettled(owner.resetDocument());
    }
  });
});

test("source thumbnails use read-only annotation/config/fonts without base form state and restore base options", async () => {
  await withSourceThumbnails(async () => {
    const sources = sourceFixture();
    const ownConfig = Promise.resolve({} as never);
    const baseConfig = Promise.resolve({} as never);
    let prepared = 0;
    let adapted = 0;
    let closed = 0;
    let base = false;
    const fonts = {
      prepare: async (_page: unknown, mode: number) => {
        assert.equal(mode, 1);
        prepared++;
      },
      context: (context: CanvasRenderingContext2D) => {
        adapted++;
        return context;
      },
      close: () => {
        closed++;
      },
    } as unknown as DocumentFonts;
    sources.install(1, { fonts, optionalContentConfigPromise: ownConfig });
    const container = new Element();
    const rendered: number[][] = [];
    const { owner } = thumbnailOwner(container, {
      selectPage() {},
      sourceRendered: (pageNo, revision) => {
        rendered.push([pageNo, revision]);
      },
    });
    const storage = {} as never;
    owner.setRasterState({
      optionalContentRevision: 1,
      formAppearanceRevision: 4,
      annotationMode: 23,
      optionalContentConfigPromise: baseConfig,
      formAppearanceRevisionFor: () => {
        assert.ok(base, "source must never read base form revision");
        return 4;
      },
      printAnnotationStorageFor: () => {
        assert.ok(base, "source must never read base annotation storage");
        return storage;
      },
    });
    owner.beginDocument(sources, 1, { width: 100, height: 120 });
    owner.setViewActive(true);
    await settle();
    assert.equal(sources.params.length, 1);
    assert.equal(sources.params[0].input.annotationMode, 1);
    assert.equal(sources.params[0].input.optionalContentConfigPromise, ownConfig);
    assert.equal(sources.params[0].input.printAnnotationStorage, undefined);
    assert.equal(prepared, 1);
    assert.equal(adapted, 1);
    const old = thumbnailCanvas(container);
    base = true;
    sources.install(1, { id: null, sourcePage: 1, linkContext: "base" });
    owner.invalidatePageSources(new Set([1]));
    assert.ok(old.width > 0);
    await settle();
    assert.equal(sources.params[1].input.annotationMode, 23);
    assert.equal(sources.params[1].input.optionalContentConfigPromise, baseConfig);
    assert.equal(sources.params[1].input.printAnnotationStorage, storage);
    assert.deepEqual(rendered, [
      [1, 1],
      [1, 2],
    ]);
    owner.invalidatePageSources(new Set());
    owner.notifyAdmissionChanged();
    await settle();
    assert.equal(sources.params.length, 2);
    await Promise.allSettled(owner.resetDocument());
    assert.equal(closed, 0);
  });
});

test("source thumbnail replacement preserves old bitmap and physical background lease until revoked task settles", async () => {
  await withSourceThumbnails(async () => {
    const sources = sourceFixture();
    sources.install(1);
    const container = new Element();
    const rendered: number[] = [];
    const { owner, coordinator } = thumbnailOwner(container, {
      selectPage() {},
      sourceRendered: (_pageNo, revision) => {
        rendered.push(revision);
      },
    });
    owner.beginDocument(sources, 1, { width: 100, height: 120 });
    owner.setViewActive(true);
    await settle();
    const bitmap = thumbnailCanvas(container);
    const task = deferred<void>();
    let cancellations = 0;
    sources.install(1, {}, task.promise, () => {
      cancellations++;
    });
    owner.invalidatePageSources(new Set([1]));
    await settle();
    const staleCanvas = sources.params[1].input.canvas!;
    sources.install(1);
    owner.invalidatePageSources(new Set([1]));
    await settle();
    assert.equal(cancellations, 1);
    assert.equal(sources.params.length, 2);
    assert.equal(thumbnailCanvas(container), bitmap);
    assert.ok(bitmap.width > 0 && staleCanvas.width > 0);
    assert.equal(coordinator.canStartBackground, false);
    assert.ok(!sources.releases.some(([, revision]) => revision === 2));
    task.resolve();
    await settle();
    await settle();
    assert.equal(staleCanvas.width, 0);
    assert.notEqual(thumbnailCanvas(container), bitmap);
    assert.deepEqual(rendered, [1, 3]);
    assert.equal(coordinator.canStartBackground, true);
    await Promise.allSettled(owner.resetDocument());
  });
});

test("targeted source thumbnails retain unrelated caches/inflight work and remain lazy while closed", async () => {
  await withSourceThumbnails(async () => {
    const sources = sourceFixture();
    for (const pageNo of [1, 2, 3]) sources.install(pageNo);
    const container = new Element();
    const { owner } = thumbnailOwner(container);
    owner.beginDocument(sources, 3, { width: 100, height: 120 });
    owner.setViewActive(true);
    for (let i = 0; i < 4; i++) await settle();
    const third = thumbnailCanvas(container, 3);
    const task = deferred<void>();
    let cancellations = 0;
    sources.install(2, {}, task.promise, () => {
      cancellations++;
    });
    owner.invalidatePageSources(new Set([2]));
    await settle();
    sources.install(1);
    owner.invalidatePageSources(new Set([1]));
    await settle();
    assert.equal(cancellations, 0);
    assert.equal(thumbnailCanvas(container, 3), third);
    task.resolve();
    for (let i = 0; i < 3; i++) await settle();
    assert.deepEqual(
      sources.params.map(({ pageNo, revision }) => [pageNo, revision]),
      [
        [1, 1],
        [2, 1],
        [3, 1],
        [2, 2],
        [1, 2],
      ],
    );
    assert.equal(thumbnailCanvas(container, 3), third);
    owner.setViewActive(false);
    const first = thumbnailCanvas(container);
    sources.install(1);
    owner.invalidatePageSources(new Set([1]));
    await settle();
    assert.equal(thumbnailCanvas(container), first);
    assert.equal(sources.params.length, 5);
    owner.setViewActive(true);
    await settle();
    assert.equal(sources.params.length, 6);
    await Promise.allSettled(owner.resetDocument());
  });
});

for (const failure of ["loader", "font", "budget"] as const) {
  test(`source thumbnail ${failure} failure retains old pixels and never reports a successful replacement`, async () => {
    await withSourceThumbnails(async () => {
      const sources = sourceFixture();
      sources.install(1);
      const container = new Element();
      const rendered: number[] = [];
      const failures: number[] = [];
      const { owner, coordinator } = thumbnailOwner(
        container,
        {
          selectPage() {},
          sourceRendered: (_pageNo, revision) => {
            rendered.push(revision);
          },
          sourceFailed: (_pageNo, revision) => {
            failures.push(revision);
            throw new Error("observer");
          },
        },
        { ...profile, thumbnailMemoryLimitMiB: failure === "budget" ? 48000 / (1024 * 1024) : 16 },
      );
      owner.beginDocument(sources, 1, { width: 100, height: 120 });
      owner.setViewActive(true);
      await settle();
      const bitmap = thumbnailCanvas(container);
      const dimensions = [bitmap.width, bitmap.height];
      sources.install(
        1,
        failure === "font"
          ? {
              fonts: {
                prepare: async () => {
                  throw new SourceFontError("budget");
                },
              } as unknown as DocumentFonts,
            }
          : {},
      );
      if (failure === "loader")
        sources.acquire = async () => {
          throw new Error("loader");
        };
      owner.invalidatePageSources(new Set([1]));
      for (let i = 0; i < 4; i++) await settle();
      assert.equal(thumbnailCanvas(container), bitmap);
      assert.deepEqual([bitmap.width, bitmap.height], dimensions);
      assert.deepEqual(rendered, [1]);
      assert.deepEqual(failures, [2, 2]);
      assert.equal(coordinator.canStartBackground, true);
      await Promise.allSettled(owner.resetDocument());
    });
  });
}

test("old thumbnail admission cannot adopt a new source returned by a delayed acquisition", async () => {
  await withSourceThumbnails(async () => {
    const sources = sourceFixture();
    sources.install(1);
    const pending = deferred<DocumentPageUse>();
    const acquire = sources.acquire;
    let calls = 0;
    sources.acquire = pageNo => (++calls === 1 ? pending.promise : acquire(pageNo));
    const container = new Element();
    const rendered: number[] = [];
    const { owner, coordinator } = thumbnailOwner(container, {
      selectPage() {},
      sourceRendered: (_pageNo, revision) => {
        rendered.push(revision);
      },
    });
    owner.beginDocument(sources, 1, { width: 100, height: 120 });
    owner.setViewActive(true);
    const latest = sources.install(1);
    owner.invalidatePageSources(new Set([1]));
    pending.resolve(latest);
    for (let i = 0; i < 3; i++) await settle();
    assert.deepEqual(rendered, [2]);
    assert.equal(sources.params.length, 1);
    assert.equal(coordinator.canStartBackground, true);
    await Promise.allSettled(owner.resetDocument());
  });
});

test("reentrant source thumbnail completion releases physical resources even when the observer throws", async () => {
  await withSourceThumbnails(async () => {
    const sources = sourceFixture();
    sources.install(1);
    const container = new Element();
    let callbacks = 0;
    const { owner, coordinator } = thumbnailOwner(container, {
      selectPage() {},
      sourceRendered: () => {
        callbacks++;
        owner.resetDocument();
        throw new Error("observer");
      },
    });
    owner.beginDocument(sources, 1, { width: 100, height: 120 });
    owner.setViewActive(true);
    await settle();
    assert.equal(callbacks, 1);
    assert.equal(coordinator.canStartBackground, true);
    assert.deepEqual(sources.releases, [[1, 1]]);
    assert.equal(container.children.length, 0);
    assert.equal(sources.params[0].input.canvas?.width, 0);
  });
});

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
