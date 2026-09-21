// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private DOM-free interpretation of the PDF catalog PageLayout preference.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module catalog-page-layout
 */

export type CatalogViewerPageLayout = "single" | "double" | "book";
export type CatalogPrintPreference = "single" | "two-left" | "two-right";

export interface CatalogPageLayoutPreference {
  readonly viewerPageLayout: CatalogViewerPageLayout;
  readonly printPreference: CatalogPrintPreference;
}

/** Maps PDF.js PageLayout output to the viewer and print composition policies. */
export function interpretCatalogPageLayout(
  raw: string | null | undefined,
): Readonly<CatalogPageLayoutPreference> | null {
  switch (raw?.toLowerCase()) {
    case "singlepage":
    case "onecolumn":
      return Object.freeze({ viewerPageLayout: "single", printPreference: "single" });
    case "twopageleft":
    case "twocolumnleft":
      return Object.freeze({ viewerPageLayout: "double", printPreference: "two-left" });
    case "twopageright":
    case "twocolumnright":
      return Object.freeze({ viewerPageLayout: "book", printPreference: "two-right" });
    default:
      return null;
  }
}
