// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for one document's canonical view and render requirement.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentView` composes {@link PageLayoutEngine} and exclusively owns canonical
 * scale, fit and page-layout policy, document page count and preferred layout,
 * topology, content and page-surface DOM, CSS-space sizing, transient zoom
 * commit, text viewport demand, motion publication, renderer reflow ordering
 * and reconciliation, detached render snapshots, and batched page-geometry
 * publication.
 * The facade supplies semantic intents and retains public UI, event, gesture-input,
 * and cross-feature lifecycle coordination.
 *
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative ownership,
 * reflow, scale-transaction, and reset procedures.
 *
 * @packageDocumentation
 * @module document-view
 */

import { type RenderPresentationDemand, type RenderViewSnapshot } from "./document-renderer.js";
import {
  PageLayoutEngine,
  type PageFitMode,
  type PageHorizontalEnvelope,
  type PageLayoutMode,
  type PageRotation,
  type PageSurfaceLease,
  type PageViewportPosition,
} from "./page-layout-engine.js";
import type { RenderMotion } from "./render-planner.js";
import type { CatalogPrintPreference } from "./catalog-page-layout.js";
import {
  documentLocationFromDisplay,
  documentLocationToDisplay,
  type DocumentLocation,
} from "./document-location.js";

const CANONICAL_SCALE_PRECISION = 1_000_000;
const SCALE_EPSILON = 1e-4;
const PAGE_GEOMETRY_EPSILON = 1e-6;

/** Configured page layout, including automatic topology selection. */
export type DocumentViewPageLayout = "auto" | PageLayoutMode;
export type DocumentViewFitMode = "auto" | PageFitMode;

/** Immutable canonical view state published after a transaction. */
export interface DocumentViewSnapshot {
  readonly pageCount: number;
  readonly scale: number;
  readonly fitActive: boolean;
  readonly fitMode: DocumentViewFitMode;
  readonly effectiveFitMode: PageFitMode;
  readonly rotation: PageRotation;
  readonly pageLayout: DocumentViewPageLayout;
  readonly effectivePageLayout: PageLayoutMode;
  readonly hasRows: boolean;
}

/** Canonical view intent and reading position retained across presentation mode. */
export interface DocumentViewPresentationSnapshot {
  readonly view: Readonly<DocumentViewSnapshot>;
  readonly location: Readonly<DocumentLocation> | null;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** Canonical viewport reading position and its active page row. */
export interface DocumentViewViewportPosition extends PageViewportPosition {
  readonly rowIndex: number;
}

/** Semantic changes produced by a committed view transaction. */
export interface DocumentViewChange {
  readonly scaleChanged: boolean;
  readonly fitChanged: boolean;
  readonly fitModeChanged: boolean;
  readonly rotationChanged: boolean;
  readonly pageLayoutChanged: boolean;
  readonly topologyChanged: boolean;
}

/** Result of a canonical view transaction, with deferred scrolling when required. */
export type DocumentViewTransactionResult =
  | Readonly<{
      kind: "unchanged";
      snapshot: Readonly<DocumentViewSnapshot>;
    }>
  | Readonly<{
      kind: "committed";
      snapshot: Readonly<DocumentViewSnapshot>;
      change: Readonly<DocumentViewChange>;
      deferredScrollPage: number | null;
    }>;

/** Dependencies and initial policy for one document view owner. */
export interface DocumentViewOptions {
  readonly container: HTMLElement;
  /** Owner document for DOM creation and window-bound layout capabilities. */
  readonly ownerDocument?: Document;
  readonly renderer: DocumentViewRendererPort;
  readonly textPresentation: DocumentViewTextPort;
  readonly pageLayout: DocumentViewPageLayout;
  readonly fitMode: DocumentViewFitMode;
  readonly initialRotation: PageRotation;
  readonly autoFitWidthMaxHeight: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly horizontalGap: number;
  readonly verticalGap: number;
  readonly devicePixelRatio?: () => number;
  readonly annotationsEnabled?: () => boolean;
  readonly requestFrame?: (callback: FrameRequestCallback) => number | null;
  readonly cancelFrame?: (handle: number) => void;
  readonly geometryChanged?: () => void;
  readonly createResizeObserver?: (callback: ResizeObserverCallback) => ResizeObserver | null;
}

/** Narrow renderer capability consumed by the document view. */
export interface DocumentViewRendererPort {
  /** Returns the current exact surface lease when one exists. */
  leaseFor?(pageNo: number): Readonly<PageSurfaceLease> | null;
  /** Invalidates renderer surface bindings before layout mutation. */
  beginSurfaceReflow(options: Readonly<{ preserveCommittedOutput: boolean }>): void;
  /** Publishes rebuilt surfaces and the resulting detached view. */
  endSurfaceReflow(view: Readonly<RenderViewSnapshot>): void;
  /** Invalidates raster requirements, optionally retaining visual placeholders. */
  invalidateView(options: Readonly<{ retainPlaceholders: boolean; graceMs: number }>): void;
  /** Reconciles raster and presentation work against current view demand. */
  reconcile(view: Readonly<RenderViewSnapshot>, demand: Readonly<RenderPresentationDemand>): void;
}

/** Narrow text-presentation capability consumed by the document view. */
export interface DocumentViewTextPort {
  /** Brackets surface replacement and optionally preserves attached layers. */
  beginSurfaceReflow(preserveSurfaces: boolean): void;
  /** Suspends native text presentation before canonical scale mutation. */
  suspendForZoom(): void;
  /** Restores text presentation at the committed canonical scale. */
  resumeAfterZoom(scale: number): void;
  /** Publishes pages in or near the current viewport. */
  setViewportPages(pageNos: readonly number[]): void;
  /** Returns pages whose retained presentation may still require raster support. */
  presentationPageNos(): readonly number[];
  /** Tests whether a page needs presentation at the supplied scale. */
  needsPresentation(pageNo: number, scale: number): boolean;
}

/** Geometry captured while committing a transient CSS zoom to canonical layout. */
export interface DocumentViewTransientCommit {
  readonly fromScale: number;
  readonly toScale: number;
  /** Content-local coordinate captured at `fromScale` when the gesture began. */
  readonly anchorContent: Readonly<{ x: number; y: number }>;
  /** Source-scale offset from the exact or nearest page's top-left border edge. */
  readonly anchorPage: Readonly<{
    pageNo: number;
    offset: Readonly<{ x: number; y: number }>;
  }> | null;
  readonly centerClient: Readonly<{ x: number; y: number }>;
}

/** Owns one document's canonical layout, surfaces, and render demand. */
export class DocumentView {
  #document: Document;
  #window: (Window & typeof globalThis) | null;
  #container: HTMLElement;
  #renderer: DocumentViewRendererPort;
  #text: DocumentViewTextPort;
  #layout = new PageLayoutEngine();
  #content: HTMLDivElement | null = null;
  #pageCount = 0;
  #scale = 1;
  #fitActive = true;
  #fitMode: DocumentViewFitMode;
  #rotation: PageRotation;
  #initialRotation: PageRotation;
  #pageLayout: DocumentViewPageLayout;
  #preferredLayout: PageLayoutMode | null = null;
  #preferredPrintLayout: CatalogPrintPreference | null = null;
  #lastFitSignature: string | null = null;
  #minScale: number;
  #maxScale: number;
  #motion: RenderMotion = "stationary";
  #lastObservedScrollTop: number | null = null;
  #devicePixelRatio: () => number;
  #annotationsEnabled: () => boolean;
  #requestFrame: (callback: FrameRequestCallback) => number | null;
  #cancelFrame: (handle: number) => void;
  #geometryChanged: (() => void) | undefined;
  #geometryFrame: number | null = null;
  #layoutMeasurementFrame: number | null = null;
  #layoutResizeObserver: ResizeObserver | null = null;
  #revision = 0;
  #autoFitWidthMaxHeight: number;
  #cachedRenderPageGeometryKey = "";
  #cachedRenderPageBaseSizes: ReadonlyMap<number, Readonly<{ width: number; height: number }>> =
    new Map();
  #cachedRenderFallbackPageSize: Readonly<{ width: number; height: number }> = Object.freeze({
    width: 0,
    height: 0,
  });
  #presentationViewportHeight: number | null = null;

  /** Creates an empty document view with fixed collaborators and scale policy. */
  constructor(options: Readonly<DocumentViewOptions>) {
    this.#container = options.container;
    this.#document = options.ownerDocument ?? options.container.ownerDocument;
    this.#window = this.#document.defaultView as (Window & typeof globalThis) | null;
    this.#renderer = options.renderer;
    this.#text = options.textPresentation;
    this.#pageLayout = options.pageLayout;
    this.#fitMode = options.fitMode;
    this.#rotation = options.initialRotation;
    this.#initialRotation = options.initialRotation;
    this.#autoFitWidthMaxHeight = options.autoFitWidthMaxHeight;
    this.#minScale = options.minScale;
    this.#maxScale = options.maxScale;
    this.#devicePixelRatio =
      options.devicePixelRatio ?? (() => Math.max(1, this.#window?.devicePixelRatio || 1));
    this.#annotationsEnabled = options.annotationsEnabled ?? (() => false);
    this.#requestFrame =
      options.requestFrame ?? (callback => this.#window?.requestAnimationFrame(callback) ?? null);
    this.#cancelFrame =
      options.cancelFrame ?? (handle => this.#window?.cancelAnimationFrame(handle));
    this.#geometryChanged = options.geometryChanged;
    this.#layout.configureGaps(options.horizontalGap, options.verticalGap);
    const ResizeObserver =
      options.createResizeObserver ??
      (this.#window?.ResizeObserver
        ? callback => new this.#window!.ResizeObserver(callback)
        : null);
    this.#layoutResizeObserver = ResizeObserver?.(() => this.#scheduleLayoutMeasurement()) ?? null;
  }

  /** Canonical content element, or `null` before document layout. */
  get contentElement(): HTMLDivElement | null {
    return this.#content;
  }
  /** Current canonical scale. */
  get scale(): number {
    return this.#scale;
  }
  /** Whether canonical scale follows fit policy. */
  get fitActive(): boolean {
    return this.#fitActive;
  }
  get fitMode(): DocumentViewFitMode {
    return this.#fitMode;
  }
  get rotation(): PageRotation {
    return this.#rotation;
  }
  /** Configured page layout before automatic resolution. */
  get pageLayout(): DocumentViewPageLayout {
    return this.#pageLayout;
  }
  /** Number of pages in the active document. */
  get pageCount(): number {
    return this.#pageCount;
  }
  /** Published viewport motion used by render planning. */
  get motion(): RenderMotion {
    return this.#motion;
  }
  /** Current immutable page-row topology. */
  get rows(): readonly (readonly number[])[] {
    return this.#layout.rows;
  }
  /** Whether an active document topology has been built. */
  get hasRows(): boolean {
    return this.#layout.rows.length > 0;
  }

  /** Captures immutable canonical state for facade publication. */
  snapshot(): Readonly<DocumentViewSnapshot> {
    return Object.freeze({
      pageCount: this.#pageCount,
      scale: this.#scale,
      fitActive: this.#fitActive,
      fitMode: this.#fitMode,
      effectiveFitMode: this.effectiveFitMode(),
      rotation: this.#rotation,
      pageLayout: this.#pageLayout,
      effectivePageLayout: this.effectivePageLayout(),
      hasRows: this.hasRows,
    });
  }

  /** Captures view intent plus exact and normalized reading positions. */
  capturePresentationSnapshot(): Readonly<DocumentViewPresentationSnapshot> {
    return Object.freeze({
      view: this.snapshot(),
      location: this.captureDocumentLocation(),
      scrollTop: this.#container.scrollTop,
      scrollLeft: this.#container.scrollLeft,
      scrollWidth: this.#container.scrollWidth,
      scrollHeight: this.#container.scrollHeight,
      clientWidth: this.#container.clientWidth,
      clientHeight: this.#container.clientHeight,
    });
  }

  /** Replaces scale limits used by later canonical transactions. */
  configureScaleLimits(minScale: number, maxScale: number): void {
    this.#minScale = minScale;
    this.#maxScale = maxScale;
  }

  /** Initializes document geometry and builds its first canonical surfaces. */
  beginDocument(
    input: Readonly<{
      pageCount: number;
      basePageSize: Readonly<{ width: number; height: number }>;
      pageBaseSizes?: ReadonlyMap<number, Readonly<{ width: number; height: number }>>;
      fitReferencePage?: number;
      preferredLayout: PageLayoutMode | null;
      preferredPrintLayout?: CatalogPrintPreference | null;
      skipInitialScroll?: boolean;
    }>,
  ): DocumentViewTransactionResult {
    this.#revision++;
    this.#pageCount = input.pageCount;
    this.#preferredLayout = input.preferredLayout;
    this.#preferredPrintLayout = input.preferredPrintLayout ?? null;
    if (!this.#layout.recordBasePageSize(input.basePageSize.width, input.basePageSize.height)) {
      throw new Error("DocumentView: invalid base page geometry");
    }
    for (const [pageNo, size] of input.pageBaseSizes ?? []) {
      if (!this.#layout.recordPageBaseSize(pageNo, size.width, size.height)) {
        throw new Error("DocumentView: invalid exact page geometry");
      }
    }
    this.#fitActive = true;
    // A reused custom container can retain scroll from its previous document or
    // from browser scroll restoration. Clear it before the first row snapshot;
    // an explicit initial destination is applied by the facade after layout.
    this.#container.scrollTop = 0;
    this.#container.scrollLeft = 0;
    this.settleMotion();
    this.#scale = this.normalizeScale(this.computeFitScale(input.fitReferencePage));
    this.#rebuildSurfaces({
      preserveSurfaces: false,
      skipInitialScroll: input.skipInitialScroll ?? false,
      keepScale: true,
    });
    this.#markFitApplied(input.fitReferencePage);
    return this.#committed({
      scaleChanged: true,
      fitChanged: false,
      fitModeChanged: false,
      rotationChanged: false,
      pageLayoutChanged: false,
      topologyChanged: true,
    });
  }

  /** Synchronously drops document topology, surfaces, and pending geometry work. */
  resetDocument(): void {
    this.#revision++;
    if (this.#geometryFrame != null) this.#cancelFrame(this.#geometryFrame);
    if (this.#layoutMeasurementFrame != null) this.#cancelFrame(this.#layoutMeasurementFrame);
    this.#geometryFrame = null;
    this.#layoutMeasurementFrame = null;
    this.#layoutResizeObserver?.disconnect();
    this.#layout.resetDocument();
    this.#container.replaceChildren();
    this.#content = null;
    this.#pageCount = 0;
    this.#scale = 1;
    this.#fitActive = true;
    this.#preferredLayout = null;
    this.#preferredPrintLayout = null;
    this.#rotation = this.#initialRotation;
    this.#lastFitSignature = null;
    this.#motion = "stationary";
    this.#lastObservedScrollTop = null;
    this.#cachedRenderPageGeometryKey = "";
    this.#cachedRenderPageBaseSizes = new Map();
    this.#cachedRenderFallbackPageSize = Object.freeze({ width: 0, height: 0 });
    this.#presentationViewportHeight = null;
    this.#container.style.removeProperty?.("--pdf-presentation-viewport-height");
  }

  /** Returns the exact current surface lease for a page. */
  leaseFor(pageNo: number): Readonly<PageSurfaceLease> | null {
    return this.#layout.leaseFor(pageNo);
  }
  /** Tests whether a surface lease still belongs to the current topology. */
  isCurrent(lease: Readonly<PageSurfaceLease>): boolean {
    return this.#layout.isCurrent(lease);
  }
  /** Returns a page's CSS-space top, or `null` when not registered. */
  pageTopFor(pageNo: number): number | null {
    return this.#layout.pageTopFor(pageNo);
  }
  /** Returns a page-specific rotation-aware height at canonical scale. */
  pageHeightFor(pageNo: number): number {
    return this.#layout.pageHeightFor(pageNo, this.#scale, this.#rotation);
  }
  /** Resolves a page to its current row index. */
  rowIndexForPage(pageNo: number): number | undefined {
    return this.#layout.rowIndexForPage(pageNo);
  }
  /** Returns a registered row element by index. */
  rowElementAt(index: number): HTMLDivElement | null {
    return this.#layout.rowElementAt(index);
  }
  /** Detaches catalog preference plus exact and fallback intrinsic page geometry for print preflight. */
  printGeometrySnapshot(): Readonly<{
    revision: number;
    preferredLayout: CatalogPrintPreference | null;
    sizes: readonly Readonly<{ width: number; height: number }>[];
    sizeFor(pageNo: number): Readonly<{ width: number; height: number }>;
    exactSizeFor(pageNo: number): Readonly<{ width: number; height: number }> | null;
  }> {
    const sizes = Object.freeze(
      Array.from({ length: this.#pageCount }, (_, index) =>
        Object.freeze(this.#layout.pageBaseSizeFor(index + 1)),
      ),
    );
    const exactSizes = Object.freeze(
      Array.from({ length: this.#pageCount }, (_, index) => {
        const pageNo = index + 1;
        return this.#layout.hasPageBaseSize(pageNo) ? sizes[index]! : null;
      }),
    );
    return Object.freeze({
      revision: this.#layout.pageGeometryRevision,
      preferredLayout: this.#preferredPrintLayout,
      sizes,
      sizeFor: (pageNo: number) =>
        sizes[pageNo - 1] ?? sizes[0] ?? Object.freeze({ width: 612, height: 792 }),
      exactSizeFor: (pageNo: number) => exactSizes[pageNo - 1] ?? null,
    });
  }
  /** Returns a page wrapper from the current surface registry. */
  pageWrapFor(pageNo: number): HTMLDivElement | null {
    return this.#layout.pageWrapFor(pageNo);
  }
  /** Resolves a client point to the geometrically nearest page in the nearest row. */
  nearestPageAt(
    clientPoint: Readonly<{ x: number; y: number }>,
  ): { pageNo: number; rect: DOMRect } | null {
    const containerRect = this.#container.getBoundingClientRect();
    const documentY =
      this.#container.scrollTop +
      clientPoint.y -
      containerRect.top -
      (this.#container.clientTop || 0);
    const rowIndex = this.#layout.rowIndexAt(documentY, this.#scale, this.#rotation);
    let nearest: { pageNo: number; rect: DOMRect; distance: number } | null = null;
    for (const pageNo of this.#layout.rows[rowIndex] ?? []) {
      const rect = this.#layout.pageWrapFor(pageNo)?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const dx =
        clientPoint.x < rect.left
          ? rect.left - clientPoint.x
          : clientPoint.x > rect.right
            ? clientPoint.x - rect.right
            : 0;
      const dy =
        clientPoint.y < rect.top
          ? rect.top - clientPoint.y
          : clientPoint.y > rect.bottom
            ? clientPoint.y - rect.bottom
            : 0;
      const distance = dx * dx + dy * dy;
      if (
        !nearest ||
        distance < nearest.distance ||
        (distance === nearest.distance && pageNo < nearest.pageNo)
      ) {
        nearest = { pageNo, rect, distance };
      }
    }
    return nearest ? { pageNo: nearest.pageNo, rect: nearest.rect } : null;
  }
  /** Resolves the canonical viewport reading position to its active row. */
  currentRowIndex(preferredPage?: number): number {
    return this.viewportPosition(preferredPage).rowIndex;
  }

  /** Selects a stable page-local reading position from measured viewport geometry. */
  viewportPosition(preferredPage?: number): Readonly<DocumentViewViewportPosition> {
    const containerRect = this.#container.getBoundingClientRect();
    const viewport = Object.freeze({
      left: containerRect.left + (this.#container.clientLeft || 0),
      top: containerRect.top + (this.#container.clientTop || 0),
      right: containerRect.left + (this.#container.clientLeft || 0) + this.#container.clientWidth,
      bottom: containerRect.top + (this.#container.clientTop || 0) + this.#container.clientHeight,
    });
    const anchor = Object.freeze({
      x: viewport.left + (viewport.right - viewport.left) / 2,
      y: viewport.top + (viewport.bottom - viewport.top) * 0.35,
    });
    const anchorDocumentY = this.#container.scrollTop + (viewport.bottom - viewport.top) * 0.35;
    const rowIndex = this.#layout.rowIndexAt(anchorDocumentY, this.#scale, this.#rotation);
    const pages = (this.#layout.rows[rowIndex] ?? []).flatMap(pageNo => {
      const wrapper = this.#layout.pageWrapFor(pageNo);
      if (!wrapper) return [];
      const bounds = wrapper.getBoundingClientRect();
      return [
        { pageNo, left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      ];
    });
    const selected = PageLayoutEngine.viewportPosition(pages, viewport, anchor, preferredPage);
    return Object.freeze({
      rowIndex,
      pageNo: selected?.pageNo ?? this.#layout.rows[rowIndex]?.[0] ?? 1,
      xRatio: selected?.xRatio ?? 0.5,
      yRatio: selected?.yRatio ?? 0,
    });
  }

  /** Captures the canonical reading anchor in rotation-neutral normalized page space. */
  captureDocumentLocation(): Readonly<DocumentLocation> | null {
    if (!this.hasRows || this.#container.clientWidth <= 0 || this.#container.clientHeight <= 0)
      return null;
    const containerBounds = this.#container.getBoundingClientRect();
    if (!(containerBounds.width > 0) || !(containerBounds.height > 0)) return null;
    const position = this.viewportPosition();
    const wrapperBounds = this.#layout.pageWrapFor(position.pageNo)?.getBoundingClientRect();
    if (!wrapperBounds || !(wrapperBounds.width > 0) || !(wrapperBounds.height > 0)) return null;
    return documentLocationFromDisplay(
      position.pageNo,
      position.xRatio,
      position.yRatio,
      this.#rotation,
    );
  }

  /** Accepts measured page geometry and batches dependent layout reconciliation. */
  recordObservedPageGeometry(pageNo: number, width: number, height: number): boolean {
    const previous = this.#layout.pageBaseSizeFor(pageNo);
    const accepted = this.#layout.recordPageBaseSize(pageNo, width, height);
    if (
      !accepted ||
      (Math.abs(previous.width - width) < PAGE_GEOMETRY_EPSILON &&
        Math.abs(previous.height - height) < PAGE_GEOMETRY_EPSILON)
    )
      return false;
    if (this.#geometryFrame != null) return true;
    const revision = this.#revision;
    this.#geometryFrame = this.#requestFrame(() => {
      this.#geometryFrame = null;
      if (revision !== this.#revision || !this.hasRows) return;
      this.#applyPageSurfaceSizes();
      this.updateHorizontalScrollLock(false);
      this.measureRows();
      this.reconcile();
      this.#geometryChanged?.();
    });
    if (this.#geometryFrame == null) return false;
    return true;
  }

  /** Records exact unrotated intrinsic geometry before a view transaction. */
  recordPreparedPageGeometry(pageNo: number, width: number, height: number): boolean {
    return this.#layout.recordPageBaseSize(pageNo, width, height);
  }

  /** Returns the row containing a page under current or staged topology. */
  referenceRow(
    pageNo: number,
    mode: DocumentViewPageLayout = this.#pageLayout,
    rotation: PageRotation = this.#rotation,
  ): readonly number[] {
    return this.#layout.rowForPage(
      pageNo,
      this.#pageCount,
      this.#effectivePageLayout(mode, rotation),
    );
  }

  /** Resolves the initial row with the same automatic-layout policy as the active view. */
  initialReferenceRow(
    input: Readonly<{
      pageNo: number;
      pageCount: number;
      preferredLayout: PageLayoutMode | null;
      basePageSize: Readonly<{ width: number; height: number }>;
    }>,
  ): readonly number[] {
    let mode: PageLayoutMode = this.#pageLayout === "auto" ? "single" : this.#pageLayout;
    const viewport = this.#fitViewportSize();
    if (
      this.#pageLayout === "auto" &&
      input.preferredLayout &&
      input.preferredLayout !== "single" &&
      PageLayoutEngine.twoUpFits(
        viewport.width,
        viewport.height,
        input.basePageSize.width,
        input.basePageSize.height,
        this.#layout.horizontalGapPx,
        this.#rotation,
      )
    )
      mode = input.preferredLayout;
    return this.#layout.rowForPage(input.pageNo, input.pageCount, mode);
  }

  /** Persists configured fit selection while no document layout is active. */
  configureFitMode(mode: DocumentViewFitMode): void {
    if (this.hasRows) throw new Error("DocumentView: configureFitMode requires an empty view");
    this.#fitMode = mode;
  }

  /** Commits already-prepared mode, fit, and rotation intent atomically. */
  commitView(
    input: Readonly<{
      pageLayout?: DocumentViewPageLayout;
      fitMode?: DocumentViewFitMode;
      rotation?: PageRotation;
      refit: boolean;
      keepPage?: number | null;
    }>,
  ): DocumentViewTransactionResult {
    const pageLayout = input.pageLayout ?? this.#pageLayout;
    const fitMode = input.fitMode ?? this.#fitMode;
    const rotation = input.rotation ?? this.#rotation;
    const pageLayoutChanged = pageLayout !== this.#pageLayout;
    const fitModeChanged = fitMode !== this.#fitMode;
    const rotationChanged = rotation !== this.#rotation;
    if (!pageLayoutChanged && !fitModeChanged && !rotationChanged && !input.refit)
      return this.#unchanged();
    const keepPage = input.keepPage ?? this.pageAtViewportReadingPosition();
    const previousScale = this.#scale;
    this.#pageLayout = pageLayout;
    this.#fitMode = fitMode;
    this.#rotation = rotation;
    if (input.refit || pageLayoutChanged) this.#fitActive = true;
    this.#text.suspendForZoom();
    try {
      if (this.#fitActive) this.#scale = this.normalizeScale(this.computeFitScale(keepPage));
      if (rotationChanged || !this.scalesEqual(previousScale, this.#scale)) {
        this.#renderer.invalidateView({ retainPlaceholders: false, graceMs: 0 });
      }
      if (pageLayoutChanged || rotationChanged || this.#pageLayout === "auto") {
        this.#rebuildSurfaces({
          preserveSurfaces: !rotationChanged,
          skipInitialScroll: true,
          keepScale: true,
        });
      } else {
        this.#prepareScaledLayout();
        this.reconcile();
      }
    } finally {
      this.#text.resumeAfterZoom(this.#scale);
    }
    this.#markFitApplied(keepPage);
    return this.#committed(
      {
        scaleChanged: !this.scalesEqual(previousScale, this.#scale),
        fitChanged: input.refit || pageLayoutChanged,
        fitModeChanged,
        rotationChanged,
        pageLayoutChanged,
        topologyChanged: pageLayoutChanged || rotationChanged || this.#pageLayout === "auto",
      },
      keepPage,
    );
  }

  /** Applies or clears one-row-per-viewport presentation geometry. */
  setPresentationViewport(active: boolean): void {
    this.#presentationViewportHeight = active ? Math.max(1, this.#container.clientHeight) : null;
    if (this.#presentationViewportHeight == null) {
      this.#container.style.removeProperty?.("--pdf-presentation-viewport-height");
    } else {
      this.#container.style.setProperty(
        "--pdf-presentation-viewport-height",
        `${this.#presentationViewportHeight}px`,
      );
    }
    this.refreshRowMetrics();
  }

  /** Refreshes the presentation block size after a container resize. */
  refreshPresentationViewport(): void {
    if (this.#presentationViewportHeight == null) return;
    this.setPresentationViewport(true);
  }

  /** Restores canonical pre-presentation intent in one surface transaction. */
  restorePresentationSnapshot(
    saved: Readonly<DocumentViewPresentationSnapshot>,
    targetPage?: number,
  ): DocumentViewTransactionResult {
    const before = this.snapshot();
    const target = saved.view;
    const keepPage = targetPage ?? saved.location?.page ?? 1;
    this.#pageLayout = target.pageLayout;
    this.#fitMode = target.fitMode;
    this.#rotation = target.rotation;
    this.#fitActive = target.fitActive;
    this.#text.suspendForZoom();
    try {
      this.#scale = this.normalizeScale(
        target.fitActive ? this.computeFitScale(keepPage) : target.scale,
      );
      this.#renderer.invalidateView({ retainPlaceholders: false, graceMs: 0 });
      this.#rebuildSurfaces({ preserveSurfaces: true, skipInitialScroll: true, keepScale: true });
    } finally {
      this.#text.resumeAfterZoom(this.#scale);
    }
    if (target.fitActive) this.#markFitApplied(keepPage);
    else this.#lastFitSignature = null;
    const sameGeometry =
      targetPage == null &&
      saved.clientWidth === this.#container.clientWidth &&
      saved.clientHeight === this.#container.clientHeight &&
      Math.abs(saved.scrollWidth - this.#container.scrollWidth) <= 1 &&
      Math.abs(saved.scrollHeight - this.#container.scrollHeight) <= 1;
    if (sameGeometry) {
      this.#container.scrollTop = this.#clamp(
        saved.scrollTop,
        0,
        Math.max(0, this.#container.scrollHeight - this.#container.clientHeight),
      );
      this.#container.scrollLeft = this.#clamp(
        saved.scrollLeft,
        0,
        Math.max(0, this.#container.scrollWidth - this.#container.clientWidth),
      );
    } else if (targetPage != null) {
      this.scrollToPage(targetPage, false, false);
      this.#centerPageHorizontally(targetPage);
    } else if (saved.location) {
      this.restoreDocumentLocation(saved.location);
    }
    this.settleMotion();
    this.reconcile();
    return this.#committed({
      scaleChanged: !this.scalesEqual(before.scale, this.#scale),
      fitChanged: before.fitActive !== this.#fitActive,
      fitModeChanged: before.fitMode !== this.#fitMode,
      rotationChanged: before.rotation !== this.#rotation,
      pageLayoutChanged: before.pageLayout !== this.#pageLayout,
      topologyChanged: before.effectivePageLayout !== this.effectivePageLayout(),
    });
  }

  #centerPageHorizontally(pageNo: number): void {
    const row = this.#layout.rowIndexForPage(pageNo);
    if (row == null) return;
    this.measureRows();
    const wrapper = this.#layout.pageWrapFor(pageNo);
    if (!wrapper) return;
    if (
      this.#layout.rowFitsHorizontallyAt(
        row,
        this.#scale,
        this.#container.clientWidth,
        this.#rotation,
      )
    ) {
      this.#container.scrollLeft = 0;
      return;
    }
    const bounds = wrapper.getBoundingClientRect();
    const containerBounds = this.#container.getBoundingClientRect();
    if (!(bounds.width > 0) || !(containerBounds.width > 0)) return;
    const viewportLeft = containerBounds.left + (this.#container.clientLeft || 0);
    const horizontalMax = this.#layout.horizontalScrollMax(
      this.#scale,
      this.#container.clientWidth,
      this.#rotation,
    );
    this.#container.scrollLeft = this.#clamp(
      this.#container.scrollLeft +
        bounds.left +
        bounds.width * 0.5 -
        (viewportLeft + this.#container.clientWidth * 0.5),
      0,
      horizontalMax,
    );
  }

  /** Commits a bounded explicit scale and optionally preserves a client anchor. */
  setExplicitScale(
    scale: number,
    anchor?: Readonly<{ x: number; y: number }>,
  ): DocumentViewTransactionResult {
    const next = this.normalizeScale(this.#clamp(scale, this.#minScale, this.#maxScale));
    if (this.scalesEqual(next, this.#scale)) return this.#unchanged();
    const previous = this.#scale;
    this.#fitActive = false;
    this.#lastFitSignature = null;
    this.#text.suspendForZoom();
    try {
      this.#scale = next;
      if (anchor) this.#preserveAnchor(previous, next, anchor);
      this.#renderer.invalidateView({ retainPlaceholders: false, graceMs: 0 });
      this.#prepareScaledLayout();
      this.reconcile();
    } finally {
      this.#text.resumeAfterZoom(this.#scale);
    }
    return this.#committed({
      scaleChanged: true,
      fitChanged: true,
      fitModeChanged: false,
      rotationChanged: false,
      pageLayoutChanged: false,
      topologyChanged: false,
    });
  }

  /** Recomputes and commits fit scale for the current topology policy. */
  applyFit(): DocumentViewTransactionResult {
    const keepPage = this.pageAtViewportReadingPosition();
    const previous = this.#scale;
    const next = this.normalizeScale(this.computeFitScale(keepPage));
    this.#fitActive = true;
    this.#text.suspendForZoom();
    try {
      this.#scale = next;
      if (!this.scalesEqual(previous, next))
        this.#renderer.invalidateView({ retainPlaceholders: false, graceMs: 0 });
      if (this.#pageLayout === "auto") {
        this.#rebuildSurfaces({ preserveSurfaces: true, skipInitialScroll: true, keepScale: true });
      } else {
        this.#prepareScaledLayout();
        this.reconcile();
      }
    } finally {
      this.#text.resumeAfterZoom(this.#scale);
    }
    this.#markFitApplied(keepPage);
    return this.#committed(
      {
        scaleChanged: !this.scalesEqual(previous, next),
        fitChanged: true,
        fitModeChanged: false,
        rotationChanged: false,
        pageLayoutChanged: false,
        topologyChanged: this.#pageLayout === "auto",
      },
      keepPage,
    );
  }

  /** Converts a transient CSS zoom into canonical scale, layout, and scroll state. */
  commitTransientZoom(
    commit: Readonly<DocumentViewTransientCommit>,
  ): DocumentViewTransactionResult {
    const next = this.normalizeScale(this.#clamp(commit.toScale, this.#minScale, this.#maxScale));
    if (this.scalesEqual(commit.fromScale, next)) return this.#unchanged();
    this.#fitActive = false;
    this.#lastFitSignature = null;
    this.#text.suspendForZoom();
    try {
      this.#scale = next;
      this.#renderer.invalidateView({ retainPlaceholders: true, graceMs: 1200 });
      this.#prepareScaledLayout();
      this.#restoreTransientAnchor({ ...commit, toScale: next });
      this.reconcile();
    } finally {
      this.#text.resumeAfterZoom(this.#scale);
    }
    return this.#committed({
      scaleChanged: true,
      fitChanged: true,
      fitModeChanged: false,
      rotationChanged: false,
      pageLayoutChanged: false,
      topologyChanged: false,
    });
  }

  /**
   * Reconciles container geometry as one measure-before-publish transaction.
   * `refit: false` updates overflow, measured row bounds, and rendering demand
   * without changing canonical scale, which is used for in-flow host changes.
   */
  resize(
    preferredKeepPage?: number | null,
    options: Readonly<{ refit?: boolean; transientZoomActive?: boolean }> = {},
  ): DocumentViewTransactionResult {
    if (!this.hasRows) return this.#unchanged();
    this.refreshPresentationViewport();
    if (!(options.refit ?? this.#fitActive)) {
      this.updateHorizontalScrollLock(options.transientZoomActive ?? false);
      this.measureRows();
      this.reconcile();
      return this.#unchanged();
    }
    const keepPage = preferredKeepPage ?? this.viewportPosition().pageNo;
    const beforeMode = this.#layout.renderedLayoutKind();
    const effectiveMode = this.effectivePageLayout() === "single" ? "single" : "two-up";
    const topologyChanged = this.#pageLayout === "auto" && beforeMode !== effectiveMode;
    const previous = this.#scale;
    const next = this.normalizeScale(this.computeFitScale(keepPage));
    this.#text.suspendForZoom();
    try {
      this.#scale = next;
      if (!this.scalesEqual(previous, next))
        this.#renderer.invalidateView({ retainPlaceholders: false, graceMs: 0 });
      if (topologyChanged)
        this.#rebuildSurfaces({ preserveSurfaces: true, skipInitialScroll: true, keepScale: true });
      else {
        this.#prepareScaledLayout();
        this.reconcile();
      }
    } finally {
      this.#text.resumeAfterZoom(this.#scale);
    }
    this.#markFitApplied(keepPage);
    return this.#committed(
      {
        scaleChanged: !this.scalesEqual(previous, next),
        fitChanged: false,
        fitModeChanged: false,
        rotationChanged: false,
        pageLayoutChanged: false,
        topologyChanged,
      },
      topologyChanged || !this.scalesEqual(previous, next) ? keepPage : null,
    );
  }

  /** Publishes viewport text demand and reconciles renderer presentation work. */
  reconcile(priorityRange?: Readonly<{ first: number; last: number; center: number }>): void {
    if (!this.hasRows) return;
    const current = this.#renderViewSnapshot();
    const targetTop = priorityRange ? current.rowBounds[priorityRange.center]?.top : null;
    const documentTop = current.rowBounds[0]?.top ?? 0;
    const documentBottom = current.rowBounds.at(-1)?.bottom ?? documentTop;
    const priorityTop =
      targetTop == null
        ? null
        : this.#clamp(
            targetTop,
            documentTop,
            Math.max(documentTop, documentBottom - current.viewport.height),
          );
    const priorityVisibleRange =
      priorityTop == null
        ? null
        : this.#layout.visibleRowRange(priorityTop, current.viewport.height, this.#scale);
    const view = priorityRange
      ? Object.freeze({
          ...current,
          visibleRange: Object.freeze({
            first: priorityVisibleRange?.first ?? priorityRange.first,
            last: priorityVisibleRange?.last ?? priorityRange.last,
            center: priorityRange.center,
          }),
          viewport: Object.freeze({
            top: priorityTop ?? current.viewport.top,
            height: current.viewport.height,
          }),
        })
      : current;
    const pages = new Set<number>();
    const first = Math.max(0, view.visibleRange.first - 1);
    const last = Math.min(view.rows.length - 1, view.visibleRange.last + 1);
    for (let row = first; row <= last; row++)
      for (const page of view.rows[row] ?? []) pages.add(page);
    this.#text.setViewportPages([...pages]);
    const textPages = this.#text
      .presentationPageNos()
      .filter(pageNo => this.#text.needsPresentation(pageNo, view.scale));
    const demand: RenderPresentationDemand = Object.freeze({
      annotations: this.#annotationsEnabled(),
      textPages: Object.freeze(textPages),
    });
    this.#renderer.reconcile(view, demand);
  }

  /** Applies horizontal overflow policy for canonical or transient zoom state. */
  updateHorizontalScrollLock(transientZoomActive: boolean): void {
    if (!this.#container.isConnected) return;
    this.#syncContentWidth();
    const fits = this.#layout.rowFitsHorizontally(
      this.#scale,
      this.#container.clientWidth,
      this.#rotation,
    );
    this.#container.style.overflowX = fits || transientZoomActive ? "hidden" : "auto";
    this.normalizeHorizontalScroll();
  }

  /** Clamps horizontal scroll to the current scaled row geometry. */
  normalizeHorizontalScroll(): void {
    if (!this.#container.isConnected) return;
    if (
      this.#layout.rowFitsHorizontally(this.#scale, this.#container.clientWidth, this.#rotation)
    ) {
      this.#container.scrollLeft = 0;
      return;
    }
    this.#container.scrollLeft = this.#clamp(
      this.#container.scrollLeft,
      0,
      this.#layout.horizontalScrollMax(this.#scale, this.#container.clientWidth, this.#rotation),
    );
  }

  /** Reports whether the widest current row fits the container. */
  rowFitsHorizontally(): boolean {
    return this.#layout.rowFitsHorizontally(
      this.#scale,
      this.#container.clientWidth,
      this.#rotation,
    );
  }

  /** Returns the immutable horizontal envelope captured by a transient zoom session. */
  transientHorizontalEnvelope(): PageHorizontalEnvelope {
    return this.#layout.horizontalEnvelope(
      this.#scale,
      this.#container.clientWidth,
      this.#rotation,
    );
  }

  /** Publishes viewport motion and its observed scroll position to render planning. */
  setMotion(motion: RenderMotion, scrollTop = this.#container.scrollTop): void {
    this.#motion = motion;
    this.#lastObservedScrollTop = scrollTop;
  }

  /** Publishes stationary motion after scrolling or canonical repositioning settles. */
  settleMotion(): void {
    this.setMotion("stationary");
  }

  /** Measures current row tops and heights in container coordinates. */
  measureRows(): boolean {
    return this.#layout.measureRows(this.#content?.offsetTop ?? 0);
  }

  /** Measures row metrics now and once more after the next layout frame. */
  refreshRowMetrics(): void {
    this.measureRows();
    const revision = this.#revision;
    this.#requestFrame(() => {
      if (revision !== this.#revision || !this.hasRows || !this.measureRows()) return;
      this.reconcile();
      this.#geometryChanged?.();
    });
  }

  /** Returns the page at the canonical viewport reading position. */
  pageAtViewportReadingPosition(): number {
    return this.viewportPosition().pageNo;
  }

  /** Restores a rotation-neutral page point to the canonical 50%/35% viewport anchor. */
  restoreDocumentLocation(location: Readonly<DocumentLocation>): boolean {
    if (
      !this.hasRows ||
      this.#container.clientWidth <= 0 ||
      this.#container.clientHeight <= 0 ||
      location.page > this.#pageCount
    )
      return false;
    const row = this.#layout.rowIndexForPage(location.page);
    if (row == null) return false;
    // A false result means the measured metrics were unchanged, not unavailable.
    this.measureRows();
    const displayed = documentLocationToDisplay(location, this.#rotation);
    const wrapper = this.#layout.pageWrapFor(location.page);
    if (!displayed || !wrapper) return false;
    const bounds = wrapper.getBoundingClientRect();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return false;
    const containerBounds = this.#container.getBoundingClientRect();
    if (!(containerBounds.width > 0) || !(containerBounds.height > 0)) return false;
    const viewportLeft = containerBounds.left + (this.#container.clientLeft || 0);
    const viewportTop = containerBounds.top + (this.#container.clientTop || 0);
    const targetX = bounds.left + displayed.xRatio * bounds.width;
    const targetY = bounds.top + displayed.yRatio * bounds.height;
    const horizontalMax = this.#layout.horizontalScrollMax(
      this.#scale,
      this.#container.clientWidth,
      this.#rotation,
    );
    this.#container.scrollLeft = this.#layout.rowFitsHorizontallyAt(
      row,
      this.#scale,
      this.#container.clientWidth,
      this.#rotation,
    )
      ? 0
      : this.#clamp(
          this.#container.scrollLeft + targetX - (viewportLeft + this.#container.clientWidth * 0.5),
          0,
          horizontalMax,
        );
    this.#container.scrollTop = this.#clamp(
      this.#container.scrollTop + targetY - (viewportTop + this.#container.clientHeight * 0.35),
      0,
      Math.max(0, this.#container.scrollHeight - this.#container.clientHeight),
    );
    this.settleMotion();
    this.reconcile({ first: row, last: row, center: row });
    return true;
  }

  /** Scrolls to a page's row and returns that row when the page exists. */
  scrollToPage(
    pageNo: number,
    smooth = false,
    trackMotion = true,
    behavior: ScrollBehavior = "smooth",
  ): number | null {
    const row = this.#layout.rowIndexForPage(pageNo);
    if (row == null) return null;
    this.scrollToRow(row, smooth, trackMotion, behavior);
    return row;
  }

  /** Returns the measured vertical target used for page-row navigation. */
  pageRowScrollTop(pageNo: number): number | null {
    const row = this.#layout.rowIndexForPage(pageNo);
    if (row == null) return null;
    this.measureRows();
    return this.#layout.rowTops[row] ?? null;
  }

  /** Resolves the exact clamped scroll target for a normalized displayed page point. */
  documentPointScrollPosition(
    pageNo: number,
    yRatio: number,
    xRatio?: number,
  ): Readonly<{ top: number; left?: number }> | null {
    this.measureRows();
    const pageTop = this.pageTopFor(pageNo);
    if (pageTop == null) return null;
    const top = this.#clamp(
      pageTop + yRatio * this.pageHeightFor(pageNo),
      0,
      Math.max(0, this.#container.scrollHeight - this.#container.clientHeight),
    );
    if (xRatio == null) return Object.freeze({ top });
    const wrapper = this.#layout.pageWrapFor(pageNo);
    if (!wrapper) return Object.freeze({ top });
    return Object.freeze({
      top,
      left: this.#clamp(
        wrapper.offsetLeft + xRatio * wrapper.offsetWidth - this.#container.clientWidth / 2,
        0,
        Math.max(0, this.#container.scrollWidth - this.#container.clientWidth),
      ),
    });
  }

  /** Scrolls to a bounded row and publishes immediate motion/render demand. */
  scrollToRow(
    index: number,
    smooth = false,
    trackMotion = true,
    behavior: ScrollBehavior = "smooth",
  ): number {
    const row = this.#clamp(index, 0, Math.max(0, this.#layout.rows.length - 1));
    const top = this.#layout.rowTops[row] ?? 0;
    if (smooth) this.#container.scrollTo({ top, behavior });
    else {
      const previousTop = this.#container.scrollTop;
      this.#container.scrollTop = top;
      if (trackMotion && previousTop !== top) {
        this.setMotion(top > previousTop ? "forward" : "backward", top);
      } else {
        this.settleMotion();
      }
      this.reconcile({ first: row, last: row, center: row });
    }
    return row;
  }

  /** Resolves automatic mode against preferred mode and current container geometry. */
  effectivePageLayout(): PageLayoutMode {
    return this.#effectivePageLayout(this.#pageLayout, this.#rotation);
  }

  #effectivePageLayout(
    mode: DocumentViewPageLayout,
    rotation: PageRotation = this.#rotation,
  ): PageLayoutMode {
    if (mode !== "auto") return mode;
    const hasGeometry = this.#layout.basePageWidth > 0 && this.#layout.basePageHeight > 0;
    const viewport = this.#fitViewportSize();
    if (hasGeometry) this.#layout.evaluateAutoLayout(viewport.width, viewport.height, rotation);
    const twoUpFits = hasGeometry ? this.#layout.autoTwoUp : false;
    if (this.#preferredLayout === "single" || !twoUpFits) return "single";
    if (this.#preferredLayout === "double") return "double";
    if (this.#preferredLayout === "book") return "book";
    return "single";
  }

  /** Resolves automatic fitting from the current container height. */
  effectiveFitMode(): PageFitMode {
    if (this.#fitMode !== "auto") return this.#fitMode;
    return this.#fitViewportSize().height <= this.#autoFitWidthMaxHeight ? "width" : "contain";
  }

  /** Computes bounded fit scale from current container and page geometry. */
  computeFitScale(referencePage?: number): number {
    const viewport = this.#fitViewportSize();
    return this.#layout.computeFitScale(
      viewport.width,
      viewport.height,
      this.effectivePageLayout(),
      this.#scale,
      this.#minScale,
      this.#maxScale,
      this.effectiveFitMode(),
      this.#rotation,
      this.referenceRow(referencePage ?? this.#layout.rows[this.currentRowIndex()]?.[0] ?? 1),
    );
  }

  /** Tests whether exact current-row geometry overflows its selected fit constraint. */
  fitNeedsRefresh(): boolean {
    if (!this.#fitActive) return true;
    const referencePage = this.#layout.rows[this.currentRowIndex()]?.[0] ?? 1;
    const row = this.referenceRow(referencePage);
    const geometry = this.#layout.rowGeometry(row, this.effectivePageLayout(), this.#rotation);
    const viewport = this.#fitViewportSize();
    const mode = this.effectiveFitMode();
    const widthOverflows =
      !this.#layout.rowFitsHorizontally(this.#scale, viewport.width, this.#rotation) ||
      (!!geometry?.exact &&
        geometry.pageWidth * this.#scale +
          this.#layout.horizontalGapFor(this.#scale) * geometry.horizontalGapCount >
          viewport.width + 0.5);
    if (!geometry?.exact) return mode !== "height" && widthOverflows;
    const heightOverflows = geometry.height * this.#scale > viewport.height + 0.5;
    return mode === "width"
      ? widthOverflows
      : mode === "height"
        ? heightOverflows
        : widthOverflows || heightOverflows;
  }

  /** Rounds scale to the canonical precision used for identity comparisons. */
  normalizeScale(scale: number): number {
    return Math.round(scale * CANONICAL_SCALE_PRECISION) / CANONICAL_SCALE_PRECISION;
  }

  /** Compares canonical scales with rendering tolerance. */
  scalesEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= SCALE_EPSILON;
  }

  /** Measures the eventual no-horizontal-scrollbar viewport used by fit policy. */
  #fitViewportSize(): Readonly<{ width: number; height: number }> {
    const rect = this.#container.getBoundingClientRect();
    let borderWidth = 0;
    let borderHeight = 0;
    if (this.#window) {
      const style = this.#window.getComputedStyle(this.#container);
      borderWidth =
        (Number.parseFloat(style.borderLeftWidth) || 0) +
        (Number.parseFloat(style.borderRightWidth) || 0);
      borderHeight =
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
    }
    const innerWidth = Math.max(0, rect.width - borderWidth);
    const innerHeight = Math.max(0, rect.height - borderHeight);
    return Object.freeze({
      // Vertical overflow generally remains after Fit, so retain its occupied width.
      width: this.#container.clientWidth || innerWidth,
      // Once rows exist, Fit removes horizontal overflow; do not let its scrollbar
      // reduce the target height. Before initial surfaces exist, retain the live
      // scrollport measurement so first layout does not predict unobserved overflow.
      height:
        this.hasRows && innerHeight > this.#container.clientHeight + 0.5
          ? innerHeight
          : this.#container.clientHeight || innerHeight,
    });
  }

  /** Rebuilds canonical surface DOM inside renderer and text reflow brackets. */
  #rebuildSurfaces(
    options: Readonly<{
      preserveSurfaces: boolean;
      skipInitialScroll: boolean;
      keepScale: boolean;
    }>,
  ): void {
    this.#text.beginSurfaceReflow(options.preserveSurfaces);
    this.#renderer.beginSurfaceReflow({ preserveCommittedOutput: options.preserveSurfaces });
    this.#layout.beginReflow(
      this.#pageCount,
      this.effectivePageLayout(),
      options.preserveSurfaces ? "preserve" : "drop",
    );

    let content: HTMLDivElement;
    if (!options.preserveSurfaces) {
      this.#container.replaceChildren();
      content = this.#document.createElement("div");
      this.#container.appendChild(content);
    } else {
      content = this.#content?.isConnected
        ? this.#content
        : (this.#container.querySelector<HTMLDivElement>(".pdf-content") ??
          this.#document.createElement("div"));
      if (content.parentElement !== this.#container) this.#container.appendChild(content);
    }
    content.className = "pdf-content";
    content.style.position = "relative";
    content.style.width = "100%";
    this.#content = content;
    this.#layoutResizeObserver?.disconnect();
    this.#layoutResizeObserver?.observe(content);

    const HtmlDiv = this.#window?.HTMLDivElement;
    const existingRows = Array.from(content.children).filter(
      (element): element is HTMLDivElement =>
        !!HtmlDiv && element instanceof HtmlDiv && element.classList.contains("pdf-row"),
    );
    for (let rowIndex = 0; rowIndex < this.#layout.rows.length; rowIndex++) {
      const row = this.#layout.rows[rowIndex];
      const rowElement = existingRows[rowIndex] ?? this.#document.createElement("div");
      rowElement.className = "pdf-row";
      rowElement.style.display = "flex";
      rowElement.style.flexDirection = "row";
      rowElement.style.justifyContent = "center";
      rowElement.style.gap = `${this.#layout.horizontalGapPx}px`;
      rowElement.style.margin = "0 auto var(--pdf-page-vgap, 1rem) auto";
      rowElement.style.width = "max-content";
      rowElement.replaceChildren();
      for (const pageNo of row) {
        let wrapper = this.#layout.pageWrapFor(pageNo);
        let canvas = this.#layout.canvasFor(pageNo);
        if (!wrapper || !canvas) {
          wrapper = this.#document.createElement("div");
          wrapper.className = "pdf-page";
          wrapper.dataset.page = String(pageNo);
          canvas = this.#document.createElement("canvas");
          canvas.width = 0;
          canvas.height = 0;
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          wrapper.appendChild(canvas);
        }
        wrapper.style.position = "relative";
        wrapper.style.overflow = "hidden";
        wrapper.style.background = "var(--pdf-page-background, white)";
        canvas.style.display = "block";
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.zIndex = "1";
        canvas.style.contain = "content";
        canvas.style.background = "var(--pdf-page-background, white)";
        if (!canvas.style.boxShadow) canvas.style.boxShadow = "0 1px 2px rgba(0,0,0,.08)";
        rowElement.appendChild(wrapper);
        this.#layout.registerPageSurface(pageNo, rowIndex, wrapper, canvas);
      }
      if (rowElement.parentElement !== content) content.appendChild(rowElement);
      this.#layout.registerRow(rowIndex, rowElement);
    }
    for (let index = this.#layout.rows.length; index < existingRows.length; index++)
      existingRows[index].remove();

    if (!options.keepScale) this.#scale = this.normalizeScale(this.computeFitScale());
    this.#prepareScaledLayout();
    if (!options.skipInitialScroll) {
      this.#container.scrollTop = this.#layout.rowTops[0] ?? 0;
      this.settleMotion();
    }
    this.#renderer.endSurfaceReflow(this.#renderViewSnapshot());
  }

  /** Applies canonical scale to surfaces, gaps, overflow, and row measurements. */
  #prepareScaledLayout(): void {
    this.#applyPageSurfaceSizes();
    this.#layout.applyScaledGaps(this.#scale);
    this.#content?.style.setProperty(
      "--pdf-page-vgap-scaled",
      `${this.#layout.verticalGapFor(this.#scale)}px`,
    );
    this.#syncContentWidth();
    this.updateHorizontalScrollLock(false);
    this.refreshRowMetrics();
  }

  /** Sizes canonical page wrappers without rewriting renderer-owned canvases. */
  #applyPageSurfaceSizes(): void {
    for (const [pageNo] of this.#layout.pageCanvasEntries()) {
      const size = this.#layout.pageSizeFor(pageNo, this.#rotation);
      const wrapper = this.#layout.pageWrapFor(pageNo);
      wrapper?.style.setProperty("--pdf-page-scale", String(this.#scale));
      if (wrapper) {
        wrapper.style.width = `${Math.max(1, size.width * this.#scale)}px`;
        wrapper.style.height = `${Math.max(1, size.height * this.#scale)}px`;
      }
    }
  }

  /** Keeps content width large enough for both the viewport and scaled rows. */
  #syncContentWidth(): void {
    if (!this.#content) return;
    this.#content.style.width = `${
      this.#layout.horizontalEnvelope(this.#scale, this.#container.clientWidth, this.#rotation)
        .contentWidth
    }px`;
  }

  /** Detaches current layout and motion facts for renderer reconciliation. */
  #renderViewSnapshot(): Readonly<RenderViewSnapshot> {
    this.#lastObservedScrollTop ??= this.#container.scrollTop;
    const pageGeometryKey = `${this.#layout.pageGeometryRevision}|${this.#rotation}`;
    if (pageGeometryKey !== this.#cachedRenderPageGeometryKey) {
      const pageBaseSizes = new Map<number, Readonly<{ width: number; height: number }>>();
      for (const pageNo of this.#layout.pageBaseSizes.keys()) {
        const size = this.#layout.pageSizeFor(pageNo, this.#rotation);
        pageBaseSizes.set(pageNo, Object.freeze({ width: size.width, height: size.height }));
      }
      this.#cachedRenderPageGeometryKey = pageGeometryKey;
      this.#cachedRenderPageBaseSizes = pageBaseSizes;
      this.#cachedRenderFallbackPageSize = Object.freeze(
        this.#rotation === 90 || this.#rotation === 270
          ? { width: this.#layout.basePageHeight, height: this.#layout.basePageWidth }
          : { width: this.#layout.basePageWidth, height: this.#layout.basePageHeight },
      );
    }
    return Object.freeze({
      topologyRevision: this.#layout.topologyRevision,
      pageGeometryRevision: this.#layout.pageGeometryRevision,
      rows: this.#layout.rows,
      rowBounds: this.#layout.rowBounds(this.#scale, this.#rotation),
      viewport: Object.freeze({
        top: this.#container.scrollTop,
        height: this.#container.clientHeight,
      }),
      visibleRange: this.#layout.visibleRowRange(
        this.#container.scrollTop,
        this.#container.clientHeight,
        this.#scale,
      ),
      motion: this.#motion,
      scale: this.#scale,
      rotation: this.#rotation,
      devicePixelRatio: Math.max(1, this.#devicePixelRatio() || 1),
      pageBaseSizes: this.#cachedRenderPageBaseSizes,
      fallbackPageSize: this.#cachedRenderFallbackPageSize,
    });
  }

  /** Coalesces observer-driven content geometry changes into one fresh plan. */
  #scheduleLayoutMeasurement(): void {
    if (this.#layoutMeasurementFrame != null || !this.hasRows) return;
    const revision = this.#revision;
    this.#layoutMeasurementFrame = this.#requestFrame(() => {
      this.#layoutMeasurementFrame = null;
      if (revision !== this.#revision || !this.hasRows || !this.measureRows()) return;
      this.reconcile();
      this.#geometryChanged?.();
    });
  }

  /** Restores a client-space anchor across an immediate canonical scale change. */
  #preserveAnchor(before: number, after: number, anchor: Readonly<{ x: number; y: number }>): void {
    const rect = this.#container.getBoundingClientRect();
    const contentX = (anchor.x - rect.left + this.#container.scrollLeft) / before;
    const contentY = (anchor.y - rect.top + this.#container.scrollTop) / before;
    const left = contentX * after - (anchor.x - rect.left);
    const top = contentY * after - (anchor.y - rect.top);
    this.#container.scrollLeft = this.#layout.rowFitsHorizontally(
      after,
      this.#container.clientWidth,
      this.#rotation,
    )
      ? 0
      : this.#clamp(
          left,
          0,
          this.#layout.horizontalScrollMax(after, this.#container.clientWidth, this.#rotation),
        );
    this.#container.scrollTop = Math.max(0, top);
    this.settleMotion();
  }

  /** Restores an exact source-layout anchor against canonical target geometry. */
  #restoreTransientAnchor(commit: Readonly<DocumentViewTransientCommit>): void {
    const factor = this.#scale / commit.fromScale;
    if (commit.anchorPage) {
      const wrapper = this.#layout.pageWrapFor(commit.anchorPage.pageNo);
      const rect = wrapper?.getBoundingClientRect();
      if (wrapper && rect) {
        this.#container.scrollLeft = this.#clamp(
          this.#container.scrollLeft +
            rect.left +
            commit.anchorPage.offset.x * factor -
            commit.centerClient.x,
          0,
          this.#layout.horizontalScrollMax(
            this.#scale,
            this.#container.clientWidth,
            this.#rotation,
          ),
        );
        this.#container.scrollTop = this.#clamp(
          this.#container.scrollTop +
            rect.top +
            commit.anchorPage.offset.y * factor -
            commit.centerClient.y,
          0,
          Math.max(0, this.#container.scrollHeight - this.#container.clientHeight),
        );
        this.settleMotion();
        return;
      }
    }
    const contentRect = this.#content?.getBoundingClientRect();
    if (!contentRect) return;
    this.#container.scrollLeft = this.#clamp(
      this.#container.scrollLeft +
        contentRect.left +
        commit.anchorContent.x * factor -
        commit.centerClient.x,
      0,
      this.#layout.horizontalScrollMax(this.#scale, this.#container.clientWidth, this.#rotation),
    );
    this.#container.scrollTop = this.#clamp(
      this.#container.scrollTop +
        contentRect.top +
        commit.anchorContent.y * factor -
        commit.centerClient.y,
      0,
      Math.max(0, this.#container.scrollHeight - this.#container.clientHeight),
    );
    this.settleMotion();
  }

  /** Builds the geometry signature used to detect stale fit state. */
  #fitSignature(referencePage?: number): string | null {
    const viewport = this.#fitViewportSize();
    return this.#layout.autoFitSignature(
      viewport.width,
      viewport.height,
      this.effectivePageLayout(),
      this.effectiveFitMode(),
      this.#rotation,
      this.referenceRow(referencePage ?? this.#layout.rows[this.currentRowIndex()]?.[0] ?? 1),
    );
  }

  /** Records the geometry for which fit was most recently committed. */
  #markFitApplied(referencePage?: number): void {
    this.#lastFitSignature = this.#fitActive ? this.#fitSignature(referencePage) : null;
  }

  /** Returns an immutable no-op transaction result. */
  #unchanged(): DocumentViewTransactionResult {
    return Object.freeze({ kind: "unchanged", snapshot: this.snapshot() });
  }

  /** Returns an immutable committed transaction result. */
  #committed(
    change: DocumentViewChange,
    deferredScrollPage: number | null = null,
  ): DocumentViewTransactionResult {
    return Object.freeze({
      kind: "committed",
      snapshot: this.snapshot(),
      change: Object.freeze({ ...change }),
      deferredScrollPage,
    });
  }

  /** Clamps a number to an inclusive range. */
  #clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
