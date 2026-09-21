// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(import.meta.dirname, "..");
const requestedRunId = process.env.PDFJS_VIEWER_PLAYWRIGHT_RUN_ID ?? `${Date.now()}-${process.pid}`;
const runId = requestedRunId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || `run-${process.pid}`;

function configuredPort() {
  const value = process.env.PDFJS_VIEWER_PLAYWRIGHT_PORT;
  if (value === undefined) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PDFJS_VIEWER_PLAYWRIGHT_PORT: ${value}`);
  }
  return String(port);
}

async function availablePort() {
  const configured = configuredPort();
  if (configured) return configured;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a Playwright server port"));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(String(address.port))));
    });
  });
}

const port = await availablePort();
const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PDFJS_VIEWER_PLAYWRIGHT_RUN_ID: runId,
    PDFJS_VIEWER_PLAYWRIGHT_PORT: port,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", error => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", async (code, signal) => {
  const exitCode = signal ? 1 : (code ?? 1);
  await rm(path.join(packageDir, ".playwright-dist", runId), { recursive: true, force: true });
  if (exitCode === 0) {
    await rm(path.join(packageDir, "test-results", runId), { recursive: true, force: true });
  }
  process.exitCode = exitCode;
});
