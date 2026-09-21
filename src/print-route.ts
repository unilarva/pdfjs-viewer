// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure print-mode routing boundary. This emitted module is for package
 * maintainers and is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module print-route
 */

import type { PdfjsViewerNativePrintCapabilities } from "./native-print-capabilities.js";
import type { PdfjsViewerPrintMode } from "./viewer-contracts.js";

export type ViewerPrintRoute =
  "disabled" | "unavailable" | "controlled-native" | "browser" | "adapter";

export interface ViewerPrintRouteDecision {
  readonly configuredMode: PdfjsViewerPrintMode;
  readonly route: ViewerPrintRoute;
  readonly fallback: boolean;
  readonly reason:
    | "mode-off"
    | "configured-browser"
    | "configured-adapter"
    | "native-supported"
    | "native-unavailable";
  readonly capabilities: Readonly<PdfjsViewerNativePrintCapabilities> | null;
}

export function resolveViewerPrintRoute(
  configuredMode: PdfjsViewerPrintMode,
  nativeCapabilities: Readonly<PdfjsViewerNativePrintCapabilities> | null,
  browserFallback = true,
): Readonly<ViewerPrintRouteDecision> {
  if (configuredMode === "off") {
    return Object.freeze({
      configuredMode,
      route: "disabled",
      fallback: false,
      reason: "mode-off",
      capabilities: null,
    });
  }
  if (configuredMode === "browser") {
    return Object.freeze({
      configuredMode,
      route: "browser",
      fallback: false,
      reason: "configured-browser",
      capabilities: null,
    });
  }
  if (configuredMode === "adapter") {
    return Object.freeze({
      configuredMode,
      route: "adapter",
      fallback: false,
      reason: "configured-adapter",
      capabilities: null,
    });
  }
  if (!nativeCapabilities)
    throw new TypeError("PdfjsViewer: native print route requires capabilities");
  if (nativeCapabilities.nativePrintSupport !== "unsupported") {
    return Object.freeze({
      configuredMode,
      route: "controlled-native",
      fallback: false,
      reason: "native-supported",
      capabilities: nativeCapabilities,
    });
  }
  return Object.freeze({
    configuredMode,
    route: browserFallback ? "browser" : "unavailable",
    fallback: browserFallback,
    reason: "native-unavailable",
    capabilities: nativeCapabilities,
  });
}
