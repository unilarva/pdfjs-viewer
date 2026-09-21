// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private fail-fast constructor-option and text-query normalization for {@link PdfjsViewer}.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * The functions here convert sparse consumer options into complete immutable
 * configuration groups before the viewer installs generated/custom UI or lifecycle resources.
 * Keeping this work outside the class separates input policy from stateful setup
 * and ensures invalid options fail before construction has observable effects.
 * Public option contracts remain facade-owned and package-root exported. See the
 * [architecture guide](../ARCHITECTURE.md) for the authoritative input-policy and
 * stateful-facade boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module viewer-options
 */

import { PDFJS_VIEWER_PRINT_DEFAULTS } from "./viewer-contracts.js";
import type {
  PdfjsViewerAccessibilityOptions,
  PdfjsViewerAnnotationMarkupFeatureOptions,
  PdfjsViewerAnnotationLinkFeatureOptions,
  PdfjsViewerBehaviorOptions,
  PdfjsViewerDocumentOptions,
  PdfjsViewerFormsFeatureOptions,
  PdfjsViewerNormalizedPrintOptions,
  PdfjsViewerNormalizedPrintDefaults,
  PdfjsViewerSidebarMode,
  PdfjsViewerInitialSidebarView,
  PdfjsViewerOptions,
  PdfjsViewerPrintOptions,
  PdfjsViewerPrintDefaults,
  PdfjsViewerPrintMode,
  PdfjsViewerSource,
  PdfjsViewerTextQueryOptions,
  PdfjsViewerTextSelectionPersistence,
  PdfjsViewerUiBindings,
  PdfjsViewerUiControlOptions,
  PdfjsViewerUiMode,
  PdfjsViewerUiRenderOptions,
} from "./viewer-contracts.js";
import { normalizePrintPageRanges } from "./print-sheet-planner.js";
import { normalizeGeneratedUiOptions } from "./generated-ui-options.js";
import { PdfjsViewerRuntime } from "./pdfjs-viewer-runtime.js";
import {
  mergeDeviceCompatibilityRules,
  normalizeDeviceCompatibilityRules,
  type PdfjsViewerDeviceCompatibilityRule,
} from "./device-compatibility.js";
import { validatePdfjsDocumentCapabilities } from "./pdfjs-compatibility.js";

export type NormalizedViewerBehavior = {
  textSelectionPersistence: PdfjsViewerTextSelectionPersistence;
  reduceRenderingWhenDocumentHidden: boolean;
  zoom: Required<NonNullable<PdfjsViewerBehaviorOptions["zoom"]>>;
  longPressMs: number;
  sidebarMode: PdfjsViewerSidebarMode;
  zoomGestures: boolean;
  searchQueryOptions: NormalizedTextQueryOptions;
  outlineFilterOptions: NormalizedTextQueryOptions;
  destinationMatchTolerance: number;
  autoFitWidthMaxHeight: number;
  initialSidebarView: PdfjsViewerInitialSidebarView;
};

export type NormalizedTextQueryOptions = Required<PdfjsViewerTextQueryOptions>;

export const DEFAULT_TEXT_QUERY_OPTIONS: Readonly<NormalizedTextQueryOptions> = {
  caseSensitive: false,
  diacritics: "smart",
};

export interface NormalizedViewerFeatures {
  navigationHistory: boolean;
  fullscreen: boolean;
  presentation: boolean;
  textSelection: boolean;
  search: boolean;
  searchPrepareOnLoad: boolean;
  outline: boolean;
  outlineFilter: boolean;
  outlinePrepareOnLoad: boolean;
  thumbnails: boolean;
  attachments: boolean;
  annotationLinks: Required<PdfjsViewerAnnotationLinkFeatureOptions>;
  annotationMarkup: Readonly<
    { enabled: boolean } & Required<PdfjsViewerAnnotationMarkupFeatureOptions>
  >;
  forms: Required<PdfjsViewerFormsFeatureOptions>;
  layers: boolean;
  print: Readonly<{
    mode: PdfjsViewerPrintMode;
    browserFallback: boolean;
    defaults: PdfjsViewerNormalizedPrintDefaults;
  }>;
}

export interface NormalizedViewerUi {
  mode: PdfjsViewerUiMode;
  labels: Readonly<import("./viewer-contracts.js").PdfjsViewerLabels>;
  formatters: Readonly<import("./viewer-contracts.js").PdfjsViewerFormatters>;
  controls: Required<PdfjsViewerUiControlOptions>;
  sidebar: Readonly<{
    primaryViews: readonly import("./viewer-contracts.js").PdfjsViewerSidebarView[];
  }>;
  direction: "ltr" | "rtl" | "auto";
}

export interface NormalizedViewerOptions {
  behavior: NormalizedViewerBehavior;
  features: NormalizedViewerFeatures;
  accessibility: Required<PdfjsViewerAccessibilityOptions>;
  uiBindings: PdfjsViewerUiBindings;
  ui: NormalizedViewerUi;
  thumbnails: Readonly<{ maxDpr: number }>;
  deviceCompatibility: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[];
}

export type NormalizedPdfSource =
  | Readonly<{ type: "url"; url: string; filename: string | null; diagnosticType: "url" }>
  | Readonly<{
      type: "data";
      data: Uint8Array | ArrayBuffer;
      filename: string | null;
      diagnosticType: "uint8array" | "arraybuffer";
    }>;

function requireOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`PdfjsViewer: ${path} must be a boolean when provided`);
  }
}

function isOptionsObject(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (!value || typeof value !== "object") return false;
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (!aborted) return false;
  try {
    return typeof aborted.call(value) === "boolean";
  } catch {
    return false;
  }
}

function validateBooleanOptions(value: object | undefined, path: string): void {
  if (!value) return;
  for (const [name, option] of Object.entries(value))
    requireOptionalBoolean(option, `${path}.${name}`);
}

function rejectUnknownOptions(value: object, allowed: readonly string[], path: string): void {
  for (const name of Object.keys(value)) {
    const qualifiedName = path ? `${path}.${name}` : name;
    if (!allowed.includes(name))
      throw new TypeError(`PdfjsViewer: unknown ${qualifiedName} option`);
  }
}

/** Rejects unsupported PDF.js loading escape hatches before document work starts. */
export function validateDocumentOptions(
  options: PdfjsViewerDocumentOptions | undefined,
  path = "documentOptions",
): void {
  if (options !== undefined && !isOptionsObject(options)) {
    throw new TypeError(`PdfjsViewer: ${path} must be an object when provided`);
  }
  rejectUnknownOptions(
    options ?? {},
    [
      "httpHeaders",
      "withCredentials",
      "password",
      "passwordProvider",
      "rangeChunkSize",
      "disableRange",
      "disableStream",
      "disableAutoFetch",
      "docBaseUrl",
      "cMapUrl",
      "cMapPacked",
      "iccUrl",
      "standardFontDataUrl",
      "wasmUrl",
      "useWorkerFetch",
      "useWasm",
      "useSystemFonts",
      "disableFontFace",
      "stopAtErrors",
      "maxImageSize",
      "verbosity",
    ],
    path,
  );
  if (!options) return;

  if (options.httpHeaders !== undefined) {
    if (!isOptionsObject(options.httpHeaders)) {
      throw new TypeError(`PdfjsViewer: ${path}.httpHeaders must be an object when provided`);
    }
    for (const [name, value] of Object.entries(options.httpHeaders)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        throw new TypeError(`PdfjsViewer: ${path}.httpHeaders contains an invalid header name`);
      }
      if (typeof value !== "string" || /[\r\n]/.test(value)) {
        throw new TypeError(
          `PdfjsViewer: ${path}.httpHeaders.${name} must be a string without line breaks`,
        );
      }
    }
  }
  requireOptionalBoolean(options.withCredentials, `${path}.withCredentials`);
  if (options.password !== undefined && typeof options.password !== "string") {
    throw new TypeError(`PdfjsViewer: ${path}.password must be a string when provided`);
  }
  if (options.passwordProvider !== undefined && typeof options.passwordProvider !== "function") {
    throw new TypeError(`PdfjsViewer: ${path}.passwordProvider must be a function when provided`);
  }
  if (
    options.rangeChunkSize !== undefined &&
    (!Number.isSafeInteger(options.rangeChunkSize) || options.rangeChunkSize <= 0)
  ) {
    throw new RangeError(
      `PdfjsViewer: ${path}.rangeChunkSize must be a positive safe integer when provided`,
    );
  }
  for (const name of [
    "disableRange",
    "disableStream",
    "disableAutoFetch",
    "cMapPacked",
    "useWorkerFetch",
    "useWasm",
    "useSystemFonts",
    "disableFontFace",
    "stopAtErrors",
  ] as const)
    requireOptionalBoolean(options[name], `${path}.${name}`);
  for (const name of [
    "docBaseUrl",
    "cMapUrl",
    "iccUrl",
    "standardFontDataUrl",
    "wasmUrl",
  ] as const) {
    const value = options[name];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      throw new TypeError(`PdfjsViewer: ${path}.${name} must be a non-empty string when provided`);
    }
  }
  for (const name of ["cMapUrl", "iccUrl", "standardFontDataUrl", "wasmUrl"] as const) {
    const value = options[name];
    if (value !== undefined && !value.endsWith("/")) {
      throw new TypeError(`PdfjsViewer: ${path}.${name} must end with a slash`);
    }
  }
  if (
    options.maxImageSize !== undefined &&
    (!Number.isSafeInteger(options.maxImageSize) || options.maxImageSize < -1)
  ) {
    throw new RangeError(
      `PdfjsViewer: ${path}.maxImageSize must be a safe integer greater than or equal to -1 when provided`,
    );
  }
  if (options.verbosity !== undefined && ![0, 1, 5].includes(options.verbosity)) {
    throw new RangeError(
      `PdfjsViewer: ${path}.verbosity must be a PDF.js verbosity level: 0, 1, or 5`,
    );
  }
}

/** Separates the package password callback and derives PDF.js XFA loading only from feature policy. */
export function pdfjsDocumentLoadOptions(
  options: PdfjsViewerDocumentOptions,
  enableXfa: boolean,
): Readonly<{
  passwordProvider: PdfjsViewerDocumentOptions["passwordProvider"];
  pdfjsOptions: Readonly<
    Omit<PdfjsViewerDocumentOptions, "passwordProvider"> & { enableXfa: boolean }
  >;
}> {
  validateDocumentOptions(options);
  const { passwordProvider, ...pdfjsOptions } = options;
  return Object.freeze({
    passwordProvider,
    pdfjsOptions: Object.freeze({ ...pdfjsOptions, enableXfa }),
  });
}

function normalizePrintQuality(value: unknown, path: string): Readonly<{ dpi: number }> {
  if (!isOptionsObject(value)) throw new TypeError(`PdfjsViewer: ${path} must be an object`);
  rejectUnknownOptions(value as object, ["dpi"], path);
  const dpi = (value as { dpi?: unknown }).dpi;
  if (!Number.isFinite(dpi) || (dpi as number) < 72 || (dpi as number) > 600) {
    throw new RangeError(`PdfjsViewer: ${path}.dpi must be finite and between 72 and 600`);
  }
  return Object.freeze({ dpi: dpi as number });
}

function normalizePrintSheet(
  value: unknown,
  path: string,
): PdfjsViewerNormalizedPrintOptions["sheet"] {
  if (typeof value === "string") {
    if (!["a3", "a4", "a5", "letter", "legal"].includes(value)) {
      throw new TypeError(
        `PdfjsViewer: ${path} must be "a3", "a4", "a5", "letter", "legal", or an object`,
      );
    }
    return value as PdfjsViewerNormalizedPrintOptions["sheet"];
  }
  if (!isOptionsObject(value))
    throw new TypeError(
      `PdfjsViewer: ${path} must be "a3", "a4", "a5", "letter", "legal", or an object`,
    );
  rejectUnknownOptions(value as object, ["width", "height", "unit"], path);
  const sheet = value as { width?: unknown; height?: unknown; unit?: unknown };
  if (
    !Number.isFinite(sheet.width) ||
    (sheet.width as number) <= 0 ||
    !Number.isFinite(sheet.height) ||
    (sheet.height as number) <= 0
  ) {
    throw new RangeError(
      `PdfjsViewer: ${path} width and height must be finite and greater than zero`,
    );
  }
  if (!["pt", "mm", "in"].includes(sheet.unit as string)) {
    throw new RangeError(`PdfjsViewer: ${path}.unit must be pt, mm, or in`);
  }
  return Object.freeze({
    width: sheet.width as number,
    height: sheet.height as number,
    unit: sheet.unit as "pt" | "mm" | "in",
  });
}

/** Validates and freezes viewer-level print defaults. */
export function normalizePrintDefaults(
  options: PdfjsViewerPrintDefaults | undefined,
  path = "features.print.defaults",
): PdfjsViewerNormalizedPrintDefaults {
  if (options !== undefined && !isOptionsObject(options)) {
    throw new TypeError(`PdfjsViewer: ${path} must be an object when provided`);
  }
  const source = options ?? {};
  rejectUnknownOptions(source, ["sheet", "pageScaling", "orientation", "quality"], path);
  const pageScaling = source.pageScaling ?? PDFJS_VIEWER_PRINT_DEFAULTS.pageScaling;
  if (pageScaling !== "fit" && pageScaling !== "shrink-to-fit") {
    throw new RangeError(`PdfjsViewer: ${path}.pageScaling must be fit or shrink-to-fit`);
  }
  const orientation = source.orientation ?? PDFJS_VIEWER_PRINT_DEFAULTS.orientation;
  if (!["auto", "portrait", "landscape"].includes(orientation)) {
    throw new RangeError(`PdfjsViewer: ${path}.orientation must be auto, portrait, or landscape`);
  }
  const quality = normalizePrintQuality(
    source.quality ?? PDFJS_VIEWER_PRINT_DEFAULTS.quality,
    `${path}.quality`,
  );
  if (quality.dpi !== 300 && quality.dpi !== 600) {
    throw new RangeError(`PdfjsViewer: ${path}.quality.dpi must be 300 or 600`);
  }
  return Object.freeze({
    sheet: normalizePrintSheet(source.sheet ?? PDFJS_VIEWER_PRINT_DEFAULTS.sheet, `${path}.sheet`),
    pageScaling,
    orientation,
    quality: quality as Readonly<{ dpi: 300 | 600 }>,
  });
}

/** Validates and detaches print options before adapter or native owner use. */
export function normalizePrintOptions(
  options: PdfjsViewerPrintOptions | undefined,
  pageCount: number,
  defaults: PdfjsViewerNormalizedPrintDefaults = PDFJS_VIEWER_PRINT_DEFAULTS,
): PdfjsViewerNormalizedPrintOptions {
  if (options !== undefined && !isOptionsObject(options)) {
    throw new TypeError("PdfjsViewer: print options must be an object when provided");
  }
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw new RangeError("PdfjsViewer: print page count must be a non-negative integer");
  }
  const source = options ?? {};
  rejectUnknownOptions(
    source,
    ["pages", "layout", "quality", "sheet", "pageScaling", "orientation", "signal"],
    "print",
  );

  const pages =
    source.pages === undefined ? "all" : normalizePrintPageRanges(source.pages, pageCount);

  const sourceLayout = source.layout ?? { mode: "auto" };
  if (!isOptionsObject(sourceLayout))
    throw new TypeError("PdfjsViewer: print.layout must be an object");
  if (!["auto", "single", "spread"].includes(sourceLayout.mode as string)) {
    throw new RangeError("PdfjsViewer: print.layout.mode must be auto, single, or spread");
  }
  rejectUnknownOptions(
    sourceLayout,
    sourceLayout.mode === "spread" ? ["mode", "firstPageSide", "gapPt"] : ["mode"],
    "print.layout",
  );
  let layout: PdfjsViewerNormalizedPrintOptions["layout"];
  if (sourceLayout.mode === "spread") {
    const firstPageSide = sourceLayout.firstPageSide ?? "auto";
    if (!["auto", "left", "right"].includes(firstPageSide as string)) {
      throw new RangeError("PdfjsViewer: print.layout.firstPageSide must be auto, left, or right");
    }
    const gapPt = sourceLayout.gapPt ?? 0;
    if (!Number.isFinite(gapPt) || (gapPt as number) < 0) {
      throw new RangeError("PdfjsViewer: print.layout.gapPt must be finite and non-negative");
    }
    layout = Object.freeze({
      mode: "spread",
      firstPageSide,
      gapPt,
    }) as PdfjsViewerNormalizedPrintOptions["layout"];
  } else {
    layout = Object.freeze({
      mode: sourceLayout.mode,
    }) as PdfjsViewerNormalizedPrintOptions["layout"];
  }

  const quality = normalizePrintQuality(source.quality ?? defaults.quality, "print.quality");
  const sheet = normalizePrintSheet(source.sheet ?? defaults.sheet, "print.sheet");
  const pageScaling = source.pageScaling ?? defaults.pageScaling;
  if (pageScaling !== "fit" && pageScaling !== "shrink-to-fit") {
    throw new RangeError("PdfjsViewer: print.pageScaling must be fit or shrink-to-fit");
  }

  const orientation = source.orientation ?? defaults.orientation;
  if (!["auto", "portrait", "landscape"].includes(orientation)) {
    throw new RangeError("PdfjsViewer: print.orientation must be auto, portrait, or landscape");
  }
  if (source.signal !== undefined && !isAbortSignal(source.signal)) {
    throw new TypeError("PdfjsViewer: print.signal must be an AbortSignal when provided");
  }
  return Object.freeze({
    pages,
    layout,
    quality,
    sheet,
    pageScaling,
    orientation,
    ...(source.signal ? { signal: source.signal } : {}),
  });
}

/** Validates and merges a partial text-query policy onto complete defaults. */
export function normalizeTextQueryOptions(
  options: PdfjsViewerTextQueryOptions | undefined,
  defaults: Readonly<NormalizedTextQueryOptions> = DEFAULT_TEXT_QUERY_OPTIONS,
  path = "text query options",
  extraKeys: readonly string[] = [],
): NormalizedTextQueryOptions {
  if (options !== undefined && !isOptionsObject(options)) {
    throw new TypeError(`PdfjsViewer: ${path} must be an object when provided`);
  }
  const source = options ?? {};
  rejectUnknownOptions(source, ["caseSensitive", "diacritics", ...extraKeys], path);
  requireOptionalBoolean(source.caseSensitive, `${path}.caseSensitive`);
  if (
    source.diacritics !== undefined &&
    !["smart", "ignore", "respect"].includes(source.diacritics)
  ) {
    throw new RangeError(`PdfjsViewer: ${path}.diacritics must be smart, ignore, or respect`);
  }
  return {
    caseSensitive: source.caseSensitive ?? defaults.caseSensitive,
    diacritics: source.diacritics ?? defaults.diacritics,
  };
}

const VIEWER_OPTION_KEYS = {
  rootEl: true,
  ui: true,
  uiBindings: true,
  behavior: true,
  runtime: true,
  logger: true,
  pageLayout: true,
  renderingProfile: true,
  renderingProfiles: true,
  renderingProfilePolicy: true,
  deviceCompatibility: true,
  keyboard: true,
  features: true,
  accessibility: true,
  defaultDocumentOptions: true,
  viewerId: true,
  navigationState: true,
  printAdapter: true,
  printSourceResolver: true,
  shareableNamedDestinationPrefix: true,
  fitMode: true,
  initialRotation: true,
  thumbnails: true,
} satisfies Readonly<Record<keyof PdfjsViewerOptions, true>>;

/** Validates shorthand or descriptor input and returns one canonical source shape. */
export function normalizePdfSource(value: PdfjsViewerSource, path = "source"): NormalizedPdfSource {
  if (typeof value === "string") {
    if (!value.trim()) throw new TypeError(`PdfjsViewer: ${path} URL must be non-empty`);
    return { type: "url", url: value, filename: null, diagnosticType: "url" };
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    if (value.byteLength === 0) throw new TypeError(`PdfjsViewer: ${path} data must be non-empty`);
    return {
      type: "data",
      data: value,
      filename: null,
      diagnosticType: value instanceof Uint8Array ? "uint8array" : "arraybuffer",
    };
  }
  if (!isOptionsObject(value)) {
    throw new TypeError(`PdfjsViewer: ${path} must be a URL, PDF data, or source descriptor`);
  }
  if (value.type !== "url" && value.type !== "data") {
    throw new TypeError(`PdfjsViewer: ${path}.type must be url or data`);
  }
  const allowed = value.type === "url" ? ["type", "url", "filename"] : ["type", "data", "filename"];
  rejectUnknownOptions(value, allowed, path);
  if (
    value.filename !== undefined &&
    (typeof value.filename !== "string" || !value.filename.trim())
  ) {
    throw new TypeError(`PdfjsViewer: ${path}.filename must be non-empty when provided`);
  }
  const filename = value.filename ?? null;
  if (value.type === "url") {
    if (typeof value.url !== "string" || !value.url.trim()) {
      throw new TypeError(`PdfjsViewer: ${path}.url must be a non-empty string`);
    }
    return { type: "url", url: value.url, filename, diagnosticType: "url" };
  }
  const data = value.data;
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
    throw new TypeError(`PdfjsViewer: ${path}.data must be a Uint8Array or ArrayBuffer`);
  }
  if (data.byteLength === 0) throw new TypeError(`PdfjsViewer: ${path}.data must be non-empty`);
  return {
    type: "data",
    data,
    filename,
    diagnosticType: data instanceof Uint8Array ? "uint8array" : "arraybuffer",
  };
}

function validateUiBindings(bindings: PdfjsViewerUiBindings, ownerDocument: Document): void {
  const elementTypes = {
    controlDiscoveryScope: "HTMLElement",
    container: "HTMLElement",
    download: "HTMLAnchorElement",
    downloadFilledDocument: "HTMLButtonElement",
    print: "HTMLButtonElement",
    documentProgress: "HTMLProgressElement",
  } as const;
  const groupTypes = {
    navigation: {
      previous: "HTMLButtonElement",
      next: "HTMLButtonElement",
      pageNumber: "HTMLInputElement",
      pageCount: "HTMLElement",
    },
    navigationHistory: {
      back: "HTMLButtonElement",
      forward: "HTMLButtonElement",
    },
    fullscreen: { toggle: "HTMLButtonElement" },
    presentation: {
      toggle: "HTMLButtonElement",
      controls: "HTMLElement",
      previous: "HTMLButtonElement",
      next: "HTMLButtonElement",
      exit: "HTMLButtonElement",
    },
    zoom: {
      fit: "HTMLButtonElement",
      fitMenu: "HTMLButtonElement",
      slider: "HTMLInputElement",
      sliderWrap: "HTMLElement",
    },
    search: {
      toggle: "HTMLButtonElement",
      panel: "HTMLElement",
      input: "HTMLInputElement",
      previous: "HTMLButtonElement",
      next: "HTMLButtonElement",
      count: "HTMLElement",
      close: "HTMLButtonElement",
    },
    menu: {
      toggle: "HTMLButtonElement",
      panel: "HTMLElement",
      close: "HTMLButtonElement",
      textSelectionToggle: "HTMLButtonElement",
      pageLayout: "HTMLElement",
      fitMode: "HTMLElement",
      rotateCounterclockwise: "HTMLButtonElement",
      resetRotation: "HTMLButtonElement",
      rotateClockwise: "HTMLButtonElement",
      renderingProfile: "HTMLElement",
    },
    sidebar: {
      container: "HTMLElement",
      toggle: "HTMLButtonElement",
      close: "HTMLButtonElement",
      primaryViews: "HTMLElement",
      moreToggle: "HTMLButtonElement",
      moreMenu: "HTMLElement",
    },
    outline: { content: "HTMLElement", filter: "HTMLElement", filterInput: "HTMLInputElement" },
    thumbnails: { content: "HTMLElement" },
    attachments: { content: "HTMLElement" },
    layers: { content: "HTMLElement" },
    printSetup: {
      dialog: "HTMLDialogElement",
      form: "HTMLFormElement",
      pages: "HTMLSelectElement",
      range: "HTMLInputElement",
      rangeWrap: "HTMLElement",
      layout: "HTMLSelectElement",
      side: "HTMLElement",
      sideSelect: "HTMLSelectElement",
      more: "HTMLDetailsElement",
      sheet: "HTMLSelectElement",
      customSheet: "HTMLElement",
      customSheetWidth: "HTMLInputElement",
      customSheetHeight: "HTMLInputElement",
      customSheetUnit: "HTMLSelectElement",
      pageScaling: "HTMLSelectElement",
      orientation: "HTMLSelectElement",
      quality: "HTMLSelectElement",
      status: "HTMLElement",
      progress: "HTMLProgressElement",
      guidance: "HTMLElement",
      fallbackWarning: "HTMLElement",
      close: "HTMLButtonElement",
      cancel: "HTMLButtonElement",
      source: "HTMLButtonElement",
      submit: "HTMLButtonElement",
      submitDetail: "HTMLElement",
    },
  } as const;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow)
    throw new TypeError("PdfjsViewer: rootEl ownerDocument must have a defaultView");
  const requireElement = (element: unknown, typeName: string, path: string): void => {
    const ElementType = (ownerWindow as unknown as Record<string, typeof HTMLElement>)[typeName];
    if (typeof ElementType !== "function" || !(element instanceof ElementType)) {
      throw new TypeError(`PdfjsViewer: ${path} must be an ${typeName}`);
    }
    if ((element as Element).ownerDocument !== ownerDocument) {
      throw new TypeError(`PdfjsViewer: ${path} must belong to rootEl.ownerDocument`);
    }
  };
  rejectUnknownOptions(
    bindings,
    [...Object.keys(elementTypes), ...Object.keys(groupTypes)],
    "uiBindings",
  );
  for (const [name, value] of Object.entries(bindings)) {
    if (name in groupTypes) {
      if (!isOptionsObject(value))
        throw new TypeError(`PdfjsViewer: uiBindings.${name} must be an object`);
      const types = groupTypes[name as keyof typeof groupTypes];
      rejectUnknownOptions(value, Object.keys(types), `uiBindings.${name}`);
      for (const [child, element] of Object.entries(value)) {
        requireElement(element, types[child as keyof typeof types], `uiBindings.${name}.${child}`);
      }
      continue;
    }
    requireElement(value, elementTypes[name as keyof typeof elementTypes], `uiBindings.${name}`);
  }
}

/** Validates constructor input and normalizes independent option groups. */
export function normalizeViewerOptions(
  opts: PdfjsViewerOptions,
  hasTouch: boolean,
): NormalizedViewerOptions {
  if (!opts || typeof opts !== "object")
    throw new TypeError("PdfjsViewer: options must be an object");
  rejectUnknownOptions(opts, Object.keys(VIEWER_OPTION_KEYS), "");
  const ownerDocument = opts.rootEl?.ownerDocument;
  const ownerWindow = ownerDocument?.defaultView;
  if (!ownerDocument || !ownerWindow || !(opts.rootEl instanceof ownerWindow.HTMLElement)) {
    throw new TypeError(
      "PdfjsViewer: rootEl must be an HTMLElement whose ownerDocument has a defaultView",
    );
  }
  if (!(opts.runtime instanceof PdfjsViewerRuntime))
    throw new TypeError("PdfjsViewer: runtime must be a PdfjsViewerRuntime");
  if (opts.viewerId !== undefined && (typeof opts.viewerId !== "string" || !opts.viewerId.trim()))
    throw new TypeError("PdfjsViewer: viewerId must be a non-empty string when provided");
  if (
    opts.shareableNamedDestinationPrefix !== undefined &&
    typeof opts.shareableNamedDestinationPrefix !== "string"
  )
    throw new TypeError(
      "PdfjsViewer: shareableNamedDestinationPrefix must be a string when provided",
    );
  if (opts.logger !== undefined && typeof opts.logger !== "function")
    throw new TypeError("PdfjsViewer: logger must be a function when provided");
  if (opts.printAdapter !== undefined && typeof opts.printAdapter !== "function")
    throw new TypeError("PdfjsViewer: printAdapter must be a function when provided");
  if (opts.printSourceResolver !== undefined && typeof opts.printSourceResolver !== "function")
    throw new TypeError("PdfjsViewer: printSourceResolver must be a function when provided");
  if (opts.uiBindings !== undefined && !isOptionsObject(opts.uiBindings))
    throw new TypeError("PdfjsViewer: uiBindings must be an object when provided");
  if (opts.ui !== undefined && typeof opts.ui !== "string" && !isOptionsObject(opts.ui))
    throw new TypeError("PdfjsViewer: ui must be a mode string or options object when provided");
  if (opts.behavior !== undefined && !isOptionsObject(opts.behavior))
    throw new TypeError("PdfjsViewer: behavior must be an options object when provided");
  if (opts.features !== undefined && !isOptionsObject(opts.features))
    throw new TypeError("PdfjsViewer: features must be an options object when provided");
  const deviceCompatibility = mergeDeviceCompatibilityRules(
    normalizeDeviceCompatibilityRules(opts.deviceCompatibility),
  );
  validateDocumentOptions(opts.defaultDocumentOptions, "defaultDocumentOptions");
  if (opts.thumbnails !== undefined && !isOptionsObject(opts.thumbnails))
    throw new TypeError("PdfjsViewer: thumbnails must be an options object when provided");
  rejectUnknownOptions(opts.thumbnails ?? {}, ["maxDpr"], "thumbnails");
  const thumbnailMaxDpr = opts.thumbnails?.maxDpr ?? 2;
  if (!Number.isFinite(thumbnailMaxDpr) || thumbnailMaxDpr <= 0)
    throw new RangeError("PdfjsViewer: thumbnails.maxDpr must be finite and greater than zero");
  const sourceUi = (
    typeof opts.ui === "string" ? { mode: opts.ui } : (opts.ui ?? {})
  ) as Partial<PdfjsViewerUiRenderOptions> & { mode?: PdfjsViewerUiMode };
  rejectUnknownOptions(
    sourceUi,
    ["mode", "labels", "formatters", "direction", "controls", "sidebar"],
    "ui",
  );
  const uiMode = sourceUi.mode;
  if (uiMode !== undefined && !["default", "custom", "headless"].includes(uiMode))
    throw new RangeError("PdfjsViewer: ui.mode must be default, custom, or headless");
  if (uiMode === "custom" || uiMode === "headless") {
    for (const name of ["direction", "controls", "sidebar"] as const) {
      if (sourceUi[name] !== undefined)
        throw new TypeError(`PdfjsViewer: ui.${name} is accepted only in default mode`);
    }
  }
  if (
    opts.keyboard !== undefined &&
    opts.keyboard !== false &&
    (!opts.keyboard || typeof opts.keyboard !== "object")
  )
    throw new TypeError("PdfjsViewer: keyboard must be false or an options object when provided");
  if (
    opts.keyboard &&
    opts.keyboard.scope !== undefined &&
    opts.keyboard.scope !== "viewer" &&
    opts.keyboard.scope !== "global"
  )
    throw new RangeError("PdfjsViewer: keyboard.scope must be viewer or global");
  if (
    opts.pageLayout !== undefined &&
    !["auto", "single", "double", "book"].includes(opts.pageLayout)
  )
    throw new RangeError("PdfjsViewer: pageLayout must be auto, single, double, or book");
  if (opts.fitMode !== undefined && !["auto", "contain", "width", "height"].includes(opts.fitMode))
    throw new RangeError("PdfjsViewer: fitMode must be auto, contain, width, or height");
  if (opts.initialRotation !== undefined && ![0, 90, 180, 270].includes(opts.initialRotation))
    throw new RangeError("PdfjsViewer: initialRotation must be 0, 90, 180, or 270");
  if (
    opts.renderingProfile !== undefined &&
    !["auto", "conservative", "balanced", "aggressive"].includes(opts.renderingProfile)
  )
    throw new RangeError(
      "PdfjsViewer: renderingProfile must be auto, conservative, balanced, or aggressive",
    );

  const uiBindings = opts.uiBindings ?? {};
  validateUiBindings(uiBindings, ownerDocument);
  const sourceBehavior = opts.behavior ?? {};
  rejectUnknownOptions(
    sourceBehavior,
    [
      "zoom",
      "longPressMs",
      "sidebarMode",
      "zoomGestures",
      "searchQueryOptions",
      "outlineFilterOptions",
      "destinationMatchTolerance",
      "textSelectionPersistence",
      "reduceRenderingWhenDocumentHidden",
      "autoFitWidthMaxHeight",
      "initialSidebarView",
    ],
    "behavior",
  );
  const zoom = {
    minDesktop: 0.2,
    maxDesktop: 10,
    minMobile: 0.2,
    maxMobile: 4,
    ...sourceBehavior.zoom,
  };
  for (const [name, value] of Object.entries(zoom)) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError(
        `PdfjsViewer: behavior.zoom.${name} must be finite and greater than zero`,
      );
  }
  if (zoom.maxDesktop < zoom.minDesktop || zoom.maxMobile < zoom.minMobile)
    throw new RangeError(
      "PdfjsViewer: maximum zoom scales must not be smaller than minimum zoom scales",
    );
  const longPressMs = sourceBehavior.longPressMs ?? (hasTouch ? 650 : 550);
  if (!Number.isFinite(longPressMs) || longPressMs < 0)
    throw new RangeError("PdfjsViewer: behavior.longPressMs must be finite and non-negative");
  const sidebarMode = sourceBehavior.sidebarMode ?? "auto";
  if (!["auto", "overlay", "persistent"].includes(sidebarMode))
    throw new RangeError("PdfjsViewer: behavior.sidebarMode must be auto, overlay, or persistent");
  const initialSidebarView = sourceBehavior.initialSidebarView ?? "auto";
  if (!["auto", "outline", "thumbnails", "attachments", "layers"].includes(initialSidebarView))
    throw new RangeError(
      "PdfjsViewer: behavior.initialSidebarView must be auto, outline, thumbnails, attachments, or layers",
    );
  requireOptionalBoolean(sourceBehavior.zoomGestures, "behavior.zoomGestures");
  requireOptionalBoolean(
    sourceBehavior.reduceRenderingWhenDocumentHidden,
    "behavior.reduceRenderingWhenDocumentHidden",
  );
  const textSelectionPersistence = sourceBehavior.textSelectionPersistence ?? "sticky";
  if (!["sticky", "until-copy"].includes(textSelectionPersistence)) {
    throw new RangeError(
      "PdfjsViewer: behavior.textSelectionPersistence must be sticky or until-copy",
    );
  }
  const searchQueryOptions = normalizeTextQueryOptions(
    sourceBehavior.searchQueryOptions,
    DEFAULT_TEXT_QUERY_OPTIONS,
    "behavior.searchQueryOptions",
  );
  const outlineFilterOptions = normalizeTextQueryOptions(
    sourceBehavior.outlineFilterOptions,
    DEFAULT_TEXT_QUERY_OPTIONS,
    "behavior.outlineFilterOptions",
  );
  const destinationMatchTolerance = sourceBehavior.destinationMatchTolerance ?? 0.1;
  if (!Number.isFinite(destinationMatchTolerance) || destinationMatchTolerance < 0) {
    throw new RangeError(
      "PdfjsViewer: behavior.destinationMatchTolerance must be finite and non-negative",
    );
  }
  const autoFitWidthMaxHeight = sourceBehavior.autoFitWidthMaxHeight ?? 400;
  if (!Number.isFinite(autoFitWidthMaxHeight) || autoFitWidthMaxHeight < 0) {
    throw new RangeError(
      "PdfjsViewer: behavior.autoFitWidthMaxHeight must be finite and non-negative",
    );
  }

  const sourceFeatures = opts.features ?? {};
  rejectUnknownOptions(
    sourceFeatures,
    [
      "search",
      "outline",
      "thumbnails",
      "attachments",
      "annotationLinks",
      "annotationMarkup",
      "forms",
      "layers",
      "textSelection",
      "print",
      "navigationHistory",
      "fullscreen",
      "presentation",
    ],
    "features",
  );
  requireOptionalBoolean(sourceFeatures.textSelection, "features.textSelection");
  requireOptionalBoolean(sourceFeatures.navigationHistory, "features.navigationHistory");
  requireOptionalBoolean(sourceFeatures.fullscreen, "features.fullscreen");
  requireOptionalBoolean(sourceFeatures.presentation, "features.presentation");
  requireOptionalBoolean(sourceFeatures.thumbnails, "features.thumbnails");
  requireOptionalBoolean(sourceFeatures.attachments, "features.attachments");
  requireOptionalBoolean(sourceFeatures.layers, "features.layers");
  if (
    sourceFeatures.print !== undefined &&
    typeof sourceFeatures.print !== "string" &&
    !isOptionsObject(sourceFeatures.print)
  ) {
    throw new TypeError("PdfjsViewer: features.print must be a mode string or options object");
  }
  if (typeof sourceFeatures.print === "object") {
    rejectUnknownOptions(
      sourceFeatures.print,
      ["mode", "browserFallback", "defaults"],
      "features.print",
    );
    requireOptionalBoolean(sourceFeatures.print.browserFallback, "features.print.browserFallback");
  }
  const printMode =
    typeof sourceFeatures.print === "string"
      ? sourceFeatures.print
      : (sourceFeatures.print?.mode ?? "native");
  if (!["off", "native", "browser", "adapter"].includes(printMode)) {
    throw new RangeError(
      "PdfjsViewer: features.print mode must be off, native, browser, or adapter",
    );
  }
  if (opts.printAdapter !== undefined && printMode !== "adapter") {
    throw new TypeError("PdfjsViewer: printAdapter requires features.print mode adapter");
  }
  if (printMode === "adapter" && opts.printAdapter === undefined) {
    throw new TypeError("PdfjsViewer: features.print mode adapter requires printAdapter");
  }
  const browserFallback =
    typeof sourceFeatures.print === "object"
      ? (sourceFeatures.print.browserFallback ?? true)
      : true;
  const printDefaults = normalizePrintDefaults(
    typeof sourceFeatures.print === "object" ? sourceFeatures.print.defaults : undefined,
  );
  if (
    typeof sourceFeatures.print === "object" &&
    sourceFeatures.print.browserFallback !== undefined &&
    printMode !== "native"
  ) {
    throw new TypeError(
      "PdfjsViewer: features.print.browserFallback is accepted only in native mode",
    );
  }
  if (
    sourceFeatures.search !== undefined &&
    typeof sourceFeatures.search !== "boolean" &&
    !isOptionsObject(sourceFeatures.search)
  ) {
    throw new TypeError("PdfjsViewer: features.search must be a boolean or options object");
  }
  if (typeof sourceFeatures.search === "object") {
    rejectUnknownOptions(sourceFeatures.search, ["prepareOnLoad"], "features.search");
    validateBooleanOptions(sourceFeatures.search, "features.search");
  }
  if (
    sourceFeatures.outline !== undefined &&
    typeof sourceFeatures.outline !== "boolean" &&
    !isOptionsObject(sourceFeatures.outline)
  ) {
    throw new TypeError("PdfjsViewer: features.outline must be a boolean or options object");
  }
  if (typeof sourceFeatures.outline === "object") {
    rejectUnknownOptions(sourceFeatures.outline, ["filter", "prepareOnLoad"], "features.outline");
    validateBooleanOptions(sourceFeatures.outline, "features.outline");
  }
  const sourceLinks = sourceFeatures.annotationLinks;
  if (
    sourceLinks !== undefined &&
    typeof sourceLinks !== "boolean" &&
    !isOptionsObject(sourceLinks)
  ) {
    throw new TypeError(
      "PdfjsViewer: features.annotationLinks must be a boolean or options object",
    );
  }
  if (typeof sourceLinks === "object") {
    rejectUnknownOptions(
      sourceLinks,
      ["internalDestinations", "externalUrls"],
      "features.annotationLinks",
    );
    validateBooleanOptions(sourceLinks, "features.annotationLinks");
  }
  const sourceMarkup = sourceFeatures.annotationMarkup;
  if (
    sourceMarkup !== undefined &&
    typeof sourceMarkup !== "boolean" &&
    !isOptionsObject(sourceMarkup)
  ) {
    throw new TypeError(
      "PdfjsViewer: features.annotationMarkup must be a boolean or options object",
    );
  }
  if (typeof sourceMarkup === "object") {
    rejectUnknownOptions(sourceMarkup, ["popups", "fileAttachments"], "features.annotationMarkup");
    validateBooleanOptions(sourceMarkup, "features.annotationMarkup");
  }
  const sourceForms = sourceFeatures.forms;
  if (
    sourceForms !== undefined &&
    typeof sourceForms !== "boolean" &&
    !isOptionsObject(sourceForms)
  ) {
    throw new TypeError("PdfjsViewer: features.forms must be a boolean or options object");
  }
  if (typeof sourceForms === "object") {
    rejectUnknownOptions(sourceForms, ["interactive", "xfa"], "features.forms");
    requireOptionalBoolean(sourceForms.interactive, "features.forms.interactive");
    requireOptionalBoolean(sourceForms.xfa, "features.forms.xfa");
  }

  const search = sourceFeatures.search !== false;
  const navigationHistory = sourceFeatures.navigationHistory !== false;
  const fullscreen = sourceFeatures.fullscreen !== false;
  const presentation = sourceFeatures.presentation !== false;
  const textSelection = sourceFeatures.textSelection !== false;
  const searchPrepareOnLoad =
    search && typeof sourceFeatures.search === "object"
      ? (sourceFeatures.search.prepareOnLoad ?? false)
      : false;
  const outline = sourceFeatures.outline !== false;
  const thumbnails = sourceFeatures.thumbnails !== false;
  const attachments = sourceFeatures.attachments !== false;
  const outlineFilter =
    outline &&
    (typeof sourceFeatures.outline === "object" ? (sourceFeatures.outline.filter ?? true) : true);
  const outlinePrepareOnLoad =
    outline && typeof sourceFeatures.outline === "object"
      ? (sourceFeatures.outline.prepareOnLoad ?? false)
      : false;
  const linksEnabled = sourceLinks !== false;
  const linkOptions = typeof sourceLinks === "object" ? sourceLinks : {};
  const markupEnabled = sourceMarkup !== false;
  const markupOptions = typeof sourceMarkup === "object" ? sourceMarkup : {};
  const formsEnabled = sourceForms !== false;
  const formOptions = typeof sourceForms === "object" ? sourceForms : {};
  const generatedUi = normalizeGeneratedUiOptions({
    id: "pdfjs-viewer-constructor",
    labels: sourceUi.labels,
    formatters: sourceUi.formatters,
    direction: sourceUi.direction,
    controls: sourceUi.controls,
    sidebar: sourceUi.sidebar,
  });
  const controls = generatedUi.controls;
  controls.search &&= search;
  controls.outline &&= outline;
  controls.thumbnails &&= thumbnails;
  controls.attachments &&= attachments;
  controls.layers &&= sourceFeatures.layers !== false;
  controls.outlineFilter &&= outlineFilter;
  controls.textSelection &&= textSelection;
  controls.navigationHistory &&= navigationHistory;
  controls.fullscreen &&= fullscreen;
  controls.presentation &&= presentation;
  controls.print &&= printMode !== "off";

  return {
    uiBindings,
    thumbnails: Object.freeze({ maxDpr: thumbnailMaxDpr }),
    ui: {
      mode: uiMode ?? "default",
      labels: generatedUi.labels,
      formatters: generatedUi.formatters,
      controls,
      sidebar: generatedUi.sidebar,
      direction: generatedUi.direction,
    },
    behavior: {
      textSelectionPersistence,
      reduceRenderingWhenDocumentHidden: sourceBehavior.reduceRenderingWhenDocumentHidden ?? true,
      zoom,
      longPressMs,
      sidebarMode,
      initialSidebarView,
      zoomGestures: sourceBehavior.zoomGestures ?? true,
      searchQueryOptions,
      outlineFilterOptions,
      destinationMatchTolerance,
      autoFitWidthMaxHeight,
    },
    features: {
      navigationHistory,
      fullscreen,
      presentation,
      textSelection,
      search,
      searchPrepareOnLoad,
      outline,
      outlineFilter,
      outlinePrepareOnLoad,
      thumbnails,
      attachments,
      annotationLinks: {
        internalDestinations: linksEnabled && (linkOptions.internalDestinations ?? true),
        externalUrls: linksEnabled && (linkOptions.externalUrls ?? true),
      },
      annotationMarkup: {
        enabled: markupEnabled,
        popups: markupEnabled && (markupOptions.popups ?? true),
        fileAttachments: markupEnabled && (markupOptions.fileAttachments ?? true),
      },
      forms: {
        interactive: formsEnabled && (formOptions.interactive ?? true),
        xfa: formsEnabled && (formOptions.xfa ?? true),
      },
      layers: sourceFeatures.layers !== false,
      print: Object.freeze({ mode: printMode, browserFallback, defaults: printDefaults }),
    },
    accessibility: {
      documentLabel: opts.accessibility?.documentLabel ?? "PDF document",
      respectReducedMotion: opts.accessibility?.respectReducedMotion ?? true,
      restorePanelFocus: opts.accessibility?.restorePanelFocus ?? true,
    },
    deviceCompatibility,
  };
}
