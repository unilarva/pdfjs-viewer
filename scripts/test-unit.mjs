// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { build } from "esbuild";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = resolve(import.meta.dirname, "..");
const nodeModulesDir = join(packageDir, "node_modules");
await mkdir(nodeModulesDir, { recursive: true });
const outputDir = await mkdtemp(join(nodeModulesDir, ".pdfjs-viewer-unit-"));

try {
  const testDir = resolve(packageDir, "tests/unit");
  const tests = (await readdir(testDir)).filter(file => file.endsWith(".test.ts"));
  const outputFiles = tests.map(test => join(outputDir, test.replace(/\.ts$/, ".mjs")));
  await Promise.all(
    tests.map(async (test, index) => {
      await build({
        entryPoints: [resolve(testDir, test)],
        outfile: outputFiles[index],
        bundle: true,
        platform: "node",
        format: "esm",
        target: ["node22"],
        packages: "external",
      });
    }),
  );
  const result = spawnSync(process.execPath, ["--test", ...outputFiles], {
    cwd: packageDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
