// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentSearch, type DocumentSearchHost } from "../../src/document-search.js";
import { DocumentPageUsage } from "../../src/document-page-usage.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function host(pdf: object, overrides: Partial<DocumentSearchHost> = {}): DocumentSearchHost {
  const pages = new DocumentPageUsage(pdf as never);
  return {
    searchEnabled: true,
    pageCount: 1,
    isDestroyed: false,
    isReady: true,
    getPdf: () => pdf as never,
    getDocumentGeneration: () => 1,
    isCurrentDocument: candidate => candidate === pdf,
    waitForDocumentPreparation: promise => promise,
    getDocumentSignal: () => new AbortController().signal,
    normalizeQueryOptions: options => ({
      caseSensitive: options.caseSensitive ?? false,
      diacritics: options.diacritics ?? "smart",
    }),
    acquirePage: pageNo => pages.acquire(pageNo),
    ...overrides,
  };
}

function textItem(
  str: string,
  transform: unknown = [1, 0, 0, 1, 0, 0],
  width = 10,
  height = 10,
): object {
  return { str, transform, width, height };
}

test("validates, defensively copies, and deeply freezes retained text items", async () => {
  const transform = [1, 0, 0, -1, 12, 0];
  const original = textItem("Café", transform, -10, 0) as {
    str: string;
    transform: number[];
    width: number;
  };
  const pdf = {
    getPage: async () => ({
      getTextContent: async () => ({
        items: [
          original,
          null,
          {},
          { ...textItem("missing string"), str: undefined },
          { ...textItem("wrong string"), str: 1 },
          textItem("wrong transform", "1,0,0,1,0,0"),
          textItem("short transform", [1, 0, 0, 1, 0]),
          textItem("long transform", [1, 0, 0, 1, 0, 0, 0]),
          textItem("infinite transform", [1, 0, 0, 1, Number.POSITIVE_INFINITY, 0]),
          textItem("nan width", undefined, Number.NaN),
          textItem("infinite height", undefined, 1, Number.NEGATIVE_INFINITY),
        ],
      }),
      cleanup: () => {},
    }),
  };
  const feature = new DocumentSearch();

  assert.equal(await feature.prepare(host(pdf)), true);
  const items = feature.itemsForPage(1);
  assert.deepEqual(items, [
    {
      textItemIndex: 0,
      str: "Café",
      textOffset: 0,
      transform: [1, 0, 0, -1, 12, 0],
      width: -10,
      height: 0,
    },
  ]);
  assert.ok(Object.isFrozen(items));
  assert.ok(Object.isFrozen(items?.[0]));
  assert.ok(Object.isFrozen(items?.[0]?.transform));

  original.str = "changed";
  original.transform[0] = 99;
  original.width = 99;
  assert.deepEqual(items, [
    {
      textItemIndex: 0,
      str: "Café",
      textOffset: 0,
      transform: [1, 0, 0, -1, 12, 0],
      width: -10,
      height: 0,
    },
  ]);
  assert.throws(() => {
    (items as unknown as object[]).push({});
  }, TypeError);
  assert.throws(() => {
    (items?.[0] as unknown as { width: number }).width = 2;
  }, TypeError);
  assert.throws(() => {
    (items?.[0]?.transform as unknown as number[])[0] = 2;
  }, TypeError);

  const result = await feature.search(host(pdf), "cafe", {});
  assert.deepEqual(result, {
    ok: true,
    query: "cafe",
    matches: [{ page: 1, segments: [{ text: "Café", characterIndex: 0, length: 4 }] }],
  });
  if (result.ok) result.matches[0]!.segments[0]!.text = "detached";
  assert.equal(feature.itemsForPage(1)?.[0]?.str, "Café");
});

test("keeps partial candidates private and distinguishes an empty indexed page from absence", async () => {
  const secondContent = deferred<{ items: object[] }>();
  const secondStarted = deferred<void>();
  const cleanupCounts = [0, 0];
  const pdf = {
    getPage: async (pageNo: number) => ({
      getTextContent: async () => {
        if (pageNo === 1) return { items: [{ str: 1 }] };
        secondStarted.resolve();
        return secondContent.promise;
      },
      cleanup: () => {
        cleanupCounts[pageNo - 1]++;
      },
    }),
  };
  const feature = new DocumentSearch();
  const searchHost = host(pdf, { pageCount: 2 });
  const preparation = feature.prepare(searchHost);
  assert.equal(feature.prepare(searchHost), preparation);
  await secondStarted.promise;
  (searchHost as { pageCount: number }).pageCount = 5;

  assert.equal(feature.ready, false);
  assert.equal(feature.indexedPageCount, 0);
  assert.equal(feature.itemsForPage(1), undefined);

  secondContent.resolve({ items: [textItem("second")] });
  assert.equal(await preparation, true);
  assert.equal(feature.ready, true);
  assert.equal(feature.indexedPageCount, 2);
  assert.deepEqual(feature.itemsForPage(1), []);
  assert.ok(Object.isFrozen(feature.itemsForPage(1)));
  assert.equal(feature.itemsForPage(3), undefined);
  assert.deepEqual(cleanupCounts, [1, 1]);
  assert.equal(feature.prepare(searchHost), preparation);
});

test("reset invalidates old work with unchanged PDF and host identity", async () => {
  const oldContent = deferred<{ items: object[] }>();
  const oldStarted = deferred<void>();
  let extraction = 0;
  const cleanupCounts = [0, 0];
  const pdf = {
    getPage: async () => {
      const index = extraction++;
      return {
        getTextContent: async () => {
          if (index === 0) {
            oldStarted.resolve();
            return oldContent.promise;
          }
          return { items: [textItem("new index")] };
        },
        cleanup: () => {
          cleanupCounts[index]++;
        },
      };
    },
  };
  const searchHost = host(pdf);
  const feature = new DocumentSearch();
  const oldPreparation = feature.prepare(searchHost);
  await oldStarted.promise;

  feature.reset();
  assert.equal(feature.ready, false);
  assert.equal(feature.error, null);
  assert.equal(feature.indexedPageCount, 0);
  assert.equal(feature.itemsForPage(1), undefined);
  feature.reset();

  const newPreparation = feature.prepare(searchHost);
  assert.notEqual(newPreparation, oldPreparation);
  assert.equal(feature.prepare(searchHost), newPreparation);
  assert.equal(await newPreparation, true);
  oldContent.reject(new Error("stale extraction failed"));
  assert.equal(await oldPreparation, false);

  assert.equal(feature.preparation, newPreparation);
  assert.equal(feature.ready, true);
  assert.equal(feature.error, null);
  assert.equal(feature.indexedPageCount, 1);
  assert.equal(feature.itemsForPage(1)?.[0]?.str, "new index");
  assert.deepEqual(cleanupCounts, [1, 1]);
});

test("failed extraction clears canonical state, reports an error, cleans once, and retries", async () => {
  const indexError = new Error("text extraction failed");
  let attempt = 0;
  let cleanupCount = 0;
  const pdf = {
    getPage: async () => {
      const currentAttempt = attempt++;
      return {
        getTextContent: async () => {
          if (currentAttempt === 0) throw indexError;
          return { items: [textItem("retry text")] };
        },
        cleanup: () => {
          cleanupCount++;
        },
      };
    },
  };
  const searchHost = host(pdf);
  const feature = new DocumentSearch();
  const failed = feature.prepare(searchHost);
  assert.equal(feature.prepare(searchHost), failed);
  assert.equal(await failed, false);
  assert.equal(feature.preparation, null);
  assert.equal(feature.ready, false);
  assert.equal(feature.error, indexError);
  assert.equal(feature.indexedPageCount, 0);
  assert.equal(feature.itemsForPage(1), undefined);
  assert.equal(cleanupCount, 1);

  const retry = feature.prepare(searchHost);
  assert.notEqual(retry, failed);
  assert.equal(feature.prepare(searchHost), retry);
  assert.equal(await retry, true);
  assert.equal(feature.preparation, retry);
  assert.equal(feature.error, null);
  assert.equal(feature.itemsForPage(1)?.[0]?.str, "retry text");
  assert.equal(cleanupCount, 2);
});

test("invalid admitted page count fails deterministically without acquiring a page", async () => {
  let getPageCount = 0;
  const pdf = {
    getPage: async () => {
      getPageCount++;
      throw new Error("unexpected");
    },
  };
  const feature = new DocumentSearch();
  const searchHost = host(pdf, { pageCount: 1.5 });

  const result = await feature.search(searchHost, "test", {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, "error");
  assert.match(String(result.error), /pageCount must be a non-negative integer/);
  assert.equal(feature.ready, false);
  assert.equal(feature.indexedPageCount, 0);
  assert.equal(getPageCount, 0);
});

test("malformed text-content containers fail the document and still clean the page once", async () => {
  let cleanupCount = 0;
  const pdf = {
    getPage: async () => ({
      getTextContent: async () => ({ items: null }),
      cleanup: () => {
        cleanupCount++;
      },
    }),
  };
  const feature = new DocumentSearch();

  assert.equal(await feature.prepare(host(pdf)), false);
  assert.equal(feature.ready, false);
  assert.equal(feature.indexedPageCount, 0);
  assert.match(String(feature.error), /returned invalid text content/);
  assert.equal(cleanupCount, 1);
});

test("search reports expected disabled and not-ready failures", async () => {
  const pdf = {
    getPage: async () => {
      throw new Error("unused");
    },
  };
  const feature = new DocumentSearch();
  assert.deepEqual(await feature.search(host(pdf, { searchEnabled: false }), "test", {}), {
    ok: false,
    query: "test",
    reason: "disabled",
  });
  assert.deepEqual(await feature.search(host(pdf, { isReady: false }), "test", {}), {
    ok: false,
    query: "test",
    reason: "not-ready",
  });
});

test("public and interactive search share canonical rich matching results", async () => {
  const pdf = {
    getPage: async () => ({
      getTextContent: async () => ({ items: [textItem("Café cafe CAFÉ")] }),
      cleanup: () => {},
    }),
  };
  const feature = new DocumentSearch();
  const searchHost = host(pdf);
  assert.equal(await feature.prepare(searchHost), true);

  const interactive = feature.findMatches("cafe", { caseSensitive: false, diacritics: "smart" });
  assert.deepEqual(interactive, [
    {
      page: 1,
      segments: [{ textItemIndex: 0, text: "Café cafe CAFÉ", characterIndex: 0, length: 4 }],
    },
    {
      page: 1,
      segments: [{ textItemIndex: 0, text: "Café cafe CAFÉ", characterIndex: 5, length: 4 }],
    },
    {
      page: 1,
      segments: [{ textItemIndex: 0, text: "Café cafe CAFÉ", characterIndex: 10, length: 4 }],
    },
  ]);
  assert.deepEqual(await feature.search(searchHost, "cafe", {}), {
    ok: true,
    query: "cafe",
    matches: interactive.map(match => ({
      page: match.page,
      segments: match.segments.map(segment => ({
        text: segment.text,
        characterIndex: segment.characterIndex,
        length: segment.length,
      })),
    })),
  });
});

test("matches across adjacent text items and projects exact ordered source segments", async () => {
  const pdf = {
    getPage: async () => ({
      getTextContent: async () => ({
        items: [textItem("Ca"), textItem("fé and Cafe"), textItem("\u0301"), textItem(" end")],
      }),
      cleanup: () => {},
    }),
  };
  const feature = new DocumentSearch();
  const searchHost = host(pdf);
  assert.equal(await feature.prepare(searchHost), true);

  assert.deepEqual(feature.findMatches("cafe", { caseSensitive: false, diacritics: "smart" }), [
    {
      page: 1,
      segments: [
        { textItemIndex: 0, text: "Ca", characterIndex: 0, length: 2 },
        { textItemIndex: 1, text: "fé and Cafe", characterIndex: 0, length: 2 },
      ],
    },
    {
      page: 1,
      segments: [
        { textItemIndex: 1, text: "fé and Cafe", characterIndex: 7, length: 4 },
        { textItemIndex: 2, text: "\u0301", characterIndex: 0, length: 1 },
      ],
    },
  ]);
  assert.deepEqual(await feature.search(searchHost, "Café", { diacritics: "respect" }), {
    ok: true,
    query: "Café",
    matches: [
      {
        page: 1,
        segments: [
          { text: "Ca", characterIndex: 0, length: 2 },
          { text: "fé and Cafe", characterIndex: 0, length: 2 },
        ],
      },
      {
        page: 1,
        segments: [
          { text: "fé and Cafe", characterIndex: 7, length: 4 },
          { text: "\u0301", characterIndex: 0, length: 1 },
        ],
      },
    ],
  });
});

test("does not bridge a match across an unpresentable source text item", async () => {
  const pdf = {
    getPage: async () => ({
      getTextContent: async () => ({
        items: [textItem("safe"), { str: " barrier " }, textItem("match")],
      }),
      cleanup: () => {},
    }),
  };
  const feature = new DocumentSearch();
  assert.equal(await feature.prepare(host(pdf)), true);

  assert.deepEqual(
    feature.findMatches("safematch", { caseSensitive: true, diacritics: "respect" }),
    [],
  );
  assert.deepEqual(feature.findMatches("safe", { caseSensitive: true, diacritics: "respect" }), [
    {
      page: 1,
      segments: [{ textItemIndex: 0, text: "safe", characterIndex: 0, length: 4 }],
    },
  ]);
  assert.equal(feature.itemsForPage(1)?.[1]?.textOffset, 13);
});
