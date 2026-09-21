// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { formatPdfDate } from "../../src/pdf-date.js";

test("PDF date formatting preserves source wall time and normalizes its encoded offset", () => {
  assert.equal(formatPdfDate("D:20260809043855+03'00'"), "2026-08-09 04:38:55 +03:00");
  assert.equal(formatPdfDate("D:20261231235959-05'30'"), "2026-12-31 23:59:59 -05:30");
  assert.equal(formatPdfDate("D:20260201020304Z"), "2026-02-01 02:03:04 +00:00");
});

test("PDF date formatting retains valid partial precision", () => {
  assert.equal(formatPdfDate("D:2026"), "2026");
  assert.equal(formatPdfDate("D:202608"), "2026-08");
  assert.equal(formatPdfDate("D:20260809"), "2026-08-09");
  assert.equal(formatPdfDate("202608090438"), "2026-08-09 04:38");
});

test("PDF date formatting leaves malformed or impossible values untouched", () => {
  for (const value of [
    "not-a-date",
    "D:20261301",
    "D:20260230",
    "D:20260809246000",
    "D:20260809043855+24'00'",
  ]) {
    assert.equal(formatPdfDate(value), value);
  }
});
