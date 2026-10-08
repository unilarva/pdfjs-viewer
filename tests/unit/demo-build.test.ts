// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeDemoSamplePdf } from "../../scripts/demo-pdf.mjs";

test("demo presentation styles are confined to the header, outside the default viewer", async () => {
  const css = postcss.parse(await readFile("examples/demo.css", "utf8"));
  css.walkRules(rule => {
    let parent: postcss.Root | postcss.Document | postcss.AtRule | postcss.Rule | undefined =
      rule.parent;
    while (parent && !(parent.type === "atrule" && parent.name === "scope")) {
      parent = parent.parent;
    }
    if (parent?.type === "atrule") {
      assert.equal(parent.params, "(.demo-header)");
    } else {
      assert.ok(["html,\nbody", ".demo-shell"].includes(rule.selector), rule.selector);
      rule.walkDecls(declaration => {
        assert.ok(
          [
            "margin",
            "height",
            "overflow",
            "overscroll-behavior",
            "display",
            "grid-template-rows",
          ].includes(declaration.prop),
          `Only outer page layout may be unscoped: ${declaration.prop}`,
        );
      });
    }
    assert.doesNotMatch(rule.selector, /(?:\.pdf-|#pdf-viewer|\.demo-viewer)/);
    rule.walkDecls(declaration => assert.ok(!declaration.prop.startsWith("--pdf-")));
  });
  const html = await readFile("examples/index.html", "utf8");
  assert.match(html, /<section id="pdf-viewer" aria-label="PDF viewer"><\/section>/);
  assert.match(html, /href="\.\/default-ui\.css"/);
});

test("demo sample PDF has its book outline, attachments, and odd-page chapter headings", async () => {
  const standardFontDataUrl = fileURLToPath(
    new URL("standard_fonts/", import.meta.resolve("pdfjs-dist/package.json")),
  );
  const loadingTask = getDocument({
    data: new Uint8Array(makeDemoSamplePdf()),
    standardFontDataUrl,
  });
  try {
    const pdf = await loadingTask.promise;
    assert.equal(pdf.numPages, 8);

    const outline = await pdf.getOutline();
    assert.deepEqual(
      outline?.map(item => item.title),
      ["Chapter 1", "Chapter 2", "Chapter 3"],
    );
    const outlinePages = await Promise.all(
      outline!.map(item => pdf.getPageIndex(item.dest![0] as never)),
    );
    assert.deepEqual(outlinePages, [2, 4, 6]);

    const attachments = await pdf.getAttachments();
    assert.ok(attachments);
    assert.deepEqual([...attachments.keys()].sort(), ["demo-data", "demo-readme"]);
    assert.equal(attachments.get("demo-readme")?.filename, "readme.txt");
    assert.equal(attachments.get("demo-data")?.filename, "data.json");

    for (const [chapter, targetPage] of outlinePages.entries()) {
      const chapterLabel = `Chapter ${chapter + 1}`;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const text = await page.getTextContent();
        const hasHeading = text.items.some(item => "str" in item && item.str === chapterLabel);
        assert.equal(hasHeading, pageNumber === targetPage + 1, `${chapterLabel} heading page`);
      }
    }
  } finally {
    await loadingTask.destroy();
  }
});

test("demo bundles every supported runtime policy without unresolved constants", async () => {
  const policies = [
    ["qualified native", "qualified-only", "native", null],
    ["unqualified PDF.js native", "allow-unqualified", "native", null],
    ["browser", "qualified-only", "browser", null],
    ["off", "qualified-only", "off", null],
    ["forced native landscape", "qualified-only", "off", "portrait-and-landscape"],
  ] as const;

  for (const [name, pdfjsVersionPolicy, printMode, nativePrintSupport] of policies) {
    const result = await build({
      entryPoints: ["examples/demo.ts"],
      absWorkingDir: process.cwd(),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      write: false,
      define: {
        __PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY__: JSON.stringify(pdfjsVersionPolicy),
        __PDFJS_VIEWER_DEMO_PRINT_MODE__: JSON.stringify(printMode),
        __PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT__: JSON.stringify(nativePrintSupport),
      },
    });
    assert.equal(result.outputFiles.length, 1, `${name} output count`);
    const output = result.outputFiles[0].text;
    assert.ok(output.length > 0, `${name} has output`);
    assert.doesNotMatch(
      output,
      /__PDFJS_VIEWER_DEMO_(?:PDFJS_VERSION_POLICY|PRINT_MODE|NATIVE_PRINT_SUPPORT)__/,
    );
    if (nativePrintSupport) assert.match(output, /portrait-and-landscape/);
  }
});
