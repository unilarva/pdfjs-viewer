// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type { PdfjsViewerNativePrintCapabilities } from "../../src/native-print-capabilities.js";
import { resolveViewerPrintRoute } from "../../src/print-route.js";

const capabilities = (
  nativePrintSupport: PdfjsViewerNativePrintCapabilities["nativePrintSupport"],
): PdfjsViewerNativePrintCapabilities => ({
  nativePrintSupport,
  engine: "chromium",
  browser: "chrome",
  platform: "desktop",
  operatingSystem: "linux",
  sourceFallbackRecommended: nativePrintSupport === "unsupported",
});

test("all explicit print modes resolve through one pure route boundary", () => {
  assert.equal(resolveViewerPrintRoute("off", null).route, "disabled");
  assert.equal(resolveViewerPrintRoute("browser", null).route, "browser");
  assert.equal(resolveViewerPrintRoute("adapter", null).route, "adapter");
  for (const support of ["portrait", "portrait-and-landscape"] as const) {
    assert.deepEqual(resolveViewerPrintRoute("native", capabilities(support)), {
      configuredMode: "native",
      route: "controlled-native",
      fallback: false,
      reason: "native-supported",
      capabilities: capabilities(support),
    });
  }
  assert.deepEqual(resolveViewerPrintRoute("native", capabilities("unsupported")), {
    configuredMode: "native",
    route: "browser",
    fallback: true,
    reason: "native-unavailable",
    capabilities: capabilities("unsupported"),
  });
  assert.deepEqual(resolveViewerPrintRoute("native", capabilities("unsupported"), false), {
    configuredMode: "native",
    route: "unavailable",
    fallback: false,
    reason: "native-unavailable",
    capabilities: capabilities("unsupported"),
  });
});
