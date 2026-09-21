// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private document-local outline, named-destination, selection, and persistence model.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentNavigation` prepares one detached outline tree per document, resolves
 * outline destinations, indexes PDF named destinations, and owns sticky semantic
 * outline selection plus prefix-stripped navigation destination ID persistence.
 * Outline entries receive compact, stable preorder ordinal keys (`"0"`, `"1"`,
 * ...) for the current preparation; no DOM identity participates in selection.
 * PDF.js outline data is treated as untrusted: malformed entries are skipped,
 * malformed branches are empty, malformed destinations are unresolved, and
 * ancestor object or array cycles produce an error outcome. Destination work is
 * resolved through a private bounded worker pool. Explicit selection is pinned until its
 * destination leaves the viewport, after which viewport geometry chooses the
 * active semantic key. A destination selected before outline preparation is
 * reconciled to the same nearby/fallback semantic target when entries arrive.
 *
 * Preparation and destination indexing share in-flight work across callers. Reset
 * invalidates pending completions, clears document-local state, cancels persistence
 * debounce, and prevents stale PDF work from becoming canonical. Debounced writes
 * additionally require both lifecycle and timer identity, so manually delivered
 * cancelled callbacks cannot write or release newer timer ownership. Persistence
 * prefix stripping, nearby-destination matching, debounce, and write ownership remain here.
 *
 * `DocumentOutlinePresentation` owns outline markup, filtering, localization,
 * listener lifetime, active reveal, and local scrolling. The facade owns public
 * preparation events and execution of returned navigation intents; `ViewerPanels`
 * owns shell open/focus policy. A PDF named destination, an outline destination,
 * and a prefix-stripped navigation destination ID are intentionally distinct.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative
 * navigation-intent procedure and model/facade boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-navigation
 */

import type * as PDFJS from "pdfjs-dist";
import type { DocumentPageUse } from "./document-page-usage.js";
import { resolvePdfDestination, type ResolvedPdfDestination } from "./pdf-destinations.js";
import { compileTextQuery, hasCompiledTextMatch } from "./text-matching.js";
import type { NormalizedTextQueryOptions } from "./viewer-options.js";
import type {
  PdfjsViewerNavigationStateAdapter,
  PdfjsViewerOutlineDestination,
  PdfjsViewerOutlineItem,
  PdfjsViewerOutlineResult,
  PdfjsViewerPdfNamedDestinationNavigationOptions,
  PdfjsViewerPdfNamedDestinationNavigationFailure,
} from "./viewer-contracts.js";

type PdfDestinationInput = string | Array<unknown> | null | undefined;
type OutlineNodeLike = Record<string, unknown>;
type NavigationDestination = {
  navigationDestinationId: string;
  pageNo: number;
  yRatio: number;
  xRatio?: number;
};
type OutlineTarget = {
  key: string;
  pageNo: number;
  yRatio: number;
  xRatio?: number;
  ordinal: number;
};
type OutlineDraft = {
  key: string;
  ordinal: number;
  title: string;
  fallbackTitle?: true;
  destinationInput: PdfDestinationInput;
  destinationStatus: PdfjsViewerOutlineItem["destinationStatus"];
  destination: PdfjsViewerOutlineDestination | null;
  children: OutlineDraft[];
  entry?: DocumentOutlineEntry;
};
type OutlineDestinationJob = {
  readonly draft: OutlineDraft;
  readonly destination: string | Array<unknown>;
};
const OUTLINE_DESTINATION_CONCURRENCY = 4;
type DocumentReadingPosition = {
  readonly pageNo: number;
  readonly yRatio: number;
  readonly xRatio: number;
};
type PageRange = { readonly start: number; readonly end: number };
type StickyOutline = { key: string | null; pageNo: number; yRatio: number; seen: boolean };
type StickyDestination = {
  navigationDestinationId: string | null;
  pageNo: number;
  yRatio: number;
  seen: boolean;
};
const EMPTY_OUTLINE_ITEMS = Object.freeze([]) as readonly [];
const CANCELLED_OUTLINE_OUTCOME = Object.freeze({
  status: "cancelled" as const,
  itemCount: 0 as const,
  items: EMPTY_OUTLINE_ITEMS,
});

/** Page geometry and persistence capabilities required by the navigation model. */
export interface DocumentNavigationHost {
  readonly destinationMatchTolerance: number;
  readonly shareableNamedDestinationPrefix: string | null;
  readonly navigationState: PdfjsViewerNavigationStateAdapter | null;
  getPdf(): PDFJS.PDFDocumentProxy | null;
  getDocumentGeneration(): number;
  getDocumentSignal(): AbortSignal;
  isCurrentDocument(pdf: PDFJS.PDFDocumentProxy, generation: number): boolean;
  pageTopFor(page: number): number | null;
  pageHeightFor(page: number): number;
  rotation(): 0 | 90 | 180 | 270;
  scrollTop(): number;
  viewportHeight(): number;
  viewportPosition(): Readonly<DocumentReadingPosition>;
  canWriteNavigationState(): boolean;
  setNavigationStateTimeout(callback: () => void, delay: number): number;
  clearNavigationStateTimeout(timer: number): void;
  acquirePage(pageNo: number): Promise<DocumentPageUse>;
}

/** Private detached outline entry used to connect model selection to facade DOM. */
export interface DocumentOutlineEntry {
  readonly key: string;
  readonly title: string;
  /** True only when the package generated the title for malformed PDF data. */
  readonly fallbackTitle?: true;
  readonly destinationStatus: PdfjsViewerOutlineItem["destinationStatus"];
  readonly destination: PdfjsViewerOutlineDestination | null;
  readonly children: readonly DocumentOutlineEntry[];
}

/** Shared outline preparation result; stale work is reported as cancelled. */
export type DocumentOutlinePreparationOutcome =
  | {
      readonly status: "ready";
      readonly itemCount: number;
      readonly items: readonly DocumentOutlineEntry[];
    }
  | {
      readonly status: "error";
      readonly itemCount: 0;
      readonly items: readonly [];
      readonly error: unknown;
    }
  | { readonly status: "cancelled"; readonly itemCount: 0; readonly items: readonly [] };

/** Movement selected by the model for facade execution. */
export interface DocumentNavigationIntent {
  readonly page: number;
  readonly yRatio: number;
  readonly xRatio?: number;
  readonly usePosition: boolean;
  readonly smooth: boolean;
}

/** Successful PDF named-destination resolution before movement is executed. */
export type DocumentNamedDestinationOutcome =
  | {
      readonly ok: true;
      readonly pdfNamedDestination: string;
      readonly intent: DocumentNavigationIntent;
    }
  | {
      readonly ok: false;
      readonly pdfNamedDestination: string;
      readonly reason: PdfjsViewerPdfNamedDestinationNavigationFailure;
      readonly error?: unknown;
    };

/** Persisted destination request returned to the facade for normal named navigation. */
interface DocumentPersistedNavigationRequest {
  readonly pdfNamedDestination: string;
  readonly smooth: boolean;
}

/** Owns all document-local outline and navigation destination state. */
export class DocumentNavigation {
  #lifecycleGeneration = 0;
  #navigationRequest = 0;
  #outlinePromise: Promise<DocumentOutlinePreparationOutcome> | null = null;
  #outlineOutcome: DocumentOutlinePreparationOutcome | null = null;
  #outlineEntries: readonly DocumentOutlineEntry[] = [];
  #outlineTargets: readonly OutlineTarget[] = [];
  #outlineTargetPages: ReadonlyMap<number, PageRange> = new Map();
  #outlineEntriesByKey: ReadonlyMap<string, DocumentOutlineEntry> = new Map();
  #destinations: readonly NavigationDestination[] = [];
  #destinationPages: ReadonlyMap<number, PageRange> = new Map();
  #destinationsIndexed = false;
  #destinationIndexPromise: Promise<void> | null = null;
  #stickyOutline: StickyOutline | null = null;
  #stickyDestination: StickyDestination | null = null;
  #syncTimer: number | null = null;
  #clearSyncTimer: ((timer: number) => void) | null = null;
  #lastSyncedDestinationId: string | null = null;
  #untitledLabel = "(Untitled)";

  /** The active document's shared detached outline preparation work. */
  public get preparation(): Promise<DocumentOutlinePreparationOutcome> | null {
    return this.#outlinePromise;
  }
  /** The active document's shared PDF named-destination indexing work. */
  public get destinationPreparation(): Promise<void> | null {
    return this.#destinationIndexPromise;
  }
  /** Canonical non-fatal outline preparation error for the active document. */
  public get error(): unknown {
    return this.#outlineOutcome?.status === "error" ? this.#outlineOutcome.error : null;
  }

  /** Relabels only package-generated outline fallback titles without resolving PDF work again. */
  public setUntitledLabel(label: string): void {
    if (label === this.#untitledLabel) return;
    this.#untitledLabel = label;
    const outcome = this.#outlineOutcome;
    if (outcome?.status !== "ready") return;
    type Draft = {
      entry: DocumentOutlineEntry;
      children: Draft[];
      replacement?: DocumentOutlineEntry;
    };
    type Task = { draft: Draft; visited: boolean };
    const roots: Draft[] = outcome.items.map(entry => ({ entry, children: [] }));
    const tasks = roots
      .slice()
      .reverse()
      .map(draft => ({ draft, visited: false }));
    while (tasks.length) {
      const task = tasks.pop()!;
      if (!task.visited) {
        tasks.push({ draft: task.draft, visited: true });
        task.draft.children = task.draft.entry.children.map(entry => ({ entry, children: [] }));
        for (let index = task.draft.children.length - 1; index >= 0; index--)
          tasks.push({ draft: task.draft.children[index]!, visited: false });
        continue;
      }
      const entry = task.draft.entry;
      task.draft.replacement = Object.freeze({
        key: entry.key,
        title: entry.fallbackTitle ? label : entry.title,
        ...(entry.fallbackTitle ? { fallbackTitle: true as const } : {}),
        destinationStatus: entry.destinationStatus,
        destination: entry.destination,
        children: Object.freeze(task.draft.children.map(child => child.replacement!)),
      });
    }
    const items = Object.freeze(roots.map(root => root.replacement!));
    const entriesByKey = new Map<string, DocumentOutlineEntry>();
    const stack = items.slice().reverse();
    while (stack.length) {
      const entry = stack.pop()!;
      entriesByKey.set(entry.key, entry);
      for (let index = entry.children.length - 1; index >= 0; index--)
        stack.push(entry.children[index]!);
    }
    const replacement = Object.freeze({
      status: "ready" as const,
      itemCount: outcome.itemCount,
      items,
    });
    this.#outlineEntries = items;
    this.#outlineEntriesByKey = entriesByKey;
    this.#outlineOutcome = replacement;
    this.#outlinePromise = Promise.resolve(replacement);
  }

  /** Cancels timers and invalidates all pending document-local completion and callbacks. */
  public reset(): void {
    this.#lifecycleGeneration++;
    this.#navigationRequest++;
    this.#clearNavigationStateTimer();
    this.#outlinePromise = null;
    this.#outlineOutcome = null;
    this.#outlineEntries = [];
    this.#outlineTargets = [];
    this.#outlineTargetPages = new Map();
    this.#outlineEntriesByKey = new Map();
    this.#destinations = [];
    this.#destinationPages = new Map();
    this.#destinationsIndexed = false;
    this.#destinationIndexPromise = null;
    this.#stickyOutline = null;
    this.#stickyDestination = null;
    this.#lastSyncedDestinationId = null;
  }

  /** Invalidates viewport-space destination data after viewer rotation. */
  public invalidateRotation(): void {
    this.#lifecycleGeneration++;
    this.#navigationRequest++;
    this.#clearNavigationStateTimer();
    this.#outlinePromise = null;
    this.#outlineOutcome = null;
    this.#outlineEntries = [];
    this.#outlineTargets = [];
    this.#outlineTargetPages = new Map();
    this.#outlineEntriesByKey = new Map();
    this.#destinations = [];
    this.#destinationPages = new Map();
    this.#destinationsIndexed = false;
    this.#destinationIndexPromise = null;
    this.#stickyOutline = null;
    this.#stickyDestination = null;
    this.#lastSyncedDestinationId = null;
  }

  /** Starts, or joins, detached outline preparation for the current document. */
  public prepareOutline(host: DocumentNavigationHost): Promise<DocumentOutlinePreparationOutcome> {
    if (this.#outlinePromise) return this.#outlinePromise;
    if (this.#outlineOutcome) return Promise.resolve(this.#outlineOutcome);
    const pdf = host.getPdf();
    if (!pdf) return Promise.resolve(this.#cancelledOutline());
    const documentGeneration = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const preparation = this.#buildOutline(host, pdf, documentGeneration, lifecycleGeneration);
    this.#outlinePromise = preparation;
    return preparation;
  }

  /** Returns a detached, optionally title-filtered public outline snapshot. */
  public async getOutline(
    host: DocumentNavigationHost,
    query: string,
    matching: NormalizedTextQueryOptions,
  ): Promise<PdfjsViewerOutlineResult> {
    const pdf = host.getPdf();
    if (!pdf) return { ok: false, reason: "not-ready" };
    const generation = host.getDocumentGeneration();
    const outcome = await this.#waitForPreparation(
      this.prepareOutline(host),
      host.getDocumentSignal(),
    );
    if (!host.isCurrentDocument(pdf, generation) || outcome.status === "cancelled")
      return { ok: false, reason: "cancelled" };
    if (outcome.status === "error") return { ok: false, reason: "error", error: outcome.error };
    const compiledQuery = query ? compileTextQuery(query, matching) : null;
    return { ok: true, items: this.#cloneOutline(outcome.items, compiledQuery) };
  }

  /** Starts shared PDF named-destination indexing without forcing outline preparation. */
  public prepareDestinations(host: DocumentNavigationHost): Promise<void> {
    const pdf = host.getPdf();
    return pdf
      ? this.#buildDestinationIndex(
          host,
          pdf,
          host.getDocumentGeneration(),
          this.#lifecycleGeneration,
        )
      : Promise.resolve();
  }

  /** Returns the active outline semantic key for current viewport geometry. */
  public activeOutlineKey(host: DocumentNavigationHost): string | null {
    if (this.#stickyOutline && this.#stickyActive(host, this.#stickyOutline))
      return this.#stickyOutline.key;
    this.#stickyOutline = null;
    const index = this.#predecessorIndex(this.#outlineTargets, host.viewportPosition());
    return index >= 0 ? this.#outlineTargets[index]!.key : null;
  }

  /** Selects an outline destination by semantic key and returns facade movement. */
  public selectOutlineDestination(
    host: DocumentNavigationHost,
    key: string,
  ): DocumentNavigationIntent | null {
    const entry = this.#outlineEntriesByKey.get(key);
    if (!entry?.destination) return null;
    const target = entry.destination;
    this.#stickToSpot(
      host,
      target.page,
      target.yRatio,
      target.navigationDestinationId ?? null,
      target.xRatio,
      key,
    );
    return {
      page: target.page,
      yRatio: target.yRatio,
      ...(target.xRatio == null ? {} : { xRatio: target.xRatio }),
      usePosition: false,
      smooth: true,
    };
  }

  /**
   * Debounces persisted state writes with document-generation and timer-identity ownership.
   * A cancelled callback delivered late cannot write through a replacement host or clear a
   * newer timer scheduled within the same document lifetime.
   */
  public scheduleNavigationStateSync(host: DocumentNavigationHost): void {
    if (
      !host.navigationState ||
      !host.shareableNamedDestinationPrefix ||
      !host.canWriteNavigationState()
    )
      return;
    this.#clearNavigationStateTimer();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const timer = host.setNavigationStateTimeout(() => {
      if (lifecycleGeneration !== this.#lifecycleGeneration || this.#syncTimer !== timer) return;
      this.#syncTimer = null;
      this.#clearSyncTimer = null;
      this.#syncNavigationState(host);
    }, 60);
    this.#syncTimer = timer;
    this.#clearSyncTimer = scheduledTimer => host.clearNavigationStateTimeout(scheduledTimer);
  }

  /** Resolves a PDF named destination without adopting or executing movement. */
  public async resolvePdfNamedDestination(
    host: DocumentNavigationHost,
    pdfNamedDestination: string,
    options: PdfjsViewerPdfNamedDestinationNavigationOptions,
  ): Promise<DocumentNamedDestinationOutcome> {
    if (typeof pdfNamedDestination !== "string")
      throw new TypeError("PdfjsViewer: named destination must be a string");
    if (!options || typeof options !== "object")
      throw new TypeError("PdfjsViewer: named destination options must be an object");
    if (!pdfNamedDestination) return { ok: false, pdfNamedDestination, reason: "invalid-name" };
    const pdf = host.getPdf();
    if (!pdf) return { ok: false, pdfNamedDestination, reason: "not-ready" };
    if (options.signal?.aborted) return { ok: false, pdfNamedDestination, reason: "cancelled" };
    const request = ++this.#navigationRequest;
    const generation = host.getDocumentGeneration();
    let resolved: ResolvedPdfDestination | null;
    try {
      resolved = await resolvePdfDestination(
        pdf,
        pdfNamedDestination,
        this.#pageAcquirer(host),
        host.rotation(),
      );
    } catch (error) {
      return { ok: false, pdfNamedDestination, reason: "error", error };
    }
    if (
      options.signal?.aborted ||
      request !== this.#navigationRequest ||
      !host.isCurrentDocument(pdf, generation)
    ) {
      return { ok: false, pdfNamedDestination, reason: "cancelled" };
    }
    if (!resolved) return { ok: false, pdfNamedDestination, reason: "not-found" };
    const page = resolved.pageIndex + 1;
    const yRatio = this.#ratio(resolved.yRatio);
    return {
      ok: true,
      pdfNamedDestination,
      intent: {
        page,
        yRatio,
        ...(resolved.xRatio == null ? {} : { xRatio: resolved.xRatio }),
        usePosition:
          options.spotWithinPage === true && (resolved.yRatio != null || resolved.xRatio != null),
        smooth: options.smooth === true,
      },
    };
  }

  /** Re-reads persisted state and returns a request for facade-owned navigation. */
  public navigationRequestFromState(
    host: DocumentNavigationHost,
    smooth: boolean,
  ): DocumentPersistedNavigationRequest | null {
    const id = host.navigationState?.readNavigationDestinationId()?.trim();
    if (!id || !host.shareableNamedDestinationPrefix) return null;
    return { pdfNamedDestination: host.shareableNamedDestinationPrefix + id, smooth };
  }

  /** Selects a destination already resolved by the facade before movement. */
  public selectResolvedDestination(
    host: DocumentNavigationHost,
    destination: { pageNo: number; yRatio?: number; xRatio?: number },
    pdfNamedDestination?: string,
  ): void {
    const hasY = typeof destination.yRatio === "number" && Number.isFinite(destination.yRatio);
    const yRatio = this.#ratio(destination.yRatio);
    const xRatio =
      typeof destination.xRatio === "number" && Number.isFinite(destination.xRatio)
        ? this.#ratio(destination.xRatio)
        : undefined;
    const namedId =
      pdfNamedDestination == null ? null : this.#idForPdfDestination(host, pdfNamedDestination);
    const firstOnPage =
      !hasY && namedId == null
        ? (this.#destinationOnPage(destination.pageNo, 0)?.navigationDestinationId ?? null)
        : undefined;
    this.#stickToSpot(host, destination.pageNo, yRatio, namedId ?? firstOnPage, xRatio);
  }

  async #buildOutline(
    host: DocumentNavigationHost,
    pdf: PDFJS.PDFDocumentProxy,
    documentGeneration: number,
    lifecycleGeneration: number,
  ): Promise<DocumentOutlinePreparationOutcome> {
    try {
      const outline = (await pdf.getOutline()) as unknown;
      if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration))
        return this.#cancelledOutline();
      const normalized = this.#normalizeOutline(outline);
      await this.#buildDestinationIndex(host, pdf, documentGeneration, lifecycleGeneration);
      await this.#resolveOutlineDestinations(
        host,
        pdf,
        documentGeneration,
        lifecycleGeneration,
        normalized.jobs,
      );
      if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration))
        return this.#cancelledOutline();
      const entries = this.#freezeOutlineDrafts(normalized.items);
      const { itemCount, entriesByKey, targets } = this.#indexOutline(entries);
      targets.sort(
        (a, b) =>
          a.pageNo - b.pageNo ||
          a.yRatio - b.yRatio ||
          (a.xRatio ?? 0) - (b.xRatio ?? 0) ||
          a.ordinal - b.ordinal,
      );
      const frozenEntries = Object.freeze(entries);
      const frozenTargets = Object.freeze(targets);
      const outcome = Object.freeze({ status: "ready" as const, itemCount, items: frozenEntries });
      if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration))
        return this.#cancelledOutline();
      const targetPages = this.#pageRanges(frozenTargets);
      this.#outlineEntries = frozenEntries;
      this.#outlineTargets = frozenTargets;
      this.#outlineTargetPages = targetPages;
      this.#outlineEntriesByKey = entriesByKey;
      if (this.#stickyOutline?.key === null) {
        this.#stickyOutline.key =
          this.#outlineTargetForSpot(host, this.#stickyOutline.pageNo, this.#stickyOutline.yRatio)
            ?.key ?? null;
      }
      this.#outlineOutcome = outcome;
      return outcome;
    } catch (error) {
      if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration))
        return this.#cancelledOutline();
      const outcome = Object.freeze({
        status: "error" as const,
        itemCount: 0 as const,
        items: EMPTY_OUTLINE_ITEMS,
        error,
      });
      this.#outlineEntries = [];
      this.#outlineTargets = [];
      this.#outlineTargetPages = new Map();
      this.#outlineEntriesByKey = new Map();
      this.#outlineOutcome = outcome;
      return outcome;
    }
  }

  #normalizeOutline(outline: unknown): { items: OutlineDraft[]; jobs: OutlineDestinationJob[] } {
    if (outline !== null && !Array.isArray(outline))
      throw new TypeError("PDF.js returned a malformed outline root");
    const items: OutlineDraft[] = [];
    const jobs: OutlineDestinationJob[] = [];
    if (outline === null) return { items, jobs };
    let ordinal = 0;
    const activeObjects = new Set<object>();
    const activeArrays = new Set<readonly unknown[]>();
    type Task =
      | { type: "node"; value: unknown; parent: OutlineDraft[] }
      | { type: "exit-object"; value: object }
      | { type: "exit-array"; value: readonly unknown[] };
    const tasks: Task[] = [
      { type: "exit-array", value: outline },
      ...outline
        .slice()
        .reverse()
        .map(value => ({ type: "node" as const, value, parent: items })),
    ];
    activeArrays.add(outline);
    while (tasks.length) {
      const task = tasks.pop()!;
      if (task.type === "exit-object") {
        activeObjects.delete(task.value);
        continue;
      }
      if (task.type === "exit-array") {
        activeArrays.delete(task.value);
        continue;
      }
      if (typeof task.value !== "object" || task.value === null || Array.isArray(task.value))
        continue;
      const node = task.value as OutlineNodeLike;
      if (activeObjects.has(node))
        throw new TypeError("PDF.js outline contains an ancestor object cycle");
      activeObjects.add(node);
      const rawDestination = node.dest;
      const destinationInput: PdfDestinationInput =
        typeof rawDestination === "string" ||
        Array.isArray(rawDestination) ||
        rawDestination == null
          ? rawDestination
          : undefined;
      const draft: OutlineDraft = {
        key: String(ordinal),
        ordinal: ordinal++,
        title: typeof node.title === "string" ? node.title : this.#untitledLabel,
        ...(typeof node.title === "string" ? {} : { fallbackTitle: true as const }),
        destinationInput,
        destinationStatus: rawDestination == null ? "none" : "unresolved",
        destination: null,
        children: [],
      };
      task.parent.push(draft);
      if (destinationInput != null) jobs.push({ draft, destination: destinationInput });
      const rawItems = node.items;
      tasks.push({ type: "exit-object", value: node });
      if (!Array.isArray(rawItems)) continue;
      if (activeArrays.has(rawItems))
        throw new TypeError("PDF.js outline contains an ancestor array cycle");
      activeArrays.add(rawItems);
      tasks.push({ type: "exit-array", value: rawItems });
      for (let index = rawItems.length - 1; index >= 0; index--)
        tasks.push({ type: "node", value: rawItems[index], parent: draft.children });
    }
    return { items, jobs };
  }

  async #resolveOutlineDestinations(
    host: DocumentNavigationHost,
    pdf: PDFJS.PDFDocumentProxy,
    documentGeneration: number,
    lifecycleGeneration: number,
    jobs: readonly OutlineDestinationJob[],
  ): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration)) {
        const job = jobs[next++];
        if (!job) return;
        let resolved: ResolvedPdfDestination | null = null;
        try {
          resolved = await resolvePdfDestination(
            pdf,
            job.destination,
            this.#pageAcquirer(host),
            host.rotation(),
          );
        } catch {}
        if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration)) return;
        if (!resolved) continue;
        const page = resolved.pageIndex + 1;
        const yRatio = this.#ratio(resolved.yRatio);
        const xRatio = resolved.xRatio == null ? undefined : this.#ratio(resolved.xRatio);
        const nearby = this.#nearbyDestination(host, page, yRatio, xRatio);
        job.draft.destination = Object.freeze({
          page,
          yRatio,
          ...(xRatio == null ? {} : { xRatio }),
          ...(typeof job.destination === "string" ? { pdfNamedDestination: job.destination } : {}),
          ...(nearby ? { navigationDestinationId: nearby.navigationDestinationId } : {}),
        });
        job.draft.destinationStatus = "resolved";
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(OUTLINE_DESTINATION_CONCURRENCY, jobs.length) }, worker),
    );
  }

  #buildDestinationIndex(
    host: DocumentNavigationHost,
    pdf: PDFJS.PDFDocumentProxy,
    documentGeneration: number,
    lifecycleGeneration: number,
  ): Promise<void> {
    if (this.#destinationsIndexed || !host.shareableNamedDestinationPrefix || !host.navigationState)
      return Promise.resolve();
    if (this.#destinationIndexPromise) return this.#destinationIndexPromise;
    const job = (async () => {
      try {
        const destinations = await pdf.getDestinations();
        if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration)) return;
        const prefix = host.shareableNamedDestinationPrefix!;
        const result: NavigationDestination[] = [];
        for (const [name, destination] of destinations) {
          if (!name.startsWith(prefix)) continue;
          const resolved = await resolvePdfDestination(
            pdf,
            destination,
            this.#pageAcquirer(host),
            host.rotation(),
          );
          if (!this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration)) return;
          if (resolved)
            result.push({
              navigationDestinationId: name.slice(prefix.length),
              pageNo: resolved.pageIndex + 1,
              yRatio: this.#ratio(resolved.yRatio),
              ...(resolved.xRatio == null ? {} : { xRatio: this.#ratio(resolved.xRatio) }),
            });
        }
        result.sort(
          (a, b) =>
            a.pageNo - b.pageNo ||
            a.yRatio - b.yRatio ||
            (a.xRatio ?? 0) - (b.xRatio ?? 0) ||
            a.navigationDestinationId.localeCompare(b.navigationDestinationId),
        );
        this.#destinations = Object.freeze(result);
        this.#destinationPages = this.#pageRanges(result);
      } catch {
      } finally {
        if (this.#isCurrent(host, pdf, documentGeneration, lifecycleGeneration)) {
          this.#destinationsIndexed = true;
          this.scheduleNavigationStateSync(host);
        }
      }
    })();
    this.#destinationIndexPromise = job;
    void job.finally(() => {
      if (this.#destinationIndexPromise === job) this.#destinationIndexPromise = null;
    });
    return job;
  }

  #stickToSpot(
    host: DocumentNavigationHost,
    pageNo: number,
    yRatio: number,
    id?: string | null,
    xRatio?: number,
    outlineKey?: string | null,
  ): void {
    this.#stickyOutline = {
      key:
        outlineKey === undefined
          ? (this.#outlineTargetForSpot(host, pageNo, yRatio)?.key ?? null)
          : outlineKey,
      pageNo,
      yRatio,
      seen: false,
    };
    this.#stickyDestination = {
      navigationDestinationId:
        id ??
        this.#nearbyDestination(host, pageNo, yRatio, xRatio)?.navigationDestinationId ??
        null,
      pageNo,
      yRatio,
      seen: false,
    };
    this.scheduleNavigationStateSync(host);
  }

  #stickyActive(
    host: DocumentNavigationHost,
    selection: { pageNo: number; yRatio: number; seen: boolean },
  ): boolean {
    const pageTop = host.pageTopFor(selection.pageNo);
    if (pageTop == null) return !selection.seen;
    const anchor = pageTop + selection.yRatio * host.pageHeightFor(selection.pageNo);
    const active =
      anchor >= host.scrollTop() - 1 && anchor <= host.scrollTop() + host.viewportHeight() + 1;
    if (active) selection.seen = true;
    return active || !selection.seen;
  }

  #nearbyDestination(
    host: DocumentNavigationHost,
    page: number,
    y: number,
    x?: number,
  ): NavigationDestination | null {
    const range = this.#destinationPages.get(page);
    if (!range) return null;
    const tolerance = host.destinationMatchTolerance;
    let index = this.#lowerBound(
      this.#destinations,
      y - tolerance,
      destination => destination.yRatio,
      range.start,
      range.end,
    );
    let nearby: NavigationDestination | null = null;
    for (; index < range.end; index++) {
      const destination = this.#destinations[index]!;
      if (destination.yRatio > y + tolerance) break;
      if (!nearby || this.#compareNearbyDestination(destination, nearby, y, x) < 0)
        nearby = destination;
    }
    return nearby;
  }

  #outlineTargetForSpot(
    host: DocumentNavigationHost,
    pageNo: number,
    yRatio: number,
  ): OutlineTarget | null {
    const range = this.#outlineTargetPages.get(pageNo);
    if (range) {
      const tolerance = host.destinationMatchTolerance;
      let index = this.#lowerBound(
        this.#outlineTargets,
        yRatio - tolerance,
        target => target.yRatio,
        range.start,
        range.end,
      );
      let nearby: OutlineTarget | null = null;
      let nearbyDistance = Infinity;
      for (; index < range.end; index++) {
        const target = this.#outlineTargets[index]!;
        if (target.yRatio > yRatio + tolerance) break;
        const distance = Math.abs(target.yRatio - yRatio);
        if (distance < nearbyDistance) {
          nearby = target;
          nearbyDistance = distance;
        }
      }
      if (nearby) return nearby;
    }
    const index = this.#upperBoundSpot(pageNo, yRatio);
    return index > 0 ? this.#outlineTargets[index - 1]! : null;
  }

  #syncNavigationState(host: DocumentNavigationHost): void {
    if (!host.navigationState || !host.canWriteNavigationState()) return;
    let id: string | null = null;
    if (this.#stickyDestination && this.#stickyActive(host, this.#stickyDestination))
      id = this.#stickyDestination.navigationDestinationId;
    else {
      this.#stickyDestination = null;
      const index = this.#predecessorIndex(this.#destinations, host.viewportPosition());
      id = index >= 0 ? this.#destinations[index]!.navigationDestinationId : null;
    }
    if (
      id === this.#lastSyncedDestinationId &&
      id === (host.navigationState.readNavigationDestinationId()?.trim() || null)
    )
      return;
    this.#lastSyncedDestinationId = id;
    host.navigationState.writeNavigationDestinationId(id);
  }

  #clearNavigationStateTimer(): void {
    if (this.#syncTimer != null) this.#clearSyncTimer?.(this.#syncTimer);
    this.#syncTimer = null;
    this.#clearSyncTimer = null;
  }

  #pageAcquirer(host: DocumentNavigationHost) {
    return { acquire: (pageNo: number) => host.acquirePage(pageNo) };
  }

  #freezeOutlineDrafts(items: OutlineDraft[]): DocumentOutlineEntry[] {
    type Task = { draft: OutlineDraft; visited: boolean };
    const tasks = items
      .slice()
      .reverse()
      .map(draft => ({ draft, visited: false }));
    while (tasks.length) {
      const task = tasks.pop()!;
      if (!task.visited) {
        tasks.push({ draft: task.draft, visited: true });
        for (let index = task.draft.children.length - 1; index >= 0; index--)
          tasks.push({ draft: task.draft.children[index]!, visited: false });
        continue;
      }
      task.draft.entry = Object.freeze({
        key: task.draft.key,
        title: task.draft.fallbackTitle ? this.#untitledLabel : task.draft.title,
        ...(task.draft.fallbackTitle ? { fallbackTitle: true as const } : {}),
        destinationStatus: task.draft.destinationStatus,
        destination: task.draft.destination,
        children: Object.freeze(task.draft.children.map(child => child.entry!)),
      });
    }
    return items.map(item => item.entry!);
  }

  #indexOutline(entries: readonly DocumentOutlineEntry[]): {
    itemCount: number;
    entriesByKey: ReadonlyMap<string, DocumentOutlineEntry>;
    targets: OutlineTarget[];
  } {
    let itemCount = 0;
    const entriesByKey = new Map<string, DocumentOutlineEntry>();
    const targets: OutlineTarget[] = [];
    const stack = entries.slice().reverse();
    while (stack.length) {
      const entry = stack.pop()!;
      const ordinal = itemCount++;
      entriesByKey.set(entry.key, entry);
      if (entry.destination)
        targets.push({
          key: entry.key,
          pageNo: entry.destination.page,
          yRatio: entry.destination.yRatio,
          ...(entry.destination.xRatio == null ? {} : { xRatio: entry.destination.xRatio }),
          ordinal,
        });
      for (let index = entry.children.length - 1; index >= 0; index--)
        stack.push(entry.children[index]!);
    }
    return { itemCount, entriesByKey, targets };
  }

  #cloneOutline(
    entries: readonly DocumentOutlineEntry[],
    compiledQuery: ReturnType<typeof compileTextQuery> | null,
  ): PdfjsViewerOutlineItem[] {
    type CloneDraft = {
      item: DocumentOutlineEntry;
      children: PdfjsViewerOutlineItem[];
      childDrafts?: CloneDraft[];
      result?: PdfjsViewerOutlineItem | null;
    };
    type Task = { draft: CloneDraft; visited: boolean };
    const roots: CloneDraft[] = entries.map(item => ({ item, children: [] }));
    const tasks = roots
      .slice()
      .reverse()
      .map(draft => ({ draft, visited: false }));
    while (tasks.length) {
      const task = tasks.pop()!;
      if (!task.visited) {
        tasks.push({ draft: task.draft, visited: true });
        const children = task.draft.item.children.map(item => ({
          item,
          children: [] as PdfjsViewerOutlineItem[],
        }));
        task.draft.childDrafts = children;
        for (let index = children.length - 1; index >= 0; index--)
          tasks.push({ draft: children[index]!, visited: false });
        continue;
      }
      const childDrafts = task.draft.childDrafts ?? [];
      for (const child of childDrafts) if (child.result) task.draft.children.push(child.result);
      if (
        compiledQuery &&
        !hasCompiledTextMatch(task.draft.item.title, compiledQuery) &&
        !task.draft.children.length
      )
        task.draft.result = null;
      else
        task.draft.result = {
          title: task.draft.item.title,
          destinationStatus: task.draft.item.destinationStatus,
          destination: task.draft.item.destination ? { ...task.draft.item.destination } : null,
          children: task.draft.children,
        };
    }
    return roots.flatMap(root => (root.result ? [root.result] : []));
  }

  #pageRanges<T extends { pageNo: number }>(items: readonly T[]): ReadonlyMap<number, PageRange> {
    const ranges = new Map<number, PageRange>();
    for (let start = 0; start < items.length;) {
      const pageNo = items[start]!.pageNo;
      let end = start + 1;
      while (end < items.length && items[end]!.pageNo === pageNo) end++;
      ranges.set(pageNo, Object.freeze({ start, end }));
      start = end;
    }
    return ranges;
  }

  #destinationOnPage(pageNo: number, offset: number): NavigationDestination | null {
    const range = this.#destinationPages.get(pageNo);
    return range && range.start + offset < range.end
      ? this.#destinations[range.start + offset]!
      : null;
  }

  #compareNearbyDestination(
    a: NavigationDestination,
    b: NavigationDestination,
    y: number,
    x?: number,
  ): number {
    return (
      Math.abs(a.yRatio - y) - Math.abs(b.yRatio - y) ||
      Math.abs((a.xRatio ?? Infinity) - (x ?? Infinity)) -
        Math.abs((b.xRatio ?? Infinity) - (x ?? Infinity)) ||
      a.navigationDestinationId.localeCompare(b.navigationDestinationId)
    );
  }

  #upperBoundSpot(pageNo: number, yRatio: number): number {
    let low = 0;
    let high = this.#outlineTargets.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const target = this.#outlineTargets[mid]!;
      if (target.pageNo < pageNo || (target.pageNo === pageNo && target.yRatio <= yRatio))
        low = mid + 1;
      else high = mid;
    }
    return low;
  }

  #predecessorIndex<T extends { pageNo: number; yRatio: number; xRatio?: number }>(
    items: readonly T[],
    position: Readonly<DocumentReadingPosition>,
  ): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const item = items[mid]!;
      const beforeOrAt =
        item.pageNo < position.pageNo ||
        (item.pageNo === position.pageNo &&
          (item.yRatio < position.yRatio ||
            (item.yRatio === position.yRatio && (item.xRatio ?? 0) <= position.xRatio)));
      if (beforeOrAt) low = mid + 1;
      else high = mid;
    }
    let index = low - 1;
    if (index < 0) return -1;
    const selected = items[index]!;
    while (index > 0) {
      const previous = items[index - 1]!;
      if (
        previous.pageNo !== selected.pageNo ||
        previous.yRatio !== selected.yRatio ||
        (previous.xRatio ?? 0) !== (selected.xRatio ?? 0)
      )
        break;
      index--;
    }
    return index;
  }

  #lowerBound<T>(
    items: readonly T[],
    value: number,
    read: (item: T) => number,
    start = 0,
    end = items.length,
  ): number {
    let low = start;
    let high = end;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (read(items[mid]!) < value) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  #upperBound<T>(items: readonly T[], value: number, read: (item: T) => number): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (read(items[mid]!) <= value) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  #isCurrent(
    host: DocumentNavigationHost,
    pdf: PDFJS.PDFDocumentProxy,
    documentGeneration: number,
    lifecycleGeneration: number,
  ): boolean {
    return (
      lifecycleGeneration === this.#lifecycleGeneration &&
      host.isCurrentDocument(pdf, documentGeneration)
    );
  }

  #waitForPreparation(
    promise: Promise<DocumentOutlinePreparationOutcome>,
    signal: AbortSignal,
  ): Promise<DocumentOutlinePreparationOutcome> {
    if (signal.aborted) return Promise.resolve(this.#cancelledOutline());
    return new Promise(resolve => {
      const finish = (outcome: DocumentOutlinePreparationOutcome) => {
        signal.removeEventListener("abort", cancel);
        resolve(outcome);
      };
      const cancel = () => finish(this.#cancelledOutline());
      signal.addEventListener("abort", cancel, { once: true });
      void promise.then(finish, () => finish(this.#cancelledOutline()));
    });
  }

  #cancelledOutline(): DocumentOutlinePreparationOutcome {
    return CANCELLED_OUTLINE_OUTCOME;
  }
  #idForPdfDestination(host: DocumentNavigationHost, destination: string): string | null {
    const prefix = host.shareableNamedDestinationPrefix;
    return prefix && destination.startsWith(prefix)
      ? destination.slice(prefix.length).trim() || null
      : null;
  }
  #ratio(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  }
}
