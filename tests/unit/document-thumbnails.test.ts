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

class Element {
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
  addEventListener(): void {}
  removeEventListener(): void {}
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
