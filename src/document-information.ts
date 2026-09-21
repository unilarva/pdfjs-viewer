// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private document-local metadata and document-information model.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentInformation` joins concurrent requests into one atomic PDF.js read,
 * normalizes PDF.js objects into a detached package-owned model, and caches only
 * that model. Reset invalidates pending publication; callers are cancelled at the
 * facade boundary while uncancellable PDF.js reads remain settlement dependencies
 * for old-proxy cleanup.
 * See the [architecture guide](../ARCHITECTURE.md) for lifecycle ordering and the
 * model/facade boundary.
 *
 * @packageDocumentation
 * @module document-information
 */

import type * as PDFJS from "pdfjs-dist";
import type {
  PdfjsViewerDocumentInformation,
  PdfjsViewerDocumentInformationResult,
  PdfjsViewerMetadataValue,
  PdfjsViewerPermission,
} from "./viewer-contracts.js";
import { getPdfjsMarkInfo, type PdfjsMarkInfo } from "./pdfjs-compatibility.js";

const PERMISSIONS = Object.freeze([
  [0x04, "print"],
  [0x08, "modify-contents"],
  [0x10, "copy"],
  [0x20, "modify-annotations"],
  [0x100, "fill-interactive-forms"],
  [0x200, "copy-for-accessibility"],
  [0x400, "assemble"],
  [0x800, "print-high-quality"],
] as const satisfies readonly (readonly [number, PdfjsViewerPermission])[]);

/** Lifecycle capabilities required by the information model. */
export interface DocumentInformationHost {
  readonly isDestroyed: boolean;
  readonly isReady: boolean;
  getPdf(): PDFJS.PDFDocumentProxy | null;
  getDocumentGeneration(): number;
  getDocumentSignal(): AbortSignal;
  isCurrentDocument(pdf: PDFJS.PDFDocumentProxy, generation: number): boolean;
}

type InformationOutcome =
  | { readonly status: "ready"; readonly information: PdfjsViewerDocumentInformation }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "cancelled" };

/** Owns one normalized, immutable information snapshot for the active document. */
export class DocumentInformation {
  #lifecycleGeneration = 0;
  #preparation: Promise<InformationOutcome> | null = null;
  #outcome: Exclude<InformationOutcome, { status: "cancelled" }> | null = null;

  /** In-flight PDF.js reads that old-proxy cleanup must not race. */
  public get preparation(): Promise<InformationOutcome> | null {
    return this.#preparation;
  }

  /** Invalidates pending publication and drops the active document's cache. */
  public reset(): void {
    this.#lifecycleGeneration++;
    this.#preparation = null;
    this.#outcome = null;
  }

  /** Returns a fresh detached projection of the active document's information. */
  public async getInformation(
    host: DocumentInformationHost,
  ): Promise<PdfjsViewerDocumentInformationResult> {
    if (host.isDestroyed) return { ok: false, reason: "destroyed" };
    const pdf = host.getPdf();
    if (!host.isReady || !pdf) return { ok: false, reason: "not-ready" };

    const generation = host.getDocumentGeneration();
    const lifecycleGeneration = this.#lifecycleGeneration;
    const outcome = await waitForSignal(
      this.#prepare(host, pdf, generation, lifecycleGeneration),
      host.getDocumentSignal(),
    );
    if (host.isDestroyed) return { ok: false, reason: "destroyed" };
    if (!outcome || !this.#isCurrent(host, pdf, generation, lifecycleGeneration)) {
      return { ok: false, reason: "cancelled" };
    }
    if (outcome.status === "error") return { ok: false, reason: "error", error: outcome.error };
    if (outcome.status === "cancelled") return { ok: false, reason: "cancelled" };
    return { ok: true, information: cloneInformation(outcome.information) };
  }

  #prepare(
    host: DocumentInformationHost,
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    lifecycleGeneration: number,
  ): Promise<InformationOutcome> {
    if (this.#outcome) return Promise.resolve(this.#outcome);
    if (this.#preparation) return this.#preparation;

    const preparation = this.#read(pdf).then<InformationOutcome, InformationOutcome>(
      information => {
        if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration))
          return { status: "cancelled" };
        const outcome = { status: "ready", information } as const;
        this.#outcome = outcome;
        return outcome;
      },
      error => {
        if (!this.#isCurrent(host, pdf, generation, lifecycleGeneration))
          return { status: "cancelled" };
        const outcome = { status: "error", error } as const;
        this.#outcome = outcome;
        return outcome;
      },
    );
    this.#preparation = preparation;
    void preparation.finally(() => {
      if (this.#preparation === preparation) this.#preparation = null;
    });
    return preparation;
  }

  async #read(pdf: PDFJS.PDFDocumentProxy): Promise<PdfjsViewerDocumentInformation> {
    // PDF.js does not expose cancellation for these reads. Wait for every sibling
    // even when one rejects so proxy cleanup never races work hidden by Promise.all.
    const results = await Promise.allSettled([
      pdf.getMetadata(),
      pdf.getPermissions(),
      getPdfjsMarkInfo(pdf),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    const [metadataResult, permissionsResult, markInfoResult] = results;
    if (
      metadataResult.status !== "fulfilled" ||
      permissionsResult.status !== "fulfilled" ||
      markInfoResult.status !== "fulfilled"
    ) {
      throw new Error("PdfjsViewer: document information reads did not settle");
    }
    const { info, metadata } = metadataResult.value;
    const permissions = permissionsResult.value;
    const markInfo = markInfoResult.value;
    const dictionary = isRecord(info) ? info : {};
    const fingerprints = pdf.fingerprints;
    const hasAcroForm = booleanValue(dictionary.IsAcroFormPresent);
    const hasXfa = booleanValue(dictionary.IsXFAPresent);
    const isPureXfa = pdf.isPureXfa;
    const formPresentation = isPureXfa
      ? "pure-xfa"
      : hasXfa && hasAcroForm
        ? "hybrid-acroform-fallback"
        : hasAcroForm
          ? "acroform"
          : hasXfa
            ? "xfa-unavailable"
            : "none";
    return {
      pageCount: pdf.numPages,
      fingerprints: {
        original: typeof fingerprints[0] === "string" ? fingerprints[0] : "",
        modified: typeof fingerprints[1] === "string" ? fingerprints[1] : null,
      },
      pdfFormatVersion: stringValue(dictionary.PDFFormatVersion),
      language: stringValue(dictionary.Language),
      encryptionFilterName: stringValue(dictionary.EncryptFilterName),
      isLinearized: booleanValue(dictionary.IsLinearized),
      title: stringValue(dictionary.Title),
      author: stringValue(dictionary.Author),
      subject: stringValue(dictionary.Subject),
      keywords: stringValue(dictionary.Keywords),
      creator: stringValue(dictionary.Creator),
      producer: stringValue(dictionary.Producer),
      creationDate: stringValue(dictionary.CreationDate),
      modificationDate: stringValue(dictionary.ModDate),
      trapped: nameValue(dictionary.Trapped),
      custom: normalizeCustomInformation(dictionary.Custom),
      metadata: normalizeMetadata(metadata),
      permissions: normalizePermissions(permissions),
      hasAcroForm,
      hasXfa,
      isPureXfa,
      formPresentation,
      hasCollection: booleanValue(dictionary.IsCollectionPresent),
      hasSignatures: booleanValue(dictionary.IsSignaturesPresent),
      markInfo: normalizeMarkInfo(markInfo),
    };
  }

  #isCurrent(
    host: DocumentInformationHost,
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    lifecycleGeneration: number,
  ): boolean {
    return (
      lifecycleGeneration === this.#lifecycleGeneration && host.isCurrentDocument(pdf, generation)
    );
  }
}

/** Lets the public query cancel while the underlying PDF.js reads settle safely. */
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function nameValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  return isRecord(value) && typeof value.name === "string" ? value.name : null;
}

function normalizeCustomInformation(
  value: unknown,
): Readonly<Record<string, string | number | boolean>> {
  const custom: Record<string, string | number | boolean> = Object.create(null);
  if (!(value instanceof Map)) return custom;
  for (const [key, entry] of value) {
    if (typeof key !== "string") continue;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")
      custom[key] = entry;
    else {
      const name = nameValue(entry);
      if (name !== null) custom[key] = name;
    }
  }
  return custom;
}

function normalizeMetadata(metadata: unknown): Readonly<Record<string, PdfjsViewerMetadataValue>> {
  const normalized: Record<string, PdfjsViewerMetadataValue> = Object.create(null);
  if (
    !metadata ||
    typeof (metadata as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function"
  )
    return normalized;
  for (const entry of metadata as Iterable<readonly [unknown, unknown]>) {
    const [key, value] = entry;
    if (typeof key !== "string") continue;
    if (typeof value === "string") normalized[key] = value;
    else if (Array.isArray(value) && value.every(item => typeof item === "string"))
      normalized[key] = [...value];
  }
  return normalized;
}

function normalizePermissions(
  values: ReadonlySet<number> | null,
): readonly PdfjsViewerPermission[] | null {
  if (values === null) return null;
  return PERMISSIONS.flatMap(([flag, permission]) => (values.has(flag) ? [permission] : []));
}

function normalizeMarkInfo(
  markInfo: PdfjsMarkInfo | null,
): PdfjsViewerDocumentInformation["markInfo"] {
  if (!markInfo) return null;
  return {
    marked: markInfo.get("Marked") === true,
    userProperties: markInfo.get("UserProperties") === true,
    suspects: markInfo.get("Suspects") === true,
  };
}

function cloneInformation(
  information: PdfjsViewerDocumentInformation,
): PdfjsViewerDocumentInformation {
  return {
    ...information,
    fingerprints: { ...information.fingerprints },
    custom: cloneRecord(information.custom, value => value),
    metadata: cloneRecord(information.metadata, value =>
      Array.isArray(value) ? [...value] : value,
    ),
    permissions: information.permissions ? [...information.permissions] : null,
    markInfo: information.markInfo ? { ...information.markInfo } : null,
  };
}

function cloneRecord<T, U>(
  record: Readonly<Record<string, T>>,
  cloneValue: (value: T) => U,
): Readonly<Record<string, U>> {
  const clone: Record<string, U> = Object.create(null);
  for (const [key, value] of Object.entries(record)) clone[key] = cloneValue(value);
  return clone;
}
