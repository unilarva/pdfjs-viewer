// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { build } from "esbuild";
import { createServer } from "node:http";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createBrotliCompress, createGzip } from "node:zlib";
import {
  demoHost,
  demoNativePrintSupport,
  demoPdfjsVersionPolicy,
  demoPort,
  demoPrintMode,
} from "./demo-host.mjs";
import { makeDemoSamplePdf } from "./demo-pdf.mjs";

const packageDir = path.resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(packageDir, ".demo-dist");
const port = demoPort();
const host = demoHost();
const pdfjsVersionPolicy = demoPdfjsVersionPolicy();
const printMode = demoPrintMode();
const nativePrintSupport = demoNativePrintSupport();
const pdfWorkerPath = fileURLToPath(import.meta.resolve("pdfjs-dist/build/pdf.worker.min.mjs"));
const standardFontsPath = path.resolve(dirname(pdfWorkerPath), "../standard_fonts");
const standardFontFiles = (await readdir(standardFontsPath)).filter(filename =>
  /\.(?:pfb|ttf)$/i.test(filename),
);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const [coreCss, defaultUiThemeCss] = await Promise.all([
  readFile(path.join(packageDir, "src/core.css"), "utf8"),
  readFile(path.join(packageDir, "src/default-ui-theme.css"), "utf8"),
]);

await build({
  entryPoints: [path.join(packageDir, "examples/demo.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  define: {
    __PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY__: JSON.stringify(pdfjsVersionPolicy),
    __PDFJS_VIEWER_DEMO_PRINT_MODE__: JSON.stringify(printMode),
    __PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT__: JSON.stringify(nativePrintSupport),
  },
  outfile: path.join(outDir, "demo.js"),
  sourcemap: true,
});

await Promise.all([
  cp(path.join(packageDir, "examples/index.html"), path.join(outDir, "index.html")),
  cp(path.join(packageDir, "examples/demo.css"), path.join(outDir, "demo.css")),
  cp(
    path.join(packageDir, "assets/icons/unilarva-pdfjs-viewer-logo-adaptive.svg"),
    path.join(outDir, "favicon.svg"),
  ),
  writeFile(path.join(outDir, "default-ui.css"), `${coreCss}\n${defaultUiThemeCss}`),
  cp(pdfWorkerPath, path.join(outDir, "pdf.worker.min.mjs")),
  cp(standardFontsPath, path.join(outDir, "standard_fonts"), { recursive: true }),
]);

const samplePdf = makeDemoSamplePdf();
const compressionThreshold = 1024;
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/demo.js", ["demo.js", "text/javascript; charset=utf-8"]],
  ["/demo.js.map", ["demo.js.map", "application/json"]],
  ["/demo.css", ["demo.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/default-ui.css", ["default-ui.css", "text/css; charset=utf-8"]],
  ["/pdf.worker.min.mjs", ["pdf.worker.min.mjs", "text/javascript; charset=utf-8"]],
]);
for (const filename of standardFontFiles) {
  files.set(`/standard_fonts/${filename}`, [
    `standard_fonts/${filename}`,
    filename.endsWith(".ttf") ? "font/ttf" : "application/octet-stream",
  ]);
}

function preferredContentEncoding(acceptEncoding) {
  const encodings = new Map();
  for (const value of acceptEncoding.split(",")) {
    const [name, ...parameters] = value.trim().toLowerCase().split(";");
    if (!name) continue;

    const quality = parameters.find(parameter => /^q\s*=/i.test(parameter.trim()));
    const weight = quality ? Number.parseFloat(quality.slice(quality.indexOf("=") + 1)) : 1;
    encodings.set(name, Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
  }

  const weightFor = encoding => encodings.get(encoding) ?? encodings.get("*") ?? 0;
  const brotliWeight = weightFor("br");
  const gzipWeight = weightFor("gzip");
  if (brotliWeight > 0 && brotliWeight >= gzipWeight) return "br";
  if (gzipWeight > 0) return "gzip";
  return undefined;
}

function sendResponse(request, response, status, contentType, contents) {
  const contentEncoding =
    contents.length >= compressionThreshold
      ? preferredContentEncoding(request.headers["accept-encoding"] ?? "")
      : undefined;
  const headers = { "Content-Type": contentType };

  if (!contentEncoding) {
    headers["Content-Length"] = contents.length;
    response.writeHead(status, headers);
    response.end(contents);
    return;
  }

  headers["Content-Encoding"] = contentEncoding;
  headers.Vary = "Accept-Encoding";
  response.writeHead(status, headers);
  Readable.from(contents)
    .pipe(contentEncoding === "br" ? createBrotliCompress() : createGzip())
    .pipe(response);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/sample.pdf") {
    sendResponse(request, response, 200, "application/pdf", samplePdf);
    return;
  }

  const entry = files.get(url.pathname);
  if (!entry) {
    sendResponse(request, response, 404, "text/plain; charset=utf-8", Buffer.from("Not found"));
    return;
  }

  try {
    const [filename, contentType] = entry;
    const contents = await readFile(path.join(outDir, filename));
    sendResponse(request, response, 200, contentType, contents);
  } catch (error) {
    console.error(error);
    sendResponse(
      request,
      response,
      500,
      "text/plain; charset=utf-8",
      Buffer.from("Unable to read demo asset"),
    );
  }
}).listen({ port, host }, () => {
  const displayHost = host.includes(":") ? `[${host}]` : host;
  console.log(`@unilarva/pdfjs-viewer demo: http://${displayHost}:${port}`);
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    console.warn(
      "Development-only LAN exposure: do not use this demo server as a production host.",
    );
  }
  if (pdfjsVersionPolicy === "allow-unqualified") {
    console.warn("Development-only PDF.js override: this version is not package-qualified.");
  }
  if (nativePrintSupport) {
    console.warn(
      `Testing-only native print compatibility override: ${nativePrintSupport} on all recognized engines.`,
    );
  }
});
