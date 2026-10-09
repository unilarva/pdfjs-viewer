# Changelog

All notable published changes to `@unilarva/pdfjs-viewer` will be documented here.

## Unreleased

- Fixed repeated rendering and eviction of buffered high-zoom pages by reserving
  replacement canvases only when committed output actually requires replacement.
  Memory admission also accounts for reused higher-quality allocations and concurrent
  replacement canvases already reserved for visible pages.
- Fixed temporary zoom placeholders stretching integer canvas rounding surplus into
  the fractional page viewport, causing small content shifts when fresh rendering replaces them.
- Updated build and consumer-test dependencies to address dependency security advisories;
  viewer runtime behavior and the required PDF.js version are unchanged.

## 0.7.2

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
