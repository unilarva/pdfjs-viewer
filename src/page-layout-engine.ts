// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private CSS-space geometry, topology, and render-surface registry.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `PageLayoutEngine` owns page grouping, row offsets, base and per-page
 * dimensions, page-to-row mappings, and the registry of row/page/canvas DOM
 * surfaces. Exact registration-epoch leases let the renderer reject detached
 * or replaced output. {@link PageLayoutEngine.resetDocument} drops every value
 * derived from the previous document while preserving configured page gaps.
 * {@link PageLayoutEngine.beginReflow} rebuilds topology
 * for the same document and makes preserving or dropping surfaces explicit;
 * document geometry, page gaps, and the latest auto-layout result survive.
 *
 * `DocumentView` composes this engine, constructs and styles surface DOM,
 * restores scroll position, and brackets reflow with renderer
 * invalidation/rebinding transitions. The facade no longer owns surface DOM.
 * The renderer consumes only the narrow exact-lease surface port. The
 * engine only applies scaled row gaps and measures registered row elements.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative reflow,
 * reset, and renderer/layout ownership procedures.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module page-layout-engine
 */

export type PageLayoutMode = "single" | "double" | "book";
export type PageSurfaceReflowMode = "preserve" | "drop";
export type PageFitMode = "contain" | "width" | "height";

const PAGE_GEOMETRY_EPSILON = 1e-6;
const PAGE_GAP_REFERENCE_SHORT_EDGE_PX = 600;
const MIN_NONZERO_PAGE_GAP_PX = 1;
const MAX_PAGE_GAP_MULTIPLIER = 16;
export type PageRotation = 0 | 90 | 180 | 270;

type PageBaseSize = Readonly<{ width: number; height: number }>;

/** Exact immutable identity of one registered page render surface. */
export interface PageSurfaceLease {
  readonly pageNo: number;
  readonly canvas: HTMLCanvasElement;
  readonly wrapper: HTMLDivElement;
  readonly registrationEpoch: number;
}

/** One measured page rectangle in viewport client coordinates. */
export interface PageViewportBounds {
  readonly pageNo: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Canonical horizontal document geometry for one scale and viewport width. */
export interface PageHorizontalEnvelope {
  readonly widestRowWidth: number;
  readonly contentWidth: number;
  readonly widestRowInset: number;
  readonly scrollMax: number;
}

/** Canonical page-local reading position selected from viewport geometry. */
export interface PageViewportPosition {
  readonly pageNo: number;
  readonly xRatio: number;
  readonly yRatio: number;
}

/** Owns immutable page-row topology, measured CSS geometry, and exact surface registrations. */
export class PageLayoutEngine {
  #rows: readonly (readonly number[])[] = [];
  #rowEls: HTMLDivElement[] = [];
  #rowTops: number[] = [];
  #rowHeights: number[] = [];
  #rowMetricsRevision = 0;
  #cachedRowBoundsKey = "";
  #cachedRowBounds: readonly Readonly<{ top: number; bottom: number }>[] = Object.freeze([]);
  #cachedHorizontalEnvelopeKey = "";
  #cachedHorizontalEnvelope: PageHorizontalEnvelope | null = null;
  #pageWrapEls = new Map<number, HTMLDivElement>();
  #pageCanvasEls = new Map<number, HTMLCanvasElement>();
  #surfaceEpochs = new Map<number, number>();
  #nextSurfaceEpoch = 0;
  #pageToRowIndex = new Map<number, number>();
  #pageBaseSizes = new Map<number, PageBaseSize>();
  #basePageWidth = 0;
  #basePageHeight = 0;
  #topologyRevision = 0;
  #pageGeometryRevision = 0;
  #horizontalGapPx = 12;
  #verticalGapPx = 16;
  #autoTwoUp = false;

  get rows(): readonly (readonly number[])[] {
    return this.#rows;
  }
  get rowTops(): readonly number[] {
    return this.#rowTops;
  }
  get pageBaseSizes(): ReadonlyMap<number, PageBaseSize> {
    return this.#pageBaseSizes;
  }
  get basePageWidth(): number {
    return this.#basePageWidth;
  }
  get basePageHeight(): number {
    return this.#basePageHeight;
  }
  get topologyRevision(): number {
    return this.#topologyRevision;
  }
  get pageGeometryRevision(): number {
    return this.#pageGeometryRevision;
  }
  get horizontalGapPx(): number {
    return this.#horizontalGapPx;
  }
  get verticalGapPx(): number {
    return this.#verticalGapPx;
  }
  get autoTwoUp(): boolean {
    return this.#autoTwoUp;
  }

  /** Resolves the horizontal gap for the current displayed reference-page size. */
  horizontalGapFor(scale: number): number {
    return scaledPageGap(this.#horizontalGapPx, this.#pageGapMultiplierFor(scale));
  }

  /** Resolves the vertical gap for the current displayed reference-page size. */
  verticalGapFor(scale: number): number {
    return scaledPageGap(this.#verticalGapPx, this.#pageGapMultiplierFor(scale));
  }

  /** Builds immutable row topology without mutating the active layout. */
  static rowsFor(pageCount: number, mode: PageLayoutMode): readonly (readonly number[])[] {
    const rows: number[][] = [];
    if (mode === "single") {
      for (let page = 1; page <= pageCount; page++) rows.push([page]);
    } else if (mode === "double") {
      for (let page = 1; page <= pageCount; page += 2)
        rows.push(page < pageCount ? [page, page + 1] : [page]);
    } else {
      if (pageCount > 0) rows.push([1]);
      for (let page = 2; page <= pageCount; page += 2)
        rows.push(page < pageCount ? [page, page + 1] : [page]);
    }
    return Object.freeze(rows.map(row => Object.freeze(row)));
  }

  /** Selects the page containing, or nearest to, the viewport reading anchor. */
  static viewportPosition(
    pages: readonly Readonly<PageViewportBounds>[],
    viewport: Readonly<{ left: number; top: number; right: number; bottom: number }>,
    anchor: Readonly<{ x: number; y: number }>,
    preferredPage?: number,
  ): Readonly<PageViewportPosition> | null {
    const preferred = pages.find(page => page.pageNo === preferredPage);
    if (preferred) {
      const width = preferred.right - preferred.left;
      const height = preferred.bottom - preferred.top;
      const visibleWidth = Math.max(
        0,
        Math.min(preferred.right, viewport.right) - Math.max(preferred.left, viewport.left),
      );
      if (
        width > 0 &&
        height > 0 &&
        anchor.y >= preferred.top &&
        anchor.y <= preferred.bottom &&
        visibleWidth >= Math.min(width, viewport.right - viewport.left) * 0.5
      ) {
        return Object.freeze({
          pageNo: preferred.pageNo,
          xRatio: this.#clampRatio((anchor.x - preferred.left) / width),
          yRatio: this.#clampRatio((anchor.y - preferred.top) / height),
        });
      }
    }
    let selected: Readonly<PageViewportBounds> | null = null;
    let selectedDistance = Number.POSITIVE_INFINITY;
    let selectedIntersection = -1;
    for (const page of pages) {
      const width = page.right - page.left;
      const height = page.bottom - page.top;
      if (!(width > 0) || !(height > 0)) continue;
      const dx =
        anchor.x < page.left
          ? page.left - anchor.x
          : anchor.x > page.right
            ? anchor.x - page.right
            : 0;
      const dy =
        anchor.y < page.top
          ? page.top - anchor.y
          : anchor.y > page.bottom
            ? anchor.y - page.bottom
            : 0;
      const distance = dx * dx + dy * dy;
      const intersection =
        Math.max(0, Math.min(page.right, viewport.right) - Math.max(page.left, viewport.left)) *
        Math.max(0, Math.min(page.bottom, viewport.bottom) - Math.max(page.top, viewport.top));
      const isPreferred = page.pageNo === preferredPage;
      const selectedPreferred = selected?.pageNo === preferredPage;
      if (
        distance < selectedDistance ||
        (distance === selectedDistance && intersection > selectedIntersection) ||
        (distance === selectedDistance &&
          intersection === selectedIntersection &&
          isPreferred &&
          !selectedPreferred) ||
        (distance === selectedDistance &&
          intersection === selectedIntersection &&
          isPreferred === selectedPreferred &&
          page.pageNo < (selected?.pageNo ?? Number.POSITIVE_INFINITY))
      ) {
        selected = page;
        selectedDistance = distance;
        selectedIntersection = intersection;
      }
    }
    if (!selected) return null;
    return Object.freeze({
      pageNo: selected.pageNo,
      xRatio: this.#clampRatio((anchor.x - selected.left) / (selected.right - selected.left)),
      yRatio: this.#clampRatio((anchor.y - selected.top) / (selected.bottom - selected.top)),
    });
  }

  /** Pure automatic two-up eligibility for staged or active document geometry. */
  static twoUpFits(
    containerWidth: number,
    containerHeight: number,
    pageWidth: number,
    pageHeight: number,
    horizontalGap: number,
    rotation: PageRotation = 0,
  ): boolean {
    if (
      ![containerWidth, containerHeight, pageWidth, pageHeight].every(
        value => Number.isFinite(value) && value > 0,
      ) ||
      !Number.isFinite(horizontalGap) ||
      horizontalGap < 0
    )
      return false;
    const width = rotation === 90 || rotation === 270 ? pageHeight : pageWidth;
    const height = rotation === 90 || rotation === 270 ? pageWidth : pageHeight;
    const heightScale = containerHeight / height;
    const gap = scaledPageGap(
      horizontalGap,
      pageGapMultiplier(Math.min(pageWidth, pageHeight), heightScale),
    );
    return width * 2 * heightScale + gap <= containerWidth;
  }

  /**
   * Discards all active-document geometry, topology, mappings, row offsets,
   * registered DOM surfaces, and the container-derived auto-layout result.
   *
   * Call only after old-document operations have been invalidated. Configured
   * Page gaps remain available for the next document. Repeated calls are safe.
   */
  resetDocument(): void {
    this.#topologyRevision++;
    this.#pageGeometryRevision++;
    this.#rows = [];
    this.#rowEls = [];
    this.#rowTops = [];
    this.#rowHeights = [];
    this.#pageWrapEls.clear();
    this.#pageCanvasEls.clear();
    this.#surfaceEpochs.clear();
    this.#pageToRowIndex.clear();
    this.#pageBaseSizes.clear();
    this.#basePageWidth = 0;
    this.#basePageHeight = 0;
    this.#autoTwoUp = false;
  }

  /**
   * Starts a same-document topology rebuild and installs row grouping for
   * `pageCount` and `mode`.
   *
   * Existing row elements, row offsets, and page mappings are always cleared.
   * `surfaceMode: "preserve"` retains registered wrappers/canvases and their
   * committed output for facade reuse; `"drop"` removes those registrations.
   * Base/per-page dimensions, page gaps, and auto-layout result are preserved.
   */
  beginReflow(pageCount: number, mode: PageLayoutMode, surfaceMode: PageSurfaceReflowMode): void {
    if (!Number.isInteger(pageCount) || pageCount < 0) {
      throw new RangeError("PageLayoutEngine: pageCount must be a non-negative integer");
    }
    if (mode !== "single" && mode !== "double" && mode !== "book") {
      throw new TypeError("PageLayoutEngine: mode must be single, double, or book");
    }
    if (surfaceMode !== "preserve" && surfaceMode !== "drop") {
      throw new TypeError("PageLayoutEngine: surfaceMode must be preserve or drop");
    }

    this.#rows = PageLayoutEngine.rowsFor(pageCount, mode);
    this.#topologyRevision++;
    this.#rowEls = [];
    this.#rowTops = [];
    this.#rowHeights = [];
    this.#pageToRowIndex.clear();
    this.#surfaceEpochs.clear();
    if (surfaceMode === "drop") {
      this.#pageWrapEls.clear();
      this.#pageCanvasEls.clear();
    }
  }

  /**
   * Registers the facade-created element for an installed row.
   * Rows must be registered in ascending order after {@link beginReflow}; an
   * existing registration at the same index is replaced.
   */
  registerRow(rowIndex: number, rowEl: HTMLDivElement): void {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= this.#rows.length) {
      throw new RangeError("PageLayoutEngine: rowIndex is outside the active row model");
    }
    if (rowIndex > this.#rowEls.length) {
      throw new Error("PageLayoutEngine: rows must be registered in ascending order");
    }
    this.#rowEls[rowIndex] = rowEl;
  }

  /**
   * Registers or replaces a page's wrapper/canvas pair and its active row
   * mapping. The page must belong to `rowIndex` in the installed row model.
   */
  registerPageSurface(
    pageNo: number,
    rowIndex: number,
    pageWrap: HTMLDivElement,
    canvas: HTMLCanvasElement,
  ): void {
    if (!this.#rows[rowIndex]?.includes(pageNo)) {
      throw new Error("PageLayoutEngine: page does not belong to the requested row");
    }
    this.#pageWrapEls.set(pageNo, pageWrap);
    this.#pageCanvasEls.set(pageNo, canvas);
    this.#surfaceEpochs.set(pageNo, ++this.#nextSurfaceEpoch);
    this.#pageToRowIndex.set(pageNo, rowIndex);
  }

  /** Returns a frozen lease for the page's exact current registration. */
  leaseFor(pageNo: number): Readonly<PageSurfaceLease> | null {
    const canvas = this.#pageCanvasEls.get(pageNo);
    const wrapper = this.#pageWrapEls.get(pageNo);
    const registrationEpoch = this.#surfaceEpochs.get(pageNo);
    if (!canvas || !wrapper || registrationEpoch == null) return null;
    return Object.freeze({ pageNo, canvas, wrapper, registrationEpoch });
  }

  /** Whether a lease still identifies the current connected registration. */
  isCurrent(lease: Readonly<PageSurfaceLease>): boolean {
    return (
      this.#surfaceEpochs.get(lease.pageNo) === lease.registrationEpoch &&
      this.#pageCanvasEls.get(lease.pageNo) === lease.canvas &&
      this.#pageWrapEls.get(lease.pageNo) === lease.wrapper &&
      lease.canvas.isConnected &&
      lease.wrapper.isConnected
    );
  }

  /**
   * Configures non-negative finite reference-size gaps. A valid call replaces both
   * prior values; invalid configuration is rejected without mutation.
   */
  configureGaps(horizontal: number, vertical: number): boolean {
    if (!this.#isFiniteNonNegative(horizontal) || !this.#isFiniteNonNegative(vertical))
      return false;
    this.#horizontalGapPx = horizontal;
    this.#verticalGapPx = vertical;
    return true;
  }

  /**
   * Records the document fallback dimensions at scale 1. Valid observations
   * replace both previous dimensions; invalid geometry is ignored atomically.
   */
  recordBasePageSize(width: number, height: number): boolean {
    if (!this.#isFinitePositive(width) || !this.#isFinitePositive(height)) return false;
    if (
      Math.abs(this.#basePageWidth - width) >= PAGE_GEOMETRY_EPSILON ||
      Math.abs(this.#basePageHeight - height) >= PAGE_GEOMETRY_EPSILON
    )
      this.#pageGeometryRevision++;
    this.#basePageWidth = width;
    this.#basePageHeight = height;
    return true;
  }

  /**
   * Records or replaces one page's scale-1 dimensions. Page numbers must be
   * positive integers and dimensions finite and positive. Invalid observations
   * leave any previous valid dimensions unchanged.
   */
  recordPageBaseSize(pageNo: number, width: number, height: number): boolean {
    if (
      !Number.isInteger(pageNo) ||
      pageNo < 1 ||
      !this.#isFinitePositive(width) ||
      !this.#isFinitePositive(height)
    )
      return false;
    const previous = this.#pageBaseSizes.get(pageNo);
    if (
      !previous ||
      Math.abs(previous.width - width) >= PAGE_GEOMETRY_EPSILON ||
      Math.abs(previous.height - height) >= PAGE_GEOMETRY_EPSILON
    ) {
      this.#pageBaseSizes.set(pageNo, { width, height });
      this.#pageGeometryRevision++;
    }
    return true;
  }

  /** Returns a page's known dimensions, falling back to document base geometry. */
  pageBaseSizeFor(pageNo: number): PageBaseSize {
    return (
      this.#pageBaseSizes.get(pageNo) ?? {
        width: this.#basePageWidth,
        height: this.#basePageHeight,
      }
    );
  }

  /** Whether exact geometry has been observed for a page. */
  hasPageBaseSize(pageNo: number): boolean {
    return this.#pageBaseSizes.has(pageNo);
  }

  /** Returns rotated scale-1 geometry for a page. */
  pageSizeFor(pageNo: number, rotation: PageRotation): PageBaseSize {
    const size = this.pageBaseSizeFor(pageNo);
    return rotation === 90 || rotation === 270 ? { width: size.height, height: size.width } : size;
  }

  /** Returns the active or hypothetical row containing a page. */
  rowForPage(pageNo: number, pageCount: number, mode: PageLayoutMode): readonly number[] {
    return PageLayoutEngine.rowsFor(pageCount, mode).find(row => row.includes(pageNo)) ?? [];
  }

  /** Computes complete scale-1 row geometry, including representative spreads. */
  rowGeometry(
    row: readonly number[],
    mode: PageLayoutMode,
    rotation: PageRotation,
  ): Readonly<{
    width: number;
    pageWidth: number;
    horizontalGapCount: number;
    height: number;
    exact: boolean;
    pages: readonly number[];
  }> | null {
    if (!row.length) return null;
    const pages = row.length === 1 && mode !== "single" ? [row[0], row[0]] : [...row];
    const sizes = pages.map(pageNo => this.pageSizeFor(pageNo, rotation));
    if (
      sizes.some(
        size => !this.#isFinitePositive(size.width) || !this.#isFinitePositive(size.height),
      )
    )
      return null;
    const pageWidth = sizes.reduce((sum, size) => sum + size.width, 0);
    const horizontalGapCount = Math.max(0, pages.length - 1);
    return Object.freeze({
      width: pageWidth + this.horizontalGapFor(1) * horizontalGapCount,
      pageWidth,
      horizontalGapCount,
      height: Math.max(...sizes.map(size => size.height)),
      exact: row.every(pageNo => this.hasPageBaseSize(pageNo)),
      pages: Object.freeze(pages),
    });
  }

  /** Returns the active row index for a page, or `undefined` before registration. */
  rowIndexForPage(pageNo: number): number | undefined {
    return this.#pageToRowIndex.get(pageNo);
  }

  /** Returns the registered row element at `rowIndex`, or `null`. */
  rowElementAt(rowIndex: number): HTMLDivElement | null {
    return this.#rowEls[rowIndex] ?? null;
  }

  /** Iterates registered page/canvas pairs without copying the surface registry. */
  pageCanvasEntries(): MapIterator<[number, HTMLCanvasElement]> {
    return this.#pageCanvasEls.entries();
  }

  /** Returns the cached top offset for a page, or `null` when unavailable. */
  pageTopFor(pageNo: number): number | null {
    const rowIndex = this.#pageToRowIndex.get(pageNo);
    if (rowIndex == null) return null;
    return this.#rowTops[rowIndex] ?? null;
  }

  /** Returns one page's current rotation-aware rendered height in CSS pixels. */
  pageHeightFor(pageNo: number, scale: number, rotation: PageRotation): number {
    return this.pageSizeFor(pageNo, rotation).height * scale;
  }

  /** Detaches current visual row bounds in document-container CSS pixels. */
  rowBounds(
    scale: number,
    rotation: PageRotation,
  ): readonly Readonly<{ top: number; bottom: number }>[] {
    const key = `${this.#topologyRevision}|${this.#pageGeometryRevision}|${this.#rowMetricsRevision}|${scale}|${rotation}`;
    if (key === this.#cachedRowBoundsKey) return this.#cachedRowBounds;
    const bounds: Array<Readonly<{ top: number; bottom: number }>> = [];
    let fallbackTop = 0;
    const gap = this.verticalGapFor(scale);
    for (let rowIndex = 0; rowIndex < this.#rows.length; rowIndex++) {
      const row = this.#rows[rowIndex]!;
      const measuredTop = this.#rowTops[rowIndex];
      const top = Number.isFinite(measuredTop) ? measuredTop! : fallbackTop;
      const measuredHeight = this.#rowHeights[rowIndex] ?? 0;
      const fallbackHeight = Math.max(
        1,
        ...row.map(pageNo => this.pageSizeFor(pageNo, rotation).height * scale),
      );
      const height =
        Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : fallbackHeight;
      const bottom = top + height;
      bounds.push(Object.freeze({ top, bottom }));
      fallbackTop = bottom + gap;
    }
    this.#cachedRowBoundsKey = key;
    this.#cachedRowBounds = Object.freeze(bounds);
    return this.#cachedRowBounds;
  }

  /** Retrieves the cached page wrapper element for a given page number. */
  pageWrapFor(pageNo: number): HTMLDivElement | null {
    return this.#pageWrapEls.get(pageNo) ?? null;
  }

  /** Retrieves the cached canvas element for a given page number. */
  canvasFor(pageNo: number): HTMLCanvasElement | null {
    return this.#pageCanvasEls.get(pageNo) ?? null;
  }

  /** Returns the kind of layout that is currently rendered in the DOM. */
  renderedLayoutKind(): "single" | "two-up" {
    return this.#rows.some(r => r.length === 2) ? "two-up" : "single";
  }

  /** Returns the widest installed row at the supplied rotation and scale. */
  renderedRowWidthFor(scale: number, rotation: PageRotation): number {
    let widest = 0;
    const gap = this.horizontalGapFor(scale);
    for (const row of this.#rows) {
      const sizes = row.map(pageNo => this.pageSizeFor(pageNo, rotation));
      const width =
        sizes.reduce((sum, size) => sum + Math.max(1, size.width * scale), 0) +
        gap * Math.max(0, row.length - 1);
      widest = Math.max(widest, width);
    }
    return widest;
  }

  /** Resolves the shared content-width, row-centering, and scroll-limit model. */
  horizontalEnvelope(
    scale: number,
    containerWidth: number,
    rotation: PageRotation,
  ): PageHorizontalEnvelope {
    const key = `${this.#topologyRevision}|${this.#pageGeometryRevision}|${this.#horizontalGapPx}|${scale}|${rotation}|${containerWidth}`;
    if (key === this.#cachedHorizontalEnvelopeKey && this.#cachedHorizontalEnvelope) {
      return this.#cachedHorizontalEnvelope;
    }
    const widestRowWidth = this.renderedRowWidthFor(scale, rotation);
    const contentWidth = Math.max(containerWidth, Math.ceil(widestRowWidth));
    this.#cachedHorizontalEnvelopeKey = key;
    this.#cachedHorizontalEnvelope = Object.freeze({
      widestRowWidth,
      contentWidth,
      widestRowInset: (contentWidth - widestRowWidth) / 2,
      scrollMax: widestRowWidth <= containerWidth + 0.5 ? 0 : contentWidth - containerWidth,
    });
    return this.#cachedHorizontalEnvelope;
  }

  /** Returns the semantic horizontal scroll limit from document geometry. */
  horizontalScrollMax(scale: number, containerWidth: number, rotation: PageRotation): number {
    return this.horizontalEnvelope(scale, containerWidth, rotation).scrollMax;
  }

  /**
   * Checks whether the current row layout fits fully within the container
   * width at a given scale, meaning horizontal scrolling can remain disabled.
   *
   * IMPORTANT: this must reflect the *currently rendered* row layout, not the
   * hypothetical effective auto-layout mode, so callers must not substitute
   * an "effective" mode here when the DOM has not been rebuilt to match it.
   */
  rowFitsHorizontally(scale: number, containerWidth: number, rotation: PageRotation): boolean {
    return this.horizontalEnvelope(scale, containerWidth, rotation).scrollMax === 0;
  }

  /** Checks whether one installed row fits the supplied viewport width. */
  rowFitsHorizontallyAt(
    rowIndex: number,
    scale: number,
    containerWidth: number,
    rotation: PageRotation,
  ): boolean {
    const row = this.#rows[rowIndex];
    if (!row) return false;
    const gap = this.horizontalGapFor(scale);
    const width =
      row.reduce(
        (sum, pageNo) => sum + Math.max(1, this.pageSizeFor(pageNo, rotation).width * scale),
        0,
      ) +
      gap * Math.max(0, row.length - 1);
    return width <= containerWidth + 0.5;
  }

  /**
   * Calculates the currently visible range of rows for a given scroll
   * position and container height.
   *
   * @returns `first`/`last` row indexes and the approximate `center` row.
   */
  visibleRowRange(
    scrollTop: number,
    containerHeight: number,
    currentScale: number,
  ): { first: number; last: number; center: number } {
    const top = scrollTop;
    const bottom = top + containerHeight;
    const tops = this.#rowTops;
    if (!tops.length) return { first: 0, last: -1, center: 0 };

    // Use scaled vertical gap to estimate row bottom.
    const vGap = this.verticalGapFor(currentScale);

    // O(log R): find the first row whose estimated bottom reaches viewport top.
    let low = 0;
    let high = tops.length;
    while (low < high) {
      const mid = low + ((high - low) >> 1);
      const nextTop = mid + 1 < tops.length ? tops[mid + 1] : Number.POSITIVE_INFINITY;
      if (nextTop - vGap >= top) high = mid;
      else low = mid + 1;
    }
    const first = Math.min(low, tops.length - 1);

    // O(log R): upper bound gives the last row with rowTop <= viewport bottom.
    low = 0;
    high = tops.length;
    while (low < high) {
      const mid = low + ((high - low) >> 1);
      if (tops[mid] <= bottom) low = mid + 1;
      else high = mid;
    }
    const last = Math.max(0, low - 1);
    const center = Math.round((first + last) / 2);
    return { first, last, center };
  }

  /** Returns the row containing, or vertically nearest to, a document-space position. */
  rowIndexAt(position: number, scale: number, rotation: PageRotation): number {
    const bounds = this.rowBounds(scale, rotation);
    if (!bounds.length) return 0;
    let low = 0;
    let high = bounds.length;
    while (low < high) {
      const mid = low + ((high - low) >> 1);
      if (bounds[mid]!.bottom < position) low = mid + 1;
      else high = mid;
    }
    if (low >= bounds.length) return bounds.length - 1;
    if (bounds[low]!.top <= position) return low;
    if (low === 0) return 0;
    return position - bounds[low - 1]!.bottom <= bounds[low]!.top - position ? low - 1 : low;
  }

  /**
   * Measures cached row tops and heights from the DOM in one layout pass.
   * A changed height invalidates row bounds even when no later row moves, which
   * is essential for custom row styling and exact end-of-document planning.
   *
   * @param contentTopOffset - The content wrapper's own `offsetTop`.
   * @returns Whether any measured row metric changed materially.
   */
  measureRows(contentTopOffset: number): boolean {
    const nextTops: number[] = [];
    const nextHeights: number[] = [];
    for (const element of this.#rowEls) {
      const offsetTop = Number.isFinite(element.offsetTop) ? element.offsetTop : 0;
      const offsetHeight =
        Number.isFinite(element.offsetHeight) && element.offsetHeight > 0
          ? element.offsetHeight
          : 0;
      nextTops.push(contentTopOffset + offsetTop);
      nextHeights.push(offsetHeight);
    }
    const changed =
      nextTops.length !== this.#rowTops.length ||
      nextTops.some(
        (top, index) => Math.abs(top - (this.#rowTops[index] ?? Number.POSITIVE_INFINITY)) >= 0.25,
      ) ||
      nextHeights.some(
        (height, index) =>
          Math.abs(height - (this.#rowHeights[index] ?? Number.POSITIVE_INFINITY)) >= 0.25,
      );
    if (!changed) return false;
    this.#rowTops = nextTops;
    this.#rowHeights = nextHeights;
    this.#rowMetricsRevision++;
    return true;
  }

  /** Applies displayed-reference-page-relative gaps to the owned row elements. */
  applyScaledGaps(currentScale: number): void {
    const hGap = this.horizontalGapFor(currentScale);
    const vGap = this.verticalGapFor(currentScale);
    for (const rowEl of this.#rowEls) {
      rowEl.style.gap = `${hGap}px`;
      // Keep top/left/right margins the same; scale bottom spacing between rows.
      rowEl.style.margin = `0 auto ${vGap}px auto`;
    }
  }

  /**
   * Evaluates whether two pages fit side-by-side at the container's current
   * size, based on a height-constrained scale. Stores and returns the result
   * in `autoTwoUp`.
   */
  evaluateAutoLayout(
    containerWidth: number,
    containerHeight: number,
    rotation: PageRotation = 0,
  ): boolean {
    if (
      !this.#isFinitePositive(this.#basePageWidth) ||
      !this.#isFinitePositive(this.#basePageHeight) ||
      !this.#isFiniteNonNegative(containerWidth) ||
      !this.#isFiniteNonNegative(containerHeight)
    ) {
      this.#autoTwoUp = false;
      return false;
    }
    this.#autoTwoUp = PageLayoutEngine.twoUpFits(
      containerWidth,
      containerHeight,
      this.#basePageWidth,
      this.#basePageHeight,
      this.#horizontalGapPx,
      rotation,
    );
    return this.#autoTwoUp;
  }

  /**
   * Computes a compact signature representing the current auto-fit state.
   * The signature changes whenever the container size or effective page layout
   * changes, allowing the caller to detect stale fit calculations.
   */
  autoFitSignature(
    containerWidth: number,
    containerHeight: number,
    effectiveMode: PageLayoutMode,
    fitMode: PageFitMode,
    rotation: PageRotation,
    row: readonly number[],
  ): string | null {
    const geometry = this.rowGeometry(row, effectiveMode, rotation);
    if (!geometry?.exact) return null;
    const cw = Math.round(containerWidth);
    const ch = Math.round(containerHeight);
    if (cw <= 0 || ch <= 0) return null;
    return `${cw}x${ch}:${effectiveMode}:${fitMode}:${rotation}:${geometry.width.toFixed(6)}x${geometry.height.toFixed(6)}`;
  }

  /**
   * Computes the optimal zoom scale factor such that a page (or spread) fits
   * within the available container dimensions while maintaining aspect ratio.
   *
   * @returns A numeric scale factor clamped between `minScale` and `maxScale`.
   */
  computeFitScale(
    containerWidth: number,
    containerHeight: number,
    effectiveMode: PageLayoutMode,
    currentScale: number,
    minScale: number,
    maxScale: number,
    fitMode: PageFitMode = "contain",
    rotation: PageRotation = 0,
    row: readonly number[] = [],
  ): number {
    const fallbackRow = row.length ? row : [1];
    const geometry = this.rowGeometry(fallbackRow, effectiveMode, rotation);
    if (!geometry) return currentScale;
    const referenceShortEdge = Math.min(this.#basePageWidth, this.#basePageHeight);
    const unboundedGapPerScale =
      referenceShortEdge > 0
        ? (this.#horizontalGapPx * referenceShortEdge) / PAGE_GAP_REFERENCE_SHORT_EDGE_PX
        : 0;
    const unboundedScaleW =
      containerWidth / (geometry.pageWidth + unboundedGapPerScale * geometry.horizontalGapCount);
    const availablePageWidth = Math.max(
      0,
      containerWidth - this.horizontalGapFor(unboundedScaleW) * geometry.horizontalGapCount,
    );
    const scaleW = availablePageWidth / geometry.pageWidth;
    const scaleH = containerHeight / geometry.height;
    const scale =
      fitMode === "width" ? scaleW : fitMode === "height" ? scaleH : Math.min(scaleW, scaleH);
    return Math.max(minScale, Math.min(maxScale, scale));
  }

  #isFinitePositive(value: number): boolean {
    return Number.isFinite(value) && value > 0;
  }

  #isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
  }

  static #clampRatio(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  #pageGapMultiplierFor(scale: number): number {
    return pageGapMultiplier(Math.min(this.#basePageWidth, this.#basePageHeight), scale);
  }
}

function pageGapMultiplier(referenceShortEdge: number, scale: number): number {
  return Math.min(
    MAX_PAGE_GAP_MULTIPLIER,
    (referenceShortEdge * scale) / PAGE_GAP_REFERENCE_SHORT_EDGE_PX,
  );
}

function scaledPageGap(configuredGap: number, multiplier: number): number {
  if (configuredGap === 0) return 0;
  return Math.max(MIN_NONZERO_PAGE_GAP_PX, configuredGap * multiplier);
}
