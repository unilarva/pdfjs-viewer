// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import type * as PDFJS from "pdfjs-dist";
import { readPdfPageFonts, type PdfPageFont } from "./pdfjs-compatibility.js";
import { inhibitTrueTypeGridFitting } from "./truetype-grid-fitting.js";

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

/** Document-scoped native font aliases preserve outline geometry without browser-global patches. */
export class DocumentFonts {
  #document: Document;
  #id = ++nextOwnerId;
  #closed = false;
  #abort = new AbortController();
  #pending = new Map<string, Promise<void>>();
  #aliases = new Map<string, string>();
  #faces = new Set<FontFace>();

  constructor(ownerDocument: Document) {
    this.#document = ownerDocument;
  }

  /** Prepares fonts before any base/detail pixels are written; failures retain the original font. */
  async prepare(
    page: PDFJS.PDFPageProxy,
    annotationMode: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.#closed || signal?.aborted) return;
    try {
      const fonts = await this.#unlessClosed(readPdfPageFonts(page, annotationMode), signal);
      if (!fonts || this.#closed || signal?.aborted) return;
      await this.#unlessClosed(
        Promise.all(
          fonts.map(font => {
            let pending = this.#pending.get(font.family);
            if (!pending) {
              pending = this.#load(font).catch(() => undefined);
              this.#pending.set(font.family, pending);
            }
            return pending;
          }),
        ),
        signal,
      );
    } catch {
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
    const data = inhibitTrueTypeGridFitting(font.data);
    if (!data || this.#closed) return;
    const owner = this.#document.defaultView as (Window & typeof globalThis) | null;
    if (!owner?.FontFace || !this.#document.fonts) return;
    const family = `${font.family}_pdfjs_viewer_linear_${this.#id}`;
    const face = new owner.FontFace(family, data.buffer as ArrayBuffer);
    await face.load();
    if (this.#closed) return;
    this.#document.fonts.add(face);
    this.#faces.add(face);
    this.#aliases.set(font.family, family);
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

  /** Stops new aliases immediately; deletion waits for every raster still using this owner. */
  async close(settlements: readonly Promise<unknown>[]): Promise<void> {
    this.#closed = true;
    this.#abort.abort();
    await Promise.allSettled(settlements);
    for (const face of this.#faces) this.#document.fonts.delete(face);
    this.#faces.clear();
    this.#aliases.clear();
    this.#pending.clear();
  }
}
