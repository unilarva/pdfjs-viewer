// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
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

test("demo blocks file-drop navigation outside its URL field and preserves other drops", async () => {
  const loads: unknown[] = [];
  const elements = new Map(
    [
      "#pdf-form",
      "#pdf-url",
      "#pdf-file",
      "#pdf-file-button",
      "#pdf-change-button",
      "#pdf-controls",
      "#sample-pdf-button",
      "#pdf-viewer",
      "#demo-status",
    ].map(selector => [
      selector,
      Object.assign(new EventTarget(), {
        value: selector === "#pdf-url" ? "./sample.pdf" : "",
        dataset: {} as Record<string, string>,
        setAttribute() {},
        removeAttribute() {},
      }),
    ]),
  );
  const documentListeners = new Map<string, (event: Event) => void>();
  const document = {
    querySelector: (selector: string) => elements.get(selector),
    addEventListener: (
      name: string,
      listener: (event: Event) => void,
      options: AddEventListenerOptions,
    ) => {
      assert.equal(options.capture, true, "guard runs before target handlers");
      documentListeners.set(name, listener);
    },
  };
  const result = await build({
    entryPoints: ["examples/demo.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    define: {
      __PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY__: '"qualified-only"',
      __PDFJS_VIEWER_DEMO_PRINT_MODE__: '"off"',
      __PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT__: "null",
    },
    plugins: [
      {
        name: "mock-demo-viewer",
        setup(plugin) {
          plugin.onResolve({ filter: /^(?:\.\.\/src\/index\.js|pdfjs-dist)$/ }, args => ({
            path: args.path,
            namespace: "mock",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
            contents:
              args.path === "pdfjs-dist"
                ? "export {};"
                : `
            export class PdfjsViewerRuntime {}
            export class PdfjsViewer { async load(source) { loads.push(source); } }
          `,
            loader: "js",
          }));
        },
      },
    ],
  });
  runInNewContext(result.outputFiles[0].text, {
    document,
    loads,
    URL,
    URLSearchParams,
    window: {
      location: { search: "", href: "https://example.test/" },
      history: { replaceState() {} },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {},
    },
  });
  assert.equal(loads.length, 1);
  assert.equal(loads[0], "./sample.pdf");

  for (const selector of ["#pdf-viewer", "#pdf-file-button", "#pdf-controls", "#pdf-url"]) {
    for (const type of ["dragover", "drop"]) {
      const event = new Event(type, { cancelable: true });
      const dataTransfer = {
        types: ["Files"],
        dropEffect: "copy",
        files: [
          {
            name: "dropped.pdf",
            arrayBuffer: async () => new ArrayBuffer(1),
          },
        ],
      };
      Object.defineProperties(event, {
        target: { value: elements.get(selector) },
        dataTransfer: { value: dataTransfer },
      });
      documentListeners.get(type)!(event);
      assert.equal(event.defaultPrevented, true);
      if (type === "dragover") {
        assert.equal(dataTransfer.dropEffect, selector === "#pdf-url" ? "copy" : "none");
      }
      elements.get(selector)!.dispatchEvent(event);
      if (selector === "#pdf-url" && type === "dragover") {
        assert.equal(dataTransfer.dropEffect, "copy");
        assert.equal(elements.get(selector)!.dataset.dragging, "true");
      }
    }
    // Local file loading resumes after reading the dropped file's bytes.
    await setImmediate();
    assert.equal(loads.length, selector === "#pdf-url" ? 2 : 1);
  }
  assert.ok(loads[1] instanceof ArrayBuffer);
  assert.equal(elements.get("#pdf-url")!.value, "dropped.pdf");
  assert.equal(elements.get("#pdf-url")!.dataset.dragging, undefined);

  for (const type of ["dragover", "drop"]) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["text/plain", "text/uri-list"], files: [] },
    });
    documentListeners.get(type)!(event);
    elements.get("#pdf-url")!.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
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
