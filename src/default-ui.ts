// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public pure renderer for package-owned default and custom PDF viewer variants.
 *
 * Package consumers may use {@link renderPdfjsViewerUi} before constructing a
 * viewer, including in template and server-rendering pipelines. The renderer
 * emits stable host extension slots, performs no DOM access, and escapes every
 * caller-provided string. Import `@unilarva/pdfjs-viewer/default-ui.css` for the
 * themed default variant, or `core.css` plus host styles for the custom variant.
 * See the [architecture guide](../ARCHITECTURE.md) for the UI/facade boundary.
 *
 * @packageDocumentation
 * @module default-ui
 */

import type {
  PdfjsViewerLabels,
  PdfjsViewerSidebarView,
  PdfjsViewerUiRenderOptions,
} from "./viewer-contracts.js";
import {
  normalizeGeneratedUiOptions,
  type NormalizedGeneratedUiOptions,
} from "./generated-ui-options.js";

export {
  normalizeGeneratedUiOptions,
  normalizeUiTextOptions,
  PDFJS_VIEWER_DEFAULT_FORMATTERS,
  PDFJS_VIEWER_DEFAULT_LABELS,
} from "./generated-ui-options.js";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function icon(): string {
  return '<span class="pdf-ui-icon" aria-hidden="true"></span>';
}
function button(className: string, label: string, disabled = false, attributes = ""): string {
  const escaped = escapeHtml(label);
  return `<button type="button" class="pdf-ui-button pdf-icon-button ${className}" title="${escaped}" aria-label="${escaped}"${attributes}${disabled ? ' disabled aria-disabled="true"' : ""}>${icon()}</button>`;
}

function renderPrintSetup(id: string, l: Readonly<PdfjsViewerLabels>): string {
  const option = (value: string, label: string, selected = false) =>
    `<option value="${value}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const control = (
    name: string,
    label: string,
    options: string,
    className: string,
    help?: string,
  ) => {
    const helpId = `${id}-print-${name}-help`;
    return `<div class="pdf-print-control"><label for="${id}-print-${name}">${escapeHtml(label)}</label><select id="${id}-print-${name}" class="${className}"${help ? ` aria-describedby="${helpId}"` : ""}>${options}</select>${help ? `<small id="${helpId}" class="pdf-print-help pdf-print-${name}-help">${escapeHtml(help)}</small>` : ""}</div>`;
  };
  const pages = `${option("all", l.printAllPages)}${option("custom", l.printCustomPages)}`;
  const layouts = `${option("auto", l.printLayoutAuto)}${option("single", l.printLayoutSingle)}${option("spread", l.printLayoutSpread)}`;
  const sheets = `${option("a3", l.printSheetA3)}${option("a4", l.printSheetA4, true)}${option("a5", l.printSheetA5)}${option("letter", l.printSheetLetter)}${option("legal", l.printSheetLegal)}${option("custom", l.printSheetCustom)}`;
  const pageScaling = `${option("fit", l.printPageScalingFit, true)}${option("shrink-to-fit", l.printPageScalingShrinkToFit)}`;
  const orientations = `${option("auto", l.printOrientationAuto)}${option("portrait", l.printOrientationPortrait)}${option("landscape", l.printOrientationLandscape)}`;
  const qualities = `${option("300", l.printQuality300, true)}${option("600", l.printQuality600)}`;
  const customSheet = `<div class="pdf-print-conditional pdf-print-custom-sheet" hidden inert aria-hidden="true"><label for="${id}-print-sheet-width">${escapeHtml(l.printSheetWidth)}</label><input id="${id}-print-sheet-width" class="pdf-print-sheet-width" type="number" min="1" step="any" value="210" autocomplete="off" enterkeyhint="done"><label for="${id}-print-sheet-height">${escapeHtml(l.printSheetHeight)}</label><input id="${id}-print-sheet-height" class="pdf-print-sheet-height" type="number" min="1" step="any" value="297" autocomplete="off" enterkeyhint="done"><label for="${id}-print-sheet-unit">${escapeHtml(l.printSheetUnit)}</label><select id="${id}-print-sheet-unit" class="pdf-print-sheet-unit"><option value="mm">${escapeHtml(l.printSheetUnitMillimeters)}</option><option value="pt">${escapeHtml(l.printSheetUnitPoints)}</option><option value="in">${escapeHtml(l.printSheetUnitInches)}</option></select></div>`;
  const side = `<div class="pdf-print-conditional pdf-print-side" hidden inert aria-hidden="true"><label for="${id}-print-side">${escapeHtml(l.printFirstPageSide)}</label><select id="${id}-print-side" class="pdf-print-side-select">${option("auto", l.printFirstPageAuto)}${option("right", l.printFirstPageRight)}${option("left", l.printFirstPageLeft)}</select></div>`;
  const basic = `<div class="pdf-print-basic"><div class="pdf-print-control-row">${control("pages", l.printPages, pages, "pdf-print-pages")}<div class="pdf-print-conditional pdf-print-range-wrap" hidden inert aria-hidden="true"><label for="${id}-print-range">${escapeHtml(l.printRange)}</label><input id="${id}-print-range" class="pdf-print-range" placeholder="${escapeHtml(l.printRangePlaceholder)}" autocomplete="off" enterkeyhint="done"></div></div><div class="pdf-print-control-row">${control("sheet", l.printSheet, sheets, "pdf-print-sheet", l.printSheetHelp)}${customSheet}</div></div>`;
  const advanced = `<details class="pdf-print-more"><summary>${escapeHtml(l.printMoreSettings)}</summary><div class="pdf-print-fields"><div class="pdf-print-control-row">${control("layout", l.printLayout, layouts, "pdf-print-layout", l.printLayoutAutoHelp)}${side}</div><div class="pdf-print-control-row">${control("orientation", l.printOrientation, orientations, "pdf-print-orientation", l.printOrientationHelp)}</div><div class="pdf-print-control-row">${control("page-scaling", l.printPageScaling, pageScaling, "pdf-print-page-scaling", l.printPageScalingHelp)}${control("quality", l.printQuality, qualities, "pdf-print-quality", l.printResolutionHelp)}</div></div></details>`;
  return `<dialog id="${id}-print-setup" class="pdf-print-setup" aria-labelledby="${id}-print-title"><form method="dialog" autocomplete="off"><header class="pdf-print-header"><h2 id="${id}-print-title">${escapeHtml(l.printSetup)}</h2><button type="button" class="pdf-ui-button pdf-icon-button pdf-print-close" title="${escapeHtml(l.close)}" aria-label="${escapeHtml(l.close)}">${icon()}</button></header>${basic}${advanced}<div class="pdf-print-feedback"><p class="pdf-print-status" role="status" aria-live="polite"></p><progress class="pdf-print-progress" max="1" value="0" aria-label="${escapeHtml(l.printProgress)}" hidden></progress><p class="pdf-print-fallback-warning" aria-live="polite" hidden></p></div><p class="pdf-print-guidance"></p><div class="pdf-print-actions"><button type="button" class="pdf-ui-button pdf-print-cancel" value="cancel">${escapeHtml(l.printCancel)}</button><button type="button" class="pdf-ui-button pdf-print-source" hidden>${escapeHtml(l.printSource)}</button><button type="submit" class="pdf-ui-button pdf-print-submit"><span>${escapeHtml(l.printPrepare)}</span><small class="pdf-print-submit-detail"></small></button></div></form></dialog>`;
}
function renderDocumentInformation(id: string, l: Readonly<PdfjsViewerLabels>): string {
  const title = escapeHtml(l.documentInformation);
  const close = escapeHtml(l.close);
  return `<dialog id="${id}-document-information" class="pdf-document-information" aria-labelledby="${id}-document-information-title"><div class="pdf-document-information-dialog"><header class="pdf-document-information-header"><h2 id="${id}-document-information-title" class="pdf-document-information-title">${title}</h2><button type="button" class="pdf-ui-button pdf-icon-button pdf-document-information-close" title="${close}" aria-label="${close}">${icon()}</button></header><p class="pdf-document-information-status" role="status" aria-live="polite"></p><div class="pdf-document-information-content"></div><div class="pdf-document-information-actions"><button type="button" class="pdf-ui-button pdf-document-information-accept">${escapeHtml(l.documentInformationAccept)}</button></div></div></dialog>`;
}
function choice(
  name: string,
  value: string,
  label: string,
  dataName: string,
  disabled = false,
): string {
  const escapedName = escapeHtml(name);
  const escapedValue = escapeHtml(value);
  return `<span class="pdf-radio-choice"><input type="radio" name="${escapedName}" id="${escapedName}-${escapedValue}" data-${dataName}="${escapedValue}"${disabled ? ' disabled aria-disabled="true"' : ""}><label for="${escapedName}-${escapedValue}">${escapeHtml(label)}</label></span>`;
}

/** Renders deterministic, fully escaped generated viewer UI from normalized options. */
function renderNormalizedPdfjsViewerUi(normalized: NormalizedGeneratedUiOptions): string {
  const { id, initialUrl, labels: l, controls: c, direction, variant, sidebar } = normalized;
  const eid = escapeHtml(id);
  const navigation = c.navigation
    ? `<div class="pdf-page-nav">${button("pdf-prev-page-btn", l.previousPage, true)}<input id="${eid}-page-number-input" class="pdf-page-number-input" value="1" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(l.currentPage)}" disabled><span class="pdf-page-sep" aria-hidden="true">/</span><span class="pdf-page-count" aria-live="polite" aria-atomic="true">?</span>${button("pdf-next-page-btn", l.nextPage, true)}</div>`
    : "";
  const search = c.search
    ? `<div class="pdf-search">${button("pdf-search-toggle-btn", l.search, true, ` aria-controls="${eid}-search" aria-expanded="false"`)}<div id="${eid}-search" class="pdf-search-panel" hidden data-open="false" role="search" aria-hidden="true" inert><div class="pdf-search-controls"><input id="${eid}-search-input" type="search" class="pdf-search-input" placeholder="${escapeHtml(l.searchPlaceholder)}" autocomplete="off" aria-label="${escapeHtml(l.search)}">${button("pdf-search-previous-btn", l.searchPrevious)}${button("pdf-search-next-btn", l.searchNext)}<span class="pdf-search-count" role="status" aria-live="polite" aria-atomic="true"></span>${button("pdf-search-close-btn", l.close)}</div><div class="pdf-search-extension" data-pdfjs-viewer-extension="search"></div></div></div>`
    : "";
  const download = c.download
    ? `<a class="pdf-ui-button pdf-menu-primary-action-start pdf-download-btn"${initialUrl ? ` href="${escapeHtml(initialUrl)}" download target="_blank" rel="noopener"` : ' hidden aria-disabled="true"'}>${icon()}<span class="pdf-ui-label">${escapeHtml(l.download)}</span></a>`
    : "";
  const downloadFilledDocument = c.downloadFilledDocument
    ? `<button type="button" class="pdf-ui-button${c.download ? "" : " pdf-menu-primary-action-start"} pdf-download-filled-document-btn" hidden disabled aria-disabled="true">${icon()}<span class="pdf-ui-label">${escapeHtml(l.downloadFilledDocument)}</span></button>`
    : "";
  const print = c.print
    ? `<button type="button" class="pdf-ui-button${c.download || c.downloadFilledDocument ? "" : " pdf-menu-primary-action-start"} pdf-print-btn" aria-haspopup="dialog" aria-controls="${eid}-print-setup">${icon()}<span class="pdf-ui-label">${escapeHtml(l.print)}</span></button>`
    : "";
  const information = c.documentInformation
    ? `<button type="button" class="pdf-ui-button pdf-document-information-btn" aria-haspopup="dialog" aria-controls="${eid}-document-information" disabled aria-disabled="true">${icon()}<span class="pdf-ui-label">${escapeHtml(l.documentInformation)}</span></button>`
    : "";
  const primaryActions = `${button("pdf-menu-close-btn", l.close)}${download}${downloadFilledDocument}${print}`;
  const textSelection = c.textSelection
    ? `<button type="button" class="pdf-ui-button pdf-text-selection-toggle-btn" aria-label="${escapeHtml(l.textSelection)}" title="${escapeHtml(l.textSelection)}" aria-pressed="false" disabled aria-disabled="true">${icon()}<span class="pdf-ui-label">${escapeHtml(l.textSelection)}</span></button>`
    : "";
  const secondaryActions =
    information || textSelection
      ? `<div class="pdf-menu-secondary-actions">${information}${textSelection}</div>`
      : "";
  const extension = '<div class="pdf-menu-extension" data-pdfjs-viewer-extension="menu"></div>';
  const actions = `<div class="pdf-menu-primary-actions">${primaryActions}</div>${extension}${secondaryActions}`;
  const zoom =
    c.zoom || c.fit
      ? `<fieldset class="pdf-zoom-controls"><legend class="pdf-zoom-label">${escapeHtml(l.zoom)}</legend><div class="pdf-zoom-row">${c.zoom ? `<div class="pdf-zoom-slider-wrap"><input id="${eid}-zoom" type="range" class="pdf-zoom-slider" min="0" max="100" value="0" aria-label="${escapeHtml(l.zoom)}" disabled></div>` : ""}${c.fit ? button("pdf-fit-menu-btn", l.fit, true) : ""}</div></fieldset>`
      : "";
  const navigationHistory = c.navigationHistory
    ? `<fieldset class="pdf-navigation-history-group"><legend>${escapeHtml(l.navigationHistory)}</legend><div class="pdf-navigation-history-controls">${button("pdf-navigation-history-back-btn", l.navigationHistoryBack, true)}${button("pdf-navigation-history-forward-btn", l.navigationHistoryForward, true)}</div></fieldset>`
    : "";
  const fullscreen = c.fullscreen
    ? button("pdf-fullscreen-toggle-btn", l.fullscreen, false, ' aria-pressed="false"')
    : "";
  const presentation = c.presentation
    ? button("pdf-presentation-toggle-btn", l.presentation, true, ' aria-pressed="false"')
    : "";
  const viewingModes =
    fullscreen || presentation
      ? `<fieldset class="pdf-viewing-mode-group"><legend>${escapeHtml(l.viewMode)}</legend><div class="pdf-viewing-mode-controls">${fullscreen}${presentation}</div></fieldset>`
      : "";
  const modeRow =
    navigationHistory || fullscreen || presentation
      ? `<div class="pdf-navigation-mode-row">${navigationHistory}${viewingModes}</div>`
      : "";
  const pageLayout = c.pageLayout
    ? `<fieldset><legend>${escapeHtml(l.pageLayout)}</legend><div class="pdf-page-layout-group">${choice(`${id}-page-layout`, "auto", l.pageLayoutAuto, "pdf-page-layout", true)}${choice(`${id}-page-layout`, "single", l.pageLayoutSingle, "pdf-page-layout", true)}${choice(`${id}-page-layout`, "double", l.pageLayoutDouble, "pdf-page-layout", true)}${choice(`${id}-page-layout`, "book", l.pageLayoutBook, "pdf-page-layout", true)}</div></fieldset>`
    : "";
  const fitMode = c.fitMode
    ? `<fieldset><legend>${escapeHtml(l.fitMode)}</legend><div class="pdf-fit-mode-group">${choice(`${id}-fit-mode`, "auto", l.fitModeAuto, "pdf-fit-mode", true)}${choice(`${id}-fit-mode`, "contain", l.fitModeContain, "pdf-fit-mode", true)}${choice(`${id}-fit-mode`, "width", l.fitModeWidth, "pdf-fit-mode", true)}${choice(`${id}-fit-mode`, "height", l.fitModeHeight, "pdf-fit-mode", true)}</div></fieldset>`
    : "";
  const rotation = c.rotation
    ? `<fieldset><legend>${escapeHtml(l.rotation)}</legend><div class="pdf-rotation-controls">${button("pdf-rotate-counterclockwise-btn", l.rotateCounterclockwise, true)}${button("pdf-reset-rotation-btn", l.resetRotation, true)}${button("pdf-rotate-clockwise-btn", l.rotateClockwise, true)}</div></fieldset>`
    : "";
  const profile = c.renderingProfile
    ? `<fieldset><legend>${escapeHtml(l.renderingProfile)}</legend><div class="pdf-rendering-profile-group">${choice(`${id}-rendering-profile`, "conservative", l.renderingConservative, "pdf-rendering-profile", true)}${choice(`${id}-rendering-profile`, "balanced", l.renderingBalanced, "pdf-rendering-profile", true)}${choice(`${id}-rendering-profile`, "aggressive", l.renderingAggressive, "pdf-rendering-profile", true)}</div></fieldset>`
    : "";
  const menu = c.menu
    ? `<div class="pdf-menu">${button("pdf-menu-toggle-btn", l.menu, true, ` aria-controls="${eid}-menu" aria-expanded="false"`)}<div id="${eid}-menu" class="pdf-menu-panel" hidden data-open="false" role="dialog" aria-label="${escapeHtml(l.menu)}" aria-hidden="true" inert><div class="pdf-menu-actions">${actions}</div>${modeRow}${zoom}${fitMode}${pageLayout}${rotation}${profile}</div></div>`
    : "";
  const sidebarViews = [
    c.outline ? { name: "outline" as const, label: l.outline } : null,
    c.thumbnails ? { name: "thumbnails" as const, label: l.thumbnails } : null,
    c.attachments ? { name: "attachments" as const, label: l.attachments } : null,
    c.layers ? { name: "layers" as const, label: l.layers } : null,
  ].filter((view): view is { name: PdfjsViewerSidebarView; label: string } => view !== null);
  const sidebarViewsByName = new Map(sidebarViews.map(view => [view.name, view]));
  const primaryViews = sidebar.primaryViews.flatMap(name => {
    const view = sidebarViewsByName.get(name);
    return view ? [view] : [];
  });
  const moreViews = sidebarViews.filter(view => !sidebar.primaryViews.includes(view.name));
  const initialSidebarView = primaryViews[0] ?? moreViews[0] ?? null;
  const hasSidebar = sidebarViews.length > 0;
  const sidebarToggle = hasSidebar ? button("pdf-sidebar-toggle-btn", l.sidebar, true) : "";
  const primary = `<div class="pdf-sidebar-primary-views" role="toolbar" aria-label="${escapeHtml(l.sidebar)}"${primaryViews.length ? "" : " hidden"}>${primaryViews.map(view => `<button type="button" class="pdf-sidebar-view-button" data-pdf-sidebar-view="${view.name}" aria-controls="${eid}-${view.name}-panel" aria-pressed="${view.name === initialSidebarView?.name}">${escapeHtml(view.label)}</button>`).join("")}</div>`;
  const moreLabel = escapeHtml(l.sidebarMoreViews);
  const more = `<div class="pdf-sidebar-more"${moreViews.length ? "" : " hidden"}><button type="button" class="pdf-ui-button pdf-icon-button pdf-sidebar-more-toggle" title="${moreLabel}" aria-label="${moreLabel}" aria-haspopup="menu" aria-controls="${eid}-sidebar-more-menu" aria-expanded="false" data-selected="${moreViews.some(view => view.name === initialSidebarView?.name)}"><span class="pdf-ui-icon" aria-hidden="true"></span></button><div id="${eid}-sidebar-more-menu" class="pdf-sidebar-more-menu" role="menu" aria-label="${moreLabel}" aria-hidden="true" hidden inert>${moreViews.map(view => `<button type="button" role="menuitemradio" data-pdf-sidebar-view="${view.name}" aria-controls="${eid}-${view.name}-panel" aria-checked="${view.name === initialSidebarView?.name}">${escapeHtml(view.label)}</button>`).join("")}</div></div>`;
  const panelAttributes = (name: string, label: string) =>
    `id="${eid}-${name}-panel" class="pdf-sidebar-panel" role="region" data-pdf-sidebar-view="${name}" aria-label="${escapeHtml(label)}"${name === initialSidebarView?.name ? "" : " hidden inert"}`;
  const outline = c.outline
    ? `<section ${panelAttributes("outline", l.outline)}>${c.outlineFilter ? `<div class="pdf-outline-filter"><input id="${eid}-outline-filter-input" type="search" class="pdf-outline-filter-input" placeholder="${escapeHtml(l.outlineFilter)}" autocomplete="off" aria-label="${escapeHtml(l.outlineFilter)}"></div>` : ""}<div class="pdf-outline"></div></section>`
    : "";
  const thumbnails = c.thumbnails
    ? `<section ${panelAttributes("thumbnails", l.thumbnails)}><div class="pdf-thumbnails"></div></section>`
    : "";
  const attachments = c.attachments
    ? `<section ${panelAttributes("attachments", l.attachments)}><div class="pdf-attachments"></div></section>`
    : "";
  const layers = c.layers
    ? `<section ${panelAttributes("layers", l.layers)}><div class="pdf-layers"></div></section>`
    : "";
  const sidebarMarkup = hasSidebar
    ? `<aside id="${eid}-sidebar" class="pdf-sidebar" tabindex="-1" data-open="false" aria-label="${escapeHtml(l.sidebar)}" aria-hidden="true" inert><div class="pdf-sidebar-header">${primary}${more}${button("pdf-sidebar-close-btn", l.close)}</div>${outline}${thumbnails}${attachments}${layers}</aside>`
    : "";
  const shellClass = variant === "default" ? "pdf-default-ui" : "pdf-custom-ui";
  const presentationControls = c.presentation
    ? `<div class="pdf-presentation-controls" role="toolbar" aria-label="${escapeHtml(l.presentationControls)}" hidden inert aria-hidden="true">${button("pdf-presentation-previous-btn", l.presentationPrevious, true)}${button("pdf-presentation-exit-btn", l.exitPresentation)}${button("pdf-presentation-next-btn", l.presentationNext, true)}</div>`
    : "";
  return `<div class="${shellClass}" dir="${direction}" data-pdfjs-viewer-root><div class="pdf-controls"><div class="pdf-controls-toolbar" role="toolbar" aria-label="${escapeHtml(l.controls)}"><div class="pdf-controls-toolbar-start">${sidebarToggle}${c.fit ? button("pdf-fit-main-btn", l.fit, true) : ""}</div>${navigation}<div class="pdf-controls-toolbar-end">${search}${menu}</div></div></div>${presentationControls}<div class="pdf-viewer-body"><progress class="pdf-document-progress" max="1" value="0" aria-label="${escapeHtml(l.documentProgress)}"></progress>${sidebarMarkup}<div class="pdf-container" tabindex="0"></div></div>${c.documentInformation ? renderDocumentInformation(eid, l) : ""}${c.print ? renderPrintSetup(eid, l) : ""}</div>`;
}

/** Returns deterministic, fully escaped generated viewer UI markup. */
export function renderPdfjsViewerUi(options: PdfjsViewerUiRenderOptions): string {
  return renderNormalizedPdfjsViewerUi(normalizeGeneratedUiOptions(options));
}

const VOID_UI_ELEMENTS = new Set(["input"]);

function decodeUiText(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    entity =>
      ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
      })[entity]!,
  );
}

/**
 * Creates generated UI exclusively through DOM construction APIs. This is the
 * browser counterpart to {@link renderPdfjsViewerUi}; it deliberately avoids
 * HTML parsing sinks so it works when Trusted Types enforcement is enabled.
 */
export function createPdfjsViewerUi(
  options: PdfjsViewerUiRenderOptions,
  ownerDocument: Document = document,
): HTMLElement {
  const normalized = normalizeGeneratedUiOptions(options);
  const markup = renderNormalizedPdfjsViewerUi(normalized);
  const fragment = ownerDocument.createDocumentFragment();
  const parents: ParentNode[] = [fragment];
  const elements: Element[] = [];
  const tokens = markup.match(/<[^>]+>|[^<]+/g) ?? [];

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      parents.at(-1)!.append(ownerDocument.createTextNode(decodeUiText(token)));
      continue;
    }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1);
      const element = elements.pop();
      if (!element || element.localName !== name)
        throw new Error("PdfjsViewer: generated UI markup is unbalanced");
      parents.pop();
      continue;
    }

    const start = /^<([a-z][a-z0-9-]*)([\s\S]*)>$/.exec(token);
    if (!start) throw new Error("PdfjsViewer: generated UI markup contains an invalid element");
    const [, name, attributes] = start;
    const element = ownerDocument.createElement(name);
    const attributePattern = /\s+([^\s=]+)(?:="([^"]*)")?/gy;
    let offset = 0;
    while (offset < attributes.length) {
      attributePattern.lastIndex = offset;
      const attribute = attributePattern.exec(attributes);
      if (!attribute)
        throw new Error("PdfjsViewer: generated UI markup contains an invalid attribute");
      element.setAttribute(attribute[1], decodeUiText(attribute[2] ?? ""));
      offset = attributePattern.lastIndex;
    }
    parents.at(-1)!.append(element);
    if (!VOID_UI_ELEMENTS.has(name)) {
      parents.push(element);
      elements.push(element);
    }
  }

  if (parents.length !== 1 || fragment.childElementCount !== 1) {
    throw new Error("PdfjsViewer: generated UI markup must contain exactly one balanced root");
  }
  const root = fragment.firstElementChild as HTMLElement;
  refreshGeneratedUiText(root, normalized.labels);
  return root;
}

/**
 * Refreshes only nodes annotated as package-authored generated UI. The metadata
 * is deliberately installed by the factory, so externally supplied custom UI is
 * never treated as localizable package markup.
 */
export function refreshGeneratedUiText(
  root: HTMLElement,
  labels: Readonly<PdfjsViewerLabels>,
): void {
  const initialized = root.dataset.pdfjsUiTextInitialized === "true";
  const text = (selector: string, key: keyof PdfjsViewerLabels): void => {
    const marker = "data-pdfjs-ui-text-content";
    const elements = initialized
      ? root.querySelectorAll<HTMLElement>(`[${marker}='${key}']`)
      : root.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (!initialized) element.setAttribute(marker, key);
      element.textContent = labels[key];
    }
  };
  const attr = (selector: string, name: string, key: keyof PdfjsViewerLabels): void => {
    const marker = `data-pdfjs-ui-text-${name}`;
    const elements = initialized
      ? root.querySelectorAll<HTMLElement>(`[${marker}='${key}']`)
      : root.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (!initialized) element.setAttribute(marker, key);
      element.setAttribute(name, labels[key]);
    }
  };
  const groupLegend = (selector: string, key: keyof PdfjsViewerLabels): void => {
    const marker = "data-pdfjs-ui-text-content";
    const legends = initialized
      ? root.querySelectorAll<HTMLElement>(`[${marker}='${key}']`)
      : Array.from(root.querySelectorAll<HTMLElement>(selector)).flatMap(group => {
          const legend = group.closest("fieldset")?.querySelector<HTMLElement>(":scope > legend");
          return legend ? [legend] : [];
        });
    for (const legend of legends) {
      if (!initialized) legend.setAttribute(marker, key);
      legend.textContent = labels[key];
    }
  };
  const buttonLabels: ReadonlyArray<readonly [string, keyof PdfjsViewerLabels]> = [
    [".pdf-prev-page-btn", "previousPage"],
    [".pdf-next-page-btn", "nextPage"],
    [".pdf-search-toggle-btn", "search"],
    [".pdf-search-previous-btn", "searchPrevious"],
    [".pdf-search-next-btn", "searchNext"],
    [".pdf-search-close-btn", "close"],
    [".pdf-menu-toggle-btn", "menu"],
    [".pdf-menu-close-btn", "close"],
    [".pdf-sidebar-toggle-btn", "sidebar"],
    [".pdf-sidebar-close-btn", "close"],
    [".pdf-fit-main-btn, .pdf-fit-menu-btn", "fit"],
    [".pdf-text-selection-toggle-btn", "textSelection"],
    [".pdf-rotate-counterclockwise-btn", "rotateCounterclockwise"],
    [".pdf-reset-rotation-btn", "resetRotation"],
    [".pdf-rotate-clockwise-btn", "rotateClockwise"],
    [".pdf-navigation-history-back-btn", "navigationHistoryBack"],
    [".pdf-navigation-history-forward-btn", "navigationHistoryForward"],
    [".pdf-fullscreen-toggle-btn", "fullscreen"],
    [".pdf-presentation-toggle-btn", "presentation"],
    [".pdf-presentation-previous-btn", "presentationPrevious"],
    [".pdf-presentation-next-btn", "presentationNext"],
    [".pdf-presentation-exit-btn", "exitPresentation"],
    [".pdf-document-information-close, .pdf-print-close", "close"],
  ];
  for (const [selector, key] of buttonLabels) {
    attr(selector, "title", key);
    attr(selector, "aria-label", key);
  }
  const staticText: ReadonlyArray<readonly [string, keyof PdfjsViewerLabels]> = [
    [".pdf-download-btn .pdf-ui-label", "download"],
    [".pdf-download-filled-document-btn .pdf-ui-label", "downloadFilledDocument"],
    [".pdf-print-btn .pdf-ui-label", "print"],
    [".pdf-document-information-btn .pdf-ui-label", "documentInformation"],
    [".pdf-text-selection-toggle-btn .pdf-ui-label", "textSelection"],
    [".pdf-zoom-label", "zoom"],
    [".pdf-page-layout-group label[for$='-auto']", "pageLayoutAuto"],
    [".pdf-page-layout-group label[for$='-single']", "pageLayoutSingle"],
    [".pdf-page-layout-group label[for$='-double']", "pageLayoutDouble"],
    [".pdf-page-layout-group label[for$='-book']", "pageLayoutBook"],
    [".pdf-fit-mode-group label[for$='-auto']", "fitModeAuto"],
    [".pdf-fit-mode-group label[for$='-contain']", "fitModeContain"],
    [".pdf-fit-mode-group label[for$='-width']", "fitModeWidth"],
    [".pdf-fit-mode-group label[for$='-height']", "fitModeHeight"],
    [".pdf-rendering-profile-group label[for$='-conservative']", "renderingConservative"],
    [".pdf-rendering-profile-group label[for$='-balanced']", "renderingBalanced"],
    [".pdf-rendering-profile-group label[for$='-aggressive']", "renderingAggressive"],
    [".pdf-zoom-controls > legend", "zoom"],
    [".pdf-document-information-title", "documentInformation"],
    [".pdf-document-information-accept", "documentInformationAccept"],
    [".pdf-print-header h2", "printSetup"],
    [".pdf-print-cancel", "printCancel"],
    [".pdf-print-source", "printSource"],
    [".pdf-print-submit > span", "printPrepare"],
    ["label[for$='-print-pages']", "printPages"],
    [".pdf-print-pages option[value='all']", "printAllPages"],
    [".pdf-print-pages option[value='custom']", "printCustomPages"],
    ["label[for$='-print-range']", "printRange"],
    ["label[for$='-print-layout']", "printLayout"],
    [".pdf-print-layout option[value='auto']", "printLayoutAuto"],
    [".pdf-print-layout option[value='single']", "printLayoutSingle"],
    [".pdf-print-layout option[value='spread']", "printLayoutSpread"],
    ["label[for$='-print-side']", "printFirstPageSide"],
    [".pdf-print-side-select option[value='auto']", "printFirstPageAuto"],
    [".pdf-print-side-select option[value='right']", "printFirstPageRight"],
    [".pdf-print-side-select option[value='left']", "printFirstPageLeft"],
    [".pdf-print-more > summary", "printMoreSettings"],
    ["label[for$='-print-sheet']", "printSheet"],
    [".pdf-print-sheet option[value='a3']", "printSheetA3"],
    [".pdf-print-sheet option[value='a4']", "printSheetA4"],
    [".pdf-print-sheet option[value='a5']", "printSheetA5"],
    [".pdf-print-sheet option[value='letter']", "printSheetLetter"],
    [".pdf-print-sheet option[value='legal']", "printSheetLegal"],
    [".pdf-print-sheet option[value='custom']", "printSheetCustom"],
    ["label[for$='-print-sheet-width']", "printSheetWidth"],
    ["label[for$='-print-sheet-height']", "printSheetHeight"],
    ["label[for$='-print-sheet-unit']", "printSheetUnit"],
    [".pdf-print-sheet-unit option[value='mm']", "printSheetUnitMillimeters"],
    [".pdf-print-sheet-unit option[value='pt']", "printSheetUnitPoints"],
    [".pdf-print-sheet-unit option[value='in']", "printSheetUnitInches"],
    ["label[for$='-print-page-scaling']", "printPageScaling"],
    [".pdf-print-page-scaling option[value='fit']", "printPageScalingFit"],
    [".pdf-print-page-scaling option[value='shrink-to-fit']", "printPageScalingShrinkToFit"],
    ["label[for$='-print-orientation']", "printOrientation"],
    [".pdf-print-orientation option[value='auto']", "printOrientationAuto"],
    [".pdf-print-orientation option[value='portrait']", "printOrientationPortrait"],
    [".pdf-print-orientation option[value='landscape']", "printOrientationLandscape"],
    ["label[for$='-print-quality']", "printQuality"],
    [".pdf-print-quality option[value='300']", "printQuality300"],
    [".pdf-print-quality option[value='600']", "printQuality600"],
    [".pdf-print-layout-help", "printLayoutAutoHelp"],
    [".pdf-print-sheet-help", "printSheetHelp"],
    [".pdf-print-orientation-help", "printOrientationHelp"],
    [".pdf-print-page-scaling-help", "printPageScalingHelp"],
    [".pdf-print-quality-help", "printResolutionHelp"],
  ];
  for (const [selector, key] of staticText) text(selector, key);
  groupLegend(".pdf-page-layout-group", "pageLayout");
  groupLegend(".pdf-fit-mode-group", "fitMode");
  groupLegend(".pdf-rendering-profile-group", "renderingProfile");
  groupLegend(".pdf-rotation-controls", "rotation");
  groupLegend(".pdf-navigation-history-group", "navigationHistory");
  groupLegend(".pdf-viewing-mode-controls", "viewMode");
  attr(".pdf-presentation-controls", "aria-label", "presentationControls");
  attr(".pdf-page-number-input", "aria-label", "currentPage");
  attr(".pdf-search-input", "placeholder", "searchPlaceholder");
  attr(".pdf-search-input", "aria-label", "search");
  attr(".pdf-outline-filter-input", "placeholder", "outlineFilter");
  attr(".pdf-outline-filter-input", "aria-label", "outlineFilter");
  attr(".pdf-zoom-slider", "aria-label", "zoom");
  attr(".pdf-document-progress", "aria-label", "documentProgress");
  attr(".pdf-print-range", "placeholder", "printRangePlaceholder");
  attr(".pdf-print-progress", "aria-label", "printProgress");
  attr(".pdf-controls-toolbar", "aria-label", "controls");
  attr(".pdf-menu-panel", "aria-label", "menu");
  attr(".pdf-sidebar", "aria-label", "sidebar");
  attr(".pdf-sidebar-primary-views", "aria-label", "sidebar");
  attr(".pdf-sidebar-more-toggle, .pdf-sidebar-more-menu", "aria-label", "sidebarMoreViews");
  attr(".pdf-sidebar-more-toggle", "title", "sidebarMoreViews");
  for (const name of ["outline", "thumbnails", "attachments", "layers"] as const) {
    const key = name;
    attr(`[data-pdf-sidebar-view='${name}'].pdf-sidebar-panel`, "aria-label", key);
    text(
      `.pdf-sidebar-view-button[data-pdf-sidebar-view='${name}'], .pdf-sidebar-more-menu [data-pdf-sidebar-view='${name}']`,
      key,
    );
  }
  if (!initialized) root.dataset.pdfjsUiTextInitialized = "true";
}
