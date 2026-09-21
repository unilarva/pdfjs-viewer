// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure UTF-16-stable, Unicode-aware matching shared by search and outline filtering.
 *
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. Cluster mapping preserves original UTF-16 offsets while
 * applying normalized case and diacritic policy, and owns no document index,
 * selection, or UI state. See the [architecture guide](../ARCHITECTURE.md) for
 * the authoritative pure-helper dependency direction.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module text-matching
 */

import type { NormalizedTextQueryOptions } from "./viewer-options.js";

/** A match in original JavaScript UTF-16 code-unit coordinates. */
export type TextMatchSpan = { index: number; length: number };

type TextCluster = { value: string; start: number; end: number };

/** A query normalized into reusable clusters and comparison policy. */
export interface CompiledTextQuery {
  readonly clusters: readonly TextCluster[];
  readonly options: NormalizedTextQueryOptions;
}

/** Folds a normalized string to base characters for diacritic-insensitive comparison. */
function foldDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** Normalizes one grapheme-like cluster before case-aware comparison. */
function normalizeCluster(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize("NFC");
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/** Tests whether a cluster contains combining marks after canonical decomposition. */
function hasDiacritics(value: string): boolean {
  return /\p{M}/u.test(value.normalize("NFD"));
}

/** Groups each base code point with following marks while preserving UTF-16 offsets. */
export function textClusters(value: string): TextCluster[] {
  const clusters: TextCluster[] = [];
  let offset = 0;
  for (const codePoint of value) {
    const end = offset + codePoint.length;
    const previous = clusters[clusters.length - 1];
    if (previous && /\p{M}/u.test(codePoint)) {
      previous.value += codePoint;
      previous.end = end;
    } else {
      clusters.push({ value: codePoint, start: offset, end });
    }
    offset = end;
  }
  return clusters;
}

/** Compares two clusters with the configured case and diacritic policy. */
function clustersEqual(
  haystack: string,
  query: string,
  options: NormalizedTextQueryOptions,
): boolean {
  const left = normalizeCluster(haystack, options.caseSensitive);
  const right = normalizeCluster(query, options.caseSensitive);
  if (options.diacritics === "respect") return left === right;
  if (options.diacritics === "smart" && hasDiacritics(query)) return left === right;
  return foldDiacritics(left) === foldDiacritics(right);
}

/** Compiles a query once for matching against multiple strings. */
export function compileTextQuery(
  query: string,
  options: NormalizedTextQueryOptions,
): CompiledTextQuery {
  return Object.freeze({
    clusters: Object.freeze(textClusters(query)),
    options,
  });
}

/** Tests a string against a query that has already been compiled. */
export function hasCompiledTextMatch(haystack: string, query: CompiledTextQuery): boolean {
  if (!query.clusters.length) return false;
  const haystackClusters = textClusters(haystack);
  for (let index = 0; index + query.clusters.length <= haystackClusters.length; index++) {
    if (
      query.clusters.every((cluster, offset) =>
        clustersEqual(haystackClusters[index + offset].value, cluster.value, query.options),
      )
    )
      return true;
  }
  return false;
}

/** Finds matches for a query that has already been compiled. */
export function findCompiledTextMatches(
  haystack: string,
  query: CompiledTextQuery,
): TextMatchSpan[] {
  if (!query.clusters.length) return [];
  const haystackClusters = textClusters(haystack);
  const matches: TextMatchSpan[] = [];
  for (let index = 0; index + query.clusters.length <= haystackClusters.length; index++) {
    if (
      !query.clusters.every((cluster, offset) =>
        clustersEqual(haystackClusters[index + offset].value, cluster.value, query.options),
      )
    )
      continue;
    const start = haystackClusters[index].start;
    const end = haystackClusters[index + query.clusters.length - 1].end;
    matches.push({ index: start, length: end - start });
  }
  return matches;
}
