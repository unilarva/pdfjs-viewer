// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { build } from "esbuild";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { sourceEntries } from "./source-entries.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(packageDir, "dist");

await rm(distDir, { recursive: true, force: true });

await build({
  entryPoints: sourceEntries.map(entry => resolve(packageDir, entry)),
  outdir: distDir,
  outbase: resolve(packageDir, "src"),
  bundle: false,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
});

execFileSync(
  process.platform === "win32" ? "tsc.cmd" : "tsc",
  ["-p", resolve(packageDir, "tsconfig.build.json")],
  { cwd: packageDir, stdio: "inherit" },
);

const coreCss = await readFile(resolve(packageDir, "src/core.css"), "utf8");
const defaultUiThemeCss = await readFile(resolve(packageDir, "src/default-ui-theme.css"), "utf8");
await writeFile(resolve(distDir, "core.css"), coreCss);
await writeFile(resolve(distDir, "default-ui.css"), `${coreCss}\n${defaultUiThemeCss}`);

console.log(`Built @unilarva/pdfjs-viewer: ${distDir}`);
