// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { interpretCatalogPageLayout } from "../../src/catalog-page-layout.js";

test("catalog PageLayout has one viewer and print interpretation", () => {
  assert.deepEqual(interpretCatalogPageLayout("SinglePage"), {
    viewerPageLayout: "single",
    printPreference: "single",
  });
  assert.deepEqual(interpretCatalogPageLayout("OneColumn"), {
    viewerPageLayout: "single",
    printPreference: "single",
  });
  assert.deepEqual(interpretCatalogPageLayout("TwoPageLeft"), {
    viewerPageLayout: "double",
    printPreference: "two-left",
  });
  assert.deepEqual(interpretCatalogPageLayout("TwoColumnRight"), {
    viewerPageLayout: "book",
    printPreference: "two-right",
  });
  assert.equal(interpretCatalogPageLayout("Unknown"), null);
  assert.equal(interpretCatalogPageLayout(null), null);
});
