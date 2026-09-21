// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePrintOptions,
  normalizePrintDefaults,
  pdfjsDocumentLoadOptions,
  validateDocumentOptions,
} from "../../src/viewer-options.js";
import {
  validatePdfjsDocumentCapabilities,
  validatePdfjsDisplayCapabilities,
} from "../../src/pdfjs-compatibility.js";
import { normalizeDeviceCompatibilityRules } from "../../src/device-compatibility.js";

function annotationStorage() {
  return {
    onSetModified: null,
    onResetModified: null,
    onAnnotationEditor: null,
    getValue() {},
    getRawValue() {},
    has() {},
    remove() {},
    setValue() {},
    resetModified() {},
    resetModifiedIds() {},
    updateEditor() {},
    getEditor() {},
    size: 0,
    print: {},
    serializable: {},
    editorStats: {},
    modifiedIds: new Set(),
    *[Symbol.iterator]() {
      /* Empty qualified storage fixture. */
    },
  };
}

test("host device compatibility rules validate, detach, and freeze records", () => {
  const source = [
    {
      engine: "chromium",
      platform: "desktop",
      operatingSystem: "linux",
      nativePrintSupport: "portrait-and-landscape",
      evidenceId: " audit-42 ",
    },
  ] as const;
  const normalized = normalizeDeviceCompatibilityRules(source);
  assert.deepEqual(normalized, [
    {
      engine: "chromium",
      platform: "desktop",
      operatingSystem: "linux",
      nativePrintSupport: "portrait-and-landscape",
      evidenceId: "audit-42",
    },
  ]);
  assert.notEqual(normalized[0], source[0]);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized[0]));

  const invalid: unknown[] = [
    {},
    [{ engine: "unknown", nativePrintSupport: "portrait" }],
    [{ engine: "chromium", platform: "console", nativePrintSupport: "portrait" }],
    [{ engine: "chromium", operatingSystem: "plan9", nativePrintSupport: "portrait" }],
    [{ engine: "chromium", nativePrintSupport: "portrait", evidenceId: " " }],
    [
      {
        engine: "chromium",
        platform: "desktop",
        operatingSystem: "android",
        nativePrintSupport: "portrait",
      },
    ],
    [{ engine: "chromium", nativePrintSupport: "portrait", extra: true }],
    [
      { engine: "chromium", nativePrintSupport: "portrait", evidenceId: "x" },
      { engine: "chromium", nativePrintSupport: "portrait-and-landscape", evidenceId: "y" },
    ],
    [
      { engine: "chromium", nativePrintSupport: "portrait", evidenceId: "x" },
      { engine: "firefox", nativePrintSupport: "portrait", evidenceId: "x" },
    ],
  ];
  for (const value of invalid) assert.throws(() => normalizeDeviceCompatibilityRules(value));
});

test("print options normalize defaults and merge ordered adjacent ranges", () => {
  const signal = new AbortController().signal;
  const normalized = normalizePrintOptions(
    {
      pages: [
        { from: 7, to: 8 },
        { from: 2, to: 4 },
        { from: 4, to: 6 },
      ],
      layout: { mode: "spread", firstPageSide: "right", gapPt: 6 },
      quality: { dpi: 300 },
      sheet: { width: 297, height: 210, unit: "mm" },
      pageScaling: "shrink-to-fit",
      orientation: "landscape",
      signal,
    },
    10,
  );

  assert.deepEqual(normalized.pages, [{ from: 2, to: 8 }]);
  assert.deepEqual(normalized.layout, { mode: "spread", firstPageSide: "right", gapPt: 6 });
  assert.deepEqual(normalized.quality, { dpi: 300 });
  assert.deepEqual(normalized.sheet, { width: 297, height: 210, unit: "mm" });
  assert.equal(normalized.pageScaling, "shrink-to-fit");
  assert.equal(normalized.orientation, "landscape");
  assert.equal(normalized.signal, signal);
  assert.ok(Object.isFrozen(normalized));

  assert.deepEqual(normalizePrintOptions(undefined, 3), {
    pages: "all",
    layout: { mode: "auto" },
    quality: { dpi: 300 },
    sheet: "a4",
    pageScaling: "fit",
    orientation: "auto",
  });
});

test("configured print defaults are detached, frozen, and overridden per call", () => {
  const source = {
    sheet: "letter",
    pageScaling: "shrink-to-fit",
    orientation: "landscape",
    quality: { dpi: 600 },
  } as const;
  const defaults = normalizePrintDefaults(source);
  assert.deepEqual(normalizePrintOptions(undefined, 3, defaults), {
    pages: "all",
    layout: { mode: "auto" },
    sheet: "letter",
    pageScaling: "shrink-to-fit",
    orientation: "landscape",
    quality: { dpi: 600 },
  });
  assert.deepEqual(
    normalizePrintOptions(
      { sheet: "legal", pageScaling: "fit", quality: { dpi: 144 } },
      3,
      defaults,
    ),
    {
      pages: "all",
      layout: { mode: "auto" },
      sheet: "legal",
      pageScaling: "fit",
      orientation: "landscape",
      quality: { dpi: 144 },
    },
  );
  assert.ok(Object.isFrozen(defaults));
  assert.ok(Object.isFrozen(defaults.quality));
  assert.throws(() => normalizePrintDefaults({ quality: { dpi: 150 as 300 } }), /300 or 600/);
  assert.throws(
    () => normalizePrintDefaults({ pageScaling: "actual" as never }),
    /fit or shrink-to-fit/,
  );
});

test("print options reject invalid ranges, layouts, sheets, and DPI", () => {
  assert.throws(() => normalizePrintOptions({ pages: [{ from: 4, to: 2 }] }, 5), /ordered range/);
  assert.throws(() => normalizePrintOptions({ pages: [{ from: 1, to: 6 }] }, 5), /within pages/);
  assert.throws(() => normalizePrintOptions({ layout: { mode: "spread", gapPt: -1 } }, 5), /gapPt/);
  assert.throws(() => normalizePrintOptions({ quality: { dpi: 71 } }, 5), /72 and 600/);
  assert.throws(() => normalizePrintOptions({ quality: { dpi: 601 } }, 5), /72 and 600/);
  assert.throws(() => normalizePrintOptions({ quality: "auto" as never }, 5), /must be an object/);
  assert.throws(
    () => normalizePrintOptions({ pageScaling: "actual" as never }, 5),
    /fit or shrink-to-fit/,
  );
  assert.throws(
    () => normalizePrintOptions({ sheet: { width: 0, height: 1, unit: "in" } }, 5),
    /width and height/,
  );
  assert.throws(() => normalizePrintOptions({ sheet: "A3" as never }, 5), /print\.sheet/);
  assert.throws(() => normalizePrintOptions({ sheet: "auto" as never }, 5), /print\.sheet/);
  assert.throws(() => normalizePrintOptions({ orientation: "square" as never }, 5), /orientation/);
  assert.throws(
    () =>
      normalizePrintOptions(
        {
          signal: {
            aborted: false,
            addEventListener() {},
            removeEventListener() {},
          } as never,
        },
        5,
      ),
    /must be an AbortSignal/,
  );
});

test("print options preserve every canonical sheet preset", () => {
  for (const sheet of ["a3", "a4", "a5", "letter", "legal"] as const) {
    assert.equal(normalizePrintOptions({ sheet }, 5).sheet, sheet);
  }
});

test("annotation capability validation requires PDF.js 6.3 display exports", () => {
  class AnnotationLayer {
    render() {}
    update() {}
    destroy() {}
  }
  class TextLayer {
    render() {}
    cancel() {}
  }
  class XfaLayer {
    static render() {}
    static update() {}
    static getPageViewport() {}
  }
  const valid = {
    AnnotationLayer,
    TextLayer,
    XfaLayer,
    AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
  };
  assert.doesNotThrow(() => validatePdfjsDisplayCapabilities(valid, { annotations: true }));
  assert.doesNotThrow(() =>
    validatePdfjsDisplayCapabilities(valid, { annotations: true, xfa: true }),
  );
  assert.throws(
    () =>
      validatePdfjsDisplayCapabilities(
        { ...valid, XfaLayer: undefined },
        { annotations: true, xfa: true },
      ),
    /XfaLayer/,
  );
  assert.throws(
    () =>
      validatePdfjsDisplayCapabilities(
        { AnnotationMode: valid.AnnotationMode },
        { annotations: true },
      ),
    /AnnotationLayer/,
  );
  assert.throws(
    () =>
      validatePdfjsDisplayCapabilities(
        {
          AnnotationLayer: valid.AnnotationLayer,
          AnnotationMode: { ...valid.AnnotationMode, ENABLE_FORMS: 1 },
        },
        { annotations: true },
      ),
    /AnnotationMode\.ENABLE_FORMS/,
  );
  assert.doesNotThrow(() =>
    validatePdfjsDisplayCapabilities(valid, { text: true, annotations: true, xfa: true }),
  );
  assert.throws(
    () => validatePdfjsDisplayCapabilities({ ...valid, TextLayer: class {} }, { text: true }),
    /TextLayer\.prototype.*render/,
  );
  assert.throws(
    () =>
      validatePdfjsDisplayCapabilities(
        { ...valid, AnnotationLayer: class {} },
        { annotations: true },
      ),
    /AnnotationLayer\.prototype.*render/,
  );
  assert.throws(
    () => validatePdfjsDisplayCapabilities({ ...valid, XfaLayer: class {} }, { xfa: true }),
    /XfaLayer.*render/,
  );
});

test("loaded document capability validation follows enabled feature surfaces", () => {
  const method = () => {};
  const valid = {
    cleanup: method,
    getData: method,
    getDestination: method,
    getDestinations: method,
    getMarkInfo: method,
    getMetadata: method,
    getOutline: method,
    getPage: method,
    getPageIndex: method,
    getPageLayout: method,
    getPermissions: method,
    getAttachmentContent: method,
    getAttachments: method,
    getFieldObjects: method,
    saveDocument: method,
    getOptionalContentConfig: method,
    numPages: 1,
    fingerprints: ["fingerprint"],
    isPureXfa: false,
    allXfaHtml: null,
    annotationStorage: annotationStorage(),
  };
  const all = { attachments: true, forms: true, layers: true, print: true };
  assert.doesNotThrow(() => validatePdfjsDocumentCapabilities(valid, all));
  assert.throws(
    () => validatePdfjsDocumentCapabilities({ ...valid, saveDocument: undefined }, all),
    /saveDocument/,
  );
  assert.throws(
    () => validatePdfjsDocumentCapabilities({ ...valid, getOptionalContentConfig: undefined }, all),
    /getOptionalContentConfig/,
  );
  assert.throws(
    () => validatePdfjsDocumentCapabilities({ ...valid, annotationStorage: undefined }, all),
    /annotationStorage/,
  );
  assert.throws(
    () => validatePdfjsDocumentCapabilities({ ...valid, numPages: 0 }, all),
    /numPages/,
  );
  assert.doesNotThrow(() =>
    validatePdfjsDocumentCapabilities(
      {
        ...valid,
        getAttachments: undefined,
        getAttachmentContent: undefined,
        getFieldObjects: undefined,
        saveDocument: undefined,
        getOptionalContentConfig: undefined,
        annotationStorage: undefined,
        allXfaHtml: undefined,
      },
      { attachments: false, forms: false, layers: false, print: false },
    ),
  );
});

test("PDF.js XFA loading is derived solely from form feature policy", () => {
  const passwordProvider = async () => "secret";
  const disabled = pdfjsDocumentLoadOptions({ passwordProvider, verbosity: 1 }, false);
  const enabled = pdfjsDocumentLoadOptions({ passwordProvider, verbosity: 1 }, true);
  assert.equal(disabled.passwordProvider, passwordProvider);
  assert.deepEqual(disabled.pdfjsOptions, { verbosity: 1, enableXfa: false });
  assert.deepEqual(enabled.pdfjsOptions, { verbosity: 1, enableXfa: true });
  assert.throws(() => pdfjsDocumentLoadOptions({ enableXfa: true } as never, false), /enableXfa/);
});

test("document options validate every supported runtime value", () => {
  assert.doesNotThrow(() =>
    validateDocumentOptions({
      httpHeaders: { Authorization: "Bearer token", "X-Custom": "" },
      withCredentials: true,
      password: "",
      passwordProvider: () => null,
      rangeChunkSize: 65_536,
      disableRange: false,
      disableStream: true,
      disableAutoFetch: false,
      docBaseUrl: "https://example.test/doc/",
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      iccUrl: "/icc/",
      standardFontDataUrl: "/fonts/",
      wasmUrl: "/wasm/",
      useWorkerFetch: true,
      useWasm: true,
      useSystemFonts: false,
      disableFontFace: false,
      stopAtErrors: false,
      maxImageSize: -1,
      verbosity: 5,
    }),
  );

  const invalid: Array<[Record<string, unknown>, RegExp]> = [
    [{ httpHeaders: [] }, /httpHeaders/],
    [{ httpHeaders: { "Bad Header": "value" } }, /header name/],
    [{ httpHeaders: { Good: "value\r\ninjected: true" } }, /without line breaks/],
    [{ withCredentials: 1 }, /withCredentials/],
    [{ password: 1 }, /password/],
    [{ passwordProvider: "callback" }, /passwordProvider/],
    [{ rangeChunkSize: 1.5 }, /rangeChunkSize/],
    [{ disableRange: "false" }, /disableRange/],
    [{ disableStream: 0 }, /disableStream/],
    [{ disableAutoFetch: null }, /disableAutoFetch/],
    [{ docBaseUrl: " " }, /docBaseUrl/],
    [{ cMapUrl: 1 }, /cMapUrl/],
    [{ cMapPacked: "true" }, /cMapPacked/],
    [{ iccUrl: "" }, /iccUrl/],
    [{ standardFontDataUrl: false }, /standardFontDataUrl/],
    [{ wasmUrl: "" }, /wasmUrl/],
    [{ cMapUrl: "/cmaps" }, /cMapUrl.*slash/],
    [{ iccUrl: "/icc" }, /iccUrl.*slash/],
    [{ standardFontDataUrl: "/fonts" }, /standardFontDataUrl.*slash/],
    [{ wasmUrl: "/wasm" }, /wasmUrl.*slash/],
    [{ useWorkerFetch: 1 }, /useWorkerFetch/],
    [{ useWasm: null }, /useWasm/],
    [{ useSystemFonts: "yes" }, /useSystemFonts/],
    [{ disableFontFace: 0 }, /disableFontFace/],
    [{ stopAtErrors: "no" }, /stopAtErrors/],
    [{ maxImageSize: -2 }, /maxImageSize/],
    [{ verbosity: 2 }, /verbosity/],
  ];
  for (const [options, expected] of invalid) {
    assert.throws(() => validateDocumentOptions(options as never), expected);
  }
});
