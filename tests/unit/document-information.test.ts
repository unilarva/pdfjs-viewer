// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type * as PDFJS from "pdfjs-dist";
import {
  DocumentInformation,
  type DocumentInformationHost,
} from "../../src/document-information.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function hostFor(pdf: PDFJS.PDFDocumentProxy) {
  let activePdf = pdf;
  let generation = 1;
  let destroyed = false;
  let ready = true;
  let controller = new AbortController();
  const host: DocumentInformationHost = {
    get isDestroyed() {
      return destroyed;
    },
    get isReady() {
      return ready;
    },
    getPdf: () => activePdf,
    getDocumentGeneration: () => generation,
    getDocumentSignal: () => controller.signal,
    isCurrentDocument: (candidate, candidateGeneration) =>
      candidate === activePdf && candidateGeneration === generation,
  };
  return {
    host,
    cancel() {
      generation++;
      controller.abort();
      controller = new AbortController();
    },
    replace(nextPdf: PDFJS.PDFDocumentProxy) {
      generation++;
      controller.abort();
      controller = new AbortController();
      activePdf = nextPdf;
    },
    destroy() {
      destroyed = true;
      controller.abort();
    },
    setReady(value: boolean) {
      ready = value;
    },
  };
}

test("normalizes PDF.js information and returns detached cached projections", async () => {
  let metadataReads = 0;
  const metadata = new Map<string, string | string[]>([
    ["dc:title", "XMP title"],
    ["dc:subject", ["one", "two"]],
  ]);
  const pdf = {
    numPages: 7,
    fingerprints: ["original-id", "modified-id"],
    isPureXfa: false,
    async getMetadata() {
      metadataReads++;
      return {
        info: {
          PDFFormatVersion: "1.7",
          Language: "en-GB",
          EncryptFilterName: "Standard",
          IsLinearized: true,
          IsAcroFormPresent: true,
          IsXFAPresent: false,
          IsCollectionPresent: true,
          IsSignaturesPresent: true,
          Title: "Info title",
          Author: "Author",
          Subject: "Subject",
          Keywords: "alpha, beta",
          Creator: "Creator",
          Producer: "Producer",
          CreationDate: "D:20260102030405Z",
          ModDate: "D:20260203040506+02'00'",
          Trapped: { name: "False" },
          Custom: new Map<string, unknown>([
            ["Text", "value"],
            ["Number", 42],
            ["Boolean", true],
            ["Name", { name: "Named" }],
            ["Ignored", {}],
          ]),
        },
        metadata,
      };
    },
    async getPermissions() {
      return new Set([0x04, 0x10, 0x200, 0x800]);
    },
    async getMarkInfo() {
      return new Map([
        ["Marked", true],
        ["UserProperties", false],
        ["Suspects", true],
      ]);
    },
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(pdf);
  const information = new DocumentInformation();

  const [first, concurrent] = await Promise.all([
    information.getInformation(lifecycle.host),
    information.getInformation(lifecycle.host),
  ]);
  assert.equal(metadataReads, 1);
  assert.equal(first.ok, true);
  assert.equal(concurrent.ok, true);
  if (!first.ok || !concurrent.ok) return;
  assert.deepEqual(
    {
      ...first.information,
      custom: { ...first.information.custom },
      metadata: { ...first.information.metadata },
    },
    {
      pageCount: 7,
      fingerprints: { original: "original-id", modified: "modified-id" },
      pdfFormatVersion: "1.7",
      language: "en-GB",
      encryptionFilterName: "Standard",
      isLinearized: true,
      title: "Info title",
      author: "Author",
      subject: "Subject",
      keywords: "alpha, beta",
      creator: "Creator",
      producer: "Producer",
      creationDate: "D:20260102030405Z",
      modificationDate: "D:20260203040506+02'00'",
      trapped: "False",
      custom: { Text: "value", Number: 42, Boolean: true, Name: "Named" },
      metadata: { "dc:title": "XMP title", "dc:subject": ["one", "two"] },
      permissions: ["print", "copy", "copy-for-accessibility", "print-high-quality"],
      hasAcroForm: true,
      hasXfa: false,
      isPureXfa: false,
      formPresentation: "acroform",
      hasCollection: true,
      hasSignatures: true,
      markInfo: { marked: true, userProperties: false, suspects: true },
    },
  );
  assert.notEqual(first.information, concurrent.information);
  assert.notEqual(first.information.metadata, concurrent.information.metadata);
  assert.equal(Object.getPrototypeOf(first.information.custom), null);
  assert.equal(Object.getPrototypeOf(first.information.metadata), null);
  (first.information.metadata["dc:subject"] as string[])[0] = "changed";
  const later = await information.getInformation(lifecycle.host);
  assert.equal(later.ok && later.information.metadata["dc:subject"]?.[0], "one");
  assert.equal(metadataReads, 1);
});

test("reports lifecycle and read failures through structured query results", async () => {
  const gate = deferred<{ info: object; metadata: Map<string, string> }>();
  const pdf = {
    numPages: 1,
    fingerprints: ["id", null],
    isPureXfa: false,
    getMetadata: () => gate.promise,
    getPermissions: async () => null,
    getMarkInfo: async () => null,
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(pdf);
  const information = new DocumentInformation();
  lifecycle.setReady(false);
  assert.deepEqual(await information.getInformation(lifecycle.host), {
    ok: false,
    reason: "not-ready",
  });
  lifecycle.setReady(true);
  const pending = information.getInformation(lifecycle.host);
  lifecycle.cancel();
  assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
  gate.resolve({ info: {}, metadata: new Map() });
  await information.preparation;

  let failedMetadataReads = 0;
  const failingPdf = {
    numPages: 1,
    fingerprints: ["id", null],
    isPureXfa: false,
    getMetadata: async () => {
      failedMetadataReads++;
      throw new Error("metadata failed");
    },
    getPermissions: async () => null,
    getMarkInfo: async () => null,
  } as unknown as PDFJS.PDFDocumentProxy;
  const failingLifecycle = hostFor(failingPdf);
  const failingInformation = new DocumentInformation();
  const failed = await failingInformation.getInformation(failingLifecycle.host);
  assert.equal(failed.ok, false);
  assert.equal(!failed.ok && failed.reason, "error");
  assert.match(
    String(!failed.ok && failed.reason === "error" ? failed.error : ""),
    /metadata failed/,
  );
  const retried = await failingInformation.getInformation(failingLifecycle.host);
  assert.equal(!retried.ok && retried.reason, "error");
  assert.equal(failedMetadataReads, 1);

  lifecycle.destroy();
  assert.deepEqual(await information.getInformation(lifecycle.host), {
    ok: false,
    reason: "destroyed",
  });
});

test("late old-document settlement cannot replace a successor result", async () => {
  const firstGate = deferred<{ info: object; metadata: Map<string, string> }>();
  const secondGate = deferred<{ info: object; metadata: Map<string, string> }>();
  const makePdf = (id: string, gate: typeof firstGate) =>
    ({
      numPages: 1,
      fingerprints: [id, null],
      isPureXfa: false,
      getMetadata: () => gate.promise,
      getPermissions: async () => null,
      getMarkInfo: async () => null,
    }) as unknown as PDFJS.PDFDocumentProxy;
  const firstPdf = makePdf("first", firstGate);
  const secondPdf = makePdf("second", secondGate);
  const lifecycle = hostFor(firstPdf);
  const information = new DocumentInformation();

  const firstQuery = information.getInformation(lifecycle.host);
  const firstPreparation = information.preparation;
  lifecycle.replace(secondPdf);
  information.reset();
  const secondQuery = information.getInformation(lifecycle.host);
  const secondPreparation = information.preparation;

  assert.deepEqual(await firstQuery, { ok: false, reason: "cancelled" });
  firstGate.resolve({ info: { Title: "First" }, metadata: new Map() });
  await firstPreparation;
  assert.equal(information.preparation, secondPreparation);
  secondGate.resolve({ info: { Title: "Second" }, metadata: new Map() });
  const second = await secondQuery;
  assert.equal(second.ok && second.information.title, "Second");
  const cached = await information.getInformation(lifecycle.host);
  assert.equal(cached.ok && cached.information.fingerprints.original, "second");
});

test("a rejected read waits for uncancellable sibling reads before settling", async () => {
  const permissionsGate = deferred<null>();
  const pdf = {
    numPages: 1,
    fingerprints: ["id", null],
    isPureXfa: false,
    getMetadata: async () => {
      throw new Error("metadata failed");
    },
    getPermissions: () => permissionsGate.promise,
    getMarkInfo: async () => null,
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(pdf);
  const information = new DocumentInformation();
  let settled = false;
  const query = information.getInformation(lifecycle.host).then(result => {
    settled = true;
    return result;
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.notEqual(information.preparation, null);
  permissionsGate.resolve(null);
  const result = await query;
  assert.equal(!result.ok && result.reason, "error");
  assert.equal(information.preparation, null);
});
