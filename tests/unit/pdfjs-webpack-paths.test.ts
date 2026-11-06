// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

// Exercise exact upstream URL contexts, offset ownership, and expected site counts.

import assert from "node:assert/strict";
import test from "node:test";
import { validateWebpackPdfjsFileUrls } from "../../scripts/pdfjs-webpack-paths.mjs";

/** Representative emitted expressions with independently renameable identifiers. */
function fixture(variant: "standard" | "legacy", jpeg: "old" | "new" = "new") {
  const base = `file:///audit/node_modules/pdfjs-dist/${variant === "legacy" ? "legacy/" : ""}build`;
  const input = { variant, displayUrl: `${base}/pdf.mjs`, workerUrl: `${base}/pdf.worker.mjs` };
  const canvas = `class Canvas{_createCanvas(width,height){return process.getBuiltinModule("module").createRequire("${input.displayUrl}")("@napi-rs/canvas").createCanvas(width,height)}}`;
  const polyfill = `if(isNode){let nativeCanvas;try{const require=process.getBuiltinModule("module").createRequire("${input.displayUrl}");try{nativeCanvas=require("@napi-rs/canvas")}catch(error){}}catch(error){}}`;
  const factory = "async function(arg={}){var module=arg";
  const quit = ",quit=(code,reason)=>{throw reason}";
  const site = `;try{new URL(".","${input.workerUrl}").href}catch{}`;
  const jbig2 = `const jbig2=${factory}${quit}${site}console.log.bind(console);var memory,heap,error=console.error.bind(console),ready=!1;function grow(){}};`;
  const openjpeg =
    jpeg === "old"
      ? `const jpeg=${factory},program="./this.program"${quit}${site}var memory,heap,log=console.log.bind(console),error=console.error.bind(console),ready=!1;function grow(){}};`
      : `const jpeg=${factory}${site}var memory,log=console.log.bind(console),error=console.error.bind(console);function grow(){}};`;
  return {
    input,
    canvas,
    polyfill,
    jbig2,
    openjpeg,
    consumer: canvas + (variant === "legacy" ? polyfill : ""),
    worker: jbig2 + openjpeg,
  };
}

for (const variant of ["standard", "legacy"] as const) {
  test(`Webpack URL policy accepts exact ${variant} display sites`, () => {
    const f = fixture(variant);
    assert.deepEqual(
      validateWebpackPdfjsFileUrls({ ...f.input, file: "consumer.js", source: f.consumer }),
      Array(variant === "legacy" ? 2 : 1).fill(f.input.displayUrl),
    );
  });
  for (const jpeg of ["old", "new"] as const) {
    test(`Webpack URL policy accepts ${variant} JBig2 and ${jpeg} OpenJPEG bootstraps`, () => {
      const f = fixture(variant, jpeg);
      assert.deepEqual(
        validateWebpackPdfjsFileUrls({ ...f.input, file: "worker.js", source: f.worker }),
        [f.input.workerUrl, f.input.workerUrl],
      );
    });
  }
}

test("Webpack URL exemptions do not extend to unrelated occurrences of the same worker URL", () => {
  const f = fixture("standard");
  for (const unrelated of [
    `globalThis.unrelatedBrowserFacingUrl="${f.input.workerUrl}";`,
    `const unrelated="${f.input.workerUrl}";`,
    `fetch("${f.input.workerUrl}");`,
    `new URL(".","${f.input.workerUrl}");`,
    `try{new URL(".","${f.input.workerUrl}").href}catch{}`,
  ]) {
    // Reject both a standalone impostor and one appended to a valid known bundle.
    for (const source of [unrelated, f.worker + unrelated])
      assert.throws(
        () => validateWebpackPdfjsFileUrls({ ...f.input, file: "worker.js", source }),
        /Unexpected local file URL/,
      );
  }
});

test("Webpack display exemptions require the complete native canvas context", () => {
  const f = fixture("legacy");
  for (const unrelated of [
    `globalThis.unrelated="${f.input.displayUrl}";`,
    `other.createRequire("${f.input.displayUrl}");`,
    f.canvas.replace('getBuiltinModule("module")', 'getBuiltinModule("other")'),
    f.canvas.replace('("@napi-rs/canvas")', '("other")'),
    f.canvas.replace(".createCanvas(width,height)", ".createCanvas(height,width)"),
    f.polyfill.replace("nativeCanvas=require(", "otherCanvas=require("),
  ])
    assert.throws(
      () =>
        validateWebpackPdfjsFileUrls({
          ...f.input,
          file: "consumer.js",
          source: f.consumer + unrelated,
        }),
      /Unexpected local file URL/,
    );
});

test("Webpack worker exemptions require bootstrap argument, quit, and console bindings", () => {
  const f = fixture("standard");
  for (const source of [
    f.worker.replace("var module=arg", "var module=other"),
    f.worker.replace("throw reason", "throw code"),
    f.worker.replace("console.error.bind", "console.warn.bind"),
    f.worker.replace(f.jbig2, `globalThis.unrelated="${f.input.workerUrl}";`),
  ])
    assert.throws(
      () => validateWebpackPdfjsFileUrls({ ...f.input, file: "worker.js", source }),
      /Unexpected local file URL/,
    );
});

test("Webpack URL policy rejects duplicate and missing recognized sites", () => {
  const f = fixture("legacy");
  for (const [file, source] of [
    ["consumer.js", f.consumer + f.canvas],
    ["consumer.js", f.consumer + f.polyfill],
    ["consumer.js", f.canvas],
    ["consumer.js", ""],
    ["worker.js", f.worker + f.jbig2],
    ["worker.js", f.worker + f.openjpeg],
    ["worker.js", f.jbig2],
    ["worker.js", f.openjpeg],
    ["worker.js", ""],
    ["worker.js", f.worker + fixture("legacy", "old").openjpeg],
  ])
    assert.throws(
      () => validateWebpackPdfjsFileUrls({ ...f.input, file, source }),
      /file-URL occurrence count/,
    );
});

test("Webpack URL policy does not allow a Node polyfill in standard output", () => {
  const f = fixture("standard");
  assert.throws(
    () =>
      validateWebpackPdfjsFileUrls({
        ...f.input,
        file: "consumer.js",
        source: f.consumer + f.polyfill,
      }),
    /Node polyfill.*expected 0, found 1/,
  );
});

test("Webpack URL policy checks exact selected paths and asset identity", () => {
  const f = fixture("standard");
  for (const [file, source] of [
    ["worker.js", f.worker.replace(f.input.workerUrl, "file:///different/pdf.worker.mjs")],
    ["consumer.js", f.consumer.replace(f.input.displayUrl, f.input.workerUrl)],
    ["extra.js", f.worker],
    ["worker.js", f.consumer],
  ])
    assert.throws(
      () => validateWebpackPdfjsFileUrls({ ...f.input, file, source }),
      /Unexpected local file URL/,
    );
  assert.deepEqual(
    validateWebpackPdfjsFileUrls({ ...f.input, file: "extra.js", source: "console.log(1)" }),
    [],
  );
});

test("Webpack known-site recognition permits consistent minifier identifier changes", () => {
  const f = fixture("legacy");
  const consumer = f.consumer.replaceAll("width", "$width").replaceAll("height", "_height$");
  const worker = f.worker.replaceAll("arg", "$input").replaceAll("reason", "_reason$");
  assert.equal(
    validateWebpackPdfjsFileUrls({ ...f.input, file: "consumer.js", source: consumer }).length,
    2,
  );
  assert.equal(
    validateWebpackPdfjsFileUrls({ ...f.input, file: "worker.js", source: worker }).length,
    2,
  );
});
