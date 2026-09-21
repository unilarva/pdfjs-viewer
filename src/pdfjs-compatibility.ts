// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private qualified PDF.js compatibility boundary for package-owned adapters.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. It contains every narrow PDF.js shape cast;
 * feature, security, and lifecycle policy remains with its owning module.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative boundary.
 * @packageDocumentation
 * @module pdfjs-compatibility
 */

import type * as PDFJS from "pdfjs-dist";
import { PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS } from "./pdfjs-version-policy.js";

const qualifiedContracts = PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS.join(", ");

type RecordLike = Record<PropertyKey, unknown>;
export type AnnotationStorage = PDFJS.PDFDocumentProxy["annotationStorage"];
export type PdfjsMarkInfo = ReadonlyMap<"Marked" | "UserProperties" | "Suspects", boolean>;

function incompatible(surface: string, capability: string): TypeError {
  return new TypeError(
    `PdfjsViewer: incompatible pdfjs-dist qualified contract (${qualifiedContracts}) ${surface} is missing ${capability}`,
  );
}

function requireMethods(value: unknown, methods: readonly PropertyKey[], surface: string): void {
  for (const method of methods) {
    if (typeof (value as RecordLike | null)?.[method] !== "function")
      throw incompatible(surface, `${String(method)}()`);
  }
}

function requireWritableProperty(value: object, property: PropertyKey, surface: string): void {
  let owner: object | null = value;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, property);
    if (descriptor) {
      if (descriptor.writable === true || typeof descriptor.set === "function") return;
      throw incompatible(surface, `writable ${String(property)}`);
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  throw incompatible(surface, String(property));
}

/** Validates every PDF.js display export required by enabled package features. */
export function validatePdfjsDisplayCapabilities(
  pdfjs: unknown,
  requirements: Readonly<{ text?: boolean; annotations?: boolean; xfa?: boolean }> = {},
): void {
  const candidate = pdfjs as RecordLike | null;
  if (requirements.text) {
    if (typeof candidate?.TextLayer !== "function")
      throw incompatible("display module", "TextLayer");
    requireMethods(
      (candidate.TextLayer as { prototype?: unknown }).prototype,
      ["render", "cancel"],
      "TextLayer.prototype",
    );
  }
  if (!requirements.annotations && !requirements.xfa) return;
  if (typeof candidate?.AnnotationLayer !== "function")
    throw incompatible("display module", "AnnotationLayer");
  requireMethods(
    (candidate.AnnotationLayer as { prototype?: unknown }).prototype,
    ["render", "update", "destroy"],
    "AnnotationLayer.prototype",
  );
  const expected = { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 } as const;
  for (const [name, value] of Object.entries(expected)) {
    if ((candidate.AnnotationMode as Record<string, unknown> | undefined)?.[name] !== value) {
      throw incompatible("display module", `AnnotationMode.${name} === ${value}`);
    }
  }
  if (requirements.xfa) {
    if (typeof candidate.XfaLayer !== "function") throw incompatible("display module", "XfaLayer");
    requireMethods(candidate.XfaLayer, ["render", "update", "getPageViewport"], "XfaLayer");
  }
}

/** Validates the loaded PDF.js proxy surface before an owner receives it. */
export function validatePdfjsDocumentCapabilities(
  pdf: unknown,
  requirements: Readonly<{ attachments: boolean; forms: boolean; layers: boolean; print: boolean }>,
): void {
  const candidate = pdf as Record<string, unknown> | null;
  if (!candidate || typeof candidate !== "object")
    throw new TypeError("PdfjsViewer: PDF.js returned an invalid PDFDocumentProxy");
  const methods = [
    "cleanup",
    "getData",
    "getDestination",
    "getDestinations",
    "getMarkInfo",
    "getMetadata",
    "getOutline",
    "getPage",
    "getPageIndex",
    "getPageLayout",
    "getPermissions",
  ];
  if (requirements.attachments) methods.push("getAttachmentContent", "getAttachments");
  if (requirements.forms) methods.push("getFieldObjects", "saveDocument");
  if (requirements.layers || requirements.print) methods.push("getOptionalContentConfig");
  requireMethods(candidate, methods, "PDFDocumentProxy");
  if (!Number.isSafeInteger(candidate.numPages) || (candidate.numPages as number) < 1)
    throw new TypeError("PdfjsViewer: PDF.js returned an invalid PDFDocumentProxy.numPages");
  for (const property of ["fingerprints", "isPureXfa"] as const)
    if (!(property in candidate)) throw incompatible("PDFDocumentProxy", property);
  if (
    (requirements.forms || requirements.print) &&
    (!candidate.annotationStorage || typeof candidate.annotationStorage !== "object")
  ) {
    throw incompatible("PDFDocumentProxy", "annotationStorage");
  }
  if (requirements.forms || requirements.print) {
    const storage = candidate.annotationStorage as AnnotationStorage;
    assertAnnotationStorage(storage);
    if (requirements.print && (!storage.print || typeof storage.print !== "object")) {
      throw incompatible("AnnotationStorage", "print storage");
    }
  }
  if (requirements.forms && !("allXfaHtml" in candidate))
    throw incompatible("PDFDocumentProxy", "allXfaHtml");
}

export const ANNOTATION_STORAGE_CAPABILITIES = Object.freeze([
  "getValue",
  "getRawValue",
  "has",
  "remove",
  "setValue",
  "resetModified",
  "resetModifiedIds",
  "updateEditor",
  "getEditor",
  Symbol.iterator,
] as const);

export function assertAnnotationStorage(storage: AnnotationStorage): void {
  requireMethods(storage, ANNOTATION_STORAGE_CAPABILITIES, "AnnotationStorage");
  for (const capability of [
    "size",
    "print",
    "serializable",
    "editorStats",
    "modifiedIds",
  ] as const) {
    if (!(capability in storage)) throw incompatible("AnnotationStorage", capability);
  }
  for (const callback of ["onSetModified", "onResetModified", "onAnnotationEditor"] as const) {
    requireWritableProperty(storage, callback, "AnnotationStorage");
  }
}

type AnnotationStorageCallbacks = {
  onSetModified: (() => void) | null;
  onResetModified: (() => void) | null;
};

/** Installs callbacks only when both PDF.js callback slots can be restored safely. */
export function installAnnotationStorageCallbacks(
  storage: AnnotationStorage,
  observe: () => void,
): () => void {
  const callbacks = storage as unknown as AnnotationStorageCallbacks;
  let previousSet: (() => void) | null;
  let previousReset: (() => void) | null;
  try {
    previousSet = callbacks.onSetModified;
    previousReset = callbacks.onResetModified;
    if (
      (previousSet !== null && typeof previousSet !== "function") ||
      (previousReset !== null && typeof previousReset !== "function")
    )
      throw new TypeError();
    const onSetModified = () => {
      try {
        previousSet?.();
      } finally {
        observe();
      }
    };
    const onResetModified = () => {
      try {
        previousReset?.();
      } finally {
        observe();
      }
    };
    callbacks.onSetModified = onSetModified;
    callbacks.onResetModified = onResetModified;
    if (callbacks.onSetModified !== onSetModified || callbacks.onResetModified !== onResetModified)
      throw new TypeError();
    callbacks.onSetModified = previousSet;
    callbacks.onResetModified = previousReset;
    if (callbacks.onSetModified !== previousSet || callbacks.onResetModified !== previousReset)
      throw new TypeError();
    callbacks.onSetModified = onSetModified;
    callbacks.onResetModified = onResetModified;
    return () => {
      try {
        if (callbacks.onSetModified === onSetModified) callbacks.onSetModified = previousSet;
      } catch {}
      try {
        if (callbacks.onResetModified === onResetModified)
          callbacks.onResetModified = previousReset;
      } catch {}
    };
  } catch {
    try {
      callbacks.onSetModified = previousSet!;
    } catch {}
    try {
      callbacks.onResetModified = previousReset!;
    } catch {}
    throw incompatible(
      "AnnotationStorage",
      "writable and restorable onSetModified/onResetModified callback slots",
    );
  }
}

/** Validates and performs the sole package adapter cast to PDF.js AnnotationStorage. */
export function asPdfjsAnnotationStorage(adapter: object): AnnotationStorage {
  const storage = adapter as unknown as AnnotationStorage;
  assertAnnotationStorage(storage);
  return storage;
}

/** Contains PDF.js 6.3.289's runtime Map while its generated declaration still describes an object. */
export function getPdfjsMarkInfo(pdf: PDFJS.PDFDocumentProxy): Promise<PdfjsMarkInfo | null> {
  return pdf.getMarkInfo() as unknown as Promise<PdfjsMarkInfo | null>;
}

/** Clones a PDF.js optional-content configuration through its qualified static surface. */
export function clonePdfjsOptionalContentConfig<T>(serializable: unknown, source: T): T {
  const constructor = (source as { constructor?: { fromSerializable?: (value: unknown) => T } })
    .constructor;
  if (typeof constructor?.fromSerializable !== "function")
    throw incompatible("OptionalContentConfig", "fromSerializable()");
  return constructor.fromSerializable(serializable);
}

export interface PdfjsAnnotationLayerInstance {
  render(parameters: object): Promise<void>;
  update(parameters: object): void;
  destroy(): void;
}
export interface PdfjsAnnotationLayerConstruction {
  readonly div: HTMLDivElement;
  readonly page: PDFJS.PDFPageProxy;
  readonly viewport: PDFJS.PageViewport;
  readonly linkService: object;
  readonly annotationCanvasMap: Map<string, HTMLCanvasElement>;
  readonly accessibilityManager: null;
  readonly annotationEditorUIManager: null;
  readonly structTreeLayer: null;
  readonly commentManager: null;
  readonly annotationStorage: AnnotationStorage | null;
}
export interface PdfjsAnnotationLayerRenderParameters {
  readonly div: HTMLDivElement;
  readonly page: PDFJS.PDFPageProxy;
  readonly viewport: PDFJS.PageViewport;
  readonly linkService: object;
  readonly annotationCanvasMap: Map<string, HTMLCanvasElement>;
  readonly annotations: readonly unknown[];
  readonly downloadManager: object;
  readonly imageResourcesPath: string;
  readonly renderForms: boolean;
  readonly annotationStorage: AnnotationStorage | undefined;
  readonly enableScripting: boolean;
  readonly hasJSActions: boolean;
  readonly fieldObjects: Map<string, unknown[]> | null;
  readonly optionalContentConfig?: object;
}
export function createPdfjsAnnotationLayer(
  constructor: unknown,
  parameters: PdfjsAnnotationLayerConstruction,
): PdfjsAnnotationLayerInstance {
  if (typeof constructor !== "function") throw incompatible("display module", "AnnotationLayer");
  return new (constructor as new (value: never) => PdfjsAnnotationLayerInstance)(
    parameters as never,
  );
}
export function renderPdfjsAnnotationLayer(
  layer: PdfjsAnnotationLayerInstance,
  parameters: PdfjsAnnotationLayerRenderParameters,
): Promise<void> {
  return layer.render(parameters);
}
export function updatePdfjsAnnotationLayer(
  layer: PdfjsAnnotationLayerInstance,
  parameters: Readonly<{ viewport: PDFJS.PageViewport; optionalContentConfig?: object }>,
): void {
  layer.update(parameters);
}

export interface PdfjsXfaLayerParameters {
  readonly viewport: PDFJS.PageViewport;
  readonly div: HTMLDivElement;
  readonly xfaHtml: unknown;
  readonly annotationStorage?: unknown;
  readonly linkService: object | null;
  readonly intent?: "display" | "print";
}
export function renderPdfjsXfaLayer(layer: unknown, parameters: PdfjsXfaLayerParameters): void {
  const render = (layer as RecordLike | null)?.render;
  if (typeof render !== "function") throw incompatible("XfaLayer", "render()");
  render.call(layer, parameters as never);
}
export function updatePdfjsXfaLayer(layer: unknown, parameters: PdfjsXfaLayerParameters): void {
  const update = (layer as RecordLike | null)?.update;
  if (typeof update !== "function") throw incompatible("XfaLayer", "update()");
  update.call(layer, parameters as never);
}
export function getPdfjsXfaPageViewport(
  layer: unknown,
  xfaHtml: unknown,
  parameters: Readonly<{ scale: number; rotation: number }>,
): PDFJS.PageViewport {
  const getPageViewport = (layer as RecordLike | null)?.getPageViewport;
  if (typeof getPageViewport !== "function") throw incompatible("XfaLayer", "getPageViewport()");
  return getPageViewport.call(layer, xfaHtml as object, parameters as never) as PDFJS.PageViewport;
}

export interface PdfPageRenderTask {
  readonly task: PDFJS.RenderTask;
  readonly promise: Promise<void>;
}
function abortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  if (typeof DOMException !== "undefined")
    return new DOMException("The operation was aborted", "AbortError");
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}
/** Starts one exact task synchronously and removes abort wiring at physical settlement. */
export function startPdfPageRenderTask(
  page: PDFJS.PDFPageProxy,
  parameters: Parameters<PDFJS.PDFPageProxy["render"]>[0],
  signal?: AbortSignal,
): PdfPageRenderTask {
  if (signal?.aborted) throw abortError(signal.reason);
  const task = page.render(parameters);
  let cancelledBySignal = false;
  const abort = () => {
    if (cancelledBySignal) return;
    cancelledBySignal = true;
    task.cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const promise = task.promise
    .then(
      () => undefined,
      error => {
        if (cancelledBySignal) throw abortError(signal?.reason);
        throw error;
      },
    )
    .finally(() => signal?.removeEventListener("abort", abort));
  return Object.freeze({ task, promise });
}

export function readPdfjsWorkerPort(
  globals: unknown,
): Readonly<{ present: boolean; value: Worker | null | undefined }> {
  try {
    const record = globals as RecordLike;
    return "workerPort" in record
      ? { present: true, value: record.workerPort as Worker | null | undefined }
      : { present: false, value: undefined };
  } catch {
    return { present: false, value: undefined };
  }
}
export function writePdfjsWorkerPort(
  globals: unknown,
  workerPort: Worker | null | undefined,
): boolean {
  try {
    const record = globals as RecordLike;
    if (!("workerPort" in record)) return false;
    record.workerPort = workerPort;
    return true;
  } catch {
    return false;
  }
}
