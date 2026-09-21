// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete state-and-policy owner for one document's raster lifecycle.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentRenderer` revision-caches detached topology and geometry, copies
 * dynamic view facts on ingress, plans visible output, owns
 * queue admission, bounded retries, PDF.js render tasks, and records bitmap identity only in
 * the same synchronous transition that commits pixels to an exact surface
 * lease. Temporary rendering preserves prior pixels; direct rendering marks a
 * surface destructive before mutation and clears partial output on failure.
 * Initial readiness is a stable cohort of the first visible pages; speculative
 * buffering and later viewport changes cannot move its completion target.
 * Evictable old-scale placeholders are removed before planning, while temporary
 * buffers from cancelled work gate admission rather than lowering canonical DPR.
 *
 * Document reset and surface reflow invalidate operations synchronously before
 * cancellation callbacks or layout mutation. Every callback is treated as
 * reentrant: document, operation, requirement, output, and lease identity are
 * checked again after it returns. Bitmap commit transfers the page proxy to a
 * deduplicated presentation lane, then releases raster admission immediately.
 * The renderer retains the admitted page use through presentation, while
 * `DocumentPageUsage` owns cleanup after every shared use is released.
 *
 * The owner depends only on a narrow surface registry and detached callbacks.
 * It neither imports the viewer facade nor controls CSS topology or feature UI.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative raster
 * procedure, lifecycle hierarchy, dependency direction, and facade boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-renderer
 */

import type * as PDFJS from "pdfjs-dist";
import { DocumentPageUsage, type DocumentPageUse } from "./document-page-usage.js";
import {
  createRenderPlan,
  resolveRasterDimensions,
  selectRenderBufferWindow,
  type RenderMotion,
  type RenderPlan,
} from "./render-planner.js";
import {
  RenderScheduler,
  renderOperationSatisfies,
  type MainRasterState,
  type RenderOperation,
} from "./render-scheduler.js";
import type { PdfjsViewerRenderingProfileSettings } from "./viewer-contracts.js";
import { startPdfPageRenderTask } from "./pdfjs-compatibility.js";
import type { PrimaryRasterPressure } from "./raster-work-coordinator.js";

const BYTES_PER_MIB = 1024 * 1024;
const DPR_EPSILON = 1e-6;
const PAGE_GEOMETRY_EPSILON = 1e-6;
const MAX_RASTER_ATTEMPTS = 3;

/** Immutable output dimensions and resource facts selected for one render. */
interface RenderBudget {
  readonly scale: number;
  readonly requestedDpr: number;
  readonly renderDpr: number;
  readonly dprReducedByMemoryLimit: boolean;
  readonly dprReducedByCanvasLimit: boolean;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  readonly presentationWidth: number;
  readonly presentationHeight: number;
  readonly pixelCount: number;
  readonly useDirectCanvas: boolean;
  readonly reservedBytes: number;
}

/** Exact surface registration supplied without exposing its registry owner. */
export interface RenderSurfaceLease {
  readonly pageNo: number;
  readonly canvas: HTMLCanvasElement;
  readonly wrapper: HTMLDivElement;
  readonly registrationEpoch: number;
}

/** Narrow renderer-facing page-surface registry. */
export interface RenderSurfaceRegistry {
  leaseFor(pageNo: number): Readonly<RenderSurfaceLease> | null;
  isCurrent(lease: Readonly<RenderSurfaceLease>): boolean;
}

/** Detached immutable layout and viewport facts for one reconciliation. */
export interface RenderViewSnapshot {
  readonly topologyRevision: number;
  readonly pageGeometryRevision: number;
  readonly rows: readonly (readonly number[])[];
  readonly rowBounds: readonly Readonly<{ top: number; bottom: number }>[];
  readonly viewport: Readonly<{ top: number; height: number }>;
  readonly visibleRange: Readonly<{ first: number; last: number; center: number }>;
  readonly motion: RenderMotion;
  readonly scale: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly devicePixelRatio: number;
  readonly pageBaseSizes: ReadonlyMap<number, Readonly<{ width: number; height: number }>>;
  readonly fallbackPageSize: Readonly<{ width: number; height: number }>;
}

/** Independently current post-render presentation requirements. */
export interface RenderPresentationCapabilities {
  readonly annotations: boolean;
  readonly text: boolean;
}

/** Presentation policy admitted with one renderer reconciliation. */
export interface RenderPresentationDemand {
  readonly annotations: boolean;
  readonly textPages: readonly number[];
}

/** Validated post-commit presentation context. */
export interface RenderPresentationContext {
  readonly documentId: number;
  readonly pageNo: number;
  readonly lease: Readonly<RenderSurfaceLease>;
  readonly viewport: PDFJS.PageViewport;
  readonly page: PDFJS.PDFPageProxy;
  readonly generation: number;
  readonly capabilities: Readonly<RenderPresentationCapabilities>;
  readonly isCurrent: (capability: keyof RenderPresentationCapabilities) => boolean;
  readonly rasterState: MainRasterState;
  readonly annotationCanvasMap: Map<string, HTMLCanvasElement>;
}

/** Token and exact physical drain captured by an owner admission suspension. */
interface RasterAdmissionSuspension {
  readonly token: symbol;
  readonly settlement: Promise<void>;
}

/** Detached structured diagnostic routed through the facade's logger. */
interface DocumentRendererDiagnostic {
  readonly level: "debug" | "error";
  readonly event: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Reentrant cross-owner effects. All callbacks are optional and non-fatal. */
interface DocumentRendererCallbacks {
  readonly observedPageGeometry?: (pageNo: number, width: number, height: number) => void;
  readonly present?: (context: Readonly<RenderPresentationContext>) => void | Promise<void>;
  readonly evicted?: (pageNo: number, lease: Readonly<RenderSurfaceLease>) => void;
  readonly retainPlaceholder?: (pageNo: number) => boolean;
  readonly progress?: (complete: number, total: number, done: boolean) => void;
  readonly ready?: (documentId: number) => void;
  readonly failed?: (documentId: number, error: Error) => void;
  readonly diagnostic?: (entry: Readonly<DocumentRendererDiagnostic>) => void;
  readonly primaryPressureChanged?: (pressure: PrimaryRasterPressure) => void;
}

/** Detached aggregate state for facade lifecycle diagnostics only. */
interface DocumentRendererSnapshot {
  readonly documentId: number;
  readonly ready: boolean;
  readonly queuedPageCount: number;
  readonly admittedRenderCount: number;
  readonly inFlightRenderCount: number;
  readonly renderedPageCount: number;
  readonly placeholderPageCount: number;
  readonly committedBytes: number;
  readonly placeholderBytes: number;
  readonly directMutatingBytes: number;
  readonly activeTemporaryBytes: number;
  readonly reservationBytes: number;
  readonly annotationCanvasBytes: number;
  readonly committedAnnotationCanvasBytes: number;
  readonly placeholderAnnotationCanvasBytes: number;
  readonly directMutatingAnnotationCanvasBytes: number;
  readonly activeAnnotationCanvasBytes: number;
  readonly settlingAnnotationCanvasBytes: number;
  readonly authoritativeRenderCount: number;
  readonly settlingRenderCount: number;
  readonly maxBufferViewportHeights: number | "unlimited";
  readonly maxBufferPages: number | "unlimited";
}

type OutputState = "committed" | "placeholder" | "direct-mutating";

interface RenderOutput {
  readonly documentId: number;
  readonly pageNo: number;
  readonly lease: Readonly<RenderSurfaceLease>;
  readonly state: OutputState;
  readonly budget: Readonly<RenderBudget>;
  readonly viewport: PDFJS.PageViewport;
  readonly viewerRotation: 0 | 90 | 180 | 270;
  readonly operation: RenderOperation | null;
  readonly rasterState: MainRasterState;
  readonly annotationCanvasMap: Map<string, HTMLCanvasElement>;
}

interface OperationContext {
  readonly documentId: number;
  readonly lease: Readonly<RenderSurfaceLease>;
  readonly rasterState: MainRasterState;
}

interface PresentationRequest {
  readonly documentId: number;
  readonly pdf: PDFJS.PDFDocumentProxy;
  readonly pageNo: number;
  readonly lease: Readonly<RenderSurfaceLease>;
  readonly scale: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly output: RenderOutput | null;
  readonly generation: number;
  readonly revision: number;
  readonly textRevision: number;
  readonly capabilities: Readonly<RenderPresentationCapabilities>;
}

interface PresentationLane {
  active: PresentationRequest | null;
  pending: PresentationRequest | null;
  use: DocumentPageUse | null;
  useDocumentId: number | null;
  revision: number;
  readonly settlement: Promise<void>;
  readonly resolve: () => void;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function safely(action: (() => void) | null | undefined): void {
  if (!action) return;
  try {
    action();
  } catch {
    /* Cross-owner cleanup is best effort. */
  }
}

/** Starts independent presentation owners before joining their settlements. */
export async function settleIndependentPresentations(
  annotation: () => void | Promise<void>,
  text: () => void | Promise<void>,
): Promise<void> {
  await Promise.allSettled([Promise.resolve().then(annotation), Promise.resolve().then(text)]);
}

/** Owns planning, execution, output identity, invalidation, and settlement. */
export class DocumentRenderer {
  #surfaces: RenderSurfaceRegistry;
  #callbacks: DocumentRendererCallbacks;
  #scheduler: RenderScheduler;
  #settings: PdfjsViewerRenderingProfileSettings;
  #profile: string;
  #pdf: PDFJS.PDFDocumentProxy | null = null;
  #pages: DocumentPageUsage | null = null;
  #ownsPages = false;
  #documentId = 0;
  #renderingActive = true;
  #rasterState: MainRasterState = Object.freeze({ optionalContentRevision: 0, annotationMode: 1 });
  #admissionSuspensions = new Set<symbol>();
  #backgroundRasterWaiting = false;
  #view: RenderViewSnapshot | null = null;
  #outputs = new Map<number, RenderOutput>();
  #operationContexts = new WeakMap<RenderOperation, OperationContext>();
  #activeAnnotationCanvasMaps = new Map<RenderOperation, Map<string, HTMLCanvasElement>>();
  #annotationCanvasOwners = new Map<object, Set<HTMLCanvasElement>>();
  #annotationCanvasRefCounts = new Map<HTMLCanvasElement, number>();
  #presentationLanes = new Map<number, PresentationLane>();
  #nextPresentationGeneration = 0;
  #presentationDemand = new Set<number>();
  #presentationTextRevisions = new Map<number, number>();
  #presentationAnnotations = false;
  #renderSettlements = new Set<Promise<void>>();
  #initialReady = false;
  #initialReadinessPages: ReadonlySet<number> | null = null;
  #initialReadinessCompleted = new Set<number>();
  #rasterFailureAttempts = new Map<string, number>();
  #terminalRasterRequirements = new Set<string>();
  #reflowing = false;
  #preserveReflowOutput = false;
  #placeholderTimer: number | null = null;
  #diagnosticTimer: number | null = null;
  #lastDiagnosticAt = 0;
  #omittedDiagnostics = 0;
  #lastPlanSignature = "";
  #geometryRevision = 0;
  #primaryPressure: PrimaryRasterPressure = "idle";
  #reconciling = false;
  #cachedTopologyRevision: number | null = null;
  #cachedGeometryRevision: number | null = null;
  #cachedGeometryRotation: RenderViewSnapshot["rotation"] | null = null;
  #cachedRows: readonly (readonly number[])[] = [];
  #cachedRowBoundsSource: RenderViewSnapshot["rowBounds"] | null = null;
  #cachedRowBounds: RenderViewSnapshot["rowBounds"] = Object.freeze([]);
  #cachedRowBoundsRevision = 0;
  #cachedPageRows = new Map<number, number>();
  #cachedPageBaseSizes = new Map<number, Readonly<{ width: number; height: number }>>();
  #cachedFallbackPageSize: Readonly<{ width: number; height: number }> = Object.freeze({
    width: 0,
    height: 0,
  });
  #ownerWindow: Window | null;

  constructor(
    surfaces: RenderSurfaceRegistry,
    profile: string,
    settings: PdfjsViewerRenderingProfileSettings,
    callbacks: DocumentRendererCallbacks = {},
    ownerWindow: Window | null = null,
  ) {
    this.#surfaces = surfaces;
    this.#profile = profile;
    this.#settings = settings;
    this.#callbacks = callbacks;
    this.#ownerWindow = ownerWindow;
    this.#scheduler = new RenderScheduler(settings.maxConcurrentRenders);
  }

  /** Supplies the immutable viewer window before a document is attached. */
  public setOwnerWindow(ownerWindow: Window): void {
    if (this.#pdf)
      throw new Error("DocumentRenderer: owner window cannot change while a document is attached");
    this.#ownerWindow = ownerWindow;
  }

  /** Starts a fresh renderer document lifetime, even when the proxy is reused. */
  beginDocument(pdf: PDFJS.PDFDocumentProxy, pages?: DocumentPageUsage): number {
    this.resetDocument();
    this.#pdf = pdf;
    this.#pages = pages ?? new DocumentPageUsage(pdf);
    this.#ownsPages = pages == null;
    this.#documentId++;
    this.#initialReady = false;
    this.#initialReadinessPages = null;
    this.#initialReadinessCompleted.clear();
    this.#rasterFailureAttempts.clear();
    this.#terminalRasterRequirements.clear();
    this.#publishPrimaryPressure();
    return this.#documentId;
  }

  /** Atomically installs semantic display-raster state and invalidates non-equivalent work. */
  setRasterState(state: Readonly<MainRasterState>, force = false): boolean {
    if (
      !Number.isSafeInteger(state.optionalContentRevision) ||
      state.optionalContentRevision < 0 ||
      !Number.isSafeInteger(state.annotationMode) ||
      state.annotationMode < 0
    ) {
      throw new TypeError("Invalid main raster state");
    }
    if (
      !force &&
      state.optionalContentRevision === this.#rasterState.optionalContentRevision &&
      state.annotationMode === this.#rasterState.annotationMode
    )
      return false;
    this.#rasterState = Object.freeze({
      optionalContentRevision: state.optionalContentRevision,
      annotationMode: state.annotationMode,
      ...(state.optionalContentConfigPromise
        ? { optionalContentConfigPromise: state.optionalContentConfigPromise }
        : {}),
    });
    this.#cancelOperations();
    this.#rasterFailureAttempts.clear();
    this.#terminalRasterRequirements.clear();
    for (const [pageNo, output] of this.#outputs) {
      if (output.state === "committed") {
        this.#replaceOutputRecord(
          pageNo,
          output,
          Object.freeze({ ...output, state: "placeholder" }),
        );
      }
    }
    this.#lastPlanSignature = "";
    if (this.#view && !this.#admissionSuspensions.size) this.#reconcileCurrent(true);
    return true;
  }

  /** Revokes current work and blocks admission until the exact token is resumed. */
  suspendAdmission(): Readonly<RasterAdmissionSuspension> {
    const token = Symbol("document-renderer-admission");
    this.#admissionSuspensions.add(token);
    this.#cancelOperations();
    this.#scheduler.clearQueue();
    const captured = [...this.#renderSettlements];
    return Object.freeze({
      token,
      settlement: Promise.allSettled(captured).then(() => undefined),
    });
  }

  /** Resumes only the suspension identified by the supplied owner token. */
  resumeAdmission(token: symbol): void {
    if (!this.#admissionSuspensions.delete(token) || this.#admissionSuspensions.size) return;
    this.#lastPlanSignature = "";
    if (this.#view) this.#reconcileCurrent(true);
  }

  /** Releases every settled main raster, including visible output and annotation backing stores. */
  evictOutputsForExclusiveWork(): Readonly<{ count: number; bytes: number }> {
    if (!this.#admissionSuspensions.size) return Object.freeze({ count: 0, bytes: 0 });
    const annotationBytes = this.#annotationMemory().outputBytes;
    let count = 0;
    let bytes = 0;
    for (const output of [...this.#outputs.values()]) {
      // Exclusive acquisition waits for direct mutation settlement. Do not clear an
      // unexpected owner; the caller verifies the residual invariant and fails safely.
      if (output.state === "direct-mutating") continue;
      bytes +=
        output.lease.canvas.width * output.lease.canvas.height * 4 +
        (annotationBytes.get(output) ?? 0);
      this.#evictOutput(output);
      count++;
    }
    // Drained operations and obsolete presentation owners cannot safely retain an
    // annotation backing store. An active presentation remains accounted as residual.
    const protectedOwners = new Set<object>([
      ...this.#activeAnnotationCanvasMaps.keys(),
      ...[...this.#presentationLanes.values()].flatMap(lane => (lane.active ? [lane.active] : [])),
    ]);
    for (const owner of [...this.#annotationCanvasOwners.keys()]) {
      if (
        !protectedOwners.has(owner) &&
        ![...this.#outputs.values()].includes(owner as RenderOutput)
      ) {
        this.#releaseAnnotationOwner(owner);
      }
    }
    if (count) this.#lastPlanSignature = "";
    return Object.freeze({ count, bytes });
  }

  /** All main raster still owned after exclusive draining and eviction. */
  rasterBytesForExclusiveWork(): number {
    let bytes = 0;
    for (const output of this.#outputs.values()) {
      bytes += output.lease.canvas.width * output.lease.canvas.height * 4;
    }
    const annotationCanvases = new Set<HTMLCanvasElement>();
    for (const canvases of this.#annotationCanvasOwners.values())
      for (const canvas of canvases) annotationCanvases.add(canvas);
    bytes += this.#annotationBytes(annotationCanvases);
    return bytes;
  }

  /**
   * Invalidates all ownership synchronously and returns detached task promises
   * that callers may await before cleaning the old document proxy.
   */
  resetDocument(): readonly Promise<unknown>[] {
    const settlements = [
      ...this.#renderSettlements,
      ...[...this.#presentationLanes.values()].map(lane => lane.settlement),
    ];
    this.#documentId++;
    this.#pdf = null;
    const pages = this.#pages;
    const ownsPages = this.#ownsPages;
    this.#pages = null;
    this.#ownsPages = false;
    if (pages && ownsPages) void pages.close();
    this.#view = null;
    this.#cachedTopologyRevision = null;
    this.#cachedGeometryRevision = null;
    this.#cachedGeometryRotation = null;
    this.#cachedRows = [];
    this.#cachedRowBoundsSource = null;
    this.#cachedRowBounds = Object.freeze([]);
    this.#cachedRowBoundsRevision = 0;
    this.#cachedPageRows.clear();
    this.#cachedPageBaseSizes.clear();
    this.#cachedFallbackPageSize = Object.freeze({ width: 0, height: 0 });
    this.#lastPlanSignature = "";
    this.#reflowing = false;
    this.#initialReady = false;
    this.#initialReadinessPages = null;
    this.#initialReadinessCompleted.clear();
    this.#rasterFailureAttempts.clear();
    this.#terminalRasterRequirements.clear();
    this.#clearPlaceholderTimer();
    this.#resetDiagnosticThrottle();
    this.#scheduler.reset(task => safely(() => task.cancel()));
    for (const [operation, map] of this.#activeAnnotationCanvasMaps) {
      this.#retainAnnotationOwner(operation, map);
    }
    this.#presentationDemand.clear();
    this.#presentationTextRevisions.clear();
    this.#presentationAnnotations = false;
    for (const [pageNo, lane] of this.#presentationLanes) {
      lane.revision++;
      lane.pending = null;
      if (!lane.active) {
        lane.use?.release();
        lane.use = null;
        this.#presentationLanes.delete(pageNo);
        lane.resolve();
      }
    }
    for (const output of this.#outputs.values()) this.#clearOutput(output, true);
    this.#outputs.clear();
    this.#publishPrimaryPressure();
    return settlements;
  }

  /** Applies concrete raster policy and reconciles current output. */
  setProfile(profile: string, settings: PdfjsViewerRenderingProfileSettings): void {
    this.#profile = profile;
    this.#settings = settings;
    this.#lastPlanSignature = "";
    this.#clearPlaceholderTimer();
    this.#cancelOperations();
    for (const output of [...this.#outputs.values()]) {
      if (output.state === "placeholder") this.#evictOutput(output);
    }
    if (this.#view) this.#reconcileCurrent(true);
  }

  /** Applies effective rendering-activity retention and buffering policy. */
  setRenderingActive(active: boolean): void {
    if (this.#renderingActive === active) return;
    this.#renderingActive = active;
    this.#lastPlanSignature = "";
    if (this.#view) this.#reconcileCurrent(true);
  }

  /** Suspends speculative buffering while a lower-priority raster owner is waiting. */
  setBackgroundRasterWaiting(waiting: boolean): void {
    if (this.#backgroundRasterWaiting === waiting) return;
    this.#backgroundRasterWaiting = waiting;
    this.#lastPlanSignature = "";
    if (this.#view) this.#reconcileCurrent(true);
  }

  /** Invalidates the current result requirement, optionally retaining placeholders. */
  invalidateView(options: Readonly<{ retainPlaceholders: boolean; graceMs: number }>): void {
    this.#cancelOperations();
    this.#lastPlanSignature = "";
    this.#clearPlaceholderTimer();
    for (const [pageNo, output] of [...this.#outputs]) {
      if (options.retainPlaceholders && output.state === "committed") {
        this.#replaceOutputRecord(
          pageNo,
          output,
          Object.freeze({ ...output, state: "placeholder" }),
        );
      } else {
        this.#evictOutput(output);
      }
    }
    if (options.retainPlaceholders && options.graceMs > 0) {
      const documentId = this.#documentId;
      const ownerWindow = this.#timerWindow();
      if (!ownerWindow) return;
      this.#placeholderTimer = ownerWindow.setTimeout(() => {
        this.#placeholderTimer = null;
        if (documentId !== this.#documentId) return;
        for (const output of [...this.#outputs.values()]) {
          if (output.state !== "placeholder") continue;
          const required = this.#scheduler.currentRequirementFor(output.pageNo) != null;
          if (!required || !this.#callbacks.retainPlaceholder?.(output.pageNo)) {
            this.#evictOutput(output);
          }
        }
        this.#lastPlanSignature = "";
        this.#reconcileCurrent(true);
      }, options.graceMs);
    }
  }

  /** Invalidates operation leases before any same-document topology mutation. */
  beginSurfaceReflow(options: Readonly<{ preserveCommittedOutput: boolean }>): void {
    this.#cancelOperations();
    this.#reflowing = true;
    this.#preserveReflowOutput = options.preserveCommittedOutput;
    this.#lastPlanSignature = "";
    if (!options.preserveCommittedOutput) {
      for (const output of [...this.#outputs.values()]) this.#evictOutput(output);
    }
  }

  /** Rebinds exact preserved bitmaps after surfaces are registered, then reconciles. */
  endSurfaceReflow(view: Readonly<RenderViewSnapshot>): void {
    if (this.#preserveReflowOutput) {
      for (const [pageNo, output] of [...this.#outputs]) {
        const lease = this.#surfaces.leaseFor(pageNo);
        const exactBitmap =
          lease &&
          lease.canvas === output.lease.canvas &&
          lease.wrapper === output.lease.wrapper &&
          lease.canvas.width === output.budget.bufferWidth &&
          lease.canvas.height === output.budget.bufferHeight &&
          this.#surfaces.isCurrent(lease);
        if (exactBitmap && output.state !== "direct-mutating") {
          this.#replaceOutputRecord(pageNo, output, Object.freeze({ ...output, lease }));
        } else {
          this.#evictOutput(output);
        }
      }
    }
    this.#reflowing = false;
    this.#preserveReflowOutput = false;
    this.reconcile(view);
  }

  /** Copies view facts and reconciles the active document's semantic plan. */
  reconcile(
    view: Readonly<RenderViewSnapshot>,
    presentationDemand?: Readonly<RenderPresentationDemand>,
  ): void {
    if (presentationDemand) {
      const nextDemand = new Set(
        presentationDemand.textPages.filter(pageNo => Number.isInteger(pageNo) && pageNo > 0),
      );
      for (const pageNo of new Set([...this.#presentationDemand, ...nextDemand])) {
        if (this.#presentationDemand.has(pageNo) !== nextDemand.has(pageNo)) {
          this.#presentationTextRevisions.set(
            pageNo,
            (this.#presentationTextRevisions.get(pageNo) ?? 0) + 1,
          );
        }
      }
      this.#presentationDemand = nextDemand;
      this.#presentationAnnotations = presentationDemand.annotations;
      for (const [pageNo, lane] of this.#presentationLanes) {
        if (lane.pending?.capabilities.text && !this.#presentationDemand.has(pageNo)) {
          lane.pending = this.#withoutPresentationCapability(lane.pending, "text");
        }
      }
      for (const pageNo of this.#presentationTextRevisions.keys()) {
        if (!this.#presentationDemand.has(pageNo) && !this.#presentationLanes.has(pageNo)) {
          this.#presentationTextRevisions.delete(pageNo);
        }
      }
    }
    this.#view = this.#detachView(view);
    this.#reconcileCurrent(false);
    this.#enqueueDemandedPresentations();
  }

  /** Detached diagnostics only; no output records or mutable collections escape. */
  snapshot(): Readonly<DocumentRendererSnapshot> {
    const scheduler = this.#scheduler.snapshot();
    const annotationMemory = this.#annotationMemory();
    let committedBytes = 0;
    let placeholderBytes = 0;
    let directMutatingBytes = 0;
    let committedAnnotationCanvasBytes = 0;
    let placeholderAnnotationCanvasBytes = 0;
    let directMutatingAnnotationCanvasBytes = 0;
    let renderedPageCount = 0;
    let placeholderPageCount = 0;
    for (const output of this.#outputs.values()) {
      const annotationBytes = annotationMemory.outputBytes.get(output) ?? 0;
      const bytes = output.budget.pixelCount * 4 + annotationBytes;
      if (output.state === "committed") {
        committedBytes += bytes;
        committedAnnotationCanvasBytes += annotationBytes;
        renderedPageCount++;
      } else if (output.state === "placeholder") {
        placeholderBytes += bytes;
        placeholderAnnotationCanvasBytes += annotationBytes;
        placeholderPageCount++;
      } else {
        directMutatingBytes += bytes;
        directMutatingAnnotationCanvasBytes += annotationBytes;
      }
    }
    const activeAnnotationCanvasBytes = annotationMemory.activeBytes;
    const settlingAnnotationCanvasBytes = annotationMemory.settlingBytes;
    const annotationCanvasBytes =
      committedAnnotationCanvasBytes +
      placeholderAnnotationCanvasBytes +
      directMutatingAnnotationCanvasBytes +
      activeAnnotationCanvasBytes +
      settlingAnnotationCanvasBytes;
    return Object.freeze({
      documentId: this.#documentId,
      ready: this.#initialReady,
      queuedPageCount: scheduler.queuedPageCount,
      admittedRenderCount: scheduler.admittedRenderCount,
      inFlightRenderCount: scheduler.inFlightRenderCount,
      renderedPageCount,
      placeholderPageCount,
      committedBytes,
      placeholderBytes,
      directMutatingBytes,
      activeTemporaryBytes:
        scheduler.activeOffscreenPixels * 4 +
        activeAnnotationCanvasBytes +
        settlingAnnotationCanvasBytes,
      reservationBytes: scheduler.reservedBytes,
      annotationCanvasBytes,
      committedAnnotationCanvasBytes,
      placeholderAnnotationCanvasBytes,
      directMutatingAnnotationCanvasBytes,
      activeAnnotationCanvasBytes,
      settlingAnnotationCanvasBytes,
      authoritativeRenderCount: scheduler.authoritativeRenderCount,
      settlingRenderCount: scheduler.settlingRenderCount,
      maxBufferViewportHeights: this.#currentBufferViewportHeights(),
      maxBufferPages: this.#currentBufferPages(),
    });
  }

  get ready(): boolean {
    return this.#initialReady;
  }

  #detachView(view: Readonly<RenderViewSnapshot>): RenderViewSnapshot {
    if (this.#cachedTopologyRevision !== view.topologyRevision) {
      this.#cachedRows = Object.freeze(view.rows.map(row => Object.freeze([...row])));
      this.#cachedPageRows = new Map();
      for (let rowIndex = 0; rowIndex < this.#cachedRows.length; rowIndex++) {
        for (const pageNo of this.#cachedRows[rowIndex]) this.#cachedPageRows.set(pageNo, rowIndex);
      }
      this.#cachedTopologyRevision = view.topologyRevision;
    }
    if (this.#cachedRowBoundsSource !== view.rowBounds) {
      this.#cachedRowBoundsSource = view.rowBounds;
      this.#cachedRowBoundsRevision++;
      this.#cachedRowBounds = Object.freeze(
        view.rowBounds.map(bounds =>
          Object.freeze({
            top: bounds.top,
            bottom: bounds.bottom,
          }),
        ),
      );
    }
    if (
      this.#cachedGeometryRevision !== view.pageGeometryRevision ||
      this.#cachedGeometryRotation !== view.rotation
    ) {
      const pageBaseSizes = new Map<number, Readonly<{ width: number; height: number }>>();
      for (const [page, size] of view.pageBaseSizes) {
        if (
          Number.isInteger(page) &&
          page > 0 &&
          finitePositive(size.width) &&
          finitePositive(size.height)
        ) {
          pageBaseSizes.set(page, Object.freeze({ width: size.width, height: size.height }));
        }
      }
      this.#cachedPageBaseSizes = pageBaseSizes;
      this.#cachedFallbackPageSize = Object.freeze({
        width: view.fallbackPageSize.width,
        height: view.fallbackPageSize.height,
      });
      this.#cachedGeometryRevision = view.pageGeometryRevision;
      this.#cachedGeometryRotation = view.rotation;
    }
    return Object.freeze({
      topologyRevision: view.topologyRevision,
      pageGeometryRevision: view.pageGeometryRevision,
      rows: this.#cachedRows,
      rowBounds: this.#cachedRowBounds,
      viewport: Object.freeze({ top: view.viewport.top, height: view.viewport.height }),
      visibleRange: Object.freeze({
        first: view.visibleRange.first,
        last: view.visibleRange.last,
        center: view.visibleRange.center,
      }),
      motion: view.motion === "forward" || view.motion === "backward" ? view.motion : "stationary",
      scale: view.scale,
      rotation: view.rotation,
      devicePixelRatio: Math.max(1, view.devicePixelRatio || 1),
      pageBaseSizes: this.#cachedPageBaseSizes,
      fallbackPageSize: this.#cachedFallbackPageSize,
    });
  }

  #currentBufferViewportHeights(): number | "unlimited" {
    if (this.#backgroundRasterWaiting) return 0;
    const active = this.#settings.maxBufferViewportHeights;
    if (this.#renderingActive) return active;
    return active === "unlimited"
      ? this.#settings.bufferViewportHeightsWhenInactive
      : Math.min(active, this.#settings.bufferViewportHeightsWhenInactive);
  }

  /** Returns the optional-page ceiling effective under current speculation policy. */
  #currentBufferPages(): number | "unlimited" {
    if (this.#currentBufferViewportHeights() === 0) return 0;
    return this.#settings.maxBufferPages;
  }

  /** Bounds directional candidate scans without hiding initial readiness rows. */
  #maxCandidateRowsPerSide(): number | "unlimited" {
    const pageLimit = this.#currentBufferPages();
    if (pageLimit === "unlimited") return "unlimited";
    return Math.max(
      1,
      Math.min(Number.MAX_SAFE_INTEGER, pageLimit + (this.#initialReadinessPages?.size ?? 0)),
    );
  }

  #reconcileCurrent(force: boolean): void {
    const pdf = this.#pdf;
    const view = this.#view;
    if (!pdf || !view || this.#reflowing || this.#reconciling || !view.rows.length) return;
    const signature = this.#viewSignature(view);
    if (!force && signature === this.#lastPlanSignature) return;
    this.#lastPlanSignature = signature;
    this.#reconciling = true;
    try {
      this.#evictUnneededPlaceholders(view);
      const plan = this.#createPlan(view);
      if (!this.#initialReadinessPages) {
        this.#initialReadinessPages = Object.freeze(new Set(plan.visiblePages));
      }
      this.#scheduler.applyPlan(plan, view.visibleRange, view.scale, this.#rasterState);
      this.#scheduler.cancelUndesired(task => safely(() => task.cancel()));
      this.#scheduler.cancelIncompatible(
        operation => this.#operationSatisfiesCurrent(operation),
        task => safely(() => task.cancel()),
      );
      this.#scheduler.rebuildQueue(
        view.visibleRange.center,
        view.motion,
        pageNo => this.#pageSatisfiesPlan(pageNo) || this.#pageHasTerminalFailure(pageNo),
        pageNo => this.#rowIndexFor(pageNo),
      );
      const preempted = this.#scheduler.preemptForVisible(
        pageNo => this.#rowIndexFor(pageNo),
        view.visibleRange.center,
        view.motion,
        task => safely(() => task.cancel()),
      );
      const visiblePages = new Set<number>();
      for (let row = view.visibleRange.first; row <= view.visibleRange.last; row++) {
        for (const pageNo of view.rows[row] ?? []) visiblePages.add(pageNo);
      }
      for (const operation of preempted) {
        this.#diagnostic(
          "debug",
          "page-render-preempted",
          `Preempted offscreen page ${operation.pageNo} for visible work`,
          {
            preemptedOperationId: operation.id,
            preemptedPageNo: operation.pageNo,
            preemptedRowIndex: this.#rowIndexFor(operation.pageNo) ?? null,
            visibleRowRange: view.visibleRange,
            visiblePages: [...visiblePages],
            renderMotion: view.motion,
          },
        );
      }
      this.#publishProgress();
      const desired = new Set(plan.desiredPages);
      for (const output of [...this.#outputs.values()].sort(
        (a, b) =>
          Math.abs((this.#rowIndexFor(b.pageNo) ?? 0) - view.visibleRange.center) -
          Math.abs((this.#rowIndexFor(a.pageNo) ?? 0) - view.visibleRange.center),
      )) {
        if (output.state === "placeholder") continue;
        if (!desired.has(output.pageNo) && !plan.retainedPages.has(output.pageNo))
          this.#evictOutput(output);
      }
      this.#pump();
    } finally {
      this.#reconciling = false;
    }
  }

  #viewSignature(view: RenderViewSnapshot): string {
    const maxBuffer = this.#currentBufferViewportHeights();
    const bufferIdentity =
      maxBuffer === "unlimited"
        ? [
            view.visibleRange.first,
            view.visibleRange.first > 0 ? 0 : -1,
            view.rows.length - view.visibleRange.last - 1,
            view.visibleRange.last + 1 < view.rows.length ? view.rows.length - 1 : -1,
          ]
        : (() => {
            const window = selectRenderBufferWindow({
              rowBounds: view.rowBounds,
              visibleRange: view.visibleRange,
              viewport: view.viewport,
              maxBufferViewportHeights: maxBuffer,
              maxCandidateRowsPerSide: this.#maxCandidateRowsPerSide(),
              motion: view.motion,
            });
            return [
              window.before.length,
              window.before.at(-1) ?? -1,
              window.after.length,
              window.after.at(-1) ?? -1,
            ];
          })();
    return [
      view.visibleRange.first,
      view.visibleRange.last,
      view.motion,
      view.scale,
      view.rotation,
      view.viewport.height,
      ...bufferIdentity,
      this.#currentBufferPages(),
      this.#cachedRowBoundsRevision,
      Math.min(view.devicePixelRatio, this.#settings.maxRenderDpr),
      this.#profile,
      this.#renderingActive ? 1 : 0,
      this.#geometryRevision,
      view.topologyRevision,
      view.pageGeometryRevision,
      this.#rasterState.optionalContentRevision,
      this.#rasterState.annotationMode,
    ].join("|");
  }

  #createPlan(view: RenderViewSnapshot): RenderPlan {
    const annotationMemory = this.#annotationMemory();
    const requestedDpr = Math.min(view.devicePixelRatio, this.#settings.maxRenderDpr);
    const retainedCandidates: Array<{ page: number; rowIndex: number; bytes: number }> = [];
    const committedPageRenderDprs = new Map<number, number>();
    const committedPageBytes = new Map<number, number>();
    const pageAdditionalBytes = new Map<number, number>();
    const fixedReplacementPageBytes = new Map<number, number>();
    let fixedOccupiedBytes = 0;
    for (const output of this.#outputs.values()) {
      const annotationBytes = annotationMemory.outputBytes.get(output) ?? 0;
      const bytes = output.budget.pixelCount * 4 + annotationBytes;
      if (annotationBytes > 0) pageAdditionalBytes.set(output.pageNo, annotationBytes);
      if (output.state === "placeholder" || output.state === "direct-mutating") {
        fixedOccupiedBytes += bytes;
        if (output.state === "placeholder") fixedReplacementPageBytes.set(output.pageNo, bytes);
        continue;
      }
      if (!this.#outputIsCurrent(output) || output.budget.scale !== view.scale) continue;
      committedPageRenderDprs.set(output.pageNo, output.budget.renderDpr);
      committedPageBytes.set(output.pageNo, bytes);
      retainedCandidates.push({
        page: output.pageNo,
        rowIndex: this.#rowIndexFor(output.pageNo) ?? Number.POSITIVE_INFINITY,
        bytes,
      });
    }
    return createRenderPlan({
      rows: view.rows,
      rowBounds: view.rowBounds,
      viewport: view.viewport,
      visibleRange: view.visibleRange,
      maxBufferViewportHeights: this.#currentBufferViewportHeights(),
      maxBufferPages: this.#currentBufferPages(),
      motion: view.motion,
      requestedDpr,
      currentScale: view.scale,
      pageBaseSizes: view.pageBaseSizes,
      fallbackPageSize: view.fallbackPageSize,
      settings: this.#settings,
      retainCommittedPages: this.#renderingActive,
      retainedCandidates,
      committedPageRenderDprs,
      committedPageBytes,
      pageAdditionalBytes,
      fixedReplacementPageBytes,
      requiredPages: this.#initialReady ? undefined : (this.#initialReadinessPages ?? undefined),
      fixedOccupiedBytes,
    });
  }

  #pump(): void {
    while (true) {
      const view = this.#view;
      const pdf = this.#pdf;
      if (!view || !pdf || this.#reflowing || this.#admissionSuspensions.size) return;
      const scheduler = this.#scheduler.snapshot();
      const plan = this.#scheduler.planSnapshot();
      const settlingBytes =
        scheduler.settlingOffscreenPixels * 4 + this.#annotationMemory().settlingBytes;
      const memoryLimitBytes = this.#settings.memoryLimitMiB * BYTES_PER_MIB;
      if (settlingBytes > 0 && plan && plan.estimatedPeakBytes + settlingBytes > memoryLimitBytes) {
        return;
      }
      let capturedLease: Readonly<RenderSurfaceLease> | null = null;
      const operation = this.#scheduler.admitNext(({ pageNo, renderDpr, requiresDirectCanvas }) => {
        if (this.#pageSatisfiesPlan(pageNo) || this.#pageHasTerminalFailure(pageNo)) return null;
        const lease = this.#surfaces.leaseFor(pageNo);
        if (!lease || !this.#surfaces.isCurrent(lease)) return null;
        capturedLease = lease;
        const direct = requiresDirectCanvas;
        return {
          pdf,
          documentGeneration: this.#documentId,
          requestedDpr: Math.min(view.devicePixelRatio, this.#settings.maxRenderDpr),
          useDirectCanvas: direct,
          maxCanvasPixels: this.#settings.maxCanvasPixels,
          maxCanvasDimension: this.#settings.maxCanvasDimension,
          reservedBytes: this.#rasterBytes(pageNo, renderDpr, view) * (direct ? 1 : 2),
          surfaceIdentity: lease.canvas,
          rasterState: this.#rasterState,
        };
      });
      if (!operation) return;
      if (!capturedLease) {
        this.#scheduler.settleOperation(operation);
        continue;
      }
      this.#operationContexts.set(
        operation,
        Object.freeze({
          documentId: this.#documentId,
          lease: capturedLease,
          rasterState: operation.requirement.rasterState,
        }),
      );
      const settlement = this.#render(operation).finally(() => {
        this.#renderSettlements.delete(settlement);
      });
      this.#renderSettlements.add(settlement);
    }
  }

  async #render(operation: RenderOperation): Promise<void> {
    const context = this.#operationContexts.get(operation);
    if (!context || !this.#operationIsCurrent(operation, context)) {
      this.#scheduler.settleOperation(operation);
      return;
    }
    const previous = this.#outputs.get(operation.pageNo);
    const replacesBitmap = previous != null && previous.state !== "direct-mutating";
    let pageUse: DocumentPageUse | null = null;
    let temporary: HTMLCanvasElement | null = null;
    let directMutating = false;
    let presentationOutput: RenderOutput | null = null;
    const annotationCanvasMap = new Map<string, HTMLCanvasElement>();
    this.#activeAnnotationCanvasMaps.set(operation, annotationCanvasMap);
    let committed = false;
    let failure: unknown = null;
    try {
      const pages = this.#pages;
      if (!pages) throw new Error("Renderer page usage is unavailable");
      pageUse = await pages.acquire(operation.pageNo);
      const page = pageUse.page;
      if (!this.#operationIsCurrent(operation, context)) return;
      const viewerRotation = this.#view?.rotation ?? 0;
      const viewport = page.getViewport({
        scale: operation.requirement.scale,
        rotation: (page.rotate + viewerRotation) % 360,
      });
      if (!finitePositive(viewport.width) || !finitePositive(viewport.height)) {
        throw new Error("PDF.js returned invalid viewport geometry");
      }
      this.#recordGeometry(operation.pageNo, viewport, operation.requirement.scale, viewerRotation);
      if (!this.#operationIsCurrent(operation, context)) return;
      const budget = this.#budget(operation, viewport);
      if (
        !this.#operationIsCurrent(operation, context, budget.renderDpr) ||
        !this.#scheduler.updateReservation(operation, budget.reservedBytes)
      )
        return;
      this.#diagnostic("debug", "page-render-started", `Rendering page ${operation.pageNo}`, {
        operationId: operation.id,
        pageNo: operation.pageNo,
        visible: this.#view ? this.#pageIsVisible(operation.pageNo, this.#view) : false,
        replacesExistingBitmap: replacesBitmap,
        previousOutputState: previous?.state ?? null,
        commitStrategy: budget.useDirectCanvas ? "attached-canvas" : "temporary-canvas",
        scale: budget.scale,
        requestedDpr: budget.requestedDpr,
        renderDpr: budget.renderDpr,
        cssWidth: budget.cssWidth,
        cssHeight: budget.cssHeight,
        bufferWidth: budget.bufferWidth,
        bufferHeight: budget.bufferHeight,
        presentationWidth: budget.presentationWidth,
        presentationHeight: budget.presentationHeight,
      });
      if (!this.#operationIsCurrent(operation, context, budget.renderDpr)) return;

      if (budget.useDirectCanvas) {
        directMutating = true;
        const output = Object.freeze({
          documentId: context.documentId,
          pageNo: operation.pageNo,
          lease: context.lease,
          state: "direct-mutating",
          budget: Object.freeze({ ...budget }),
          viewport,
          viewerRotation,
          operation,
          rasterState: operation.requirement.rasterState,
          annotationCanvasMap,
        });
        this.#retainAnnotationOwner(output, annotationCanvasMap);
        this.#outputs.set(operation.pageNo, output);
        this.#applyOutputPresentation(output);
        if (previous && previous !== output) this.#releaseAnnotationOwner(previous);
        const canvas = context.lease.canvas;
        canvas.width = budget.bufferWidth;
        canvas.height = budget.bufferHeight;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("Attached canvas 2D context is unavailable");
        drawing.setTransform(budget.renderDpr, 0, 0, budget.renderDpr, 0, 0);
        drawing.imageSmoothingEnabled = true;
        const render = startPdfPageRenderTask(page, {
          canvas,
          canvasContext: drawing,
          viewport,
          intent: "display",
          annotationMode: operation.requirement.rasterState.annotationMode,
          annotationCanvasMap,
          ...(operation.requirement.rasterState.optionalContentConfigPromise
            ? {
                optionalContentConfigPromise:
                  operation.requirement.rasterState.optionalContentConfigPromise,
              }
            : {}),
        });
        const task = render.task;
        if (!this.#scheduler.attachTask(operation, task)) {
          safely(() => task.cancel());
          return;
        }
        await render.promise;
        if (!this.#admitRenderedAnnotationCanvases(operation, budget, annotationCanvasMap)) return;
        if (!this.#operationIsCurrent(operation, context, budget.renderDpr)) return;
        this.#commitOutput(
          operation,
          context,
          budget,
          viewport,
          viewerRotation,
          annotationCanvasMap,
        );
        committed = true;
        directMutating = false;
      } else {
        temporary = context.lease.canvas.ownerDocument.createElement("canvas");
        temporary.width = budget.bufferWidth;
        temporary.height = budget.bufferHeight;
        if (!this.#scheduler.recordOffscreenAllocation(operation, budget.pixelCount)) return;
        const drawing = temporary.getContext("2d");
        if (!drawing) throw new Error("Temporary canvas 2D context is unavailable");
        drawing.setTransform(budget.renderDpr, 0, 0, budget.renderDpr, 0, 0);
        drawing.imageSmoothingEnabled = true;
        const render = startPdfPageRenderTask(page, {
          canvas: temporary,
          canvasContext: drawing,
          viewport,
          intent: "display",
          annotationMode: operation.requirement.rasterState.annotationMode,
          annotationCanvasMap,
          ...(operation.requirement.rasterState.optionalContentConfigPromise
            ? {
                optionalContentConfigPromise:
                  operation.requirement.rasterState.optionalContentConfigPromise,
              }
            : {}),
        });
        const task = render.task;
        if (!this.#scheduler.attachTask(operation, task)) {
          safely(() => task.cancel());
          return;
        }
        await render.promise;
        if (!this.#admitRenderedAnnotationCanvases(operation, budget, annotationCanvasMap)) return;
        if (!this.#operationIsCurrent(operation, context, budget.renderDpr)) return;
        const canvas = context.lease.canvas;
        const attached = canvas.getContext("2d");
        if (!attached) throw new Error("Attached canvas 2D context is unavailable");
        this.#applyRasterPresentation(canvas, budget);
        canvas.width = budget.bufferWidth;
        canvas.height = budget.bufferHeight;
        attached.setTransform(1, 0, 0, 1, 0, 0);
        attached.imageSmoothingEnabled = false;
        attached.clearRect(0, 0, budget.bufferWidth, budget.bufferHeight);
        attached.drawImage(temporary, 0, 0);
        if (!this.#operationIsCurrent(operation, context, budget.renderDpr)) return;
        this.#commitOutput(
          operation,
          context,
          budget,
          viewport,
          viewerRotation,
          annotationCanvasMap,
        );
        committed = true;
      }

      const output = this.#outputs.get(operation.pageNo);
      if (output?.state === "committed" && this.#outputIsCurrent(output)) {
        presentationOutput = output;
      }
      this.#diagnostic(
        "debug",
        "page-render-completed",
        `Committed page ${operation.pageNo} render`,
        {
          operationId: operation.id,
          pageNo: operation.pageNo,
          replacedExistingBitmap: replacesBitmap,
          previousOutputState: previous?.state ?? null,
          previousDpr: previous?.budget.renderDpr ?? null,
          dpr: budget.renderDpr,
          previousScale: previous?.budget.scale ?? null,
          scale: budget.scale,
        },
      );
    } catch (error) {
      failure = error;
    } finally {
      if (temporary) {
        temporary.width = 0;
        temporary.height = 0;
      }
      this.#activeAnnotationCanvasMaps.delete(operation);
      this.#releaseAnnotationOwner(operation);
      if (!committed && !directMutating)
        this.#releaseUnownedAnnotationCanvases(annotationCanvasMap);
      if (directMutating) this.#clearDirectMutation(operation, context);
      const failedCurrent =
        !committed && failure != null && this.#scheduler.ownsOperation(operation);
      if (committed) {
        const key = this.#requirementKey(operation.pageNo);
        this.#rasterFailureAttempts.delete(key);
        this.#terminalRasterRequirements.delete(key);
      } else if (failedCurrent) {
        this.#recordRasterFailure(operation, failure);
      }
      const settledKnown = this.#scheduler.settleOperation(operation);
      if (settledKnown) {
        this.#publishProgress();
        if (this.#view && this.#pdf) {
          this.#scheduler.rebuildQueue(
            this.#view.visibleRange.center,
            this.#view.motion,
            pageNo => this.#pageSatisfiesPlan(pageNo) || this.#pageHasTerminalFailure(pageNo),
            pageNo => this.#rowIndexFor(pageNo),
          );
        }
        this.#pump();
        if (this.#scheduler.snapshot().idle && this.#pdf && this.#view) {
          if (this.#lastPlanSignature !== this.#viewSignature(this.#view))
            this.#reconcileCurrent(true);
          if (this.#initialReady) this.#scheduleMemoryDiagnostic("render-settled");
        }
      }
      if (presentationOutput && pageUse && this.#presentationOutputIsCurrent(presentationOutput)) {
        const presentationUse = pageUse;
        pageUse = null;
        void this.#enqueuePresentation(
          presentationOutput.pageNo,
          presentationOutput.lease,
          presentationOutput.budget.scale,
          presentationOutput,
          Object.freeze({
            annotations: this.#presentationAnnotations,
            text: this.#presentationDemand.has(presentationOutput.pageNo),
          }),
          presentationUse,
        );
      }
      pageUse?.release();
    }
  }

  #budget(operation: RenderOperation, viewport: PDFJS.PageViewport): RenderBudget {
    const requirement = operation.requirement;
    const cssWidth = Math.max(1, viewport.width);
    const cssHeight = Math.max(1, viewport.height);
    const renderDpr = requirement.renderDpr;
    const raster = resolveRasterDimensions(
      cssWidth,
      cssHeight,
      renderDpr,
      requirement.maxCanvasPixels,
      requirement.maxCanvasDimension,
    );
    const bufferWidth = raster.width;
    const bufferHeight = raster.height;
    const pixelCount = bufferWidth * bufferHeight;
    return Object.freeze({
      scale: requirement.scale,
      requestedDpr: requirement.requestedDpr,
      renderDpr: raster.renderDpr,
      dprReducedByMemoryLimit: requirement.dprReducedByMemoryLimit,
      dprReducedByCanvasLimit: raster.canvasLimited || requirement.dprReducedByCanvasLimit,
      cssWidth,
      cssHeight,
      bufferWidth,
      bufferHeight,
      presentationWidth: bufferWidth / raster.renderDpr,
      presentationHeight: bufferHeight / raster.renderDpr,
      pixelCount,
      useDirectCanvas: requirement.useDirectCanvas,
      reservedBytes: pixelCount * 4 * (requirement.useDirectCanvas ? 1 : 2),
    });
  }

  #commitOutput(
    operation: RenderOperation,
    context: OperationContext,
    budget: Readonly<RenderBudget>,
    viewport: PDFJS.PageViewport,
    viewerRotation: 0 | 90 | 180 | 270,
    annotationCanvasMap: Map<string, HTMLCanvasElement>,
  ): void {
    const previous = this.#outputs.get(operation.pageNo);
    const output = Object.freeze({
      documentId: context.documentId,
      pageNo: operation.pageNo,
      lease: context.lease,
      state: "committed",
      budget,
      viewport,
      viewerRotation,
      operation,
      rasterState: operation.requirement.rasterState,
      annotationCanvasMap,
    });
    this.#retainAnnotationOwner(output, annotationCanvasMap);
    this.#outputs.set(operation.pageNo, output);
    this.#applyOutputPresentation(output);
    if (previous && previous !== output) this.#releaseAnnotationOwner(previous);
    this.#releaseAnnotationOwner(operation);
    this.#publishPageGeometry(context.lease, viewport);
  }

  /** Enforces the hard viewer-managed limit after PDF.js reveals annotation backing stores. */
  #admitRenderedAnnotationCanvases(
    operation: RenderOperation,
    budget: Readonly<RenderBudget>,
    map: ReadonlyMap<string, HTMLCanvasElement>,
  ): boolean {
    const annotationBytes = this.#annotationCanvasBytes(map);
    if (!this.#scheduler.updateReservation(operation, budget.reservedBytes + annotationBytes))
      return false;
    if (annotationBytes === 0) return true;
    const snapshot = this.snapshot();
    const observedBytes =
      snapshot.committedBytes +
      snapshot.placeholderBytes +
      snapshot.directMutatingBytes +
      snapshot.activeTemporaryBytes;
    const limitBytes = this.#settings.memoryLimitMiB * BYTES_PER_MIB;
    if (observedBytes <= limitBytes) return true;
    const view = this.#view;
    const mandatory =
      !!view &&
      (this.#pageIsVisible(operation.pageNo, view) ||
        (!this.#initialReady && (this.#initialReadinessPages?.has(operation.pageNo) ?? false)));
    const details = {
      operationId: operation.id,
      pageNo: operation.pageNo,
      annotationCanvasBytes: annotationBytes,
      observedBytes,
      memoryLimitBytes: limitBytes,
      overageBytes: observedBytes - limitBytes,
      mandatoryVisibleOutput: mandatory,
    };
    if (mandatory) {
      this.#diagnostic(
        "debug",
        "annotation-canvas-mandatory-overage",
        `Preserving mandatory page ${operation.pageNo} despite observed annotation-canvas overage`,
        details,
      );
      return true;
    }
    this.#terminalRasterRequirements.add(this.#requirementKey(operation.pageNo));
    this.#diagnostic(
      "debug",
      "annotation-canvas-admission-rejected",
      `Rejected optional page ${operation.pageNo} after annotation canvases exceeded the memory limit`,
      details,
    );
    return false;
  }

  #operationIsCurrent(
    operation: RenderOperation,
    context: OperationContext,
    resultDpr?: number,
  ): boolean {
    return (
      context.documentId === this.#documentId &&
      operation.pdf === this.#pdf &&
      operation.documentGeneration === this.#documentId &&
      operation.requirement.rasterState.optionalContentRevision ===
        this.#rasterState.optionalContentRevision &&
      operation.requirement.rasterState.annotationMode === this.#rasterState.annotationMode &&
      this.#scheduler.ownsOperation(operation) &&
      this.#operationSatisfiesCurrent(operation, resultDpr) &&
      this.#surfaces.isCurrent(context.lease)
    );
  }

  #operationSatisfiesCurrent(operation: RenderOperation, resultDpr?: number): boolean {
    const requirement = this.#scheduler.currentRequirementFor(operation.pageNo);
    return requirement != null && renderOperationSatisfies(operation, requirement, resultDpr);
  }

  #pageSatisfiesPlan(pageNo: number): boolean {
    const output = this.#outputs.get(pageNo);
    const requirement = this.#scheduler.currentRequirementFor(pageNo);
    if (!output || output.state !== "committed" || !requirement || !this.#outputIsCurrent(output))
      return false;
    return (
      output.budget.scale === requirement.scale &&
      output.viewerRotation === this.#view?.rotation &&
      output.rasterState.optionalContentRevision === this.#rasterState.optionalContentRevision &&
      output.rasterState.annotationMode === this.#rasterState.annotationMode &&
      output.budget.renderDpr + DPR_EPSILON >= requirement.renderDpr &&
      output.lease.canvas.width === output.budget.bufferWidth &&
      output.lease.canvas.height === output.budget.bufferHeight
    );
  }

  /** Keeps old-scale pixels only where they are visible or explicitly pinned. */
  #evictUnneededPlaceholders(view: Readonly<RenderViewSnapshot>): void {
    const required = new Set<number>(this.#initialReady ? [] : (this.#initialReadinessPages ?? []));
    for (let row = view.visibleRange.first; row <= view.visibleRange.last; row++) {
      for (const pageNo of view.rows[row] ?? []) required.add(pageNo);
    }
    for (const output of [...this.#outputs.values()]) {
      if (output.state !== "placeholder" || required.has(output.pageNo)) continue;
      if (this.#callbacks.retainPlaceholder?.(output.pageNo)) continue;
      this.#evictOutput(output);
    }
  }

  #requirementKey(pageNo: number): string {
    const requirement = this.#scheduler.currentRequirementFor(pageNo);
    return `${pageNo}|${requirement?.scale ?? this.#view?.scale ?? 0}|${requirement?.renderDpr ?? 0}|${this.#view?.rotation ?? 0}|${this.#rasterState.optionalContentRevision}|${this.#rasterState.annotationMode}`;
  }

  #pageHasTerminalFailure(pageNo: number): boolean {
    return this.#terminalRasterRequirements.has(this.#requirementKey(pageNo));
  }

  #recordRasterFailure(operation: RenderOperation, error: unknown): void {
    const key = this.#requirementKey(operation.pageNo);
    const attempts = (this.#rasterFailureAttempts.get(key) ?? 0) + 1;
    this.#rasterFailureAttempts.set(key, attempts);
    const details = {
      operationId: operation.id,
      pageNo: operation.pageNo,
      attempt: attempts,
      maximumAttempts: MAX_RASTER_ATTEMPTS,
      scale: operation.requirement.scale,
      renderDpr: operation.requirement.renderDpr,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    if (attempts >= MAX_RASTER_ATTEMPTS) {
      const failedDocumentId = operation.documentGeneration;
      const failedInitialReadiness =
        failedDocumentId === this.#documentId &&
        !this.#initialReady &&
        this.#initialReadinessPages?.has(operation.pageNo) === true;
      this.#terminalRasterRequirements.add(key);
      this.#diagnostic(
        "error",
        "page-render-terminal-failure",
        `Rendering page ${operation.pageNo} failed`,
        details,
      );
      if (failedInitialReadiness) {
        const rasterError = new Error(
          `Rendering PDF page ${operation.pageNo} failed after ${attempts} attempts`,
          {
            cause: error,
          },
        );
        this.#callback(() => this.#callbacks.failed?.(failedDocumentId, rasterError));
      }
      return;
    }
    this.#diagnostic("debug", "page-render-retry", `Retrying page ${operation.pageNo}`, details);
  }

  #outputSatisfiesCurrentRequirement(output: RenderOutput): boolean {
    const requirement = this.#scheduler.currentRequirementFor(output.pageNo);
    return (
      requirement != null &&
      output.budget.scale === requirement.scale &&
      output.viewerRotation === this.#view?.rotation &&
      output.rasterState.optionalContentRevision === this.#rasterState.optionalContentRevision &&
      output.rasterState.annotationMode === this.#rasterState.annotationMode &&
      output.budget.renderDpr + DPR_EPSILON >= requirement.renderDpr
    );
  }

  #outputIsCurrent(output: RenderOutput): boolean {
    return (
      output.documentId === this.#documentId &&
      output.rasterState.optionalContentRevision === this.#rasterState.optionalContentRevision &&
      output.rasterState.annotationMode === this.#rasterState.annotationMode &&
      this.#surfaces.isCurrent(output.lease) &&
      output.lease.canvas.width === output.budget.bufferWidth &&
      output.lease.canvas.height === output.budget.bufferHeight
    );
  }

  #publishProgress(): void {
    this.#publishPrimaryPressure();
    if (!this.#pdf || !this.#view || !this.#initialReadinessPages) return;
    const documentId = this.#documentId;
    const readinessPages = this.#initialReadinessPages;
    for (const pageNo of this.#initialReadinessPages) {
      if (this.#pageSatisfiesPlan(pageNo)) this.#initialReadinessCompleted.add(pageNo);
    }
    const complete = this.#initialReadinessCompleted.size;
    const total = this.#initialReadinessPages.size;
    const done = total > 0 && complete >= total;
    this.#callback(() => this.#callbacks.progress?.(complete, total, done));
    if (
      !this.#pdf ||
      this.#documentId !== documentId ||
      this.#initialReadinessPages !== readinessPages ||
      done === false ||
      this.#initialReady
    )
      return;
    this.#initialReady = true;
    this.#scheduleMemoryDiagnostic("initial-render-ready");
    this.#callback(() => this.#callbacks.ready?.(documentId));
    this.#lastPlanSignature = "";
    this.#publishPrimaryPressure();
  }

  #publishPrimaryPressure(): void {
    let pressure: PrimaryRasterPressure = "idle";
    const view = this.#view;
    if (this.#pdf && view) {
      let visibleMissing = !this.#initialReady;
      for (
        let row = view.visibleRange.first;
        !visibleMissing && row <= view.visibleRange.last;
        row++
      ) {
        visibleMissing = (view.rows[row] ?? []).some(
          pageNo => !this.#pageSatisfiesPlan(pageNo) && !this.#pageHasTerminalFailure(pageNo),
        );
      }
      const scheduler = this.#scheduler.snapshot();
      pressure = visibleMissing
        ? "urgent"
        : scheduler.queuedPageCount || scheduler.admittedRenderCount
          ? "speculative"
          : "idle";
    }
    if (pressure === this.#primaryPressure) return;
    this.#primaryPressure = pressure;
    this.#callback(() => this.#callbacks.primaryPressureChanged?.(pressure));
  }

  #presentationOutputIsCurrent(output: RenderOutput): boolean {
    return (
      output.documentId === this.#documentId &&
      this.#pdf != null &&
      this.#outputs.get(output.pageNo) === output &&
      output.state === "committed" &&
      this.#outputIsCurrent(output) &&
      this.#outputSatisfiesCurrentRequirement(output)
    );
  }

  #enqueuePresentation(
    pageNo: number,
    lease: Readonly<RenderSurfaceLease>,
    scale: number,
    output: RenderOutput | null,
    capabilities: Readonly<RenderPresentationCapabilities>,
    suppliedUse: DocumentPageUse | null = null,
  ): Promise<void> {
    const pdf = this.#pdf;
    const admitted = Object.freeze({
      annotations:
        capabilities.annotations && !!output && this.#presentationOutputIsCurrent(output),
      text:
        capabilities.text && this.#presentationDemand.has(pageNo) && this.#view?.scale === scale,
    });
    if (
      !pdf ||
      !this.#pages ||
      !this.#surfaces.isCurrent(lease) ||
      (!admitted.annotations && !admitted.text)
    ) {
      suppliedUse?.release();
      return Promise.resolve();
    }
    const currentLane = this.#presentationLanes.get(pageNo);
    const latest = currentLane?.pending ?? currentLane?.active ?? null;
    const compatible =
      !latest ||
      (latest.documentId === this.#documentId &&
        latest.pdf === pdf &&
        latest.lease === lease &&
        latest.scale === scale &&
        latest.rotation === this.#view?.rotation &&
        (!latest.output || !output || latest.output === output));
    if (currentLane && !compatible) {
      currentLane.revision++;
      currentLane.pending = null;
    }
    const covers = (
      candidate: PresentationRequest | null | undefined,
      capability: keyof RenderPresentationCapabilities,
    ) =>
      !!candidate &&
      candidate.revision === currentLane?.revision &&
      candidate.capabilities[capability] &&
      candidate.documentId === this.#documentId &&
      candidate.pdf === pdf &&
      candidate.lease === lease &&
      candidate.scale === scale &&
      candidate.rotation === this.#view?.rotation &&
      (capability !== "text" ||
        candidate.textRevision === (this.#presentationTextRevisions.get(pageNo) ?? 0)) &&
      (!candidate.output || !output || candidate.output === output);
    const coveredAnnotations =
      compatible &&
      (covers(currentLane?.active, "annotations") || covers(currentLane?.pending, "annotations"));
    const coveredText =
      compatible && (covers(currentLane?.active, "text") || covers(currentLane?.pending, "text"));
    const missing = Object.freeze({
      annotations: admitted.annotations && !coveredAnnotations,
      text: admitted.text && !coveredText,
    });
    if (currentLane && !missing.annotations && !missing.text) {
      suppliedUse?.release();
      return currentLane.settlement;
    }
    const revision = currentLane?.revision ?? 0;
    const request: PresentationRequest = Object.freeze({
      documentId: this.#documentId,
      pdf,
      pageNo,
      lease,
      scale,
      output,
      rotation: this.#view?.rotation ?? 0,
      generation: ++this.#nextPresentationGeneration,
      revision,
      textRevision: this.#presentationTextRevisions.get(pageNo) ?? 0,
      capabilities: missing,
    });
    if (currentLane) {
      const pending = currentLane.pending;
      currentLane.pending =
        pending && compatible
          ? Object.freeze({
              ...request,
              output: request.output ?? pending.output,
              capabilities: Object.freeze({
                annotations: pending.capabilities.annotations || request.capabilities.annotations,
                text: pending.capabilities.text || request.capabilities.text,
              }),
            })
          : request;
      suppliedUse?.release();
      return currentLane.settlement;
    }
    let resolve!: () => void;
    const settlement = new Promise<void>(done => {
      resolve = done;
    });
    const lane: PresentationLane = {
      active: null,
      pending: request,
      use: suppliedUse,
      useDocumentId: suppliedUse ? request.documentId : null,
      revision: 0,
      settlement,
      resolve,
    };
    this.#presentationLanes.set(pageNo, lane);
    void this.#drainPresentationLane(pageNo, lane);
    return settlement;
  }

  async #drainPresentationLane(pageNo: number, lane: PresentationLane): Promise<void> {
    try {
      while (lane.pending) {
        const request = lane.pending;
        lane.pending = null;
        lane.active = request;
        try {
          if (!this.#presentationRequestIsCurrent(request)) continue;
          if (lane.use && lane.useDocumentId !== request.documentId) {
            lane.use.release();
            lane.use = null;
            lane.useDocumentId = null;
          }
          if (!lane.use) {
            lane.use = (await this.#pages?.acquire(pageNo)) ?? null;
            lane.useDocumentId = lane.use ? request.documentId : null;
          }
          if (!lane.use || !this.#presentationRequestIsCurrent(request)) continue;
          const viewport =
            request.output?.viewport ??
            lane.use.page.getViewport({
              scale: request.scale,
              rotation: (lane.use.page.rotate + request.rotation) % 360,
            });
          this.#recordGeometry(pageNo, viewport, request.scale, request.rotation);
          this.#publishPageGeometry(request.lease, viewport);
          if (!this.#presentationRequestIsCurrent(request)) continue;
          const isCurrent = (capability: keyof RenderPresentationCapabilities) =>
            this.#presentationCapabilityIsCurrent(request, capability);
          if (request.output)
            this.#retainAnnotationOwner(request, request.output.annotationCanvasMap);
          await this.#callbacks.present?.(
            Object.freeze({
              documentId: request.documentId,
              pageNo,
              lease: request.lease,
              viewport,
              page: lane.use.page,
              generation: request.generation,
              capabilities: request.capabilities,
              isCurrent,
              rasterState: request.output?.rasterState ?? this.#rasterState,
              annotationCanvasMap: request.output?.annotationCanvasMap ?? new Map(),
            }),
          );
        } catch {
          /* Presentation cannot roll back committed pixels. */
        } finally {
          this.#releaseAnnotationOwner(request);
          lane.active = null;
        }
      }
    } finally {
      lane.use?.release();
      lane.use = null;
      lane.useDocumentId = null;
      if (this.#presentationLanes.get(pageNo) === lane) this.#presentationLanes.delete(pageNo);
      if (!this.#presentationDemand.has(pageNo)) this.#presentationTextRevisions.delete(pageNo);
      lane.resolve();
    }
  }

  #presentationRequestIsCurrent(request: PresentationRequest): boolean {
    return (
      request.documentId === this.#documentId &&
      request.pdf === this.#pdf &&
      this.#presentationLanes.get(request.pageNo)?.revision === request.revision &&
      this.#surfaces.isCurrent(request.lease) &&
      this.#view?.scale === request.scale &&
      this.#view.rotation === request.rotation
    );
  }

  #presentationCapabilityIsCurrent(
    request: PresentationRequest,
    capability: keyof RenderPresentationCapabilities,
  ): boolean {
    if (!request.capabilities[capability] || !this.#presentationRequestIsCurrent(request))
      return false;
    return capability === "annotations"
      ? !!request.output && this.#presentationOutputIsCurrent(request.output)
      : this.#presentationDemand.has(request.pageNo) &&
          request.textRevision === (this.#presentationTextRevisions.get(request.pageNo) ?? 0);
  }

  #withoutPresentationCapability(
    request: PresentationRequest,
    capability: keyof RenderPresentationCapabilities,
  ): PresentationRequest | null {
    const capabilities = Object.freeze({
      annotations: capability === "annotations" ? false : request.capabilities.annotations,
      text: capability === "text" ? false : request.capabilities.text,
    });
    return capabilities.annotations || capabilities.text
      ? Object.freeze({ ...request, capabilities })
      : null;
  }

  #enqueueDemandedPresentations(): void {
    const view = this.#view;
    if (!view || !this.#pdf || !this.#pages || this.#reflowing) return;
    for (const pageNo of this.#presentationDemand) {
      const lease = this.#surfaces.leaseFor(pageNo);
      if (lease && this.#surfaces.isCurrent(lease)) {
        void this.#enqueuePresentation(
          pageNo,
          lease,
          view.scale,
          null,
          Object.freeze({ annotations: false, text: true }),
        );
      }
    }
  }

  #recordGeometry(
    pageNo: number,
    viewport: PDFJS.PageViewport,
    scale: number,
    viewerRotation: number,
  ): void {
    const view = this.#view;
    if (!view || !finitePositive(scale)) return;
    const rotatedWidth = viewport.width / scale;
    const rotatedHeight = viewport.height / scale;
    const width = viewerRotation === 90 || viewerRotation === 270 ? rotatedHeight : rotatedWidth;
    const height = viewerRotation === 90 || viewerRotation === 270 ? rotatedWidth : rotatedHeight;
    const previous = view.pageBaseSizes.get(pageNo);
    if (
      previous &&
      Math.abs(previous.width - width) < PAGE_GEOMETRY_EPSILON &&
      Math.abs(previous.height - height) < PAGE_GEOMETRY_EPSILON
    )
      return;
    this.#cachedPageBaseSizes.set(pageNo, Object.freeze({ width, height }));
    this.#geometryRevision++;
    this.#callback(() => this.#callbacks.observedPageGeometry?.(pageNo, width, height));
  }

  #publishPageGeometry(lease: Readonly<RenderSurfaceLease>, viewport: PDFJS.PageViewport): void {
    if (!this.#surfaces.isCurrent(lease)) return;
    lease.wrapper.style.setProperty("--scale-factor", String(viewport.scale));
    lease.wrapper.style.setProperty("--user-unit", String(viewport.userUnit));
    lease.wrapper.style.setProperty(
      "--total-scale-factor",
      "calc(var(--scale-factor) * var(--user-unit))",
    );
    lease.wrapper.style.setProperty("--scale-round-x", "1px");
    lease.wrapper.style.setProperty("--scale-round-y", "1px");
    lease.wrapper.dataset.mainRotation = String(((viewport.rotation % 360) + 360) % 360);
  }

  #clearDirectMutation(operation: RenderOperation, context: OperationContext): void {
    const output = this.#outputs.get(operation.pageNo);
    if (
      !output ||
      output.state !== "direct-mutating" ||
      output.operation !== operation ||
      output.lease !== context.lease
    )
      return;
    this.#outputs.delete(operation.pageNo);
    this.#releaseAnnotationOwner(output);
    if (this.#surfaces.isCurrent(context.lease)) {
      context.lease.canvas.width = 0;
      context.lease.canvas.height = 0;
      this.#applyEmptyPresentation(context.lease.canvas);
      this.#callback(() => this.#callbacks.evicted?.(operation.pageNo, context.lease));
    }
  }

  #evictOutput(output: RenderOutput): void {
    if (this.#outputs.get(output.pageNo) !== output) return;
    this.#outputs.delete(output.pageNo);
    this.#clearOutput(output, true);
  }

  #replaceOutputRecord(pageNo: number, previous: RenderOutput, next: RenderOutput): void {
    this.#retainAnnotationOwner(next, next.annotationCanvasMap);
    this.#outputs.set(pageNo, next);
    this.#applyOutputPresentation(next);
    this.#releaseAnnotationOwner(previous);
  }

  /** Keeps canvas quantization private from canonical page and overlay geometry. */
  #applyOutputPresentation(output: RenderOutput): void {
    if (!this.#surfaces.isCurrent(output.lease)) return;
    if (output.state === "placeholder") {
      this.#applyEmptyPresentation(output.lease.canvas);
      return;
    }
    this.#applyRasterPresentation(output.lease.canvas, output.budget);
  }

  #applyRasterPresentation(canvas: HTMLCanvasElement, budget: Readonly<RenderBudget>): void {
    canvas.style.width = `${budget.presentationWidth}px`;
    canvas.style.height = `${budget.presentationHeight}px`;
  }

  #applyEmptyPresentation(canvas: HTMLCanvasElement): void {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }

  #clearOutput(output: RenderOutput, publish: boolean): void {
    this.#releaseAnnotationOwner(output);
    if (!this.#surfaces.isCurrent(output.lease)) return;
    output.lease.canvas.width = 0;
    output.lease.canvas.height = 0;
    this.#applyEmptyPresentation(output.lease.canvas);
    if (publish) this.#callback(() => this.#callbacks.evicted?.(output.pageNo, output.lease));
  }

  #cancelOperations(): void {
    this.#scheduler.clearQueue();
    this.#scheduler.cancelActiveOperations(task => safely(() => task.cancel()));
  }

  /** Resolves timers from an injected window or an existing owner surface. */
  #timerWindow(): Window | null {
    return (
      this.#ownerWindow ??
      this.#outputs.values().next().value?.lease.canvas.ownerDocument.defaultView ??
      null
    );
  }

  #clearPlaceholderTimer(): void {
    if (this.#placeholderTimer != null) this.#timerWindow()?.clearTimeout(this.#placeholderTimer);
    this.#placeholderTimer = null;
  }

  #resetDiagnosticThrottle(): void {
    if (this.#diagnosticTimer != null) this.#timerWindow()?.clearTimeout(this.#diagnosticTimer);
    this.#diagnosticTimer = null;
    this.#lastDiagnosticAt = 0;
    this.#omittedDiagnostics = 0;
  }

  #scheduleMemoryDiagnostic(reason: string): void {
    if (!this.#callbacks.diagnostic) return;
    const delay = Math.max(0, this.#lastDiagnosticAt + 5_000 - Date.now());
    if (this.#diagnosticTimer != null) {
      this.#timerWindow()?.clearTimeout(this.#diagnosticTimer);
      this.#omittedDiagnostics++;
    }
    if (delay > 0) {
      const documentId = this.#documentId;
      const ownerWindow = this.#timerWindow();
      if (!ownerWindow) return;
      this.#diagnosticTimer = ownerWindow.setTimeout(() => {
        this.#diagnosticTimer = null;
        if (documentId !== this.#documentId) return;
        const omitted = this.#omittedDiagnostics;
        this.#omittedDiagnostics = 0;
        this.#emitMemoryDiagnostic(reason, true, omitted);
      }, delay);
      return;
    }
    this.#omittedDiagnostics = 0;
    this.#emitMemoryDiagnostic(reason, false, 0);
  }

  #emitMemoryDiagnostic(reason: string, delayed: boolean, omittedCallCount: number): void {
    const snapshot = this.snapshot();
    const plan = this.#scheduler.planSnapshot();
    const estimatedBytes =
      snapshot.committedBytes +
      snapshot.placeholderBytes +
      snapshot.directMutatingBytes +
      snapshot.activeTemporaryBytes;
    const currentOutputs = [...this.#outputs.values()].filter(
      output => output.state === "committed",
    );
    const memoryReducedPageCount = currentOutputs.filter(
      output => output.budget.dprReducedByMemoryLimit,
    ).length;
    const canvasReducedPageCount = currentOutputs.filter(
      output => output.budget.dprReducedByCanvasLimit,
    ).length;
    const attachedBackingStorePixels =
      (snapshot.committedBytes + snapshot.placeholderBytes + snapshot.directMutatingBytes) / 4;
    const activeOffscreenPixels = snapshot.activeTemporaryBytes / 4;
    this.#lastDiagnosticAt = Date.now();
    this.#diagnostic(
      "debug",
      "canvas-memory-estimate",
      "Estimated attached canvas backing-store memory",
      {
        reason,
        delayed,
        omittedCallCount,
        estimateScope: "viewer-managed-raster-backing-stores-and-reservations",
        bytesPerPixelAssumption: 4,
        estimatedBytes,
        estimatedMiB: Math.round((estimatedBytes / BYTES_PER_MIB) * 100) / 100,
        backingStorePixels: attachedBackingStorePixels + activeOffscreenPixels,
        attachedBackingStorePixels,
        activeOffscreenPixels,
        activeOffscreenBufferCount: this.#scheduler.snapshot().activeOffscreenBufferCount,
        attachedCanvasCount: snapshot.renderedPageCount,
        committedBytes: snapshot.committedBytes,
        placeholderBytes: snapshot.placeholderBytes,
        directMutatingBytes: snapshot.directMutatingBytes,
        activeTemporaryBytes: snapshot.activeTemporaryBytes,
        reservedBytes: snapshot.reservationBytes,
        annotationCanvasBytes: snapshot.annotationCanvasBytes,
        committedAnnotationCanvasBytes: snapshot.committedAnnotationCanvasBytes,
        placeholderAnnotationCanvasBytes: snapshot.placeholderAnnotationCanvasBytes,
        directMutatingAnnotationCanvasBytes: snapshot.directMutatingAnnotationCanvasBytes,
        activeAnnotationCanvasBytes: snapshot.activeAnnotationCanvasBytes,
        settlingAnnotationCanvasBytes: snapshot.settlingAnnotationCanvasBytes,
        authoritativeRenderCount: snapshot.authoritativeRenderCount,
        settlingRenderCount: snapshot.settlingRenderCount,
        renderedPageCount: snapshot.renderedPageCount,
        placeholderPageCount: snapshot.placeholderPageCount,
        inFlightRenderCount: snapshot.inFlightRenderCount,
        admittedRenderCount: snapshot.admittedRenderCount,
        renderingProfile: this.#profile,
        scale: this.#view?.scale ?? 0,
        devicePixelRatio: this.#view?.devicePixelRatio ?? 1,
        maxRenderDpr: this.#settings.maxRenderDpr,
        memoryLimitMiB: this.#settings.memoryLimitMiB,
        maxCanvasPixels: this.#settings.maxCanvasPixels,
        maxCanvasDimension: this.#settings.maxCanvasDimension,
        dprReducedByMemoryLimit: memoryReducedPageCount > 0,
        memoryReducedPageCount,
        dprReducedByCanvasLimit: canvasReducedPageCount > 0,
        canvasReducedPageCount,
        plannedDirectRenderPages: plan?.plannedDirectRenderPages ?? [],
        directRenderingPlanned: (plan?.plannedDirectRenderPages.length ?? 0) > 0,
        admittedRowIndexes: plan?.admittedRowIndexes ?? [],
        renderMotion: this.#view?.motion ?? "stationary",
        effectiveBufferRowsBefore: plan?.bufferRowsBefore ?? 0,
        effectiveBufferRowsAfter: plan?.bufferRowsAfter ?? 0,
        effectiveBufferRowsTotal: (plan?.bufferRowsBefore ?? 0) + (plan?.bufferRowsAfter ?? 0),
        effectiveBufferPageCount: plan?.bufferPageCount ?? 0,
        maxBufferPages: this.#currentBufferPages(),
        bufferPageLimitReached: plan?.bufferPageLimitReached ?? false,
        effectiveBufferViewportHeightsBefore: plan?.bufferViewportHeightsBefore ?? 0,
        effectiveBufferViewportHeightsAfter: plan?.bufferViewportHeightsAfter ?? 0,
        effectiveBufferViewportHeightsTotal:
          (plan?.bufferViewportHeightsBefore ?? 0) + (plan?.bufferViewportHeightsAfter ?? 0),
        estimatedPlanPeakBytes: plan?.estimatedPeakBytes ?? estimatedBytes,
        estimatedPlanPeakHeadroomBytes: Math.max(
          0,
          this.#settings.memoryLimitMiB * BYTES_PER_MIB -
            (plan?.estimatedPeakBytes ?? estimatedBytes),
        ),
        emergencyVisibleOverageBytes: plan?.emergencyVisibleOverageBytes ?? 0,
        visibleDprReduced: plan?.visibleDprReduced ?? false,
        optionalDprReduced: plan?.optionalDprReduced ?? false,
        canvasLimitPageCount: plan?.canvasLimitPageCount ?? 0,
        concurrencyReduced: plan?.concurrencyReduced ?? false,
        effectiveMaxConcurrentRenders:
          plan?.maxConcurrentRenders ?? this.#settings.maxConcurrentRenders,
        retainedPageCount: plan?.retainedPageCount ?? 0,
        evictedPageCount: plan?.evictedPageCount ?? 0,
        visibleQualityUpgradeCount: plan?.visibleQualityUpgradeCount ?? 0,
        excludes: ["PDF.js caches", "decoded PDF resources", "browser and GPU overhead"],
      },
    );
  }

  #annotationCanvasBytes(map: ReadonlyMap<string, HTMLCanvasElement>): number {
    return this.#annotationBytes(new Set(map.values()));
  }

  #annotationBytes(canvases: ReadonlySet<HTMLCanvasElement>): number {
    let pixels = 0;
    for (const canvas of canvases) {
      const width = Number.isFinite(canvas.width) ? Math.max(0, canvas.width) : 0;
      const height = Number.isFinite(canvas.height) ? Math.max(0, canvas.height) : 0;
      pixels += width * height;
    }
    return pixels * 4;
  }

  #retainAnnotationOwner(owner: object, map: ReadonlyMap<string, HTMLCanvasElement>): void {
    let owned = this.#annotationCanvasOwners.get(owner);
    if (!owned) {
      owned = new Set();
      this.#annotationCanvasOwners.set(owner, owned);
    }
    for (const canvas of new Set(map.values())) {
      if (owned.has(canvas)) continue;
      owned.add(canvas);
      this.#annotationCanvasRefCounts.set(
        canvas,
        (this.#annotationCanvasRefCounts.get(canvas) ?? 0) + 1,
      );
    }
  }

  #releaseAnnotationOwner(owner: object): void {
    const owned = this.#annotationCanvasOwners.get(owner);
    if (!owned) return;
    this.#annotationCanvasOwners.delete(owner);
    for (const canvas of owned) {
      const remaining = (this.#annotationCanvasRefCounts.get(canvas) ?? 1) - 1;
      if (remaining > 0) {
        this.#annotationCanvasRefCounts.set(canvas, remaining);
        continue;
      }
      this.#annotationCanvasRefCounts.delete(canvas);
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  #releaseUnownedAnnotationCanvases(map: ReadonlyMap<string, HTMLCanvasElement>): void {
    for (const canvas of new Set(map.values())) {
      if (this.#annotationCanvasRefCounts.has(canvas)) continue;
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  #annotationMemory(): Readonly<{
    outputBytes: ReadonlyMap<RenderOutput, number>;
    activeBytes: number;
    settlingBytes: number;
  }> {
    for (const output of this.#outputs.values()) {
      this.#retainAnnotationOwner(output, output.annotationCanvasMap);
    }
    for (const [operation, map] of this.#activeAnnotationCanvasMaps) {
      this.#retainAnnotationOwner(operation, map);
      const output = this.#outputs.get(operation.pageNo);
      if (output?.operation === operation && output.annotationCanvasMap === map) {
        this.#retainAnnotationOwner(output, map);
      }
    }

    const accounted = new Set<HTMLCanvasElement>();
    const outputBytes = new Map<RenderOutput, number>();
    for (const output of [...this.#outputs.values()].sort((a, b) => a.pageNo - b.pageNo)) {
      const unique = new Set<HTMLCanvasElement>();
      for (const canvas of this.#annotationCanvasOwners.get(output) ?? []) {
        if (!accounted.has(canvas)) unique.add(canvas);
        accounted.add(canvas);
      }
      outputBytes.set(output, this.#annotationBytes(unique));
    }

    const active = new Set<HTMLCanvasElement>();
    const settling = new Set<HTMLCanvasElement>();
    for (const operation of this.#activeAnnotationCanvasMaps.keys()) {
      const output = this.#outputs.get(operation.pageNo);
      if (output?.operation === operation) continue;
      const target = this.#scheduler.ownsOperation(operation) ? active : settling;
      for (const canvas of this.#annotationCanvasOwners.get(operation) ?? []) {
        if (!accounted.has(canvas)) target.add(canvas);
        accounted.add(canvas);
      }
    }
    const knownOwners = new Set<object>([
      ...this.#outputs.values(),
      ...this.#activeAnnotationCanvasMaps.keys(),
    ]);
    for (const [owner, canvases] of this.#annotationCanvasOwners) {
      if (knownOwners.has(owner)) continue;
      for (const canvas of canvases) {
        if (!accounted.has(canvas)) settling.add(canvas);
        accounted.add(canvas);
      }
    }
    return Object.freeze({
      outputBytes,
      activeBytes: this.#annotationBytes(active),
      settlingBytes: this.#annotationBytes(settling),
    });
  }

  #diagnostic(
    level: "debug" | "error",
    event: string,
    message: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    this.#callback(() =>
      this.#callbacks.diagnostic?.(
        Object.freeze({
          level,
          event,
          message,
          details: Object.freeze({ ...details }),
        }),
      ),
    );
  }

  #callback(callback: () => void): void {
    try {
      callback();
    } catch {
      /* Every external callback is non-fatal and reentrant. */
    }
  }

  #rowIndexFor(pageNo: number): number | undefined {
    return this.#cachedPageRows.get(pageNo);
  }

  #pageIsVisible(pageNo: number, view: RenderViewSnapshot): boolean {
    const row = this.#rowIndexFor(pageNo);
    return row != null && row >= view.visibleRange.first && row <= view.visibleRange.last;
  }

  #rasterBytes(pageNo: number, dpr: number, view: RenderViewSnapshot): number {
    const size = view.pageBaseSizes.get(pageNo) ?? view.fallbackPageSize;
    const raster = resolveRasterDimensions(
      size.width * view.scale,
      size.height * view.scale,
      dpr,
      this.#settings.maxCanvasPixels,
      this.#settings.maxCanvasDimension,
    );
    return raster.width * raster.height * 4;
  }
}
