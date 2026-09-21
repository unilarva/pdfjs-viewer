// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  PDFJS_VIEWER_DEVICE_COMPATIBILITY,
  normalizeDeviceCompatibilityRules,
  resolveDeviceCompatibility,
} from "../../src/device-compatibility.js";
import {
  nativePrintCapabilitiesFor,
  resolveNativePrintCapabilities,
} from "../../src/native-print-capabilities.js";

const chromeDesktop = "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36";
const firefoxDesktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/141.0";
const safariDesktop =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const chromeAndroid = "Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Mobile Safari/537.36";
const firefoxAndroid = "Mozilla/5.0 (Android 16; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0";

test("package device compatibility grants desktop landscape to Chromium and Firefox, portrait transport on supported mobile platforms, and rejects WebKit and apple-mobile", () => {
  assert.equal(PDFJS_VIEWER_DEVICE_COMPATIBILITY.length, 8);
  for (const userAgent of [chromeDesktop, firefoxDesktop]) {
    assert.equal(
      resolveDeviceCompatibility({ userAgent }).nativePrintSupport,
      "portrait-and-landscape",
      "chromeFirefoxDesktop",
    );
  }
  assert.equal(
    resolveDeviceCompatibility({ userAgent: safariDesktop }).nativePrintSupport,
    "unsupported",
    "safariDesktop",
  );
  assert.equal(
    resolveDeviceCompatibility({ userAgent: chromeAndroid }).nativePrintSupport,
    "portrait",
    "chromeAndroid",
  );
  assert.equal(
    resolveDeviceCompatibility({ userAgent: firefoxAndroid }).nativePrintSupport,
    "portrait",
    "firefoxAndroid",
  );
  for (const userAgent of [
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/141.0 Mobile/15E148 Safari/605.1.15",
  ]) {
    assert.equal(
      resolveDeviceCompatibility({ userAgent }).nativePrintSupport,
      "unsupported",
      "appleMobile",
    );
  }
  assert.equal(
    resolveDeviceCompatibility({ userAgent: "custom-agent" }).nativePrintSupport,
    "unsupported",
  );
});

test("browser and platform refinements override an engine rule by selector containment", () => {
  const rules = normalizeDeviceCompatibilityRules([
    { engine: "chromium", nativePrintSupport: "portrait" },
    { engine: "chromium", browser: "chrome", nativePrintSupport: "portrait-and-landscape" },
    {
      engine: "chromium",
      browser: "chrome",
      platform: "android",
      nativePrintSupport: "unsupported",
    },
  ]);
  assert.equal(
    resolveDeviceCompatibility({ userAgent: chromeDesktop }, rules).nativePrintSupport,
    "portrait-and-landscape",
  );
  assert.equal(
    resolveDeviceCompatibility({ userAgent: chromeAndroid }, rules).nativePrintSupport,
    "unsupported",
  );
  assert.equal(
    resolveDeviceCompatibility(
      { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Edg/140.0 Chrome/140.0 Safari/537.36" },
      rules,
    ).nativePrintSupport,
    "portrait",
  );
});

test("independent conflicting refinements require an explicit intersection", () => {
  const ambiguous = [
    { engine: "chromium", browser: "chrome", nativePrintSupport: "portrait" },
    { engine: "chromium", platform: "android", nativePrintSupport: "unsupported" },
  ];
  assert.throws(() => normalizeDeviceCompatibilityRules(ambiguous), /explicit intersection/);
  assert.doesNotThrow(() =>
    normalizeDeviceCompatibilityRules([
      ...ambiguous,
      {
        engine: "chromium",
        browser: "chrome",
        platform: "android",
        nativePrintSupport: "unsupported",
      },
    ]),
  );
});

test("rules require a known engine and coherent optional selectors", () => {
  for (const value of [
    {},
    [{ platform: "android", nativePrintSupport: "portrait" }],
    [{ engine: "unknown", nativePrintSupport: "portrait" }],
    [{ engine: "firefox", browser: "chrome", nativePrintSupport: "portrait" }],
    [
      {
        engine: "chromium",
        platform: "desktop",
        operatingSystem: "android",
        nativePrintSupport: "portrait",
      },
    ],
    [{ engine: "chromium", nativePrintSupport: "all" }],
  ])
    assert.throws(() => normalizeDeviceCompatibilityRules(value));
  assert.throws(
    () =>
      resolveDeviceCompatibility({ userAgent: chromeDesktop }, [
        { engine: "chromium", browser: "chrome", nativePrintSupport: "portrait" },
        { engine: "chromium", platform: "desktop", nativePrintSupport: "unsupported" },
      ]),
    /explicit intersection/,
  );
});

test("native capability resolution preserves policy but applies mechanical CSSOM denial", () => {
  assert.deepEqual(resolveNativePrintCapabilities({ userAgent: chromeAndroid }), {
    nativePrintSupport: "portrait",
    engine: "chromium",
    browser: "chrome",
    platform: "android",
    operatingSystem: "android",
    sourceFallbackRecommended: false,
  });
  const win = {
    navigator: { userAgent: firefoxAndroid },
    document: {},
    CSSStyleSheet: undefined,
  } as unknown as Window;
  const result = nativePrintCapabilitiesFor(win);
  assert.equal(result.nativePrintSupport, "unsupported");
  assert.equal(result.sourceFallbackRecommended, true);
});
