// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  consumerFacingSourceEntries,
  privateEmittedSourceEntries,
  sourceEntries,
} from "./source-entries.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(packageDir, "src");
const errors = [];

const sourceFileName = entry => entry.slice("src/".length);
const consumerFacingSources = new Set(consumerFacingSourceEntries.map(sourceFileName));
const privateEmittedSources = new Set(privateEmittedSourceEntries.map(sourceFileName));
const publicSourceAllowlist = new Set(
  consumerFacingSourceEntries
    .filter(entry => entry !== "src/index.ts")
    .map(entry => `./${entry.slice("src/".length, -".ts".length)}.js`),
);

const modelSources = [
  "document-information.ts",
  "document-attachments.ts",
  "document-layers.ts",
  "document-search.ts",
  "document-navigation.ts",
];
const forbiddenModelDependencies = new Set([
  "./default-ui.js",
  "./document-renderer.js",
  "./page-layout-engine.js",
  "./pdfjs-viewer.js",
  "./pointer-scroll.js",
  "./document-progress-feedback.js",
  "./render-scheduler.js",
  "./viewer-ui-discovery.js",
  "./zoom-gesture.js",
]);
const forbiddenNavigationHostCapabilities = new Set([
  "emitOutlinePreparation",
  "hostActive",
  "installOutlineFilterUi",
  "isOutlineOverlay",
  "normalizeOutlineQueryOptions",
  "outlineContainer",
  "outlineFilterEnabled",
  "outlineFilterOptions",
  "outlinePreparationErrorLabel",
  "scrollToPage",
  "scrollToPageWithImeGuard",
  "scrollToSpot",
]);

const report = message => errors.push(message);
const sourcePath = fileName => resolve(srcDir, fileName);
const readSource = fileName => readFile(sourcePath(fileName), "utf8");

/** Blanks comments and, optionally, strings while preserving statement boundaries. */
const scrubSource = (source, scrubStrings = false) => {
  let result = "";
  let state = "code";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        result += "\n";
      } else result += " ";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        result += "  ";
        index += 1;
      } else result += char === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "string") {
      if (char === "\\") {
        result += scrubStrings ? "  " : char + (next ?? "");
        index += 1;
      } else if (char === quote) {
        state = "code";
        result += scrubStrings ? " " : char;
      } else {
        result += scrubStrings && char !== "\n" ? " " : char;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line-comment";
      result += "  ";
      index += 1;
    } else if (char === "/" && next === "*") {
      state = "block-comment";
      result += "  ";
      index += 1;
    } else if (char === '"' || char === "'" || char === "`") {
      state = "string";
      quote = char;
      result += scrubStrings ? " " : char;
    } else {
      result += char;
    }
  }
  return result;
};

const moduleSpecifiers = source => {
  const withoutComments = scrubSource(source);
  const specifiers = [];
  const declarationPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?(["'])([^"']+)\1/g;
  const dynamicPattern = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const match of withoutComments.matchAll(declarationPattern)) specifiers.push(match[2]);
  for (const match of withoutComments.matchAll(dynamicPattern)) specifiers.push(match[2]);
  return specifiers;
};

const documentRendererDependencies = new Set(
  moduleSpecifiers(await readSource("document-renderer.ts")),
);
if (documentRendererDependencies.has("./page-layout-engine.js")) {
  report(
    "src/document-renderer.ts must consume the narrow surface-registry port instead of importing PageLayoutEngine.",
  );
}

// These checks intentionally recognize stable source constructs rather than
// formatting, method counts, line counts, or prose. They are bounded to the
// build/export/dependency contracts this validator can enforce objectively.
const buildSource = scrubSource(await readFile(resolve(packageDir, "scripts/build.mjs"), "utf8"));
const importsSourceEntries =
  /\bimport\s*\{\s*sourceEntries\s*\}\s*from\s*(["'])\.\/source-entries\.mjs\1\s*;?/.test(
    buildSource,
  );
const derivesEsbuildEntries = /\bentryPoints\s*:\s*sourceEntries\s*\.\s*map\s*\(/.test(buildSource);
if (!importsSourceEntries) {
  report(
    'scripts/build.mjs must import { sourceEntries } from "./source-entries.mjs" so build and architecture validation share one emitted-entry manifest.',
  );
}
if (!derivesEsbuildEntries) {
  report(
    "scripts/build.mjs must derive esbuild entryPoints from sourceEntries.map(...); do not restore a separate entry-point list.",
  );
}

const actualEntries = (await readdir(srcDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
  .map(entry => `src/${entry.name}`)
  .sort();
const declaredEntries = [...sourceEntries].sort();
const duplicateEntries = sourceEntries.filter(
  (entry, index) => sourceEntries.indexOf(entry) !== index,
);
const duplicateConsumerEntries = consumerFacingSourceEntries.filter(
  (entry, index) => consumerFacingSourceEntries.indexOf(entry) !== index,
);

if (duplicateEntries.length) {
  report(
    `scripts/source-entries.mjs contains duplicate entries: ${[...new Set(duplicateEntries)].join(", ")}.`,
  );
}
if (duplicateConsumerEntries.length) {
  report(
    `scripts/source-entries.mjs contains duplicate consumer-facing entries: ${[...new Set(duplicateConsumerEntries)].join(", ")}.`,
  );
}
for (const entry of consumerFacingSourceEntries) {
  if (!sourceEntries.includes(entry)) {
    report(`${entry} is consumer-facing but is not present in the emitted source manifest.`);
  }
}
for (const entry of actualEntries) {
  if (!declaredEntries.includes(entry)) {
    report(
      `${entry} is not emitted by the non-bundled build. Add it to scripts/source-entries.mjs.`,
    );
  }
}
for (const entry of declaredEntries) {
  if (!actualEntries.includes(entry)) {
    report(
      `${entry} is listed in scripts/source-entries.mjs but is not a top-level src/*.ts file. Remove or correct the stale entry.`,
    );
  }
}

for (const entry of actualEntries) {
  const fileName = entry.slice("src/".length);
  const source = await readSource(fileName);
  const moduleHeader = source.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
  if (!moduleHeader.includes("[architecture guide](../ARCHITECTURE.md)")) {
    report(`${entry} module TSDoc must link to the authoritative ../ARCHITECTURE.md guide.`);
  }
  if (consumerFacingSources.has(fileName)) {
    if (!/\b(?:Public|public|Package consumers|package consumers)\b/.test(moduleHeader)) {
      report(
        `${entry} is consumer-facing and its module TSDoc must prioritize the public package-root audience.`,
      );
    }
  } else if (
    !/\bPrivate\b/.test(moduleHeader) ||
    !moduleHeader.includes("not a supported consumer")
  ) {
    report(
      `${entry} is private and its module TSDoc must state that it is not a supported consumer subpath or package-root export.`,
    );
  }
}

for (const fileName of privateEmittedSources) {
  const source = await readSource(fileName);
  if (moduleSpecifiers(source).includes("./pdfjs-viewer.js")) {
    report(
      `src/${fileName} imports the PdfjsViewer facade. Private owners must receive narrow values, intents, results, or capabilities instead.`,
    );
  }
}

const indexSource = scrubSource(await readSource("index.ts"));
const indexExportStatements = [...indexSource.matchAll(/\bexport\b[^;]*;/g)].map(match => match[0]);
const indexReexportSources = new Set();
for (const statement of indexExportStatements) {
  const fromMatch = statement.match(/\bfrom\s*(["'])([^"']+)\1\s*;$/);
  if (!fromMatch) {
    report(
      "src/index.ts contains a local export. Package-root exports must re-export from an explicit public source module.",
    );
  } else if (!publicSourceAllowlist.has(fromMatch[2])) {
    report(
      `src/index.ts re-exports from ${JSON.stringify(fromMatch[2])}, which is not in the public-source allowlist in scripts/validate-architecture.mjs.`,
    );
  } else {
    indexReexportSources.add(fromMatch[2]);
  }
}
for (const specifier of publicSourceAllowlist) {
  if (!indexReexportSources.has(specifier)) {
    report(
      `Consumer-facing source ${JSON.stringify(specifier)} contributes no package-root export from src/index.ts.`,
    );
  }
}

for (const fileName of modelSources) {
  const source = await readSource(fileName);
  for (const specifier of moduleSpecifiers(source)) {
    if (forbiddenModelDependencies.has(specifier)) {
      report(
        `src/${fileName} imports ${JSON.stringify(specifier)}. Document models must not depend on facade, DOM presentation, layout, rendering, or gesture owners.`,
      );
    }
  }

  const code = scrubSource(source, true);
  const violations = new Set();
  const recordMatches = (pattern, label) => {
    if (pattern.test(code)) violations.add(label);
  };
  recordMatches(
    /\b(?:CSSStyleDeclaration|Document|DOMRect|EventTarget|HTMLElement|Window|HTML[A-Za-z]*Element)\b/,
    "DOM type",
  );
  recordMatches(/\b(?:window|document)\s*\./, "browser global");
  recordMatches(/\bglobalThis\s*\.\s*(?:window|document)\b/, "browser global");
  recordMatches(
    /\.\s*(?:createElement|querySelector|querySelectorAll|setAttribute|removeAttribute|scrollIntoView|dispatchEvent)\s*\(/,
    "DOM creation/query/mutation",
  );
  recordMatches(/\.\s*(?:classList|dataset|style)\b/, "DOM presentation property");
  recordMatches(
    /\.\s*(?:focus|openPanel|closePanel|renderHighlights|renderOutline|scrollTo|setScrollPosition)\s*\(/,
    "presentation/scroll method",
  );
  if (fileName === "document-navigation.ts") {
    for (const capability of forbiddenNavigationHostCapabilities) {
      const pattern = new RegExp(`\\b${capability}\\b`);
      if (pattern.test(code)) violations.add(`forbidden navigation host capability ${capability}`);
    }
  }
  if (violations.size) {
    report(
      `src/${fileName} uses detached-model-forbidden construct(s): ${[...violations].sort().join(", ")}. Keep DOM presentation and movement execution in the facade.`,
    );
  }
}

if (errors.length) {
  console.error("Architecture validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture validation passed for ${actualEntries.length} emitted TypeScript modules.`,
  );
}
