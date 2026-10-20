// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

// Usage: node scripts/benchmark-ocg.mjs [--project=chromium] [--repeat-each=3]
// Optional: PDFJS_VIEWER_BENCHMARK_MODULE=/absolute/frozen/bundle.js
//           PDFJS_VIEWER_OCG_BASELINE_REF=HEAD (read-only Git source snapshot)
//           PDFJS_VIEWER_OCG_DEPENDENCIES=registered (requires the new public API)
//           PDFJS_VIEWER_OCG_PAGES=240 PDFJS_VIEWER_OCG_LABEL=pre-selective
//           PDFJS_VIEWER_BENCHMARK_PDF=/absolute/consumer.pdf (external profiling)
//           PDFJS_VIEWER_BENCHMARK_PAGES=6,7 (1-based physical pages, default 1)
// Unlike playwright-run.mjs, keeps successful JSON/log attachments for comparison.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = path.resolve(import.meta.dirname, "..");
const runId = `ocg-${Date.now()}-${process.pid}`;
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("No test port"));
    server.close(error => (error ? reject(error) : resolve(address.port)));
  });
});
let modulePath = process.env.PDFJS_VIEWER_BENCHMARK_MODULE;
const baselineRef = process.env.PDFJS_VIEWER_OCG_BASELINE_REF;
const externalPdf = process.env.PDFJS_VIEWER_BENCHMARK_PDF;
const zoomContinuity = process.env.PDFJS_VIEWER_BENCHMARK_ZOOM === "1";
const scrollProbe = process.env.PDFJS_VIEWER_BENCHMARK_SCROLL === "1";
const pdfBytes = externalPdf ? await readFile(externalPdf) : null;
const pdfIdentity = pdfBytes
  ? {
      sha256: createHash("sha256").update(pdfBytes).digest("hex"),
      bytes: pdfBytes.length,
    }
  : null;
let sourceCommit;
if (baselineRef) {
  if (modulePath) throw new Error("Choose a baseline Git ref or a frozen module, not both");
  const commit = execFileSync("git", ["rev-parse", "--verify", `${baselineRef}^{commit}`], {
    cwd: packageDir,
    encoding: "utf8",
  }).trim();
  sourceCommit = commit;
  modulePath = path.join(await mkdtemp(path.join(tmpdir(), "pdfjs-ocg-baseline-")), "index.js");
  await build({
    entryPoints: [path.join(packageDir, "src/index.ts")],
    outfile: modulePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    plugins: [
      {
        name: "committed-source-baseline",
        setup(builder) {
          builder.onLoad({ filter: /\.ts$/ }, args => {
            const relative = path.relative(packageDir, args.path);
            if (!relative.startsWith(`src${path.sep}`)) return;
            return {
              contents: execFileSync("git", ["show", `${commit}:${relative}`], {
                cwd: packageDir,
                encoding: "utf8",
              }),
              loader: "ts",
              resolveDir: path.dirname(args.path),
            };
          });
        },
      },
    ],
  });
  console.log(`Read-only committed baseline: ${commit}`);
}
if (!modulePath) {
  modulePath = path.join(await mkdtemp(path.join(tmpdir(), "pdfjs-ocg-working-tree-")), "index.js");
  await build({
    entryPoints: [path.join(packageDir, "src/index.ts")],
    outfile: modulePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
  });
}
const moduleSha256 = modulePath
  ? createHash("sha256")
      .update(await readFile(modulePath))
      .digest("hex")
  : "working-tree-source";
const args = process.argv.slice(2);
console.log(`OCG benchmark artifacts: ${path.join(packageDir, "test-results", runId)}`);
console.log(`Module: ${modulePath ?? "src/index.ts"}; SHA256: ${moduleSha256}`);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("@playwright/test/cli")),
    "test",
    externalPdf
      ? zoomContinuity
        ? "tests/browser/pdf-zoom-continuity.spec.ts"
        : scrollProbe
          ? "tests/browser/pdf-scroll-performance.spec.ts"
          : "tests/browser/pdf-performance.spec.ts"
      : "tests/browser/ocg-benchmark.spec.ts",
    "--workers=1",
    ...(args.some(arg => arg.startsWith("--project")) ? [] : ["--project=chromium"]),
    ...args,
  ],
  {
    cwd: packageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PDFJS_VIEWER_OCG_BENCHMARK: "1",
      PDFJS_VIEWER_OCG_MODULE_SHA256: moduleSha256,
      PDFJS_VIEWER_OCG_SOURCE_COMMIT: sourceCommit ?? "working-tree-or-supplied-module",
      ...(modulePath ? { PDFJS_VIEWER_BENCHMARK_MODULE: modulePath } : {}),
      PDFJS_VIEWER_PLAYWRIGHT_RUN_ID: runId,
      PDFJS_VIEWER_PLAYWRIGHT_PORT: String(port),
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", error => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", async (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
  try {
    const outputDir = path.join(packageDir, "test-results", runId);
    await writeFile(
      path.join(outputDir, "run.json"),
      JSON.stringify(
        {
          modulePath,
          moduleSha256,
          sourceCommit,
          pdfIdentity,
          exitCode: process.exitCode,
          probe: zoomContinuity
            ? "zoom-continuity"
            : scrollProbe
              ? "fast-scroll"
              : externalPdf
                ? "pdf-performance"
                : "synthetic-ocg",
        },
        null,
        2,
      ),
    );
    if (process.exitCode !== 0 || zoomContinuity || scrollProbe) return;
    const files = (await readdir(outputDir, { recursive: true })).filter(
      file => path.basename(file) === (externalPdf ? "pdf-performance.json" : "ocg-benchmark.json"),
    );
    const reports = await Promise.all(
      files.map(async file => JSON.parse(await readFile(path.join(outputDir, file), "utf8"))),
    );
    const summary = [];
    const distribution = values => {
      const sorted = values.toSorted((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return {
        min: sorted[0],
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        max: sorted.at(-1),
      };
    };
    if (externalPdf) {
      for (const key of new Set(
        reports.map(r => `${r.browser.project}/${r.pageNo}/${r.fontRendering}`),
      )) {
        const samples = reports.filter(
          r => `${r.browser.project}/${r.pageNo}/${r.fontRendering}` === key,
        );
        summary.push({
          key,
          samples: samples.length,
          loadMs: distribution(samples.map(r => r.loadMs)),
          firstRasterMs: distribution(samples.map(r => r.firstRasterMs)),
          fontPreparationMs: distribution(samples.map(r => r.pipeline.fontPreparationMs ?? 0)),
          commitMs: distribution(samples.map(r => r.pipeline.commitMs ?? 0)),
          concurrency: samples[0].concurrency,
          bufferViewportHeights: samples[0].bufferViewportHeights,
          viewerPdfjsMs: distribution(samples.map(r => r.render.elapsedMs)),
          bareColdMs: distribution(samples.map(r => r.bare.renders[0].elapsedMs)),
          bareWarmMs: distribution(samples.map(r => r.bare.renders[1].elapsedMs)),
          bareHiddenMs: distribution(samples.map(r => r.bare.renders[2].elapsedMs)),
          operatorListMs: distribution(samples.map(r => r.operatorList.elapsedMs)),
          operatorCount: samples.map(r => r.operatorList.count),
        });
      }
      await writeFile(
        path.join(outputDir, "summary.json"),
        JSON.stringify(
          {
            modulePath,
            moduleSha256,
            sourceCommit,
            pdfIdentity,
            summary,
          },
          null,
          2,
        ),
      );
      console.log(`PDF performance summary: ${JSON.stringify(summary)}`);
      return;
    }
    for (const key of new Set(
      reports.map(report => `${report.browser.project}/${report.settings.alternatives}`),
    )) {
      const samples = reports.filter(
        report => `${report.browser.project}/${report.settings.alternatives}` === key,
      );
      summary.push({
        key,
        samples: samples.length,
        loadMs: distribution(samples.map(report => report.load.loadMs)),
        firstMainRasterMs: distribution(samples.map(report => report.initial.firstMainRasterMs)),
        getLayersMs: distribution(samples.map(report => report.load.getLayersMs)),
        localMutationMs: samples[0].settings.alternatives
          ? distribution(
              samples.map(report => report.phases.find(phase => phase.name === "local").mutationMs),
            )
          : null,
        localMainRenders: samples.map(
          report =>
            report.phases.find(phase => phase.name === "local")?.counts["page-render-started"] ?? 0,
        ),
        layerInputsWhileClosed: samples.map(report => report.initial.layerInputsWhileClosed),
      });
    }
    await writeFile(
      path.join(outputDir, "summary.json"),
      JSON.stringify({ modulePath, moduleSha256, sourceCommit, summary }, null, 2),
    );
    console.log(`OCG benchmark summary: ${JSON.stringify(summary)}`);
  } catch (error) {
    console.error("Unable to preserve benchmark summary:", error);
    process.exitCode = 1;
  }
});
