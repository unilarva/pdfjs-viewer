// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  createRenderPlan,
  resolveRasterDimensions,
  type RenderPlannerInput,
} from "../../src/render-planner.js";

const BYTES_PER_MIB = 1024 * 1024;

test("raster dimensions preserve one uniform DPR and hard canvas limits", () => {
  const unconstrained = resolveRasterDimensions(41.95, 59.52, 1, 24_000_000, 8192);
  assert.deepEqual(
    {
      width: unconstrained.width,
      height: unconstrained.height,
      canvasLimited: unconstrained.canvasLimited,
    },
    { width: 42, height: 60, canvasLimited: false },
  );
  assert.equal(unconstrained.renderDpr, 1);

  const constrained = resolveRasterDimensions(4195, 5952, 1, 24_000_000, 8192);
  assert.equal(constrained.canvasLimited, true);
  assert.ok(constrained.width * constrained.height <= 24_000_000);
  assert.ok(constrained.width <= 8192 && constrained.height <= 8192);
  assert.ok(constrained.renderDpr < 1);
  assert.ok(constrained.width / constrained.renderDpr >= 4195);
  assert.ok(constrained.height / constrained.renderDpr >= 5952);
  assert.deepEqual(resolveRasterDimensions(4195, 5952, constrained.renderDpr, 24_000_000, 8192), {
    ...constrained,
    canvasLimited: false,
  });
});

test("raster rounding is stable across fractional DPRs and near-integer products", () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const raster = resolveRasterDimensions(467.962088072, 664.0000189239998, dpr, 24_000_000, 8192);
    assert.equal(raster.renderDpr, dpr);
    assert.equal(raster.width, Math.ceil(Math.fround(467.962088072 * dpr)));
    assert.equal(raster.height, Math.ceil(Math.fround(664.0000189239998 * dpr)));
  }

  const dprOne = resolveRasterDimensions(467.962088072, 664.0000189239998, 1, 24_000_000, 8192);
  assert.deepEqual(dprOne, { width: 468, height: 664, renderDpr: 1, canvasLimited: false });
});

function rowBounds(count: number, height: number): Array<{ top: number; bottom: number }> {
  return Array.from({ length: count }, (_, index) => ({
    top: index * height,
    bottom: (index + 1) * height,
  }));
}

function input(overrides: Partial<RenderPlannerInput> = {}): RenderPlannerInput {
  const rows = overrides.rows ?? [[1], [2], [3], [4]];
  const visibleRange = overrides.visibleRange ?? { first: 1, last: 1 };
  return {
    rows,
    rowBounds: rows.map((_, index) => ({ top: index * 100, bottom: (index + 1) * 100 })),
    viewport: { top: visibleRange.first * 100, height: 100 },
    visibleRange,
    requiredPages: new Set(),
    maxBufferViewportHeights: "unlimited",
    maxBufferPages: "unlimited",
    motion: "stationary",
    requestedDpr: 1,
    currentScale: 1,
    pageBaseSizes: new Map(),
    fallbackPageSize: { width: 100, height: 100 },
    settings: {
      memoryLimitMiB: 5,
      maxCanvasPixels: 24_000_000,
      maxCanvasDimension: 8192,
      maxConcurrentRenders: 3,
      minRenderDpr: 0.5,
      allowDprReduction: true,
      allowVisibleDirectRendering: false,
      memoryHysteresis: 0,
    },
    retainCommittedPages: true,
    retainedCandidates: [],
    committedPageRenderDprs: new Map(),
    committedPageBytes: new Map(),
    fixedReplacementPageBytes: new Map(),
    fixedOccupiedBytes: 0,
    ...overrides,
  };
}

test("stationary unlimited buffering grows after then before without duplicates", () => {
  const plan = createRenderPlan(input());
  assert.deepEqual(plan.desiredPages, [2, 3, 1, 4]);
  assert.deepEqual(plan.admittedRowIndexes, [2, 0, 3]);
  assert.deepEqual([...plan.visiblePages], [2]);
});

test("allocates one total viewport-height budget by motion and redistributes document edges", () => {
  const rows = Array.from({ length: 11 }, (_, index) => [index + 1]);
  const plan = (
    motion: RenderPlannerInput["motion"],
    visibleRow = 5,
    maxBufferViewportHeights = 6,
  ) =>
    createRenderPlan(
      input({
        rows,
        visibleRange: { first: visibleRow, last: visibleRow },
        viewport: { top: visibleRow * 100, height: 100 },
        maxBufferViewportHeights,
        motion,
      }),
    );

  const stationary = plan("stationary", 5, 4);
  assert.deepEqual(stationary.admittedRowIndexes, [6, 4, 7, 3]);
  assert.deepEqual([stationary.bufferRowsBefore, stationary.bufferRowsAfter], [2, 2]);
  assert.deepEqual(
    [stationary.bufferViewportHeightsBefore, stationary.bufferViewportHeightsAfter],
    [2, 2],
  );

  const forward = plan("forward");
  assert.deepEqual(forward.admittedRowIndexes, [6, 4, 7, 3, 8, 9]);
  assert.deepEqual([forward.bufferRowsBefore, forward.bufferRowsAfter], [2, 4]);

  const backward = plan("backward");
  assert.deepEqual(backward.admittedRowIndexes, [4, 6, 3, 7, 2, 1]);
  assert.deepEqual([backward.bufferRowsBefore, backward.bufferRowsAfter], [4, 2]);

  const atStart = plan("backward", 0);
  assert.deepEqual([atStart.bufferRowsBefore, atStart.bufferRowsAfter], [0, 6]);
  assert.deepEqual(atStart.admittedRowIndexes, [1, 2, 3, 4, 5, 6]);

  const atEnd = plan("forward", 10);
  assert.deepEqual([atEnd.bufferRowsBefore, atEnd.bufferRowsAfter], [6, 0]);
  assert.deepEqual(atEnd.admittedRowIndexes, [9, 8, 7, 6, 5, 4]);
});

test("selects complete multi-page rows within viewport-height coverage", () => {
  const plan = createRenderPlan(
    input({
      rows: [
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
      ],
      visibleRange: { first: 1, last: 1 },
      maxBufferViewportHeights: 1.5,
      motion: "forward",
    }),
  );
  assert.equal(plan.bufferRowsBefore + plan.bufferRowsAfter, 2);
  assert.deepEqual(plan.admittedRowIndexes, [2, 0]);
  assert.deepEqual(plan.desiredPages, [3, 4, 5, 6, 1, 2]);
});

test("enforces a strict optional-page ceiling without splitting rows", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2, 3], [4], [5, 6]],
      rowBounds: rowBounds(4, 100),
      viewport: { top: 200, height: 100 },
      visibleRange: { first: 2, last: 2 },
      maxBufferViewportHeights: "unlimited",
      maxBufferPages: 2,
      motion: "forward",
    }),
  );
  assert.deepEqual(plan.admittedRowIndexes, [3]);
  assert.deepEqual(plan.desiredPages, [4, 5, 6]);
  assert.equal(plan.bufferPageCount, 2);
  assert.equal(plan.bufferPageLimitReached, true);
});

test("a row that exceeds remaining page capacity blocks only its side", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2, 3], [4, 5], [6]],
      rowBounds: rowBounds(4, 100),
      viewport: { top: 100, height: 100 },
      visibleRange: { first: 1, last: 1 },
      maxBufferViewportHeights: "unlimited",
      maxBufferPages: 1,
      motion: "forward",
    }),
  );
  assert.deepEqual(plan.admittedRowIndexes, [0]);
  assert.deepEqual(plan.desiredPages, [2, 3, 1]);
  assert.equal(plan.bufferPageCount, 1);
});

test("maximum safe page ceilings retain bounded scans around readiness rows", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2], [3]],
      rowBounds: rowBounds(3, 100),
      viewport: { top: 0, height: 100 },
      visibleRange: { first: 0, last: 0 },
      requiredPages: new Set([2]),
      maxBufferViewportHeights: "unlimited",
      maxBufferPages: Number.MAX_SAFE_INTEGER,
    }),
  );
  assert.deepEqual(plan.desiredPages, [1, 2, 3]);
  assert.equal(plan.bufferPageCount, 1);
});

test("admits more rows at lower zoom for the same viewport-height target", () => {
  const rows = Array.from({ length: 20 }, (_, index) => [index + 1]);
  const planAt = (scale: number, visibleLast: number) =>
    createRenderPlan(
      input({
        rows,
        rowBounds: rowBounds(rows.length, 100 * scale),
        viewport: { top: 5 * 100 * scale, height: 300 },
        visibleRange: { first: 5, last: visibleLast },
        maxBufferViewportHeights: 2,
        currentScale: scale,
        settings: { ...input().settings, memoryLimitMiB: 512 },
      }),
    );

  const zoomedOut = planAt(0.5, 10);
  const normal = planAt(1, 7);
  const zoomedIn = planAt(2, 6);
  assert.ok(zoomedOut.admittedRowIndexes.length > normal.admittedRowIndexes.length);
  assert.ok(normal.admittedRowIndexes.length > zoomedIn.admittedRowIndexes.length);
});

test("includes a whole mixed-height row that intersects the distance boundary", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2], [3], [4]],
      rowBounds: [
        { top: 0, bottom: 100 },
        { top: 100, bottom: 200 },
        { top: 200, bottom: 300 },
        { top: 300, bottom: 700 },
      ],
      viewport: { top: 200, height: 100 },
      visibleRange: { first: 2, last: 2 },
      maxBufferViewportHeights: 2,
    }),
  );
  assert.deepEqual(plan.admittedRowIndexes, [3, 1]);
  assert.equal(plan.bufferViewportHeightsAfter, 4);
});

test("stops one side at its nearest memory rejection instead of creating a hole", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2], [3]],
      rowBounds: rowBounds(3, 100),
      viewport: { top: 0, height: 100 },
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: "unlimited",
      pageBaseSizes: new Map([
        [1, { width: 100, height: 100 }],
        [2, { width: 1000, height: 1000 }],
        [3, { width: 100, height: 100 }],
      ]),
      settings: { ...input().settings, memoryLimitMiB: 1, allowDprReduction: false },
    }),
  );
  assert.deepEqual(plan.desiredPages, [1]);
  assert.deepEqual(plan.admittedRowIndexes, []);
});

test("zero-height finite viewports admit no optional rows while unlimited remains unbounded", () => {
  const base = {
    rows: [[1], [2], [3]],
    rowBounds: rowBounds(3, 100),
    viewport: { top: 100, height: 0 },
    visibleRange: { first: 1, last: 1 },
  } satisfies Partial<RenderPlannerInput>;
  assert.deepEqual(
    createRenderPlan(input({ ...base, maxBufferViewportHeights: 4 })).desiredPages,
    [2],
  );
  assert.deepEqual(
    createRenderPlan(input({ ...base, maxBufferViewportHeights: "unlimited" })).desiredPages,
    [2, 3, 1],
  );
});

test("retains committed pages outside a directional desired window when memory permits", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2], [3], [4], [5]],
      visibleRange: { first: 2, last: 2 },
      maxBufferViewportHeights: 0,
      motion: "forward",
      retainedCandidates: [{ page: 2, rowIndex: 1, bytes: 40_000 }],
      committedPageRenderDprs: new Map([[2, 1]]),
      committedPageBytes: new Map([[2, 40_000]]),
    }),
  );
  assert.deepEqual(plan.desiredPages, [3]);
  assert.deepEqual([...plan.retainedPages], [2]);
});

test("uses a common reduced DPR for mandatory visible pages", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1, 2]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      requestedDpr: 2,
      fallbackPageSize: { width: 1000, height: 1000 },
      settings: {
        memoryLimitMiB: 5,
        maxCanvasPixels: 24_000_000,
        maxCanvasDimension: 8192,
        maxConcurrentRenders: 3,
        minRenderDpr: 0.5,
        allowDprReduction: true,
        allowVisibleDirectRendering: false,
        memoryHysteresis: 0,
      },
    }),
  );
  assert.equal(plan.visibleDprReduced, true);
  assert.equal(plan.pageRenderDprs.get(1), plan.pageRenderDprs.get(2));
  assert.ok(plan.pageRenderDprs.get(1)! >= 0.5);
  assert.ok(plan.emergencyVisibleOverageBytes <= 1);
});

test("reduces concurrency before selecting direct visible rendering", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      fallbackPageSize: { width: 1200, height: 1200 },
      settings: {
        memoryLimitMiB: 5,
        maxCanvasPixels: 24_000_000,
        maxCanvasDimension: 8192,
        maxConcurrentRenders: 4,
        minRenderDpr: 1,
        allowDprReduction: false,
        allowVisibleDirectRendering: true,
        memoryHysteresis: 0,
      },
    }),
  );
  assert.equal(plan.maxConcurrentRenders, 1);
  assert.deepEqual([...plan.directRenderPages], [1]);
  assert.equal(plan.concurrencyReduced, true);
});

test("bounds concurrency reduction work by mandatory page count", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      fallbackPageSize: { width: 1200, height: 1200 },
      settings: {
        ...input().settings,
        maxConcurrentRenders: 1_000_000_000,
        allowDprReduction: false,
      },
    }),
  );

  assert.equal(plan.maxConcurrentRenders, 1);
  assert.equal(plan.concurrencyReduced, true);
});

test("selects direct rendering for first-time buffered pages independently of visible fallback policy", () => {
  const enabled = createRenderPlan(
    input({
      rows: [[1], [2], [3]],
      visibleRange: { first: 1, last: 1 },
      settings: { ...input().settings, allowVisibleDirectRendering: true },
    }),
  );
  const disabled = createRenderPlan(
    input({
      rows: [[1], [2], [3]],
      visibleRange: { first: 1, last: 1 },
    }),
  );

  assert.deepEqual([...enabled.directRenderPages], [3, 1]);
  assert.equal(enabled.directRenderPages.has(2), false);
  assert.deepEqual([...disabled.directRenderPages], [3, 1]);
});

test("does not duplicate a required readiness page when its row enters the buffer", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2], [3]],
      visibleRange: { first: 2, last: 2 },
      requiredPages: new Set([1]),
    }),
  );
  assert.equal(plan.desiredPages.filter(page => page === 1).length, 1);
});

test("keeps buffered and visible replacements on temporary canvases", () => {
  const plan = createRenderPlan(
    input({
      rows: [[2], [3]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: "unlimited",
      fallbackPageSize: { width: 1200, height: 1200 },
      committedPageRenderDprs: new Map([
        [2, 0.5],
        [3, 0.5],
      ]),
      committedPageBytes: new Map([
        [2, BYTES_PER_MIB],
        [3, BYTES_PER_MIB],
      ]),
      settings: {
        ...input().settings,
        memoryLimitMiB: 20,
        maxConcurrentRenders: 4,
        allowDprReduction: false,
        allowVisibleDirectRendering: true,
      },
    }),
  );

  assert.deepEqual(plan.desiredPages, [2, 3]);
  assert.equal(plan.directRenderPages.has(2), false);
  assert.equal(plan.directRenderPages.has(3), false);
});

test("includes old attached bytes in same-scale replacement peak", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      committedPageRenderDprs: new Map([[1, 0.75]]),
      committedPageBytes: new Map([[1, 60_000]]),
    }),
  );

  assert.equal(plan.estimatedSteadyBytes, 40_000);
  assert.equal(plan.estimatedPeakBytes, 100_000);
});

test("includes annotation backing stores in steady and replacement planning", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      committedPageRenderDprs: new Map([[1, 0.75]]),
      committedPageBytes: new Map([[1, 60_000]]),
      pageAdditionalBytes: new Map([[1, 20_000]]),
    }),
  );

  assert.equal(plan.estimatedSteadyBytes, 60_000);
  assert.equal(plan.estimatedPeakBytes, 120_000);
});

test("fixed placeholders remain allocated alongside their full temporary replacement", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      fixedOccupiedBytes: 60_000,
      fixedReplacementPageBytes: new Map([[1, 60_000]]),
      settings: {
        ...input().settings,
        allowVisibleDirectRendering: true,
      },
    }),
  );

  assert.equal(plan.directRenderPages.has(1), false);
  assert.equal(plan.estimatedSteadyBytes, 100_000);
  assert.equal(plan.estimatedPeakBytes, 140_000);
});

test("retains nearby committed pages only while peak memory fits", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1], [2], [3]],
      visibleRange: { first: 1, last: 1 },
      maxBufferViewportHeights: 0,
      retainedCandidates: [
        { page: 3, rowIndex: 2, bytes: 2 * BYTES_PER_MIB },
        { page: 1, rowIndex: 0, bytes: 4 * BYTES_PER_MIB },
      ],
    }),
  );
  assert.deepEqual([...plan.retainedPages], [3]);
  assert.equal(plan.evictedPageCount, 1);
});

test("does not retain off-window pages for inactive viewers", () => {
  const plan = createRenderPlan(
    input({
      maxBufferViewportHeights: 0,
      retainCommittedPages: false,
      retainedCandidates: [{ page: 1, rowIndex: 0, bytes: 1 }],
    }),
  );
  assert.equal(plan.retainedPageCount, 0);
});

test("caps each canvas independently below the aggregate memory quality floor", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      requestedDpr: 2,
      currentScale: 4,
      fallbackPageSize: { width: 612, height: 792 },
      settings: {
        memoryLimitMiB: 512,
        maxCanvasPixels: 24_000_000,
        maxCanvasDimension: 8192,
        maxConcurrentRenders: 3,
        minRenderDpr: 2,
        allowDprReduction: true,
        allowVisibleDirectRendering: false,
        memoryHysteresis: 0.1,
      },
    }),
  );

  const dpr = plan.pageRenderDprs.get(1)!;
  const width = Math.floor(612 * 4 * dpr);
  const height = Math.floor(792 * 4 * dpr);
  assert.ok(dpr < 2);
  assert.ok(width * height <= 24_000_000);
  assert.ok(width <= 8192 && height <= 8192);
  assert.deepEqual([...plan.canvasLimitPages], [1]);
  assert.equal(plan.memoryLimitPages.size, 0);
  assert.equal(plan.visibleDprReduced, false);
});

test("enforces the maximum canvas dimension independently of area", () => {
  const plan = createRenderPlan(
    input({
      rows: [[1]],
      visibleRange: { first: 0, last: 0 },
      maxBufferViewportHeights: 0,
      requestedDpr: 2,
      fallbackPageSize: { width: 5000, height: 100 },
      settings: {
        memoryLimitMiB: 512,
        maxCanvasPixels: 24_000_000,
        maxCanvasDimension: 8192,
        maxConcurrentRenders: 3,
        minRenderDpr: 2,
        allowDprReduction: true,
        allowVisibleDirectRendering: false,
        memoryHysteresis: 0.1,
      },
    }),
  );

  const dpr = plan.pageRenderDprs.get(1)!;
  assert.equal(dpr, 163 / 100);
  assert.deepEqual([...plan.canvasLimitPages], [1]);
});

test("constrained uniform render DPR is stable output identity", () => {
  const base = {
    rows: [[1]],
    visibleRange: { first: 0, last: 0 },
    maxBufferViewportHeights: 0,
    requestedDpr: 1,
    fallbackPageSize: { width: 4195, height: 5952 },
    settings: { ...input().settings, memoryLimitMiB: 512 },
  } satisfies Partial<RenderPlannerInput>;
  const initial = createRenderPlan(input(base));
  const dpr = initial.pageRenderDprs.get(1)!;
  const reused = createRenderPlan(input({ ...base, committedPageRenderDprs: new Map([[1, dpr]]) }));

  assert.ok(dpr < 1);
  assert.equal(reused.pageRenderDprs.get(1), dpr);
  assert.equal(reused.visibleQualityUpgradeCount, 0);
});

test("includes fixed occupied bytes without retaining or satisfying placeholders", () => {
  const plan = createRenderPlan(
    input({
      maxBufferViewportHeights: 0,
      fixedOccupiedBytes: 2 * BYTES_PER_MIB,
    }),
  );
  assert.equal(plan.estimatedSteadyBytes, 2 * BYTES_PER_MIB + 40_000);
  assert.equal(plan.estimatedPeakBytes, 2 * BYTES_PER_MIB + 80_000);
  assert.deepEqual(plan.desiredPages, [2]);
  assert.equal(plan.retainedPageCount, 0);
});
