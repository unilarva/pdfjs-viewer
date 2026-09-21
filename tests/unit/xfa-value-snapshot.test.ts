// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentXfaPrintSnapshot,
  inspectDocumentXfaPrintSource,
} from "../../src/document-xfa-print.js";
import {
  collectXfaFields,
  createXfaValueSnapshot,
  materializeXfaStructure,
} from "../../src/xfa-value-snapshot.js";

const page = (id: string, value: string) => ({
  name: "div",
  attributes: { class: ["xfaPage"], style: { width: "612px", height: "792px" } },
  children: [
    {
      name: "input",
      attributes: { id: `${id}-dom`, dataId: id, value },
      children: [],
    },
  ],
});

test("XFA snapshots freeze structural values while yielding isolated mutable render copies", () => {
  const live = new Map<string, Record<string, unknown>>([["field-a", { value: "Edited" }]]);
  const root = { name: "div", attributes: {}, children: [page("field-a", "Loaded")] };
  const snapshot = createXfaValueSnapshot(root, {
    getValue: (id, fallback) => Object.assign(fallback, live.get(id)),
  });
  live.set("field-a", { value: "Later" });
  assert.deepEqual(snapshot.annotationStorage.getValue("field-a", { value: null }), {
    value: "Edited",
  });
  assert.deepEqual(collectXfaFields(snapshot.structure), [
    {
      id: "field-a",
      domId: "field-a-dom",
      pageNo: 1,
      defaultValue: "Loaded",
      name: null,
      disabled: false,
      readOnly: false,
    },
  ]);
  assert.ok(Object.isFrozen(snapshot.structure));
  const mutable = materializeXfaStructure(snapshot.structure);
  (mutable.children![0]!.attributes as Record<string, unknown>).name = "display";
  assert.equal(snapshot.structure.children![0]!.attributes?.name, undefined);
});

test("pure-XFA print preparation snapshots every page and never reads PrintAnnotationStorage", () => {
  let printReads = 0;
  const storage = {
    getValue: (_id: string, fallback: object) => ({ ...fallback, value: "job-start" }),
    get print() {
      printReads++;
      return {};
    },
  };
  const pdf = {
    isPureXfa: true,
    numPages: 2,
    allXfaHtml: { name: "div", attributes: {}, children: [page("a", "A"), page("b", "B")] },
    annotationStorage: storage,
  };
  const XfaLayer = {
    getPageViewport: (xfaPage: { attributes: { style: object } }) => ({
      source: xfaPage.attributes.style,
    }),
  };
  const snapshot = createDocumentXfaPrintSnapshot(pdf as never, XfaLayer as never)!;
  storage.getValue = (_id: string, fallback: object) => ({ ...fallback, value: "after-start" });
  assert.equal(snapshot.pages.length, 2);
  assert.equal(snapshot.pages[0].intent, "print");
  assert.equal(
    (snapshot.annotationStorage.getValue("a", { value: null }) as { value: unknown }).value,
    "job-start",
  );
  assert.equal(printReads, 0);
});

test("XFA print admission counts before cloning and snapshots only admitted pages", () => {
  let attributeReads = 0;
  const guarded = {
    name: "div",
    get attributes() {
      attributeReads++;
      return { value: "large" };
    },
    children: [],
  };
  const pdf = {
    isPureXfa: true,
    numPages: 2,
    allXfaHtml: {
      name: "div",
      children: [
        { name: "div", children: [guarded, { name: "img", children: [] }] },
        page("b", "B"),
      ],
    },
    annotationStorage: { getValue: (_id: string, fallback: object) => fallback },
  };
  const oversized = inspectDocumentXfaPrintSource(pdf as never, [1], {
    maxPages: 1,
    maxNodes: 1,
    maxImages: 10,
  })!;
  assert.equal(oversized.exceeded, true);
  assert.equal(attributeReads, 0, "count-first admission must not copy source attributes");

  const admitted = inspectDocumentXfaPrintSource(pdf as never, [2], {
    maxPages: 1,
    maxNodes: 10,
    maxImages: 10,
  })!;
  const snapshot = createDocumentXfaPrintSnapshot(
    pdf as never,
    {
      getPageViewport: () => ({ width: 100, height: 200 }),
    } as never,
    admitted,
  )!;
  assert.deepEqual(
    snapshot.pages.map(value => value.pageNo),
    [2],
  );
  assert.equal(snapshot.pageFor(2).size.height, 200);
  assert.throws(() => snapshot.pageFor(1), /was not admitted/);
  assert.equal(attributeReads, 0);
});
