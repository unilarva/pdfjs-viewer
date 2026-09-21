// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure raster-memory and directional buffering planning for `DocumentRenderer`.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * This module deliberately knows nothing about the DOM, PDF.js proxies, or a
 * {@link PdfjsViewer} instance. `DocumentRenderer` snapshots mutable view and
 * output state into {@link RenderPlannerInput}; the planner returns pages, DPRs,
 * execution strategy, retention, concurrency, and steady/transition memory
 * estimates for one reconciliation pass. One total optional viewport-distance
 * budget and an independent page-count ceiling select whole rows from stationary
 * or directional motion policy. Keeping this policy pure makes its ordering and
 * pressure behavior directly testable.
 * Placeholder/direct transitional occupancy enters as fixed bytes; per-page
 * placeholder identity additionally preserves safe replacement and exact transition peaks.
 * Transitional output never becomes desired or retained output. See the
 * [architecture guide](../ARCHITECTURE.md) for the authoritative rendering procedure.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module render-planner
 */

/** Inputs needed by the deterministic raster-memory planner. */
export type RenderMotion = "backward" | "stationary" | "forward";

/** Detached topology, geometry, resource policy, and current output facts. */
export interface RenderPlannerInput {
  rows: readonly (readonly number[])[];
  rowBounds: readonly Readonly<{ top: number; bottom: number }>[];
  viewport: Readonly<{ top: number; height: number }>;
  visibleRange: Readonly<{ first: number; last: number }>;
  /** Initial visible pages that remain mandatory until first readiness. */
  requiredPages?: ReadonlySet<number>;
  maxBufferViewportHeights: number | "unlimited";
  /** Maximum optional pages admitted into the desired window. */
  maxBufferPages: number | "unlimited";
  motion: RenderMotion;
  requestedDpr: number;
  currentScale: number;
  pageBaseSizes: ReadonlyMap<number, Readonly<{ width: number; height: number }>>;
  fallbackPageSize: Readonly<{ width: number; height: number }>;
  settings: Readonly<{
    memoryLimitMiB: number;
    maxCanvasPixels: number;
    maxCanvasDimension: number;
    maxConcurrentRenders: number;
    minRenderDpr: number;
    allowDprReduction: boolean;
    allowVisibleDirectRendering: boolean;
    memoryHysteresis: number;
  }>;
  retainCommittedPages: boolean;
  retainedCandidates: readonly Readonly<{ page: number; rowIndex: number; bytes: number }>[];
  committedPageRenderDprs: ReadonlyMap<number, number>;
  /** Attached same-scale raster bytes that remain allocated during replacement. */
  committedPageBytes?: ReadonlyMap<number, number>;
  /** Best-known non-page-canvas backing stores retained by each desired page. */
  pageAdditionalBytes?: ReadonlyMap<number, number>;
  /** Old-scale placeholder bytes already included in fixed occupancy but requiring safe replacement. */
  fixedReplacementPageBytes?: ReadonlyMap<number, number>;
  /** Occupied raster bytes that cannot satisfy or be retained by this plan. */
  fixedOccupiedBytes: number;
}

/** Complete output of one render-planning pass. */
export interface RenderPlan {
  desiredPages: number[];
  admittedRowIndexes: number[];
  retainedPages: Set<number>;
  visiblePages: Set<number>;
  pageRenderDprs: Map<number, number>;
  directRenderPages: Set<number>;
  canvasLimitPages: Set<number>;
  memoryLimitPages: Set<number>;
  maxConcurrentRenders: number;
  estimatedSteadyBytes: number;
  estimatedPeakBytes: number;
  emergencyVisibleOverageBytes: number;
  bufferRowsBefore: number;
  bufferRowsAfter: number;
  bufferPageCount: number;
  bufferPageLimitReached: boolean;
  bufferViewportHeightsBefore: number;
  bufferViewportHeightsAfter: number;
  visibleDprReduced: boolean;
  optionalDprReduced: boolean;
  concurrencyReduced: boolean;
  retainedPageCount: number;
  evictedPageCount: number;
  visibleQualityUpgradeCount: number;
}

/** Exact integer backing-store geometry for one CSS-space raster target. */
export interface RasterDimensions {
  readonly width: number;
  readonly height: number;
  readonly renderDpr: number;
  readonly canvasLimited: boolean;
}

/**
 * Resolves one uniform PDF.js render DPR and its integer backing dimensions.
 * Unconstrained output rounds up so fractional CSS edges are never clipped;
 * constrained output rounds down to preserve hard dimension and area limits.
 * Unconstrained integer coverage never inflates the semantic render DPR;
 * constrained integer limits may lower it to the final safe uniform value.
 */
export function resolveRasterDimensions(
  cssWidth: number,
  cssHeight: number,
  requestedDpr: number,
  maxCanvasPixels: number,
  maxCanvasDimension: number,
): Readonly<RasterDimensions> {
  const safeCssWidth = Math.max(1, cssWidth);
  const safeCssHeight = Math.max(1, cssHeight);
  const safeRequestedDpr = Number.isFinite(requestedDpr) && requestedDpr > 0 ? requestedDpr : 1;
  const targetWidth = Math.max(1, Math.ceil(Math.fround(safeCssWidth * safeRequestedDpr)));
  const targetHeight = Math.max(1, Math.ceil(Math.fround(safeCssHeight * safeRequestedDpr)));
  const targetFits =
    targetWidth <= maxCanvasDimension &&
    targetHeight <= maxCanvasDimension &&
    targetWidth * targetHeight <= maxCanvasPixels;
  if (targetFits) {
    return Object.freeze({
      width: targetWidth,
      height: targetHeight,
      renderDpr: safeRequestedDpr,
      canvasLimited: false,
    });
  }

  const canvasSafeDpr = Math.min(
    safeRequestedDpr,
    maxCanvasDimension / safeCssWidth,
    maxCanvasDimension / safeCssHeight,
    Math.sqrt(maxCanvasPixels / (safeCssWidth * safeCssHeight)),
  );
  let width = Math.max(
    1,
    Math.min(maxCanvasDimension, Math.floor(Math.fround(safeCssWidth * canvasSafeDpr))),
  );
  let height = Math.max(
    1,
    Math.min(
      maxCanvasDimension,
      Math.floor(Math.fround(safeCssHeight * canvasSafeDpr)),
      Math.floor(maxCanvasPixels / width),
    ),
  );
  width = Math.max(1, Math.min(width, Math.floor(maxCanvasPixels / height)));
  let renderDpr = Math.min(safeRequestedDpr, width / safeCssWidth, height / safeCssHeight);
  width = Math.max(1, Math.min(width, Math.ceil(Math.fround(safeCssWidth * renderDpr))));
  height = Math.max(
    1,
    Math.min(
      height,
      Math.ceil(Math.fround(safeCssHeight * renderDpr)),
      Math.floor(maxCanvasPixels / width),
    ),
  );
  width = Math.max(1, Math.min(width, Math.floor(maxCanvasPixels / height)));
  renderDpr = Math.min(renderDpr, width / safeCssWidth, height / safeCssHeight);
  return Object.freeze({
    width,
    height,
    renderDpr,
    canvasLimited: true,
  });
}

const BYTES_PER_MIB = 1024 * 1024;
const DPR_EPSILON = 1e-6;
const DPR_SEARCH_ITERATIONS = 40;

/** Geometry-only input for selecting directional row candidates. */
interface RenderBufferWindowInput {
  readonly rowBounds: readonly Readonly<{ top: number; bottom: number }>[];
  readonly visibleRange: Readonly<{ first: number; last: number }>;
  readonly viewport: Readonly<{ top: number; height: number }>;
  readonly maxBufferViewportHeights: number | "unlimited";
  /** Optional scan bound; planner callers derive it from the page ceiling. */
  readonly maxCandidateRowsPerSide?: number | "unlimited";
  readonly motion: RenderMotion;
}

/** Selects contiguous whole-row candidates from one directional CSS-distance budget. */
export function selectRenderBufferWindow(input: Readonly<RenderBufferWindowInput>): Readonly<{
  before: readonly number[];
  after: readonly number[];
  viewportTop: number;
  viewportBottom: number;
  viewportHeight: number;
}> {
  const { first, last } = input.visibleRange;
  const viewportTop = Number.isFinite(input.viewport.top) ? input.viewport.top : 0;
  const viewportHeight =
    Number.isFinite(input.viewport.height) && input.viewport.height > 0 ? input.viewport.height : 0;
  const viewportBottom = viewportTop + viewportHeight;
  const unlimitedDistance = input.maxBufferViewportHeights === "unlimited";
  const finiteViewportHeights =
    typeof input.maxBufferViewportHeights === "number" &&
    Number.isFinite(input.maxBufferViewportHeights) &&
    input.maxBufferViewportHeights > 0
      ? input.maxBufferViewportHeights
      : 0;
  const totalBufferPixels = unlimitedDistance
    ? Number.POSITIVE_INFINITY
    : finiteViewportHeights * viewportHeight;
  const maxCandidateRows =
    input.maxCandidateRowsPerSide === "unlimited" || input.maxCandidateRowsPerSide == null
      ? Number.POSITIVE_INFINITY
      : Number.isSafeInteger(input.maxCandidateRowsPerSide) && input.maxCandidateRowsPerSide >= 0
        ? input.maxCandidateRowsPerSide
        : 0;
  if (!Number.isFinite(totalBufferPixels)) {
    const beforeCount = Math.min(Math.max(0, first), maxCandidateRows);
    const afterCount = Math.min(Math.max(0, input.rowBounds.length - last - 1), maxCandidateRows);
    return Object.freeze({
      before: Object.freeze(Array.from({ length: beforeCount }, (_, offset) => first - 1 - offset)),
      after: Object.freeze(Array.from({ length: afterCount }, (_, offset) => last + 1 + offset)),
      viewportTop,
      viewportBottom,
      viewportHeight,
    });
  }
  const availableBeforePixels =
    first > 0 && input.rowBounds.length ? Math.max(0, viewportTop - input.rowBounds[0]!.top) : 0;
  const availableAfterPixels =
    last + 1 < input.rowBounds.length
      ? Math.max(0, input.rowBounds.at(-1)!.bottom - viewportBottom)
      : 0;
  const leadingBudget = (totalBufferPixels * 2) / 3;
  let allocatedBefore =
    input.motion === "backward"
      ? leadingBudget
      : input.motion === "forward"
        ? totalBufferPixels - leadingBudget
        : totalBufferPixels / 2;
  let allocatedAfter = totalBufferPixels - allocatedBefore;
  allocatedBefore = Math.min(allocatedBefore, availableBeforePixels);
  allocatedAfter = Math.min(allocatedAfter, availableAfterPixels);
  let unallocated = totalBufferPixels - allocatedBefore - allocatedAfter;
  const topUp = (side: "before" | "after"): void => {
    if (!(unallocated > 0)) return;
    if (side === "before") {
      const added = Math.min(unallocated, availableBeforePixels - allocatedBefore);
      allocatedBefore += added;
      unallocated -= added;
    } else {
      const added = Math.min(unallocated, availableAfterPixels - allocatedAfter);
      allocatedAfter += added;
      unallocated -= added;
    }
  };
  if (input.motion === "backward") {
    topUp("before");
    topUp("after");
  } else {
    topUp("after");
    topUp("before");
  }
  const before: number[] = [];
  const after: number[] = [];
  if (totalBufferPixels > 0) {
    const beforeBoundary = viewportTop - allocatedBefore;
    const afterBoundary = viewportBottom + allocatedAfter;
    for (let rowIndex = first - 1; rowIndex >= 0; rowIndex--) {
      if (before.length >= maxCandidateRows) break;
      const bounds = input.rowBounds[rowIndex];
      if (!bounds || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom)) break;
      if (bounds.bottom <= beforeBoundary) break;
      before.push(rowIndex);
    }
    for (let rowIndex = last + 1; rowIndex < input.rowBounds.length; rowIndex++) {
      if (after.length >= maxCandidateRows) break;
      const bounds = input.rowBounds[rowIndex];
      if (!bounds || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom)) break;
      if (bounds.top >= afterBoundary) break;
      after.push(rowIndex);
    }
  }
  return Object.freeze({
    before: Object.freeze(before),
    after: Object.freeze(after),
    viewportTop,
    viewportBottom,
    viewportHeight,
  });
}

/**
 * Builds a deterministic visible-first rendering plan without reading viewer,
 * browser, PDF.js, or DOM state. Returned collections are newly allocated.
 */
export function createRenderPlan(input: Readonly<RenderPlannerInput>): RenderPlan {
  // Phase 1: Visible rows are mandatory. Seed the desired set with all of their
  // pages before considering quality reductions, buffering, or retention.
  const { first, last } = input.visibleRange;
  const visiblePages = new Set<number>();
  for (let row = first; row <= last; row++) {
    for (const page of input.rows[row] ?? []) visiblePages.add(page);
  }
  const mandatoryPages = new Set([...visiblePages, ...(input.requiredPages ?? [])]);

  // Canvas memory grows with DPR squared. Centralizing the estimate keeps every
  // fit decision on exactly the same rounded backing-store dimensions.
  const rasterFor = (page: number, requestedDpr: number): Readonly<RasterDimensions> => {
    const size = input.pageBaseSizes.get(page) ?? input.fallbackPageSize;
    return resolveRasterDimensions(
      size.width * input.currentScale,
      size.height * input.currentScale,
      requestedDpr,
      input.settings.maxCanvasPixels,
      input.settings.maxCanvasDimension,
    );
  };
  const rasterBytes = (page: number, raster: Readonly<RasterDimensions>): number => {
    const additional = input.pageAdditionalBytes?.get(page) ?? 0;
    return (
      raster.width * raster.height * 4 + (Number.isFinite(additional) ? Math.max(0, additional) : 0)
    );
  };
  const fallbackRowHeight = (rowIndex: number): number =>
    Math.max(
      1,
      ...(input.rows[rowIndex] ?? []).map(
        page =>
          (input.pageBaseSizes.get(page) ?? input.fallbackPageSize).height * input.currentScale,
      ),
    );
  const rowBounds: Array<Readonly<{ top: number; bottom: number }>> = [];
  for (let rowIndex = 0; rowIndex < input.rows.length; rowIndex++) {
    const supplied = input.rowBounds[rowIndex];
    const fallbackTop = rowBounds[rowIndex - 1]?.bottom ?? 0;
    const top = Number.isFinite(supplied?.top) ? supplied!.top : fallbackTop;
    const bottom =
      Number.isFinite(supplied?.bottom) && supplied!.bottom > top
        ? supplied!.bottom
        : top + fallbackRowHeight(rowIndex);
    rowBounds.push(Object.freeze({ top, bottom }));
  }
  const maxBufferPages =
    input.maxBufferPages === "unlimited"
      ? Number.POSITIVE_INFINITY
      : Number.isSafeInteger(input.maxBufferPages) && input.maxBufferPages >= 0
        ? input.maxBufferPages
        : 0;
  const maxCandidateRowsPerSide = Number.isFinite(maxBufferPages)
    ? Math.max(
        1,
        Math.min(Number.MAX_SAFE_INTEGER, maxBufferPages + (input.requiredPages?.size ?? 0)),
      )
    : "unlimited";
  const bufferWindow = selectRenderBufferWindow({
    rowBounds,
    visibleRange: input.visibleRange,
    viewport: input.viewport,
    maxBufferViewportHeights: input.maxBufferViewportHeights,
    maxCandidateRowsPerSide,
    motion: input.motion,
  });
  const {
    before: eligibleBefore,
    after: eligibleAfter,
    viewportTop,
    viewportBottom,
    viewportHeight,
  } = bufferWindow;
  let bufferRowsBefore = 0;
  let bufferRowsAfter = 0;
  let bufferPageCount = 0;
  let bufferPageLimitReached = false;
  const bufferedRowsBefore: number[] = [];
  const bufferedRowsAfter: number[] = [];
  const admittedRowIndexes: number[] = [];
  const desiredPages = [...mandatoryPages];
  const retainedPages = new Set<number>();
  const pageRenderDprs = new Map<number, number>();
  const desiredPageBytes = new Map<number, number>();
  const directRenderPages = new Set<number>();
  const canvasLimitPages = new Set<number>();
  let desiredSteadyBytes = 0;
  for (const page of desiredPages) {
    const raster = rasterFor(page, input.requestedDpr);
    const bytes = rasterBytes(page, raster);
    pageRenderDprs.set(page, raster.renderDpr);
    desiredPageBytes.set(page, bytes);
    desiredSteadyBytes += bytes;
    if (raster.canvasLimited) canvasLimitPages.add(page);
  }
  const memoryLimitPages = new Set<number>();
  let concurrency = input.settings.maxConcurrentRenders;
  const limit = input.settings.memoryLimitMiB * BYTES_PER_MIB;
  const growthLimit = limit * (1 - input.settings.memoryHysteresis);
  let visibleDprReduced = false;
  let optionalDprReduced = false;
  let evictedPageCount = 0;
  let retainedSteadyBytes = 0;
  const fixedOccupiedBytes = Number.isFinite(input.fixedOccupiedBytes)
    ? Math.max(0, input.fixedOccupiedBytes)
    : 0;
  const committedBytes = (page: number): number => {
    const bytes = input.committedPageBytes?.get(page) ?? 0;
    return Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  };
  const replacesCommittedPage = (page: number): boolean =>
    input.committedPageRenderDprs.has(page) ||
    input.committedPageBytes?.has(page) === true ||
    input.fixedReplacementPageBytes?.has(page) === true;

  const temporaryOverhead = (page: number, targetBytes: number): number => {
    const oldCommittedBytes = committedBytes(page);
    if (oldCommittedBytes > 0) return Math.max(targetBytes, oldCommittedBytes);
    return targetBytes;
  };

  // Steady memory is attached output. Peak memory additionally includes the
  // largest temporary buffers that may coexist at the chosen concurrency.
  const steadyBytes = (): number => fixedOccupiedBytes + desiredSteadyBytes + retainedSteadyBytes;
  const temporaryPeakBytes = (): number =>
    desiredPages
      .filter(page => !directRenderPages.has(page))
      .map(page => temporaryOverhead(page, desiredPageBytes.get(page)!))
      .sort((a, b) => b - a)
      .slice(0, concurrency)
      .reduce((sum, bytes) => sum + bytes, 0);

  // Phase 2: Fit mandatory visible backing stores by lowering their common DPR
  // target. Per-canvas safety limits remain page-specific and may go below the
  // aggregate-memory quality floor.
  const visibleRequestedBytes = steadyBytes();
  if (visibleRequestedBytes > limit && input.settings.allowDprReduction) {
    let low = Math.min(input.settings.minRenderDpr, input.requestedDpr);
    let high = input.requestedDpr;
    const bytesAt = (candidateDpr: number): number => {
      let bytes = fixedOccupiedBytes;
      for (const page of mandatoryPages) bytes += rasterBytes(page, rasterFor(page, candidateDpr));
      return bytes;
    };
    if (bytesAt(low) <= limit) {
      for (let i = 0; i < DPR_SEARCH_ITERATIONS; i++) {
        const mid = (low + high) / 2;
        if (bytesAt(mid) <= limit) low = mid;
        else high = mid;
      }
    }
    const fittedDpr = low;
    desiredSteadyBytes = 0;
    for (const page of mandatoryPages) {
      const initialDpr = pageRenderDprs.get(page)!;
      const raster = rasterFor(page, fittedDpr);
      const renderDpr = raster.renderDpr;
      const bytes = rasterBytes(page, raster);
      pageRenderDprs.set(page, renderDpr);
      desiredPageBytes.set(page, bytes);
      desiredSteadyBytes += bytes;
      if (renderDpr < initialDpr - DPR_EPSILON) memoryLimitPages.add(page);
    }
    visibleDprReduced = memoryLimitPages.size > 0;
  }

  // Phase 3: Lower concurrency before allowing direct-to-visible rendering.
  // Direct rendering reduces peak memory but can expose incremental painting.
  const mandatoryTemporaryOverheads = desiredPages
    .map(page => temporaryOverhead(page, desiredPageBytes.get(page)!))
    .sort((a, b) => b - a);
  const temporaryPrefixBytes = [0];
  for (const bytes of mandatoryTemporaryOverheads) {
    temporaryPrefixBytes.push(temporaryPrefixBytes.at(-1)! + bytes);
  }
  const initialConcurrentPageCount = Math.min(concurrency, mandatoryTemporaryOverheads.length);
  if (steadyBytes() + temporaryPrefixBytes[initialConcurrentPageCount]! > limit) {
    let concurrentPageCount = initialConcurrentPageCount;
    while (
      concurrentPageCount > 1 &&
      steadyBytes() + temporaryPrefixBytes[concurrentPageCount]! > limit
    ) {
      concurrentPageCount--;
    }
    concurrency = Math.max(1, concurrentPageCount);
  }
  const mandatoryPeakBytes =
    steadyBytes() +
    temporaryPrefixBytes[Math.min(concurrency, mandatoryTemporaryOverheads.length)]!;
  if (mandatoryPeakBytes > limit && input.settings.allowVisibleDirectRendering) {
    const largestFirst = [...mandatoryPages].sort(
      (a, b) => desiredPageBytes.get(b)! - desiredPageBytes.get(a)!,
    );
    const availableTemporaryBytes = limit - steadyBytes();
    const replacementOverhead = largestFirst.reduce(
      (largest, page) =>
        replacesCommittedPage(page)
          ? Math.max(largest, temporaryOverhead(page, desiredPageBytes.get(page)!))
          : largest,
      0,
    );
    for (const page of largestFirst) {
      if (replacesCommittedPage(page)) continue;
      if (
        replacementOverhead <= availableTemporaryBytes &&
        desiredPageBytes.get(page)! <= availableTemporaryBytes
      )
        break;
      directRenderPages.add(page);
    }
  }
  if (directRenderPages.size && concurrency !== 1) {
    throw new Error("Render planner selected direct rendering before reducing concurrency to one");
  }

  // Phase 4: Admit complete rows intersecting one total CSS-distance budget,
  // nearest-first and leading-side-first. True document-edge shortage is
  // redistributed; row-boundary overshoot is not.
  // Only the first narrow miss may consume the optional DPR-reduction escape.
  let optionalDprFitUsed = false;
  const tryAdmitRow = (
    rowIndex: number,
    side: "before" | "after",
  ): "admitted" | "covered" | "rejected" => {
    const pages = (input.rows[rowIndex] ?? []).filter(page => !pageRenderDprs.has(page));
    if (!pages.length) return "covered";
    // The page ceiling is strict: never split a spread merely to consume its
    // remaining capacity. The caller blocks only this side, preserving a
    // contiguous window while the opposite side may still fit a smaller row.
    if (bufferPageCount + pages.length > maxBufferPages) {
      bufferPageLimitReached = true;
      return "rejected";
    }
    let rowDpr = input.requestedDpr;
    const rowCosts = (dpr: number): { steady: number; temporary: number } => {
      let steady = 0;
      let temporary = 0;
      for (const page of pages) {
        const raster = rasterFor(page, dpr);
        const bytes = rasterBytes(page, raster);
        steady += bytes;
        const direct = !replacesCommittedPage(page);
        if (!direct) temporary = Math.max(temporary, temporaryOverhead(page, bytes));
      }
      return { steady, temporary };
    };
    let costs = rowCosts(rowDpr);
    const fits = (): boolean => steadyBytes() + costs.steady + costs.temporary <= growthLimit;
    if (!fits()) {
      if (!optionalDprFitUsed && input.settings.allowDprReduction) {
        let low = Math.min(input.settings.minRenderDpr, input.requestedDpr);
        let high = input.requestedDpr;
        let lowCosts = rowCosts(low);
        if (steadyBytes() + lowCosts.steady + lowCosts.temporary <= growthLimit) {
          for (let i = 0; i < DPR_SEARCH_ITERATIONS; i++) {
            const mid = (low + high) / 2;
            const candidate = rowCosts(mid);
            if (steadyBytes() + candidate.steady + candidate.temporary <= growthLimit) {
              low = mid;
              lowCosts = candidate;
            } else {
              high = mid;
            }
          }
        }
        rowDpr = low;
        costs = lowCosts;
        optionalDprFitUsed = true;
        optionalDprReduced = rowDpr < input.requestedDpr;
      }
      if (!fits()) return "rejected";
    }
    for (const page of pages) {
      const requestedRaster = rasterFor(page, input.requestedDpr);
      const raster = rasterFor(page, rowDpr);
      const renderDpr = raster.renderDpr;
      const initialDpr = requestedRaster.renderDpr;
      const bytes = rasterBytes(page, raster);
      desiredPages.push(page);
      pageRenderDprs.set(page, renderDpr);
      desiredPageBytes.set(page, bytes);
      if (!replacesCommittedPage(page)) {
        directRenderPages.add(page);
      }
      if (requestedRaster.canvasLimited) canvasLimitPages.add(page);
      if (renderDpr < initialDpr - DPR_EPSILON) memoryLimitPages.add(page);
    }
    desiredSteadyBytes += costs.steady;
    bufferPageCount += pages.length;
    if (side === "after") bufferRowsAfter++;
    else bufferRowsBefore++;
    admittedRowIndexes.push(rowIndex);
    return "admitted";
  };

  const leadingSide: "before" | "after" = input.motion === "backward" ? "before" : "after";
  const blocked = { before: false, after: false };
  for (
    let distance = 0;
    distance < Math.max(eligibleBefore.length, eligibleAfter.length);
    distance++
  ) {
    const trySide = (side: "before" | "after"): void => {
      if (blocked[side]) return;
      const rowIndex = (side === "before" ? eligibleBefore : eligibleAfter)[distance];
      if (rowIndex == null) return;
      const result = tryAdmitRow(rowIndex, side);
      if (result === "rejected") {
        blocked[side] = true;
        return;
      }
      (side === "before" ? bufferedRowsBefore : bufferedRowsAfter).push(rowIndex);
    };
    trySide(leadingSide);
    trySide(leadingSide === "after" ? "before" : "after");
    if (bufferPageCount >= maxBufferPages) {
      bufferPageLimitReached ||= Number.isFinite(maxBufferPages);
      break;
    }
    if (blocked.before && blocked.after) break;
  }
  const beforeExtent =
    bufferedRowsBefore.length && viewportHeight > 0
      ? Math.max(0, viewportTop - rowBounds[bufferedRowsBefore.at(-1)!]!.top) / viewportHeight
      : 0;
  const afterExtent =
    bufferedRowsAfter.length && viewportHeight > 0
      ? Math.max(0, rowBounds[bufferedRowsAfter.at(-1)!]!.bottom - viewportBottom) / viewportHeight
      : 0;

  // Phase 5: Retain already committed, nearby pages while peak headroom allows.
  // Retained pages are not added to desiredPages, so retention cannot schedule
  // speculative rendering or make the render window grow without bound.
  const desiredTemporaryBytes = temporaryPeakBytes();
  const desiredSet = new Set(desiredPages);
  const retainedCandidates = input.retainCommittedPages
    ? [...input.retainedCandidates]
        .filter(candidate => !desiredSet.has(candidate.page))
        .map(candidate => ({
          candidate,
          distance:
            candidate.rowIndex < first
              ? first - candidate.rowIndex
              : candidate.rowIndex > last
                ? candidate.rowIndex - last
                : 0,
        }))
        .sort((a, b) => {
          if (a.distance !== b.distance) return a.distance - b.distance;
          if (a.candidate.rowIndex !== b.candidate.rowIndex) {
            return input.motion === "backward"
              ? a.candidate.rowIndex - b.candidate.rowIndex
              : b.candidate.rowIndex - a.candidate.rowIndex;
          }
          return a.candidate.page - b.candidate.page;
        })
        .map(({ candidate }) => candidate)
    : [];
  for (const candidate of retainedCandidates) {
    retainedPages.add(candidate.page);
    retainedSteadyBytes += candidate.bytes;
    if (steadyBytes() + desiredTemporaryBytes > growthLimit) {
      retainedPages.delete(candidate.page);
      retainedSteadyBytes -= candidate.bytes;
      evictedPageCount++;
    }
  }

  // Phase 6: Freeze totals and derive diagnostics from the completed plan.
  // Visible pages remain present even when minimum quality causes an overage.
  const steady = steadyBytes();
  const peak = steady + desiredTemporaryBytes;
  const visiblePlannedBytes =
    fixedOccupiedBytes +
    [...visiblePages].reduce((sum, page) => sum + desiredPageBytes.get(page)!, 0);
  return {
    desiredPages,
    admittedRowIndexes,
    retainedPages,
    visiblePages,
    pageRenderDprs,
    directRenderPages,
    canvasLimitPages,
    memoryLimitPages,
    maxConcurrentRenders: concurrency,
    estimatedSteadyBytes: steady,
    estimatedPeakBytes: peak,
    emergencyVisibleOverageBytes: Math.max(0, visiblePlannedBytes - limit),
    bufferRowsBefore,
    bufferRowsAfter,
    bufferPageCount,
    bufferPageLimitReached,
    bufferViewportHeightsBefore: beforeExtent,
    bufferViewportHeightsAfter: afterExtent,
    visibleDprReduced,
    optionalDprReduced,
    concurrencyReduced: concurrency < input.settings.maxConcurrentRenders,
    retainedPageCount: retainedPages.size,
    evictedPageCount,
    visibleQualityUpgradeCount: [...visiblePages].filter(page => {
      const committed = input.committedPageRenderDprs.get(page);
      return committed != null && committed + DPR_EPSILON < pageRenderDprs.get(page)!;
    }).length,
  };
}
