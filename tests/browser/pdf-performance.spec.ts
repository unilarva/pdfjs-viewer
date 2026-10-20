// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test.skip(
  !process.env.PDFJS_VIEWER_BENCHMARK_PDF || process.env.PDFJS_VIEWER_OCG_BENCHMARK !== "1",
  "Opt in with benchmark-ocg.mjs and an external PDF path",
);
const pages = (process.env.PDFJS_VIEWER_BENCHMARK_PAGES ?? "1").split(",").map(Number);
if (pages.some(page => !Number.isSafeInteger(page) || page < 1))
  throw new Error("Invalid benchmark pages");
const concurrency = process.env.PDFJS_VIEWER_BENCHMARK_CONCURRENCY;
const buffer = process.env.PDFJS_VIEWER_BENCHMARK_BUFFER;
if (
  concurrency !== undefined &&
  (!Number.isSafeInteger(Number(concurrency)) || Number(concurrency) < 1)
)
  throw new Error("Invalid concurrency");
if (buffer !== undefined && (!Number.isFinite(Number(buffer)) || Number(buffer) < 0))
  throw new Error("Invalid buffer");

for (const pageNo of pages)
  for (const fontRendering of ["native", "geometric"] as const) {
    test(`PDF performance: page ${pageNo}, ${fontRendering}`, async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 1280, height: 900 });
      const query = new URLSearchParams({
        profile: "1",
        font: fontRendering,
        ...(concurrency === undefined ? {} : { concurrency }),
        ...(buffer === undefined ? {} : { buffer }),
      });
      await page.goto(`/?${query}`);
      const load = await page.evaluate(async pageNo => {
        const started = performance.now();
        const result = await window.ocgBenchmark.viewer.load("/external-benchmark.pdf", {
          initialPage: pageNo,
        });
        return { started, loadMs: performance.now() - started, ok: result.ok };
      }, pageNo);
      expect(load.ok).toBe(true);
      await expect
        .poll(
          () =>
            page.evaluate(
              pageNo =>
                window.ocgBenchmark.logs.some(
                  log =>
                    log.entry.event === "page-render-completed" &&
                    log.entry.details?.pageNo === pageNo,
                ),
              pageNo,
            ),
          { timeout: 120_000 },
        )
        .toBe(true);
      const initial = await page.evaluate(
        async ({ pageNo, started }) => {
          const { viewer, logs } = window.ocgBenchmark;
          const completion = logs.find(
            log =>
              log.entry.event === "page-render-completed" && log.entry.details?.pageNo === pageNo,
          )!;
          const render = logs.find(
            log =>
              log.entry.event === "benchmark-pdfjs-render-completed" &&
              log.entry.details?.pageNo === pageNo,
          )!.entry.details!;
          const metadataStarted = performance.now();
          const info = await viewer.getDocumentInformation();
          const metadataMs = performance.now() - metadataStarted;
          const layerStarted = performance.now();
          const layers = viewer.getLayers();
          const getLayersMs = performance.now() - layerStarted;
          // Snapshot before destroy cancels nearby speculative work.
          const snapshot = logs.slice();
          await viewer.destroy();
          return {
            firstRasterMs: completion.at - started,
            pipeline: completion.entry.details,
            render,
            metadataMs,
            getLayersMs,
            layersOk: layers.ok,
            metadataOk: info.ok,
            logs: snapshot,
          };
        },
        { pageNo, started: load.started },
      );
      const scale = Number(initial.render.viewportScale);
      const annotationMode = Number(initial.render.annotationMode);
      expect(scale).toBeGreaterThan(0);
      const bare = await page.evaluate(
        async ({ pageNo, scale, annotationMode }) =>
          window.ocgBenchmark.profilePage(pageNo, scale, annotationMode, false),
        { pageNo, scale, annotationMode },
      );
      expect(bare.canvasWidth).toBe(initial.render.canvasWidth);
      expect(bare.canvasHeight).toBe(initial.render.canvasHeight);
      const operatorList = await page.evaluate(
        async ({ pageNo, scale, annotationMode }) =>
          window.ocgBenchmark.profilePage(pageNo, scale, annotationMode, true),
        { pageNo, scale, annotationMode },
      );
      const report = {
        schemaVersion: 1,
        browser: { project: testInfo.project.name, version: browser.version() },
        pdfjsVersion: "6.4.299",
        pageNo,
        fontRendering,
        concurrency: Number(concurrency ?? 3),
        bufferViewportHeights: Number(buffer ?? 16),
        viewport: { width: 1280, height: 900 },
        loadMs: load.loadMs,
        ...initial,
        bare,
        operatorList,
        caveats: [
          "Local no-store HTTP source; fresh PDF.js documents/workers, not cold OS/browser resource caches.",
          "Viewer runs first, then bare PDF.js; repeated samples do not eliminate ordering/cache effects.",
          "Bare native rendering matches viewport scale and DPR=1, but excludes text/annotations/sidebar/prerender and geometric font preparation.",
          "PDF.js Page Request ends at display readiness, not completion of all streamed operators.",
          "PDF.js Rendering includes streaming/resource waits and scheduling, not isolated canvas CPU/GPU time.",
          "Explicit operator-list probe runs in a separate fresh document, never before a measured cold render.",
          "All-hidden uses the warm operator list; it is not an equivalent normal/unlayered PDF.",
          "Timings are descriptive with diagnostics enabled; no speed threshold or PDF.js internal memory estimate.",
        ],
      };
      const reportPath = testInfo.outputPath("pdf-performance.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      await testInfo.attach("pdf-performance.json", {
        path: reportPath,
        contentType: "application/json",
      });
      console.log(
        JSON.stringify({
          pageNo,
          fontRendering,
          loadMs: load.loadMs,
          firstRasterMs: initial.firstRasterMs,
          viewerPdfjsMs: initial.render.elapsedMs,
          bare: bare.renders,
          operatorListMs: operatorList.elapsedMs,
          operators: operatorList.count,
        }),
      );
    });
  }
