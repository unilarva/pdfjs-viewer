// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeThumbnailRasterBudget,
  orderThumbnailEvictions,
  selectThumbnailRenderCandidate,
} from "../../src/thumbnail-render-planner.js";

const viewport = { top: 100, bottom: 300, height: 200 };

test("selects visible work first and follows the leading edge while moving", () => {
  const candidates = [
    { pageNo: 1, top: 20, bottom: 80 },
    { pageNo: 2, top: 120, bottom: 180 },
    { pageNo: 3, top: 200, bottom: 260 },
    { pageNo: 4, top: 320, bottom: 380 },
  ];
  assert.equal(
    selectThumbnailRenderCandidate(candidates, viewport, new Set([2, 3]), 1, new Set([1])),
    3,
  );
  assert.equal(
    selectThumbnailRenderCandidate(
      [candidates[0], candidates[3]],
      viewport,
      new Set(),
      1,
      new Set([4]),
    ),
    4,
  );
});

test("evicts farthest output before older equal-distance output", () => {
  const candidates = [
    { pageNo: 1, top: 20, bottom: 80, lastNeeded: 2 },
    { pageNo: 2, top: 120, bottom: 180, lastNeeded: 1 },
    { pageNo: 3, top: 320, bottom: 380, lastNeeded: 3 },
  ];
  assert.deepEqual(orderThumbnailEvictions(candidates, viewport), [1, 3, 2]);
  assert.deepEqual(orderThumbnailEvictions(candidates, null), [2, 1, 3]);
});

test("raster budget obeys DPR, canvas, and available-byte limits", () => {
  assert.deepEqual(
    computeThumbnailRasterBudget({
      cssWidth: 120,
      cssHeight: 160,
      maxDpr: 2,
      devicePixelRatio: 3,
      maxCanvasPixels: 1_000_000,
      maxCanvasDimension: 1000,
      availableBytes: 1_000_000,
    }),
    { dpr: 2, width: 240, height: 320, bytes: 307_200 },
  );

  const constrained = computeThumbnailRasterBudget({
    cssWidth: 120,
    cssHeight: 160,
    maxDpr: 2,
    devicePixelRatio: 2,
    maxCanvasPixels: 1_000_000,
    maxCanvasDimension: 1000,
    availableBytes: 76_800,
  });
  assert.equal(constrained.dpr, 1);
  assert.equal(constrained.bytes, 76_800);
});
