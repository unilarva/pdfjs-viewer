// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { PdfjsViewer, PdfjsViewerRuntime, type PdfjsViewerLogEntry } from "../../src/index";
import * as PDFJS from "pdfjs-dist";

declare global {
  interface Window {
    ocgBenchmark: {
      viewer: PdfjsViewer;
      logs: Array<{ at: number; entry: Readonly<PdfjsViewerLogEntry> }>;
      rasters: Map<number, HTMLCanvasElement>;
      profilePage: typeof profilePage;
      renderGate?: Promise<void>;
      releaseRenders?: () => void;
    };
  }
}

const rootEl = document.querySelector<HTMLElement>("#primary")!;
const logs: Window["ocgBenchmark"]["logs"] = [];
const logger = (entry: Readonly<PdfjsViewerLogEntry>) =>
  logs.push({ at: performance.now(), entry });
const profiling = new URLSearchParams(location.search).has("profile");
let renderId = 0;
const bind = (target: object, property: string | symbol) => {
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
};
// Test-only observation at the supplied runtime boundary. No operator filtering,
// config changes or changes to PDF.js cancellation semantics. Continuity tests alone
// can explicitly gate task settlement to reproduce a slow bitmap replacement.
const observedPdfjs = {
  ...PDFJS,
  getDocument: (...args: Parameters<typeof PDFJS.getDocument>) => {
    const documentStarted = performance.now();
    const loadingTask =
      profiling && typeof args[0] === "object" && !(args[0] instanceof Uint8Array)
        ? PDFJS.getDocument({ ...args[0], pdfBug: true })
        : PDFJS.getDocument(...args);
    const promise = loadingTask.promise.then(pdf => {
      if (profiling)
        logger({
          level: "debug",
          component: "viewer",
          event: "benchmark-document-loaded",
          message: "Test-only PDF.js document acquisition",
          details: { elapsedMs: performance.now() - documentStarted, pageCount: pdf.numPages },
        });
      return new Proxy(pdf, {
        get(target, property) {
          if (property === "getOptionalContentConfig")
            return async (...args: Parameters<typeof target.getOptionalContentConfig>) => {
              const start = performance.now();
              const config = await target.getOptionalContentConfig(...args);
              logger({
                level: "debug",
                component: "viewer",
                event: "benchmark-ocg-acquisition",
                message: "Test-only optional-content acquisition",
                details: {
                  elapsedMs: performance.now() - start,
                  intent: args[0]?.intent ?? "display",
                },
              });
              return config;
            };
          if (property !== "getPage") return bind(target, property);
          return async (pageNo: number) => {
            const acquiredAt = performance.now();
            const page = await target.getPage(pageNo);
            if (profiling)
              logger({
                level: "debug",
                component: "viewer",
                event: "benchmark-get-page",
                message: "Test-only page acquisition",
                details: { pageNo, elapsedMs: performance.now() - acquiredAt },
              });
            return new Proxy(page, {
              get(target, property) {
                if (profiling && property === "getOperatorList")
                  return async (...args: Parameters<typeof page.getOperatorList>) => {
                    const started = performance.now();
                    const operators = await target.getOperatorList(...args);
                    logger({
                      level: "debug",
                      component: "viewer",
                      event: "benchmark-operator-list",
                      message:
                        "Test-only explicitly requested operator list (not render-stream timing)",
                      details: {
                        pageNo,
                        elapsedMs: performance.now() - started,
                        count: operators.fnArray.length,
                      },
                    });
                    return operators;
                  };
                if (property !== "render") return bind(target, property);
                return (...args: Parameters<typeof page.render>) => {
                  const id = ++renderId;
                  const start = performance.now();
                  const statsStart = target.stats?.times.length ?? 0;
                  const emit = (event: string) =>
                    logger({
                      level: "debug",
                      component: "viewer",
                      event,
                      message: "Test-only PDF.js render observation (all raster owners)",
                      details: {
                        renderId: id,
                        pageNo,
                        elapsedMs: performance.now() - start,
                        viewportScale: args[0].viewport.scale,
                        viewportWidth: args[0].viewport.width,
                        viewportHeight: args[0].viewport.height,
                        canvasWidth: args[0].canvas?.width ?? args[0].canvasContext?.canvas.width,
                        canvasHeight:
                          args[0].canvas?.height ?? args[0].canvasContext?.canvas.height,
                        annotationMode: args[0].annotationMode,
                        pdfjsStats: target.stats?.times
                          .slice(statsStart)
                          .map(({ name, start, end }) => ({ name, elapsedMs: end - start })),
                      },
                    });
                  emit("benchmark-pdfjs-render-started");
                  const task = target.render(...args);
                  const gate = window.ocgBenchmark?.renderGate;
                  const observedPromise = gate
                    ? task.promise.then(async result => {
                        await gate;
                        return result;
                      })
                    : task.promise;
                  void observedPromise.then(
                    () => emit("benchmark-pdfjs-render-completed"),
                    () => emit("benchmark-pdfjs-render-rejected"),
                  );
                  return new Proxy(task, {
                    get(target, property) {
                      if (property === "promise") return observedPromise;
                      if (property !== "cancel") return bind(target, property);
                      return (...args: Parameters<typeof task.cancel>) => {
                        emit("benchmark-pdfjs-render-cancel-requested");
                        return target.cancel(...args);
                      };
                    },
                  });
                };
              },
            });
          };
        },
      });
    });
    return new Proxy(loadingTask, {
      get: (target, property) => (property === "promise" ? promise : bind(target, property)),
    });
  },
};
const runtime = new PdfjsViewerRuntime({ pdfjs: observedPdfjs, workerSrc: "/pdf.worker.min.mjs" });
const query = new URLSearchParams(location.search);
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: "default",
  fontRendering:
    new URLSearchParams(location.search).get("font") === "geometric" ? "geometric" : "native",
  ...(profiling ? { pageLayout: "single" as const, fitMode: "contain" as const } : {}),
  renderingProfile: "balanced",
  renderingProfiles: {
    balanced: {
      memoryLimitMiB: 96,
      thumbnailMemoryLimitMiB: 4,
      maxRenderDpr: 1,
      ...(query.has("concurrency")
        ? { maxConcurrentRenders: Number(query.get("concurrency")) }
        : {}),
      ...(query.has("buffer") ? { maxBufferViewportHeights: Number(query.get("buffer")) } : {}),
    },
  },
  logger,
});
/** Separate fresh-document probe: never request operator lists before a cold raster. */
async function profilePage(
  pageNo: number,
  scale: number,
  annotationMode: number,
  operatorsOnly: boolean,
) {
  PDFJS.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const started = performance.now();
  const task = PDFJS.getDocument({ url: "/external-benchmark.pdf", pdfBug: true });
  const pdf = await task.promise;
  const loadMs = performance.now() - started;
  try {
    const pageStarted = performance.now();
    const page = await pdf.getPage(pageNo);
    const getPageMs = performance.now() - pageStarted;
    if (operatorsOnly) {
      const start = performance.now();
      const list = await page.getOperatorList({ annotationMode });
      const elapsedMs = performance.now() - start;
      const counts = new Map<number, number>();
      for (const op of list.fnArray) counts.set(op, (counts.get(op) ?? 0) + 1);
      const names = new Map(Object.entries(PDFJS.OPS).map(([name, id]) => [id, name]));
      return {
        loadMs,
        getPageMs,
        elapsedMs,
        count: list.fnArray.length,
        topOperations: [...counts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([id, count]) => ({ name: names.get(id), count })),
        renders: [],
      };
    }
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const config = await pdf.getOptionalContentConfig({ intent: "display" });
    const renders = [];
    for (const phase of ["cold", "warm", "all-hidden"]) {
      if (phase === "all-hidden") for (const [id] of config) config.setVisibility(id, false);
      const statsStart = page.stats?.times.length ?? 0;
      const start = performance.now();
      let firstContinueMs: number | null = null;
      let continuations = 0;
      const render = page.render({
        canvas,
        viewport,
        annotationMode,
        optionalContentConfigPromise: Promise.resolve(config),
      });
      render.onContinue = (resume: () => void) => {
        firstContinueMs ??= performance.now() - start;
        continuations++;
        resume();
      };
      await render.promise;
      renders.push({
        phase,
        elapsedMs: performance.now() - start,
        firstContinueMs,
        continuations,
        stats: page.stats?.times
          .slice(statsStart)
          .map(({ name, start, end }) => ({ name, elapsedMs: end - start })),
      });
    }
    canvas.width = canvas.height = 0;
    return {
      loadMs,
      getPageMs,
      elapsedMs: 0,
      count: 0,
      topOperations: [],
      renders,
      canvasWidth: Math.ceil(viewport.width),
      canvasHeight: Math.ceil(viewport.height),
    };
  } finally {
    await task.destroy();
  }
}
window.ocgBenchmark = { viewer, logs, rasters: new Map(), profilePage };
