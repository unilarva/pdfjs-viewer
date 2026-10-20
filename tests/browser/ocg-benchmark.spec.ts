// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type Manifest = {
  pages: number;
  alternatives: number;
  groups: Array<{ name: string; pages: number[]; visible: boolean; registered: boolean }>;
  radioFamilies: string[][];
};

test.skip(process.env.PDFJS_VIEWER_OCG_BENCHMARK !== "1", "Opt in using scripts/benchmark-ocg.mjs");
const pages = Number(process.env.PDFJS_VIEWER_OCG_PAGES ?? 240);
const registered = process.env.PDFJS_VIEWER_OCG_DEPENDENCIES === "registered";

/** Wait for real renders to settle, then a bounded quiet window, not a performance target. */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const entries = window.ocgBenchmark.logs;
          const starts = entries.filter(
            log => log.entry.event === "benchmark-pdfjs-render-started",
          );
          const ends = entries.filter(log =>
            ["benchmark-pdfjs-render-completed", "benchmark-pdfjs-render-rejected"].includes(
              log.entry.event,
            ),
          );
          const last = entries
            .filter(log =>
              /render-(started|completed|rejected|cancel-requested)$/.test(log.entry.event),
            )
            .at(-1);
          return starts.length === ends.length && (!last || performance.now() - last.at >= 250);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

for (const alternatives of [0, 2, 6, 12]) {
  test(`OCG benchmark: ${alternatives || "ordinary"} alternatives`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const query = `pages=${pages}&alternatives=${alternatives}`;
    const response = await page.request.get(`/ocg-benchmark.json?${query}`);
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as Manifest;
    const phases: unknown[] = [];
    const load = await page.evaluate(async source => {
      const { viewer, logs } = window.ocgBenchmark;
      const started = performance.now();
      const result = await viewer.load(source);
      const ready = performance.now();
      const queryStarted = performance.now();
      const layers = viewer.getLayers();
      return {
        result,
        layersOk: layers.ok,
        loadMs: ready - started,
        getLayersMs: performance.now() - queryStarted,
        started,
        logStart: logs.length,
      };
    }, `/ocg-benchmark.pdf?${query}`);
    expect(load.result.ok).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.ocgBenchmark.logs.some(
            log => log.entry.event === "page-render-completed" && log.entry.details?.pageNo === 1,
          ),
        ),
      )
      .toBe(true);
    await settle(page);
    const initial = await page.evaluate(started => {
      const { logs } = window.ocgBenchmark;
      return {
        firstMainRasterMs:
          logs.find(
            log => log.entry.event === "page-render-completed" && log.entry.details?.pageNo === 1,
          )!.at - started,
        logs: logs.slice(),
        layerInputsWhileClosed: document.querySelectorAll("input[data-pdf-layer-id]").length,
        dpr: devicePixelRatio,
        scale: window.ocgBenchmark.viewer.state.scale,
      };
    }, load.started);
    if (alternatives) {
      const groups = await page.evaluate(() => {
        const result = window.ocgBenchmark.viewer.getLayers();
        if (!result.ok) throw new Error(`Layers unavailable: ${result.reason}`);
        type Node = (typeof result.layers)[number];
        const collect = (
          nodes: readonly Node[],
        ): Array<{ id: string; name: string; visible: boolean }> =>
          nodes.flatMap(node => (node.kind === "group" ? [node] : collect(node.children)));
        return collect(result.layers);
      });
      expect(groups.length).toBe(manifest.groups.length);
      if (registered) {
        const result = await page.evaluate(
          ({ manifest, groups }) => {
            const { viewer } = window.ocgBenchmark;
            if (viewer.documentId === null) throw new Error("No ready document token");
            return viewer.setLayerPageDependencies(
              manifest.groups
                .filter(group => group.registered)
                .map(group => ({
                  id: groups.find(candidate => candidate.name === group.name)!.id,
                  pages: group.pages,
                })),
              viewer.documentId,
            );
          },
          { manifest, groups },
        );
        expect(result.ok).toBe(true);
      }
      const mutations = [
        { name: "local", changes: [{ name: "Page 1 alternative 2", visible: true }] },
        { name: "local-repeat", changes: [{ name: "Page 1 alternative 1", visible: true }] },
        { name: "shared-span", changes: [{ name: "Shared span", visible: false }] },
        { name: "shared-page-a", changes: [{ name: "Shared page A", visible: false }] },
        { name: "shared-page-b", changes: [{ name: "Shared page B", visible: false }] },
        { name: "radio-cross-page", changes: [{ name: "Radio right", visible: true }] },
        { name: "unknown-fallback", changes: [{ name: "Unknown span", visible: false }] },
        { name: "no-op", changes: [{ name: "Unknown span", visible: false }] },
        { name: "thumbnails-shared-span", changes: [{ name: "Shared span", visible: true }] },
        { name: "thumbnails-unknown-fallback", changes: [{ name: "Unknown span", visible: true }] },
      ];
      for (const mutation of mutations) {
        if (mutation.name === "thumbnails-shared-span") {
          const logStart = await page.evaluate(() => window.ocgBenchmark.logs.length);
          await page.getByRole("button", { name: "Document navigation" }).click();
          const thumbnails = page.getByRole("button", { name: "Thumbnails", exact: true });
          if ((await thumbnails.getAttribute("aria-pressed")) !== "true") await thumbnails.click();
          await expect(page.locator(".pdf-thumbnail").first()).toHaveAttribute(
            "data-pdf-thumbnail-ready",
            "",
          );
          await settle(page);
          phases.push(
            await page.evaluate(
              logStart => ({
                name: "open-thumbnails",
                logs: window.ocgBenchmark.logs.slice(logStart),
              }),
              logStart,
            ),
          );
        }
        const changes = mutation.changes.map(change => ({
          id: groups.find(group => group.name === change.name)!.id,
          visible: change.visible,
        }));
        const before = await page.evaluate(() => {
          const canvases = [
            ...document.querySelectorAll<HTMLCanvasElement>(
              ".pdf-page canvas:not(.pdf-detail-canvas)",
            ),
          ].filter(canvas => canvas.width > 0 && canvas.height > 0);
          window.ocgBenchmark.rasters = new Map(
            canvases.map(canvas => [
              Number(canvas.closest<HTMLElement>(".pdf-page")!.dataset.page),
              canvas,
            ]),
          );
          return {
            pages: canvases.map(canvas =>
              Number(canvas.closest<HTMLElement>(".pdf-page")!.dataset.page),
            ),
            firstPagePixels: window.ocgBenchmark.rasters.get(1)?.toDataURL(),
          };
        });
        const sample = await page.evaluate(async changes => {
          const { viewer, logs } = window.ocgBenchmark;
          const previous = viewer.getLayers();
          if (!previous.ok) throw new Error("Layers unavailable before mutation");
          type Node = (typeof previous.layers)[number];
          const collect = (
            nodes: readonly Node[],
          ): Array<{ id: string; name: string; visible: boolean }> =>
            nodes.flatMap(node => (node.kind === "group" ? [node] : collect(node.children)));
          const previousVisibility = new Map(
            collect(previous.layers).map(group => [group.id, group.visible]),
          );
          const logStart = logs.length;
          const started = performance.now();
          const result = await viewer.setLayerVisibility(changes);
          const mutationMs = performance.now() - started;
          const changedGroups = result.ok
            ? collect(result.layers)
                .filter(group => previousVisibility.get(group.id) !== group.visible)
                .map(({ id, name }) => ({ id, name }))
            : [];
          return { ok: result.ok, changedGroups, started, mutationMs, logStart };
        }, changes);
        expect(sample.ok).toBe(true);
        await settle(page);
        const result = await page.evaluate(({ started, logStart }) => {
          const retained: number[] = [];
          const replacedOrMissing: number[] = [];
          for (const [pageNo, canvas] of window.ocgBenchmark.rasters) {
            const current = document.querySelector<HTMLCanvasElement>(
              `.pdf-page[data-page="${pageNo}"] canvas:not(.pdf-detail-canvas)`,
            );
            (current === canvas && canvas.width > 0 ? retained : replacedOrMissing).push(pageNo);
          }
          return {
            settledMs: performance.now() - started,
            logs: window.ocgBenchmark.logs.slice(logStart),
            retainedCanvasPages: retained,
            replacedOrMissingCanvasPages: replacedOrMissing,
            firstPagePixels: document
              .querySelector<HTMLCanvasElement>(
                '.pdf-page[data-page="1"] canvas:not(.pdf-detail-canvas)',
              )
              ?.toDataURL(),
          };
        }, sample);
        const counts: Record<string, number> = {};
        for (const log of result.logs) counts[log.entry.event] = (counts[log.entry.event] ?? 0) + 1;
        if (mutation.name === "no-op")
          expect(counts["benchmark-pdfjs-render-started"] ?? 0).toBe(0);
        if (mutation.name === "local" || mutation.name === "local-repeat")
          expect(result.firstPagePixels).not.toBe(before.firstPagePixels);
        const affectedPages = [
          ...new Set(
            sample.changedGroups.flatMap(
              group => manifest.groups.find(item => item.name === group.name)!.pages,
            ),
          ),
        ].sort((a, b) => a - b);
        const unknownGroups = sample.changedGroups.filter(
          group => !manifest.groups.find(item => item.name === group.name)!.registered,
        );
        const renderPages = result.logs
          .filter(log => log.entry.event === "benchmark-pdfjs-render-started")
          .map(log => Number(log.entry.details?.pageNo));
        const cancelPages = result.logs
          .filter(log => log.entry.event === "benchmark-pdfjs-render-cancel-requested")
          .map(log => Number(log.entry.details?.pageNo));
        const unaffectedRenderPages = renderPages.filter(pageNo => !affectedPages.includes(pageNo));
        const unaffectedCancelPages = cancelPages.filter(pageNo => !affectedPages.includes(pageNo));
        if (registered && unknownGroups.length === 0) {
          expect(unaffectedCancelPages).toEqual([]);
          expect(unaffectedRenderPages).toEqual([]);
          expect(
            result.replacedOrMissingCanvasPages.filter(pageNo => !affectedPages.includes(pageNo)),
          ).toEqual([]);
        }
        const { firstPagePixels: _pixels, ...measurement } = result;
        phases.push({
          name: mutation.name,
          changes,
          cachedPagesBefore: before.pages,
          changedGroups: sample.changedGroups,
          affectedPages,
          unknownGroups,
          renderPages,
          cancelPages,
          unaffectedRenderPages,
          unaffectedCancelPages,
          mutationMs: sample.mutationMs,
          ...measurement,
          counts,
        });
      }
      // Measure actual panel creation separately from closed-panel mutation work.
      const panelStarted = await page.evaluate(() => performance.now());
      await page.getByRole("button", { name: "More document views" }).click();
      await page.getByRole("menuitemradio", { name: "Layers", exact: true }).click();
      await expect(page.locator("input[data-pdf-layer-id]")).toHaveCount(groups.length);
      phases.push(
        await page.evaluate(
          started => ({
            name: "open-layers-panel",
            elapsedMs: performance.now() - started,
            inputs: document.querySelectorAll("input[data-pdf-layer-id]").length,
          }),
          panelStarted,
        ),
      );
    }
    const report = {
      schemaVersion: 1,
      label: process.env.PDFJS_VIEWER_OCG_LABEL ?? "working-tree",
      moduleSha256: process.env.PDFJS_VIEWER_OCG_MODULE_SHA256,
      sourceCommit: process.env.PDFJS_VIEWER_OCG_SOURCE_COMMIT,
      browser: { project: testInfo.project.name, version: browser.version() },
      settings: {
        pages,
        alternatives,
        dependencies: registered ? "registered-except-unknown-span" : "unregistered",
        profile: "balanced",
        memoryLimitMiB: 96,
        maxRenderDpr: 1,
        viewport: { width: 1280, height: 900 },
        dpr: initial.dpr,
        scale: initial.scale,
      },
      manifest,
      load,
      initial,
      phases,
      finalLogs: await page.evaluate(() => window.ocgBenchmark.logs),
      caveats: [
        "Synthetic path/font workload; not a real-world PDF performance prediction.",
        "Durations include logger/proxy observation overhead; no wall-clock acceptance thresholds.",
        "Render-start through completion includes PDF.js preparation/raster/commit, not isolated GPU time.",
        "benchmark-pdfjs-* events observe actual render tasks across all owners; cancel-requested is not cancellation settlement.",
        "No independent thumbnail owner classification; main/detail events are viewer diagnostics.",
        "Fit-scale steady mutations do not intentionally activate high-zoom detail rendering; its absence is not a performance result.",
        "Viewer memory estimates exclude PDF.js internal resources and are throttled.",
        "Quiet-window latency is included in settledMs; speculative work may start later.",
      ],
    };
    const reportPath = testInfo.outputPath("ocg-benchmark.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach("ocg-benchmark.json", {
      path: reportPath,
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        alternatives,
        pages,
        loadMs: load.loadMs,
        firstMainRasterMs: initial.firstMainRasterMs,
        phases: phases.map(phase => {
          const value = phase as { name: string; mutationMs?: number; counts?: unknown };
          return { name: value.name, mutationMs: value.mutationMs, counts: value.counts };
        }),
      }),
    );
    await page.evaluate(() => window.ocgBenchmark.viewer.destroy());
  });
}
