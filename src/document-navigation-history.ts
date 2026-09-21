// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private bounded in-document navigation history.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * Back/Forward selection is transactional so a caller can restore geometry
 * before committing stack mutation.
 * See the [architecture guide](../ARCHITECTURE.md) for ownership and intent policy.
 *
 * @packageDocumentation
 * @module document-navigation-history
 */

import {
  documentLocationsEqual,
  normalizeDocumentLocation,
  type DocumentLocation,
} from "./document-location.js";

const LOCATION_LIMIT = 100;

/** Deferred atomic history transition. */
export interface DocumentNavigationHistoryTransition {
  readonly target: Readonly<DocumentLocation>;
  commit(): boolean;
}

/** Owns one active document's bounded Back/Forward stacks. */
export class DocumentNavigationHistory {
  #back: Readonly<DocumentLocation>[] = [];
  #forward: Readonly<DocumentLocation>[] = [];
  #revision = 0;

  get canGoBack(): boolean {
    return this.#back.length > 0;
  }

  get canGoForward(): boolean {
    return this.#forward.length > 0;
  }

  /** Records a detached departure and clears the abandoned Forward branch. */
  recordDeparture(location: Readonly<DocumentLocation>): boolean {
    const normalized = normalizeDocumentLocation(location);
    if (!normalized) return false;
    const previous = this.#back.at(-1);
    if (previous && documentLocationsEqual(previous, normalized)) {
      if (this.#forward.length === 0) return false;
      this.#forward = [];
      this.#revision++;
      return true;
    }
    this.#back.push(normalized);
    this.#forward = [];
    this.#trim();
    this.#revision++;
    return true;
  }

  /** Selects Back without mutation; `commit()` atomically advances if still current. */
  takeBack(
    current: Readonly<DocumentLocation>,
  ): Readonly<DocumentNavigationHistoryTransition> | null {
    return this.#take("back", current);
  }

  /** Selects Forward without mutation; `commit()` atomically advances if still current. */
  takeForward(
    current: Readonly<DocumentLocation>,
  ): Readonly<DocumentNavigationHistoryTransition> | null {
    return this.#take("forward", current);
  }

  /** Drops every location retained for the previous document. */
  reset(): void {
    if (this.#back.length === 0 && this.#forward.length === 0) return;
    this.#back = [];
    this.#forward = [];
    this.#revision++;
  }

  #take(
    direction: "back" | "forward",
    current: Readonly<DocumentLocation>,
  ): Readonly<DocumentNavigationHistoryTransition> | null {
    const normalizedCurrent = normalizeDocumentLocation(current);
    const source = direction === "back" ? this.#back : this.#forward;
    const target = source.at(-1);
    if (!normalizedCurrent || !target) return null;
    const revision = this.#revision;
    let settled = false;
    return Object.freeze({
      target,
      commit: () => {
        if (
          settled ||
          revision !== this.#revision ||
          source !== (direction === "back" ? this.#back : this.#forward)
        )
          return false;
        settled = true;
        source.pop();
        const destination = direction === "back" ? this.#forward : this.#back;
        if (!documentLocationsEqual(normalizedCurrent, target)) {
          destination.push(normalizedCurrent);
        }
        this.#trim();
        this.#revision++;
        return true;
      },
    });
  }

  #trim(): void {
    while (this.#back.length + this.#forward.length > LOCATION_LIMIT) {
      if (this.#back.length > 0) this.#back.shift();
      else this.#forward.shift();
    }
  }
}
