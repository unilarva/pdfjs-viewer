// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for one document's controlled native print preparation.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. `DocumentPrint` owns cancellable job identity,
 * print snapshots, exclusive raster admission, page-use leases, scratch canvases,
 * encoded sheets, frame construction, invocation transfer, and pre-transfer cleanup.
 * The window coordinator exclusively owns resources after native invocation. See the
 * [architecture guide](../ARCHITECTURE.md) for lifecycle ordering and memory limits.
 * @packageDocumentation
 * @module document-print
 */

import type * as PDFJS from "pdfjs-dist";
import type {
  PdfjsViewerDocumentInformation,
  PdfjsViewerNormalizedPrintOptions,
  PdfjsViewerPrintCleanupDetail,
  PdfjsViewerPrintInvokedDetail,
  PdfjsViewerPrintProgressDetail,
  PdfjsViewerPrintResult,
  PdfjsViewerPrintStartDetail,
} from "./viewer-contracts.js";
import type { DocumentPageAcquirer, DocumentPageUse } from "./document-page-usage.js";
import type { DocumentLayersVisibilitySnapshot } from "./document-layers.js";
import type { DocumentXfaPrintSnapshot } from "./document-xfa-print.js";
import { materializeXfaStructure } from "./xfa-value-snapshot.js";
import type { RasterWorkCoordinator } from "./raster-work-coordinator.js";
import { startPdfPageRenderTask } from "./pdfjs-compatibility.js";
import { getPdfjsXfaPageViewport, renderPdfjsXfaLayer } from "./pdfjs-compatibility.js";
import {
  DEFAULT_PRINT_BUDGET_LIMITS,
  countPrintPages,
  countPrintSheets,
  estimatePrintPeakBytes,
  planPrintDpiFit,
  planPrintSheetGeometry,
  planPrintSheets,
  resolvePrintTransportGeometry,
  resolvePrintSheetSize,
  resolvePermissionAwarePrintDpi,
  selectedPrintRuns,
  type PrintBudgetLimits,
  type PrintPageSize,
  type ResolvedPrintLayout,
} from "./print-sheet-planner.js";
import { nativePrintCoordinatorFor } from "./native-print-coordinator.js";
import {
  nativePrintCapabilitiesFor,
  type PdfjsViewerNativePrintCapabilities,
} from "./native-print-capabilities.js";
import { resolveDocumentPrintPermission } from "./print-permission.js";

const PDF_TO_CSS_UNITS = 96 / 72;
const PAGE_GEOMETRY_EPSILON = 1e-6;

type AnnotationStorage = PDFJS.PDFDocumentProxy["annotationStorage"];
type DocumentPrintPhase = "idle" | "preflight" | "preparing" | "invoked";
interface DocumentPrintState {
  readonly phase: DocumentPrintPhase;
  readonly jobId: number | null;
  readonly completedSheets: number;
  readonly totalSheets: number;
  readonly retainedBytes: number;
  readonly nativeResourcesRetained: boolean;
}
interface DocumentPrintGeometrySnapshot {
  readonly revision: number;
  readonly layout: ResolvedPrintLayout;
  readonly sizes: readonly PrintPageSize[];
  sizeFor(pageNo: number): PrintPageSize;
}
interface DocumentPrintCallbacks {
  readonly state?: (state: Readonly<DocumentPrintState>) => void;
  readonly event?: (event: DocumentPrintEvent) => void;
  readonly diagnostic?: (details: Readonly<Record<string, unknown>>) => void;
}
type DocumentPrintEvent =
  | Readonly<{ type: "start"; detail: PdfjsViewerPrintStartDetail }>
  | Readonly<{ type: "progress"; detail: Readonly<PdfjsViewerPrintProgressDetail> }>
  | Readonly<{ type: "invoked"; detail: Readonly<PdfjsViewerPrintInvokedDetail> }>
  | Readonly<{ type: "cleanup"; detail: PdfjsViewerPrintCleanupDetail }>;
interface DocumentPrintContext {
  readonly pdf: PDFJS.PDFDocumentProxy;
  readonly pages: DocumentPageAcquirer;
  readonly information: PdfjsViewerDocumentInformation;
  readonly geometry: DocumentPrintGeometrySnapshot;
  readonly layerVisibility: DocumentLayersVisibilitySnapshot | null;
  readonly formStorageSnapshot: AnnotationStorage["print"];
  readonly xfaSnapshot: DocumentXfaPrintSnapshot | null;
  readonly revisions: Readonly<{
    document: number;
    layers: number | null;
    forms: number;
    geometry: number;
  }>;
  readonly AnnotationMode: typeof PDFJS.AnnotationMode;
  readonly XfaLayer?: typeof PDFJS.XfaLayer;
  readonly signal: AbortSignal;
  readonly window: Window;
  readonly nativeCapabilities?: () => Readonly<PdfjsViewerNativePrintCapabilities>;
  readonly sourceFallbackAvailable?: boolean;
  /** Immutable profile snapshot captured synchronously by the facade for this job. */
  readonly limits?: Readonly<PrintBudgetLimits>;
  readonly profile: Readonly<{ id: string; revision: number }>;
  readonly evictMainRasterOutputs?: () => Readonly<{ count: number; bytes: number }>;
  readonly residualRasterBytes?: () => number;
  readonly evictThumbnailBackingStores?: () => Readonly<{ count: number; bytes: number }>;
}

interface PrintDomContext {
  readonly root: HTMLDivElement;
  readonly stylesheet: CSSStyleSheet;
  readonly cleanup: () => void;
}

const idleState = (): DocumentPrintState =>
  Object.freeze({
    phase: "idle",
    jobId: null,
    completedSheets: 0,
    totalSheets: 0,
    retainedBytes: 0,
    nativeResourcesRetained: false,
  });

/** Owns at most one cancellable preparation job for the active viewer. */
export class DocumentPrint {
  #coordinator: RasterWorkCoordinator;
  #fallbackLimits: Readonly<PrintBudgetLimits>;
  #callbacks: DocumentPrintCallbacks;
  #preserveDebugArtifacts: boolean;
  #nextJobId = 0;
  #abort: AbortController | null = null;
  #state: Readonly<DocumentPrintState> = idleState();

  constructor(
    coordinator: RasterWorkCoordinator,
    fallbackLimits: Partial<PrintBudgetLimits> = {},
    callbacks: DocumentPrintCallbacks = {},
    preserveDebugArtifacts = false,
  ) {
    this.#coordinator = coordinator;
    this.#fallbackLimits = Object.freeze({ ...DEFAULT_PRINT_BUDGET_LIMITS, ...fallbackLimits });
    this.#callbacks = callbacks;
    this.#preserveDebugArtifacts = preserveDebugArtifacts;
  }

  get state(): Readonly<DocumentPrintState> {
    return this.#state;
  }

  /** Releases a retained debug print artifact and its exclusive raster lease. */
  releaseDebugArtifact(win: Window): boolean {
    return nativePrintCoordinatorFor(win).releaseDebugArtifact();
  }

  /** Cancels preparation only. Invoked resources belong to the window coordinator. */
  cancel(): void {
    this.#abort?.abort();
  }
  reset(): void {
    if (this.#state.phase === "invoked") return;
    const abort = this.#abort;
    abort?.abort();
    // A replacement may admit its successor immediately. Stale work keeps its
    // local controller and cannot clear or publish over the newer operation.
    if (this.#abort === abort) this.#abort = null;
    // Invocation transferred ownership to the Window; document replacement must not hide or release it.
    this.#publish(idleState());
  }

  async print(
    options: PdfjsViewerNormalizedPrintOptions,
    context: DocumentPrintContext,
  ): Promise<PdfjsViewerPrintResult> {
    const limits = context.limits ?? this.#fallbackLimits;
    const sourceFallbackAvailable = context.sourceFallbackAvailable ?? true;
    if (this.#abort) return { ok: false, reason: "cancelled" };
    if (options.signal?.aborted || context.signal.aborted)
      return { ok: false, reason: "cancelled" };
    const permission = resolveDocumentPrintPermission(context.information);
    if (!permission.allowed) return { ok: false, reason: "disabled" };
    const resolveCapabilities =
      context.nativeCapabilities ?? (() => nativePrintCapabilitiesFor(context.window));
    const capabilities = resolveCapabilities();
    if (capabilities.nativePrintSupport === "unsupported")
      return { ok: false, reason: "unsupported" };
    const requestedDpi = resolvePermissionAwarePrintDpi(options.quality, permission.highQuality);

    const layout = context.geometry.layout;
    const runs = selectedPrintRuns(options.pages, context.pdf.numPages);
    const sheetCount = countPrintSheets(runs, layout);
    if (sheetCount > limits.maxSheets) {
      this.#callbacks.diagnostic?.(
        Object.freeze({
          requestedDpi,
          resolvedDpi: null,
          sheetCount,
          exceededLimits: Object.freeze(["maxSheets"]),
          nativeCapabilities: capabilities,
          revisions: context.revisions,
          profile: context.profile,
        }),
      );
      return {
        ok: false,
        reason: "too-many-sheets",
        sheetCount,
        maxSheets: limits.maxSheets,
        sourceFallbackAvailable,
      };
    }
    const xfa = context.xfaSnapshot;
    if (xfa) {
      const selectedPages = countPrintPages(runs);
      let selectedNodes = 0;
      let selectedImages = 0;
      for (const run of runs)
        for (let pageNo = run.from; pageNo <= run.to; pageNo++) {
          const page = xfa.pageFor(pageNo);
          selectedNodes += page.nodeCount;
          selectedImages += page.imageCount;
        }
      if (
        selectedPages > limits.maxXfaPages ||
        selectedNodes > limits.maxXfaNodes ||
        selectedImages > limits.maxXfaImages
      ) {
        return {
          ok: false,
          reason: "too-large",
          estimatedSheetCount: sheetCount,
          sourceFallbackAvailable,
        };
      }
    }
    const selectedSizes: PrintPageSize[] = [];
    for (const run of runs)
      for (let pageNo = run.from; pageNo <= run.to; pageNo++)
        selectedSizes.push(context.geometry.sizeFor(pageNo));
    const sheetSize = resolvePrintSheetSize(
      options.sheet,
      options.orientation,
      layout,
      selectedSizes,
    );
    const transport = resolvePrintTransportGeometry(
      sheetSize,
      capabilities.nativePrintSupport === "portrait-and-landscape",
    );
    // Preflight is allocation-free: exclusive draining later establishes the zero-raster baseline.
    const residualBaselineBytes = 0;
    const rasterFit = xfa
      ? null
      : planPrintDpiFit(sheetCount, transport.size, requestedDpi, limits, 0);
    const estimate = rasterFit?.estimate ?? null;
    this.#callbacks.diagnostic?.(
      Object.freeze({
        requestedDpi,
        resolvedDpi: rasterFit?.resolvedDpi ?? requestedDpi,
        sheetCount,
        exceededLimits: estimate?.exceeded ?? Object.freeze([]),
        decodedBytes: estimate?.decodedBytes ?? 0,
        estimatedRetainedBytes: estimate?.estimatedRetainedBytes ?? 0,
        peakBytes: estimate?.peakBytes ?? 0,
        xfaNodes: xfa?.nodeCount ?? 0,
        xfaImages: xfa?.imageCount ?? 0,
        nativeCapabilities: capabilities,
        nativeTransportSize: transport.size,
        rotatedCounterclockwise: transport.rotatedCounterclockwise,
        revisions: context.revisions,
        profile: context.profile,
      }),
    );
    if (rasterFit?.resolvedDpi === null) {
      return {
        ok: false,
        reason: rasterFit.estimate.exceeded.includes("memoryLimitMiB")
          ? "memory-limit"
          : "too-large",
        estimatedSheetCount: sheetCount,
        sourceFallbackAvailable,
      };
    }
    const sheets = planPrintSheets(runs, layout);
    const dpi = rasterFit?.resolvedDpi ?? requestedDpi;
    const native = nativePrintCoordinatorFor(context.window);
    native.recoverOrphanedLease();
    if (native.busy) return { ok: false, reason: "unsupported" };

    const jobId = ++this.#nextJobId;
    const abort = new AbortController();
    this.#abort = abort;
    const cancel = () => abort.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    context.signal.addEventListener("abort", cancel, { once: true });
    // Abort may race with listener installation. Do not publish a job or allocate
    // resources unless both caller-owned lifetimes are still active.
    if (options.signal?.aborted || context.signal.aborted) {
      options.signal?.removeEventListener("abort", cancel);
      context.signal.removeEventListener("abort", cancel);
      if (this.#abort === abort) this.#abort = null;
      return { ok: false, reason: "cancelled" };
    }
    const urls: string[] = [];
    let printDom: PrintDomContext | null = null;
    let sheetCanvas: HTMLCanvasElement | null = null;
    let pageCanvas: HTMLCanvasElement | null = null;
    let exclusive: Awaited<ReturnType<RasterWorkCoordinator["acquireExclusive"]>> | null = null;
    let transferred = false;
    let started = false;
    let retainedBytes = 0;
    try {
      this.#publish(
        Object.freeze({
          phase: "preflight",
          jobId,
          completedSheets: 0,
          totalSheets: sheetCount,
          retainedBytes: 0,
          nativeResourcesRetained: false,
        }),
      );
      this.#throwIfStale(abort, jobId);
      started = true;
      this.#callbacks.event?.(
        Object.freeze({
          type: "start",
          detail: Object.freeze({
            kind: "controlled",
            jobId,
            sheetCount,
            dpi,
            nativeCapabilities: capabilities,
          }),
        }),
      );
      this.#throwIfStale(abort, jobId);
      const optionalContentConfig = await context.pdf.getOptionalContentConfig({ intent: "print" });
      for (const [id, visible] of Object.entries(context.layerVisibility?.visibility ?? {})) {
        optionalContentConfig.setVisibility(id, visible, true);
      }
      this.#throwIfAborted(abort.signal);
      const printAnnotationStorage = xfa?.annotationStorage ?? context.formStorageSnapshot;
      exclusive = await this.#coordinator.acquireExclusive();
      this.#throwIfAborted(abort.signal);
      const evictedMain =
        context.evictMainRasterOutputs?.() ?? Object.freeze({ count: 0, bytes: 0 });
      const evictedThumbnails =
        context.evictThumbnailBackingStores?.() ?? Object.freeze({ count: 0, bytes: 0 });
      const residualRasterBytes = context.residualRasterBytes?.() ?? 0;
      this.#callbacks.diagnostic?.(
        Object.freeze({
          evictedMainCanvases: evictedMain.count,
          evictedMainRasterBytes: evictedMain.bytes,
          evictedThumbnailBackingStores: evictedThumbnails.count,
          evictedThumbnailRasterBytes: evictedThumbnails.bytes,
          reclaimableRasterBytes: evictedMain.bytes + evictedThumbnails.bytes,
          residualRasterBytes,
          profile: context.profile,
        }),
      );
      this.#throwIfStale(abort, jobId);
      if (residualRasterBytes !== 0) {
        return {
          ok: false,
          reason: "memory-limit",
          estimatedSheetCount: sheetCount,
          sourceFallbackAvailable,
        };
      }
      this.#publish(
        Object.freeze({
          phase: "preparing",
          jobId,
          completedSheets: 0,
          totalSheets: sheetCount,
          retainedBytes: 0,
          nativeResourcesRetained: false,
        }),
      );
      this.#throwIfStale(abort, jobId);

      if (xfa) {
        if (!context.XfaLayer) throw new Error("PdfjsViewer: pure-XFA printing requires XfaLayer");
        printDom = this.#createPrintDom(context.window, transport.size, jobId);
        await this.#prepareXfa(
          printDom,
          sheets,
          sheetSize,
          transport.size,
          transport.rotatedCounterclockwise,
          layout,
          options.pageScaling,
          xfa,
          context.XfaLayer,
          printAnnotationStorage,
          limits,
          abort.signal,
        );
        this.#progress(abort, jobId, sheetCount, sheetCount, 0);
      } else {
        if (!estimate) throw new Error("PdfjsViewer: raster print estimate is unavailable");
        sheetCanvas = context.window.document.createElement("canvas");
        sheetCanvas.width = estimate.canvasWidth;
        sheetCanvas.height = estimate.canvasHeight;
        pageCanvas = context.window.document.createElement("canvas");
        for (let index = 0; index < sheets.length; index++) {
          this.#throwIfAborted(abort.signal);
          const sheet = sheets[index]!;
          const uses: DocumentPageUse[] = [];
          try {
            const sheetContext = sheetCanvas.getContext("2d", { alpha: false });
            if (!sheetContext) throw new Error("PdfjsViewer: print sheet canvas is unavailable");
            sheetContext.fillStyle = "white";
            sheetContext.setTransform(1, 0, 0, 1, 0, 0);
            sheetContext.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
            if (transport.rotatedCounterclockwise)
              sheetContext.setTransform(0, -1, 1, 0, 0, sheetCanvas.height);
            for (const pageNo of [sheet.left, sheet.right]) {
              if (pageNo === null) continue;
              const use = await context.pages.acquire(pageNo);
              uses.push(use);
              this.#throwIfAborted(abort.signal);
              const baseViewport = use.page.getViewport({ scale: 1, rotation: use.page.rotate });
              const admittedSize = context.geometry.sizeFor(pageNo);
              if (
                Math.abs(baseViewport.width - admittedSize.width) >= PAGE_GEOMETRY_EPSILON ||
                Math.abs(baseViewport.height - admittedSize.height) >= PAGE_GEOMETRY_EPSILON
              ) {
                return { ok: false, reason: "cancelled" };
              }
              const geometry = planPrintSheetGeometry(
                sheet,
                sheetSize,
                layout,
                candidate => context.geometry.sizeFor(candidate),
                options.pageScaling,
              );
              const slot = pageNo === sheet.left ? geometry.slots[0] : geometry.slots[1];
              if (!slot) continue;
              const rasterScale =
                (Math.min(slot.width / baseViewport.width, slot.height / baseViewport.height) *
                  dpi) /
                72;
              const viewport = use.page.getViewport({
                scale: rasterScale,
                rotation: use.page.rotate,
              });
              if (
                Math.max(viewport.width, viewport.height) > limits.maxCanvasDimension ||
                viewport.width * viewport.height > limits.maxCanvasPixels
              ) {
                return {
                  ok: false,
                  reason: "too-large",
                  estimatedSheetCount: sheets.length,
                  sourceFallbackAvailable,
                };
              }
              pageCanvas.width = Math.ceil(viewport.width);
              pageCanvas.height = Math.ceil(viewport.height);
              const pageContext = pageCanvas.getContext("2d", { alpha: false });
              if (!pageContext) throw new Error("PdfjsViewer: print page canvas is unavailable");
              pageContext.save();
              pageContext.fillStyle = "white";
              pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
              pageContext.restore();
              const annotationCanvasMap = new Map<string, HTMLCanvasElement>();
              try {
                await startPdfPageRenderTask(
                  use.page,
                  {
                    canvas: pageCanvas,
                    canvasContext: pageContext,
                    viewport,
                    intent: "print",
                    annotationMode: context.AnnotationMode.ENABLE_STORAGE,
                    optionalContentConfigPromise: Promise.resolve(optionalContentConfig),
                    printAnnotationStorage: printAnnotationStorage as AnnotationStorage["print"],
                    annotationCanvasMap,
                  },
                  abort.signal,
                ).promise;
                const annotationBytes = canvasMapBytes(annotationCanvasMap);
                if (annotationBytes > limits.maxAnnotationCanvasBytesPerPage) {
                  return {
                    ok: false,
                    reason: "memory-limit",
                    estimatedSheetCount: sheetCount,
                    sourceFallbackAvailable,
                  };
                }
                sheetContext.drawImage(
                  pageCanvas,
                  (slot.x * dpi) / 72,
                  (slot.y * dpi) / 72,
                  (slot.width * dpi) / 72,
                  (slot.height * dpi) / 72,
                );
              } finally {
                releaseCanvasMap(annotationCanvasMap);
              }
            }
            const blob = await canvasBlob(sheetCanvas);
            this.#throwIfAborted(abort.signal);
            retainedBytes += blob.size;
            const remainingEstimatedBytes =
              (estimate.estimatedRetainedBytes * (sheets.length - index - 1)) / sheets.length;
            const projectedRetainedBytes = Math.ceil(retainedBytes + remainingEstimatedBytes);
            if (
              estimatePrintPeakBytes(estimate, projectedRetainedBytes, limits, 0) >
              limits.memoryLimitMiB * 1024 * 1024
            ) {
              return {
                ok: false,
                reason: "memory-limit",
                estimatedSheetCount: sheetCount,
                sourceFallbackAvailable,
              };
            }
            urls.push(windowUrl(context.window).createObjectURL(blob));
          } finally {
            for (const use of uses) use.release();
          }
          this.#progress(abort, jobId, index + 1, sheets.length, retainedBytes);
        }
        sheetCanvas.width = sheetCanvas.height = 0;
        pageCanvas.width = pageCanvas.height = 0;
        sheetCanvas = pageCanvas = null;
        printDom = this.#createPrintDom(context.window, transport.size, jobId);
        await this.#installImages(printDom, urls, transport.size, limits, abort.signal);
      }
      this.#throwIfAborted(abort.signal);
      const ownedDom = printDom;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const url of urls) windowUrl(context.window).revokeObjectURL(url);
        ownedDom.cleanup();
      };
      const nativeExclusive = exclusive;
      const settled = () => {
        nativeExclusive.release();
        if (this.#state.jobId === jobId) this.#publish(idleState());
        if (started)
          this.#callbacks.event?.(
            Object.freeze({
              type: "cleanup",
              detail: Object.freeze({ kind: "controlled", jobId, retainedBytes }),
            }),
          );
      };
      let invocation: "invoked" | "busy" | "unsupported";
      try {
        invocation = native.invoke({
          jobId,
          root: ownedDom.root,
          printWindow: context.window,
          urls: Object.freeze([...urls]),
          retainedBytes,
          sheetCount,
          preserveArtifact: this.#preserveDebugArtifacts,
          invoked: () => {
            // This runs before print(), so a synchronous afterprint cannot make the
            // public lifecycle skip the retained invoked state.
            this.#publish(
              Object.freeze({
                phase: "invoked",
                jobId,
                completedSheets: sheetCount,
                totalSheets: sheetCount,
                retainedBytes,
                nativeResourcesRetained: true,
              }),
            );
            this.#callbacks.event?.(
              Object.freeze({
                type: "invoked",
                detail: Object.freeze({ kind: "controlled", jobId, sheetCount, retainedBytes }),
              }),
            );
            this.#callbacks.diagnostic?.(
              Object.freeze({
                requestedDpi,
                resolvedDpi: dpi,
                sheetCount,
                actualRetainedBytes: retainedBytes,
                revisions: context.revisions,
              }),
            );
          },
          settled,
          cleanup,
        });
      } catch (error) {
        // A throwing print() is finalized by the coordinator before it rethrows.
        transferred = true;
        throw error;
      }
      if (invocation !== "invoked") return { ok: false, reason: "unsupported" };
      transferred = true;
      // Native lifecycle now owns release. Keeping admission suspended prevents print
      // resources and newly rendered viewer output from occupying separate envelopes.
      exclusive = null;
      return { ok: true, status: "print-invoked", sheetCount };
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError"))
        return { ok: false, reason: "cancelled" };
      throw error;
    } finally {
      exclusive?.release();
      options.signal?.removeEventListener("abort", cancel);
      context.signal.removeEventListener("abort", cancel);
      if (!transferred) {
        for (const url of urls) windowUrl(context.window).revokeObjectURL(url);
        printDom?.cleanup();
        this.#callbacks.event?.(
          Object.freeze({
            type: "cleanup",
            detail: Object.freeze({ kind: "controlled", jobId, retainedBytes }),
          }),
        );
      }
      if (sheetCanvas) sheetCanvas.width = sheetCanvas.height = 0;
      if (pageCanvas) pageCanvas.width = pageCanvas.height = 0;
      if (this.#abort === abort) this.#abort = null;
      if (!transferred && this.#state.jobId === jobId) this.#publish(idleState());
    }
  }

  #createPrintDom(win: Window, size: PrintPageSize, jobId: number): PrintDomContext {
    const doc = win.document;
    const Sheet = (win as Window & { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
    if (!Sheet || !("adoptedStyleSheets" in doc)) {
      throw new Error("PdfjsViewer: controlled printing requires constructed stylesheet support");
    }
    const stylesheet = new Sheet();
    stylesheet.replaceSync(`@page { size: ${size.width}pt ${size.height}pt; margin: 0; }
      .pdf-native-print-root[data-pdf-print-job="${jobId}"] { width: ${size.width}pt; }
      .pdf-native-print-root[data-pdf-print-job="${jobId}"] > .pdf-native-print-sheet { width: ${size.width}pt; height: ${size.height}pt; }`);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, stylesheet];
    const root = doc.createElement("div");
    root.className = "pdf-native-print-root";
    root.dataset.pdfPrintJob = String(jobId);
    root.setAttribute("aria-hidden", "true");
    try {
      doc.body.append(root);
    } catch (error) {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(candidate => candidate !== stylesheet);
      throw error;
    }
    let cleaned = false;
    return Object.freeze({
      root,
      stylesheet,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        root.remove();
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(
          candidate => candidate !== stylesheet,
        );
      },
    });
  }

  async #installImages(
    printDom: PrintDomContext,
    urls: readonly string[],
    size: PrintPageSize,
    limits: PrintBudgetLimits,
    signal: AbortSignal,
  ): Promise<void> {
    const doc = printDom.root.ownerDocument;
    const images = urls.map(url => {
      const sheet = doc.createElement("div");
      sheet.className = "pdf-native-print-sheet";
      const image = doc.createElement("img");
      image.src = url;
      image.alt = "";
      sheet.append(image);
      printDom.root.append(sheet);
      return image;
    });
    await decodeImagesBounded(images, limits.maxConcurrentImageDecodes, signal);
    await this.#awaitPrintReadiness(printDom, size, [], signal);
    this.#throwIfAborted(signal);
  }

  async #prepareXfa(
    printDom: PrintDomContext,
    sheets: readonly Readonly<{ left: number | null; right: number | null }>[],
    logicalSize: PrintPageSize,
    transportSize: PrintPageSize,
    rotatedCounterclockwise: boolean,
    layout: ResolvedPrintLayout,
    pageScaling: PdfjsViewerNormalizedPrintOptions["pageScaling"],
    snapshot: DocumentXfaPrintSnapshot,
    XfaLayer: typeof PDFJS.XfaLayer | undefined,
    storage: unknown,
    limits: PrintBudgetLimits,
    signal: AbortSignal,
  ): Promise<void> {
    if (!XfaLayer) throw new Error("PdfjsViewer: pure-XFA printing requires XfaLayer");
    const doc = printDom.root.ownerDocument;
    const measuredSlots: Array<
      Readonly<{ element: HTMLElement; rect: import("./print-sheet-planner.js").PrintRect }>
    > = [];
    const jobSelector = `.pdf-native-print-root[data-pdf-print-job="${printDom.root.dataset.pdfPrintJob}"]`;
    printDom.stylesheet.insertRule(
      `${jobSelector} .pdf-native-print-content { width: ${logicalSize.width}pt; height: ${logicalSize.height}pt;${rotatedCounterclockwise ? ` transform: translateY(${logicalSize.width}pt) rotate(-90deg); transform-origin: 0 0;` : ""} }`,
    );
    for (const [sheetIndex, sheetPlan] of sheets.entries()) {
      const sheet = doc.createElement("div");
      sheet.className = "pdf-native-print-sheet";
      printDom.root.append(sheet);
      const content = doc.createElement("div");
      content.className = "pdf-native-print-content";
      sheet.append(content);
      const geometry = planPrintSheetGeometry(
        sheetPlan,
        logicalSize,
        layout,
        pageNo => {
          return snapshot.pageFor(pageNo).size;
        },
        pageScaling,
      );
      for (const [slotIndex, pageNo] of [sheetPlan.left, sheetPlan.right].entries()) {
        if (pageNo === null) continue;
        const slotRect = geometry.slots[slotIndex]!;
        const slot = doc.createElement("div");
        const slotClass = `pdf-native-print-slot-${sheetIndex}-${slotIndex}`;
        slot.className = `pdf-native-print-slot ${slotClass}`;
        printDom.stylesheet.insertRule(
          `.pdf-native-print-root[data-pdf-print-job="${printDom.root.dataset.pdfPrintJob}"] .${slotClass} { left: ${slotRect.x}pt; top: ${slotRect.y}pt; width: ${slotRect.width}pt; height: ${slotRect.height}pt; }`,
        );
        content.append(slot);
        const page = snapshot.pageFor(pageNo);
        const containScale = Math.min(
          slotRect.width / page.size.width,
          slotRect.height / page.size.height,
        );
        const xfaHtml = materializeXfaStructure(page.xfaHtml);
        const viewport = getPdfjsXfaPageViewport(XfaLayer, xfaHtml, {
          scale: PDF_TO_CSS_UNITS * containScale,
          rotation: 0,
        });
        const xfaRoot = doc.createElement("div");
        const transform = `matrix(${viewport.transform.join(",")})`;
        printDom.stylesheet.insertRule(
          `.pdf-native-print-root[data-pdf-print-job="${printDom.root.dataset.pdfPrintJob}"] .${slotClass} > .xfaLayer { width: ${page.size.width}px; height: ${page.size.height}px; transform: ${transform}; transform-origin: 0 0; }`,
        );
        slot.append(xfaRoot);
        renderPdfjsXfaLayer(XfaLayer, {
          viewport,
          div: xfaRoot,
          xfaHtml,
          annotationStorage: storage,
          intent: "print",
          linkService: null,
        });
        xfaRoot.removeAttribute("style");
        measuredSlots.push(Object.freeze({ element: slot, rect: slotRect }));
      }
    }
    const images = [...printDom.root.querySelectorAll<HTMLImageElement>("img")];
    await decodeImagesBounded(images, limits.maxConcurrentImageDecodes, signal);
    await this.#awaitPrintReadiness(
      printDom,
      transportSize,
      measuredSlots,
      signal,
      rotatedCounterclockwise,
    );
    this.#throwIfAborted(signal);
  }

  async #awaitPrintReadiness(
    printDom: PrintDomContext,
    size: PrintPageSize,
    slots: readonly Readonly<{
      element: HTMLElement;
      rect: import("./print-sheet-planner.js").PrintRect;
    }>[],
    signal: AbortSignal,
    rotatedCounterclockwise = false,
  ): Promise<void> {
    const doc = printDom.root.ownerDocument;
    if (
      !doc.adoptedStyleSheets.includes(printDom.stylesheet) ||
      !printDom.stylesheet.cssRules.length
    ) {
      throw new Error("PdfjsViewer: print stylesheet was not installed");
    }
    await abortable(doc.fonts.ready, signal);
    await nextLayoutFrame(doc.defaultView!, signal);
    const rootStyle = doc.defaultView!.getComputedStyle(printDom.root);
    if (rootStyle.position !== "fixed" || rootStyle.overflow !== "hidden") {
      throw new Error("PdfjsViewer: functional core.css print rules are not ready");
    }
    const expectedWidth = size.width * PDF_TO_CSS_UNITS;
    const expectedHeight = size.height * PDF_TO_CSS_UNITS;
    for (const sheet of printDom.root.querySelectorAll<HTMLElement>(".pdf-native-print-sheet")) {
      if (doc.defaultView!.getComputedStyle(sheet).position !== "relative") {
        throw new Error("PdfjsViewer: functional print sheet rules are not ready");
      }
      assertPhysicalBounds(sheet.getBoundingClientRect(), expectedWidth, expectedHeight, "sheet");
    }
    for (const { element, rect } of slots) {
      assertPhysicalBounds(
        element.getBoundingClientRect(),
        (rotatedCounterclockwise ? rect.height : rect.width) * PDF_TO_CSS_UNITS,
        (rotatedCounterclockwise ? rect.width : rect.height) * PDF_TO_CSS_UNITS,
        "slot",
      );
      const child = element.firstElementChild;
      if (child) {
        const bounds = child.getBoundingClientRect();
        const slotBounds = element.getBoundingClientRect();
        if (
          bounds.width <= 0 ||
          bounds.height <= 0 ||
          bounds.left < slotBounds.left - 1 ||
          bounds.top < slotBounds.top - 1 ||
          bounds.right > slotBounds.right + 1 ||
          bounds.bottom > slotBounds.bottom + 1
        ) {
          throw new Error("PdfjsViewer: rendered XFA page exceeds its physical print slot");
        }
      }
    }
  }

  #progress(
    abort: AbortController,
    jobId: number,
    completedSheets: number,
    totalSheets: number,
    retainedBytes: number,
  ): void {
    this.#throwIfStale(abort, jobId);
    this.#publish(
      Object.freeze({
        phase: "preparing",
        jobId,
        completedSheets,
        totalSheets,
        retainedBytes,
        nativeResourcesRetained: false,
      }),
    );
    this.#throwIfStale(abort, jobId);
    this.#callbacks.event?.(
      Object.freeze({
        type: "progress",
        detail: Object.freeze({
          kind: "controlled",
          jobId,
          completedSheets,
          totalSheets,
          retainedBytes,
        }),
      }),
    );
    this.#throwIfStale(abort, jobId);
  }

  #publish(state: Readonly<DocumentPrintState>): void {
    this.#state = state;
    this.#callbacks.state?.(state);
  }
  #throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException("The print operation was cancelled", "AbortError");
  }
  #throwIfStale(abort: AbortController, jobId: number): void {
    if (this.#abort !== abort || this.#state.jobId !== jobId) {
      throw new DOMException("The print operation was replaced", "AbortError");
    }
    this.#throwIfAborted(abort.signal);
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      blob =>
        blob ? resolve(blob) : reject(new Error("PdfjsViewer: print sheet encoding failed")),
      "image/png",
    ),
  );
}

const windowUrl = (win: Window): typeof URL => (win as Window & { URL: typeof URL }).URL;

function canvasMapBytes(map: ReadonlyMap<string, HTMLCanvasElement>): number {
  let bytes = 0;
  for (const canvas of new Set(map.values())) bytes += canvas.width * canvas.height * 4;
  return bytes;
}

function releaseCanvasMap(map: ReadonlyMap<string, HTMLCanvasElement>): void {
  for (const canvas of new Set(map.values())) canvas.width = canvas.height = 0;
}

async function decodeImagesBounded(
  images: readonly HTMLImageElement[],
  concurrency: number,
  signal: AbortSignal,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(images.length, concurrency) }, async () => {
    while (next < images.length) {
      if (signal.aborted) throw new DOMException("The print operation was cancelled", "AbortError");
      const image = images[next++]!;
      await abortable(image.decode(), signal);
    }
  });
  await Promise.all(workers);
}

/** Settles cancellation without abandoning a browser-owned readiness promise. */
function abortable<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new DOMException("The print operation was cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () =>
      finish(() => reject(new DOMException("The print operation was cancelled", "AbortError")));
    signal.addEventListener("abort", abort, { once: true });
    // Always attach both handlers: a stalled/rejected browser promise remains observed
    // after cancellation and cannot produce an unhandled rejection.
    Promise.resolve(promise).then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

function nextLayoutFrame(win: Window, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The print operation was cancelled", "AbortError"));
      return;
    }
    let first = 0;
    let second = 0;
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      win.cancelAnimationFrame(first);
      win.cancelAnimationFrame(second);
      reject(new DOMException("The print operation was cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    first = win.requestAnimationFrame(() => {
      second = win.requestAnimationFrame(() => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve();
      });
    });
  });
}

function assertPhysicalBounds(
  rect: DOMRect,
  expectedWidth: number,
  expectedHeight: number,
  label: string,
): void {
  if (Math.abs(rect.width - expectedWidth) > 1 || Math.abs(rect.height - expectedHeight) > 1) {
    throw new Error(
      `PdfjsViewer: print ${label} geometry is not physically exact (${rect.width}x${rect.height}, expected ${expectedWidth}x${expectedHeight})`,
    );
  }
}
