// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

// Qualify one immutable package tarball against every exact peer in clean consumers.

import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { build as viteBuild, preview as vitePreview } from "vite";
import webpack from "webpack";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import { chromium } from "@playwright/test";
import { parseExactPdfjsVersionUnion } from "./pdfjs-version-manifest.mjs";
import { createMinimalPdf } from "./minimal-pdf.mjs";
import { validateWebpackPdfjsFileUrls } from "./pdfjs-webpack-paths.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suppliedTarball = process.argv[2] ? resolve(process.argv[2]) : null;
const tsc = process.platform === "win32" ? "tsc.cmd" : "tsc";
const cssLoader = fileURLToPath(import.meta.resolve("css-loader"));
const requestedVersion = process.argv[3];
const outputRoot = await mkdtemp(resolve(tmpdir(), "pdfjs-viewer-consumer-"));
const npmEnv = { ...process.env, npm_config_cache: resolve(tmpdir(), "kilo/npm-cache") };

function packTarball(destination) {
  const result = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], {
      cwd: packageDir,
      encoding: "utf8",
      env: npmEnv,
    }),
  );
  const metadata = Array.isArray(result) ? result[0] : Object.values(result)[0];
  if (!metadata?.filename) throw new Error("npm pack returned no package metadata");
  return resolve(destination, metadata.filename);
}

function variantMain(variant, bundler = "vite") {
  const display =
    variant === "standard" ? "pdfjs-dist/build/pdf.mjs" : "pdfjs-dist/legacy/build/pdf.mjs";
  const worker =
    variant === "standard"
      ? "pdfjs-dist/build/pdf.worker.min.mjs?url"
      : "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
  const stylesheet =
    variant === "standard"
      ? "@unilarva/pdfjs-viewer/default-ui.css"
      : "@unilarva/pdfjs-viewer/core.css";
  const root =
    'const root = document.createElement("section"); root.style.cssText = "width: 800px; height: 600px";';
  return `
    import { PdfjsViewer, PdfjsViewerRuntime } from "@unilarva/pdfjs-viewer";
    import * as pdfjs from "${display}";
    ${bundler === "vite" ? `import workerSrc from "${worker}";` : 'const workerSrc = new URL("/worker.js", globalThis.location.href).href;'}
    import "${stylesheet}";
    globalThis.candidateResult = null;
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    const NativeWorker = globalThis.Worker;
    let workerConstructions = 0;
    const workerErrors = [];
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: new Proxy(NativeWorker, {
      construct(target, argumentsList) {
        workerConstructions++;
        const worker = Reflect.construct(target, argumentsList, target);
        worker.addEventListener("error", event => workerErrors.push(event.message || "Worker error"));
        return worker;
      },
    }) });
    ${root}
    document.body.append(root);
    const runtime = new PdfjsViewerRuntime({ pdfjs, workerSrc });
    let ready = false;
    root.addEventListener("pdf:ready", () => { ready = true; }, { once: true });
    const viewer = new PdfjsViewer({ rootEl: root, runtime, ui: { mode: "${variant === "standard" ? "default" : "headless"}" } });
    const load = await viewer.load("/fixture.pdf");
    const sentinel = document.createElement("div"); sentinel.className = "pdf-text-layer"; root.append(sentinel);
    async function paintedCanvas() {
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        const canvas = [...root.querySelectorAll(".pdf-page > canvas")].find(candidate => candidate.width > 0 && candidate.height > 0);
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        const pixels = canvas && context ? context.getImageData(0, 0, canvas.width, canvas.height).data : [];
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) {
            return { canvas, colored: true };
          }
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return { canvas: null, colored: false };
    }
    const { canvas, colored } = await paintedCanvas();
    globalThis.candidateResult = () => ({ load, ready, workerConstructed: workerConstructions > 0, workerErrors, canvas: canvas && { width: canvas.width, height: canvas.height }, colored, cssSentinel: getComputedStyle(sentinel).position });
    globalThis.candidateDispose = () => {
      viewer.destroy(); runtime.destroy();
      if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
      else Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: NativeWorker });
    };
  `;
}

try {
  const tarball = suppliedTarball ?? packTarball(outputRoot);
  const pkg = JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }),
  );
  const qualifiedVersions = parseExactPdfjsVersionUnion(pkg.peerDependencies["pdfjs-dist"]);
  if (requestedVersion === undefined) {
    // Pack once, then pass that same artifact to every isolated peer run.
    for (const version of qualifiedVersions) {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), tarball, version], {
        cwd: packageDir,
        stdio: "inherit",
      });
    }
  } else {
    if (!qualifiedVersions.includes(requestedVersion))
      throw new Error(`Requested pdfjs-dist ${requestedVersion} is not a packed qualified peer`);
    await qualifyConsumer(tarball, requestedVersion);
  }
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

// Use only the installed distribution and its exact display/worker pair.
async function qualifyConsumer(tarball, pdfjsVersion) {
  console.log(`Qualifying exact tarball consumer with pdfjs-dist ${pdfjsVersion}`);
  const consumer = resolve(outputRoot, "consumer");
  const fixtures = resolve(consumer, "fixtures");
  await cp(resolve(packageDir, "tests/package-consumer"), fixtures, { recursive: true });
  await writeFile(
    resolve(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", tarball, `pdfjs-dist@${pdfjsVersion}`],
    { cwd: consumer, stdio: "inherit", env: npmEnv },
  );
  const installedPdfjs = JSON.parse(
    await readFile(resolve(consumer, "node_modules/pdfjs-dist/package.json"), "utf8"),
  );
  if (installedPdfjs.version !== pdfjsVersion)
    throw new Error(`Installed pdfjs-dist ${installedPdfjs.version}, expected ${pdfjsVersion}`);

  const consumerTsconfig = resolve(fixtures, "tsconfig.dist.json");
  const nodeNextTsconfig = resolve(fixtures, "tsconfig.nodenext.json");
  execFileSync(tsc, ["-p", consumerTsconfig], { cwd: packageDir, stdio: "inherit" });
  execFileSync(tsc, ["-p", nodeNextTsconfig], { cwd: packageDir, stdio: "inherit" });

  for (const cssImport of [
    "@unilarva/pdfjs-viewer/default-ui.css",
    "@unilarva/pdfjs-viewer/core.css",
  ]) {
    const bundle = await build({
      stdin: {
        contents: `import { PdfjsViewer } from "@unilarva/pdfjs-viewer"; import "${cssImport}"; globalThis.packageConsumer = PdfjsViewer;`,
        loader: "js",
        resolveDir: consumer,
        sourcefile: "package-consumer.js",
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      tsconfig: consumerTsconfig,
      outdir: resolve(outputRoot, "esbuild"),
      write: false,
      metafile: true,
    });
    const inputs = Object.keys(bundle.metafile.inputs).map(path => path.split(sep).join("/"));
    if (
      !inputs.some(path => path.endsWith("dist/index.js")) ||
      !inputs.some(path =>
        path.endsWith(cssImport.endsWith("core.css") ? "dist/core.css" : "dist/default-ui.css"),
      )
    )
      throw new Error(`esbuild did not resolve ${cssImport} from the packed export map`);
    if (inputs.some(path => path.includes("packages/pdfjs-viewer/src/") || path.startsWith("src/")))
      throw new Error(
        "Consumer bundle resolved package source instead of installed distribution files",
      );
    if (
      !bundle.outputFiles.some(file => file.path.endsWith(".js")) ||
      !bundle.outputFiles.some(file => file.path.endsWith(".css"))
    )
      throw new Error("Consumer bundle did not emit both JavaScript and CSS outputs");
  }

  const viteOutput = resolve(outputRoot, "vite");
  await viteBuild({
    configFile: false,
    root: resolve(fixtures, "vite"),
    logLevel: "warn",
    build: { outDir: viteOutput, emptyOutDir: true, sourcemap: true },
  });
  const viteFiles = await readdir(resolve(viteOutput, "assets"));
  if (
    !viteFiles.some(file => file.endsWith(".js")) ||
    !viteFiles.some(file => file.endsWith(".css"))
  )
    throw new Error("Vite production smoke did not emit JavaScript and CSS assets");
  const browser = await chromium.launch();
  try {
    for (const variant of ["standard", "legacy"]) {
      for (const bundler of ["vite", "webpack"]) {
        const fixtureRoot = resolve(consumer, `${variant}-${bundler}`);
        await mkdir(fixtureRoot);
        await cp(resolve(fixtures, "vite/index.html"), resolve(fixtureRoot, "index.html"));
        await mkdir(resolve(fixtureRoot, "public"));
        await writeFile(resolve(fixtureRoot, "public", "fixture.pdf"), createMinimalPdf());
        await writeFile(resolve(fixtureRoot, "main.ts"), variantMain(variant, bundler));
        const output = resolve(outputRoot, `${variant}-${bundler}`);
        if (bundler === "vite") {
          await viteBuild({
            configFile: false,
            root: fixtureRoot,
            logLevel: "warn",
            build: { outDir: output, emptyOutDir: true },
          });
        } else {
          const pdfjsRoot = resolve(consumer, "node_modules/pdfjs-dist");
          const display = resolve(
            pdfjsRoot,
            variant === "standard" ? "build/pdf.mjs" : "legacy/build/pdf.mjs",
          );
          const worker = resolve(dirname(display), "pdf.worker.mjs");
          await new Promise((resolveStats, reject) =>
            webpack(
              {
                mode: "production",
                target: ["web", "es2022"],
                context: consumer,
                entry: { consumer: resolve(fixtureRoot, "main.ts"), worker },
                output: { path: output, filename: "[name].js", clean: true },
                module: {
                  rules: [{ test: /\.css$/i, use: [MiniCssExtractPlugin.loader, cssLoader] }],
                },
                plugins: [new MiniCssExtractPlugin({ filename: "[name].css" })],
              },
              (error, stats) => {
                if (error) return reject(error);
                if (!stats || stats.hasErrors())
                  return reject(
                    new Error(
                      stats?.toString({ colors: false, errors: true, warnings: true }) ??
                        "Webpack produced no stats",
                    ),
                  );
                if (stats.hasWarnings())
                  console.warn(stats.toString({ colors: false, all: false, warnings: true }));
                resolveStats(stats);
              },
            ),
          );
          const files = await readdir(output);
          if (!["consumer.js", "consumer.css", "worker.js"].every(file => files.includes(file)))
            throw new Error(
              "Webpack production smoke did not emit display, worker, and CSS assets",
            );
          for (const file of files.filter(file => file.endsWith(".js"))) {
            const source = await readFile(resolve(output, file), "utf8");
            const urls = validateWebpackPdfjsFileUrls({
              source,
              file,
              variant,
              displayUrl: pathToFileURL(display).href,
              workerUrl: pathToFileURL(worker).href,
            });
            for (const url of urls) {
              console.warn(
                `PDF.js upstream https://github.com/mozilla/pdf.js/issues/22429: ${pdfjsVersion} ${variant} Webpack ${file} retains ${url}. Browser rendering must still pass; this bundle is not path-clean.`,
              );
            }
          }
          await cp(resolve(fixtureRoot, "public/fixture.pdf"), resolve(output, "fixture.pdf"));
          const html = await readFile(resolve(fixtureRoot, "index.html"), "utf8");
          await writeFile(
            resolve(output, "index.html"),
            html
              .replace('src="/main.ts"', 'src="/consumer.js"')
              .replace("</head>", '<link rel="stylesheet" href="/consumer.css"></head>'),
          );
        }
        const server = await vitePreview({
          configFile: false,
          root: fixtureRoot,
          logLevel: "warn",
          build: { outDir: output },
          preview: { port: 0, strictPort: false },
        });
        const page = await browser.newPage();
        const pageErrors = [];
        page.on("pageerror", error => pageErrors.push(error));
        page.on("console", message => {
          if (message.text().includes("Setting up fake worker"))
            pageErrors.push(new Error(message.text()));
        });
        try {
          await page.goto(server.resolvedUrls.local[0], { waitUntil: "networkidle" });
          await page
            .waitForFunction(() => typeof globalThis.candidateResult === "function", null, {
              timeout: 30_000,
            })
            .catch(error => {
              throw new Error(
                `${pdfjsVersion} ${variant} ${bundler} installed runtime did not expose a result: ${JSON.stringify(pageErrors.map(pageError => pageError.message))}`,
                { cause: error },
              );
            });
          const result = await page.evaluate(() => globalThis.candidateResult());
          if (
            !result.load?.ok ||
            !result.ready ||
            !result.workerConstructed ||
            result.workerErrors.length ||
            !result.canvas ||
            result.canvas.width <= 0 ||
            result.canvas.height <= 0 ||
            !result.colored ||
            result.cssSentinel !== "absolute" ||
            pageErrors.length
          )
            throw new Error(
              `${pdfjsVersion} ${variant} ${bundler} installed runtime smoke failed: ${JSON.stringify({ result, pageErrors: pageErrors.map(error => error.message) })}`,
            );
        } finally {
          await page.evaluate(() => globalThis.candidateDispose?.()).catch(() => {});
          await page.close();
          await server.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(
    `Exact tarball passes strict Bundler/NodeNext, esbuild/Vite/Webpack, and standard/legacy Vite/Webpack installed runtime consumers with pdfjs-dist ${pdfjsVersion} (see any upstream path warnings above).`,
  );
}
