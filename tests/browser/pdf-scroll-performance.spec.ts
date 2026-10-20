// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test.skip(
  !process.env.PDFJS_VIEWER_BENCHMARK_PDF || process.env.PDFJS_VIEWER_OCG_BENCHMARK !== "1",
  "Opt-in external-PDF scrolling probe",
);
const initialPage = Number((process.env.PDFJS_VIEWER_BENCHMARK_PAGES ?? "1").split(",")[0]);

for (const fontRendering of ["native", "geometric"] as const)
  test(`fast scroll timing: ${fontRendering}`, async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto(`/?profile=1&font=${fontRendering}`);
    expect(
      await page.evaluate(
        async initialPage =>
          (await window.ocgBenchmark.viewer.load("/external-benchmark.pdf", { initialPage })).ok,
        initialPage,
      ),
    ).toBe(true);
    const trace = await page.evaluate(async () => {
      const { viewer, logs } = window.ocgBenchmark;
      const count = viewer.state.pageCount;
      const targets = [
        ...new Set(
          [0.35, 0.45, 0.55, 0.65, 0.75].map(fraction => Math.max(1, Math.floor(count * fraction))),
        ),
      ];
      const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
      logs.length = 0;
      const steps = [];
      for (const pageNo of targets) {
        const wrapper = document.querySelector<HTMLElement>(`.pdf-page[data-page="${pageNo}"]`)!;
        container.scrollTop +=
          wrapper.getBoundingClientRect().top - container.getBoundingClientRect().top;
        steps.push({ at: performance.now(), pageNo });
        // Two animation frames admit en-route demand while still moving quickly.
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      const stoppedAt = performance.now();
      const target = targets.at(-1)!;
      const canvas = document.querySelector<HTMLCanvasElement>(
        `.pdf-page[data-page="${target}"] canvas:not(.pdf-detail-canvas)`,
      )!;
      return { steps, stoppedAt, target, hadBitmapAtStop: canvas.width > 0 && canvas.height > 0 };
    });
    if (!trace.hadBitmapAtStop)
      await expect
        .poll(
          () =>
            page.evaluate(
              target =>
                window.ocgBenchmark.logs.some(
                  log =>
                    log.entry.event === "page-render-completed" &&
                    log.entry.details?.pageNo === target,
                ),
              trace.target,
            ),
          { timeout: 120_000 },
        )
        .toBe(true);
    const report = await page.evaluate(
      ({ trace, fontRendering }) => {
        const logs = window.ocgBenchmark.logs.slice();
        const completion = logs.find(
          log =>
            log.entry.event === "page-render-completed" &&
            log.entry.details?.pageNo === trace.target,
        );
        const admission = logs.find(
          log =>
            log.entry.event === "page-render-admitted" &&
            log.entry.details?.pageNo === trace.target,
        );
        const raster = logs.find(
          log =>
            log.entry.event === "page-render-started" && log.entry.details?.pageNo === trace.target,
        );
        return {
          fontRendering,
          ...trace,
          admissionAfterStopMs: admission ? admission.at - trace.stoppedAt : null,
          rasterAfterStopMs: raster ? raster.at - trace.stoppedAt : null,
          completionAfterStopMs: completion ? completion.at - trace.stoppedAt : null,
          logs,
          caveats: [
            "Real scroll events, no artificial task delay.",
            "Two RAFs between jumps; actual step intervals are recorded, not assumed constant.",
            "Negative latencies mean demand was admitted or completed before the final stop.",
            "An already-cached target needs no new render; missing lifecycle timings are null.",
            "Default balanced buffer/concurrency; worker backlog is not isolated CPU measurement.",
          ],
        };
      },
      { trace, fontRendering },
    );
    const output = testInfo.outputPath("pdf-scroll-performance.json");
    await writeFile(
      output,
      JSON.stringify(
        { browser: { project: testInfo.project.name, version: browser.version() }, ...report },
        null,
        2,
      ),
    );
    await testInfo.attach("pdf-scroll-performance.json", {
      path: output,
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        fontRendering,
        target: report.target,
        admissionAfterStopMs: report.admissionAfterStopMs,
        rasterAfterStopMs: report.rasterAfterStopMs,
        completionAfterStopMs: report.completionAfterStopMs,
        hadBitmapAtStop: report.hadBitmapAtStop,
      }),
    );
    await page.evaluate(async () => window.ocgBenchmark.viewer.destroy());
  });
