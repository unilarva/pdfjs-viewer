// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public pure native-print mechanical capability projection.
 * Consumers import its function and contracts from the package root, never this
 * emitted sibling path. See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module native-print-capabilities
 */

import {
  PDFJS_VIEWER_DEVICE_COMPATIBILITY,
  resolveDeviceCompatibility,
  type PdfjsViewerDeviceCompatibilityRule,
  type PdfjsViewerDeviceEnvironment,
  type PdfjsViewerNativePrintSupport,
} from "./device-compatibility.js";

/** Pure support decision. Resource lifetime is deliberately not represented here. */
export interface PdfjsViewerNativePrintCapabilities {
  /** Native print orientations admitted by device and mechanical checks. */
  readonly nativePrintSupport: PdfjsViewerNativePrintSupport;
  /** Resolved browser compatibility family. */
  readonly engine: import("./device-compatibility.js").PdfjsViewerBrowserCompatibilityEngine;
  /** Resolved browser brand. */
  readonly browser: import("./device-compatibility.js").PdfjsViewerBrowser;
  /** Resolved device platform. */
  readonly platform: import("./device-compatibility.js").PdfjsViewerPlatform;
  /** Resolved operating system. */
  readonly operatingSystem: import("./device-compatibility.js").PdfjsViewerOperatingSystem;
  /** Whether the browser PDF source is the recommended print route. */
  readonly sourceFallbackRecommended: boolean;
}

/** Qualifies controlled printing without reading DOM state or deciding cleanup policy. */
export function resolveNativePrintCapabilities(
  environment: PdfjsViewerDeviceEnvironment,
  compatibility: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[] = PDFJS_VIEWER_DEVICE_COMPATIBILITY,
): Readonly<PdfjsViewerNativePrintCapabilities> {
  const resolved = resolveDeviceCompatibility(environment, compatibility);
  const controlled = resolved.nativePrintSupport !== "unsupported";
  return Object.freeze({
    ...resolved,
    sourceFallbackRecommended: !controlled,
  });
}

/** Captures browser facts only; policy remains independently unit-testable above. */
export function nativePrintCapabilitiesFor(
  win: Window,
  compatibility: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[] = PDFJS_VIEWER_DEVICE_COMPATIBILITY,
): Readonly<PdfjsViewerNativePrintCapabilities> {
  const navigator = win.navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const policy = resolveNativePrintCapabilities(
    { userAgent: navigator.userAgent, mobile: navigator.userAgentData?.mobile },
    compatibility,
  );
  const Sheet = (win as Window & { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (
    win.document &&
    (!Sheet ||
      typeof Sheet.prototype.replaceSync !== "function" ||
      !("adoptedStyleSheets" in win.document))
  ) {
    return Object.freeze({
      ...policy,
      nativePrintSupport: "unsupported",
      sourceFallbackRecommended: true,
    });
  }
  return policy;
}
