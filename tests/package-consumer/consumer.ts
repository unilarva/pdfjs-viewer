// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import {
  createPdfjsViewerUi,
  formatPdfDate,
  renderPdfjsViewerUi,
  parsePrintPageRanges,
  resolveNativePrintCapabilities,
  PDFJS_VIEWER_STATE_CLASSES,
  PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS,
  PDFJS_VIEWER_UI_HOOKS,
  PDFJS_VIEWER_PRINT_DEFAULTS,
  PdfjsViewer,
  PdfjsViewerRuntime,
  type PdfjsViewerUiRenderOptions,
  type PdfjsViewerAttachment,
  type PdfjsViewerAttachmentDownloadResult,
  type PdfjsViewerAttachmentsCompleteEvent,
  type PdfjsViewerAttachmentsResult,
  type PdfjsViewerOutlineCompleteEvent,
  type PdfjsViewerOutlineQueryOptions,
  type PdfjsViewerOutlineResult,
  type PdfjsViewerOptions,
  type PdfjsViewerPdfjsModule,
  type PdfjsViewerPdfjsVersionPolicy,
  type PdfjsViewerErrorEvent,
  type PdfjsViewerPageChangeEvent,
  type PdfjsViewerPrintAdapter,
  type PdfjsViewerPrintOptions,
  type PdfjsViewerPrintResult,
  type PdfjsViewerPrintFeatureOptions,
  type PdfjsViewerPrintDefaults,
  type PdfjsViewerPrintPageScaling,
  type PdfjsViewerPrintMode,
  type PdfjsViewerPrintPreflightResult,
  type PdfjsViewerFormatters,
  type PdfjsViewerLabels,
  type PdfjsViewerPrintState,
  type PdfjsViewerPrintEvent,
  type PdfjsViewerPrintSourceOptions,
  type PdfjsViewerPrintSourceResult,
  type PdfjsViewerSearchIndexCompleteEvent,
  type PdfjsViewerSearchResult,
  type PdfjsViewerSearchMatch,
  type PdfjsViewerQueryFailure,
  type PdfjsViewerQueryFailureReason,
  type PdfjsViewerReadyEvent,
  type PdfjsViewerSource,
  type PdfjsViewerState,
  type PdfjsViewerStateChangeEvent,
  type PdfjsViewerTextQueryOptions,
  type PdfjsViewerTextSelectionPersistence,
  type PdfjsViewerUiBindings,
  type PdfjsViewerUiTextOptions,
  type PdfjsViewerFitModeSelection,
  type PdfjsViewerRotation,
  type PdfjsViewerRenderBufferPages,
  type PdfjsViewerRenderBufferViewportHeights,
  type PdfjsViewerThumbnailsOptions,
  type PdfjsViewerSidebarView,
  type PdfjsViewerLayersResult,
  type PdfjsViewerLayerMutationResult,
  type PdfjsViewerLoadCancellationCause,
  type PdfjsViewerLoadOptions,
  type PdfjsViewerLoadResult,
  type PdfjsViewerOperatingSystem,
  type PdfjsViewerDeviceEnvironment,
  type PdfjsViewerDeviceCompatibilityRule,
  type PdfjsViewerNativePrintCapabilities,
} from "@unilarva/pdfjs-viewer";
import * as pdfjs from "pdfjs-dist";

const pdfjsModule: PdfjsViewerPdfjsModule = pdfjs;
const nativePrintEnvironment: PdfjsViewerDeviceEnvironment = { userAgent: "package-consumer" };
const nativePrintCapabilities: PdfjsViewerNativePrintCapabilities =
  resolveNativePrintCapabilities(nativePrintEnvironment);
void nativePrintCapabilities;

const printAdapter: PdfjsViewerPrintAdapter = async context => {
  void context.sourceUrl;
  void context.sourceFilename;
  void context.formDirty;
  void (await context.getDocumentData({ document: "with-form-values" })).byteLength;
  void context.options.layout;
  void context.options.pageScaling;
  return { status: "adapter-completed", sheetCount: 3 };
};
const compatibility = {
  engine: "chromium",
  platform: "desktop",
  operatingSystem: "linux" as PdfjsViewerOperatingSystem,
  nativePrintSupport: "portrait-and-landscape",
  evidenceId: "host-audit-2026-08",
} satisfies PdfjsViewerDeviceCompatibilityRule;
const pageScaling = "shrink-to-fit" satisfies PdfjsViewerPrintPageScaling;
const printDefaults = {
  sheet: "letter",
  pageScaling,
  quality: { dpi: 600 },
} satisfies PdfjsViewerPrintDefaults;
const printFeature = {
  mode: "native",
  browserFallback: false,
  defaults: printDefaults,
} satisfies PdfjsViewerPrintFeatureOptions;
const printMode = "native" satisfies PdfjsViewerPrintMode;
const deviceCompatibility = [compatibility] satisfies readonly PdfjsViewerDeviceCompatibilityRule[];
void printFeature;
void printMode;
void deviceCompatibility;
void PDFJS_VIEWER_PRINT_DEFAULTS;
const printSheetPresets = [
  "a3",
  "a4",
  "a5",
  "letter",
  "legal",
] satisfies readonly PdfjsViewerPrintOptions["sheet"][];
void printSheetPresets;
const printSetupLabels = {
  printPageScalingHelp: "Smaller pages may be enlarged or kept at actual size.",
  printRangeInvalid: "Enter pages from 1 to {pageCount}.",
  printSheetWidth: "Width",
  printSheetHeight: "Height",
  printSheetUnit: "Unit",
  printResolutionHelp: "Final output-sheet resolution.",
  printSheetHelp: "Selected paper size.",
} satisfies Pick<
  PdfjsViewerLabels,
  | "printPageScalingHelp"
  | "printRangeInvalid"
  | "printSheetWidth"
  | "printSheetHeight"
  | "printSheetUnit"
  | "printResolutionHelp"
  | "printSheetHelp"
>;
void printSetupLabels;
const printSetupFormatters = {
  printSheetLimitExceeded: (sheetCount, maxSheets) => `${sheetCount}/${maxSheets}`,
  printReducedQuality: dpi => `Reduced to ${dpi} DPI`,
  printReducedExplanation: dpi => `Quality reduced to ${dpi} DPI.`,
} satisfies Pick<
  PdfjsViewerFormatters,
  "printSheetLimitExceeded" | "printReducedQuality" | "printReducedExplanation"
>;
void printSetupFormatters;
void parsePrintPageRanges("1-2", 2);
void formatPdfDate("D:20260809043855+03'00'");

const generatedUiOptions = {
  id: "consumer-viewer",
  labels: {
    print: "Print document",
    textSelection: "Select text",
    rotateCounterclockwise: "Turn counterclockwise",
    outlineUntitled: "(Untitled chapter)",
  },
  formatters: { searchResultPosition: (current, total) => `${current} of ${total}` },
  direction: "ltr",
  controls: {
    print: true,
    renderingProfile: false,
    textSelection: true,
    navigationHistory: true,
    fitMode: true,
    rotation: true,
    thumbnails: true,
    attachments: true,
    layers: true,
  },
  sidebar: { primaryViews: ["outline", "thumbnails"] },
} satisfies PdfjsViewerUiRenderOptions;

const viewerOptions = {
  rootEl: document.createElement("section"),
  runtime: new PdfjsViewerRuntime({ pdfjs: pdfjsModule, workerSrc: "/pdf.worker.min.mjs" }),
  defaultDocumentOptions: { withCredentials: true },
  features: {
    navigationHistory: true,
    textSelection: true,
    search: { prepareOnLoad: true },
    outline: { filter: false, prepareOnLoad: true },
    thumbnails: true,
    attachments: true,
    annotationLinks: { externalUrls: false },
    annotationMarkup: { popups: true, fileAttachments: true },
    forms: { interactive: true, xfa: true },
    layers: true,
    print: "adapter",
  },
  behavior: {
    textSelectionPersistence: "until-copy" as PdfjsViewerTextSelectionPersistence,
    reduceRenderingWhenDocumentHidden: false,
    zoomGestures: false,
    searchQueryOptions: { diacritics: "respect" },
    outlineFilterOptions: { caseSensitive: true },
    autoFitWidthMaxHeight: 400,
    initialSidebarView: "auto",
  },
  fitMode: "auto" as PdfjsViewerFitModeSelection,
  initialRotation: 90 as PdfjsViewerRotation,
  shareableNamedDestinationPrefix: "section:",
  navigationState: {
    readNavigationDestinationId: () => null,
    writeNavigationDestinationId: () => {},
  },
  ui: { mode: "default", ...generatedUiOptions },
  printAdapter,
  thumbnails: { maxDpr: 2 } satisfies PdfjsViewerThumbnailsOptions,
  renderingProfiles: {
    balanced: {
      maxBufferViewportHeights: 2.5 as PdfjsViewerRenderBufferViewportHeights,
      maxBufferPages: 40 as PdfjsViewerRenderBufferPages,
      memoryLimitMiB: 640,
      print: { maxSheets: 20 },
    },
  },
} satisfies PdfjsViewerOptions;
const typedViewer = new PdfjsViewer(viewerOptions);
const runtimeUiText = {
  labels: { attachmentDownload: "Save attachment", outlineUntitled: "(Untitled section)" },
  formatters: { zoom: scale => `${Math.round(scale * 100)} percent` },
} satisfies PdfjsViewerUiTextOptions;
typedViewer.setUiText(runtimeUiText);
const stateSnapshot: PdfjsViewerState = typedViewer.state;
void stateSnapshot.canGoBack;
void stateSnapshot.canGoForward;
void stateSnapshot;
if (false) {
  // @ts-expect-error Public state snapshots are compile-time readonly.
  typedViewer.state.status = "ready";
}
const loadOptions = {
  initialPage: 2,
  documentOptions: { httpHeaders: { Authorization: "Bearer test" } },
} satisfies PdfjsViewerLoadOptions;
const loadPromise: Promise<PdfjsViewerLoadResult> = typedViewer.load("/document.pdf", loadOptions);
void loadPromise.then(result => {
  if (!result.ok && result.reason === "error") console.error(result.error);
  if (!result.ok && result.reason === "cancelled") {
    const cause: PdfjsViewerLoadCancellationCause = result.cause;
    void cause;
  }
});
const sidebarView: PdfjsViewerSidebarView = "attachments";
void sidebarView;

const lifecycleListener = (
  event:
    | PdfjsViewerReadyEvent
    | PdfjsViewerErrorEvent
    | PdfjsViewerPageChangeEvent
    | PdfjsViewerStateChangeEvent,
): void => {
  if (event.type === "pdf:ready") void event.detail;
  else if (event.type === "pdf:error") void event.detail.error;
  else if (event.type === "pdf:pagechange") void event.detail.page;
  else {
    const state: PdfjsViewerState = event.detail;
    void state.status;
  }
};
void lifecycleListener;

const deferredViewerOptions = {
  rootEl: document.createElement("section"),
  runtime: viewerOptions.runtime,
} satisfies PdfjsViewerOptions;
void deferredViewerOptions;

const describedSources = [
  { type: "url", url: "/document.pdf", filename: "document.pdf" },
  { type: "data", data: new Uint8Array([37, 80, 68, 70]), filename: "memory.pdf" },
] satisfies readonly PdfjsViewerSource[];
void describedSources;

const textSelectionToggle = document.createElement("button");
const fitModeGroup = document.createElement("div");
const rotateCounterclockwise = document.createElement("button");
const resetRotation = document.createElement("button");
const rotateClockwise = document.createElement("button");
const historyBack = document.createElement("button");
const historyForward = document.createElement("button");
const attachmentsContent = document.createElement("div");
const layersContent = document.createElement("div");
const printSetupBindings = {
  dialog: document.createElement("dialog"),
  form: document.createElement("form"),
  pages: document.createElement("select"),
  range: document.createElement("input"),
  rangeWrap: document.createElement("div"),
  layout: document.createElement("select"),
  side: document.createElement("div"),
  sideSelect: document.createElement("select"),
  more: document.createElement("details"),
  sheet: document.createElement("select"),
  customSheet: document.createElement("div"),
  customSheetWidth: document.createElement("input"),
  customSheetHeight: document.createElement("input"),
  customSheetUnit: document.createElement("select"),
  orientation: document.createElement("select"),
  quality: document.createElement("select"),
  status: document.createElement("p"),
  progress: document.createElement("progress"),
  guidance: document.createElement("p"),
  fallbackWarning: document.createElement("p"),
  close: document.createElement("button"),
  cancel: document.createElement("button"),
  source: document.createElement("button"),
  submit: document.createElement("button"),
  submitDetail: document.createElement("small"),
} satisfies NonNullable<PdfjsViewerUiBindings["printSetup"]>;
void printSetupBindings;
const bindingOptions = {
  ...viewerOptions,
  uiBindings: {
    navigationHistory: { back: historyBack, forward: historyForward },
    menu: {
      textSelectionToggle,
      fitMode: fitModeGroup,
      rotateCounterclockwise,
      resetRotation,
      rotateClockwise,
    },
    attachments: { content: attachmentsContent },
    layers: { content: layersContent },
  },
} satisfies PdfjsViewerOptions;

function exerciseTextSelection(viewer: PdfjsViewer): void {
  viewer.setTextSelectionMode(true);
  viewer.navigateToPage(2);
  void viewer.goBack();
  void viewer.goForward();
  viewer.previousRow(false);
  void viewer.state.textSelectionMode;
  void viewer.state.active;
  void viewer.state.canDownload;
  void viewer.state.canPrint;
  void viewer.state.sourceFilename;
  void viewer.state.searchPreparation;
  void viewer.state.outlinePreparation;
  void viewer.state.attachmentsPreparation;
  void viewer.state.formDirty;
  void viewer.state.fitMode;
  void viewer.state.effectiveFitMode;
  void viewer.state.fitActive;
  void viewer.state.rotation;
  void viewer.setPageLayout("book");
  void viewer.setFitMode("width");
  void viewer.fit();
  void viewer.rotateTo(180);
  void viewer.rotateBy(-90);
  void viewer.resetRotation();
  void viewer.getDocumentData({ document: "original" });
  void viewer.download();
  void viewer.download({ document: "with-form-values", filename: "filled.pdf" });
  void viewer.downloadAttachment("attachment-id");
  const layers: PdfjsViewerLayersResult = viewer.getLayers();
  const layerMutation: Promise<PdfjsViewerLayerMutationResult> = viewer.setLayerVisibility([
    { id: "layer-id", visible: false },
  ]);
  void layers;
  void layerMutation;
  void viewer.resetLayers();
  const printOptions = {
    pages: [{ from: 1, to: 3 }],
    layout: { mode: "spread", firstPageSide: "right", gapPt: 6 },
    quality: { dpi: 300 },
    sheet: "a4",
    orientation: "landscape",
  } satisfies PdfjsViewerPrintOptions;
  const printResult: Promise<PdfjsViewerPrintResult> = viewer.print(printOptions);
  const printPreflight: Promise<PdfjsViewerPrintPreflightResult> =
    viewer.preflightPrint(printOptions);
  const printSourceOptions = { document: "auto" } satisfies PdfjsViewerPrintSourceOptions;
  const printSource: Promise<PdfjsViewerPrintSourceResult> =
    viewer.openPrintSource(printSourceOptions);
  const printState: PdfjsViewerPrintState = viewer.state.print;
  void printResult;
  void printPreflight;
  void printSource;
  void printState;
}

const printListener = (event: PdfjsViewerPrintEvent): void => {
  if (event.type === "pdf:printprogress") {
    const controlled: "controlled" = event.detail.kind;
    void controlled;
    void event.detail.completedSheets;
  } else if (event.type === "pdf:printstart" && event.detail.kind === "adapter") {
    const adapter: "adapter" = event.detail.kind;
    void adapter;
  }
};
void printListener;

const preparationListeners = {
  search(event: PdfjsViewerSearchIndexCompleteEvent) {
    return event.detail.status === "ready" ? event.detail.indexedPages : event.detail.error;
  },
  outline(event: PdfjsViewerOutlineCompleteEvent) {
    return event.detail.status === "ready" ? event.detail.itemCount : event.detail.error;
  },
  attachments(event: PdfjsViewerAttachmentsCompleteEvent) {
    return event.detail.status === "ready" ? event.detail.itemCount : event.detail.error;
  },
};

async function queryDocument(viewer: PdfjsViewer): Promise<{
  search: PdfjsViewerSearchResult;
  outline: PdfjsViewerOutlineResult;
  attachments: PdfjsViewerAttachmentsResult;
}> {
  const textMatching = {
    caseSensitive: false,
  } satisfies PdfjsViewerTextQueryOptions;
  const outlineQuery = {
    query: "Chapter",
  } satisfies PdfjsViewerOutlineQueryOptions;
  const [search, outline, attachments] = await Promise.all([
    viewer.search("document", textMatching),
    viewer.getOutline(outlineQuery),
    viewer.getAttachments(),
  ]);
  if (outline.ok) {
    void outline.items[0]?.destination?.pdfNamedDestination;
    void outline.items[0]?.destination?.navigationDestinationId;
  }
  if (search.ok) {
    const match: PdfjsViewerSearchMatch | undefined = search.matches[0];
    void match?.segments[0]?.characterIndex;
  }
  if (!search.ok) {
    const failure: PdfjsViewerQueryFailure = search;
    const reason: PdfjsViewerQueryFailureReason = failure.reason;
    if (failure.reason === "error") void failure.error;
    void reason;
  }
  if (attachments.ok) {
    const attachment: PdfjsViewerAttachment | undefined = attachments.attachments[0];
    if (attachment) {
      const download: PdfjsViewerAttachmentDownloadResult = await viewer.downloadAttachment(
        attachment.id,
      );
      void download.ok;
      void attachment.filename;
      void attachment.description;
    }
  }
  return { search, outline, attachments };
}

void [
  createPdfjsViewerUi,
  renderPdfjsViewerUi,
  PDFJS_VIEWER_STATE_CLASSES,
  PDFJS_VIEWER_UI_HOOKS,
  PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS,
  PdfjsViewer,
  PdfjsViewerRuntime,
  generatedUiOptions,
  viewerOptions,
  preparationListeners,
  queryDocument,
  bindingOptions,
  exerciseTextSelection,
];

const pdfjsVersionPolicy: PdfjsViewerPdfjsVersionPolicy = "qualified-only";
void pdfjsVersionPolicy;
