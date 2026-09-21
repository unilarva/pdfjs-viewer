// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  createHashNavigationStateAdapter,
  validateNavigationStateAdapter,
} from "../../src/hash-navigation-state.js";

test("hash adapter reads, writes, and preserves unrelated parameters", () => {
  const location = {
    hash: "#view=manual&section=intro&theme=dark",
    href: "https://example.test/page#view=manual&section=intro&theme=dark",
  };
  let replaced = "";
  const ownerWindow = {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: URL) => {
        replaced = url.href;
        location.hash = url.hash;
      },
    },
  } as unknown as Window;
  const adapter = createHashNavigationStateAdapter(
    { navigationDestinationParam: "section" },
    ownerWindow,
  );
  assert.equal(adapter.readNavigationDestinationId(), "intro");
  adapter.writeNavigationDestinationId("next");
  assert.match(replaced, /view=manual/);
  assert.match(replaced, /section=next/);
  assert.match(replaced, /theme=dark/);
  adapter.writeNavigationDestinationId(null);
  assert.equal(location.hash.includes("section="), false);
});

test("navigation adapter validation rejects incomplete integrations", () => {
  assert.throws(() => validateNavigationStateAdapter({} as never));
  assert.throws(() =>
    createHashNavigationStateAdapter({ navigationDestinationParam: "" }, {} as Window),
  );
});
