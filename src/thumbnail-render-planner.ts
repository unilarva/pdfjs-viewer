// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure planning for thumbnail render order, eviction order, and raster budgets.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. It owns no DOM, cache mutation, queue, or lifecycle.
 * See the [architecture guide](../ARCHITECTURE.md) for rendering ownership boundaries.
 * @packageDocumentation
 * @module thumbnail-render-planner
 */

export interface ThumbnailPanelGeometry {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

export interface ThumbnailCandidateGeometry {
  readonly pageNo: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ThumbnailEvictionCandidate extends ThumbnailCandidateGeometry {
  readonly lastNeeded: number;
}

export interface ThumbnailRasterBudgetInput {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly maxDpr: number;
  readonly devicePixelRatio: number;
  readonly maxCanvasPixels: number;
  readonly maxCanvasDimension: number;
  readonly availableBytes: number;
}

export interface ThumbnailRasterBudget {
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/** Returns CSS-pixel distance from an item to the panel viewport. */
export function thumbnailViewportDistance(
  item: ThumbnailCandidateGeometry,
  viewport: ThumbnailPanelGeometry,
): number {
  if (item.bottom >= viewport.top && item.top <= viewport.bottom) return 0;
  return item.bottom < viewport.top ? viewport.top - item.bottom : item.top - viewport.bottom;
}

/** Returns whether an item lies behind current panel motion. */
export function thumbnailIsBehind(
  item: ThumbnailCandidateGeometry,
  viewport: ThumbnailPanelGeometry,
  direction: -1 | 0 | 1,
): boolean {
  if (!direction) return false;
  return direction > 0 ? item.bottom < viewport.top : item.top > viewport.bottom;
}

/** Selects visible-first work with directional and active-page tie breaks. */
export function selectThumbnailRenderCandidate(
  candidates: readonly ThumbnailCandidateGeometry[],
  viewport: ThumbnailPanelGeometry,
  visiblePages: ReadonlySet<number>,
  direction: -1 | 0 | 1,
  activePages: ReadonlySet<number>,
): number | null {
  const activeDistance = (pageNo: number): number => {
    let distance = pageNo;
    for (const active of activePages) distance = Math.min(distance, Math.abs(active - pageNo));
    return distance;
  };
  const ordered = [...candidates].sort((a, b) => {
    const aVisible = visiblePages.has(a.pageNo);
    const bVisible = visiblePages.has(b.pageNo);
    const visible = Number(!aVisible) - Number(!bVisible);
    if (visible) return visible;
    if (direction && aVisible && bVisible) {
      const leading = direction > 0 ? b.bottom - a.bottom : a.top - b.top;
      if (leading) return leading;
    }
    const directionalDistance = (item: ThumbnailCandidateGeometry): number => {
      const distance = thumbnailViewportDistance(item, viewport);
      return thumbnailIsBehind(item, viewport, direction)
        ? distance + viewport.height * 4
        : distance;
    };
    const distance = directionalDistance(a) - directionalDistance(b);
    return distance || activeDistance(a.pageNo) - activeDistance(b.pageNo) || a.pageNo - b.pageNo;
  });
  return ordered[0]?.pageNo ?? null;
}

/** Orders retained output from least to most valuable. */
export function orderThumbnailEvictions(
  candidates: readonly ThumbnailEvictionCandidate[],
  viewport: ThumbnailPanelGeometry | null,
): readonly number[] {
  return [...candidates]
    .sort((a, b) => {
      const aDistance = viewport
        ? thumbnailViewportDistance(a, viewport)
        : Number.POSITIVE_INFINITY;
      const bDistance = viewport
        ? thumbnailViewportDistance(b, viewport)
        : Number.POSITIVE_INFINITY;
      const distance = aDistance === bDistance ? 0 : bDistance - aDistance;
      return distance || a.lastNeeded - b.lastNeeded || b.pageNo - a.pageNo;
    })
    .map(candidate => candidate.pageNo);
}

/** Computes the highest backing-store DPR that satisfies every supplied limit. */
export function computeThumbnailRasterBudget(
  input: ThumbnailRasterBudgetInput,
): ThumbnailRasterBudget {
  const cssPixels = Math.max(1, input.cssWidth * input.cssHeight);
  const requestedDpr = Math.min(input.maxDpr, input.devicePixelRatio);
  const dpr = Math.max(
    1 / Math.max(input.cssWidth, input.cssHeight),
    Math.min(
      requestedDpr,
      input.maxCanvasDimension / Math.max(input.cssWidth, input.cssHeight),
      Math.sqrt(input.maxCanvasPixels / cssPixels),
      Math.sqrt(Math.max(4, input.availableBytes) / (cssPixels * 4)),
    ),
  );
  const width = Math.max(1, Math.floor(input.cssWidth * dpr));
  const height = Math.max(1, Math.floor(input.cssHeight * dpr));
  return Object.freeze({ dpr, width, height, bytes: width * height * 4 });
}
