// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private owner of the active document's complete text index.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * Preparation validates and copies PDF.js text items into a local candidate
 * index, concatenates each page's original item strings with exact offset
 * mappings, releases each shared page use, and publishes the candidate atomically
 * only after every expected page succeeds. `DocumentPageUsage`, not search,
 * owns eventual proxy cleanup. Published items,
 * transforms, and page arrays are detached from PDF.js and frozen. Malformed
 * individual items are skipped; an unusable text-content container fails the
 * preparation without exposing partial state.
 *
 * Document identity and an internal reset generation cancel stale work. Reset
 * synchronously removes the canonical index, readiness, and error state, and
 * stale completions cannot publish or replace newer work. The viewer facade
 * retains UI preparation intent, aria-busy state, query match selection,
 * highlight rendering, IME navigation, and completion events; it receives only
 * immutable page-level source-segment matches from this module. See the
 * [architecture guide](../ARCHITECTURE.md) for the authoritative atomic
 * publication procedure and search model/presentation boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-search
 */

import type * as PDFJS from "pdfjs-dist";
import type { DocumentPageUse } from "./document-page-usage.js";
import { compileTextQuery, findCompiledTextMatches } from "./text-matching.js";
import { PDFJS_TEXT_CONTENT_PARAMS } from "./text-content-policy.js";
import type { NormalizedTextQueryOptions } from "./viewer-options.js";
import type {
  PdfjsViewerSearchMatch,
  PdfjsViewerSearchResult,
  PdfjsViewerTextQueryOptions,
} from "./viewer-contracts.js";

/** A validated, detached, deeply immutable text fragment in the private index. */
export interface DocumentSearchTextItem {
  readonly textItemIndex: number;
  readonly str: string;
  readonly textOffset: number;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly width: number;
  readonly height: number;
}

/** One exact source-item segment of a canonical page-local match. */
export interface DocumentTextMatchSegment {
  readonly textItemIndex: number;
  readonly text: string;
  readonly characterIndex: number;
  readonly length: number;
}

/** Canonical page-local match retained only for the caller's current query. */
export interface DocumentTextMatch {
  readonly page: number;
  readonly segments: readonly DocumentTextMatchSegment[];
}

interface DocumentSearchPage {
  readonly text: string;
  readonly items: readonly DocumentSearchTextItem[];
}

/** Projects one page-stream range to the smallest ordered set of source items. */
function sourceSegments(
  items: readonly DocumentSearchTextItem[],
  matchIndex: number,
  matchLength: number,
): DocumentTextMatchSegment[] {
  const matchEnd = matchIndex + matchLength;
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const item = items[middle];
    if (item && item.textOffset + item.str.length <= matchIndex) low = middle + 1;
    else high = middle;
  }

  const segments: DocumentTextMatchSegment[] = [];
  for (let index = low; index < items.length; index++) {
    const item = items[index];
    if (!item || item.textOffset >= matchEnd) break;
    const start = Math.max(matchIndex, item.textOffset);
    const end = Math.min(matchEnd, item.textOffset + item.str.length);
    if (end > start)
      segments.push({
        textItemIndex: item.textItemIndex,
        text: item.str,
        characterIndex: start - item.textOffset,
        length: end - start,
      });
  }
  return segments;
}

function projectSearchMatch(match: Readonly<DocumentTextMatch>): PdfjsViewerSearchMatch {
  return {
    page: match.page,
    segments: match.segments.map(segment => ({
      text: segment.text,
      characterIndex: segment.characterIndex,
      length: segment.length,
    })),
  };
}

/** Capabilities required to index and query the active document. */
export interface DocumentSearchHost {
  readonly searchEnabled: boolean;
  readonly pageCount: number;
  readonly isDestroyed: boolean;
  readonly isReady: boolean;
  getPdf(): PDFJS.PDFDocumentProxy | null;
  getDocumentGeneration(): number;
  isCurrentDocument(pdf: PDFJS.PDFDocumentProxy, generation: number): boolean;
  waitForDocumentPreparation(promise: Promise<boolean>, signal: AbortSignal): Promise<boolean>;
  getDocumentSignal(): AbortSignal;
  normalizeQueryOptions(options: PdfjsViewerTextQueryOptions): NormalizedTextQueryOptions;
  acquirePage(pageNo: number): Promise<DocumentPageUse>;
}

/** Retains a complete canonical text index and exposes detached public search results. */
export class DocumentSearch {
  #indexPromise: Promise<boolean> | null = null;
  #ready = false;
  #error: unknown = null;
  #pages: ReadonlyMap<number, DocumentSearchPage> = new Map();
  #lifecycleGeneration = 0;

  /**
   * The active lifecycle's shared preparation identity.
   *
   * Successful preparation remains shared until reset. Failed preparation is
   * cleared only by its own completion and may then be retried.
   */
  public get preparation(): Promise<boolean> | null {
    return this.#indexPromise;
  }
  /** True only when every admitted page is represented in the canonical index. */
  public get ready(): boolean {
    return this.#ready;
  }
  /** The non-fatal indexing error for the active document, when any. */
  public get error(): unknown {
    return this.#error;
  }

  /** Number of pages in the complete canonical index, or zero before readiness. */
  public get indexedPageCount(): number {
    return this.#pages.size;
  }

  /**
   * Returns a page's immutable text fragments.
   *
   * `undefined` means the page is absent or no complete index is published. An
   * empty frozen array means the page was indexed but had no valid text items.
   */
  public itemsForPage(pageNo: number): readonly DocumentSearchTextItem[] | undefined {
    return this.#pages.get(pageNo)?.items;
  }

  /** Discards all active-document state after close, replacement, or destruction. */
  public reset(): void {
    this.#lifecycleGeneration++;
    this.#indexPromise = null;
    this.#ready = false;
    this.#error = null;
    this.#pages = new Map();
  }

  /**
   * Starts or joins indexing for the admitted document identity and page count.
   * Every acquired page is cleaned exactly once on success, failure, malformed
   * content, or stale cancellation.
   */
  public prepare(host: DocumentSearchHost): Promise<boolean> {
    if (this.#indexPromise) return this.#indexPromise;
    if (!host.searchEnabled) return Promise.resolve(false);
    const pdf = host.getPdf();
    if (!pdf) return Promise.resolve(false);
    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const pageCount = host.pageCount;
    this.#error = null;
    const preparation = this.#buildIndex(host, pdf, generation, lifecycleGeneration, pageCount);
    this.#indexPromise = preparation;
    void preparation.then(ready => {
      if (
        !this.#isCurrent(host, pdf, generation, lifecycleGeneration) ||
        this.#indexPromise !== preparation
      )
        return;
      if (!ready) this.#indexPromise = null;
    });
    return preparation;
  }

  /** Returns detached matches without changing live search-panel state. */
  public async search(
    host: DocumentSearchHost,
    query: string,
    options: PdfjsViewerTextQueryOptions,
  ): Promise<PdfjsViewerSearchResult> {
    if (typeof query !== "string" || !query.trim()) {
      throw new TypeError("PdfjsViewer: search query must be a non-empty string");
    }
    const requestedQuery = query.trim();
    const matching = host.normalizeQueryOptions(options);
    if (host.isDestroyed) return { ok: false, query: requestedQuery, reason: "destroyed" };
    if (!host.searchEnabled) return { ok: false, query: requestedQuery, reason: "disabled" };
    const pdf = host.getPdf();
    if (!host.isReady || !pdf) return { ok: false, query: requestedQuery, reason: "not-ready" };

    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const ready = await host.waitForDocumentPreparation(
      this.prepare(host),
      host.getDocumentSignal(),
    );
    if (host.isDestroyed) return { ok: false, query: requestedQuery, reason: "destroyed" };
    if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration)) {
      return { ok: false, query: requestedQuery, reason: "cancelled" };
    }
    if (!ready) return { ok: false, query: requestedQuery, reason: "error", error: this.#error };

    const matches = this.findMatches(requestedQuery, matching).map(projectSearchMatch);
    return { ok: true, query: requestedQuery, matches };
  }

  /** Returns canonical rich matches for an already-normalized current query. */
  public findMatches(query: string, options: NormalizedTextQueryOptions): DocumentTextMatch[] {
    const compiled = compileTextQuery(query, options);
    const matches: DocumentTextMatch[] = [];
    for (let page = 1; page <= this.#pages.size; page++) {
      const indexedPage = this.#pages.get(page);
      if (!indexedPage) continue;
      for (const match of findCompiledTextMatches(indexedPage.text, compiled)) {
        const segments = sourceSegments(indexedPage.items, match.index, match.length);
        if (segments.reduce((length, segment) => length + segment.length, 0) === match.length) {
          matches.push({ page, segments: Object.freeze(segments) });
        }
      }
    }
    return matches;
  }

  /** Builds locally and atomically publishes only a complete, current candidate index. */
  async #buildIndex(
    host: DocumentSearchHost,
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    lifecycleGeneration: number,
    pageCount: number,
  ): Promise<boolean> {
    try {
      if (!Number.isInteger(pageCount) || pageCount < 0) {
        throw new TypeError("DocumentSearch: pageCount must be a non-negative integer");
      }
      const candidate = new Map<number, DocumentSearchPage>();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration)) return false;
        const pageUse = await host.acquirePage(pageNumber);
        try {
          if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration)) return false;
          const text = await pageUse.page.getTextContent(PDFJS_TEXT_CONTENT_PARAMS);
          if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration)) return false;
          if (!text || typeof text !== "object" || !Array.isArray(text.items)) {
            throw new TypeError(`DocumentSearch: page ${pageNumber} returned invalid text content`);
          }
          const items: DocumentSearchTextItem[] = [];
          let textItemIndex = 0;
          let pageText = "";
          for (const sourceItem of text.items) {
            const hasText =
              !!sourceItem &&
              typeof sourceItem === "object" &&
              typeof (sourceItem as Record<string, unknown>).str === "string";
            const item = this.#copyItem(sourceItem, textItemIndex, pageText.length);
            if (item) items.push(item);
            if (hasText) {
              pageText += (sourceItem as Record<string, unknown>).str as string;
              textItemIndex++;
            }
          }
          candidate.set(
            pageNumber,
            Object.freeze({
              text: pageText,
              items: Object.freeze(items),
            }),
          );
        } finally {
          pageUse.release();
        }
      }
      if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration)) return false;
      if (candidate.size !== pageCount) {
        throw new Error("DocumentSearch: incomplete candidate index");
      }
      this.#pages = candidate;
      this.#ready = true;
      this.#error = null;
      return true;
    } catch (error) {
      if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration)) return false;
      this.#pages = new Map();
      this.#ready = false;
      this.#error = error;
      return false;
    }
  }

  /** Copies one structurally valid item; malformed individual items are omitted. */
  #copyItem(
    item: unknown,
    textItemIndex: number,
    textOffset: number,
  ): DocumentSearchTextItem | null {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.str !== "string" ||
      !Array.isArray(candidate.transform) ||
      candidate.transform.length !== 6 ||
      !candidate.transform.every(value => typeof value === "number" && Number.isFinite(value)) ||
      typeof candidate.width !== "number" ||
      !Number.isFinite(candidate.width) ||
      typeof candidate.height !== "number" ||
      !Number.isFinite(candidate.height)
    )
      return null;
    const transform = Object.freeze([
      ...candidate.transform,
    ]) as DocumentSearchTextItem["transform"];
    return Object.freeze({
      textItemIndex,
      str: candidate.str,
      textOffset,
      transform,
      width: candidate.width,
      height: candidate.height,
    });
  }

  #isCurrent(
    host: DocumentSearchHost,
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    lifecycleGeneration: number,
  ): boolean {
    return (
      lifecycleGeneration === this.#lifecycleGeneration && host.isCurrentDocument(pdf, generation)
    );
  }
}
