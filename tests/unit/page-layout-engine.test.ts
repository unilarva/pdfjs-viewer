// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { PageLayoutEngine, type PageLayoutMode } from "../../src/page-layout-engine.js";

function fakeRowEl(offsetTop: number, offsetHeight = 100): HTMLDivElement {
  return {
    offsetTop,
    offsetHeight,
    style: {} as CSSStyleDeclaration,
  } as unknown as HTMLDivElement;
}

function fakeSurface(): { wrap: HTMLDivElement; canvas: HTMLCanvasElement } {
  return {
    wrap: { isConnected: true } as HTMLDivElement,
    canvas: { isConnected: true } as HTMLCanvasElement,
  };
}

function installRows(engine: PageLayoutEngine, offsets: readonly number[]): void {
  offsets.forEach((offset, index) => engine.registerRow(index, fakeRowEl(offset)));
  engine.measureRows(0);
}

test("pageTopFor/pageHeightFor resolve registered topology and base geometry", () => {
  const engine = new PageLayoutEngine();
  engine.recordBasePageSize(400, 800);
  engine.beginReflow(3, "single", "drop");
  installRows(engine, [0, 500, 1000]);
  const { wrap, canvas } = fakeSurface();
  engine.registerPageSurface(3, 2, wrap, canvas);

  assert.equal(engine.pageTopFor(3), 1000);
  assert.equal(engine.pageTopFor(99), null, "unknown page returns null");
  assert.equal(engine.pageHeightFor(3, 1.5, 0), 1200);
});

test("row grouping owns single, double, and book topology", () => {
  const expected: Record<PageLayoutMode, readonly (readonly number[])[]> = {
    single: [[1], [2], [3], [4], [5]],
    double: [[1, 2], [3, 4], [5]],
    book: [[1], [2, 3], [4, 5]],
  };
  for (const mode of ["single", "double", "book"] as const) {
    const engine = new PageLayoutEngine();
    engine.beginReflow(5, mode, "drop");
    assert.deepEqual(engine.rows, expected[mode]);
  }
});

test("rendered layout width and horizontal fit reflect the installed row model", () => {
  const engine = new PageLayoutEngine();
  engine.recordBasePageSize(600, 800);
  engine.configureGaps(20, 16);

  engine.beginReflow(2, "single", "drop");
  assert.equal(engine.renderedLayoutKind(), "single");
  assert.equal(engine.renderedRowWidthFor(1, 0), 600);
  assert.equal(engine.rowFitsHorizontally(1, 600, 0), true);
  assert.equal(engine.rowFitsHorizontally(1, 599, 0), false);

  engine.beginReflow(4, "double", "drop");
  assert.equal(engine.renderedLayoutKind(), "two-up");
  assert.equal(engine.renderedRowWidthFor(1, 0), 1220);
  assert.equal(engine.horizontalScrollMax(1, 1000, 0), 220);
  const overflowingEnvelope = engine.horizontalEnvelope(1, 1000, 0);
  assert.deepEqual(overflowingEnvelope, {
    widestRowWidth: 1220,
    contentWidth: 1220,
    widestRowInset: 0,
    scrollMax: 220,
  });
  assert.equal(engine.horizontalEnvelope(1, 1000, 0), overflowingEnvelope);
  assert.deepEqual(engine.horizontalEnvelope(0.8, 1000, 0), {
    widestRowWidth: 976,
    contentWidth: 1000,
    widestRowInset: 12,
    scrollMax: 0,
  });
  engine.recordPageBaseSize(2, 710, 300);
  assert.notEqual(engine.horizontalEnvelope(1, 1000, 0), overflowingEnvelope);
});

test("horizontal bounds use the widest mixed row and current rotation", () => {
  const engine = new PageLayoutEngine();
  engine.recordBasePageSize(400, 800);
  engine.recordPageBaseSize(1, 300, 900);
  engine.recordPageBaseSize(2, 700, 200);
  engine.configureGaps(20, 16);
  engine.beginReflow(2, "double", "drop");

  assert.equal(engine.renderedRowWidthFor(1, 0), 1013.3333333333334);
  assert.equal(engine.horizontalScrollMax(1, 800, 0), 214);
  assert.equal(engine.renderedRowWidthFor(1, 90), 1113.3333333333333);
  assert.equal(engine.rowFitsHorizontally(1, 1100, 90), false);
  assert.equal(engine.pageHeightFor(2, 2, 90), 1400);
  assert.equal(engine.renderedRowWidthFor(1.234, 0), 1250.4533333333334);
});

test("visibleRowRange finds the first, last, and center row", () => {
  const engine = new PageLayoutEngine();
  engine.configureGaps(12, 0);
  engine.beginReflow(5, "single", "drop");
  installRows(engine, [0, 100, 200, 300, 400]);

  assert.deepEqual(new PageLayoutEngine().visibleRowRange(0, 100, 1), {
    first: 0,
    last: -1,
    center: 0,
  });
  assert.deepEqual(engine.visibleRowRange(150, 100, 1), { first: 1, last: 2, center: 2 });
  assert.deepEqual(engine.visibleRowRange(0, 1000, 1), { first: 0, last: 4, center: 2 });
});

test("row reading position selects containing rows and the nearest side of gaps", () => {
  assert.equal(new PageLayoutEngine().rowIndexAt(100, 1, 0), 0);
  const engine = new PageLayoutEngine();
  engine.beginReflow(3, "single", "drop");
  installRows(engine, [0, 120, 240]);
  assert.equal(engine.rowIndexAt(0, 1, 0), 0);
  assert.equal(engine.rowIndexAt(99, 1, 0), 0);
  assert.equal(engine.rowIndexAt(109, 1, 0), 0);
  assert.equal(engine.rowIndexAt(111, 1, 0), 1);
  assert.equal(engine.rowIndexAt(120, 1, 0), 1);
  assert.equal(engine.rowIndexAt(1_000, 1, 0), 2);
});

test("viewport reading position uses anchor containment, intersection, and preferred spread ties", () => {
  const viewport = { left: 0, top: 0, right: 220, bottom: 200 };
  const pages = [
    { pageNo: 2, left: 0, top: 0, right: 100, bottom: 200 },
    { pageNo: 3, left: 120, top: 0, right: 220, bottom: 200 },
  ];
  assert.deepEqual(PageLayoutEngine.viewportPosition(pages, viewport, { x: 50, y: 70 }), {
    pageNo: 2,
    xRatio: 0.5,
    yRatio: 0.35,
  });
  assert.deepEqual(PageLayoutEngine.viewportPosition(pages, viewport, { x: 170, y: 70 }), {
    pageNo: 3,
    xRatio: 0.5,
    yRatio: 0.35,
  });
  assert.equal(PageLayoutEngine.viewportPosition(pages, viewport, { x: 110, y: 70 })?.pageNo, 2);
  assert.equal(PageLayoutEngine.viewportPosition(pages, viewport, { x: 110, y: 70 }, 3)?.pageNo, 3);
  assert.equal(PageLayoutEngine.viewportPosition(pages, viewport, { x: 50, y: 70 }, 3)?.pageNo, 3);
});

test("row and page registration replaces mappings and exposes registered surfaces", () => {
  const engine = new PageLayoutEngine();
  engine.beginReflow(2, "double", "drop");
  const row = fakeRowEl(120);
  engine.registerRow(0, row);
  const first = fakeSurface();
  const replacement = fakeSurface();
  engine.registerPageSurface(1, 0, first.wrap, first.canvas);
  engine.registerPageSurface(1, 0, replacement.wrap, replacement.canvas);

  assert.equal(engine.rowElementAt(0), row);
  assert.equal(engine.rowIndexForPage(1), 0);
  assert.equal(engine.pageWrapFor(1), replacement.wrap);
  assert.equal(engine.canvasFor(1), replacement.canvas);
  assert.throws(() => engine.registerPageSurface(3, 0, first.wrap, first.canvas));
});

test("measureRows caches tops and heights while applyScaledGaps updates rows", () => {
  const engine = new PageLayoutEngine();
  engine.configureGaps(12, 16);
  engine.recordBasePageSize(600, 800);
  engine.beginReflow(3, "single", "drop");
  const rows = [fakeRowEl(0), fakeRowEl(120), fakeRowEl(260)];
  rows.forEach((row, index) => engine.registerRow(index, row));

  assert.equal(engine.measureRows(10), true);
  assert.equal(engine.measureRows(10), false);
  assert.deepEqual(engine.rowTops, [10, 130, 270]);
  const bounds = engine.rowBounds(1, 0);
  assert.equal(
    engine.rowBounds(1, 0),
    bounds,
    "unchanged row geometry reuses its immutable snapshot",
  );
  assert.deepEqual(bounds, [
    { top: 10, bottom: 110 },
    { top: 130, bottom: 230 },
    { top: 270, bottom: 370 },
  ]);
  (rows[2] as unknown as { offsetHeight: number }).offsetHeight = 140;
  assert.equal(engine.measureRows(10), true);
  assert.notEqual(
    engine.rowBounds(1, 0),
    bounds,
    "height-only changes invalidate the cached bounds",
  );
  assert.deepEqual(engine.rowBounds(1, 0)[2], { top: 270, bottom: 410 });
  engine.applyScaledGaps(2);
  assert.equal(rows[0].style.gap, "24px");
  assert.equal(rows[0].style.margin, "0 auto 32px auto");
});

test("base and per-page geometry reject invalid values and replace repeated valid observations", () => {
  const engine = new PageLayoutEngine();
  assert.equal(engine.recordBasePageSize(400, 800), true);
  assert.equal(engine.recordBasePageSize(Number.NaN, 900), false);
  assert.deepEqual([engine.basePageWidth, engine.basePageHeight], [400, 800]);
  assert.equal(engine.recordBasePageSize(500, 900), true);
  assert.deepEqual([engine.basePageWidth, engine.basePageHeight], [500, 900]);

  assert.equal(engine.recordPageBaseSize(2, 300, 700), true);
  assert.equal(engine.recordPageBaseSize(2, -1, 750), false);
  assert.deepEqual(engine.pageBaseSizeFor(2), { width: 300, height: 700 });
  assert.equal(engine.recordPageBaseSize(2, 320, 720), true);
  assert.deepEqual(engine.pageBaseSizeFor(2), { width: 320, height: 720 });
  assert.equal(engine.recordPageBaseSize(0, 100, 100), false);
  assert.deepEqual(engine.pageBaseSizeFor(99), { width: 500, height: 900 });
});

test("render snapshot revisions advance only for topology and changed geometry", () => {
  const layout = new PageLayoutEngine();
  const topology = layout.topologyRevision;
  const geometry = layout.pageGeometryRevision;
  layout.beginReflow(2, "single", "drop");
  assert.equal(layout.topologyRevision, topology + 1);
  assert.equal(layout.pageGeometryRevision, geometry);
  assert.equal(layout.recordBasePageSize(100, 120), true);
  assert.equal(layout.pageGeometryRevision, geometry + 1);
  assert.equal(layout.recordBasePageSize(100, 120), true);
  assert.equal(layout.pageGeometryRevision, geometry + 1, "equal fallback geometry is stable");
  assert.equal(layout.recordPageBaseSize(1, 100, 120), true);
  assert.equal(layout.pageGeometryRevision, geometry + 2);
  assert.equal(layout.recordPageBaseSize(1, 100, 120), true);
  assert.equal(layout.pageGeometryRevision, geometry + 2, "equal page geometry is stable");
  layout.resetDocument();
  assert.equal(layout.topologyRevision, topology + 2);
  assert.equal(layout.pageGeometryRevision, geometry + 3);
});

test("auto layout, fit signature, and fit scale use validated base geometry", () => {
  const engine = new PageLayoutEngine();
  assert.equal(engine.autoFitSignature(800, 600, "single", "contain", 0, [1]), null);
  assert.equal(engine.computeFitScale(800, 600, "single", 1.25, 0.2, 4), 1.25);
  engine.recordBasePageSize(400, 800);
  engine.recordPageBaseSize(1, 400, 800);
  engine.configureGaps(20, 16);

  assert.equal(engine.evaluateAutoLayout(1000, 400), true);
  assert.equal(engine.autoTwoUp, true);
  assert.equal(engine.evaluateAutoLayout(100, 800), false);
  assert.equal(
    engine.autoFitSignature(800.4, 600.6, "single", "contain", 0, [1]),
    "800x601:single:contain:0:400.000000x800.000000",
  );
  assert.equal(engine.computeFitScale(800, 400, "single", 1, 0.2, 4), 0.5);
  assert.equal(engine.computeFitScale(820, 800, "double", 1, 0.2, 4), 1);
  assert.equal(engine.computeFitScale(8200, 8000, "single", 1, 0.2, 4), 4);
  assert.equal(PageLayoutEngine.twoUpFits(1000, 400, 400, 800, 20, 0), true);
  assert.equal(PageLayoutEngine.twoUpFits(1000, 400, 400, 800, 20, 90), false);
});

test("fit modes use complete rotated row geometry and representative singleton spreads", () => {
  const engine = new PageLayoutEngine();
  engine.recordBasePageSize(400, 800);
  engine.recordPageBaseSize(1, 400, 800);
  engine.recordPageBaseSize(2, 600, 300);
  engine.configureGaps(20, 16);

  assert.equal(
    engine.computeFitScale(1020, 800, "double", 1, 0.2, 4, "width", 0, [1, 2]),
    1.006578947368421,
  );
  assert.equal(engine.computeFitScale(1020, 800, "double", 1, 0.2, 4, "height", 0, [1, 2]), 1);
  assert.equal(engine.computeFitScale(1620, 600, "double", 1, 0.2, 4, "contain", 90, [1, 2]), 1);
  assert.equal(engine.computeFitScale(820, 800, "book", 1, 0.2, 4, "contain", 0, [1]), 1);
});

test("page gaps normalize to displayed short edge and retain nonzero bounds", () => {
  const engine = new PageLayoutEngine();
  engine.recordBasePageSize(400, 800);
  engine.configureGaps(20, 16);
  engine.beginReflow(2, "double", "drop");

  assert.ok(Math.abs(engine.horizontalGapFor(1) - 13.333333333333334) < 1e-12);
  assert.ok(Math.abs(engine.verticalGapFor(1) - 10.666666666666666) < 1e-12);
  assert.equal(engine.horizontalGapFor(0.01), 1);
  assert.equal(engine.horizontalGapFor(100), 320);
  assert.equal(engine.verticalGapFor(100), 256);
  assert.equal(engine.horizontalGapFor(100) / engine.verticalGapFor(100), 20 / 16);
  assert.equal(engine.computeFitScale(410, 800, "double", 1, 0.2, 4), 0.5040983606557377);
  assert.equal(engine.renderedRowWidthFor(0.5, 0), 406.6666666666667);
  assert.equal(PageLayoutEngine.twoUpFits(406, 400, 400, 800, 20), false);

  const large = new PageLayoutEngine();
  large.recordBasePageSize(4_000, 8_000);
  large.configureGaps(20, 16);
  assert.equal(large.horizontalGapFor(0.1), engine.horizontalGapFor(1));

  const zero = new PageLayoutEngine();
  zero.recordBasePageSize(400, 800);
  zero.configureGaps(0, 0);
  assert.equal(zero.horizontalGapFor(0.001), 0);
  assert.equal(zero.verticalGapFor(1_000), 0);
});

test("resetDocument clears every document value while preserving page gaps", () => {
  const engine = new PageLayoutEngine();
  engine.configureGaps(99, 77);
  engine.recordBasePageSize(400, 800);
  engine.recordPageBaseSize(1, 410, 810);
  engine.evaluateAutoLayout(1000, 400);
  engine.beginReflow(1, "single", "drop");
  engine.registerRow(0, fakeRowEl(25));
  engine.measureRows(5);
  const surface = fakeSurface();
  engine.registerPageSurface(1, 0, surface.wrap, surface.canvas);

  engine.resetDocument();

  assert.deepEqual(engine.rows, []);
  assert.deepEqual(engine.rowTops, []);
  assert.equal(engine.rowElementAt(0), null);
  assert.equal(engine.pageWrapFor(1), null);
  assert.equal(engine.canvasFor(1), null);
  assert.equal(engine.rowIndexForPage(1), undefined);
  assert.equal(engine.pageBaseSizes.size, 0);
  assert.deepEqual([engine.basePageWidth, engine.basePageHeight], [0, 0]);
  assert.equal(engine.autoTwoUp, false);
  assert.deepEqual([engine.horizontalGapPx, engine.verticalGapPx], [99, 77]);
});

test("surface leases are immutable and invalidated by registration, reflow, and reset", () => {
  const engine = new PageLayoutEngine();
  engine.beginReflow(1, "single", "drop");
  const surface = fakeSurface();
  engine.registerPageSurface(1, 0, surface.wrap, surface.canvas);
  const first = engine.leaseFor(1)!;
  assert.equal(Object.isFrozen(first), true);
  assert.equal(engine.isCurrent(first), true);

  engine.registerPageSurface(1, 0, surface.wrap, surface.canvas);
  const second = engine.leaseFor(1)!;
  assert.equal(engine.isCurrent(first), false);
  assert.equal(engine.isCurrent(second), true);

  engine.beginReflow(1, "single", "preserve");
  assert.equal(engine.isCurrent(second), false);
  assert.equal(engine.leaseFor(1), null, "preserved objects require explicit re-registration");
  engine.registerPageSurface(1, 0, surface.wrap, surface.canvas);
  const rebound = engine.leaseFor(1)!;
  assert.equal(engine.isCurrent(rebound), true);
  engine.resetDocument();
  assert.equal(engine.isCurrent(rebound), false);
});

test("same-document reflow preserves geometry and explicitly preserves or drops surfaces", () => {
  const engine = new PageLayoutEngine();
  engine.recordBasePageSize(400, 800);
  engine.recordPageBaseSize(2, 450, 850);
  engine.evaluateAutoLayout(1000, 400);
  engine.beginReflow(2, "single", "drop");
  installRows(engine, [0, 900]);
  const surface = fakeSurface();
  engine.registerPageSurface(2, 1, surface.wrap, surface.canvas);

  engine.beginReflow(2, "double", "preserve");
  assert.deepEqual(engine.rows, [[1, 2]]);
  assert.deepEqual(engine.rowTops, []);
  assert.equal(engine.rowIndexForPage(2), undefined);
  assert.equal(engine.canvasFor(2), surface.canvas);
  assert.deepEqual(engine.pageBaseSizeFor(2), { width: 450, height: 850 });
  assert.deepEqual([engine.basePageWidth, engine.basePageHeight], [400, 800]);
  assert.equal(engine.autoTwoUp, true);

  engine.beginReflow(2, "single", "drop");
  assert.equal(engine.pageWrapFor(2), null);
  assert.equal(engine.canvasFor(2), null);
  assert.deepEqual(engine.pageBaseSizeFor(2), { width: 450, height: 850 });
});
