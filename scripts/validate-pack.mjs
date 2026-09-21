// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedGeneratedDistFiles,
  privateEmittedSourceEntries,
  rootApiManifest,
} from "./source-entries.mjs";
import { parseExactPdfjsVersionUnion } from "./pdfjs-version-manifest.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suppliedTarball = process.argv[2] ? resolve(process.argv[2]) : null;
const packageManifest = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const pdfjsVersion = parseExactPdfjsVersionUnion(packageManifest.peerDependencies["pdfjs-dist"]).at(
  -1,
);
const workspace = await mkdtemp(resolve(tmpdir(), "pdfjs-viewer-pack-"));
const npmEnv = { ...process.env, npm_config_cache: resolve(tmpdir(), "kilo/npm-cache") };
// The distribution with fullscreen/presentation, complete consumer guides, and maintainer
// documentation measures about 895 KB packed / 3.94 MB unpacked; retain modest headroom.
const MAX_PACKED_BYTES = 920_000;
const MAX_UNPACKED_BYTES = 4_050_000;
const MAX_CORE_CSS_BYTES = 30_000;
const MAX_DEFAULT_UI_CSS_BYTES = 80_000;

async function installedBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) bytes += await installedBytes(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
  }
  return bytes;
}

function packTarball(destination) {
  const result = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], {
      cwd: packageDir,
      encoding: "utf8",
      env: npmEnv,
    }),
  );
  const metadata = Array.isArray(result) ? result[0] : Object.values(result)[0];
  if (!metadata?.filename) throw new Error("npm pack returned no package metadata");
  return resolve(destination, metadata.filename);
}

try {
  const tarball = suppliedTarball ?? packTarball(workspace);
  const packedBytes = (await stat(tarball)).size;
  const expected = [
    "package/package.json",
    "package/README.md",
    "package/USAGE.md",
    "package/CUSTOMIZATION.md",
    "package/ARCHITECTURE.md",
    "package/DEVICE-COMPATIBILITY.md",
    "package/CHANGELOG.md",
    "package/LICENSE",
    "package/assets/icons/unilarva-pdfjs-viewer-logo-adaptive.svg",
    "package/dist/core.css",
    "package/dist/default-ui.css",
    ...expectedGeneratedDistFiles.map(file => `package/dist/${file}`),
  ].sort();
  const actual = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  if (actual.join("\n") !== expected.join("\n")) {
    const missing = expected.filter(file => !actual.includes(file));
    const unexpected = actual.filter(file => !expected.includes(file));
    throw new Error(
      `Packed tarball allowlist mismatch; missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`,
    );
  }
  execFileSync("tar", ["-xzf", tarball, "-C", workspace]);
  const packedDir = resolve(workspace, "package");
  const unpackedBytes = await installedBytes(packedDir);
  if (packedBytes > MAX_PACKED_BYTES || unpackedBytes > MAX_UNPACKED_BYTES)
    throw new Error(
      `Packed size budget exceeded: ${packedBytes} packed, ${unpackedBytes} unpacked`,
    );
  const pkg = JSON.parse(await readFile(resolve(packedDir, "package.json"), "utf8"));
  if (pkg.license !== "Apache-2.0" || pkg.publishConfig?.provenance !== true)
    throw new Error("Packed license/provenance metadata is incomplete");
  if (
    pkg.repository?.url !== "git+https://github.com/unilarva/pdfjs-viewer.git" ||
    "directory" in (pkg.repository ?? {})
  )
    throw new Error("Packed repository metadata is not standalone");
  if (
    pkg.bugs?.url !== "https://github.com/unilarva/pdfjs-viewer/issues" ||
    pkg.homepage !== "https://github.com/unilarva/pdfjs-viewer#readme"
  )
    throw new Error("Packed support links are not standalone");
  if (
    JSON.stringify(pkg.sideEffects) !== JSON.stringify(["./dist/default-ui.css", "./dist/core.css"])
  )
    throw new Error("Packed sideEffects contract changed");
  if (
    JSON.stringify(Object.keys(pkg.exports).sort()) !==
    JSON.stringify([".", "./core.css", "./default-ui.css", "./package.json"].sort())
  )
    throw new Error("Packed root export map changed");
  if (!/Apache License\s+Version 2\.0/.test(await readFile(resolve(packedDir, "LICENSE"), "utf8")))
    throw new Error("Packed Apache-2.0 license text is missing");
  for (const cssFile of ["core.css", "default-ui.css"]) {
    const css = await readFile(resolve(packedDir, "dist", cssFile), "utf8");
    if (
      !css.includes("SPDX-License-Identifier: Apache-2.0") ||
      !css.includes("adapted from Mozilla PDF.js 6.3 pdf_viewer.css")
    )
      throw new Error(`Packed ${cssFile} is missing PDF.js CSS license provenance`);
    if (
      Buffer.byteLength(css) >
      (cssFile === "core.css" ? MAX_CORE_CSS_BYTES : MAX_DEFAULT_UI_CSS_BYTES)
    )
      throw new Error(`Packed ${cssFile} exceeds its size budget`);
  }
  for (const mapFile of actual.filter(file => file.endsWith(".map"))) {
    const map = JSON.parse(await readFile(resolve(workspace, mapFile), "utf8"));
    if (
      !map.sources?.length ||
      map.sources.some(source => source.startsWith("/") || source.includes("dist/"))
    )
      throw new Error(`${mapFile} has invalid source provenance`);
    if (
      !Array.isArray(map.sourcesContent) ||
      map.sourcesContent.length !== map.sources.length ||
      map.sourcesContent.some(source => typeof source !== "string")
    )
      throw new Error(`${mapFile} does not embed every original source`);
  }
  const consumer = resolve(workspace, "consumer");
  await mkdir(consumer);
  await writeFile(
    resolve(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", tarball, `pdfjs-dist@${pdfjsVersion}`],
    { cwd: consumer, stdio: "inherit", env: npmEnv },
  );
  const installed = resolve(consumer, "node_modules/@unilarva/pdfjs-viewer");
  const installedPdfjs = JSON.parse(
    await readFile(resolve(consumer, "node_modules/pdfjs-dist/package.json"), "utf8"),
  );
  if (installedPdfjs.version !== pdfjsVersion)
    throw new Error(`Packed install resolved unqualified pdfjs-dist ${installedPdfjs.version}`);
  await writeFile(
    resolve(consumer, "probe.mjs"),
    `import * as packageRoot from "@unilarva/pdfjs-viewer"; const missing = ${JSON.stringify(rootApiManifest.values)}.filter(name => !(name in packageRoot)); if (missing.length) throw new Error(\`Packed root is missing runtime exports: \${missing.join(", ")}\`);`,
  );
  execFileSync(process.execPath, ["probe.mjs"], { cwd: consumer, stdio: "inherit", env: npmEnv });
  const consumerRequire = createRequire(resolve(consumer, "probe.cjs"));
  for (const entry of privateEmittedSourceEntries) {
    const stem = entry.slice("src/".length, -".ts".length);
    let rejected = false;
    try {
      consumerRequire.resolve(`@unilarva/pdfjs-viewer/${stem}`);
    } catch (error) {
      rejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
    }
    if (!rejected) throw new Error(`Packed install exposed private package subpath ${stem}`);
  }
  if ((await readdir(resolve(installed, "dist"))).length === 0)
    throw new Error("Packed installation is incomplete");
  console.log(
    `Exact tarball and packed install are valid (${packedBytes} bytes packed, ${unpackedBytes} bytes unpacked).`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
