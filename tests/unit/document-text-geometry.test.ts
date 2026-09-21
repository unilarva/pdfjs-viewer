// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  changedSelectionPages,
  normalizeSelectionRects,
  orderedTextEndpoints,
  partitionSelectionPages,
} from "../../src/document-text-geometry.js";

test("orders endpoints and partitions intermediate pages", () => {
  const first = { page: 1, textItemIndex: 3, utf16Offset: 2 };
  const last = { page: 3, textItemIndex: 1, utf16Offset: 4 };
  assert.deepEqual(orderedTextEndpoints(last, first), [first, last]);
  assert.deepEqual(partitionSelectionPages(last, first), [
    { page: 1, start: first, end: null },
    { page: 2, start: null, end: null },
    { page: 3, start: null, end: last },
  ]);
});

test("partitions a same-page selection without synthetic edges", () => {
  const first = { page: 2, textItemIndex: 1, utf16Offset: 1 };
  const last = { page: 2, textItemIndex: 2, utf16Offset: 3 };
  assert.deepEqual(partitionSelectionPages(first, last), [{ page: 2, start: first, end: last }]);
});

test("invalidates only page-local partitions whose semantic bounds changed", () => {
  const first = { page: 1, textItemIndex: 0, utf16Offset: 1 };
  const second = { page: 3, textItemIndex: 0, utf16Offset: 4 };
  const moved = { page: 3, textItemIndex: 0, utf16Offset: 8 };
  assert.deepEqual(
    changedSelectionPages({ anchor: first, focus: second }, { anchor: first, focus: moved }),
    [3],
  );
  assert.deepEqual(
    changedSelectionPages({ anchor: first, focus: second }, { anchor: second, focus: first }),
    [],
  );
  assert.deepEqual(changedSelectionPages(null, { anchor: first, focus: second }), [1, 2, 3]);
  assert.deepEqual(changedSelectionPages({ anchor: first, focus: second }, null), [1, 2, 3]);
});

test("merges sorted same-line rectangles in one forward pass", () => {
  assert.deepEqual(
    normalizeSelectionRects([
      { left: 22, top: 10.2, right: 30, bottom: 20.2 },
      { left: 0, top: 30, right: 5, bottom: 40 },
      { left: 0, top: 10, right: 20, bottom: 20 },
    ]),
    [
      { left: 0, top: 10, right: 30, bottom: 20.2 },
      { left: 0, top: 30, right: 5, bottom: 40 },
    ],
  );
  assert.deepEqual(normalizeSelectionRects([]), []);
});

test("normalizes duplicate and partially overlapping rectangles into a disjoint union", () => {
  const normalized = normalizeSelectionRects([
    { left: 0, top: 0, right: 10, bottom: 10 },
    { left: 0, top: 0, right: 10, bottom: 10 },
    { left: 5, top: 5, right: 15, bottom: 15 },
  ]);
  assert.equal(
    normalized.reduce(
      (area, rect) => area + (rect.right - rect.left) * (rect.bottom - rect.top),
      0,
    ),
    175,
  );
  for (let index = 0; index < normalized.length; index++) {
    for (let other = index + 1; other < normalized.length; other++) {
      const a = normalized[index];
      const b = normalized[other];
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    }
  }
});
