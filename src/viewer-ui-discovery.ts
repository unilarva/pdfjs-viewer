// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private interactive UI binding discovery with direct-reference precedence and
 * unique typed stable-selector fallback. Host extension slots are not bindings
 * and are not discovered here. This is not a supported consumer subpath or
 * package-root export. See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module viewer-ui-discovery
 */

import type { PdfjsViewerUiBindings } from "./viewer-contracts.js";
import { PDFJS_VIEWER_UI_HOOKS } from "./viewer-contracts.js";

type SelectorHooks<T> = {
  readonly [Name in keyof T]: T[Name] extends string ? string : SelectorHooks<T[Name]>;
};
type Hooks = SelectorHooks<typeof PDFJS_VIEWER_UI_HOOKS>;
type ElementConstructor<T extends Element> = { new (...args: never[]): T };

function resolve<T extends Element>(
  direct: T | undefined,
  scope: ParentNode | null,
  selector: string,
  type: ElementConstructor<T>,
  path: string,
  required = false,
): T | null {
  if (direct !== undefined) return requireType(direct, type, path, selector);
  if (!scope) return null;
  let matches: NodeListOf<Element>;
  try {
    matches = scope.querySelectorAll(selector);
  } catch {
    throw new TypeError(`PdfjsViewer: invalid UI hook selector for ${path}: ${selector}`);
  }
  if (matches.length === 0) {
    if (required)
      throw new Error(`PdfjsViewer: required UI hook missing below rootEl: ${selector}`);
    return null;
  }
  if (matches.length !== 1)
    throw new Error(`PdfjsViewer: UI hook ${path} must match exactly one element: ${selector}`);
  return requireType(matches[0], type, path, selector);
}

function requireType<T extends Element>(
  element: unknown,
  type: ElementConstructor<T>,
  path: string,
  selector: string,
): T {
  if (!(element instanceof type)) {
    throw new TypeError(`PdfjsViewer: UI hook ${path} (${selector}) must be an ${type.name}`);
  }
  return element;
}

function requirePrintNumberInput(
  input: HTMLInputElement | null,
  path: string,
): HTMLInputElement | null {
  if (!input) return null;
  if (input.type !== "number" || !Number.isFinite(Number(input.min)) || Number(input.min) <= 0) {
    throw new TypeError(`PdfjsViewer: UI hook ${path} must be a number input with a positive min`);
  }
  return input;
}

/** Resolves every singular stable hook once, with direct bindings taking precedence. */
export function discoverViewerUi(
  root: HTMLElement,
  bindings: Readonly<PdfjsViewerUiBindings>,
  hooks: Hooks,
  discoverPrintSetup = true,
) {
  const view = root.ownerDocument.defaultView;
  if (!view) throw new TypeError("PdfjsViewer: rootEl ownerDocument must have a defaultView");
  const types = view as unknown as Record<string, ElementConstructor<Element>>;
  const html = types.HTMLElement as ElementConstructor<HTMLElement>;
  const button = types.HTMLButtonElement as ElementConstructor<HTMLButtonElement>;
  const input = types.HTMLInputElement as ElementConstructor<HTMLInputElement>;
  const select = types.HTMLSelectElement as ElementConstructor<HTMLSelectElement>;
  const dialogType = types.HTMLDialogElement as ElementConstructor<HTMLDialogElement>;
  const form = types.HTMLFormElement as ElementConstructor<HTMLFormElement>;
  const details = types.HTMLDetailsElement as ElementConstructor<HTMLDetailsElement>;
  const progress = types.HTMLProgressElement as ElementConstructor<HTMLProgressElement>;
  const anchor = types.HTMLAnchorElement as ElementConstructor<HTMLAnchorElement>;

  const controlDiscoveryScope = resolve(
    bindings.controlDiscoveryScope,
    root,
    hooks.root.controlDiscoveryScope,
    html,
    "controlDiscoveryScope",
  );
  const controls = controlDiscoveryScope ?? root;
  const container = resolve(
    bindings.container,
    root,
    hooks.root.container,
    html,
    "container",
    true,
  )!;
  const searchPanel = resolve(
    bindings.search?.panel,
    controls,
    hooks.search.panel,
    html,
    "search.panel",
  );
  const menuPanel = resolve(bindings.menu?.panel, controls, hooks.menu.panel, html, "menu.panel");
  const sidebarContainer = resolve(
    bindings.sidebar?.container,
    root,
    hooks.sidebar.container,
    html,
    "sidebar.container",
  );
  const printBindings = discoverPrintSetup ? bindings.printSetup : undefined;
  const hasDirectPrintDescendant = Object.entries(printBindings ?? {}).some(
    ([name, value]) => name !== "dialog" && value !== undefined,
  );
  const printDialog = discoverPrintSetup
    ? resolve(printBindings?.dialog, root, hooks.printSetup.dialog, dialogType, "printSetup.dialog")
    : null;
  if (hasDirectPrintDescendant && !printDialog)
    throw new TypeError(
      "PdfjsViewer: uiBindings.printSetup descendants require uiBindings.printSetup.dialog",
    );
  const printScope = printDialog;
  const print = {
    dialog: printDialog,
    form: resolve(printBindings?.form, printScope, hooks.printSetup.form, form, "printSetup.form"),
    pages: resolve(
      printBindings?.pages,
      printScope,
      hooks.printSetup.pages,
      select,
      "printSetup.pages",
    ),
    range: resolve(
      printBindings?.range,
      printScope,
      hooks.printSetup.range,
      input,
      "printSetup.range",
    ),
    rangeWrap: resolve(
      printBindings?.rangeWrap,
      printScope,
      hooks.printSetup.rangeWrap,
      html,
      "printSetup.rangeWrap",
    ),
    layout: resolve(
      printBindings?.layout,
      printScope,
      hooks.printSetup.layout,
      select,
      "printSetup.layout",
    ),
    side: resolve(printBindings?.side, printScope, hooks.printSetup.side, html, "printSetup.side"),
    sideSelect: resolve(
      printBindings?.sideSelect,
      printScope,
      hooks.printSetup.sideSelect,
      select,
      "printSetup.sideSelect",
    ),
    more: resolve(
      printBindings?.more,
      printScope,
      hooks.printSetup.more,
      details,
      "printSetup.more",
    ),
    sheet: resolve(
      printBindings?.sheet,
      printScope,
      hooks.printSetup.sheet,
      select,
      "printSetup.sheet",
    ),
    customSheet: resolve(
      printBindings?.customSheet,
      printScope,
      hooks.printSetup.customSheet,
      html,
      "printSetup.customSheet",
    ),
    customSheetWidth: requirePrintNumberInput(
      resolve(
        printBindings?.customSheetWidth,
        printScope,
        hooks.printSetup.customSheetWidth,
        input,
        "printSetup.customSheetWidth",
      ),
      "printSetup.customSheetWidth",
    ),
    customSheetHeight: requirePrintNumberInput(
      resolve(
        printBindings?.customSheetHeight,
        printScope,
        hooks.printSetup.customSheetHeight,
        input,
        "printSetup.customSheetHeight",
      ),
      "printSetup.customSheetHeight",
    ),
    customSheetUnit: resolve(
      printBindings?.customSheetUnit,
      printScope,
      hooks.printSetup.customSheetUnit,
      select,
      "printSetup.customSheetUnit",
    ),
    pageScaling: resolve(
      printBindings?.pageScaling,
      printScope,
      hooks.printSetup.pageScaling,
      select,
      "printSetup.pageScaling",
    ),
    orientation: resolve(
      printBindings?.orientation,
      printScope,
      hooks.printSetup.orientation,
      select,
      "printSetup.orientation",
    ),
    quality: resolve(
      printBindings?.quality,
      printScope,
      hooks.printSetup.quality,
      select,
      "printSetup.quality",
    ),
    status: resolve(
      printBindings?.status,
      printScope,
      hooks.printSetup.status,
      html,
      "printSetup.status",
    ),
    progress: resolve(
      printBindings?.progress,
      printScope,
      hooks.printSetup.progress,
      progress,
      "printSetup.progress",
    ),
    guidance: resolve(
      printBindings?.guidance,
      printScope,
      hooks.printSetup.guidance,
      html,
      "printSetup.guidance",
    ),
    fallbackWarning: resolve(
      printBindings?.fallbackWarning,
      printScope,
      hooks.printSetup.fallbackWarning,
      html,
      "printSetup.fallbackWarning",
    ),
    close: resolve(
      printBindings?.close,
      printScope,
      hooks.printSetup.close,
      button,
      "printSetup.close",
    ),
    cancel: resolve(
      printBindings?.cancel,
      printScope,
      hooks.printSetup.cancel,
      button,
      "printSetup.cancel",
    ),
    source: resolve(
      printBindings?.source,
      printScope,
      hooks.printSetup.source,
      button,
      "printSetup.source",
    ),
    submit: resolve(
      printBindings?.submit,
      printScope,
      hooks.printSetup.submit,
      button,
      "printSetup.submit",
    ),
    submitDetail: resolve(
      printBindings?.submitDetail,
      printScope,
      hooks.printSetup.submitDetail,
      html,
      "printSetup.submitDetail",
    ),
  };
  for (const [name, element] of Object.entries(printBindings ?? {})) {
    if (name !== "dialog" && element && !printDialog!.contains(element as Node)) {
      throw new TypeError(
        `PdfjsViewer: uiBindings.printSetup.${name} must be contained by uiBindings.printSetup.dialog`,
      );
    }
  }
  if (print.form) {
    for (const [name, element] of Object.entries(print)) {
      if (name !== "dialog" && name !== "form" && element && !print.form.contains(element)) {
        throw new TypeError(
          `PdfjsViewer: print setup hook ${name} must be contained by printSetup.form`,
        );
      }
    }
  }

  const pageNumber = resolve(
    bindings.navigation?.pageNumber,
    controls,
    hooks.navigation.pageNumber,
    input,
    "navigation.pageNumber",
  );
  if (pageNumber && pageNumber.type !== "number" && pageNumber.inputMode !== "numeric") {
    throw new TypeError(
      "PdfjsViewer: UI hook navigation.pageNumber must be a number input or use inputmode=numeric",
    );
  }
  const slider = resolve(bindings.zoom?.slider, controls, hooks.zoom.slider, input, "zoom.slider");
  if (slider && slider.type !== "range")
    throw new TypeError("PdfjsViewer: UI hook zoom.slider must be an input[type=range]");

  return {
    controlDiscoveryScope,
    container,
    navigation: {
      previous: resolve(
        bindings.navigation?.previous,
        controls,
        hooks.navigation.previous,
        button,
        "navigation.previous",
      ),
      next: resolve(
        bindings.navigation?.next,
        controls,
        hooks.navigation.next,
        button,
        "navigation.next",
      ),
      pageNumber,
      pageCount: resolve(
        bindings.navigation?.pageCount,
        controls,
        hooks.navigation.pageCount,
        html,
        "navigation.pageCount",
      ),
    },
    navigationHistory: {
      back: resolve(
        bindings.navigationHistory?.back,
        controls,
        hooks.navigationHistory.back,
        button,
        "navigationHistory.back",
      ),
      forward: resolve(
        bindings.navigationHistory?.forward,
        controls,
        hooks.navigationHistory.forward,
        button,
        "navigationHistory.forward",
      ),
    },
    fullscreen: {
      toggle: resolve(
        bindings.fullscreen?.toggle,
        controls,
        hooks.fullscreen.toggle,
        button,
        "fullscreen.toggle",
      ),
    },
    presentation: {
      toggle: resolve(
        bindings.presentation?.toggle,
        controls,
        hooks.presentation.toggle,
        button,
        "presentation.toggle",
      ),
      controls: resolve(
        bindings.presentation?.controls,
        root,
        hooks.presentation.controls,
        html,
        "presentation.controls",
      ),
      previous: resolve(
        bindings.presentation?.previous,
        root,
        hooks.presentation.previous,
        button,
        "presentation.previous",
      ),
      next: resolve(
        bindings.presentation?.next,
        root,
        hooks.presentation.next,
        button,
        "presentation.next",
      ),
      exit: resolve(
        bindings.presentation?.exit,
        root,
        hooks.presentation.exit,
        button,
        "presentation.exit",
      ),
    },
    zoom: {
      fit: resolve(bindings.zoom?.fit, controls, hooks.zoom.fit, button, "zoom.fit"),
      fitMenu: resolve(
        bindings.zoom?.fitMenu,
        controls,
        hooks.zoom.fitMenu,
        button,
        "zoom.fitMenu",
      ),
      slider,
      sliderWrap: resolve(
        bindings.zoom?.sliderWrap,
        controls,
        hooks.zoom.sliderWrap,
        html,
        "zoom.sliderWrap",
      ),
    },
    search: {
      toggle: resolve(
        bindings.search?.toggle,
        controls,
        hooks.search.toggle,
        button,
        "search.toggle",
      ),
      panel: searchPanel,
      input: resolve(
        bindings.search?.input,
        searchPanel,
        hooks.search.input,
        input,
        "search.input",
      ),
      previous: resolve(
        bindings.search?.previous,
        searchPanel,
        hooks.search.previous,
        button,
        "search.previous",
      ),
      next: resolve(bindings.search?.next, searchPanel, hooks.search.next, button, "search.next"),
      count: resolve(bindings.search?.count, searchPanel, hooks.search.count, html, "search.count"),
      close: resolve(
        bindings.search?.close,
        searchPanel,
        hooks.search.close,
        button,
        "search.close",
      ),
    },
    menu: {
      toggle: resolve(bindings.menu?.toggle, controls, hooks.menu.toggle, button, "menu.toggle"),
      panel: menuPanel,
      close: resolve(bindings.menu?.close, menuPanel, hooks.menu.close, button, "menu.close"),
      textSelectionToggle: resolve(
        bindings.menu?.textSelectionToggle,
        controls,
        hooks.menu.textSelectionToggle,
        button,
        "menu.textSelectionToggle",
      ),
      pageLayout: resolve(
        bindings.menu?.pageLayout,
        controls,
        hooks.menu.pageLayout,
        html,
        "menu.pageLayout",
      ),
      fitMode: resolve(bindings.menu?.fitMode, controls, hooks.menu.fitMode, html, "menu.fitMode"),
      rotateCounterclockwise: resolve(
        bindings.menu?.rotateCounterclockwise,
        controls,
        hooks.menu.rotateCounterclockwise,
        button,
        "menu.rotateCounterclockwise",
      ),
      resetRotation: resolve(
        bindings.menu?.resetRotation,
        controls,
        hooks.menu.resetRotation,
        button,
        "menu.resetRotation",
      ),
      rotateClockwise: resolve(
        bindings.menu?.rotateClockwise,
        controls,
        hooks.menu.rotateClockwise,
        button,
        "menu.rotateClockwise",
      ),
      renderingProfile: resolve(
        bindings.menu?.renderingProfile,
        controls,
        hooks.menu.renderingProfile,
        html,
        "menu.renderingProfile",
      ),
    },
    sidebar: {
      container: sidebarContainer,
      toggle: resolve(
        bindings.sidebar?.toggle,
        controls,
        hooks.sidebar.toggle,
        button,
        "sidebar.toggle",
      ),
      close: resolve(
        bindings.sidebar?.close,
        sidebarContainer,
        hooks.sidebar.close,
        button,
        "sidebar.close",
      ),
      primaryViews: resolve(
        bindings.sidebar?.primaryViews,
        sidebarContainer,
        hooks.sidebar.primaryViews,
        html,
        "sidebar.primaryViews",
      ),
      moreToggle: resolve(
        bindings.sidebar?.moreToggle,
        sidebarContainer,
        hooks.sidebar.moreToggle,
        button,
        "sidebar.moreToggle",
      ),
      moreMenu: resolve(
        bindings.sidebar?.moreMenu,
        sidebarContainer,
        hooks.sidebar.moreMenu,
        html,
        "sidebar.moreMenu",
      ),
    },
    outline: {
      content: resolve(
        bindings.outline?.content,
        sidebarContainer,
        hooks.outline.content,
        html,
        "outline.content",
      ),
      filter: resolve(
        bindings.outline?.filter,
        sidebarContainer,
        hooks.outline.filter,
        html,
        "outline.filter",
      ),
      filterInput: resolve(
        bindings.outline?.filterInput,
        sidebarContainer,
        hooks.outline.filterInput,
        input,
        "outline.filterInput",
      ),
    },
    thumbnails: {
      content: resolve(
        bindings.thumbnails?.content,
        sidebarContainer,
        hooks.thumbnails.content,
        html,
        "thumbnails.content",
      ),
    },
    attachments: {
      content: resolve(
        bindings.attachments?.content,
        sidebarContainer,
        hooks.attachments.content,
        html,
        "attachments.content",
      ),
    },
    layers: {
      content: resolve(
        bindings.layers?.content,
        sidebarContainer,
        hooks.layers.content,
        html,
        "layers.content",
      ),
    },
    download: resolve(bindings.download, root, hooks.actions.download, anchor, "download"),
    downloadFilledDocument: resolve(
      bindings.downloadFilledDocument,
      root,
      hooks.actions.downloadFilledDocument,
      button,
      "downloadFilledDocument",
    ),
    print: resolve(bindings.print, controls, hooks.actions.print, button, "print"),
    printSetup: print,
    documentProgress: resolve(
      bindings.documentProgress,
      root,
      hooks.documentProgress.indicator,
      progress,
      "documentProgress",
    ),
  };
}
