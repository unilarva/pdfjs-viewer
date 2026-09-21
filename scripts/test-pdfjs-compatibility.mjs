// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPdfjsCssCompatibility } from "./pdfjs-css-compatibility.mjs";
import { parseExactPdfjsVersionUnion } from "./pdfjs-version-manifest.mjs";

const variant = process.argv[2];
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const qualifiedVersions = parseExactPdfjsVersionUnion(
  packageManifest.peerDependencies?.["pdfjs-dist"],
);
const requestedVersion = process.argv[3];
if (variant !== "standard" && variant !== "legacy")
  throw new Error("Expected standard or legacy PDF.js variant");
if (requestedVersion === undefined) {
  for (const qualifiedVersion of qualifiedVersions) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), variant, qualifiedVersion], {
      cwd: packageDir,
      stdio: "inherit",
    });
  }
  process.exit(0);
}
const version = requestedVersion ?? qualifiedVersions[0];

if (!("DOMMatrix" in globalThis)) globalThis.DOMMatrix = class DOMMatrix {};
if (!("ImageData" in globalThis)) globalThis.ImageData = class ImageData {};
if (!("Path2D" in globalThis)) globalThis.Path2D = class Path2D {};
if (!("try" in Promise))
  Promise.try = (callback, ...args) => new Promise(resolve => resolve(callback(...args)));
if (!("toHex" in Uint8Array.prototype))
  Uint8Array.prototype.toHex = function toHex() {
    return Array.from(this, byte => byte.toString(16).padStart(2, "0")).join("");
  };
if (!("getOrInsertComputed" in Map.prototype))
  Map.prototype.getOrInsertComputed = function getOrInsertComputed(key, callback) {
    if (this.has(key)) return this.get(key);
    const value = callback(key);
    this.set(key, value);
    return value;
  };

const workspace = await mkdtemp(resolve(tmpdir(), "pdfjs-viewer-compat-"));
const npmEnv = { ...process.env, npm_config_cache: resolve(tmpdir(), "kilo/npm-cache") };
await writeFile(
  resolve(workspace, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
try {
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", `pdfjs-dist@${version}`],
    {
      cwd: workspace,
      stdio: "inherit",
      env: npmEnv,
    },
  );
  const installedPackage = JSON.parse(
    await readFile(resolve(workspace, "node_modules/pdfjs-dist/package.json"), "utf8"),
  );
  if (installedPackage.version !== version)
    throw new Error(`Installed pdfjs-dist ${installedPackage.version}, expected ${version}`);
  const modulePath = resolve(
    workspace,
    "node_modules/pdfjs-dist",
    variant === "legacy" ? "legacy/build/pdf.mjs" : "build/pdf.mjs",
  );
  await checkPdfjsCssCompatibility(
    resolve(workspace, "node_modules/pdfjs-dist"),
    modulePath,
    version,
  );
  const pdfjs = await import(pathToFileURL(modulePath).href);
  const requireMethods = (value, methods, name) => {
    for (const method of methods)
      if (typeof value?.[method] !== "function") throw new Error(`${name} is missing ${method}()`);
  };

  if (pdfjs.version !== version)
    throw new Error(`Expected qualified pdfjs-dist ${version}, got ${pdfjs.version}`);
  requireMethods(pdfjs, ["getDocument"], "PDF.js display module");
  if (!pdfjs.GlobalWorkerOptions)
    throw new Error("PDF.js display module is missing GlobalWorkerOptions");
  requireMethods(
    pdfjs.AnnotationLayer?.prototype,
    ["render", "update", "destroy"],
    "AnnotationLayer.prototype",
  );
  requireMethods(pdfjs.TextLayer?.prototype, ["render", "cancel"], "TextLayer.prototype");
  requireMethods(pdfjs.XfaLayer, ["render", "update", "getPageViewport"], "XfaLayer");
  for (const [name, value] of Object.entries({
    DISABLE: 0,
    ENABLE: 1,
    ENABLE_FORMS: 2,
    ENABLE_STORAGE: 3,
  })) {
    if (pdfjs.AnnotationMode?.[name] !== value)
      throw new Error(`AnnotationMode.${name} is incompatible`);
  }

  function compatibilityPdf() {
    const objects = [
      "<</Type/Catalog/Pages 2 0 R/AcroForm 5 0 R/MarkInfo<</Marked true/UserProperties false/Suspects true>>>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]/Annots[7 0 R]>>",
      "<</Length 0>>stream\n\nendstream",
      "<</Fields[7 0 R]>>",
      "<</Producer(PDF.js compatibility qualification)/PhaseThreeCustom(qualified)>>",
      "<</Type/Annot/Subtype/Widget/FT/Tx/T(phase-field)/V(qualified)/Rect[4 4 68 20]/P 3 0 R>>",
    ];
    let source = "%PDF-1.7\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(new TextEncoder().encode(source).length);
      source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const startXref = new TextEncoder().encode(source).length;
    source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    source += offsets
      .slice(1)
      .map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
    source += `trailer<</Size ${objects.length + 1}/Root 1 0 R/Info 6 0 R>>\nstartxref\n${startXref}\n%%EOF`;
    return new TextEncoder().encode(source);
  }

  const pdf = compatibilityPdf();
  const task = pdfjs.getDocument({ data: pdf });
  try {
    const document = await task.promise;
    requireMethods(
      document,
      [
        "cleanup",
        "getAttachmentContent",
        "getAttachments",
        "getData",
        "getDestination",
        "getDestinations",
        "getFieldObjects",
        "getMarkInfo",
        "getMetadata",
        "getOptionalContentConfig",
        "getOutline",
        "getPage",
        "getPageIndex",
        "getPageLayout",
        "getPermissions",
        "saveDocument",
      ],
      "PDFDocumentProxy",
    );
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1)
      throw new Error("PDFDocumentProxy has an invalid numPages");
    for (const property of ["allXfaHtml", "annotationStorage", "fingerprints", "isPureXfa"]) {
      if (!(property in document)) throw new Error(`PDFDocumentProxy is missing ${property}`);
    }
    const fieldObjects = await document.getFieldObjects();
    if (!(fieldObjects instanceof Map) || !fieldObjects.has("phase-field")) {
      throw new Error("PDFDocumentProxy.getFieldObjects() must return a populated Map");
    }
    const { info } = await document.getMetadata();
    if (!(info?.Custom instanceof Map) || info.Custom.get("PhaseThreeCustom") !== "qualified") {
      throw new Error("PDFDocumentProxy.getMetadata() info.Custom must be a populated Map");
    }
    const markInfo = await document.getMarkInfo();
    if (
      !(markInfo instanceof Map) ||
      markInfo.get("Marked") !== true ||
      markInfo.get("Suspects") !== true
    ) {
      throw new Error("PDFDocumentProxy.getMarkInfo() must return a populated Map");
    }
    const permissions = await document.getPermissions();
    if (permissions !== null && !(permissions instanceof Set)) {
      throw new Error("PDFDocumentProxy.getPermissions() must return a Set or null");
    }
    const storage = document.annotationStorage;
    requireMethods(
      storage,
      [
        "getValue",
        "getRawValue",
        "has",
        "remove",
        "setValue",
        "resetModified",
        "resetModifiedIds",
        "updateEditor",
        "getEditor",
        Symbol.iterator,
      ],
      "AnnotationStorage",
    );
    for (const property of ["size", "print", "serializable", "editorStats", "modifiedIds"]) {
      if (!(property in storage)) throw new Error(`AnnotationStorage is missing ${property}`);
    }
    for (const slot of ["onSetModified", "onResetModified", "onAnnotationEditor"]) {
      let owner = storage;
      let descriptor;
      while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, slot)))
        owner = Object.getPrototypeOf(owner);
      if (!descriptor || (descriptor.writable !== true && typeof descriptor.set !== "function")) {
        throw new Error(`AnnotationStorage ${slot} is not writable`);
      }
    }
    for (const slot of ["onSetModified", "onResetModified"]) {
      const previous = storage[slot];
      const callback = () => {};
      storage[slot] = callback;
      if (storage[slot] !== callback) throw new Error(`AnnotationStorage ${slot} is not writable`);
      storage[slot] = previous;
      if (storage[slot] !== previous)
        throw new Error(`AnnotationStorage ${slot} is not restorable`);
    }
    const configuration = await document.getOptionalContentConfig({ intent: "display" });
    requireMethods(configuration.constructor, ["fromSerializable"], "OptionalContentConfig");
    requireMethods(
      configuration,
      ["getOrder", "getGroup", "setVisibility", "setOCGState", Symbol.iterator],
      "OptionalContentConfig.prototype",
    );
    if (!("serializable" in configuration))
      throw new Error("OptionalContentConfig is missing serializable");
    if (![...configuration].every(entry => Array.isArray(entry) && entry.length === 2))
      throw new Error("OptionalContentConfig iterator is incompatible");
    const clone = configuration.constructor.fromSerializable(configuration.serializable);
    if (!clone || typeof clone[Symbol.iterator] !== "function")
      throw new Error("OptionalContentConfig static clone is incompatible");
    const page = await document.getPage(1);
    requireMethods(
      page,
      [
        "cleanup",
        "getAnnotations",
        "getTextContent",
        "getViewport",
        "getXfa",
        "render",
        "streamTextContent",
      ],
      "PDFPageProxy",
    );
    if (!Number.isFinite(page.rotate)) throw new Error("PDFPageProxy has an invalid rotate value");
    const canvasContext = new Proxy(
      { canvas: { width: 1, height: 1 } },
      {
        get(target, property) {
          return property in target ? target[property] : () => {};
        },
      },
    );
    const renderTask = page.render({ canvasContext, viewport: page.getViewport({ scale: 1 }) });
    if (!renderTask?.promise || typeof renderTask.cancel !== "function")
      throw new Error("PDFPageProxy render task promise/cancel surface is incompatible");
    renderTask.cancel();
    await renderTask.promise.catch(() => {});
  } finally {
    await task.destroy();
  }

  console.log(
    `Installed pdfjs-dist ${version} ${variant} display, document, page, XFA, storage, and OCG capabilities are compatible.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
