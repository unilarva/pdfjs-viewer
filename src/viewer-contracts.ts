// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public viewer contracts and centralized categorized DOM/state hooks.
 * Package consumers use interactive selectors as custom-UI fallback contracts;
 * extension selectors identify host-content insertion slots, not bindings.
 * See the [architecture guide](../ARCHITECTURE.md) for ownership boundaries.
 * @packageDocumentation
 * @module viewer-contracts
 */

import type { PdfjsViewerDeviceCompatibilityRule } from "./device-compatibility.js";
import type { PdfjsViewerNativePrintCapabilities } from "./native-print-capabilities.js";
import type { PdfjsViewerLogger, PdfjsViewerRuntime } from "./pdfjs-viewer-runtime.js";
/** Intentional type-only edge preserves the public print-adapter viewer instance shape. */
import type { PdfjsViewer } from "./pdfjs-viewer.js";

/** Stable selectors and insertion slots used by custom viewer UI integrations. */
export const PDFJS_VIEWER_UI_HOOKS = {
  /** Viewer-root discovery hooks. */
  root: {
    /** Scope searched for stable custom-control selectors. */
    controlDiscoveryScope: ".pdf-controls",
    /** Scrollable document-surface container. */
    container: ".pdf-container",
  },
  /** Page-navigation control hooks. */
  navigation: {
    /** Previous-page-row action. */
    previous: ".pdf-prev-page-btn",
    /** Next-page-row action. */
    next: ".pdf-next-page-btn",
    /** Current-page input. */
    pageNumber: ".pdf-page-number-input",
    /** Total-page-count output. */
    pageCount: ".pdf-page-count",
  },
  /** In-document Back/Forward history hooks. */
  navigationHistory: {
    /** Restores the previous explicit document location. */
    back: ".pdf-navigation-history-back-btn",
    /** Restores the next explicit document location. */
    forward: ".pdf-navigation-history-forward-btn",
  },
  /** Browser fullscreen control hooks. */
  fullscreen: {
    /** Enters or exits exact-root browser fullscreen. */
    toggle: ".pdf-fullscreen-toggle-btn",
  },
  /** Discrete-page presentation-mode hooks. */
  presentation: {
    /** Enters or exits presentation mode. */
    toggle: ".pdf-presentation-toggle-btn",
    /** Transient presentation control toolbar. */
    controls: ".pdf-presentation-controls",
    /** Moves to the previous presentation page. */
    previous: ".pdf-presentation-previous-btn",
    /** Moves to the next presentation page. */
    next: ".pdf-presentation-next-btn",
    /** Exits presentation mode. */
    exit: ".pdf-presentation-exit-btn",
  },
  /** Zoom control hooks. */
  zoom: {
    /** Primary fit action. */
    fit: ".pdf-fit-main-btn",
    /** Fit action inside the options menu. */
    fitMenu: ".pdf-fit-menu-btn",
    /** Optional zoom slider. */
    slider: ".pdf-zoom-slider",
    /** Zoom-slider layout wrapper. */
    sliderWrap: ".pdf-zoom-slider-wrap",
  },
  /** Search panel and control hooks. */
  search: {
    /** Search-panel toggle. */
    toggle: ".pdf-search-toggle-btn",
    /** Search panel. */
    panel: ".pdf-search-panel",
    /** Search-query input. */
    input: ".pdf-search-input",
    /** Previous-search-result action. */
    previous: ".pdf-search-previous-btn",
    /** Next-search-result action. */
    next: ".pdf-search-next-btn",
    /** Search-result count output. */
    count: ".pdf-search-count",
    /** Search-panel close action. */
    close: ".pdf-search-close-btn",
  },
  /** Options-menu and view-setting hooks. */
  menu: {
    /** Options-menu toggle. */
    toggle: ".pdf-menu-toggle-btn",
    /** Options-menu panel. */
    panel: ".pdf-menu-panel",
    /** Options-menu close action. */
    close: ".pdf-menu-close-btn",
    /** Text-selection-mode toggle. */
    textSelectionToggle: ".pdf-text-selection-toggle-btn",
    /** Page-layout control group. */
    pageLayout: ".pdf-page-layout-group",
    /** Fit-mode control group. */
    fitMode: ".pdf-fit-mode-group",
    /** Counterclockwise rotation action. */
    rotateCounterclockwise: ".pdf-rotate-counterclockwise-btn",
    /** Rotation reset action. */
    resetRotation: ".pdf-reset-rotation-btn",
    /** Clockwise rotation action. */
    rotateClockwise: ".pdf-rotate-clockwise-btn",
    /** Rendering-profile control group. */
    renderingProfile: ".pdf-rendering-profile-group",
  },
  /** Host-owned content insertion slots. */
  extensions: {
    /** Search-panel extension slot. */
    search: ".pdf-search-extension",
    /** Options-menu extension slot. */
    menu: ".pdf-menu-extension",
  },
  /** Sidebar shell hooks. */
  sidebar: {
    /** Sidebar container. */
    container: ".pdf-sidebar",
    /** Sidebar toggle. */
    toggle: ".pdf-sidebar-toggle-btn",
    /** Sidebar close action. */
    close: ".pdf-sidebar-close-btn",
    /** Primary-view switcher container. */
    primaryViews: ".pdf-sidebar-primary-views",
    /** Additional-view menu toggle. */
    moreToggle: ".pdf-sidebar-more-toggle",
    /** Additional-view menu. */
    moreMenu: ".pdf-sidebar-more-menu",
  },
  /** Outline-view hooks. */
  outline: {
    /** Outline content container. */
    content: ".pdf-outline",
    /** Outline-filter wrapper. */
    filter: ".pdf-outline-filter",
    /** Outline-filter input. */
    filterInput: ".pdf-outline-filter-input",
  },
  /** Thumbnail-view hooks. */
  thumbnails: {
    /** Thumbnail content container. */
    content: ".pdf-thumbnails",
  },
  /** Attachment-view hooks. */
  attachments: {
    /** Attachment content container. */
    content: ".pdf-attachments",
  },
  /** Optional-content layer-view hooks. */
  layers: {
    /** Layer content container. */
    content: ".pdf-layers",
  },
  /** Document action hooks. */
  actions: {
    /** Original-document download action. */
    download: ".pdf-download-btn",
    /** Filled-document download action. */
    downloadFilledDocument: ".pdf-download-filled-document-btn",
    /** Print action. */
    print: ".pdf-print-btn",
  },
  /** Controlled native-print setup hooks. */
  printSetup: {
    /** Print-setup dialog. */
    dialog: ".pdf-print-setup",
    /** Form within the print-setup dialog. */
    form: "form",
    /** Page-selection mode control. */
    pages: ".pdf-print-pages",
    /** Custom page-range input. */
    range: ".pdf-print-range",
    /** Custom page-range wrapper. */
    rangeWrap: ".pdf-print-range-wrap",
    /** Pages-per-sheet layout control. */
    layout: ".pdf-print-layout",
    /** First-page-side control wrapper. */
    side: ".pdf-print-side",
    /** First-page-side selector. */
    sideSelect: ".pdf-print-side-select",
    /** Additional print-settings disclosure. */
    more: ".pdf-print-more",
    /** Physical sheet selector. */
    sheet: ".pdf-print-sheet",
    /** Custom sheet controls. */
    customSheet: ".pdf-print-custom-sheet",
    /** Custom sheet-width input. */
    customSheetWidth: ".pdf-print-sheet-width",
    /** Custom sheet-height input. */
    customSheetHeight: ".pdf-print-sheet-height",
    /** Custom sheet-unit selector. */
    customSheetUnit: ".pdf-print-sheet-unit",
    /** Page-scaling selector. */
    pageScaling: ".pdf-print-page-scaling",
    /** Output-orientation selector. */
    orientation: ".pdf-print-orientation",
    /** Output-quality selector. */
    quality: ".pdf-print-quality",
    /** Print-plan status output. */
    status: ".pdf-print-status",
    /** Sheet-preparation progress element. */
    progress: ".pdf-print-progress",
    /** System-dialog guidance output. */
    guidance: ".pdf-print-guidance",
    /** Browser-source fallback warning output. */
    fallbackWarning: ".pdf-print-fallback-warning",
    /** Print-setup close action. */
    close: ".pdf-print-close",
    /** Print-preparation cancellation action. */
    cancel: ".pdf-print-cancel",
    /** Browser-source fallback action. */
    source: ".pdf-print-source",
    /** Native-print preparation action. */
    submit: ".pdf-print-submit",
    /** Detail associated with the native-print action. */
    submitDetail: ".pdf-print-submit-detail",
  },
  /** Document-load progress hooks. */
  documentProgress: {
    /** Document-load progress indicator. */
    indicator: ".pdf-document-progress",
  },
} as const;

/** Attribute applied to every package-scoped viewer styling boundary. */
export const PDFJS_VIEWER_ROOT_ATTRIBUTE = "data-pdfjs-viewer-root" as const;

/** Stable CSS state classes applied by package-managed viewer UI. */
export const PDFJS_VIEWER_STATE_CLASSES = {
  /** Base zoom-limit feedback class. */
  zoomLimitHint: "pdf-zoom-limit-hint",
  /** Minimum-zoom feedback class. */
  zoomLimitHintIn: "pdf-zoom-limit-hint--in",
  /** Maximum-zoom feedback class. */
  zoomLimitHintOut: "pdf-zoom-limit-hint--out",
  /** Visible document-progress state. */
  documentProgressVisible: "pdf-document-progress--visible",
  /** Current outline-entry state. */
  outlineCurrent: "pdf-outline-current",
  /** Search-index preparation state. */
  searchPreparing: "pdf-search-count--preparing",
  /** Outline preparation state. */
  outlinePreparing: "pdf-outline--preparing",
  /** Attachment preparation state. */
  attachmentsPreparing: "pdf-attachments--preparing",
  /** Search-result highlight. */
  searchHighlight: "pdf-search-highlight",
  /** Current search-result highlight. */
  searchHighlightCurrent: "pdf-search-highlight-current",
  /** Active pinch-zoom state. */
  pinchActive: "pdf-pinch-active",
  /** Current thumbnail state. */
  thumbnailCurrent: "pdf-thumbnail-current",
  /** Failed thumbnail state. */
  thumbnailError: "pdf-thumbnail-error",
  /** Exact viewer root currently owns browser fullscreen. */
  fullscreen: "pdf-fullscreen",
  /** Discrete-page presentation mode is active. */
  presentationMode: "pdf-presentation-mode",
  /** Transient presentation controls are currently visible. */
  presentationControlsVisible: "pdf-presentation-controls-visible",
} as const;

/**
 * Layout mode for rendering pages in the PDF viewer.
 *
 * Values:
 * - "single": One page per row.
 * - "double": Two pages per row; odd-numbered pages appear on the left.
 * - "book": Book spread; the first page is shown alone, then two pages per row;
 *   odd-numbered pages on the right.
 * - "auto": The viewer selects the most appropriate mode automatically;
 *   takes into account the preferred mode in the PDF and whether two pages
 *   fit side-by-side in the available view space.
 */
export type PdfjsViewerPageLayout = "single" | "double" | "book" | "auto";
/** Concrete row-fitting strategy. */
export type PdfjsViewerFitMode = "contain" | "width" | "height";
/** Configured fitting strategy, including container-height automatic selection. */
export type PdfjsViewerFitModeSelection = PdfjsViewerFitMode | "auto";
/** Viewer-added clockwise document rotation. */
export type PdfjsViewerRotation = 0 | 90 | 180 | 270;
/**
 * Per-viewer rendering profiles ordered from lowest to highest retained bitmap use.
 * They control render concurrency, viewport buffers, page retention, pixel budgets,
 * and maximum render DPR; they do not configure the shared PDF.js worker.
 */
export type PdfjsViewerRenderingProfile = "conservative" | "balanced" | "aggressive";
/** A concrete rendering profile or the policy-selected automatic profile. */
export type PdfjsViewerRenderingProfileSelection = PdfjsViewerRenderingProfile | "auto";

/** Strategy for finding or creating viewer UI below the supplied root element. */
export type PdfjsViewerUiMode = "default" | "custom" | "headless";
/** A view hosted by the shared viewer sidebar. */
export type PdfjsViewerSidebarView = "outline" | "thumbnails" | "attachments" | "layers";
/** How long text-selection interaction mode remains active. */
export type PdfjsViewerTextSelectionPersistence = "sticky" | "until-copy";

/** English defaults and host-overridable text used by the generated UI. */
export interface PdfjsViewerLabels {
  /** Labels the generated controls toolbar. */
  controls: string;
  /** Enables or disables PDF text-selection interaction mode. */
  textSelection: string;
  /** Opens the table of contents. */
  outline: string;
  /** Labels the shared sidebar toggle and region. */
  sidebar: string;
  /** Labels the sidebar's secondary-view overflow menu. */
  sidebarMoreViews: string;
  /** Labels the thumbnail navigator. */
  thumbnails: string;
  /** Labels the embedded-file attachment list. */
  attachments: string;
  /** Labels the optional-content layer controls. */
  layers: string;
  /** Status shown while optional-content layers are being prepared. */
  layersPreparing: string;
  /** Non-fatal optional-content layer preparation failure message. */
  layersPreparationError: string;
  /** Message shown when the document contains no optional-content layers. */
  noLayers: string;
  /** Action label that restores the loaded layer visibility state. */
  resetLayers: string;
  /** Fallback name for an optional-content layer without a PDF label. */
  fallbackLayer: string;
  /** Fallback name for an optional-content layer group without a PDF label. */
  fallbackLayerGroup: string;
  /** Accessible thumbnail rendering failure. */
  thumbnailError: string;
  /** Fits the document to the current viewport. */
  fit: string;
  /** Labels the fit-mode control group. */
  fitMode: string;
  /** Labels automatic fit-mode selection. */
  fitModeAuto: string;
  /** Labels complete-row containment fit mode. */
  fitModeContain: string;
  /** Labels width-based fit mode. */
  fitModeWidth: string;
  /** Labels height-based fit mode. */
  fitModeHeight: string;
  /** Labels document rotation controls. */
  rotation: string;
  /** Labels in-document Back/Forward controls. */
  navigationHistory: string;
  /** Labels browser fullscreen and presentation controls. */
  viewMode: string;
  /** Restores the previous location in document history. */
  navigationHistoryBack: string;
  /** Restores the next location in document history. */
  navigationHistoryForward: string;
  /** Enters exact-root browser fullscreen. */
  fullscreen: string;
  /** Exits exact-root browser fullscreen. */
  exitFullscreen: string;
  /** Enters discrete-page presentation mode. */
  presentation: string;
  /** Exits discrete-page presentation mode. */
  exitPresentation: string;
  /** Labels transient presentation controls. */
  presentationControls: string;
  /** Moves to the previous presentation page. */
  presentationPrevious: string;
  /** Moves to the next presentation page. */
  presentationNext: string;
  /** Rotates the document counterclockwise. */
  rotateCounterclockwise: string;
  /** Restores the configured document rotation. */
  resetRotation: string;
  /** Rotates the document clockwise. */
  rotateClockwise: string;
  /** Navigates to the previous page or row. */
  previousPage: string;
  /** Navigates to the next page or row. */
  nextPage: string;
  /** Labels the editable current-page field. */
  currentPage: string;
  /** Opens document search. */
  search: string;
  /** Moves to the previous document-search result. */
  searchPrevious: string;
  /** Moves to the next document-search result. */
  searchNext: string;
  /** Closes the current panel. */
  close: string;
  /** Downloads the current document. */
  download: string;
  /** Downloads a copy containing current interactive form values. */
  downloadFilledDocument: string;
  /** Prints the current document. */
  print: string;
  /** Opens normalized metadata and document properties. */
  documentInformation: string;
  /** Status shown while document information is loading. */
  documentInformationLoading: string;
  /** Message shown when document information cannot be read. */
  documentInformationUnavailable: string;
  /** Label for the document title metadata field. */
  documentInformationFieldTitle: string;
  /** Label for the document author metadata field. */
  documentInformationFieldAuthor: string;
  /** Label for the document subject metadata field. */
  documentInformationFieldSubject: string;
  /** Label for the document keywords metadata field. */
  documentInformationFieldKeywords: string;
  /** Label for the PDF creation-date metadata field. */
  documentInformationFieldCreationDate: string;
  /** Label for the PDF modification-date metadata field. */
  documentInformationFieldModificationDate: string;
  /** Label for the document creator metadata field. */
  documentInformationFieldCreator: string;
  /** Label for the PDF producer metadata field. */
  documentInformationFieldProducer: string;
  /** Label for the PDF format-version metadata field. */
  documentInformationFieldPdfVersion: string;
  /** Label for the document page-count metadata field. */
  documentInformationFieldPageCount: string;
  /** Label for the document language metadata field. */
  documentInformationFieldLanguage: string;
  /** Label for the fast-web-view metadata field. */
  documentInformationFieldLinearized: string;
  /** Localized affirmative metadata value. */
  documentInformationYes: string;
  /** Localized negative metadata value. */
  documentInformationNo: string;
  /** Accept action for the document-information dialog. */
  documentInformationAccept: string;
  /** Title for the controlled-print setup dialog. */
  printSetup: string;
  /** Label for controlled-print page selection. */
  printPages: string;
  /** Label selecting every document page for controlled printing. */
  printAllPages: string;
  /** Label selecting a custom controlled-print page range. */
  printCustomPages: string;
  /** Label for the custom controlled-print range input. */
  printRange: string;
  /** Label for pages-per-sheet layout selection. */
  printLayout: string;
  /** Label for automatic controlled-print layout selection. */
  printLayoutAuto: string;
  /** Explains the conservative automatic two-page policy. */
  printLayoutAutoHelp: string;
  /** Label for single-page-per-sheet layout. */
  printLayoutSingle: string;
  /** Label for two-page spread layout. */
  printLayoutSpread: string;
  /** Label for first-page-side selection in spread layout. */
  printFirstPageSide: string;
  /** Label for automatic first-page-side selection. */
  printFirstPageAuto: string;
  /** Label placing the first spread page on the right. */
  printFirstPageRight: string;
  /** Label placing the first spread page on the left. */
  printFirstPageLeft: string;
  /** Label for physical print-sheet selection. */
  printSheet: string;
  /** Label for the A3 sheet preset. */
  printSheetA3: string;
  /** Label for the A4 sheet preset. */
  printSheetA4: string;
  /** Label for the A5 sheet preset. */
  printSheetA5: string;
  /** Label for the US Letter sheet preset. */
  printSheetLetter: string;
  /** Label for the US Legal sheet preset. */
  printSheetLegal: string;
  /** Label for a custom print sheet. */
  printSheetCustom: string;
  /** Label for page scaling within output-sheet slots. */
  printPageScaling: string;
  /** Label allowing page enlargement and reduction to fill a slot. */
  printPageScalingFit: string;
  /** Label preventing enlargement of pages that already fit. */
  printPageScalingShrinkToFit: string;
  /** Explains the selected page-scaling policy. */
  printPageScalingHelp: string;
  /** Label for output orientation selection. */
  printOrientation: string;
  /** Label for automatic orientation selection. */
  printOrientationAuto: string;
  /** Label for portrait orientation. */
  printOrientationPortrait: string;
  /** Label for landscape orientation. */
  printOrientationLandscape: string;
  /** Explains automatic orientation selection. */
  printOrientationHelp: string;
  /** Label for controlled-print raster quality selection. */
  printQuality: string;
  /** Label for 300-DPI print quality. */
  printQuality300: string;
  /** Label for 600-DPI print quality. */
  printQuality600: string;
  /** Disclosure label for advanced print settings. */
  printMoreSettings: string;
  /** Action label that starts controlled print preparation. */
  printPrepare: string;
  /** Action label that cancels controlled print preparation. */
  printCancel: string;
  /** Action label that opens the source PDF in the browser. */
  printSource: string;
  /** Guidance for browser-native print-dialog settings. */
  printSystemDialogGuidance: string;
  /** Guidance to retain portrait output in the native print dialog. */
  printKeepPortraitGuidance: string;
  /** Duplex guidance for portrait output sheets. */
  printDuplexPortraitFlipGuidance: string;
  /** Duplex guidance for landscape output sheets. */
  printDuplexLandscapeFlipGuidance: string;
  /** Explains when cancellation can stop preparation. */
  printPreparationCancelGuidance: string;
  /** Message shown when controlled printing is unavailable. */
  printUnsupportedPlatform: string;
  /** Validation message for an invalid custom page range. */
  printRangeInvalid: string;
  /** Label for custom sheet width. */
  printSheetWidth: string;
  /** Label for custom sheet height. */
  printSheetHeight: string;
  /** Label for custom sheet measurement unit. */
  printSheetUnit: string;
  /** Label for millimetres. */
  printSheetUnitMillimeters: string;
  /** Label for points. */
  printSheetUnitPoints: string;
  /** Label for inches. */
  printSheetUnitInches: string;
  /** Placeholder example for a custom page range. */
  printRangePlaceholder: string;
  /** Explains final on-sheet DPI semantics. */
  printResolutionHelp: string;
  /** Explains physical output-sheet selection. */
  printSheetHelp: string;
  /** Explains that the aggregate controlled-print memory envelope was exhausted. */
  printMemoryLimitExceeded: string;
  /** Message shown when the requested controlled print cannot be prepared safely. */
  printPreparationUnavailable: string;
  /** Warns that browser-source printing loses current layer visibility. */
  printSourceLayerWarning: string;
  /** Warns that browser-source printing can lose spread page parity. */
  printSourceParityWarning: string;
  /** Warns that browser-source printing loses the selected page range. */
  printSourceRangeWarning: string;
  /** Warns that browser-source printing loses prepared output quality. */
  printSourceQualityWarning: string;
  /** Labels controlled-print sheet preparation progress. */
  printProgress: string;
  /** Opens the viewer options menu. */
  menu: string;
  /** Labels zoom controls. */
  zoom: string;
  /** Labels the page layout group. */
  pageLayout: string;
  /** Labels automatic page layout. */
  pageLayoutAuto: string;
  /** Labels single-page layout. */
  pageLayoutSingle: string;
  /** Labels two-page spread layout. */
  pageLayoutDouble: string;
  /** Labels book-style spread layout. */
  pageLayoutBook: string;
  /** Labels the rendering-profile group. */
  renderingProfile: string;
  /** Labels the conservative rendering profile. */
  renderingConservative: string;
  /** Labels the balanced rendering profile. */
  renderingBalanced: string;
  /** Labels the aggressive rendering profile. */
  renderingAggressive: string;
  /** Labels the outline-filter field. */
  outlineFilter: string;
  /** Fallback title for malformed or missing PDF outline titles. */
  outlineUntitled: string;
  /** Placeholder shown in the document-search field. */
  searchPlaceholder: string;
  /** Status shown while a typed query waits for full-document search indexing. */
  searchPreparing: string;
  /** Accessible status assigned while the table of contents is being prepared. */
  outlinePreparing: string;
  /** Accessible status assigned while document attachments are being prepared. */
  attachmentsPreparing: string;
  /** Non-fatal full-document search-index failure message. */
  searchPreparationError: string;
  /** Non-fatal outline preparation failure message. */
  outlinePreparationError: string;
  /** Non-fatal attachment discovery failure message. */
  attachmentsPreparationError: string;
  /** Message shown when the document has no table of contents. */
  noOutline: string;
  /** Message shown when the document has no embedded attachments. */
  noAttachments: string;
  /** Action label for downloading one embedded attachment. */
  attachmentDownload: string;
  /** Message shown when one attachment cannot be downloaded. */
  attachmentDownloadError: string;
  /** Accessible label assigned to PDF annotation links without visible text. */
  annotationLink: string;
  /** Accessible label assigned to annotation note and comment triggers. */
  annotationComment: string;
  /** Accessible label assigned to page-local attachment triggers. */
  annotationAttachment: string;
  /** Message used when a page-local attachment cannot be opened. */
  annotationAttachmentError: string;
  /** Diagnostic text used when PDF.js cannot expose a pure-XFA page. */
  xfaUnavailable: string;
  /** Diagnostic text explaining the AcroForm fallback for mixed XFA documents. */
  xfaHybridFallback: string;
  /** Labels document loading and initial rendering progress. */
  documentProgress: string;
  /** Accessible status published when document loading or initial rendering fails. */
  documentProgressError: string;
}

/** Host-overridable formatting for generated and package-managed dynamic UI text. */
export interface PdfjsViewerFormatters {
  /** Formats one raw PDF creation or modification date for default-UI presentation. */
  documentInformationDate(value: string): string;
  /** Formats a zero-result search count. */
  searchResultCount(total: number): string;
  /** Formats the active 1-based search result and total result count. */
  searchResultPosition(current: number, total: number): string;
  /** Formats a zoom scale where `1` represents 100%. */
  zoom(scale: number): string;
  /** Formats the accessible label for one thumbnail page button. */
  thumbnailPage(pageNumber: number): string;
  /** Formats the physical controlled-print plan without hardcoded presentation text. */
  printSummary(summary: Readonly<PdfjsViewerPrintSummary>): string;
  /** Formats cancellable print preparation progress. */
  printProgress(completedSheets: number, totalSheets: number): string;
  /** Explains a configurable pre-allocation controlled-print sheet limit. */
  printSheetLimitExceeded(sheetCount: number, maxSheets: number): string;
  /** Describes the DPI selected after controlled-print quality reduction. */
  printReducedQuality(dpi: number): string;
  /** Explains controlled-print quality reduction without imposing English word order. */
  printReducedExplanation(dpi: number): string;
}

/** Resolved print plan supplied to the configured summary formatter. */
export interface PdfjsViewerPrintSummary {
  /** Localized description of the selected pages. */
  readonly pages: string;
  /** Number of output sheets. */
  readonly sheetCount: number;
  /** Resolved physical output orientation. */
  readonly orientation: "portrait" | "landscape";
  /** Resolved pages-per-sheet layout. */
  readonly layout: "single" | "spread";
  /** Resolved final on-sheet raster DPI. */
  readonly dpi: number;
}

/** Controls included in the package-owned generated UI. All default to `true`. */
export interface PdfjsViewerUiControlOptions {
  /** Include the text-selection toggle in the options menu. */
  textSelection?: boolean;
  /** Include previous/next buttons and the current-page field. */
  navigation?: boolean;
  /** Include in-document Back/Forward controls in the options menu. */
  navigationHistory?: boolean;
  /** Include the browser-fullscreen toggle in the compact mode row. */
  fullscreen?: boolean;
  /** Include presentation toggle and transient presentation controls. */
  presentation?: boolean;
  /** Include the primary and menu fit-to-view controls. */
  fit?: boolean;
  /** Include fit-mode radios in the options menu. */
  fitMode?: boolean;
  /** Include document rotation actions in the options menu. */
  rotation?: boolean;
  /** Include document-search controls when search is enabled. */
  search?: boolean;
  /** Include table-of-contents controls when the outline is enabled. */
  outline?: boolean;
  /** Include thumbnail navigation controls when thumbnails are enabled. */
  thumbnails?: boolean;
  /** Include document attachment controls when attachments are enabled. */
  attachments?: boolean;
  /** Include optional-content layer controls when layers are enabled. */
  layers?: boolean;
  /** Include the table-of-contents filter when outline filtering is enabled. */
  outlineFilter?: boolean;
  /** Include the options menu. Controls nested inside it require this menu. */
  menu?: boolean;
  /** Include the document download action in the options menu. */
  download?: boolean;
  /** Include the filled-document download independently from original download. */
  downloadFilledDocument?: boolean;
  /** Include the print action in the options menu. */
  print?: boolean;
  /** Include the document-information action and dialog in the options menu. */
  documentInformation?: boolean;
  /** Include zoom controls in the options menu. */
  zoom?: boolean;
  /** Include page layout controls in the options menu. */
  pageLayout?: boolean;
  /** Include rendering-profile controls in the options menu when multiple profiles are available. */
  renderingProfile?: boolean;
}

/** Labels and dynamic text formatters shared by every UI mode. */
export interface PdfjsViewerUiTextOptions {
  /** Partial replacements for the built-in English labels. */
  labels?: Partial<PdfjsViewerLabels>;
  /** Partial replacements for package-authored dynamic text. */
  formatters?: Partial<PdfjsViewerFormatters>;
}

/** Composition and label options accepted by the generated-UI factory. */
export interface PdfjsViewerUiRenderOptions extends PdfjsViewerUiTextOptions {
  /** Default-themed shell, or a neutral shell for host-owned custom styling. */
  variant?: "default" | "custom";
  /** Instance-unique prefix used for generated IDs and radio names. */
  id: string;
  /** Initial URL assigned to the generated download link. */
  initialUrl?: string | null;
  /** Text direction applied to generated UI. Defaults to `"auto"`. */
  direction?: "ltr" | "rtl" | "auto";
  /** Package-owned controls included in the generated UI. */
  controls?: PdfjsViewerUiControlOptions;
  /** Generated sidebar view-switcher composition. */
  sidebar?: {
    /** Views kept directly visible; other enabled views use the overflow menu. */
    primaryViews?: readonly PdfjsViewerSidebarView[];
  };
}

/** Constructor UI contract, discriminated so ignored composition cannot be supplied. */
export type PdfjsViewerUiOptions =
  | (PdfjsViewerUiTextOptions &
      Pick<PdfjsViewerUiRenderOptions, "direction" | "controls" | "sidebar"> & {
        /** Generates the complete package-owned default UI. */
        mode?: "default";
      })
  | (PdfjsViewerUiTextOptions & {
      /** Uses host-provided controls or a headless package-created surface. */
      mode: "custom" | "headless";
    });

/**
 * Direct element bindings for a custom UI.
 *
 * A supplied element takes precedence over stable-selector discovery. Omitted
 * bindings use their documented selector and discovery scope; the document
 * {@link container} is the only required binding or discoverable element.
 * Directly bound elements may live outside {@link PdfjsViewerOptions.rootEl}.
 */
export interface PdfjsViewerUiBindings {
  /**
   * Explicit scope for ordinary control-selector discovery.
   * When omitted, the viewer uses a `.pdf-controls` element below `rootEl`, then `rootEl`.
   */
  controlDiscoveryScope?: HTMLElement;
  /** Scrollable document viewport that receives package-owned page surfaces. */
  container?: HTMLElement;
  /** Direct bindings for page navigation controls. */
  navigation?: {
    /** Moves to the previous page or visible page row. */
    previous?: HTMLButtonElement;
    /** Moves to the next page or visible page row. */
    next?: HTMLButtonElement;
    /** Displays and accepts the current page number. */
    pageNumber?: HTMLInputElement;
    /** Displays the loaded document's page count. */
    pageCount?: HTMLElement;
  };
  /** Direct bindings for in-document Back/Forward controls. */
  navigationHistory?: {
    /** Restores the previous explicit document location. */
    back?: HTMLButtonElement;
    /** Restores the next explicit document location. */
    forward?: HTMLButtonElement;
  };
  /** Direct binding for browser fullscreen. */
  fullscreen?: {
    /** Enters or exits exact-root browser fullscreen. */
    toggle?: HTMLButtonElement;
  };
  /** Direct bindings for discrete-page presentation mode. */
  presentation?: {
    /** Enters or exits presentation mode. */
    toggle?: HTMLButtonElement;
    /** Transient presentation toolbar. */
    controls?: HTMLElement;
    /** Moves to the previous presentation page. */
    previous?: HTMLButtonElement;
    /** Moves to the next presentation page. */
    next?: HTMLButtonElement;
    /** Exits presentation mode. */
    exit?: HTMLButtonElement;
  };
  /** Document download link. */
  download?: HTMLAnchorElement;
  /** Downloads a new PDF containing current interactive form values. */
  downloadFilledDocument?: HTMLButtonElement;
  /** Document print button. */
  print?: HTMLButtonElement;
  /** Direct bindings for a package-managed controlled-native print setup dialog. */
  printSetup?: {
    /** HTML dialog containing every controlled-print element. */
    dialog?: HTMLDialogElement;
    /** Form that submits controlled print preparation. */
    form?: HTMLFormElement;
    /** Selects all pages or a custom page range. */
    pages?: HTMLSelectElement;
    /** Accepts a custom page range. */
    range?: HTMLInputElement;
    /** Wrapper shown only for custom page ranges. */
    rangeWrap?: HTMLElement;
    /** Selects automatic, single-page, or spread layout. */
    layout?: HTMLSelectElement;
    /** Wrapper shown only for spread first-page-side selection. */
    side?: HTMLElement;
    /** Selects the first-page side for spread layout. */
    sideSelect?: HTMLSelectElement;
    /** Disclosure containing advanced print settings. */
    more?: HTMLDetailsElement;
    /** Selects a sheet preset or custom sheet dimensions. */
    sheet?: HTMLSelectElement;
    /** Wrapper shown only for custom sheet dimensions. */
    customSheet?: HTMLElement;
    /** Custom sheet width number input. */
    customSheetWidth?: HTMLInputElement;
    /** Custom sheet height number input. */
    customSheetHeight?: HTMLInputElement;
    /** Unit for custom sheet dimensions. */
    customSheetUnit?: HTMLSelectElement;
    /** Selects enlargement-and-reduction or reduction-only page fitting. */
    pageScaling?: HTMLSelectElement;
    /** Selects automatic, portrait, or landscape orientation. */
    orientation?: HTMLSelectElement;
    /** Selects automatic or explicit output DPI. */
    quality?: HTMLSelectElement;
    /** Live status for print preflight and preparation. */
    status?: HTMLElement;
    /** Progress of controlled-print sheet preparation. */
    progress?: HTMLProgressElement;
    /** Guidance for native-dialog and cancellation behavior. */
    guidance?: HTMLElement;
    /** Warning shown when browser-source fallback changes output semantics. */
    fallbackWarning?: HTMLElement;
    /** Closes the print setup dialog. */
    close?: HTMLButtonElement;
    /** Cancels and closes the print setup dialog. */
    cancel?: HTMLButtonElement;
    /** Opens browser-source printing when it is available. */
    source?: HTMLButtonElement;
    /** Submits controlled print preparation. */
    submit?: HTMLButtonElement;
    /** Detail appended to the controlled-print submit action. */
    submitDetail?: HTMLElement;
  };
  /** Direct bindings for zoom and fit-to-view controls. */
  zoom?: {
    /** Primary fit-to-view button. */
    fit?: HTMLButtonElement;
    /** Fit-to-view button shown in the options menu. */
    fitMenu?: HTMLButtonElement;
    /** Range input that controls document zoom. */
    slider?: HTMLInputElement;
    /** Wrapper that receives the fit-to-view marker position. */
    sliderWrap?: HTMLElement;
  };
  /** Direct bindings for the document-search controls. */
  search?: {
    /** Opens and closes the search panel. */
    toggle?: HTMLButtonElement;
    /** Search panel that scopes fallback discovery of its child controls. */
    panel?: HTMLElement;
    /** Input that accepts the document-search query. */
    input?: HTMLInputElement;
    /** Selects the previous search result. */
    previous?: HTMLButtonElement;
    /** Selects the next search result. */
    next?: HTMLButtonElement;
    /** Displays the selected result and total result count. */
    count?: HTMLElement;
    /** Closes the search panel. */
    close?: HTMLButtonElement;
  };
  /** Direct bindings for the options menu and its controls. */
  menu?: {
    /** Opens and closes the options menu. */
    toggle?: HTMLButtonElement;
    /** Options menu panel that scopes fallback discovery of its close button. */
    panel?: HTMLElement;
    /** Closes the options menu. */
    close?: HTMLButtonElement;
    /** Enables or disables text-selection interaction mode. */
    textSelectionToggle?: HTMLButtonElement;
    /** Contains page-layout radio inputs identified by `data-pdf-page-layout`. */
    pageLayout?: HTMLElement;
    /** Contains fit-mode radio inputs identified by `data-pdf-fit-mode`. */
    fitMode?: HTMLElement;
    /** Rotates the document counterclockwise. */
    rotateCounterclockwise?: HTMLButtonElement;
    /** Restores the configured initial rotation. */
    resetRotation?: HTMLButtonElement;
    /** Rotates the document clockwise. */
    rotateClockwise?: HTMLButtonElement;
    /** Contains rendering-profile radio inputs identified by `data-pdf-rendering-profile`. */
    renderingProfile?: HTMLElement;
  };
  /** Direct bindings for the shared sidebar shell. */
  sidebar?: {
    /** Sidebar container that hosts the active sidebar view. */
    container?: HTMLElement;
    /** Opens and closes the shared sidebar. */
    toggle?: HTMLButtonElement;
    /** Closes a collapsible sidebar. */
    close?: HTMLButtonElement;
    /** Toolbar containing directly visible view-selector buttons. */
    primaryViews?: HTMLElement;
    /** Opens and closes the secondary-view menu. */
    moreToggle?: HTMLButtonElement;
    /** Menu containing secondary view selectors. */
    moreMenu?: HTMLElement;
  };
  /** Direct bindings for the table-of-contents controls. */
  outline?: {
    /** Mount point where the viewer renders outline entries. */
    content?: HTMLElement;
    /** Wrapper whose visibility represents the outline filter state. */
    filter?: HTMLElement;
    /** Input that filters rendered outline entries. */
    filterInput?: HTMLInputElement;
  };
  /** Direct bindings for thumbnail navigation. */
  thumbnails?: {
    /** Mount point where the viewer creates thumbnail page buttons. */
    content?: HTMLElement;
  };
  /** Direct bindings for document attachments. */
  attachments?: {
    /** Mount point where the viewer renders embedded-file download actions. */
    content?: HTMLElement;
  };
  /** Direct bindings for optional-content layer controls. */
  layers?: {
    /** Mount point where the viewer renders the normalized layer tree. */
    content?: HTMLElement;
  };
  /** Native indicator for optional document-loading and initial-render progress feedback. */
  documentProgress?: HTMLProgressElement;
}

/** Scope in which the viewer handles keyboard shortcuts. */
export type PdfjsViewerKeyboardScope = "viewer" | "global";

/** Keyboard-shortcut routing configuration. */
export interface PdfjsViewerKeyboardOptions {
  /** `viewer` handles keys bubbling from the viewer; `global` uses document routing. */
  scope?: PdfjsViewerKeyboardScope;
}

/** Configuration for PDF outline loading and presentation. */
export interface PdfjsViewerOutlineFeatureOptions {
  /** Enable filtering within the table of contents. Defaults to `true`. */
  filter?: boolean;
  /** Load and render the outline after document load instead of on first use. Defaults to `false`. */
  prepareOnLoad?: boolean;
}

/** Configuration for document search indexing. */
export interface PdfjsViewerSearchFeatureOptions {
  /** Build the full-document text index after document load instead of on first use. Defaults to `false`. */
  prepareOnLoad?: boolean;
}

/** Configuration for links originating from PDF annotations. */
export interface PdfjsViewerAnnotationLinkFeatureOptions {
  /** Enable links to destinations inside the document. Defaults to `true`. */
  internalDestinations?: boolean;
  /** Enable links to external URLs. Defaults to `true`. */
  externalUrls?: boolean;
}

/** Configuration for rich read-only annotation presentation. */
export interface PdfjsViewerAnnotationMarkupFeatureOptions {
  /** Enable annotation popup presentation. Defaults to `true`. */
  popups?: boolean;
  /** Enable page-local annotation attachment actions. Defaults to `true`. */
  fileAttachments?: boolean;
}

/** Configuration for interactive PDF forms. */
export interface PdfjsViewerFormsFeatureOptions {
  /** Enable interactive AcroForm controls. Defaults to `true`. */
  interactive?: boolean;
  /** Enable pure-XFA loading and presentation. Hybrid XFA uses its AcroForm fallback. Defaults to `true`. */
  xfa?: boolean;
}

/** Optional document capabilities. All default to enabled. */
export interface PdfjsViewerFeatureOptions {
  /** Enable document-local Back/Forward history. Defaults to `true`. */
  navigationHistory?: boolean;
  /** Enable standard exact-root browser fullscreen. Defaults to `true`. */
  fullscreen?: boolean;
  /** Enable discrete-page presentation mode. Defaults to `true`. */
  presentation?: boolean;
  /** Enable selectable PDF text and its interaction mode. */
  textSelection?: boolean;
  /** Enable document search, or configure when its text index is built. */
  search?: boolean | PdfjsViewerSearchFeatureOptions;
  /** Enable the table of contents, or configure its optional filtering. */
  outline?: boolean | PdfjsViewerOutlineFeatureOptions;
  /** Enable demand-driven page thumbnails. Defaults to `true`. */
  thumbnails?: boolean;
  /** Enable document-level embedded-file attachments. Defaults to `true`. */
  attachments?: boolean;
  /** Enable annotation links, or configure their supported targets. Defaults to `true`. */
  annotationLinks?: boolean | PdfjsViewerAnnotationLinkFeatureOptions;
  /** Enable rich read-only annotations, or configure their interaction. Defaults to `true`. */
  annotationMarkup?: boolean | PdfjsViewerAnnotationMarkupFeatureOptions;
  /** Enable PDF forms, or configure supported form categories. Defaults to `true`. */
  forms?: boolean | PdfjsViewerFormsFeatureOptions;
  /** Enable optional-content layer support. Defaults to `true`. */
  layers?: boolean;
  /** Configure printing. Omitted values default to controlled native printing with source fallback. */
  print?: PdfjsViewerPrintMode | PdfjsViewerPrintFeatureOptions;
}

/** Operational print mode for UI and programmatic printing. */
export type PdfjsViewerPrintMode = "off" | "native" | "browser" | "adapter";

/** Print mode for the package or discovered print action. */
export interface PdfjsViewerPrintFeatureOptions {
  /** Operational mode. Defaults to `native`. */
  mode?: PdfjsViewerPrintMode;
  /** Allow browser-source fallback and explicit source printing in native mode. Defaults to `true`. */
  browserFallback?: boolean;
  /** Defaults shared by package UI, custom UI, direct calls, and adapters. */
  defaults?: PdfjsViewerPrintDefaults;
}

/** Accessibility and motion-preference behavior. */
export interface PdfjsViewerAccessibilityOptions {
  /** Accessible name applied to the document viewport when one is not already present. */
  documentLabel?: string;
  /** Respect prefers-reduced-motion for all programmatic smooth scrolling. Default true. */
  respectReducedMotion?: boolean;
  /** Restore focus to the control that opened a panel when it closes. Default true. */
  restorePanelFocus?: boolean;
}

/** Descriptor for a URL-backed PDF source. */
export interface PdfjsViewerUrlSource {
  /** Identifies a URL-backed source descriptor. */
  readonly type: "url";
  /** Non-empty URL passed to PDF.js. */
  readonly url: string;
  /** Optional suggested filename for download-oriented integrations. */
  readonly filename?: string;
}

/** Descriptor for an in-memory PDF source. */
export interface PdfjsViewerDataSource {
  /** Identifies an in-memory source descriptor. */
  readonly type: "data";
  /** Non-empty PDF bytes passed to PDF.js. */
  readonly data: Uint8Array | ArrayBuffer;
  /** Optional suggested filename for download-oriented integrations. */
  readonly filename?: string;
}

/** A shorthand value or extensible source descriptor accepted by `load()`. */
export type PdfjsViewerSource =
  string | Uint8Array | ArrayBuffer | PdfjsViewerUrlSource | PdfjsViewerDataSource;

/** Reason PDF.js requested a password from the host. */
export type PdfjsViewerPasswordReason = "need-password" | "incorrect-password";

/** Context passed when PDF.js needs a password or rejects the previous one. */
export interface PdfjsViewerPasswordRequest {
  /** Whether this is the first request or a retry after an incorrect password. */
  reason: PdfjsViewerPasswordReason;
}

/**
 * Supplies passwords requested by PDF.js. Return `null` to cancel the current
 * document load; rejection is also treated as cancellation.
 */
export type PdfjsViewerPasswordProvider = (
  request: PdfjsViewerPasswordRequest,
) => string | null | Promise<string | null>;

/**
 * Safe PDF.js document-loading options. Source and lifecycle fields are owned by
 * the viewer and intentionally cannot be overridden through this interface.
 */
export interface PdfjsViewerDocumentOptions {
  /** HTTP headers supplied to PDF.js URL requests. Defaults to no additional headers. */
  httpHeaders?: Readonly<Record<string, string>>;
  /** Include credentials in cross-origin PDF requests. Defaults to `false`. */
  withCredentials?: boolean;
  /** Initial document password. Defaults to no password; prefer `passwordProvider` for interactive retries. */
  password?: string;
  /** Supplies passwords requested by PDF.js. Defaults to no interactive password provider. */
  passwordProvider?: PdfjsViewerPasswordProvider;
  /** Suggested range-request chunk size in bytes. Defaults to `65536` (64 KiB). */
  rangeChunkSize?: number;
  /** Disable HTTP range requests. Defaults to `false`. */
  disableRange?: boolean;
  /** Disable streaming. Defaults to `false`. */
  disableStream?: boolean;
  /** Disable automatic fetching of missing ranges. Defaults to `false`. */
  disableAutoFetch?: boolean;
  /** Base URL used to resolve relative links in the PDF. Defaults to no base URL. */
  docBaseUrl?: string;
  /** Base URL for PDF.js character maps. Defaults to no character-map URL. */
  cMapUrl?: string;
  /** Whether character maps at `cMapUrl` use packed binary form. Defaults to `true`. */
  cMapPacked?: boolean;
  /** Base URL for ICC color profiles. Defaults to no ICC-profile URL. */
  iccUrl?: string;
  /** Base URL for standard-font data. Defaults to no standard-font URL. */
  standardFontDataUrl?: string;
  /** Base URL for PDF.js WebAssembly assets. Defaults to no WebAssembly URL. */
  wasmUrl?: string;
  /**
   * Let the worker fetch auxiliary resources directly. Defaults to `true` only
   * when packed CMaps, standard fonts, and WebAssembly URLs are all configured
   * with fetchable URLs; otherwise defaults to `false`.
   */
  useWorkerFetch?: boolean;
  /** Enable PDF.js WebAssembly acceleration. Defaults to `true`. */
  useWasm?: boolean;
  /** Allow PDF.js to use installed system fonts. Defaults to `true` in supported browsers when `disableFontFace` is `false`. */
  useSystemFonts?: boolean;
  /** Disable `@font-face` creation for embedded fonts. Defaults to `false` in supported browsers. */
  disableFontFace?: boolean;
  /** Reject document loading when PDF.js encounters parse errors. Defaults to `false`. */
  stopAtErrors?: boolean;
  /** Maximum decoded image size in pixels. Defaults to `-1`, meaning no limit. */
  maxImageSize?: number;
  /** PDF.js diagnostic verbosity level. Defaults to warning output (`1`). */
  verbosity?: number;
}

/** Host-controlled persistence and routing for shareable document destinations. */
export interface PdfjsViewerNavigationStateAdapter {
  /** Reads the persisted navigation destination ID without its PDF named-destination prefix. */
  readNavigationDestinationId(): string | null;
  /** Persists a navigation destination ID, or clears it when passed `null`. */
  writeNavigationDestinationId(navigationDestinationId: string | null): void;
}

/** Browser hash parameter names used by {@link createHashNavigationStateAdapter}. */
export interface PdfjsViewerHashNavigationOptions {
  /** Hash parameter that stores the navigation destination ID. */
  navigationDestinationParam: string;
}

/** Interaction policy for a custom or responsive sidebar container. */
export type PdfjsViewerSidebarMode = "auto" | "overlay" | "persistent";
/** Initial sidebar selection policy. */
export type PdfjsViewerInitialSidebarView = PdfjsViewerSidebarView | "auto";

/** Typed interaction and rendering behavior. Visual styling is through CSS. */
export interface PdfjsViewerBehaviorOptions {
  /** Keep selection mode active, or deactivate after a managed PDF copy. */
  textSelectionPersistence?: PdfjsViewerTextSelectionPersistence;
  /** Reduce speculative rendering and offscreen raster retention while the owning browser document is hidden. Defaults to `true`. */
  reduceRenderingWhenDocumentHidden?: boolean;
  /** Absolute zoom bounds. Mobile and desktop are detected per viewer. */
  zoom?: Partial<PdfjsViewerZoomOptions>;
  /** Pointer long-press threshold in milliseconds. */
  longPressMs?: number;
  /** Sidebar interaction policy. `auto` detects overlay positioning from CSS. */
  sidebarMode?: PdfjsViewerSidebarMode;
  /** Initially selected sidebar view. Auto prefers a provisionally available outline. */
  initialSidebarView?: PdfjsViewerInitialSidebarView;
  /** Enable Ctrl/Cmd-wheel and touch/pinch viewer zoom. Defaults to `true`. */
  zoomGestures?: boolean;
  /** Default matching policy for UI search and public `search()` calls. */
  searchQueryOptions?: Partial<PdfjsViewerTextQueryOptions>;
  /** Default matching policy for UI outline filtering and queried `getOutline()` calls. */
  outlineFilterOptions?: Partial<PdfjsViewerTextQueryOptions>;
  /** Same-page tolerance for associating document spots with outline or navigation destinations. Defaults to `0.1`. */
  destinationMatchTolerance?: number;
  /** Maximum container height at which automatic fit resolves to width. Defaults to 400. */
  autoFitWidthMaxHeight?: number;
}

/** Zoom bounds selected according to the viewer's device classification. */
export interface PdfjsViewerZoomOptions {
  /** Minimum desktop zoom scale. Must be finite and greater than zero. */
  minDesktop: number;
  /** Maximum desktop zoom scale. Defaults to 10; must be finite and no smaller than `minDesktop`. */
  maxDesktop: number;
  /** Minimum likely-mobile zoom scale. Must be finite and greater than zero. */
  minMobile: number;
  /** Maximum likely-mobile zoom scale. Defaults to 4; must be finite and no smaller than `minMobile`. */
  maxMobile: number;
}

/** Fired after parsing, layout initialization, and the initial render window complete. */
export interface PdfjsViewerReadyEvent extends CustomEvent<void> {
  type: "pdf:ready";
}
/** Private discriminated detail shared by asynchronous feature-preparation events. */
type PdfjsViewerPreparationResult<T extends object> =
  | (T & {
      /** Indicates that preparation completed successfully. */
      status: "ready";
    })
  /** Failed preparation result with the originating error. */
  | (T & {
      /** Indicates that preparation ended with an error. */
      status: "error";
      /** Error that prevented preparation. */
      error: unknown;
    });
/** Fired when full-document search indexing settles for the active document. */
export interface PdfjsViewerSearchIndexCompleteEvent extends CustomEvent<
  PdfjsViewerPreparationResult<{
    /** Number of document pages indexed before settlement. */
    indexedPages: number;
  }>
> {
  type: "pdf:searchindexcomplete";
}
/** Fired when outline preparation settles for the active document. */
export interface PdfjsViewerOutlineCompleteEvent extends CustomEvent<
  PdfjsViewerPreparationResult<{
    /** Number of outline items prepared before settlement. */
    itemCount: number;
  }>
> {
  type: "pdf:outlinecomplete";
}
/** Fired when attachment metadata preparation settles for the active document. */
export interface PdfjsViewerAttachmentsCompleteEvent extends CustomEvent<
  PdfjsViewerPreparationResult<{
    /** Number of attachment entries prepared before settlement. */
    itemCount: number;
  }>
> {
  type: "pdf:attachmentscomplete";
}
/** Fired when the active viewer load fails. */
export interface PdfjsViewerErrorEvent extends CustomEvent<{
  /** Error that ended the active load. */
  error: unknown;
}> {
  type: "pdf:error";
}
/** Fired when the viewer's current 1-based page changes. */
export interface PdfjsViewerPageChangeEvent extends CustomEvent<{
  /** New 1-based current page. */
  page: number;
}> {
  type: "pdf:pagechange";
}
/** Observable document/viewer lifecycle status. */
export type PdfjsViewerStatus = "loading" | "ready" | "closed" | "error" | "destroyed";
/** Expected fullscreen command failure. */
export type PdfjsViewerFullscreenFailure =
  "disabled" | "unavailable" | "occupied" | "denied" | "cancelled" | "not-active";
/** Immutable result of a fullscreen command. */
export type PdfjsViewerFullscreenResult =
  | Readonly<{
      /** Whether the requested command completed successfully. */
      ok: true;
      /** Browser-authoritative exact-root fullscreen ownership. */
      fullscreen: boolean;
    }>
  | Readonly<{
      /** Whether the requested command completed successfully. */
      ok: false;
      /** Expected reason the command did not complete. */
      reason: PdfjsViewerFullscreenFailure;
      /** Browser-authoritative exact-root fullscreen ownership. */
      fullscreen: boolean;
      /** Unexpected underlying value retained for diagnostics when available. */
      cause?: unknown;
    }>;
/** Expected presentation-mode command failure. */
export type PdfjsViewerPresentationModeFailure =
  "disabled" | "not-ready" | "cancelled" | "not-active";
/** Immutable result of a presentation-mode command. */
export type PdfjsViewerPresentationModeResult =
  | Readonly<{
      /** Whether the requested command completed successfully. */
      ok: true;
      /** Whether discrete-page presentation mode is active. */
      presentationMode: boolean;
      /** Browser-authoritative exact-root fullscreen ownership. */
      fullscreen: boolean;
    }>
  | Readonly<{
      /** Whether the requested command completed successfully. */
      ok: false;
      /** Expected reason the command did not complete. */
      reason: PdfjsViewerPresentationModeFailure;
      /** Whether discrete-page presentation mode is active. */
      presentationMode: boolean;
      /** Browser-authoritative exact-root fullscreen ownership. */
      fullscreen: boolean;
      /** Unexpected underlying value retained for diagnostics when available. */
      cause?: unknown;
    }>;
/** Per-document settings applied by one explicit {@link PdfjsViewer.load} call. */
export interface PdfjsViewerLoadOptions {
  /** Initial 1-based page applied before the first render plan is computed. */
  readonly initialPage?: number;
  /** PDF.js document options shallowly overriding constructor defaults for this load. */
  readonly documentOptions?: PdfjsViewerDocumentOptions;
}
/** Expected reason why an admitted load stopped before readiness. */
export type PdfjsViewerLoadCancellationCause =
  "superseded" | "closed" | "destroyed" | "password-cancelled";
/** Exactly-once result of one explicit {@link PdfjsViewer.load} attempt. */
export type PdfjsViewerLoadResult =
  | {
      /** Indicates that the document became ready. */
      readonly ok: true;
    }
  | {
      /** Indicates that the document did not become ready. */
      readonly ok: false;
      /** Identifies expected lifecycle cancellation. */
      readonly reason: "cancelled";
      /** Expected lifecycle action that cancelled this load. */
      readonly cause: PdfjsViewerLoadCancellationCause;
    }
  | {
      /** Indicates that the document did not become ready. */
      readonly ok: false;
      /** Identifies a terminal loading error. */
      readonly reason: "error";
      /** Terminal PDF.js or viewer error. */
      readonly error: unknown;
    };
/** Observable state of an optional active-document preparation feature. */
export type PdfjsViewerFeaturePreparationState =
  "disabled" | "idle" | "loading" | "ready" | "error";
/** Immutable observable state returned by `viewer.state` and state-change events. */
export type PdfjsViewerState = Readonly<{
  /** Current document/viewer lifecycle state. */
  status: PdfjsViewerStatus;
  /** Whether the host currently presents this viewer as active. */
  active: boolean;
  /** Whether this viewer's exact root owns browser fullscreen. */
  fullscreen: boolean;
  /** Whether browser fullscreen may currently be requested. */
  canFullscreen: boolean;
  /** Whether discrete-page presentation mode is active. */
  presentationMode: boolean;
  /** Whether presentation mode may currently be entered. */
  canPresent: boolean;
  /** Number of pages in the ready document, or zero without a document. */
  pageCount: number;
  /** Current 1-based page; reset to one when the document closes. */
  currentPage: number;
  /** Whether a previous explicit in-document location can be restored. */
  canGoBack: boolean;
  /** Whether a later explicit in-document location can be restored. */
  canGoForward: boolean;
  /** Current CSS-space PDF scale where `1` represents 100%. */
  scale: number;
  /** Configured page layout. */
  pageLayout: PdfjsViewerPageLayout;
  /** Concrete page grouping currently used to render document rows. */
  effectivePageLayout: Exclude<PdfjsViewerPageLayout, "auto">;
  /** Configured row-fitting strategy. */
  fitMode: PdfjsViewerFitModeSelection;
  /** Concrete row-fitting strategy at the current container height. */
  effectiveFitMode: PdfjsViewerFitMode;
  /** Whether canonical scale currently follows fit policy. */
  fitActive: boolean;
  /** Viewer-added clockwise document rotation. */
  rotation: PdfjsViewerRotation;
  /** Requested rendering profile selection. */
  renderingProfile: PdfjsViewerRenderingProfileSelection;
  /** Concrete rendering profile currently applied to the document renderer. */
  effectiveRenderingProfile: PdfjsViewerRenderingProfile;
  /** Concrete rendering profiles available for explicit selection on this viewer. */
  availableRenderingProfiles: readonly PdfjsViewerRenderingProfile[];
  /** URL of a URL-backed document, or `null` for bytes/closed state. */
  sourceUrl: string | null;
  /** Suggested source filename supplied by a descriptor, or `null`. */
  sourceFilename: string | null;
  /** Whether the built-in download action can download the current source. */
  canDownload: boolean;
  /** Whether `print()` can currently invoke native printing or a configured adapter. */
  canPrint: boolean;
  /** Controlled-print preparation and transferred native-resource diagnostics. */
  print: PdfjsViewerPrintState;
  /** Full-document search-index preparation state. */
  searchPreparation: PdfjsViewerFeaturePreparationState;
  /** Table-of-contents preparation state. */
  outlinePreparation: PdfjsViewerFeaturePreparationState;
  /** Embedded-file attachment preparation state. */
  attachmentsPreparation: PdfjsViewerFeaturePreparationState;
  /** Whether package-owned form values differ from their visible loaded values. */
  formDirty: boolean;
  /** Whether PDF text-selection interaction mode is active. */
  textSelectionMode: boolean;
}>;
/** Fired whenever an observable value in {@link PdfjsViewerState} changes. */
export interface PdfjsViewerStateChangeEvent extends CustomEvent<PdfjsViewerState> {
  type: "pdf:statechange";
}
/** Fired after authoritative exact-root browser fullscreen changes. */
export interface PdfjsViewerFullscreenChangeEvent extends CustomEvent<
  Readonly<{ fullscreen: boolean }>
> {
  type: "pdf:fullscreenchange";
}
/** Fired for an expected browser fullscreen request or exit failure. */
export interface PdfjsViewerFullscreenErrorEvent extends CustomEvent<
  Extract<PdfjsViewerFullscreenResult, { readonly ok: false }>
> {
  type: "pdf:fullscreenerror";
}
/** Fired after presentation mode enters or exits. */
export interface PdfjsViewerPresentationModeChangeEvent extends CustomEvent<
  Readonly<{ presentationMode: boolean }>
> {
  type: "pdf:presentationmodechange";
}
/** Expected failure reason returned by PDF named-destination navigation. */
export type PdfjsViewerPdfNamedDestinationNavigationFailure =
  "invalid-name" | "not-ready" | "not-found" | "cancelled" | "destroyed" | "error";
/** Structured result returned instead of throwing for expected navigation failures. */
export type PdfjsViewerPdfNamedDestinationNavigationResult =
  | {
      /** Indicates successful destination resolution and navigation. */
      ok: true;
      /** Requested PDF named destination. */
      pdfNamedDestination: string;
      /** Resolved 1-based page. */
      page: number;
      /** Whether a destination spot was applied. */
      positioned: boolean;
    }
  | {
      /** Indicates that navigation was not completed. */
      ok: false;
      /** Requested PDF named destination. */
      pdfNamedDestination: string;
      /** Expected reason navigation was not completed. */
      reason: PdfjsViewerPdfNamedDestinationNavigationFailure;
      /** Underlying unexpected resolution error. */
      error?: unknown;
    };
/** Expected failure reason returned by public document-data queries. */
export type PdfjsViewerQueryFailureReason =
  "disabled" | "not-ready" | "cancelled" | "destroyed" | "error";
/** Structured failure shared by public document-data queries. */
export type PdfjsViewerQueryFailure =
  | {
      /** Indicates that the query did not complete successfully. */
      ok: false;
      /** Expected non-error reason the query did not complete. */
      reason: Exclude<PdfjsViewerQueryFailureReason, "error">;
    }
  | {
      /** Indicates that the query did not complete successfully. */
      ok: false;
      /** Identifies an unexpected query error. */
      reason: "error";
      /** Underlying query error. */
      error: unknown;
    };
/** Detached metadata for one document-level embedded attachment. */
export interface PdfjsViewerAttachment {
  /** Opaque document-scoped identity used by {@link PdfjsViewer.downloadAttachment}. */
  readonly id: string;
  /** Safe basename used for display and browser download. */
  readonly filename: string;
  /** Optional PDF-provided description. */
  readonly description: string | null;
}
/** Result returned by {@link PdfjsViewer.getAttachments}. */
export type PdfjsViewerAttachmentsResult =
  | {
      /** Indicates that attachment metadata was read successfully. */
      ok: true;
      /** Detached attachment metadata in PDF order. */
      attachments: readonly PdfjsViewerAttachment[];
    }
  | PdfjsViewerQueryFailure;
/** Expected failure returned by {@link PdfjsViewer.downloadAttachment}. */
export type PdfjsViewerAttachmentDownloadFailure =
  | PdfjsViewerQueryFailure
  | {
      /** Indicates that the attachment was not downloaded. */
      ok: false;
      /** Expected attachment-specific failure reason. */
      reason: "not-found" | "unavailable";
    };
/** Result returned after requesting one browser attachment download. */
export type PdfjsViewerAttachmentDownloadResult =
  | {
      /** Indicates that the browser download was requested successfully. */
      ok: true;
    }
  | PdfjsViewerAttachmentDownloadFailure;
/** XMP metadata value normalized from PDF.js metadata. */
export type PdfjsViewerMetadataValue = string | readonly string[];
/** One operation granted by an explicit PDF permission dictionary. */
export type PdfjsViewerPermission =
  | "print"
  | "modify-contents"
  | "copy"
  | "modify-annotations"
  | "fill-interactive-forms"
  | "copy-for-accessibility"
  | "assemble"
  | "print-high-quality";
/** Stable identifiers for the original and, when present, modified document. */
export interface PdfjsViewerDocumentFingerprints {
  /** Stable fingerprint for the originally loaded PDF bytes. */
  readonly original: string;
  /** Fingerprint for a modified PDF revision, when present. */
  readonly modified: string | null;
}
/** Tagged-PDF flags from the document catalog. */
export interface PdfjsViewerDocumentMarkInfo {
  /** Whether the document declares marked content. */
  readonly marked: boolean;
  /** Whether the document declares user properties. */
  readonly userProperties: boolean;
  /** Whether PDF tagging quality is marked as suspect. */
  readonly suspects: boolean;
}
/** Detached normalized metadata and capabilities for one ready PDF document. */
export interface PdfjsViewerDocumentInformation {
  /** Number of pages in the loaded document. */
  readonly pageCount: number;
  /** Stable original and optional modified PDF fingerprints. */
  readonly fingerprints: PdfjsViewerDocumentFingerprints;
  /** PDF format version reported by the document, when available. */
  readonly pdfFormatVersion: string | null;
  /** Document language tag, when reported by the PDF. */
  readonly language: string | null;
  /** Encryption handler name, when reported by the PDF. */
  readonly encryptionFilterName: string | null;
  /** Whether the document is optimized for incremental web loading. */
  readonly isLinearized: boolean;
  /** PDF title metadata. */
  readonly title: string | null;
  /** PDF author metadata. */
  readonly author: string | null;
  /** PDF subject metadata. */
  readonly subject: string | null;
  /** PDF keyword metadata. */
  readonly keywords: string | null;
  /** Application that created the PDF. */
  readonly creator: string | null;
  /** Software that produced the PDF. */
  readonly producer: string | null;
  /** Original PDF date string from the Info dictionary, without lossy parsing. */
  readonly creationDate: string | null;
  /** Original PDF date string from the Info dictionary, without lossy parsing. */
  readonly modificationDate: string | null;
  /** Trapping-state metadata reported by the PDF. */
  readonly trapped: string | null;
  /** Primitive custom entries from the PDF Info dictionary. */
  readonly custom: Readonly<Record<string, string | number | boolean>>;
  /** Parsed XMP properties keyed by their lower-case namespace-qualified names. */
  readonly metadata: Readonly<Record<string, PdfjsViewerMetadataValue>>;
  /** Explicitly granted operations, or `null` when PDF.js could not expose a permission list. */
  readonly permissions: readonly PdfjsViewerPermission[] | null;
  /** Whether the document contains AcroForm fields. */
  readonly hasAcroForm: boolean;
  /** Whether the document contains XFA content. */
  readonly hasXfa: boolean;
  /** Whether XFA, rather than AcroForm, is the sole form representation. */
  readonly isPureXfa: boolean;
  /** Form presentation exposed by PDF.js; mixed XFA is intentionally reported as its AcroForm fallback. */
  readonly formPresentation:
    "none" | "acroform" | "pure-xfa" | "hybrid-acroform-fallback" | "xfa-unavailable";
  /** Whether the document contains a PDF portfolio collection. */
  readonly hasCollection: boolean;
  /** Whether the document contains signature fields. */
  readonly hasSignatures: boolean;
  /** Tagged-PDF catalog flags, when exposed by PDF.js. */
  readonly markInfo: PdfjsViewerDocumentMarkInfo | null;
}
/** Result returned by {@link PdfjsViewer.getDocumentInformation}. */
export type PdfjsViewerDocumentInformationResult =
  | {
      /** Indicates that document information was read successfully. */
      ok: true;
      /** Fresh detached document metadata and capability snapshot. */
      information: PdfjsViewerDocumentInformation;
    }
  | PdfjsViewerQueryFailure;
/** One source-text segment contributing to a search match. */
export interface PdfjsViewerSearchMatchSegment {
  /** Original PDF.js text fragment containing this part of the match. */
  readonly text: string;
  /** Segment start within `text`, in JavaScript UTF-16 code units. */
  readonly characterIndex: number;
  /** Segment length within `text`, in JavaScript UTF-16 code units. */
  readonly length: number;
}
/** Detached full-document search match composed of one or more ordered source segments. */
export interface PdfjsViewerSearchMatch {
  /** 1-based PDF page containing the match. */
  readonly page: number;
  /** Ordered source spans; a match crossing PDF.js text items contains multiple segments. */
  readonly segments: readonly PdfjsViewerSearchMatchSegment[];
}
/** Diacritic comparison used by public text and outline-title queries. */
export type PdfjsViewerDiacriticMatching = "smart" | "ignore" | "respect";
/** Query-time text comparison policy. It never rebuilds retained document data. */
export interface PdfjsViewerTextQueryOptions {
  /** Require case to match. Viewer defaults use `false`; public calls inherit their relevant behavior policy. */
  caseSensitive?: boolean;
  /** Compare diacritics asymmetrically, ignore them, or require them. Viewer defaults use `smart`. */
  diacritics?: PdfjsViewerDiacriticMatching;
}
/** Optional public-outline title filtering and comparison policy. */
export interface PdfjsViewerOutlineQueryOptions extends PdfjsViewerTextQueryOptions {
  /** Keep matching outline items and ancestors of matching descendants. Empty means no filtering. */
  query?: string;
}
/** Result returned by {@link PdfjsViewer.search}. */
export type PdfjsViewerSearchResult =
  | {
      /** Indicates that search completed successfully. */
      ok: true;
      /** Trimmed query evaluated against document text. */
      query: string;
      /** Detached matches in page and source-text order. */
      matches: readonly PdfjsViewerSearchMatch[];
    }
  | (PdfjsViewerQueryFailure & {
      /** Trimmed query evaluated before the failure. */
      query: string;
    });
/** Resolved internal destination exposed by a public outline item. */
export interface PdfjsViewerOutlineDestination {
  /** 1-based destination page. */
  readonly page: number;
  /** Horizontal position normalized to the page width, when provided by the PDF. */
  readonly xRatio?: number;
  /** Vertical position normalized to the page height. */
  readonly yRatio: number;
  /** Exact PDF named destination when the outline item explicitly used one. */
  readonly pdfNamedDestination?: string;
  /** Locally inferred ID when navigation-state destination syncing is configured. */
  readonly navigationDestinationId?: string;
}
/** Whether an outline item had no destination, resolved one, or contained an unusable target. */
export type PdfjsViewerOutlineDestinationStatus = "none" | "resolved" | "unresolved";
/** Detached item in the PDF's hierarchical outline. */
export interface PdfjsViewerOutlineItem {
  /** Display title, including the configured fallback for untitled items. */
  readonly title: string;
  /** Whether this item has a resolved, absent, or unusable destination. */
  readonly destinationStatus: PdfjsViewerOutlineDestinationStatus;
  /** Resolved destination, or `null` when none is usable. */
  readonly destination: PdfjsViewerOutlineDestination | null;
  /** Descendant outline items in PDF order. */
  readonly children: readonly PdfjsViewerOutlineItem[];
}
/** Result returned by {@link PdfjsViewer.getOutline}. */
export type PdfjsViewerOutlineResult =
  | {
      /** Indicates that outline preparation completed successfully. */
      ok: true;
      /** Detached hierarchical outline in PDF order. */
      items: readonly PdfjsViewerOutlineItem[];
    }
  | PdfjsViewerQueryFailure;
/** Positioning, animation, and cancellation options for named navigation. */
export interface PdfjsViewerPdfNamedDestinationNavigationOptions {
  /** Use the destination's vertical coordinate when available. Defaults to false. */
  spotWithinPage?: boolean;
  /** Request animated scrolling, subject to reduced-motion preferences. */
  smooth?: boolean;
  /** Cancels this navigation request without cancelling document loading. */
  signal?: AbortSignal;
}
/** One detached optional-content group exposed by the layer API. */
export interface PdfjsViewerLayerGroup {
  /** Discriminant identifying an addressable optional-content group. */
  readonly kind: "group";
  /** PDF.js optional-content group identifier. */
  readonly id: string;
  /** Display name normalized from the PDF. */
  readonly name: string;
  /** Current effective visibility. */
  readonly visible: boolean;
}
/** One detached label grouping optional-content children. */
export interface PdfjsViewerLayerLabel {
  /** Discriminant identifying a structural layer label. */
  readonly kind: "label";
  /** Display name normalized from the PDF. */
  readonly name: string;
  /** Nested optional-content nodes. */
  readonly children: readonly PdfjsViewerLayerNode[];
}
/** A detached optional-content group or structural label. */
export type PdfjsViewerLayerNode = PdfjsViewerLayerGroup | PdfjsViewerLayerLabel;
/** Successful detached optional-content state. */
export interface PdfjsViewerLayerState {
  /** Monotonically increasing revision of the committed layer state. */
  readonly revision: number;
  /** Normalized optional-content tree. */
  readonly layers: readonly PdfjsViewerLayerNode[];
}
/** Fired after a committed optional-content state change. */
export interface PdfjsViewerLayersChangeEvent extends CustomEvent<PdfjsViewerLayerState> {
  type: "pdf:layerschange";
}
/** Result returned by the optional-content query API. */
export type PdfjsViewerLayersResult =
  | ({
      /** Indicates that optional-content state is available. */
      ok: true;
    } & PdfjsViewerLayerState)
  | PdfjsViewerQueryFailure;
/** One requested atomic optional-content visibility change. */
export interface PdfjsViewerLayerVisibilityChange {
  /** Identifier of the optional-content group to update. */
  readonly id: string;
  /** Desired effective visibility. */
  readonly visible: boolean;
}
/** Result returned by atomic optional-content mutation and reset APIs. */
export type PdfjsViewerLayerMutationResult =
  | ({
      /** Indicates that the layer mutation committed successfully. */
      ok: true;
    } & PdfjsViewerLayerState)
  | PdfjsViewerQueryFailure
  | {
      /** Indicates that the layer mutation was rejected. */
      ok: false;
      /** Identifies one or more unknown layer IDs. */
      reason: "unknown-layer";
      /** Requested layer IDs absent from the current tree. */
      ids: readonly string[];
    };
/** Result returned when restoring loaded form defaults. */
export type PdfjsViewerFormResetResult =
  | {
      /** Indicates that loaded form values were restored successfully. */
      ok: true;
      /** Always false after successfully restoring loaded values. */
      formDirty: false;
    }
  | PdfjsViewerQueryFailure;
/** Fired when package-owned form dirty state changes. */
export interface PdfjsViewerFormDirtyChangeEvent extends CustomEvent<{
  /** Whether visible form values differ from loaded values. */
  formDirty: boolean;
}> {
  type: "pdf:formdirtychange";
}
/** Document representation selected for byte access, download, or printing. */
export type PdfjsViewerDocumentVariant = "original" | "with-form-values";
/** Selects the document representation returned by {@link PdfjsViewer.getDocumentData}. */
export interface PdfjsViewerDocumentDataOptions {
  /** Original bytes or bytes containing current interactive form values. */
  document?: PdfjsViewerDocumentVariant;
}
/** Result returned when reading detached current-document bytes. */
export type PdfjsViewerDocumentDataResult =
  | {
      /** Indicates that document bytes were read successfully. */
      ok: true;
      /** Fresh detached PDF bytes. */
      data: Uint8Array;
    }
  | PdfjsViewerQueryFailure;
/** Selects the document representation and filename downloaded by {@link PdfjsViewer.download}. */
export interface PdfjsViewerDownloadOptions extends PdfjsViewerDocumentDataOptions {
  /** Download filename, or the document-derived default when omitted. */
  filename?: string;
}
/** Result returned after requesting a browser download. */
export type PdfjsViewerDownloadResult =
  | {
      /** Indicates that browser download activation was requested successfully. */
      ok: true;
    }
  | PdfjsViewerQueryFailure;
/** Inclusive 1-based print page range. */
export interface PdfjsViewerPrintPageRange {
  /** First included 1-based page. */
  readonly from: number;
  /** Last included 1-based page. */
  readonly to: number;
}
/** Every page or ordered ranges selected for controlled printing. */
export type PdfjsViewerPrintPages = "all" | readonly PdfjsViewerPrintPageRange[];
/** Package-controlled single-page or adjacent-page print composition. */
export type PdfjsViewerPrintLayout =
  | {
      /** Lets package policy select single-page or spread composition. */
      readonly mode: "auto";
    }
  | {
      /** Places one PDF page on each output sheet. */
      readonly mode: "single";
    }
  | {
      /** Places adjacent PDF pages on each output sheet. */
      readonly mode: "spread";
      /** Requested side for the first selected page. */
      readonly firstPageSide?: "auto" | "left" | "right";
      /** Gap between spread pages in PDF points. */
      readonly gapPt?: number;
    };
/** Complete validated print layout supplied to an adapter or print owner. */
export type PdfjsViewerNormalizedPrintLayout =
  | {
      /** Retains automatic composition until document geometry is resolved. */
      readonly mode: "auto";
    }
  | {
      /** Uses validated single-page composition. */
      readonly mode: "single";
    }
  | {
      /** Uses validated adjacent-page composition. */
      readonly mode: "spread";
      /** Resolved requested side for the first selected page. */
      readonly firstPageSide: "auto" | "left" | "right";
      /** Validated gap between spread pages in PDF points. */
      readonly gapPt: number;
    };
/** Physical print sheet suggestion accepted by controlled or adapter printing. */
export type PdfjsViewerPrintSheet =
  | "a3"
  | "a4"
  | "a5"
  | "letter"
  | "legal"
  | {
      /** Physical custom sheet width. */
      readonly width: number;
      /** Physical custom sheet height. */
      readonly height: number;
      /** Unit used by the custom dimensions. */
      readonly unit: "pt" | "mm" | "in";
    };
/** Placement policy for a PDF page within its physical output-sheet slot. */
export type PdfjsViewerPrintPageScaling = "fit" | "shrink-to-fit";
/** Viewer-level defaults applied before per-call print options. */
export interface PdfjsViewerPrintDefaults {
  /** Default physical output sheet. */
  sheet?: PdfjsViewerPrintSheet;
  /** Default page placement policy. */
  pageScaling?: PdfjsViewerPrintPageScaling;
  /** Default requested output orientation. */
  orientation?: "auto" | "portrait" | "landscape";
  /** Default requested final on-sheet raster DPI. */
  quality?: {
    /** Final on-sheet raster DPI. */
    readonly dpi: 300 | 600;
  };
}
/** Complete immutable viewer-level print defaults. */
export interface PdfjsViewerNormalizedPrintDefaults {
  /** Validated physical output sheet. */
  readonly sheet: PdfjsViewerPrintSheet;
  /** Validated page placement policy. */
  readonly pageScaling: PdfjsViewerPrintPageScaling;
  /** Validated requested output orientation. */
  readonly orientation: "auto" | "portrait" | "landscape";
  /** Validated final on-sheet raster DPI. */
  readonly quality: {
    /** Final on-sheet raster DPI. */
    readonly dpi: 300 | 600;
  };
}
/** Package defaults shared by generated UI, custom UI, direct calls, and adapters. */
export const PDFJS_VIEWER_PRINT_DEFAULTS: PdfjsViewerNormalizedPrintDefaults = Object.freeze({
  sheet: "a4",
  pageScaling: "fit",
  orientation: "auto",
  quality: Object.freeze({ dpi: 300 }),
});
/** Caller-selected controlled print policy. */
export interface PdfjsViewerPrintOptions {
  /** Every page or the inclusive ranges to print. */
  pages?: PdfjsViewerPrintPages;
  /** Requested pages-per-sheet composition. */
  layout?: PdfjsViewerPrintLayout;
  /** Requested final on-sheet raster DPI. */
  quality?: {
    /** Requested final on-sheet raster DPI. */
    readonly dpi: number;
  };
  /** Requested physical output sheet. */
  sheet?: PdfjsViewerPrintSheet;
  /** Page placement policy within each output-sheet slot. */
  pageScaling?: PdfjsViewerPrintPageScaling;
  /** Requested output orientation. */
  orientation?: "auto" | "portrait" | "landscape";
  /** Signal that cancels preparation before native invocation. */
  signal?: AbortSignal;
}
/** Configurable controlled-print workload and per-resource limits. */
export interface PdfjsViewerPrintLimits {
  /** Maximum output sheets admitted for one controlled-print job. */
  maxSheets: number;
  /** Maximum temporary annotation raster bytes per page. */
  maxAnnotationCanvasBytesPerPage: number;
  /** Conservative estimated encoded bytes retained per raster pixel. */
  estimatedEncodedBytesPerPixel: number;
  /** Multiplier for temporary encoding overhead. */
  encodingOverheadRatio: number;
  /** Fraction of the estimated peak reserved as safety headroom. */
  safetyMarginRatio: number;
  /** Maximum pure-XFA pages admitted to one print job. */
  maxXfaPages: number;
  /** Maximum pure-XFA DOM nodes admitted to one print job. */
  maxXfaNodes: number;
  /** Maximum pure-XFA images admitted to one print job. */
  maxXfaImages: number;
  /** Maximum concurrent pure-XFA image decodes. */
  maxConcurrentImageDecodes: number;
}
/** Allocation-free native print setup result shared by package and host dialogs. */
export type PdfjsViewerPrintPreflightResult =
  | {
      /** Indicates that the native print plan satisfies current policy and limits. */
      readonly ok: true;
      /** Requested DPI after print-permission policy. */
      readonly requestedDpi: number;
      /** Budget-safe DPI used to rasterize the output. */
      readonly resolvedDpi: number;
      /** Whether the requested DPI was reduced to satisfy limits. */
      readonly reduced: boolean;
      /** Whether browser-source fallback is available for this route. */
      readonly sourceFallbackAvailable: boolean;
      /** Number of planned physical output sheets. */
      readonly sheetCount: number;
      /** Whether browser-source fallback can lose requested spread parity. */
      readonly paritySensitive: boolean;
      /** Whether browser-source fallback can lose changed layer visibility. */
      readonly layerWarning: boolean;
      /** Resolved native-print capability decision. */
      readonly nativeCapabilities: Readonly<PdfjsViewerNativePrintCapabilities>;
      /** Resolved physical output orientation. */
      readonly orientation: "portrait" | "landscape";
      /** Resolved pages-per-sheet layout. */
      readonly layout: "single" | "spread";
    }
  | {
      /** Indicates that no native print plan is available. */
      readonly ok: false;
      /** Expected reason planning did not succeed. */
      readonly reason:
        "not-ready" | "destroyed" | "disabled" | "too-large" | "cancelled" | "unsupported";
      /** Requested DPI, when it was computed before failure. */
      readonly requestedDpi?: number;
      /** Planned sheet count, when it was computed before failure. */
      readonly sheetCount?: number;
      /** Whether browser-source fallback is available for this route. */
      readonly sourceFallbackAvailable: boolean;
      /** Whether source fallback can lose requested spread parity. */
      readonly paritySensitive?: boolean;
      /** Whether source fallback can lose changed layer visibility. */
      readonly layerWarning?: boolean;
      /** Resolved native-print capabilities, when they were available. */
      readonly nativeCapabilities?: Readonly<PdfjsViewerNativePrintCapabilities>;
    }
  | {
      /** Indicates that no native print plan is available. */
      readonly ok: false;
      /** Identifies the active rendering profile's memory limit. */
      readonly reason: "memory-limit";
      /** Whether browser-source fallback is available for this route. */
      readonly sourceFallbackAvailable: boolean;
      /** Requested DPI, when it was computed before failure. */
      readonly requestedDpi?: number;
      /** Planned sheet count, when it was computed before failure. */
      readonly sheetCount?: number;
      /** Whether source fallback can lose requested spread parity. */
      readonly paritySensitive?: boolean;
      /** Whether source fallback can lose changed layer visibility. */
      readonly layerWarning?: boolean;
      /** Resolved native-print capabilities, when they were available. */
      readonly nativeCapabilities?: Readonly<PdfjsViewerNativePrintCapabilities>;
    }
  | {
      /** Indicates that no native print plan is available. */
      readonly ok: false;
      /** Identifies the active rendering profile's sheet limit. */
      readonly reason: "too-many-sheets";
      /** Number of sheets required by the requested job. */
      readonly sheetCount: number;
      /** Maximum sheets allowed by the active rendering profile. */
      readonly maxSheets: number;
      /** Whether browser-source fallback is available for this route. */
      readonly sourceFallbackAvailable: boolean;
      /** Whether source fallback can lose requested spread parity. */
      readonly paritySensitive?: boolean;
      /** Whether source fallback can lose changed layer visibility. */
      readonly layerWarning?: boolean;
      /** Resolved native-print capabilities, when they were available. */
      readonly nativeCapabilities?: Readonly<PdfjsViewerNativePrintCapabilities>;
    };
/** Current controlled-print preparation and retained native-resource state. */
export interface PdfjsViewerPrintState {
  /** Current controlled-print lifecycle phase. */
  readonly phase: "idle" | "preflight" | "preparing" | "invoked";
  /** Active controlled-print job ID, or `null` while idle. */
  readonly jobId: number | null;
  /** Number of prepared sheets. */
  readonly completedSheets: number;
  /** Total sheets planned for the active job. */
  readonly totalSheets: number;
  /** Bytes retained by package-owned native-print resources. */
  readonly retainedBytes: number;
  /** Whether native invocation still retains package-owned resources. */
  readonly nativeResourcesRetained: boolean;
}
/** Detail emitted when adapter or controlled printing starts. */
export type PdfjsViewerPrintStartDetail = Readonly<
  | {
      /** Identifies a host-adapter print operation. */
      kind: "adapter";
    }
  | {
      /** Identifies a package-controlled native print operation. */
      kind: "controlled";
      /** Controlled-print job identity. */
      jobId: number;
      /** Planned output sheets. */
      sheetCount: number;
      /** Final on-sheet raster DPI. */
      dpi: number;
      /** Resolved native-print capability decision. */
      nativeCapabilities: Readonly<PdfjsViewerNativePrintCapabilities>;
    }
>;
/** Detail emitted as controlled-print sheet preparation advances. */
export interface PdfjsViewerPrintProgressDetail {
  /** Identifies a package-controlled native print operation. */
  readonly kind: "controlled";
  /** Controlled-print job identity. */
  readonly jobId: number;
  /** Sheets prepared so far. */
  readonly completedSheets: number;
  /** Total sheets planned for the job. */
  readonly totalSheets: number;
  /** Bytes retained by generated sheets. */
  readonly retainedBytes: number;
}
/** Detail emitted after controlled printing reaches native invocation. */
export interface PdfjsViewerPrintInvokedDetail {
  /** Identifies a package-controlled native print operation. */
  readonly kind: "controlled";
  /** Controlled-print job identity. */
  readonly jobId: number;
  /** Number of generated output sheets. */
  readonly sheetCount: number;
  /** Bytes retained during native invocation. */
  readonly retainedBytes: number;
}
/** Detail emitted after adapter or controlled-print cleanup. */
export type PdfjsViewerPrintCleanupDetail = Readonly<
  | {
      /** Identifies a host-adapter print operation. */
      kind: "adapter";
    }
  | {
      /** Identifies a package-controlled native print operation. */
      kind: "controlled";
      /** Controlled-print job identity. */
      jobId: number;
      /** Bytes retained immediately before cleanup. */
      retainedBytes: number;
    }
>;
/** Controlled-print lifecycle event union with event-specific detail. */
export type PdfjsViewerPrintEvent =
  | (CustomEvent<PdfjsViewerPrintStartDetail> & {
      /** Print-start event name. */
      readonly type: "pdf:printstart";
    })
  | (CustomEvent<Readonly<PdfjsViewerPrintProgressDetail>> & {
      /** Print-progress event name. */
      readonly type: "pdf:printprogress";
    })
  | (CustomEvent<Readonly<PdfjsViewerPrintInvokedDetail>> & {
      /** Native-print-invocation event name. */
      readonly type: "pdf:printinvoked";
    })
  | (CustomEvent<PdfjsViewerPrintCleanupDetail> & {
      /** Print-cleanup event name. */
      readonly type: "pdf:printcleanup";
    });
/** Complete validated print policy supplied to a host adapter. */
export interface PdfjsViewerNormalizedPrintOptions {
  /** Validated page selection. */
  readonly pages: PdfjsViewerPrintPages;
  /** Validated pages-per-sheet layout. */
  readonly layout: PdfjsViewerNormalizedPrintLayout;
  /** Validated final on-sheet raster DPI. */
  readonly quality: {
    /** Validated final on-sheet raster DPI. */
    readonly dpi: number;
  };
  /** Validated physical output sheet. */
  readonly sheet: PdfjsViewerPrintSheet;
  /** Validated page placement policy. */
  readonly pageScaling: PdfjsViewerPrintPageScaling;
  /** Validated requested output orientation. */
  readonly orientation: "auto" | "portrait" | "landscape";
  /** Optional signal that cancels preparation before native invocation. */
  readonly signal?: AbortSignal;
}
/** Adapter-owned successful completion. It does not imply native print completion. */
export interface PdfjsViewerPrintAdapterResult {
  /** Indicates that the host adapter completed its invocation. */
  readonly status: "adapter-completed";
  /** Output sheet count reported by the host adapter, when known. */
  readonly sheetCount?: number;
}
/** Honest result from the configured native, browser-source, or adapter print route. */
export type PdfjsViewerPrintResult =
  | {
      /** Indicates successful print invocation. */
      ok: true;
      /** Identifies package-controlled native print invocation. */
      status: "print-invoked";
      /** Number of generated sheets passed to native printing. */
      sheetCount: number;
    }
  | ({
      /** Indicates successful adapter completion. */
      ok: true;
    } & PdfjsViewerPrintAdapterResult)
  | PdfjsViewerPrintSourceResult
  | {
      /** Indicates that printing was not invoked. */
      ok: false;
      /** Identifies a structural print workload limit. */
      reason: "too-large";
      /** Estimated sheets required by the rejected job. */
      estimatedSheetCount: number;
      /** Whether browser-source fallback is available. */
      sourceFallbackAvailable: boolean;
    }
  | {
      /** Indicates that printing was not invoked. */
      ok: false;
      /** Identifies the active rendering profile's memory limit. */
      reason: "memory-limit";
      /** Estimated sheets required by the rejected job. */
      estimatedSheetCount: number;
      /** Whether browser-source fallback is available. */
      sourceFallbackAvailable: boolean;
    }
  | {
      /** Indicates that printing was not invoked. */
      ok: false;
      /** Identifies the active rendering profile's sheet limit. */
      reason: "too-many-sheets";
      /** Number of sheets required by the rejected job. */
      sheetCount: number;
      /** Maximum sheets allowed by the active profile. */
      maxSheets: number;
      /** Whether browser-source fallback is available. */
      sourceFallbackAvailable: boolean;
    }
  | {
      /** Indicates that printing was not invoked. */
      ok: false;
      /** Expected reason the configured print route was unavailable or cancelled. */
      reason: "not-ready" | "disabled" | "cancelled" | "unsupported";
    };
/** Explicit source-document choice for browser PDF-handler fallback. */
export interface PdfjsViewerPrintSourceOptions {
  /** Source representation to open, or automatic selection from form state. */
  document?: "auto" | PdfjsViewerDocumentVariant;
  /** Whether to navigate directly to a URL or materialize PDF bytes. */
  navigation?: "auto" | "direct" | "materialize";
  /** Print intent used only to report semantics lost by source fallback. */
  print?: PdfjsViewerPrintOptions;
}
/** Semantics that browser-source printing cannot preserve. */
export type PdfjsViewerPrintSourceWarning =
  "custom-range-lost" | "layer-state-lost" | "spread-parity-lost";
/** Result returned when explicitly opening a browser PDF-handler source. */
export type PdfjsViewerPrintSourceResult =
  | {
      /** Indicates that a browser PDF source was opened successfully. */
      ok: true;
      /** Identifies successful browser-source opening. */
      status: "source-opened";
      /** Semantics not preserved by the opened source. */
      warnings: readonly PdfjsViewerPrintSourceWarning[];
    }
  | {
      /** Indicates that a browser PDF source was not opened. */
      ok: false;
      /** Expected reason browser-source opening did not complete. */
      reason: "not-ready" | "disabled" | "cancelled" | "unsupported" | "popup-blocked";
    }
  | {
      /** Indicates that a browser PDF source was not opened. */
      ok: false;
      /** Identifies document export or source-resolution failure. */
      reason: "export-failed";
      /** Error encountered while resolving or exporting the source. */
      error: unknown;
    };
/** Context supplied to a host-owned print implementation. */
export interface PdfjsViewerPrintContext {
  /** Viewer requesting the print operation. */
  viewer: PdfjsViewer;
  /** URL-backed source when available; in-memory documents expose `null`. */
  sourceUrl: string | null;
  /** Suggested source filename supplied by a descriptor, or `null`. */
  sourceFilename: string | null;
  /** Complete validated options for this adapter-owned operation. */
  options: PdfjsViewerNormalizedPrintOptions;
  /** Whether current interactive form values differ from the loaded document. */
  formDirty: boolean;
  /** Returns detached original or current-form-value document bytes on demand. */
  getDocumentData(options: { document: PdfjsViewerDocumentVariant }): Promise<Uint8Array>;
  /** Viewer host element for application-specific UI or state lookup. */
  rootEl: HTMLElement;
}
/**
 * Host-owned print operation returning its own validated completion result.
 */
export type PdfjsViewerPrintAdapter = (
  context: PdfjsViewerPrintContext,
) => PdfjsViewerPrintAdapterResult | Promise<PdfjsViewerPrintAdapterResult>;

/** Active-document context supplied to a browser-source resolver. */
export interface PdfjsViewerPrintSourceResolutionContext {
  /** Current URL-backed PDF source. */
  readonly sourceUrl: string;
  /** Whether current document loading used credentials or HTTP headers. */
  readonly authenticated: boolean;
  /** Requested source representation. */
  readonly document: PdfjsViewerDocumentVariant;
}
/** Resolves a host-authorized URL or bytes for browser-source printing. */
export type PdfjsViewerPrintSourceResolver = (
  context: PdfjsViewerPrintSourceResolutionContext,
) => string | Uint8Array | ArrayBuffer | null | Promise<string | Uint8Array | ArrayBuffer | null>;

/** Total viewport heights to buffer beyond the visible range, or `"unlimited"` for no distance ceiling. */
export type PdfjsViewerRenderBufferViewportHeights = number | "unlimited";
/** Maximum optional pages in the desired render window, or `"unlimited"` for no count ceiling. */
export type PdfjsViewerRenderBufferPages = number | "unlimited";

/** Profile choices and the automatic choice for one device category. */
export interface PdfjsViewerRenderingProfilePolicyCategory {
  /** Profiles exposed by generated and custom rendering-profile controls. */
  availableProfiles: readonly PdfjsViewerRenderingProfile[];
  /** Profile selected when `renderingProfile` is `"auto"`. */
  defaultProfile: PdfjsViewerRenderingProfile;
}

/** Rendering-profile availability and defaults by viewer device classification. */
export interface PdfjsViewerRenderingProfilePolicy {
  /** Available profiles and automatic default for likely-mobile viewers. */
  likelyMobile: PdfjsViewerRenderingProfilePolicyCategory;
  /** Available profiles and automatic default for all other viewers. */
  other: PdfjsViewerRenderingProfilePolicyCategory;
}

/**
 * Tunable resource, quality, and retention limits for one rendering profile.
 *
 * The document renderer builds each render plan deterministically in this order:
 *
 * 1. Collect every page in the visible row range plus pages still required for
 *    initial readiness. These pages are mandatory.
 * 2. Resolve `min(devicePixelRatio, maxRenderDpr)` into exact integer backing-store
 *    dimensions for each mandatory page. Fractional unconstrained dimensions round
 *    upward to cover the complete CSS page; dimensions constrained by
 *    `maxCanvasPixels` or `maxCanvasDimension` lower one uniform render DPR and
 *    round downward. That scalar DPR is the render and reuse identity; integer
 *    coverage ratios do not become quality targets. Canvas safety may override
 *    `minRenderDpr`.
 * 3. Estimate mandatory settled canvas backing stores at four bytes per raster pixel.
 *    If that exceeds `memoryLimitMiB` and `allowDprReduction` is enabled, assign
 *    one common proportionally fitted DPR to all mandatory pages, clamped to
 *    `minRenderDpr`. If mandatory pages still exceed the limit, keep them and
 *    report the unavoidable overage instead of omitting required output.
 * 4. Estimate render peak as settled backing stores plus the largest temporary
 *    offscreen buffers allowed by concurrency. Reduce effective concurrency from
 *    `maxConcurrentRenders` toward one until the mandatory peak fits or concurrency
 *    reaches one.
 * 5. If the visible peak still exceeds the limit and `allowVisibleDirectRendering` is
 *    enabled, select visible pages largest-first for direct-to-visible rendering
 *    until the peak fits or every visible page is direct. Direct rendering is
 *    therefore considered only after concurrency has reached one.
 * 6. Select complete optional rows intersecting one total
 *    `maxBufferViewportHeights` distance budget. Stationary views split it evenly;
 *    active motion assigns about two thirds to the leading side. Distance unavailable
 *    at a document edge moves to the other side. Admit a complete row only when all
 *    its optional pages fit within `maxBufferPages`; never split a spread to consume
 *    the remaining page allowance. Each admitted row must also leave space
 *    below the hysteresis-adjusted limit for its settled backing stores and at least
 *    one largest temporary replacement buffer required by that row. A first render
 *    writes directly to its already attached offscreen canvas and needs no temporary
 *    buffer; replacing existing output keeps the old backing store until commit and
 *    therefore reserves the complete temporary raster alongside it.
 * 7. Only the first optional row that does not fit at the requested DPR may use
 *    proportional DPR reduction, when allowed, no lower than `minRenderDpr`.
 *    Reject an optional row that still does not fit; do not direct-render it.
 * 8. Retain already-rendered pages outside the admitted row window nearest-first
 *    while the same peak constraint permits them. Retention never schedules new
 *    rendering. Non-retained attached canvases are evicted before the new queue
 *    can allocate output, so disposable old pages never force lower new-render quality.
 * 9. When an optionally rendered page becomes visible, rerender it whenever its
 *    committed DPR is lower than the exact DPR required by the visible plan.
 *    Visible quality upgrades are queued before optional work.
 * 10. Build the render queue visible-first. While scrolling, visible pages and
 *     optional work are ordered toward the leading edge of motion; while stationary,
 *     they are ordered center-out. A newly visible page may preempt speculative work,
 *     but active visible rendering is never preempted.
 *
 * The memory limit covers attached canvas backing stores, active temporary
 * offscreen canvases, and admitted render reservations. Per-canvas limits are
 * independent browser-safety constraints. PDF.js caches, decoded document
 * resources, and browser/GPU overhead are outside the observable limit.
 * Optional buffering must satisfy every distance, page-count, canvas, and
 * viewer-managed memory constraint; increasing one limit never bypasses another.
 * Mandatory visible and initial-readiness pages are the sole memory-limit
 * exception: when they cannot fit even after permitted DPR and concurrency
 * reductions, the viewer preserves required output rather than deliberately
 * leaving the viewport blank or reporting false initial readiness.
 */
export interface PdfjsViewerRenderingProfileSettings {
  /** Viewer-managed raster-memory limit in MiB; finite values are clamped to 5–8192. */
  memoryLimitMiB: number;
  /** Separate demand-driven thumbnail bitmap cap in MiB; finite values are clamped to 1–1024. */
  thumbnailMemoryLimitMiB: number;
  /** Maximum pixel area of one canvas backing store. Safety limit may override `minRenderDpr`. */
  maxCanvasPixels: number;
  /** Maximum width or height of one canvas backing store. Safety limit may override `minRenderDpr`. */
  maxCanvasDimension: number;
  /** Maximum simultaneous page renders when the memory plan permits them. */
  maxConcurrentRenders: number;
  /** Target total viewport-height distance outside the visible range; whole boundary rows may extend it. */
  maxBufferViewportHeights: PdfjsViewerRenderBufferViewportHeights;
  /** Maximum optional desired pages inside that distance window; complete rows remain atomic. */
  maxBufferPages: PdfjsViewerRenderBufferPages;
  /** Maximum total buffered viewport heights while effective rendering activity is inactive. */
  bufferViewportHeightsWhenInactive: number;
  /** Preferred upper render DPR. */
  maxRenderDpr: number;
  /** Lowest DPR used under pressure before mandatory visible pages may exceed the limit. */
  minRenderDpr: number;
  /** Permit the planner to lower render DPR as far as `minRenderDpr`. */
  allowDprReduction: boolean;
  /** Permit the planner to render visible pages directly when peak headroom is insufficient. */
  allowVisibleDirectRendering: boolean;
  /** Fraction of the limit kept free when growing the buffer, to avoid churn. */
  memoryHysteresis: number;
  /** Complete controlled-print workload policy. Raster and canvas limits are shared from this profile's top level. */
  print: PdfjsViewerPrintLimits;
}

/** Thumbnail raster policy. Presentation width remains CSS-owned. */
export interface PdfjsViewerThumbnailsOptions {
  /** Maximum thumbnail backing-store DPR. Defaults to 2. */
  maxDpr?: number;
}

/** Partial per-profile overrides merged over the package's recommended defaults. */
/** Sparse profile overrides. `print` is independently sparse and deep-merged. */
export type PdfjsViewerRenderingProfiles = Partial<
  Record<
    PdfjsViewerRenderingProfile,
    Partial<Omit<PdfjsViewerRenderingProfileSettings, "print">> & {
      print?: Partial<PdfjsViewerPrintLimits>;
    }
  >
>;

/** Complete construction options for {@link PdfjsViewer}. */
export interface PdfjsViewerOptions {
  /** Host element containing custom markup or receiving generated viewer UI. */
  rootEl: HTMLElement;
  /** UI mode. Omitted mode generates the package default UI. */
  ui?: PdfjsViewerUiMode | PdfjsViewerUiOptions;
  /** Direct custom-UI elements that take precedence over selector discovery. */
  uiBindings?: PdfjsViewerUiBindings;
  /** Typed non-visual interaction and rendering behavior. */
  behavior?: PdfjsViewerBehaviorOptions;
  /** Demand-driven thumbnail raster policy. */
  thumbnails?: PdfjsViewerThumbnailsOptions;
  /** Explicit ownership context for workers and global keyboard routing. */
  runtime: PdfjsViewerRuntime;
  /** Optional structured viewer diagnostic sink. No logging occurs by default. */
  logger?: PdfjsViewerLogger;
  /** Initial page grouping. Defaults to `"auto"`. */
  pageLayout?: PdfjsViewerPageLayout;
  /** Initial fitting strategy. Defaults to `"auto"`. */
  fitMode?: PdfjsViewerFitModeSelection;
  /** Viewer-added rotation restored for each document. Defaults to `0`. */
  initialRotation?: PdfjsViewerRotation;
  /** Initial rendering profile; `"auto"` selects the configured device-policy default. */
  renderingProfile?: PdfjsViewerRenderingProfileSelection;
  /** Optional partial overrides for the built-in rendering profiles. */
  renderingProfiles?: PdfjsViewerRenderingProfiles;
  /** Device-specific profile availability and `"auto"` defaults. */
  renderingProfilePolicy?: Partial<PdfjsViewerRenderingProfilePolicy>;
  /** Host compatibility refinements merged over the package device baseline. */
  deviceCompatibility?: readonly PdfjsViewerDeviceCompatibilityRule[];
  /** Defaults to viewer-scoped keyboard handling. Use false to disable it. */
  keyboard?: false | PdfjsViewerKeyboardOptions;
  /** Optional document capabilities; all default to enabled. */
  features?: PdfjsViewerFeatureOptions;
  /** Accessible labeling, focus, and reduced-motion behavior. */
  accessibility?: PdfjsViewerAccessibilityOptions;
  /** PDF.js document options copied as defaults for every explicit {@link PdfjsViewer.load}. */
  defaultDocumentOptions?: PdfjsViewerDocumentOptions;
  /** Stable identity used by global keyboard and navigation-state ownership. */
  viewerId?: string;

  /** Host-provided destination persistence and active-viewer routing. */
  navigationState?: PdfjsViewerNavigationStateAdapter;
  /** Host print implementation required exclusively by `features.print` mode `adapter`. */
  printAdapter?: PdfjsViewerPrintAdapter;
  /** Resolves authenticated or application-specific browser-PDF fallback sources. */
  printSourceResolver?: PdfjsViewerPrintSourceResolver;
  /**
   * Optional PDF named destination prefix used for shareable anchors.
   * Example: "songid:".
   */
  shareableNamedDestinationPrefix?: string;
}
