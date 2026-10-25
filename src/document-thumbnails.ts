// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for demand-driven sidebar thumbnail DOM, raster work, and cache.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. It shares page lifetime and raster arbitration,
 * but owns all thumbnail policy and resources. See the
 * [architecture guide](../ARCHITECTURE.md) for ownership and lifecycle ordering.
 * @packageDocumentation
 * @module document-thumbnails
 */

import type {
  DocumentPageAcquirer,
  DocumentPageUse,
  DocumentPageSourceContext,
} from "./document-page-usage.js";
import { startPdfPageRenderTask } from "./pdfjs-compatibility.js";
import type { BackgroundRasterLease, RasterWorkCoordinator } from "./raster-work-coordinator.js";
import type { PdfjsViewerRenderingProfileSettings } from "./viewer-contracts.js";
import {
  computeThumbnailRasterBudget,
  orderThumbnailEvictions,
  selectThumbnailRenderCandidate,
  thumbnailIsBehind,
  thumbnailViewportDistance,
  type ThumbnailCandidateGeometry,
  type ThumbnailPanelGeometry,
} from "./thumbnail-render-planner.js";

const BYTES_PER_MIB = 1024 * 1024;
const MAX_ATTEMPTS = 2;
const THUMBNAIL_SCROLL_IDLE_MS = 120;
const THUMBNAIL_PREFETCH_VIEWPORTS = 3;
const MAX_THUMBNAIL_BACKING_DIMENSION = 384;

type ThumbnailState = "placeholder" | "rendering" | "ready" | "error";

/** Immutable semantic identity and configuration for thumbnail display rasters. */
interface ThumbnailRasterState {
  readonly optionalContentRevision: number;
  readonly formAppearanceRevision: number;
  readonly formAppearanceRevisionFor?: (pageNo: number) => number;
  readonly printAnnotationStorageFor?: (
    pageNo: number,
    revision: number,
  ) => Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]["printAnnotationStorage"] | null;
  readonly annotationMode: number;
  readonly optionalContentConfigPromise?: NonNullable<
    Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0]["optionalContentConfigPromise"]
  >;
}

interface ThumbnailAdmissionSuspension {
  readonly token: symbol;
  readonly settlement: Promise<void>;
}

interface ThumbnailItem {
  sourceRevision: number;
  source?: Readonly<DocumentPageSourceContext>;
  contentGeneration: number;
  readonly pageNo: number;
  readonly item: HTMLLIElement;
  readonly button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  baseWidth: number;
  baseHeight: number;
  width: number;
  height: number;
  bufferWidth: number;
  bufferHeight: number;
  bytes: number;
  lastNeeded: number;
  attempts: number;
  state: ThumbnailState;
  formAppearanceRevision: number;
  annotationMode: number;
}

interface ActiveOperation {
  readonly sourceRevision: number;
  source?: Readonly<DocumentPageSourceContext>;
  sourceResolved: boolean;
  readonly contentGeneration: number;
  readonly generation: number;
  readonly item: ThumbnailItem;
  readonly abort: AbortController;
  readonly rasterState: ThumbnailRasterState;
  formAppearanceRevision: number;
  lease: BackgroundRasterLease | null;
  renderWidth: number;
  renderHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  bytes: number;
  stale: boolean;
  retainForContentChange: boolean;
}

interface DocumentThumbnailsOptions {
  readonly scrollContainer: HTMLElement | null;
  readonly ownerDocument?: Document;
  readonly coordinator: RasterWorkCoordinator;
  readonly maxDpr: number;
  readonly pageLabel: (pageNo: number) => string;
  readonly errorLabel: string;
  readonly scrollBehavior: () => ScrollBehavior;
}

interface DocumentThumbnailsCallbacks {
  readonly sourceRendered?: (pageNo: number, revision: number) => void;
  readonly sourceFailed?: (pageNo: number, revision: number, error: unknown) => void;
  readonly selectPage: (pageNo: number) => void;
  /** Optional non-sensitive completion timing, installed only when diagnostics are enabled. */
  readonly diagnostic?: (
    entry: Readonly<{
      level: "debug";
      event: "thumbnail-render-completed";
      message: string;
      details: Readonly<Record<string, unknown>>;
    }>,
  ) => void;
}

/** Owns one document generation of placeholders and at most one physical render. */
export class DocumentThumbnails {
  #document: Document | null;
  #window: (Window & typeof globalThis) | null;
  #options: DocumentThumbnailsOptions;
  #callbacks: DocumentThumbnailsCallbacks;
  #pages: DocumentPageAcquirer | null = null;
  #items = new Map<number, ThumbnailItem>();
  #nearVisiblePages = new Set<number>();
  #intersectionPages = new Set<number>();
  #viewportPages = new Set<number>();
  #visibleDemand = new Set<number>();
  #activePages = new Set<number>();
  #generation = 0;
  #contentGeneration = 0;
  #globalContentGeneration = 0;
  #pageContentGenerations = new Map<number, number>();
  #rasterState: ThumbnailRasterState = Object.freeze({
    optionalContentRevision: 0,
    formAppearanceRevision: 0,
    annotationMode: 1,
  });
  #admissionSuspensions = new Set<symbol>();
  #rotation: 0 | 90 | 180 | 270 = 0;
  #fallback = { width: 1, height: Math.SQRT2 };
  #profile: PdfjsViewerRenderingProfileSettings;
  #activeOperation: ActiveOperation | null = null;
  #settlements = new Set<Promise<void>>();
  #nearIntersection: IntersectionObserver | null = null;
  #visibleIntersection: IntersectionObserver | null = null;
  #surfaceResize: ResizeObserver | null = null;
  #retiredSurfaceResizes = new Map<number, HTMLCanvasElement>();
  #neededClock = 0;
  #viewActive = false;
  #lastScrollTop = 0;
  #scrollDirection: -1 | 0 | 1 = 0;
  #scrollIdleTimer: number | null = null;
  #onScroll: (() => void) | null = null;
  #onScrollEnd: (() => void) | null = null;
  #onManualScrollIntent: (() => void) | null = null;
  #revealRaf: number | null = null;
  #automaticReveal = false;
  #automaticRevealBehavior: ScrollBehavior = "auto";
  #expectedScrollTop: number | null = null;
  #programmaticScrollPending = false;
  #programmaticScrollResetRaf: number | null = null;
  #programmaticScrollEndTimer: number | null = null;
  #viewportDemandRaf: number | null = null;

  constructor(
    options: Readonly<DocumentThumbnailsOptions>,
    profile: PdfjsViewerRenderingProfileSettings,
    callbacks: DocumentThumbnailsCallbacks,
  ) {
    this.#options = { ...options };
    this.#document = options.ownerDocument ?? options.scrollContainer?.ownerDocument ?? null;
    this.#window = this.#document?.defaultView as (Window & typeof globalThis) | null;
    this.#profile = profile;
    this.#callbacks = callbacks;
    const IntersectionObserver = this.#window?.IntersectionObserver;
    if (options.scrollContainer && IntersectionObserver) {
      this.#nearIntersection = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const pageNo = Number((entry.target as HTMLElement).dataset.pdfPageNumber);
            const item = this.#items.get(pageNo);
            if (!item || item.item !== entry.target) continue;
            if (entry.isIntersecting) {
              this.#intersectionPages.add(pageNo);
              const renewed = !this.#nearVisiblePages.has(pageNo);
              this.#nearVisiblePages.add(pageNo);
              item.lastNeeded = ++this.#neededClock;
              this.#observeSurface(item);
              this.#reconcileMeasurement(item);
              if (renewed && item?.state === "error") {
                item.attempts = 0;
                item.state = "placeholder";
                this.#clearError(item);
              }
            } else {
              this.#intersectionPages.delete(pageNo);
              if (!this.#viewportPages.has(pageNo)) {
                this.#nearVisiblePages.delete(pageNo);
                this.#surfaceResize?.unobserve(item.canvas);
              }
            }
          }
          this.#refreshVisibleDemandFromGeometry();
          this.#pump();
        },
        {
          root: options.scrollContainer,
          rootMargin: `${THUMBNAIL_PREFETCH_VIEWPORTS * 100}% 0px`,
        },
      );
      this.#visibleIntersection = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const pageNo = Number((entry.target as HTMLElement).dataset.pdfPageNumber);
            const item = this.#items.get(pageNo);
            if (!item || item.item !== entry.target) continue;
            if (entry.isIntersecting) {
              this.#visibleDemand.add(pageNo);
              this.#nearVisiblePages.add(pageNo);
              item.lastNeeded = ++this.#neededClock;
              this.#observeSurface(item);
              this.#reconcileMeasurement(item);
            } else this.#visibleDemand.delete(pageNo);
          }
          this.#refreshVisibleDemandFromGeometry();
          this.#preemptForVisibleDemand();
          this.#pump();
        },
        { root: options.scrollContainer },
      );
    }
    if (options.scrollContainer) {
      this.#onScroll = () => {
        const next = options.scrollContainer!.scrollTop;
        const delta = next - this.#lastScrollTop;
        const programmatic =
          this.#programmaticScrollPending ||
          (this.#expectedScrollTop != null && Math.abs(next - this.#expectedScrollTop) < 1);
        this.#expectedScrollTop = null;
        if (!programmatic && Math.abs(delta) >= 1) this.#scrollDirection = delta > 0 ? 1 : -1;
        this.#lastScrollTop = next;
        if (this.#scrollIdleTimer != null) this.#window?.clearTimeout(this.#scrollIdleTimer);
        this.#scrollIdleTimer =
          this.#window?.setTimeout(() => {
            this.#scrollIdleTimer = null;
            this.#scrollDirection = 0;
            this.#pump();
          }, THUMBNAIL_SCROLL_IDLE_MS) ?? null;
        this.#seedViewportDemand();
        this.#scheduleViewportDemandRefresh();
        if (!this.#nearIntersection) this.#refreshDemandFromGeometry();
        this.#refreshVisibleDemandFromGeometry();
        this.#preemptForVisibleDemand();
        if (
          this.#activeOperation &&
          this.#isBehindScroll(this.#activeOperation.item) &&
          this.#panelDistance(this.#activeOperation.item) > options.scrollContainer!.clientHeight
        )
          this.#cancelActive();
        this.#pump();
      };
      options.scrollContainer.addEventListener("scroll", this.#onScroll, { passive: true });
      this.#onManualScrollIntent = () => {
        this.#finishProgrammaticScroll();
        this.#automaticReveal = false;
        if (this.#revealRaf != null) this.#window?.cancelAnimationFrame(this.#revealRaf);
        this.#revealRaf = null;
      };
      for (const type of ["pointerdown", "touchstart", "wheel", "keydown"] as const) {
        options.scrollContainer.addEventListener(type, this.#onManualScrollIntent, {
          passive: true,
        });
      }
      this.#onScrollEnd = () => this.#finishProgrammaticScroll();
      options.scrollContainer.addEventListener("scrollend", this.#onScrollEnd, { passive: true });
    }
    const ResizeObserver = this.#window?.ResizeObserver;
    if (ResizeObserver) {
      this.#surfaceResize = new ResizeObserver(entries => {
        for (const entry of entries) {
          const pageNo = Number((entry.target as HTMLElement).dataset.pdfPageNumber);
          const item = this.#items.get(pageNo);
          if (item && item.canvas === entry.target) this.#reconcileMeasurement(item);
        }
        this.#refreshVisibleDemandFromGeometry();
        this.#preemptForVisibleDemand();
        this.#pump();
      });
    }
  }

  beginDocument(
    pages: DocumentPageAcquirer,
    pageCount: number,
    fallback: Readonly<{ width: number; height: number }>,
  ): void {
    this.resetDocument();
    this.#pages = pages;
    this.#generation++;
    if (fallback.width > 0 && fallback.height > 0) this.#fallback = { ...fallback };
    const scrollContainer = this.#options.scrollContainer;
    if (!scrollContainer) return;
    const ownerDocument = this.#document;
    if (!ownerDocument) return;
    const list = ownerDocument.createElement("ol");
    list.className = "pdf-thumbnail-list";
    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
      const itemEl = ownerDocument.createElement("li");
      itemEl.className = "pdf-thumbnail";
      itemEl.dataset.pdfPageNumber = String(pageNo);
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = "pdf-thumbnail-button";
      button.setAttribute("aria-label", this.#options.pageLabel(pageNo));
      const canvas = ownerDocument.createElement("canvas");
      canvas.className = "pdf-thumbnail-canvas";
      canvas.dataset.pdfPageNumber = String(pageNo);
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.visibility = "visible";
      const number = ownerDocument.createElement("span");
      number.className = "pdf-thumbnail-page-number";
      number.textContent = String(pageNo);
      button.append(canvas, number);
      itemEl.append(button);
      list.append(itemEl);
      const item: ThumbnailItem = {
        sourceRevision: -1,
        contentGeneration: -1,
        pageNo,
        item: itemEl,
        button,
        canvas,
        baseWidth: this.#fallback.width,
        baseHeight: this.#fallback.height,
        width: 0,
        height: 0,
        bufferWidth: 0,
        bufferHeight: 0,
        bytes: 0,
        lastNeeded: 0,
        attempts: 0,
        state: "placeholder",
        formAppearanceRevision: -1,
        annotationMode: -1,
      };
      this.#applyAspectRatio(item);
      this.#items.set(pageNo, item);
      button.addEventListener("click", () => this.#callbacks.selectPage(pageNo));
      this.#nearIntersection?.observe(itemEl);
      this.#visibleIntersection?.observe(itemEl);
    }
    scrollContainer.replaceChildren(list);
  }

  resetDocument(): readonly Promise<unknown>[] {
    const settlements = [...this.#settlements];
    this.#generation++;
    this.#cancelActive();
    this.#pageContentGenerations.clear();
    this.#globalContentGeneration = ++this.#contentGeneration;
    this.#nearIntersection?.takeRecords();
    this.#visibleIntersection?.takeRecords();
    this.#pages = null;
    this.#retiredSurfaceResizes.clear();
    this.#nearVisiblePages.clear();
    this.#intersectionPages.clear();
    this.#viewportPages.clear();
    this.#visibleDemand.clear();
    this.#activePages.clear();
    if (this.#scrollIdleTimer != null) this.#window?.clearTimeout(this.#scrollIdleTimer);
    this.#scrollIdleTimer = null;
    this.#scrollDirection = 0;
    this.#automaticReveal = false;
    this.#automaticRevealBehavior = "auto";
    this.#expectedScrollTop = null;
    this.#programmaticScrollPending = false;
    if (this.#programmaticScrollEndTimer != null)
      this.#window?.clearTimeout(this.#programmaticScrollEndTimer);
    this.#programmaticScrollEndTimer = null;
    if (this.#programmaticScrollResetRaf != null)
      this.#window?.cancelAnimationFrame(this.#programmaticScrollResetRaf);
    this.#programmaticScrollResetRaf = null;
    if (this.#viewportDemandRaf != null)
      this.#window?.cancelAnimationFrame(this.#viewportDemandRaf);
    this.#viewportDemandRaf = null;
    if (this.#revealRaf != null) this.#window?.cancelAnimationFrame(this.#revealRaf);
    this.#revealRaf = null;
    for (const item of this.#items.values()) {
      this.#nearIntersection?.unobserve(item.item);
      this.#visibleIntersection?.unobserve(item.item);
      this.#surfaceResize?.unobserve(item.canvas);
      if (this.#activeOperation?.item !== item) this.#clearBackingStore(item);
    }
    this.#items.clear();
    this.#options.scrollContainer?.replaceChildren();
    return settlements;
  }

  destroy(): void {
    this.resetDocument();
    this.#nearIntersection?.disconnect();
    this.#visibleIntersection?.disconnect();
    this.#surfaceResize?.disconnect();
    if (this.#onScroll && this.#options.scrollContainer)
      this.#options.scrollContainer.removeEventListener("scroll", this.#onScroll);
    if (this.#onScrollEnd && this.#options.scrollContainer)
      this.#options.scrollContainer.removeEventListener("scrollend", this.#onScrollEnd);
    if (this.#onManualScrollIntent && this.#options.scrollContainer) {
      for (const type of ["pointerdown", "touchstart", "wheel", "keydown"] as const) {
        this.#options.scrollContainer.removeEventListener(type, this.#onManualScrollIntent);
      }
    }
  }

  /** Refreshes package-authored thumbnail labels without affecting raster work. */
  setUiText(pageLabel: (pageNo: number) => string, errorLabel: string): void {
    this.#options = { ...this.#options, pageLabel, errorLabel };
    for (const item of this.#items.values()) {
      item.button.setAttribute(
        "aria-label",
        item.state === "error"
          ? `${pageLabel(item.pageNo)}. ${errorLabel}`
          : pageLabel(item.pageNo),
      );
      if (item.state === "error") item.button.title = errorLabel;
    }
  }

  setProfile(profile: PdfjsViewerRenderingProfileSettings): void {
    this.#cancelActive();
    this.#profile = profile;
    const maxDimension = Math.min(profile.maxCanvasDimension, MAX_THUMBNAIL_BACKING_DIMENSION);
    for (const item of this.#items.values()) {
      if (item.state !== "ready") continue;
      if (
        item.bufferWidth > maxDimension ||
        item.bufferHeight > maxDimension ||
        item.bufferWidth * item.bufferHeight > profile.maxCanvasPixels
      )
        this.#invalidate(item);
    }
    this.#evictToBudget();
    this.#pump();
  }

  /** Releases every thumbnail backing store during exclusive print preparation. */
  evictBackingStoresForExclusiveWork(): Readonly<{ count: number; bytes: number }> {
    let count = 0;
    let bytes = 0;
    for (const item of this.#items.values()) {
      if (!item.bytes || this.#activeOperation?.item === item) continue;
      bytes += item.bytes;
      this.#clearBackingStore(item);
      item.state = "placeholder";
      count++;
    }
    return Object.freeze({ count, bytes });
  }

  /** All thumbnail backing-store bytes still retained after exclusive eviction. */
  rasterBytesForExclusiveWork(): number {
    let bytes = 0;
    for (const item of this.#items.values()) bytes += item.bytes;
    return bytes;
  }

  /**
   * Installs latest configuration while retaining old canvases until lazy replacement.
   * A page set limits OCG invalidation; form/mode changes still use global validation.
   */
  setRasterState(
    state: Readonly<ThumbnailRasterState>,
    affectedPages?: ReadonlySet<number>,
    force = false,
  ): boolean {
    if (
      !Number.isSafeInteger(state.optionalContentRevision) ||
      state.optionalContentRevision < 0 ||
      !Number.isSafeInteger(state.formAppearanceRevision) ||
      state.formAppearanceRevision < 0 ||
      !Number.isSafeInteger(state.annotationMode) ||
      state.annotationMode < 0
    ) {
      throw new TypeError("Invalid thumbnail raster state");
    }
    if (
      !force &&
      state.optionalContentRevision === this.#rasterState.optionalContentRevision &&
      state.formAppearanceRevision === this.#rasterState.formAppearanceRevision &&
      state.annotationMode === this.#rasterState.annotationMode
    )
      return false;
    const targeted =
      affectedPages !== undefined &&
      !force &&
      state.annotationMode === this.#rasterState.annotationMode &&
      state.formAppearanceRevision === this.#rasterState.formAppearanceRevision;
    const pages = targeted ? new Set(affectedPages) : undefined;
    const generation = ++this.#contentGeneration;
    if (pages) {
      for (const pageNo of pages) this.#pageContentGenerations.set(pageNo, generation);
    } else {
      this.#globalContentGeneration = generation;
      this.#pageContentGenerations.clear();
    }
    this.#rasterState = Object.freeze({
      optionalContentRevision: state.optionalContentRevision,
      formAppearanceRevision: state.formAppearanceRevision,
      annotationMode: state.annotationMode,
      ...(state.formAppearanceRevisionFor
        ? { formAppearanceRevisionFor: state.formAppearanceRevisionFor }
        : {}),
      ...(state.printAnnotationStorageFor
        ? { printAnnotationStorageFor: state.printAnnotationStorageFor }
        : {}),
      ...(state.optionalContentConfigPromise
        ? { optionalContentConfigPromise: state.optionalContentConfigPromise }
        : {}),
    });
    const installed = this.#rasterState;
    const documentGeneration = this.#generation;
    if (!pages || (this.#activeOperation && pages.has(this.#activeOperation.item.pageNo)))
      this.#cancelActive();
    else if (this.#activeOperation) this.#activeOperation.retainForContentChange = true;
    if (this.#rasterState !== installed || this.#generation !== documentGeneration) return true;
    for (const item of this.#items.values()) {
      if (pages && !pages.has(item.pageNo)) continue;
      if (!this.#itemSatisfiesRasterState(item)) this.#invalidate(item, true);
    }
    this.#pump();
    return true;
  }

  /** Revokes only changed display slots while retaining their lazy replacement bitmaps. */
  invalidatePageSources(pages: ReadonlySet<number>): void {
    if (!pages.size) return;
    const generation = ++this.#contentGeneration;
    const documentGeneration = this.#generation;
    for (const pageNo of pages) this.#pageContentGenerations.set(pageNo, generation);
    if (this.#activeOperation && !pages.has(this.#activeOperation.item.pageNo))
      this.#activeOperation.retainForContentChange = true;
    for (const pageNo of pages) {
      const item = this.#items.get(pageNo);
      if (item) this.#invalidate(item, true);
      if (documentGeneration !== this.#generation) return;
    }
    this.#pump();
  }

  /** Invalidates only thumbnails whose interactive form appearance changed. */
  invalidateFormPages(pages: readonly number[]): void {
    for (const pageNo of new Set(pages)) {
      const item = this.#items.get(pageNo);
      if (item && !this.#itemSatisfiesRasterState(item)) this.#invalidate(item, true);
    }
    this.#pump();
  }

  /** Revokes current work and blocks admission until the exact token is resumed. */
  suspendAdmission(): Readonly<ThumbnailAdmissionSuspension> {
    const token = Symbol("document-thumbnails-admission");
    this.#admissionSuspensions.add(token);
    this.#cancelActive();
    const captured = [...this.#settlements];
    return Object.freeze({ token, settlement: Promise.allSettled(captured).then(() => undefined) });
  }

  resumeAdmission(token: symbol): void {
    if (!this.#admissionSuspensions.delete(token) || this.#admissionSuspensions.size) return;
    this.#pump();
  }

  setViewActive(active: boolean): void {
    this.#viewActive = active;
    if (!active) {
      this.#retiredSurfaceResizes.clear();
      if (this.#scrollIdleTimer != null) this.#window?.clearTimeout(this.#scrollIdleTimer);
      this.#scrollIdleTimer = null;
      this.#scrollDirection = 0;
      this.#expectedScrollTop = null;
      this.#programmaticScrollPending = false;
      if (this.#programmaticScrollEndTimer != null)
        this.#window?.clearTimeout(this.#programmaticScrollEndTimer);
      this.#programmaticScrollEndTimer = null;
      this.#automaticReveal = false;
      for (const pageNo of this.#nearVisiblePages) {
        const item = this.#items.get(pageNo);
        if (item) this.#surfaceResize?.unobserve(item.canvas);
      }
      if (this.#programmaticScrollResetRaf != null)
        this.#window?.cancelAnimationFrame(this.#programmaticScrollResetRaf);
      this.#programmaticScrollResetRaf = null;
      this.#cancelActive();
    } else {
      this.#lastScrollTop = this.#options.scrollContainer?.scrollTop ?? 0;
      this.#scrollDirection = 0;
      for (const pageNo of this.#activePages) {
        const item = this.#items.get(pageNo);
        if (item) {
          this.#observeSurface(item);
          this.#reconcileMeasurement(item);
        }
      }
      this.#scheduleRevealActivePages(true, "auto");
      this.#seedDemand();
      this.#refreshVisibleDemandFromGeometry();
      this.#pump();
    }
  }

  setRotation(rotation: 0 | 90 | 180 | 270): void {
    if (this.#rotation === rotation) return;
    this.#rotation = rotation;
    for (const item of this.#items.values()) {
      this.#applyAspectRatio(item);
      this.#invalidate(item);
    }
    this.#pump();
  }

  setActivePages(pages: readonly number[]): void {
    const next = new Set(pages);
    const changed =
      pages.length !== this.#activePages.size || pages.some(page => !this.#activePages.has(page));
    const previous = this.#activePages;
    this.#activePages = next;
    for (const pageNo of previous) {
      if (next.has(pageNo)) continue;
      const item = this.#items.get(pageNo);
      item?.item.classList.remove("pdf-thumbnail-current");
      item?.button.removeAttribute("aria-current");
    }
    for (const pageNo of next) {
      if (previous.has(pageNo)) continue;
      const item = this.#items.get(pageNo);
      item?.item.classList.add("pdf-thumbnail-current");
      item?.button.setAttribute("aria-current", "page");
    }
    if (changed && this.#viewActive)
      this.#scheduleRevealActivePages(true, this.#options.scrollBehavior());
  }

  observePageGeometry(pageNo: number, width: number, height: number): void {
    const item = this.#items.get(pageNo);
    if (!item || width <= 0 || height <= 0) return;
    const changed = item.baseWidth !== width || item.baseHeight !== height;
    item.baseWidth = width;
    item.baseHeight = height;
    this.#applyAspectRatio(item);
    this.#reconcileMeasurement(item);
    if (changed) {
      this.#refreshVisibleDemandFromGeometry();
      this.#pump();
    }
  }

  notifyAdmissionChanged(): void {
    this.#pump();
  }

  #pump(): void {
    if (!this.#viewActive || !this.#pages || this.#admissionSuspensions.size) return;
    this.#seedViewportDemand();
    this.#refreshVisibleDemandFromGeometry(false);
    if (this.#activeOperation) {
      this.#preemptForVisibleDemand();
      return;
    }
    if (!this.#options.coordinator.canStartBackground) return;
    const items = [...this.#nearVisiblePages]
      .map(pageNo => this.#items.get(pageNo))
      .filter(
        (item): item is ThumbnailItem =>
          !!item &&
          item.width > 0 &&
          item.state !== "rendering" &&
          !(
            item.state === "ready" &&
            this.#itemSatisfiesRasterState(item) &&
            !this.#needsVisibleQualityUpgrade(item)
          ) &&
          (item.state !== "error" || item.attempts < MAX_ATTEMPTS),
      );
    const viewport = this.#panelGeometry();
    if (!viewport) return;
    const candidates = items.map(item => this.#itemGeometry(item));
    const pageNo = selectThumbnailRenderCandidate(
      candidates,
      viewport,
      this.#visibleDemand,
      this.#scrollDirection,
      this.#activePages,
    );
    const item = pageNo == null ? null : this.#items.get(pageNo);
    if (!item) return;
    const operation: ActiveOperation = {
      sourceRevision: this.#pages.revision?.(item.pageNo) ?? 0,
      sourceResolved: false,
      contentGeneration: this.#contentGenerationFor(item.pageNo),
      generation: this.#generation,
      item,
      abort: new AbortController(),
      lease: null,
      rasterState: this.#rasterState,
      formAppearanceRevision: this.#pages.revision ? -1 : this.#formRevisionFor(item.pageNo),
      renderWidth: 0,
      renderHeight: 0,
      bufferWidth: 0,
      bufferHeight: 0,
      bytes: 0,
      stale: false,
      retainForContentChange: false,
    };
    operation.lease = this.#options.coordinator.acquireBackground(() => {
      operation.stale = true;
      operation.abort.abort();
    });
    if (!operation.lease) return;
    this.#activeOperation = operation;
    item.state = "rendering";
    item.item.removeAttribute("data-pdf-thumbnail-ready");
    this.#clearError(item);
    const settlement = this.#render(operation).finally(() => {
      this.#settlements.delete(settlement);
      if (operation.stale) {
        operation.item.state = "placeholder";
        if (!this.#currentGeneration(operation)) this.#clearBackingStore(operation.item);
      }
      if (this.#activeOperation === operation) this.#activeOperation = null;
      operation.lease?.release();
      this.#pump();
    });
    this.#settlements.add(settlement);
  }

  async #render(operation: ActiveOperation): Promise<void> {
    const measure = !!this.#callbacks.diagnostic;
    const started = measure ? performance.now() : 0;
    let use: DocumentPageUse | null = null;
    let temporary: HTMLCanvasElement | null = null;
    let committed = false;
    try {
      use = await this.#pages!.acquire(operation.item.pageNo);
      if ((use.source?.revision ?? 0) !== operation.sourceRevision) return;
      operation.source = use.source;
      if (use.source?.id == null && operation.formAppearanceRevision < 0)
        operation.formAppearanceRevision = this.#formRevisionFor(operation.item.pageNo);
      operation.sourceResolved = true;
      const acquired = measure ? performance.now() : 0;
      if (!this.#current(operation)) return;
      const page = use.page;
      const source = use.source;
      const annotationMode = source?.id != null ? 1 : operation.rasterState.annotationMode;
      const optionalContentConfigPromise =
        source?.id != null
          ? source.optionalContentConfigPromise
          : operation.rasterState.optionalContentConfigPromise;
      const fonts = source?.fonts;
      if (fonts) await fonts.prepare(page, annotationMode, operation.abort.signal);
      if (!this.#current(operation)) return;
      const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
      const viewport = page.getViewport({
        scale: 1,
        rotation: (page.rotate + this.#rotation) % 360,
      });
      if (!(viewport.width > 0) || !(viewport.height > 0))
        throw new Error("Invalid thumbnail viewport geometry");
      operation.item.baseWidth = baseViewport.width;
      operation.item.baseHeight = baseViewport.height;
      this.#applyAspectRatio(operation.item);
      // Exact page geometry refines the active requirement; it must not cancel itself.
      this.#reconcileMeasurement(operation.item, false);
      if (!this.#current(operation) || operation.item.width <= 0) return;
      const budget = this.#planAdmission(operation.item, viewport.width, viewport.height);
      const scale = operation.item.width / viewport.width;
      const renderViewport = page.getViewport({
        scale,
        rotation: (page.rotate + this.#rotation) % 360,
      });
      temporary = operation.item.canvas.ownerDocument.createElement("canvas");
      temporary.className = "pdf-thumbnail-canvas";
      temporary.dataset.pdfPageNumber = String(operation.item.pageNo);
      temporary.style.aspectRatio = operation.item.canvas.style.aspectRatio;
      temporary.style.visibility = "hidden";
      temporary.width = budget.width;
      temporary.height = budget.height;
      operation.bufferWidth = budget.width;
      operation.bufferHeight = budget.height;
      operation.bytes = budget.bytes;
      const context = temporary.getContext("2d");
      if (!context) throw new Error("Thumbnail canvas 2D context is unavailable");
      operation.renderWidth = operation.item.width;
      operation.renderHeight = operation.item.height;
      context.setTransform(fonts ? 1 : budget.dpr, 0, 0, fonts ? 1 : budget.dpr, 0, 0);
      context.imageSmoothingEnabled = true;
      const canvasContext = fonts?.context(context, budget.dpr) ?? context;
      const printAnnotationStorage =
        source?.id != null
          ? null
          : (operation.rasterState.printAnnotationStorageFor?.(
              operation.item.pageNo,
              operation.formAppearanceRevision,
            ) ?? null);
      const render = startPdfPageRenderTask(
        page,
        {
          canvas: canvasContext === context ? temporary : null,
          canvasContext,
          ...(fonts ? { transform: [budget.dpr, 0, 0, budget.dpr, 0, 0] } : {}),
          viewport: renderViewport,
          intent: "display",
          annotationMode,
          ...(printAnnotationStorage ? { printAnnotationStorage } : {}),
          ...(optionalContentConfigPromise ? { optionalContentConfigPromise } : {}),
        },
        operation.abort.signal,
        canvasContext !== context && fonts
          ? context => fonts.context(context, budget.dpr)
          : undefined,
      );
      const taskStarted = measure ? performance.now() : 0;
      await render.promise;
      const taskCompleted = measure ? performance.now() : 0;
      if (!this.#current(operation)) return;
      if (
        Math.abs(operation.item.width - operation.renderWidth) >= 0.25 ||
        Math.abs(operation.item.height - operation.renderHeight) >= 0.25
      ) {
        operation.item.state = "placeholder";
        return;
      }
      const placeholder = operation.item.canvas;
      this.#surfaceResize?.unobserve(placeholder);
      temporary.style.visibility = "visible";
      placeholder.replaceWith(temporary);
      operation.item.canvas = temporary;
      placeholder.width = 0;
      placeholder.height = 0;
      if (this.#nearVisiblePages.has(operation.item.pageNo)) this.#observeSurface(operation.item);
      committed = true;
      operation.item.bufferWidth = operation.bufferWidth;
      operation.item.bufferHeight = operation.bufferHeight;
      operation.item.bytes = operation.bytes;
      operation.item.state = "ready";
      operation.item.contentGeneration = operation.contentGeneration;
      operation.item.sourceRevision = operation.sourceRevision;
      operation.item.source = operation.source;
      operation.item.formAppearanceRevision = operation.formAppearanceRevision;
      operation.item.annotationMode = operation.rasterState.annotationMode;
      operation.item.item.setAttribute("data-pdf-thumbnail-ready", "");
      operation.item.attempts = 0;
      operation.item.lastNeeded = ++this.#neededClock;
      this.#evictToBudget(operation.item.pageNo);
      if (this.#activePages.has(operation.item.pageNo)) this.#scheduleRevealActivePages(false);
      if (this.#current(operation)) {
        try {
          this.#callbacks.sourceRendered?.(operation.item.pageNo, operation.sourceRevision);
        } catch {
          /* Observers do not own physical settlement. */
        }
      }
      if (measure) {
        const completed = performance.now();
        try {
          this.#callbacks.diagnostic?.({
            level: "debug",
            event: "thumbnail-render-completed",
            message: `Committed page ${operation.item.pageNo} thumbnail render`,
            details: {
              pageNo: operation.item.pageNo,
              elapsedMs: completed - started,
              pageAcquisitionMs: acquired - started,
              renderTaskMs: taskCompleted - taskStarted,
              commitMs: completed - taskCompleted,
            },
          });
        } catch {
          // Consumer diagnostics must not turn a committed thumbnail into a failure.
        }
      }
    } catch (error) {
      if (operation.abort.signal.aborted || !this.#current(operation)) return;
      operation.item.attempts++;
      operation.item.state = operation.item.attempts >= MAX_ATTEMPTS ? "error" : "placeholder";
      if (operation.item.state === "error") {
        operation.item.item.classList.add("pdf-thumbnail-error");
        operation.item.button.setAttribute(
          "aria-label",
          `${this.#options.pageLabel(operation.item.pageNo)}. ${this.#options.errorLabel}`,
        );
        operation.item.button.title = this.#options.errorLabel;
      }
      if (!operation.item.bytes) this.#clearBackingStore(operation.item);
      try {
        this.#callbacks.sourceFailed?.(operation.item.pageNo, operation.sourceRevision, error);
      } catch {
        /* Observers do not own physical settlement. */
      }
    } finally {
      if (temporary && !committed) {
        temporary.width = 0;
        temporary.height = 0;
      }
      use?.release();
      if (!committed && operation.item.state === "rendering") operation.item.state = "placeholder";
    }
  }

  #planAdmission(item: ThumbnailItem, viewportWidth: number, viewportHeight: number) {
    const requested = Math.min(this.#options.maxDpr, this.#window?.devicePixelRatio || 1);
    const cssPixels = Math.max(1, item.width * ((item.width * viewportHeight) / viewportWidth));
    const canvasLimitedDpr = Math.min(
      requested,
      Math.min(this.#profile.maxCanvasDimension, MAX_THUMBNAIL_BACKING_DIMENSION) /
        Math.max(item.width, item.height),
      Math.sqrt(this.#profile.maxCanvasPixels / cssPixels),
    );
    const desiredBytes = Math.max(
      4,
      Math.floor(cssPixels * canvasLimitedDpr * canvasLimitedDpr * 4),
    );
    this.#evictForAdmission(desiredBytes, item.pageNo);
    const availableBytes = this.#limitBytes() - this.#cacheBytes();
    if (availableBytes < 4)
      throw new Error("Thumbnail replacement has no offscreen memory headroom");
    return computeThumbnailRasterBudget({
      cssWidth: item.width,
      cssHeight: (item.width * viewportHeight) / viewportWidth,
      maxDpr: canvasLimitedDpr,
      devicePixelRatio: requested,
      maxCanvasPixels: this.#profile.maxCanvasPixels,
      maxCanvasDimension: Math.min(
        this.#profile.maxCanvasDimension,
        MAX_THUMBNAIL_BACKING_DIMENSION,
      ),
      availableBytes,
    });
  }

  /** Promote reduced prefetch pixels only when visible output can improve within its retained budget. */
  #needsVisibleQualityUpgrade(item: ThumbnailItem): boolean {
    if (!this.#visibleDemand.has(item.pageNo) || !(item.height > 0)) return false;
    let retainedVisibleBytes = 0;
    for (const pageNo of this.#visibleDemand)
      retainedVisibleBytes += this.#items.get(pageNo)?.bytes ?? 0;
    const availableBytes = this.#limitBytes() - retainedVisibleBytes;
    if (availableBytes < 4) return false;
    const budget = computeThumbnailRasterBudget({
      cssWidth: item.width,
      cssHeight: item.height,
      maxDpr: this.#options.maxDpr,
      devicePixelRatio: this.#window?.devicePixelRatio || 1,
      maxCanvasPixels: this.#profile.maxCanvasPixels,
      maxCanvasDimension: Math.min(
        this.#profile.maxCanvasDimension,
        MAX_THUMBNAIL_BACKING_DIMENSION,
      ),
      availableBytes,
    });
    return budget.width > item.bufferWidth + 1 || budget.height > item.bufferHeight + 1;
  }

  #reconcileMeasurement(item: ThumbnailItem, invalidate = true): void {
    const rect = item.canvas.getBoundingClientRect();
    let width = rect.width;
    try {
      const style = this.#window?.getComputedStyle(item.canvas);
      if (!style) return;
      width -= parseFloat(style.borderLeftWidth) || 0;
      width -= parseFloat(style.borderRightWidth) || 0;
      width -= parseFloat(style.paddingLeft) || 0;
      width -= parseFloat(style.paddingRight) || 0;
    } catch {}
    width = Math.max(0, width);
    const ratio = this.#ratio(item);
    const height = width / ratio;
    if (Math.abs(item.width - width) < 0.25 && Math.abs(item.height - height) < 0.25) return;
    item.width = width;
    item.height = height;
    if (invalidate && this.#activeOperation?.item !== item) this.#invalidate(item, true);
    if (this.#viewActive && this.#activePages.has(item.pageNo))
      this.#scheduleRevealActivePages(false);
  }

  #ratio(item: ThumbnailItem): number {
    const rotated = this.#rotation === 90 || this.#rotation === 270;
    const width = rotated ? item.baseHeight : item.baseWidth;
    const height = rotated ? item.baseWidth : item.baseHeight;
    return width > 0 && height > 0 ? width / height : this.#fallback.width / this.#fallback.height;
  }

  #applyAspectRatio(item: ThumbnailItem): void {
    const ratio = this.#ratio(item);
    item.canvas.style.aspectRatio = `${ratio} / 1`;
  }

  #clearError(item: ThumbnailItem): void {
    item.item.classList.remove("pdf-thumbnail-error");
    item.button.removeAttribute("title");
    item.button.setAttribute("aria-label", this.#options.pageLabel(item.pageNo));
  }

  #invalidate(item: ThumbnailItem, retainBitmap = false): void {
    if (this.#activeOperation?.item === item) this.#cancelActive();
    if (!retainBitmap && item.bytes) this.#clearBackingStore(item);
    item.state = "placeholder";
    item.attempts = 0;
  }

  #cancelActive(): void {
    const operation = this.#activeOperation;
    if (!operation || operation.stale) return;
    operation.stale = true;
    operation.abort.abort();
  }

  #preemptForVisibleDemand(): void {
    const operation = this.#activeOperation;
    if (
      !operation ||
      operation.retainForContentChange ||
      this.#visibleDemand.has(operation.item.pageNo)
    )
      return;
    const visibleMissing = [...this.#visibleDemand].some(pageNo => {
      const item = this.#items.get(pageNo);
      return (
        !!item && item.state !== "ready" && (item.state !== "error" || item.attempts < MAX_ATTEMPTS)
      );
    });
    if (visibleMissing) this.#cancelActive();
  }

  #refreshVisibleDemandFromGeometry(viewportChanged = true): void {
    const scrollContainer = this.#options.scrollContainer;
    if (!scrollContainer) return;
    // Content-only pumping retains unrelated work; a new viewport demand does not.
    if (viewportChanged && this.#activeOperation)
      this.#activeOperation.retainForContentChange = false;
    const viewport = scrollContainer.getBoundingClientRect();
    this.#visibleDemand.clear();
    for (const pageNo of this.#nearVisiblePages) {
      const item = this.#items.get(pageNo);
      if (!item) continue;
      const bounds = item.item.getBoundingClientRect();
      if (bounds.bottom >= viewport.top && bounds.top <= viewport.bottom)
        this.#visibleDemand.add(pageNo);
    }
  }

  /** Seeds a bounded visible neighborhood when observer delivery lags scrolling. */
  #seedViewportDemand(): void {
    const scrollContainer = this.#options.scrollContainer;
    if (!scrollContainer || !this.#items.size) return;
    const viewport = scrollContainer.getBoundingClientRect();
    if (!(viewport.width > 0) || !(viewport.height > 0)) return;
    let low = 1;
    let high = this.#items.size;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const item = this.#items.get(middle);
      if (!item || item.item.getBoundingClientRect().bottom >= viewport.top) high = middle;
      else low = middle + 1;
    }
    let afterViewport = 0;
    const nextViewportPages = new Set<number>();
    for (let pageNo = Math.max(1, low - 2); pageNo <= this.#items.size; pageNo++) {
      const item = this.#items.get(pageNo);
      if (!item) continue;
      const bounds = item.item.getBoundingClientRect();
      if (bounds.top > viewport.bottom && ++afterViewport > 2) break;
      nextViewportPages.add(pageNo);
      this.#nearVisiblePages.add(pageNo);
      item.lastNeeded = ++this.#neededClock;
      this.#observeSurface(item);
      this.#reconcileMeasurement(item);
    }
    for (const pageNo of this.#viewportPages) {
      if (nextViewportPages.has(pageNo) || this.#intersectionPages.has(pageNo)) continue;
      this.#nearVisiblePages.delete(pageNo);
      const item = this.#items.get(pageNo);
      if (item) this.#surfaceResize?.unobserve(item.canvas);
    }
    this.#viewportPages = nextViewportPages;
  }

  #scheduleViewportDemandRefresh(): void {
    if (this.#viewportDemandRaf != null) return;
    this.#viewportDemandRaf =
      this.#window?.requestAnimationFrame(() => {
        this.#viewportDemandRaf = null;
        const retired = [...this.#retiredSurfaceResizes];
        this.#retiredSurfaceResizes.clear();
        if (!this.#viewActive) return;
        for (const [pageNo, canvas] of retired)
          if (this.#items.get(pageNo)?.canvas === canvas && this.#nearVisiblePages.has(pageNo))
            this.#surfaceResize?.observe(canvas);
        this.#seedViewportDemand();
        this.#refreshVisibleDemandFromGeometry();
        this.#preemptForVisibleDemand();
        this.#pump();
      }) ?? null;
  }

  /** Geometry fallback for platforms without intersection observation. */
  #refreshDemandFromGeometry(): void {
    const scrollContainer = this.#options.scrollContainer;
    if (!scrollContainer) return;
    const viewport = scrollContainer.getBoundingClientRect();
    if (!(viewport.width > 0) || !(viewport.height > 0)) return;
    const top = viewport.top - viewport.height * THUMBNAIL_PREFETCH_VIEWPORTS;
    const bottom = viewport.bottom + viewport.height * THUMBNAIL_PREFETCH_VIEWPORTS;
    const previous = this.#nearVisiblePages;
    this.#nearVisiblePages = new Set();
    this.#intersectionPages.clear();
    this.#viewportPages.clear();
    this.#visibleDemand.clear();
    for (const item of this.#items.values()) {
      const bounds = item.item.getBoundingClientRect();
      if (bounds.bottom < top || bounds.top > bottom) continue;
      this.#nearVisiblePages.add(item.pageNo);
      item.lastNeeded = ++this.#neededClock;
      this.#observeSurface(item);
      this.#reconcileMeasurement(item);
      if (bounds.bottom >= viewport.top && bounds.top <= viewport.bottom)
        this.#visibleDemand.add(item.pageNo);
    }
    for (const pageNo of previous) {
      if (this.#nearVisiblePages.has(pageNo)) continue;
      const item = this.#items.get(pageNo);
      if (item) this.#surfaceResize?.unobserve(item.canvas);
    }
  }

  #current(operation: ActiveOperation): boolean {
    return (
      this.#activeOperation === operation &&
      !operation.stale &&
      this.#sourceIsCurrent(operation.item.pageNo, operation.sourceRevision, operation.source) &&
      this.#currentGeneration(operation) &&
      operation.contentGeneration === this.#contentGenerationFor(operation.item.pageNo) &&
      (!operation.sourceResolved ||
        operation.source?.id != null ||
        (operation.formAppearanceRevision === this.#formRevisionFor(operation.item.pageNo) &&
          operation.rasterState.annotationMode === this.#rasterState.annotationMode))
    );
  }

  #itemSatisfiesRasterState(item: ThumbnailItem): boolean {
    return (
      item.contentGeneration === this.#contentGenerationFor(item.pageNo) &&
      this.#sourceIsCurrent(item.pageNo, item.sourceRevision, item.source) &&
      (item.source?.id != null ||
        (item.formAppearanceRevision === this.#formRevisionFor(item.pageNo) &&
          item.annotationMode === this.#rasterState.annotationMode))
    );
  }

  #currentGeneration(operation: ActiveOperation): boolean {
    return (
      operation.generation === this.#generation &&
      this.#items.get(operation.item.pageNo) === operation.item
    );
  }

  /** Mapping revocation does not release the page use or physical background lease. */
  #sourceIsCurrent(
    pageNo: number,
    revision: number,
    source?: Readonly<DocumentPageSourceContext>,
  ): boolean {
    return (
      revision === (this.#pages?.revision?.(pageNo) ?? 0) &&
      (!source ||
        (source.revision === revision && source.logicalPage === pageNo && source.isCurrent()))
    );
  }

  #formRevisionFor(pageNo: number): number {
    return (
      this.#rasterState.formAppearanceRevisionFor?.(pageNo) ??
      this.#rasterState.formAppearanceRevision
    );
  }

  /** A full config update does not invalidate equivalent pixels on unrelated pages. */
  #contentGenerationFor(pageNo: number): number {
    return this.#pageContentGenerations.get(pageNo) ?? this.#globalContentGeneration;
  }

  #limitBytes(): number {
    return this.#profile.thumbnailMemoryLimitMiB * BYTES_PER_MIB;
  }
  #cacheBytes(): number {
    let bytes = 0;
    for (const item of this.#items.values()) bytes += item.bytes;
    return bytes;
  }

  #evictToBudget(preservePage?: number): void {
    let bytes = this.#cacheBytes();
    if (bytes <= this.#limitBytes()) return;
    for (const item of this.#evictionCandidates(preservePage)) {
      bytes -= item.bytes;
      this.#clearBackingStore(item);
      item.state = "placeholder";
      if (bytes <= this.#limitBytes()) break;
    }
  }

  #evictForAdmission(requiredBytes: number, preservePage: number): void {
    const retainedLimit = Math.max(
      0,
      this.#limitBytes() - Math.min(requiredBytes, this.#limitBytes()),
    );
    let retainedBytes = this.#cacheBytes();
    if (retainedBytes <= retainedLimit) return;
    for (const item of this.#evictionCandidates(preservePage)) {
      // Fit replacements/prefetch around readable visible pixels, not by blanking them.
      if (this.#visibleDemand.has(item.pageNo)) continue;
      retainedBytes -= item.bytes;
      this.#clearBackingStore(item);
      item.state = "placeholder";
      if (retainedBytes <= retainedLimit) break;
    }
    const preserved = this.#items.get(preservePage);
    if (
      retainedBytes > retainedLimit &&
      preserved?.bytes &&
      !this.#visibleDemand.has(preservePage) &&
      preserved.sourceRevision === (this.#pages?.revision?.(preservePage) ?? 0)
    ) {
      this.#clearBackingStore(preserved);
      preserved.state = "placeholder";
    }
  }

  #evictionCandidates(preservePage?: number): ThumbnailItem[] {
    const candidates = [...this.#items.values()].filter(
      item =>
        item.pageNo !== preservePage && this.#activeOperation?.item !== item && item.bytes > 0,
    );
    const items = new Map(candidates.map(item => [item.pageNo, item]));
    return orderThumbnailEvictions(
      candidates.map(item => ({ ...this.#itemGeometry(item), lastNeeded: item.lastNeeded })),
      this.#viewActive ? this.#panelGeometry() : null,
    ).map(pageNo => items.get(pageNo)!);
  }

  #panelDistance(item: ThumbnailItem): number {
    const viewport = this.#panelGeometry();
    return viewport
      ? thumbnailViewportDistance(this.#itemGeometry(item), viewport)
      : Number.POSITIVE_INFINITY;
  }

  #isBehindScroll(item: ThumbnailItem): boolean {
    const viewport = this.#panelGeometry();
    return viewport
      ? thumbnailIsBehind(this.#itemGeometry(item), viewport, this.#scrollDirection)
      : false;
  }

  #panelGeometry(): ThumbnailPanelGeometry | null {
    const scrollContainer = this.#options.scrollContainer;
    if (!scrollContainer) return null;
    const bounds = scrollContainer.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, height: scrollContainer.clientHeight };
  }

  #itemGeometry(item: ThumbnailItem): ThumbnailCandidateGeometry {
    const bounds = item.item.getBoundingClientRect();
    return { pageNo: item.pageNo, top: bounds.top, bottom: bounds.bottom };
  }

  #seedDemand(): void {
    if (!this.#nearIntersection) {
      this.#refreshDemandFromGeometry();
      return;
    }
    // Intersection callbacks populate viewport demand without synchronously measuring
    // every page. Seed only the active row so opening can reveal it immediately.
    for (const pageNo of this.#activePages) {
      const item = this.#items.get(pageNo);
      if (!item) continue;
      this.#nearVisiblePages.add(pageNo);
      item.lastNeeded = ++this.#neededClock;
      this.#observeSurface(item);
      this.#reconcileMeasurement(item);
    }
    this.#seedViewportDemand();
  }

  #revealActivePages(): void {
    const content = this.#options.scrollContainer;
    const active = [...this.#activePages]
      .map(pageNo => this.#items.get(pageNo)?.item)
      .filter((item): item is HTMLLIElement => !!item);
    if (!content || !active.length) return;
    const viewport = content.getBoundingClientRect();
    if (!(viewport.height > 0)) return;
    const first = active[0].getBoundingClientRect();
    const last = active[active.length - 1].getBoundingClientRect();
    if (last.bottom - first.top <= viewport.height) {
      if (first.top < viewport.top) this.#adjustScrollTop(first.top - viewport.top);
      else if (last.bottom > viewport.bottom) this.#adjustScrollTop(last.bottom - viewport.bottom);
      return;
    }
    if (first.top < viewport.top || first.bottom > viewport.bottom)
      this.#adjustScrollTop(first.top - viewport.top);
  }

  #scheduleRevealActivePages(reanchor: boolean, behavior?: ScrollBehavior): void {
    if (reanchor) {
      this.#automaticReveal = true;
      this.#automaticRevealBehavior = behavior ?? this.#options.scrollBehavior();
    }
    if (!this.#automaticReveal) return;
    if (this.#revealRaf != null) return;
    this.#revealRaf =
      this.#window?.requestAnimationFrame(() => {
        this.#revealRaf = null;
        if (this.#viewActive && this.#automaticReveal) this.#revealActivePages();
      }) ?? null;
  }

  #adjustScrollTop(delta: number): void {
    const content = this.#options.scrollContainer;
    if (!content || Math.abs(delta) < 0.5) return;
    // Some engines quantize scrollTop to whole CSS pixels. Round away from zero so
    // a fractional edge does not remain perpetually clipped by half a pixel.
    const adjustment = Math.sign(delta) * Math.ceil(Math.abs(delta));
    this.#programmaticScrollPending = true;
    if (this.#programmaticScrollResetRaf != null)
      this.#window?.cancelAnimationFrame(this.#programmaticScrollResetRaf);
    if (this.#programmaticScrollEndTimer != null)
      this.#window?.clearTimeout(this.#programmaticScrollEndTimer);
    const top = content.scrollTop + adjustment;
    this.#expectedScrollTop = top;
    const behavior = this.#automaticRevealBehavior;
    content.scrollTo({ top, behavior });
    if (behavior === "smooth") {
      this.#programmaticScrollEndTimer =
        this.#window?.setTimeout(() => this.#finishProgrammaticScroll(), 600) ?? null;
    } else {
      this.#programmaticScrollResetRaf =
        this.#window?.requestAnimationFrame(() => this.#finishProgrammaticScroll()) ?? null;
    }
  }

  #finishProgrammaticScroll(): void {
    if (this.#programmaticScrollResetRaf != null)
      this.#window?.cancelAnimationFrame(this.#programmaticScrollResetRaf);
    this.#programmaticScrollResetRaf = null;
    if (this.#programmaticScrollEndTimer != null)
      this.#window?.clearTimeout(this.#programmaticScrollEndTimer);
    this.#programmaticScrollEndTimer = null;
    this.#programmaticScrollPending = false;
    this.#expectedScrollTop = null;
  }

  /** Other demand callbacks cannot bypass a retired surface's deferred observation. */
  #observeSurface(item: ThumbnailItem): void {
    if (this.#items.get(item.pageNo) !== item) return;
    if (this.#retiredSurfaceResizes.has(item.pageNo)) {
      this.#retiredSurfaceResizes.set(item.pageNo, item.canvas);
      return;
    }
    this.#surfaceResize?.observe(item.canvas);
  }

  #clearBackingStore(item: ThumbnailItem): void {
    const canvas = item.canvas;
    const hadBacking = canvas.width > 0 || canvas.height > 0;
    item.item.removeAttribute("data-pdf-thumbnail-ready");
    canvas.style.visibility = "visible";
    canvas.width = 0;
    canvas.height = 0;
    item.bufferWidth = 0;
    item.bufferHeight = 0;
    item.bytes = 0;
    if (!hadBacking || this.#items.get(item.pageNo) !== item) return;
    // Resizing frees pixels, but the painted host can retain browser font/shaping caches.
    const placeholder = canvas.cloneNode(false) as HTMLCanvasElement;
    this.#surfaceResize?.unobserve(canvas);
    canvas.replaceWith(placeholder);
    item.canvas = placeholder;
    if (this.#surfaceResize && this.#viewActive && this.#nearVisiblePages.has(item.pageNo)) {
      // A new observation during resize delivery can produce a browser loop warning.
      this.#retiredSurfaceResizes.set(item.pageNo, placeholder);
      this.#scheduleViewportDemandRefresh();
    }
  }
}
