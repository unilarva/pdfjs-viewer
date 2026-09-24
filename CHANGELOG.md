# Changelog

All notable published changes to `@unilarva/pdfjs-viewer` will be documented here.

## Unreleased

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
