// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

// Qualifies every exact peer release and both build flavors through existing browser runners.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseExactPdfjsVersionUnion } from "./pdfjs-version-manifest.mjs";

const packageDir = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const versions = parseExactPdfjsVersionUnion(manifest.peerDependencies?.["pdfjs-dist"]);
const requestedScripts = process.argv.slice(2);
const scripts = requestedScripts.length
  ? requestedScripts.map(suffix => `test:browser:${suffix}`)
  : [
      "test:browser:chromium",
      "test:browser:firefox",
      "test:browser:mobile:chromium",
      "test:browser:mobile:firefox",
      "test:browser:webkit:docker",
      "test:browser:mobile:webkit:docker",
    ];
for (const script of scripts) {
  if (script === "test:browser:qualified" || typeof manifest.scripts?.[script] !== "string")
    throw new Error(`Unknown browser script suffix: ${script.slice("test:browser:".length)}`);
}

const workspace = await mkdtemp(resolve(tmpdir(), "pdfjs-viewer-browser-matrix-"));
try {
  // A fresh writable cache avoids user/global cache permissions, including in CI containers.
  const env = { ...process.env, npm_config_cache: resolve(workspace, "npm-cache") };
  for (const version of versions) {
    const installation = resolve(workspace, version);
    await mkdir(installation);
    await writeFile(
      resolve(installation, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-package-lock", `pdfjs-dist@${version}`],
      {
        cwd: installation,
        stdio: "inherit",
        env,
      },
    );
    const pdfjsRoot = resolve(installation, "node_modules/pdfjs-dist");
    const installed = JSON.parse(await readFile(resolve(pdfjsRoot, "package.json"), "utf8"));
    if (installed.version !== version)
      throw new Error(`Installed pdfjs-dist ${installed.version}, expected ${version}`);
    for (const flavor of ["standard", "legacy"]) {
      for (const script of scripts) {
        console.log(`\nPDF.js ${version} ${flavor}: ${script}`);
        execFileSync("npm", ["run", script], {
          cwd: packageDir,
          stdio: "inherit",
          env: {
            ...env,
            PDFJS_VIEWER_TEST_PDFJS_ROOT: pdfjsRoot,
            PDFJS_VIEWER_TEST_LEGACY: flavor === "legacy" ? "1" : "0",
          },
        });
      }
    }
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
