// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private fixed-geometry page resolver, immutable acquisition scopes and bounded auxiliary pool.
 * This is not a supported consumer subpath. The canonical document remains owned
 * by the facade. See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module document-page-sources
 */
import type * as PDFJS from "pdfjs-dist";
import type { DocumentFonts } from "./document-fonts.js";
import {
  DocumentPageUsage,
  type DocumentPageAcquirer,
  type DocumentPageUse,
} from "./document-page-usage.js";
import type {
  PdfjsViewerPageSource,
  PdfjsViewerPageSourcePreparationOptions,
  PdfjsViewerPageSourcePreparationResult,
  PdfjsViewerPageSourceMutationResult,
  PdfjsViewerPageSourceOverride,
  PdfjsViewerPageSourceMutationOptions,
  PdfjsViewerPageSourceFailure,
} from "./viewer-contracts.js";

type Geometry = { view: readonly number[]; rotation: number; userUnit: number };
type Loaded = { pdf: PDFJS.PDFDocumentProxy; dispose: () => Promise<void>; fonts?: DocumentFonts };
type Live = Loaded & {
  usage: DocumentPageUsage;
  optionalContentConfigPromise: ReturnType<PDFJS.PDFDocumentProxy["getOptionalContentConfig"]>;
};
type Opening = { promise: Promise<Live>; abort: AbortController; waiters: number };
type Entry = {
  handle: PdfjsViewerPageSource;
  bytes?: Uint8Array;
  blob?: Blob;
  caller: boolean;
  maps: number;
  snapshots: number;
  uses: number;
  touched: number;
  geometry: readonly Geometry[];
  linkContext: "source" | "base";
  live?: Live;
  opening?: Opening;
  destroying?: Promise<void>;
};
type Mapping = { entry: Entry; sourcePage: number };

/** Private selected-page scope; retains backing, never live readers or copied PDF bytes. */
export interface DocumentPageSourceSnapshot extends DocumentPageAcquirer {
  /** Whole-map revision captured synchronously with the selected slots. */
  readonly mappingRevision: number;
  /** Returns the captured slot revision; rejects unselected pages and released scopes. */
  revision(page: number): number;
  /** Revokes new reads and drops backing pins; admitted physical uses settle independently. */
  release(): void;
}

/** Loader ownership is injected; this owner never creates a worker/loading task. */
export interface DocumentPageSourcesOptions {
  load(data: Uint8Array, signal?: AbortSignal): Promise<Loaded>;
  limits?: Partial<{
    maxBytes: number;
    maxBlobBytes: number;
    maxLiveBytes: number;
    maxLiveDocuments: number;
    maxSources: number;
    maxSourcePages: number;
    maxBatchPages: number;
  }>;
  changed?(pages: ReadonlySet<number>, revision: number): void;
}

class SourceFailure extends Error {
  constructor(readonly reason: PdfjsViewerPageSourceFailure["reason"]) {
    super(reason);
  }
}

function geometry(page: PDFJS.PDFPageProxy): Geometry {
  const view = Array.from(page.view);
  if (
    view.length !== 4 ||
    !view.every(Number.isFinite) ||
    view[2] <= view[0] ||
    view[3] <= view[1] ||
    !Number.isFinite(view[2] - view[0]) ||
    !Number.isFinite(view[3] - view[1]) ||
    !Number.isFinite(page.rotate) ||
    page.rotate % 90 !== 0 ||
    !Number.isFinite(page.userUnit) ||
    page.userUnit <= 0
  ) {
    throw new SourceFailure("invalid-page");
  }
  return Object.freeze({
    view: Object.freeze(view),
    rotation: ((page.rotate % 360) + 360) % 360,
    userUnit: page.userUnit,
  });
}

function matches(a: Geometry, b: Geometry): boolean {
  return (
    a.rotation === b.rotation &&
    Math.abs(a.userUnit - b.userUnit) <= 1e-6 &&
    a.view.every((value, index) => Math.abs(value - b.view[index]) <= 1e-4)
  );
}

/** Uses only supported public PDF.js document inspection APIs, failing closed. */
async function readonlyDocument(pdf: PDFJS.PDFDocumentProxy): Promise<void> {
  if (
    typeof pdf.getPermissions !== "function" ||
    typeof pdf.getMetadata !== "function" ||
    typeof pdf.getFieldObjects !== "function" ||
    typeof pdf.isPureXfa !== "boolean"
  ) {
    throw new SourceFailure("unsupported");
  }
  const [permissions, metadata, fields] = await Promise.all([
    pdf.getPermissions(),
    pdf.getMetadata(),
    pdf.getFieldObjects(),
  ]);
  const info = metadata?.info as Record<string, unknown> | undefined;
  if (
    !info ||
    typeof info !== "object" ||
    !["IsAcroFormPresent", "IsXFAPresent", "IsSignaturesPresent"].every(
      key => typeof info[key] === "boolean",
    )
  ) {
    throw new SourceFailure("unsupported");
  }
  if (
    permissions !== null ||
    pdf.isPureXfa ||
    info.IsAcroFormPresent ||
    info.IsXFAPresent ||
    info.IsSignaturesPresent ||
    (fields !== null && (!(fields instanceof Map) || fields.size !== 0))
  )
    throw new SourceFailure("unsupported");
}

function numericDestination(destination: unknown): destination is unknown[] {
  return Array.isArray(destination) && Number.isInteger(destination[0]) && destination[0] >= 0;
}

/** Owns immutable source bytes, atomic mappings, and every auxiliary physical use. */
export class DocumentPageSources implements DocumentPageAcquirer {
  #base: PDFJS.PDFDocumentProxy;
  #baseAcquirer: DocumentPageAcquirer;
  #options: DocumentPageSourcesOptions;
  #limits: Required<NonNullable<DocumentPageSourcesOptions["limits"]>>;
  #entries = new Set<Entry>();
  #handles = new WeakMap<PdfjsViewerPageSource, Entry>();
  #mappings = new Map<number, Mapping>();
  #revisions = new Map<number, number>();
  #geometry = new Map<number, Promise<Geometry>>();
  #baseValidation?: Promise<void>;
  #bytes = 0;
  #blobBytes = 0;
  #slots = 0;
  #liveBytes = 0;
  #clock = 0;
  #nextId = 0;
  #revision = 0;
  #sequence = 0;
  #closed = false;
  #abort = new AbortController();
  #queue: Promise<void> = Promise.resolve();
  #jobs = new Set<Promise<unknown>>();
  #snapshots = new Set<() => void>();
  #waiters = new Set<() => void>();
  #closePromise?: Promise<void>;

  constructor(
    basePdf: PDFJS.PDFDocumentProxy,
    baseAcquirer: DocumentPageAcquirer,
    options: DocumentPageSourcesOptions,
  ) {
    this.#base = basePdf;
    this.#baseAcquirer = baseAcquirer;
    this.#options = options;
    this.#limits = {
      maxBytes: 64 * 1024 * 1024,
      maxBlobBytes: 256 * 1024 * 1024,
      maxLiveBytes: 64 * 1024 * 1024,
      maxLiveDocuments: 4,
      // Permit a full candidate set beside installed sources for atomic replacement.
      maxSources: Math.max(128, 2 * basePdf.numPages),
      maxSourcePages: 128,
      maxBatchPages: Math.max(128, basePdf.numPages),
      ...options.limits,
    };
    for (const value of Object.values(this.#limits))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError("Source limits must be positive safe integers");
  }

  /** Snapshots mutable bytes or retains native immutable Blob backing, then validates. */
  async prepare(
    data: Uint8Array | Blob,
    options: PdfjsViewerPageSourcePreparationOptions = {},
  ): Promise<PdfjsViewerPageSourcePreparationResult> {
    if (this.#closed) return { ok: false, reason: "destroyed" };
    if (options.signal?.aborted) return { ok: false, reason: "cancelled" };
    if (
      options.linkContext !== undefined &&
      options.linkContext !== "source" &&
      options.linkContext !== "base"
    )
      return { ok: false, reason: "unsupported" };
    let blob: Blob | undefined;
    const isBytes =
      ArrayBuffer.isView(data) && Object.prototype.toString.call(data) === "[object Uint8Array]";
    if (!isBytes) {
      try {
        // Native brand checking also accepts foreign-realm Blobs, but not lookalikes.
        // Slicing bypasses subclass overrides and retains only immutable native backing.
        blob = Blob.prototype.slice.call(data);
      } catch {
        return { ok: false, reason: "invalid-source" };
      }
    }
    const byteLength = blob ? blob.size : (data as Uint8Array).byteLength;
    if (!byteLength) return { ok: false, reason: "invalid-source" };
    if (
      this.#entries.size >= this.#limits.maxSources ||
      byteLength >
        (blob
          ? this.#limits.maxBlobBytes - this.#blobBytes
          : this.#limits.maxBytes - this.#bytes) ||
      byteLength > this.#limits.maxLiveBytes
    )
      return { ok: false, reason: "resource-limit" };
    const bytes = blob ? undefined : new Uint8Array(data as Uint8Array);
    let entry!: Entry;
    let pageCount = 0;
    const handle: PdfjsViewerPageSource = Object.freeze({
      id: `source-${++this.#nextId}`,
      get pageCount() {
        return pageCount;
      },
      byteLength,
      release: () => {
        if (!entry.caller) return;
        entry.caller = false;
        this.#retire(entry);
      },
    });
    entry = {
      handle,
      bytes,
      blob,
      caller: true,
      maps: 0,
      snapshots: 0,
      uses: 1,
      touched: ++this.#clock,
      geometry: [],
      linkContext: options.linkContext ?? "source",
    };
    this.#entries.add(entry);
    this.#handles.set(handle, entry);
    if (blob) this.#blobBytes += byteLength;
    else this.#bytes += byteLength;
    let finish!: () => void;
    this.#track(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    const abort = () => this.#wake();
    options.signal?.addEventListener("abort", abort);
    try {
      const live = await this.#ensure(entry, options.signal);
      this.#check(options.signal);
      pageCount = live.pdf.numPages;
      if (!Number.isInteger(pageCount) || pageCount < 1) throw new SourceFailure("invalid-source");
      if (pageCount > this.#limits.maxSourcePages) throw new SourceFailure("resource-limit");
      await readonlyDocument(live.pdf);
      await live.optionalContentConfigPromise;
      const geometries: Geometry[] = [];
      for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
        this.#check(options.signal);
        const use = await live.usage.acquire(pageNo);
        try {
          geometries.push(geometry(use.page));
          const annotations: unknown = await use.page.getAnnotations({ intent: "any" });
          if (!Array.isArray(annotations)) throw new SourceFailure("unsupported");
          for (const annotation of annotations) this.#validateLink(annotation, entry.linkContext);
        } finally {
          use.release();
        }
      }
      this.#check(options.signal);
      entry.geometry = Object.freeze(geometries);
      return { ok: true, source: handle };
    } catch (error) {
      entry.caller = false;
      return this.#failure(error, options.signal);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.#release(entry);
      finish();
    }
  }

  /** Latest requested batch wins; pending earlier changes are never inherited. */
  async setOverrides(
    overrides: readonly PdfjsViewerPageSourceOverride[],
    options: PdfjsViewerPageSourceMutationOptions = {},
  ): Promise<PdfjsViewerPageSourceMutationResult> {
    const sequence = ++this.#sequence;
    if (this.#closed) return { ok: false, reason: "destroyed" };
    if (!Array.isArray(overrides) || overrides.length > this.#limits.maxBatchPages)
      return { ok: false, reason: "resource-limit" };
    const changes = new Map<number, Mapping | null>();
    try {
      this.#check(options.signal);
      for (const override of overrides) {
        if (!override || !this.#validPage(override.page) || changes.has(override.page))
          throw new SourceFailure("invalid-page");
        if (override.source === null) {
          changes.set(override.page, null);
          continue;
        }
        const entry = this.#handles.get(override.source);
        if (!entry?.caller || !this.#entries.has(entry)) throw new SourceFailure("invalid-source");
        if (
          !Number.isInteger(override.sourcePage) ||
          override.sourcePage < 1 ||
          override.sourcePage > entry.geometry.length
        )
          throw new SourceFailure("invalid-page");
        changes.set(override.page, { entry, sourcePage: override.sourcePage });
      }
      this.#baseValidation ??= this.#track(readonlyDocument(this.#base));
      await this.#baseValidation;
      for (const [page, mapping] of changes) {
        this.#check(options.signal);
        if (sequence !== this.#sequence) throw new SourceFailure("superseded");
        if (
          mapping &&
          !matches(await this.#baseGeometry(page), mapping.entry.geometry[mapping.sourcePage - 1])
        )
          throw new SourceFailure("geometry-mismatch");
      }
      this.#check(options.signal);
      if (sequence !== this.#sequence) throw new SourceFailure("superseded");
      for (const mapping of changes.values())
        if (mapping && !mapping.entry.caller) throw new SourceFailure("invalid-source");
    } catch (error) {
      if (!this.#closed && !options.signal?.aborted && sequence !== this.#sequence)
        return { ok: false, reason: "superseded" };
      return this.#failure(error, options.signal);
    }

    const changed = new Set<number>();
    const retired = new Set<Entry>();
    for (const [page, mapping] of changes) {
      const old = this.#mappings.get(page);
      if (
        (!old && !mapping) ||
        (old?.entry === mapping?.entry && old?.sourcePage === mapping?.sourcePage)
      )
        continue;
      changed.add(page);
      if (old) {
        old.entry.maps--;
        retired.add(old.entry);
      }
      if (mapping) {
        mapping.entry.maps++;
        this.#mappings.set(page, mapping);
      } else this.#mappings.delete(page);
    }
    if (changed.size) {
      const revision = ++this.#revision;
      for (const page of changed) this.#revisions.set(page, revision);
      for (const entry of retired) this.#retire(entry);
      // Internal coordinator notification occurs after the entire authoritative commit.
      this.#options.changed?.(changed, revision);
      return { ok: true, revision, pages: [...changed] };
    }
    return { ok: true, revision: this.#revision, pages: [] };
  }

  /** Returns the authority revision of this logical page, including restored base pages. */
  revision(page: number): number {
    return this.#revisions.get(page) ?? 0;
  }

  /** Whole-map authority revision, including resets to canonical pages. */
  get mappingRevision(): number {
    return this.#revision;
  }

  /** Whether any logical page currently selects an auxiliary source. */
  get hasOverrides(): boolean {
    return this.#mappings.size !== 0;
  }

  /** Diagnostic mapping snapshot; undefined means the canonical base page. */
  currentSource(page: number): { source: PdfjsViewerPageSource; sourcePage: number } | undefined {
    const mapping = this.#mappings.get(page);
    return mapping && { source: mapping.entry.handle, sourcePage: mapping.sourcePage };
  }

  /** Captures selected logical slots atomically without opening or copying auxiliary PDFs. */
  snapshot(
    pages: readonly number[],
    options: { signal?: AbortSignal } = {},
  ): DocumentPageSourceSnapshot {
    const signal = options.signal;
    this.#check(signal);
    if (!Array.isArray(pages) || !pages.length || pages.length > this.#base.numPages)
      throw new SourceFailure("invalid-page");
    const selected = new Map<number, { mapping: Mapping | undefined; revision: number }>();
    const entries = new Set<Entry>();
    for (const page of pages) {
      if (!this.#validPage(page) || selected.has(page)) throw new SourceFailure("invalid-page");
      const mapping = this.#mappings.get(page);
      selected.set(page, { mapping, revision: this.revision(page) });
      if (mapping) entries.add(mapping.entry);
    }
    const mappingRevision = this.#revision;
    const abort = new AbortController();
    for (const entry of entries) entry.snapshots++;
    const release = (): void => {
      if (abort.signal.aborted) return;
      abort.abort();
      signal?.removeEventListener("abort", release);
      this.#snapshots.delete(release);
      selected.clear();
      for (const entry of entries) {
        entry.snapshots--;
        this.#retire(entry);
      }
      entries.clear();
      this.#wake();
    };
    this.#snapshots.add(release);
    signal?.addEventListener("abort", release, { once: true });
    // Also reject an abort that raced listener installation (including foreign signals).
    if (signal?.aborted) release();
    return Object.freeze({
      mappingRevision,
      revision: (page: number): number => {
        this.#check(abort.signal);
        const slot = selected.get(page);
        if (!slot) throw new SourceFailure("invalid-page");
        return slot.revision;
      },
      acquire: async (page: number): Promise<DocumentPageUse> => {
        this.#check(abort.signal);
        const slot = selected.get(page);
        if (!slot) throw new SourceFailure("invalid-page");
        return this.#acquire(
          page,
          slot.mapping,
          slot.revision,
          () => !abort.signal.aborted,
          abort.signal,
        );
      },
      release,
    });
  }

  /** Admits a physical lease before awaiting document loading or page acquisition. */
  async acquire(logicalPage: number): Promise<DocumentPageUse> {
    if (this.#closed) throw new SourceFailure("destroyed");
    if (!this.#validPage(logicalPage)) throw new SourceFailure("invalid-page");
    const mapping = this.#mappings.get(logicalPage);
    const revision = this.revision(logicalPage);
    return this.#acquire(
      logicalPage,
      mapping,
      revision,
      () => this.revision(logicalPage) === revision && this.#mappings.get(logicalPage) === mapping,
    );
  }

  /** Shared physical admission for live-map reads and immutable selected-page scopes. */
  async #acquire(
    logicalPage: number,
    mapping: Mapping | undefined,
    revision: number,
    isCurrent: () => boolean,
    signal?: AbortSignal,
  ): Promise<DocumentPageUse> {
    this.#check(signal);
    const entry = mapping?.entry;
    if (entry) entry.uses++;
    let finish!: () => void;
    const settlement = new Promise<void>(resolve => {
      finish = resolve;
    });
    this.#track(settlement);
    const abort = () => this.#wake();
    signal?.addEventListener("abort", abort);
    try {
      const live = entry ? await this.#ensure(entry, signal) : undefined;
      this.#check(signal);
      const pdf = live?.pdf ?? this.#base;
      const sourcePage = mapping?.sourcePage ?? logicalPage;
      const use = await (live?.usage ?? this.#baseAcquirer).acquire(sourcePage);
      if (this.#closed || signal?.aborted) {
        use.release();
        this.#check(signal);
      }
      let released = false;
      const source = Object.freeze({
        id: entry?.handle.id ?? null,
        revision,
        logicalPage,
        sourcePage,
        pdf,
        ...(live
          ? { optionalContentConfigPromise: live.optionalContentConfigPromise, fonts: live.fonts }
          : {}),
        linkContext: entry?.linkContext ?? "base",
        isCurrent: () => !this.#closed && isCurrent(),
      });
      return Object.freeze({
        page: use.page,
        source,
        release: () => {
          if (released) return;
          released = true;
          try {
            use.release();
          } finally {
            if (entry) this.#release(entry);
            finish();
          }
        },
      });
    } catch (error) {
      if (entry) this.#release(entry);
      finish();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  /** Translates an immutable source destination only while its originating mapping is current. */
  async resolveDestination(
    logicalPage: number,
    expectedSourceId: string | null,
    destination: unknown,
  ): Promise<string | unknown[] | null> {
    const mapping = this.#mappings.get(logicalPage);
    if (
      this.#closed ||
      !this.#validPage(logicalPage) ||
      (mapping?.entry.handle.id ?? null) !== expectedSourceId
    )
      return null;
    const revision = this.revision(logicalPage);
    const current = () =>
      !this.#closed &&
      this.revision(logicalPage) === revision &&
      this.#mappings.get(logicalPage) === mapping;
    if (!mapping || mapping.entry.linkContext === "base")
      return typeof destination === "string" || numericDestination(destination)
        ? destination
        : null;
    const entry = mapping.entry;
    entry.uses++;
    let finish!: () => void;
    this.#track(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    try {
      const live = await this.#ensure(entry);
      const explicit =
        typeof destination === "string" ? await live.pdf.getDestination(destination) : destination;
      if (!Array.isArray(explicit) || !explicit.length) return null;
      let pageIndex: number;
      if (numericDestination(explicit)) pageIndex = explicit[0] as number;
      else if (
        explicit[0] &&
        typeof explicit[0] === "object" &&
        Number.isInteger(explicit[0].num) &&
        Number.isInteger(explicit[0].gen)
      )
        pageIndex = await live.pdf.getPageIndex(explicit[0]);
      else return null;
      const slots = [...this.#mappings].filter(
        ([, value]) => value.entry === entry && value.sourcePage === pageIndex + 1,
      );
      return current() && slots.length === 1 ? [slots[0][0] - 1, ...explicit.slice(1)] : null;
    } catch {
      return null;
    } finally {
      this.#release(entry);
      finish();
    }
  }

  /** Synchronously revokes authority; settles owned readers, tasks, disposals and fonts. */
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#sequence++;
    this.#abort.abort();
    for (const release of this.#snapshots) release();
    this.#mappings.clear();
    for (const entry of this.#entries) {
      entry.caller = false;
      entry.maps = 0;
      this.#retire(entry);
    }
    this.#wake();
    this.#closePromise = (async () => {
      while (this.#jobs.size) await Promise.allSettled([...this.#jobs]);
    })();
    return this.#closePromise;
  }

  #validPage(page: number): boolean {
    return Number.isInteger(page) && page >= 1 && page <= this.#base.numPages;
  }

  #check(signal?: AbortSignal): void {
    if (this.#closed) throw new SourceFailure("destroyed");
    if (signal?.aborted) throw new SourceFailure("cancelled");
  }

  #failure(error: unknown, signal?: AbortSignal): PdfjsViewerPageSourceFailure {
    return {
      ok: false,
      reason: this.#closed
        ? "destroyed"
        : signal?.aborted
          ? "cancelled"
          : error instanceof SourceFailure
            ? error.reason
            : "error",
      ...(error instanceof SourceFailure ? {} : { error }),
    };
  }

  #validateLink(value: unknown, context: "source" | "base"): void {
    if (!value || typeof value !== "object") throw new SourceFailure("unsupported");
    const annotation = value as Record<string, unknown>;
    if (
      annotation.annotationType !== 2 ||
      annotation.hasAppearance ||
      ["actions", "setOCGState", "resetForm", "action", "jsActions"].some(
        key => annotation[key] != null,
      ) ||
      (annotation.unsafeUrl && !annotation.url)
    )
      throw new SourceFailure("unsupported");
    if (
      annotation.dest != null &&
      !(
        typeof annotation.dest === "string" ||
        (context === "base" ? numericDestination(annotation.dest) : Array.isArray(annotation.dest))
      )
    )
      throw new SourceFailure("unsupported");
  }

  #baseGeometry(page: number): Promise<Geometry> {
    let pending = this.#geometry.get(page);
    if (!pending) {
      pending = (async () => {
        const use = await this.#baseAcquirer.acquire(page);
        try {
          return geometry(use.page);
        } finally {
          use.release();
        }
      })();
      this.#geometry.set(page, pending);
      this.#track(pending);
    }
    return pending;
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#jobs.add(promise);
    void promise.then(
      () => this.#jobs.delete(promise),
      () => this.#jobs.delete(promise),
    );
    return promise;
  }

  #wake(): void {
    for (const wake of this.#waiters) wake();
    this.#waiters.clear();
  }

  #release(entry: Entry): void {
    entry.uses--;
    entry.touched = ++this.#clock;
    this.#retire(entry);
    this.#wake();
  }

  #retire(entry: Entry): void {
    if (entry.caller || entry.maps || entry.snapshots || entry.uses) return;
    if (entry.live) {
      void this.#evict(entry).catch(() => undefined);
      return;
    }
    if (entry.opening || entry.destroying) return;
    if (this.#entries.delete(entry)) {
      if (entry.blob) this.#blobBytes -= entry.handle.byteLength;
      else this.#bytes -= entry.handle.byteLength;
      entry.bytes = undefined;
      entry.blob = undefined;
    }
  }

  #evict(entry: Entry): Promise<void> {
    if (entry.destroying) return entry.destroying;
    const live = entry.live;
    if (!live || entry.uses) return Promise.resolve();
    entry.live = undefined;
    // Fonts may retain mounted DOM users after the PDF document has been destroyed.
    if (live.fonts) this.#track(Promise.resolve().then(() => live.fonts!.close([])));
    const destroying = (async () => {
      try {
        await live.usage.close();
      } finally {
        await live.dispose();
      }
    })();
    entry.destroying = this.#track(
      destroying.finally(() => {
        entry.destroying = undefined;
        this.#slots--;
        this.#liveBytes -= entry.handle.byteLength;
        this.#retire(entry);
        this.#wake();
      }),
    );
    return entry.destroying;
  }

  /** Cancels one queued/shared waiter without discarding the underlying physical settlement. */
  #waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    this.#check(signal);
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new SourceFailure(this.#closed ? "destroyed" : "cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(
        value => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        error => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
      if (signal.aborted) abort();
    });
  }

  /** Shares physical opening, but each waiter owns its cancellation and demand independently. */
  #ensure(entry: Entry, signal?: AbortSignal): Promise<Live> {
    this.#check(signal);
    if (entry.live) return Promise.resolve(entry.live);
    if (entry.opening?.abort.signal.aborted) {
      // A cancelled loader must finish disposal before a new generation may open.
      return this.#waitFor(
        entry.opening.promise.then(
          () => undefined,
          () => undefined,
        ),
        signal,
      ).then(() => this.#ensure(entry, signal));
    }
    if (!entry.opening) {
      const abort = new AbortController();
      const sharedSignal = AbortSignal.any([abort.signal, this.#abort.signal]);
      const previous = this.#queue;
      const opening: Opening = { abort, waiters: 0, promise: undefined! };
      const work = this.#waitFor(previous, sharedSignal).then(async () => {
        this.#check(sharedSignal);
        if (entry.destroying) await entry.destroying;
        while (
          this.#slots >= this.#limits.maxLiveDocuments ||
          entry.handle.byteLength > this.#limits.maxLiveBytes - this.#liveBytes
        ) {
          this.#check(sharedSignal);
          const idle = [...this.#entries]
            .filter(item => item.live && !item.uses)
            .sort((a, b) => a.touched - b.touched)[0];
          if (idle) {
            await this.#evict(idle);
            continue;
          }
          await new Promise<void>(resolve => this.#waiters.add(resolve));
        }
        this.#check(sharedSignal);
        this.#slots++;
        this.#liveBytes += entry.handle.byteLength;
        let loaded: Loaded | undefined;
        try {
          // Reserve both a document slot and byte budget before materializing Blob bytes.
          // A fresh copy protects either backing from PDF.js transfer/detachment.
          const data = entry.blob
            ? new Uint8Array(await entry.blob.arrayBuffer())
            : entry.bytes!.slice();
          this.#check(sharedSignal);
          loaded = await this.#options.load(data, sharedSignal);
          this.#check(sharedSignal);
          const optionalContentConfigPromise = loaded.pdf.getOptionalContentConfig({
            intent: "display",
          });
          void optionalContentConfigPromise.catch(() => undefined);
          const usage = new DocumentPageUsage(loaded.pdf);
          loaded.fonts?.bindPageUsage(usage);
          const live = {
            ...loaded,
            usage,
            optionalContentConfigPromise,
          };
          entry.live = live;
          return live;
        } catch (error) {
          try {
            if (loaded?.fonts) this.#track(Promise.resolve().then(() => loaded!.fonts!.close([])));
            if (loaded) await loaded.dispose();
          } finally {
            this.#slots--;
            this.#liveBytes -= entry.handle.byteLength;
            this.#wake();
          }
          throw error;
        }
      });
      opening.promise = this.#track(
        work.finally(() => {
          entry.opening = undefined;
          this.#retire(entry);
        }),
      );
      entry.opening = opening;
      // A cancelled queued open can settle promptly without bypassing earlier work.
      // Both tails retain only void settlement, never a Live or rejection reason.
      this.#queue = Promise.all([
        previous,
        opening.promise.then(
          () => undefined,
          () => undefined,
        ),
      ]).then(() => undefined);
    }
    const opening = entry.opening;
    opening.waiters++;
    return this.#waitFor(opening.promise, signal).finally(() => {
      opening.waiters--;
      if (!opening.waiters && entry.opening === opening) {
        opening.abort.abort();
        this.#wake();
      }
    });
  }
}
