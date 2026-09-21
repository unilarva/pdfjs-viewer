// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private renderer-internal scheduling and resource state machine.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * This module owns the active render plan, priority queue, concurrency
 * admission, per-page commit authority, attached PDF.js tasks, reservations,
 * temporary-buffer allocations, direct-surface exclusion, cancellation, and
 * balanced physical settlement. Cancellation invalidates commit authority
 * synchronously but retains concurrency and resources until the exact operation
 * settles. Mutable collections never escape the scheduler; callers observe
 * scalar queries or detached readonly snapshots and request state transitions.
 *
 * `DocumentRenderer` constructs plans from detached view/profile facts and owns
 * PDF.js calls, output records, canvases, progress, and diagnostics. This lower
 * layer exposes only queue/operation/resource transitions and detached counters.
 *
 * Each renderer-owned `RenderAdmission` carries immutable document/result
 * identity plus task/resources through settlement. Committed bitmap identity
 * remains solely in `DocumentRenderer`. The
 * renderer must call {@link RenderScheduler.reset} during synchronous document
 * invalidation; reset then makes every old operation unownable before DOM reset.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative split
 * between renderer policy/output ownership and scheduler transitions.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module render-scheduler
 */

import type * as PDFJS from "pdfjs-dist";
import type { RenderMotion, RenderPlan } from "./render-planner.js";

const DPR_EPSILON = 1e-6;

/** Immutable semantic state captured by each main display raster. */
export interface MainRasterState {
  readonly optionalContentRevision: number;
  readonly annotationMode: number;
  readonly optionalContentConfigPromise?: NonNullable<
    Parameters<PDFJS.PDFPageProxy["render"]>[0]["optionalContentConfigPromise"]
  >;
}

/** Immutable raster requirements and strategy selected when work is admitted. */
interface RenderOperationRequirement {
  readonly scale: number;
  readonly requestedDpr: number;
  readonly renderDpr: number;
  readonly useDirectCanvas: boolean;
  readonly dprReducedByMemoryLimit: boolean;
  readonly dprReducedByCanvasLimit: boolean;
  readonly maxCanvasPixels: number;
  readonly maxCanvasDimension: number;
  readonly rasterState: MainRasterState;
}

/** Current semantic output requirements used to validate admitted work. */
interface CurrentRenderRequirement {
  readonly scale: number;
  readonly renderDpr: number;
  readonly rasterState: MainRasterState;
}

/** Immutable identity and document/result context for one admitted page render. */
export interface RenderOperation {
  readonly id: number;
  readonly pageNo: number;
  readonly pdf: PDFJS.PDFDocumentProxy;
  readonly documentGeneration: number;
  readonly requirement: RenderOperationRequirement;
}

/** Plan-owned facts supplied while constructing the next admitted operation. */
export interface RenderAdmissionCandidate {
  readonly pageNo: number;
  readonly renderDpr: number;
  readonly requiresDirectCanvas: boolean;
  readonly dprReducedByMemoryLimit: boolean;
  readonly dprReducedByCanvasLimit: boolean;
}

/** Facade-owned document and raster facts needed to admit one queued page. */
interface RenderAdmission {
  readonly pdf: PDFJS.PDFDocumentProxy;
  readonly documentGeneration: number;
  readonly requestedDpr: number;
  readonly useDirectCanvas: boolean;
  readonly maxCanvasPixels: number;
  readonly maxCanvasDimension: number;
  readonly reservedBytes: number;
  /** Exact attached canvas used to exclude replacement work while a direct writer settles. */
  readonly surfaceIdentity: object;
  readonly rasterState?: MainRasterState;
}

/** Detached aggregate state used by diagnostics and orchestration. */
interface RenderSchedulerSnapshot {
  readonly queuedPageCount: number;
  readonly admittedRenderCount: number;
  readonly inFlightRenderCount: number;
  readonly activeOffscreenBufferCount: number;
  readonly activeOffscreenPixels: number;
  readonly reservedBytes: number;
  readonly authoritativeRenderCount: number;
  readonly settlingRenderCount: number;
  readonly directSurfaceLockCount: number;
  readonly settlingOffscreenPixels: number;
  readonly maxConcurrentRenders: number;
  readonly idle: boolean;
}

/** Detached active-plan diagnostics without mutable planner collections. */
interface RenderPlanSnapshot {
  readonly desiredPages: readonly number[];
  readonly admittedRowIndexes: readonly number[];
  readonly plannedDirectRenderPages: readonly number[];
  readonly estimatedPeakBytes: number;
  readonly emergencyVisibleOverageBytes: number;
  readonly bufferRowsBefore: number;
  readonly bufferRowsAfter: number;
  readonly bufferPageCount: number;
  readonly bufferPageLimitReached: boolean;
  readonly bufferViewportHeightsBefore: number;
  readonly bufferViewportHeightsAfter: number;
  readonly visibleDprReduced: boolean;
  readonly optionalDprReduced: boolean;
  readonly canvasLimitPageCount: number;
  readonly concurrencyReduced: boolean;
  readonly maxConcurrentRenders: number;
  readonly retainedPageCount: number;
  readonly evictedPageCount: number;
  readonly visibleQualityUpgradeCount: number;
}

interface RenderOperationState {
  readonly operation: RenderOperation;
  authoritative: boolean;
  task: PDFJS.RenderTask | null;
  reservationBytes: number;
  offscreenPixels: number;
  readonly surfaceIdentity: object;
  readonly directSurfaceLock: boolean;
}

interface ActiveRenderPlanContext {
  readonly plan: RenderPlan;
  readonly visibleRange: Readonly<{ first: number; last: number }>;
  readonly scale: number;
  readonly rasterState: MainRasterState;
}

/** Whether admitted work, and optionally its finished DPR, satisfies current requirements. */
export function renderOperationSatisfies(
  operation: RenderOperation,
  current: CurrentRenderRequirement,
  resultDpr?: number,
): boolean {
  const admitted = operation.requirement;
  const admittedRaster = admitted.rasterState ?? { optionalContentRevision: 0, annotationMode: 1 };
  const currentRaster = current.rasterState ?? { optionalContentRevision: 0, annotationMode: 1 };
  return (
    admitted.scale === current.scale &&
    admittedRaster.optionalContentRevision === currentRaster.optionalContentRevision &&
    admittedRaster.annotationMode === currentRaster.annotationMode &&
    admitted.renderDpr + DPR_EPSILON >= current.renderDpr &&
    (resultDpr == null || resultDpr + DPR_EPSILON >= current.renderDpr)
  );
}

/** Owns and enforces all mutable render scheduling and resource bookkeeping. */
export class RenderScheduler {
  #operations = new Map<RenderOperation, RenderOperationState>();
  #authoritativeByPage = new Map<number, RenderOperation>();
  #directSurfaceOwners = new Map<object, RenderOperation>();
  #queue: number[] = [];
  #planContext: ActiveRenderPlanContext | null = null;
  #defaultMaxConcurrentRenders: number;
  #nextOperationId = 0;

  constructor(initialMaxConcurrentRenders: number) {
    this.#defaultMaxConcurrentRenders = initialMaxConcurrentRenders;
  }

  /** Atomically replaces queued work and installs detached plan context. */
  applyPlan(
    plan: RenderPlan,
    visibleRange: Readonly<{ first: number; last: number }>,
    activeScale: number,
    rasterState: MainRasterState = Object.freeze({ optionalContentRevision: 0, annotationMode: 1 }),
  ): void {
    const detachedRasterState: MainRasterState = Object.freeze({
      optionalContentRevision: rasterState.optionalContentRevision,
      annotationMode: rasterState.annotationMode,
      ...(rasterState.optionalContentConfigPromise
        ? { optionalContentConfigPromise: rasterState.optionalContentConfigPromise }
        : {}),
    });
    const detachedPlan: RenderPlan = {
      ...plan,
      desiredPages: [...plan.desiredPages],
      admittedRowIndexes: [...plan.admittedRowIndexes],
      retainedPages: new Set(plan.retainedPages),
      visiblePages: new Set(plan.visiblePages),
      pageRenderDprs: new Map(plan.pageRenderDprs),
      directRenderPages: new Set(plan.directRenderPages),
      canvasLimitPages: new Set(plan.canvasLimitPages),
      memoryLimitPages: new Set(plan.memoryLimitPages),
    };
    this.#queue = [];
    this.#planContext = {
      plan: detachedPlan,
      visibleRange: Object.freeze({ first: visibleRange.first, last: visibleRange.last }),
      scale: activeScale,
      rasterState: detachedRasterState,
    };
  }

  /** Detached active-plan diagnostics suitable for logging and progress policy. */
  planSnapshot(): Readonly<RenderPlanSnapshot> | null {
    const plan = this.#planContext?.plan;
    if (!plan) return null;
    return Object.freeze({
      desiredPages: Object.freeze([...plan.desiredPages]),
      admittedRowIndexes: Object.freeze([...plan.admittedRowIndexes]),
      plannedDirectRenderPages: Object.freeze([...plan.directRenderPages]),
      estimatedPeakBytes: plan.estimatedPeakBytes,
      emergencyVisibleOverageBytes: plan.emergencyVisibleOverageBytes,
      bufferRowsBefore: plan.bufferRowsBefore,
      bufferRowsAfter: plan.bufferRowsAfter,
      bufferPageCount: plan.bufferPageCount,
      bufferPageLimitReached: plan.bufferPageLimitReached,
      bufferViewportHeightsBefore: plan.bufferViewportHeightsBefore,
      bufferViewportHeightsAfter: plan.bufferViewportHeightsAfter,
      visibleDprReduced: plan.visibleDprReduced,
      optionalDprReduced: plan.optionalDprReduced,
      canvasLimitPageCount: plan.canvasLimitPages.size,
      concurrencyReduced: plan.concurrencyReduced,
      maxConcurrentRenders: plan.maxConcurrentRenders,
      retainedPageCount: plan.retainedPageCount,
      evictedPageCount: plan.evictedPageCount,
      visibleQualityUpgradeCount: plan.visibleQualityUpgradeCount,
    });
  }

  /** Semantic raster requirement currently planned for one page. */
  currentRequirementFor(pageNo: number): CurrentRenderRequirement | null {
    const context = this.#planContext;
    const renderDpr = context?.plan.pageRenderDprs.get(pageNo);
    if (!context || renderDpr == null) return null;
    return Object.freeze({
      scale: context.scale,
      renderDpr,
      rasterState: context.rasterState,
    });
  }

  /** Rebuilds queued work in visible-first stationary or leading-edge order. */
  rebuildQueue(
    centerRow: number,
    motion: RenderMotion,
    isSatisfied: (pageNo: number) => boolean,
    rowIndexFor: (pageNo: number) => number | undefined,
  ): void {
    const plan = this.#planContext?.plan;
    if (!plan) {
      this.#queue = [];
      return;
    }
    const pending = plan.desiredPages.filter(
      pageNo => !this.#authoritativeByPage.has(pageNo) && !isSatisfied(pageNo),
    );
    const desiredOrder = new Map(plan.desiredPages.map((pageNo, index) => [pageNo, index]));
    pending.sort((a, b) => {
      const aVisible = plan.visiblePages.has(a) ? 0 : 1;
      const bVisible = plan.visiblePages.has(b) ? 0 : 1;
      if (aVisible !== bVisible) return aVisible - bVisible;
      const aRow = rowIndexFor(a) ?? 0;
      const bRow = rowIndexFor(b) ?? 0;
      if (!aVisible) {
        if (motion === "forward" && aRow !== bRow) return bRow - aRow;
        if (motion === "backward" && aRow !== bRow) return aRow - bRow;
        if (motion === "stationary") {
          const distance = Math.abs(aRow - centerRow) - Math.abs(bRow - centerRow);
          if (distance) return distance;
        }
      }
      return (
        (desiredOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (desiredOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || a - b
      );
    });
    this.#queue = pending.reverse();
  }

  /** Clears pending, not-yet-admitted work without affecting active operations. */
  clearQueue(): void {
    this.#queue = [];
  }

  /** Detached queue snapshot; mutating it cannot alter scheduler ordering. */
  queuedPages(): readonly number[] {
    return Object.freeze([...this.#queue]);
  }

  /**
   * Removes the next eligible page and admits it in one transition. Duplicate
   * same-page work and over-concurrency admission are impossible through this API.
   */
  admitNext(
    createAdmission: (candidate: RenderAdmissionCandidate) => RenderAdmission | null,
  ): RenderOperation | null {
    const context = this.#planContext;
    const plan = context?.plan;
    if (!context || !plan || this.#operations.size >= plan.maxConcurrentRenders) return null;
    const blocked: number[] = [];
    const candidateCount = this.#queue.length;
    for (let index = 0; index < candidateCount; index++) {
      const pageNo = this.#queue.pop()!;
      if (this.#authoritativeByPage.has(pageNo)) continue;
      const renderDpr = plan.pageRenderDprs.get(pageNo);
      if (renderDpr == null) continue;
      const admission = createAdmission(
        Object.freeze({
          pageNo,
          renderDpr,
          requiresDirectCanvas: plan.directRenderPages.has(pageNo),
          dprReducedByMemoryLimit: plan.memoryLimitPages.has(pageNo),
          dprReducedByCanvasLimit: plan.canvasLimitPages.has(pageNo),
        }),
      );
      if (!admission) {
        blocked.push(pageNo);
        continue;
      }
      if (this.#planContext !== context) return null;
      if (!Number.isFinite(admission.reservedBytes) || admission.reservedBytes < 0) continue;
      if (this.#directSurfaceOwners.has(admission.surfaceIdentity)) {
        blocked.push(pageNo);
        continue;
      }
      const operation: RenderOperation = Object.freeze({
        id: ++this.#nextOperationId,
        pageNo,
        pdf: admission.pdf,
        documentGeneration: admission.documentGeneration,
        requirement: Object.freeze({
          scale: context.scale,
          requestedDpr: admission.requestedDpr,
          renderDpr,
          useDirectCanvas: admission.useDirectCanvas,
          dprReducedByMemoryLimit: plan.memoryLimitPages.has(pageNo),
          dprReducedByCanvasLimit: plan.canvasLimitPages.has(pageNo),
          maxCanvasPixels: admission.maxCanvasPixels,
          maxCanvasDimension: admission.maxCanvasDimension,
          rasterState: admission.rasterState ?? context.rasterState,
        }),
      });
      const state: RenderOperationState = {
        operation,
        authoritative: true,
        task: null,
        reservationBytes: admission.reservedBytes,
        offscreenPixels: 0,
        surfaceIdentity: admission.surfaceIdentity,
        directSurfaceLock: admission.useDirectCanvas,
      };
      this.#operations.set(operation, state);
      this.#authoritativeByPage.set(pageNo, operation);
      if (state.directSurfaceLock)
        this.#directSurfaceOwners.set(admission.surfaceIdentity, operation);
      while (blocked.length) this.#queue.push(blocked.pop()!);
      return operation;
    }
    while (blocked.length) this.#queue.push(blocked.pop()!);
    return null;
  }

  /** Whether this operation still owns the active same-page scheduler slot. */
  ownsOperation(operation: RenderOperation): boolean {
    return (
      this.#authoritativeByPage.get(operation.pageNo) === operation &&
      this.#operations.get(operation)?.authoritative === true
    );
  }

  /** Associates one cancellable PDF.js task with its owning admitted operation. */
  attachTask(operation: RenderOperation, task: PDFJS.RenderTask): boolean {
    const state = this.#ownedState(operation);
    if (!state || state.task) return false;
    state.task = task;
    return true;
  }

  /** Updates the reservation only while the exact operation owns the page. */
  updateReservation(operation: RenderOperation, reservedBytes: number): boolean {
    const state = this.#ownedState(operation);
    if (!state || !Number.isFinite(reservedBytes) || reservedBytes < 0) return false;
    state.reservationBytes = reservedBytes;
    return true;
  }

  /** Records a temporary backing-store allocation for its exact owner. */
  recordOffscreenAllocation(operation: RenderOperation, pixels: number): boolean {
    const state = this.#ownedState(operation);
    if (
      !state ||
      operation.requirement.useDirectCanvas ||
      state.offscreenPixels !== 0 ||
      !Number.isFinite(pixels) ||
      pixels <= 0
    )
      return false;
    state.offscreenPixels = pixels;
    return true;
  }

  /** Releases every resource still owned by this exact operation. */
  settleOperation(operation: RenderOperation): boolean {
    const state = this.#operations.get(operation);
    if (!state) return false;
    this.#operations.delete(operation);
    if (this.#authoritativeByPage.get(operation.pageNo) === operation) {
      this.#authoritativeByPage.delete(operation.pageNo);
    }
    if (
      state.directSurfaceLock &&
      this.#directSurfaceOwners.get(state.surfaceIdentity) === operation
    ) {
      this.#directSurfaceOwners.delete(state.surfaceIdentity);
    }
    return true;
  }

  /** Detached aggregate resource and scheduling counters. */
  snapshot(): Readonly<RenderSchedulerSnapshot> {
    let inFlightRenderCount = 0;
    let activeOffscreenBufferCount = 0;
    let activeOffscreenPixels = 0;
    let settlingOffscreenPixels = 0;
    let reservedBytes = 0;
    for (const state of this.#operations.values()) {
      if (state.task) inFlightRenderCount++;
      if (state.offscreenPixels > 0) {
        activeOffscreenBufferCount++;
        activeOffscreenPixels += state.offscreenPixels;
        if (!state.authoritative) settlingOffscreenPixels += state.offscreenPixels;
      }
      reservedBytes += state.reservationBytes;
    }
    return Object.freeze({
      queuedPageCount: this.#queue.length,
      admittedRenderCount: this.#operations.size,
      inFlightRenderCount,
      activeOffscreenBufferCount,
      activeOffscreenPixels,
      reservedBytes,
      authoritativeRenderCount: this.#authoritativeByPage.size,
      settlingRenderCount: this.#operations.size - this.#authoritativeByPage.size,
      directSurfaceLockCount: this.#directSurfaceOwners.size,
      settlingOffscreenPixels,
      maxConcurrentRenders:
        this.#planContext?.plan.maxConcurrentRenders ?? this.#defaultMaxConcurrentRenders,
      idle: this.#queue.length === 0 && this.#operations.size === 0,
    });
  }

  /** Cancels and invalidates all active operations while preserving queue and plan. */
  cancelActiveOperations(cancelTask: (task: PDFJS.RenderTask) => void): void {
    for (const state of [...this.#operations.values()]) {
      this.#cancelState(state, cancelTask);
    }
  }

  /** Cancels operations outside the current desired-page set, including pre-task work. */
  cancelUndesired(cancelTask: (task: PDFJS.RenderTask) => void): void {
    const desiredPages = new Set(this.#planContext?.plan.desiredPages ?? []);
    this.#cancelWhere(operation => !desiredPages.has(operation.pageNo), cancelTask);
  }

  /** Cancels operations whose immutable result requirements no longer fit current policy. */
  cancelIncompatible(
    isCompatible: (operation: RenderOperation) => boolean,
    cancelTask: (task: PDFJS.RenderTask) => void,
  ): void {
    this.#cancelWhere(operation => !isCompatible(operation), cancelTask);
  }

  /** Drops one page's active operation, cancelling its task if attached. */
  dropPageState(pageNo: number, cancelTask: (task: PDFJS.RenderTask) => void): boolean {
    const operation = this.#authoritativeByPage.get(pageNo);
    const state = operation ? this.#operations.get(operation) : undefined;
    if (state) this.#cancelState(state, cancelTask);
    return state?.task != null;
  }

  /** Full document reset: invalidates all work and clears plan and queue. */
  reset(cancelTask: (task: PDFJS.RenderTask) => void): void {
    const existingOperations = new Set(this.#operations.keys());
    try {
      this.cancelActiveOperations(cancelTask);
    } finally {
      for (const [operation, state] of [...this.#operations]) {
        state.authoritative = false;
        if (existingOperations.has(operation)) continue;
        this.#operations.delete(operation);
        if (
          state.directSurfaceLock &&
          this.#directSurfaceOwners.get(state.surfaceIdentity) === operation
        ) {
          this.#directSurfaceOwners.delete(state.surfaceIdentity);
        }
      }
      this.#authoritativeByPage.clear();
      this.#queue = [];
      this.#planContext = null;
    }
  }

  #ownedState(operation: RenderOperation): RenderOperationState | null {
    const state = this.#operations.get(operation);
    return state?.authoritative === true ? state : null;
  }

  #cancelWhere(
    shouldCancel: (operation: RenderOperation) => boolean,
    cancelTask: (task: PDFJS.RenderTask) => void,
  ): void {
    for (const state of [...this.#operations.values()]) {
      if (!state.authoritative) continue;
      if (!shouldCancel(state.operation)) continue;
      this.#cancelState(state, cancelTask);
    }
  }

  /** Preempts the least useful current work when visible pages are waiting for capacity. */
  preemptForVisible(
    rowIndexFor: (pageNo: number) => number | undefined,
    centerRow: number,
    motion: RenderMotion,
    cancelTask: (task: PDFJS.RenderTask) => void,
  ): readonly RenderOperation[] {
    const plan = this.#planContext?.plan;
    if (!plan || this.#operations.size < plan.maxConcurrentRenders) return [];
    const waitingVisible = this.#queue.filter(pageNo => plan.visiblePages.has(pageNo)).length;
    if (!waitingVisible) return [];
    const victims = [...this.#authoritativeByPage.values()]
      .filter(operation => !plan.visiblePages.has(operation.pageNo))
      .sort((a, b) => {
        const aRow = rowIndexFor(a.pageNo) ?? Number.POSITIVE_INFINITY;
        const bRow = rowIndexFor(b.pageNo) ?? Number.POSITIVE_INFINITY;
        const distance = Math.abs(bRow - centerRow) - Math.abs(aRow - centerRow);
        if (distance) return distance;
        if (motion === "forward") return aRow - bRow;
        if (motion === "backward") return bRow - aRow;
        return 0;
      })
      .slice(0, waitingVisible);
    for (const operation of victims) {
      const state = this.#operations.get(operation);
      if (state) this.#cancelState(state, cancelTask);
    }
    return Object.freeze(victims);
  }

  #cancelState(state: RenderOperationState, cancelTask: (task: PDFJS.RenderTask) => void): void {
    if (!state.authoritative) return;
    state.authoritative = false;
    if (this.#authoritativeByPage.get(state.operation.pageNo) === state.operation) {
      this.#authoritativeByPage.delete(state.operation.pageNo);
    }
    if (state.task) {
      try {
        cancelTask(state.task);
      } catch {
        /* Physical ownership remains until settlement. */
      }
    }
  }
}
