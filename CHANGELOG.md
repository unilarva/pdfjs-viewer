# Changelog

All notable published changes to `@unilarva/pdfjs-viewer` will be documented here.

## Unreleased

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
- Added support for `pdfjs-dist 6.4.299` while retaining `6.3.289` with the same implementation.
- Documented the latest-PDF.js-first support policy: retain older releases only without
  compatibility scaffolding, and allow coordinated viewer/PDF.js upgrades during pre-1.0.

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
