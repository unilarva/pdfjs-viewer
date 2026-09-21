// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  demoHost,
  demoNativePrintSupport,
  demoPdfjsVersionPolicy,
  demoPort,
  demoPrintMode,
} from "../../scripts/demo-host.mjs";
import { resolveDemoPrintPolicy } from "../../examples/demo-policy.js";
import { mergeDeviceCompatibilityRules } from "../../src/device-compatibility.js";
import { resolveDeviceCompatibility } from "../../src/index.js";

test("demo host and port default to loopback and require explicit valid overrides", () => {
  assert.equal(demoHost(undefined), "127.0.0.1");
  assert.equal(demoHost("0.0.0.0"), "0.0.0.0");
  assert.throws(() => demoHost(""), /nonempty/);
  assert.throws(() => demoHost("localhost invalid"), /whitespace/);
  assert.throws(() => demoHost("https://localhost"), /not a URL or path/);
  assert.equal(demoPort(undefined), 8047);
  assert.equal(demoPort("9000"), 9000);
  assert.throws(() => demoPort("9000x"), /integer/);
  assert.throws(() => demoPort("65536"), /1 to 65535/);
  assert.equal(demoPdfjsVersionPolicy(undefined), "qualified-only");
  assert.equal(demoPdfjsVersionPolicy("allow-unqualified"), "allow-unqualified");
  assert.throws(() => demoPdfjsVersionPolicy("allow"), /qualified-only or allow-unqualified/);
  assert.equal(demoPrintMode(undefined), "native");
  assert.equal(demoPrintMode("browser"), "browser");
  assert.throws(() => demoPrintMode("adapter"), /native, browser, or off/);
  assert.equal(demoNativePrintSupport(undefined), null);
  assert.equal(demoNativePrintSupport("portrait"), "portrait");
  assert.equal(demoNativePrintSupport("portrait-and-landscape"), "portrait-and-landscape");
  assert.throws(() => demoNativePrintSupport("all"), /portrait or portrait-and-landscape/);
});

test("demo forced native support overrides generic, desktop, and apple-mobile compatibility defaults", () => {
  assert.deepEqual(resolveDemoPrintPolicy("browser", null), { printMode: "browser" });
  for (const support of ["portrait", "portrait-and-landscape"] as const) {
    const policy = resolveDemoPrintPolicy("off", support);
    assert.equal(policy.printMode, "native");
    const rules = mergeDeviceCompatibilityRules(policy.deviceCompatibility ?? []);
    for (const userAgent of [
      "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/141.0",
      "Mozilla/5.0 (Android 16; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    ])
      assert.equal(resolveDeviceCompatibility({ userAgent }, rules).nativePrintSupport, support);
  }
});
