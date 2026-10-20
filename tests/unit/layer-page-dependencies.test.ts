// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { LayerPageDependencies } from "../../src/layer-page-dependencies.js";

test("registered page unions include shared/multi-page and implicit radio-group changes", () => {
  const index = new LayerPageDependencies();
  assert.equal(
    index.replace(
      [
        { id: "a", pages: [20, 21] },
        { id: "b", pages: [21, 22] },
        { id: "empty", pages: [] },
      ],
      new Set(["a", "b", "empty", "unknown"]),
      100,
    ),
    true,
  );
  assert.deepEqual([...index.affected(["a", "b"])!], [20, 21, 22]);
  assert.deepEqual([...index.affected(["empty"])!], []);
  assert.deepEqual([...index.affected([])!], []);
  assert.equal(index.affected(["a", "unknown"]), undefined);
});

test("registration validates atomically, rejects zero-based pages and detaches caller arrays", () => {
  const index = new LayerPageDependencies();
  const ids = new Set(["a"]);
  const pages = [1];
  assert.equal(index.replace([{ id: "a", pages }], ids, 2), true);
  pages.push(2);
  for (const dependencies of [
    [{ id: "a", pages: [0] }],
    [{ id: "a", pages: [3] }],
    [{ id: "a", pages: [1.5] }],
    [{ id: "a", pages: [NaN] }],
    [{ id: "a", pages: [1, 1] }],
    [{ id: "unknown", pages: [1] }],
    [
      { id: "a", pages: [1] },
      { id: "a", pages: [2] },
    ],
  ]) {
    assert.equal(index.replace(dependencies, ids, 2), false);
    assert.deepEqual([...index.affected(["a"])!], [1]);
  }
  index.clear();
  assert.equal(index.affected(["a"]), undefined);
  assert.equal(index.replace([], ids, 2), true);
});
