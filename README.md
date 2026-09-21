# `@unilarva/pdfjs-viewer`

<p align="center">
  <img
    src="./assets/icons/unilarva-pdfjs-viewer-logo-adaptive.svg"
    alt="@unilarva/pdfjs-viewer logo"
    width="160"
  >
</p>

A framework-independent, TypeScript-first browser PDF viewer built on Mozilla PDF.js.
Use the complete responsive UI, bring your own controls, or embed just the document
surface. Your application owns the integration; the viewer handles rendering,
navigation, and interaction.

**See it in use:** [Unilaiva songbook](https://unilaiva.aavalla.net) is the real-world
application that started this project. It uses an application-owned UI, rather than
the package's default theme.

[Quick start](#quick-start) | [Usage guide](./USAGE.md) | [Customization](./CUSTOMIZATION.md)

## Highlights

- Complete default UI, selectively generated controls, custom markup bindings, or a
  headless document surface. No framework adapter is required.
- Responsive single-page and book-style spreads, touch and touchpad pinch zoom,
  drag-to-scroll, browser fullscreen, discrete-page presentation mode, and viewer-scoped
  keyboard shortcuts.
- Search, filtered outlines, thumbnails, internal links, rotation, document metadata,
  attachments, optional-content layers, and cross-page text selection that survives view changes.
- Visible-first, high-DPI rendering with configurable profiles that bound viewer-managed raster
  memory.
- Read-only annotations and popups, interactive AcroForms and pure XFA forms, and
  filled-PDF export for supported form values. PDF JavaScript is never executed.
- Controlled printing with ranges, paper sizes, two-page sheets, and DPI settings where
  the browser supports it, plus browser-source and application-adapter routes.
- URL and in-memory loading, password handling, reusable viewers, shared workers, typed
  state and events, document-local Back/Forward, and optional URL-hash navigation.
- Themeable, localizable controls with semantic markup, focus management, and reduced-motion
  support. See the [accessibility limitations](./CUSTOMIZATION.md#accessibility) when
  evaluating PDF content for assistive technologies.
- Deterministic server-renderable UI and a browser DOM factory that avoids HTML parsing sinks for
  CSP and Trusted Types-conscious deployments.

> **Pre-1.0 status:** Public APIs, options, behavior, styling hooks, and the exact
> supported `pdfjs-dist` version set can change between minor releases. Pin exact
> versions, review release notes and `peerDependencies` before upgrading, and treat the
> peer dependency set, not this package version, as the PDF.js compatibility contract.

## Guides

- [Usage guide](./USAGE.md): loading, lifecycle, options, profiles, public API, events,
  behavior, printing, security, and troubleshooting.
- [Customization guide](./CUSTOMIZATION.md): default, custom, and headless UI modes;
  markup bindings; styling; generated UI; and localization.
- [Architecture](./ARCHITECTURE.md): maintainer-only source, release-qualification, and
  implementation guidance.

## Requirements

- A modern browser with ESM, private class fields, workers, `AbortController`, and
  standard DOM APIs. Distributed JavaScript targets ES2022.
- Current desktop and mobile Chromium, Firefox, and Safari/WebKit are supported.
  Automated mobile projects use desktop engine binaries with a touch-capable narrow
  viewport; they are interaction regressions, not physical Android/iOS qualification.
  Native selection handles and system print UI remain browser-owned.
- The consuming application must install the exact `pdfjs-dist` version declared in this
  release's `peerDependencies` (currently `6.3.289`). The package does not bundle PDF.js,
  its worker, fonts, CMaps, ICC data, or WASM assets.
- An ESM-capable bundler or browser setup. There is no CommonJS build.
- A browser document when constructing a viewer. SSR tooling can import the package,
  but viewer, worker, and browser UI creation must run client-side after the host exists.

| Import                                  | Purpose                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@unilarva/pdfjs-viewer`                | Browser ESM runtime, utilities, and public TypeScript contracts.                          |
| `@unilarva/pdfjs-viewer/core.css`       | Functional viewer, text, annotation, XFA, and print CSS for custom/headless UI.           |
| `@unilarva/pdfjs-viewer/default-ui.css` | Functional CSS plus the complete generated default theme. Do not combine with `core.css`. |
| `@unilarva/pdfjs-viewer/package.json`   | Metadata for build tooling and compatibility checks, not a runtime module.                |

Only documented entry points are public. Implementation modules below `dist/` are not.

## Quick Start

Install the viewer and its exact PDF.js peer:

```sh
npm install --save-exact @unilarva/pdfjs-viewer pdfjs-dist@6.3.289
```

Give the host an explicit height; otherwise the scrollable document area can collapse:

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

For a full-viewport viewer, `svh` avoids resizing with mobile browser chrome. Use `dvh`
only when that resize is wanted. In an application shell, `height: 100%` works when every
ancestor through the shell has an explicit height.

Copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to your application's public
`/assets/pdf.worker.min.mjs` URL as part of the build, or use a
[bundler-specific worker recipe](./USAGE.md#worker-setup-by-bundler).
Then configure the worker, create a runtime, and pass it to the viewer:

```ts
import { PdfjsViewer, PdfjsViewerRuntime } from "@unilarva/pdfjs-viewer";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import "@unilarva/pdfjs-viewer/default-ui.css";

const rootEl = document.querySelector<HTMLElement>("#pdf-viewer");
if (!rootEl) throw new Error("Missing #pdf-viewer");

const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "/assets/pdf.worker.min.mjs",
});
const viewer = new PdfjsViewer({ rootEl, runtime });

const result = await viewer.load("/documents/example.pdf");
if (!result.ok && result.reason === "error") console.error(result.error);

window.addEventListener(
  "pagehide",
  () => {
    viewer.destroy();
    runtime.destroy(); // After its last attached viewer.
  },
  { once: true },
);
```

The omitted `ui` mode is the complete default UI. Keyboard shortcuts are scoped to events
originating in the viewer; use `keyboard: false` to disable them. Import
`default-ui.css` only for default UI. Custom and headless integrations import `core.css`
only and provide their own shell styling.

The worker is intentionally not inferred, shipped, or downloaded. Keep it from the same
installed `pdfjs-dist` tree as the display API. The [usage guide worker recipes](./USAGE.md#worker-setup-by-bundler)
cover Vite, Webpack, static/CDN, and host-owned workers.

## Next Integration Steps

### Handle Readiness And Failure

Construct the viewer before starting a load so application state can subscribe to its root. Events
are dispatched directly from `rootEl`; they do not bubble, cross shadow boundaries, or cancel.
`pdf:ready` and a successful `load()` result both mean that the initial visible pages rendered.

```ts
rootEl.addEventListener("pdf:ready", () => {
  statusEl.textContent = "Ready";
});

rootEl.addEventListener("pdf:error", event => {
  const { error } = (event as CustomEvent<{ error: unknown }>).detail;
  console.error("PDF load failed", error);
  statusEl.textContent = "The PDF could not be opened.";
});

rootEl.addEventListener("pdf:statechange", event => {
  const state = (event as CustomEvent).detail;
  pageEl.textContent = `${state.currentPage} / ${state.pageCount}`;
});
```

`load()` returns an expected cancellation result when replaced, closed, destroyed, or cancelled by
a password prompt. A load failure returns an error result and emits `pdf:error`. Invalid input and
calls after `destroy()` throw or reject. See [lifecycle and readiness](./USAGE.md#lifecycle-and-readiness),
[error handling](./USAGE.md#error-handling), and [events](./USAGE.md#events) for the full contract.

### Choose A UI Mode

The default UI is a responsive complete viewer. It is the shortest route to production and can be
re-themed, localized, and composed with selected generated controls.

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: {
    mode: "default",
    controls: { print: false },
  },
});
```

Use `ui: "custom"` to bind the document surface and only application-owned controls. Use
`ui: "headless"` for a package-created surface driven completely through methods and events. Both
require `core.css`, not `default-ui.css`. The [customization guide](./CUSTOMIZATION.md) documents
their CSS, DOM ownership, accessibility, and localization contracts.

### Configure Features Deliberately

Capabilities default to enabled, including search, text selection, outline, thumbnails, attachments,
annotation links/markup, forms, layers, and native-print routing. Disable capabilities that the host
does not expose, or configure them through their typed nested options:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  pageLayout: "auto",
  fitMode: "auto",
  renderingProfile: "auto",
  features: {
    outline: { filter: true },
    thumbnails: true,
    forms: { interactive: true, xfa: true },
  },
  behavior: {
    zoomGestures: true,
    textSelectionPersistence: "sticky",
  },
});
```

PDF JavaScript is unsupported and never executed. Print, SaveAs, submission/network, rich-media, and scripting
annotation actions are filtered. Read-only markup, internal/external links, supported forms, and
optional-content layers remain independently configurable. See [common options](./USAGE.md#common-options)
for feature behavior and [security guidance](./USAGE.md#security-and-deployment-notes)
for deployment boundaries.

### Reuse And Clean Up

`close()` releases the current document while retaining the viewer and its controls for another
`load()`. `destroy()` is terminal and idempotent; generated UI is removed, while caller-owned roots
and custom markup are preserved. A viewer also destroys itself when its root disconnects.

```ts
await viewer.load("/documents/second.pdf");
await viewer.close();
await viewer.load(pdfBytes);
viewer.destroy();
runtime.destroy(); // Only after every attached viewer is destroyed.
```

One runtime normally serves every visible viewer in an application. The detailed guide covers shared
workers, multi-viewer activation, global keyboard scope, hash-backed navigation, downloads, document
queries, diagnostics, and controlled printing.

## Project History

This viewer began as part of [Unilaiva](https://unilaiva.aavalla.net), my songbook site. I
wanted readers to have a consistent experience across desktop and mobile browsers, inspired
by desktop Firefox's PDF viewer, which I felt was the best fit for reading and navigating a
songbook.

That use case shaped the priorities: an outline for finding songs, internal links, keyboard
navigation, book-like two-page presentation when space allows, and comfortable scrolling and
zoom gestures across devices. Over the years, the viewer grew beyond the original site, and I
began to see it as something other projects could use too.

In 2026, I found LLM assistance useful enough to help prepare it for that broader role,
including adding features the songbook had not needed, notably form support. That work led to
the decision to separate the viewer into a reusable open-source package. Its focus remains the
same: a comfortable reading experience, with the surrounding application free to make it its own.

## Development

Build, test, and local demo commands are in the
[maintainer guide](./ARCHITECTURE.md#development-and-contributing). Its architecture
and release-qualification guidance is not required to integrate the published package.

## License

Copyright © 2022-2026 Lari Natri. Licensed under [`Apache-2.0`](./LICENSE). PDF.js/`pdfjs-dist`
is a separate peer dependency under its own license.
