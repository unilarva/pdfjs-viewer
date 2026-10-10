// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPdfjsCssCompatibility } from "./pdfjs-css-compatibility.mjs";
import { parseExactPdfjsVersionUnion } from "./pdfjs-version-manifest.mjs";
import { makeHintedFontPdf } from "./hinted-font-fixture.mjs";

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
  // Node 22/24 lack Math.sumPrecise used by actual TrueType conversion. Reuse
  // the candidate legacy build's standards polyfill; still test the selected
  // display module/worker below, rather than substituting a mock font path.
  if (typeof Math.sumPrecise !== "function") {
    await import(
      pathToFileURL(resolve(workspace, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href
    );
  }
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
    const contents = "0.5 g";
    const objects = [
      "<</Type/Catalog/Pages 2 0 R/AcroForm 5 0 R/MarkInfo<</Marked true/UserProperties false/Suspects true>>>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]/Contents 4 0 R/Annots[7 0 R]>>",
      `<</Length ${contents.length}>>stream\n${contents}\nendstream`,
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
    const canvas = { width: 72, height: 72, getContext: () => canvasContext };
    const canvasContext = new Proxy(
      { canvas, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      {
        get(target, property) {
          return property in target ? target[property] : () => {};
        },
      },
    );
    if (
      !Number.isSafeInteger(pdfjs.OPS?.beginAnnotation) ||
      !Number.isSafeInteger(pdfjs.OPS?.endAnnotation)
    ) {
      throw new Error("PDF.js annotation operation filtering contract is incompatible");
    }
    let filteredOperations = 0;
    const renderTask = page.render({
      canvas,
      canvasContext,
      viewport: page.getViewport({ scale: 1 }),
      operationsFilter: (index, operatorList) => {
        if (
          !Number.isInteger(index) ||
          !Array.isArray(operatorList?.fnArray) ||
          !Array.isArray(operatorList?.argsArray) ||
          index >= operatorList.fnArray.length
        ) {
          throw new Error("PDF.js operation filter must expose the display operator list");
        }
        filteredOperations++;
        return false;
      },
    });
    if (!renderTask?.promise || typeof renderTask.cancel !== "function")
      throw new Error("PDFPageProxy render task promise/cancel surface is incompatible");
    await renderTask.promise;
    if (filteredOperations === 0) throw new Error("PDF.js operation filtering was not exercised");
    const cancelledRender = page.render({
      canvas,
      canvasContext,
      viewport: page.getViewport({ scale: 1 }),
    });
    cancelledRender.cancel();
    await cancelledRender.promise.catch(() => {});
  } finally {
    await task.destroy();
  }

  // Use the candidate's own font asset and worker, not the checkout dependency.
  // A real populated font catches drift hidden by an empty collection or mock.
  if (pdfjs.OPS?.setFont !== 37) throw new Error("PDF.js geometric font setFont opcode changed");
  const fontPdf = await makeHintedFontPdf(
    "transparent",
    resolve(workspace, "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
  );
  const fontTask = pdfjs.getDocument({
    data: new Uint8Array(fontPdf),
    disableFontFace: false,
    fontExtraProperties: true,
    useSystemFonts: false,
  });
  try {
    const document = await fontTask.promise;
    const page = await document.getPage(1);
    requireMethods(page, ["getOperatorList"], "Geometric-font PDFPageProxy");
    requireMethods(page.commonObjs, ["get"], "Geometric-font shared object pool");
    const operators = await page.getOperatorList({
      intent: "display",
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
    });
    const ids = new Set(
      operators.argsArray
        .filter((_, index) => operators.fnArray[index] === pdfjs.OPS.setFont)
        .map(args => args[0]),
    );
    if (ids.size === 0)
      throw new Error("Embedded-font qualification did not expose font dependencies");
    for (const id of ids) {
      const font = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("PDF.js shared font callback did not settle")),
          10_000,
        );
        try {
          page.commonObjs.get(id, value => {
            clearTimeout(timeout);
            resolve(value);
          });
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
      if (
        typeof font?.loadedName !== "string" ||
        !font.loadedName ||
        font.disableFontFace ||
        !ArrayBuffer.isView(font.data) ||
        font.data.byteLength < 12
      ) {
        throw new Error("PDF.js retained native font family/data/callback contract changed");
      }
      const data = new DataView(font.data.buffer, font.data.byteOffset, font.data.byteLength);
      if (data.getUint32(0) !== 0x00010000)
        throw new Error("Embedded TrueType data was cleared or changed format");
    }

    const transport = page._transport;
    const originalFactory = transport?.canvasFactory;
    requireMethods(
      originalFactory,
      ["create", "reset", "destroy"],
      "Geometric-font canvas factory",
    );
    let creates = 0;
    const entry = (width, height) => {
      const canvas = { width, height };
      const context = new Proxy(
        { canvas, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
        {
          get: (target, key) => (key in target ? target[key] : () => {}),
        },
      );
      canvas.getContext = () => context;
      return { canvas, context };
    };
    const capturedFactory = {
      create(width, height) {
        creates++;
        return entry(width, height);
      },
      reset(target, width, height) {
        target.canvas.width = width;
        target.canvas.height = height;
      },
      destroy(target) {
        target.canvas.width = target.canvas.height = 0;
        target.canvas = target.context = null;
      },
    };
    const root = entry(612, 792);
    let render;
    try {
      transport.canvasFactory = capturedFactory;
      if (transport.canvasFactory !== capturedFactory)
        throw new Error("PDF.js canvas factory is not writable");
      render = page.render({
        canvas: null,
        canvasContext: root.context,
        viewport: page.getViewport({ scale: 1 }),
        operationsFilter: () => false,
      });
    } finally {
      transport.canvasFactory = originalFactory;
    }
    if (transport.canvasFactory !== originalFactory)
      throw new Error("PDF.js canvas factory is not restorable");
    await render.promise;
    if (creates === 0)
      throw new Error(
        "PDF.js no longer captures the scoped factory before async transparent drawing",
      );
  } finally {
    await fontTask.destroy();
  }

  console.log(
    `Installed pdfjs-dist ${version} ${variant} display, document, page, XFA, storage, OCG, retained-font, and scoped-canvas contracts are compatible.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
