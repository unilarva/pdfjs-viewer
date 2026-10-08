// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { detailRegionContains, planDetailRaster } from "../../src/detail-render-planner.js";

test("detail crops pad and quantize fractional visible bounds without moving the page transform", () => {
  const visible = { x: 300.25, y: 401.75, width: 221.5, height: 179.25 };
  const raster = planDetailRaster(
    visible,
    1200.5,
    1600.75,
    2.5,
    0.5,
    32_000_000,
    16_000_000,
    4096,
  )!;
  assert.equal(raster.x, 128);
  assert.equal(raster.y, 256);
  assert.equal(detailRegionContains(raster, visible), true);
  assert.equal(raster.dpr, 2.5);
  assert.equal(raster.bytes, raster.bufferWidth * raster.bufferHeight * 4);
  assert.equal(detailRegionContains(raster, { ...visible, x: 900 }), false);
});

test("detail dimensions and area independently obey built-in and custom canvas and memory limits", () => {
  for (const [area, dimension] of [
    [16_000_000, 4096],
    [32_000_000, 8192],
    [48_000_000, 16384],
    [900_000, 700],
  ]) {
    for (const available of [2_000_000, 200_000_000]) {
      const raster = planDetailRaster(
        { x: 5, y: 7, width: 2200, height: 1300 },
        20_000,
        30_000,
        3,
        0.01,
        available,
        area,
        dimension,
      )!;
      assert.ok(raster.bufferWidth <= dimension && raster.bufferHeight <= dimension);
      assert.ok(raster.bufferWidth * raster.bufferHeight <= area);
      assert.ok(raster.bytes <= available);
      assert.ok(raster.dpr > 0.01);
    }
  }
});

test("detail is skipped without useful quality improvement or hard headroom", () => {
  const crop = { x: 0, y: 0, width: 100, height: 120 };
  assert.equal(planDetailRaster(crop, 100, 120, 1, 1, 1_000_000, 16_000_000, 4096), null);
  assert.equal(planDetailRaster(crop, 100, 120, 3, 0.5, 3, 16_000_000, 4096), null);
  assert.equal(
    planDetailRaster({ ...crop, x: NaN }, 100, 120, 3, 0.5, 1_000_000, 16_000_000, 4096),
    null,
  );
});

test("optional padding and quantization never lower visible quality when the exact crop fits", () => {
  const visible = { x: 300.25, y: 401.75, width: 100.5, height: 120.25 };
  for (const [availableBytes, area, dimension] of [
    [10_000_000, 10_000_000, 256],
    [10_000_000, 50_000, 4096],
    [50_000 * 4, 10_000_000, 4096],
  ]) {
    const raster = planDetailRaster(visible, 2000, 3000, 2, 0.5, availableBytes, area, dimension)!;
    assert.equal(raster.dpr, 2);
    assert.ok(detailRegionContains(raster, visible));
    assert.ok(raster.bytes <= availableBytes);
    assert.ok(raster.bufferWidth * raster.bufferHeight <= area);
    assert.ok(raster.bufferWidth <= dimension && raster.bufferHeight <= dimension);
  }
});

test("fractional exact-fit crops remove every optional pixel before lowering resolution", () => {
  const visible = { x: 300.25, y: 401.75, width: 100.5, height: 120.25 };
  const area = Math.ceil(visible.width * 2) * Math.ceil(visible.height * 2);
  const raster = planDetailRaster(visible, 2000, 3000, 2, 0.5, area * 4, area, 241)!;
  assert.equal(raster.dpr, 2);
  assert.equal(raster.x, visible.x);
  assert.equal(raster.y, visible.y);
  assert.equal(raster.width, visible.width);
  assert.equal(raster.height, visible.height);
  assert.equal(raster.bytes, area * 4);
});

test("clipped crop containment tolerates roundoff on every edge but rejects genuine subpixel gaps", () => {
  const crop = { x: 650.25, y: 850.5, width: 149.75, height: 109.5 };
  assert.ok(
    detailRegionContains(crop, {
      x: crop.x - 1e-13,
      y: crop.y - 1e-13,
      width: crop.width + 2e-13,
      height: crop.height + 2e-13,
    }),
  );
  assert.equal(detailRegionContains(crop, { ...crop, x: crop.x + 1 / 64 }), false);
  assert.equal(detailRegionContains(crop, { ...crop, y: crop.y - 1 / 64 }), false);
  assert.equal(
    detailRegionContains({ ...crop, y: 1e12 }, { ...crop, y: 1e12, x: crop.x - 1 / 64 }),
    false,
  );
});

test("unavoidable resolution reduction still covers the whole visible region without overscan", () => {
  const visible = { x: 300.25, y: 401.75, width: 600.5, height: 800.25 };
  const raster = planDetailRaster(visible, 2000, 3000, 2, 0.1, 1_000_000, 750_000, 512)!;
  assert.ok(raster.dpr < 2);
  assert.ok(detailRegionContains(raster, visible));
  assert.equal(raster.width, visible.width);
  assert.equal(raster.height, visible.height);
  assert.ok(raster.bytes <= 1_000_000);
});

test("extreme zoom keeps allocations bounded and the visible region geometrically stable", () => {
  const visible = { x: 1_800_000.125, y: 2_600_000.75, width: 960.5, height: 720.25 };
  const raster = planDetailRaster(
    visible,
    5_000_000,
    7_000_000,
    3,
    0.0005,
    12_000_000,
    16_000_000,
    4096,
  )!;
  assert.ok(detailRegionContains(raster, visible));
  assert.ok(raster.bytes <= 12_000_000);
  assert.ok(Number.isFinite(raster.x * raster.dpr));
  assert.ok(raster.dpr > 1);
});
