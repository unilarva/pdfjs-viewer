// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private shared PDF.js text extraction identity policy.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * Search indexing and runtime `TextLayer` presentation must consume the same
 * unnormalized marked-content stream so their text-item indices remain exact.
 * See the [architecture guide](../ARCHITECTURE.md) for text ownership details.
 *
 * @packageDocumentation
 * @module text-content-policy
 */

export const PDFJS_TEXT_CONTENT_PARAMS = Object.freeze({
  includeMarkedContent: true,
  disableNormalization: true,
});
