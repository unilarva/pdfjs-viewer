// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import type * as PDFJS from "pdfjs-dist";
import { readPdfPageFonts, type PdfPageFont } from "./pdfjs-compatibility.js";
import { inhibitTrueTypeGridFitting } from "./truetype-grid-fitting.js";
import type { DocumentPageAcquirer, DocumentPageUse } from "./document-page-usage.js";

/**
 * Private document-owned font geometry and lifetime policy.
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for ownership and compatibility constraints.
 * @packageDocumentation
 * @module document-fonts
 */

/** Empirical visible-size cutoff: smaller text retains native hinting for contrast. */
const GEOMETRIC_FONT_MIN_CSS_SIZE = 24;
/** Keeps base/detail policy identical despite floating-point drift at the cutoff. */
const FONT_SIZE_COMPARISON_EPSILON = 1e-4;

let nextOwnerId = 0;

/** Private source-font preparation failure; callers must keep existing usable pixels. */
export class SourceFontError extends Error {}

/** Private source admission failure when copied font bytes exceed the resource budget. */
export class DocumentFontBudgetError extends SourceFontError {}

/** Private font-owner policy; ordinary base owners retain their historical defaults. */
export interface DocumentFontOptions {
  /** Whether to prepare outline-preserving aliases. Defaults to true. */
  geometric?: boolean;
  /** Whether to independently retain native faces for evictable source documents. */
  retainNativeFaces?: boolean;
  /** Reserves each copied buffer until its face is deleted; null denies admission. */
  reserveBytes?: (bytes: number) => (() => void) | null;
}

/** Pins this owner's faces, without retaining its PDF document. */
export interface DocumentFontLease {
  /** Releases the pin once; subsequent calls have no effect. */
  release(): void;
}

/** Document-scoped native font aliases preserve outline geometry without browser-global patches. */
export class DocumentFonts {
  #document: Document;
  #id = ++nextOwnerId;
  #closed = false;
  #abort = new AbortController();
  #pending = new Map<string, Promise<void>>();
  #physical = new Set<Promise<unknown>>();
  #pages?: DocumentPageAcquirer;
  #aliases = new Map<string, string>();
  #faces = new Set<FontFace>();
  #options: DocumentFontOptions;
  #reservations = new Map<FontFace, () => void>();
  #byteLength = 0;
  #retains = 0;
  #drains = 0;
  #closing?: Promise<void>;
  #finishClose?: () => void;

  /** Creates a base alias owner or an independently retained source-generation owner. */
  constructor(ownerDocument: Document, options: DocumentFontOptions = {}) {
    this.#document = ownerDocument;
    this.#options = { ...options };
  }

  /** Estimated copied font bytes currently charged, including in-flight loads. */
  get byteLength(): number {
    return this.#byteLength;
  }

  /** Binds the exact physical document's page owner before any font work is admitted. */
  bindPageUsage(pages: DocumentPageAcquirer): void {
    if (this.#closed || this.#physical.size || (this.#pages && this.#pages !== pages))
      throw new SourceFontError("Cannot replace an admitted font page owner");
    this.#pages = pages;
  }

  /** Admits a text-layer pin before close; the pin also covers faces prepared later. */
  retain(): DocumentFontLease {
    if (this.#closed) throw new SourceFontError("Cannot retain a closed font owner");
    this.#retains++;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#retains--;
        this.#deleteWhenDrained();
      },
    };
  }

  /** Prepares render fonts; source-copy failures reject instead of permitting unsafe eviction. */
  async prepare(
    page: PDFJS.PDFPageProxy,
    annotationMode: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.#closed || signal?.aborted) return;
    try {
      // Caller cancellation revokes authority, not the underlying PDF/font operations.
      const physical = (async () => {
        let use: DocumentPageUse | undefined;
        try {
          if (this.#pages) use = await this.#pages.acquire(page.pageNumber);
          if (this.#closed || signal?.aborted) return;
          const fonts = await readPdfPageFonts(use?.page ?? page, annotationMode);
          if (this.#closed || signal?.aborted) return;
          const loaded = await Promise.allSettled(
            fonts.map(font => {
              let pending = this.#pending.get(font.family);
              if (!pending) {
                pending = this.#load(font).catch(error => {
                  if (this.#options.retainNativeFaces) throw error;
                });
                this.#pending.set(font.family, pending);
              }
              return pending;
            }),
          );
          for (const result of loaded) if (result.status === "rejected") throw result.reason;
        } finally {
          // Font descriptors can still reference PDF-owned bytes between native/alias loads.
          use?.release();
        }
      })();
      this.#physical.add(physical);
      const settled = () => {
        this.#physical.delete(physical);
        this.#deleteWhenDrained();
      };
      void physical.then(settled, settled);
      await this.#unlessClosed(physical, signal);
    } catch (error) {
      if (this.#options.retainNativeFaces && !this.#closed && !signal?.aborted)
        throw error instanceof SourceFontError
          ? error
          : new SourceFontError("Unable to retain source fonts", { cause: error });
      // Invalid/unsupported font dependencies must not turn otherwise valid
      // PDF content into a blank page. PDF.js retains its original font path.
    }
  }

  /** Revokes public preparation promptly without abandoning a late promise rejection. */
  async #unlessClosed<T>(work: Promise<T>, caller?: AbortSignal): Promise<T | undefined> {
    const signal = this.#abort.signal;
    if (signal.aborted || caller?.aborted) {
      void work.catch(() => undefined);
      return undefined;
    }
    let abort!: () => void;
    const cancelled = new Promise<undefined>(resolve => {
      abort = () => resolve(undefined);
    });
    signal.addEventListener("abort", abort, { once: true });
    caller?.addEventListener("abort", abort, { once: true });
    try {
      return await Promise.race([work, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
      caller?.removeEventListener("abort", abort);
    }
  }

  async #load(font: PdfPageFont): Promise<void> {
    if (this.#closed) return;
    if (this.#options.retainNativeFaces) await this.#loadFace(font.family, font.data, true);
    if (this.#closed || this.#options.geometric === false) return;
    const data = inhibitTrueTypeGridFitting(font.data);
    if (!data) return;
    const family = `${font.family}_pdfjs_viewer_linear_${this.#id}`;
    if (await this.#loadFace(family, data, false)) this.#aliases.set(font.family, family);
  }

  /** Copies exactly the qualified font view; ownership never includes PDF.js's original face. */
  async #loadFace(family: string, data: Uint8Array, native: boolean): Promise<boolean> {
    const owner = this.#document.defaultView as (Window & typeof globalThis) | null;
    if (!owner?.FontFace || !this.#document.fonts) {
      if (native) throw new SourceFontError("Native source font copying is unavailable");
      return false;
    }
    const bytes = data.byteLength;
    const reservation = this.#options.reserveBytes?.(bytes);
    if (reservation === null) throw new DocumentFontBudgetError("Source font budget exceeded");
    this.#byteLength += bytes;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.#byteLength -= bytes;
      reservation?.();
    };
    try {
      const face = new owner.FontFace(family, data.slice().buffer as ArrayBuffer);
      await face.load();
      if (this.#closed) {
        release();
        return false;
      }
      this.#document.fonts.add(face);
      this.#faces.add(face);
      this.#reservations.set(face, release);
      return true;
    } catch (error) {
      release();
      if (native) throw new SourceFontError("Unable to copy native source font", { cause: error });
      throw error;
    }
  }

  /** Adapts only this render's context; DOM fonts and the original context remain consumer-owned. */
  context(context: CanvasRenderingContext2D, renderDpr: number): CanvasRenderingContext2D {
    if (!this.#aliases.size) return context;
    const aliases = this.#aliases;
    const methods = new Map<PropertyKey, unknown>();
    return new Proxy(context, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (!methods.has(property)) {
          if (property === "fillText" || property === "strokeText") {
            methods.set(property, (...args: unknown[]) => {
              const originalFont = target.font;
              const size = /([\d.]+)px/.exec(originalFont);
              const matrix = target.getTransform();
              // Tiny stems can vanish into gray coverage without grid fitting.
              // Visible size keeps the policy equal across base/detail DPRs.
              const cssSize = size
                ? (Number(size[1]) * Math.hypot(matrix.c, matrix.d)) / renderDpr
                : 0;
              if (cssSize <= GEOMETRIC_FONT_MIN_CSS_SIZE + FONT_SIZE_COMPARISON_EPSILON)
                return value.apply(target, args);
              const font = originalFont.replace(
                /(px\s+)(?:"([^"]+)"|([^,]+))/,
                (
                  match,
                  prefix: string,
                  quoted: string | undefined,
                  unquoted: string | undefined,
                ) => {
                  const family = quoted ?? unquoted?.trim();
                  const alias = family == null ? undefined : aliases.get(family);
                  return alias ? `${prefix}"${alias}"` : match;
                },
              );
              if (font === originalFont) return value.apply(target, args);
              target.font = font;
              try {
                return value.apply(target, args);
              } finally {
                target.font = originalFont;
              }
            });
          } else methods.set(property, value.bind(target));
        }
        return methods.get(property);
      },
      set(target, property, value: unknown) {
        return Reflect.set(target, property, value, target);
      },
    });
  }

  /** Revokes new work synchronously; all admitted text pins and physical rasters delay deletion. */
  close(settlements: readonly Promise<unknown>[]): Promise<void> {
    if (!this.#closing)
      this.#closing = new Promise(resolve => {
        this.#finishClose = resolve;
      });
    this.#closed = true;
    this.#abort.abort();
    this.#drains++;
    const drained = Promise.allSettled(settlements).then(() => {
      this.#drains--;
      this.#deleteWhenDrained();
    });
    return Promise.all([this.#closing, drained]).then(() => undefined);
  }

  /** Deletes only owned identities once both physical and logical users are gone. */
  #deleteWhenDrained(): void {
    if (!this.#closed || this.#drains || this.#retains || this.#physical.size) return;
    for (const face of this.#faces) this.#document.fonts.delete(face);
    this.#faces.clear();
    for (const release of this.#reservations.values()) release();
    this.#reservations.clear();
    this.#aliases.clear();
    this.#pending.clear();
    this.#finishClose?.();
  }
}
