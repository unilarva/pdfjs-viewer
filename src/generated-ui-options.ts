// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private generated-UI option and text normalization.
 *
 * This emitted module is for package maintainers and is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative input-policy boundary.
 *
 * @packageDocumentation
 * @module generated-ui-options
 */

import type {
  PdfjsViewerFormatters,
  PdfjsViewerUiRenderOptions,
  PdfjsViewerLabels,
  PdfjsViewerUiControlOptions,
  PdfjsViewerSidebarView,
} from "./viewer-contracts.js";
import { formatPdfDate } from "./pdf-date.js";

export const PDFJS_VIEWER_DEFAULT_LABELS: Readonly<PdfjsViewerLabels> = {
  controls: "PDF controls",
  textSelection: "Text selection mode",
  outline: "Table of contents",
  fit: "Fit to view",
  fitMode: "Fit mode",
  fitModeAuto: "Auto",
  fitModeContain: "Contain",
  fitModeWidth: "Width",
  fitModeHeight: "Height",
  rotation: "Rotation",
  navigationHistory: "Navigation history",
  viewMode: "View mode",
  navigationHistoryBack: "Go back in navigation history",
  navigationHistoryForward: "Go forward in navigation history",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  presentation: "Presentation",
  exitPresentation: "Exit presentation",
  presentationControls: "Presentation controls",
  presentationPrevious: "Previous page (long press for first page)",
  presentationNext: "Next page (long press for last page)",
  rotateCounterclockwise: "Rotate counterclockwise",
  resetRotation: "Reset rotation",
  rotateClockwise: "Rotate clockwise",
  previousPage: "Previous page (long press for first page)",
  nextPage: "Next page (long press for last page)",
  currentPage: "Current page",
  search: "Search",
  searchPrevious: "Previous result",
  searchNext: "Next result",
  close: "Close",
  download: "Download original PDF",
  downloadFilledDocument: "Save filled PDF",
  print: "Print…",
  documentInformation: "Document information",
  documentInformationLoading: "Loading document information…",
  documentInformationUnavailable: "Document information is unavailable.",
  documentInformationFieldTitle: "Title",
  documentInformationFieldAuthor: "Author",
  documentInformationFieldSubject: "Subject",
  documentInformationFieldKeywords: "Keywords",
  documentInformationFieldCreationDate: "Creation date",
  documentInformationFieldModificationDate: "Modification date",
  documentInformationFieldCreator: "Application",
  documentInformationFieldProducer: "PDF producer",
  documentInformationFieldPdfVersion: "PDF version",
  documentInformationFieldPageCount: "Page count",
  documentInformationFieldLanguage: "Language",
  documentInformationFieldLinearized: "Fast web view",
  documentInformationYes: "Yes",
  documentInformationNo: "No",
  documentInformationAccept: "OK",
  printSetup: "Print setup",
  printPages: "Pages",
  printAllPages: "All",
  printCustomPages: "Custom range",
  printRange: "Page range",
  printLayout: "Pages per sheet",
  printLayoutAuto: "Automatic spreads",
  printLayoutAutoHelp:
    '"Automatic spreads" uses two pages when the PDF prefers a spread and the pages fit on the selected paper.',
  printLayoutSingle: "Single page",
  printLayoutSpread: "Two pages",
  printFirstPageSide: "First page side",
  printFirstPageAuto: "Automatic",
  printFirstPageRight: "Right",
  printFirstPageLeft: "Left",
  printSheet: "Sheet",
  printSheetA3: "A3",
  printSheetA4: "A4",
  printSheetA5: "A5",
  printSheetLetter: "US Letter",
  printSheetLegal: "US Legal",
  printSheetCustom: "Custom",
  printPageScaling: "Page scaling",
  printPageScalingFit: "Fit to sheet",
  printPageScalingShrinkToFit: "Keep smaller pages at actual size",
  printPageScalingHelp:
    '"Fit to sheet" may enlarge smaller pages. "Keep smaller pages at actual size" centers them without enlargement. Oversized pages are always reduced.',
  printOrientation: "Orientation",
  printQuality: "Quality",
  printMoreSettings: "More settings",
  printOrientationAuto: "Automatic",
  printOrientationPortrait: "Portrait",
  printOrientationLandscape: "Landscape",
  printOrientationHelp:
    '"Automatic" follows single-page proportions and chooses the better side-by-side or stacked two-page arrangement.',
  printQuality300: "300 DPI",
  printQuality600: "600 DPI",
  printPrepare: "Open system print dialog",
  printCancel: "Cancel",
  printSource: "Open PDF in browser",
  printSystemDialogGuidance:
    'In the system print dialog use "Pages: All" and "Pages per sheet: 1".',
  printKeepPortraitGuidance: 'Keep "Portrait orientation" in the system print dialog.',
  printDuplexPortraitFlipGuidance: 'For duplex portrait sheets, use "long-edge flipping".',
  printDuplexLandscapeFlipGuidance: 'For duplex landscape sheets, use "short-edge flipping".',
  printPreparationCancelGuidance: "Cancel stops preparation before the system print dialog opens.",
  printUnsupportedPlatform: "Prepared printing is unavailable on this browser or platform.",
  printRangeInvalid: "Enter pages from 1 to {pageCount}, for example 2-6, 9.",
  printSheetWidth: "Width",
  printSheetHeight: "Height",
  printSheetUnit: "Unit",
  printSheetUnitMillimeters: "mm",
  printSheetUnitPoints: "pt",
  printSheetUnitInches: "in",
  printRangePlaceholder: "2-6, 9",
  printResolutionHelp:
    '"300 DPI" and "600 DPI" are final output-sheet resolutions. Quality may be reduced to fit print limits.',
  printSheetHelp:
    '"Custom" accepts another paper size. Every page is composed onto the selected paper.',
  printMemoryLimitExceeded:
    "This selection exceeds the current print memory limit. Choose fewer pages, select a larger rendering profile, or open the PDF in the browser.",
  printPreparationUnavailable: "This selection cannot be prepared safely for printing.",
  printSourceLayerWarning:
    "Opening the PDF in the browser does not preserve current layer visibility.",
  printSourceParityWarning:
    "Opening the PDF in the browser may not preserve right-side spread parity.",
  printSourceRangeWarning:
    "Opening the PDF in the browser does not preserve the selected page range.",
  printSourceQualityWarning:
    "Opening the PDF in the browser does not preserve the selected prepared-print DPI.",
  printProgress: "Preparing print sheets",
  menu: "PDF options",
  zoom: "Zoom",
  pageLayout: "Page layout",
  pageLayoutAuto: "Auto",
  pageLayoutSingle: "Single",
  pageLayoutDouble: "Double",
  pageLayoutBook: "Book",
  renderingProfile: "Rendering profile",
  renderingConservative: "Low memory",
  renderingBalanced: "Balanced",
  renderingAggressive: "High memory",
  outlineFilter: "Filter table of contents",
  outlineUntitled: "(Untitled)",
  searchPlaceholder: "Search document",
  searchPreparing: "Preparing search…",
  outlinePreparing: "Preparing table of contents…",
  searchPreparationError: "Search unavailable",
  outlinePreparationError: "Outline unavailable",
  noOutline: "No outline",
  annotationLink: "Link",
  annotationComment: "Annotation comment",
  annotationAttachment: "Open attached file",
  annotationAttachmentError: "Attached file unavailable",
  xfaUnavailable: "XFA form unavailable",
  xfaHybridFallback: "Hybrid XFA is using its AcroForm fallback",
  sidebar: "Document navigation",
  sidebarMoreViews: "More document views",
  thumbnails: "Thumbnails",
  thumbnailError: "Thumbnail unavailable",
  attachments: "Attachments",
  attachmentsPreparing: "Preparing attachments…",
  attachmentsPreparationError: "Attachments unavailable",
  noAttachments: "No attachments",
  attachmentDownload: "Download",
  attachmentDownloadError: "Attachment download failed",
  layers: "Layers",
  layersPreparing: "Preparing layers…",
  layersPreparationError: "Layers unavailable",
  noLayers: "No layers",
  resetLayers: "Reset layers",
  fallbackLayer: "Layer",
  fallbackLayerGroup: "Group",
  documentProgress: "Loading PDF",
  documentProgressError: "PDF loading failed",
};

export const PDFJS_VIEWER_DEFAULT_FORMATTERS: Readonly<PdfjsViewerFormatters> = {
  documentInformationDate: formatPdfDate,
  searchResultCount: total => String(total),
  searchResultPosition: (current, total) => `${current}/${total}`,
  zoom: scale => `${Math.round(scale * 100)}%`,
  thumbnailPage: pageNumber => `Page ${pageNumber}`,
  printSummary: ({ pages, sheetCount, orientation, layout, dpi }) =>
    `Pages ${pages} → ${sheetCount} ${orientation} ${sheetCount === 1 ? "sheet" : "sheets"}, ${layout === "spread" ? "two pages per sheet" : "one page per sheet"}, ${dpi} DPI.`,
  printProgress: (completedSheets, totalSheets) =>
    `${completedSheets}/${totalSheets} sheets prepared`,
  printSheetLimitExceeded: (sheetCount, maxSheets) =>
    `This selection would create ${sheetCount} sheets; the current limit is ${maxSheets}. Choose fewer pages or open the PDF in the browser.`,
  printReducedQuality: dpi => `Reduced quality ${dpi} DPI`,
  printReducedExplanation: dpi =>
    `This page range at the requested quality needs more preparation memory, so quality was reduced to ${dpi} DPI.`,
};

export const PDFJS_VIEWER_DEFAULT_UI_CONTROLS: Readonly<Required<PdfjsViewerUiControlOptions>> = {
  textSelection: true,
  navigation: true,
  navigationHistory: true,
  fullscreen: true,
  presentation: true,
  fit: true,
  search: true,
  outline: true,
  thumbnails: true,
  attachments: true,
  layers: true,
  outlineFilter: true,
  menu: true,
  download: true,
  downloadFilledDocument: true,
  print: true,
  documentInformation: true,
  zoom: true,
  pageLayout: true,
  fitMode: true,
  rotation: true,
  renderingProfile: true,
};

export interface NormalizedGeneratedUiOptions {
  labels: Readonly<PdfjsViewerLabels>;
  formatters: Readonly<PdfjsViewerFormatters>;
  controls: Required<PdfjsViewerUiControlOptions>;
  direction: "ltr" | "rtl" | "auto";
  id: string;
  initialUrl: string | null;
  variant: "default" | "custom";
  sidebar: Readonly<{ primaryViews: readonly PdfjsViewerSidebarView[] }>;
}

function isOptionsObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownOptions(value: object, allowed: readonly string[], path: string): void {
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name)) throw new TypeError(`PdfjsViewer: unknown ${path}.${name} option`);
  }
}

/** Validates and resolves runtime UI text into a detached immutable snapshot. */
export function normalizeUiTextOptions(
  options: import("./viewer-contracts.js").PdfjsViewerUiTextOptions,
): Readonly<Pick<NormalizedGeneratedUiOptions, "labels" | "formatters">> {
  if (!isOptionsObject(options))
    throw new TypeError("PdfjsViewer: UI text options must be an object");
  rejectUnknownOptions(options, ["labels", "formatters"], "UI text");
  if (options.labels !== undefined && !isOptionsObject(options.labels))
    throw new TypeError("PdfjsViewer: UI labels must be an options object when provided");
  if (options.labels) {
    rejectUnknownOptions(options.labels, Object.keys(PDFJS_VIEWER_DEFAULT_LABELS), "UI labels");
    for (const [name, label] of Object.entries(options.labels))
      if (typeof label !== "string")
        throw new TypeError(`PdfjsViewer: UI labels.${name} must be a string`);
  }
  if (options.formatters !== undefined && !isOptionsObject(options.formatters))
    throw new TypeError("PdfjsViewer: UI formatters must be an options object when provided");
  if (options.formatters) {
    rejectUnknownOptions(
      options.formatters,
      Object.keys(PDFJS_VIEWER_DEFAULT_FORMATTERS),
      "UI formatters",
    );
    for (const [name, formatter] of Object.entries(options.formatters))
      if (typeof formatter !== "function")
        throw new TypeError(`PdfjsViewer: UI formatters.${name} must be a function`);
  }
  return Object.freeze({
    labels: Object.freeze({ ...PDFJS_VIEWER_DEFAULT_LABELS, ...options.labels }),
    formatters: Object.freeze({ ...PDFJS_VIEWER_DEFAULT_FORMATTERS, ...options.formatters }),
  });
}

/** Validates and completes generated UI options without reading browser state. */
export function normalizeGeneratedUiOptions(
  options: PdfjsViewerUiRenderOptions,
): NormalizedGeneratedUiOptions {
  if (!isOptionsObject(options)) throw new TypeError("PdfjsViewer: UI options must be an object");
  rejectUnknownOptions(
    options,
    ["id", "initialUrl", "labels", "formatters", "direction", "controls", "variant", "sidebar"],
    "UI",
  );
  if (
    options.variant !== undefined &&
    options.variant !== "default" &&
    options.variant !== "custom"
  ) {
    throw new TypeError("PdfjsViewer: UI variant must be default or custom when provided");
  }
  if (typeof options.id !== "string" || !options.id.trim()) {
    throw new TypeError("PdfjsViewer: UI id must be a non-empty string");
  }
  if (
    options.initialUrl !== undefined &&
    options.initialUrl !== null &&
    typeof options.initialUrl !== "string"
  ) {
    throw new TypeError("PdfjsViewer: UI initialUrl must be a string or null when provided");
  }
  const text = normalizeUiTextOptions({ labels: options.labels, formatters: options.formatters });
  const direction = options.direction;
  if (
    direction !== undefined &&
    direction !== "ltr" &&
    direction !== "rtl" &&
    direction !== "auto"
  ) {
    throw new TypeError("PdfjsViewer: UI direction must be ltr, rtl, or auto when provided");
  }
  if (options.controls !== undefined && !isOptionsObject(options.controls)) {
    throw new TypeError("PdfjsViewer: UI controls must be an options object when provided");
  }
  if (options.controls) {
    rejectUnknownOptions(
      options.controls,
      Object.keys(PDFJS_VIEWER_DEFAULT_UI_CONTROLS),
      "UI controls",
    );
    for (const [name, enabled] of Object.entries(options.controls)) {
      if (typeof enabled !== "boolean")
        throw new TypeError(`PdfjsViewer: UI controls.${name} must be a boolean`);
    }
  }
  if (options.sidebar !== undefined && !isOptionsObject(options.sidebar)) {
    throw new TypeError("PdfjsViewer: UI sidebar must be an options object when provided");
  }
  const sidebar = options.sidebar ?? {};
  rejectUnknownOptions(sidebar, ["primaryViews"], "UI sidebar");
  const primaryViews = sidebar.primaryViews ?? ["outline", "thumbnails"];
  if (!Array.isArray(primaryViews))
    throw new TypeError("PdfjsViewer: UI sidebar.primaryViews must be an array when provided");
  const sidebarViews = ["outline", "thumbnails", "attachments", "layers"] as const;
  for (const view of primaryViews) {
    if (!sidebarViews.includes(view as PdfjsViewerSidebarView)) {
      throw new RangeError("PdfjsViewer: UI sidebar.primaryViews contains an unknown sidebar view");
    }
  }
  if (new Set(primaryViews).size !== primaryViews.length) {
    throw new RangeError("PdfjsViewer: UI sidebar.primaryViews must not contain duplicate views");
  }
  return {
    id: options.id.trim(),
    initialUrl: options.initialUrl ?? null,
    variant: options.variant ?? "default",
    direction: direction ?? "auto",
    labels: text.labels,
    formatters: text.formatters,
    controls: { ...PDFJS_VIEWER_DEFAULT_UI_CONTROLS, ...options.controls },
    sidebar: { primaryViews: [...primaryViews] },
  };
}
