// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private normalized document locations and viewer-rotation conversion.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * Coordinates use normalized baseline rendered-page space and are neutral to
 * viewer-added rotation. Intrinsic PDF page rotation remains part of that baseline.
 * See the [architecture guide](../ARCHITECTURE.md) for the geometry ownership boundary.
 *
 * @packageDocumentation
 * @module document-location
 */

const DOCUMENT_LOCATION_RATIO_EPSILON = 1e-4;
type DocumentLocationRotation = 0 | 90 | 180 | 270;

/** Private normalized reading location shared by view geometry and history. */
export interface DocumentLocation {
  readonly page: number;
  readonly xRatio: number;
  readonly yRatio: number;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Validates, clamps, detaches, and freezes a document location. */
export function normalizeDocumentLocation(
  location: Readonly<DocumentLocation>,
): Readonly<DocumentLocation> | null {
  if (!Number.isSafeInteger(location.page) || location.page < 1) return null;
  if (!Number.isFinite(location.xRatio) || !Number.isFinite(location.yRatio)) return null;
  return Object.freeze({
    page: location.page,
    xRatio: clampRatio(location.xRatio),
    yRatio: clampRatio(location.yRatio),
  });
}

/** Tests material identity using the canonical normalized-coordinate tolerance. */
export function documentLocationsEqual(
  first: Readonly<DocumentLocation>,
  second: Readonly<DocumentLocation>,
): boolean {
  return (
    first.page === second.page &&
    Math.abs(first.xRatio - second.xRatio) <= DOCUMENT_LOCATION_RATIO_EPSILON &&
    Math.abs(first.yRatio - second.yRatio) <= DOCUMENT_LOCATION_RATIO_EPSILON
  );
}

/** Converts displayed normalized coordinates into baseline rendered-page space. */
export function documentLocationFromDisplay(
  page: number,
  xRatio: number,
  yRatio: number,
  rotation: DocumentLocationRotation,
): Readonly<DocumentLocation> | null {
  return normalizeDocumentLocation(
    rotation === 90
      ? { page, xRatio: yRatio, yRatio: 1 - xRatio }
      : rotation === 180
        ? { page, xRatio: 1 - xRatio, yRatio: 1 - yRatio }
        : rotation === 270
          ? { page, xRatio: 1 - yRatio, yRatio: xRatio }
          : { page, xRatio, yRatio },
  );
}

/** Converts a baseline rendered-page location into the displayed orientation. */
export function documentLocationToDisplay(
  location: Readonly<DocumentLocation>,
  rotation: DocumentLocationRotation,
): Readonly<DocumentLocation> | null {
  const normalized = normalizeDocumentLocation(location);
  if (!normalized) return null;
  const { page, xRatio, yRatio } = normalized;
  return normalizeDocumentLocation(
    rotation === 90
      ? { page, xRatio: 1 - yRatio, yRatio: xRatio }
      : rotation === 180
        ? { page, xRatio: 1 - xRatio, yRatio: 1 - yRatio }
        : rotation === 270
          ? { page, xRatio: yRatio, yRatio: 1 - xRatio }
          : normalized,
  );
}
