// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  compileTextQuery,
  findCompiledTextMatches,
  hasCompiledTextMatch,
} from "../../src/text-matching.js";

const smart = { caseSensitive: false, diacritics: "smart" as const };

test("matches case according to policy", () => {
  assert.equal(hasCompiledTextMatch("Alpha", compileTextQuery("alpha", smart)), true);
  assert.equal(
    hasCompiledTextMatch("Alpha", compileTextQuery("alpha", { ...smart, caseSensitive: true })),
    false,
  );
});

test("implements smart, ignore, and respect diacritic policies", () => {
  assert.equal(hasCompiledTextMatch("cafe", compileTextQuery("cafe\u0301", smart)), false);
  assert.equal(hasCompiledTextMatch("café", compileTextQuery("cafe", smart)), true);
  assert.equal(
    hasCompiledTextMatch("café", compileTextQuery("cafe", { ...smart, diacritics: "ignore" })),
    true,
  );
  assert.equal(
    hasCompiledTextMatch("café", compileTextQuery("cafe", { ...smart, diacritics: "respect" })),
    false,
  );
});

test("matches Unicode text, overlap candidates, and combining marks", () => {
  assert.equal(hasCompiledTextMatch("😀a😀a", compileTextQuery("😀a", smart)), true);
  assert.equal(hasCompiledTextMatch("aaaa", compileTextQuery("aa", smart)), true);
  assert.equal(
    hasCompiledTextMatch("e\u0301", compileTextQuery("é", { ...smart, diacritics: "respect" })),
    true,
  );
});

test("does not treat an empty compiled query as a text match", () => {
  assert.equal(hasCompiledTextMatch("Any title", compileTextQuery("", smart)), false);
});

test("reuses a compiled query across haystacks", () => {
  const query = compileTextQuery("cafe", smart);
  assert.equal(hasCompiledTextMatch("Café", query), true);
  assert.equal(hasCompiledTextMatch("decaf", query), false);
  assert.deepEqual(findCompiledTextMatches("Café", query), [{ index: 0, length: 4 }]);
  assert.deepEqual(findCompiledTextMatches("decaf", query), []);
});
