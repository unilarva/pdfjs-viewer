// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentView } from "../../src/document-view.js";
import { installTestPlatform } from "./test-platform.js";

class FakeStyle {
  [name: string]: unknown;
  #values = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.#values.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.#values.get(name) ?? "";
  }
  removeProperty(name: string): string {
    const previous = this.getPropertyValue(name);
    this.#values.delete(name);
    return previous;
  }
}

class FakeElement {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  className = "";
  dataset: Record<string, string> = {};
  style = new FakeStyle() as unknown as CSSStyleDeclaration;
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  isConnected = true;
  offsetTop = 0;
  offsetHeight = 100;
  offsetLeft = 0;
  offsetWidth = 100;
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 1000;
  scrollWidth = 1200;
  clientWidth = 800;
  clientHeight = 600;
  borderBoxWidth: number | null = null;
  borderBoxHeight: number | null = null;
  width = 0;
  height = 0;
  get classList() {
    return { contains: (name: string) => this.className.split(" ").includes(name) };
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
    this.isConnected = false;
  }
  querySelector<T extends FakeElement>(selector: string): T | null {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const visit = (node: FakeElement): FakeElement | null => {
      for (const child of node.children) {
        if (child.classList.contains(className)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this) as T | null;
  }
  getBoundingClientRect(): DOMRect {
    const width = this.borderBoxWidth ?? this.clientWidth;
    const height = this.borderBoxHeight ?? this.clientHeight;
    return {
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() {},
    };
  }
  scrollTo(options: ScrollToOptions): void {
    if (options.top != null) this.scrollTop = options.top;
    if (options.left != null) this.scrollLeft = options.left;
  }
}

function withFakeDocument(run: () => void): void {
  class Div extends FakeElement {}
  class Canvas extends FakeElement {}
  const platform = installTestPlatform(
    name => (name === "canvas" ? new Canvas() : new Div()) as unknown as Element,
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "HTMLDivElement");
  Object.defineProperty(globalThis, "HTMLDivElement", { configurable: true, value: Div });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "HTMLDivElement", previous);
    else delete (globalThis as { HTMLDivElement?: unknown }).HTMLDivElement;
    platform.restore();
  }
}

function setup(options: { pageLayout?: "auto" | "single" | "double" | "book" } = {}) {
  const calls: string[] = [];
  const views: Array<{
    scale: number;
    rows: readonly (readonly number[])[];
    rowBounds?: readonly Readonly<{ top: number; bottom: number }>[];
    pageBaseSizes?: ReadonlyMap<number, Readonly<{ width: number; height: number }>>;
    fallbackPageSize?: Readonly<{ width: number; height: number }>;
  }> = [];
  const renderer = {
    beginSurfaceReflow: () => calls.push("renderer-begin"),
    endSurfaceReflow: (view: { scale: number; rows: readonly (readonly number[])[] }) => {
      calls.push("renderer-end");
      views.push(view);
    },
    invalidateView: () => calls.push("renderer-invalidate"),
    reconcile: (view: { scale: number; rows: readonly (readonly number[])[] }) => {
      calls.push("renderer-reconcile");
      views.push(view);
    },
  };
  const text = {
    beginSurfaceReflow: () => calls.push("text-reflow"),
    suspendForZoom: () => calls.push("text-suspend"),
    resumeAfterZoom: () => calls.push("text-resume"),
    setViewportPages: () => {},
    presentationPageNos: () => [],
    needsPresentation: () => false,
  };
  const container = new FakeElement();
  const view = new DocumentView({
    container: container as unknown as HTMLElement,
    renderer: renderer as never,
    textPresentation: text as never,
    pageLayout: options.pageLayout ?? "single",
    fitMode: "auto",
    initialRotation: 0,
    autoFitWidthMaxHeight: 400,
    minScale: 0.2,
    maxScale: 4,
    horizontalGap: 12,
    verticalGap: 16,
    devicePixelRatio: () => 1,
    requestFrame: callback => {
      callback(0);
      return 1;
    },
    cancelFrame: () => {},
  });
  return { view, container, calls, views };
}

test("owns initial topology, surfaces, canonical sizing, and render snapshot", () => {
  withFakeDocument(() => {
    const { view, container, calls, views } = setup();
    const result = view.beginDocument({
      pageCount: 3,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    assert.equal(result.kind, "committed");
    assert.deepEqual(view.rows, [[1], [2], [3]]);
    assert.equal(container.children[0]?.className, "pdf-content");
    assert.equal(view.leaseFor(3)?.pageNo, 3);
    assert.equal(view.leaseFor(1)?.canvas.style.width, "100%");
    assert.equal(view.leaseFor(1)?.canvas.style.height, "100%");
    assert.equal(
      view.pageWrapFor(1)?.style.getPropertyValue("--pdf-page-scale"),
      String(view.scale),
    );
    assert.deepEqual(calls.slice(0, 3), ["text-reflow", "renderer-begin", "renderer-end"]);
    assert.equal(views[0]?.scale, view.scale);
    assert.equal(view.contentElement?.style.getPropertyValue("--pdf-page-vgap-scaled"), "8px");
  });
});

test("page gaps follow displayed page size across fit and explicit zoom", () => {
  withFakeDocument(() => {
    const { view, container } = setup({ pageLayout: "double" });
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    const fittedScale = view.scale;
    const row = view.contentElement?.children[0];
    assert.equal(row?.style.gap, "6px");
    assert.equal(row?.style.margin, "0 auto 8px auto");

    container.clientWidth = 1_600;
    container.clientHeight = 1_200;
    view.resize();
    assert.equal(view.scale, fittedScale * 2);
    assert.equal(row?.style.gap, "12px");
    assert.equal(row?.style.margin, "0 auto 16px auto");

    view.setExplicitScale(fittedScale * 4);
    assert.equal(view.fitActive, false);
    assert.equal(row?.style.gap, "24px");
    assert.equal(row?.style.margin, "0 auto 32px auto");

    view.applyFit();
    assert.equal(row?.style.gap, "12px");
    assert.equal(row?.style.margin, "0 auto 16px auto");
  });
});

test("presentation viewport and snapshot restore canonical intent and exact scroll", () => {
  withFakeDocument(() => {
    const { view, container } = setup({ pageLayout: "double" });
    view.beginDocument({
      pageCount: 4,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(1.35);
    container.scrollTop = 240;
    container.scrollLeft = 35;
    const saved = view.capturePresentationSnapshot();
    assert.equal(Object.isFrozen(saved), true);

    view.setPresentationViewport(true);
    assert.equal(container.style.getPropertyValue("--pdf-presentation-viewport-height"), "600px");
    view.commitView({ pageLayout: "single", fitMode: "contain", refit: true, keepPage: 2 });
    assert.equal(view.pageLayout, "single");
    assert.equal(view.fitActive, true);

    view.setPresentationViewport(false);
    view.restorePresentationSnapshot(saved);
    assert.equal(view.pageLayout, "double");
    assert.equal(view.fitActive, false);
    assert.equal(view.scale, 1.35);
    assert.equal(container.scrollTop, 240);
    assert.equal(container.scrollLeft, 35);
    assert.equal(container.style.getPropertyValue("--pdf-presentation-viewport-height"), "");
  });
});

test("render snapshots reuse detached page geometry until its revision changes", () => {
  withFakeDocument(() => {
    const { view, views } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([[1, { width: 410, height: 810 }]]),
      preferredLayout: null,
    });
    view.reconcile();
    assert.equal(views[1]?.pageBaseSizes, views[0]?.pageBaseSizes);
    assert.equal(views[1]?.fallbackPageSize, views[0]?.fallbackPageSize);

    view.recordPreparedPageGeometry(2, 420, 820);
    view.reconcile();
    assert.notEqual(views[2]?.pageBaseSizes, views[1]?.pageBaseSizes);
    assert.notEqual(views[2]?.fallbackPageSize, views[1]?.fallbackPageSize);
    assert.deepEqual(views[2]?.pageBaseSizes?.get(2), { width: 420, height: 820 });
  });
});

test("page-one navigation targets a measured leading row inset", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    const firstRow = view.rowElementAt(0) as unknown as FakeElement;
    firstRow.offsetTop = 16;
    view.refreshRowMetrics();

    container.scrollTop = 0;
    view.scrollToPage(1, false, false);
    assert.equal(container.scrollTop, 16);
  });
});

test("navigation history restores fractional page geometry to the canonical reading anchor", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    container.clientWidth = 400;
    container.clientHeight = 200;
    container.borderBoxWidth = 400;
    container.borderBoxHeight = 200;
    container.scrollHeight = 2000;
    view.beginDocument({
      pageCount: 1,
      basePageSize: { width: 600, height: 800 },
      pageBaseSizes: new Map([[1, { width: 600, height: 800 }]]),
      preferredLayout: null,
    });
    view.setExplicitScale(1);
    const page = view.pageWrapFor(1) as unknown as FakeElement;
    page.getBoundingClientRect = () => ({
      left: 50 - container.scrollLeft,
      top: 500 - container.scrollTop,
      width: 600,
      height: 800,
      right: 650 - container.scrollLeft,
      bottom: 1300 - container.scrollTop,
      x: 50 - container.scrollLeft,
      y: 500 - container.scrollTop,
      toJSON() {},
    });
    container.scrollLeft = 30.25;
    container.scrollTop = 600.75;
    const captured = view.captureDocumentLocation();
    assert.ok(captured);

    container.scrollLeft = 0;
    container.scrollTop = 0;
    assert.equal(view.restoreDocumentLocation(captured), true);
    assert.ok(Math.abs(container.scrollLeft - 30.25) < 1e-9);
    assert.ok(Math.abs(container.scrollTop - 600.75) < 1e-9);
  });
});

test("document location capture and restoration preserve state while geometry is unavailable", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    container.clientWidth = 400;
    container.clientHeight = 200;
    container.borderBoxWidth = 400;
    container.borderBoxHeight = 200;
    container.scrollHeight = 2000;
    view.beginDocument({
      pageCount: 1,
      basePageSize: { width: 600, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(1);
    const page = view.pageWrapFor(1) as unknown as FakeElement;
    let pageVisible = true;
    page.getBoundingClientRect = () => ({
      left: pageVisible ? 50 - container.scrollLeft : 0,
      top: pageVisible ? 500 - container.scrollTop : 0,
      width: pageVisible ? 600 : 0,
      height: pageVisible ? 800 : 0,
      right: pageVisible ? 650 - container.scrollLeft : 0,
      bottom: pageVisible ? 1300 - container.scrollTop : 0,
      x: pageVisible ? 50 - container.scrollLeft : 0,
      y: pageVisible ? 500 - container.scrollTop : 0,
      toJSON() {},
    });
    container.scrollLeft = 30.25;
    container.scrollTop = 600.75;
    const location = view.captureDocumentLocation();
    assert.ok(location);

    pageVisible = false;
    assert.equal(view.captureDocumentLocation(), null);
    assert.equal(view.restoreDocumentLocation(location), false);
    assert.equal(container.scrollLeft, 30.25);
    assert.equal(container.scrollTop, 600.75);

    pageVisible = true;
    container.clientWidth = 0;
    assert.equal(view.captureDocumentLocation(), null);
    assert.equal(view.restoreDocumentLocation(location), false);
    assert.equal(container.scrollLeft, 30.25);
    assert.equal(container.scrollTop, 600.75);

    container.clientWidth = 400;
    container.scrollLeft = 0;
    container.scrollTop = 0;
    assert.equal(view.restoreDocumentLocation(location), true);
    assert.ok(Math.abs(container.scrollLeft - 30.25) < 1e-9);
    assert.ok(Math.abs(container.scrollTop - 600.75) < 1e-9);
  });
});

test("document locations use known viewer-rotation mappings during capture and restoration", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    container.clientWidth = 400;
    container.clientHeight = 200;
    container.borderBoxWidth = 400;
    container.borderBoxHeight = 200;
    container.scrollHeight = 2_000;
    view.beginDocument({
      pageCount: 1,
      basePageSize: { width: 600, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(1);

    const cases = [
      [90, 800, 600, 0.2, 0.7, 0.7, 0.8],
      [180, 600, 800, 0.2, 0.7, 0.8, 0.3],
      [270, 800, 600, 0.2, 0.7, 0.3, 0.2],
    ] as const;
    for (const [rotation, width, height, displayedX, displayedY, xRatio, yRatio] of cases) {
      view.commitView({ rotation, refit: false });
      const page = view.pageWrapFor(1) as unknown as FakeElement;
      page.getBoundingClientRect = () => ({
        left: 100 - container.scrollLeft,
        top: 300 - container.scrollTop,
        width,
        height,
        right: 100 - container.scrollLeft + width,
        bottom: 300 - container.scrollTop + height,
        x: 100 - container.scrollLeft,
        y: 300 - container.scrollTop,
        toJSON() {},
      });
      const expectedLeft = 100 + displayedX * width - container.clientWidth * 0.5;
      const expectedTop = 300 + displayedY * height - container.clientHeight * 0.35;
      container.scrollLeft = expectedLeft;
      container.scrollTop = expectedTop;
      const location = view.captureDocumentLocation();
      assert.ok(location);
      assert.ok(Math.abs(location.xRatio - xRatio) < 1e-9);
      assert.ok(Math.abs(location.yRatio - yRatio) < 1e-9);

      container.scrollLeft = 0;
      container.scrollTop = 0;
      assert.equal(view.restoreDocumentLocation(location), true);
      assert.ok(Math.abs(container.scrollLeft - expectedLeft) < 1e-9);
      assert.ok(Math.abs(container.scrollTop - expectedTop) < 1e-9);
    }
  });
});

test("document location restoration centers a fitting row despite another row overflowing", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    container.clientWidth = 400;
    container.clientHeight = 200;
    container.borderBoxWidth = 400;
    container.borderBoxHeight = 200;
    container.scrollHeight = 2_000;
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 200, height: 800 },
      pageBaseSizes: new Map([[2, { width: 900, height: 800 }]]),
      preferredLayout: null,
    });
    view.setExplicitScale(1);
    const first = view.pageWrapFor(1) as unknown as FakeElement;
    first.getBoundingClientRect = () => ({
      left: 350 - container.scrollLeft,
      top: 300 - container.scrollTop,
      width: 200,
      height: 800,
      right: 550 - container.scrollLeft,
      bottom: 1_100 - container.scrollTop,
      x: 350 - container.scrollLeft,
      y: 300 - container.scrollTop,
      toJSON() {},
    });
    container.scrollLeft = 250;
    container.scrollTop = 0;
    assert.equal(view.rowFitsHorizontally(), false);
    assert.equal(view.restoreDocumentLocation({ page: 1, xRatio: 0.5, yRatio: 0.35 }), true);
    assert.equal(container.scrollLeft, 0);
  });
});

test("document locations survive zoom and double or book topology changes", () => {
  withFakeDocument(() => {
    const { view, container } = setup({ pageLayout: "double" });
    container.clientWidth = 500;
    container.clientHeight = 200;
    container.borderBoxWidth = 500;
    container.borderBoxHeight = 200;
    container.scrollHeight = 4_000;
    view.beginDocument({
      pageCount: 4,
      basePageSize: { width: 300, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(1);
    const installPageThreeBounds = (left: number, top: number, width: number, height: number) => {
      const page = view.pageWrapFor(3) as unknown as FakeElement;
      page.getBoundingClientRect = () => ({
        left: left - container.scrollLeft,
        top: top - container.scrollTop,
        width,
        height,
        right: left - container.scrollLeft + width,
        bottom: top - container.scrollTop + height,
        x: left - container.scrollLeft,
        y: top - container.scrollTop,
        toJSON() {},
      });
    };
    installPageThreeBounds(312, 1_000, 300, 800);
    const pageFour = view.pageWrapFor(4) as unknown as FakeElement;
    pageFour.getBoundingClientRect = () => ({
      left: 624 - container.scrollLeft,
      top: 1_000 - container.scrollTop,
      width: 300,
      height: 800,
      right: 924 - container.scrollLeft,
      bottom: 1_800 - container.scrollTop,
      x: 624 - container.scrollLeft,
      y: 1_000 - container.scrollTop,
      toJSON() {},
    });
    container.scrollLeft = 312 + 0.4 * 300 - 250;
    container.scrollTop = 1_000 + 0.6 * 800 - 70;
    const location = view.captureDocumentLocation();
    assert.deepEqual(location, { page: 3, xRatio: 0.4, yRatio: 0.6 });

    view.setExplicitScale(1.5);
    view.commitView({ pageLayout: "book", refit: false });
    installPageThreeBounds(390, 1_600, 450, 1_200);
    container.scrollLeft = 0;
    container.scrollTop = 0;
    assert.equal(view.restoreDocumentLocation(location!), true);
    assert.ok(
      Math.abs(
        container.scrollLeft -
          Math.min(390 + 0.4 * 450 - 250, view.transientHorizontalEnvelope().scrollMax),
      ) < 1e-9,
    );
    assert.ok(Math.abs(container.scrollTop - (1_600 + 0.6 * 1_200 - 70)) < 1e-9);
  });
});

test("canonical scale transaction suspends text and reconciles only final geometry", () => {
  withFakeDocument(() => {
    const { view, calls, views } = setup();
    view.beginDocument({
      pageCount: 1,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    calls.length = 0;
    views.length = 0;
    const result = view.setExplicitScale(1.23456749);
    assert.equal(result.kind, "committed");
    assert.equal(view.scale, 1.234567);
    assert.deepEqual(calls, [
      "text-suspend",
      "renderer-invalidate",
      "renderer-reconcile",
      "text-resume",
    ]);
    assert.equal(views[0]?.scale, 1.234567);
    assert.equal(view.setExplicitScale(1.2345674).kind, "unchanged");
  });
});

test("transient commit restores a source-scale offset against target page geometry", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(1);
    container.scrollTop = 100;
    const page = view.pageWrapFor(1) as unknown as FakeElement;
    page.getBoundingClientRect = () => ({
      left: 200,
      top: 100,
      width: 600,
      height: 1200,
      right: 800,
      bottom: 1300,
      x: 200,
      y: 100,
      toJSON() {},
    });

    view.commitTransientZoom({
      fromScale: 1,
      toScale: 1.5,
      anchorContent: { x: 400, y: 400 },
      anchorPage: { pageNo: 1, offset: { x: 100, y: 200 } },
      centerClient: { x: 400, y: 250 },
    });

    assert.equal(container.scrollLeft, 0);
    assert.equal(container.scrollTop, 250);
  });
});

test("automatic fit resolves at the height threshold and rotation is canonical", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 1,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([[1, { width: 400, height: 800 }]]),
      preferredLayout: null,
    });
    assert.equal(view.effectiveFitMode(), "contain");
    container.clientHeight = 400;
    assert.equal(view.effectiveFitMode(), "width");
    view.commitView({ rotation: 90, refit: true, keepPage: 1 });
    assert.equal(view.rotation, 90);
    assert.equal(view.fitActive, true);
  });
});

test("auto fit threshold, mixed-row currentness, and page heights use current geometry", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([
        [1, { width: 400, height: 800 }],
        [2, { width: 200, height: 1000 }],
      ]),
      preferredLayout: null,
    });
    container.clientHeight = 399;
    assert.equal(view.effectiveFitMode(), "width");
    container.clientHeight = 400;
    assert.equal(view.effectiveFitMode(), "width");
    container.clientHeight = 401;
    assert.equal(view.effectiveFitMode(), "contain");
    assert.equal(view.pageHeightFor(2), view.scale * 1000);
    container.scrollTop = view.pageTopFor(2) ?? 0;
    assert.equal(view.fitNeedsRefresh(), true);
    view.commitView({ refit: true, keepPage: 2 });
    assert.equal(view.fitNeedsRefresh(), false);
  });
});

test("fit currentness waits for exact row geometry instead of flickering on fallback geometry", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([[1, { width: 400, height: 800 }]]),
      preferredLayout: null,
    });
    container.scrollTop = view.pageTopFor(2) ?? 0;
    assert.equal(view.fitNeedsRefresh(), false);

    container.clientWidth = 200;
    container.borderBoxWidth = 200;
    assert.equal(view.fitNeedsRefresh(), true);

    view.recordPreparedPageGeometry(2, 200, 1000);
    assert.equal(view.fitNeedsRefresh(), true);
  });
});

test("fit ignores transient horizontal scrollbar height and settles in one operation", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 1,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([[1, { width: 400, height: 800 }]]),
      preferredLayout: null,
    });
    assert.equal(view.scale, 0.75);

    container.clientWidth = 296;
    container.clientHeight = 585;
    container.borderBoxWidth = 296;
    container.borderBoxHeight = 600;
    assert.equal(view.fitNeedsRefresh(), true);
    view.applyFit();
    assert.equal(view.scale, 0.74);

    container.clientHeight = 600;
    assert.equal(view.fitNeedsRefresh(), false);
    assert.equal(view.computeFitScale(), 0.74);
  });
});

test("fit visibility follows installed row overflow when the exact current row still fits", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([
        [1, { width: 400, height: 800 }],
        [2, { width: 600, height: 800 }],
      ]),
      preferredLayout: null,
    });
    container.clientWidth = 400;
    container.borderBoxWidth = 400;
    assert.equal(view.fitNeedsRefresh(), true);
  });
});

test("resize fits and records currentness from the preferred keep page", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      pageBaseSizes: new Map([
        [1, { width: 400, height: 800 }],
        [2, { width: 200, height: 1000 }],
      ]),
      preferredLayout: null,
    });
    container.scrollTop = 0;
    const result = view.resize(2);
    assert.equal(result.kind, "committed");
    assert.equal(view.scale, 0.6);
    container.scrollTop = view.pageTopFor(2) ?? 0;
    assert.equal(view.fitNeedsRefresh(), false);
  });
});

test("non-fit resize measures row bounds before renderer reconciliation", () => {
  withFakeDocument(() => {
    const { view, calls, views } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(1);
    const first = view.rowElementAt(0) as unknown as FakeElement;
    const second = view.rowElementAt(1) as unknown as FakeElement;
    first.offsetTop = 20;
    first.offsetHeight = 110;
    second.offsetTop = 150;
    second.offsetHeight = 140;
    calls.length = 0;
    views.length = 0;

    const result = view.resize(undefined, { refit: false });

    assert.equal(result.kind, "unchanged");
    assert.deepEqual(calls, ["renderer-reconcile"]);
    assert.deepEqual(views[0]?.rowBounds, [
      { top: 20, bottom: 130 },
      { top: 150, bottom: 290 },
    ]);
  });
});

test("page layout transaction owns fit, preserving reflow, and semantic result", () => {
  withFakeDocument(() => {
    const { view, calls } = setup();
    view.beginDocument({
      pageCount: 4,
      basePageSize: { width: 300, height: 500 },
      preferredLayout: null,
    });
    view.setExplicitScale(2);
    calls.length = 0;
    const result = view.commitView({ pageLayout: "double", refit: true });
    assert.equal(result.kind, "committed");
    assert.equal(view.fitActive, true);
    assert.deepEqual(view.rows, [
      [1, 2],
      [3, 4],
    ]);
    assert.deepEqual(calls, [
      "text-suspend",
      "renderer-invalidate",
      "text-reflow",
      "renderer-begin",
      "renderer-end",
      "text-resume",
    ]);
    if (result.kind === "committed") assert.equal(result.change.topologyChanged, true);
  });
});

test("reset drops document-owned DOM, surfaces, geometry, and canonical state", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 2,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    view.setExplicitScale(2);
    view.resetDocument();
    assert.equal(view.pageCount, 0);
    assert.equal(view.scale, 1);
    assert.equal(view.fitActive, true);
    assert.deepEqual(view.rows, []);
    assert.equal(view.leaseFor(1), null);
    assert.equal(container.children.length, 0);
  });
});

test("renderer surface leases and motion-neutral navigation use the production owner", () => {
  withFakeDocument(() => {
    const { view, container } = setup();
    view.beginDocument({
      pageCount: 3,
      basePageSize: { width: 400, height: 800 },
      preferredLayout: null,
    });
    const lease = view.leaseFor(2);
    assert.ok(lease);
    assert.equal(view.isCurrent(lease), true);
    assert.equal(view.scrollToPage(2, false, false), 1);
    assert.equal(container.scrollTop, view.pageTopFor(2));
  });
});

test("auto layout follows PDF preference when two-page geometry fits and resets stale initial scroll", () => {
  withFakeDocument(() => {
    const { view, container } = setup({ pageLayout: "auto" });
    container.scrollTop = 900;
    container.scrollLeft = 80;
    view.beginDocument({
      pageCount: 4,
      basePageSize: { width: 300, height: 500 },
      preferredLayout: "book",
      skipInitialScroll: true,
    });
    assert.deepEqual(view.rows, [[1], [2, 3], [4]]);
    assert.equal(container.scrollTop, 0);
    assert.equal(container.scrollLeft, 0);
    assert.equal(view.scale, 1.2);
  });
});
