// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal package-integration example for the generated default viewer UI.
 *
 * This intentionally contains only the essential host lookup, explicit PDF.js
 * worker/runtime setup, viewer construction, event handling, and final cleanup.
 * It is a concise source reference rather than the runnable repository demo;
 * use `npm run demo` to launch the interactive URL-loading example.
 *
 * In an installed consumer application, import from `@unilarva/pdfjs-viewer`
 * and import `@unilarva/pdfjs-viewer/default-ui.css` through the application's
 * bundler. The relative source import below keeps this repository example
 * directly type-checkable before the package is published.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 */

import { PdfjsViewerRuntime, PdfjsViewer } from "../src/index.js";
import * as pdfjs from "pdfjs-dist";
// In an application bundler, also import `@unilarva/pdfjs-viewer/default-ui.css`.

const rootEl = document.querySelector<HTMLElement>("#pdf-viewer");
if (!rootEl) throw new Error("Missing #pdf-viewer host");

const runtime = new PdfjsViewerRuntime({ pdfjs, workerSrc: "/pdf.worker.min.mjs" });

const viewer = new PdfjsViewer({
  rootEl,
  runtime,
});

rootEl.addEventListener("pdf:pagechange", event => {
  console.log("Page", (event as CustomEvent<{ page: number }>).detail.page);
});

void viewer.load("/example.pdf");

window.addEventListener(
  "pagehide",
  () => {
    viewer.destroy();
    runtime.destroy();
  },
  { once: true },
);
