// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private caller-attested optional-content dependency index. Omitted IDs are
 * unknown, never empty. The facade owns document admission and lifecycle resets.
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module layer-page-dependencies
 */

import type { PdfjsViewerLayerPageDependency } from "./viewer-contracts.js";

/** Atomic detached dependency maps for one facade document. */
export class LayerPageDependencies {
  #pages = new Map<string, ReadonlySet<number>>();

  /** Validates the whole map before replacing it; rejected maps preserve old state. */
  replace(
    dependencies: readonly PdfjsViewerLayerPageDependency[],
    ids: ReadonlySet<string>,
    pageCount: number,
  ): boolean {
    if (!Array.isArray(dependencies)) return false;
    const next = new Map<string, ReadonlySet<number>>();
    for (const entry of dependencies) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.id !== "string" ||
        !ids.has(entry.id) ||
        next.has(entry.id) ||
        !Array.isArray(entry.pages)
      )
        return false;
      const pages = new Set<number>();
      for (const page of entry.pages) {
        if (!Number.isSafeInteger(page) || page < 1 || page > pageCount || pages.has(page))
          return false;
        pages.add(page);
      }
      next.set(entry.id, pages);
    }
    this.#pages = next;
    return true;
  }

  /** Undefined requests conservative whole-document invalidation for any unknown ID. */
  affected(changedIds: readonly string[]): ReadonlySet<number> | undefined {
    const pages = new Set<number>();
    for (const id of changedIds) {
      const registered = this.#pages.get(id);
      if (!registered) return undefined;
      for (const page of registered) pages.add(page);
    }
    return pages;
  }

  /** Revokes all registrations on document replacement, close, or destroy. */
  clear(): void {
    this.#pages.clear();
  }
}
