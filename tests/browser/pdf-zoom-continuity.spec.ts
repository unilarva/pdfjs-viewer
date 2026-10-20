// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test.skip(
  !process.env.PDFJS_VIEWER_BENCHMARK_PDF || process.env.PDFJS_VIEWER_OCG_BENCHMARK !== "1",
  "Opt-in external-PDF continuity probe",
);
const pageNo = Number((process.env.PDFJS_VIEWER_BENCHMARK_PAGES ?? "1").split(",")[0]);

for (const method of ["wheel", "api"] as const)
  test(`slow ${method} zoom replacement retains the actual old bitmap past the grace timeout`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("/?profile=1&font=geometric&buffer=0");
    expect(
      await page.evaluate(
        async pageNo =>
          (
            await window.ocgBenchmark.viewer.load("/external-benchmark.pdf", {
              initialPage: pageNo,
            })
          ).ok,
        pageNo,
      ),
    ).toBe(true);
    const selector = `.pdf-page[data-page="${pageNo}"] canvas:not(.pdf-detail-canvas)`;
    const old = await page.locator(selector).elementHandle();
    if (!old) throw new Error("Missing initial bitmap");
    const before = await old.evaluate(canvas => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    try {
      await page.evaluate(() => {
        window.ocgBenchmark.logs.length = 0;
        window.ocgBenchmark.renderGate = new Promise<void>(resolve => {
          window.ocgBenchmark.releaseRenders = resolve;
        });
      });
      if (method === "wheel") {
        const box = await old.boundingBox();
        if (!box) throw new Error("Missing canvas bounds");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -120);
        await page.keyboard.up("Control");
      } else
        await page.evaluate(pageNo => {
          const rect = document
            .querySelector(`.pdf-page[data-page="${pageNo}"]`)!
            .getBoundingClientRect();
          window.ocgBenchmark.viewer.zoomBy(1.5, {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        }, pageNo);
      await expect
        .poll(() =>
          page.evaluate(
            pageNo =>
              window.ocgBenchmark.logs.some(
                log =>
                  log.entry.event === "benchmark-pdfjs-render-started" &&
                  log.entry.details?.pageNo === pageNo,
              ),
            pageNo,
          ),
        )
        .toBe(true);
      // Intentional time-boundary test: hold replacement past the production 1200ms grace period.
      await page.waitForTimeout(1800);
      const held = await old.evaluate(canvas => ({
        connected: canvas.isConnected,
        width: (canvas as HTMLCanvasElement).width,
        height: (canvas as HTMLCanvasElement).height,
      }));
      const logs = await page.evaluate(() => window.ocgBenchmark.logs);
      await writeFile(
        testInfo.outputPath("zoom-held.json"),
        JSON.stringify({ before, held, logs }, null, 2),
      );
      expect(held.connected).toBe(true);
      expect(held.width).toBe(before.width);
      expect(held.height).toBe(before.height);
      await page.evaluate(() => {
        window.ocgBenchmark.renderGate = undefined;
        window.ocgBenchmark.releaseRenders?.();
      });
      await expect
        .poll(
          () =>
            page.evaluate(
              pageNo =>
                window.ocgBenchmark.logs.some(
                  log =>
                    log.entry.event === "page-render-completed" &&
                    log.entry.details?.pageNo === pageNo &&
                    log.entry.details?.replacedExistingBitmap === true,
                ),
              pageNo,
            ),
          { timeout: 60_000 },
        )
        .toBe(true);
      const starts = await page.evaluate(
        pageNo =>
          window.ocgBenchmark.logs.filter(
            log =>
              log.entry.event === "benchmark-pdfjs-render-started" &&
              log.entry.details?.pageNo === pageNo,
          ).length,
        pageNo,
      );
      expect(starts).toBe(1);
    } finally {
      await writeFile(
        testInfo.outputPath("zoom-final.json"),
        JSON.stringify(
          await page.evaluate(() => ({
            state: window.ocgBenchmark.viewer.state,
            logs: window.ocgBenchmark.logs,
          })),
          null,
          2,
        ),
      );
      await page.evaluate(async () => {
        window.ocgBenchmark.releaseRenders?.();
        await window.ocgBenchmark.viewer.destroy();
      });
    }
  });
