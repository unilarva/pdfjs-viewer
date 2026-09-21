// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type * as PDFJS from "pdfjs-dist";
import { DocumentPageUsage } from "../../src/document-page-usage.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function page(cleanups: { value: number }): PDFJS.PDFPageProxy {
  return {
    cleanup: () => {
      cleanups.value++;
    },
  } as unknown as PDFJS.PDFPageProxy;
}

test("concurrent page uses clean only after the final release", async () => {
  const cleanups = { value: 0 };
  const proxy = page(cleanups);
  const usage = new DocumentPageUsage({
    getPage: async () => proxy,
  } as unknown as PDFJS.PDFDocumentProxy);
  const [first, second] = await Promise.all([usage.acquire(1), usage.acquire(1)]);
  first.release();
  assert.equal(cleanups.value, 0);
  second.release();
  assert.equal(cleanups.value, 1);
  second.release();
  assert.equal(cleanups.value, 1, "release is idempotent");
});

test("pending acquisition prevents early cleanup and close waits", async () => {
  const cleanups = { value: 0 };
  const proxy = page(cleanups);
  const pending = deferred<PDFJS.PDFPageProxy>();
  let calls = 0;
  const usage = new DocumentPageUsage({
    getPage: async () => (++calls === 1 ? proxy : pending.promise),
  } as unknown as PDFJS.PDFDocumentProxy);
  const first = await usage.acquire(1);
  const secondPromise = usage.acquire(1);
  first.release();
  assert.equal(cleanups.value, 0);
  let closed = false;
  const close = usage.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  pending.resolve(proxy);
  const second = await secondPromise;
  second.release();
  await close;
  assert.equal(cleanups.value, 1);
});

test("different pages settle independently", async () => {
  const firstCleanups = { value: 0 };
  const secondCleanups = { value: 0 };
  const usage = new DocumentPageUsage({
    getPage: async (pageNo: number) => (pageNo === 1 ? page(firstCleanups) : page(secondCleanups)),
  } as unknown as PDFJS.PDFDocumentProxy);
  const first = await usage.acquire(1);
  const second = await usage.acquire(2);
  first.release();
  assert.deepEqual([firstCleanups.value, secondCleanups.value], [1, 0]);
  second.release();
  assert.deepEqual([firstCleanups.value, secondCleanups.value], [1, 1]);
});

test("failed acquisition does not strand close and closed owners reject new use", async () => {
  const usage = new DocumentPageUsage({
    getPage: async () => {
      throw new Error("failed");
    },
  } as unknown as PDFJS.PDFDocumentProxy);
  await assert.rejects(usage.acquire(1), /failed/);
  await usage.close();
  await assert.rejects(usage.acquire(1), /closed/);
});

test("a later batch performs its own cleanup", async () => {
  const cleanups = { value: 0 };
  const proxy = page(cleanups);
  const usage = new DocumentPageUsage({
    getPage: async () => proxy,
  } as unknown as PDFJS.PDFDocumentProxy);
  (await usage.acquire(1)).release();
  (await usage.acquire(1)).release();
  assert.equal(cleanups.value, 2);
});
