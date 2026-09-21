// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for selectable PDF text and exact text highlights.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * Package adapters wrap the runtime PDF.js `TextLayer` on each exact page surface,
 * map semantic text-item offsets to stable DOM spans, paint search and
 * selection ranges from browser `Range` geometry, and coordinates native range
 * suspension across zoom and topology replacement. It never estimates glyph
 * positions or creates package-owned selection handles.
 *
 * See the [architecture guide](../ARCHITECTURE.md) for lifecycle, presentation,
 * selection, and facade coordination guarantees.
 *
 * @packageDocumentation
 * @module document-text-presentation
 */

import type * as PDFJS from "pdfjs-dist";
import type { RenderPresentationContext, RenderSurfaceLease } from "./document-renderer.js";
import {
  changedSelectionPages,
  compareTextEndpoints,
  normalizeSelectionRects,
  partitionSelectionPages,
  type TextGeometryRect,
} from "./document-text-geometry.js";
import { PDFJS_TEXT_CONTENT_PARAMS } from "./text-content-policy.js";
import type { DocumentTextMatch } from "./document-search.js";

export interface DocumentTextPresentationDiagnostic {
  readonly event: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

interface DocumentTextPresentationOptions {
  readonly TextLayer: typeof PDFJS.TextLayer;
  readonly container: HTMLElement;
  readonly copied?: () => void;
  readonly demandChanged?: () => void;
  readonly diagnostic?: (entry: Readonly<DocumentTextPresentationDiagnostic>) => void;
  readonly createTextLayerBuilder?: (
    options: Readonly<{
      pdfPage: PDFJS.PDFPageProxy;
      highlighter: {
        setTextMapping(textDivs: HTMLSpanElement[], textContentItemsStr: string[]): void;
        enable(): void;
        disable(): void;
      };
      enablePermissions: boolean;
      onAppend(layer: HTMLDivElement): void;
    }>,
  ) => DocumentTextLayerBuilder;
}

interface DocumentTextLayerBuilder {
  readonly div: HTMLDivElement;
  render: TextLayerBuilderRender;
  cancel(): void;
}

interface TextEndpoint {
  readonly page: number;
  readonly textItemIndex: number;
  readonly utf16Offset: number;
  readonly affinity: "forward" | "backward";
}

interface LogicalSelection {
  readonly anchor: TextEndpoint;
  readonly focus: TextEndpoint;
}

interface PageTextPresentation {
  readonly pageNo: number;
  lease: Readonly<RenderSurfaceLease>;
  viewport: PDFJS.PageViewport;
  readonly builder: DocumentTextLayerBuilder;
  readonly layer: HTMLDivElement;
  readonly highlights: HTMLDivElement;
  readonly searchHighlights: HTMLDivElement;
  readonly selectionHighlights: HTMLDivElement;
  spans: readonly HTMLSpanElement[];
  strings: readonly string[];
  generation: number;
  builderRendered: boolean;
  presentationScale: number | null;
  layoutRotation: number;
  geometryScale: number;
  copyListenerInstalled: boolean;
  searchHighlightNodes: Map<string, readonly HTMLElement[]>;
  searchMaterializedRevision: number;
  searchGeometryRaf: number | null;
}

interface MappedNode {
  readonly record: PageTextPresentation;
  readonly textItemIndex: number;
  readonly span: HTMLSpanElement;
}

type TextLayerBuilderRender = (options: {
  viewport: PDFJS.PageViewport;
  images?: ConstructorParameters<typeof PDFJS.TextLayer>[0]["images"];
  textContentParams?: object;
}) => Promise<void>;

const EDGE_SCROLL_BAND = 48;
const EDGE_SCROLL_MAX = 24;
const RECT_TOLERANCE = 1;
const PRESENTATION_SCALE_EPSILON = 1e-6;
const nativeSelectionOwners = new WeakMap<Document, DocumentTextPresentation>();

function safely(action: (() => void) | null | undefined): void {
  try {
    action?.();
  } catch {
    /* Presentation cleanup is best effort. */
  }
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

/** Owns PDF.js text builders, mappings, exact highlights, and native selection state. */
export class DocumentTextPresentation {
  #document: Document;
  #window: Window & typeof globalThis;
  #container: HTMLElement;
  #copied: (() => void) | undefined;
  #demandChanged: (() => void) | undefined;
  #diagnosticCallback: DocumentTextPresentationOptions["diagnostic"];
  #createTextLayerBuilder: NonNullable<DocumentTextPresentationOptions["createTextLayerBuilder"]>;
  #records = new Map<number, PageTextPresentation>();
  #viewportPages = new Set<number>();
  #nodeMappings = new WeakMap<Node, MappedNode>();
  #matchesByPage = new Map<number, readonly DocumentTextMatch[]>();
  #searchRevision = 0;
  #activeMatchKey: string | null = null;
  #activeMatchPage: number | null = null;
  #mode = false;
  #selection: LogicalSelection | null = null;
  #lastAnchor: TextEndpoint | null = null;
  #lastFocus: TextEndpoint | null = null;
  #selectionChangeGeneration = 0;
  #selectionRaf: number | null = null;
  #demandRaf: number | null = null;
  #restoring = false;
  #zoomSuspended = false;
  #nativeState: "dormant" | "owned" | "retained" = "dormant";
  #restoreScale: number | null = null;
  #destroyed = false;
  #toolbarToken = 0;
  #toolbarTransaction: Readonly<{ token: number; scopes: readonly HTMLElement[] }> | null = null;
  #toolbarRestoreRaf: number | null = null;
  #copyPreCancelled = new WeakMap<ClipboardEvent, boolean>();
  #completedCopies = new WeakSet<ClipboardEvent>();
  #zoomGeneration = 0;
  #zoomFailures = new Map<string, number>();
  #zoomFallbackPages = new Set<number>();
  #zoomFallbackGeometry = new Map<
    number,
    Readonly<
      { available: true; scale: number; rects: readonly TextGeometryRect[] } | { available: false }
    >
  >();
  #mouseSelecting = false;
  #mousePoint = { x: 0, y: 0 };
  #mouseSelectionStart = { x: 0, y: 0 };
  #mouseSelectionMoved = false;
  #mouseGapRestoreRaf: number | null = null;
  #autoscrollRaf: number | null = null;
  #touchPointers = new Set<number>();
  #suppressTapClearUntil = 0;
  #hadSelectionOnPointerDown = false;
  #lastPointerWasTouch = false;
  readonly #onSelectionChangeBound = () => this.#onSelectionChange();
  readonly #onPointerDownBound = (event: Event) => this.#onPointerDown(event as PointerEvent);
  readonly #onPointerEndBound = (event: Event) => this.#onPointerEnd(event as PointerEvent);
  readonly #onMouseDownBound = (event: Event) => this.#onMouseDown(event as MouseEvent);
  readonly #onMouseMoveBound = (event: Event) => this.#onMouseMove(event as MouseEvent);
  readonly #onMouseUpBound = () => this.#stopMouseSelection();
  readonly #onClickBound = (event: Event) => this.#onClick(event as MouseEvent);

  constructor(options: Readonly<DocumentTextPresentationOptions>) {
    this.#container = options.container;
    this.#document = options.container.ownerDocument;
    const ownerWindow = this.#document.defaultView as (Window & typeof globalThis) | null;
    if (!ownerWindow)
      throw new Error("DocumentTextPresentation requires an owner document with a window");
    this.#window = ownerWindow;
    this.#copied = options.copied;
    this.#demandChanged = options.demandChanged;
    this.#diagnosticCallback = options.diagnostic;
    this.#createTextLayerBuilder =
      options.createTextLayerBuilder ??
      (builderOptions => {
        // Avoid PDF.js's web TextLayerBuilder: it reads globalThis.pdfjsLib at
        // module evaluation and cannot follow the runtime's standard/legacy API.
        const ownerDocument = this.#document;
        const div = ownerDocument.createElement("div");
        let task: InstanceType<typeof options.TextLayer> | null = null;
        return {
          div,
          async render({ viewport, images, textContentParams }) {
            const textContentSource = builderOptions.pdfPage.streamTextContent(textContentParams);
            task = new options.TextLayer({ textContentSource, images, container: div, viewport });
            builderOptions.highlighter.setTextMapping(task.textDivs, task.textContentItemsStr);
            await task.render();
            const endOfContent = ownerDocument.createElement("div");
            endOfContent.className = "endOfContent";
            div.append(endOfContent);
            div.addEventListener("copy", event => {
              if (builderOptions.enablePermissions) return;
              event.clipboardData?.setData(
                "text/plain",
                ownerDocument.getSelection()?.toString() ?? "",
              );
              event.preventDefault();
              event.stopPropagation();
            });
            builderOptions.onAppend(div);
            builderOptions.highlighter.enable();
          },
          cancel() {
            task?.cancel();
          },
        };
      });
    this.#document.addEventListener("selectionchange", this.#onSelectionChangeBound);
    this.#container.addEventListener("pointerdown", this.#onPointerDownBound, true);
    this.#container.addEventListener("pointerup", this.#onPointerEndBound, true);
    this.#container.addEventListener("pointercancel", this.#onPointerEndBound, true);
    this.#container.addEventListener("mousedown", this.#onMouseDownBound);
    this.#container.addEventListener("click", this.#onClickBound, true);
    this.#window.addEventListener("mousemove", this.#onMouseMoveBound, true);
    this.#window.addEventListener("mouseup", this.#onMouseUpBound, true);
  }

  public selectionIncludesPage(pageNo: number): boolean {
    return this.#selectionTouchesPage(pageNo);
  }

  /** Whether an event target belongs to currently selectable mapped PDF text. */
  public isTextSelectionTarget(target: EventTarget | null): boolean {
    return this.#mode && this.#mappingForTarget(target) != null;
  }

  public setMode(active: boolean): void {
    if (this.#mode === active) return;
    this.#mode = active;
    for (const record of this.#records.values()) this.#syncInteractiveState(record);
    if (!active) this.clearSelection();
  }

  /** Reconciles independent visible-plus-adjacent viewport candidates. */
  public setViewportPages(pageNos: readonly number[]): void {
    this.#viewportPages = new Set(pageNos.filter(pageNo => Number.isInteger(pageNo) && pageNo > 0));
    this.#releaseUnownedRecords();
  }

  /** Exact pages currently required by viewport policy or semantic selection pins. */
  public presentationPageNos(): readonly number[] {
    const pages = new Set(this.selectionPageNos());
    if (this.#activeMatchPage != null) pages.add(this.#activeMatchPage);
    for (const pageNo of this.#viewportPages) {
      if (this.#mode || this.#matchesByPage.has(pageNo)) pages.add(pageNo);
    }
    return [...pages];
  }

  /** Pages retained by the current semantic selection, including intermediates. */
  public selectionPageNos(): readonly number[] {
    if (!this.#selection) return [];
    const first = Math.min(this.#selection.anchor.page, this.#selection.focus.page);
    const last = Math.max(this.#selection.anchor.page, this.#selection.focus.page);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }

  /** Whether one retained page needs a page-backed presentation callback. */
  public needsPresentation(pageNo: number, scale: number): boolean {
    if (!this.#pageIsDemanded(pageNo)) return false;
    const record = this.#records.get(pageNo);
    return (
      !record ||
      record.presentationScale == null ||
      Math.abs(record.presentationScale - scale) > PRESENTATION_SCALE_EPSILON
    );
  }

  public async present(context: Readonly<RenderPresentationContext>): Promise<void> {
    if (this.#destroyed || !context.isCurrent("text") || !this.#pageIsDemanded(context.pageNo))
      return;
    const existing = this.#records.get(context.pageNo);
    let record = existing;
    if (record && record.lease.wrapper !== context.lease.wrapper) {
      this.#releaseRecord(record);
      record = undefined;
    }
    if (!record) {
      let mappingRecord: PageTextPresentation | null = null;
      const mappingSink = {
        setTextMapping: (textDivs: HTMLSpanElement[], textContentItemsStr: string[]) => {
          // PDF.js supplies these arrays before render and fills them in place.
          if (mappingRecord) {
            mappingRecord.spans = textDivs;
            mappingRecord.strings = textContentItemsStr;
          }
        },
        enable: () => {},
        disable: () => {},
      };
      const builder = this.#createTextLayerBuilder({
        pdfPage: context.page,
        highlighter: mappingSink,
        enablePermissions: false,
        onAppend: (layer: HTMLDivElement) => {
          const current = this.#records.get(context.pageNo);
          if (
            current?.builder === builder &&
            current.generation === context.generation &&
            !layer.isConnected
          ) {
            context.lease.wrapper.append(layer);
          }
        },
      });
      builder.div.classList.add("pdf-text-layer", "selectionRendering");
      const highlights = this.#document.createElement("div");
      highlights.className = "pdf-highlight-layer";
      const searchHighlights = this.#document.createElement("div");
      searchHighlights.className = "pdf-search-highlight-channel";
      const selectionHighlights = this.#document.createElement("div");
      selectionHighlights.className = "pdf-selection-highlight-channel";
      highlights.append(searchHighlights, selectionHighlights);
      record = {
        pageNo: context.pageNo,
        lease: context.lease,
        viewport: context.viewport,
        builder,
        layer: builder.div,
        highlights,
        searchHighlights,
        selectionHighlights,
        spans: [],
        strings: [],
        generation: context.generation,
        builderRendered: false,
        presentationScale: null,
        layoutRotation: context.viewport.rotation,
        geometryScale: context.viewport.scale,
        copyListenerInstalled: false,
        searchHighlightNodes: new Map(),
        searchMaterializedRevision: -1,
        searchGeometryRaf: null,
      };
      mappingRecord = record;
      this.#records.set(context.pageNo, record);
    } else {
      const rotationChanged = record.layoutRotation !== context.viewport.rotation;
      record.lease = context.lease;
      record.viewport = context.viewport;
      record.generation = context.generation;
      if (!record.layer.isConnected) context.lease.wrapper.append(record.layer);
      if (rotationChanged) {
        record.builder.cancel();
        record.spans = [];
        record.strings = [];
        record.builderRendered = false;
        record.presentationScale = null;
        record.searchMaterializedRevision = -1;
        record.layoutRotation = context.viewport.rotation;
      }
    }
    this.#syncInteractiveState(record);

    try {
      if (!record.builderRendered) {
        await record.builder.render({
          viewport: context.viewport,
          textContentParams: PDFJS_TEXT_CONTENT_PARAMS,
        });
        record.builderRendered = true;
      }
      if (
        this.#records.get(context.pageNo) !== record ||
        record.generation !== context.generation ||
        !context.isCurrent("text") ||
        !this.#pageIsDemanded(context.pageNo)
      )
        return;
      record.viewport = context.viewport;
      if (record.spans.length) {
        record.spans = Object.freeze([...record.spans]);
        record.strings = Object.freeze([...record.strings]);
      }
      this.#indexRecord(record);
      if (!record.copyListenerInstalled) {
        record.layer.addEventListener(
          "copy",
          event => this.#onLayerCopyCapture(event, record!),
          true,
        );
        record.layer.addEventListener("copy", event => this.#onLayerCopy(event, record!));
        record.copyListenerInstalled = true;
      }
      if (
        this.#restoreScale != null &&
        Math.abs(record.viewport.scale - this.#restoreScale) <= PRESENTATION_SCALE_EPSILON
      ) {
        this.#materializeHighlightScale(record, this.#restoreScale);
        if (record.searchMaterializedRevision !== this.#searchRevision)
          this.#renderSearch(record, true);
      } else {
        this.#renderSearch(record);
      }
      this.#zoomFailures.delete(this.#zoomFailureKey(context.pageNo));
      const recoveredFallback = this.#zoomFallbackPages.delete(context.pageNo);
      this.#zoomFallbackGeometry.delete(context.pageNo);
      if (
        !this.#zoomSuspended &&
        !this.#zoomFallbackPages.size &&
        (recoveredFallback || !this.#selectionMirrorIsCurrent())
      ) {
        this.#renderSelectionFromBookmarks();
      }
      record.presentationScale = context.viewport.scale;
      this.#finishPendingZoomIfReady();
      this.#tryRestoreSelection();
    } catch (error) {
      const failureIsCurrent =
        this.#records.get(context.pageNo) === record &&
        record.generation === context.generation &&
        context.isCurrent("text") &&
        this.#pageIsDemanded(context.pageNo);
      const usedFallback =
        failureIsCurrent &&
        this.#handleZoomPresentationFailure(record, context.viewport.scale, error);
      if (failureIsCurrent && !usedFallback) {
        this.#releaseRecord(record);
      }
      if (failureIsCurrent) {
        this.#diagnostic("text-layer-presentation-failed", "PDF text layer presentation failed", {
          documentId: context.documentId,
          pageNo: context.pageNo,
          generation: context.generation,
          error,
        });
      }
    }
  }

  public evict(pageNo: number, lease: Readonly<RenderSurfaceLease>): void {
    const record = this.#records.get(pageNo);
    if (!record || record.lease.wrapper !== lease.wrapper || this.#pageIsDemanded(pageNo)) return;
    if (this.#selectionTouchesPage(pageNo)) return;
    this.#releaseRecord(record);
  }

  public setSearchMatches(matches: readonly DocumentTextMatch[]): void {
    this.#searchRevision++;
    const previousPages = new Set(this.#matchesByPage.keys());
    const previousActivePage = this.#activeMatchPage;
    const frozenMatches = Object.freeze(
      matches.map(match =>
        Object.freeze({
          page: match.page,
          segments: Object.freeze(match.segments.map(segment => Object.freeze({ ...segment }))),
        }),
      ),
    );
    const indexed = new Map<number, DocumentTextMatch[]>();
    for (const match of frozenMatches) {
      const pageMatches = indexed.get(match.page) ?? [];
      pageMatches.push(match);
      indexed.set(match.page, pageMatches);
    }
    this.#matchesByPage = new Map(
      [...indexed].map(([page, pageMatches]) => [page, Object.freeze(pageMatches)]),
    );
    this.#activeMatchKey = null;
    this.#activeMatchPage = null;
    const changedPages = new Set([...previousPages, ...this.#matchesByPage.keys()]);
    for (const pageNo of changedPages) {
      const record = this.#records.get(pageNo);
      if (record) this.#renderSearch(record);
    }
    this.#releaseUnownedRecords();
    if (previousActivePage != null) this.#notifyDemandChanged();
  }

  public setActiveSearchMatch(match: Readonly<DocumentTextMatch> | null): void {
    const next = match ? this.#matchKey(match) : null;
    const nextPage = match?.page ?? null;
    if (next === this.#activeMatchKey && nextPage === this.#activeMatchPage) return;
    const previous = this.#activeMatchKey;
    const previousPage = this.#activeMatchPage;
    this.#activeMatchKey = next;
    this.#activeMatchPage = nextPage;
    for (const record of this.#records.values()) {
      for (const node of previous ? (record.searchHighlightNodes.get(previous) ?? []) : []) {
        node.classList.remove("pdf-search-highlight-current");
      }
      for (const node of next ? (record.searchHighlightNodes.get(next) ?? []) : []) {
        node.classList.add("pdf-search-highlight-current");
      }
    }
    this.#releaseUnownedRecords();
    if (previousPage !== nextPage) this.#notifyDemandChanged();
  }

  public beginSurfaceReflow(preserveSurfaces: boolean): void {
    this.#captureSelection();
    if (preserveSurfaces) return;
    this.#clearNativeSelection(false);
    this.#restoreScale = null;
    for (const record of [...this.#records.values()]) this.#releaseRecord(record);
  }

  public suspendForZoom(): void {
    if (this.#zoomSuspended) return;
    this.#captureSelection();
    this.#zoomSuspended = true;
    if (this.#nativeState === "owned") this.#nativeState = "retained";
    this.#restoreScale = null;
    this.#stopMouseSelection();
    this.#renderSelectionFromBookmarks();
    this.#captureZoomFallbackGeometry();
    this.#clearNativeSelection(false);
  }

  public resumeAfterZoom(scale: number): void {
    this.#zoomGeneration++;
    this.#zoomFailures.clear();
    this.#zoomFallbackPages.clear();
    this.#restoreScale = scale;
    for (const record of this.#records.values()) {
      const ratio = scale / record.geometryScale;
      record.highlights.style.transformOrigin = "0 0";
      record.highlights.style.transform =
        Math.abs(ratio - 1) <= PRESENTATION_SCALE_EPSILON ? "" : `scale(${ratio})`;
      const matches = this.#matchesByPage.get(record.pageNo);
      if (
        record.builderRendered &&
        record.searchMaterializedRevision !== this.#searchRevision &&
        matches &&
        this.#pageIsDemanded(record.pageNo)
      ) {
        this.#scheduleSearchGeometryRetry(record, matches, true);
      }
    }
    if (!this.#selection) {
      this.#zoomSuspended = false;
      this.#nativeState = "dormant";
      return;
    }
    this.#finishPendingZoomIfReady();
    this.#tryRestoreSelection();
  }

  public clearSelection(): void {
    const previousPages = this.#selectionPages(this.#selection);
    this.#selection = null;
    this.#lastAnchor = null;
    this.#lastFocus = null;
    this.#restoreScale = null;
    this.#zoomFailures.clear();
    this.#zoomFallbackPages.clear();
    this.#zoomFallbackGeometry.clear();
    if (nativeSelectionOwners.get(this.#document) === this)
      nativeSelectionOwners.delete(this.#document);
    this.#nativeState = "dormant";
    this.#stopMouseSelection();
    this.#clearNativeSelection(false);
    this.#syncNativeSelectionPaint();
    for (const page of previousPages)
      this.#records.get(page)?.selectionHighlights.replaceChildren();
    this.#releaseUnownedRecords();
    if (previousPages.length) this.#scheduleDemandChanged();
  }

  /** Begins or transfers an exact toolbar selection-retention transaction. */
  public beginToolbarInteraction(scopes: readonly HTMLElement[]): number {
    this.#captureSelection();
    if (this.#nativeState === "owned") this.#nativeState = "retained";
    const token = ++this.#toolbarToken;
    this.#toolbarTransaction = Object.freeze({ token, scopes: Object.freeze([...scopes]) });
    return token;
  }

  /** Completes only the current toolbar transaction after focus settles. */
  public completeToolbarInteraction(token: number): boolean {
    const transaction = this.#toolbarTransaction;
    if (transaction?.token !== token) return true;
    if (!this.#focusBelongsToToolbarTransaction(transaction)) {
      this.#toolbarTransaction = null;
      this.#yieldNativeOwnership();
      return false;
    }
    const nativeSelection = this.#document.getSelection();
    if (
      nativeSelection &&
      !nativeSelection.isCollapsed &&
      !this.#selectionBelongsToViewer(nativeSelection)
    ) {
      this.#toolbarTransaction = null;
      this.#yieldNativeOwnership();
      return false;
    }
    if (this.#toolbarRestoreRaf != null) this.#window.cancelAnimationFrame(this.#toolbarRestoreRaf);
    this.#toolbarRestoreRaf = this.#window.requestAnimationFrame(() => {
      this.#toolbarRestoreRaf = null;
      const transaction = this.#toolbarTransaction;
      if (!transaction || transaction.token !== token) return;
      if (!this.#focusBelongsToToolbarTransaction(transaction)) {
        this.#toolbarTransaction = null;
        this.#yieldNativeOwnership();
        return;
      }
      this.#toolbarTransaction = null;
      const currentSelection = this.#document.getSelection();
      if (
        currentSelection &&
        !currentSelection.isCollapsed &&
        !this.#selectionBelongsToViewer(currentSelection)
      ) {
        this.#yieldNativeOwnership();
        return;
      }
      if (
        !this.#mode ||
        this.#zoomSuspended ||
        !this.#selection ||
        this.#nativeState !== "retained"
      )
        return;
      this.#restoreNativeSelection(this.#selection, true);
    });
    return true;
  }

  public reset(): void {
    this.clearSelection();
    this.#matchesByPage.clear();
    this.#activeMatchKey = null;
    this.#activeMatchPage = null;
    this.#viewportPages.clear();
    this.#cancelScheduledOwnerWork();
    this.#toolbarTransaction = null;
    this.#toolbarToken++;
    this.#zoomSuspended = false;
    this.#zoomFailures.clear();
    this.#zoomFallbackPages.clear();
    this.#zoomFallbackGeometry.clear();
    this.#touchPointers.clear();
    this.#suppressTapClearUntil = 0;
    for (const record of [...this.#records.values()]) this.#releaseRecord(record);
    this.#records.clear();
    this.#nodeMappings = new WeakMap();
  }

  public destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.reset();
    this.#document.removeEventListener("selectionchange", this.#onSelectionChangeBound);
    this.#container.removeEventListener("pointerdown", this.#onPointerDownBound, true);
    this.#container.removeEventListener("pointerup", this.#onPointerEndBound, true);
    this.#container.removeEventListener("pointercancel", this.#onPointerEndBound, true);
    this.#container.removeEventListener("mousedown", this.#onMouseDownBound);
    this.#container.removeEventListener("click", this.#onClickBound, true);
    this.#window.removeEventListener("mousemove", this.#onMouseMoveBound, true);
    this.#window.removeEventListener("mouseup", this.#onMouseUpBound, true);
  }

  #indexRecord(record: PageTextPresentation): void {
    record.spans.forEach((span, textItemIndex) => {
      const mapping = { record, textItemIndex, span };
      this.#nodeMappings.set(span, mapping);
      for (const child of span.childNodes) this.#nodeMappings.set(child, mapping);
    });
  }

  #syncInteractiveState(record: PageTextPresentation): void {
    record.layer.classList.toggle("pdf-text-layer--interactive", this.#mode);
    record.layer.classList.toggle(
      "pdf-text-layer--native-selection-hidden",
      this.#nativeState !== "dormant" && this.#selection != null,
    );
    record.lease.wrapper.classList.toggle("pdf-text-selection-mode", this.#mode);
  }

  #syncNativeSelectionPaint(): void {
    for (const record of this.#records.values()) this.#syncInteractiveState(record);
  }

  #releaseRecord(record: PageTextPresentation): void {
    if (this.#records.get(record.pageNo) === record) this.#records.delete(record.pageNo);
    if (record.searchGeometryRaf != null)
      this.#window.cancelAnimationFrame(record.searchGeometryRaf);
    record.searchGeometryRaf = null;
    safely(() => record.builder.cancel());
    record.layer.remove();
    record.highlights.remove();
  }

  #renderSearch(record: PageTextPresentation, duringZoomCommit = false): void {
    if (this.#zoomSuspended && !duringZoomCommit) return;
    if (record.searchGeometryRaf != null)
      this.#window.cancelAnimationFrame(record.searchGeometryRaf);
    record.searchGeometryRaf = null;
    record.searchHighlights.replaceChildren();
    record.searchHighlightNodes.clear();
    const matches = this.#matchesByPage.get(record.pageNo);
    if (!matches?.length) {
      record.searchMaterializedRevision = this.#searchRevision;
      return;
    }
    // A published query may race the first text presentation. Completion owns
    // the first geometry pass once PDF.js has finalized the item mapping.
    if (!record.builderRendered) return;
    const fragment = this.#document.createDocumentFragment();
    const pageRect = record.lease.wrapper.getBoundingClientRect();
    const layerRect = record.layer.getBoundingClientRect();
    let geometryIncomplete = false;
    for (const match of matches) {
      this.#ensureHighlights(record);
      const key = this.#matchKey(match);
      const nodes: HTMLElement[] = [];
      for (const segment of match.segments) {
        const span = record.spans[segment.textItemIndex];
        const textNode = span?.firstChild;
        if (
          !span ||
          !textNode ||
          textNode.nodeType !== Node.TEXT_NODE ||
          record.strings[segment.textItemIndex] !== segment.text
        ) {
          this.#diagnostic(
            "text-highlight-mapping-mismatch",
            "Search text does not match its PDF text span",
            {
              pageNo: record.pageNo,
              textItemIndex: segment.textItemIndex,
            },
          );
          continue;
        }
        const start = Math.max(
          0,
          Math.min(segment.characterIndex, textNode.textContent?.length ?? 0),
        );
        const end = Math.max(
          start,
          Math.min(start + segment.length, textNode.textContent?.length ?? 0),
        );
        const range = this.#document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const segmentNodes = this.#rangeHighlightNodes(
          range,
          pageRect,
          layerRect,
          key === this.#activeMatchKey
            ? "pdf-search-highlight pdf-search-highlight-current"
            : "pdf-search-highlight",
        );
        nodes.push(...segmentNodes);
        if (!segmentNodes.length) geometryIncomplete = true;
        range.detach();
      }
      record.searchHighlightNodes.set(key, nodes);
      fragment.append(...nodes);
    }
    record.searchHighlights.replaceChildren(fragment);
    record.geometryScale = record.viewport.scale;
    if (geometryIncomplete) {
      this.#scheduleSearchGeometryRetry(record, matches);
    } else {
      record.searchMaterializedRevision = this.#searchRevision;
    }
  }

  #scheduleSearchGeometryRetry(
    record: PageTextPresentation,
    matches: readonly DocumentTextMatch[],
    duringZoomCommit = false,
  ): void {
    if (record.searchGeometryRaf != null)
      this.#window.cancelAnimationFrame(record.searchGeometryRaf);
    const revision = this.#searchRevision;
    record.searchGeometryRaf = this.#window.requestAnimationFrame(() => {
      record.searchGeometryRaf = null;
      if (
        this.#destroyed ||
        this.#records.get(record.pageNo) !== record ||
        this.#searchRevision !== revision ||
        this.#matchesByPage.get(record.pageNo) !== matches ||
        !this.#pageIsDemanded(record.pageNo)
      )
        return;
      this.#renderSearch(record, duringZoomCommit);
    });
  }

  #rangeHighlightNodes(
    range: Range,
    pageRect: DOMRect,
    layerRect: DOMRect,
    className: string,
  ): readonly HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const rect of range.getClientRects()) {
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        !intersects(rect, pageRect) ||
        !this.#rectContainedByLayer(rect, layerRect)
      )
        continue;
      const highlight = this.#document.createElement("div");
      highlight.className = className;
      Object.assign(highlight.style, {
        left: `${rect.left - pageRect.left}px`,
        top: `${rect.top - pageRect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      nodes.push(highlight);
    }
    return nodes;
  }

  #scheduleSelectionChange(): void {
    if (!this.#mode || this.#zoomSuspended || this.#restoring) return;
    if (this.#nativeSelectionMatchesBookmarks()) return;
    const generation = ++this.#selectionChangeGeneration;
    if (this.#selectionRaf != null) return;
    this.#selectionRaf = this.#window.requestAnimationFrame(() => {
      this.#selectionRaf = null;
      if (generation <= this.#selectionChangeGeneration) this.#captureSelection();
    });
  }

  #onSelectionChange(): void {
    if (!this.#restoring && this.#shouldRetainMouseGap()) {
      this.#restoreNativeSelection(this.#selection!, true, "microtask");
      return;
    }
    this.#scheduleSelectionChange();
  }

  #nativeSelectionMatchesBookmarks(): boolean {
    if (this.#nativeState !== "owned" || !this.#selection) return false;
    const nativeSelection = this.#document.getSelection();
    if (!nativeSelection || nativeSelection.isCollapsed) return false;
    const anchor = this.#endpointFor(
      nativeSelection.anchorNode,
      nativeSelection.anchorOffset,
      "backward",
    );
    const focus = this.#endpointFor(
      nativeSelection.focusNode,
      nativeSelection.focusOffset,
      "forward",
    );
    return (
      !!anchor &&
      !!focus &&
      this.#compareEndpoints(anchor, this.#selection.anchor) === 0 &&
      this.#compareEndpoints(focus, this.#selection.focus) === 0
    );
  }

  #captureSelection(): void {
    if (!this.#mode || this.#restoring) return;
    if (this.#shouldRetainMouseGap()) {
      this.#restoreNativeSelection(this.#selection!, true, "microtask");
      return;
    }
    const nativeSelection = this.#document.getSelection();
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) {
      const transaction = this.#toolbarTransaction;
      const focus = this.#document.activeElement;
      if (
        this.#nativeState === "retained" &&
        transaction &&
        focus instanceof this.#window.HTMLElement &&
        !transaction.scopes.some(scope => scope === focus || scope.contains(focus))
      ) {
        this.#yieldNativeOwnership();
      }
      return;
    }
    const anchor = this.#endpointFor(
      nativeSelection.anchorNode,
      nativeSelection.anchorOffset,
      "backward",
    );
    const focus = this.#endpointFor(
      nativeSelection.focusNode,
      nativeSelection.focusOffset,
      "forward",
    );
    if (!anchor || !focus) {
      const ownInvalid =
        this.#nodeInsideViewer(nativeSelection.anchorNode) ||
        this.#nodeInsideViewer(nativeSelection.focusNode);
      if (!ownInvalid) {
        this.#yieldNativeOwnership();
        return;
      }
      this.#restoreInvalidEndpoint(anchor, focus);
      return;
    }
    this.#lastAnchor = anchor;
    this.#lastFocus = focus;
    const previous = this.#selection;
    this.#selection = Object.freeze({ anchor, focus });
    this.#nativeState = "owned";
    nativeSelectionOwners.set(this.#document, this);
    this.#syncNativeSelectionPaint();
    const affected = new Set(changedSelectionPages(previous, this.#selection));
    this.#renderSelectionFromBookmarks(affected);
    this.#releaseUnownedRecords();
    if (!previous || previous.anchor.page !== anchor.page || previous.focus.page !== focus.page) {
      this.#scheduleDemandChanged();
    }
  }

  #endpointFor(
    node: Node | null,
    offset: number,
    affinity: TextEndpoint["affinity"],
  ): TextEndpoint | null {
    if (!node) return null;
    const mapping = this.#mappingForNode(node);
    if (!mapping) return null;
    const length = mapping.span.textContent?.length ?? 0;
    const utf16Offset =
      node.nodeType === Node.TEXT_NODE
        ? Math.max(0, Math.min(offset, length))
        : offset <= 0
          ? 0
          : length;
    return Object.freeze({
      page: mapping.record.pageNo,
      textItemIndex: mapping.textItemIndex,
      utf16Offset,
      affinity,
    });
  }

  #restoreInvalidEndpoint(anchor: TextEndpoint | null, focus: TextEndpoint | null): void {
    const restoredAnchor = anchor ?? this.#lastAnchor;
    const restoredFocus = focus ?? this.#lastFocus;
    if (!restoredAnchor || !restoredFocus || this.#nativeState === "dormant") return;
    this.#selection = Object.freeze({ anchor: restoredAnchor, focus: restoredFocus });
    this.#restoreNativeSelection(this.#selection, true);
  }

  #renderSelectionFromBookmarks(affectedPages?: ReadonlySet<number>): void {
    const affected =
      affectedPages ?? new Set([...this.#records.keys(), ...this.#selectionPages(this.#selection)]);
    if (!this.#selection) {
      for (const page of affected) this.#records.get(page)?.selectionHighlights.replaceChildren();
      return;
    }
    const selectedPages = new Set(this.#selectionPages(this.#selection));
    for (const page of affected) {
      if (!selectedPages.has(page)) this.#records.get(page)?.selectionHighlights.replaceChildren();
    }
    for (const partition of partitionSelectionPages(
      this.#selection.anchor,
      this.#selection.focus,
    )) {
      const pageNo = partition.page;
      if (!affected.has(pageNo)) continue;
      const record = this.#records.get(pageNo);
      if (!record) continue;
      const first = partition.start
        ? this.#domEndpoint(partition.start)
        : this.#edgeDomEndpoint(record, false);
      const last = partition.end
        ? this.#domEndpoint(partition.end)
        : this.#edgeDomEndpoint(record, true);
      if (!first || !last) continue;
      const range = this.#document.createRange();
      try {
        range.setStart(first.node, first.offset);
        range.setEnd(last.node, last.offset);
        const pageRect = record.lease.wrapper.getBoundingClientRect();
        const layerRect = record.layer.getBoundingClientRect();
        const rects: TextGeometryRect[] = [];
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0 || !this.#rectContainedByLayer(rect, layerRect))
            continue;
          rects.push({
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top,
            right: rect.right - pageRect.left,
            bottom: rect.bottom - pageRect.top,
          });
        }
        const fragment = this.#document.createDocumentFragment();
        for (const rect of normalizeSelectionRects(rects)) {
          this.#ensureHighlights(record);
          const highlight = this.#document.createElement("div");
          highlight.className = "pdf-text-selection-highlight";
          Object.assign(highlight.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.right - rect.left}px`,
            height: `${rect.bottom - rect.top}px`,
          });
          fragment.append(highlight);
        }
        record.selectionHighlights.replaceChildren(fragment);
      } finally {
        range.detach();
      }
      record.geometryScale = record.viewport.scale;
    }
  }

  #domEndpoint(endpoint: TextEndpoint): { node: Node; offset: number } | null {
    const span = this.#records.get(endpoint.page)?.spans[endpoint.textItemIndex];
    const node = span?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    return {
      node,
      offset: Math.max(0, Math.min(endpoint.utf16Offset, node.textContent?.length ?? 0)),
    };
  }

  #restoreNativeSelection(
    selection: LogicalSelection,
    explicit = false,
    release: "frame" | "microtask" = "frame",
  ): boolean {
    const anchor = this.#domEndpoint(selection.anchor);
    const focus = this.#domEndpoint(selection.focus);
    const nativeSelection = this.#document.getSelection();
    if (!anchor || !focus || !nativeSelection) return false;
    const owner = nativeSelectionOwners.get(this.#document);
    if (!explicit || (owner && owner !== this)) return false;
    if (
      !nativeSelection.isCollapsed &&
      !this.#selectionBelongsToViewer(nativeSelection) &&
      owner !== this
    )
      return false;
    this.#restoring = true;
    try {
      nativeSelection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      this.#nativeState = "owned";
      nativeSelectionOwners.set(this.#document, this);
      this.#syncNativeSelectionPaint();
      return true;
    } finally {
      if (release === "microtask")
        this.#window.queueMicrotask(() => {
          this.#restoring = false;
        });
      else
        this.#window.requestAnimationFrame(() => {
          this.#restoring = false;
        });
    }
  }

  #tryRestoreSelection(): void {
    if (!this.#mode || this.#zoomSuspended || !this.#selection) return;
    if (this.selectionPageNos().some(page => this.#zoomFallbackPages.has(page))) return;
    if (this.#restoreScale != null) {
      for (const page of this.selectionPageNos()) {
        const record = this.#records.get(page);
        if (
          record?.presentationScale == null ||
          Math.abs(record.presentationScale - this.#restoreScale) > PRESENTATION_SCALE_EPSILON
        )
          return;
      }
    }
    if (this.#nativeState === "retained" && this.#restoreNativeSelection(this.#selection, true)) {
      this.#restoreScale = null;
    }
  }

  #finishPendingZoomIfReady(): void {
    if (!this.#zoomSuspended || this.#restoreScale == null || !this.#selection) return;
    for (const page of this.selectionPageNos()) {
      const record = this.#records.get(page);
      if (
        (record?.presentationScale == null ||
          Math.abs(record.presentationScale - this.#restoreScale) > PRESENTATION_SCALE_EPSILON) &&
        !this.#zoomFallbackPages.has(page)
      )
        return;
    }
    this.#zoomSuspended = false;
    if (
      !this.#zoomFallbackPages.size &&
      this.selectionPageNos().some(
        page => !this.#records.get(page)?.selectionHighlights.childElementCount,
      )
    ) {
      this.#renderSelectionFromBookmarks();
    }
    this.#tryRestoreSelection();
  }

  #clearNativeSelection(clearBookmarks: boolean): void {
    const selection = this.#document.getSelection();
    if (selection && this.#selectionBelongsToViewer(selection)) {
      this.#restoring = true;
      selection.removeAllRanges();
      this.#window.queueMicrotask(() => {
        this.#restoring = false;
      });
    }
    if (clearBookmarks) this.#selection = null;
  }

  #selectionBelongsToViewer(selection: Selection): boolean {
    return (
      !!this.#endpointFor(selection.anchorNode, selection.anchorOffset, "backward") ||
      !!this.#endpointFor(selection.focusNode, selection.focusOffset, "forward")
    );
  }

  #focusBelongsToToolbarTransaction(
    transaction: Readonly<{ token: number; scopes: readonly HTMLElement[] }>,
  ): boolean {
    const focus = this.#document.activeElement;
    return (
      focus instanceof this.#window.HTMLElement &&
      transaction.scopes.some(scope => scope === focus || scope.contains(focus))
    );
  }

  #selectionTouchesPage(pageNo: number): boolean {
    if (!this.#selection) return false;
    const first = Math.min(this.#selection.anchor.page, this.#selection.focus.page);
    const last = Math.max(this.#selection.anchor.page, this.#selection.focus.page);
    return pageNo >= first && pageNo <= last;
  }

  #selectionMirrorIsCurrent(): boolean {
    if (!this.#selection) return true;
    return this.selectionPageNos().every(page => {
      const record = this.#records.get(page);
      return (
        !!record &&
        record.selectionHighlights.childElementCount > 0 &&
        Math.abs(record.geometryScale - record.viewport.scale) <= PRESENTATION_SCALE_EPSILON
      );
    });
  }

  #onLayerCopy(event: ClipboardEvent, record: PageTextPresentation): void {
    if (!this.#mode || this.#records.get(record.pageNo) !== record) return;
    if (
      !this.#selection ||
      this.#nativeState !== "owned" ||
      nativeSelectionOwners.get(this.#document) !== this
    )
      return;
    if (this.#completedCopies.has(event) || this.#copyPreCancelled.get(event)) return;
    if (!event.defaultPrevented) return;
    this.#completedCopies.add(event);
    this.#copied?.();
  }

  #onLayerCopyCapture(event: ClipboardEvent, record: PageTextPresentation): void {
    if (!this.#mode || this.#records.get(record.pageNo) !== record) return;
    this.#copyPreCancelled.set(event, event.defaultPrevented);
  }

  #onMouseDown(event: MouseEvent): void {
    if (
      !this.#mode ||
      event.button !== 0 ||
      !(event.target instanceof this.#window.Node) ||
      !this.#container.contains(event.target)
    )
      return;
    this.#hadSelectionOnPointerDown = this.#selection != null;
    this.#mousePoint = { x: event.clientX, y: event.clientY };
    this.#mouseSelectionStart = this.#mousePoint;
    this.#mouseSelectionMoved = false;
    if (
      !(event.target instanceof this.#window.Element) ||
      !(event.target as Element).closest(".pdf-page")
    )
      return;
    if (!this.#mappingForTarget(event.target)) return;
    this.#mouseSelecting = true;
  }

  #onPointerDown(event: PointerEvent): void {
    this.#lastPointerWasTouch = event.pointerType === "touch";
    if (!this.#lastPointerWasTouch) {
      if (event.isPrimary && event.button === 0 && this.#selection) this.clearSelection();
      return;
    }
    this.#hadSelectionOnPointerDown = this.#selection != null;
    this.#touchPointers.add(event.pointerId);
    if (this.#touchPointers.size >= 2) this.#suppressTapClearUntil = Number.POSITIVE_INFINITY;
  }

  #onPointerEnd(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    const wasMultiTouch = this.#touchPointers.size >= 2;
    this.#touchPointers.delete(event.pointerId);
    if (wasMultiTouch) this.#suppressTapClearUntil = this.#window.performance.now() + 500;
    if (
      event.type === "pointerup" &&
      !wasMultiTouch &&
      this.#window.performance.now() >= this.#suppressTapClearUntil &&
      this.#hadSelectionOnPointerDown &&
      event.target instanceof this.#window.Element &&
      !(event.target as Element).closest(".pdf-text-layer span")
    ) {
      this.#hadSelectionOnPointerDown = false;
      this.clearSelection();
    }
  }

  #onMouseMove(event: MouseEvent): void {
    if (!this.#mouseSelecting) return;
    this.#mousePoint = { x: event.clientX, y: event.clientY };
    if (
      Math.hypot(
        event.clientX - this.#mouseSelectionStart.x,
        event.clientY - this.#mouseSelectionStart.y,
      ) > 3
    ) {
      this.#mouseSelectionMoved = true;
      const nativeSelection = this.#document.getSelection();
      const ownsNativeRange =
        !!nativeSelection &&
        !nativeSelection.isCollapsed &&
        this.#selectionBelongsToViewer(nativeSelection);
      if (!this.#mousePointTargetsMappedText() && (this.#selection || ownsNativeRange)) {
        // Prevent Chromium from temporarily extending the native range through
        // PDF.js's page-sized end marker before selectionchange can restore it.
        event.preventDefault();
        if (!this.#selection && ownsNativeRange) this.#captureSelection();
        if (this.#selection) this.#restoreNativeSelection(this.#selection, true, "microtask");
      }
      this.#scheduleMouseGapRetention();
      if (
        nativeSelection &&
        !nativeSelection.isCollapsed &&
        this.#selectionBelongsToViewer(nativeSelection)
      ) {
        this.#scheduleAutoscroll();
      }
    }
  }

  #scheduleMouseGapRetention(): void {
    if (this.#mouseGapRestoreRaf != null || !this.#mouseSelecting || !this.#selection) return;
    // Chromium may snap a native range to PDF.js page structure while the
    // pointer crosses blank paper. Check after native mouse processing and
    // retain the prior semantic endpoint until mapped text is reached again.
    this.#mouseGapRestoreRaf = this.#window.requestAnimationFrame(() => {
      this.#mouseGapRestoreRaf = null;
      if (!this.#mouseSelecting || !this.#mouseSelectionMoved || !this.#selection) return;
      if (!this.#shouldRetainMouseGap()) return;
      this.#restoreNativeSelection(this.#selection, true, "microtask");
    });
  }

  #shouldRetainMouseGap(): boolean {
    if (!this.#mode || !this.#mouseSelecting || !this.#mouseSelectionMoved || !this.#selection)
      return false;
    return !this.#mousePointTargetsMappedText();
  }

  #mousePointTargetsMappedText(): boolean {
    const target = this.#document.elementFromPoint(this.#mousePoint.x, this.#mousePoint.y);
    return !!target && !!this.#mappingForTarget(target);
  }

  #onClick(event: MouseEvent): void {
    if (
      !this.#mode ||
      !(event.target instanceof this.#window.Element) ||
      !(event.target as Element).closest(".pdf-page")
    )
      return;
    if (this.#lastPointerWasTouch && this.#window.performance.now() < this.#suppressTapClearUntil)
      return;
    const moved = this.#mouseSelectionMoved;
    const hadSelection = this.#hadSelectionOnPointerDown;
    const preserveNewTouchSelection = this.#lastPointerWasTouch && !hadSelection;
    this.#hadSelectionOnPointerDown = false;
    this.#lastPointerWasTouch = false;
    this.#mouseSelectionMoved = false;
    if (moved) return;
    this.#window.queueMicrotask(() => {
      if (hadSelection || (this.#selection != null && !preserveNewTouchSelection)) {
        this.clearSelection();
        return;
      }
      const selection = this.#document.getSelection();
      if (selection && !selection.isCollapsed && this.#selectionBelongsToViewer(selection)) {
        this.#captureSelection();
        return;
      }
      this.clearSelection();
    });
  }

  #mappingForTarget(target: EventTarget | null): MappedNode | null {
    const node = target instanceof this.#window.Node ? (target as Node) : null;
    return node ? this.#mappingForNode(node) : null;
  }

  #mappingForNode(node: Node): MappedNode | null {
    const direct =
      this.#nodeMappings.get(node) ??
      (node.parentNode ? this.#nodeMappings.get(node.parentNode) : undefined);
    if (direct) return direct;
    const span =
      node instanceof HTMLSpanElement
        ? node
        : (node.parentElement?.closest<HTMLSpanElement>(".pdf-text-layer span") ?? null);
    if (!span) return null;
    for (const record of this.#records.values()) {
      const textItemIndex = record.spans.indexOf(span);
      if (textItemIndex >= 0) return { record, textItemIndex, span };
    }
    return null;
  }

  #scheduleAutoscroll(): void {
    if (this.#autoscrollRaf != null || !this.#mouseSelecting) return;
    this.#autoscrollRaf = this.#window.requestAnimationFrame(() => {
      this.#autoscrollRaf = null;
      const selection = this.#document.getSelection();
      if (
        !this.#mouseSelecting ||
        !this.#mouseSelectionMoved ||
        !selection ||
        selection.isCollapsed ||
        !this.#selectionBelongsToViewer(selection)
      )
        return;
      const rect = this.#container.getBoundingClientRect();
      const speed = (coordinate: number, low: number, high: number): number => {
        if (coordinate < low + EDGE_SCROLL_BAND) {
          return (
            -EDGE_SCROLL_MAX * Math.min(1, (low + EDGE_SCROLL_BAND - coordinate) / EDGE_SCROLL_BAND)
          );
        }
        if (coordinate > high - EDGE_SCROLL_BAND) {
          return (
            EDGE_SCROLL_MAX *
            Math.min(1, (coordinate - (high - EDGE_SCROLL_BAND)) / EDGE_SCROLL_BAND)
          );
        }
        return 0;
      };
      const dx = speed(this.#mousePoint.x, rect.left, rect.right);
      const dy = speed(this.#mousePoint.y, rect.top, rect.bottom);
      if (dx || dy) {
        this.#container.scrollLeft += dx;
        this.#container.scrollTop += dy;
        const x = Math.max(rect.left + 1, Math.min(this.#mousePoint.x, rect.right - 1));
        const y = Math.max(rect.top + 1, Math.min(this.#mousePoint.y, rect.bottom - 1));
        this.#moveNativeFocusToPoint(x, y);
      }
      this.#scheduleAutoscroll();
    });
  }

  #moveNativeFocusToPoint(x: number, y: number): void {
    const caretPosition = this.#document.caretPositionFromPoint?.(x, y);
    const legacyRange = !caretPosition
      ? (
          this.#document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          }
        ).caretRangeFromPoint?.(x, y)
      : null;
    const node = caretPosition?.offsetNode ?? legacyRange?.startContainer ?? null;
    const offset = caretPosition?.offset ?? legacyRange?.startOffset ?? 0;
    const focus = this.#endpointFor(node, offset, "forward");
    const selection = this.#document.getSelection();
    if (
      !focus ||
      !selection ||
      !selection.anchorNode ||
      !this.#endpointFor(selection.anchorNode, selection.anchorOffset, "backward")
    )
      return;
    const domFocus = this.#domEndpoint(focus);
    if (!domFocus) return;
    this.#restoring = true;
    try {
      selection.setBaseAndExtent(
        selection.anchorNode,
        selection.anchorOffset,
        domFocus.node,
        domFocus.offset,
      );
    } finally {
      this.#window.queueMicrotask(() => {
        this.#restoring = false;
      });
    }
    this.#lastFocus = focus;
    this.#captureSelection();
  }

  #stopMouseSelection(): void {
    this.#mouseSelecting = false;
    if (this.#mouseGapRestoreRaf != null)
      this.#window.cancelAnimationFrame(this.#mouseGapRestoreRaf);
    this.#mouseGapRestoreRaf = null;
    if (this.#autoscrollRaf != null) this.#window.cancelAnimationFrame(this.#autoscrollRaf);
    this.#autoscrollRaf = null;
    if (this.#mouseSelectionMoved) {
      this.#window.setTimeout(() => {
        this.#mouseSelectionMoved = false;
      }, 0);
    }
  }

  #ensureHighlights(record: PageTextPresentation): void {
    if (!record.highlights.isConnected) record.lease.wrapper.append(record.highlights);
  }

  #materializeHighlightScale(record: PageTextPresentation, scale: number): void {
    const ratio = scale / record.geometryScale;
    if (Math.abs(ratio - 1) > PRESENTATION_SCALE_EPSILON) {
      for (const highlight of record.highlights.querySelectorAll<HTMLElement>(
        ".pdf-search-highlight, .pdf-text-selection-highlight",
      )) {
        for (const property of ["left", "top", "width", "height"] as const) {
          const value = Number.parseFloat(highlight.style[property]);
          if (Number.isFinite(value)) highlight.style[property] = `${value * ratio}px`;
        }
      }
    }
    record.geometryScale = scale;
    record.highlights.style.transform = "";
    record.highlights.style.transformOrigin = "";
  }

  #compareEndpoints(a: TextEndpoint, b: TextEndpoint): number {
    return compareTextEndpoints(a, b);
  }

  #edgeDomEndpoint(
    record: PageTextPresentation,
    end: boolean,
  ): { node: Node; offset: number } | null {
    const indexes = end
      ? Array.from({ length: record.spans.length }, (_, index) => record.spans.length - index - 1)
      : Array.from({ length: record.spans.length }, (_, index) => index);
    for (const index of indexes) {
      const node = record.spans[index]?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE)
        return { node, offset: end ? (node.textContent?.length ?? 0) : 0 };
    }
    return null;
  }

  #rectContainedByLayer(rect: DOMRect, layer: DOMRect): boolean {
    return (
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      rect.left >= layer.left - RECT_TOLERANCE &&
      rect.top >= layer.top - RECT_TOLERANCE &&
      rect.right <= layer.right + RECT_TOLERANCE &&
      rect.bottom <= layer.bottom + RECT_TOLERANCE
    );
  }

  #nodeInsideViewer(node: Node | null): boolean {
    return !!node && this.#container.contains(node);
  }

  #yieldNativeOwnership(): void {
    const previousPages = this.#selectionPages(this.#selection);
    if (nativeSelectionOwners.get(this.#document) === this)
      nativeSelectionOwners.delete(this.#document);
    this.#nativeState = "dormant";
    this.#selection = null;
    this.#lastAnchor = null;
    this.#lastFocus = null;
    this.#syncNativeSelectionPaint();
    for (const page of previousPages)
      this.#records.get(page)?.selectionHighlights.replaceChildren();
    this.#releaseUnownedRecords();
    if (previousPages.length) this.#scheduleDemandChanged();
  }

  #releaseUnownedRecords(): void {
    for (const record of [...this.#records.values()]) {
      if (!this.#pageIsDemanded(record.pageNo)) {
        this.#releaseRecord(record);
      }
    }
  }

  #pageIsDemanded(pageNo: number): boolean {
    return (
      this.#selectionTouchesPage(pageNo) ||
      this.#activeMatchPage === pageNo ||
      (this.#viewportPages.has(pageNo) && (this.#mode || this.#matchesByPage.has(pageNo)))
    );
  }

  #selectionPages(selection: LogicalSelection | null): readonly number[] {
    if (!selection) return [];
    const first = Math.min(selection.anchor.page, selection.focus.page);
    const last = Math.max(selection.anchor.page, selection.focus.page);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }

  #matchKey(match: Readonly<DocumentTextMatch>): string {
    return `${match.page}:${match.segments
      .map(segment => `${segment.textItemIndex}:${segment.characterIndex}:${segment.length}`)
      .join(",")}`;
  }

  #scheduleDemandChanged(): void {
    if (this.#destroyed || this.#demandRaf != null || !this.#demandChanged) return;
    this.#demandRaf = this.#window.requestAnimationFrame(() => {
      this.#demandRaf = null;
      if (!this.#destroyed) safely(this.#demandChanged);
    });
  }

  #notifyDemandChanged(): void {
    if (!this.#destroyed) safely(this.#demandChanged);
  }

  #zoomFailureKey(pageNo: number): string {
    return `${this.#zoomGeneration}:${pageNo}:${this.#restoreScale ?? 0}`;
  }

  #handleZoomPresentationFailure(
    record: PageTextPresentation,
    scale: number,
    error: unknown,
  ): boolean {
    const pageNo = record.pageNo;
    if (
      !this.#zoomSuspended ||
      this.#restoreScale == null ||
      !this.#selectionTouchesPage(pageNo) ||
      Math.abs(scale - this.#restoreScale) > PRESENTATION_SCALE_EPSILON
    )
      return false;
    const key = this.#zoomFailureKey(pageNo);
    const attempts = (this.#zoomFailures.get(key) ?? 0) + 1;
    this.#zoomFailures.set(key, attempts);
    if (attempts === 1) {
      this.#scheduleDemandChanged();
      return false;
    }
    const fallbackGeometryAvailable = this.#materializeZoomFallback(record, scale);
    this.#zoomFallbackPages.add(pageNo);
    this.#diagnostic(
      "text-layer-zoom-recovery-fallback",
      "Text selection zoom recovery used retained geometry",
      {
        pageNo,
        scale,
        zoomGeneration: this.#zoomGeneration,
        attempts,
        fallbackGeometryAvailable,
        error,
      },
    );
    this.#finishPendingZoomIfReady();
    return true;
  }

  #captureZoomFallbackGeometry(): void {
    this.#zoomFallbackGeometry.clear();
    for (const pageNo of this.selectionPageNos()) {
      const record = this.#records.get(pageNo);
      if (!record) {
        this.#zoomFallbackGeometry.set(pageNo, Object.freeze({ available: false }));
        continue;
      }
      const rects = [
        ...record.selectionHighlights.querySelectorAll<HTMLElement>(
          ".pdf-text-selection-highlight",
        ),
      ]
        .map(highlight =>
          Object.freeze({
            left: Number.parseFloat(highlight.style.left),
            top: Number.parseFloat(highlight.style.top),
            right:
              Number.parseFloat(highlight.style.left) + Number.parseFloat(highlight.style.width),
            bottom:
              Number.parseFloat(highlight.style.top) + Number.parseFloat(highlight.style.height),
          }),
        )
        .filter(rect => Object.values(rect).every(Number.isFinite));
      this.#zoomFallbackGeometry.set(
        pageNo,
        Object.freeze({
          available: true,
          scale: record.geometryScale,
          rects: Object.freeze(rects),
        }),
      );
    }
  }

  #materializeZoomFallback(record: PageTextPresentation, scale: number): boolean {
    const fallback = this.#zoomFallbackGeometry.get(record.pageNo);
    if (!fallback?.available) return false;
    const ratio = scale / fallback.scale;
    const fragment = this.#document.createDocumentFragment();
    for (const rect of fallback.rects) {
      const highlight = this.#document.createElement("div");
      highlight.className = "pdf-text-selection-highlight";
      Object.assign(highlight.style, {
        left: `${rect.left * ratio}px`,
        top: `${rect.top * ratio}px`,
        width: `${(rect.right - rect.left) * ratio}px`,
        height: `${(rect.bottom - rect.top) * ratio}px`,
      });
      fragment.append(highlight);
    }
    this.#ensureHighlights(record);
    record.selectionHighlights.replaceChildren(fragment);
    record.geometryScale = scale;
    return true;
  }

  #cancelScheduledOwnerWork(): void {
    if (this.#selectionRaf != null) this.#window.cancelAnimationFrame(this.#selectionRaf);
    if (this.#demandRaf != null) this.#window.cancelAnimationFrame(this.#demandRaf);
    if (this.#toolbarRestoreRaf != null) this.#window.cancelAnimationFrame(this.#toolbarRestoreRaf);
    this.#selectionRaf = null;
    this.#demandRaf = null;
    this.#toolbarRestoreRaf = null;
    this.#selectionChangeGeneration++;
  }

  #diagnostic(event: string, message: string, details: Readonly<Record<string, unknown>>): void {
    safely(() =>
      this.#diagnosticCallback?.(
        Object.freeze({ event, message, details: Object.freeze({ ...details }) }),
      ),
    );
  }
}
