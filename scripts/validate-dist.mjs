// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { expectedGeneratedDistFiles, rootApiManifest } from "./source-entries.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(packageDir, "dist");
const errors = [];
const listFiles = async dir =>
  (await readdir(dir, { withFileTypes: true })).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [relative(distDir, path).split(sep).join("/")];
  });
const actualFiles = (await listFiles(distDir)).sort();
const packageJson = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const cssExports = Object.entries(packageJson.exports ?? {})
  .filter(([key, target]) => key.endsWith(".css") && typeof target === "string")
  .map(([key, target]) => [key, target.slice("./dist/".length)]);
const expectedFiles = [...expectedGeneratedDistFiles, ...cssExports.map(([, file]) => file)].sort();
const missing = expectedFiles.filter(file => !actualFiles.includes(file));
const unexpected = actualFiles.filter(file => !expectedFiles.includes(file));
if (missing.length) errors.push(`missing files: ${missing.join(", ")}`);
if (unexpected.length) errors.push(`unexpected files: ${unexpected.join(", ")}`);

const runtimeExports = Object.keys(
  await import(`${new URL("../dist/index.js", import.meta.url)}?validate=${Date.now()}`),
).sort();
const expectedRuntimeExports = [...rootApiManifest.values].sort();
if (runtimeExports.join("\n") !== expectedRuntimeExports.join("\n")) {
  errors.push(
    `root runtime exports differ: expected [${expectedRuntimeExports.join(", ")}], got [${runtimeExports.join(", ")}]`,
  );
}

const declaration = await readFile(resolve(distDir, "index.d.ts"), "utf8");
const declarationExports = new Set();
for (const block of declaration.matchAll(/export(?:\s+type)?\s*\{([^}]+)\}/gs)) {
  for (const item of block[1].split(",")) {
    const name = item
      .trim()
      .split(/\s+as\s+/)
      .at(-1)
      ?.trim();
    if (name) declarationExports.add(name);
  }
}
const expectedDeclarationExports = [...rootApiManifest.values, ...rootApiManifest.types].sort();
const actualDeclarationExports = [...declarationExports].sort();
if (actualDeclarationExports.join("\n") !== expectedDeclarationExports.join("\n")) {
  const absent = expectedDeclarationExports.filter(name => !declarationExports.has(name));
  const extra = actualDeclarationExports.filter(name => !expectedDeclarationExports.includes(name));
  errors.push(
    `root declaration surface differs; missing [${absent.join(", ")}], unexpected [${extra.join(", ")}]`,
  );
}

for (const mapFile of actualFiles.filter(file => file.endsWith(".map"))) {
  const map = JSON.parse(await readFile(resolve(distDir, mapFile), "utf8"));
  if (!Array.isArray(map.sources) || map.sources.length === 0)
    errors.push(`${mapFile} has no sources`);
  if (map.file && map.file !== mapFile.slice(0, -4).split("/").at(-1))
    errors.push(`${mapFile} names an invalid output file: ${map.file}`);
  if (map.sources?.some(source => source.includes("dist/") || source.startsWith("/")))
    errors.push(`${mapFile} has a non-source or absolute source path`);
  if (
    !Array.isArray(map.sourcesContent) ||
    map.sourcesContent.length !== map.sources?.length ||
    map.sourcesContent.some(source => typeof source !== "string")
  )
    errors.push(`${mapFile} does not embed every original source`);
}

if (!cssExports.some(([key]) => key === "./core.css"))
  errors.push("package exports must include ./core.css");
if (!cssExports.some(([key]) => key === "./default-ui.css"))
  errors.push("package exports must include ./default-ui.css");
for (const [key, file] of cssExports) {
  if (!packageJson.sideEffects?.includes(`./dist/${file}`))
    errors.push(`${key} must be listed in sideEffects`);
  if (!actualFiles.includes(file)) errors.push(`${key} targets missing dist/${file}`);
}
const sourceCssFiles = (await readdir(resolve(packageDir, "src")))
  .filter(file => file.endsWith(".css"))
  .sort();
if (sourceCssFiles.join("\n") !== ["core.css", "default-ui-theme.css"].join("\n")) {
  errors.push(`source CSS files differ: [${sourceCssFiles.join(", ")}]`);
}
const [coreCss, defaultUiThemeCss, builtCoreCss, builtDefaultUiCss] = await Promise.all([
  readFile(resolve(packageDir, "src/core.css"), "utf8"),
  readFile(resolve(packageDir, "src/default-ui-theme.css"), "utf8"),
  readFile(resolve(distDir, "core.css"), "utf8"),
  readFile(resolve(distDir, "default-ui.css"), "utf8"),
]);
if (builtCoreCss !== coreCss) errors.push("dist/core.css differs from src/core.css");
if (builtDefaultUiCss !== `${coreCss}\n${defaultUiThemeCss}`) {
  errors.push("dist/default-ui.css is not the generated core.css + default-ui-theme.css aggregate");
}
for (const [file, built] of [
  ["core.css", builtCoreCss],
  ["default-ui.css", builtDefaultUiCss],
]) {
  const customProperties = [...built.matchAll(/(^|[;{]\s*)--([\w-]+)\s*:/gm)].map(
    match => `--${match[2]}`,
  );
  const invalid = [
    ...new Set(
      customProperties.filter(
        name =>
          !/^--(?:pdf-ui-|pdf-form-|xfa-|pdf-page-(?:hgap|vgap)$|pdf-thumbnail-width$|comb-width$|min-font-size(?:-inv)?$|text-scale-factor$|font-height$|scale-x$|rotate$)/.test(
            name,
          ),
      ),
    ),
  ];
  if (invalid.length)
    errors.push(`dist/${file} defines unrecognized custom properties: ${invalid.join(", ")}`);
}

if (errors.length) {
  console.error("Package distribution validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Package distribution files, exports, declarations, source maps, and CSS are valid.");
}
