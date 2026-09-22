# Using `@unilarva/pdfjs-viewer`

This is the detailed consumer guide. For a minimal first integration, start with the
[README](./README.md#quick-start). UI modes, custom markup, styling, and localization
are documented in [CUSTOMIZATION.md](./CUSTOMIZATION.md). Source-checkout build, test,
and demo commands belong to the
[maintainer guide](./ARCHITECTURE.md#development-and-contributing).

## Contents

- [Requirements and package format](#requirements-and-package-format)
  - [Supported entry points](#supported-entry-points)
- [Quick start](#quick-start)
  - [1. Install dependencies](#1-install-dependencies)
  - [PDF.js version policy](#pdfjs-version-policy)
  - [2. Add a host element](#2-add-a-host-element)
  - [3. Configure the PDF.js worker](#3-configure-the-pdfjs-worker)
  - [4. Create the viewer](#4-create-the-viewer)
- [Worker setup by bundler](#worker-setup-by-bundler)
  - [Vite](#vite)
  - [Webpack 5](#webpack-5)
  - [esbuild or a custom build script](#esbuild-or-a-custom-build-script)
  - [Static server or CDN](#static-server-or-cdn)
  - [Existing Worker instance](#existing-worker-instance)
  - [Configure once at application startup](#configure-once-at-application-startup)
- [Common options](#common-options)
  - [Rendering profiles](#rendering-profiles)
  - [Interaction behavior](#interaction-behavior)
  - [Document features](#document-features)
- [PDF.js document loading](#pdfjs-document-loading)
- [Error handling](#error-handling)
- [PDF named destinations and navigation state](#pdf-named-destinations-and-navigation-state)
  - [Initial navigation](#initial-navigation)
  - [Updates while scrolling and navigating](#updates-while-scrolling-and-navigating)
  - [Multiple viewers and navigation-state ownership](#multiple-viewers-and-navigation-state-ownership)
- [Public controls](#public-controls)
  - [Fullscreen and presentation mode](#fullscreen-and-presentation-mode)
  - [In-document navigation history](#in-document-navigation-history)
- [Behavior and features](#behavior-and-features)
- [Printing](#printing)
  - [Fallback and adapters](#fallback-and-adapters)
  - [Print events](#print-events)
  - [Availability and device compatibility](#availability-and-device-compatibility)
- [Lifecycle and readiness](#lifecycle-and-readiness)
- [Events](#events)
- [Cleanup](#cleanup)
- [Diagnostics](#diagnostics)
- [Troubleshooting](#troubleshooting)
- [Security and deployment notes](#security-and-deployment-notes)
  - [Strict CSP and browser security headers](#strict-csp-and-browser-security-headers)

## Requirements and package format

- A modern browser with JavaScript modules, private class fields, workers,
  `AbortController`, and standard DOM APIs. The distributed JavaScript targets ES2022.
- The support policy covers current desktop and mobile Chromium, Firefox, and Safari/WebKit.
  Automated mobile projects exercise desktop engine binaries with a touch-capable narrow viewport;
  they are synthetic interaction regressions, not physical Android/iOS browser qualification.
  Native OS selection handles and system print UI remain browser-owned.
- `pdfjs-dist 6.3.289`, installed by the consuming application. This is the only currently
  qualified release and the current release's exact supported version; each release's `peerDependencies` declaration is
  authoritative. This package does not bundle PDF.js, its worker, fonts, CMaps, ICC data,
  or WASM assets.
- A bundler or browser setup that supports ESM. There is no CommonJS build.
- A browser document when constructing a viewer. The package can be imported by SSR
  tooling, but viewer, worker, and UI creation must run on the client after the host
  element exists.

This package publishes browser ESM, TypeScript declarations, source maps, the functional
`core.css`, and the aggregate default-theme `default-ui.css`. Import only from documented
package entry points; internal `dist/` files are not public subpath exports.

### Supported entry points

| Import                                  | Supported purpose                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@unilarva/pdfjs-viewer`                | Browser ESM runtime, utilities, and public TypeScript contracts.                                    |
| `@unilarva/pdfjs-viewer/core.css`       | Functional viewer, text, annotation, XFA, and print rules for custom or headless UI.                |
| `@unilarva/pdfjs-viewer/default-ui.css` | Aggregate functional stylesheet and complete generated-UI theme. Do not combine it with `core.css`. |
| `@unilarva/pdfjs-viewer/package.json`   | Package metadata for build tooling and compatibility checks; not a runtime viewer module.           |

No implementation module below `dist/` is a supported import path.

The package is licensed under `Apache-2.0`. Applications distributing it should
review the license obligations appropriate to their distribution model.

## Quick start

### 1. Install dependencies

```sh
npm install --save-exact @unilarva/pdfjs-viewer pdfjs-dist@6.3.289
```

`pdfjs-dist` is a peer dependency. Keep the API and worker from the same installed
`pdfjs-dist` version and build tree. The exported `PdfjsViewerPdfjsModule` type
describes the display API module required by `PdfjsViewerRuntimeOptions.pdfjs`.

### PDF.js version policy

`PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS` is the frozen public list of exact PDF.js
releases qualified by this package. Runtime construction defaults to
`pdfjsVersionPolicy: "qualified-only"` and rejects every other version. The peer
dependency is likewise an exact union, never `6.3.*` or an open range: PDF.js patch
releases can change underdocumented DOM, CSS, and private surfaces used by forms,
annotations, XFA, optional content, and printing.

An application may deliberately use a package-manager peer override and pass
`pdfjsVersionPolicy: "allow-unqualified"` after completing its own qualification:

```ts
const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc,
  pdfjsVersionPolicy: "allow-unqualified",
});
```

That opt-in emits an `unqualified-pdfjs-version` debug diagnostic, is unsupported,
and carries no compatibility guarantees. It bypasses only version membership; display,
document, and adapter capability checks still run. See
[Qualifying a New PDF.js Release](./ARCHITECTURE.md#qualifying-a-new-pdfjs-release) for the
evidence package maintainers require before adding a release to the supported set.

### 2. Add a host element

The viewer needs an explicit height. Without one, its scrollable document area may
collapse.

```html
<div id="pdf-viewer"></div>

<style>
  #pdf-viewer {
    width: 100%;
    height: 100vh;
    height: 100svh;
    min-height: 24rem;
  }
</style>
```

For a full-viewport viewer, `svh` keeps the host independent of dynamic mobile
browser-chrome changes. Use `dvh` instead only when you intentionally want the
entire viewer to resize with the currently visible viewport. If the viewer is
inside an application shell, `height: 100%` is often preferable, provided every
ancestor up to the shell has an explicit height.

### 3. Configure the PDF.js worker

The package deliberately does not ship, infer, or download a worker. Create a runtime
with either `workerSrc` or `workerPort`, then pass it to each viewer. This avoids
API/worker version mismatches and lets your bundler, CDN, CSP, and cache policy control
the asset.

See [Worker setup by bundler](#worker-setup-by-bundler) for ready-to-use recipes.
Deployments with a strict Content Security Policy should also review
[Strict CSP and browser security headers](#strict-csp-and-browser-security-headers), especially
the `worker-src`, `connect-src`, `style-src-attr`, and Trusted Types requirements.

### 4. Create the viewer

Import the default stylesheet when using the omitted/default UI mode:

```ts
import { PdfjsViewerRuntime, PdfjsViewer } from "@unilarva/pdfjs-viewer";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import "@unilarva/pdfjs-viewer/default-ui.css";

const rootEl = document.querySelector<HTMLElement>("#pdf-viewer");
if (!rootEl) throw new Error("Missing #pdf-viewer");

const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "/assets/pdf.worker.min.mjs",
});

const viewer = new PdfjsViewer({
  rootEl,
  runtime,
});
const loadResult = await viewer.load("/documents/example.pdf");
if (!loadResult.ok && loadResult.reason === "error") {
  console.error(loadResult.error);
}

window.addEventListener(
  "pagehide",
  () => {
    viewer.destroy();
    runtime.destroy(); // When this is the application's last viewer.
  },
  { once: true },
);
```

`default-ui.css` is the generated aggregate of functional `core.css` and the default UI theme.
Default-UI consumers import only `default-ui.css`. Custom and headless consumers import only
`core.css` and provide their own shell and control styling.

The omitted UI mode creates the complete default UI.
Keyboard shortcuts are viewer-scoped by default: they run only when a keyboard event
originates inside the viewer. Pass `keyboard: false` to disable them.

Construction is synchronous and document-free, so applications can attach listeners before
starting work. `load()` accepts a URL string, `Uint8Array`, `ArrayBuffer`, or a discriminated
descriptor:

```ts
{ type: "url", url: "/documents/example.pdf", filename: "example.pdf" }
{ type: "data", data: pdfBytes, filename: "example.pdf" }
```

`filename` is exposed as `state.sourceFilename`, used by built-in downloads, and passed to
`printAdapter`. Byte-backed sources are not copied or retained by the viewer for download or
printing at load time; their complete bytes are requested from PDF.js only on demand.
The default print mode uses controlled package-rendered output on recognized engines and supports
both single-page and two-page sheets. It rotates logical landscape sheets for portrait-only native
transport, sends landscape directly where qualified, and otherwise provides browser-source
fallback. See [Printing](#printing). Every viewer begins in the document-free `closed` state:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  defaultDocumentOptions: { standardFontDataUrl: "/pdfjs/standard_fonts/" },
});
rootEl.addEventListener("pdf:ready", onReady);
const result = await viewer.load("/documents/example.pdf", { initialPage: 2 });
```

Constructor `defaultDocumentOptions` are copied as defaults for every load. Per-load
`documentOptions` shallowly override them; a supplied `httpHeaders` object replaces default
headers completely. `initialPage` belongs to that load only. Persisted navigation, when configured
and available, takes precedence over `initialPage`.

The runtime uses the explicitly supplied `pdfjs-dist` display API. The viewer targets current
evergreen Chromium, Firefox, and Safari/WebKit releases and continuously tests all three engines.
Applications may inject PDF.js's legacy display build when their own PDF.js deployment requires it:

```ts
import * as legacyPdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfjsViewerRuntime } from "@unilarva/pdfjs-viewer";

const runtime = new PdfjsViewerRuntime({
  pdfjs: legacyPdfjs,
  workerSrc: "/assets/pdf.worker.legacy.min.mjs",
});
```

The legacy tree is the same PDF.js release and feature set with a different PDF.js compilation
target. It does not broaden this viewer package's browser-support baseline. Its tradeoffs are
larger files and additional parsing and initialization work. Always pair it with
`pdfjs-dist/legacy/build/pdf.worker.min.mjs`; never mix standard and legacy API/worker
trees. The package demo exercises the standard build.

Destroy each viewer when its host is no longer needed. If the application owns an
explicit runtime, destroy it after its last attached viewer; `runtime.destroy()` rejects
while any viewer remains attached. Framework integrations normally perform this in their
unmount or teardown hook.

The repository's `examples/default.ts` is the compact source version of this setup. It
shows the minimum runtime, viewer, event, and cleanup integration without the additional
interface used by the interactive development demo.

## Worker setup by bundler

The recipes below assume these application imports and the same `rootEl`, `pdfUrl`,
and cleanup lifecycle shown in [Quick start](#quick-start):

```ts
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import { PdfjsViewer, PdfjsViewerRuntime } from "@unilarva/pdfjs-viewer";
```

### Vite

Vite can emit the installed worker as an asset and return its public URL:

```ts
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const runtime = new PdfjsViewerRuntime({ pdfjs, workerSrc: pdfWorkerUrl });
const viewer = new PdfjsViewer({ rootEl, runtime });
await viewer.load(pdfUrl);
```

If TypeScript does not recognize `?url`, include Vite's client types or add:

```ts
declare module "*?url" {
  const url: string;
  export default url;
}
```

### Webpack 5

Webpack can emit a URL dependency when its asset handling is enabled:

```ts
const pdfWorkerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const runtime = new PdfjsViewerRuntime({ pdfjs, workerSrc: pdfWorkerUrl });
const viewer = new PdfjsViewer({ rootEl, runtime });
await viewer.load(pdfUrl);
```

Depending on the Webpack configuration, importing the worker as an `asset/resource`
may be preferable. Pass the resulting URL as `workerSrc`.

### esbuild or a custom build script

Copy the worker from the installed `pdfjs-dist` package into your public output as
part of every build. Automating the copy prevents it from becoming stale after an
upgrade:

```js
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/assets", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "dist/assets/pdf.worker.min.mjs",
);
```

Then configure its public URL:

```ts
const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "/assets/pdf.worker.min.mjs",
});
const viewer = new PdfjsViewer({ rootEl, runtime });
await viewer.load(pdfUrl);
```

### Static server or CDN

Deploy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` with your static assets and
pass its deployed URL. If it is cross-origin, configure CORS and an appropriate
JavaScript MIME type. Pin CDN URLs to the exact installed `pdfjs-dist` version.

```ts
const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "https://static.example.com/pdfjs/6.3.289/pdf.worker.min.mjs",
});
const viewer = new PdfjsViewer({ rootEl, runtime });
await viewer.load(pdfUrl);
```

### Existing Worker instance

Advanced integrations can create and own the worker themselves:

```ts
const workerPort = new Worker("/assets/pdf.worker.min.mjs", { type: "module" });
const runtime = new PdfjsViewerRuntime({ pdfjs, workerPort });
const viewer = new PdfjsViewer({ rootEl, runtime });
await viewer.load(pdfUrl);
```

### Configure once at application startup

Create one application runtime, reuse it for every viewer in the same application, and
optionally warm its worker before creating viewers. One shared runtime is the normal
configuration even when several viewers are alive or visible simultaneously:

```ts
import { PdfjsViewerRuntime, PdfjsViewer } from "@unilarva/pdfjs-viewer";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";

const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "/assets/pdf.worker.min.mjs",
});
runtime.startWorker();

const primaryViewer = new PdfjsViewer({ rootEl: primaryRoot, runtime });
const secondaryViewer = new PdfjsViewer({ rootEl: secondaryRoot, runtime });
await Promise.all([primaryViewer.load(primaryPdf), secondaryViewer.load(secondaryPdf)]);
```

The runtime owns global keyboard routing and workers it creates. Destroy every viewer before
calling `runtime.destroy()`. A host-provided `workerPort` remains host-owned and is never
terminated by the runtime. `startWorker()` optionally warms the worker.

Create separate runtimes only when independently owned application modules, micro-frontends,
or tests require separate runtime lifecycles or diagnostics. A runtime per viewer does not
provide worker or keyboard isolation and is not recommended.

PDF.js worker options are module-global. Simultaneously active runtimes must therefore use
matching `pdfjs`, `workerSrc`, `workerPort`, and `workerFactory` values. Incompatible runtime
configuration throws during viewer creation or `startWorker()`.

Every viewer requires an explicit runtime. Runtime and worker ownership are never inferred
from viewer options.

## Common options

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  pageLayout: "auto", // auto | single | double | book
  fitMode: "auto", // auto | contain | width | height
  initialRotation: 0, // 0 | 90 | 180 | 270
  renderingProfile: "auto", // auto | conservative | balanced | aggressive
  keyboard: { scope: "viewer" }, // viewer (default) | global; or false
  viewerId: "manual",
  features: { outline: { filter: true }, thumbnails: true },
  thumbnails: { maxDpr: 2 },
  behavior: { initialSidebarView: "auto" },
});
await viewer.load(pdfUrl, { initialPage: 1 });
```

### Rendering profiles

`PdfjsViewerRenderingProfileSelection` accepts `"auto"`, `"conservative"`, `"balanced"`,
or `"aggressive"`. `PdfjsViewerRenderingProfile` is the concrete profile type and therefore
excludes `"auto"`.

`"auto"` selects the `renderingProfilePolicy` default for the device category classified
during construction: `"conservative"` for likely-mobile devices and `"balanced"` for
other devices by default. That choice is fixed for the viewer's lifetime; it is not
re-evaluated after a resize or environment change. After selecting a manual profile,
`viewer.setRenderingProfile("auto")` restores the same construction-time choice.

The detached state snapshot preserves both values as `renderingProfile` (the requested
selection) and `effectiveRenderingProfile` (the applied concrete profile), plus the stable
`availableRenderingProfiles` list for custom and headless integrations. The generated default UI
has radios only for concrete profiles, so restoring `"auto"` is programmatic. The policy
also determines which manual profiles are available for each device category; a manual
selection outside that set throws `RangeError`.

#### How rendering adapts

Each profile feeds the same deterministic, visible-first render planner rather than selecting a
separate rendering implementation:

- visible pages and initial-readiness work take priority over speculative buffering;
- nearby rows and render order follow scroll direction, then return to center-out ordering when
  scrolling stops;
- disposable offscreen bitmaps are evicted before new render quality is reduced; and
- exact canvas limits, available concurrency, and finally DPR adapt to keep viewer-managed raster
  memory bounded without deliberately leaving required pages blank.

Existing sufficient bitmaps are reused, and replacements render offscreen before an atomic commit
unless the selected profile explicitly permits direct visible rendering under unavoidable pressure.
The exact configurable sequence is documented on `PdfjsViewerRenderingProfileSettings`; see
[Render planning and admission](./ARCHITECTURE.md#render-planning-and-admission) for its ownership,
memory, and scheduling invariants.

#### Profile overrides

The built-in rendering profiles are intended to be good defaults for most consumers.
Applications with measured workload-specific needs may override any subset of the `conservative`,
`balanced`, or `aggressive` settings; omitted fields and profiles retain their package defaults:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  renderingProfile: "balanced",
  renderingProfiles: {
    balanced: {
      memoryLimitMiB: 192,
      thumbnailMemoryLimitMiB: 16,
      maxCanvasPixels: 24_000_000,
      maxCanvasDimension: 8192,
      maxBufferViewportHeights: 4,
      maxBufferPages: 40,
      bufferViewportHeightsWhenInactive: 0,
      allowVisibleDirectRendering: false,
    },
    aggressive: {
      memoryLimitMiB: 320,
      thumbnailMemoryLimitMiB: 32,
      maxBufferViewportHeights: "unlimited",
      maxBufferPages: "unlimited",
    },
  },
});
await viewer.load(pdfUrl);
```

Invalid settings are rejected during construction. `memoryLimitMiB` is the aggregate
viewer-managed raster budget; `thumbnailMemoryLimitMiB` controls the thumbnail cache;
`maxCanvasPixels` and `maxCanvasDimension` cap individual canvases; and the buffer settings
limit nearby speculative work. These constraints are cumulative. Visible pages retain priority
even when a configured limit is too small to represent them.

#### Inactive viewers and hidden documents

`viewer.setActive()` controls that instance's presentation, rendering window, global-keyboard
ownership, and navigation-state writes. Hosts switching between globally routed viewers should
deactivate the old viewer and activate the new one.

By default, the viewer also listens to its owning document's Page Visibility state. A hidden
browser tab, minimized window, screen lock, or backgrounded mobile browser reduces the main
render window to the active profile's `bufferViewportHeightsWhenInactive`, stops background
thumbnail work, and releases unneeded offscreen page rasters. Visible pages remain mandatory.
This resource policy does not change `viewer.state.active`, panel visibility, keyboard routing,
or navigation-state ownership. Applications that intentionally warm hidden documents can opt out:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  behavior: { reduceRenderingWhenDocumentHidden: false },
});
```

### Interaction behavior

Behavioral settings are explicit typed options:

```ts
new PdfjsViewer({
  rootEl,
  runtime,
  behavior: {
    longPressMs: 600,
    sidebarMode: "auto", // auto | overlay | persistent
    zoomGestures: true,
    searchQueryOptions: {
      caseSensitive: false,
      diacritics: "smart",
    },
    outlineFilterOptions: {
      caseSensitive: false,
      diacritics: "smart",
    },
    destinationMatchTolerance: 0.1,
    autoFitWidthMaxHeight: 400,
    zoom: {
      minDesktop: 0.25,
      maxDesktop: 6,
      minMobile: 0.25,
      maxMobile: 3,
    },
  },
});
```

Default zoom bounds are `0.2–10` on desktop and `0.2–4` on likely-mobile devices.
`destinationMatchTolerance` is measured in page heights. It limits same-page
associations between explicit document spots, outline targets, and shareable named
destinations; no candidate is selected outside the tolerance.

### Document features

Document capabilities are separate from interaction behavior and generated-UI composition.
The document capabilities below default to enabled; printing is configured separately:

```ts
new PdfjsViewer({
  rootEl,
  runtime,
  features: {
    search: { prepareOnLoad: false },
    textSelection: true,
    outline: { filter: true, prepareOnLoad: false },
    thumbnails: true,
    attachments: true,
    annotationLinks: {
      internalDestinations: true,
      externalUrls: true,
    },
    annotationMarkup: { popups: true, fileAttachments: true },
    forms: { interactive: true, xfa: true },
    layers: true,
  },
});
```

Set `textSelection: false`, `outline: false`, `thumbnails: false`, `attachments: false`,
`annotationLinks: false`, `annotationMarkup: false`, `forms: false`, or `layers: false`
to disable a capability.
Disabling search skips full-document text indexing and highlights; disabling the outline
skips outline loading; disabling thumbnails skips thumbnail presentation;
disabling attachments skips catalog discovery, attachment UI, public queries, and downloads;
disabling annotation links, markup, and interactive forms skips their presentation. Disabling
`forms.xfa` prevents XFA form presentation. `internalDestinations` and `externalUrls`
independently control PDF-link destinations.
Read-only markup includes notes/comments, highlight/underline/strikeout/squiggle, stamps, free
text, ink, popups, and page-local files. Navigation-only named actions, OCG actions, and local
files use package-owned adapters. Print, SaveAs, submit/network, rich-media, and scripting actions
are always filtered before rendering; ResetForm is exposed through `resetForms()` instead of PDF actions.
Text selection uses native browser/PDF.js ranges and mobile handles, with a package-painted
highlight. Multiple viewers coordinate selection ownership. Layer visibility and form values
are reflected consistently in the main view, thumbnails, saved documents, and controlled print
output where applicable.
PDF JavaScript is unsupported and never executed. Scripted validation, calculation, formatting,
and actions remain inactive. Pure XFA participates in the same dirty, reset, and export lifecycle as
AcroForms. Hybrid XFA uses its AcroForm fallback. Proprietary LiveCycle behavior that PDF.js
cannot expose is reported as unavailable rather than emulated.

Text-selection mode starts off even though its capability defaults enabled. Activate it
through the generated/custom toggle or `viewer.setTextSelectionMode(true)`. The default
`behavior.textSelectionPersistence: "sticky"` keeps the mode active after copy;
`"until-copy"` deactivates it only after PDF.js handles a copy from this viewer's managed
selection. A primary-mouse drag beginning on PDF text selects text; a drag beginning on textless
paper, a canvas, or a page gap continues to drag-scroll and may fling the document. Search remains
open and independently highlighted while selecting. Mode and its selection reset on replacement,
`close()`, and `destroy()`.

Search indexing and outline loading are demand-driven by default. Opening the generated or
custom search panel starts the text index, and entering a query also starts it as a fallback.
Opening the outline starts outline loading and destination resolution. Set that feature's
`prepareOnLoad` option to `true` to start the work asynchronously after document setup;
preparation does not delay `pdf:ready`. Concurrent demands share one per-document
preparation, and completed work is reused until the document is replaced or closed.
Preparation state is available through `viewer.state`, accessible busy/status markup, and the
exported `searchPreparing`, `outlinePreparing`, and `attachmentsPreparing` state classes.

## PDF.js document loading

URL loading is delegated to PDF.js so streaming, byte-range requests, credentials, and
its native cancellation behavior remain available. Pass safe document initialization
settings through constructor `defaultDocumentOptions` or one load's nested `documentOptions`:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  defaultDocumentOptions: {
    httpHeaders: { Authorization: `Bearer ${accessToken}` },
    withCredentials: true,
    rangeChunkSize: 128 * 1024,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  },
});
await viewer.load("https://documents.example.test/report.pdf");
```

The supported settings are `httpHeaders`, `withCredentials`, `password`,
`passwordProvider`, `rangeChunkSize`, `disableRange`, `disableStream`,
`disableAutoFetch`, `docBaseUrl`, `cMapUrl`, `cMapPacked`, `iccUrl`,
`standardFontDataUrl`, `wasmUrl`, `useWorkerFetch`, `useWasm`, `useSystemFonts`,
`disableFontFace`, `stopAtErrors`, `maxImageSize`, and `verbosity`. XFA cannot be enabled through
`documentOptions`; PDF.js `enableXfa` is derived solely from `features.forms.xfa`.
Asset URL settings must include a trailing slash and must point to assets from the same
installed `pdfjs-dist` version as the viewer. No CMaps, standard fonts, ICC profiles, or
WASM files are copied by this package.

Provide `standardFontDataUrl` when rendering XFA or PDFs that depend on PDF standard fonts.
Without matching standard-font data, PDF.js falls back to browser fonts; changed font metrics
can wrap or overlap text in fixed-layout forms. The package demo serves `pdfjs-dist/standard_fonts`
at `./standard_fonts/` as an integration example.

For an interactive password prompt, return a password from `passwordProvider`. Returning
`null` cancels loading. The reason distinguishes a missing password from a rejected one:

```ts
defaultDocumentOptions: {
  passwordProvider: async ({ reason }) => {
    return showPasswordDialog({ incorrect: reason === "incorrect-password" });
  },
},
```

The `load()` source, worker ownership, loading-task cancellation,
and internal DOM factories remain viewer-owned and cannot be overridden through `documentOptions`.
For byte-backed loads, PDF.js may transfer ownership of the supplied typed array to its
worker; copy it first when the application must retain usable bytes.

## Error handling

Handle API misuse separately from document-load failures:

- Invalid arguments, incompatible runtime configuration, and calls made after
  `destroy()` throw or reject. Wrap host-initiated operations such as `load()` in
  `try` / `catch` when accepting dynamic input.
- Network, parsing, setup, and initial PDF.js rendering failures detach the failed document,
  change `viewer.state.status` to `"error"`, dispatch `pdf:error` on `rootEl`, and return
  `{ ok: false, reason: "error", error }`. These failures do not rely
  on a stable `Error.message` string, so present a generic user-facing message and
  keep the original error only for diagnostics.
- Supersession, `close()`, `destroy()`, and password-dialog cancellation return
  `{ ok: false, reason: "cancelled", cause }` without dispatching `pdf:error`. `load()` returns
  `{ ok: true }` only after the same initial-render milestone announced by `pdf:ready`.

```ts
const showPdfError = (message: string) => {
  statusEl.textContent = message;
};

rootEl.addEventListener("pdf:error", event => {
  const { error } = (event as CustomEvent<{ error: unknown }>).detail;
  console.error("PDF load failed", error);
  showPdfError("The PDF could not be opened.");
});

async function openPdf(pdf: PdfjsViewerSource): Promise<void> {
  try {
    const result = await viewer.load(pdf);
    if (!result.ok && result.reason === "error") {
      console.error("PDF load failed", result.error);
    }
  } catch (error) {
    console.error("PDF request was rejected", error);
    showPdfError("The requested PDF is not valid.");
  }
}
```

Use [`examples/demo.ts`](https://github.com/unilarva/pdfjs-viewer/blob/main/examples/demo.ts) for a runnable URL-loading example with
status updates, `pdf:error` handling, and cleanup. Password-protected documents can
use `defaultDocumentOptions.passwordProvider` or per-load
`documentOptions.passwordProvider`; see [PDF.js document loading](#pdfjs-document-loading).

## PDF named destinations and navigation state

PDF files can contain **PDF named destinations**: author-defined names that resolve to a
page and, depending on the destination type, a position within that page. They are
PDF metadata, not headings inferred from page text. This feature is therefore useful
only when the PDF producer creates predictable destination names.

The viewer can expose a selected subset as prefix-stripped **navigation destination IDs**.
Those IDs are persisted through `navigationState`; the optional built-in adapter stores them
in URL hash parameters:

```ts
import { createHashNavigationStateAdapter, PdfjsViewer } from "@unilarva/pdfjs-viewer";

const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  viewerId: "manual",
  shareableNamedDestinationPrefix: "section:",
  navigationState: createHashNavigationStateAdapter(
    {
      navigationDestinationParam: "section",
    },
    rootEl.ownerDocument.defaultView!,
  ),
});
await viewer.load(pdfUrl);
```

Both `shareableNamedDestinationPrefix` and `navigationState` are required to enable persisted
navigation destinations. The built-in hash adapter is optional convenience; applications
can instead provide storage or router integration through `navigationState`. For example,
`readNavigationDestinationId()` and `writeNavigationDestinationId()` exchange only the
prefix-stripped navigation destination ID, never the complete PDF named destination. If the
PDF contains the PDF named destination
`section:introduction`, the configuration above represents it as:

```text
#section=introduction
```

The prefix remains an implementation detail of the PDF: it is removed when writing
the URL and added again when resolving the URL. A hash can contain other parameters;
they are preserved:

```text
#view=manual&section=introduction&theme=dark
```

Hash values are encoded and decoded with `URLSearchParams`, so callers should treat
the hash as query-string-style parameters rather than manually concatenating it.

### Initial navigation

During each `load()`, the viewer reads the navigation destination ID from `navigationState`,
prepends `shareableNamedDestinationPrefix`, and resolves that PDF named destination before
the initial render window is chosen. A valid persisted navigation destination takes precedence over
that load's `initialPage`. If it cannot be resolved, the viewer clears its destination parameter
when that viewer owns hash updates; unrelated hash parameters remain intact.

The viewer builds its navigation-destination index from `pdf.getDestinations()`. It includes
only PDF named destinations that start with `shareableNamedDestinationPrefix`, strips that
prefix to obtain the navigation destination ID, and records the resolved page and normalized
position. An arbitrary PDF may have no PDF named destinations, or may use names that do not
match the configured prefix; in either case automatic synchronization has nothing to track.

### Updates while scrolling and navigating

While the user scrolls, the viewer selects the indexed navigation destination nearest the
active viewport position and schedules a navigation-state update. Updates are debounced by
60 ms. The hash adapter uses `history.replaceState()`, so ordinary scrolling does not create
browser history entries, and retains unrelated hash parameters.

Explicit navigation from an outline item, an internal PDF link, or
`navigateToPdfNamedDestination()` creates a sticky navigation destination. Its ID stays persisted while
the chosen location remains visible instead of immediately changing to a nearby
anchor. Outside sticky navigation, an ID more than two pages behind the current page is
removed from navigation state rather than left as a stale value.

The related public methods are:

- `navigateToPdfNamedDestination(pdfNamedDestination, options?)` is the preferred async API. It accepts
  `spotWithinPage`, `smooth`, and an `AbortSignal`, and returns a structured result.
  Success includes `pdfNamedDestination`, the destination page, and whether spot positioning was used; failure
  reports `invalid-name`, `not-ready`, `not-found`, `cancelled`, `destroyed`, or `error`.
- `navigateFromNavigationState(smooth?)` re-reads the adapter, reconstructs the complete
  PDF named destination, and triggers page-only navigation. It returns whether navigation
  was triggered, not whether asynchronous PDF destination resolution ultimately
  succeeded.

The adapter is read automatically during initial loading. The viewer does not install a
global `hashchange` listener for later changes. Routers that update the hash after the
viewer exists should call `navigateFromNavigationState()` themselves.

```ts
const controller = new AbortController();
const result = await viewer.navigateToPdfNamedDestination("section:introduction", {
  spotWithinPage: true,
  smooth: true,
  signal: controller.signal,
});

if (!result.ok) console.warn("Navigation failed", result.reason);
```

Starting another structured navigation supersedes an unresolved one. Closing,
replacing, or destroying the document also prevents stale requests from scrolling a
replacement document.

### Multiple viewers and navigation-state ownership

`viewerId` identifies a viewer instance in applications that keep multiple viewers alive.
When omitted, the viewer generates a unique page-local ID available as `viewer.viewerId`.
Applications that need stable hash ownership across reloads should provide their own ID.

Viewers start active. Two side-by-side viewers can therefore share one runtime and remain
fully rendered without either viewer receiving a `setActive()` call. Keep the default
`keyboard: { scope: "viewer" }` so keyboard events are handled by the viewer containing DOM
focus. If both viewers persist navigation state, give them separate adapters or parameter
names so they do not write the same hash or storage entry.

Global keyboard scope is intended for mutually exclusive views such as full-screen routes.
A globally scoped viewer claims window-level keyboard ownership when it is constructed;
without later `setActive()` calls, the most recently constructed globally scoped viewer
receives those shortcuts. A host switching between such views should explicitly deactivate
the old viewer and activate the new one.

`viewer.setActive(false)` marks a host view inactive, hides its overlay UI, disables
outside-click closers, releases its global-keyboard ownership when applicable, and
suppresses its hash writes. It also applies the inactive rendering-profile buffer and releases
unneeded offscreen page rasters. `setActive(true)` restores presentation and takes global-keyboard
ownership when the viewer uses a unique `viewerId`; normal buffering resumes only while the owning
document is visible unless `behavior.reduceRenderingWhenDocumentHidden` is disabled.

Use unique `viewerId` values when multiple globally routed viewers share a runtime.
After construction, explicit `setActive()` calls control global keyboard and navigation-state
write ownership; the most recently activated globally routed viewer owns window-level
keyboard input across compatible runtimes. Hash parameters do not select an active viewer.

## Public controls

Useful methods include the following nonexhaustive selection:

- `navigateToPage(page)` and `navigateToPdfNamedDestination(pdfNamedDestination, options)`;
- `navigateFromNavigationState()`;
- `goBack()` and `goForward()` for document-local explicit-navigation history;
- `nextRow()` and `previousRow()`;
- `zoomTo(scale)` and `zoomBy(factor)`;
- `setPageLayout(layout): Promise<void>`;
- `setFitMode(mode): Promise<void>` and `fit(): Promise<void>`;
- `enterFullscreen()`, `exitFullscreen()`, and `toggleFullscreen()` return typed, non-throwing
  results for expected Fullscreen API unavailability, occupancy, denial, and cancellation;
- `enterPresentationMode()`, `exitPresentationMode()`, and `togglePresentationMode()` switch
  between ordinary continuous reading and one fitted page per viewport;
- `rotateTo(rotation): Promise<void>`, `rotateBy(degrees): Promise<void>`, and `resetRotation(): Promise<void>`;
- `setRenderingProfile(selection)`, where `selection` is `"auto"`, `"conservative"`,
  `"balanced"`, or `"aggressive"`;
- `setTextSelectionMode(active)` enables or disables native PDF text selection;
- `setUiText(options)` replaces package-owned dynamic labels and formatters at runtime;
- `load(source, { initialPage, documentOptions }?)` loads the first document or replaces the
  current one using a URL, `Uint8Array`, `ArrayBuffer`, or typed source descriptor and returns a
  discriminated completion result; per-load document options shallowly override constructor
  `defaultDocumentOptions`;
- `close()` releases the current PDF while preserving the viewer and its UI;
- `getDocumentData({ document }?)` returns detached bytes for `"original"` (the default) or
  `"with-form-values"`;
- `download({ document, filename }?)` requests browser activation for either document variant;
- `preflightPrint(options?)`, `print(options?)`, and `openPrintSource(options?)` use the
  configured print route and return discriminated results;
- `getDocumentInformation()` returns detached normalized metadata, identifiers, permissions,
  and format/capability information without opening UI;
- `search(query)` prepares the search index on demand and returns detached page/text matches
  without opening or changing the search panel;
- `getOutline()` prepares the outline on demand and returns a detached hierarchical tree
  with resolved 1-based page targets;
- `getAttachments()` returns detached metadata for document-level embedded files;
- `downloadAttachment(id)` lazily reads and downloads one attachment;
- `getLayers()`, `setLayerVisibility(changes)`, and `resetLayers()` query and atomically
  change display optional-content state;
- `resetForms()` restores the visible AcroForm or pure-XFA values loaded when the viewer opened;
- `setActive(active)` for applications with multiple views; and
- `destroy()` for deterministic cleanup.

### Fullscreen and presentation mode

`features.fullscreen` and `features.presentation` default to `true` and are independent.
Fullscreen uses only the standard Fullscreen API and only exits when this viewer's exact root owns
`document.fullscreenElement`. `state.fullscreen` is browser-authoritative; `state.canFullscreen`
reflects feature, capability, active-view, and lifecycle gates. Expected command failures are returned
as frozen results and published through `pdf:fullscreenerror`; ownership changes publish
`pdf:fullscreenchange`. Entering or leaving fullscreen preserves the current viewport page through
any resulting resize-driven refit.

Presentation mode requires a ready active document. It captures the current layout, fit intent,
rotation, explicit zoom, and reading position, then applies single-page contain fit. It requests
fullscreen when that independent feature is available, but remains embedded when the request is
unavailable or denied. Whenever fullscreen and presentation are active together, leaving either mode
leaves both: browser Escape or another external fullscreen exit restores the ordinary view, and an
explicit presentation exit also exits fullscreen. Activation order does not change this behavior.

While presenting, Arrow keys, Page Up/Down, Space and Shift+Space move exactly one page; Home/End
jump to the first/last page and Escape exits. Vertically dominant mouse-wheel/trackpad input is
accumulated and throttled to one discrete page step; horizontal or Ctrl/Command wheel input does not
navigate. Continuous drag scrolling, pinch zoom, and layout, fit, and zoom mutations are unavailable.
Search, outline, thumbnails, links, annotations, page-number
jumps, document queries, downloads, forms, and layers remain operational, but destinations collapse
to their page row and presentation navigation does not modify document-local Back/Forward history.
The page at the viewport's current reading position is preserved when entering, including before a
scroll has published updated state and when either page of a spread is current. Intentional navigation
changes the authoritative presentation page; fullscreen resizing and delayed layout measurements do
not. Exiting restores the original layout, fit, rotation, and explicit zoom around the page reached in
presentation; when that page did not change, the exact original scroll position is restored.

Swipe or make a quick vertical primary-mouse fling up/down, or tap/click the lower/upper viewport
third, to move silently to the next/previous page.
The middle third and a touch long press reveal the transient controls; mouse movement and keyboard
focus reveal them as well, but presentation navigation keys do not. A normal Previous/Next control
activation moves one page; holding Previous jumps to the first page and holding Next jumps to the
last page. Pointer-activated control buttons release focus back to the document so the controls can
fade again, while keyboard focus keeps them visible for accessibility.
`state.presentationMode` and `state.canPresent` are also published through `pdf:statechange`;
transitions publish `pdf:presentationmodechange`.

### In-document navigation history

`features.navigationHistory` defaults to `true`. `goBack()` and `goForward()` synchronously return
`false` when the feature is disabled, the document is not ready, that direction is unavailable, or
precise active-view geometry is temporarily unavailable; a failed geometry attempt preserves the
entry for retry. Normal unavailability does not throw;
otherwise they restore the saved page-local reading point while retaining current zoom, rotation,
viewport size, and page layout. `state.canGoBack` and `state.canGoForward` provide late-subscriber
availability and update through the existing `pdf:statechange` event.

Explicit page, destination, outline, thumbnail, search-result, annotation, and first/last-page jumps
create entries. Ordinary scrolling, next/previous-row reading, zoom/layout changes, initial loading,
and host-owned navigation-state restoration do not. History is bounded to 100 locations and resets
when the document is replaced, closed, or destroyed.

Internal PDF links, committed page-number input, and thumbnail selection use bounded smooth
scrolling. Initial document positioning remains immediate, and all requested smooth movement becomes
immediate when the configured reduced-motion policy applies.

This feature never calls browser history or changes a URL. `PdfjsViewerNavigationStateAdapter` and
the hash adapter remain the separate shareable-destination mechanism and continue using replace
semantics for one host-owned destination.

Page-layout and rotation changes are asynchronous and reject without partially applying a failed
change or when no document is ready. `setFitMode()` may update the selected mode while closed or
loading and applies it to the next ready document; `fit()` requires a ready document.

The package root also exports the relevant TypeScript contracts, including
`PdfjsViewerOptions`, `PdfjsViewerPageLayout`, `PdfjsViewerFitMode`,
`PdfjsViewerFitModeSelection`, `PdfjsViewerRotation`, `PdfjsViewerUiControlOptions`,
`PdfjsViewerRenderingProfile`,
`PdfjsViewerRenderingProfileSelection`, `PdfjsViewerRenderingProfileSettings`,
`PdfjsViewerDocumentVariant`, `PdfjsViewerDocumentDataResult`, `PdfjsViewerDownloadResult`,
`PdfjsViewerState`, event types, navigation results, runtime options, UI bindings, and document-loading
options. `renderPdfjsViewerUi()` and `PDFJS_VIEWER_UI_HOOKS` are
available for custom integration as described in
[Customize and localize the UI](./CUSTOMIZATION.md#customize-and-localize-the-ui). Package implementation files
are not public entry points. Treat the generated package-root declaration (`dist/index.d.ts`)
and the package-root export inventory in [`ARCHITECTURE.md`](./ARCHITECTURE.md#module-status-and-audience)
as the complete current API inventory.

Document information, search, outline, and attachment queries use structured results:

```ts
const documentInformation = await viewer.getDocumentInformation();
if (documentInformation.ok) {
  const { title, author, metadata, permissions } = documentInformation.information;
  console.log(title, author, metadata["dc:title"], permissions);
}

const search = await viewer.search("Introduction", {
  caseSensitive: false,
  diacritics: "smart", // smart | ignore | respect
});
if (search.ok) {
  for (const match of search.matches) {
    console.log(match.page);
    for (const segment of match.segments) {
      console.log(segment.text, segment.characterIndex, segment.length);
    }
  }
}

const outline = await viewer.getOutline({
  query: "Chapter",
  caseSensitive: true,
  diacritics: "respect",
});
if (outline.ok) {
  for (const item of outline.items) {
    console.log(
      item.title,
      item.destinationStatus,
      item.destination?.page,
      item.destination?.navigationDestinationId,
      item.children,
    );
  }
}

const attachments = await viewer.getAttachments();
if (attachments.ok) {
  for (const attachment of attachments.attachments) {
    console.log(attachment.id, attachment.filename, attachment.description);
  }
  const first = attachments.attachments[0];
  if (first) await viewer.downloadAttachment(first.id);
}

const layers = viewer.getLayers();
if (layers.ok) {
  await viewer.setLayerVisibility([{ id: "optional-content-id", visible: false }]);
  await viewer.resetLayers();
}

if (viewer.state.formDirty) {
  const documentData = await viewer.getDocumentData({ document: "with-form-values" });
  if (documentData.ok) consumePdfBytes(documentData.data);
  await viewer.download({ document: "with-form-values" });
  await viewer.resetForms();
}
```

Document queries require a ready document and return expected failures with `ok: false` and
`reason: "not-ready"`, `"cancelled"`, `"destroyed"`, or `"error"`. Search, outline, attachments, and
current-form-value byte access can additionally return `"disabled"` when their feature is disabled. `downloadAttachment()` also
returns `"not-found"` for an unknown document-scoped ID and `"unavailable"` when PDF.js cannot
provide bytes. Attachment support currently covers catalog-level embedded files; page-local
File Attachment annotations and full PDF Portfolio collection semantics are outside this scope.
Error failures also expose `error`. `search()` rejects an empty or non-string query with
`TypeError`; explicit API searches allow one-character queries. Returned arrays and objects
are detached snapshots, so caller mutation does not affect later queries or viewer UI.
Layer mutations additionally return `reason: "unknown-layer"` with all unknown IDs and reject
the whole operation. Successful changes increment `revision` and preserve PDF radio-button
group semantics.

`getDocumentInformation()` returns normalized data rather than PDF.js objects. Standard PDF
Info fields and parsed XMP `metadata` remain separate because they may
disagree. XMP values are strings or string arrays. `creationDate` and `modificationDate`
preserve original PDF date strings so applications can choose their own parsing and time-zone
policy. `permissions` is the explicit list of granted operations, or `null` when PDF.js could
not expose a permission list. `null` must not be interpreted as proof that an encrypted PDF is
unrestricted. Document fingerprints expose separate original and modified IDs.
The result also reports AcroForm, XFA, portfolio/collection, signature, linearization, and
tagged-PDF flags. `formPresentation` distinguishes `acroform`, `pure-xfa`,
`hybrid-acroform-fallback`, and unavailable XFA rather than implying mixed `getXfa()` support.
It intentionally omits file size: PDF.js `getDownloadInfo()` can force a
range-loaded document to finish downloading, which would make a metadata query unexpectedly
expensive.
Creation and modification dates remain the raw PDF strings in this result. Their timezone suffix,
for example `+03'00'`, comes from the PDF metadata rather than the host device. `formatPdfDate()`
provides a human-readable projection such as `2026-08-09 04:38:55 +03:00` while preserving that
encoded wall time and offset; invalid values pass through unchanged. The generated dialog uses this
helper through the overridable `ui.formatters.documentInformationDate` formatter.
The optional generated default-UI dialog consumes this same public result through the facade. It
does not add a generated-UI dependency to metadata acquisition. Custom and headless modes do not
discover, populate, or manage information controls: consumers own their markup and call the query
when needed. This also supports projections outside a dialog without ambient DOM binding:

```ts
root.addEventListener("pdf:ready", async () => {
  const result = await viewer.getDocumentInformation();
  if (!result.ok) return;
  documentTitle.textContent = result.information.title ?? "";
});
```

Search results contain page-local source `segments`; `characterIndex` and `length` are
JavaScript UTF-16 offsets into each segment's original `text`. Matches may span adjacent PDF.js
text items but not page boundaries. A queried `getOutline()` result includes matching items and
their ancestors to preserve hierarchy.

Document search, search highlighting, generated/custom outline filtering, `search()`, and
filtered `getOutline()` use the same character comparison and substring helpers. Matching
is case-insensitive by default. Diacritic modes are:

- `"smart"`: an unaccented query matches accented or unaccented text, while an accented
  query requires the same accent;
- `"ignore"`: accents are folded on both query and document text; and
- `"respect"`: accents must match after NFC normalization.

`behavior.searchQueryOptions` supplies defaults for UI document search and public `search()`
calls. `behavior.outlineFilterOptions` supplies defaults for UI outline filtering and
queried `getOutline()` calls. Both default to `{ caseSensitive: false, diacritics: "smart" }`.
Public method options are partial overrides: an omitted field is inherited from the relevant
stored default. These are query-time policies over retained original strings, so changing
them between public calls never rebuilds the search index or outline.
Outline `destinationStatus` is `"resolved"`, `"none"`, or `"unresolved"`, distinguishing
usable targets from destinationless items and malformed or unsupported PDF destinations.
`destination.pdfNamedDestination` preserves an explicit string destination from the PDF
outline itself.
`destination.navigationDestinationId` is separate and optional: it is inferred only when
`shareableNamedDestinationPrefix` and `navigationState` configure persisted destination syncing and a
prefix-matching PDF named destination is on the same page within
`behavior.destinationMatchTolerance`. The ID has the configured prefix removed. A named
destination elsewhere in the document, or one farther away on the same page, is not assigned.
Generated outline navigation uses this same inferred ID, so API results and URL/hash state do
not disagree about a selected outline spot.

Named-destination navigation requires `viewer.state.status === "ready"` and otherwise
returns a structured `not-ready` result. It does not operate on a document that is still
loading, failed, closed, or being replaced. `zoomTo()` rejects non-finite scales, while
`zoomBy()` rejects non-finite or non-positive factors with `RangeError`; valid values are
clamped to the configured zoom range. Committed scales are normalized to six decimal places;
transient pinch, wheel, and slider feedback remains continuous until commit.

## Behavior and features

- **Page layout:** `pageLayout: "single"`, `"double"`, and `"book"` are explicit.
  `"auto"` chooses single-page or two-page layout using the available width and the
  PDF's `PageLayout` metadata. Once document dimensions are known, auto layout measures
  whether a height-fitted spread fits the container. This intrinsic two-page selection is
  part of `"auto"` and has no separate behavior option. Changing page layout returns the
  viewer to Fit while preserving the viewed page.
- **Fit and resizing:** `fitMode` accepts `"auto"`, `"contain"`, `"width"`, or
  `"height"`. Auto uses width at container heights up to `autoFitWidthMaxHeight` (400
  by default), otherwise contain. Fit targets the complete current row; singleton cover
  and trailing rows in spread modes use representative two-page geometry. Explicit zoom
  disables Fit. Window resize refits while Fit is active, while container-only resize
  preserves scale and refreshes Fit-control visibility.
- **Zoom gestures:** Ctrl/Command plus a physical mouse-wheel step interpolates its
  transform-only feedback before one final canonical zoom commit. Continuous pixel-wheel
  touchpad pinch input, touch pinch, and slider dragging retain their direct frame-coalesced
  response, so mouse-wheel smoothing does not add gesture latency or extra render work.
- **Rotation:** `initialRotation` and `rotateTo()` use clockwise quarter turns. `rotateBy()`
  accepts any integer multiple of 90. Rotation composes with intrinsic PDF page rotation,
  resets to `initialRotation` on replacement, and refits only while Fit is active.
- **Rendering profiles:** `renderingProfile` controls how aggressively pages outside the visible
  area remain rendered. `"conservative"` favors low memory use, `"aggressive"` retains more work,
  and `"balanced"` balances them. `"auto"` selects a profile from device conditions.
  Rendering is asynchronous, visible-first, and bounded by the active profile.
- **Search and outline preparation:** full-document text extraction and outline destination
  resolution start on first use by default. `features.search.prepareOnLoad` and
  `features.outline.prepareOnLoad` start them asynchronously after document setup instead.
  Search/outline UI and the public `search()`/`getOutline()` methods share the same
  per-document preparation. Named-destination indexing used by shareable navigation remains
  independent.
- **Text selection:** selection and search highlights can span rendered pages and survive zoom,
  fit, layout, and resize changes. Drags beginning outside selectable PDF text continue to scroll
  the document. Native mobile selection handles remain browser-owned.
- **Navigation controls:** holding previous/next jumps to the first or last page after
  `behavior.longPressMs`. Page-row navigation respects single-page and spread layouts
  rather than always moving exactly one PDF page.
- **Keyboard input:** `keyboard: { scope: "viewer" }` is the safe default and handles
  only events originating inside this viewer. `keyboard: { scope: "global" }` routes
  window-level commands to the active `viewerId`, while `keyboard: false` installs no
  keyboard handler. Editable controls remain protected. Supported navigation includes
  arrows, Page Up/Down, Space, Home/End, Escape for panels, and F3/Shift+F3 for search.
- **Document data and downloads:** `getDocumentData({ document })` returns detached bytes for the
  `"original"` document (the default) or the document `"with-form-values"`. Concurrent original
  reads share one PDF.js `getData()` operation, but every successful caller receives its own array.
  The method has no browser activation or retained-byte side effect.

  A `.pdf-download-btn` custom-UI hook and public `viewer.download({ document, filename })` support
  URL and in-memory sources. Original URL sources use their source URL without reading PDF bytes.
  In-memory and current-form-value requests create an `application/pdf` Blob, activate a temporary
  download link, and revoke its object URL in the next task. The descriptor `filename` is preferred
  for the original variant; otherwise the viewer uses the URL basename or `document.pdf`. The
  current-form-value variant defaults to that basename with `-filled.pdf`. Concurrent byte-backed
  calls with the same variant and filename share one extraction and start one download. `canDownload`
  becomes true once an in-memory document proxy is available.

  Browser URL-download policy still applies. In particular, browsers may ignore the
  `download` attribute for cross-origin URLs unless the response permits or requests a
  download. URL actions use a safe `_blank`/`noopener` fallback so that such a response opens
  in a new tab instead of navigating the host application. An `{ ok: true }` result from
  `download()` means activation was requested, not that the browser or server guaranteed a saved file.

  The generated default UI's original-document action is labeled **Download original PDF**. When a
  supported interactive form is available, the `.pdf-download-filled-document-btn` action is labeled
  **Save filled PDF** and calls `download({ document: "with-form-values" })`. It remains disabled until
  a form value differs from its loaded value and is absent for documents without supported forms.
  Browser activation and byte access do not clear dirty state.
  Reset restores the values observed when this viewer loaded the document, including a previously
  saved `/V`; it does not restore AcroForm `/DV` defaults. Save/export cover values PDF.js can
  serialize, not unsupported proprietary XFA behavior, scripts, signatures, or submission side effects.

  An in-memory download necessarily materializes the complete PDF and Blob storage temporarily.
  For very large documents, a URL-backed source is the most memory-efficient download path.

## Printing

Omitted `features.print` normalizes to `"native"`. The package device-compatibility baseline enables
portrait-transport controlled printing, including spread composition, for recognized Chromium and
Firefox compatibility engines. Desktop Chromium and Firefox additionally receive direct landscape
transport. WebKit, Apple mobile platforms, unknown engines, unmatched host-disabled environments,
and browsers without the required constructed-CSSOM APIs resolve unsupported and use browser-source
printing when native mode's default `browserFallback: true` permits it. This baseline describes package
transport support, not qualification of a particular printer, driver, system print dialog, or physical
device/browser combination. Use `"off"` when the client must expose no printing.

The package exports `PDFJS_VIEWER_PRINT_DEFAULTS` and defaults controlled output to A4 paper,
`fit` page scaling, automatic orientation, and a 300 DPI target. Configure viewer-local defaults for
US Letter or reduction-only placement under native, browser, or adapter mode:

```ts
features: {
  print: {
    mode: "native",
    defaults: {
      sheet: "letter",
      pageScaling: "shrink-to-fit",
      orientation: "auto",
      quality: { dpi: 300 },
    },
  },
}
```

Controlled printing always composes onto an explicit paper size: A3, A4, A5, US Letter, US Legal,
or caller-supplied custom dimensions. This avoids delegating document-sized placement to inconsistent
browser print pipelines. `pageScaling: "fit"` enlarges or
reduces each page to its slot; `"shrink-to-fit"` keeps smaller pages at physical size, reduces larger
pages, and always centers the result. Package `@page` margins remain zero; system print-dialog margins are
browser and user policy.

Automatic layout uses two pages only when the PDF declares a spread preference and every selected page
fits one physical half of the selected sheet. With automatic orientation, the planner compares a
side-by-side landscape sheet with a stacked portrait sheet and chooses the placement with the best
minimum page scale; landscape source pages therefore naturally stack. The check allows one millimetre
for PDF producer rounding. Explicit single and spread choices remain authoritative. In setup UI, a user
selection of Automatic spreads or Two pages resets Orientation to Automatic; a later explicit orientation
selection remains authoritative and selects the corresponding placement axis. For single-page layout,
automatic orientation compares portrait and landscape paper against all selected source-page proportions.

| Mode        | Route                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `"off"`     | Operationally disabled: UI is hidden/disabled, `state.canPrint` is false, and `print()`/`openPrintSource()` return `disabled`.      |
| `"native"`  | Controlled native according to resolved device compatibility and technical support; otherwise browser-source fallback when allowed. |
| `"browser"` | Always opens the browser PDF source and reserves its popup synchronously.                                                           |
| `"adapter"` | Calls `printAdapter` only and skips native preflight, setup, and resource limits.                                                   |

`"adapter"` requires `printAdapter`, which is rejected for every other mode.
Print setup UI is active only for a controlled-native route. Resolved `nativePrintSupport` has three
levels: `"unsupported"` uses source fallback, `"portrait"` sends only portrait media to the native
pipeline, and `"portrait-and-landscape"` may send either orientation directly. Both supported levels
permit the complete single, automatic, and spread layout UI. On portrait-only transport, a resolved
logical landscape sheet is composed as a unit, rotated 90 degrees counterclockwise, and encoded with swapped
portrait dimensions before `window.print()`. Raster and pure-XFA output use the same transformation.
Mechanical checks, PDF permissions, and resource limits remain mandatory regardless of compatibility
records.

### Fallback and adapters

Native mode accepts `browserFallback`, which defaults to `true`. Set it to `false` when application
policy must not expose the browser-source route:

```ts
features: { print: { mode: "native", browserFallback: false } }
```

When controlled native printing is unavailable, this makes `state.canPrint` false, hides or disables
the generated print action, makes `print()` return `unsupported`, and makes `openPrintSource()` return
`disabled`. Controlled resource failures report `sourceFallbackAvailable: false`, so generated and
custom setup owners do not offer the source button. `browserFallback` is rejected outside native mode.

Override printing for application policy or a host-native integration. The adapter
can use an original URL when present or request complete bytes on demand:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  features: { print: "adapter" },
  printAdapter: async ({
    sourceUrl,
    sourceFilename,
    formDirty,
    getDocumentData,
    options,
    viewer,
  }) => {
    const data =
      sourceUrl && !formDirty
        ? undefined
        : await getDocumentData({ document: formDirty ? "with-form-values" : "original" });
    const sheetCount = await applicationPrint({
      sourceUrl,
      sourceFilename,
      data,
      options,
      state: viewer.state,
    });
    return { status: "adapter-completed", sheetCount };
  },
});
await viewer.load(pdfUrl);

const result = await viewer.print({
  pages: [{ from: 2, to: 8 }],
  layout: { mode: "spread", firstPageSide: "right" },
  quality: { dpi: 300 },
  sheet: "a4",
  pageScaling: "fit",
  orientation: "landscape",
});
```

`print()` returns a discriminated controlled, browser-source, adapter, or expected-failure
result. `print-invoked` means only that `window.print()` was called; browsers do not reveal
whether the user printed or cancelled. Controlled output accepts page ranges, single/spread layout,
first-page side, fixed preset or custom sheet sizes, orientation, and 72-600 DPI quality.
`parsePrintPageRanges(input, pageCount)` exposes the package parser for host-owned dialogs.

PDF permissions are mandatory. Ordinary print permission caps requested quality at 150 DPI; high-quality
permission permits caller targets from 72-600 DPI. Omitted quality requests 300 DPI. A `null` permission
list is treated as unrestricted for print admission. `preflightPrint(options)` applies to a
controlled-native route and reports resolved DPI, sheet count, resource-limit outcomes, and
source-fallback warnings without allocating print output. Print limits are configured under each
rendering profile's `print` settings; `memoryLimitMiB`, `maxCanvasPixels`, and
`maxCanvasDimension` remain the shared raster limits.
The generated setup intentionally offers only 300 and 600 DPI targets; lower numeric targets remain
available to programmatic and adapter consumers. Requested targets may resolve lower because of PDF
permissions, memory, or canvas limits.

`openPrintSource({ document: "auto" })` is the explicit long-document fallback when native-mode
`browserFallback` permits it. It reserves a
blank tab synchronously, uses saved current-form bytes when dirty, otherwise uses the original,
and reports warnings for controlled features the browser source cannot preserve. URL sources
loaded with headers or credentials are materialized because direct navigation cannot reproduce
PDF.js request policy. Use
`navigation: "materialize"` to force that behavior or `printSourceResolver` to return a host URL or
bytes. It remains an explicit action after a controlled-native resource failure.
Source fallback hands a PDF source to the browser's own handler. It cannot preserve controlled
sheet composition or DPI and cannot preset the browser's range, paper, orientation, scale, duplex,
margin, color, destination, or cancellation result.
Disabling browser fallback and generated download controls is a product-policy boundary, not DRM:
a browser that can load and render a PDF may still expose its bytes through network tools or caches.

### Print events

`viewer.state.print` exposes current print phase and progress. Native jobs emit
`pdf:printstart`, `pdf:printprogress`, `pdf:printinvoked`, and `pdf:printcleanup`; use the exported
`PdfjsViewerPrintEvent` discriminated union. For custom setup bindings and generated-dialog behavior,
see [Print setup UI](./CUSTOMIZATION.md#print-setup-ui).

### Availability and device compatibility

`state.canPrint` requires readiness and PDF permission, is false for `off` and unavailable native
without fallback, and additionally requires the constructor-validated adapter in adapter mode.

`PDFJS_VIEWER_DEVICE_COMPATIBILITY` and `resolveDeviceCompatibility()` expose the generic package
baseline. Every `PdfjsViewerDeviceCompatibilityRule` requires `engine`; optional `browser`, `platform`,
and `operatingSystem` selectors refine it. Host `deviceCompatibility` records are merged over package
records, replacing an exact selector set and otherwise adding refinements:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  deviceCompatibility: [
    {
      engine: "chromium",
      browser: "chrome",
      platform: "android",
      nativePrintSupport: "portrait-and-landscape",
      evidenceId: "print-audit-2026-09-android-chrome-landscape",
    },
  ],
  features: { print: "native" },
});
```

`resolveNativePrintCapabilities(environment)` accepts the same
`PdfjsViewerDeviceEnvironment` used by compatibility resolution and returns
`PdfjsViewerNativePrintCapabilities`. There is no separate native-print environment model.

Matching uses selector containment rather than array order: a rule wins only when it adds compatible
selectors to a broader matching rule. Browser and platform refinements are independent. Overlapping
rules with different support that do not refine one another are rejected unless their explicit
intersection is present. Equal exact host selectors replace package selectors. Rules are viewer-local,
detached, and frozen; omitted `evidenceId` is allowed for broad policy, while evidence-backed exceptions
may retain a host audit identifier. See
[`DEVICE-COMPATIBILITY.md`](./DEVICE-COMPATIBILITY.md) for the risk model and physical procedure.

## Lifecycle and readiness

- **Lifecycle:** construction creates a reusable viewer in the same document-free `"closed"`
  state produced by `close()`. Generated UI belongs to the viewer and is removed by
  `destroy()`; caller-provided roots and custom markup are preserved. A mutation observer also
  destroys the viewer after its root is disconnected from the document.
- **Readiness:** `pdf:ready` means the document was loaded and every page visible in the
  first valid render plan committed successfully. Buffered pages, later viewport changes,
  eager feature preparation, and later lazy page renders do not delay that stable milestone
  and may still be running. The viewer remains `loading` until that cohort commits. It sets
  `state.status` to `ready` before dispatching `pdf:ready`, then publishes buffered eager
  preparation events. Initial-cohort failure sets `error` before one `pdf:error` event.

| Operation                                  | Lifecycle contract                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `new PdfjsViewer(options)`                 | Synchronously validates and creates a document-free `closed` viewer.                                            |
| `load(source, options?)`                   | Returns one discriminated result. A newer load cancels the previous attempt with cause `superseded`.            |
| `close()`                                  | Cancels an active load with cause `closed`, detaches the document, and retains viewer UI/infrastructure.        |
| `destroy()`                                | Synchronously enters the terminal state, cancels an active load with cause `destroyed`, and remains idempotent. |
| Commands after `destroy()`                 | Throw or reject; document interaction commands also reject without a ready document.                            |
| Result-returning queries after `destroy()` | Return their documented `{ ok: false, reason: "destroyed" }` result. `state` and `viewerId` remain readable.    |

## Events

Events are dispatched directly from `rootEl`. They do not bubble, are not composed across a
shadow boundary, and are not cancelable; subscribe on the exact viewer root before calling
`load()`:

```ts
rootEl.addEventListener("pdf:ready", () => {
  console.log("Initial pages rendered");
});

rootEl.addEventListener("pdf:pagechange", event => {
  const { page } = (event as CustomEvent<{ page: number }>).detail;
  console.log("Current page", page);
});

rootEl.addEventListener("pdf:error", event => {
  const { error } = (event as CustomEvent<{ error: unknown }>).detail;
  console.error("PDF failed", error);
});

rootEl.addEventListener("pdf:statechange", event => {
  const state = (event as CustomEvent).detail;
  console.log(state.status, state.currentPage, state.scale);
});

rootEl.addEventListener("pdf:fullscreenchange", event => {
  console.log("Fullscreen", (event as CustomEvent<{ fullscreen: boolean }>).detail.fullscreen);
});

rootEl.addEventListener("pdf:fullscreenerror", event => {
  console.warn("Fullscreen request failed", (event as CustomEvent).detail);
});

rootEl.addEventListener("pdf:presentationmodechange", event => {
  console.log(
    "Presentation",
    (event as CustomEvent<{ presentationMode: boolean }>).detail.presentationMode,
  );
});

rootEl.addEventListener("pdf:searchindexcomplete", event => {
  const { status, indexedPages, error } = (event as CustomEvent).detail;
  console.log("Search index", status, indexedPages, error);
});

rootEl.addEventListener("pdf:outlinecomplete", event => {
  const { status, itemCount, error } = (event as CustomEvent).detail;
  console.log("Outline", status, itemCount, error);
});

rootEl.addEventListener("pdf:attachmentscomplete", event => {
  const { status, itemCount, error } = (event as CustomEvent).detail;
  console.log("Attachments", status, itemCount, error);
});

rootEl.addEventListener("pdf:layerschange", event => {
  const { revision, layers } = (event as CustomEvent).detail;
  console.log("Layers", revision, layers);
});

rootEl.addEventListener("pdf:formdirtychange", event => {
  console.log("Form dirty", (event as CustomEvent<{ formDirty: boolean }>).detail.formDirty);
});
```

The preparation events fire once when each active-document attempt settles. `status` is
`"ready"` on success and `"error"` for a non-fatal preparation failure; the latter includes
`error`. Editing the search query or closing and reopening the outline retries a failed
preparation. Eager completion events are ordered after `pdf:ready`, including when the work
finishes first, so a ready-event handler can safely subscribe to them. Work cancelled by
document replacement, `close()`, or `destroy()` does not emit a completion event.

On success, the viewer publishes the ready state, synchronously dispatches `pdf:ready`, flushes
buffered eager-preparation events, and only then settles the `load()` promise with `{ ok: true }`.
On terminal failure, the failed document is detached first, the error state is published,
`pdf:error` is synchronously dispatched, and the promise then settles with the error result.
Expected cancellation dispatches neither `pdf:ready` nor `pdf:error`; its public result may settle
before uncancellable PDF.js cleanup physically finishes.

The current detached, read-only snapshot is also available as `viewer.state`. It contains
`status` (`loading`, `ready`, `closed`, `error`, or `destroyed`), host `active` state,
`fullscreen`, `canFullscreen`, `presentationMode`, `canPresent`, `pageCount`,
`currentPage`, `canGoBack`, `canGoForward`, `scale`, selected `pageLayout`, `fitMode`, and `renderingProfile`, their concrete
`effectivePageLayout`, `effectiveFitMode`, and `effectiveRenderingProfile`, the concrete
`availableRenderingProfiles`, `fitActive`,
`rotation`, `textSelectionMode`, `formDirty`, `sourceUrl`, `sourceFilename`, `canDownload`,
`canPrint`, `print`, and the
`searchPreparation`, `outlinePreparation`, and `attachmentsPreparation` feature states.

`currentPage` is the page at the viewer's reading position, horizontally centered and slightly
above the viewport midpoint. A small visible sliver of the preceding page therefore does not make
that page current. In a horizontally scrollable spread, horizontal position can select either page;
stable ties retain the previously current spread page. Thumbnail highlighting still covers the
complete active spread. Outline highlighting and persisted named destinations select the latest
destination at or before the same page-local reading position, so a chapter remains selected until
the reading position reaches a later chapter destination.

Feature preparation is `"disabled"` when the feature is unavailable, `"idle"` before
demand, `"loading"` while active-document work runs, and `"ready"` or `"error"` after
it settles. A document replacement resets enabled features to `"idle"`. The dedicated
completion events remain useful for their result counts and error objects; state provides
the current snapshot needed by newly mounted controls.

`pdf:statechange` is emitted only when at least one observable state value changes. Its
detail is a fresh detached snapshot, so consumers can initialize from `viewer.state` and
then replace their local snapshot from each event without reading viewer internals.

`fitActive` means the automatic Fit policy remains enabled. It does not promise that the
current scale equals every row's target. Navigating to differently sized pages or a
container-only resize preserves scale; the Fit action becomes visible when the rendered row
layout overflows the selected Fit constraint. Window resize refits automatically while this
policy is active.

## Cleanup

```ts
viewer.destroy();
```

To reuse the same viewer and controls, replace or close only its document:

```ts
await viewer.load("/documents/second.pdf");
await viewer.load("/documents/private.pdf", {
  documentOptions: {
    httpHeaders: { Authorization: `Bearer ${accessToken}` },
  },
});
await viewer.load(pdfBytes); // Uint8Array or ArrayBuffer
await viewer.close(); // UI remains available for another load()
```

Constructor `defaultDocumentOptions` are defaults for every load; replacement-load
`documentOptions` shallowly override them for that call. Per-load `httpHeaders` replace the
default header object instead of merging credentials across origins.

Generated markup is removed by `destroy()`. Caller-owned roots and custom markup are
preserved. The viewer also destroys itself if its root is removed from the document.

Cleanup cancels viewer-managed work and prevents obsolete loads or queries from publishing
into a replacement document. `close()` and replacement `load()` do not wait for PDF.js reads
that PDF.js itself cannot cancel.

## Diagnostics

The package is silent by default: it does not write routine lifecycle messages or load
errors directly to the browser console. Applications can opt into structured diagnostics
with a logger on a runtime and/or viewer:

```ts
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import { PdfjsViewer, PdfjsViewerRuntime, type PdfjsViewerLogger } from "@unilarva/pdfjs-viewer";

const logger: PdfjsViewerLogger = entry => {
  const write = entry.level === "error" ? console.error : console.debug;
  write(`[pdfjs-viewer:${entry.component}:${entry.event}] ${entry.message}`, entry);
};

const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "/assets/pdf.worker.min.mjs",
  logger,
});
const viewer = new PdfjsViewer({ rootEl, runtime, logger });
await viewer.load(pdfUrl);
```

Entries have a stable `event`, severity, component, message, optional `viewerId`, and
structured details; failures also include the original error. Runtime entries cover worker
leasing and viewer attachment. Viewer entries cover creation/destruction, status changes,
document loading/parsing/readiness/failure, cleanup, the selected rendering profile, and
throttled canvas-memory estimates. Logger exceptions are contained and never interrupt
viewer behavior.

Diagnostics include lifecycle, worker, rendering, retry, feature, and estimated raster-memory
events. Memory estimates cover viewer-managed canvas output and temporary raster work, not
PDF.js caches, decoded resources, browser process memory, or GPU overhead. Treat event details
as telemetry and use `pdf:error` plus `viewer.state` for user-facing behavior.

The logger is for development and host telemetry. User-facing load handling should still
use `pdf:error` and `viewer.state`; diagnostics do not replace the public event contract.
Avoid forwarding document URLs, authorization data, or other sensitive application values
from surrounding code. Built-in entries deliberately report source type rather than URL.

## Troubleshooting

- **Worker configuration error:** create a runtime with `workerSrc`/`workerPort` and
  pass that runtime to each viewer. Conflicting active runtime configurations are rejected.
- **Version mismatch:** deploy the worker from the same installed `pdfjs-dist` version
  used to bundle the viewer API.
- **Blank or zero-height viewer:** give `rootEl` and its parent layout an explicit height.
- **Worker MIME/CORS failure:** serve `.mjs` as JavaScript and configure CORS for
  cross-origin assets.
- **Default UI is unstyled:** import `@unilarva/pdfjs-viewer/default-ui.css`.
- **PDF URL fails:** ensure the PDF endpoint is reachable and allows cross-origin access
  when hosted on another origin.
- **SSR failure:** defer viewer construction and worker creation until client-side code
  runs and `rootEl` is connected to a browser document.
- **Content Security Policy failure:** permit the worker URL through `worker-src` and
  other PDF.js assets through the directives used by your deployment, or supply a
  CSP-compatible `workerFactory`/`workerPort`.
- **Print is rejected or unsupported:** inspect the discriminated `print()` result. Permission
  denial, an unqualified platform, resource limits, and a still-retained native invocation each
  have explicit outcomes. `print-invoked` only means `window.print()` was called; the package cannot
  observe whether the system print dialog printed or was cancelled. Source fallback is always an explicit
  user action and may be blocked by popup/navigation policy.

## Security and deployment notes

- Treat PDFs as untrusted input. Parsing and rendering are delegated to PDF.js; use the exact
  supported `pdfjs-dist` peer version, follow its advisories, and update the viewer/PDF.js pair
  when a supported security release is available.
- Validate document URLs and authorization headers in application code. This package
  does not provide access control or sanitize host-generated custom UI.
- Cross-origin PDFs, workers, fonts, CMaps, ICC profiles, and WASM assets need suitable
  CORS, MIME, caching, and Content Security Policy headers.
- PDF JavaScript is unsupported and never executed, including AcroForm and XFA validation,
  calculation, formatting, and action scripts. Submit/network, Print, SaveAs, rich-media, and
  scripting annotation actions are filtered before presentation.
- External annotation links are exposed only for `http:`, `https:`, `mailto:`, and `tel:` URLs.
  Disable all annotation links with `features: { annotationLinks: false }`, or independently
  configure `annotationLinks.internalDestinations` and `annotationLinks.externalUrls`.

### Strict CSP and browser security headers

The viewer does not use `eval`, inline event-handler attributes, injected `<style>`
elements, or HTML-string insertion for PDF-derived content. `createPdfjsViewerUi()` creates
the package UI with DOM APIs and is suitable when a consumer wants to create it explicitly.
The separate SSR string returned by `renderPdfjsViewerUi()` is not `TrustedHTML`; a host choosing
to insert it client-side owns the required Trusted Types policy.
Controlled print construction also uses DOM APIs and a constructed stylesheet; it never uses
`document.write`, string HTML, or print-root style attributes. A browser without constructed
document stylesheet support returns `unsupported`.

Some capabilities still need to be allowed explicitly by a strict deployment policy:

- **`style-src-attr`:** the viewer updates element style properties for page layout,
  canvas dimensions, zoom transforms, and annotation placement. A policy
  containing `style-src-attr 'none'` will prevent these capabilities from working. A
  nonce does not authorize runtime style attributes.
- **`worker-src`:** allow the PDF.js module worker URL, or pass a host-created
  `workerPort` / CSP-compatible `workerFactory` when creating the runtime. With
  `require-trusted-types-for 'script'`, the factory must construct `Worker` with a
  `TrustedScriptURL` returned by an explicitly allowed host policy; the package cannot create
  a deployment policy on the host's behalf.
- **`connect-src`:** allow URL-backed PDFs and any configured PDF.js assets such as
  CMaps, standard fonts, ICC profiles, or WASM resources. Cross-origin assets also
  need appropriate CORS responses.
- **`img-src`:** controlled-native printing presents generated sheet images through
  package-owned `blob:` URLs. A strict policy must permit `blob:` for those images; this is
  unnecessary when controlled-native printing is not enabled.
- **`navigate-to` and `sandbox`:** these may block external PDF annotation links and any
  host print adapter that chooses to open a document in a new tab.
- **COEP/COOP:** when cross-origin isolation is enabled, cross-origin PDFs, workers,
  and PDF.js support assets must satisfy the relevant CORS/CORP requirements.
