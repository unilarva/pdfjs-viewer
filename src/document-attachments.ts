// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private document-local attachment metadata and content model.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentAttachments` joins catalog discovery and per-attachment content reads,
 * normalizes metadata into immutable package-owned records, and never retains bytes
 * returned by a settled lazy content read. Public callers receive detached metadata
 * projections and may cancel promptly while uncancellable PDF.js reads remain
 * settlement dependencies for old-proxy cleanup.
 *
 * See the [architecture guide](../ARCHITECTURE.md) for lifecycle ordering and the
 * model/facade boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-attachments
 */

import type * as PDFJS from "pdfjs-dist";
import type { PdfjsViewerAttachment, PdfjsViewerAttachmentsResult } from "./viewer-contracts.js";

type CatalogAttachments = Awaited<ReturnType<PDFJS.PDFDocumentProxy["getAttachments"]>>;
type AttachmentRecord = Readonly<{
  attachment: PdfjsViewerAttachment;
  originalId: string;
}>;

const EMPTY_ATTACHMENTS = Object.freeze([]) as readonly [];
const CANCELLED_PREPARATION = Object.freeze({
  status: "cancelled" as const,
  itemCount: 0 as const,
  items: EMPTY_ATTACHMENTS,
});

/** Lifecycle capabilities required by the attachment model. */
export interface DocumentAttachmentsHost {
  readonly attachmentsEnabled: boolean;
  readonly isDestroyed: boolean;
  readonly isReady: boolean;
  getPdf(): PDFJS.PDFDocumentProxy | null;
  getDocumentGeneration(): number;
  getDocumentSignal(): AbortSignal;
  isCurrentDocument(pdf: PDFJS.PDFDocumentProxy, generation: number): boolean;
}

/** Shared metadata preparation result; stale work is reported as cancelled. */
export type DocumentAttachmentsPreparationOutcome =
  | {
      readonly status: "ready";
      readonly itemCount: number;
      readonly items: readonly PdfjsViewerAttachment[];
    }
  | {
      readonly status: "error";
      readonly itemCount: 0;
      readonly items: readonly [];
      readonly error: unknown;
    }
  | { readonly status: "cancelled"; readonly itemCount: 0; readonly items: readonly [] };

/** Result of resolving one attachment's bytes for facade-owned download. */
type DocumentAttachmentContentOutcome =
  | {
      readonly status: "ready";
      readonly attachment: PdfjsViewerAttachment;
      readonly content: Uint8Array;
    }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "cancelled" };

/** Owns normalized metadata and transient lazy content reads for one document. */
export class DocumentAttachments {
  #lifecycleGeneration = 0;
  #preparation: Promise<DocumentAttachmentsPreparationOutcome> | null = null;
  #outcome: Exclude<DocumentAttachmentsPreparationOutcome, { status: "cancelled" }> | null = null;
  #records: ReadonlyMap<string, AttachmentRecord> = new Map();
  #contentReads = new Map<string, Promise<DocumentAttachmentContentOutcome>>();
  #settlements = new Set<Promise<unknown>>();

  /** The active document's shared attachment metadata preparation. */
  public get preparation(): Promise<DocumentAttachmentsPreparationOutcome> | null {
    return this.#preparation;
  }

  /** Unsettled uncancellable PDF.js metadata and content reads. */
  public get settlements(): readonly Promise<unknown>[] {
    return Object.freeze([...this.#settlements]);
  }

  /** Invalidates publication and drops all active-document attachment state. */
  public reset(): void {
    this.#lifecycleGeneration++;
    this.#preparation = null;
    this.#outcome = null;
    this.#records = new Map();
    this.#contentReads.clear();
    this.#settlements.clear();
  }

  /** Starts, or joins, normalized attachment metadata discovery. */
  public prepare(host: DocumentAttachmentsHost): Promise<DocumentAttachmentsPreparationOutcome> {
    if (this.#preparation) return this.#preparation;
    if (this.#outcome) return Promise.resolve(this.#outcome);
    const pdf = host.getPdf();
    if (!host.attachmentsEnabled || host.isDestroyed || !host.isReady || !pdf) {
      return Promise.resolve(CANCELLED_PREPARATION);
    }

    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const read = this.#track(Promise.resolve().then(() => pdf.getAttachments()));
    const preparation = read.then<
      DocumentAttachmentsPreparationOutcome,
      DocumentAttachmentsPreparationOutcome
    >(
      attachments => {
        if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration))
          return CANCELLED_PREPARATION;
        const records = this.#normalize(attachments);
        const items = Object.freeze([...records.values()].map(record => record.attachment));
        const outcome = Object.freeze({ status: "ready" as const, itemCount: items.length, items });
        this.#records = records;
        this.#outcome = outcome;
        return outcome;
      },
      error => {
        if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration))
          return CANCELLED_PREPARATION;
        const outcome = Object.freeze({
          status: "error" as const,
          itemCount: 0 as const,
          items: EMPTY_ATTACHMENTS,
          error,
        });
        this.#outcome = outcome;
        return outcome;
      },
    );
    this.#preparation = preparation;
    return preparation;
  }

  /** Returns a fresh detached projection of the active document's attachments. */
  public async getAttachments(
    host: DocumentAttachmentsHost,
  ): Promise<PdfjsViewerAttachmentsResult> {
    if (host.isDestroyed) return { ok: false, reason: "destroyed" };
    if (!host.attachmentsEnabled) return { ok: false, reason: "disabled" };
    const pdf = host.getPdf();
    if (!host.isReady || !pdf) return { ok: false, reason: "not-ready" };

    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const outcome = await waitForSignal(this.prepare(host), host.getDocumentSignal());
    if (host.isDestroyed) return { ok: false, reason: "destroyed" };
    if (
      !outcome ||
      !this.#isCurrent(host, pdf, generation, lifecycleGeneration) ||
      outcome.status === "cancelled"
    ) {
      return { ok: false, reason: "cancelled" };
    }
    if (outcome.status === "error") return { ok: false, reason: "error", error: outcome.error };
    return { ok: true, attachments: outcome.items.map(cloneAttachment) };
  }

  /** Lazily resolves one attachment's bytes without retaining settled worker bytes. */
  public async getContent(
    host: DocumentAttachmentsHost,
    id: string,
  ): Promise<DocumentAttachmentContentOutcome> {
    if (host.isDestroyed || !host.attachmentsEnabled) return { status: "cancelled" };
    const pdf = host.getPdf();
    if (!host.isReady || !pdf) return { status: "cancelled" };

    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const preparation = await waitForSignal(this.prepare(host), host.getDocumentSignal());
    if (
      !preparation ||
      !this.#isCurrent(host, pdf, generation, lifecycleGeneration) ||
      preparation.status === "cancelled"
    ) {
      return { status: "cancelled" };
    }
    if (preparation.status === "error") return { status: "error", error: preparation.error };
    const record = this.#records.get(id);
    if (!record) return { status: "not-found" };

    let read = this.#contentReads.get(id);
    if (!read) {
      const settlement = this.#track(
        Promise.resolve().then(() => pdf.getAttachmentContent(record.originalId)),
      );
      read = settlement.then<DocumentAttachmentContentOutcome, DocumentAttachmentContentOutcome>(
        content => {
          if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration))
            return { status: "cancelled" };
          if (content instanceof Uint8Array) {
            return { status: "ready", attachment: cloneAttachment(record.attachment), content };
          }
          if (content !== null) {
            return {
              status: "error",
              error: new TypeError("PdfjsViewer: attachment content was not a Uint8Array or null"),
            };
          }
          return { status: "unavailable" };
        },
        error =>
          this.#isCurrent(host, pdf, generation, lifecycleGeneration)
            ? { status: "error", error }
            : { status: "cancelled" },
      );
      this.#contentReads.set(id, read);
      void read.then(() => {
        if (this.#contentReads.get(id) === read) this.#contentReads.delete(id);
      });
    }

    const outcome = await waitForSignal(read, host.getDocumentSignal());
    if (!outcome || !this.#isCurrent(host, pdf, generation, lifecycleGeneration))
      return { status: "cancelled" };
    return outcome.status === "ready"
      ? {
          status: "ready",
          attachment: cloneAttachment(outcome.attachment),
          content: outcome.content,
        }
      : outcome;
  }

  /** Reads an annotation-local embedded file without requiring catalog discovery. */
  public async getPageLocalContent(
    host: DocumentAttachmentsHost,
    id: string,
  ): Promise<Uint8Array | null> {
    if (host.isDestroyed || !host.isReady || typeof id !== "string" || !id) return null;
    const pdf = host.getPdf();
    if (!pdf) return null;
    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const read = this.#track(Promise.resolve().then(() => pdf.getAttachmentContent(id)));
    try {
      const content = await waitForSignal(read, host.getDocumentSignal());
      return this.#isCurrent(host, pdf, generation, lifecycleGeneration) &&
        content instanceof Uint8Array
        ? content
        : null;
    } catch {
      return null;
    }
  }

  #normalize(attachments: CatalogAttachments): ReadonlyMap<string, AttachmentRecord> {
    const records = new Map<string, AttachmentRecord>();
    if (!attachments) return records;
    for (const [id, value] of attachments) {
      if (typeof id !== "string" || !id) continue;
      const attachment = Object.freeze({
        id,
        filename: safeFilename(value?.filename),
        description: normalizeDescription(value?.description),
      });
      records.set(
        id,
        Object.freeze({
          attachment,
          originalId: id,
        }),
      );
    }
    return records;
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#settlements.add(promise);
    void promise.then(
      () => this.#settlements.delete(promise),
      () => this.#settlements.delete(promise),
    );
    return promise;
  }

  #isCurrent(
    host: DocumentAttachmentsHost,
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    lifecycleGeneration: number,
  ): boolean {
    return (
      lifecycleGeneration === this.#lifecycleGeneration && host.isCurrentDocument(pdf, generation)
    );
  }
}

/** Lets a public request cancel while the underlying PDF.js operation settles. */
function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const finish = (value: T | null) => {
      signal.removeEventListener("abort", cancel);
      resolve(value);
    };
    const cancel = () => finish(null);
    signal.addEventListener("abort", cancel, { once: true });
    void promise.then(
      value => finish(value),
      () => finish(null),
    );
  });
}

function cloneAttachment(attachment: PdfjsViewerAttachment): PdfjsViewerAttachment {
  return { id: attachment.id, filename: attachment.filename, description: attachment.description };
}

function safeFilename(value: unknown): string {
  if (typeof value !== "string") return "attachment.bin";
  const basename = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const safe = basename
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .trim();
  return safe && safe !== "." && safe !== ".." ? safe : "attachment.bin";
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const description = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .trim();
  return description || null;
}
