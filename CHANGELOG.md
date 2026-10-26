# Changelog

All notable published changes to `@unilarva/pdfjs-viewer` will be documented here.

## Unreleased

## 0.9.0

- Added read-only display page replacements through `preparePageSource()` and
  `setPageSourceOverrides()`, accepting PDF bytes or Blobs. Replace or restore pages in
  atomic batches while keeping layout, text, search, thumbnails, and links consistent.
  Downloads and default print routes still use the original PDF. Opt in with
  `features.print.pageSources: "display"` to print selected replacements natively from a
  stable mapping, including mixed two-page sheets. Each source uses its own Print layer
  configuration, without exporting a complete PDF. Optional `printOutputProvider` captures
  host state synchronously and lazily supplies complete current PDF bytes for browser
  printing, including URL and in-memory documents and source-only `document: "current"`.
  Missing providers with active opted-in replacements and provider failures fail closed;
  explicit original/form-value output and the legacy source resolver remain unchanged. See the
  [usage guide](./USAGE.md#read-only-display-page-sources) for geometry, supported-PDF,
  resource, and lifecycle constraints.
- Report retryable source/popup failures in print setup and direct browser-print actions instead
  of silently dismissing failed output, and cancel pending source preparation when its reserved
  browser tab closes.
- Added `pdf:pagesourceschange` and `pdf:pagecontent` events to distinguish installed page
  mappings from rendering completion or failure.
- Added `setLayerPageDependencies()` and document-scoped `documentId` tokens so
  consumers can preserve unaffected page and thumbnail renders during layer changes.
  Unmapped groups retain conservative document-wide invalidation.
- Added `registerPageOverlay()` for PDF-anchored consumer DOM with geometry callbacks,
  automatic cleanup, and inactivity handling. Overlays are excluded from PDF exports
  and controlled printing.
- Added opt-in page and thumbnail render timings, admission, and cancellation diagnostics.
- Improved layer-sidebar responsiveness and focus preservation during visibility changes.
- Kept visible pages onscreen during slow or repeated zoom changes and improved
  replacement-render memory budgeting.
- Reduced memory retained after page and thumbnail eviction, including browser-owned
  font and text-shaping caches, without closing the document or removing consumer overlays.
- Fixed initial-page rendering and readiness when opening a document at a later page.
- Fixed page-number input drafts being overwritten by scrolling or delayed layout updates,
  including on mobile browsers.
- Fixed delayed annotations failing to appear after a later text request.
- Fixed loaded PDF.js documents and worker resources remaining retained after `destroy()`;
  host-owned workers remain usable after viewer runtime teardown.

## 0.8.1

- Fixed overflowing default menus so all controls remain reachable by scrolling.
- Added reusable native disclosure styling to the default UI: More settings now uses a
  rotating triangle and smooth expansion/collapse, respecting reduced-motion preferences.
- Kept Reset rotation visible but disabled, with matching ARIA state, whenever the
  viewer is at its configured initial rotation, for both generated and custom UI.
  The default UI now uses a distinct upright-page-and-baseline icon instead of the Fit icon.
- Prevented file drops outside the demo's URL field from navigating away from the demo;
  the reusable viewer's drop behavior is unchanged.
- Added opt-in `fontRendering: "geometric"` to preserve larger embedded TrueType
  glyph proportions across zoom and base/detail DPR changes using owned native
  aliases without grid fitting. Native PDF.js rendering remains the default;
  small text, original DOM fonts, and explicit outline rendering are preserved.
- Fixed repeated rendering and eviction of buffered high-zoom pages by reserving
  replacement canvases only when committed output actually requires replacement.
  Memory admission also accounts for reused higher-quality allocations and concurrent
  replacement canvases already reserved for visible pages.
- Fixed temporary zoom placeholders stretching integer canvas rounding surplus into
  the fractional page viewport, causing small content shifts when fresh rendering replaces them.
- Updated build and consumer-test dependencies to address dependency security advisories;
  viewer runtime behavior and the required PDF.js version are unchanged.

## 0.8.0

- **Breaking: requires `pdfjs-dist 6.4.299`; PDF.js 6.3 is no longer supported.**
  Upgrade the display module, matching worker, and supporting PDF.js assets together.
  Both standard and legacy builds of the required release remain supported.
- Added automatic high-resolution detail rendering for sharper PDF content at high zoom,
  with graceful fallback on constrained devices. Cropped overlays share the rendering memory
  budget, preserve interactive layers and annotation appearance, and prioritize visible-region
  resolution over optional padding. Scheduling avoids unnecessary detail work at native quality,
  rejects stale crops, and keeps cancelled resources owned until physical settlement.
- Updated canvas safety limits to conservative 16M pixels/4096 px, balanced 32M pixels/8192 px,
  and aggressive 48M pixels/16384 px. Total memory budgets and automatic profile selection
  are unchanged.
- Increased default maximum zoom to 32 on desktop and 16 on likely-mobile devices,
  preserving consumer overrides.
- Improved allocation and context-loss fallback without oversized intermediate replacement
  canvases or publishing blank output as successful.
- Corrected annotation backing-store accounting and ownership, including grouped named
  appearances and surface rebinding after PDF.js presentation consumes the canvas map.
- Prevented repeated rendering reconciliation when a consumer callback republishes an unchanged view.
- Fixed cached-page readmission repeatedly retrying a stale canvas-constrained requirement
  after discovering different PDF page geometry.
- Added Ctrl/Command+P to open print setup or invoke the configured print route when keyboard
  shortcuts are enabled and the active viewer can print, preserving browser printing otherwise.
- Fixed a delayed sidebar-opening reveal overriding a newer outline selection's smooth scroll.
- Fixed positional PDF-link navigation leaving `state.currentPage` stale when the last animation
  frame reaches its destination without a subsequent native scroll callback.
- Added progressive Screen Wake Lock support with five selectable policies and a
  `"presentation-only"` default. `state.screenWakeLock` and `setScreenWakeLock(policy)`
  expose the selected policy, not actual lock status.
- Added a generated **Keep screen on** selector, overridable labels, and custom UI radio-group
  bindings. Feature and generated-control switches independently disable capability and UI;
  browser limitations remain silent in the UI and use optional structured logger diagnostics.
- Removed demo-specific viewer styling so the demo showcases the unmodified generated default UI;
  demo presentation styles are scoped to its header.

## 0.7.2

- Fixed release workflow tag validation failing before package qualification because of shell quoting.
- Added a fast, reduced-motion-aware fade from the outgoing page to the fully visible incoming page
  during presentation navigation.
- Fixed presentation mode entry and exit jumping away from the current viewport page when page
  state publication, fullscreen resizing, spread-page selection, or delayed container reflow
  overlapped the mode transaction.
- Fixed the hidden default toolbar continuing to reserve vertical space in presentation mode.
- Removed expected browser and PDF.js warning noise from test fixtures.
- Stabilized document-visibility and iframe keyboard-routing tests.
- Added scoped TypeScript projects for the Playwright and Vite test harnesses so editor diagnostics
  include their fixture globals, Node runtime types, and stylesheet declaration while keeping the
  installed-runtime consumer fixtures isolated from development-only configuration.

## 0.7.0

- Initial public release.
