// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Sole public TypeScript entry point for `@unilarva/pdfjs-viewer`.
 *
 * Package consumers import supported viewer/runtime values, the default UI and
 * hash-navigation factories, stable hooks, and public contracts from this module.
 * Import `@unilarva/pdfjs-viewer/default-ui.css` for generated UI or
 * `@unilarva/pdfjs-viewer/core.css` for viewer surfaces without default chrome.
 * Emitted sibling modules are package implementation details unless re-exported
 * here; see the [architecture guide](../ARCHITECTURE.md) for the authoritative
 * public/private module inventory and dependency boundaries.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 */

export { PdfjsViewer } from "./pdfjs-viewer.js";
export { parsePrintPageRanges } from "./print-sheet-planner.js";
export { createHashNavigationStateAdapter } from "./hash-navigation-state.js";
export { formatPdfDate } from "./pdf-date.js";
export {
  PDFJS_VIEWER_UI_HOOKS,
  PDFJS_VIEWER_STATE_CLASSES,
  PDFJS_VIEWER_ROOT_ATTRIBUTE,
  PDFJS_VIEWER_PRINT_DEFAULTS,
} from "./viewer-contracts.js";
export { PdfjsViewerRuntime } from "./pdfjs-viewer-runtime.js";
export { PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS } from "./pdfjs-version-policy.js";
export { createPdfjsViewerUi, renderPdfjsViewerUi } from "./default-ui.js";
export {
  PDFJS_VIEWER_DEVICE_COMPATIBILITY,
  resolveDeviceCompatibility,
} from "./device-compatibility.js";
export type {
  PdfjsViewerBrowser,
  PdfjsViewerBrowserCompatibilityEngine,
  PdfjsViewerDeviceCompatibility,
  PdfjsViewerDeviceCompatibilityRule,
  PdfjsViewerDeviceEnvironment,
  PdfjsViewerNativePrintSupport,
  PdfjsViewerOperatingSystem,
  PdfjsViewerPlatform,
} from "./device-compatibility.js";
export { resolveNativePrintCapabilities } from "./native-print-capabilities.js";
export type { PdfjsViewerNativePrintCapabilities } from "./native-print-capabilities.js";

export type {
  PdfjsViewerPageLayout,
  PdfjsViewerFitMode,
  PdfjsViewerFitModeSelection,
  PdfjsViewerRotation,
  PdfjsViewerRenderingProfile,
  PdfjsViewerRenderingProfileSelection,
  PdfjsViewerAccessibilityOptions,
  PdfjsViewerAttachment,
  PdfjsViewerAttachmentDownloadFailure,
  PdfjsViewerAttachmentDownloadResult,
  PdfjsViewerAttachmentsCompleteEvent,
  PdfjsViewerAttachmentsResult,
  PdfjsViewerAnnotationMarkupFeatureOptions,
  PdfjsViewerAnnotationLinkFeatureOptions,
  PdfjsViewerBehaviorOptions,
  PdfjsViewerDocumentFingerprints,
  PdfjsViewerDocumentVariant,
  PdfjsViewerDocumentDataOptions,
  PdfjsViewerDocumentDataResult,
  PdfjsViewerDocumentInformation,
  PdfjsViewerDocumentInformationResult,
  PdfjsViewerDocumentMarkInfo,
  PdfjsViewerDocumentOptions,
  PdfjsViewerDownloadOptions,
  PdfjsViewerDownloadResult,
  PdfjsViewerDiacriticMatching,
  PdfjsViewerErrorEvent,
  PdfjsViewerFeatureOptions,
  PdfjsViewerFullscreenChangeEvent,
  PdfjsViewerFullscreenErrorEvent,
  PdfjsViewerFullscreenFailure,
  PdfjsViewerFullscreenResult,
  PdfjsViewerPrintFeatureOptions,
  PdfjsViewerPrintMode,
  PdfjsViewerFeaturePreparationState,
  PdfjsViewerFormsFeatureOptions,
  PdfjsViewerFormDirtyChangeEvent,
  PdfjsViewerFormResetResult,
  PdfjsViewerFormatters,
  PdfjsViewerUiRenderOptions,
  PdfjsViewerHashNavigationOptions,
  PdfjsViewerKeyboardOptions,
  PdfjsViewerKeyboardScope,
  PdfjsViewerLabels,
  PdfjsViewerLoadCancellationCause,
  PdfjsViewerLoadOptions,
  PdfjsViewerLoadResult,
  PdfjsViewerNavigationStateAdapter,
  PdfjsViewerMetadataValue,
  PdfjsViewerOutlineFeatureOptions,
  PdfjsViewerOutlineCompleteEvent,
  PdfjsViewerOutlineDestination,
  PdfjsViewerOutlineDestinationStatus,
  PdfjsViewerOutlineItem,
  PdfjsViewerOutlineQueryOptions,
  PdfjsViewerOutlineResult,
  PdfjsViewerSidebarMode,
  PdfjsViewerSidebarView,
  PdfjsViewerInitialSidebarView,
  PdfjsViewerPdfNamedDestinationNavigationOptions,
  PdfjsViewerPdfNamedDestinationNavigationFailure,
  PdfjsViewerPdfNamedDestinationNavigationResult,
  PdfjsViewerPageChangeEvent,
  PdfjsViewerPresentationModeChangeEvent,
  PdfjsViewerPresentationModeFailure,
  PdfjsViewerPresentationModeResult,
  PdfjsViewerPasswordProvider,
  PdfjsViewerPasswordReason,
  PdfjsViewerPasswordRequest,
  PdfjsViewerPermission,
  PdfjsViewerLayerGroup,
  PdfjsViewerLayerLabel,
  PdfjsViewerLayerMutationResult,
  PdfjsViewerLayerNode,
  PdfjsViewerLayersResult,
  PdfjsViewerLayerState,
  PdfjsViewerLayerVisibilityChange,
  PdfjsViewerLayersChangeEvent,
  PdfjsViewerPrintAdapter,
  PdfjsViewerPrintAdapterResult,
  PdfjsViewerPrintContext,
  PdfjsViewerPrintDefaults,
  PdfjsViewerPrintLayout,
  PdfjsViewerPrintLimits,
  PdfjsViewerPrintPreflightResult,
  PdfjsViewerPrintState,
  PdfjsViewerPrintSummary,
  PdfjsViewerPrintEvent,
  PdfjsViewerPrintStartDetail,
  PdfjsViewerPrintProgressDetail,
  PdfjsViewerPrintInvokedDetail,
  PdfjsViewerPrintCleanupDetail,
  PdfjsViewerNormalizedPrintLayout,
  PdfjsViewerNormalizedPrintDefaults,
  PdfjsViewerNormalizedPrintOptions,
  PdfjsViewerPrintOptions,
  PdfjsViewerPrintPageRange,
  PdfjsViewerPrintPageScaling,
  PdfjsViewerPrintPages,
  PdfjsViewerPrintResult,
  PdfjsViewerPrintSheet,
  PdfjsViewerPrintSourceOptions,
  PdfjsViewerPrintSourceResult,
  PdfjsViewerPrintSourceWarning,
  PdfjsViewerPrintSourceResolver,
  PdfjsViewerPrintSourceResolutionContext,
  PdfjsViewerQueryFailure,
  PdfjsViewerQueryFailureReason,
  PdfjsViewerReadyEvent,
  PdfjsViewerSearchFeatureOptions,
  PdfjsViewerSearchIndexCompleteEvent,
  PdfjsViewerSearchMatch,
  PdfjsViewerSearchMatchSegment,
  PdfjsViewerSearchResult,
  PdfjsViewerTextQueryOptions,
  PdfjsViewerTextSelectionPersistence,
  PdfjsViewerRenderingProfileSettings,
  PdfjsViewerRenderingProfiles,
  PdfjsViewerRenderingProfilePolicy,
  PdfjsViewerRenderingProfilePolicyCategory,
  PdfjsViewerRenderBufferPages,
  PdfjsViewerRenderBufferViewportHeights,
  PdfjsViewerSource,
  PdfjsViewerUrlSource,
  PdfjsViewerDataSource,
  PdfjsViewerState,
  PdfjsViewerStatus,
  PdfjsViewerStateChangeEvent,
  PdfjsViewerUiBindings,
  PdfjsViewerUiControlOptions,
  PdfjsViewerUiMode,
  PdfjsViewerUiOptions,
  PdfjsViewerUiTextOptions,
  PdfjsViewerZoomOptions,
  PdfjsViewerOptions,
  PdfjsViewerThumbnailsOptions,
} from "./viewer-contracts.js";
export type {
  PdfjsViewerLogEntry,
  PdfjsViewerLogger,
  PdfjsViewerLogLevel,
  PdfjsViewerRuntimeOptions,
  PdfjsViewerPdfjsModule,
} from "./pdfjs-viewer-runtime.js";
export type { PdfjsViewerPdfjsVersionPolicy } from "./pdfjs-version-policy.js";
