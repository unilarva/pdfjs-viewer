// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure endpoint ordering, page partitioning, and rectangle normalization
 * helpers for document text presentation. This emitted
 * module is for package maintainers and is not a supported consumer subpath or
 * package-root export. It owns no DOM, document, selection, or lifecycle state. See the
 * [architecture guide](../ARCHITECTURE.md) for the mutable owner boundary.
 *
 * @packageDocumentation
 * @module document-text-geometry
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 */

export interface TextGeometryEndpoint {
  readonly page: number;
  readonly textItemIndex: number;
  readonly utf16Offset: number;
}

export interface TextGeometryRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PageSelectionPartition<T extends TextGeometryEndpoint> {
  readonly page: number;
  readonly start: T | null;
  readonly end: T | null;
}

export interface TextGeometrySelection<T extends TextGeometryEndpoint> {
  readonly anchor: T;
  readonly focus: T;
}

export function compareTextEndpoints(a: TextGeometryEndpoint, b: TextGeometryEndpoint): number {
  return a.page - b.page || a.textItemIndex - b.textItemIndex || a.utf16Offset - b.utf16Offset;
}

export function orderedTextEndpoints<T extends TextGeometryEndpoint>(a: T, b: T): readonly [T, T] {
  return compareTextEndpoints(a, b) <= 0 ? [a, b] : [b, a];
}

export function partitionSelectionPages<T extends TextGeometryEndpoint>(
  a: T,
  b: T,
): readonly PageSelectionPartition<T>[] {
  const [start, end] = orderedTextEndpoints(a, b);
  const pages: PageSelectionPartition<T>[] = [];
  for (let page = start.page; page <= end.page; page++) {
    pages.push(
      Object.freeze({
        page,
        start: page === start.page ? start : null,
        end: page === end.page ? end : null,
      }),
    );
  }
  return Object.freeze(pages);
}

function endpointsEqual(a: TextGeometryEndpoint | null, b: TextGeometryEndpoint | null): boolean {
  return a === b || (!!a && !!b && compareTextEndpoints(a, b) === 0);
}

/** Returns only pages whose page-local visual range changed. */
export function changedSelectionPages<T extends TextGeometryEndpoint>(
  previous: TextGeometrySelection<T> | null,
  next: TextGeometrySelection<T> | null,
): readonly number[] {
  if (!previous && !next) return Object.freeze([]);
  const bounds = (selection: TextGeometrySelection<T>) => {
    const [start, end] = orderedTextEndpoints(selection.anchor, selection.focus);
    return { start, end };
  };
  const interval = (selection: TextGeometrySelection<T> | null): readonly number[] => {
    if (!selection) return [];
    const { start, end } = bounds(selection);
    return Array.from({ length: end.page - start.page + 1 }, (_, index) => start.page + index);
  };
  if (!previous) return Object.freeze(interval(next));
  if (!next) return Object.freeze(interval(previous));

  const before = bounds(previous);
  const after = bounds(next);
  const changed = new Set<number>();
  const addRange = (first: number, last: number) => {
    for (let page = first; page <= last; page++) changed.add(page);
  };
  addRange(before.start.page, Math.min(before.end.page, after.start.page - 1));
  addRange(Math.max(before.start.page, after.end.page + 1), before.end.page);
  addRange(after.start.page, Math.min(after.end.page, before.start.page - 1));
  addRange(Math.max(after.start.page, before.end.page + 1), after.end.page);
  const partition = (start: T, end: T, page: number): PageSelectionPartition<T> | null => {
    if (page < start.page || page > end.page) return null;
    return {
      page,
      start: page === start.page ? start : null,
      end: page === end.page ? end : null,
    };
  };
  for (const page of new Set([
    before.start.page,
    before.end.page,
    after.start.page,
    after.end.page,
  ])) {
    const oldPart = partition(before.start, before.end, page);
    const newPart = partition(after.start, after.end, page);
    if (
      !oldPart ||
      !newPart ||
      !endpointsEqual(oldPart.start, newPart.start) ||
      !endpointsEqual(oldPart.end, newPart.end)
    )
      changed.add(page);
  }
  return Object.freeze([...changed].sort((a, b) => a - b));
}

function subtractRect(
  source: TextGeometryRect,
  blocker: TextGeometryRect,
): readonly TextGeometryRect[] {
  const left = Math.max(source.left, blocker.left);
  const top = Math.max(source.top, blocker.top);
  const right = Math.min(source.right, blocker.right);
  const bottom = Math.min(source.bottom, blocker.bottom);
  if (right - left <= 0.01 || bottom - top <= 0.01) return [source];
  const pieces: TextGeometryRect[] = [];
  const add = (piece: TextGeometryRect) => {
    if (piece.right - piece.left > 0.01 && piece.bottom - piece.top > 0.01) {
      pieces.push(Object.freeze(piece));
    }
  };
  add({ left: source.left, top: source.top, right: source.right, bottom: top });
  add({ left: source.left, top: bottom, right: source.right, bottom: source.bottom });
  add({ left: source.left, top, right: left, bottom });
  add({ left: right, top, right: source.right, bottom });
  return pieces;
}

/** Merges same-line fragments and returns an exact non-overlapping union. */
export function normalizeSelectionRects(
  rects: readonly TextGeometryRect[],
): readonly TextGeometryRect[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const merged: TextGeometryRect[] = [];
  for (const source of sorted) {
    const previous = merged.at(-1);
    if (previous) {
      const previousHeight = previous.bottom - previous.top;
      const sourceHeight = source.bottom - source.top;
      const centerDistance = Math.abs(
        (previous.top + previous.bottom) / 2 - (source.top + source.bottom) / 2,
      );
      const sameLine = centerDistance <= Math.max(2, Math.min(previousHeight, sourceHeight) * 0.3);
      const horizontalGap = source.left - previous.right;
      if (sameLine && horizontalGap <= 2) {
        merged[merged.length - 1] = Object.freeze({
          left: Math.min(previous.left, source.left),
          top: Math.min(previous.top, source.top),
          right: Math.max(previous.right, source.right),
          bottom: Math.max(previous.bottom, source.bottom),
        });
        continue;
      }
    }
    merged.push(Object.freeze({ ...source }));
  }
  const disjoint: TextGeometryRect[] = [];
  let active: TextGeometryRect[] = [];
  for (const rect of merged) {
    active = active.filter(blocker => blocker.bottom - rect.top > 0.01);
    let pieces: readonly TextGeometryRect[] = [rect];
    for (const blocker of active) {
      pieces = pieces.flatMap(piece => subtractRect(piece, blocker));
      if (!pieces.length) break;
    }
    disjoint.push(...pieces);
    active.push(...pieces);
  }
  return Object.freeze(disjoint);
}
