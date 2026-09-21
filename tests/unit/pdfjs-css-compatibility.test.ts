// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("qualified PDF.js peer unions accept only exact stable releases", async () => {
  const { parseExactPdfjsVersionUnion } = await import(
    `${process.cwd()}/scripts/pdfjs-version-manifest.mjs`
  );
  assert.deepEqual(parseExactPdfjsVersionUnion("6.3.289|| 6.4.100"), ["6.3.289", "6.4.100"]);
  assert.throws(() => parseExactPdfjsVersionUnion("6.3.*"), /only exact stable versions/);
});

test("CSS qualification reports category, selector, declaration, and version drift", async () => {
  const { validatePdfjsCssCompatibility } = await import(
    `${process.cwd()}/scripts/pdfjs-css-compatibility.mjs`
  );
  const manifest = [
    {
      category: "fixture",
      upstream: [[".upstream", "display", "flex"]],
      local: [[".local", "display", "flex"]],
      sentinels: ["fixtureClass"],
      divergences: [{ id: "fixture", reason: "Fixture uses a smaller contract." }],
    },
  ] as const;
  validatePdfjsCssCompatibility({
    upstreamCss: ".upstream { display: flex; }",
    localCss: ".local { display: flex; }",
    runtimeSource: "fixtureClass",
    version: "1.2.3",
    manifest,
  });
  assert.throws(
    () =>
      validatePdfjsCssCompatibility({
        upstreamCss: ".upstream { display: block; }",
        localCss: ".local {}",
        runtimeSource: "",
        version: "1.2.3",
        manifest,
      }),
    /fixture.*\.upstream.*display: flex.*1\.2\.3/s,
  );
});

test("CSS qualification preserves commas inside multiline functional selectors", async () => {
  const { validatePdfjsCssCompatibility } = await import(
    `${process.cwd()}/scripts/pdfjs-css-compatibility.mjs`
  );
  const manifest = [
    {
      category: "fixture",
      upstream: [],
      local: [[".local :is(.first input, .second textarea)", "display", "flex"]],
      sentinels: [],
      divergences: [{ id: "fixture", reason: "Fixture uses a smaller contract." }],
    },
  ] as const;
  validatePdfjsCssCompatibility({
    upstreamCss: "",
    localCss: `.local
      :is(
        .first input,
        .second textarea
      ) {
        display: flex;
      }`,
    runtimeSource: "",
    version: "1.2.3",
    manifest,
  });
});

test("CSS qualification never credits nested declarations to the parent selector", async () => {
  const { validatePdfjsCssCompatibility } = await import(
    `${process.cwd()}/scripts/pdfjs-css-compatibility.mjs`
  );
  const manifest = [
    {
      category: "fixture",
      upstream: [[".parent", "display", "flex"]],
      local: [],
      sentinels: [],
      divergences: [{ id: "fixture", reason: "Fixture uses a smaller contract." }],
    },
  ] as const;
  assert.throws(
    () =>
      validatePdfjsCssCompatibility({
        upstreamCss: ".parent { .child { display: flex; } }",
        localCss: "",
        runtimeSource: "",
        version: "1.2.3",
        manifest,
      }),
    /upstream selector \.parent requires display: flex/,
  );
});

test("CSS qualification never credits conditional declarations to the base selector", async () => {
  const { validatePdfjsCssCompatibility } = await import(
    `${process.cwd()}/scripts/pdfjs-css-compatibility.mjs`
  );
  const manifest = [
    {
      category: "fixture",
      upstream: [[".base", "display", "flex"]],
      local: [],
      sentinels: [],
      divergences: [{ id: "fixture", reason: "Fixture uses a smaller contract." }],
    },
  ] as const;
  assert.throws(
    () =>
      validatePdfjsCssCompatibility({
        upstreamCss: "@media print { .base { display: flex; } }",
        localCss: "",
        runtimeSource: "",
        version: "1.2.3",
        manifest,
      }),
    /upstream selector \.base is missing/,
  );
});

test("CSS qualification reads the supplied candidate runtime module", async () => {
  const { checkPdfjsCssCompatibility } = await import(
    `${process.cwd()}/scripts/pdfjs-css-compatibility.mjs`
  );
  const candidate = await mkdtemp(join(tmpdir(), "pdfjs-css-candidate-"));
  const runtimeModule = join(candidate, "legacy-runtime.mjs");
  const manifest = [
    {
      category: "fixture",
      upstream: [[".upstream", "display", "flex"]],
      local: [],
      sentinels: ["legacy-sentinel"],
      divergences: [{ id: "fixture", reason: "Fixture uses a smaller contract." }],
    },
  ] as const;
  try {
    await mkdir(join(candidate, "web"));
    await writeFile(join(candidate, "web/pdf_viewer.css"), ".upstream { display: flex; }");
    await writeFile(runtimeModule, "legacy-sentinel");
    await checkPdfjsCssCompatibility(candidate, runtimeModule, "1.2.3", manifest);
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
});
