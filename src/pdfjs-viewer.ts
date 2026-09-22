// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public `PdfjsViewer` implementation facade.
 *
 * Package consumers use {@link PdfjsViewer} through the package root to wrap the
 * PDF.js display API with reusable document lifecycle, responsive rendering,
 * optional generated UI, search, outlines, thumbnails, annotation links, accessibility, and
 * framework-independent browser events. Public options, state, events, and result
 * shapes are owned by `viewer-contracts.ts` and re-exported from the package root.
 *
 * For maintainers, this module is the intentional public facade and cross-owner
 * coordinator. It retains lifecycle ordering, public feature UI, gesture input
 * sequencing, semantic panel effects, progress/events, and search presentation.
 * `ViewerPanels` owns sidebar/popover interaction, while
 * `DocumentOutlinePresentation` and `DocumentThumbnails` own their respective views.
 * `DocumentPresentation` owns annotation-derived page DOM and interaction,
 * `DocumentView` owns canonical surface DOM and render demand,
 * `DocumentTextPresentation` owns selectable text DOM, and `DocumentPageUsage`
 * owns shared PDF.js page cleanup, and `RasterWorkCoordinator` arbitrates foreground and
 * background raster priority; other private owners encapsulate rendering,
 * search, and navigation state.
 *
 * {@link LifecycleScope} instances define viewer and document lifetime. Viewer
 * lifetime owns constructor-created UI, permanent listeners/observers,
 * and runtime registration. Document lifetime owns loading/preparation, layout,
 * gestures, and document-relative scheduled work. Render-document and operation
 * lifetimes are nested within it and owned by {@link DocumentRenderer}; request
 * generation separately
 * preserves latest-wins `load()` behavior. Replacement synchronously invalidates
 * document work and operations before detaching state/DOM, starts old proxy
 * cleanup without blocking the successor, then creates a fresh document scope.
 * Permanent container/control listeners survive replacement, but all immediate
 * document interactions are gated on an active, ready document scope. The
 * [architecture guide](../ARCHITECTURE.md) is authoritative for ownership,
 * lifecycle ordering, dependency direction, and extraction stopping rules.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module pdfjs-viewer
 */

import type * as PDFJS from "pdfjs-dist";
import { createPdfjsViewerUi, refreshGeneratedUiText } from "./default-ui.js";
import { normalizeUiTextOptions } from "./generated-ui-options.js";
import {
  normalizePdfSource,
  pdfjsDocumentLoadOptions,
  normalizePrintOptions,
  normalizeTextQueryOptions,
  normalizeViewerOptions,
  validateDocumentOptions,
  type NormalizedPdfSource,
  type NormalizedViewerBehavior,
  type NormalizedViewerFeatures,
  type NormalizedViewerUi,
} from "./viewer-options.js";
import {
  validatePdfjsDocumentCapabilities,
  validatePdfjsDisplayCapabilities,
} from "./pdfjs-compatibility.js";
import { discoverViewerUi } from "./viewer-ui-discovery.js";
import { ViewerPanels } from "./viewer-panels.js";
import {
  ViewerFullscreen,
  type ViewerFullscreenFailureResult,
  type ViewerFullscreenResult,
} from "./viewer-fullscreen.js";
import { PresentationInputController } from "./presentation-input.js";
import { BoundaryControlPress } from "./boundary-control-press.js";
import { ViewerPrintSetup } from "./viewer-print-setup.js";
import { ViewerDocumentInformation } from "./viewer-document-information.js";
import { RasterWorkCoordinator } from "./raster-work-coordinator.js";
import { DocumentPrint } from "./document-print.js";
import { retainPrintSourceUrl, nativePrintCoordinatorFor } from "./native-print-coordinator.js";
import {
  countPrintPages,
  countPrintSheets,
  planPrintDpiFit,
  resolvePrintTransportGeometry,
  resolvePrintLayout,
  resolvePrintSheetSize,
  selectedPrintRuns,
  resolvePermissionAwarePrintDpi,
  type PrintPageSize,
  type PrintBudgetLimits,
  type ResolvedPrintLayout,
} from "./print-sheet-planner.js";
import {
  nativePrintCapabilitiesFor,
  type PdfjsViewerNativePrintCapabilities,
} from "./native-print-capabilities.js";
import type {
  PdfjsViewerDeviceCompatibilityRule,
  PdfjsViewerNativePrintSupport,
} from "./device-compatibility.js";
import { resolveViewerPrintRoute, type ViewerPrintRouteDecision } from "./print-route.js";
import { resolveDocumentPrintPermission, resolvePdfjsPrintPermission } from "./print-permission.js";
import {
  interpretCatalogPageLayout,
  type CatalogPageLayoutPreference,
} from "./catalog-page-layout.js";
import { DocumentThumbnails } from "./document-thumbnails.js";
import {
  DocumentSearch,
  type DocumentSearchHost,
  type DocumentTextMatch,
} from "./document-search.js";
import { DocumentInformation, type DocumentInformationHost } from "./document-information.js";
import {
  DocumentAttachments,
  type DocumentAttachmentsHost,
  type DocumentAttachmentsPreparationOutcome,
} from "./document-attachments.js";
import { DocumentAttachmentsPresentation } from "./document-attachments-presentation.js";
import { DocumentLayers } from "./document-layers.js";
import { DocumentLayersPresentation } from "./document-layers-presentation.js";
import { DocumentPageUsage, type DocumentPageUse } from "./document-page-usage.js";
import { DocumentTextPresentation } from "./document-text-presentation.js";
import { DocumentPresentation } from "./document-presentation.js";
import {
  DocumentNavigation,
  type DocumentNavigationHost,
  type DocumentNavigationIntent,
  type DocumentOutlinePreparationOutcome,
} from "./document-navigation.js";
import { DocumentNavigationHistory } from "./document-navigation-history.js";
import type { DocumentLocation } from "./document-location.js";
import { DocumentOutlinePresentation } from "./document-outline-presentation.js";
import { PointerScrollController, type PointerScrollHost } from "./pointer-scroll.js";
import { DocumentProgressFeedback } from "./document-progress-feedback.js";
import { ZoomGestureController, type ZoomGestureHost } from "./zoom-gesture.js";
import {
  DocumentView,
  type DocumentViewPresentationSnapshot,
  type DocumentViewTransactionResult,
} from "./document-view.js";
import { LifecycleScope } from "./lifecycle-scope.js";
import type { RenderMotion } from "./render-planner.js";
import {
  DocumentRenderer,
  settleIndependentPresentations,
  type RenderPresentationContext,
} from "./document-renderer.js";
import { resolvePdfDestination as resolvePdfDestinationValue } from "./pdf-destinations.js";
import {
  DEFAULT_RENDERING_PROFILE_POLICY,
  DEFAULT_RENDERING_PROFILE_SETTINGS,
  mergeRenderingProfilePolicy,
  mergeRenderingProfiles,
  resolveRenderingProfile,
} from "./rendering-profiles.js";
import { validateNavigationStateAdapter } from "./hash-navigation-state.js";
import {
  PDFJS_VIEWER_ROOT_ATTRIBUTE,
  PDFJS_VIEWER_STATE_CLASSES,
  PDFJS_VIEWER_UI_HOOKS,
} from "./viewer-contracts.js";
import type {
  PdfjsViewerPageLayout,
  PdfjsViewerFitModeSelection,
  PdfjsViewerRotation,
  PdfjsViewerRenderingProfile,
  PdfjsViewerRenderingProfileSelection,
  PdfjsViewerRenderingProfileSettings,
  PdfjsViewerSidebarView,
  PdfjsViewerLabels,
  PdfjsViewerFormatters,
  PdfjsViewerUiTextOptions,
  PdfjsViewerUiBindings,
  PdfjsViewerKeyboardScope,
  PdfjsViewerPrintMode,
  PdfjsViewerAccessibilityOptions,
  PdfjsViewerSource,
  PdfjsViewerPasswordReason,
  PdfjsViewerDocumentOptions,
  PdfjsViewerNavigationStateAdapter,
  PdfjsViewerStatus,
  PdfjsViewerLoadOptions,
  PdfjsViewerLoadCancellationCause,
  PdfjsViewerLoadResult,
  PdfjsViewerFeaturePreparationState,
  PdfjsViewerFullscreenResult,
  PdfjsViewerPresentationModeResult,
  PdfjsViewerState,
  PdfjsViewerPdfNamedDestinationNavigationResult,
  PdfjsViewerAttachmentsResult,
  PdfjsViewerAttachmentDownloadResult,
  PdfjsViewerDocumentInformation,
  PdfjsViewerDocumentInformationResult,
  PdfjsViewerTextQueryOptions,
  PdfjsViewerOutlineQueryOptions,
  PdfjsViewerSearchResult,
  PdfjsViewerOutlineResult,
  PdfjsViewerPdfNamedDestinationNavigationOptions,
  PdfjsViewerLayersResult,
  PdfjsViewerLayerVisibilityChange,
  PdfjsViewerLayerMutationResult,
  PdfjsViewerFormResetResult,
  PdfjsViewerDocumentVariant,
  PdfjsViewerDocumentDataOptions,
  PdfjsViewerDocumentDataResult,
  PdfjsViewerDownloadOptions,
  PdfjsViewerDownloadResult,
  PdfjsViewerPrintPageRange,
  PdfjsViewerPrintOptions,
  PdfjsViewerPrintPreflightResult,
  PdfjsViewerPrintState,
  PdfjsViewerPrintStartDetail,
  PdfjsViewerPrintCleanupDetail,
  PdfjsViewerNormalizedPrintOptions,
  PdfjsViewerPrintAdapterResult,
  PdfjsViewerPrintResult,
  PdfjsViewerPrintSourceOptions,
  PdfjsViewerPrintSourceWarning,
  PdfjsViewerPrintSourceResult,
  PdfjsViewerPrintAdapter,
  PdfjsViewerPrintSourceResolver,
  PdfjsViewerOptions,
} from "./viewer-contracts.js";

import {
  getPdfjsViewerRuntimeAccess,
  PdfjsViewerRuntime,
  type PdfjsViewerLogger,
  type PdfjsViewerLogLevel,
  type RuntimeViewerRegistration,
} from "./pdfjs-viewer-runtime.js";

type ViewerWindow = Window & typeof globalThis;
type LoadAttempt = {
  readonly requestGeneration: number;
  readonly promise: Promise<PdfjsViewerLoadResult>;
  settled: boolean;
  settle(result: PdfjsViewerLoadResult): void;
};

const SCROLL_MOTION_IDLE_MS = 120;
const SMOOTH_NAVIGATION_MIN_DURATION_MS = 180;
const SMOOTH_NAVIGATION_MAX_DURATION_MS = 500;
const SMOOTH_NAVIGATION_PX_PER_MS = 4;

type SmoothNavigation = {
  targetTop: number;
  targetLeft: number | null;
  startTop: number;
  startLeft: number;
  startTime: number | null;
  duration: number;
  raf: number | null;
};

/** Runs best-effort cleanup whose failure cannot change observable lifecycle state. */
function runCleanup(action: (() => void) | null | undefined): void {
  if (!action) return;
  try {
    action();
  } catch {
    /* Cleanup is intentionally idempotent and non-fatal. */
  }
}

type PdfDestinationInput = string | Array<unknown> | null | undefined;

/** WebKit's non-standard gesture event exposed by Safari. */
interface WebKitGestureEvent extends Event {
  clientX?: number;
  clientY?: number;
  scale?: number;
}

/**
 * Framework-independent PDF.js viewer with reusable UI, navigation, rendering,
 * search, accessibility, and deterministic document lifecycle management.
 *
 * Construction creates a document-free viewer in the `closed` state. Call
 * {@link load} explicitly after attaching event listeners. Observe `state`, the
 * returned load result, or viewer events for readiness and errors; use
 * {@link load} and {@link close} to reuse the instance, and call {@link destroy}
 * for final cleanup.
 */
export class PdfjsViewer {
  // --- Instance identity and lifecycle ---

  static #nextViewerId = 0;
  #destroyed = false;
  #viewerLifetime!: LifecycleScope;
  #documentLifetime!: LifecycleScope;
  #loadAbort: AbortController | null = null;
  #loadingTask: ReturnType<typeof PDFJS.getDocument> | null = null;
  #activeLoadAttempt: LoadAttempt | null = null;
  #disconnectObserver: MutationObserver | null = null;

  // --- Runtime, diagnostics, and host ownership ---

  #runtime: PdfjsViewerRuntime;
  #pdfjs: typeof PDFJS;
  #logger: PdfjsViewerLogger | null;
  #runtimeRegistration: RuntimeViewerRegistration | null = null;
  #runtimeAttached = false;
  #viewerId: string;
  #keyboardScope: PdfjsViewerKeyboardScope | null = "viewer";
  #hostActive = true;
  #documentVisible = true;
  #renderingActive = true;

  // --- Document lifecycle and observable view state ---

  #pdf: PDFJS.PDFDocumentProxy | null = null;
  #documentPageUsage: DocumentPageUsage | null = null;
  #printGeometryPreparations = new Map<string, Promise<Readonly<PrintPageSize> | null>>();
  #pdfUrl: string | null = null;
  #pdfFilename: string | null = null;
  #documentDataRead: Readonly<{
    pdf: PDFJS.PDFDocumentProxy;
    promise: Promise<Uint8Array>;
  }> | null = null;
  #downloadOperations = new Set<
    Readonly<{
      pdf: PDFJS.PDFDocumentProxy;
      generation: number;
      document: PdfjsViewerDocumentVariant;
      filename: string;
      promise: Promise<PdfjsViewerDownloadResult>;
    }>
  >();
  #status: PdfjsViewerStatus = "closed";
  #printPermissionAllowed = true;
  #lastPublishedState: Readonly<PdfjsViewerState> | null = null;
  #publishedPrintState: Readonly<PdfjsViewerPrintState> | null = null;
  #documentGeneration = 0;
  #documentRequestGeneration = 0;
  #controlledPrintAdmission: Readonly<{ generation: number }> | null = null;
  #terminalLoadError: Readonly<{ error: unknown }> | null = null;
  #initialRenderWaiter: (() => void) | null = null;
  #documentSearch = new DocumentSearch();
  #documentInformation = new DocumentInformation();
  #documentAttachments = new DocumentAttachments();
  #documentLayers!: DocumentLayers;
  #documentNavigation = new DocumentNavigation();
  #documentNavigationHistory = new DocumentNavigationHistory();
  #navigationIntentGeneration = 0;
  #navigationCommitRevision = 0;
  #pendingExplicitNavigationIntent: Readonly<DocumentNavigationIntent> | null = null;
  #documentAttachmentsPresentation!: DocumentAttachmentsPresentation;
  #documentLayersPresentation!: DocumentLayersPresentation;
  #documentOutlinePresentation!: DocumentOutlinePresentation;
  #documentPresentation!: DocumentPresentation;
  #documentTextPresentation!: DocumentTextPresentation;
  #textSelectionMode = false;
  #formAppearanceRevision = 0;

  #initialPageLayout: PdfjsViewerPageLayout = "auto";
  #initialFitMode: PdfjsViewerFitModeSelection = "auto";
  #initialRotation: PdfjsViewerRotation = 0;
  #viewOperationGeneration = 0;
  #pendingRotationRequest: Readonly<{ rotation: PdfjsViewerRotation }> | null = null;

  // --- Fullscreen and presentation modes ---

  #viewerFullscreen!: ViewerFullscreen;
  #fullscreenToggleBtnEl: HTMLButtonElement | null = null;
  #presentationToggleBtnEl: HTMLButtonElement | null = null;
  #presentationInput!: PresentationInputController;
  #presentationMode = false;
  #presentationOperationGeneration = 0;
  #presentationViewTransitionDepth = 0;
  #presentationResizePending = false;
  #presentationPageAnchor: number | null = null;
  #presentationSnapshot: Readonly<{
    documentGeneration: number;
    entryPage: number;
    view: Readonly<DocumentViewPresentationSnapshot>;
  }> | null = null;
  #presentationFocusReturn: HTMLElement | null = null;
  #presentationFullscreenRequested = false;
  #presentationFullscreenPromise: Promise<ViewerFullscreenResult> | null = null;
  #presentationFullscreenCancellationPending = false;
  #publishedFullscreenFailures = new WeakSet<object>();

  // --- Host configuration and primary UI roots ---

  #ownerDocument: Document;
  #ownerWindow: ViewerWindow;
  #pdfRootEl: HTMLElement;
  #docContainerEl: HTMLElement;
  #ownedUiEl: HTMLElement | null = null;
  #ownedMarkerElements = new Set<HTMLElement>();
  #uiBindings: PdfjsViewerUiBindings;
  #behavior: NormalizedViewerBehavior;
  #features: NormalizedViewerFeatures;
  #accessibility: Required<PdfjsViewerAccessibilityOptions>;
  #labels: Readonly<PdfjsViewerLabels>;
  #formatters: Readonly<PdfjsViewerFormatters>;
  #printAdapter: PdfjsViewerPrintAdapter | null;
  #printSourceResolver: PdfjsViewerPrintSourceResolver | null;
  #printFeature: Readonly<{
    mode: PdfjsViewerPrintMode;
    browserFallback: boolean;
    defaults: import("./viewer-contracts.js").PdfjsViewerNormalizedPrintDefaults;
  }>;
  #deviceCompatibility: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[];
  #defaultDocumentOptions: PdfjsViewerDocumentOptions;
  #activeDocumentOptions: PdfjsViewerDocumentOptions = {};

  // --- Navigation, zoom, and profile controls ---

  #prevPageBtnEl: HTMLButtonElement | null = null;
  #nextPageBtnEl: HTMLButtonElement | null = null;
  #previousBoundaryControlPress: BoundaryControlPress | null = null;
  #nextBoundaryControlPress: BoundaryControlPress | null = null;
  #pageNumEl: HTMLInputElement | null = null;
  #pageCountEl: HTMLElement | null = null;
  #navigationHistoryBackBtnEl: HTMLButtonElement | null = null;
  #navigationHistoryForwardBtnEl: HTMLButtonElement | null = null;
  #downloadBtnEl: HTMLAnchorElement | null = null;
  #downloadFilledDocumentBtnEl: HTMLButtonElement | null = null;
  #downloadFilledDocumentBusy = false;
  #printBtnEl: HTMLButtonElement | null = null;
  #viewerPrintSetup: ViewerPrintSetup | null = null;
  #documentInformationBtnEl: HTMLButtonElement | null = null;
  #viewerDocumentInformation: ViewerDocumentInformation | null = null;

  #autoFitBtnEl: HTMLButtonElement | null = null;
  #autoFitMenuBtnEl: HTMLButtonElement | null = null;

  #zoomSliderEl: HTMLInputElement | null = null;
  #zoomSliderWrapEl: HTMLElement | null = null;
  #zoomSliderRaf: number | null = null;
  #zoomSliderDragActive = false;
  #pageLayoutToggleSingleEl: HTMLInputElement | null = null;
  #pageLayoutToggleDoubleEl: HTMLInputElement | null = null;
  #pageLayoutToggleBookEl: HTMLInputElement | null = null;
  #pageLayoutToggleAutoEl: HTMLInputElement | null = null;
  #fitModeToggleAutoEl: HTMLInputElement | null = null;
  #fitModeToggleContainEl: HTMLInputElement | null = null;
  #fitModeToggleWidthEl: HTMLInputElement | null = null;
  #fitModeToggleHeightEl: HTMLInputElement | null = null;
  #rotateCounterclockwiseBtnEl: HTMLButtonElement | null = null;
  #resetRotationBtnEl: HTMLButtonElement | null = null;
  #rotateClockwiseBtnEl: HTMLButtonElement | null = null;

  #renderingProfileToggleConservativeEl: HTMLInputElement | null = null;
  #renderingProfileToggleBalancedEl: HTMLInputElement | null = null;
  #renderingProfileToggleAggressiveEl: HTMLInputElement | null = null;
  #renderingProfileGroupEl: HTMLElement | null = null;

  // --- Document search ---

  #searchInputEl: HTMLInputElement | null = null;
  #searchPrevBtnEl: HTMLButtonElement | null = null;
  #searchNextBtnEl: HTMLButtonElement | null = null;
  #searchCountEl: HTMLElement | null = null;
  #searchPanelEl: HTMLElement | null = null;
  #searchCloseBtnEl: HTMLButtonElement | null = null;
  #searchToggleBtnEl: HTMLButtonElement | null = null;
  #searchPreparationUpdatesUi = false;
  #searchPreparationState: PdfjsViewerFeaturePreparationState = "idle";
  #searchQuery: string = "";
  #searchQueryForced = false;
  #searchMatches: DocumentTextMatch[] = [];
  #presentedSearchMatches: readonly DocumentTextMatch[] | null = null;
  #searchPos: number = -1;

  // --- Toolbar popover panels ---

  #menuToggleBtnEl: HTMLButtonElement | null = null;
  #menuPanelEl: HTMLElement | null = null;
  #menuCloseBtnEl: HTMLButtonElement | null = null;
  #textSelectionToggleBtnEl: HTMLButtonElement | null = null;

  // --- Sidebar shell ---

  #sidebarContainerEl: HTMLElement | null = null;
  #sidebarCloseBtnEl: HTMLButtonElement | null = null;
  #sidebarToggleEl: HTMLButtonElement | null = null;
  #sidebarPrimaryViewsEl: HTMLElement | null = null;
  #sidebarMoreToggleEl: HTMLButtonElement | null = null;
  #sidebarMoreMenuEl: HTMLElement | null = null;
  #viewerPanels!: ViewerPanels;

  // --- Outline view and selection ---

  #outlineContentEl: HTMLElement | null = null;
  #thumbnailsContentEl: HTMLElement | null = null;
  #attachmentsContentEl: HTMLElement | null = null;
  #layersContentEl: HTMLElement | null = null;
  #outlineAvailable = true;
  #attachmentsAvailable = true;
  #layersAvailable = false;
  #outlinePreparationState: PdfjsViewerFeaturePreparationState = "idle";
  #attachmentsPreparationState: PdfjsViewerFeaturePreparationState = "idle";

  // --- Render scheduling, budgets, and retention ---

  #renderingProfile: PdfjsViewerRenderingProfile = "balanced";
  #renderingProfileRevision = 0;
  #renderingProfileSelection: PdfjsViewerRenderingProfileSelection = "auto";
  #automaticRenderingProfile: PdfjsViewerRenderingProfile = "balanced";
  #renderingProfiles: Record<PdfjsViewerRenderingProfile, PdfjsViewerRenderingProfileSettings> =
    DEFAULT_RENDERING_PROFILE_SETTINGS;
  #availableRenderingProfiles: readonly PdfjsViewerRenderingProfile[] =
    DEFAULT_RENDERING_PROFILE_POLICY.other.availableProfiles;
  #showInitialRenderProgress = false;
  #rasterWorkCoordinator = new RasterWorkCoordinator(() =>
    this.#documentThumbnails?.notifyAdmissionChanged(),
  );
  #documentPrint!: DocumentPrint;
  #documentThumbnails!: DocumentThumbnails;
  /** Complete raster lifecycle owner; see `DocumentRenderer`. */
  #documentRenderer = new DocumentRenderer(
    {
      leaseFor: pageNo => this.#documentView.leaseFor(pageNo),
      isCurrent: lease => this.#documentView.isCurrent(lease),
    },
    this.#renderingProfile,
    DEFAULT_RENDERING_PROFILE_SETTINGS.balanced,
    {
      observedPageGeometry: (pageNo, width, height) => {
        this.#documentView.recordObservedPageGeometry(pageNo, width, height);
        this.#documentThumbnails?.observePageGeometry(pageNo, width, height);
      },
      present: context => this.#presentRenderedPage(context),
      retainPlaceholder: pageNo =>
        (this.#documentTextPresentation?.selectionIncludesPage(pageNo) ?? false) ||
        (this.#documentPresentation?.retainsPage(pageNo) ?? false),
      evicted: (_pageNo, lease) => {
        this.#documentPresentation?.evict(_pageNo, lease);
        this.#documentTextPresentation?.evict(_pageNo, lease);
      },
      progress: (complete, total, done) => {
        if (!this.#showInitialRenderProgress) return;
        this.#documentProgressFeedback.update(
          0.06 * complete + 0.94 * total,
          total,
          done,
          "render",
        );
      },
      ready: documentId => {
        if (
          this.#destroyed ||
          this.#status !== "loading" ||
          this.#documentRenderer.snapshot().documentId !== documentId ||
          !this.#pdf
        )
          return;
        this.#showInitialRenderProgress = false;
        this.#setStatus("ready");
        this.#pdfRootEl.dispatchEvent(new this.#ownerWindow.CustomEvent("pdf:ready"));
        this.#flushPreparationEvents();
        if (this.#features.attachments) void this.#prepareAttachments();
        this.#log("debug", "load-ready", "Document reached ready state", {
          generation: this.#documentGeneration,
          pageCount: this.#pdf.numPages,
        });
        this.#settleInitialRenderWaiter();
      },
      failed: (documentId, error) => {
        if (
          this.#destroyed ||
          this.#status !== "loading" ||
          this.#documentRenderer.snapshot().documentId !== documentId ||
          !this.#pdf
        )
          return;
        this.#showInitialRenderProgress = false;
        this.#terminalLoadError = Object.freeze({ error });
        this.#settleInitialRenderWaiter();
      },
      diagnostic: entry => this.#log(entry.level, entry.event, entry.message, entry.details),
      primaryPressureChanged: pressure => this.#rasterWorkCoordinator.setPrimaryPressure(pressure),
    },
  );
  #scrollRaf: number | null = null;
  #scrollRequestGeneration = 0;
  #scrollPendingDuringTouchZoom = false;
  #lastObservedScrollTop: number | null = null;
  #scrollMotionIdleTimer: number | null = null;
  #pendingPreparationEvents: Array<{
    type: "pdf:searchindexcomplete" | "pdf:outlinecomplete" | "pdf:attachmentscomplete";
    detail: object;
  }> = [];
  #lastEmittedPage = 1;

  // --- Destination navigation and persisted anchors ---

  // Applied before the first render window is computed.
  #pendingInitialPage: number | null = null;
  #pendingNavTargetPage: number | null = null;
  #pendingNavClearTimer: number | null = null;
  #smoothNavigation: SmoothNavigation | null = null;

  // Same-page tolerance for associating a spot with outline and navigation
  // destinations. Expressed in page heights; default is ±0.1 page.
  #destinationMatchTolerance = 0.1;

  #shareableNamedDestinationPrefix: string | null = null;
  #navigationState: PdfjsViewerNavigationStateAdapter | null = null;

  // Resolved before the initial render window is computed.
  #pendingInitialPdfNamedDestination: string | null = null;
  #pendingInitialResolvedDestination: { pageNo: number; yRatio?: number } | null = null;
  // --- Zoom sessions and gesture state ---

  #zoomMinScale: number = 0.2;
  #zoomMaxScale: number = 4;
  /** Transient-zoom anchor/scale/touch-lock gesture state; see `ZoomGestureController`. */
  #zoomGesture!: ZoomGestureController;
  #overflowAnchorTimer: number | null = null;
  #zoomLimitHintEl: HTMLDivElement | null = null;
  #zoomLimitHintDirection: "in" | "out" | null = null;

  #suppressClickUntil = 0;
  /** Mouse-drag scroll fling and middle-mouse auto-scroll gesture state; see `PointerScrollController`. */
  #pointerScroll!: PointerScrollController;
  #sidebarPointerScroll!: PointerScrollController;
  #sidebarPointerScrollHosts = new WeakMap<HTMLElement, PointerScrollHost>();

  // --- Resize observation and progress feedback ---

  #containerResizeObserver: ResizeObserver | null = null;
  #containerResizeRaf: number | null = null;
  #resizeRaf: number | null = null;
  #documentProgressFeedback!: DocumentProgressFeedback;
  #documentView!: DocumentView;

  /**
   * Creates the selected UI mode, installs viewer-level event handlers, attaches
   * to the configured runtime, and leaves the viewer document-free.
   *
   * @param opts - Viewer, UI, runtime, loading, behavior, and accessibility
   * configuration. `pageLayout` and `renderingProfile` both default to `"auto"`.
   * @throws When worker/runtime options conflict or required custom UI hooks are
   * missing.
   */
  constructor(opts: PdfjsViewerOptions) {
    const rootOwnerDocument = opts?.rootEl?.ownerDocument;
    const rootOwnerWindow = rootOwnerDocument?.defaultView as ViewerWindow | null | undefined;
    if (!rootOwnerDocument || !rootOwnerWindow) {
      throw new TypeError("PdfjsViewer: rootEl must belong to a Document with a defaultView");
    }
    this.#ownerDocument = rootOwnerDocument;
    this.#ownerWindow = rootOwnerWindow;
    this.#viewerLifetime = this.#createLifecycleScope();
    this.#documentLifetime = this.#createLifecycleScope();
    this.#documentRenderer.setOwnerWindow(this.#ownerWindow);
    const gesturePlatform = {
      requestAnimationFrame: (callback: FrameRequestCallback) =>
        this.#ownerWindow.requestAnimationFrame(callback),
      cancelAnimationFrame: (id: number) => this.#ownerWindow.cancelAnimationFrame(id),
      setTimeout: (callback: () => void, delay: number) =>
        this.#ownerWindow.setTimeout(callback, delay),
      clearTimeout: (id: number | null) => {
        if (id != null) this.#ownerWindow.clearTimeout(id);
        return null;
      },
    };
    this.#zoomGesture = new ZoomGestureController(gesturePlatform);
    const pointerPlatform = { ...gesturePlatform, now: () => this.#ownerWindow.performance.now() };
    this.#pointerScroll = new PointerScrollController(pointerPlatform);
    this.#sidebarPointerScroll = new PointerScrollController(pointerPlatform);
    const normalized = normalizeViewerOptions(opts, this.#hasTouch());
    if (opts.navigationState !== undefined) validateNavigationStateAdapter(opts.navigationState);

    this.#logger = opts.logger ?? null;

    this.#runtime = opts.runtime;
    const runtimeAccess = getPdfjsViewerRuntimeAccess(this.#runtime);
    runtimeAccess.assertWorkerCompatible();
    this.#pdfjs = runtimeAccess.pdfjs;
    // --- Validate required root element and extract options ---
    this.#pdfRootEl = opts.rootEl;
    this.#uiBindings = normalized.uiBindings;
    this.#behavior = normalized.behavior;
    this.#documentVisible = this.#ownerDocument.visibilityState === "visible";
    this.#features = normalized.features;
    validatePdfjsDisplayCapabilities(this.#pdfjs, {
      text: this.#features.textSelection,
      annotations:
        this.#features.annotationLinks.internalDestinations ||
        this.#features.annotationLinks.externalUrls ||
        this.#features.annotationMarkup.enabled ||
        this.#features.forms.interactive ||
        this.#features.forms.xfa,
      xfa: this.#features.forms.xfa,
    });
    this.#accessibility = normalized.accessibility;
    this.#labels = normalized.ui.labels;
    this.#formatters = normalized.ui.formatters;
    this.#printAdapter = opts.printAdapter ?? null;
    this.#printSourceResolver = opts.printSourceResolver ?? null;
    this.#printFeature = normalized.features.print;
    this.#deviceCompatibility = normalized.deviceCompatibility;
    this.#documentPrint = new DocumentPrint(
      this.#rasterWorkCoordinator,
      {},
      {
        state: () => {
          this.#viewerPrintSetup?.syncState();
          this.#emitStateChange();
        },
        event: event =>
          this.#pdfRootEl.dispatchEvent(
            new this.#ownerWindow.CustomEvent(`pdf:print${event.type}`, { detail: event.detail }),
          ),
        diagnostic: details =>
          this.#log("debug", "print-budget", "Evaluated controlled print budget", details),
      },
    );
    this.#defaultDocumentOptions = this.#copyDocumentOptions(opts.defaultDocumentOptions ?? {});
    this.#viewerId = opts.viewerId?.trim() || `pdfjs-viewer-${++PdfjsViewer.#nextViewerId}`;
    this.#initialPageLayout = opts.pageLayout ?? "auto";
    this.#initialFitMode = opts.fitMode ?? "auto";
    this.#initialRotation = opts.initialRotation ?? 0;
    this.#keyboardScope = opts.keyboard === false ? null : (opts.keyboard?.scope ?? "viewer");
    if (this.#keyboardScope === "global")
      runtimeAccess.assertViewerIdAvailable(this.#viewerId, this.#ownerWindow);
    this.#shareableNamedDestinationPrefix = opts.shareableNamedDestinationPrefix ?? null;
    this.#navigationState = opts.navigationState ?? null;
    const enableOutlineFilter =
      this.#features.outline &&
      this.#features.outlineFilter &&
      (!this.#ownedUiEl || normalized.ui.controls.outlineFilter);
    this.#renderingProfiles = mergeRenderingProfiles(opts.renderingProfiles);

    this.#destinationMatchTolerance = this.#behavior.destinationMatchTolerance;

    const isLikelyMobile = this.#isLikelyMobile();
    const renderingProfilePolicy = mergeRenderingProfilePolicy(opts.renderingProfilePolicy);
    const activeProfilePolicy = isLikelyMobile
      ? renderingProfilePolicy.likelyMobile
      : renderingProfilePolicy.other;
    this.#availableRenderingProfiles = Object.freeze([...activeProfilePolicy.availableProfiles]);
    this.#automaticRenderingProfile = activeProfilePolicy.defaultProfile;

    try {
      this.#applyViewerMarkers();
      this.#prepareUi(normalized.ui);
      this.#log("debug", "created", "Viewer was created", {
        pageLayout: this.#initialPageLayout,
        fitMode: this.#initialFitMode,
        initialRotation: this.#initialRotation,
        autoFitWidthMaxHeight: this.#behavior.autoFitWidthMaxHeight,
        keyboardScope: this.#keyboardScope,
      });

      // --- Core container and controls lookup ---
      const printRoute = this.#printRoute();
      const ui = discoverViewerUi(
        this.#pdfRootEl,
        this.#uiBindings,
        PDFJS_VIEWER_UI_HOOKS,
        printRoute.route === "controlled-native",
      );
      this.#downloadBtnEl = ui.download;
      this.#downloadFilledDocumentBtnEl = ui.downloadFilledDocument;
      this.#printBtnEl = ui.print;
      this.#documentInformationBtnEl =
        this.#ownedUiEl?.querySelector<HTMLButtonElement>(".pdf-document-information-btn") ?? null;
      const printSetup = printRoute.route === "controlled-native" ? ui.printSetup : null;
      if (printRoute.route !== "controlled-native") {
        this.#ownedUiEl?.querySelector(".pdf-print-setup")?.remove();
        this.#printBtnEl?.removeAttribute("aria-haspopup");
        this.#printBtnEl?.removeAttribute("aria-controls");
      }
      if (
        (printRoute.route === "disabled" || printRoute.route === "unavailable") &&
        this.#printBtnEl
      ) {
        this.#printBtnEl.hidden = true;
        this.#printBtnEl.disabled = true;
        this.#printBtnEl.setAttribute("aria-disabled", "true");
      }
      this.#syncDownloadControl();
      this.#docContainerEl = ui.container;
      if (this.#printBtnEl && printSetup?.dialog) {
        this.#viewerPrintSetup = new ViewerPrintSetup(
          this.#printBtnEl,
          printSetup,
          this.#labels,
          this.#formatters,
          {
            generation: () => this.#documentGeneration,
            pageCount: () => this.#documentView.pageCount,
            state: () => this.#printState(),
            routeSelected: () => this.#logPrintRoute("button"),
            closeTransientUi: () => this.#closeTransientUi(),
            preflight: options => this.preflightPrint(options),
            print: options => this.#executePrint(options, false),
            openSource: options => this.openPrintSource({ document: "auto", print: options }),
            cancelPreparation: () => this.#documentPrint.cancel(),
            failed: error =>
              this.#log("error", "print-setup-failed", "Print setup action failed", {}, error),
          },
          this.#printFeature.defaults,
        );
      }
      const documentInformationDialog =
        this.#ownedUiEl?.querySelector<HTMLDialogElement>(".pdf-document-information") ?? null;
      if (this.#documentInformationBtnEl && documentInformationDialog) {
        this.#viewerDocumentInformation = new ViewerDocumentInformation(
          this.#documentInformationBtnEl,
          documentInformationDialog,
          this.#labels,
          this.#formatters.documentInformationDate,
          {
            closeTransientUi: () => this.#closeTransientUi(),
            getInformation: () => this.getDocumentInformation(),
            failed: error =>
              this.#log(
                "error",
                "document-information-failed",
                "Document information action failed",
                {},
                error,
              ),
          },
        );
      }
      this.#documentPresentation = new DocumentPresentation(
        {
          ownerDocument: this.#ownerDocument,
          AnnotationLayer: this.#pdfjs.AnnotationLayer,
          ...(this.#features.forms.xfa ? { XfaLayer: this.#pdfjs.XfaLayer } : {}),
          annotationLinkLabel: this.#labels.annotationLink,
          annotationCommentLabel: this.#labels.annotationComment,
          annotationAttachmentLabel: this.#labels.annotationAttachment,
          annotationAttachmentErrorLabel: this.#labels.annotationAttachmentError,
          xfaUnavailableLabel: this.#labels.xfaUnavailable,
          xfaHybridFallbackLabel: this.#labels.xfaHybridFallback,
          optionalContentActions: this.#features.layers,
          links: this.#features.annotationLinks,
          markup: this.#features.annotationMarkup,
          forms: this.#features.forms,
        },
        {
          internalDestination: intent => this.#followAnnotationDestination(intent.destination),
          namedNavigation: action => this.#followAnnotationNamedAction(action),
          setOptionalContent: action => this.#documentLayers.executeSetOCGState(action),
          attachmentContent: id =>
            this.#documentAttachments.getPageLocalContent(this.#attachmentsHost(), id),
          dirtyChanged: formDirty => {
            this.#syncFilledDocumentDownloadControl();
            this.#emitStateChange();
            this.#pdfRootEl.dispatchEvent(
              new this.#ownerWindow.CustomEvent("pdf:formdirtychange", { detail: { formDirty } }),
            );
          },
          formStateChanged: () => {
            this.#syncFilledDocumentDownloadControl();
            this.#emitStateChange();
            if (!this.#pdf || !this.#documentPageUsage) return;
            const layers = this.#documentLayers.renderState();
            this.#installRasterState(
              layers?.revision ?? 0,
              this.#formAppearanceRevision,
              layers?.configurationPromise,
              true,
            );
            this.#reconcileRendering();
          },
          formAppearanceChanged: pageNo => {
            this.#formAppearanceRevision++;
            this.#documentThumbnails.invalidateFormPages([pageNo]);
          },
          requestFormPage: pageNo => {
            this.#scrollToPage(pageNo, false, false);
            const row = this.#documentView.rowIndexForPage(pageNo) ?? 0;
            this.#reconcileRendering({ first: row, last: row, center: row });
          },
          diagnostic: entry =>
            this.#log("debug", entry.event, entry.message, entry.details, entry.error),
        },
      );
      this.#documentTextPresentation = new DocumentTextPresentation({
        container: this.#docContainerEl,
        // Text presentation must use the same injected PDF.js tree as getDocument().
        TextLayer: this.#pdfjs.TextLayer,
        copied: () => {
          if (this.#behavior.textSelectionPersistence === "until-copy") {
            this.setTextSelectionMode(false);
          }
        },
        demandChanged: () => {
          if (this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
        },
        diagnostic: entry => this.#log("debug", entry.event, entry.message, entry.details),
      });
      this.#documentView = new DocumentView({
        container: this.#docContainerEl,
        ownerDocument: this.#ownerDocument,
        renderer: this.#documentRenderer,
        textPresentation: this.#documentTextPresentation,
        pageLayout: this.#initialPageLayout,
        fitMode: this.#initialFitMode,
        initialRotation: this.#initialRotation,
        autoFitWidthMaxHeight: this.#behavior.autoFitWidthMaxHeight,
        minScale: this.#zoomMinScale,
        maxScale: this.#zoomMaxScale,
        horizontalGap: this.#cssVarToPx("--pdf-page-hgap", 12),
        verticalGap: this.#cssVarToPx("--pdf-page-vgap", 16),
        annotationsEnabled: () => this.#documentPresentation.annotationsEnabled,
        requestFrame: callback => this.#documentLifetime.requestAnimationFrame(callback),
        cancelFrame: handle => this.#ownerWindow.cancelAnimationFrame(handle),
        geometryChanged: () => {
          this.#updateFitUI();
          this.#scheduleScrollDerivedState();
        },
      });

      // --- Navigation controls ---
      this.#prevPageBtnEl = ui.navigation.previous;
      this.#nextPageBtnEl = ui.navigation.next;
      this.#pageNumEl = ui.navigation.pageNumber;
      this.#pageCountEl = ui.navigation.pageCount;
      this.#navigationHistoryBackBtnEl = ui.navigationHistory.back;
      this.#navigationHistoryForwardBtnEl = ui.navigationHistory.forward;
      this.#fullscreenToggleBtnEl = this.#features.fullscreen ? ui.fullscreen.toggle : null;
      this.#presentationToggleBtnEl = this.#features.presentation ? ui.presentation.toggle : null;
      this.#presentationInput = new PresentationInputController({
        root: this.#pdfRootEl,
        container: this.#docContainerEl,
        controls: this.#features.presentation ? ui.presentation.controls : null,
        previous: this.#features.presentation ? ui.presentation.previous : null,
        next: this.#features.presentation ? ui.presentation.next : null,
        exit: this.#features.presentation ? ui.presentation.exit : null,
        longPressMs: this.#behavior.longPressMs,
        callbacks: {
          canInteract: () => this.#canInteractWithDocument(),
          step: delta => this.#presentationStep(delta),
          jump: boundary =>
            this.#scrollToPage(
              boundary === "first" ? 1 : this.#documentView.pageCount,
              false,
              false,
            ),
          exit: () => void this.exitPresentationMode(),
          focusDocument: () => this.#docContainerEl.focus({ preventScroll: true }),
          setControlsVisible: visible =>
            this.#setModeClass(PDFJS_VIEWER_STATE_CLASSES.presentationControlsVisible, visible),
          isTextSelectionTarget: target =>
            this.#documentTextPresentation?.isTextSelectionTarget(target) ?? false,
          isFormControlTarget: target => this.#documentPresentation.isFormControlTarget(target),
        },
      });
      if (!this.#features.navigationHistory) {
        for (const control of [
          this.#navigationHistoryBackBtnEl,
          this.#navigationHistoryForwardBtnEl,
        ]) {
          if (!control) continue;
          control.disabled = true;
          control.setAttribute("aria-disabled", "true");
        }
        const backGroup = this.#navigationHistoryBackBtnEl?.closest(
          ".pdf-navigation-history-controls",
        );
        const forwardGroup = this.#navigationHistoryForwardBtnEl?.closest(
          ".pdf-navigation-history-controls",
        );
        if (backGroup instanceof this.#ownerWindow.HTMLElement && backGroup === forwardGroup)
          this.#hideUnavailableElement(backGroup);
        else {
          this.#hideUnavailableElement(this.#navigationHistoryBackBtnEl);
          this.#hideUnavailableElement(this.#navigationHistoryForwardBtnEl);
        }
        this.#navigationHistoryBackBtnEl = null;
        this.#navigationHistoryForwardBtnEl = null;
      }
      this.#syncNavigationHistoryControls();

      // Accessibility: Ensure container is focusable
      if (!this.#docContainerEl.hasAttribute("tabindex"))
        this.#docContainerEl.setAttribute("tabindex", "0");
      if (!this.#docContainerEl.hasAttribute("role"))
        this.#docContainerEl.setAttribute("role", "region");
      if (!this.#docContainerEl.hasAttribute("aria-label"))
        this.#docContainerEl.setAttribute("aria-label", this.#accessibility.documentLabel);

      // Keep native scrolling fast while viewer zoom gestures are active. When
      // disabled, restore native browser touch handling instead.
      this.#docContainerEl.style.touchAction = this.#behavior.zoomGestures ? "pan-x pan-y" : "auto";
      this.#docContainerEl.style.overscrollBehavior = "contain";
      this.#docContainerEl.style.setProperty("-webkit-overflow-scrolling", "touch");

      // --- Page layout radio toggles (optional) ---
      const pageLayoutGroup = ui.menu.pageLayout;
      this.#pageLayoutToggleSingleEl =
        pageLayoutGroup?.querySelector<HTMLInputElement>('[data-pdf-page-layout="single"]') ?? null;
      this.#pageLayoutToggleDoubleEl =
        pageLayoutGroup?.querySelector<HTMLInputElement>('[data-pdf-page-layout="double"]') ?? null;
      this.#pageLayoutToggleBookEl =
        pageLayoutGroup?.querySelector<HTMLInputElement>('[data-pdf-page-layout="book"]') ?? null;
      this.#pageLayoutToggleAutoEl =
        pageLayoutGroup?.querySelector<HTMLInputElement>('[data-pdf-page-layout="auto"]') ?? null;
      const fitModeGroup = ui.menu.fitMode;
      this.#fitModeToggleAutoEl =
        fitModeGroup?.querySelector<HTMLInputElement>('[data-pdf-fit-mode="auto"]') ?? null;
      this.#fitModeToggleContainEl =
        fitModeGroup?.querySelector<HTMLInputElement>('[data-pdf-fit-mode="contain"]') ?? null;
      this.#fitModeToggleWidthEl =
        fitModeGroup?.querySelector<HTMLInputElement>('[data-pdf-fit-mode="width"]') ?? null;
      this.#fitModeToggleHeightEl =
        fitModeGroup?.querySelector<HTMLInputElement>('[data-pdf-fit-mode="height"]') ?? null;
      this.#rotateCounterclockwiseBtnEl = ui.menu.rotateCounterclockwise;
      this.#resetRotationBtnEl = ui.menu.resetRotation;
      this.#rotateClockwiseBtnEl = ui.menu.rotateClockwise;

      // --- Rendering profile toggles (optional) ---
      this.#renderingProfileGroupEl = ui.menu.renderingProfile;
      this.#renderingProfileToggleConservativeEl =
        this.#renderingProfileGroupEl?.querySelector<HTMLInputElement>(
          '[data-pdf-rendering-profile="conservative"]',
        ) ?? null;
      this.#renderingProfileToggleBalancedEl =
        this.#renderingProfileGroupEl?.querySelector<HTMLInputElement>(
          '[data-pdf-rendering-profile="balanced"]',
        ) ?? null;
      this.#renderingProfileToggleAggressiveEl =
        this.#renderingProfileGroupEl?.querySelector<HTMLInputElement>(
          '[data-pdf-rendering-profile="aggressive"]',
        ) ?? null;
      this.#filterRenderingProfileControls();

      // --- Utility UI elements ---
      this.#autoFitBtnEl = ui.zoom.fit;
      this.#autoFitMenuBtnEl = ui.zoom.fitMenu;
      this.#zoomSliderEl = ui.zoom.slider;
      this.#zoomSliderWrapEl = ui.zoom.sliderWrap;

      // --- Search UI elements ---
      this.#searchToggleBtnEl = ui.search.toggle;
      this.#searchPanelEl = ui.search.panel;
      this.#searchInputEl = ui.search.input;
      this.#searchPrevBtnEl = ui.search.previous;
      this.#searchNextBtnEl = ui.search.next;
      this.#searchCountEl = ui.search.count;
      this.#searchCloseBtnEl = ui.search.close;
      if (!this.#features.search) {
        this.#searchToggleBtnEl = null;
        this.#searchPanelEl = null;
        this.#searchInputEl = null;
        this.#searchPrevBtnEl = null;
        this.#searchNextBtnEl = null;
        this.#searchCountEl = null;
        this.#searchCloseBtnEl = null;
      }

      // --- Toolbar popover panels ---
      this.#menuToggleBtnEl = ui.menu.toggle;
      this.#menuPanelEl = ui.menu.panel;
      this.#menuCloseBtnEl = ui.menu.close;
      this.#textSelectionToggleBtnEl = this.#features.textSelection
        ? ui.menu.textSelectionToggle
        : null;
      this.#syncTextSelectionControl();

      // --- Sidebar views ---
      this.#sidebarContainerEl = ui.sidebar.container;
      this.#sidebarCloseBtnEl = ui.sidebar.close;
      this.#sidebarToggleEl = ui.sidebar.toggle;
      this.#sidebarPrimaryViewsEl = ui.sidebar.primaryViews;
      this.#sidebarMoreToggleEl = ui.sidebar.moreToggle;
      this.#sidebarMoreMenuEl = ui.sidebar.moreMenu;
      this.#outlineContentEl = ui.outline.content;
      this.#thumbnailsContentEl = ui.thumbnails.content;
      this.#attachmentsContentEl = ui.attachments.content;
      this.#layersContentEl = ui.layers.content;
      if (!this.#features.outline) {
        this.#outlineContentEl = null;
      }
      if (!this.#features.thumbnails) this.#thumbnailsContentEl = null;
      if (!this.#features.attachments) this.#attachmentsContentEl = null;
      if (!this.#features.layers) this.#layersContentEl = null;
      const availableSidebarViews = this.#availableSidebarViews();
      const initialSidebarView =
        this.#behavior.initialSidebarView === "auto"
          ? (availableSidebarViews[0] ?? null)
          : availableSidebarViews.includes(this.#behavior.initialSidebarView)
            ? this.#behavior.initialSidebarView
            : (availableSidebarViews[0] ?? null);
      this.#documentNavigation.setUntitledLabel(this.#labels.outlineUntitled);
      this.#documentOutlinePresentation = new DocumentOutlinePresentation(
        {
          sidebar: this.#sidebarContainerEl,
          content: this.#outlineContentEl,
          filter: this.#features.outline ? ui.outline.filter : null,
          filterInput: this.#features.outline ? ui.outline.filterInput : null,
        },
        {
          filterEnabled: enableOutlineFilter,
          filterLabel: this.#labels.outlineFilter,
          untitledLabel: this.#labels.outlineUntitled,
          noOutlineLabel: this.#labels.noOutline,
          preparationLabel: this.#labels.outlinePreparing,
          preparationErrorLabel: this.#labels.outlinePreparationError,
          filterOptions: this.#behavior.outlineFilterOptions,
          viewerId: this.#viewerId,
        },
        {
          select: key => this.#selectOutlineEntry(key),
          preparationStateChanged: state => this.#setPreparationState("outline", state),
          preparationCompleted: outcome => {
            this.#emitPreparationEvent(
              "pdf:outlinecomplete",
              outcome.status === "ready"
                ? { status: "ready", itemCount: outcome.itemCount }
                : {
                    status: "error",
                    itemCount: 0,
                    error: outcome.status === "error" ? outcome.error : null,
                  },
            );
            if (outcome.status === "ready" && outcome.itemCount === 0) {
              this.#outlineAvailable = false;
              this.#viewerPanels.setAvailableViews(this.#availableSidebarViews());
            }
            if (outcome.status === "ready") {
              this.#syncOutlineActive(
                this.#viewerPanels.isSidebarViewOpen("outline") ? "opening" : "selection-change",
              );
            }
          },
          isOpen: () => this.#viewerPanels.isSidebarViewOpen("outline"),
          isOverlay: () => this.#viewerPanels.isSidebarOverlay(),
          hasTouch: () => this.#hasTouch(),
          scrollBehavior: () => this.#scrollBehavior(true),
        },
      );
      this.#documentAttachmentsPresentation = new DocumentAttachmentsPresentation(
        {
          content: this.#attachmentsContentEl,
        },
        {
          preparationLabel: this.#labels.attachmentsPreparing,
          preparationErrorLabel: this.#labels.attachmentsPreparationError,
          noAttachmentsLabel: this.#labels.noAttachments,
          downloadLabel: this.#labels.attachmentDownload,
          downloadErrorLabel: this.#labels.attachmentDownloadError,
        },
        {
          preparationStateChanged: state => this.#setPreparationState("attachments", state),
          preparationCompleted: outcome => {
            this.#emitPreparationEvent(
              "pdf:attachmentscomplete",
              outcome.status === "ready"
                ? { status: "ready", itemCount: outcome.itemCount }
                : {
                    status: "error",
                    itemCount: 0,
                    error: outcome.status === "error" ? outcome.error : null,
                  },
            );
            if (outcome.status === "ready" && outcome.itemCount === 0) {
              this.#attachmentsAvailable = false;
              this.#viewerPanels.setAvailableViews(this.#availableSidebarViews());
            }
          },
          download: id => this.downloadAttachment(id),
        },
      );
      this.#documentLayers = new DocumentLayers(this.#features.layers, {
        committed: (state, renderState) => {
          this.#installRasterState(
            renderState.revision,
            this.#formAppearanceRevision,
            renderState.configurationPromise,
          );
          this.#documentLayersPresentation.ready(state);
          this.#pdfRootEl.dispatchEvent(
            new this.#ownerWindow.CustomEvent("pdf:layerschange", { detail: state }),
          );
        },
        diagnostic: entry =>
          this.#log(entry.level, entry.event, entry.message, entry.details, entry.error),
      });
      this.#documentLayersPresentation = new DocumentLayersPresentation(
        {
          content: this.#layersContentEl,
          loadingLabel: this.#labels.layersPreparing,
          emptyLabel: this.#labels.noLayers,
          errorLabel: this.#labels.layersPreparationError,
          resetLabel: this.#labels.resetLayers,
          fallbackLayerLabel: this.#labels.fallbackLayer,
          fallbackGroupLabel: this.#labels.fallbackLayerGroup,
        },
        {
          setVisibility: changes => this.setLayerVisibility(changes),
          reset: () => this.resetLayers(),
          diagnostic: error =>
            this.#log(
              "debug",
              "layers-presentation-failed",
              "Layer controls could not be updated",
              {},
              error,
            ),
        },
      );
      this.#documentThumbnails = new DocumentThumbnails(
        {
          scrollContainer: this.#thumbnailsContentEl,
          ownerDocument: this.#ownerDocument,
          coordinator: this.#rasterWorkCoordinator,
          maxDpr: normalized.thumbnails.maxDpr,
          pageLabel: pageNo => this.#formatters.thumbnailPage(pageNo),
          errorLabel: this.#labels.thumbnailError,
          scrollBehavior: () => this.#scrollBehavior(true),
        },
        this.#renderingProfiles.balanced,
        {
          selectPage: pageNo => {
            this.#scrollToPageWithHistory(pageNo, true);
            if (this.#viewerPanels.isSidebarOverlay()) this.#viewerPanels.setSidebarOpen(false);
          },
        },
      );
      this.#rasterWorkCoordinator.setAdmissionOwners(
        this.#documentRenderer,
        this.#documentThumbnails,
      );
      this.#installRasterState(0, 0);
      this.#documentThumbnails.setRotation(this.#documentView.rotation);
      const sidebarViewElements = (
        view: PdfjsViewerSidebarView,
        content: HTMLElement | null,
        extras: readonly (HTMLElement | null)[] = [],
      ): readonly HTMLElement[] => {
        const panel = content?.closest<HTMLElement>(`[data-pdf-sidebar-view="${view}"]`);
        return panel
          ? [panel]
          : [
              ...new Set(
                [content, ...extras].filter((element): element is HTMLElement => !!element),
              ),
            ];
      };
      this.#viewerPanels = new ViewerPanels(
        {
          sidebar: this.#sidebarContainerEl,
          sidebarClose: this.#sidebarCloseBtnEl,
          sidebarToggle: this.#sidebarToggleEl,
          sidebarPrimaryViews: this.#sidebarPrimaryViewsEl,
          sidebarMoreToggle: this.#sidebarMoreToggleEl,
          sidebarMoreMenu: this.#sidebarMoreMenuEl,
          sidebarViews: {
            outline: sidebarViewElements("outline", this.#outlineContentEl, [
              enableOutlineFilter ? ui.outline.filter : null,
            ]),
            thumbnails: sidebarViewElements("thumbnails", this.#thumbnailsContentEl),
            attachments: sidebarViewElements("attachments", this.#attachmentsContentEl),
            layers: sidebarViewElements("layers", this.#layersContentEl),
          },
          toolbar: {
            search: {
              panel: this.#searchPanelEl,
              toggle: this.#searchToggleBtnEl,
              close: this.#searchCloseBtnEl,
            },
            menu: {
              panel: this.#menuPanelEl,
              toggle: this.#menuToggleBtnEl,
              close: this.#menuCloseBtnEl,
            },
          },
        },
        {
          ownerDocument: this.#ownerDocument,
          sidebarMode: this.#behavior.sidebarMode,
          restoreFocus: this.#accessibility.restorePanelFocus,
          initialSidebarView,
          sidebarCloseSelector: PDFJS_VIEWER_UI_HOOKS.sidebar.close,
        },
        {
          sidebarOpened: view => {
            if (view === "outline") {
              void this.#prepareOutline();
              this.#documentOutlinePresentation.open();
            }
            if (view === "attachments") void this.#prepareAttachments();
            const thumbnailsActive = view === "thumbnails";
            this.#documentRenderer.setBackgroundRasterWaiting(thumbnailsActive);
            this.#rasterWorkCoordinator.setViewActive(thumbnailsActive);
            this.#documentThumbnails.setViewActive(thumbnailsActive);
            this.#viewerPanels.setHostActive(this.#hostActive);
            this.#scheduleContainerLayoutSync();
          },
          sidebarClosed: view => {
            if (view === "outline") this.#documentOutlinePresentation.close();
            if (view === "thumbnails") {
              this.#documentRenderer.setBackgroundRasterWaiting(false);
              this.#rasterWorkCoordinator.setViewActive(false);
              this.#documentThumbnails.setViewActive(false);
            }
            const scrollOwner =
              view === "outline"
                ? this.#outlineContentEl
                : view === "thumbnails"
                  ? this.#thumbnailsContentEl
                  : view === "attachments"
                    ? this.#attachmentsContentEl
                    : this.#layersContentEl;
            if (scrollOwner)
              this.#sidebarPointerScroll.reset(this.#sidebarPointerScrollHost(scrollOwner));
            this.#viewerPanels.setHostActive(this.#hostActive);
            this.#scheduleContainerLayoutSync();
          },
          toolbarOpened: panel => {
            if (panel === "search") {
              void this.#prepareSearchIndex();
              this.#viewerLifetime.setTimeout(() => {
                this.#searchInputEl?.focus();
                this.#searchInputEl?.select();
              }, 0);
            }
          },
          toolbarClosed: panel => {
            if (panel === "search") this.#resetSearchPanel();
          },
          beginToolbarInteraction: elements =>
            this.#documentTextPresentation.beginToolbarInteraction(elements),
          completeToolbarInteraction: token =>
            this.#documentTextPresentation.completeToolbarInteraction(token),
        },
      );
      this.#viewerPanels.setAvailableViews(availableSidebarViews, initialSidebarView);
      this.#viewerFullscreen = new ViewerFullscreen({
        root: this.#pdfRootEl,
        enabled: this.#features.fullscreen,
        callbacks: {
          stateChanged: active => this.#handleFullscreenChange(active),
          failed: result => this.#publishFullscreenFailure(result),
        },
      });
      this.#setModeClass(PDFJS_VIEWER_STATE_CLASSES.fullscreen, this.#viewerFullscreen.active);
      this.#syncModeControls();

      // --- Document progress ---
      this.#documentProgressFeedback = new DocumentProgressFeedback(
        ui.documentProgress,
        this.#labels.documentProgressError,
      );

      // --- UI wiring & initialization ---
      this.#wireUI();
      this.#on(this.#ownerWindow, "resize", this.#onResize);
      if (this.#behavior.reduceRenderingWhenDocumentHidden) {
        this.#on(this.#ownerDocument, "visibilitychange", () =>
          this.#handleDocumentVisibilityChange(),
        );
      }
      this.#syncRenderingActivity();

      // --- Set zoom scale range
      if (isLikelyMobile) {
        this.#zoomMinScale = this.#behavior.zoom.minMobile;
        this.#zoomMaxScale = this.#behavior.zoom.maxMobile;
      } else {
        this.#zoomMinScale = this.#behavior.zoom.minDesktop;
        this.#zoomMaxScale = this.#behavior.zoom.maxDesktop;
      }
      this.#documentView.configureScaleLimits(this.#zoomMinScale, this.#zoomMaxScale);

      this.#configureZoomSliderBounds();
      this.#syncZoomSliderUI();
      this.#viewerPrintSetup?.resetDocument();

      // --- Select rendering profile ---
      this.#renderingProfileSelection = opts.renderingProfile ?? "auto";
      this.#setRenderingProfile(
        resolveRenderingProfile(
          this.#renderingProfileSelection,
          this.#availableRenderingProfiles,
          this.#automaticRenderingProfile,
        ),
        true,
      );

      // Reflect chosen settings in UI controls if present
      const selectedPageLayoutRadio = pageLayoutGroup?.querySelector<HTMLInputElement>(
        `[data-pdf-page-layout="${this.#documentView.pageLayout}"]`,
      );
      if (selectedPageLayoutRadio) selectedPageLayoutRadio.checked = true;
      const selectedFitModeRadio = fitModeGroup?.querySelector<HTMLInputElement>(
        `[data-pdf-fit-mode="${this.#documentView.fitMode}"]`,
      );
      if (selectedFitModeRadio) selectedFitModeRadio.checked = true;
      this.#syncRenderingProfileControls();

      if (this.#keyboardScope === "global") {
        this.#runtimeRegistration = {
          viewerId: this.#viewerId,
          ownerWindow: this.#ownerWindow,
          handleKeyboardEvent: event => this.#handleKeyboardEvent(event),
        };
        getPdfjsViewerRuntimeAccess(this.#runtime).register(this.#runtimeRegistration);
        this.#syncRuntimeActiveViewer();
      } else if (this.#keyboardScope === "viewer") {
        this.#on(this.#pdfRootEl, "keydown", (event: Event) => {
          this.#handleKeyboardEvent(event as KeyboardEvent);
        });
      }

      // Track container-size changes caused by in-flow UI (for example a pushed
      // sidebar). DocumentView refreshes overflow, measured row geometry, and
      // render demand atomically without changing the selected canonical scale.
      if (typeof this.#ownerWindow.ResizeObserver !== "undefined") {
        this.#containerResizeObserver = new this.#ownerWindow.ResizeObserver(() =>
          this.#scheduleContainerLayoutSync(),
        );
        this.#containerResizeObserver.observe(this.#docContainerEl);
      }

      // --- Auto cleanup observer: destroys instance when removed from DOM ---
      this.#disconnectObserver = new this.#ownerWindow.MutationObserver(() => {
        if (!this.#ownerDocument.documentElement.contains(this.#pdfRootEl)) {
          this.destroy();
        }
      });
      const disconnectRoot = this.#ownerDocument.body ?? this.#ownerDocument.documentElement;
      this.#disconnectObserver.observe(disconnectRoot, { childList: true, subtree: true });

      // --- Attach the document-free viewer to its runtime ---
      getPdfjsViewerRuntimeAccess(this.#runtime).attachViewer();
      this.#runtimeAttached = true;
    } catch (error) {
      this.#rollbackConstruction();
      throw error;
    }
  }

  // --- Public lifecycle, state, and document operations ---

  /**
   * Permanently destroys this viewer and releases document, rendering, event,
   * observer, timer, and runtime-registration resources.
   *
   * Idempotent and synchronous to callers. Generated UI is removed, while the
   * host root and custom markup remain caller-owned. Detached proxy cleanup waits
   * for loading-task destruction plus captured render and preparation settlements,
   * so teardown owners do not concurrently clean the same PDF. The viewer also
   * invokes this automatically after its root is disconnected. After document
   * operations are invalidated, the full layout reset drops all document
   * geometry and surfaces. A destroyed instance cannot load another document.
   */
  public destroy(): void {
    if (this.#destroyed) return;
    this.#cancelPresentationMode(false);
    if (this.#viewerFullscreen) void this.#viewerFullscreen.exit();
    this.#viewerFullscreen?.destroy();
    this.#destroyed = true;
    this.#status = "destroyed";
    this.#cancelActiveLoad("destroyed");
    this.#setTextSelectionMode(false, false);
    const cancelled = this.#cancelDocumentWork();

    const loadingTask = this.#loadingTask;
    this.#loadingTask = null;
    const loadingSettlement = loadingTask
      ? (async () => {
          try {
            await loadingTask.destroy();
          } catch {}
        })()
      : Promise.resolve();

    this.#releaseViewerInfrastructure();
    this.#documentOutlinePresentation.destroy();
    this.#documentAttachmentsPresentation.destroy();
    this.#documentLayersPresentation.destroy();
    this.#documentLayers.destroy();
    this.#documentThumbnails.destroy();
    this.#documentTextPresentation.destroy();

    this.#documentView.resetDocument();
    this.#pdfUrl = null;
    this.#pdfFilename = null;
    this.#lastEmittedPage = 1;

    // Release PDF.js document resources if possible
    const pdf = this.#pdf;
    this.#pdf = null;
    this.#activeDocumentOptions = {};
    this.#printPermissionAllowed = true;
    this.#downloadFilledDocumentBusy = false;
    this.#syncDownloadControl();
    this.#syncFilledDocumentDownloadControl();
    this.#documentSearch.reset();
    this.#documentInformation.reset();
    this.#viewerDocumentInformation?.resetDocument();
    this.#documentAttachments.reset();
    this.#documentNavigation.reset();
    this.#documentNavigationHistory.reset();
    this.#syncNavigationHistoryControls();
    this.#searchPreparationState = "idle";
    this.#outlinePreparationState = "idle";
    this.#attachmentsPreparationState = "idle";
    this.#documentProgressFeedback.reset();
    this.#searchPreparationUpdatesUi = false;
    this.#searchMatches = [];
    this.#pendingPreparationEvents.length = 0;
    // An open setup dialog must discard its old advisory result and preflight the new profile.
    this.#viewerPrintSetup?.syncState();
    void Promise.allSettled([
      loadingSettlement,
      ...cancelled.renderSettlements,
      ...cancelled.preparationSettlements,
    ]).then(() => {
      runCleanup(() => pdf?.cleanup());
    });

    // Remove only UI created by this package. Caller-owned roots and custom UI stay intact.
    this.#zoomLimitHintEl?.remove();
    this.#zoomLimitHintEl = null;
    this.#ownedUiEl?.remove();
    this.#ownedUiEl = null;
    this.#removeOwnedViewerMarkers();

    this.#log("debug", "destroyed", "Viewer resources were released");
  }

  // --- Host visibility and rendering activity ---

  /**
   * Marks this viewer instance as active/inactive from the host application's
   * perspective.
   *
   * When inactive, the viewer keeps its internal state (e.g. sidebar open), but
   * overlay UI is forced hidden and outside-click closers are disabled so it
   * cannot interfere with other views. Effective rendering activity also becomes
   * inactive, reducing speculative buffering and offscreen raster retention.
   * Owner-document visibility contributes to rendering activity independently
   * and never changes this host-owned state.
   *
   * @param active - Whether the host currently presents this viewer as active.
   */
  public setActive(active: boolean): void {
    this.#assertAlive("setActive");
    if (typeof active !== "boolean") {
      throw new TypeError("PdfjsViewer: active must be a boolean");
    }
    const next = !!active;
    if (this.#hostActive === next) {
      this.#syncRuntimeActiveViewer(next);
      return;
    }
    if (!next) {
      this.#cancelPresentationMode(true);
      void this.#viewerFullscreen.exit();
    }
    this.#hostActive = next;
    this.#syncModeControls();
    this.#syncRuntimeActiveViewer(next);
    this.#viewerPanels.setHostActive(this.#hostActive);
    this.#syncRenderingActivity();
    const renderer = this.#documentRenderer.snapshot();
    this.#log(
      "debug",
      next ? "view-activated" : "view-deactivated",
      next ? "Viewer became active" : "Viewer became inactive",
      {
        active: next,
        renderingActive: this.#renderingActive,
        renderingProfile: this.#renderingProfile,
        scale: this.#documentView.scale,
        maxBufferViewportHeights: renderer.maxBufferViewportHeights,
        maxBufferPages: renderer.maxBufferPages,
        renderedPageCount: renderer.renderedPageCount,
        queuedPageCount: renderer.queuedPageCount,
        inFlightRenderCount: renderer.inFlightRenderCount,
      },
    );
    if (next) this.#documentNavigation.scheduleNavigationStateSync(this.#navigationHost());
    this.#emitStateChange();
  }

  /** Applies the conjunction of host activity and owner-document visibility to raster owners. */
  #syncRenderingActivity(): void {
    const next =
      this.#hostActive &&
      (!this.#behavior.reduceRenderingWhenDocumentHidden || this.#documentVisible);
    if (this.#renderingActive === next) return;
    this.#renderingActive = next;
    this.#rasterWorkCoordinator.setRenderingActive(next);
    this.#documentRenderer.setRenderingActive(next);
    if (this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
  }

  /** Reconciles raster activity without changing host-owned active state or UI ownership. */
  #handleDocumentVisibilityChange(): void {
    const visible = this.#ownerDocument.visibilityState === "visible";
    if (this.#documentVisible === visible) return;
    this.#documentVisible = visible;
    this.#syncRenderingActivity();
    const renderer = this.#documentRenderer.snapshot();
    this.#log(
      "debug",
      "document-visibility-changed",
      visible ? "Owning document became visible" : "Owning document became hidden",
      {
        visibilityState: this.#ownerDocument.visibilityState,
        hostActive: this.#hostActive,
        renderingActive: this.#renderingActive,
        maxBufferViewportHeights: renderer.maxBufferViewportHeights,
        maxBufferPages: renderer.maxBufferPages,
        renderedPageCount: renderer.renderedPageCount,
        queuedPageCount: renderer.queuedPageCount,
        inFlightRenderCount: renderer.inFlightRenderCount,
      },
    );
  }

  /** Synchronizes global-keyboard ownership with this viewer's host activity. */
  #syncRuntimeActiveViewer(active: boolean = this.#hostActive): void {
    if (this.#keyboardScope !== "global" || !this.#runtimeRegistration) return;
    const runtime = getPdfjsViewerRuntimeAccess(this.#runtime);
    if (active) runtime.activateViewer(this.#viewerId, this.#ownerWindow);
    else runtime.deactivateViewer(this.#viewerId, this.#ownerWindow);
  }

  // --- Document replacement and observable state ---

  /**
   * Replaces the current document while preserving this viewer and its UI.
   *
   * Any active load, render, search index, outline build, or navigation is
   * cancelled before the replacement starts. A persisted navigation destination
   * is read for every load and takes precedence over that call's `initialPage`.
   * State is updated before direct, non-bubbling ready/error events; the returned
   * promise settles after the corresponding event handler has run.
   *
   * @param source - URL or in-memory PDF data accepted by PDF.js.
   * @param options - Initial view intent and PDF.js options for this load.
   * @returns Exactly one ready, expected-cancellation, or terminal-error result.
   * @throws For invalid arguments or when called after {@link destroy}.
   */
  public load(
    source: PdfjsViewerSource,
    options: PdfjsViewerLoadOptions = {},
  ): Promise<PdfjsViewerLoadResult> {
    this.#assertAlive("load");
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("PdfjsViewer: load options must be an object when provided");
    }
    for (const key of Object.keys(options)) {
      if (key !== "initialPage" && key !== "documentOptions") {
        throw new TypeError(`PdfjsViewer: unknown load option ${JSON.stringify(key)}`);
      }
    }
    if (
      options.initialPage !== undefined &&
      (!Number.isSafeInteger(options.initialPage) || options.initialPage < 1)
    ) {
      throw new RangeError("PdfjsViewer: load.initialPage must be a positive safe integer");
    }
    validateDocumentOptions(options.documentOptions);
    const normalizedSource = normalizePdfSource(source);
    const documentOptions = this.#copyDocumentOptions({
      ...this.#defaultDocumentOptions,
      ...options.documentOptions,
    });
    this.#cancelActiveLoad("superseded");
    const requestGeneration = ++this.#documentRequestGeneration;
    const attempt = this.#createLoadAttempt(requestGeneration);
    this.#activeLoadAttempt = attempt;
    void this.#runLoadRequest(
      attempt,
      normalizedSource,
      options.initialPage ?? null,
      documentOptions,
    );
    return attempt.promise;
  }

  /**
   * Returns a fresh frozen snapshot of observable viewer state. Nested published
   * structures are also detached and frozen.
   */
  public get state(): Readonly<PdfjsViewerState> {
    return Object.freeze({
      status: this.#status,
      active: this.#hostActive,
      fullscreen: this.#viewerFullscreen?.active ?? false,
      canFullscreen:
        !this.#destroyed && this.#hostActive && (this.#viewerFullscreen?.canEnter ?? false),
      presentationMode: this.#presentationMode,
      canPresent:
        !this.#destroyed &&
        this.#hostActive &&
        this.#features.presentation &&
        this.#status === "ready" &&
        !!this.#pdf,
      pageCount: this.#documentView.pageCount,
      currentPage: this.#lastEmittedPage,
      canGoBack:
        this.#features.navigationHistory &&
        this.#status === "ready" &&
        this.#documentNavigationHistory.canGoBack,
      canGoForward:
        this.#features.navigationHistory &&
        this.#status === "ready" &&
        this.#documentNavigationHistory.canGoForward,
      scale: this.#documentView.scale,
      pageLayout: this.#documentView.pageLayout,
      effectivePageLayout: this.#documentView.effectivePageLayout(),
      fitMode: this.#documentView.fitMode,
      effectiveFitMode: this.#documentView.effectiveFitMode(),
      fitActive: this.#documentView.fitActive,
      rotation: this.#documentView.rotation,
      renderingProfile: this.#renderingProfileSelection,
      effectiveRenderingProfile: this.#renderingProfile,
      availableRenderingProfiles: this.#availableRenderingProfiles,
      sourceUrl: this.#pdfUrl,
      sourceFilename: this.#pdfFilename,
      canDownload: !this.#destroyed && (this.#pdfUrl !== null || this.#pdf !== null),
      canPrint:
        !this.#destroyed &&
        this.#status === "ready" &&
        this.#printPermissionAllowed &&
        !["disabled", "unavailable"].includes(this.#printRoute().route),
      print: this.#printState(),
      searchPreparation: this.#features.search ? this.#searchPreparationState : "disabled",
      outlinePreparation: this.#features.outline ? this.#outlinePreparationState : "disabled",
      attachmentsPreparation: this.#features.attachments
        ? this.#attachmentsPreparationState
        : "disabled",
      formDirty: this.#documentPresentation.formDirty,
      textSelectionMode: this.#textSelectionMode,
    });
  }

  /** Stable identity of this viewer instance for global routing and navigation-state ownership. */
  public get viewerId(): string {
    return this.#viewerId;
  }

  #printState(): Readonly<PdfjsViewerPrintState> {
    const state = this.#documentPrint.state;
    const native = nativePrintCoordinatorFor(this.#ownerWindow).diagnostics;
    const candidate: Readonly<PdfjsViewerPrintState> =
      state.phase === "invoked" && !native.active
        ? {
            phase: "idle",
            jobId: null,
            completedSheets: 0,
            totalSheets: 0,
            retainedBytes: 0,
            nativeResourcesRetained: false,
          }
        : { ...state, nativeResourcesRetained: state.phase === "invoked" && native.active };
    const previous = this.#publishedPrintState;
    if (
      previous &&
      previous.phase === candidate.phase &&
      previous.jobId === candidate.jobId &&
      previous.completedSheets === candidate.completedSheets &&
      previous.totalSheets === candidate.totalSheets &&
      previous.retainedBytes === candidate.retainedBytes &&
      previous.nativeResourcesRetained === candidate.nativeResourcesRetained
    )
      return previous;
    return (this.#publishedPrintState = Object.freeze(candidate));
  }

  /**
   * Cancels document-specific work and releases the current PDF while keeping
   * the viewer instance, UI, and permanent event listeners reusable.
   *
   * Calling this method repeatedly is safe. The viewer enters the `closed`
   * state unless it has already been destroyed.
   *
   * @returns A promise that settles after active loading/rendering has been
   * cancelled and the document is detached. If PDF.js has an uncancellable
   * text/outline read in flight, final proxy cleanup follows when that read settles.
   */
  public async close(): Promise<void> {
    this.#assertAlive("close");
    this.#cancelPresentationMode(true);
    this.#cancelActiveLoad("closed");
    const requestGeneration = ++this.#documentRequestGeneration;
    await this.#closeDocument();
    if (this.#destroyed || requestGeneration !== this.#documentRequestGeneration) return;
    this.#setSidebarDocumentAvailability(false);
    this.#setStatus("closed");
  }

  /**
   * Downloads the selected representation of the active PDF. Original URL
   * sources use their source URL without reading document bytes; every other
   * request obtains detached bytes on demand and uses a temporary Blob URL.
   *
   * Concurrent byte-backed calls with the same document variant and filename
   * share one extraction and start one download.
   *
   * @returns A discriminated activation result or expected failure. Browser
   * cross-origin and response-header policy determines whether an original URL
   * source downloads or opens in a new tab.
   */
  public async download(
    options: PdfjsViewerDownloadOptions = {},
  ): Promise<PdfjsViewerDownloadResult> {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("PdfjsViewer: download options must be an object");
    }
    for (const key of Object.keys(options)) {
      if (key !== "document" && key !== "filename")
        throw new TypeError(`PdfjsViewer: unknown download.${key} option`);
    }
    const document = options.document ?? "original";
    if (document !== "original" && document !== "with-form-values") {
      throw new RangeError("PdfjsViewer: download.document must be original or with-form-values");
    }
    if (
      options.filename !== undefined &&
      (typeof options.filename !== "string" || !options.filename.trim())
    ) {
      throw new TypeError(
        "PdfjsViewer: download.filename must be a non-empty string when provided",
      );
    }
    if (this.#destroyed) return { ok: false, reason: "destroyed" };
    if (this.#status === "closed") return { ok: false, reason: "not-ready" };
    const filename =
      options.filename?.trim() ||
      (document === "with-form-values" ? this.#filledDocumentFilename() : this.#downloadFilename());
    if (document === "original" && this.#pdfUrl) {
      this.#startBrowserDownload(this.#pdfUrl, filename, true);
      return { ok: true };
    }

    const pdf = this.#pdf;
    if (!pdf) return { ok: false, reason: "not-ready" };
    const generation = this.#documentGeneration;
    const activeOperation = [...this.#downloadOperations].find(
      operation =>
        operation.pdf === pdf &&
        operation.generation === generation &&
        operation.document === document &&
        operation.filename === filename,
    );
    if (activeOperation) {
      return activeOperation.promise;
    }

    const promise = this.#downloadDocument(pdf, generation, document, filename);
    const operation = { pdf, generation, document, filename, promise } as const;
    this.#downloadOperations.add(operation);
    void promise.then(
      () => {
        this.#downloadOperations.delete(operation);
      },
      () => {
        this.#downloadOperations.delete(operation);
      },
    );
    return promise;
  }

  /**
   * Plans viewer-controlled native printing without allocating print output.
   * Applies configured defaults, document permissions, native capabilities,
   * sheet geometry, and the active rendering profile's resource limits.
   *
   * @returns A discriminated native-print plan or expected failure. Print routes
   * other than controlled native return an `unsupported` result.
   * @throws When the supplied print options are invalid.
   */
  public async preflightPrint(
    options: PdfjsViewerPrintOptions = {},
  ): Promise<PdfjsViewerPrintPreflightResult> {
    if (this.#destroyed) return { ok: false, reason: "destroyed", sourceFallbackAvailable: false };
    const profile = this.#renderingProfile;
    const profileRevision = this.#renderingProfileRevision;
    const limits = this.#printBudgetLimits(this.#renderingProfiles[profile]);
    const requested = normalizePrintOptions(
      options,
      this.#documentView.pageCount,
      this.#printFeature.defaults,
    );
    if (requested.signal?.aborted)
      return { ok: false, reason: "cancelled", sourceFallbackAvailable: false };
    const route = this.#printRoute();
    if (route.route === "disabled")
      return { ok: false, reason: "disabled", sourceFallbackAvailable: false };
    if (this.#destroyed || this.#status !== "ready" || !this.#pdf)
      return { ok: false, reason: "not-ready", sourceFallbackAvailable: false };
    if (route.route !== "controlled-native") {
      return {
        ok: false,
        reason: "unsupported",
        sourceFallbackAvailable: route.route === "browser",
        ...(route.capabilities ? { nativeCapabilities: route.capabilities } : {}),
      };
    }
    const sourceFallbackAvailable = this.#printFeature.browserFallback;
    const normalized = this.#constrainNativePrintOptions(requested, route.capabilities!);
    if (!normalized) {
      return {
        ok: false,
        reason: "unsupported",
        sourceFallbackAvailable,
        nativeCapabilities: route.capabilities!,
      };
    }
    const pdf = this.#pdf;
    const pages = this.#documentPageUsage;
    if (!pages) return { ok: false, reason: "not-ready", sourceFallbackAvailable: false };
    const generation = this.#documentGeneration;
    const permission = await this.#resolvePrintPermission();
    if (!permission.ok)
      return { ok: false, reason: permission.reason, sourceFallbackAvailable: false };
    if (!this.#isCurrentDocument(pdf, generation) || this.#documentPageUsage !== pages) {
      return { ok: false, reason: "cancelled", sourceFallbackAvailable: false };
    }
    // A preflight result must describe the currently selected profile, not a prior async snapshot.
    if (this.#renderingProfile !== profile || this.#renderingProfileRevision !== profileRevision) {
      return { ok: false, reason: "cancelled", sourceFallbackAvailable: false };
    }
    if (!permission.allowed)
      return { ok: false, reason: "disabled", sourceFallbackAvailable: false };
    const printPermission = resolveDocumentPrintPermission(permission.information);
    const geometry = await this.#prepareNativePrintGeometry(normalized, pdf, pages, generation);
    if (!geometry) return { ok: false, reason: "cancelled", sourceFallbackAvailable: false };
    if (this.#renderingProfile !== profile || this.#renderingProfileRevision !== profileRevision) {
      return { ok: false, reason: "cancelled", sourceFallbackAvailable: false };
    }
    const layout = geometry.layout;
    const runs = geometry.runs;
    const sheetCount = countPrintSheets(runs, layout);
    const layers = this.#documentLayers.visibilitySnapshot();
    const sourceWarnings = {
      paritySensitive: layout.mode === "spread" && layout.firstPageSide === "right",
      layerWarning: !!layers?.hasLayers && layers.differsFromDefaults,
    } as const;
    let nativeCapabilities = route.capabilities!;
    if (sheetCount > limits.maxSheets) {
      return {
        ok: false,
        reason: "too-many-sheets",
        sourceFallbackAvailable,
        sheetCount,
        maxSheets: limits.maxSheets,
        nativeCapabilities,
        ...sourceWarnings,
      };
    }
    const sheetSize = resolvePrintSheetSize(
      normalized.sheet,
      normalized.orientation,
      layout,
      geometry.sizes,
    );
    const requestedDpi = resolvePermissionAwarePrintDpi(
      normalized.quality,
      printPermission.highQuality,
    );
    const selectedPages = countPrintPages(runs);
    const pureXfa = this.#documentPresentation.formPresentation === "pure-xfa";
    if (pureXfa && selectedPages > limits.maxXfaPages) {
      return {
        ok: false,
        reason: "too-large",
        sourceFallbackAvailable,
        requestedDpi,
        sheetCount,
        nativeCapabilities,
      };
    }
    const pageNumbers = geometry.pageNumbers;
    const xfa = pureXfa
      ? this.#documentPresentation.xfaPrintAdmission(pageNumbers, {
          maxPages: limits.maxXfaPages,
          maxNodes: limits.maxXfaNodes,
          maxImages: limits.maxXfaImages,
        })
      : null;
    if (xfa?.exceeded)
      return {
        ok: false,
        reason: "too-large",
        sourceFallbackAvailable,
        requestedDpi,
        sheetCount,
        nativeCapabilities,
      };
    nativeCapabilities = this.#resolveNativePrintCapabilities();
    if (nativeCapabilities.nativePrintSupport === "unsupported") {
      return {
        ok: false,
        reason: "unsupported",
        sourceFallbackAvailable,
        requestedDpi,
        sheetCount,
        nativeCapabilities,
        ...sourceWarnings,
      };
    }
    const transport = resolvePrintTransportGeometry(
      sheetSize,
      nativeCapabilities.nativePrintSupport === "portrait-and-landscape",
    );
    const fit = xfa
      ? {
          resolvedDpi: requestedDpi,
          reduced: false,
          estimate: { exceeded: [], decodedBytes: 0, estimatedRetainedBytes: 0, peakBytes: 0 },
        }
      : planPrintDpiFit(sheetCount, transport.size, requestedDpi, limits, 0);
    const context = {
      requestedDpi,
      sheetCount,
      orientation: sheetSize.width > sheetSize.height ? "landscape" : "portrait",
      layout: layout.mode === "spread" ? "spread" : "single",
      ...sourceWarnings,
      nativeCapabilities,
      sourceFallbackAvailable,
    } as const;
    this.#log("debug", "print-preflight", "Evaluated print setup", {
      ...context,
      nativeTransportSize: transport.size,
      rotatedCounterclockwise: transport.rotatedCounterclockwise,
      resolvedDpi: fit.resolvedDpi,
      exceededLimits: fit.estimate.exceeded,
      decodedBytes: fit.estimate.decodedBytes,
      estimatedRetainedBytes: fit.estimate.estimatedRetainedBytes,
      reclaimableRasterBytes: 0,
      residualRasterBytes: 0,
      profile: { id: profile, revision: profileRevision },
    });
    const noFitReason =
      !xfa && (fit.estimate.exceeded as readonly string[]).includes("memoryLimitMiB")
        ? "memory-limit"
        : "too-large";
    return fit.resolvedDpi === null
      ? { ok: false, reason: noFitReason, ...context }
      : { ok: true, resolvedDpi: fit.resolvedDpi, reduced: fit.reduced, ...context };
  }

  /**
   * Prints the active document through the configured native, browser-source,
   * or host-adapter route.
   *
   * @returns A discriminated invocation result or expected failure.
   * @throws When options are invalid, the viewer is destroyed, or a host print
   * adapter fails or returns an invalid result.
   */
  public print(options: PdfjsViewerPrintOptions = {}): Promise<PdfjsViewerPrintResult> {
    this.#assertAlive("print");
    return this.#executePrint(options, true);
  }

  async #executePrint(
    options: PdfjsViewerPrintOptions,
    logDirectRoute: boolean,
  ): Promise<PdfjsViewerPrintResult> {
    const profile = this.#renderingProfile;
    const profileRevision = this.#renderingProfileRevision;
    const limits = this.#printBudgetLimits(this.#renderingProfiles[profile]);
    const requestedOptions = normalizePrintOptions(
      options,
      this.#documentView.pageCount,
      this.#printFeature.defaults,
    );
    if (requestedOptions.signal?.aborted) return { ok: false, reason: "cancelled" };
    const route = this.#printRoute();
    if (logDirectRoute) this.#logPrintRoute("public-api", route);
    if (route.route === "disabled") return { ok: false, reason: "disabled" };
    if (route.route === "unavailable") return { ok: false, reason: "unsupported" };
    if (this.#destroyed || this.#status !== "ready" || !this.#pdf)
      return { ok: false, reason: "not-ready" };
    if (route.route === "browser")
      return this.openPrintSource({ document: "auto", print: requestedOptions });
    const pdf = this.#pdf;
    if (route.route === "adapter") return this.#printWithAdapter(requestedOptions, pdf);
    const normalizedOptions = this.#constrainNativePrintOptions(
      requestedOptions,
      route.capabilities!,
    );
    if (!normalizedOptions) return { ok: false, reason: "unsupported" };
    const pages = this.#documentPageUsage;
    if (!pages) return { ok: false, reason: "not-ready" };
    const generation = this.#documentGeneration;
    if (this.#controlledPrintAdmission || this.#documentPrint.state.phase !== "idle")
      return { ok: false, reason: "cancelled" };
    const admission = Object.freeze({ generation });
    this.#controlledPrintAdmission = admission;
    const sourceFallbackAvailable = this.#printFeature.browserFallback;
    this.#closeTransientUi();
    try {
      const permission = await this.#resolvePrintPermission();
      if (!permission.ok) return { ok: false, reason: permission.reason };
      if (!this.#isCurrentDocument(pdf, generation) || this.#documentPageUsage !== pages) {
        return { ok: false, reason: "cancelled" };
      }
      if (!permission.allowed) return { ok: false, reason: "disabled" };
      const geometry = await this.#prepareNativePrintGeometry(
        normalizedOptions,
        pdf,
        pages,
        generation,
      );
      if (!geometry) return { ok: false, reason: "cancelled" };
      const layout = geometry.layout;
      const runs = geometry.runs;
      const sheetCount = countPrintSheets(runs, layout);
      if (this.#resolveNativePrintCapabilities().nativePrintSupport === "unsupported") {
        return { ok: false, reason: "unsupported" };
      }
      const selectedPages = countPrintPages(runs);
      const pureXfa = this.#documentPresentation.formPresentation === "pure-xfa";
      if (sheetCount > limits.maxSheets) {
        return {
          ok: false,
          reason: "too-many-sheets",
          sheetCount,
          maxSheets: limits.maxSheets,
          sourceFallbackAvailable,
        };
      }
      if (pureXfa && selectedPages > limits.maxXfaPages) {
        return {
          ok: false,
          reason: "too-large",
          estimatedSheetCount: sheetCount,
          sourceFallbackAvailable,
        };
      }
      const xfaAdmission = pureXfa
        ? this.#documentPresentation.xfaPrintAdmission(geometry.pageNumbers, {
            maxPages: limits.maxXfaPages,
            maxNodes: limits.maxXfaNodes,
            maxImages: limits.maxXfaImages,
          })
        : null;
      if (xfaAdmission?.exceeded) {
        return {
          ok: false,
          reason: "too-large",
          estimatedSheetCount: sheetCount,
          sourceFallbackAvailable,
        };
      }
      const layerVisibility = this.#documentLayers.visibilitySnapshot();
      const formStorageSnapshot =
        this.#documentPresentation.nativePrintStorage() ?? pdf.annotationStorage.print;
      const formRevision = this.#documentPresentation.formRevision;
      const revisions = Object.freeze({
        document: generation,
        layers: layerVisibility?.revision ?? null,
        forms: formRevision,
        geometry: geometry.revision,
      });
      if (xfaAdmission && this.#documentPresentation.formRevision !== formRevision) {
        return { ok: false, reason: "cancelled" };
      }
      const xfaSnapshot = xfaAdmission
        ? this.#documentPresentation.xfaPrintSnapshot(xfaAdmission)
        : null;
      return await this.#documentPrint.print(normalizedOptions, {
        pdf,
        pages,
        information: permission.information,
        geometry,
        layerVisibility,
        formStorageSnapshot,
        xfaSnapshot,
        revisions,
        AnnotationMode: this.#pdfjs.AnnotationMode,
        XfaLayer: this.#features.forms.xfa ? this.#pdfjs.XfaLayer : undefined,
        signal: this.#documentLifetime.signal,
        window: this.#ownerWindow,
        nativeCapabilities: () => this.#resolveNativePrintCapabilities(),
        sourceFallbackAvailable,
        evictMainRasterOutputs: () => this.#documentRenderer.evictOutputsForExclusiveWork(),
        residualRasterBytes: () =>
          this.#documentRenderer.rasterBytesForExclusiveWork() +
          this.#documentThumbnails.rasterBytesForExclusiveWork(),
        evictThumbnailBackingStores: () =>
          this.#documentThumbnails.evictBackingStoresForExclusiveWork(),
        limits,
        profile: Object.freeze({ id: profile, revision: profileRevision }),
      });
    } finally {
      if (this.#controlledPrintAdmission === admission) this.#controlledPrintAdmission = null;
    }
  }

  #resolveNativePrintCapabilities(): Readonly<PdfjsViewerNativePrintCapabilities> {
    return nativePrintCapabilitiesFor(this.#ownerWindow, this.#deviceCompatibility);
  }

  /** Applies the resolved device policy before native geometry preparation. */
  #constrainNativePrintOptions(
    options: PdfjsViewerNormalizedPrintOptions,
    capabilities: Readonly<PdfjsViewerNativePrintCapabilities>,
  ): PdfjsViewerNormalizedPrintOptions | null {
    if (capabilities.nativePrintSupport === "unsupported") return null;
    return options;
  }

  #printRoute(): Readonly<ViewerPrintRouteDecision> {
    const mode = this.#printFeature.mode;
    const capabilities = mode === "native" ? this.#resolveNativePrintCapabilities() : null;
    return resolveViewerPrintRoute(mode, capabilities, this.#printFeature.browserFallback);
  }

  #logPrintRoute(trigger: "button" | "public-api", route = this.#printRoute()): void {
    this.#log("debug", "print-route-selected", "Selected print route", {
      trigger,
      configuredMode: route.configuredMode,
      route: route.route,
      fallback: route.fallback,
      browserFallback: this.#printFeature.browserFallback,
      reason: route.reason,
      capabilities: route.capabilities,
    });
  }

  async #printWithAdapter(
    normalizedOptions: PdfjsViewerNormalizedPrintOptions,
    pdf: PDFJS.PDFDocumentProxy,
  ): Promise<PdfjsViewerPrintResult> {
    const adapter = this.#printAdapter;
    if (!adapter) throw new Error("PdfjsViewer: adapter print route has no printAdapter");
    const generation = this.#documentGeneration;
    const documentSignal = this.#documentLifetime.signal;
    const formDirty = this.#documentPresentation.formDirty;
    const admittedFormData = formDirty
      ? this.#documentPresentation.exportDocumentWithFormValues()
      : null;
    void admittedFormData?.catch(() => {});
    this.#closeTransientUi();
    const permission = await this.#resolvePrintPermission();
    if (!permission.ok) return { ok: false, reason: permission.reason };
    if (!this.#isCurrentDocument(pdf, generation)) return { ok: false, reason: "cancelled" };
    if (!permission.allowed) return { ok: false, reason: "disabled" };
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:printstart", {
        detail: { kind: "adapter" } satisfies PdfjsViewerPrintStartDetail,
      }),
    );
    let result: PdfjsViewerPrintAdapterResult;
    try {
      result = await adapter({
        viewer: this,
        sourceUrl: this.#pdfUrl,
        sourceFilename: this.#pdfFilename,
        options: normalizedOptions,
        formDirty,
        getDocumentData: async ({ document: choice }) => {
          if (choice !== "original" && choice !== "with-form-values") {
            throw new RangeError(
              "PdfjsViewer: print document data choice must be original or with-form-values",
            );
          }
          if (!this.#isCurrentDocument(pdf, generation))
            throw new DOMException("The print document was replaced or closed", "AbortError");
          if (choice === "with-form-values" && formDirty) {
            const data = await admittedFormData;
            if (!data || !this.#isCurrentDocument(pdf, generation))
              throw new DOMException("The print document was replaced or closed", "AbortError");
            return Uint8Array.from(data);
          }
          const data = await this.#waitForDocumentValue(
            this.#readDocumentData(pdf),
            documentSignal,
          );
          if (!data || !this.#isCurrentDocument(pdf, generation))
            throw new DOMException("The print document was replaced or closed", "AbortError");
          return Uint8Array.from(data);
        },
        rootEl: this.#pdfRootEl,
      });
    } finally {
      this.#pdfRootEl.dispatchEvent(
        new this.#ownerWindow.CustomEvent("pdf:printcleanup", {
          detail: { kind: "adapter" } satisfies PdfjsViewerPrintCleanupDetail,
        }),
      );
    }
    if (normalizedOptions.signal?.aborted || !this.#isCurrentDocument(pdf, generation))
      return { ok: false, reason: "cancelled" };
    if (!result || result.status !== "adapter-completed")
      throw new TypeError('PdfjsViewer: printAdapter must return { status: "adapter-completed" }');
    if (
      result.sheetCount !== undefined &&
      (!Number.isInteger(result.sheetCount) || result.sheetCount < 1)
    ) {
      throw new RangeError(
        "PdfjsViewer: printAdapter sheetCount must be a positive integer when provided",
      );
    }
    return result.sheetCount === undefined
      ? { ok: true, status: "adapter-completed" }
      : { ok: true, status: "adapter-completed", sheetCount: result.sheetCount };
  }

  #closeTransientUi(): HTMLElement | null {
    const active = this.#ownerDocument.activeElement as HTMLElement | null;
    const opener = active && this.#menuPanelEl?.contains(active) ? this.#menuToggleBtnEl : active;
    this.#viewerPanels?.toggleToolbar("menu", false, false);
    return opener;
  }

  async #resolvePrintPermission(): Promise<
    | { ok: true; allowed: boolean; information: PdfjsViewerDocumentInformation }
    | { ok: false; reason: "not-ready" | "cancelled" }
  > {
    const result = await this.#documentInformation.getInformation(this.#informationHost());
    if (!result.ok)
      return { ok: false, reason: result.reason === "not-ready" ? "not-ready" : "cancelled" };
    const { allowed } = resolveDocumentPrintPermission(result.information);
    if (this.#printPermissionAllowed !== allowed) {
      this.#printPermissionAllowed = allowed;
      this.#emitStateChange();
    }
    return { ok: true, allowed, information: result.information };
  }

  /** Explicitly opens original/current-value bytes in the browser PDF handler. */
  public async openPrintSource(
    options: PdfjsViewerPrintSourceOptions = {},
  ): Promise<PdfjsViewerPrintSourceResult> {
    this.#assertAlive("openPrintSource");
    this.#closeTransientUi();
    if (options === null || typeof options !== "object" || Array.isArray(options))
      throw new TypeError("PdfjsViewer: print source options must be an object");
    for (const key of Object.keys(options))
      if (!["document", "navigation", "print"].includes(key))
        throw new TypeError(`PdfjsViewer: unknown print source.${key} option`);
    const choice = options.document ?? "auto";
    if (!["auto", "original", "with-form-values"].includes(choice))
      throw new RangeError(
        "PdfjsViewer: print source document must be auto, original, or with-form-values",
      );
    const navigation = options.navigation ?? "auto";
    if (!["auto", "direct", "materialize"].includes(navigation))
      throw new RangeError(
        "PdfjsViewer: print source navigation must be auto, direct, or materialize",
      );
    const normalizedPrint = options.print
      ? normalizePrintOptions(
          options.print,
          this.#documentView.pageCount,
          this.#printFeature.defaults,
        )
      : null;
    const route = this.#printRoute();
    if (
      route.route === "disabled" ||
      route.route === "unavailable" ||
      (this.#printFeature.mode === "native" && !this.#printFeature.browserFallback)
    ) {
      return { ok: false, reason: "disabled" };
    }
    if (this.#destroyed || this.#status !== "ready" || !this.#pdf)
      return { ok: false, reason: "not-ready" };
    const win = this.#ownerWindow;
    const child = win.open("about:blank", "_blank");
    if (!child) return { ok: false, reason: "popup-blocked" };
    try {
      child.opener = null;
    } catch {
      /* Browser may prevent opener mutation. */
    }
    const resolved =
      choice === "auto"
        ? this.#documentPresentation.formDirty
          ? "with-form-values"
          : "original"
        : choice;
    const admittedPdf = this.#pdf;
    const admittedGeneration = this.#documentGeneration;
    const admittedFormRevision = this.#documentPresentation.formRevision;
    const warnings: PdfjsViewerPrintSourceWarning[] = [];
    if (normalizedPrint) {
      if (normalizedPrint.pages !== "all") warnings.push("custom-range-lost");
      const geometry = this.#documentView.printGeometrySnapshot();
      const exactSizes = selectedPrintRuns(
        normalizedPrint.pages,
        this.#documentView.pageCount,
      ).flatMap(run =>
        Array.from({ length: run.to - run.from + 1 }, (_, index) =>
          geometry.exactSizeFor(run.from + index),
        ),
      );
      const printLayout = resolvePrintLayout(
        normalizedPrint.layout,
        geometry.preferredLayout,
        exactSizes,
        normalizedPrint.sheet,
        normalizedPrint.orientation,
      );
      const preferredSpreadGeometryMissing =
        normalizedPrint.layout.mode === "auto" &&
        (geometry.preferredLayout === "two-left" || geometry.preferredLayout === "two-right") &&
        exactSizes.some(size => size === null);
      if (printLayout.mode === "spread" || preferredSpreadGeometryMissing)
        warnings.push("spread-parity-lost");
    }
    const layers = this.#documentLayers.visibilitySnapshot();
    if (layers?.hasLayers && layers.differsFromDefaults) warnings.push("layer-state-lost");
    try {
      const permission = await this.#resolvePrintPermission();
      if (!permission.ok) {
        child.close();
        return { ok: false, reason: permission.reason };
      }
      if (!permission.allowed) {
        child.close();
        return { ok: false, reason: "disabled" };
      }
      if (
        !this.#isCurrentDocument(admittedPdf, admittedGeneration) ||
        this.#documentPresentation.formRevision !== admittedFormRevision
      ) {
        child.close();
        return { ok: false, reason: "cancelled" };
      }
      const authenticated =
        !!Object.keys(this.#activeDocumentOptions.httpHeaders ?? {}).length ||
        this.#activeDocumentOptions.withCredentials === true;
      let resolvedByHost: string | Uint8Array | ArrayBuffer | null = null;
      if (this.#printSourceResolver && this.#pdfUrl) {
        resolvedByHost = await this.#printSourceResolver({
          sourceUrl: this.#pdfUrl,
          authenticated,
          document: resolved,
        });
      }
      const directAllowed =
        navigation !== "materialize" && (!authenticated || typeof resolvedByHost === "string");
      const sourceCandidate = typeof resolvedByHost === "string" ? resolvedByHost : this.#pdfUrl;
      const sourceUrl =
        resolved === "original" && directAllowed && sourceCandidate
          ? safePrintSourceUrl(sourceCandidate, win.document.baseURI)
          : null;
      if (navigation === "direct" && !sourceUrl) {
        child.close();
        return { ok: false, reason: "unsupported" };
      }
      if (sourceUrl) {
        child.location.replace(sourceUrl);
        return { ok: true, status: "source-opened", warnings: Object.freeze(warnings) };
      }
      let data: Uint8Array;
      if (resolvedByHost instanceof Uint8Array || resolvedByHost instanceof ArrayBuffer) {
        data = Uint8Array.from(new Uint8Array(resolvedByHost));
      } else {
        const documentData = await this.getDocumentData({ document: resolved });
        if (!documentData.ok) {
          child.close();
          if (documentData.reason === "error")
            return { ok: false, reason: "export-failed", error: documentData.error };
          if (documentData.reason === "not-ready" || documentData.reason === "disabled")
            return { ok: false, reason: documentData.reason };
          return { ok: false, reason: "cancelled" };
        }
        data = documentData.data;
      }
      const url = (win as ViewerWindow).URL.createObjectURL(
        new (win as ViewerWindow).Blob([data as BlobPart], { type: "application/pdf" }),
      );
      child.location.replace(url);
      retainPrintSourceUrl(win, child, url);
      return { ok: true, status: "source-opened", warnings: Object.freeze(warnings) };
    } catch (error) {
      child.close();
      return { ok: false, reason: "export-failed", error };
    }
  }

  // --- Public document-data queries ---

  /**
   * Returns detached original or current-form-value bytes for the active PDF.
   * Concurrent reads join package-owned extraction while each successful caller
   * receives its own byte array.
   */
  public async getDocumentData(
    options: PdfjsViewerDocumentDataOptions = {},
  ): Promise<PdfjsViewerDocumentDataResult> {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("PdfjsViewer: document data options must be an object");
    }
    for (const key of Object.keys(options)) {
      if (key !== "document")
        throw new TypeError(`PdfjsViewer: unknown document data.${key} option`);
    }
    const document = options.document ?? "original";
    if (document !== "original" && document !== "with-form-values") {
      throw new RangeError(
        "PdfjsViewer: document data document must be original or with-form-values",
      );
    }
    if (this.#destroyed) return { ok: false, reason: "destroyed" };
    if (document === "with-form-values" && !this.#features.forms.interactive) {
      return { ok: false, reason: "disabled" };
    }
    const pdf = this.#pdf;
    if (this.#status !== "ready" || !pdf) return { ok: false, reason: "not-ready" };
    const generation = this.#documentGeneration;
    try {
      const source =
        document === "with-form-values" && this.#documentPresentation.formDirty
          ? this.#documentPresentation.exportDocumentWithFormValues()
          : this.#readDocumentData(pdf);
      const data = await this.#waitForDocumentValue(source, this.#documentLifetime.signal);
      if (!data || !this.#isCurrentDocument(pdf, generation))
        return { ok: false, reason: "cancelled" };
      return { ok: true, data: Uint8Array.from(data) };
    } catch (error) {
      return { ok: false, reason: "error", error };
    }
  }

  /**
   * Returns normalized metadata, identifiers, permissions, and document-format
   * capabilities for the active PDF. Concurrent calls share one PDF.js read;
   * each successful result is a fresh detached snapshot.
   */
  public getDocumentInformation(): Promise<PdfjsViewerDocumentInformationResult> {
    return this.#documentInformation.getInformation(this.#informationHost());
  }

  /**
   * Replaces every runtime UI-text override with a new immutable effective map.
   * Omitted labels and formatters always return to the built-in English defaults.
   */
  public setUiText(options: PdfjsViewerUiTextOptions): void {
    this.#assertAlive("setUiText");
    const text = normalizeUiTextOptions(options);
    this.#labels = text.labels;
    this.#formatters = text.formatters;
    if (this.#ownedUiEl) refreshGeneratedUiText(this.#ownedUiEl, this.#labels);
    this.#viewerPrintSetup?.setUiText(this.#labels, this.#formatters);
    this.#viewerDocumentInformation?.setUiText(
      this.#labels,
      this.#formatters.documentInformationDate,
    );
    this.#documentNavigation.setUntitledLabel(this.#labels.outlineUntitled);
    this.#documentOutlinePresentation.setUiText({
      filterLabel: this.#labels.outlineFilter,
      untitledLabel: this.#labels.outlineUntitled,
      noOutlineLabel: this.#labels.noOutline,
      preparationLabel: this.#labels.outlinePreparing,
      preparationErrorLabel: this.#labels.outlinePreparationError,
    });
    this.#documentAttachmentsPresentation.setUiText({
      preparationLabel: this.#labels.attachmentsPreparing,
      preparationErrorLabel: this.#labels.attachmentsPreparationError,
      noAttachmentsLabel: this.#labels.noAttachments,
      downloadLabel: this.#labels.attachmentDownload,
      downloadErrorLabel: this.#labels.attachmentDownloadError,
    });
    this.#documentLayersPresentation.setUiText({
      loadingLabel: this.#labels.layersPreparing,
      emptyLabel: this.#labels.noLayers,
      errorLabel: this.#labels.layersPreparationError,
      resetLabel: this.#labels.resetLayers,
      fallbackLayerLabel: this.#labels.fallbackLayer,
      fallbackGroupLabel: this.#labels.fallbackLayerGroup,
    });
    this.#documentThumbnails.setUiText(this.#formatters.thumbnailPage, this.#labels.thumbnailError);
    this.#documentPresentation.setUiText({
      annotationLinkLabel: this.#labels.annotationLink,
      annotationCommentLabel: this.#labels.annotationComment,
      annotationAttachmentLabel: this.#labels.annotationAttachment,
      annotationAttachmentErrorLabel: this.#labels.annotationAttachmentError,
      xfaUnavailableLabel: this.#labels.xfaUnavailable,
      xfaHybridFallbackLabel: this.#labels.xfaHybridFallback,
    });
    this.#documentProgressFeedback.setUiText(this.#labels.documentProgressError);
    this.#updateSearchCount();
    this.#syncZoomSliderUI();
    this.#syncModeControls();
  }

  /** Returns detached metadata for document-level embedded files without opening the sidebar. */
  public async getAttachments(): Promise<PdfjsViewerAttachmentsResult> {
    if (this.#destroyed) return { ok: false, reason: "destroyed" };
    if (!this.#features.attachments) return { ok: false, reason: "disabled" };
    if (this.#status !== "ready" || !this.#pdf) return { ok: false, reason: "not-ready" };
    void this.#prepareAttachments();
    return this.#documentAttachments.getAttachments(this.#attachmentsHost());
  }

  /** Returns the current detached optional-content tree without opening the sidebar. */
  public getLayers(): PdfjsViewerLayersResult {
    if (this.#destroyed) return { ok: false, reason: "destroyed" };
    if (!this.#features.layers) return { ok: false, reason: "disabled" };
    if (this.#status !== "ready" || !this.#pdf) return { ok: false, reason: "not-ready" };
    return this.#documentLayers.getLayers();
  }

  /** Applies one atomic optional-content visibility transaction. */
  public setLayerVisibility(
    changes: readonly PdfjsViewerLayerVisibilityChange[],
  ): Promise<PdfjsViewerLayerMutationResult> {
    this.#assertAlive("setLayerVisibility");
    if (!Array.isArray(changes))
      throw new TypeError("PdfjsViewer: layer visibility changes must be an array");
    const detached = changes.map((change, index) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) {
        throw new TypeError(`PdfjsViewer: layer visibility changes[${index}] must be an object`);
      }
      if (typeof change.id !== "string" || !change.id) {
        throw new TypeError(
          `PdfjsViewer: layer visibility changes[${index}].id must be a non-empty string`,
        );
      }
      if (typeof change.visible !== "boolean") {
        throw new TypeError(
          `PdfjsViewer: layer visibility changes[${index}].visible must be a boolean`,
        );
      }
      return Object.freeze({ id: change.id, visible: change.visible });
    });
    if (this.#destroyed) return Promise.resolve({ ok: false, reason: "destroyed" });
    if (!this.#features.layers) return Promise.resolve({ ok: false, reason: "disabled" });
    if (this.#status !== "ready" || !this.#pdf)
      return Promise.resolve({ ok: false, reason: "not-ready" });
    return this.#documentLayers.setVisibility(detached);
  }

  /** Restores optional-content visibility loaded from the PDF display intent. */
  public resetLayers(): Promise<PdfjsViewerLayerMutationResult> {
    this.#assertAlive("resetLayers");
    if (this.#destroyed) return Promise.resolve({ ok: false, reason: "destroyed" });
    if (!this.#features.layers) return Promise.resolve({ ok: false, reason: "disabled" });
    if (this.#status !== "ready" || !this.#pdf)
      return Promise.resolve({ ok: false, reason: "not-ready" });
    return this.#documentLayers.resetLayers();
  }

  /** Restores every interactive form field to its visible value at document load. */
  public resetForms(): Promise<PdfjsViewerFormResetResult> {
    this.#assertAlive("resetForms");
    if (this.#destroyed) return Promise.resolve({ ok: false, reason: "destroyed" });
    if (!this.#features.forms.interactive)
      return Promise.resolve({ ok: false, reason: "disabled" });
    if (this.#status !== "ready" || !this.#pdf)
      return Promise.resolve({ ok: false, reason: "not-ready" });
    return Promise.resolve(
      this.#documentPresentation.resetForms()
        ? { ok: true, formDirty: false }
        : { ok: false, reason: "not-ready" },
    );
  }

  /** Lazily reads and downloads one attachment identified by {@link getAttachments}. */
  public async downloadAttachment(id: string): Promise<PdfjsViewerAttachmentDownloadResult> {
    this.#assertAlive("downloadAttachment");
    if (typeof id !== "string" || !id) {
      throw new TypeError("PdfjsViewer: attachment id must be a non-empty string");
    }
    if (this.#destroyed) return { ok: false, reason: "destroyed" };
    if (!this.#features.attachments) return { ok: false, reason: "disabled" };
    const pdf = this.#pdf;
    if (this.#status !== "ready" || !pdf) return { ok: false, reason: "not-ready" };
    const generation = this.#documentGeneration;
    const outcome = await this.#documentAttachments.getContent(this.#attachmentsHost(), id);
    if (outcome.status === "cancelled" || !this.#isCurrentDocument(pdf, generation)) {
      return { ok: false, reason: "cancelled" };
    }
    if (outcome.status === "not-found" || outcome.status === "unavailable") {
      return { ok: false, reason: outcome.status };
    }
    if (outcome.status === "error") return { ok: false, reason: "error", error: outcome.error };

    const blobData: BlobPart =
      outcome.content.buffer instanceof ArrayBuffer
        ? new Uint8Array(
            outcome.content.buffer,
            outcome.content.byteOffset,
            outcome.content.byteLength,
          )
        : Uint8Array.from(outcome.content);
    const objectUrl = this.#ownerWindow.URL.createObjectURL(
      new this.#ownerWindow.Blob([blobData], { type: "application/octet-stream" }),
    );
    try {
      if (!this.#isCurrentDocument(pdf, generation)) return { ok: false, reason: "cancelled" };
      this.#startBrowserDownload(objectUrl, outcome.attachment.filename);
      return { ok: true };
    } finally {
      this.#ownerWindow.setTimeout(() => this.#ownerWindow.URL.revokeObjectURL(objectUrl), 0);
    }
  }

  /**
   * Searches the active document without opening or mutating the search UI.
   * The text index is prepared on demand and reused by later UI or API queries.
   *
   * @param query - Non-empty query. Unlike live UI typing, one-character queries are allowed.
   * @param options - Query-time case and diacritic policy; retained text is not rebuilt.
   * @returns Detached matches in page and source-text order, or a structured expected failure.
   */
  public async search(
    query: string,
    options: PdfjsViewerTextQueryOptions = {},
  ): Promise<PdfjsViewerSearchResult> {
    if (typeof query !== "string" || !query.trim()) {
      throw new TypeError("PdfjsViewer: search query must be a non-empty string");
    }
    // Route API preparation through the UI lifecycle so completion events retain
    // their established timing even when no search panel has been opened.
    if (!this.#destroyed && this.#features.search && this.#status === "ready" && this.#pdf) {
      void this.#prepareSearchIndex(false);
    }
    return this.#documentSearch.search(this.#searchHost(), query, options);
  }

  /**
   * Returns the active document's resolved hierarchical outline without opening
   * the sidebar. Outline preparation is shared with UI demand. An optional
   * title query returns matching items and ancestors of matching descendants.
   */
  public async getOutline(
    options: PdfjsViewerOutlineQueryOptions = {},
  ): Promise<PdfjsViewerOutlineResult> {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("PdfjsViewer: outline query options must be an object");
    }
    if (options.query !== undefined && typeof options.query !== "string") {
      throw new TypeError("PdfjsViewer: outline query options.query must be a string");
    }
    const matching = normalizeTextQueryOptions(
      options,
      this.#behavior.outlineFilterOptions,
      "outline query options",
      ["query"],
    );
    if (this.#destroyed) return { ok: false, reason: "destroyed" };
    if (!this.#features.outline) return { ok: false, reason: "disabled" };
    if (this.#status !== "ready" || !this.#pdf) return { ok: false, reason: "not-ready" };
    // API and UI demand join one model preparation and one facade presentation.
    void this.#prepareOutline();
    return this.#documentNavigation.getOutline(
      this.#navigationHost(),
      options.query?.trim() ?? "",
      matching,
    );
  }

  // --- Fullscreen and presentation modes ---

  /** Requests standard browser fullscreen for this viewer's exact root. */
  public async enterFullscreen(): Promise<PdfjsViewerFullscreenResult> {
    this.#assertAlive("enterFullscreen");
    if (!this.#hostActive) return this.#fullscreenFailure("not-active");
    return this.#mapFullscreenResult(await this.#viewerFullscreen.enter());
  }

  /** Exits standard browser fullscreen only when this viewer's exact root owns it. */
  public async exitFullscreen(): Promise<PdfjsViewerFullscreenResult> {
    this.#assertAlive("exitFullscreen");
    if (!this.#viewerFullscreen.active) {
      return Object.freeze({ ok: true, fullscreen: false });
    }
    return this.#mapFullscreenResult(await this.#viewerFullscreen.exit());
  }

  /** Toggles exact-root standard browser fullscreen. */
  public toggleFullscreen(): Promise<PdfjsViewerFullscreenResult> {
    this.#assertAlive("toggleFullscreen");
    return this.#viewerFullscreen.active ? this.exitFullscreen() : this.enterFullscreen();
  }

  /** Enters discrete-page presentation mode and opportunistically requests fullscreen. */
  public async enterPresentationMode(): Promise<PdfjsViewerPresentationModeResult> {
    this.#assertAlive("enterPresentationMode");
    if (!this.#features.presentation) return this.#presentationFailure("disabled");
    if (!this.#hostActive) return this.#presentationFailure("not-active");
    if (this.#status !== "ready" || !this.#pdf) return this.#presentationFailure("not-ready");
    if (this.#presentationMode) return this.#presentationSuccess(true);

    const releaseViewTransition = this.#beginPresentationViewTransition();
    try {
      const operation = ++this.#presentationOperationGeneration;
      const documentGeneration = this.#documentGeneration;
      const viewSnapshot = this.#documentView.capturePresentationSnapshot();
      const keepPage = Math.min(
        this.#documentView.pageCount,
        Math.max(1, this.#documentView.viewportPosition(this.#lastEmittedPage).pageNo),
      );
      this.#presentationPageAnchor = keepPage;
      this.#scrollRequestGeneration++;
      this.#cancelSmoothNavigation();
      this.#presentationSnapshot = Object.freeze({
        documentGeneration,
        entryPage: keepPage,
        view: viewSnapshot,
      });
      this.#presentationFocusReturn =
        this.#ownerDocument.activeElement instanceof this.#ownerWindow.HTMLElement
          ? (this.#ownerDocument.activeElement as HTMLElement)
          : this.#presentationToggleBtnEl;
      this.#presentationMode = true;
      this.#presentationInput.setActive(true);
      this.#viewerPanels.setPresentationSuppressed(true);
      if (
        this.#presentationFocusReturn &&
        !this.#docContainerEl.contains(this.#presentationFocusReturn) &&
        !this.#presentationInput.contains(this.#presentationFocusReturn)
      ) {
        this.#docContainerEl.focus({ preventScroll: true });
      }
      this.#setModeClass(PDFJS_VIEWER_STATE_CLASSES.presentationMode, true);
      this.#documentView.setPresentationViewport(true);
      this.#docContainerEl.style.touchAction = "none";
      this.#abortTransientZoomForLayoutChange();
      this.#pointerScroll.reset(this.#pointerScrollHost());
      this.#presentationInput.showControls(true);
      this.#syncModeControls();
      this.#publishPresentationChange();

      const wasFullscreen = this.#viewerFullscreen.active;
      this.#presentationFullscreenRequested =
        !wasFullscreen && this.#features.fullscreen && this.#viewerFullscreen.canEnter;
      const fullscreenPromise = this.#presentationFullscreenRequested
        ? this.#viewerFullscreen.enter()
        : Promise.resolve<ViewerFullscreenResult>(
            wasFullscreen
              ? Object.freeze({ status: "active", active: true })
              : Object.freeze({ status: "unavailable", active: false }),
          );
      this.#presentationFullscreenPromise = fullscreenPromise;

      try {
        await this.#performViewOperation({
          pageLayout: "single",
          fitMode: "contain",
          refit: true,
          keepPage,
        });
        if (!this.#isCurrentPresentationOperation(operation, documentGeneration)) {
          return this.#presentationFailure("cancelled");
        }
        this.#scrollToPage(keepPage, false, false);
        await fullscreenPromise;
        if (this.#presentationFullscreenPromise === fullscreenPromise) {
          this.#presentationFullscreenPromise = null;
        }
        if (!this.#isCurrentPresentationOperation(operation, documentGeneration)) {
          return this.#presentationFailure("cancelled");
        }
        this.#presentationFullscreenRequested = false;
        this.#syncModeControls();
        return this.#presentationSuccess(true);
      } catch (cause) {
        if (this.#isCurrentPresentationOperation(operation, documentGeneration)) {
          await this.#exitPresentationModeInternal(true, true);
        }
        return this.#presentationFailure("cancelled", cause);
      }
    } finally {
      releaseViewTransition();
    }
  }

  /** Exits presentation mode and restores the pre-presentation view transaction. */
  public exitPresentationMode(): Promise<PdfjsViewerPresentationModeResult> {
    this.#assertAlive("exitPresentationMode");
    if (!this.#presentationMode) return Promise.resolve(this.#presentationSuccess(false));
    return this.#exitPresentationModeInternal(true, true);
  }

  /** Toggles discrete-page presentation mode. */
  public togglePresentationMode(): Promise<PdfjsViewerPresentationModeResult> {
    this.#assertAlive("togglePresentationMode");
    return this.#presentationMode ? this.exitPresentationMode() : this.enterPresentationMode();
  }

  async #exitPresentationModeInternal(
    restore: boolean,
    exitFullscreen: boolean,
  ): Promise<PdfjsViewerPresentationModeResult> {
    if (!this.#presentationMode) return this.#presentationSuccess(false);
    const releaseViewTransition = this.#beginPresentationViewTransition();
    try {
      const operation = ++this.#presentationOperationGeneration;
      const saved = this.#presentationSnapshot;
      const presentationPage =
        this.#presentationPageAnchor ??
        this.#documentView.captureDocumentLocation()?.page ??
        this.#lastEmittedPage;
      this.#cancelPendingPresentationFullscreenRequest();
      this.#presentationMode = false;
      this.#presentationInput.setActive(false);
      this.#presentationFullscreenRequested = false;
      this.#setModeClass(PDFJS_VIEWER_STATE_CLASSES.presentationMode, false);
      this.#documentView.setPresentationViewport(false);
      this.#docContainerEl.style.touchAction = this.#behavior.zoomGestures ? "pan-x pan-y" : "auto";
      if (exitFullscreen && this.#viewerFullscreen.active) {
        await this.#viewerFullscreen.exit();
      }
      if (operation !== this.#presentationOperationGeneration) {
        return this.#presentationFailure("cancelled");
      }
      if (
        restore &&
        saved &&
        saved.documentGeneration === this.#documentGeneration &&
        this.#status === "ready" &&
        !!this.#pdf
      ) {
        this.#invalidatePendingViewOperations();
        const restorePage =
          presentationPage === saved.entryPage ? saved.entryPage : presentationPage;
        const pdf = this.#pdf;
        const pages = this.#documentPageUsage;
        if (pdf && pages) {
          try {
            const row = this.#documentView.referenceRow(
              restorePage,
              saved.view.view.pageLayout,
              saved.view.view.rotation,
            );
            const prepared = await this.#prepareRowGeometry(pages, row);
            if (
              operation !== this.#presentationOperationGeneration ||
              !this.#isCurrentDocument(pdf, saved.documentGeneration)
            ) {
              return this.#presentationFailure("cancelled");
            }
            this.#recordPreparedPageGeometry(prepared);
          } catch (cause) {
            if (
              operation === this.#presentationOperationGeneration &&
              this.#isCurrentDocument(pdf, saved.documentGeneration)
            ) {
              this.#log(
                "error",
                "presentation-restore-geometry-failed",
                "Presentation exit reused retained page geometry after exact preparation failed",
                { page: restorePage },
                cause,
              );
            }
          }
        }
        if (
          operation !== this.#presentationOperationGeneration ||
          !pdf ||
          !this.#isCurrentDocument(pdf, saved.documentGeneration)
        ) {
          return this.#presentationFailure("cancelled");
        }
        const restored = this.#documentView.restorePresentationSnapshot(
          saved.view,
          presentationPage === saved.entryPage ? undefined : presentationPage,
        );
        this.#applyViewResult(restored);
        this.#handleRotationChange(restored);
        if (presentationPage !== this.#lastEmittedPage) {
          this.#lastEmittedPage = presentationPage;
          if (this.#pageNumEl) this.#pageNumEl.value = String(presentationPage);
          this.#pdfRootEl.dispatchEvent(
            new this.#ownerWindow.CustomEvent("pdf:pagechange", {
              detail: { page: presentationPage },
            }),
          );
        }
        this.#syncPageLayoutControls();
        this.#syncFitModeControls();
        this.#updateFitUI();
      }
      this.#presentationSnapshot = null;
      this.#presentationPageAnchor = null;
      this.#viewerPanels.setPresentationSuppressed(false);
      const focus = this.#presentationFocusReturn;
      this.#presentationFocusReturn = null;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
      this.#syncModeControls();
      this.#publishPresentationChange();
      return this.#presentationSuccess(false);
    } finally {
      releaseViewTransition();
    }
  }

  #cancelPresentationMode(emit: boolean): void {
    if (!this.#presentationMode && !this.#presentationSnapshot) return;
    const exitFullscreen = this.#viewerFullscreen?.active ?? false;
    this.#cancelPendingPresentationFullscreenRequest();
    this.#presentationOperationGeneration++;
    this.#presentationMode = false;
    this.#presentationInput.setActive(false);
    this.#presentationSnapshot = null;
    this.#presentationPageAnchor = null;
    this.#presentationFullscreenRequested = false;
    this.#presentationFocusReturn = null;
    this.#setModeClass(PDFJS_VIEWER_STATE_CLASSES.presentationMode, false);
    this.#documentView?.setPresentationViewport(false);
    if (this.#docContainerEl) {
      this.#docContainerEl.style.touchAction = this.#behavior.zoomGestures ? "pan-x pan-y" : "auto";
    }
    this.#viewerPanels?.setPresentationSuppressed(false);
    this.#syncModeControls();
    if (emit) this.#publishPresentationChange();
    if (exitFullscreen && this.#viewerFullscreen?.active) {
      void this.#viewerFullscreen.exit();
    }
  }

  #isCurrentPresentationOperation(operation: number, documentGeneration: number): boolean {
    return (
      this.#presentationMode &&
      operation === this.#presentationOperationGeneration &&
      documentGeneration === this.#documentGeneration &&
      this.#status === "ready" &&
      !!this.#pdf &&
      !this.#destroyed
    );
  }

  /** Defers resize-owned view mutations until a presentation transaction has settled. */
  #beginPresentationViewTransition(): () => void {
    this.#presentationViewTransitionDepth++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#presentationViewTransitionDepth--;
      if (this.#presentationViewTransitionDepth === 0 && !this.#presentationMode) {
        this.#presentationPageAnchor = null;
      }
      if (
        this.#presentationViewTransitionDepth !== 0 ||
        !this.#presentationResizePending ||
        this.#destroyed
      )
        return;
      this.#presentationResizePending = false;
      this.#onResize();
    };
  }

  #handleFullscreenChange(active: boolean): void {
    this.#setModeClass(PDFJS_VIEWER_STATE_CLASSES.fullscreen, active);
    this.#syncModeControls();
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:fullscreenchange", {
        detail: Object.freeze({ fullscreen: active }),
      }),
    );
    this.#emitStateChange();
    if (active && this.#presentationFullscreenCancellationPending) {
      this.#presentationFullscreenCancellationPending = false;
      void this.#viewerFullscreen.exit();
      return;
    }
    if (!active && this.#presentationMode) {
      void this.#exitPresentationModeInternal(true, false);
    }
  }

  #cancelPendingPresentationFullscreenRequest(): void {
    const pending = this.#presentationFullscreenPromise;
    this.#presentationFullscreenPromise = null;
    if (!this.#presentationFullscreenRequested || !pending) return;
    this.#presentationFullscreenCancellationPending = true;
    void this.#viewerFullscreen.exit();
    void pending.finally(() => {
      if (!this.#presentationFullscreenCancellationPending) return;
      this.#presentationFullscreenCancellationPending = false;
      if (this.#viewerFullscreen.active) void this.#viewerFullscreen.exit();
    });
  }

  #mapFullscreenResult(result: ViewerFullscreenResult): PdfjsViewerFullscreenResult {
    if (result.status === "active" || result.status === "inactive") {
      return Object.freeze({ ok: true, fullscreen: result.active });
    }
    const mapped = Object.freeze({
      ok: false as const,
      reason: result.status,
      fullscreen: result.active,
      ...(result.cause === undefined ? {} : { cause: result.cause }),
    });
    if (!this.#publishedFullscreenFailures.has(result)) this.#publishFullscreenFailure(result);
    return mapped;
  }

  #publishFullscreenFailure(result: ViewerFullscreenFailureResult): void {
    this.#publishedFullscreenFailures.add(result);
    const detail = Object.freeze({
      ok: false as const,
      reason: result.status,
      fullscreen: result.active,
      ...(result.cause === undefined ? {} : { cause: result.cause }),
    });
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:fullscreenerror", { detail }),
    );
  }

  #fullscreenFailure(
    reason: "disabled" | "unavailable" | "occupied" | "denied" | "cancelled" | "not-active",
  ): PdfjsViewerFullscreenResult {
    const result = Object.freeze({
      ok: false as const,
      reason,
      fullscreen: this.#viewerFullscreen?.active ?? false,
    });
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:fullscreenerror", { detail: result }),
    );
    return result;
  }

  #presentationSuccess(presentationMode: boolean): PdfjsViewerPresentationModeResult {
    return Object.freeze({
      ok: true,
      presentationMode,
      fullscreen: this.#viewerFullscreen?.active ?? false,
    });
  }

  #presentationFailure(
    reason: "disabled" | "not-ready" | "cancelled" | "not-active",
    cause?: unknown,
  ): PdfjsViewerPresentationModeResult {
    return Object.freeze({
      ok: false,
      reason,
      presentationMode: this.#presentationMode,
      fullscreen: this.#viewerFullscreen?.active ?? false,
      ...(cause === undefined ? {} : { cause }),
    });
  }

  #publishPresentationChange(): void {
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:presentationmodechange", {
        detail: Object.freeze({ presentationMode: this.#presentationMode }),
      }),
    );
    this.#emitStateChange();
  }

  #setModeClass(className: string, active: boolean): void {
    this.#pdfRootEl.classList.toggle(className, active);
    this.#ownedUiEl?.classList.toggle(className, active);
  }

  #syncModeControls(): void {
    const fullscreen = this.#viewerFullscreen?.active ?? false;
    const canFullscreen =
      !this.#destroyed &&
      this.#hostActive &&
      this.#features.fullscreen &&
      (fullscreen || (this.#viewerFullscreen?.canEnter ?? false));
    if (this.#fullscreenToggleBtnEl) {
      this.#fullscreenToggleBtnEl.disabled = !canFullscreen;
      this.#fullscreenToggleBtnEl.setAttribute("aria-disabled", String(!canFullscreen));
      this.#fullscreenToggleBtnEl.setAttribute("aria-pressed", String(fullscreen));
      if (this.#ownedUiEl?.contains(this.#fullscreenToggleBtnEl)) {
        const label = fullscreen ? this.#labels.exitFullscreen : this.#labels.fullscreen;
        this.#fullscreenToggleBtnEl.title = label;
        this.#fullscreenToggleBtnEl.setAttribute("aria-label", label);
      }
    }
    const canPresent =
      !this.#destroyed &&
      this.#hostActive &&
      this.#features.presentation &&
      (this.#presentationMode || (this.#status === "ready" && !!this.#pdf));
    if (this.#presentationToggleBtnEl) {
      this.#presentationToggleBtnEl.disabled = !canPresent;
      this.#presentationToggleBtnEl.setAttribute("aria-disabled", String(!canPresent));
      this.#presentationToggleBtnEl.setAttribute("aria-pressed", String(this.#presentationMode));
      if (this.#ownedUiEl?.contains(this.#presentationToggleBtnEl)) {
        const label = this.#presentationMode
          ? this.#labels.exitPresentation
          : this.#labels.presentation;
        this.#presentationToggleBtnEl.title = label;
        this.#presentationToggleBtnEl.setAttribute("aria-label", label);
      }
    }
    const row =
      this.#documentView?.currentRowIndex(this.#presentationPageAnchor ?? this.#lastEmittedPage) ??
      0;
    const presentationReady = this.#presentationMode && this.#status === "ready";
    this.#presentationInput.setNavigationAvailability(
      presentationReady && row > 0,
      presentationReady && row < (this.#documentView?.rows.length ?? 1) - 1,
    );
  }

  #presentationStep(delta: -1 | 1): void {
    if (!this.#presentationMode || !this.#canInteractWithDocument()) return;
    const row = this.#documentView.currentRowIndex(
      this.#presentationPageAnchor ?? this.#lastEmittedPage,
    );
    this.#scrollToRow(row + delta, false, false);
  }

  // --- Public layout, rendering, zoom, and navigation controls ---

  /**
   * Changes the page grouping and returns zoom to automatic fit while
   * preserving the page nearest the viewport center.
   *
   * In `auto` mode the viewer selects single- or two-page rows from the
   * available width and the PDF's preferred page layout.
   *
   * @param layout - Page layout to apply.
   */
  public async setPageLayout(layout: PdfjsViewerPageLayout): Promise<void> {
    this.#assertReadyDocument("setPageLayout");
    if (!["auto", "single", "double", "book"].includes(layout)) {
      throw new RangeError("PdfjsViewer: page layout must be auto, single, double, or book");
    }
    if (this.#presentationMode) return;
    await this.#performViewOperation({ pageLayout: layout, refit: true });
  }

  /** Selects and applies a row-fitting strategy. */
  public async setFitMode(mode: PdfjsViewerFitModeSelection): Promise<void> {
    this.#assertAlive("setFitMode");
    if (!["auto", "contain", "width", "height"].includes(mode)) {
      throw new RangeError("PdfjsViewer: fit mode must be auto, contain, width, or height");
    }
    if (this.#presentationMode) return;
    if (this.#destroyed) return;
    if (!this.#canInteractWithDocument()) {
      this.#documentView.configureFitMode(mode);
      this.#syncFitModeControls();
      this.#emitStateChange();
      return;
    }
    await this.#performViewOperation({ fitMode: mode, refit: true });
  }

  /** Fits the current complete page row using the configured fit mode. */
  public async fit(): Promise<void> {
    this.#assertReadyDocument("fit");
    if (this.#presentationMode) return;
    await this.#performViewOperation({ refit: true });
  }

  /** Applies an absolute viewer-added quarter-turn rotation to a ready document. */
  public async rotateTo(rotation: PdfjsViewerRotation): Promise<void> {
    this.#assertReadyDocument("rotateTo");
    if (![0, 90, 180, 270].includes(rotation))
      throw new RangeError("PdfjsViewer: rotation must be 0, 90, 180, or 270");
    if (!this.#canInteractWithDocument()) return;
    const request = Object.freeze({ rotation });
    this.#pendingRotationRequest = request;
    try {
      await this.#performViewOperation({ rotation, refit: this.#documentView.fitActive });
    } finally {
      if (this.#pendingRotationRequest === request) this.#pendingRotationRequest = null;
    }
  }

  /** Rotates a ready document by a multiple of 90 degrees. */
  public async rotateBy(degrees: number): Promise<void> {
    this.#assertReadyDocument("rotateBy");
    if (!Number.isInteger(degrees) || degrees % 90 !== 0)
      throw new RangeError("PdfjsViewer: rotation delta must be an integer multiple of 90");
    if (!this.#canInteractWithDocument()) return;
    const base = this.#pendingRotationRequest?.rotation ?? this.#documentView.rotation;
    const rotation = ((((base + degrees) % 360) + 360) % 360) as PdfjsViewerRotation;
    await this.rotateTo(rotation);
  }

  /** Restores the constructor's initial viewer rotation for the ready document. */
  public async resetRotation(): Promise<void> {
    await this.rotateTo(this.#initialRotation);
  }

  /** Acquires exact staged-row geometry, then commits only the latest operation. */
  async #performViewOperation(
    input: Readonly<{
      pageLayout?: PdfjsViewerPageLayout;
      fitMode?: PdfjsViewerFitModeSelection;
      rotation?: PdfjsViewerRotation;
      refit: boolean;
      keepPage?: number;
    }>,
  ): Promise<void> {
    if (!this.#canInteractWithDocument()) return;
    if (input.rotation === undefined) this.#pendingRotationRequest = null;
    const pdf = this.#pdf;
    const pages = this.#documentPageUsage;
    if (!pdf || !pages) return;
    const generation = this.#documentGeneration;
    const operation = ++this.#viewOperationGeneration;
    const keepPage =
      input.keepPage ??
      this.#pendingNavTargetPage ??
      this.#documentView.pageAtViewportReadingPosition();
    const row = this.#documentView.referenceRow(
      keepPage,
      input.pageLayout ?? this.#documentView.pageLayout,
      input.rotation ?? this.#documentView.rotation,
    );
    const prepared = await this.#prepareRowGeometry(pages, row);
    if (!this.#isCurrentDocument(pdf, generation) || operation !== this.#viewOperationGeneration)
      return;
    this.#recordPreparedPageGeometry(prepared);
    this.#abortTransientZoomForLayoutChange();
    const result = this.#documentView.commitView({ ...input, keepPage });
    this.#applyViewResult(result);
    this.#handleRotationChange(result);
    this.#syncPageLayoutControls();
    this.#syncFitModeControls();
    this.#updateFitUI();
    this.#emitStateChange();
  }

  async #prepareRowGeometry(
    pages: DocumentPageUsage,
    row: readonly number[],
  ): Promise<readonly Readonly<{ pageNo: number; width: number; height: number }>[]> {
    const uses = await this.#acquirePageUses(pages, row);
    try {
      return uses.map((use, index) => {
        const viewport = use.page.getViewport({ scale: 1, rotation: use.page.rotate });
        if (
          !Number.isFinite(viewport.width) ||
          viewport.width <= 0 ||
          !Number.isFinite(viewport.height) ||
          viewport.height <= 0
        ) {
          throw new Error("PDF.js returned invalid page geometry");
        }
        return Object.freeze({
          pageNo: row[index],
          width: viewport.width,
          height: viewport.height,
        });
      });
    } finally {
      for (const use of uses) use.release();
    }
  }

  #recordPreparedPageGeometry(
    prepared: readonly Readonly<{ pageNo: number; width: number; height: number }>[],
  ): void {
    for (const geometry of prepared) {
      this.#documentView.recordPreparedPageGeometry(
        geometry.pageNo,
        geometry.width,
        geometry.height,
      );
    }
  }

  #handleRotationChange(result: DocumentViewTransactionResult): void {
    if (result.kind !== "committed" || !result.change.rotationChanged) return;
    this.#documentNavigation.invalidateRotation();
    this.#documentOutlinePresentation.reset();
    this.#setPreparationState("outline", "idle");
    if (this.#features.outlinePrepareOnLoad || this.#viewerPanels.isSidebarViewOpen("outline"))
      void this.#prepareOutline();
    void this.#documentNavigation.prepareDestinations(this.#navigationHost());
  }

  /** Acquires a bounded page batch and releases every partially fulfilled use on failure. */
  async #acquirePageUses(
    pages: DocumentPageUsage,
    pageNos: readonly number[],
  ): Promise<readonly DocumentPageUse[]> {
    const settled = await Promise.allSettled(pageNos.map(pageNo => pages.acquire(pageNo)));
    const uses = settled.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      for (const use of uses) use.release();
      throw failure.reason;
    }
    return uses;
  }

  /** Admits exact selected geometry sequentially so native auto layout never relies on unseen-page fallbacks. */
  async #prepareNativePrintGeometry(
    normalized: PdfjsViewerNormalizedPrintOptions,
    pdf: PDFJS.PDFDocumentProxy,
    pages: DocumentPageUsage,
    generation: number,
  ): Promise<Readonly<{
    revision: number;
    layout: ResolvedPrintLayout;
    sizes: readonly PrintPageSize[];
    sizeFor(pageNo: number): PrintPageSize;
    runs: readonly PdfjsViewerPrintPageRange[];
    pageNumbers: readonly number[];
  }> | null> {
    const runs = selectedPrintRuns(normalized.pages, pdf.numPages);
    const pageNumbers = Object.freeze(
      runs.flatMap(run =>
        Array.from({ length: run.to - run.from + 1 }, (_, index) => run.from + index),
      ),
    );
    for (const pageNo of pageNumbers) {
      if (
        normalized.signal?.aborted ||
        !this.#isCurrentDocument(pdf, generation) ||
        this.#documentPageUsage !== pages
      )
        return null;
      if (this.#documentView.printGeometrySnapshot().exactSizeFor(pageNo)) continue;
      const size = await this.#prepareExactPrintPageGeometry(pageNo, pdf, pages, generation);
      if (!size) return null;
    }
    if (
      normalized.signal?.aborted ||
      !this.#isCurrentDocument(pdf, generation) ||
      this.#documentPageUsage !== pages
    )
      return null;
    const snapshot = this.#documentView.printGeometrySnapshot();
    const admitted = new Map<number, PrintPageSize>();
    for (const pageNo of pageNumbers) {
      const size = snapshot.exactSizeFor(pageNo);
      if (!size) return null;
      admitted.set(pageNo, Object.freeze({ width: size.width, height: size.height }));
    }
    const sizes = Object.freeze(pageNumbers.map(pageNo => admitted.get(pageNo)!));
    const layout = resolvePrintLayout(
      normalized.layout,
      snapshot.preferredLayout,
      sizes,
      normalized.sheet,
      normalized.orientation,
    );
    return Object.freeze({
      revision: snapshot.revision,
      layout,
      sizes,
      sizeFor: (pageNo: number) => {
        const size = admitted.get(pageNo);
        if (!size)
          throw new RangeError(
            "PdfjsViewer: admitted print geometry does not contain the selected page",
          );
        return size;
      },
      runs,
      pageNumbers,
    });
  }

  /** Coalesces one exact page probe and publishes it only to the still-current document. */
  #prepareExactPrintPageGeometry(
    pageNo: number,
    pdf: PDFJS.PDFDocumentProxy,
    pages: DocumentPageUsage,
    generation: number,
  ): Promise<Readonly<PrintPageSize> | null> {
    const key = `${generation}:${pageNo}`;
    const active = this.#printGeometryPreparations.get(key);
    if (active) return active;
    const promise = (async () => {
      const use = await pages.acquire(pageNo);
      try {
        const viewport = use.page.getViewport({ scale: 1, rotation: use.page.rotate });
        if (
          !Number.isFinite(viewport.width) ||
          viewport.width <= 0 ||
          !Number.isFinite(viewport.height) ||
          viewport.height <= 0
        ) {
          throw new Error("PDF.js returned invalid page geometry");
        }
        if (!this.#isCurrentDocument(pdf, generation) || this.#documentPageUsage !== pages)
          return null;
        this.#documentView.recordPreparedPageGeometry(pageNo, viewport.width, viewport.height);
        return Object.freeze({ width: viewport.width, height: viewport.height });
      } finally {
        use.release();
      }
    })();
    this.#printGeometryPreparations.set(key, promise);
    void promise
      .finally(() => {
        if (this.#printGeometryPreparations.get(key) === promise)
          this.#printGeometryPreparations.delete(key);
      })
      .catch(() => {});
    return promise;
  }

  /** Supersedes asynchronous prepared geometry before a synchronous view intent. */
  #invalidatePendingViewOperations(): void {
    this.#viewOperationGeneration++;
    this.#pendingRotationRequest = null;
  }

  #syncPageLayoutControls(): void {
    for (const input of [
      this.#pageLayoutToggleAutoEl,
      this.#pageLayoutToggleSingleEl,
      this.#pageLayoutToggleDoubleEl,
      this.#pageLayoutToggleBookEl,
    ]) {
      if (input) input.checked = input.dataset.pdfPageLayout === this.#documentView.pageLayout;
    }
  }

  #syncFitModeControls(): void {
    for (const input of [
      this.#fitModeToggleAutoEl,
      this.#fitModeToggleContainEl,
      this.#fitModeToggleWidthEl,
      this.#fitModeToggleHeightEl,
    ]) {
      if (input) input.checked = input.dataset.pdfFitMode === this.#documentView.fitMode;
    }
  }

  /**
   * Selects a rendering profile, or restores the device-policy automatic choice.
   *
   * `"auto"` resolves to the configured default for the device category selected
   * during construction. It remains that selection but does not dynamically change
   * when the viewport or device environment later changes.
   *
   * @param selection - A concrete profile or `"auto"`.
   * @throws {RangeError} When the selection is invalid or unavailable on this viewer.
   * @throws When called after {@link destroy}.
   */
  public setRenderingProfile(selection: PdfjsViewerRenderingProfileSelection): void {
    if (this.#destroyed)
      throw new Error("PdfjsViewer: cannot set rendering profile after destroy()");
    if (!["auto", "conservative", "balanced", "aggressive"].includes(selection)) {
      throw new RangeError(
        "PdfjsViewer: rendering profile must be auto, conservative, balanced, or aggressive",
      );
    }
    if (selection !== "auto" && !this.#availableRenderingProfiles.includes(selection)) {
      throw new RangeError(
        `PdfjsViewer: rendering profile ${selection} is unavailable for this device category`,
      );
    }
    if (this.#renderingProfileSelection === selection) return;
    this.#renderingProfileSelection = selection;
    this.#setRenderingProfile(
      resolveRenderingProfile(
        selection,
        this.#availableRenderingProfiles,
        this.#automaticRenderingProfile,
      ),
    );
    this.#emitStateChange();
  }

  /** Enables or disables native PDF text-selection interaction mode. */
  public setTextSelectionMode(active: boolean): void {
    if (this.#destroyed)
      throw new Error("PdfjsViewer: cannot set text selection mode after destroy()");
    if (typeof active !== "boolean") {
      throw new TypeError("PdfjsViewer: text selection mode must be a boolean");
    }
    this.#setTextSelectionMode(active && this.#features.textSelection, true);
  }

  #setTextSelectionMode(active: boolean, emit: boolean): void {
    if (this.#textSelectionMode === active) return;
    this.#textSelectionMode = active;
    this.#documentTextPresentation?.setMode(active);
    this.#syncTextSelectionControl();
    if (this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
    if (emit) this.#emitStateChange();
  }

  #syncTextSelectionControl(): void {
    this.#textSelectionToggleBtnEl?.setAttribute("aria-pressed", String(this.#textSelectionMode));
  }

  /**
   * Sets an absolute zoom scale, clamped to the configured zoom limits, and
   * disables automatic fit.
   *
   * @param scale - Finite scale where `1` represents 100%.
   * @throws {RangeError} When `scale` is not finite.
   */
  public zoomTo(scale: number): void {
    this.#assertReadyDocument("zoomTo");
    if (!Number.isFinite(scale)) throw new RangeError("PdfjsViewer: scale must be finite");
    if (this.#presentationMode) return;
    this.#invalidatePendingViewOperations();
    const result = this.#documentView.setExplicitScale(scale);
    if (result.kind === "unchanged") return;
    this.#applyViewResult(result);
    this.#updateFitUI();
    this.#emitStateChange();
  }

  /**
   * Multiplies the current zoom around an optional viewport anchor, clamps the
   * result to the configured zoom limits, and disables automatic fit.
   *
   * @param factor - Finite multiplier greater than zero.
   * @param anchor - Optional anchor in viewport/client coordinates.
   * @throws {RangeError} When `factor` is non-finite or not greater than zero.
   */
  public zoomBy(factor: number, anchor?: { x: number; y: number }): void {
    this.#assertReadyDocument("zoomBy");
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new RangeError("PdfjsViewer: zoom factor must be finite and greater than zero");
    }
    if (
      anchor !== undefined &&
      (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
    ) {
      throw new TypeError("PdfjsViewer: zoom anchor must have finite x and y coordinates");
    }
    if (this.#presentationMode) return;
    this.#invalidatePendingViewOperations();
    const result = this.#documentView.setExplicitScale(this.#documentView.scale * factor, anchor);
    if (result.kind === "unchanged") return;
    this.#applyViewResult(result);
    this.#updateFitUI();
    this.#emitStateChange();
  }

  /**
   * Jumps to a specific 1-based page without animation. Invalid or out-of-range
   * values are ignored.
   *
   * @param page - Desired page number; fractional values are floored.
   */
  public navigateToPage(page: number): void {
    this.#assertReadyDocument("navigateToPage");
    const p = Math.floor(page);
    if (!Number.isFinite(p) || p < 1 || p > this.#documentView.pageCount) return;
    this.#scrollToPageWithHistory(p, false);
  }

  /**
   * Scroll to a named destination inside the PDF (e.g. an internal link target).
   *
   * Programmatic navigation uses the same sticky-target behavior as outline
   * clicks and internal PDF links: outline/navigation state is updated immediately and
   * stays pinned while the chosen spot remains visible.
   *
   * Resolves the destination via `pdf.getDestination()` and scrolls to the
   * corresponding page. If `spotWithinPage` is true and the destination encodes
   * a vertical position (XYZ / FitH / FitBH / Fit / FitB), the viewer scrolls to
   * that approximate Y location within the page; otherwise it scrolls only to
   * the page as a whole.
   *
   * Navigation is accepted only while the viewer is ready. Replacement loads,
   * explicit cancellation, and newer navigation requests cancel in-flight work.
   *
   * @param pdfNamedDestination - Exact named destination identifier from the PDF.
   * @param options - Positioning, animation, and cancellation options.
   * @returns A structured success or failure result; normal lookup failures do
   * not throw.
   */
  public async navigateToPdfNamedDestination(
    pdfNamedDestination: string,
    options: PdfjsViewerPdfNamedDestinationNavigationOptions = {},
  ): Promise<PdfjsViewerPdfNamedDestinationNavigationResult> {
    return this.#navigateToPdfNamedDestination(pdfNamedDestination, options, true);
  }

  async #navigateToPdfNamedDestination(
    pdfNamedDestination: string,
    options: PdfjsViewerPdfNamedDestinationNavigationOptions,
    recordHistory: boolean,
  ): Promise<PdfjsViewerPdfNamedDestinationNavigationResult> {
    this.#assertReadyDocument("navigateToPdfNamedDestination");
    if (typeof pdfNamedDestination !== "string")
      throw new TypeError("PdfjsViewer: named destination must be a string");
    if (!options || typeof options !== "object")
      throw new TypeError("PdfjsViewer: named destination options must be an object");
    if (!pdfNamedDestination) return { ok: false, pdfNamedDestination, reason: "invalid-name" };
    if (this.#destroyed) return { ok: false, pdfNamedDestination, reason: "destroyed" };
    if (this.#status !== "ready" || !this.#pdf)
      return { ok: false, pdfNamedDestination, reason: "not-ready" };
    const navigation = this.#beginNavigationIntent(recordHistory);
    const outcome = await this.#documentNavigation.resolvePdfNamedDestination(
      this.#navigationHost(),
      pdfNamedDestination,
      options,
    );
    if (!outcome.ok) return outcome;
    if (!this.#isCurrentNavigationIntent(navigation)) {
      return { ok: false, pdfNamedDestination, reason: "cancelled" };
    }
    this.#documentNavigation.selectResolvedDestination(
      this.#navigationHost(),
      {
        pageNo: outcome.intent.page,
        yRatio: outcome.intent.yRatio,
        ...(outcome.intent.xRatio == null ? {} : { xRatio: outcome.intent.xRatio }),
      },
      pdfNamedDestination,
    );
    const { positioned } = this.#commitNavigationIntent(navigation, outcome.intent, recordHistory);
    return { ok: true, pdfNamedDestination, page: outcome.intent.page, positioned };
  }

  /**
   * Re-reads the navigation adapter and starts navigation to its destination.
   *
   * @param smooth - Whether scrolling should animate, subject to reduced-motion
   * preferences.
   * @returns `true` when an ID was available and navigation was started; this
   * does not imply that asynchronous destination lookup succeeds.
   */
  public navigateFromNavigationState(smooth: boolean = false): boolean {
    this.#assertReadyDocument("navigateFromNavigationState");
    if (typeof smooth !== "boolean") throw new TypeError("PdfjsViewer: smooth must be a boolean");
    const request = this.#documentNavigation.navigationRequestFromState(
      this.#navigationHost(),
      smooth,
    );
    if (!request) return false;
    void this.#navigateToPdfNamedDestination(
      request.pdfNamedDestination,
      { smooth: request.smooth },
      false,
    );
    return true;
  }

  /**
   * Restores the previous explicit location synchronously within the active document.
   * This document-local history is independent of browser and URL history.
   *
   * @returns `false` when history is disabled, the viewer is not ready, no Back
   * entry exists, or precise current geometry cannot be captured or restored.
   * Normal unavailability does not throw.
   */
  public goBack(): boolean {
    return this.#restoreNavigationHistory("back");
  }

  /**
   * Restores the next explicit location synchronously within the active document.
   * This document-local history is independent of browser and URL history.
   *
   * @returns `false` when history is disabled, the viewer is not ready, no Forward
   * entry exists, or precise current geometry cannot be captured or restored.
   * Normal unavailability does not throw.
   */
  public goForward(): boolean {
    return this.#restoreNavigationHistory("forward");
  }

  /**
   * Scrolls to the next page row when one exists.
   * @param smooth - Whether scrolling should animate, subject to reduced-motion
   * preferences.
   */
  public nextRow(smooth: boolean = true): void {
    this.#assertReadyDocument("nextRow");
    if (typeof smooth !== "boolean") throw new TypeError("PdfjsViewer: smooth must be a boolean");
    if (this.#presentationMode) smooth = false;
    const idx = this.#navigationRowIndex();
    if (idx < this.#documentView.rows.length - 1) {
      this.#releasePendingExplicitMovement();
      this.#scrollToRow(idx + 1, smooth);
    }
  }

  /**
   * Scrolls to the previous page row when one exists.
   * @param smooth - Whether scrolling should animate, subject to reduced-motion
   * preferences.
   */
  public previousRow(smooth: boolean = true): void {
    this.#assertReadyDocument("previousRow");
    if (typeof smooth !== "boolean") throw new TypeError("PdfjsViewer: smooth must be a boolean");
    if (this.#presentationMode) smooth = false;
    const idx = this.#navigationRowIndex();
    if (idx > 0) {
      this.#releasePendingExplicitMovement();
      this.#scrollToRow(idx - 1, smooth);
    }
  }

  // --- Lifecycle teardown, cancellation, and settlement ---

  /** Emits an opt-in viewer diagnostic without allowing logger failures to escape. */
  #log(
    level: PdfjsViewerLogLevel,
    event: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    error?: unknown,
  ): void {
    try {
      this.#logger?.({
        level,
        component: "viewer",
        event,
        message,
        viewerId: this.#viewerId ?? undefined,
        details,
        error,
      });
    } catch {}
  }

  /**
   * Invalidates old-document callbacks before cancelling render operations and
   * resetting interaction state. Idempotent within one document lifetime.
   */
  #cancelDocumentWork(): {
    renderSettlements: readonly Promise<unknown>[];
    preparationSettlements: readonly Promise<unknown>[];
  } {
    this.#cancelPresentationMode(true);
    this.#previousBoundaryControlPress?.reset();
    this.#nextBoundaryControlPress?.reset();
    this.#controlledPrintAdmission = null;
    this.#documentPrint.reset();
    this.#viewerPrintSetup?.resetDocument();
    this.#viewerDocumentInformation?.resetDocument();
    this.#documentGeneration++;
    this.#invalidateNavigationIntent();
    this.#settleInitialRenderWaiter();
    this.#terminalLoadError = null;
    this.#viewOperationGeneration++;
    this.#pendingRotationRequest = null;
    this.#documentLifetime.cancel();
    this.#printGeometryPreparations.clear();
    runCleanup(() => this.#loadAbort?.abort());
    this.#loadAbort = null;
    const renderSettlements = [
      ...this.#documentRenderer.resetDocument(),
      ...this.#documentThumbnails.resetDocument(),
    ];
    const pageUsage = this.#documentPageUsage;
    this.#documentPageUsage = null;
    if (pageUsage) renderSettlements.push(pageUsage.close());
    this.#setTextSelectionMode(false, false);
    const formSettlements = this.#documentPresentation.reset();
    this.#documentTextPresentation.reset();
    this.#documentLayers.resetDocument();
    this.#documentLayersPresentation.reset();
    const preparationSettlements: Promise<unknown>[] = [];
    for (const promise of [
      this.#documentDataRead?.promise,
      this.#documentInformation.preparation,
      ...this.#documentAttachments.settlements,
      this.#documentSearch.preparation,
      this.#documentNavigation.preparation,
      this.#documentNavigation.destinationPreparation,
    ]) {
      if (promise) preparationSettlements.push(promise);
    }
    preparationSettlements.push(...formSettlements);
    this.#formAppearanceRevision = 0;
    this.#documentDataRead = null;
    this.#downloadOperations.clear();
    this.#hideZoomLimitHint();
    this.#scrollRaf = this.#containerResizeRaf = this.#resizeRaf = this.#zoomSliderRaf = null;
    this.#overflowAnchorTimer = this.#pendingNavClearTimer = null;
    this.#cancelSmoothNavigation();
    this.#scrollMotionIdleTimer = null;
    this.#documentView.settleMotion();
    this.#rasterWorkCoordinator.setStationary(true);
    this.#rasterWorkCoordinator.setTransient(false);
    this.#lastObservedScrollTop = null;
    this.#scrollPendingDuringTouchZoom = false;
    this.#zoomSliderDragActive = false;
    this.#suppressClickUntil = 0;
    this.#pendingNavTargetPage = null;
    this.#pointerScroll.reset(this.#pointerScrollHost());
    for (const scrollOwner of [
      this.#outlineContentEl,
      this.#thumbnailsContentEl,
      this.#attachmentsContentEl,
      this.#layersContentEl,
    ]) {
      if (scrollOwner)
        this.#sidebarPointerScroll.reset(this.#sidebarPointerScrollHost(scrollOwner));
    }
    this.#zoomGesture.reset(this.#zoomGestureHost);
    this.#docContainerEl.style.removeProperty("overflow-anchor");
    this.#docContainerEl.style.removeProperty("overflow-x");
    this.#docContainerEl.classList.remove(PDFJS_VIEWER_STATE_CLASSES.pinchActive);
    this.#showInitialRenderProgress = false;
    this.#documentProgressFeedback.cancelPending();
    return { renderSettlements, preparationSettlements };
  }

  /**
   * Invalidates document work first, then performs the full `DocumentView`
   * reset before detaching DOM state, so replacement planning cannot observe
   * old geometry or surfaces. Loading-task destruction may be awaited by
   * replacement; render, preparation, and proxy settlement remains detached.
   * Repeated close is safe.
   */
  async #closeDocument(): Promise<void> {
    const cancelled = this.#cancelDocumentWork();
    const loadingTask = this.#loadingTask;
    this.#loadingTask = null;
    const pdf = this.#pdf;
    this.#pdf = null;
    this.#documentInformation.reset();
    this.#documentAttachments.reset();
    this.#documentSearch.reset();
    this.#documentNavigation.reset();
    this.#documentNavigationHistory.reset();
    this.#syncNavigationHistoryControls();
    this.#searchPreparationState = "idle";
    this.#outlinePreparationState = "idle";
    this.#attachmentsPreparationState = "idle";
    this.#documentOutlinePresentation.reset();
    this.#documentAttachmentsPresentation.reset();
    this.#documentLayersPresentation.reset();
    this.#documentProgressFeedback.reset();
    this.#searchPreparationUpdatesUi = false;
    this.#pdfUrl = null;
    this.#pdfFilename = null;
    this.#syncDownloadControl();
    this.#lastEmittedPage = 1;
    if (this.#pageCountEl) this.#pageCountEl.textContent = "?";
    if (this.#pageNumEl) this.#pageNumEl.value = "1";
    this.#documentView.resetDocument();
    this.#searchQuery = "";
    this.#searchMatches = [];
    this.#searchPos = -1;
    this.#searchQueryForced = false;
    this.#updateSearchCount();
    this.#pendingPreparationEvents.length = 0;
    this.#searchPanelEl?.removeAttribute("aria-busy");
    if (!this.#destroyed && this.#status !== "loading") this.#setStatus("closed");

    const loadingSettlement = loadingTask
      ? (async () => {
          try {
            await loadingTask.destroy();
          } catch {}
        })()
      : Promise.resolve();
    void Promise.allSettled([
      loadingSettlement,
      ...cancelled.renderSettlements,
      ...cancelled.preparationSettlements,
    ]).then(async () => {
      try {
        await pdf?.cleanup();
      } catch {}
    });
    if (loadingTask) await loadingSettlement;
  }

  /**
   * Releases permanent listeners, observers, runtime registration, and viewer
   * timers after document invalidation. Called only by idempotent {@link destroy};
   * close/replacement deliberately preserve this infrastructure and custom UI.
   */
  #releaseViewerInfrastructure(): void {
    this.#previousBoundaryControlPress?.reset();
    this.#nextBoundaryControlPress?.reset();
    this.#presentationInput.destroy();
    this.#viewerLifetime.cancel();
    this.#viewerPrintSetup?.destroy();
    this.#viewerPrintSetup = null;
    this.#viewerDocumentInformation?.destroy();
    this.#viewerDocumentInformation = null;
    this.#viewerPanels.destroy();
    this.#viewerFullscreen?.destroy();
    this.#disconnectObserver?.disconnect();
    this.#disconnectObserver = null;
    this.#containerResizeObserver?.disconnect();
    this.#containerResizeObserver = null;
    this.#syncRuntimeActiveViewer(false);
    if (this.#runtimeRegistration)
      getPdfjsViewerRuntimeAccess(this.#runtime).unregister(this.#runtimeRegistration);
    this.#runtimeRegistration = null;
    if (this.#runtimeAttached) {
      getPdfjsViewerRuntimeAccess(this.#runtime).detachViewer();
      this.#runtimeAttached = false;
    }
  }

  #rollbackConstruction(): void {
    runCleanup(() =>
      (this.#presentationInput as PresentationInputController | undefined)?.destroy(),
    );
    this.#viewerLifetime.cancel();
    runCleanup(() => this.#viewerPrintSetup?.destroy());
    this.#viewerPrintSetup = null;
    runCleanup(() => this.#viewerDocumentInformation?.destroy());
    this.#viewerDocumentInformation = null;
    runCleanup(() => (this.#viewerPanels as ViewerPanels | undefined)?.destroy());
    runCleanup(() => (this.#viewerFullscreen as ViewerFullscreen | undefined)?.destroy());
    this.#disconnectObserver?.disconnect();
    this.#disconnectObserver = null;
    this.#containerResizeObserver?.disconnect();
    this.#containerResizeObserver = null;
    if (this.#runtimeRegistration) {
      runCleanup(() =>
        getPdfjsViewerRuntimeAccess(this.#runtime).unregister(this.#runtimeRegistration!),
      );
      this.#runtimeRegistration = null;
    }
    if (this.#runtimeAttached) {
      runCleanup(() => getPdfjsViewerRuntimeAccess(this.#runtime).detachViewer());
      this.#runtimeAttached = false;
    }
    runCleanup(() =>
      (this.#documentOutlinePresentation as DocumentOutlinePresentation | undefined)?.destroy(),
    );
    runCleanup(() =>
      (
        this.#documentAttachmentsPresentation as DocumentAttachmentsPresentation | undefined
      )?.destroy(),
    );
    runCleanup(() =>
      (this.#documentLayersPresentation as DocumentLayersPresentation | undefined)?.destroy(),
    );
    runCleanup(() => (this.#documentLayers as DocumentLayers | undefined)?.destroy());
    runCleanup(() => (this.#documentThumbnails as DocumentThumbnails | undefined)?.destroy());
    runCleanup(() =>
      (this.#documentTextPresentation as DocumentTextPresentation | undefined)?.destroy(),
    );
    runCleanup(() => (this.#documentView as DocumentView | undefined)?.resetDocument());
    this.#ownedUiEl?.remove();
    this.#ownedUiEl = null;
    this.#removeOwnedViewerMarkers();
  }

  #applyViewerMarkers(): void {
    this.#applyViewerMarker(this.#pdfRootEl);
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (value instanceof this.#ownerWindow.HTMLElement) {
        this.#applyViewerMarker(value as HTMLElement);
        return;
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(this.#uiBindings);
  }

  #applyViewerMarker(element: HTMLElement): void {
    if (element.hasAttribute(PDFJS_VIEWER_ROOT_ATTRIBUTE)) return;
    element.setAttribute(PDFJS_VIEWER_ROOT_ATTRIBUTE, "");
    this.#ownedMarkerElements.add(element);
  }

  #removeOwnedViewerMarkers(): void {
    for (const element of this.#ownedMarkerElements)
      element.removeAttribute(PDFJS_VIEWER_ROOT_ATTRIBUTE);
    this.#ownedMarkerElements.clear();
  }

  /** Creates the selected UI mode before DOM references are collected. */
  #prepareUi(ui: NormalizedViewerUi): void {
    const mode = ui.mode;

    if (mode === "custom") {
      if (!(
        this.#uiBindings.container ??
        this.#pdfRootEl.querySelector(PDFJS_VIEWER_UI_HOOKS.root.container)
      )) {
        throw new Error(
          `PdfjsViewer: ui: 'custom' requires ${PDFJS_VIEWER_UI_HOOKS.root.container} below rootEl or a uiBindings.container; alternatively use ui: 'default'`,
        );
      }
      return;
    }

    // Replace only an incomplete generated attempt; never discard host markup.
    if (mode === "headless") {
      const shell = this.#ownerDocument.createElement("div");
      shell.className = "pdf-headless-ui";
      shell.dataset.pdfjsViewerOwned = "true";
      const container = this.#ownerDocument.createElement("div");
      container.className = "pdf-container";
      container.tabIndex = 0;
      shell.append(container);
      this.#pdfRootEl.append(shell);
      this.#ownedUiEl = shell;
      this.#applyViewerMarker(shell);
      return;
    }

    this.#ownedUiEl = createPdfjsViewerUi(
      {
        id: this.#viewerId,
        initialUrl: this.#pdfUrl,
        labels: ui.labels,
        formatters: ui.formatters,
        direction: ui.direction,
        controls: ui.controls,
        sidebar: ui.sidebar,
      },
      this.#pdfRootEl.ownerDocument,
    );
    this.#pdfRootEl.append(this.#ownedUiEl);
    this.#ownedUiEl.dataset.pdfjsViewerOwned = "true";
    this.#applyViewerMarker(this.#ownedUiEl);
  }

  /** Updates lifecycle status and emits a fresh observable state snapshot. */
  #setStatus(status: PdfjsViewerStatus): void {
    const previousStatus = this.#status;
    this.#status = status;
    this.#syncReadyControls(status === "ready");
    this.#syncDownloadControl();
    this.#syncFilledDocumentDownloadControl();
    this.#syncNavigationHistoryControls();
    this.#syncModeControls();
    if (status !== previousStatus) {
      this.#log(
        "debug",
        "status-changed",
        `Viewer status changed from ${previousStatus} to ${status}`,
        {
          previousStatus,
          status,
        },
      );
    }
    this.#emitStateChange();
  }

  /** Dispatches the current state through the `pdf:statechange` event. */
  #emitStateChange(): void {
    const state = this.state;
    const previous = this.#lastPublishedState;
    if (
      previous &&
      (Object.keys(state) as Array<keyof PdfjsViewerState>).every(key =>
        Object.is(previous[key], state[key]),
      )
    )
      return;
    this.#lastPublishedState = state;
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:statechange", { detail: state }),
    );
  }

  /** Publishes one current optional-feature preparation transition. */
  #setPreparationState(
    feature: "search" | "outline" | "attachments",
    state: PdfjsViewerFeaturePreparationState,
  ): void {
    const current =
      feature === "search"
        ? this.#searchPreparationState
        : feature === "outline"
          ? this.#outlinePreparationState
          : this.#attachmentsPreparationState;
    if (current === state) return;
    if (feature === "search") this.#searchPreparationState = state;
    else if (feature === "outline") this.#outlinePreparationState = state;
    else this.#attachmentsPreparationState = state;
    this.#log(
      "debug",
      `${feature}-preparation-state-changed`,
      `${feature} preparation changed from ${current} to ${state}`,
      {
        feature,
        previousState: current,
        state,
      },
    );
    this.#emitStateChange();
  }

  /** Emits preparation completion after `pdf:ready`, buffering eager results when needed. */
  #emitPreparationEvent(
    type: "pdf:searchindexcomplete" | "pdf:outlinecomplete" | "pdf:attachmentscomplete",
    detail: object,
  ): void {
    if (!this.#documentRenderer.ready) {
      this.#pendingPreparationEvents.push({ type, detail });
      return;
    }
    this.#pdfRootEl.dispatchEvent(new this.#ownerWindow.CustomEvent(type, { detail }));
  }

  /** Flushes eager preparation outcomes after ready listeners have run. */
  #flushPreparationEvents(): void {
    const pending = this.#pendingPreparationEvents.splice(0);
    for (const { type, detail } of pending) {
      this.#pdfRootEl.dispatchEvent(new this.#ownerWindow.CustomEvent(type, { detail }));
    }
  }

  /** Lets public queries cancel promptly even when the underlying PDF.js read cannot. */
  #waitForDocumentPreparation(promise: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = (ready: boolean) => {
        signal.removeEventListener("abort", cancel);
        resolve(ready);
      };
      const cancel = () => finish(false);
      signal.addEventListener("abort", cancel, { once: true });
      void promise.then(finish, () => finish(false));
    });
  }

  /** Resolves an uncancellable PDF.js read early with `null` when its document ends. */
  #waitForDocumentValue<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const finish = (value: T | null) => {
        signal.removeEventListener("abort", cancel);
        resolve(value);
      };
      const cancel = () => finish(null);
      signal.addEventListener("abort", cancel, { once: true });
      void promise.then(finish, error => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      });
    });
  }

  /** Adapts viewer lifecycle capabilities for the private document-search module. */
  #searchHost(): DocumentSearchHost {
    return {
      searchEnabled: this.#features.search,
      pageCount: this.#documentView.pageCount,
      isDestroyed: this.#destroyed,
      isReady: this.#status === "ready",
      getPdf: () => this.#pdf,
      getDocumentGeneration: () => this.#documentGeneration,
      isCurrentDocument: (pdf, generation) => this.#isCurrentDocument(pdf, generation),
      waitForDocumentPreparation: (promise, signal) =>
        this.#waitForDocumentPreparation(promise, signal),
      getDocumentSignal: () => this.#documentLifetime.signal,
      normalizeQueryOptions: options =>
        normalizeTextQueryOptions(options, this.#behavior.searchQueryOptions, "search options"),
      acquirePage: pageNo => {
        if (!this.#documentPageUsage)
          throw new Error("PdfjsViewer: document page usage is unavailable");
        return this.#documentPageUsage.acquire(pageNo);
      },
    };
  }

  /** Adapts only active-document identity and cancellation for metadata reads. */
  #informationHost(): DocumentInformationHost {
    return {
      isDestroyed: this.#destroyed,
      isReady: this.#status === "ready",
      getPdf: () => this.#pdf,
      getDocumentGeneration: () => this.#documentGeneration,
      getDocumentSignal: () => this.#documentLifetime.signal,
      isCurrentDocument: (pdf, generation) => this.#isCurrentDocument(pdf, generation),
    };
  }

  /** Adapts active-document identity and cancellation for attachment reads. */
  #attachmentsHost(): DocumentAttachmentsHost {
    return {
      attachmentsEnabled: this.#features.attachments,
      isDestroyed: this.#destroyed,
      isReady: this.#status === "ready",
      getPdf: () => this.#pdf,
      getDocumentGeneration: () => this.#documentGeneration,
      getDocumentSignal: () => this.#documentLifetime.signal,
      isCurrentDocument: (pdf, generation) => this.#isCurrentDocument(pdf, generation),
    };
  }

  /** Adapts only document identity, geometry, and persistence for navigation policy. */
  #navigationHost(): DocumentNavigationHost {
    return {
      destinationMatchTolerance: this.#destinationMatchTolerance,
      shareableNamedDestinationPrefix: this.#shareableNamedDestinationPrefix,
      navigationState: this.#navigationState,
      getPdf: () => this.#pdf,
      getDocumentGeneration: () => this.#documentGeneration,
      getDocumentSignal: () => this.#documentLifetime.signal,
      isCurrentDocument: (pdf, generation) => this.#isCurrentDocument(pdf, generation),
      pageTopFor: page => this.#documentView.pageTopFor(page),
      pageHeightFor: page => this.#documentView.pageHeightFor(page),
      rotation: () => this.#documentView.rotation,
      scrollTop: () => this.#docContainerEl.scrollTop,
      viewportHeight: () => this.#docContainerEl.clientHeight,
      viewportPosition: () => {
        const position = this.#documentView.viewportPosition(
          this.#pendingNavTargetPage ?? this.#lastEmittedPage,
        );
        return { pageNo: position.pageNo, yRatio: position.yRatio, xRatio: position.xRatio };
      },
      canWriteNavigationState: () => this.#canWriteNavigationState(),
      setNavigationStateTimeout: (callback, delay) => this.#ownerWindow.setTimeout(callback, delay),
      clearNavigationStateTimeout: timer => this.#ownerWindow.clearTimeout(timer),
      acquirePage: pageNo => {
        if (!this.#documentPageUsage)
          throw new Error("PdfjsViewer: document page usage is unavailable");
        return this.#documentPageUsage.acquire(pageNo);
      },
    };
  }

  // --- UI setup and listener helpers ---

  /** Registers a permanent listener owned by the viewer lifetime. */
  #on<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (this: Window, ev: WindowEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  #on<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (this: Document, ev: DocumentEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  #on<T extends HTMLElement, K extends keyof HTMLElementEventMap>(
    target: T,
    type: K,
    listener: (this: T, ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  #on(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  #on(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.#viewerLifetime.listen(target, type, listener, options);
  }

  #createLifecycleScope(): LifecycleScope {
    return new LifecycleScope({
      createAbortController: () => new this.#ownerWindow.AbortController(),
      requestAnimationFrame: callback => this.#ownerWindow.requestAnimationFrame(callback),
      cancelAnimationFrame: id => this.#ownerWindow.cancelAnimationFrame(id),
      setTimeout: (callback, delay) => this.#ownerWindow.setTimeout(callback, delay),
      clearTimeout: id => this.#ownerWindow.clearTimeout(id),
    });
  }

  /** Synchronizes active-source download state without hiding custom UI. */
  #syncDownloadControl(): void {
    const download = this.#downloadBtnEl;
    if (!download) return;
    const available = this.#pdfUrl !== null || this.#pdf !== null;
    if (available) {
      download.href = this.#pdfUrl ?? "#";
      download.download = this.#downloadFilename();
      if (this.#pdfUrl) {
        download.target = "_blank";
        download.rel = "noopener";
      } else {
        download.removeAttribute("target");
        download.removeAttribute("rel");
      }
      download.removeAttribute("aria-disabled");
      if (this.#ownedUiEl) download.hidden = false;
      return;
    }
    download.removeAttribute("href");
    download.removeAttribute("download");
    download.removeAttribute("target");
    download.removeAttribute("rel");
    download.setAttribute("aria-disabled", "true");
    if (this.#ownedUiEl) download.hidden = true;
  }

  /** Returns descriptor metadata, a URL basename, or a stable generic PDF name. */
  #downloadFilename(): string {
    if (this.#pdfFilename) return this.#pdfFilename;
    if (this.#pdfUrl) {
      try {
        const basename = new this.#ownerWindow.URL(
          this.#pdfUrl,
          this.#ownerDocument.baseURI,
        ).pathname
          .split("/")
          .pop();
        if (basename) return decodeURIComponent(basename);
      } catch {}
    }
    return "document.pdf";
  }

  #filledDocumentFilename(): string {
    const original = this.#downloadFilename();
    return original.toLowerCase().endsWith(".pdf")
      ? `${original.slice(0, -4)}-filled.pdf`
      : `${original}-filled.pdf`;
  }

  #syncFilledDocumentDownloadControl(): void {
    const action = this.#downloadFilledDocumentBtnEl;
    if (!action) return;
    const formsAvailable = this.#status === "ready" && this.#documentPresentation.formsEnabled;
    if (this.#ownedUiEl?.classList.contains("pdf-default-ui")) action.hidden = !formsAvailable;
    const enabled = formsAvailable && this.#documentPresentation.formDirty;
    action.disabled = !enabled || this.#downloadFilledDocumentBusy;
    action.setAttribute("aria-disabled", String(action.disabled));
    action.toggleAttribute("aria-busy", this.#downloadFilledDocumentBusy);
  }

  /** Starts a browser download through a temporary package-owned anchor. */
  #startBrowserDownload(url: string, filename: string, newTabFallback: boolean = false): void {
    const anchor = this.#ownerDocument.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    if (newTabFallback) {
      anchor.target = "_blank";
      anchor.rel = "noopener";
    }
    anchor.hidden = true;
    this.#ownerDocument.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  }

  /** Joins one uncached complete-data read for the active PDF.js proxy. */
  #readDocumentData(pdf: PDFJS.PDFDocumentProxy): Promise<Uint8Array> {
    let read = this.#documentDataRead;
    if (read?.pdf === pdf) return read.promise;

    read = { pdf, promise: pdf.getData() };
    this.#documentDataRead = read;
    const currentRead = read;
    void read.promise.then(
      () => {
        if (this.#documentDataRead === currentRead) this.#documentDataRead = null;
      },
      () => {
        if (this.#documentDataRead === currentRead) this.#documentDataRead = null;
      },
    );
    return read.promise;
  }

  /** Performs one generation-checked, memory-on-demand document download. */
  async #downloadDocument(
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    document: PdfjsViewerDocumentVariant,
    filename: string,
  ): Promise<PdfjsViewerDownloadResult> {
    try {
      const result = await this.getDocumentData({ document });
      if (!result.ok || !this.#isCurrentDocument(pdf, generation)) {
        return result.ok ? { ok: false, reason: "cancelled" } : result;
      }
      const objectUrl = this.#ownerWindow.URL.createObjectURL(
        new this.#ownerWindow.Blob([result.data as BlobPart], { type: "application/pdf" }),
      );
      try {
        this.#startBrowserDownload(objectUrl, filename);
      } finally {
        // A later task lets the browser consume the activated URL without retaining
        // a document-lifetime Blob copy.
        this.#ownerWindow.setTimeout(() => this.#ownerWindow.URL.revokeObjectURL(objectUrl), 0);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "error", error };
    }
  }

  /** Hides package-owned or policy-ineligible UI. */
  #hideUnavailableElement(element: HTMLElement | null): void {
    if (!element) return;
    element.hidden = true;
    element.style.setProperty("display", "none", "important");
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("inert", "");
  }

  /** Hides a disabled control and a label for it within the control's container. */
  #hideUnavailableControl(element: HTMLElement | null): void {
    this.#hideUnavailableElement(element);
    const label =
      Array.from(element?.parentElement?.querySelectorAll("label") ?? []).find(
        candidate => candidate.control === element,
      ) ?? null;
    this.#hideUnavailableElement(label);
  }

  /** Restores a known control whose server-rendered disabled state ends at document readiness. */
  #enableReadyControl(element: HTMLElement | null): void {
    if (!element) return;
    element.removeAttribute("disabled");
    if (element.getAttribute("aria-disabled") === "true") element.removeAttribute("aria-disabled");
    if (element.dataset.sbDisabled === "1") delete element.dataset.sbDisabled;
    if (element.dataset.sbDisabledTabindex === "1") {
      if (element.getAttribute("tabindex") === "-1") element.removeAttribute("tabindex");
      delete element.dataset.sbDisabledTabindex;
    }
  }

  /** Applies document readiness to every document-dependent generated or custom control. */
  #syncReadyControls(enabled: boolean): void {
    const controls: Array<HTMLElement | null> = [
      this.#prevPageBtnEl,
      this.#nextPageBtnEl,
      this.#pageNumEl,
      this.#autoFitBtnEl,
      this.#autoFitMenuBtnEl,
      this.#zoomSliderEl,
      this.#searchToggleBtnEl,
      this.#menuToggleBtnEl,
      this.#sidebarToggleEl,
      this.#documentInformationBtnEl,
      this.#textSelectionToggleBtnEl,
      this.#pageLayoutToggleAutoEl,
      this.#pageLayoutToggleSingleEl,
      this.#pageLayoutToggleDoubleEl,
      this.#pageLayoutToggleBookEl,
      this.#fitModeToggleAutoEl,
      this.#fitModeToggleContainEl,
      this.#fitModeToggleWidthEl,
      this.#fitModeToggleHeightEl,
      this.#rotateCounterclockwiseBtnEl,
      this.#resetRotationBtnEl,
      this.#rotateClockwiseBtnEl,
      this.#renderingProfileToggleConservativeEl,
      this.#renderingProfileToggleBalancedEl,
      this.#renderingProfileToggleAggressiveEl,
    ];
    for (const control of controls) {
      if (!control) continue;
      if (enabled) this.#enableReadyControl(control);
      else {
        control.setAttribute("disabled", "");
        control.setAttribute("aria-disabled", "true");
      }
    }
    if (enabled)
      this.#updatePageNavDisabled(this.#documentView.currentRowIndex(this.#lastEmittedPage));
    this.#syncNavigationHistoryControls();
    this.#syncModeControls();
  }

  /** Excludes device-policy-ineligible profile controls from viewer wiring. */
  #filterRenderingProfileControls(): void {
    const controls = [
      this.#renderingProfileToggleConservativeEl,
      this.#renderingProfileToggleBalancedEl,
      this.#renderingProfileToggleAggressiveEl,
    ];
    for (const control of controls) {
      const profile = control?.dataset.pdfRenderingProfile as
        PdfjsViewerRenderingProfile | undefined;
      if (control && profile && !this.#availableRenderingProfiles.includes(profile)) {
        if (this.#ownedUiEl) {
          control.disabled = true;
          this.#hideUnavailableControl(control);
        }
        if (profile === "conservative") this.#renderingProfileToggleConservativeEl = null;
        else if (profile === "balanced") this.#renderingProfileToggleBalancedEl = null;
        else this.#renderingProfileToggleAggressiveEl = null;
      }
    }
    if (this.#ownedUiEl && this.#availableRenderingProfiles.length < 2) {
      this.#hideUnavailableElement(
        this.#renderingProfileGroupEl?.closest("fieldset") ?? this.#renderingProfileGroupEl,
      );
    }
  }

  // --- Motion preferences and viewport anchoring ---

  /** Resolves requested animation against the reduced-motion preference. */
  #scrollBehavior(smooth: boolean): ScrollBehavior {
    if (!smooth) return "auto";
    if (
      this.#accessibility.respectReducedMotion &&
      this.#ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return "auto";
    return "smooth";
  }

  // --- Transient zoom and touch-scroll coordination ---
  // Anchor tracking, CSS-transform math, wheel-delta normalization, and
  // touch-scroll lock live in `ZoomGestureController`. This facade builds the
  // `ZoomGestureHost` capability object below and keeps the cross-cutting
  // "commit" sequencing (re-render, outline, navigation-state sync) here.

  /** Lazily-built host bridging `ZoomGestureController` to this facade's DOM state. */
  #zoomGestureHostObj: ZoomGestureHost | null = null;
  get #zoomGestureHost(): ZoomGestureHost {
    return (this.#zoomGestureHostObj ??= {
      getContentEl: () => this.#documentView.contentElement,
      getViewportRect: () => {
        const rect = this.#docContainerEl.getBoundingClientRect();
        return {
          left: rect.left + this.#docContainerEl.clientLeft,
          top: rect.top + this.#docContainerEl.clientTop,
          width: this.#docContainerEl.clientWidth,
          height: this.#docContainerEl.clientHeight,
        };
      },
      getScrollPosition: () => ({
        left: this.#docContainerEl.scrollLeft,
        top: this.#docContainerEl.scrollTop,
      }),
      setScrollPosition: pos => {
        if (pos.left !== undefined) this.#docContainerEl.scrollLeft = pos.left;
        if (pos.top !== undefined) this.#docContainerEl.scrollTop = pos.top;
      },
      getCurrentScale: () => this.#documentView.scale,
      getZoomLimits: () => ({ min: this.#zoomMinScale, max: this.#zoomMaxScale }),
      resolvePageAnchor: pt => {
        const el = this.#ownerDocument.elementFromPoint(pt.x, pt.y) as HTMLElement | null;
        const wrap = el?.closest(".pdf-page") as HTMLElement | null;
        const pageNo = Number(wrap?.dataset.page || "0") || null;
        const rect = wrap?.getBoundingClientRect();
        return pageNo && rect && rect.width > 0 && rect.height > 0
          ? { pageNo, rect }
          : this.#documentView.nearestPageAt(pt);
      },
      getHorizontalEnvelope: () => this.#documentView.transientHorizontalEnvelope(),
      showZoomLimitHint: direction => this.#showZoomLimitHint(direction),
      hideZoomLimitHint: () => this.#hideZoomLimitHint(),
    });
  }

  /** Stable capability object used for pointer interruption during document reset. */
  #pointerScrollHostObj: PointerScrollHost | null = null;
  #pointerScrollHost(): PointerScrollHost {
    return (this.#pointerScrollHostObj ??= {
      rowFitsHorizontally: () => this.#documentView.rowFitsHorizontally(),
      normalizeHorizontalScroll: () => this.#documentView.normalizeHorizontalScroll(),
      getScrollPosition: () => ({
        left: this.#docContainerEl.scrollLeft,
        top: this.#docContainerEl.scrollTop,
      }),
      setScrollPosition: pos => {
        if (pos.left !== undefined) this.#docContainerEl.scrollLeft = pos.left;
        if (pos.top !== undefined) this.#docContainerEl.scrollTop = pos.top;
      },
      setCursor: cursor => {
        this.#docContainerEl.style.cursor = cursor;
      },
    });
  }

  #sidebarPointerScrollHost(element: HTMLElement): PointerScrollHost {
    const existing = this.#sidebarPointerScrollHosts.get(element);
    if (existing) return existing;
    const host: PointerScrollHost = {
      rowFitsHorizontally: () => true,
      normalizeHorizontalScroll: () => {
        element.scrollLeft = 0;
      },
      getScrollPosition: () => ({ left: element.scrollLeft, top: element.scrollTop }),
      setScrollPosition: position => {
        if (position.top !== undefined) element.scrollTop = position.top;
      },
      setCursor: cursor => {
        if (cursor) element.dataset.pdfPointerScrollCursor = cursor;
        else delete element.dataset.pdfPointerScrollCursor;
      },
    };
    this.#sidebarPointerScrollHosts.set(element, host);
    return host;
  }

  /** Whether a persistent UI listener may begin or mutate a document interaction. */
  #canInteractWithDocument(): boolean {
    return (
      !this.#destroyed &&
      this.#documentLifetime.active &&
      this.#status === "ready" &&
      this.#pdf != null
    );
  }

  #assertAlive(operation: string): void {
    if (this.#destroyed) throw new Error(`PdfjsViewer: cannot ${operation} after destroy()`);
  }

  #assertReadyDocument(operation: string): void {
    this.#assertAlive(operation);
    if (!this.#canInteractWithDocument()) {
      throw new Error(`PdfjsViewer: cannot ${operation} without a ready document`);
    }
  }

  /** Begins transient zoom only while the active document accepts interaction. */
  #startTransientZoom(centerClient: { x: number; y: number }): boolean {
    if (!this.#canInteractWithDocument() || !this.#documentView.contentElement) return false;
    this.#invalidatePendingViewOperations();
    if (!this.#zoomGesture.active) this.#documentTextPresentation.suspendForZoom();
    this.#zoomGesture.start(centerClient, this.#zoomGestureHost);
    this.#rasterWorkCoordinator.setTransient(this.#zoomGesture.active);
    // A transformed descendant contributes visual overflow to scrollWidth in a
    // browser-dependent way. Pinch scrolling is locked anyway, so exclude that
    // transient overflow from native horizontal scrolling for the whole session.
    this.#documentView.updateHorizontalScrollLock(this.#zoomGesture.active);
    if (!this.#zoomGesture.active)
      this.#documentTextPresentation.resumeAfterZoom(this.#documentView.scale);
    return this.#zoomGesture.active;
  }

  /** Cancels cached transient geometry before resize or row-topology mutation. */
  #abortTransientZoomForLayoutChange(): void {
    if (!this.#zoomGesture.active) return;
    this.#zoomSliderDragActive = false;
    this.#docContainerEl.classList.remove(PDFJS_VIEWER_STATE_CLASSES.pinchActive);
    this.#zoomGesture.reset(this.#zoomGestureHost);
    this.#rasterWorkCoordinator.setTransient(false);
    this.#documentTextPresentation.resumeAfterZoom(this.#documentView.scale);
    this.#documentView.updateHorizontalScrollLock(false);
  }

  /** Update the transient CSS scale while zooming */
  #updateTransientZoom(targetScale: number, centerClient: { x: number; y: number }): void {
    if (!this.#canInteractWithDocument()) return;
    this.#zoomGesture.update(targetScale, centerClient, this.#zoomGestureHost);
  }

  /**
   * Commits scale, scaled layout, anchor restoration, and the render snapshot
   * atomically so no plan can observe new geometry with the old scroll position.
   */
  #commitTransientZoom(): void {
    if (!this.#zoomGesture.active) return;

    const commit = this.#zoomGesture.computeCommit(this.#zoomGestureHost);

    // Clear CSS transform
    if (this.#documentView.contentElement) {
      this.#documentView.contentElement.style.transform = "";
      this.#documentView.contentElement.style.transformOrigin = "";
    }

    // Disable scroll anchoring during commit to avoid thrash (FF)
    this.#overflowAnchorTimer = this.#documentLifetime.clearTimeout(this.#overflowAnchorTimer);
    this.#docContainerEl.style.setProperty("overflow-anchor", "none");

    const {
      fromScale: before,
      toScale: after,
      anchorContent,
      anchorPage,
      centerClient: anchor,
    } = commit;

    if (this.#documentView.scalesEqual(before, after)) {
      this.#documentTextPresentation.resumeAfterZoom(before);
      this.#updateFitUI();
      this.#finishTransientZoomSession();
      return;
    }

    this.#applyViewResult(
      this.#documentView.commitTransientZoom({
        fromScale: before,
        toScale: after,
        anchorContent,
        anchorPage,
        centerClient: anchor,
      }),
    );
    this.#updateFitUI();

    this.#finishTransientZoomSession();
  }

  /**
   * Final cleanup step after a transient pinch/wheel zoom commit.
   */
  #finishTransientZoomSession(): void {
    this.#zoomGesture.finishSession(this.#zoomGestureHost);
    this.#rasterWorkCoordinator.setTransient(false);
    if (this.#scrollPendingDuringTouchZoom) this.#scheduleScrollDerivedState();
    this.#overflowAnchorTimer = this.#documentLifetime.setTimeout(() => {
      this.#docContainerEl.style.removeProperty("overflow-anchor");
      this.#overflowAnchorTimer = null;
    }, 800);

    // Restore native horizontal scrolling only after the transform is gone and
    // session state has been cleared, then clamp against document geometry.
    this.#documentView.updateHorizontalScrollLock(false);

    // Update outline highlight after zoom commit
    this.#syncOutlineActive();
    this.#documentNavigation.scheduleNavigationStateSync(this.#navigationHost());
  }

  // --- Rendering profiles and resource budgets ---

  /** Synchronizes discovered rendering-profile radios to the effective profile. */
  #syncRenderingProfileControls(): void {
    const selected = this.#renderingProfile;
    for (const [profile, control] of [
      ["conservative", this.#renderingProfileToggleConservativeEl],
      ["balanced", this.#renderingProfileToggleBalancedEl],
      ["aggressive", this.#renderingProfileToggleAggressiveEl],
    ] as const) {
      if (control) control.checked = profile === selected;
    }
  }

  /** Applies one concrete rendering profile and reconciles all rendered output. */
  #setRenderingProfile(profile: PdfjsViewerRenderingProfile, force: boolean = false): void {
    if (!force && this.#renderingProfile === profile) {
      this.#syncRenderingProfileControls();
      return;
    }
    const settings = this.#renderingProfiles[profile];
    this.#log("debug", "rendering-profile-selected", `Selected ${profile} rendering profile`, {
      renderingProfile: profile,
      renderingSettings: settings,
      devicePixelRatio: Math.max(1, this.#ownerWindow.devicePixelRatio || 1),
    });
    this.#renderingProfile = profile;
    this.#renderingProfileRevision++;
    this.#documentRenderer.setProfile(profile, settings);
    this.#documentThumbnails.setProfile(settings);
    if (this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
    this.#syncRenderingProfileControls();
    // An open setup dialog must discard its old advisory result and preflight the new profile.
    this.#viewerPrintSetup?.syncState();
  }

  /** Combines shared profile canvas safety with profile-owned print resource policy. */
  #printBudgetLimits(settings: PdfjsViewerRenderingProfileSettings): Readonly<PrintBudgetLimits> {
    return Object.freeze({
      ...settings.print,
      memoryLimitMiB: settings.memoryLimitMiB,
      maxCanvasPixels: settings.maxCanvasPixels,
      maxCanvasDimension: settings.maxCanvasDimension,
    });
  }

  // --- Page geometry and render-window scheduling ---

  /** Reconciles raster and text output through the canonical view owner. */
  #reconcileRendering(
    priorityRange?: Readonly<{ first: number; last: number; center: number }>,
  ): void {
    if (!this.#pdf || !this.#documentView.hasRows) return;
    this.#documentView.reconcile(priorityRange);
  }

  /** Applies owner transaction side effects that remain facade coordination. */
  #applyViewResult(result: DocumentViewTransactionResult): void {
    if (result.kind === "unchanged") return;
    if (result.change.rotationChanged)
      this.#documentThumbnails.setRotation(this.#documentView.rotation);
    if (result.deferredScrollPage != null) {
      const scrollRequestGeneration = this.#scrollRequestGeneration;
      this.#documentLifetime.requestAnimationFrame(() => {
        if (scrollRequestGeneration !== this.#scrollRequestGeneration) return;
        if (this.#presentationMode && this.#presentationPageAnchor !== result.deferredScrollPage)
          return;
        this.#scrollToPage(result.deferredScrollPage!, false, false);
        this.#reconcileRendering();
      });
    }
    this.#scheduleScrollDerivedState();
  }

  // --- Lifecycle load admission, cancellation, and settlement ---

  #createLoadAttempt(requestGeneration: number): LoadAttempt {
    let resolve!: (result: PdfjsViewerLoadResult) => void;
    const promise = new Promise<PdfjsViewerLoadResult>(settle => {
      resolve = settle;
    });
    const attempt: LoadAttempt = {
      requestGeneration,
      promise,
      settled: false,
      settle(result) {
        if (attempt.settled) return;
        attempt.settled = true;
        resolve(Object.freeze(result));
      },
    };
    return attempt;
  }

  async #runLoadRequest(
    attempt: LoadAttempt,
    source: NormalizedPdfSource,
    initialPage: number | null,
    documentOptions: PdfjsViewerDocumentOptions,
  ): Promise<void> {
    try {
      this.#setTextSelectionMode(false, false);
      this.#setStatus("loading");
      // Invalidation and detachment are synchronous. Await only destruction of an
      // active loading task; proxy/render/preparation cleanup is detached below.
      await this.#closeDocument();
      if (!this.#isCurrentLoadAttempt(attempt)) return;

      this.#pdfUrl = source.type === "url" ? source.url : null;
      this.#pdfFilename = source.filename;
      this.#syncDownloadControl();
      this.#pendingInitialPage = initialPage;
      this.#pendingInitialResolvedDestination = null;
      this.#pendingInitialPdfNamedDestination = null;
      if (this.#shareableNamedDestinationPrefix && this.#navigationState) {
        const navigationDestinationId = this.#navigationState.readNavigationDestinationId()?.trim();
        if (navigationDestinationId) {
          this.#pendingInitialPdfNamedDestination = `${this.#shareableNamedDestinationPrefix}${navigationDestinationId}`;
        }
      }

      const result = await this.#load(source, documentOptions, attempt);
      if (result) this.#settleLoadAttempt(attempt, result);
    } catch (error) {
      const result = await this.#failLoadAttempt(attempt, error, this.#documentGeneration);
      if (result) this.#settleLoadAttempt(attempt, result);
    }
  }

  #isCurrentLoadAttempt(attempt: LoadAttempt): boolean {
    return (
      !this.#destroyed &&
      !attempt.settled &&
      this.#activeLoadAttempt === attempt &&
      attempt.requestGeneration === this.#documentRequestGeneration
    );
  }

  #settleLoadAttempt(attempt: LoadAttempt, result: PdfjsViewerLoadResult): void {
    attempt.settle(result);
    if (this.#activeLoadAttempt === attempt) this.#activeLoadAttempt = null;
  }

  #cancelActiveLoad(cause: PdfjsViewerLoadCancellationCause): void {
    const attempt = this.#activeLoadAttempt;
    if (!attempt) return;
    this.#activeLoadAttempt = null;
    attempt.settle({ ok: false, reason: "cancelled", cause });
  }

  #copyDocumentOptions(options: PdfjsViewerDocumentOptions): PdfjsViewerDocumentOptions {
    return {
      ...options,
      ...(options.httpHeaders ? { httpHeaders: { ...options.httpHeaders } } : {}),
    };
  }

  /** Returns true while asynchronous work still belongs to the active viewer. */
  #isCurrentDocument(pdf: PDFJS.PDFDocumentProxy, generation: number): boolean {
    return !this.#destroyed && generation === this.#documentGeneration && pdf === this.#pdf;
  }

  /**
   * Loads a PDF through PDF.js, reporting its native network progress and
   * initializing the viewer once parsing completes.
   *
   * Process:
   * PDF.js owns URL fetching, streaming, range requests, credentials, and
   * cancellation. In-memory sources are passed directly as document data.
   *
   * @param source - URL or in-memory PDF data.
   * @param documentOptions - Safe PDF.js document initialization options.
   */
  async #load(
    source: NormalizedPdfSource,
    documentOptions: PdfjsViewerDocumentOptions,
    attempt: LoadAttempt,
  ): Promise<PdfjsViewerLoadResult | null> {
    validateDocumentOptions(documentOptions);
    this.#activeDocumentOptions = {
      ...documentOptions,
      ...(documentOptions.httpHeaders ? { httpHeaders: { ...documentOptions.httpHeaders } } : {}),
    };
    this.#previousBoundaryControlPress?.reset();
    this.#nextBoundaryControlPress?.reset();
    this.#presentationInput.reset();
    this.#documentLifetime.cancel();
    this.#documentLifetime = this.#createLifecycleScope();
    const generation = ++this.#documentGeneration;
    this.#terminalLoadError = null;
    this.#log("debug", "load-started", "Started loading a PDF document", {
      generation,
      sourceType: source.diagnosticType,
    });
    this.#setStatus("loading");
    this.#setSidebarDocumentAvailability(true);
    if (this.#features.layers) this.#documentLayersPresentation.loading();

    // Cancel any in-flight load before starting a new one. Public load() calls
    // close() first, but this also makes overlapping replacement calls safe.
    runCleanup(() => this.#loadAbort?.abort());
    const supersededTask = this.#loadingTask;
    if (supersededTask) {
      this.#loadingTask = null;
      try {
        await supersededTask.destroy();
      } catch {}
    }
    if (!this.#isCurrentLoadAttempt(attempt) || generation !== this.#documentGeneration)
      return null;
    const ac = new AbortController();
    this.#loadAbort = ac;

    let passwordCancelled = false;
    let networkProgressActive = true;
    let taskForCleanup: ReturnType<typeof PDFJS.getDocument> | null = null;

    try {
      const { passwordProvider, pdfjsOptions } = pdfjsDocumentLoadOptions(
        documentOptions,
        this.#features.forms.xfa,
      );
      const task = this.#pdfjs.getDocument({
        ...pdfjsOptions,
        ...(source.type === "url" ? { url: source.url } : { data: source.data }),
      });
      taskForCleanup = task;
      this.#loadingTask = task;
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (
          !networkProgressActive ||
          this.#destroyed ||
          ac.signal.aborted ||
          generation !== this.#documentGeneration
        )
          return;
        this.#documentProgressFeedback.update(
          loaded * 0.9,
          total > 0 ? total : null,
          false,
          "load",
        );
      };
      if (passwordProvider) {
        task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          const passwordReason: PdfjsViewerPasswordReason =
            reason === 2 ? "incorrect-password" : "need-password";
          void Promise.resolve(passwordProvider({ reason: passwordReason }))
            .then(password => {
              if (
                password == null ||
                this.#destroyed ||
                ac.signal.aborted ||
                generation !== this.#documentGeneration
              ) {
                if (this.#loadingTask === task) {
                  passwordCancelled = password == null;
                  ac.abort();
                  void task.destroy();
                }
                return;
              }
              updatePassword(password);
            })
            .catch(() => {
              if (this.#loadingTask === task) {
                passwordCancelled = true;
                ac.abort();
                void task.destroy();
              }
            });
        };
      }
      const pdf = await task.promise;
      // Streaming/range transports may report additional bytes after PDF.js has
      // produced the document proxy. Those callbacks belong to background data
      // fetching and must not overwrite rendering progress or cancel its hide timer.
      networkProgressActive = false;

      if (this.#destroyed || ac.signal.aborted || generation !== this.#documentGeneration) {
        try {
          await pdf.cleanup();
        } catch {}
        return null;
      }
      validatePdfjsDocumentCapabilities(pdf, {
        attachments: this.#features.attachments,
        forms: this.#features.forms.interactive || this.#features.forms.xfa,
        layers: this.#features.layers,
        print: this.#features.print.mode !== "off",
      });
      this.#pdf = pdf;
      let printPermissionAllowed = true;
      try {
        const permissions = await pdf.getPermissions();
        printPermissionAllowed = resolvePdfjsPrintPermission(permissions).allowed;
      } catch {}
      // Permission reads may outlive replacement. Gate every shared-owner mutation
      // after the await so a stale document cannot reset the active presentation.
      if (!this.#isCurrentDocument(pdf, generation)) return null;
      this.#printPermissionAllowed = printPermissionAllowed;
      void this.#documentPresentation.beginDocument(pdf);
      if (!this.#isCurrentDocument(pdf, generation)) return null;
      const layersRenderState = await this.#documentLayers.beginDocument(pdf);
      if (!this.#isCurrentDocument(pdf, generation)) return null;
      if (layersRenderState) {
        this.#installRasterState(
          layersRenderState.revision,
          this.#formAppearanceRevision,
          layersRenderState.configurationPromise,
          true,
        );
        const layers = this.#documentLayers.getLayers();
        if (layers.ok) this.#documentLayersPresentation.ready(layers);
      } else {
        this.#installRasterState(0, this.#formAppearanceRevision, undefined, true);
        const layers = this.#documentLayers.getLayers();
        if (!layers.ok && layers.reason === "error")
          this.#documentLayersPresentation.error(layers.error);
      }
      this.#documentPageUsage = new DocumentPageUsage(pdf);
      this.#documentRenderer.beginDocument(pdf, this.#documentPageUsage);
      this.#layersAvailable = this.#documentLayers.hasLayers;
      this.#viewerPanels.setAvailableViews(
        this.#availableSidebarViews(),
        this.#behavior.initialSidebarView === "auto"
          ? (this.#availableSidebarViews()[0] ?? null)
          : this.#behavior.initialSidebarView,
      );
      this.#showInitialRenderProgress = true;
      this.#log("debug", "document-parsed", "PDF.js parsed the document", {
        generation,
        pageCount: pdf.numPages,
      });

      this.#documentProgressFeedback.update(0.9, 1, false, "render");

      await this.#afterPdfLoaded(pdf, generation);
      await this.#waitForDocumentReadiness(pdf, generation, ac.signal);
      if (!this.#isCurrentDocument(pdf, generation) || !this.#isCurrentLoadAttempt(attempt))
        return null;
      const terminalLoadError = this.#currentTerminalLoadError();
      if (terminalLoadError) {
        return this.#failLoadAttempt(attempt, terminalLoadError.error, generation);
      }
      if (this.#status !== "ready") return null;
      return { ok: true };
    } catch (err) {
      if (this.#destroyed || !this.#isCurrentLoadAttempt(attempt)) return null;
      if (passwordCancelled && generation === this.#documentGeneration) {
        await this.#closeDocument();
        if (!this.#isCurrentLoadAttempt(attempt)) return null;
        this.#setStatus("closed");
        return { ok: false, reason: "cancelled", cause: "password-cancelled" };
      }
      if (ac.signal.aborted) return null;
      return this.#failLoadAttempt(attempt, err, generation);
    } finally {
      networkProgressActive = false;
      // Do not let an older load clear a replacement load's task.
      if (this.#loadingTask === taskForCleanup) this.#loadingTask = null;
      if (this.#loadAbort === ac) this.#loadAbort = null;
    }
  }

  async #failLoadAttempt(
    attempt: LoadAttempt,
    error: unknown,
    generation: number,
  ): Promise<PdfjsViewerLoadResult | null> {
    if (!this.#isCurrentLoadAttempt(attempt) || generation !== this.#documentGeneration)
      return null;
    const sourceUrl = this.#pdfUrl;
    const sourceFilename = this.#pdfFilename;
    this.#log("error", "load-failed", "Document loading failed", { generation }, error);
    await this.#closeDocument();
    if (!this.#isCurrentLoadAttempt(attempt)) return null;
    this.#pdfUrl = sourceUrl;
    this.#pdfFilename = sourceFilename;
    this.#syncDownloadControl();
    this.#documentProgressFeedback.update(1, 1, false, "error");
    this.#setStatus("error");
    this.#pdfRootEl.dispatchEvent(
      new this.#ownerWindow.CustomEvent("pdf:error", { detail: { error } }),
    );
    return { ok: false, reason: "error", error };
  }

  #currentTerminalLoadError(): Readonly<{ error: unknown }> | null {
    return this.#terminalLoadError;
  }

  async #waitForDocumentReadiness(
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      !this.#isCurrentDocument(pdf, generation) ||
      signal.aborted ||
      this.#status === "ready" ||
      this.#terminalLoadError
    )
      return;
    await new Promise<void>(resolve => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (this.#initialRenderWaiter === settle) this.#initialRenderWaiter = null;
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = (): void => settle();
      this.#settleInitialRenderWaiter();
      this.#initialRenderWaiter = settle;
      signal.addEventListener("abort", onAbort, { once: true });
      if (
        !this.#isCurrentDocument(pdf, generation) ||
        signal.aborted ||
        this.#status === "ready" ||
        this.#terminalLoadError
      )
        settle();
    });
  }

  #settleInitialRenderWaiter(): void {
    const settle = this.#initialRenderWaiter;
    this.#initialRenderWaiter = null;
    settle?.();
  }

  /**
   * Post-load setup after PDF.js has parsed the document.
   *
   * Responsibilities:
   *  - Store page count and update UI.
   *  - Probe first page to determine base page dimensions.
   *  - Initialize layout rows.
   *  - Optionally start eager search-index and outline preparation.
   *  - Trigger initial rendering.
   *  - Trigger responsive rendering through the constructor-owned listeners.
   */
  async #afterPdfLoaded(pdf: PDFJS.PDFDocumentProxy, generation: number): Promise<void> {
    if (!this.#isCurrentDocument(pdf, generation)) return;

    if (this.#pageCountEl) this.#pageCountEl.textContent = String(pdf.numPages);

    // Read PDF preferred layout before first layout
    const preferredLayout = await this.#readPreferredLayout(pdf, generation);
    if (!this.#isCurrentDocument(pdf, generation)) return;

    // Resolve an optional persisted navigation ID through its full PDF named destination.
    await this.#resolvePendingInitialNavigationDestination(pdf, generation);
    if (!this.#isCurrentDocument(pdf, generation)) return;

    const initialReferencePage = this.#clamp(
      this.#pendingInitialResolvedDestination?.pageNo ?? this.#pendingInitialPage ?? 1,
      1,
      pdf.numPages,
    );
    const pageUsage = this.#documentPageUsage;
    if (!pageUsage) return;
    const firstUses = await this.#acquirePageUses(pageUsage, [initialReferencePage]);
    let fallback: Readonly<{ width: number; height: number }>;
    try {
      const page = firstUses[0]!.page;
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      fallback = { width: viewport.width, height: viewport.height };
    } finally {
      for (const use of firstUses) use.release();
    }
    if (!this.#isCurrentDocument(pdf, generation) || this.#documentPageUsage !== pageUsage) return;
    this.#documentThumbnails.beginDocument(pageUsage, pdf.numPages, fallback);
    const referenceRow = this.#documentView.initialReferenceRow({
      pageNo: initialReferencePage,
      pageCount: pdf.numPages,
      preferredLayout: preferredLayout?.viewerPageLayout ?? null,
      basePageSize: fallback,
    });
    const remainingPages = referenceRow.filter(pageNo => pageNo !== initialReferencePage);
    const uses = await this.#acquirePageUses(pageUsage, remainingPages);
    const exactGeometry = new Map<number, Readonly<{ width: number; height: number }>>();
    exactGeometry.set(initialReferencePage, fallback);
    try {
      for (let index = 0; index < uses.length; index++) {
        const page = uses[index].page;
        const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
        exactGeometry.set(remainingPages[index], {
          width: viewport.width,
          height: viewport.height,
        });
      }
    } finally {
      for (const use of uses) use.release();
    }
    if (!this.#isCurrentDocument(pdf, generation)) return;
    const skipInitialScroll =
      this.#pendingInitialPage != null || this.#pendingInitialResolvedDestination != null;
    this.#applyViewResult(
      this.#documentView.beginDocument({
        pageCount: pdf.numPages,
        basePageSize: fallback,
        pageBaseSizes: exactGeometry,
        fitReferencePage: initialReferencePage,
        preferredLayout: preferredLayout?.viewerPageLayout ?? null,
        preferredPrintLayout: preferredLayout?.printPreference ?? null,
        skipInitialScroll,
      }),
    );
    this.#lastObservedScrollTop = this.#docContainerEl.scrollTop;
    this.#updatePageNavDisabled(this.#documentView.currentRowIndex(this.#lastEmittedPage));
    this.#documentThumbnails.setActivePages(
      this.#documentView.rows[this.#documentView.currentRowIndex(this.#lastEmittedPage)] ?? [
        initialReferencePage,
      ],
    );
    this.#updateFitUI();
    this.#documentLifetime.requestAnimationFrame(() => {
      this.#documentView.measureRows();
      this.#applyPendingInitialNavigation();
    });

    // Start optional background feature preparation and kick off rendering.
    if (
      this.#features.searchPrepareOnLoad ||
      !!this.#searchQuery ||
      this.#searchPanelEl?.dataset.open === "true"
    ) {
      void this.#prepareSearchIndex();
    }
    this.#reconcileRendering();
    if (this.#features.outlinePrepareOnLoad || this.#viewerPanels.isSidebarViewOpen("outline")) {
      void this.#prepareOutline();
    }
    void this.#documentNavigation.prepareDestinations(this.#navigationHost());

    this.#configureZoomSliderBounds();
    this.#syncZoomSliderUI();
  }

  /**
   * Reads the PDF catalog's `PageLayout` preference and maps it to this
   * viewer's supported layout modes.
   *
   * - SinglePage / OneColumn -> single
   * - TwoPageLeft / TwoColumnLeft -> double (odd pages on the left)
   * - TwoPageRight / TwoColumnRight -> book (odd pages on the right;
   *   our "book" also keeps page 1 as cover)
   *
   * Unsupported or missing values are ignored, leaving the preferred mode unset.
   */
  async #readPreferredLayout(
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
  ): Promise<Readonly<CatalogPageLayoutPreference> | null> {
    try {
      const layout = (await pdf.getPageLayout()) || "";
      if (!this.#isCurrentDocument(pdf, generation)) return null;
      layout
        ? this.#log("debug", "pdf-preferred-layout", `PDF prefers layout: ${layout}`, {
            preferredLayout: layout,
          })
        : this.#log("debug", "pdf-preferred-layout-empty", "PDF does not specify preferred layout");
      return interpretCatalogPageLayout(layout);
    } catch (error) {
      return null;
    }
  }

  // --- Resize and layout synchronization ---

  /**
   * Request resize handling (throttled to rAF).
   */
  #onResize = (): void => {
    if (this.#resizeRaf != null) return;
    this.#resizeRaf = this.#documentLifetime.requestAnimationFrame(() => {
      this.#resizeRaf = null;
      this.#handleResize();
    });
  };

  /**
   * Handle window resize. If Fit is enabled, preserve the centered page across
   * scale/layout changes.
   */
  #handleResize = (): void => {
    if (!this.#docContainerEl.isConnected) return;
    if (this.#presentationViewTransitionDepth > 0) {
      this.#presentationResizePending = true;
      return;
    }
    this.#abortTransientZoomForLayoutChange();
    const keepPage =
      this.#pendingNavTargetPage ??
      (this.#presentationMode ? this.#presentationPageAnchor : null) ??
      this.#documentView.viewportPosition(this.#lastEmittedPage).pageNo;
    this.#documentView.refreshPresentationViewport();
    if (this.#documentView.fitActive && this.#canInteractWithDocument()) {
      void this.#performViewOperation({ refit: true, keepPage }).catch(error => {
        this.#log("error", "resize-fit-failed", "PDF resize fitting failed", {}, error);
      });
    } else {
      this.#applyViewResult(this.#documentView.resize(keepPage));
    }
    this.#updateFitUI();
    // Keep outline highlight in sync on resize-driven layout changes
    this.#syncOutlineActive();
    this.#documentNavigation.scheduleNavigationStateSync(this.#navigationHost());

    // Keep zoom slider (and Fit marker) in sync even when Fit is disabled.
    this.#syncZoomSliderUI();
  };

  /** Delegates an in-flow container resize to the canonical view owner. */
  #scheduleContainerLayoutSync(): void {
    if (this.#containerResizeRaf != null) return;
    this.#containerResizeRaf = this.#documentLifetime.requestAnimationFrame(() => {
      this.#containerResizeRaf = null;
      if (this.#destroyed) return;
      if (this.#presentationViewTransitionDepth > 0) {
        this.#presentationResizePending = true;
        return;
      }
      const presentationPage = this.#presentationMode ? this.#presentationPageAnchor : null;
      this.#documentView.resize(presentationPage ?? undefined, {
        refit: false,
        transientZoomActive: this.#zoomGesture.active,
      });
      if (presentationPage != null) this.#scrollToPage(presentationPage, false, false);
      this.#updateFitUI();
      this.#scheduleScrollDerivedState();
    });
  }

  // --- UI event wiring ---

  #wireSidebarPointerScrolling(element: HTMLElement): void {
    const controller = this.#sidebarPointerScroll;
    const host = this.#sidebarPointerScrollHost(element);
    let suppressClick = false;
    this.#on(element, "mousedown", (event: MouseEvent) => {
      if (
        !this.#hostActive ||
        !this.#viewerPanels.sidebarOpen ||
        !element.isConnected ||
        element.getClientRects().length === 0
      )
        return;
      if (event.button === 1) {
        controller.onAutoScrollStart(event.clientX, event.clientY, host);
        event.preventDefault();
        return;
      }
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      controller.onDragStart(startX, startY, host);
      event.preventDefault();
      const onMove = (moveEvent: MouseEvent) => {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 3) moved = true;
        controller.onDragMove(moveEvent.clientX, moveEvent.clientY, host);
      };
      let disposeMove = () => {};
      let disposeUp = () => {};
      const onUp = () => {
        controller.onDragEnd(host);
        disposeMove();
        disposeUp();
        if (moved) {
          suppressClick = true;
          this.#viewerLifetime.setTimeout(() => {
            suppressClick = false;
          }, 0);
        }
      };
      disposeMove = this.#viewerLifetime.listen(
        this.#ownerWindow,
        "mousemove",
        onMove as EventListener,
        true,
      );
      disposeUp = this.#viewerLifetime.listen(
        this.#ownerWindow,
        "mouseup",
        onUp as EventListener,
        true,
      );
    });
    this.#on(
      element,
      "click",
      (event: MouseEvent) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      },
      true,
    );
    this.#on(element, "mousemove", (event: MouseEvent) => {
      controller.onAutoScrollMove(event.clientX, event.clientY);
    });
    const stopAutoScroll = () => controller.onAutoScrollEnd(host);
    this.#on(element, "mouseup", stopAutoScroll);
    this.#on(element, "mouseleave", stopAutoScroll);
  }

  /**
   * Installs persistent facade-owned control and input listeners. Handlers that
   * mutate document interaction state guard entry with `#canInteractWithDocument`.
   */
  #wireUI(): void {
    this.#wireDocumentPointerInput();
    this.#wireNavigationControls();
    this.#wireZoomGestures();
    this.#wireSidebarInput();
    this.#wireViewControls();
    this.#wirePanelsAndSearch();
    this.#wireDocumentActions();
    this.#wirePrintAction();
    this.#wireModeControls();
  }

  #wireModeControls(): void {
    if (this.#fullscreenToggleBtnEl)
      this.#on(this.#fullscreenToggleBtnEl, "click", () => void this.toggleFullscreen());
    if (this.#presentationToggleBtnEl)
      this.#on(this.#presentationToggleBtnEl, "click", () => void this.togglePresentationMode());
  }

  #wireDocumentPointerInput(): void {
    // Drag scrolling prevents the browser's default mouse focus transfer.
    // Move focus explicitly for every primary mouse or touch interaction so
    // focused toolbar and outline inputs release focus without moving scroll.
    this.#on(this.#docContainerEl, "pointerdown", (e: PointerEvent) => {
      this.#cancelNavigationFromUserInput();
      if (!e.isPrimary) return;
      if (
        this.#documentTextPresentation?.isTextSelectionTarget(e.target) ||
        this.#documentPresentation.isFormControlTarget(e.target)
      )
        return;
      this.#docContainerEl.focus({ preventScroll: true });
    });

    // Direct wheel input cancels installed smooth movement, whether it becomes
    // native scrolling or a Ctrl/Meta zoom gesture below. Unresolved semantic
    // requests retain their generation and may still complete afterward.
    this.#on(this.#docContainerEl, "wheel", () => this.#cancelNavigationFromUserInput(), {
      passive: true,
    });

    // Prevent taps from activating links/buttons after a touch-pan/pinch.
    // (On mobile, a pan gesture can still produce a click on pointerup.)
    this.#on(
      this.#docContainerEl,
      "click",
      (e: MouseEvent) => {
        if (this.#ownerWindow.Date.now() < this.#suppressClickUntil) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true },
    );

    // Update page number as you scroll (use first page of current row).
    this.#on(this.#docContainerEl, "scroll", () => {
      if (this.#zoomGesture.touchScrollLocked && this.#zoomGesture.pinchInputActive) {
        this.#zoomGesture.syncTouchScrollLock(this.#zoomGestureHost);
        this.#scrollPendingDuringTouchZoom = true;
        return;
      }
      this.#scheduleScrollDerivedState();
    });

    // Gesture state machines live in `PointerScrollController`; this facade
    // only registers listeners and forwards raw events + DOM access via
    // `#pointerScrollHost`.
    const host = this.#pointerScrollHost();
    this.#on(this.#docContainerEl, "mousedown", (e: MouseEvent) => {
      if (!this.#canInteractWithDocument()) return;
      if (this.#presentationMode) return;
      if (e.button === 1) {
        this.#pointerScroll.onAutoScrollStart(e.clientX, e.clientY, host);
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      if (
        this.#documentTextPresentation?.isTextSelectionTarget(e.target) ||
        this.#documentPresentation.isFormControlTarget(e.target)
      )
        return;
      this.#pointerScroll.onDragStart(e.clientX, e.clientY, host);
      e.preventDefault();
      const onMove = (ev: MouseEvent) =>
        this.#pointerScroll.onDragMove(ev.clientX, ev.clientY, host);
      let disposeMove = () => {};
      let disposeUp = () => {};
      const onUp = () => {
        this.#pointerScroll.onDragEnd(host);
        disposeMove();
        disposeUp();
      };
      // Drag listeners belong to the active document, not permanent UI wiring.
      disposeMove = this.#documentLifetime.listen(
        this.#ownerWindow,
        "mousemove",
        onMove as EventListener,
        true,
      );
      disposeUp = this.#documentLifetime.listen(
        this.#ownerWindow,
        "mouseup",
        onUp as EventListener,
        true,
      );
    });
    this.#on(this.#docContainerEl, "mousemove", (e: MouseEvent) => {
      this.#pointerScroll.onAutoScrollMove(e.clientX, e.clientY);
    });
    const stopAutoScroll = () => this.#pointerScroll.onAutoScrollEnd(host);
    this.#on(this.#docContainerEl, "mouseup", stopAutoScroll);
    this.#on(this.#docContainerEl, "mouseleave", stopAutoScroll);
  }

  #wireNavigationControls(): void {
    if (this.#navigationHistoryBackBtnEl)
      this.#on(this.#navigationHistoryBackBtnEl, "click", () => this.goBack());
    if (this.#navigationHistoryForwardBtnEl)
      this.#on(this.#navigationHistoryForwardBtnEl, "click", () => this.goForward());
    // Prev/Next: click = one row; long-press = first/last page with history.
    if (this.#prevPageBtnEl) {
      const previousButton = this.#prevPageBtnEl;
      this.#previousBoundaryControlPress = new BoundaryControlPress({
        button: previousButton,
        longPressMs: this.#behavior.longPressMs,
        timers: this.#viewerLifetime,
        canPress: () => this.#canInteractWithDocument() && !previousButton.disabled,
        onShortPress: () => this.previousRow(),
        onLongPress: () => this.#scrollToPageWithHistory(1, true),
        listen: (target, type, listener, options) => this.#on(target, type, listener, options),
      });
    }
    if (this.#nextPageBtnEl) {
      const nextButton = this.#nextPageBtnEl;
      this.#nextBoundaryControlPress = new BoundaryControlPress({
        button: nextButton,
        longPressMs: this.#behavior.longPressMs,
        timers: this.#viewerLifetime,
        canPress: () => this.#canInteractWithDocument() && !nextButton.disabled,
        onShortPress: () => this.nextRow(),
        onLongPress: () => this.#scrollToPageWithHistory(this.#documentView.pageCount, true),
        listen: (target, type, listener, options) => this.#on(target, type, listener, options),
      });
    }
    if (this.#pageCountEl) {
      const pageCountElement = this.#pageCountEl;
      const LONG_PRESS_MS = this.#behavior.longPressMs;
      let pageCountTimer: number | null = null;
      const clearPageCountTimer = () => {
        pageCountTimer = this.#documentLifetime.clearTimeout(pageCountTimer);
      };

      this.#on(pageCountElement, "pointerdown", () => {
        if (!this.#canInteractWithDocument()) return;
        const txt = pageCountElement.textContent?.trim() || "";
        if (!txt || txt === "0" || txt === "?") return;
        clearPageCountTimer();
        pageCountTimer = this.#documentLifetime.setTimeout(() => {
          const currentTxt = pageCountElement.textContent?.trim() || "";
          if (!currentTxt || currentTxt === "0" || currentTxt === "?") return;
          this.#scrollToPageWithHistory(this.#documentView.pageCount, true);
        }, LONG_PRESS_MS);
      });
      const cancelPageCountPress = () => clearPageCountTimer();
      this.#on(pageCountElement, "pointerup", cancelPageCountPress);
      this.#on(pageCountElement, "pointerleave", cancelPageCountPress);
      this.#on(pageCountElement, "pointercancel", cancelPageCountPress);
      this.#on(pageCountElement, "blur", cancelPageCountPress);
    }
  }

  #wireZoomGestures(): void {
    // Zoom with Ctrl/⌘ + wheel (includes trackpad pinch on most browsers).
    // Discrete wheel steps interpolate their transient transform; continuous
    // touchpad input keeps its direct one-frame-per-sample response.
    if (this.#behavior.zoomGestures) {
      this.#on(
        this.#docContainerEl,
        "wheel",
        (e: WheelEvent) => {
          if (!(e.ctrlKey || e.metaKey)) return; // normal scroll otherwise
          if (this.#presentationMode) return;
          if (!this.#canInteractWithDocument() || !this.#documentView.contentElement) return;
          e.preventDefault();

          this.#zoomGesture.admitWheelSample(
            {
              delta: -ZoomGestureController.normalizeWheelZoomDelta(e),
              stepped: ZoomGestureController.isSteppedWheelZoomEvent(e),
              center: { x: e.clientX, y: e.clientY },
            },
            this.#zoomGestureHost,
            center => this.#startTransientZoom(center),
            () => {
              if (this.#canInteractWithDocument()) this.#commitTransientZoom();
              else this.#zoomGesture.reset(this.#zoomGestureHost);
            },
          );
        },
        { passive: false },
      );

      // Safari/WebKit pinch-to-zoom (trackpad + iOS): gesture events.
      // These are non-standard but still the most reliable path on Safari.
      {
        const fallbackGestureCenter = (): { x: number; y: number } => {
          const r = this.#docContainerEl.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };

        this.#on(
          this.#docContainerEl,
          "gesturestart",
          (event: Event) => {
            const e = event as WebKitGestureEvent;
            if (this.#presentationMode) return;
            if (!this.#canInteractWithDocument() || !this.#documentView.contentElement) return;
            e.preventDefault?.();

            // Safari may expose one physical pinch through both Pointer Events and
            // WebKit gesture events. Once the WebKit stream appears, it exclusively
            // owns the session so the two streams cannot commit or remain active
            // independently.
            setPinchSelectionSuppressed(
              this.#zoomGesture.beginWebKitGesture(
                { clientX: e.clientX, clientY: e.clientY, fallbackCenter: fallbackGestureCenter() },
                this.#zoomGestureHost,
                () => this.#abortTransientZoomForLayoutChange(),
                center => this.#startTransientZoom(center),
              ),
            );
          },
          { passive: false },
        );

        this.#on(
          this.#docContainerEl,
          "gesturechange",
          (event: Event) => {
            const e = event as WebKitGestureEvent;
            if (
              !this.#zoomGesture.webKitGestureActive ||
              !this.#canInteractWithDocument() ||
              !this.#documentView.contentElement
            )
              return;
            e.preventDefault?.();
            this.#zoomGesture.updateWebKitGesture(
              {
                scale: e.scale,
                clientX: e.clientX,
                clientY: e.clientY,
                fallbackCenter: fallbackGestureCenter(),
              },
              this.#zoomGestureHost,
            );
          },
          { passive: false },
        );

        const endGesture = (e: Event & { preventDefault?: () => void }) => {
          if (!this.#zoomGesture.endWebKitGesture()) return;
          e.preventDefault?.();
          setPinchSelectionSuppressed(false);
          if (this.#canInteractWithDocument()) {
            this.#suppressClickUntil = this.#ownerWindow.Date.now() + 350;
            this.#commitTransientZoom();
          } else {
            this.#zoomGesture.reset(this.#zoomGestureHost);
          }
        };

        this.#on(this.#ownerDocument, "gestureend", endGesture, { passive: false });
        this.#on(this.#ownerDocument, "gesturecancel", endGesture, { passive: false });
      }

      // Touch pinch zoom with Pointer Events.
      // Normal single-finger scrolling stays native. During a multi-touch pinch,
      // browser pinch-zoom is disabled and native scroll is temporarily locked so
      // the custom transient zoom transform remains stable.
      const setPinchSelectionSuppressed = (suppressed: boolean): void => {
        if (suppressed) {
          this.#docContainerEl.classList.add(PDFJS_VIEWER_STATE_CLASSES.pinchActive);
        } else {
          this.#docContainerEl.classList.remove(PDFJS_VIEWER_STATE_CLASSES.pinchActive);
        }
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (this.#presentationMode) return;
        if (!this.#canInteractWithDocument()) return;
        if (
          this.#zoomGesture.pointerDown(
            { id: e.pointerId, x: e.clientX, y: e.clientY },
            this.#zoomGestureHost,
            center => this.#startTransientZoom(center),
          )
        )
          setPinchSelectionSuppressed(true);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (!this.#canInteractWithDocument()) return;
        this.#zoomGesture.pointerMove(
          { id: e.pointerId, x: e.clientX, y: e.clientY },
          this.#zoomGestureHost,
        );
      };

      const onPointerUpOrCancel = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (this.#zoomGesture.pointerEnd(e.pointerId)) {
          setPinchSelectionSuppressed(false);
          if (this.#canInteractWithDocument()) {
            this.#suppressClickUntil = this.#ownerWindow.Date.now() + 350;
            this.#commitTransientZoom();
          } else {
            this.#zoomGesture.reset(this.#zoomGestureHost);
          }
        }
      };

      this.#on(this.#docContainerEl, "selectstart", (event: Event) => {
        if (this.#zoomGesture.pinchInputActive) event.preventDefault();
      });

      this.#on(this.#docContainerEl, "pointerdown", onPointerDown, { passive: true });
      this.#on(this.#docContainerEl, "pointermove", onPointerMove, { passive: true });
      this.#on(this.#ownerDocument, "pointerup", onPointerUpOrCancel, { passive: true });
      this.#on(this.#ownerDocument, "pointercancel", onPointerUpOrCancel, { passive: true });
      this.#on(
        this.#docContainerEl,
        "touchmove",
        (e: TouchEvent) => {
          if (
            this.#zoomGesture.webKitGestureActive ||
            (e.touches?.length ?? 0) >= 2 ||
            this.#zoomGesture.pinchInputActive
          ) {
            e.preventDefault();
            this.#zoomGesture.syncTouchScrollLock(this.#zoomGestureHost);
          }
        },
        { passive: false },
      );
    }
  }

  #wireSidebarInput(): void {
    if (this.#outlineContentEl) this.#wireSidebarPointerScrolling(this.#outlineContentEl);
    if (this.#thumbnailsContentEl) this.#wireSidebarPointerScrolling(this.#thumbnailsContentEl);
    if (this.#sidebarContainerEl) {
      const syncSettledSidebarLayout = (event: TransitionEvent) => {
        if (event.target === this.#sidebarContainerEl) this.#scheduleContainerLayoutSync();
      };
      this.#on(this.#sidebarContainerEl, "transitionend", syncSettledSidebarLayout);
      this.#on(this.#sidebarContainerEl, "transitioncancel", syncSettledSidebarLayout);
    }
  }

  #wireViewControls(): void {
    // Page layout toggle (if present in markup)
    const containViewFailure = (operation: Promise<void>) =>
      void operation.catch(error => {
        this.#syncPageLayoutControls();
        this.#syncFitModeControls();
        this.#log("error", "view-operation-failed", "PDF view operation failed", {}, error);
      });
    if (this.#pageLayoutToggleSingleEl)
      this.#on(this.#pageLayoutToggleSingleEl, "change", () =>
        containViewFailure(this.setPageLayout("single")),
      );
    if (this.#pageLayoutToggleDoubleEl)
      this.#on(this.#pageLayoutToggleDoubleEl, "change", () =>
        containViewFailure(this.setPageLayout("double")),
      );
    if (this.#pageLayoutToggleBookEl)
      this.#on(this.#pageLayoutToggleBookEl, "change", () =>
        containViewFailure(this.setPageLayout("book")),
      );
    if (this.#pageLayoutToggleAutoEl)
      this.#on(this.#pageLayoutToggleAutoEl, "change", () =>
        containViewFailure(this.setPageLayout("auto")),
      );
    if (this.#fitModeToggleAutoEl)
      this.#on(this.#fitModeToggleAutoEl, "change", () =>
        containViewFailure(this.setFitMode("auto")),
      );
    if (this.#fitModeToggleContainEl)
      this.#on(this.#fitModeToggleContainEl, "change", () =>
        containViewFailure(this.setFitMode("contain")),
      );
    if (this.#fitModeToggleWidthEl)
      this.#on(this.#fitModeToggleWidthEl, "change", () =>
        containViewFailure(this.setFitMode("width")),
      );
    if (this.#fitModeToggleHeightEl)
      this.#on(this.#fitModeToggleHeightEl, "change", () =>
        containViewFailure(this.setFitMode("height")),
      );
    if (this.#rotateCounterclockwiseBtnEl)
      this.#on(this.#rotateCounterclockwiseBtnEl, "click", () =>
        containViewFailure(this.rotateBy(-90)),
      );
    if (this.#resetRotationBtnEl)
      this.#on(this.#resetRotationBtnEl, "click", () => containViewFailure(this.resetRotation()));
    if (this.#rotateClockwiseBtnEl)
      this.#on(this.#rotateClockwiseBtnEl, "click", () => containViewFailure(this.rotateBy(90)));

    // Rendering profile toggles (if present in markup)
    if (this.#renderingProfileToggleConservativeEl)
      this.#on(this.#renderingProfileToggleConservativeEl, "change", () =>
        this.setRenderingProfile("conservative"),
      );
    if (this.#renderingProfileToggleBalancedEl)
      this.#on(this.#renderingProfileToggleBalancedEl, "change", () =>
        this.setRenderingProfile("balanced"),
      );
    if (this.#renderingProfileToggleAggressiveEl)
      this.#on(this.#renderingProfileToggleAggressiveEl, "change", () =>
        this.setRenderingProfile("aggressive"),
      );

    // Toolbar popover panels use the same explicit state and accessibility lifecycle.
    if (this.#textSelectionToggleBtnEl)
      this.#on(this.#textSelectionToggleBtnEl, "click", () => {
        this.setTextSelectionMode(!this.#textSelectionMode);
        this.#viewerPanels.toggleToolbar("menu", false);
      });

    // Fit buttons (reset zoom)
    if (this.#autoFitBtnEl)
      this.#on(this.#autoFitBtnEl, "click", () => containViewFailure(this.fit()));
    if (this.#autoFitMenuBtnEl)
      this.#on(this.#autoFitMenuBtnEl, "click", () => containViewFailure(this.fit()));

    // Zoom slider (optional)
    if (this.#zoomSliderEl) this.#wireZoomSlider();

    if (this.#pageNumEl) {
      const pageNumberInput = this.#pageNumEl;
      this.#on(pageNumberInput, "beforeinput", (e: InputEvent) => {
        if (e.data && !/^\d+$/.test(e.data)) {
          e.preventDefault();
        }
      });

      this.#on(pageNumberInput, "keydown", e => {
        // Jump to typed page number
        if (e.key === "Enter") {
          const desired = parseInt(pageNumberInput.value, 10);
          if (!isNaN(desired) && desired >= 1 && desired <= this.#documentView.pageCount) {
            this.#scrollToPageWithHistory(desired, true);
          } else {
            pageNumberInput.value = String(this.#lastEmittedPage);
          }
        }
        // Change pages with some keys in the input field
        if (e.key === "ArrowUp" || e.key === "PageUp") {
          e.preventDefault();
          this.previousRow(false);
        } else if (e.key === "ArrowDown" || e.key === "PageDown") {
          e.preventDefault();
          this.nextRow(false);
        } else if (e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          if (e.shiftKey) this.previousRow(false);
          else this.nextRow(false);
        }
        e.stopPropagation(); // prevent interfering with viewer keys
      });
      // Scroll wheel on input
      this.#on(
        pageNumberInput,
        "wheel",
        e => {
          const target = e.target as HTMLElement;
          if (target === pageNumberInput) {
            e.preventDefault();
            if (e.deltaY < 0) {
              this.previousRow(false);
            } else if (e.deltaY > 0) {
              this.nextRow(false);
            }
          }
        },
        { passive: false },
      );
      // Clamp on blur
      this.#on(pageNumberInput, "blur", () => this.#jumpToPageInput(true));
    }
  }

  #wirePanelsAndSearch(): void {
    // Search UI
    if (this.#searchInputEl)
      this.#on(this.#searchInputEl, "input", e => {
        const v = (e.target as HTMLInputElement).value;
        this.#updateSearchQuery(v, false); // live: non-forced
      });
    if (this.#searchPrevBtnEl) this.#on(this.#searchPrevBtnEl, "click", () => this.#searchPrev());
    if (this.#searchNextBtnEl) this.#on(this.#searchNextBtnEl, "click", () => this.#searchNext());
  }

  #wireDocumentActions(): void {
    // URL-backed links retain native browser behavior. Byte-backed links need
    // asynchronous PDF.js extraction before a temporary object URL can be used.
    const download = this.#downloadBtnEl;
    if (download)
      this.#on(download, "click", event => {
        if (this.#pdfUrl) return;
        event.preventDefault();
        void this.download().catch(error => {
          this.#log("error", "download-failed", "Download action failed", {}, error);
        });
      });
    const downloadFilledDocument = this.#downloadFilledDocumentBtnEl;
    if (downloadFilledDocument)
      this.#on(downloadFilledDocument, "click", () => {
        this.#downloadFilledDocumentBusy = true;
        this.#syncFilledDocumentDownloadControl();
        void this.download({ document: "with-form-values" })
          .then(result => {
            if (!result.ok && result.reason === "error") {
              this.#log(
                "error",
                "download-filled-document-failed",
                "Filled PDF download failed",
                {},
                result.error,
              );
            }
          })
          .catch(error => {
            this.#log(
              "error",
              "download-filled-document-failed",
              "Filled PDF download failed",
              {},
              error,
            );
          })
          .finally(() => {
            this.#downloadFilledDocumentBusy = false;
            this.#syncFilledDocumentDownloadControl();
          });
      });
  }

  #wirePrintAction(): void {
    // Print button
    const printButton = this.#printBtnEl;
    if (printButton && !this.#viewerPrintSetup)
      this.#on(printButton, "click", () => {
        this.#closeTransientUi();
        this.#logPrintRoute("button");
        void this.#executePrint({}, false).catch(error => {
          this.#log("error", "print-failed", "Print action failed", { error });
        });
      });
  }

  /**
   * Apply host-driven active/inactive visibility rules for transient overlay UI.
   *
   * This keeps the viewer standalone: the host may call {@link setActive} when
   * switching views, but the viewer itself owns the exact DOM tweaks required to
   * avoid overlay leaks.
   */
  // --- Sidebar and toolbar-popover interaction ---

  /** Clears document-search state when its popover closes. */
  #resetSearchPanel(): void {
    this.#clearAllHighlights(true);
    if (this.#searchInputEl) this.#searchInputEl.value = "";
    this.#searchQuery = "";
    this.#searchQueryForced = false;
    this.#searchMatches = [];
    this.#presentedSearchMatches = null;
    this.#searchPos = -1;
    this.#updateSearchCount();
  }

  /**
   * Attempts to navigate to a user-specified page number from the input field.
   *
   * @param snapBack - If `true`, and the input value is invalid,
   *                   the page number input will reset to the last valid page.
   */
  #jumpToPageInput(snapBack = false): void {
    const pageNumberInput = this.#pageNumEl;
    if (!pageNumberInput) return;
    const desired = parseInt(pageNumberInput.value, 10);
    if (!isNaN(desired) && desired >= 1 && desired <= this.#documentView.pageCount) {
      this.#scrollToPageWithHistory(desired, true);
    } else if (snapBack) {
      pageNumberInput.value = String(this.#lastEmittedPage);
    }
  }

  // --- Page layout and automatic fitting ---

  /** Hides Fit controls only while the owner reports a current fit. */
  #updateFitUI(): void {
    const needsButton = !this.#documentView.fitActive || this.#documentView.fitNeedsRefresh();
    if (this.#autoFitBtnEl)
      this.#autoFitBtnEl.style.visibility = needsButton ? "inherit" : "hidden";
    if (this.#autoFitMenuBtnEl)
      this.#autoFitMenuBtnEl.style.visibility = needsButton ? "inherit" : "hidden";
    this.#syncZoomSliderUI();
  }

  // --- Optional zoom-slider control ---

  /** Returns the document viewport center in client coordinates. */
  #viewportCenterClient(): { x: number; y: number } {
    const rect = this.#docContainerEl.getBoundingClientRect();
    return {
      x: rect.left + this.#docContainerEl.clientWidth / 2,
      y: rect.top + this.#docContainerEl.clientHeight / 2,
    };
  }

  /** Applies fit-to-viewport zoom while preserving the centered page. */
  #applyFitZoom(): void {
    if (!this.#canInteractWithDocument()) return;
    this.#applyViewResult(this.#documentView.applyFit());
    this.#updateFitUI();
  }

  /** Applies a bounded explicit scale while preserving a client-coordinate anchor. */
  #zoomToWithAnchor(scale: number, anchorClient: { x: number; y: number }): void {
    if (!this.#canInteractWithDocument()) return;
    this.#invalidatePendingViewOperations();
    this.#applyViewResult(this.#documentView.setExplicitScale(scale, anchorClient));
    this.#updateFitUI();
  }

  /** Configures the optional zoom slider's normalized logarithmic range. */
  #configureZoomSliderBounds(): void {
    if (!this.#zoomSliderEl) return;
    // Use a normalized 0..100 slider and map -> scale logarithmically.
    this.#zoomSliderEl.min = "0";
    this.#zoomSliderEl.max = "100";
    this.#zoomSliderEl.step = "1";
  }

  /** Maps an absolute zoom scale to the slider's logarithmic percentage. */
  #scaleToSliderPct(scale: number): number {
    const min = this.#zoomMinScale;
    const max = this.#zoomMaxScale;
    const clamped = this.#clamp(scale, min, max);

    // Log mapping feels more natural across wide zoom ranges.
    const ratio = max / min;
    if (!Number.isFinite(ratio) || ratio <= 1.0001) return 0;

    const pct = (Math.log(clamped / min) / Math.log(ratio)) * 100;
    return this.#clamp(pct, 0, 100);
  }

  /** Maps the slider's normalized percentage to an absolute zoom scale. */
  #sliderPctToScale(pct: number): number {
    const min = this.#zoomMinScale;
    const max = this.#zoomMaxScale;
    const p = this.#clamp(pct, 0, 100);

    const ratio = max / min;
    if (!Number.isFinite(ratio) || ratio <= 1.0001) return min;

    return min * Math.exp((p / 100) * Math.log(ratio));
  }

  /** Synchronizes the slider thumb, spoken value, and fit marker with viewer state. */
  #syncZoomSliderUI(): void {
    const slider = this.#zoomSliderEl;
    if (!slider) return;

    // Don't fight the user's drag; the slider already shows their desired value.
    if (!this.#zoomSliderDragActive) {
      const pct = this.#scaleToSliderPct(this.#documentView.scale);
      slider.value = String(Math.round(pct));

      // Accessibility: keep a spoken value even though we don't show numbers visually.
      slider.setAttribute("aria-valuetext", this.#formatters.zoom(this.#documentView.scale));
    }

    // Marker for Fit zoom target.
    // Snap to the same slider step so the marker aligns with the thumb.
    if (this.#zoomSliderWrapEl) {
      const fit = this.#documentView.computeFitScale();
      const fitPct = this.#scaleToSliderPct(fit);
      const fitStepPct = this.#clamp(Math.round(fitPct), 0, 100);
      this.#zoomSliderWrapEl.style.setProperty("--pdf-fit-marker-f", String(fitStepPct / 100));
    }
  }

  /** Wires pointer, keyboard, and transient-render behavior for the zoom slider. */
  #wireZoomSlider(): void {
    const slider = this.#zoomSliderEl;
    if (!slider) return;

    const applyFromSlider = () => {
      if (!this.#canInteractWithDocument()) return;
      const pct = Number(slider.value) || 0;
      const targetScale = this.#sliderPctToScale(pct);
      const anchor = this.#viewportCenterClient();

      if (this.#zoomSliderDragActive && this.#documentView.contentElement) {
        if (!this.#zoomGesture.active) this.#startTransientZoom(anchor);
        this.#updateTransientZoom(targetScale, anchor);
      } else {
        this.#zoomToWithAnchor(targetScale, anchor);
      }
    };

    this.#on(slider, "pointerdown", (e: PointerEvent) => {
      // Don't let the click bubble up to any dropdown auto-close logic.
      e.stopPropagation();
      if (!this.#canInteractWithDocument()) return;
      this.#zoomSliderDragActive = true;
      const anchor = this.#viewportCenterClient();
      this.#startTransientZoom(anchor);
    });

    this.#on(slider, "input", () => {
      if (!this.#canInteractWithDocument()) return;
      if (this.#zoomSliderRaf != null) return;
      this.#zoomSliderRaf = this.#documentLifetime.requestAnimationFrame(() => {
        this.#zoomSliderRaf = null;
        applyFromSlider();
      });
    });

    const endDrag = () => {
      if (!this.#zoomSliderDragActive) return;
      this.#zoomSliderDragActive = false;

      // Commit transient zoom if we used it; otherwise apply directly.
      if (this.#canInteractWithDocument()) {
        if (this.#zoomGesture.active) this.#commitTransientZoom();
        else applyFromSlider();
      } else {
        this.#zoomGesture.reset(this.#zoomGestureHost);
      }

      // Avoid accidental clicks closing menus after dragging.
      if (this.#canInteractWithDocument())
        this.#suppressClickUntil = this.#ownerWindow.Date.now() + 250;
    };

    this.#on(slider, "pointerup", (e: PointerEvent) => {
      e.stopPropagation();
      endDrag();
    });
    this.#on(slider, "pointercancel", (e: PointerEvent) => {
      e.stopPropagation();
      endDrag();
    });

    // Keyboard changes (Arrow keys) typically trigger `change`.
    this.#on(slider, "change", () => {
      if (this.#zoomSliderDragActive) return;
      if (!this.#canInteractWithDocument()) return;
      applyFromSlider();
    });
  }

  // --- Page overlays ---

  /** Applies admitted load navigation before the first render reconciliation. */
  #applyPendingInitialNavigation(): void {
    if (this.#pendingInitialResolvedDestination != null && this.#documentView.pageCount > 0) {
      const { pageNo } = this.#pendingInitialResolvedDestination;
      this.#pendingInitialResolvedDestination = null;
      this.#pendingInitialPage = null;

      const targetPage = this.#clamp(pageNo, 1, this.#documentView.pageCount);

      // Initial URL anchor navigation keeps the exact spot sticky, but scrolls
      // only the full page into view just like outline clicks do.
      this.#scrollToPage(targetPage, false, false);

      const idx = this.#documentView.rowIndexForPage(targetPage) ?? 0;
      const firstPageInRow = this.#documentView.rows[idx]?.[0] ?? targetPage;
      if (this.#pageNumEl) this.#pageNumEl.value = String(firstPageInRow);
      this.#updatePageNavDisabled(idx);
    } else if (this.#pendingInitialPage != null && this.#documentView.pageCount > 0) {
      const target = this.#clamp(this.#pendingInitialPage, 1, this.#documentView.pageCount);
      this.#pendingInitialPage = null;

      // Jump without animation. This will influence which pages get rendered first.
      this.#scrollToPage(target, false, false);

      // Best-effort UI sync (scroll handler will also run).
      const idx = this.#documentView.rowIndexForPage(target) ?? 0;
      const firstPageInRow = this.#documentView.rows[idx]?.[0] ?? target;
      if (this.#pageNumEl) this.#pageNumEl.value = String(firstPageInRow);
      this.#updatePageNavDisabled(idx);
    }

    this.#reconcileRendering();
  }

  /** Coordinates independent annotation and text owners for one committed output. */
  async #presentRenderedPage(context: Readonly<RenderPresentationContext>): Promise<void> {
    await settleIndependentPresentations(
      () => this.#documentPresentation.present(context),
      () => {
        if (
          context.capabilities.text &&
          context.isCurrent("text") &&
          (this.#features.search || this.#features.textSelection) &&
          this.#documentTextPresentation.needsPresentation(context.pageNo, context.viewport.scale)
        ) {
          return this.#documentTextPresentation.present(context);
        }
      },
    );
  }

  /** Atomically installs one future layers/forms raster state across both raster owners. */
  #installRasterState(
    optionalContentRevision: number,
    formAppearanceRevision: number,
    optionalContentConfigPromise?: NonNullable<
      Parameters<PDFJS.PDFPageProxy["render"]>[0]["optionalContentConfigPromise"]
    >,
    force = false,
  ): void {
    const main = this.#documentRenderer.suspendAdmission();
    const thumbnails = this.#documentThumbnails.suspendAdmission();
    try {
      const shared = {
        optionalContentRevision,
        ...(optionalContentConfigPromise ? { optionalContentConfigPromise } : {}),
      };
      this.#documentRenderer.setRasterState(
        Object.freeze({
          ...shared,
          annotationMode: this.#features.forms.interactive
            ? this.#pdfjs.AnnotationMode.ENABLE_FORMS
            : this.#pdfjs.AnnotationMode.ENABLE,
        }),
        force,
      );
      this.#documentThumbnails.setRasterState(
        Object.freeze({
          ...shared,
          annotationMode: this.#features.forms.interactive
            ? this.#pdfjs.AnnotationMode.ENABLE_STORAGE
            : this.#pdfjs.AnnotationMode.ENABLE,
          formAppearanceRevision,
          formAppearanceRevisionFor: (pageNo: number) =>
            this.#documentPresentation.formAppearanceRevision(pageNo),
          printAnnotationStorageFor: (pageNo: number, revision: number) =>
            this.#documentPresentation.thumbnailStorage(pageNo, revision),
        }),
        force,
      );
    } finally {
      this.#documentRenderer.resumeAdmission(main.token);
      this.#documentThumbnails.resumeAdmission(thumbnails.token);
    }
  }

  /** Resolves one owner-emitted annotation intent through canonical navigation policy. */
  async #followAnnotationDestination(destination: PdfDestinationInput): Promise<void> {
    const pdf = this.#pdf;
    const pageUsage = this.#documentPageUsage;
    if (!pdf || !pageUsage || this.#status !== "ready") return;
    const navigation = this.#beginNavigationIntent(true);
    const resolved = await resolvePdfDestinationValue(
      pdf,
      destination,
      pageUsage,
      this.#documentView.rotation,
    );
    if (!this.#isCurrentNavigationIntent(navigation) || this.#pdf !== pdf || !resolved) return;
    const targetPage = resolved.pageIndex + 1;
    this.#documentNavigation.selectResolvedDestination(
      this.#navigationHost(),
      {
        pageNo: targetPage,
        yRatio: resolved.yRatio,
        xRatio: resolved.xRatio,
      },
      typeof destination === "string" ? destination : undefined,
    );
    this.#commitNavigationIntent(
      navigation,
      Object.freeze({
        page: targetPage,
        yRatio: resolved.yRatio ?? 0,
        ...(resolved.xRatio == null ? {} : { xRatio: resolved.xRatio }),
        usePosition: resolved.yRatio != null || resolved.xRatio != null,
        smooth: true,
      }),
      true,
    );
  }

  /** Applies the navigation-only named actions admitted by annotation policy. */
  #followAnnotationNamedAction(action: string): void {
    if (this.#status !== "ready" || !this.#pdf) return;
    const current = this.#documentView.currentRowIndex(this.#lastEmittedPage);
    switch (action) {
      case "FirstPage":
        this.#scrollToPageWithHistory(1, true);
        break;
      case "LastPage":
        this.#scrollToPageWithHistory(this.#documentView.pageCount, true);
        break;
      case "NextPage":
      case "PageDown":
        this.#releasePendingExplicitMovement();
        this.#scrollToRow(current + 1, true);
        break;
      case "PrevPage":
      case "PageUp":
        this.#releasePendingExplicitMovement();
        this.#scrollToRow(current - 1, true);
        break;
    }
  }

  /** Clears search matches through the text-presentation owner. */
  #clearAllHighlights(reconcileDemand = false): void {
    this.#documentTextPresentation.setSearchMatches([]);
    if (reconcileDemand && this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
  }

  // --- Row navigation and destination selection state ---

  /**
   * Resolves relative row navigation from an in-flight programmatic target when
   * present. Smooth scrolling leaves the physical position in its source row
   * for part of the animation, so using it directly would drop rapid forward
   * requests instead of extending the requested destination.
   */
  #navigationRowIndex(): number {
    const pendingPage = this.#presentationPageAnchor ?? this.#pendingNavTargetPage;
    const pendingIndex =
      pendingPage == null ? undefined : this.#documentView.rowIndexForPage(pendingPage);
    return pendingIndex ?? this.#documentView.currentRowIndex(this.#lastEmittedPage);
  }

  /**
   * Scrolls the document container to bring the specified row into view.
   *
   * @param index - The row index to scroll to. If out of range, it will be
   *                clamped within [0, rows.length - 1].
   * @param smooth - Whether scrolling should animate smoothly (`true`) or jump
   *                 instantly (`false`). Defaults to `true`.
   * @param trackMotion - Whether an instant jump should influence render direction.
   */
  #scrollToRow(index: number, smooth = true, trackMotion = true): void {
    this.#scrollRequestGeneration++;
    index = this.#clamp(index, 0, this.#documentView.rows.length - 1);
    if (this.#presentationMode) {
      this.#presentationPageAnchor = this.#documentView.rows[index]?.[0] ?? 1;
    }
    if (!smooth) {
      this.#cancelSmoothNavigation();
      // Assignment is synchronous, allowing API navigation to reprioritize before
      // the deferred scroll event gives old speculative work another admission slot.
      this.#documentView.scrollToRow(index, false, trackMotion);
      this.#scheduleScrollDerivedState();
    } else {
      const targetPage = this.#documentView.rows[index]?.[0] ?? 1;
      this.#setPendingNavigationTarget(targetPage);
      if (this.#scrollBehavior(true) === "auto") {
        this.#cancelSmoothNavigation();
        this.#documentView.scrollToRow(index, false, trackMotion);
        this.#scheduleScrollDerivedState();
      } else {
        const targetTop = this.#documentView.pageRowScrollTop(targetPage) ?? 0;
        this.#startSmoothNavigation(targetTop);
      }
      if (this.#pageNumEl) this.#pageNumEl.value = String(targetPage);
      this.#updatePageNavDisabled(index);
      if (targetPage !== this.#lastEmittedPage) {
        this.#lastEmittedPage = targetPage;
        this.#pdfRootEl.dispatchEvent(
          new this.#ownerWindow.CustomEvent("pdf:pagechange", { detail: { page: targetPage } }),
        );
        this.#emitStateChange();
      }
    }
  }

  /** Tracks active vertical direction and returns planning to center-out after idle. */
  #observeRenderMotion(scrollTop: number): void {
    const previous = this.#lastObservedScrollTop;
    this.#lastObservedScrollTop = scrollTop;
    if (previous == null || scrollTop === previous) return;
    this.#setRenderMotion(scrollTop > previous ? "forward" : "backward", "vertical-scroll");
    this.#scrollMotionIdleTimer = this.#documentLifetime.clearTimeout(this.#scrollMotionIdleTimer);
    this.#scrollMotionIdleTimer = this.#documentLifetime.setTimeout(() => {
      this.#scrollMotionIdleTimer = null;
      this.#setRenderMotion("stationary", "scroll-idle");
      if (this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
    }, SCROLL_MOTION_IDLE_MS);
  }

  #setRenderMotion(
    motion: RenderMotion,
    reason: "vertical-scroll" | "scroll-idle" | "internal-scroll",
  ): void {
    const previousMotion = this.#docContainerEl.dataset.pdfRenderMotion ?? "stationary";
    if (motion === previousMotion) return;
    this.#docContainerEl.dataset.pdfRenderMotion = motion;
    this.#documentView.setMotion(motion);
    this.#rasterWorkCoordinator.setStationary(motion === "stationary");
    this.#log("debug", "render-motion-changed", `Render motion changed to ${motion}`, {
      previousMotion,
      motion,
      reason,
      idleDelayMs: SCROLL_MOTION_IDLE_MS,
    });
  }

  /** Coalesces scroll-derived facade state and defers it across touch pinch ownership. */
  #scheduleScrollDerivedState(): void {
    if (this.#scrollRaf != null) return;
    this.#scrollRaf = this.#documentLifetime.requestAnimationFrame(() => {
      this.#scrollRaf = null;
      if (this.#zoomGesture.touchScrollLocked && this.#zoomGesture.pinchInputActive) {
        this.#zoomGesture.syncTouchScrollLock(this.#zoomGestureHost);
        this.#scrollPendingDuringTouchZoom = true;
        return;
      }
      this.#scrollPendingDuringTouchZoom = false;
      this.#documentView.normalizeHorizontalScroll();
      const scrollTop = this.#docContainerEl.scrollTop;
      if (this.#lastObservedScrollTop == null) this.#lastObservedScrollTop = 0;
      this.#observeRenderMotion(scrollTop);
      const presentationPage = this.#presentationMode ? this.#presentationPageAnchor : null;
      const pendingPage = presentationPage ?? this.#pendingNavTargetPage;
      let position = this.#documentView.viewportPosition(pendingPage ?? this.#lastEmittedPage);
      if (presentationPage != null && position.pageNo !== presentationPage) {
        this.#documentView.scrollToPage(presentationPage, false, false);
        position = this.#documentView.viewportPosition(presentationPage);
      }
      const idx = position.rowIndex;
      const currentPage = presentationPage ?? position.pageNo;
      const pendingIndex =
        pendingPage == null ? null : this.#documentView.rowIndexForPage(pendingPage);
      if (this.#pageNumEl) this.#pageNumEl.value = String(pendingPage ?? currentPage);
      this.#updatePageNavDisabled(pendingIndex ?? idx);
      this.#documentThumbnails.setActivePages(
        this.#documentView.rows[pendingIndex ?? idx] ?? [currentPage],
      );
      this.#reconcileRendering();
      this.#updateFitUI();
      this.#syncOutlineActive();
      this.#documentNavigation.scheduleNavigationStateSync(this.#navigationHost());

      if (
        (presentationPage != null || pendingPage == null) &&
        currentPage !== this.#lastEmittedPage
      ) {
        this.#lastEmittedPage = currentPage;
        this.#pdfRootEl.dispatchEvent(
          new this.#ownerWindow.CustomEvent("pdf:pagechange", { detail: { page: currentPage } }),
        );
        this.#emitStateChange();
      }
      if (presentationPage == null && pendingPage != null && pendingIndex === idx) {
        this.#pendingNavTargetPage = null;
        if (!this.#smoothNavigation && !this.#pendingExplicitNavigationIntent?.usePosition)
          this.#pendingExplicitNavigationIntent = null;
        this.#pendingNavClearTimer = this.#documentLifetime.clearTimeout(
          this.#pendingNavClearTimer,
        );
      }
    });
  }

  /**
   * Scrolls to the row that contains the specified page number.
   *
   * @param pageNo - The page number to scroll to.
   * @param smooth - Whether scrolling should be animated smoothly (default: false).
   * @param trackMotion - Whether an instant jump should influence render direction.
   */
  #scrollToPage(pageNo: number, smooth = false, trackMotion = true): void {
    const idx = this.#documentView.rowIndexForPage(pageNo);
    if (idx != null) this.#scrollToRow(idx, smooth, trackMotion);
  }

  /** Captures an active document location without retaining view or DOM objects. */
  #captureDocumentLocation(): Readonly<DocumentLocation> | null {
    if (!this.#features.navigationHistory || this.#status !== "ready" || !this.#pdf) return null;
    return this.#documentView.captureDocumentLocation();
  }

  /** Commits one previously admitted semantic departure without publishing intermediate state. */
  #recordNavigationDeparture(location: Readonly<DocumentLocation> | null): boolean {
    if (
      !location ||
      this.#presentationMode ||
      !this.#features.navigationHistory ||
      this.#status !== "ready"
    )
      return false;
    return this.#documentNavigationHistory.recordDeparture(location);
  }

  /** Performs one explicit page-row jump as a facade-owned history transaction. */
  #scrollToPageWithHistory(pageNo: number, smooth = false): boolean {
    const navigation = this.#beginNavigationIntent(true);
    return this.#commitNavigationIntent(
      navigation,
      Object.freeze({ page: pageNo, yRatio: 0, usePosition: false, smooth }),
      true,
    ).moved;
  }

  /** Tests a page-only target against the installed row geometry. */
  #pageJumpWouldMove(pageNo: number): boolean {
    const targetTop = this.#documentView.pageRowScrollTop(pageNo);
    if (targetTop == null) return false;
    return Math.abs(this.#docContainerEl.scrollTop - targetTop) > 0.01;
  }

  /** Restores one selected history target and commits stack mutation only on admission. */
  #restoreNavigationHistory(direction: "back" | "forward"): boolean {
    if (
      !this.#features.navigationHistory ||
      this.#destroyed ||
      this.#status !== "ready" ||
      !this.#pdf
    )
      return false;
    this.#settlePendingExplicitNavigation();
    this.#invalidateNavigationIntent();
    const current = this.#documentView.captureDocumentLocation();
    if (!current) return false;
    const transition =
      direction === "back"
        ? this.#documentNavigationHistory.takeBack(current)
        : this.#documentNavigationHistory.takeForward(current);
    if (!transition) return false;
    this.#cancelSmoothNavigation();
    if (!this.#documentView.restoreDocumentLocation(transition.target)) return false;
    if (!transition.commit()) return false;
    this.#scheduleScrollDerivedState();
    this.#syncNavigationHistoryControls();
    this.#emitStateChange();
    return true;
  }

  /** Starts a newer semantic request after settling any installed smooth destination. */
  #beginNavigationIntent(recordHistory: boolean): Readonly<{
    documentGeneration: number;
    navigationGeneration: number;
    departure: Readonly<DocumentLocation> | null;
  }> {
    const navigationGeneration = ++this.#navigationIntentGeneration;
    this.#settlePendingExplicitNavigation();
    return Object.freeze({
      documentGeneration: this.#documentGeneration,
      navigationGeneration,
      departure:
        recordHistory && navigationGeneration === this.#navigationIntentGeneration
          ? this.#captureDocumentLocation()
          : null,
    });
  }

  /** Invalidates pending async/deferred navigation without changing document history. */
  #invalidateNavigationIntent(): void {
    this.#navigationIntentGeneration++;
    this.#pendingExplicitNavigationIntent = null;
  }

  /** Releases only installed movement state without superseding unresolved semantic requests. */
  #releasePendingExplicitMovement(): void {
    this.#pendingExplicitNavigationIntent = null;
  }

  /** Checks both active-document and facade navigation request identity. */
  #isCurrentNavigationIntent(
    navigation: Readonly<{ documentGeneration: number; navigationGeneration: number }>,
  ): boolean {
    return (
      navigation.documentGeneration === this.#documentGeneration &&
      navigation.navigationGeneration === this.#navigationIntentGeneration &&
      this.#status === "ready" &&
      !!this.#pdf &&
      !this.#destroyed
    );
  }

  /** Finishes an installed smooth target before a newer explicit jump captures departure. */
  #settlePendingExplicitNavigation(): void {
    const pending = this.#pendingExplicitNavigationIntent;
    if (!pending) return;
    this.#pendingExplicitNavigationIntent = null;
    this.#cancelSmoothNavigation();
    this.#executeNavigationIntent(Object.freeze({ ...pending, smooth: false }));
  }

  /** Records and installs one generation-current semantic movement, then publishes state. */
  #commitNavigationIntent(
    navigation: Readonly<{
      documentGeneration: number;
      navigationGeneration: number;
      departure: Readonly<DocumentLocation> | null;
    }>,
    intent: Readonly<DocumentNavigationIntent>,
    recordHistory: boolean,
  ): Readonly<{ moved: boolean; positioned: boolean }> {
    if (!this.#isCurrentNavigationIntent(navigation) || !this.#navigationIntentWouldMove(intent)) {
      return Object.freeze({ moved: false, positioned: false });
    }
    if (recordHistory) this.#recordNavigationDeparture(navigation.departure);
    this.#syncNavigationHistoryControls();
    const smooth = intent.smooth && this.#scrollBehavior(true) === "smooth";
    this.#pendingExplicitNavigationIntent = smooth
      ? Object.freeze({ ...intent, smooth: false })
      : null;
    const positioned = this.#executeNavigationIntent(intent);
    this.#navigationCommitRevision++;
    if (this.#isCurrentNavigationIntent(navigation)) {
      this.#syncNavigationHistoryControls();
      this.#emitStateChange();
    }
    return Object.freeze({ moved: true, positioned });
  }

  /** Owns disabled and ARIA state for optional generated or custom history controls. */
  #syncNavigationHistoryControls(): void {
    const ready = this.#features.navigationHistory && this.#status === "ready" && !this.#destroyed;
    for (const [control, available] of [
      [this.#navigationHistoryBackBtnEl, this.#documentNavigationHistory.canGoBack],
      [this.#navigationHistoryForwardBtnEl, this.#documentNavigationHistory.canGoForward],
    ] as const) {
      if (!control) continue;
      control.disabled = !ready || !available;
      control.setAttribute("aria-disabled", String(control.disabled));
    }
  }

  /** Keeps a programmatic target authoritative while smooth scrolling crosses intermediate rows. */
  #setPendingNavigationTarget(targetPage: number): void {
    this.#pendingNavTargetPage = targetPage;
    this.#pendingNavClearTimer = this.#documentLifetime.clearTimeout(this.#pendingNavClearTimer);
    this.#pendingNavClearTimer = this.#documentLifetime.setTimeout(() => {
      this.#pendingNavTargetPage = null;
      this.#pendingExplicitNavigationIntent = null;
      this.#pendingNavClearTimer = null;
      this.#scheduleScrollDerivedState();
    }, 2000);
  }

  /** Starts or retargets viewer-owned bounded smooth navigation. */
  #startSmoothNavigation(targetTop: number, targetLeft: number | null = null): void {
    const startTop = this.#docContainerEl.scrollTop;
    const startLeft = this.#docContainerEl.scrollLeft;
    const distance = Math.hypot(targetTop - startTop, (targetLeft ?? startLeft) - startLeft);
    const duration = this.#clamp(
      distance / SMOOTH_NAVIGATION_PX_PER_MS,
      SMOOTH_NAVIGATION_MIN_DURATION_MS,
      SMOOTH_NAVIGATION_MAX_DURATION_MS,
    );
    const navigation = this.#smoothNavigation ?? {
      targetTop,
      targetLeft,
      startTop,
      startLeft,
      startTime: null,
      duration,
      raf: null,
    };
    navigation.targetTop = targetTop;
    navigation.targetLeft = targetLeft;
    navigation.startTop = startTop;
    navigation.startLeft = startLeft;
    navigation.startTime = null;
    navigation.duration = duration;
    this.#smoothNavigation = navigation;
    if (navigation.raf == null) {
      navigation.raf = this.#documentLifetime.requestAnimationFrame(time =>
        this.#advanceSmoothRowNavigation(navigation, time),
      );
    }
  }

  /** Advances the current smooth navigation, retargeting from its physical position. */
  #advanceSmoothRowNavigation(navigation: SmoothNavigation, time: number): void {
    if (this.#smoothNavigation !== navigation) return;
    navigation.raf = null;
    if (navigation.startTime == null) navigation.startTime = time;
    const progress = this.#clamp((time - navigation.startTime) / navigation.duration, 0, 1);
    const easedProgress = 1 - (1 - progress) ** 3;
    this.#docContainerEl.scrollTop =
      navigation.startTop + (navigation.targetTop - navigation.startTop) * easedProgress;
    if (navigation.targetLeft != null) {
      this.#docContainerEl.scrollLeft =
        navigation.startLeft + (navigation.targetLeft - navigation.startLeft) * easedProgress;
    }
    this.#scheduleScrollDerivedState();
    if (progress < 1) {
      navigation.raf = this.#documentLifetime.requestAnimationFrame(nextTime =>
        this.#advanceSmoothRowNavigation(navigation, nextTime),
      );
    } else {
      this.#smoothNavigation = null;
      this.#pendingExplicitNavigationIntent = null;
    }
  }

  /** Cancels a smooth programmatic destination after direct user input. */
  #cancelSmoothNavigation(): void {
    if (!this.#smoothNavigation) return;
    this.#smoothNavigation = null;
    this.#pendingNavTargetPage = null;
    this.#pendingNavClearTimer = this.#documentLifetime.clearTimeout(this.#pendingNavClearTimer);
    this.#scheduleScrollDerivedState();
  }

  /** Cancels only installed smooth movement while unresolved semantic requests retain authority. */
  #cancelNavigationFromUserInput(): void {
    this.#releasePendingExplicitMovement();
    this.#cancelSmoothNavigation();
  }

  /** Executes model-selected movement and reports whether spot positioning succeeded. */
  #executeNavigationIntent(intent: DocumentNavigationIntent): boolean {
    if (this.#presentationMode) {
      this.#scrollToPage(intent.page, false, false);
      return false;
    }
    if (intent.usePosition) {
      const target = this.#documentView.documentPointScrollPosition(
        intent.page,
        intent.yRatio,
        intent.xRatio,
      );
      if (target) {
        this.#cancelSmoothNavigation();
        if (this.#scrollBehavior(intent.smooth) === "smooth") {
          this.#setPendingNavigationTarget(intent.page);
          this.#startSmoothNavigation(target.top, target.left);
        } else {
          this.#docContainerEl.scrollTo({
            top: target.top,
            ...(target.left == null ? {} : { left: target.left }),
            behavior: "auto",
          });
        }
        this.#scheduleScrollDerivedState();
        return true;
      }
    }
    this.#scrollToPage(intent.page, intent.smooth);
    return false;
  }

  /** Tests the exact current scroll position against a resolved semantic intent. */
  #navigationIntentWouldMove(intent: DocumentNavigationIntent): boolean {
    if (this.#presentationMode) return this.#pageJumpWouldMove(intent.page);
    if (!intent.usePosition) return this.#pageJumpWouldMove(intent.page);
    const target = this.#documentView.documentPointScrollPosition(
      intent.page,
      intent.yRatio,
      intent.xRatio,
    );
    if (!target) return this.#pageJumpWouldMove(intent.page);
    return (
      Math.abs(this.#docContainerEl.scrollTop - target.top) > 0.01 ||
      (target.left != null && Math.abs(this.#docContainerEl.scrollLeft - target.left) > 0.01)
    );
  }

  /**
   * Smoothly scroll to a target page, deferring until after IME/visualViewport
   * resize when necessary (Chrome Mobile). Also marks a pending navigation
   * target so onResize preserves the intended page during Fit recalculations.
   *
   * @param targetPage - 1-based page number
   * @param smooth - use smooth scrolling (default true)
   * @param hadFocus - hint that an input had focus just before triggering
   */
  #scrollToPageWithImeGuard(
    targetPage: number,
    smooth: boolean = true,
    hadFocus?: boolean,
    recordHistory = false,
  ): void {
    const intent = Object.freeze({
      page: targetPage,
      yRatio: 0,
      usePosition: false,
      smooth,
    });
    const explicitNavigation = recordHistory ? this.#beginNavigationIntent(true) : null;
    const neutralNavigation = recordHistory
      ? null
      : Object.freeze({
          documentGeneration: this.#documentGeneration,
          navigationGeneration: this.#navigationIntentGeneration,
          commitRevision: this.#navigationCommitRevision,
        });

    const vv = this.#ownerWindow.visualViewport;
    const doSmooth = () => {
      this.#documentLifetime.requestAnimationFrame(() => {
        if (explicitNavigation) {
          if (!this.#isCurrentNavigationIntent(explicitNavigation)) return;
          this.#commitNavigationIntent(explicitNavigation, intent, true);
          return;
        }
        if (
          !neutralNavigation ||
          neutralNavigation.documentGeneration !== this.#documentGeneration ||
          neutralNavigation.navigationGeneration !== this.#navigationIntentGeneration ||
          neutralNavigation.commitRevision !== this.#navigationCommitRevision ||
          this.#status !== "ready" ||
          !this.#pdf ||
          this.#destroyed ||
          !this.#navigationIntentWouldMove(intent)
        )
          return;
        this.#executeNavigationIntent(intent);
      });
    };

    // Heuristic: if an input had focus OR the visual viewport is notably shorter
    // than the layout viewport, the IME is/was likely visible.
    const imeLikely =
      !!hadFocus ||
      (vv && typeof vv.height === "number" && this.#ownerWindow.innerHeight - vv.height > 80);

    if (imeLikely && vv && typeof vv.addEventListener === "function") {
      // IME likely active -> wait for the viewport to settle after keyboard hides
      let settled = false;
      let disposeResize = () => {};
      const onVVResize = () => {
        if (settled) return;
        settled = true;
        disposeResize();
        doSmooth();
      };
      disposeResize = this.#documentLifetime.listen(vv, "resize", onVVResize as EventListener, {
        once: true,
      });
      // Fallback if no resize arrives quickly
      this.#documentLifetime.setTimeout(() => {
        if (!settled) {
          settled = true;
          disposeResize();
          doSmooth();
        }
      }, 300);
    } else {
      // No IME/keyboard involvement detected
      doSmooth();
    }
  }

  /**
   * Updates the enabled/disabled state of the page navigation buttons
   * based on the currently active page index.
   *
   * @param idx - The current page index (0-based).
   *              Disables "previous" if idx is the first page,
   *              and disables "next" if idx is the last page.
   */
  #updatePageNavDisabled(idx: number) {
    this.#prevPageBtnEl?.toggleAttribute("disabled", idx <= 0);
    this.#nextPageBtnEl?.toggleAttribute("disabled", idx >= this.#documentView.rows.length - 1);
    this.#syncModeControls();
  }

  /** Returns whether this active viewer currently owns navigation-state writes. */
  #canWriteNavigationState(): boolean {
    if (!this.#hostActive) return false;
    return getPdfjsViewerRuntimeAccess(this.#runtime).isActiveViewer(
      this.#viewerId,
      this.#ownerWindow,
    );
  }

  /** Resolves a navigation adapter's initial PDF named destination for the current document. */
  async #resolvePendingInitialNavigationDestination(
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
  ): Promise<void> {
    if (!this.#pendingInitialPdfNamedDestination) return;

    const pdfNamedDestination = this.#pendingInitialPdfNamedDestination;
    this.#pendingInitialPdfNamedDestination = null;

    const pageUsage = this.#documentPageUsage;
    if (!pageUsage) return;
    const resolved = await resolvePdfDestinationValue(
      pdf,
      pdfNamedDestination,
      pageUsage,
      this.#documentView.rotation,
    );
    if (!this.#isCurrentDocument(pdf, generation)) return;
    if (!resolved) {
      // If the URL requested an anchor that does not exist in this document,
      // clear it so sharing the URL doesn't point to a non-existent location.
      if (this.#navigationState && this.#canWriteNavigationState()) {
        this.#navigationState.writeNavigationDestinationId(null);
      }
      return;
    }

    const pageNo = resolved.pageIndex + 1;
    const yRatio =
      resolved.yRatio != null && isFinite(resolved.yRatio) ? this.#clamp(resolved.yRatio, 0, 1) : 0;

    this.#pendingInitialResolvedDestination = {
      pageNo,
      yRatio: resolved.yRatio,
    };
    this.#documentNavigation.selectResolvedDestination(
      this.#navigationHost(),
      {
        pageNo,
        yRatio,
        xRatio: resolved.xRatio,
      },
      pdfNamedDestination,
    );
  }

  // --- Keyboard routing ---

  /**
   * Handles all global keyboard interactions within a viewer instance.
   * Supports:
   *  - Search panel toggling and navigation
   *  - Closing panels with Escape
   *  - Preventing shortcut capture while typing
   *  - Page navigation via arrow keys, PgUp/PgDn, Home, and End
   *
   * @param e - The keyboard event
   */
  #handleKeyboardEvent(e: KeyboardEvent): void {
    if (e.key === "Tab") return; // never hijack focus nav

    // --- Search (Ctrl/Cmd+F) ---
    if (this.#searchInputEl && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (this.#searchPanelEl?.hidden) this.#viewerPanels.toggleToolbar("search", true);
      else {
        this.#searchInputEl?.focus();
        this.#searchInputEl?.select();
      }
      return;
    }

    const el = this.#getEventElement(e);

    const outlineViewOpen = this.#viewerPanels.isSidebarViewOpen("outline") && this.#hostActive;
    const inSidebar = outlineViewOpen && !!(el && this.#sidebarContainerEl?.contains(el));
    const inOutlineFilterInput =
      outlineViewOpen && this.#documentOutlinePresentation.isFilterInput(el);

    const isOutlineScrollKey =
      e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown";

    const isSpaceKey = e.key === " " || e.key === "Spacebar";

    // When the outline view is open, Alt+Arrow/Page keys scroll its content.
    // (PDF stays the default receiver of navigation keys.)
    if (outlineViewOpen && e.altKey && isOutlineScrollKey && (inSidebar || inOutlineFilterInput)) {
      e.preventDefault();
      this.#documentOutlinePresentation.scrollByKey(e.key);
      return;
    }

    // Special case: when outline filter input is focused, ArrowUp/Down + PageUp/Down
    // should still navigate the PDF (unless Alt is held, handled above).
    const allowPdfNavFromOutlineFilter = inOutlineFilterInput && isOutlineScrollKey;

    const inEditable = !!el?.closest(
      'input, textarea, select, [contenteditable], [role="textbox"]',
    );
    const inButtonLike = !!el?.closest('button, [role="button"]');
    const inWidget = !!el?.closest(
      '[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="combobox"], [role="slider"], [role="tablist"]',
    );
    const keyIsNav =
      e.key.startsWith("Arrow") ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "PageUp" ||
      e.key === "PageDown" ||
      e.key === " " ||
      e.key === "Spacebar";

    const shouldSkip =
      (inEditable && keyIsNav && !allowPdfNavFromOutlineFilter) ||
      (inButtonLike && (e.key === " " || e.key === "Spacebar" || e.key === "Enter")) ||
      (inWidget && keyIsNav);

    // --- Ignore the rest of the keys if they might interfere with other behavior ---
    if (shouldSkip) return;

    if (this.#presentationInput.handleKeydown(e)) return;

    const wantsDown =
      e.key === "ArrowDown" ||
      e.key === "PageDown" ||
      ((e.key === " " || e.key === "Spacebar") && !e.shiftKey);
    const wantsUp =
      e.key === "ArrowUp" ||
      e.key === "PageUp" ||
      ((e.key === " " || e.key === "Spacebar") && e.shiftKey);
    const wantsLeft = e.key === "ArrowLeft";
    const wantsRight = e.key === "ArrowRight";

    // If the outline view is open, keep the PDF as the default receiver for
    // Arrow/Page navigation keys *and* Space/Shift+Space scrolling.
    //
    // - Arrow/Page keys: always route to PDF even if focus is inside the outline.
    // - Space: route to PDF when focus is inside the outline *except* when the
    //          outline filter input is focused (space should type in the input).
    const forcePdfNav =
      outlineViewOpen &&
      ((isOutlineScrollKey && (inSidebar || inOutlineFilterInput)) ||
        (isSpaceKey && inSidebar && !inOutlineFilterInput));

    const localScrollY = forcePdfNav
      ? null
      : this.#closestScrollableAncestor(el, "y", this.#docContainerEl);
    const localScrollX = this.#closestScrollableAncestor(el, "x", this.#docContainerEl);
    if (
      (localScrollY && wantsDown && this.#canScrollInDirection(localScrollY, "down")) ||
      (localScrollY && wantsUp && this.#canScrollInDirection(localScrollY, "up")) ||
      (localScrollX && wantsLeft && this.#canScrollInDirection(localScrollX, "left")) ||
      (localScrollX && wantsRight && this.#canScrollInDirection(localScrollX, "right"))
    ) {
      // Let the local scrollable pane handle it
      return;
    }
    // --- Handle the rest of the key events ---

    // --- Document scrolling/navigation ---
    const horizOverflow = this.#docContainerEl.scrollWidth > this.#docContainerEl.clientWidth + 2;
    switch (e.key) {
      case "Escape": // Closes panels
        this.#viewerPanels.setSidebarOpen(false);
        this.#viewerPanels.toggleToolbar("search", false);
        this.#viewerPanels.toggleToolbar("menu", false);
        break;
      case "ArrowLeft": // Scroll left, if horizontal overflow
        if (horizOverflow) {
          e.preventDefault();
          this.#cancelNavigationFromUserInput();
          this.#docContainerEl.scrollBy({
            left: -Math.round(this.#docContainerEl.clientWidth * 0.9),
            behavior: this.#scrollBehavior(true),
          });
        }
        break;
      case "ArrowRight": // Scroll right, if horizontal overflow
        if (horizOverflow) {
          e.preventDefault();
          this.#cancelNavigationFromUserInput();
          this.#docContainerEl.scrollBy({
            left: Math.round(this.#docContainerEl.clientWidth * 0.9),
            behavior: this.#scrollBehavior(true),
          });
        }
        break;
      case "ArrowUp": // Scroll up
        e.preventDefault();
        this.#cancelNavigationFromUserInput();
        this.#docContainerEl.scrollBy({
          top: -Math.max(80, Math.round(this.#docContainerEl.clientHeight * 0.15)),
          behavior: this.#scrollBehavior(true),
        });
        break;
      case "ArrowDown": // Scroll down
        e.preventDefault();
        this.#cancelNavigationFromUserInput();
        this.#docContainerEl.scrollBy({
          top: Math.max(80, Math.round(this.#docContainerEl.clientHeight * 0.15)),
          behavior: this.#scrollBehavior(true),
        });
        break;
      case "PageUp": // Previous row/page
        e.preventDefault();
        this.previousRow(true);
        break;
      case "PageDown": // Next row/page
        e.preventDefault();
        this.nextRow(true);
        break;
      case " ": // Space/Shift+Space: Next/previous row
      case "Spacebar": // legacy
        e.preventDefault();
        if (e.shiftKey) this.previousRow(true);
        else this.nextRow(true);
        break;
      case "Home": // Jump to first page
        e.preventDefault();
        this.#scrollToPageWithHistory(1, true);
        break;
      case "End": // Jump to last page
        e.preventDefault();
        this.#scrollToPageWithHistory(this.#documentView.pageCount, true);
        break;
      case "Enter":
        if (!this.#searchInputEl?.contains(el)) break;
      // Continue like F3 if in search input
      case "F3": // F3/Shift+F3: next/prev search result
        if (!this.#searchInputEl) break;
        e.preventDefault();
        const val = this.#searchInputEl?.value ?? "";
        if (val.length === 1) {
          // One-char searches require manual query updates
          this.#updateSearchQuery(val, true);
        }
        if (e.shiftKey) {
          this.#searchPrev();
        } else {
          this.#searchNext();
        }
    }
  }

  // --- Document search indexing and result navigation ---

  /** Starts full-document search indexing once for the active document. */
  #prepareSearchIndex(updateUi = true): Promise<boolean> {
    const uiWasRequested = this.#searchPreparationUpdatesUi;
    this.#searchPreparationUpdatesUi ||= updateUi;
    if (!this.#features.search || this.#documentSearch.ready)
      return Promise.resolve(this.#documentSearch.ready);
    const existingPreparation = this.#documentSearch.preparation;
    if (existingPreparation) {
      if (updateUi && !uiWasRequested) {
        this.#searchPanelEl?.setAttribute("aria-busy", "true");
        this.#updateSearchCount();
      }
      return existingPreparation;
    }
    const pdf = this.#pdf;
    if (!pdf) return Promise.resolve(false);

    const generation = this.#documentGeneration;
    this.#setPreparationState("search", "loading");
    if (this.#searchPreparationUpdatesUi) {
      this.#searchPanelEl?.setAttribute("aria-busy", "true");
      this.#updateSearchCount();
    }
    const preparation = this.#documentSearch.prepare(this.#searchHost());
    if (this.#documentSearch.preparation === existingPreparation) return preparation;
    void preparation.then(ready => {
      if (!this.#isCurrentDocument(pdf, generation)) return;
      this.#setPreparationState("search", ready ? "ready" : "error");
      if (this.#searchPreparationUpdatesUi) this.#searchPanelEl?.removeAttribute("aria-busy");
      if (ready && this.#searchPreparationUpdatesUi) {
        if (this.#searchQuery && (this.#searchQuery.length >= 2 || this.#searchQueryForced)) {
          this.#recomputeMatches();
          if (this.#searchMatches.length) {
            this.#searchPos = 0;
            this.#jumpToSearchPos(this.#searchQueryForced);
          }
        } else {
          this.#updateSearchCount();
        }
      }
      if (!ready && this.#searchPreparationUpdatesUi) {
        this.#searchMatches = [];
        this.#searchPos = -1;
        this.#updateSearchCount();
        if (this.#searchCountEl)
          this.#searchCountEl.textContent = this.#labels.searchPreparationError;
      }
      this.#emitPreparationEvent(
        "pdf:searchindexcomplete",
        ready
          ? { status: "ready", indexedPages: this.#documentSearch.indexedPageCount }
          : { status: "error", indexedPages: 0, error: this.#documentSearch.error },
      );
    });
    return preparation;
  }

  /**
   * Updates the current search query and refreshes highlights in the viewer.
   *
   * @param q - The new query string entered by the user.
   * @param force - Whether to force update the query state (e.g., triggered by Enter/F3/Next/Prev),
   *                or treat it as live typing (default: false).
   *
   * Behavior:
   * - Trims the query while retaining its original case and diacritics.
   * - Clears existing highlights when the query changes.
   * - Ignores short queries (< 2 chars) unless forced.
   * - Recomputes matches and highlights across rendered pages.
   * - In live typing mode: jumps to the first match immediately.
   * - In forced mode: keeps the current search position, navigation is handled elsewhere.
   */
  #updateSearchQuery(q: string, force = false): void {
    this.#searchQuery = (q || "").trim();
    this.#searchQueryForced = force;
    this.#clearAllHighlights();
    if (!force && this.#searchQuery.length < 2) {
      this.#searchMatches = [];
      this.#searchPos = -1;
      this.#updateSearchCount();
      this.#syncTextSearchMatches();
      return;
    }
    if (!this.#documentSearch.ready) {
      this.#searchMatches = [];
      this.#searchPos = -1;
      this.#updateSearchCount();
      this.#syncTextSearchMatches();
      void this.#prepareSearchIndex();
      return;
    }
    this.#recomputeMatches();
    if (!this.#searchQuery || this.#searchMatches.length === 0) {
      this.#searchPos = -1;
      this.#updateSearchCount();
      this.#syncTextSearchMatches();
      return;
    }
    if (!force) {
      // Live typing case -> go to *first* match
      this.#searchPos = 0;
      this.#jumpToSearchPos();
    }
    // Forced case (Enter/F3/Next/Prev) -> leave pointer unchanged,
    // navigation will be handled by searchNext/searchPrev
    this.#syncTextSearchMatches();
  }

  /**
   * Recomputes all matches of the current search query (`#searchQuery`)
   * across immutable page-level source-segment matches from the complete index.
   *
   * - Clears any previously stored matches.
   * - If no search query is set, just updates the search count and exits.
   * - Otherwise, checks each page's concatenated source stream for occurrences
   *   under the configured matching policy.
   * - Each match records its page and exact ordered source-item segments.
   * - Finally, updates the total match count.
   */
  #recomputeMatches(): void {
    this.#searchMatches = [];
    if (!this.#searchQuery) {
      this.#updateSearchCount();
      return;
    }

    this.#searchMatches = this.#documentSearch.findMatches(
      this.#searchQuery,
      this.#behavior.searchQueryOptions,
    );
    this.#updateSearchCount();
    this.#syncTextSearchMatches();
  }

  #syncTextSearchMatches(): void {
    const active = this.#searchMatches[this.#searchPos];
    if (this.#presentedSearchMatches !== this.#searchMatches) {
      this.#documentTextPresentation.setSearchMatches(this.#searchMatches);
      this.#presentedSearchMatches = this.#searchMatches;
      if (this.#pdf && this.#documentView.hasRows) this.#reconcileRendering();
    }
    this.#documentTextPresentation.setActiveSearchMatch(active ?? null);
  }

  /**
   * Update the UI to reflect the current state of the text search.
   *
   * - If no query exists or it's too short, clears the results counter.
   * - If a search was performed but no matches are found, displays "0".
   * - Otherwise, shows the current match position and total number of matches.
   *
   * Also updates the navigation buttons (`Previous` / `Next`) to be disabled
   * when there are no matches.
   */
  #updateSearchCount(): void {
    if (!this.#searchCountEl) return;

    if (this.#searchQuery && !this.#documentSearch.ready) {
      this.#searchCountEl.textContent =
        this.#searchPreparationState === "loading"
          ? this.#labels.searchPreparing
          : this.#searchPreparationState === "error"
            ? this.#labels.searchPreparationError
            : "";
      this.#searchCountEl.classList.toggle(
        PDFJS_VIEWER_STATE_CLASSES.searchPreparing,
        this.#searchPreparationState === "loading",
      );
      this.#searchPrevBtnEl?.toggleAttribute("disabled", true);
      this.#searchNextBtnEl?.toggleAttribute("disabled", true);
      return;
    }

    this.#searchCountEl.classList.remove(PDFJS_VIEWER_STATE_CLASSES.searchPreparing);

    // No query or query too short -> nothing yet
    if (!this.#searchQuery || (this.#searchQuery.length < 2 && this.#searchPos < 0)) {
      this.#searchCountEl.textContent = "";
    } else if (this.#searchMatches.length === 0) {
      // Search performed, but no matches
      this.#searchCountEl.textContent = this.#formatters.searchResultCount(0);
    } else {
      // Normal case: we have matches
      this.#searchCountEl.textContent = this.#formatters.searchResultPosition(
        this.#searchPos + 1,
        this.#searchMatches.length,
      );
    }

    this.#searchPrevBtnEl?.toggleAttribute("disabled", this.#searchMatches.length === 0);
    this.#searchNextBtnEl?.toggleAttribute("disabled", this.#searchMatches.length === 0);
  }

  /**
   * Jumps the viewer to the current search result.
   * - Scrolls to the page containing the active match.
   * - Updates the displayed search result count.
   * - Refreshes highlights to ensure the active match is visually emphasized.
   */
  #jumpToSearchPos(recordHistory = false): void {
    const match = this.#searchMatches[this.#searchPos];
    if (!match) return;

    const vv = this.#ownerWindow.visualViewport;
    const imeLikely =
      !!this.#searchInputEl &&
      (this.#ownerDocument.activeElement === this.#searchInputEl ||
        !!(vv && typeof vv.height === "number" && this.#ownerWindow.innerHeight - vv.height > 80));
    this.#scrollToPageWithImeGuard(match.page, true, imeLikely, recordHistory);

    this.#updateSearchCount();
    // Active navigation only toggles classes on cached highlight nodes.
    this.#syncTextSearchMatches();
  }

  /**
   * Move the search cursor to the next match in the list.
   * If no position is set, start from the first match.
   * Wraps around to the beginning after the last match.
   */
  #searchNext(): void {
    if (!this.#searchMatches.length) return;
    if (this.#searchPos < 0) {
      this.#searchPos = 0; // first activation
    } else {
      this.#searchPos = (this.#searchPos + 1) % this.#searchMatches.length;
    }
    this.#jumpToSearchPos(true);
  }

  /**
   * Move the search cursor to the previous match in the list.
   * If no position is set, start from the first match.
   * Wraps around to the last match when moving before the first.
   */
  #searchPrev(): void {
    if (!this.#searchMatches.length) return;
    if (this.#searchPos < 0) {
      this.#searchPos = 0; // first activation
    } else {
      this.#searchPos =
        (this.#searchPos - 1 + this.#searchMatches.length) % this.#searchMatches.length;
    }
    this.#jumpToSearchPos(true);
  }

  // --- Sidebar feature construction and filtering ---

  /** Returns currently available view mounts in stable tab order. */
  #availableSidebarViews(): PdfjsViewerSidebarView[] {
    return [
      ...(this.#outlineContentEl && this.#outlineAvailable ? ["outline" as const] : []),
      ...(this.#thumbnailsContentEl ? ["thumbnails" as const] : []),
      ...(this.#attachmentsContentEl && this.#attachmentsAvailable ? ["attachments" as const] : []),
      ...(this.#layersContentEl && this.#layersAvailable ? ["layers" as const] : []),
    ];
  }

  /** Resets document-scoped sidebar availability without clearing the user's preferred view. */
  #setSidebarDocumentAvailability(loading: boolean): void {
    this.#outlineAvailable = loading && this.#features.outline;
    this.#attachmentsAvailable = loading && this.#features.attachments;
    this.#layersAvailable = false;
    this.#viewerPanels.setAvailableViews(this.#availableSidebarViews());
  }

  /** Joins attachment discovery while owning its exactly-once UI handoff. */
  #prepareAttachments(): Promise<DocumentAttachmentsPreparationOutcome> {
    if (!this.#features.attachments || !this.#pdf || this.#status !== "ready") {
      return Promise.resolve({ status: "cancelled", itemCount: 0, items: [] });
    }
    return this.#documentAttachmentsPresentation.prepare(() =>
      this.#documentAttachments.prepare(this.#attachmentsHost()),
    );
  }

  /**
   * Joins model preparation while owning its exactly-once UI handoff.
   *
   * One facade promise per document sets `aria-busy`, renders generated or
   * custom outline content, installs filtering, localizes empty/error states,
   * and emits or queues `pdf:outlinecomplete`. Model callers can join the same
   * detached preparation without repeating any presentation side effects.
   */
  #prepareOutline(): Promise<DocumentOutlinePreparationOutcome> {
    if (!this.#features.outline || !this.#pdf) {
      return Promise.resolve({ status: "cancelled", itemCount: 0, items: [] });
    }
    return this.#documentOutlinePresentation.prepare(() =>
      this.#documentNavigation.prepareOutline(this.#navigationHost()),
    );
  }

  /** Selects one owner-emitted semantic key through the navigation model. */
  #selectOutlineEntry(key: string): void {
    const intent = this.#documentNavigation.selectOutlineDestination(this.#navigationHost(), key);
    if (!intent) return;
    if (this.#viewerPanels.isSidebarOverlay()) this.#viewerPanels.setSidebarOpen(false);
    this.#syncOutlineActive();
    this.#scrollToPageWithImeGuard(intent.page, intent.smooth, false, true);
  }

  /** Publishes the navigation model's active key to the outline view owner. */
  #syncOutlineActive(reason: "opening" | "selection-change" = "selection-change"): void {
    this.#documentOutlinePresentation.setActiveKey(
      this.#documentNavigation.activeOutlineKey(this.#navigationHost()),
      reason,
    );
  }

  // --- General DOM, device, numeric, and type utilities ---

  /**
   * Clamp a number to ensure it stays within the specified range.
   *
   * @param n   The number to clamp
   * @param min The minimum allowed value
   * @param max The maximum allowed value
   * @returns   The clamped value within [min, max]
   */
  #clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Shows visual feedback when the user tries to zoom past the min/max.
   *
   * The hint remains steadily visible while a gesture is held past a limit.
   * Repeated updates in the same direction are intentionally idempotent.
   */
  #showZoomLimitHint(direction: "in" | "out"): void {
    const baseClass = PDFJS_VIEWER_STATE_CLASSES.zoomLimitHint;
    const inClass = PDFJS_VIEWER_STATE_CLASSES.zoomLimitHintIn;
    const outClass = PDFJS_VIEWER_STATE_CLASSES.zoomLimitHintOut;
    const dirClass = direction === "in" ? inClass : outClass;
    if (this.#zoomLimitHintDirection === direction) return;
    const parent = this.#docContainerEl.parentElement;
    if (!parent) return;
    const element = this.#zoomLimitHintEl ?? this.#ownerDocument.createElement("div");
    if (!this.#zoomLimitHintEl) {
      element.className = baseClass;
      element.setAttribute("aria-hidden", "true");
      parent.appendChild(element);
      this.#zoomLimitHintEl = element;
    }
    const rect = this.#docContainerEl.getBoundingClientRect();
    element.style.inset = `${rect.top}px ${this.#ownerWindow.innerWidth - rect.right}px ${this.#ownerWindow.innerHeight - rect.bottom}px ${rect.left}px`;

    if (
      this.#accessibility.respectReducedMotion &&
      this.#ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      this.#zoomLimitHintDirection = null;
      element.classList.remove(inClass, outClass);
      return;
    }
    this.#zoomLimitHintDirection = direction;
    element.classList.remove(inClass, outClass);
    element.classList.add(baseClass, dirClass);
  }

  /** Fades the zoom-limit feedback after input returns in range or ends. */
  #hideZoomLimitHint(): void {
    if (!this.#zoomLimitHintEl || this.#zoomLimitHintDirection == null) return;
    this.#zoomLimitHintDirection = null;
    this.#zoomLimitHintEl.classList.remove(
      PDFJS_VIEWER_STATE_CLASSES.zoomLimitHintIn,
      PDFJS_VIEWER_STATE_CLASSES.zoomLimitHintOut,
    );
  }

  /**
   * Returns the most specific element associated with an event.
   *
   * Prefers the first element in the composed path, then falls back to the
   * event target and finally the active element.
   */
  #getEventElement(e: Event): Element | null {
    const path = e.composedPath?.();
    if (Array.isArray(path)) {
      for (const n of path) if (n instanceof this.#ownerWindow.Element) return n as Element;
    }
    if (e.target instanceof this.#ownerWindow.Element) return e.target as Element;
    if (this.#ownerDocument.activeElement instanceof this.#ownerWindow.Element)
      return this.#ownerDocument.activeElement as Element;
    return null;
  }

  /**
   * Checks whether an element is scrollable on the requested axis.
   *
   * Both overflow style and actual overflow size are considered.
   */
  #isScrollable(el: Element, axis: "y" | "x" = "y"): boolean {
    const cs = this.#ownerWindow.getComputedStyle(el);
    const ov = axis === "y" ? cs.overflowY : cs.overflowX;
    if (!/(auto|scroll|overlay)/.test(ov)) return false;
    const box = el as HTMLElement;
    return axis === "y"
      ? box.scrollHeight - box.clientHeight > 1
      : box.scrollWidth - box.clientWidth > 1;
  }

  /**
   * Finds the nearest scrollable ancestor of an element on the requested axis.
   *
   * Traversal crosses shadow DOM boundaries and stops before `stopAt` when
   * provided.
   */
  #closestScrollableAncestor(
    start: Element | null,
    axis: "y" | "x" = "y",
    stopAt?: Element, // e.g., your main doc container to ignore
  ): HTMLElement | null {
    let n: Node | null = start;
    while (n && n !== this.#ownerDocument.documentElement && n !== stopAt) {
      if (n instanceof this.#ownerWindow.HTMLElement && this.#isScrollable(n as HTMLElement, axis))
        return n as HTMLElement;
      // Walk through shadow roots
      if (n instanceof this.#ownerWindow.ShadowRoot) n = n.host;
      else n = (n as Node).parentNode;
    }
    return null;
  }

  /**
   * Checks whether an element can still scroll further in the given direction.
   *
   * Horizontal checks use a small probe-and-revert step to remain robust across
   * different RTL scroll models.
   */
  #canScrollInDirection(el: HTMLElement, dir: "up" | "down" | "left" | "right"): boolean {
    const eps = 1;

    if (dir === "up") return el.scrollTop > eps;
    if (dir === "down") return el.scrollTop < el.scrollHeight - el.clientHeight - eps;

    // Horizontal: probe and revert (robust across RTL models)
    const before = el.scrollLeft;
    const delta = dir === "left" ? -2 : 2; // small nudge
    el.scrollLeft += delta;
    const moved = Math.abs(el.scrollLeft - before) > 0.5;
    el.scrollLeft = before; // revert
    return moved;
  }

  /**
   * Check whether the environment is likely touch-capable.
   *
   * Heuristics used:
   * - navigator.maxTouchPoints > 1: modern signal for multi-touch hardware
   *   (using >1 helps avoid some false positives on devices reporting a single pointer).
   * - matchMedia('(any-pointer: coarse)'): broader indicator for touch-oriented pointers.
   *
   * @returns True if touch input is likely available.
   */
  #hasTouch(): boolean {
    return (
      (this.#ownerWindow.navigator.maxTouchPoints || 0) > 1 ||
      this.#ownerWindow.matchMedia?.("(any-pointer: coarse)")?.matches === true
    );
  }

  /**
   * Detects if the current device is likely a mobile device.
   *
   * Heuristics used:
   * - User agent string matches common mobile platforms (Android, iOS, etc.).
   * - Device reports being touch-capable.
   * - Screen width is considered narrow (≤ 768px).
   *
   * @returns {boolean} True if the device is likely mobile, otherwise false.
   */
  #isLikelyMobile(): boolean {
    const ua = this.#ownerWindow.navigator.userAgent || "";
    const mobileUA = /(Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini)/i.test(ua);
    const touch = this.#hasTouch();
    const narrow =
      typeof this.#ownerWindow.matchMedia === "function" &&
      this.#ownerWindow.matchMedia("(max-width: 768px)").matches === true;
    return mobileUA || (touch && narrow);
  }

  /**
   * Gets a value from a css variable and converts it to pixels. If the variable
   * does not exist or is not a valid css length, the fallback value is returned.
   * @param name CSS variable's name, e.g. '--my-length-var'
   * @param fallback Number to return in case of errors
   * @returns the length variable's length in pixels
   */
  #cssVarToPx(name: string, fallback: number): number {
    let el: HTMLDivElement | null = null;

    try {
      const raw = this.#ownerWindow.getComputedStyle(this.#pdfRootEl).getPropertyValue(name).trim();
      if (!raw) return fallback;

      const mount = this.#pdfRootEl;
      if (!mount) return fallback;

      el = this.#ownerDocument.createElement("div");
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
      el.style.width = raw;
      if (!el.style.width) return fallback;

      mount.appendChild(el);
      const px = el.getBoundingClientRect().width || el.offsetWidth || 0;
      return Number.isFinite(px) && px >= 0 ? px : fallback;
    } catch {
      return fallback;
    } finally {
      el?.remove();
    }
  }
}

function safePrintSourceUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:", "blob:", "data:"].includes(url.protocol.toLowerCase())
      ? url.href
      : null;
  } catch {
    return null;
  }
}
