// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import type {
  PdfjsViewerDeviceCompatibilityRule,
  PdfjsViewerNativePrintSupport,
  PdfjsViewerPrintMode,
} from "../src/index.js";

export function resolveDemoPrintPolicy(
  configuredMode: Exclude<PdfjsViewerPrintMode, "adapter">,
  forcedSupport: Exclude<PdfjsViewerNativePrintSupport, "unsupported"> | null,
): Readonly<{
  printMode: Exclude<PdfjsViewerPrintMode, "adapter">;
  deviceCompatibility?: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[];
}> {
  if (!forcedSupport) return Object.freeze({ printMode: configuredMode });
  return Object.freeze({
    printMode: "native",
    deviceCompatibility: Object.freeze([
      Object.freeze({ engine: "chromium", nativePrintSupport: forcedSupport }),
      Object.freeze({ engine: "chromium", platform: "desktop", nativePrintSupport: forcedSupport }),
      Object.freeze({
        engine: "chromium",
        platform: "apple-mobile",
        nativePrintSupport: forcedSupport,
      }),
      Object.freeze({ engine: "firefox", nativePrintSupport: forcedSupport }),
      Object.freeze({ engine: "firefox", platform: "desktop", nativePrintSupport: forcedSupport }),
      Object.freeze({
        engine: "firefox",
        platform: "apple-mobile",
        nativePrintSupport: forcedSupport,
      }),
      Object.freeze({ engine: "webkit", nativePrintSupport: forcedSupport }),
      Object.freeze({
        engine: "webkit",
        platform: "apple-mobile",
        nativePrintSupport: forcedSupport,
      }),
    ]),
  });
}
