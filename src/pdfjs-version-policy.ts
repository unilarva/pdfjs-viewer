// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public qualified PDF.js release policy for {@link PdfjsViewerRuntime}.
 *
 * Only these exact releases have passed the package's API, CSS, and browser
 * qualification procedure. See the [architecture guide](../ARCHITECTURE.md)
 * before changing this list.
 * @packageDocumentation
 * @module pdfjs-version-policy
 */

/** Exact PDF.js releases qualified by this package release. */
export const PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS = Object.freeze(["6.3.289"] as const);

/** PDF.js runtime version admission policy. */
export type PdfjsViewerPdfjsVersionPolicy = "qualified-only" | "allow-unqualified";
