// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  countPrintPages,
  countPrintSheets,
  estimatePrintBudget,
  estimatePrintPeakBytes,
  normalizePrintPageRanges,
  parsePrintPageRanges,
  planPrintSheetGeometry,
  planPrintSheets,
  planPrintDpiFit,
  resolvePermissionAwarePrintDpi,
  resolvePrintLayout,
  resolvePrintSheetSize,
  resolvePrintTransportGeometry,
} from "../../src/print-sheet-planner.js";

test("range parser validates and canonicalizes maximal runs", () => {
  assert.deepEqual(parsePrintPageRanges("9, 2-4, 3-6, 7, 12-16", 20), [
    { from: 2, to: 7 },
    { from: 9, to: 9 },
    { from: 12, to: 16 },
  ]);
  assert.deepEqual(
    normalizePrintPageRanges(
      [
        { from: 3, to: 3 },
        { from: 4, to: 4 },
      ],
      5,
    ),
    [{ from: 3, to: 4 }],
  );
  assert.throws(() => parsePrintPageRanges("4-2", 8), /ordered range/);
  assert.throws(() => parsePrintPageRanges("0,2", 8), /within pages/);
  assert.throws(() => parsePrintPageRanges("1,", 8), /malformed/);
});

test("right spreads preserve absolute parity and never pair across gaps", () => {
  const right = resolvePrintLayout({ mode: "spread", firstPageSide: "right", gapPt: 6 }, null);
  assert.deepEqual(
    planPrintSheets(
      [
        { from: 3, to: 4 },
        { from: 7, to: 7 },
      ],
      right,
    ),
    [
      { left: null, right: 3 },
      { left: 4, right: null },
      { left: null, right: 7 },
    ],
  );
  assert.deepEqual(planPrintSheets([{ from: 3, to: 7 }], right), [
    { left: null, right: 3 },
    { left: 4, right: 5 },
    { left: 6, right: 7 },
  ]);
  assert.equal(
    countPrintSheets(
      [
        { from: 3, to: 4 },
        { from: 7, to: 7 },
      ],
      right,
    ),
    3,
  );
  assert.equal(countPrintSheets([{ from: 3, to: 7 }], right), 3);
});

test("automatic layout requires a spread preference, complete geometry, and selected-sheet fit", () => {
  const a5 = { width: (148 * 72) / 25.4, height: (210 * 72) / 25.4 };
  const left = resolvePrintLayout({ mode: "auto" }, "two-left", [a5, a5]);
  assert.deepEqual(left, {
    mode: "spread",
    firstPageSide: "left",
    placement: "side-by-side",
    gapPt: 0,
  });
  assert.deepEqual(resolvePrintLayout({ mode: "auto" }, null), { mode: "single", gapPt: 0 });
  assert.deepEqual(resolvePrintLayout({ mode: "auto" }, "two-right", []), {
    mode: "single",
    gapPt: 0,
  });
  assert.deepEqual(resolvePrintLayout({ mode: "auto" }, "two-right", [a5, null]), {
    mode: "single",
    gapPt: 0,
  });
  assert.deepEqual(
    resolvePrintLayout({ mode: "spread", firstPageSide: "auto", gapPt: 0 }, "two-left"),
    { mode: "spread", firstPageSide: "left", placement: "side-by-side", gapPt: 0 },
  );
  assert.deepEqual(resolvePrintLayout({ mode: "spread", firstPageSide: "auto", gapPt: 0 }, null), {
    mode: "spread",
    firstPageSide: "right",
    placement: "side-by-side",
    gapPt: 0,
  });
  assert.deepEqual(resolvePrintLayout({ mode: "single" }, "two-left", [a5]), {
    mode: "single",
    gapPt: 0,
  });
});

test("fixed-sheet auto admits preferred spreads only when every page fits one physical slot", () => {
  const mm = (value: number) => (value * 72) / 25.4;
  const a5 = { width: mm(148), height: mm(210) };
  const a4 = { width: mm(210), height: mm(297) };
  assert.equal(
    resolvePrintLayout({ mode: "auto" }, "two-right", [a5, a5], "a4", "auto").mode,
    "spread",
  );
  assert.equal(
    resolvePrintLayout({ mode: "auto" }, "two-right", [a4, a4], "a4", "auto").mode,
    "single",
  );
  assert.equal(
    resolvePrintLayout({ mode: "auto" }, "two-right", [a4, a4], "a3", "auto").mode,
    "spread",
  );
  assert.equal(
    resolvePrintLayout({ mode: "auto" }, "two-right", [a5], "a4", "portrait").mode,
    "single",
  );
  assert.equal(
    resolvePrintLayout(
      { mode: "auto" },
      "two-right",
      [{ width: mm(149.5), height: mm(211) }],
      "a4",
      "auto",
    ).mode,
    "spread",
  );
  assert.equal(
    resolvePrintLayout(
      { mode: "auto" },
      "two-right",
      [{ width: mm(149.501), height: mm(211) }],
      "a4",
      "auto",
    ).mode,
    "single",
  );
  assert.equal(
    resolvePrintLayout(
      { mode: "auto" },
      "two-right",
      [{ width: mm(149.5), height: mm(211.001) }],
      "a4",
      "landscape",
    ).mode,
    "single",
  );
  assert.equal(
    resolvePrintLayout(
      { mode: "auto" },
      "two-right",
      [{ width: 152, height: 202 }],
      { width: 300, height: 200, unit: "pt" },
      "landscape",
    ).mode,
    "spread",
  );
  assert.equal(resolvePrintLayout({ mode: "auto" }, null, [a5], "a4", "auto").mode, "single");
});

test("fixed geometry maps two pages onto the selected landscape sheet", () => {
  const layout = resolvePrintLayout({ mode: "spread", firstPageSide: "right", gapPt: 8 }, null);
  const a5 = { width: 419.53, height: 595.28 };
  const size = resolvePrintSheetSize("a4", "auto", layout);
  assert.equal(size.width > size.height, true);
  const geometry = planPrintSheetGeometry(
    { left: 2, right: 3 },
    size,
    layout,
    page => (page === 2 ? a5 : { width: 700, height: 400 }),
    "fit",
  );
  assert.equal(geometry.slots[0]!.x >= 0, true);
  assert.equal(geometry.slots[0]!.x + geometry.slots[0]!.width <= size.width / 2, true);
  assert.equal(geometry.slots[1]!.x + geometry.slots[1]!.width <= size.width + 1e-9, true);
  assert.ok(Math.abs(geometry.slots[1]!.height / geometry.slots[1]!.width - 400 / 700) < 1e-12);
});

test("automatic spread placement stacks landscape source pages on portrait paper", () => {
  const landscapePage = { width: 595, height: 420 };
  const layout = resolvePrintLayout(
    { mode: "spread", firstPageSide: "right", gapPt: 10 },
    null,
    [landscapePage, landscapePage],
    "a4",
    "auto",
  );
  assert.equal(layout.mode, "spread");
  if (layout.mode !== "spread") return;
  assert.equal(layout.placement, "stacked");
  const sheet = resolvePrintSheetSize("a4", "auto", layout);
  assert.equal(sheet.width < sheet.height, true);
  const geometry = planPrintSheetGeometry(
    { left: 2, right: 3 },
    sheet,
    layout,
    () => landscapePage,
    "fit",
  );
  assert.equal(geometry.slots[0]!.x, geometry.slots[1]!.x);
  assert.equal(geometry.slots[0]!.y < geometry.slots[1]!.y, true);
  assert.ok(
    Math.abs(
      geometry.slots[0]!.width / geometry.slots[0]!.height -
        landscapePage.width / landscapePage.height,
    ) < 1e-12,
  );
});

test("spread singleton slots retain absolute left/right parity and gap", () => {
  const layout = resolvePrintLayout({ mode: "spread", firstPageSide: "right", gapPt: 20 }, null);
  const size = { width: 1_000, height: 500 };
  const sizeFor = () => ({ width: 490, height: 500 });
  const left = planPrintSheetGeometry({ left: 4, right: null }, size, layout, sizeFor, "fit");
  const right = planPrintSheetGeometry({ left: null, right: 3 }, size, layout, sizeFor, "fit");

  assert.equal(left.gapPt, 20);
  assert.deepEqual(left.slots, [{ x: 0, y: 0, width: 490, height: 500 }, null]);
  assert.equal(right.gapPt, 20);
  assert.deepEqual(right.slots, [null, { x: 510, y: 0, width: 490, height: 500 }]);
});

test("page scaling enlarges with fit but only reduces with shrink-to-fit and always centers", () => {
  const layout = resolvePrintLayout({ mode: "single" }, null);
  const sheet = { width: 600, height: 800 };
  const small = () => ({ width: 300, height: 400 });
  assert.deepEqual(
    planPrintSheetGeometry({ left: 1, right: null }, sheet, layout, small, "fit").slots[0],
    {
      x: 0,
      y: 0,
      width: 600,
      height: 800,
    },
  );
  assert.deepEqual(
    planPrintSheetGeometry({ left: 1, right: null }, sheet, layout, small, "shrink-to-fit")
      .slots[0],
    {
      x: 150,
      y: 200,
      width: 300,
      height: 400,
    },
  );
  const large = () => ({ width: 1_200, height: 800 });
  for (const scaling of ["fit", "shrink-to-fit"] as const) {
    assert.deepEqual(
      planPrintSheetGeometry({ left: 1, right: null }, sheet, layout, large, scaling).slots[0],
      {
        x: 0,
        y: 200,
        width: 600,
        height: 400,
      },
    );
  }
});

test("canonical paper presets use exact source dimensions before orientation", () => {
  const layout = resolvePrintLayout({ mode: "single" }, null);
  const closeTo = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  const expected = {
    a3: [(297 * 72) / 25.4, (420 * 72) / 25.4],
    a4: [(210 * 72) / 25.4, (297 * 72) / 25.4],
    a5: [(148 * 72) / 25.4, (210 * 72) / 25.4],
    letter: [8.5 * 72, 11 * 72],
    legal: [8.5 * 72, 14 * 72],
  } as const;
  for (const [preset, [width, height]] of Object.entries(expected)) {
    const portrait = resolvePrintSheetSize(preset as keyof typeof expected, "portrait", layout);
    closeTo(portrait.width, width);
    closeTo(portrait.height, height);
    const landscape = resolvePrintSheetSize(preset as keyof typeof expected, "landscape", layout);
    closeTo(landscape.width, height);
    closeTo(landscape.height, width);
  }
});

test("automatic single-page orientation follows selected source proportions", () => {
  const layout = resolvePrintLayout({ mode: "single" }, null);
  const portrait = resolvePrintSheetSize("a4", "auto", layout, [{ width: 420, height: 595 }]);
  const landscape = resolvePrintSheetSize("a4", "auto", layout, [{ width: 595, height: 420 }]);
  const explicitPortrait = resolvePrintSheetSize("a4", "portrait", layout, [
    { width: 595, height: 420 },
  ]);
  assert.equal(portrait.width < portrait.height, true);
  assert.equal(landscape.width > landscape.height, true);
  assert.equal(explicitPortrait.width < explicitPortrait.height, true);
});

test("portrait-only transport rotates only logical landscape sheets counterclockwise", () => {
  const landscape = { width: 842, height: 595 };
  assert.deepEqual(resolvePrintTransportGeometry(landscape, false), {
    size: { width: 595, height: 842 },
    rotatedCounterclockwise: true,
  });
  assert.deepEqual(resolvePrintTransportGeometry(landscape, true), {
    size: landscape,
    rotatedCounterclockwise: false,
  });
  const portrait = { width: 595, height: 842 };
  assert.deepEqual(resolvePrintTransportGeometry(portrait, false), {
    size: portrait,
    rotatedCounterclockwise: false,
  });
});

test("one print envelope admits decoded- and retained-dominant phase peaks before allocation", () => {
  const decodedLimits = { ...DEFAULT_LIMITS, memoryLimitMiB: 20 };
  const estimate = estimatePrintBudget(1, { width: 612, height: 792 }, 300, decodedLimits);
  assert.equal(estimate.accepted, false);
  assert.deepEqual(estimate.exceeded, ["memoryLimitMiB"]);
  assert.ok(estimate.decodedBytes > estimate.estimatedRetainedBytes);
  assert.equal(
    estimate.peakBytes,
    Math.ceil(
      Math.max(
        estimate.estimatedRetainedBytes +
          estimate.sheetScratchBytes +
          estimate.pageScratchBytes +
          Math.max(estimate.annotationScratchBytes, estimate.encodingScratchBytes),
        estimate.estimatedRetainedBytes + estimate.decodedBytes,
      ) *
        (1 + decodedLimits.safetyMarginRatio),
    ),
  );

  const retainedLimits = {
    ...DEFAULT_LIMITS,
    memoryLimitMiB: 5,
    estimatedEncodedBytesPerPixel: 16,
  };
  const retained = estimatePrintBudget(1, { width: 612, height: 792 }, 72, retainedLimits);
  assert.equal(retained.accepted, false);
  assert.deepEqual(retained.exceeded, ["memoryLimitMiB"]);
  assert.ok(retained.estimatedRetainedBytes > retained.decodedBytes);
});

test("preflight uses a zero raster baseline before exclusive eviction", () => {
  const limits = { ...DEFAULT_LIMITS, memoryLimitMiB: 134 };
  assert.deepEqual(
    planPrintDpiFit(1, { width: 612, height: 792 }, 300, limits),
    planPrintDpiFit(1, { width: 612, height: 792 }, 300, limits, 0),
  );
});

test("representative 20/100/250/500-job arithmetic remains allocation free", () => {
  const rows = [20, 100, 250, 500].map(sheetCount =>
    estimatePrintBudget(sheetCount, { width: 595.28, height: 841.89 }, 150),
  );
  assert.deepEqual(
    rows.map(row => row.sheetCount),
    [20, 100, 250, 500],
  );
  assert.equal(rows[0].accepted, true);
  assert.equal(
    rows.slice(1).every(row => !row.accepted),
    true,
  );
  assert.equal(rows[3].decodedBytes > 4_000_000_000, true);
});

test("actual Blob growth is checked against the same phase-aware envelope", () => {
  assert.equal(
    countPrintPages([
      { from: 2, to: 5 },
      { from: 9, to: 10 },
    ]),
    6,
  );
  const limits = { ...DEFAULT_LIMITS, memoryLimitMiB: 48 };
  const estimate = estimatePrintBudget(1, { width: 612, height: 792 }, 72, limits);
  assert.equal(estimate.accepted, true);
  const actualPeak = estimatePrintPeakBytes(estimate, 48 * 1024 * 1024, limits);
  assert.ok(actualPeak > limits.memoryLimitMiB * 1024 * 1024);
  assert.throws(() => estimatePrintPeakBytes(estimate, -1, DEFAULT_LIMITS), /non-negative/);
});

test("DPI fitting applies permissions and selects the highest safe integer", () => {
  assert.equal(resolvePermissionAwarePrintDpi({ dpi: 300 }, true), 300);
  assert.equal(resolvePermissionAwarePrintDpi({ dpi: 300 }, false), 150);
  assert.equal(resolvePermissionAwarePrintDpi({ dpi: 300 }, false), 150);
  const limits = {
    ...DEFAULT_LIMITS,
    maxCanvasDimension: 10_000,
    maxCanvasPixels: 20_000_000,
    memoryLimitMiB: 96,
  };
  const fit = planPrintDpiFit(1, { width: 612, height: 792 }, 300, limits);
  assert.equal(fit.resolvedDpi !== null && fit.resolvedDpi < 300 && fit.resolvedDpi >= 72, true);
  assert.equal(fit.reduced, true);
  assert.equal(fit.estimate.accepted, true);
  if (fit.resolvedDpi !== null)
    assert.equal(
      planPrintDpiFit(1, { width: 612, height: 792 }, fit.resolvedDpi + 1, limits).resolvedDpi,
      fit.resolvedDpi,
    );
});

test("shared 24 million pixel canvas safety preserves range while reducing only excessive DPI", () => {
  const limits = { ...DEFAULT_LIMITS, maxCanvasPixels: 24_000_000, maxCanvasDimension: 8192 };
  const a4 = { width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 };
  assert.equal(planPrintDpiFit(1, a4, 300, limits).resolvedDpi, 300);
  const high = planPrintDpiFit(1, a4, 900, limits);
  assert.ok(high.resolvedDpi !== null && high.resolvedDpi < 900);
  // Fitting changes raster quality only; caller-owned selected runs are never rewritten.
  assert.deepEqual(normalizePrintPageRanges([{ from: 2, to: 4 }], 8), [{ from: 2, to: 4 }]);
});

test("DPI fitting cannot weaken hard sheet limits and reports no-fit at 72 DPI", () => {
  const hard = { ...DEFAULT_LIMITS, maxSheets: 1 };
  const hardPlan = planPrintDpiFit(2, { width: 612, height: 792 }, 300, hard);
  assert.equal(hardPlan.resolvedDpi, null);
  assert.equal(hardPlan.hardLimitExceeded, true);
  const impossible = planPrintDpiFit(1, { width: 612, height: 792 }, 300, {
    ...DEFAULT_LIMITS,
    memoryLimitMiB: 0.1,
  });
  assert.equal(impossible.resolvedDpi, null);
  assert.equal(impossible.hardLimitExceeded, false);
});

const DEFAULT_LIMITS = {
  maxSheets: 350,
  maxCanvasDimension: 8192,
  maxCanvasPixels: 24_000_000,
  memoryLimitMiB: 768,
  maxAnnotationCanvasBytesPerPage: 32 * 1024 * 1024,
  estimatedEncodedBytesPerPixel: 0.5,
  encodingOverheadRatio: 1,
  safetyMarginRatio: 0.15,
  maxXfaPages: 350,
  maxXfaNodes: 500_000,
  maxXfaImages: 10_000,
  maxConcurrentImageDecodes: 4,
};
