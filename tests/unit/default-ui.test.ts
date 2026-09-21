// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  createPdfjsViewerUi,
  PDFJS_VIEWER_DEFAULT_LABELS,
  PDFJS_VIEWER_DEFAULT_FORMATTERS,
  normalizeGeneratedUiOptions,
  normalizeUiTextOptions,
  renderPdfjsViewerUi,
} from "../../src/default-ui.js";

test("generated UI factory normalizes text options once", () => {
  class FakeParent {
    children: unknown[] = [];

    append(child: unknown): void {
      this.children.push(child);
    }
  }
  class FakeElement extends FakeParent {
    attributes = new Map<string, string>();
    dataset: Record<string, string | undefined> = {};

    constructor(readonly localName: string) {
      super();
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }

    querySelectorAll(): [] {
      return [];
    }
  }
  class FakeDocumentFragment extends FakeParent {
    get childElementCount(): number {
      return this.children.filter(child => child instanceof FakeElement).length;
    }

    get firstElementChild(): FakeElement | null {
      return (
        (this.children.find(child => child instanceof FakeElement) as FakeElement | undefined) ??
        null
      );
    }
  }

  const ownerDocument = {
    createDocumentFragment: () => new FakeDocumentFragment(),
    createElement: (name: string) => new FakeElement(name),
    createTextNode: (text: string) => text,
  };
  let labelReads = 0;
  const options = {
    id: "normalize-once",
    get labels() {
      labelReads++;
      return { search: "Find" };
    },
  };

  createPdfjsViewerUi(options, ownerDocument as never);

  assert.equal(labelReads, 1);
});

test("generated print setup exposes one complete basic and advanced hook contract", () => {
  const html = renderPdfjsViewerUi({ id: "print-owner" });
  assert.match(html, /<progress class="pdf-document-progress"[^>]*aria-label="Loading PDF"/);
  for (const hook of [
    "pdf-print-setup",
    "pdf-print-pages",
    "pdf-print-range",
    "pdf-print-layout",
    "pdf-print-side",
    "pdf-print-side-select",
    "pdf-print-more",
    "pdf-print-sheet",
    "pdf-print-custom-sheet",
    "pdf-print-sheet-width",
    "pdf-print-sheet-height",
    "pdf-print-sheet-unit",
    "pdf-print-page-scaling",
    "pdf-print-orientation",
    "pdf-print-quality",
    "pdf-print-status",
    "pdf-print-progress",
    "pdf-print-guidance",
    "pdf-print-fallback-warning",
    "pdf-print-close",
    "pdf-print-cancel",
    "pdf-print-source",
    "pdf-print-submit",
    "pdf-print-submit-detail",
  ])
    assert.match(html, new RegExp(`class="[^"]*${hook}`));
  assert.match(html, /<details class="pdf-print-more">/);
  assert.match(
    html,
    /<progress class="pdf-print-progress"[^>]*aria-label="Preparing print sheets"/,
  );
  assert.match(html, /<option value="spread">Two pages<\/option>/);
  assert.match(html, /<option value="custom">Custom<\/option>/);
  assert.ok(html.indexOf('class="pdf-print-sheet"') < html.indexOf('class="pdf-print-layout"'));
  assert.ok(html.indexOf('class="pdf-print-more"') < html.indexOf('class="pdf-print-layout"'));
  assert.ok(
    html.indexOf('class="pdf-print-layout"') < html.indexOf('class="pdf-print-orientation"'),
  );
  assert.ok(
    html.indexOf('class="pdf-print-orientation"') < html.indexOf('class="pdf-print-page-scaling"'),
  );
  assert.ok(
    html.indexOf('class="pdf-print-page-scaling"') < html.indexOf('class="pdf-print-quality"'),
  );
  for (const name of ["layout", "sheet", "orientation", "page-scaling", "quality"]) {
    assert.match(
      html,
      new RegExp(`class="pdf-print-${name}"[^>]*aria-describedby="print-owner-print-${name}-help"`),
    );
    assert.match(html, new RegExp(`<small id="print-owner-print-${name}-help"`));
  }
  assert.match(html, />Open system print dialog<\/span>/);
  assert.match(html, />Open PDF in browser<\/button>/);
  assert.equal((html.match(/enterkeyhint="done"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /cannot be observed/);
  assert.doesNotMatch(html, /type="radio"[^>]*pdf-print/);
});

test("generated document information UI is optional, labelled, and structurally complete", () => {
  const html = renderPdfjsViewerUi({
    id: "information-owner",
    labels: { documentInformation: "Details", documentInformationAccept: "Accept" },
  });
  assert.match(
    html,
    /class="[^"]*pdf-document-information-btn"[^>]*aria-controls="information-owner-document-information"/,
  );
  assert.match(
    html,
    /id="information-owner-document-information" class="pdf-document-information"[^>]*aria-labelledby="information-owner-document-information-title"/,
  );
  assert.match(
    html,
    /id="information-owner-document-information-title" class="pdf-document-information-title">Details<\/h2>/,
  );
  assert.match(
    html,
    /class="pdf-menu-secondary-actions">.*pdf-document-information-btn.*pdf-text-selection-toggle-btn/,
  );
  assert.doesNotMatch(
    html.match(/class="pdf-menu-primary-actions">.*?<\/div>/)?.[0] ?? "",
    /pdf-document-information-btn/,
  );
  for (const hook of [
    "pdf-document-information-content",
    "pdf-document-information-status",
    "pdf-document-information-close",
    "pdf-document-information-accept",
  ])
    assert.match(html, new RegExp(`class="[^"]*${hook}`));
  assert.match(html, />Accept<\/button>/);

  const omitted = renderPdfjsViewerUi({
    id: "without-information",
    controls: { documentInformation: false },
  });
  assert.doesNotMatch(omitted, /pdf-document-information/);
});

test("default print formatters describe physical output and cancellable progress", () => {
  assert.equal(
    PDFJS_VIEWER_DEFAULT_FORMATTERS.printSummary({
      pages: "3-7",
      sheetCount: 3,
      orientation: "landscape",
      layout: "spread",
      dpi: 300,
    }),
    "Pages 3-7 → 3 landscape sheets, two pages per sheet, 300 DPI.",
  );
  assert.equal(PDFJS_VIEWER_DEFAULT_FORMATTERS.printProgress(2, 3), "2/3 sheets prepared");
  assert.equal(
    PDFJS_VIEWER_DEFAULT_FORMATTERS.printSheetLimitExceeded(351, 350),
    "This selection would create 351 sheets; the current limit is 350. Choose fewer pages or open the PDF in the browser.",
  );
  assert.equal(PDFJS_VIEWER_DEFAULT_FORMATTERS.printReducedQuality(150), "Reduced quality 150 DPI");
  assert.equal(
    PDFJS_VIEWER_DEFAULT_FORMATTERS.printReducedExplanation(150),
    "This page range at the requested quality needs more preparation memory, so quality was reduced to 150 DPI.",
  );
  assert.equal(
    PDFJS_VIEWER_DEFAULT_LABELS.printMemoryLimitExceeded,
    "This selection exceeds the current print memory limit. Choose fewer pages, select a larger rendering profile, or open the PDF in the browser.",
  );
  assert.equal(
    PDFJS_VIEWER_DEFAULT_LABELS.printKeepPortraitGuidance,
    'Keep "Portrait orientation" in the system print dialog.',
  );
});

test("runtime UI text normalization replaces overrides from immutable defaults", () => {
  const first = normalizeUiTextOptions({
    labels: { search: "Find" },
    formatters: { zoom: scale => `${scale}x` },
  });
  const second = normalizeUiTextOptions({ labels: { print: "Imprimer" } });
  assert.equal(first.labels.search, "Find");
  assert.equal(first.formatters.zoom(2), "2x");
  assert.equal(second.labels.search, PDFJS_VIEWER_DEFAULT_LABELS.search);
  assert.equal(second.labels.print, "Imprimer");
  assert.equal(second.formatters.zoom(2), "200%");
  assert.ok(Object.isFrozen(second.labels));
  assert.ok(Object.isFrozen(second.formatters));
  assert.throws(
    () => normalizeUiTextOptions({ unknown: true } as never),
    /unknown UI text\.unknown/,
  );
  assert.throws(
    () => normalizeUiTextOptions({ labels: { search: 1 } } as never),
    /labels\.search must be a string/,
  );
});

test("default labels are strictly strings", () => {
  for (const label of Object.values(PDFJS_VIEWER_DEFAULT_LABELS))
    assert.equal(typeof label, "string");
});

test("generated history and viewing modes share a compact row before zoom", () => {
  const html = renderPdfjsViewerUi({ id: "history" });
  const modeRow = html.indexOf('class="pdf-navigation-mode-row"');
  const history = html.indexOf('class="pdf-navigation-history-controls"');
  const fullscreen = html.indexOf("pdf-fullscreen-toggle-btn");
  const presentation = html.indexOf("pdf-presentation-toggle-btn");
  const zoom = html.indexOf('class="pdf-zoom-controls"');
  assert.ok(modeRow >= 0 && modeRow < history && history < fullscreen);
  assert.ok(fullscreen < presentation && presentation < zoom);
  assert.match(
    html,
    /pdf-navigation-mode-row.*pdf-navigation-history-controls.*pdf-viewing-mode-controls.*pdf-fullscreen-toggle-btn.*pdf-presentation-toggle-btn/,
  );
  assert.match(html, /pdf-navigation-history-group"><legend>Navigation history<\/legend>/);
  assert.match(html, /pdf-viewing-mode-group"><legend>View mode<\/legend>/);
  assert.match(
    html,
    /pdf-navigation-history-back-btn[^>]*title="Go back in navigation history"[^>]*disabled aria-disabled="true"/,
  );
  assert.match(
    html,
    /pdf-navigation-history-forward-btn[^>]*title="Go forward in navigation history"[^>]*disabled aria-disabled="true"/,
  );
  assert.doesNotMatch(
    renderPdfjsViewerUi({ id: "without-history", controls: { navigationHistory: false } }),
    /pdf-navigation-history-/,
  );
  assert.match(
    renderPdfjsViewerUi({ id: "without-history", controls: { navigationHistory: false } }),
    /pdf-fullscreen-toggle-btn.*pdf-presentation-toggle-btn/,
  );
  assert.doesNotMatch(
    renderPdfjsViewerUi({ id: "without-menu", controls: { menu: false } }),
    /pdf-navigation-history-/,
  );
  assert.throws(
    () =>
      renderPdfjsViewerUi({
        id: "invalid-history",
        controls: { navigationHistory: "yes" },
      } as never),
    /controls\.navigationHistory must be a boolean/,
  );
});

test("generated viewing modes expose distinct accessible toggles and transient controls", () => {
  const html = renderPdfjsViewerUi({
    id: "modes",
    labels: { fullscreen: "Expand", presentation: "Project", presentationControls: "Slides" },
  });
  assert.match(html, /pdf-fullscreen-toggle-btn[^>]*title="Expand"[^>]*aria-pressed="false"/);
  assert.match(
    html,
    /pdf-presentation-toggle-btn[^>]*title="Project"[^>]*aria-pressed="false"[^>]*disabled/,
  );
  assert.match(html, /class="pdf-presentation-controls" role="toolbar" aria-label="Slides"/);
  assert.match(html, /pdf-presentation-previous-btn/);
  assert.match(html, /pdf-presentation-exit-btn/);
  assert.match(html, /pdf-presentation-next-btn/);

  const noFullscreen = renderPdfjsViewerUi({
    id: "presentation-only",
    controls: { fullscreen: false },
  });
  assert.doesNotMatch(noFullscreen, /pdf-fullscreen-toggle-btn/);
  assert.match(noFullscreen, /pdf-presentation-toggle-btn/);
  const noPresentation = renderPdfjsViewerUi({
    id: "fullscreen-only",
    controls: { presentation: false },
  });
  assert.match(noPresentation, /pdf-fullscreen-toggle-btn/);
  assert.doesNotMatch(noPresentation, /pdf-presentation-/);
});

test("generated UI factories require non-empty IDs and preserve independent form saving", () => {
  for (const id of ["", "   ", null, 1]) {
    assert.throws(() => renderPdfjsViewerUi({ id } as never), /id must be a non-empty string/);
  }
  assert.equal(normalizeGeneratedUiOptions({ id: "  viewer  " }).id, "viewer");

  const html = renderPdfjsViewerUi({
    id: "form-only",
    controls: { download: false, downloadFilledDocument: true, print: false },
  });
  assert.match(
    html,
    /class="pdf-ui-button pdf-menu-primary-action-start pdf-download-filled-document-btn"/,
  );
  assert.doesNotMatch(html, /pdf-download-btn|pdf-print-btn/);
});

test("generated UI emits its styling marker and complete initial ARIA relationships", () => {
  const html = renderPdfjsViewerUi({ id: "rtl-viewer", direction: "rtl" });
  assert.match(html, /^<div class="pdf-default-ui" dir="rtl" data-pdfjs-viewer-root>/);
  assert.match(
    html,
    /class="[^"]*pdf-search-toggle-btn"[^>]*aria-controls="rtl-viewer-search"[^>]*aria-expanded="false"/,
  );
  assert.match(html, /id="rtl-viewer-search"[^>]*role="search"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /class="[^"]*pdf-sidebar-toggle-btn"[^>]*aria-label="Document navigation"/);
  assert.match(html, /class="pdf-container" tabindex="0"/);
  assert.match(html, /class="pdf-document-progress"[^>]*aria-label="Loading PDF"/);
});

test("generated sidebar SSR selects one enabled view across primary and overflow controls", () => {
  const selected = (html: string) => ({
    panels: [...html.matchAll(/<section ([^>]+)>/g)]
      .filter(([, attributes]) => !attributes.includes("hidden inert"))
      .map(([, attributes]) => /data-pdf-sidebar-view="([^"]+)"/.exec(attributes)?.[1]),
    primary: [
      ...html.matchAll(
        /class="pdf-sidebar-view-button"[^>]*data-pdf-sidebar-view="([^"]+)"[^>]*aria-pressed="true"/g,
      ),
    ].map(match => match[1]),
    overflow: [
      ...html.matchAll(
        /role="menuitemradio"[^>]*data-pdf-sidebar-view="([^"]+)"[^>]*aria-checked="true"/g,
      ),
    ].map(match => match[1]),
    overflowSelected: /pdf-sidebar-more-toggle"[^>]*data-selected="true"/.test(html),
  });

  assert.deepEqual(
    selected(
      renderPdfjsViewerUi({ id: "sidebar-thumbnails", sidebar: { primaryViews: ["thumbnails"] } }),
    ),
    {
      panels: ["thumbnails"],
      primary: ["thumbnails"],
      overflow: [],
      overflowSelected: false,
    },
  );
  assert.deepEqual(
    selected(renderPdfjsViewerUi({ id: "sidebar-layers", sidebar: { primaryViews: ["layers"] } })),
    {
      panels: ["layers"],
      primary: ["layers"],
      overflow: [],
      overflowSelected: false,
    },
  );
  assert.deepEqual(
    selected(renderPdfjsViewerUi({ id: "sidebar-overflow", sidebar: { primaryViews: [] } })),
    {
      panels: ["outline"],
      primary: [],
      overflow: ["outline"],
      overflowSelected: true,
    },
  );
  assert.deepEqual(
    selected(
      renderPdfjsViewerUi({
        id: "sidebar-unavailable",
        controls: { outline: false },
        sidebar: { primaryViews: ["outline", "layers"] },
      }),
    ),
    {
      panels: ["layers"],
      primary: ["layers"],
      overflow: [],
      overflowSelected: false,
    },
  );
});
