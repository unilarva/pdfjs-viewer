// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { ViewerPanels } from "../../src/viewer-panels.js";

test("headless panel ownership remains inert without optional bindings", () => {
  const ownerDocument = {
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
    defaultView: {
      HTMLElement: class {},
      Element: class {},
      Node: class {},
      AbortController,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      setTimeout: () => 1,
      clearTimeout() {},
      getComputedStyle: () => ({ position: "static", direction: "ltr" }),
    },
  } as unknown as Document;
  const effects: string[] = [];
  const panels = new ViewerPanels(
    {
      sidebar: null,
      sidebarClose: null,
      sidebarToggle: null,
      sidebarPrimaryViews: null,
      sidebarMoreToggle: null,
      sidebarMoreMenu: null,
      sidebarViews: {},
      toolbar: {
        search: { panel: null, toggle: null, close: null },
        menu: { panel: null, toggle: null, close: null },
      },
    },
    {
      ownerDocument,
      sidebarMode: "auto",
      restoreFocus: true,
      initialSidebarView: null,
      sidebarCloseSelector: ".close",
    },
    {
      sidebarOpened: () => effects.push("sidebar-opened"),
      sidebarClosed: () => effects.push("sidebar-closed"),
      toolbarOpened: () => effects.push("toolbar-opened"),
      toolbarClosed: () => effects.push("toolbar-closed"),
      beginToolbarInteraction: () => 1,
      completeToolbarInteraction: () => true,
    },
  );
  panels.setSidebarOpen(true);
  panels.toggleToolbar("search");
  panels.setHostActive(false);
  panels.destroy();
  assert.deepEqual(effects, []);
});
