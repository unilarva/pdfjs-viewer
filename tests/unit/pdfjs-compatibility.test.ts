// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOTATION_STORAGE_CAPABILITIES,
  asPdfjsAnnotationStorage,
  assertAnnotationStorage,
  clonePdfjsOptionalContentConfig,
  createPdfjsAnnotationLayer,
  getPdfjsMarkInfo,
  getPdfjsXfaPageViewport,
  installAnnotationStorageCallbacks,
  readPdfjsWorkerPort,
  renderPdfjsAnnotationLayer,
  renderPdfjsXfaLayer,
  startPdfPageRenderTask,
  updatePdfjsAnnotationLayer,
  updatePdfjsXfaLayer,
  validatePdfjsDisplayCapabilities,
  validatePdfjsDocumentCapabilities,
  writePdfjsWorkerPort,
} from "../../src/pdfjs-compatibility.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function storage() {
  const values = new Map<string, object>();
  return {
    onSetModified: null as (() => void) | null,
    onResetModified: null as (() => void) | null,
    onAnnotationEditor: null,
    getValue: (id: string, fallback: object) => values.get(id) ?? fallback,
    getRawValue: (id: string) => values.get(id),
    has: (id: string) => values.has(id),
    remove: (id: string) => values.delete(id),
    setValue: (id: string, value: object) => values.set(id, value),
    resetModified() {},
    resetModifiedIds() {},
    updateEditor() {},
    getEditor() {},
    get size() {
      return values.size;
    },
    get print() {
      return {};
    },
    get serializable() {
      return {};
    },
    get editorStats() {
      return {};
    },
    get modifiedIds() {
      return new Set();
    },
    *[Symbol.iterator]() {
      yield* values;
    },
  };
}

test("reports capability-specific qualified incompatibilities", () => {
  assert.throws(
    () => validatePdfjsDisplayCapabilities({}, { text: true }),
    /qualified contract \(6\.3\.289\) display module is missing TextLayer/,
  );
  assert.throws(
    () =>
      validatePdfjsDocumentCapabilities(
        {},
        { attachments: false, forms: false, layers: false, print: false },
      ),
    /qualified contract \(6\.3\.289\) PDFDocumentProxy is missing cleanup\(\)/,
  );
  const candidate = storage();
  delete (candidate as Partial<typeof candidate>).getEditor;
  assert.throws(
    () => assertAnnotationStorage(candidate as never),
    /qualified contract \(6\.3\.289\) AnnotationStorage is missing getEditor\(\)/,
  );
  assert.equal(ANNOTATION_STORAGE_CAPABILITIES.includes("setValue"), true);
  const methods = [
    "cleanup",
    "getData",
    "getDestination",
    "getDestinations",
    "getMarkInfo",
    "getMetadata",
    "getOutline",
    "getPage",
    "getPageIndex",
    "getPageLayout",
    "getPermissions",
    "getOptionalContentConfig",
  ];
  const document = Object.fromEntries(methods.map(method => [method, () => {}])) as Record<
    string,
    unknown
  >;
  Object.assign(document, {
    numPages: 1,
    fingerprints: ["fixture"],
    isPureXfa: false,
    annotationStorage: {},
  });
  assert.throws(
    () =>
      validatePdfjsDocumentCapabilities(document, {
        attachments: false,
        forms: false,
        layers: false,
        print: true,
      }),
    /AnnotationStorage is missing getValue\(\)/,
  );
  document.annotationStorage = { ...storage(), print: undefined };
  assert.throws(
    () =>
      validatePdfjsDocumentCapabilities(document, {
        attachments: false,
        forms: false,
        layers: false,
        print: true,
      }),
    /AnnotationStorage is missing print storage/,
  );
});

test("annotation callbacks are installed and restored, and generated adapters are validated", () => {
  const source = storage();
  let previousCalls = 0;
  const previous = () => {
    previousCalls++;
  };
  source.onSetModified = previous;
  let observed = 0;
  const release = installAnnotationStorageCallbacks(source as never, () => {
    observed++;
  });
  source.onSetModified?.();
  assert.equal(observed, 1);
  assert.equal(previousCalls, 1);
  release();
  assert.equal(source.onSetModified, previous);
  const releaseOwned = installAnnotationStorageCallbacks(source as never, () => {});
  const replacement = () => {};
  source.onSetModified = replacement;
  releaseOwned();
  assert.equal(source.onSetModified, replacement);
  assert.equal(asPdfjsAnnotationStorage(source as never), source);
  assert.throws(() => asPdfjsAnnotationStorage({}), /AnnotationStorage is missing getValue\(\)/);
});

test("rejects annotation callback slots that cannot be restored", () => {
  const source = storage();
  Object.defineProperty(source, "onSetModified", { get: () => null, configurable: true });
  assert.throws(
    () => installAnnotationStorageCallbacks(source as never, () => {}),
    /qualified contract \(6\.3\.289\) AnnotationStorage.*callback slots/,
  );
  const editorSource = storage();
  Object.defineProperty(editorSource, "onAnnotationEditor", {
    value: null,
    writable: false,
    configurable: true,
  });
  assert.throws(
    () => assertAnnotationStorage(editorSource as never),
    /AnnotationStorage is missing writable onAnnotationEditor/,
  );
});

test("clones optional-content configurations only through the static qualified surface", () => {
  const source = {
    constructor: {
      fromSerializable(value: unknown) {
        return { copied: value };
      },
    },
  };
  assert.deepEqual(clonePdfjsOptionalContentConfig({ layers: [] }, source), {
    copied: { layers: [] },
  });
  assert.throws(
    () => clonePdfjsOptionalContentConfig({}, {}),
    /qualified contract \(6\.3\.289\) OptionalContentConfig is missing fromSerializable\(\)/,
  );
});

test("contains the qualified getMarkInfo declaration mismatch in the compatibility boundary", async () => {
  const markInfo = new Map([
    ["Marked", true],
    ["UserProperties", false],
    ["Suspects", false],
  ] as const);
  const pdf = {
    getMarkInfo: async () => markInfo,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy;
  assert.equal(await getPdfjsMarkInfo(pdf), markInfo);
});

test("forwards annotation and XFA invocation boundaries", async () => {
  const calls: unknown[] = [];
  class AnnotationLayer {
    constructor(parameters: unknown) {
      calls.push(parameters);
    }
    async render(parameters: unknown) {
      calls.push(parameters);
    }
    update(parameters: unknown) {
      calls.push(parameters);
    }
    destroy() {}
  }
  const annotation = createPdfjsAnnotationLayer(AnnotationLayer, { construction: true } as never);
  await renderPdfjsAnnotationLayer(annotation, { render: true } as never);
  updatePdfjsAnnotationLayer(annotation, { update: true } as never);
  const xfa = {
    render(parameters: unknown) {
      calls.push(parameters);
    },
    update(parameters: unknown) {
      calls.push(parameters);
    },
    getPageViewport(html: unknown, parameters: unknown) {
      calls.push({ html, parameters });
      return { width: 1, height: 2 };
    },
  };
  renderPdfjsXfaLayer(xfa, { render: true } as never);
  updatePdfjsXfaLayer(xfa, { update: true } as never);
  assert.deepEqual(getPdfjsXfaPageViewport(xfa, { node: true }, { scale: 1, rotation: 0 }), {
    width: 1,
    height: 2,
  });
  assert.equal(calls.length, 6);
});

test("reads and mutates workerPort only through tolerant compatibility access", () => {
  const worker = { postMessage() {}, terminate() {} } as unknown as Worker;
  const globals: { workerPort?: Worker | null } = {};
  assert.deepEqual(readPdfjsWorkerPort(globals), { present: false, value: undefined });
  assert.equal(writePdfjsWorkerPort(globals, worker), false);
  globals.workerPort = null;
  assert.equal(readPdfjsWorkerPort(globals).value, null);
  assert.equal(writePdfjsWorkerPort(globals, worker), true);
  assert.equal(globals.workerPort, worker);
  assert.equal(writePdfjsWorkerPort(globals, undefined), true);
  assert.equal(globals.workerPort, undefined);
});

test("starts the exact render task synchronously and preserves abort settlement semantics", async () => {
  const pending = deferred<void>();
  let cancels = 0;
  const task = {
    promise: pending.promise,
    cancel: () => {
      cancels++;
      pending.reject(new Error("cancelled"));
    },
  } as import("pdfjs-dist").RenderTask;
  const page = { render: () => task } as unknown as import("pdfjs-dist").PDFPageProxy;
  const controller = new AbortController();
  const render = startPdfPageRenderTask(
    page,
    {} as Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0],
    controller.signal,
  );
  assert.equal(render.task, task);
  controller.abort();
  controller.abort();
  assert.equal(cancels, 1);
  await assert.rejects(render.promise, { name: "AbortError" });
  const already = new AbortController();
  already.abort();
  assert.throws(
    () =>
      startPdfPageRenderTask(
        page,
        {} as Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0],
        already.signal,
      ),
    { name: "AbortError" },
  );
});

test("preserves genuine render failures", async () => {
  const pending = deferred<void>();
  const failure = new Error("render failed");
  const task = { promise: pending.promise, cancel() {} } as import("pdfjs-dist").RenderTask;
  const page = { render: () => task } as unknown as import("pdfjs-dist").PDFPageProxy;
  const render = startPdfPageRenderTask(
    page,
    {} as Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0],
  );
  pending.reject(failure);
  await assert.rejects(render.promise, error => error === failure);
});

test("removes abort wiring after physical render settlement", async () => {
  const pending = deferred<void>();
  let cancels = 0;
  const task = {
    promise: pending.promise,
    cancel: () => {
      cancels++;
    },
  } as import("pdfjs-dist").RenderTask;
  const page = { render: () => task } as unknown as import("pdfjs-dist").PDFPageProxy;
  const controller = new AbortController();
  const render = startPdfPageRenderTask(
    page,
    {} as Parameters<import("pdfjs-dist").PDFPageProxy["render"]>[0],
    controller.signal,
  );
  pending.resolve();
  await render.promise;
  controller.abort();
  assert.equal(cancels, 0);
});
