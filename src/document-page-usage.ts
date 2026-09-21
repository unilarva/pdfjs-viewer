// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private document-scoped owner for shared PDF.js page-proxy cleanup.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * PDF.js may return the same cached page proxy to rendering, text extraction,
 * navigation, and presentation. This owner admits each use before `getPage()`,
 * delays owner-controlled cleanup until all overlapping users release, and lets
 * document teardown wait for every admitted acquisition. Callers release uses;
 * they never clean page proxies directly. See the
 * [architecture guide](../ARCHITECTURE.md) for lifecycle and cleanup ordering.
 *
 * @packageDocumentation
 * @module document-page-usage
 */

import type * as PDFJS from "pdfjs-dist";

/** One admitted use of a PDF.js page proxy. Release is idempotent. */
export interface DocumentPageUse {
  readonly page: PDFJS.PDFPageProxy;
  release(): void;
}

/** Narrow capability accepted by owners that need temporary page access. */
export interface DocumentPageAcquirer {
  acquire(pageNo: number): Promise<DocumentPageUse>;
}

interface PageUsage {
  pending: number;
  active: number;
  readonly proxies: Set<PDFJS.PDFPageProxy>;
}

/** Coordinates all page users belonging to one admitted PDF document. */
export class DocumentPageUsage implements DocumentPageAcquirer {
  #pdf: PDFJS.PDFDocumentProxy;
  #pages = new Map<number, PageUsage>();
  #closed = false;
  #closePromise: Promise<void> | null = null;
  #resolveClose: (() => void) | null = null;

  constructor(pdf: PDFJS.PDFDocumentProxy) {
    this.#pdf = pdf;
  }

  public async acquire(pageNo: number): Promise<DocumentPageUse> {
    if (this.#closed) throw new Error("DocumentPageUsage: document is closed");
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      throw new RangeError("DocumentPageUsage: page number must be a positive integer");
    }
    const usage = this.#pages.get(pageNo) ?? { pending: 0, active: 0, proxies: new Set() };
    this.#pages.set(pageNo, usage);
    usage.pending++;
    let page: PDFJS.PDFPageProxy;
    try {
      page = await this.#pdf.getPage(pageNo);
    } catch (error) {
      usage.pending--;
      this.#finishPage(pageNo, usage);
      throw error;
    }
    usage.pending--;
    usage.active++;
    usage.proxies.add(page);
    let released = false;
    return Object.freeze({
      page,
      release: () => {
        if (released) return;
        released = true;
        usage.active--;
        this.#finishPage(pageNo, usage);
      },
    });
  }

  /** Rejects new acquisitions and settles after every admitted use releases. */
  public close(): Promise<void> {
    this.#closed = true;
    if (!this.#pages.size) return Promise.resolve();
    if (!this.#closePromise) {
      this.#closePromise = new Promise(resolve => {
        this.#resolveClose = resolve;
      });
    }
    return this.#closePromise;
  }

  #finishPage(pageNo: number, usage: PageUsage): void {
    if (usage.pending || usage.active) return;
    if (this.#pages.get(pageNo) === usage) this.#pages.delete(pageNo);
    for (const page of usage.proxies) {
      try {
        page.cleanup();
      } catch {
        /* PDF.js cleanup is best effort. */
      }
    }
    usage.proxies.clear();
    if (this.#closed && !this.#pages.size) {
      this.#resolveClose?.();
      this.#resolveClose = null;
    }
  }
}
