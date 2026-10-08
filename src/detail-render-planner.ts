// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private CSS-space detail geometry and bounded backing-store planning.
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for renderer ownership.
 * @packageDocumentation
 * @module detail-render-planner
 */
import { resolveRasterDimensions } from "./render-planner.js";

/** A rectangle in the rotated page's canonical CSS coordinate system. */
export interface DetailRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One clipped raster, including its exact allocation and uniform output scale. */
export interface DetailRaster extends DetailRegion {
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  readonly dpr: number;
  readonly bytes: number;
}

/** Whether a crop covers the visible portion, allowing only floating-point roundoff. */
export function detailRegionContains(outer: DetailRegion, inner: DetailRegion): boolean {
  const outerRight = outer.x + outer.width;
  const innerRight = inner.x + inner.width;
  const outerBottom = outer.y + outer.height;
  const innerBottom = inner.y + inner.height;
  // Page clipping and CSS/PDF coordinate conversion can differ by a few ULPs.
  // Keep axis-local tolerances: large vertical coordinates must not hide a real
  // horizontal gap, and ordinary subpixel movement must still request a new crop.
  const epsilonX =
    Number.EPSILON *
    16 *
    Math.max(1, Math.abs(outer.x), Math.abs(inner.x), Math.abs(outerRight), Math.abs(innerRight));
  const epsilonY =
    Number.EPSILON *
    16 *
    Math.max(1, Math.abs(outer.y), Math.abs(inner.y), Math.abs(outerBottom), Math.abs(innerBottom));
  return (
    outer.x <= inner.x + epsilonX &&
    outer.y <= inner.y + epsilonY &&
    outerRight >= innerRight - epsilonX &&
    outerBottom >= innerBottom - epsilonY
  );
}

/** Preserves visible-region quality, shrinking optional overscan before reducing DPR. */
export function planDetailRaster(
  visible: DetailRegion,
  pageWidth: number,
  pageHeight: number,
  requestedDpr: number,
  baseDpr: number,
  availableBytes: number,
  maxCanvasPixels: number,
  maxCanvasDimension: number,
): Readonly<DetailRaster> | null {
  if (
    ![
      visible.x,
      visible.y,
      visible.width,
      visible.height,
      pageWidth,
      pageHeight,
      requestedDpr,
      baseDpr,
      availableBytes,
    ].every(Number.isFinite) ||
    visible.width <= 0 ||
    visible.height <= 0 ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    availableBytes < 4
  )
    return null;
  // The final candidate has neither padding nor quantization. Only that exact
  // visible crop may trade resolution for hard canvas or memory constraints.
  for (const padding of [128, 64, 32, 16, 0]) {
    const quantum = Math.min(64, padding);
    const x = Math.max(
      0,
      quantum ? Math.floor((visible.x - padding) / quantum) * quantum : visible.x,
    );
    const y = Math.max(
      0,
      quantum ? Math.floor((visible.y - padding) / quantum) * quantum : visible.y,
    );
    const right = Math.min(
      pageWidth,
      quantum
        ? Math.ceil((visible.x + visible.width + padding) / quantum) * quantum
        : visible.x + visible.width,
    );
    const bottom = Math.min(
      pageHeight,
      quantum
        ? Math.ceil((visible.y + visible.height + padding) / quantum) * quantum
        : visible.y + visible.height,
    );
    const width = right - x;
    const height = bottom - y;
    if (width <= 0 || height <= 0) return null;
    const raster = resolveRasterDimensions(
      width,
      height,
      requestedDpr,
      Math.min(maxCanvasPixels, Math.floor(availableBytes / 4)),
      maxCanvasDimension,
    );
    if (padding && raster.renderDpr < requestedDpr) continue;
    // A tiny quality increase is not worth another allocation or a visible seam.
    if (raster.renderDpr <= baseDpr * 1.1) return null;
    return Object.freeze({
      x,
      y,
      width,
      height,
      bufferWidth: raster.width,
      bufferHeight: raster.height,
      dpr: raster.renderDpr,
      bytes: raster.width * raster.height * 4,
    });
  }
  return null;
}
