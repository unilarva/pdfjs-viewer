// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type * as PDFJS from "pdfjs-dist";
import {
  DocumentAttachments,
  type DocumentAttachmentsHost,
} from "../../src/document-attachments.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function hostFor(pdf: PDFJS.PDFDocumentProxy) {
  let activePdf = pdf;
  let generation = 1;
  let destroyed = false;
  let ready = true;
  let enabled = true;
  let controller = new AbortController();
  const host: DocumentAttachmentsHost = {
    get attachmentsEnabled() {
      return enabled;
    },
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
    setEnabled(value: boolean) {
      enabled = value;
    },
  };
}

test("normalizes safe detached metadata while preserving opaque IDs and duplicate names", async () => {
  let metadataReads = 0;
  const pdf = {
    async getAttachments() {
      metadataReads++;
      return new Map([
        [
          "opaque/a",
          {
            filename: "C:\\private\\same\u202e.txt",
            rawFilename: "do-not-use.exe",
            description: "  First  ",
          },
        ],
        ["opaque/b", { filename: "/tmp/same.txt", rawFilename: "ignored", description: "  " }],
        [
          "opaque/c",
          {
            filename: "folder/\u0000\u0085",
            rawFilename: "secret.txt",
            description: "Description",
          },
        ],
      ]);
    },
    async getAttachmentContent() {
      return null;
    },
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(pdf);
  const attachments = new DocumentAttachments();

  const first = await attachments.getAttachments(lifecycle.host);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.attachments, [
    { id: "opaque/a", filename: "same.txt", description: "First" },
    { id: "opaque/b", filename: "same.txt", description: null },
    { id: "opaque/c", filename: "attachment.bin", description: "Description" },
  ]);
  assert.equal(metadataReads, 1);
  assert.equal(Object.isFrozen((await attachments.prepare(lifecycle.host)).items[0]), true);

  (first.attachments as { filename: string }[])[0]!.filename = "changed";
  const later = await attachments.getAttachments(lifecycle.host);
  assert.equal(later.ok && later.attachments[0]?.filename, "same.txt");
  assert.notEqual(later.ok && later.attachments, first.attachments);
  assert.equal(metadataReads, 1);
});

test("loads exact bytes lazily, joins concurrent reads, and drops settled byte work", async () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  const content = deferred<Uint8Array | null>();
  const requestedIds: string[] = [];
  const pdf = {
    async getAttachments() {
      return new Map([
        [
          "id:exact",
          {
            filename: "bytes.bin",
            rawFilename: "bytes.bin",
            description: "",
            content: new Uint8Array([9]),
          },
        ],
      ]);
    },
    getAttachmentContent(id: string) {
      requestedIds.push(id);
      return content.promise;
    },
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(pdf);
  const attachments = new DocumentAttachments();

  const metadata = await attachments.getAttachments(lifecycle.host);
  assert.equal(metadata.ok, true);
  assert.deepEqual(requestedIds, []);
  const first = attachments.getContent(lifecycle.host, "id:exact");
  const concurrent = attachments.getContent(lifecycle.host, "id:exact");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requestedIds, ["id:exact"]);
  assert.equal(attachments.settlements.length, 1);
  content.resolve(bytes);
  const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
  assert.equal(firstResult.status, "ready");
  assert.equal(concurrentResult.status, "ready");
  if (firstResult.status === "ready" && concurrentResult.status === "ready") {
    assert.deepEqual(firstResult.content, bytes);
    assert.deepEqual(concurrentResult.content, bytes);
    assert.notEqual(firstResult.attachment, concurrentResult.attachment);
  }
  assert.equal(attachments.settlements.length, 0);

  const secondContent = deferred<Uint8Array | null>();
  (pdf.getAttachmentContent as unknown as (id: string) => Promise<Uint8Array | null>) = (
    id: string,
  ) => {
    (requestedIds as string[]).push(id);
    return secondContent.promise;
  };
  const second = attachments.getContent(lifecycle.host, "id:exact");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requestedIds, ["id:exact", "id:exact"]);
  secondContent.resolve(null);
  assert.deepEqual(await second, { status: "unavailable" });
  assert.deepEqual(await attachments.getContent(lifecycle.host, "missing"), {
    status: "not-found",
  });
});

test("public cancellation is prompt while stale PDF.js reads remain settlements", async () => {
  const metadata = deferred<Map<
    string,
    { filename: string; rawFilename: string; description: string }
  > | null>();
  const firstPdf = {
    getAttachments: () => metadata.promise,
    async getAttachmentContent() {
      return null;
    },
  } as unknown as PDFJS.PDFDocumentProxy;
  const secondPdf = {
    async getAttachments() {
      return new Map([["new", { filename: "new.txt", rawFilename: "new.txt", description: "" }]]);
    },
    async getAttachmentContent() {
      return null;
    },
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(firstPdf);
  const attachments = new DocumentAttachments();

  const query = attachments.getAttachments(lifecycle.host);
  const stalePreparation = attachments.preparation;
  await Promise.resolve();
  assert.equal(attachments.settlements.length, 1);
  const staleSettlements = attachments.settlements;
  lifecycle.replace(secondPdf);
  attachments.reset();
  assert.deepEqual(await query, { ok: false, reason: "cancelled" });
  assert.equal(attachments.settlements.length, 0);

  const successor = attachments.getAttachments(lifecycle.host);
  metadata.resolve(
    new Map([["old", { filename: "old.txt", rawFilename: "old.txt", description: "" }]]),
  );
  await Promise.all([stalePreparation, ...staleSettlements]);
  const result = await successor;
  assert.equal(result.ok && result.attachments[0]?.id, "new");
  assert.equal(attachments.settlements.length, 0);
});

test("content cancellation cannot publish a late read into a successor lifecycle", async () => {
  const content = deferred<Uint8Array | null>();
  const pdf = {
    async getAttachments() {
      return new Map([["id", { filename: "file.bin", rawFilename: "file.bin", description: "" }]]);
    },
    getAttachmentContent: () => content.promise,
  } as unknown as PDFJS.PDFDocumentProxy;
  const lifecycle = hostFor(pdf);
  const attachments = new DocumentAttachments();
  await attachments.prepare(lifecycle.host);

  const pending = attachments.getContent(lifecycle.host, "id");
  await Promise.resolve();
  await Promise.resolve();
  lifecycle.cancel();
  const staleSettlements = attachments.settlements;
  attachments.reset();
  assert.deepEqual(await pending, { status: "cancelled" });
  assert.equal(attachments.settlements.length, 0);
  content.resolve(new Uint8Array([1, 2, 3]));
  await Promise.all(staleSettlements);
  assert.equal(attachments.settlements.length, 0);
});
