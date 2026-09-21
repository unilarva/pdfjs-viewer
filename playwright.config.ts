// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";

const requestedRunId = process.env.PDFJS_VIEWER_PLAYWRIGHT_RUN_ID ?? "default";
const runId = requestedRunId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "default";
const configuredPort = Number.parseInt(process.env.PDFJS_VIEWER_PLAYWRIGHT_PORT ?? "", 10);
const port =
  Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535
    ? configuredPort
    : 4179;
const baseURL = `http://127.0.0.1:${port}`;
const mobileViewport = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
};

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: `playwright-report/${runId}` }], ["line"]]
    : "list",
  outputDir: `./test-results/${runId}`,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/playwright-server.mjs",
    url: `${baseURL}/health`,
    env: {
      PLAYWRIGHT_DIST_DIR: `.playwright-dist/${runId}`,
      PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "mobile-chromium",
      grep: /@mobile/,
      use: { browserName: "chromium", ...mobileViewport },
    },
    { name: "mobile-firefox", grep: /@mobile/, use: { browserName: "firefox", ...mobileViewport } },
    { name: "mobile-webkit", grep: /@mobile/, use: { browserName: "webkit", ...mobileViewport } },
  ],
});
