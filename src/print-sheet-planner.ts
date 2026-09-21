// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public canonical owner of the package-root `parsePrintPageRanges` utility and
 * private DOM-free controlled-print sheet, geometry, and budget planning. The
 * emitted module remains an unsupported consumer subpath. It performs no PDF.js
 * work and allocates no raster resources. See the
 * [architecture guide](../ARCHITECTURE.md) for print ownership.
 * @packageDocumentation
 * @module print-sheet-planner
 */

import type {
  PdfjsViewerNormalizedPrintLayout,
  PdfjsViewerPrintPageRange,
  PdfjsViewerPrintPages,
  PdfjsViewerPrintSheet,
  PdfjsViewerNormalizedPrintOptions,
} from "./viewer-contracts.js";

type PrintCatalogPreference = "single" | "two-left" | "two-right" | null;
type PrintPageSide = "left" | "right";
type PrintSpreadPlacement = "side-by-side" | "stacked";
export type ResolvedPrintLayout = Readonly<
  | { mode: "single"; gapPt: 0 }
  | { mode: "spread"; firstPageSide: PrintPageSide; placement: PrintSpreadPlacement; gapPt: number }
>;
interface PrintLogicalSheet {
  readonly left: number | null;
  readonly right: number | null;
}
export interface PrintPageSize {
  readonly width: number;
  readonly height: number;
}
interface PrintTransportGeometry {
  readonly size: PrintPageSize;
  readonly rotatedCounterclockwise: boolean;
}
export interface PrintRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface PrintSheetGeometry {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly gapPt: number;
  readonly slots: readonly [PrintRect | null, PrintRect | null];
}
export interface PrintBudgetLimits {
  readonly maxSheets: number;
  readonly maxCanvasDimension: number;
  readonly maxCanvasPixels: number;
  /** Package-controlled print raster envelope in MiB, excluding browser/PDF.js/GPU process memory. */
  readonly memoryLimitMiB: number;
  readonly maxAnnotationCanvasBytesPerPage: number;
  readonly estimatedEncodedBytesPerPixel: number;
  readonly encodingOverheadRatio: number;
  readonly safetyMarginRatio: number;
  readonly maxXfaPages: number;
  readonly maxXfaNodes: number;
  readonly maxXfaImages: number;
  readonly maxConcurrentImageDecodes: number;
}
interface PrintBudgetEstimate {
  readonly sheetCount: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly pixelsPerSheet: number;
  readonly decodedBytes: number;
  readonly estimatedRetainedBytes: number;
  readonly pageScratchBytes: number;
  readonly sheetScratchBytes: number;
  readonly annotationScratchBytes: number;
  readonly encodingScratchBytes: number;
  readonly peakBytes: number;
  readonly accepted: boolean;
  readonly exceeded: readonly (keyof PrintBudgetLimits)[];
}
interface PrintDpiFitPlan {
  readonly requestedDpi: number;
  readonly resolvedDpi: number | null;
  readonly reduced: boolean;
  readonly estimate: Readonly<PrintBudgetEstimate>;
  readonly hardLimitExceeded: boolean;
}

/** Allows up to one millimetre of PDF-producer rounding on each automatic-spread edge. */
const AUTO_SPREAD_EDGE_EPSILON_PT = 72 / 25.4;

/** Legacy internal fallback only; public defaults are profile-owned. */
export const DEFAULT_PRINT_BUDGET_LIMITS: Readonly<PrintBudgetLimits> = Object.freeze({
  maxSheets: 350,
  maxCanvasDimension: 8192,
  maxCanvasPixels: 24_000_000,
  memoryLimitMiB: 768,
  maxAnnotationCanvasBytesPerPage: 32 * 1024 * 1024,
  // Conservative photographic-page evidence assumption. Actual Blob bytes remain authoritative.
  estimatedEncodedBytesPerPixel: 0.5,
  encodingOverheadRatio: 1,
  safetyMarginRatio: 0.15,
  maxXfaPages: 350,
  maxXfaNodes: 500_000,
  maxXfaImages: 10_000,
  maxConcurrentImageDecodes: 4,
});

/** Applies PDF print-quality permission policy before budget fitting. */
export function resolvePermissionAwarePrintDpi(
  quality: PdfjsViewerNormalizedPrintOptions["quality"],
  highQualityAllowed: boolean,
): number {
  const requested = Math.floor(quality.dpi);
  return highQualityAllowed ? requested : Math.min(requested, 150);
}

/** Parses browser-familiar `2-6, 9` syntax and returns canonical maximal runs. */
export function parsePrintPageRanges(
  input: string,
  pageCount: number,
): readonly PdfjsViewerPrintPageRange[] {
  if (typeof input !== "string")
    throw new TypeError("PdfjsViewer: print page range must be a string");
  const pieces = input.split(",").map(piece => piece.trim());
  if (!pieces.length || pieces.some(piece => !piece))
    throw new RangeError("PdfjsViewer: print page range is empty or malformed");
  const ranges = pieces.map((piece, index) => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (!match)
      throw new RangeError(`PdfjsViewer: print page range item ${index + 1} is malformed`);
    return { from: Number(match[1]), to: Number(match[2] ?? match[1]) };
  });
  const normalized = normalizePrintPageRanges(ranges, pageCount);
  if (normalized === "all")
    throw new Error("PdfjsViewer: parsed print ranges cannot normalize to all");
  return normalized;
}

/** Validates, sorts, merges overlap/adjacency, and freezes inclusive ranges. */
export function normalizePrintPageRanges(
  pages: PdfjsViewerPrintPages,
  pageCount: number,
): "all" | readonly PdfjsViewerPrintPageRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1)
    throw new RangeError("PdfjsViewer: print page count must be positive");
  if (pages === "all") return "all";
  if (!Array.isArray(pages) || !pages.length)
    throw new TypeError('PdfjsViewer: print.pages must be "all" or a non-empty array of ranges');
  const ranges = pages
    .map((range, index) => {
      if (!range || typeof range !== "object" || Array.isArray(range))
        throw new TypeError(`PdfjsViewer: print.pages[${index}] must be an object`);
      for (const key of Object.keys(range))
        if (key !== "from" && key !== "to")
          throw new TypeError(`PdfjsViewer: unknown print.pages[${index}].${key} option`);
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to))
        throw new TypeError(`PdfjsViewer: print.pages[${index}] from and to must be integers`);
      if (range.from < 1 || range.to < range.from || range.to > pageCount)
        throw new RangeError(
          `PdfjsViewer: print.pages[${index}] must be an ordered range within pages 1-${pageCount}`,
        );
      return { from: range.from, to: range.to };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to + 1) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return Object.freeze(merged.map(range => Object.freeze(range)));
}

export function selectedPrintRuns(
  pages: PdfjsViewerPrintPages,
  pageCount: number,
): readonly PdfjsViewerPrintPageRange[] {
  const normalized = normalizePrintPageRanges(pages, pageCount);
  return normalized === "all"
    ? Object.freeze([Object.freeze({ from: 1, to: pageCount })])
    : normalized;
}

/** Counts selected logical pages without materializing a per-page collection. */
export function countPrintPages(runs: readonly PdfjsViewerPrintPageRange[]): number {
  let count = 0;
  for (const run of runs) count += run.to - run.from + 1;
  return count;
}

export function resolvePrintLayout(
  layout: PdfjsViewerNormalizedPrintLayout,
  preference: PrintCatalogPreference,
  selectedExactSizes: readonly (PrintPageSize | null)[] = [],
  sheet: PdfjsViewerPrintSheet = "a4",
  orientation: "auto" | "portrait" | "landscape" = "auto",
): ResolvedPrintLayout {
  if (layout.mode === "single") return Object.freeze({ mode: "single", gapPt: 0 });
  const firstPageSide =
    layout.mode === "auto"
      ? preference === "two-left"
        ? "left"
        : "right"
      : layout.firstPageSide === "auto"
        ? preference === "two-left"
          ? "left"
          : preference === "two-right"
            ? "right"
            : "right"
        : layout.firstPageSide;
  const sizes = selectedExactSizes.every(
    (size): size is PrintPageSize =>
      !!size &&
      Number.isFinite(size.width) &&
      size.width > 0 &&
      Number.isFinite(size.height) &&
      size.height > 0,
  )
    ? selectedExactSizes
    : [];
  const gapPt = layout.mode === "spread" ? layout.gapPt : 0;
  let placement: PrintSpreadPlacement;
  if (orientation === "portrait") placement = "stacked";
  else if (orientation === "landscape") placement = "side-by-side";
  else
    placement =
      sizes.length &&
      spreadPlacementScale("stacked", sizes, sheet, gapPt) >
        spreadPlacementScale("side-by-side", sizes, sheet, gapPt)
        ? "stacked"
        : "side-by-side";
  const spread = Object.freeze({ mode: "spread" as const, firstPageSide, placement, gapPt });
  if (layout.mode === "spread") return spread;
  if ((preference !== "two-left" && preference !== "two-right") || !sizes.length)
    return Object.freeze({ mode: "single", gapPt: 0 });

  const sheetSize = resolvePrintSheetSize(sheet, orientation, spread);
  const slot = spreadSlotSize(sheetSize, placement, gapPt);
  const fits =
    slot.width > 0 &&
    slot.height > 0 &&
    sizes.every(
      size =>
        size.width <= slot.width + AUTO_SPREAD_EDGE_EPSILON_PT &&
        size.height <= slot.height + AUTO_SPREAD_EDGE_EPSILON_PT,
    );
  return fits ? spread : Object.freeze({ mode: "single", gapPt: 0 });
}

function spreadPlacementScale(
  placement: PrintSpreadPlacement,
  sizes: readonly PrintPageSize[],
  sheet: PdfjsViewerPrintSheet,
  gapPt: number,
): number {
  const layout = { mode: "spread" as const, firstPageSide: "right" as const, placement, gapPt };
  const slot = spreadSlotSize(resolvePrintSheetSize(sheet, "auto", layout), placement, gapPt);
  let minimum = Infinity;
  for (const size of sizes)
    minimum = Math.min(minimum, slot.width / size.width, slot.height / size.height);
  return minimum;
}

function spreadSlotSize(
  sheetSize: PrintPageSize,
  placement: PrintSpreadPlacement,
  gapPt: number,
): PrintPageSize {
  return placement === "stacked"
    ? { width: sheetSize.width, height: Math.max(0, sheetSize.height - gapPt) / 2 }
    : { width: Math.max(0, sheetSize.width - gapPt) / 2, height: sheetSize.height };
}

/** Plans sheets independently for each selected run; absolute page parity determines slots. */
export function planPrintSheets(
  runs: readonly PdfjsViewerPrintPageRange[],
  layout: ReturnType<typeof resolvePrintLayout>,
): readonly Readonly<PrintLogicalSheet>[] {
  const sheets: PrintLogicalSheet[] = [];
  for (const run of runs) {
    if (layout.mode === "single") {
      for (let page = run.from; page <= run.to; page++) sheets.push({ left: page, right: null });
      continue;
    }
    const leftParity = layout.firstPageSide === "left" ? 1 : 0;
    let page = run.from;
    if (page % 2 !== leftParity) sheets.push({ left: null, right: page++ });
    while (page <= run.to) {
      const left = page++;
      const right = page <= run.to ? page++ : null;
      sheets.push({ left, right });
    }
  }
  return Object.freeze(sheets.map(sheet => Object.freeze(sheet)));
}

/** Counts output sheets arithmetically before any per-sheet or per-page array exists. */
export function countPrintSheets(
  runs: readonly PdfjsViewerPrintPageRange[],
  layout: ReturnType<typeof resolvePrintLayout>,
): number {
  let count = 0;
  for (const run of runs) {
    const pages = run.to - run.from + 1;
    if (layout.mode === "single") count += pages;
    else {
      const leftParity = layout.firstPageSide === "left" ? 1 : 0;
      const leadingBlank = run.from % 2 !== leftParity ? 1 : 0;
      count += Math.ceil((pages + leadingBlank) / 2);
    }
  }
  return count;
}

const points = (value: number, unit: "pt" | "mm" | "in") =>
  value * (unit === "pt" ? 1 : unit === "mm" ? 72 / 25.4 : 72);
const PRINT_SHEET_PRESETS = Object.freeze({
  a3: Object.freeze({ width: points(297, "mm"), height: points(420, "mm") }),
  a4: Object.freeze({ width: points(210, "mm"), height: points(297, "mm") }),
  a5: Object.freeze({ width: points(148, "mm"), height: points(210, "mm") }),
  letter: Object.freeze({ width: points(8.5, "in"), height: points(11, "in") }),
  legal: Object.freeze({ width: points(8.5, "in"), height: points(14, "in") }),
});

/** Resolves the job-wide logical sheet selected by the caller. */
export function resolvePrintSheetSize(
  sheet: PdfjsViewerPrintSheet,
  orientation: "auto" | "portrait" | "landscape",
  layout: ReturnType<typeof resolvePrintLayout>,
  selectedSizes: readonly PrintPageSize[] = [],
): Readonly<PrintPageSize> {
  let width: number;
  let height: number;
  if (typeof sheet === "string") ({ width, height } = PRINT_SHEET_PRESETS[sheet]);
  else [width, height] = [points(sheet.width, sheet.unit), points(sheet.height, sheet.unit)];
  let target: "portrait" | "landscape";
  if (orientation !== "auto") target = orientation;
  else if (layout.mode === "spread")
    target = layout.placement === "stacked" ? "portrait" : "landscape";
  else
    target =
      selectedSizes.length &&
      singleSheetScale("landscape", width, height, selectedSizes) >
        singleSheetScale("portrait", width, height, selectedSizes)
        ? "landscape"
        : "portrait";
  if ((target === "landscape" && width < height) || (target === "portrait" && width > height))
    [width, height] = [height, width];
  return Object.freeze({ width, height });
}

function singleSheetScale(
  orientation: "portrait" | "landscape",
  width: number,
  height: number,
  sizes: readonly PrintPageSize[],
): number {
  const sheetWidth =
    orientation === "landscape" ? Math.max(width, height) : Math.min(width, height);
  const sheetHeight =
    orientation === "landscape" ? Math.min(width, height) : Math.max(width, height);
  let minimum = Infinity;
  for (const size of sizes)
    minimum = Math.min(minimum, sheetWidth / size.width, sheetHeight / size.height);
  return minimum;
}

/** Converts a logical landscape sheet into counterclockwise-rotated portrait browser transport when required. */
export function resolvePrintTransportGeometry(
  logicalSize: PrintPageSize,
  landscapeSupported: boolean,
): Readonly<PrintTransportGeometry> {
  const rotatedCounterclockwise = !landscapeSupported && logicalSize.width > logicalSize.height;
  return Object.freeze({
    size: Object.freeze(
      rotatedCounterclockwise
        ? { width: logicalSize.height, height: logicalSize.width }
        : { width: logicalSize.width, height: logicalSize.height },
    ),
    rotatedCounterclockwise,
  });
}

function contain(
  size: PrintPageSize,
  slot: PrintRect,
  pageScaling: PdfjsViewerNormalizedPrintOptions["pageScaling"],
): PrintRect {
  const containScale = Math.min(slot.width / size.width, slot.height / size.height);
  const scale = pageScaling === "shrink-to-fit" ? Math.min(1, containScale) : containScale;
  const width = size.width * scale;
  const height = size.height * scale;
  return Object.freeze({
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  });
}

/** Contains logical pages in fixed physical slots without clipping or aspect distortion. */
export function planPrintSheetGeometry(
  sheet: PrintLogicalSheet,
  sheetSize: PrintPageSize,
  layout: ResolvedPrintLayout,
  sizeFor: (pageNo: number) => PrintPageSize,
  pageScaling: PdfjsViewerNormalizedPrintOptions["pageScaling"],
): Readonly<PrintSheetGeometry> {
  const spread = layout.mode === "spread";
  const gapPt = spread ? layout.gapPt : 0;
  const stacked = spread && layout.placement === "stacked";
  const usableWidth = Math.max(0, sheetSize.width - (spread && !stacked ? gapPt : 0));
  const usableHeight = Math.max(0, sheetSize.height - (stacked ? gapPt : 0));
  const leftSlot = {
    x: 0,
    y: 0,
    width: spread && !stacked ? usableWidth / 2 : sheetSize.width,
    height: stacked ? usableHeight / 2 : sheetSize.height,
  };
  const rightSlot = stacked
    ? { x: 0, y: usableHeight / 2 + gapPt, width: sheetSize.width, height: usableHeight / 2 }
    : { x: usableWidth / 2 + gapPt, y: 0, width: usableWidth / 2, height: sheetSize.height };
  return Object.freeze({
    widthPt: sheetSize.width,
    heightPt: sheetSize.height,
    gapPt: spread ? gapPt : 0,
    slots: Object.freeze([
      sheet.left === null ? null : contain(sizeFor(sheet.left), leftSlot, pageScaling),
      sheet.right === null ? null : contain(sizeFor(sheet.right), rightSlot, pageScaling),
    ]) as readonly [PrintRect | null, PrintRect | null],
  });
}

/** Computes allocation-free package-controlled print raster memory cost. */
export function estimatePrintBudget(
  sheetCount: number,
  sheetSize: PrintPageSize,
  dpi: number,
  limits: PrintBudgetLimits = DEFAULT_PRINT_BUDGET_LIMITS,
  residualBaselineBytes = 0,
): Readonly<PrintBudgetEstimate> {
  if (!Number.isFinite(residualBaselineBytes) || residualBaselineBytes < 0) {
    throw new RangeError("PdfjsViewer: residual baseline bytes must be finite and non-negative");
  }
  const canvasWidth = Math.ceil((sheetSize.width * dpi) / 72);
  const canvasHeight = Math.ceil((sheetSize.height * dpi) / 72);
  const pixelsPerSheet = canvasWidth * canvasHeight;
  const decodedBytes = pixelsPerSheet * 4 * sheetCount;
  const estimatedRetainedBytes = Math.ceil(
    pixelsPerSheet * sheetCount * limits.estimatedEncodedBytesPerPixel,
  );
  const sheetScratchBytes = pixelsPerSheet * 4;
  const pageScratchBytes = pixelsPerSheet * 4;
  const annotationScratchBytes = limits.maxAnnotationCanvasBytesPerPage;
  const encodingScratchBytes = Math.ceil(
    pixelsPerSheet * limits.estimatedEncodedBytesPerPixel * limits.encodingOverheadRatio,
  );
  // Preparation and native invocation are exclusive phases. Blob sources remain owned
  // through native printing so cross-browser image loading cannot outlive their URLs.
  const preparationPeak =
    estimatedRetainedBytes +
    sheetScratchBytes +
    pageScratchBytes +
    Math.max(annotationScratchBytes, encodingScratchBytes);
  const invocationPeak = estimatedRetainedBytes + decodedBytes;
  const peakWithoutMargin = Math.max(preparationPeak, invocationPeak);
  const peakBytes = Math.ceil(
    (peakWithoutMargin + residualBaselineBytes) * (1 + limits.safetyMarginRatio),
  );
  const exceeded: (keyof PrintBudgetLimits)[] = [];
  if (sheetCount > limits.maxSheets) exceeded.push("maxSheets");
  if (Math.max(canvasWidth, canvasHeight) > limits.maxCanvasDimension)
    exceeded.push("maxCanvasDimension");
  if (pixelsPerSheet > limits.maxCanvasPixels) exceeded.push("maxCanvasPixels");
  if (peakBytes > limits.memoryLimitMiB * 1024 * 1024) exceeded.push("memoryLimitMiB");
  return Object.freeze({
    sheetCount,
    canvasWidth,
    canvasHeight,
    pixelsPerSheet,
    decodedBytes,
    estimatedRetainedBytes,
    pageScratchBytes,
    sheetScratchBytes,
    annotationScratchBytes,
    encodingScratchBytes,
    peakBytes,
    accepted: !exceeded.length,
    exceeded: Object.freeze(exceeded),
  });
}

/** Replaces estimated encoded retention with observed/projected Blob bytes. */
export function estimatePrintPeakBytes(
  estimate: PrintBudgetEstimate,
  retainedBytes: number,
  limits: PrintBudgetLimits,
  residualBaselineBytes = 0,
): number {
  if (
    !Number.isFinite(retainedBytes) ||
    retainedBytes < 0 ||
    !Number.isFinite(residualBaselineBytes) ||
    residualBaselineBytes < 0
  ) {
    throw new RangeError(
      "PdfjsViewer: retained print and residual baseline bytes must be finite and non-negative",
    );
  }
  const preparationPeak =
    retainedBytes +
    estimate.sheetScratchBytes +
    estimate.pageScratchBytes +
    Math.max(estimate.annotationScratchBytes, estimate.encodingScratchBytes);
  const invocationPeak = retainedBytes + estimate.decodedBytes;
  const peakWithoutMargin = Math.max(preparationPeak, invocationPeak);
  return Math.ceil((peakWithoutMargin + residualBaselineBytes) * (1 + limits.safetyMarginRatio));
}

/** Finds the highest budget-safe integer DPI without weakening hard sheet limits. */
export function planPrintDpiFit(
  sheetCount: number,
  sheetSize: PrintPageSize,
  requestedDpi: number,
  limits: PrintBudgetLimits = DEFAULT_PRINT_BUDGET_LIMITS,
  residualBaselineBytes = 0,
): Readonly<PrintDpiFitPlan> {
  if (!Number.isFinite(requestedDpi) || requestedDpi < 72) {
    throw new RangeError("PdfjsViewer: requested print DPI must be finite and at least 72");
  }
  const requested = Math.floor(requestedDpi);
  const initial = estimatePrintBudget(
    sheetCount,
    sheetSize,
    requested,
    limits,
    residualBaselineBytes,
  );
  if (initial.exceeded.includes("maxSheets")) {
    return Object.freeze({
      requestedDpi: requested,
      resolvedDpi: null,
      reduced: false,
      estimate: initial,
      hardLimitExceeded: true,
    });
  }
  if (initial.accepted) {
    return Object.freeze({
      requestedDpi: requested,
      resolvedDpi: requested,
      reduced: false,
      estimate: initial,
      hardLimitExceeded: false,
    });
  }
  for (let dpi = requested - 1; dpi >= 72; dpi--) {
    const estimate = estimatePrintBudget(sheetCount, sheetSize, dpi, limits, residualBaselineBytes);
    if (estimate.accepted) {
      return Object.freeze({
        requestedDpi: requested,
        resolvedDpi: dpi,
        reduced: true,
        estimate,
        hardLimitExceeded: false,
      });
    }
  }
  return Object.freeze({
    requestedDpi: requested,
    resolvedDpi: null,
    reduced: false,
    estimate: estimatePrintBudget(sheetCount, sheetSize, 72, limits, residualBaselineBytes),
    hardLimitExceeded: false,
  });
}
