// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

const CSSOM_DPR_RATIO_EPSILON = 1e-5;

test.beforeEach(async ({ page }, testInfo) => {
  page.on("pageerror", error =>
    console.error(`fixture page error: ${error.stack ?? error.message}`),
  );
  page.on("console", message => {
    const text = message.text();
    const isExpectedCspDiagnostic =
      testInfo.tags.includes("@csp") &&
      message.type() === "error" &&
      [
        "requires 'TrustedHTML' assignment",
        "blocked assigning to an injection sink",
        "requires a TrustedHTML value",
        "Refused to apply a stylesheet",
      ].some(fragment => text.includes(fragment));
    const isExpectedInvalidDocumentDiagnostic =
      testInfo.title ===
        "load results, events, cleanup, and destroyed behavior form one terminal contract" &&
      message.type() === "warning" &&
      text === "Warning: Indexing all PDF objects";
    const isExpectedIframeLayoutDiagnostic =
      testInfo.title === "viewer-scoped keyboard routing uses the iframe owner document" &&
      message.type() === "warning" &&
      text.includes("Layout was forced before the page was fully loaded");
    if (
      !isExpectedCspDiagnostic &&
      !isExpectedInvalidDocumentDiagnostic &&
      !isExpectedIframeLayoutDiagnostic
    )
      console.log(`fixture console ${message.type()}: ${text}`);
  });
  await page.goto(testInfo.tags.includes("@csp") ? "/csp" : "/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
});

test("generated UI loads and exposes accessible controls and state", async ({ page }) => {
  await expect(page.getByRole("toolbar", { name: "PDF controls" })).toBeVisible();
  await expect(page.getByRole("region", { name: "primary PDF" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Loading PDF" })).toHaveAttribute("max", "1");
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  await expect(page.locator(".pdf-page-count")).toHaveText("3");
  await expect(page.locator("#primary .pdf-page-layout-group")).toHaveCount(1);
  await expect(page.locator("#primary .pdf-fit-mode-group")).toHaveCount(1);
  await expect(page.locator("#primary .pdf-rotate-counterclockwise-btn")).toBeEnabled();
  await expect(page.locator("#primary .pdf-reset-rotation-btn")).toBeEnabled();
  await expect(page.locator("#primary .pdf-rotate-clockwise-btn")).toBeEnabled();
  await expect(page.locator("#primary .pdf-rendering-profile-group")).toHaveCount(1);
  await expect(page.locator("#primary .pdf-download-filled-document-btn")).toHaveAttribute(
    "hidden",
    "",
  );
  await expect(page.locator("#primary .pdf-search-extension")).toHaveAttribute(
    "data-pdfjs-viewer-extension",
    "search",
  );
  await expect(page.locator("#primary .pdf-menu-extension")).toHaveAttribute(
    "data-pdfjs-viewer-extension",
    "menu",
  );
  const menuOrder = await page
    .locator("#primary .pdf-menu-actions > *")
    .evaluateAll(elements => elements.map(element => element.className));
  expect(menuOrder).toEqual([
    "pdf-menu-primary-actions",
    "pdf-menu-extension",
    "pdf-menu-secondary-actions",
  ]);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.status)).toBe("ready");
  await expect(page.locator("#primary .pdf-text-selection-toggle-btn")).toBeEnabled();
  await expect(page.locator("#primary .pdf-text-selection-toggle-btn")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.textSelectionMode))
    .toBe(false);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".pdf-page-number-input")).toHaveValue("2");
  const samples = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>("#primary .pdf-page-number-input")!;
    const values: string[] = [];
    for (let i = 0; i < 8; i++) {
      values.push(input.value);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return values;
  });
  expect(samples).toEqual(Array(samples.length).fill("2"));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
});

test("@mobile fullscreen and presentation modes use exact-root ownership and discrete navigation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const documentState = document as Document & { fullscreenElement: Element | null };
    let owner: Element | null = null;
    Object.defineProperty(documentState, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(documentState, "fullscreenElement", {
      configurable: true,
      get: () => owner,
    });
    const root = document.querySelector<HTMLElement>("#primary")!;
    root.requestFullscreen = () => {
      owner = root;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    documentState.exitFullscreen = () => {
      owner = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
  });

  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.navigateToPage(2));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await root.locator(".pdf-menu-toggle-btn").click();
  await root.locator(".pdf-fullscreen-toggle-btn").click();
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await expect(root).toHaveClass(/pdf-fullscreen/);
  await page.evaluate(async () => {
    await window.fixture.primary.setPageLayout("double");
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.pageLayout))
    .toBe("double");
  const before = await page.evaluate(() => {
    const state = window.fixture.primary.state;
    return {
      pageLayout: state.pageLayout,
      fitMode: state.fitMode,
      fitActive: state.fitActive,
      scale: state.scale,
      rotation: state.rotation,
      canGoBack: state.canGoBack,
    };
  });
  if (!(await root.locator(".pdf-presentation-toggle-btn").isVisible())) {
    await root.locator(".pdf-menu-toggle-btn").click();
  }
  const presentationResult = await page.evaluate(() =>
    window.fixture.primary.enterPresentationMode(),
  );
  expect(presentationResult).toMatchObject({ ok: true, presentationMode: true });
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.presentationMode))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.pageLayout))
    .toBe("single");
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.fitMode))
    .toBe("contain");
  await page.evaluate(() => window.fixture.primary.navigateToPage(1));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await expect(root.locator(".pdf-container")).toBeFocused();
  await expect(root.locator(".pdf-presentation-controls")).toBeVisible();
  expect(
    await root
      .locator(".pdf-presentation-controls")
      .evaluate(element => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
  const holdPresentationButton = async (selector: string): Promise<void> => {
    const box = await root.locator(selector).boundingBox();
    if (!box) throw new Error(`presentation control ${selector} has no box`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(750);
    await page.mouse.up();
  };
  await holdPresentationButton(".pdf-presentation-next-btn");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
  await holdPresentationButton(".pdf-presentation-previous-btn");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await root.locator(".pdf-presentation-next-btn").click();
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await root.locator(".pdf-container").dispatchEvent("wheel", { deltaY: -100, deltaMode: 0 });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await root.locator(".pdf-container").dispatchEvent("wheel", { deltaY: -100, deltaMode: 0 });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await page.waitForTimeout(350);
  await root
    .locator(".pdf-container")
    .dispatchEvent("wheel", { deltaX: 100, deltaY: 10, deltaMode: 0 });
  await root
    .locator(".pdf-container")
    .dispatchEvent("wheel", { deltaY: 100, deltaMode: 0, ctrlKey: true });
  expect(await page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  const flingBox = await root.locator(".pdf-container").boundingBox();
  if (!flingBox) throw new Error("presentation container has no box");
  const flingX = flingBox.x + flingBox.width / 2;
  await root.locator(".pdf-container").dispatchEvent("pointerdown", {
    pointerId: 40,
    pointerType: "mouse",
    isPrimary: true,
    clientX: flingX,
    clientY: flingBox.y + (flingBox.height * 3) / 4,
  });
  await root.locator(".pdf-container").dispatchEvent("pointermove", {
    pointerId: 40,
    pointerType: "mouse",
    isPrimary: true,
    clientX: flingX,
    clientY: flingBox.y + flingBox.height / 4,
  });
  await root.locator(".pdf-container").dispatchEvent("pointerup", {
    pointerId: 40,
    pointerType: "mouse",
    isPrimary: true,
    clientX: flingX,
    clientY: flingBox.y + flingBox.height / 4,
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await expect
    .poll(() =>
      root.evaluate(element => element.classList.contains("pdf-presentation-controls-visible")),
    )
    .toBe(false);
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  expect(
    await root.evaluate(element => element.classList.contains("pdf-presentation-controls-visible")),
  ).toBe(false);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  expect(
    await root.evaluate(element => element.classList.contains("pdf-presentation-controls-visible")),
  ).toBe(false);
  const containerBox = await root.locator(".pdf-container").boundingBox();
  if (!containerBox) throw new Error("presentation container has no box");
  await page.mouse.click(
    containerBox.x + containerBox.width / 2,
    containerBox.y + containerBox.height / 6,
  );
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  expect(
    await root.evaluate(element => element.classList.contains("pdf-presentation-controls-visible")),
  ).toBe(false);
  const touchX = containerBox.x + containerBox.width / 2;
  const touchStartY = containerBox.y + (containerBox.height * 3) / 4;
  const touchEndY = containerBox.y + containerBox.height / 4;
  await root.locator(".pdf-container").dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    clientX: touchX,
    clientY: touchStartY,
  });
  await root.locator(".pdf-container").dispatchEvent("pointermove", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    clientX: touchX,
    clientY: touchEndY,
  });
  await root.locator(".pdf-container").dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    clientX: touchX,
    clientY: touchEndY,
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await root.locator(".pdf-container").dispatchEvent("pointerdown", {
    pointerId: 42,
    pointerType: "touch",
    isPrimary: true,
    clientX: touchX,
    clientY: containerBox.y + containerBox.height / 2,
  });
  await expect
    .poll(() =>
      root.evaluate(element => element.classList.contains("pdf-presentation-controls-visible")),
    )
    .toBe(true);
  await root.locator(".pdf-container").dispatchEvent("pointerup", {
    pointerId: 42,
    pointerType: "touch",
    isPrimary: true,
    clientX: touchX,
    clientY: containerBox.y + containerBox.height / 2,
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.canGoBack))
    .toBe(before.canGoBack);
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.presentationMode))
    .toBe(false);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await expect(root.locator(".pdf-presentation-controls")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.pageLayout))
    .toBe(before.pageLayout);
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.fitMode))
    .toBe(before.fitMode);
  if (!before.fitActive) {
    await expect
      .poll(() => page.evaluate(() => window.fixture.primary.state.scale))
      .toBeCloseTo(before.scale, 5);
  }

  const sidebarToggle = root.locator(".pdf-sidebar-toggle-btn");
  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => window.fixture.primary.enterPresentationMode());
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.presentationMode))
    .toBe(true);
  await expect(root.locator(".pdf-sidebar")).toHaveCSS("display", "none");
  await page.evaluate(() => window.fixture.primary.rotateTo(90));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.rotation)).toBe(90);
  expect(
    await root.evaluate(element => {
      const container = element.querySelector<HTMLElement>(".pdf-container")!;
      const currentPage = Number(
        element.querySelector<HTMLInputElement>(".pdf-page-number-input")!.value,
      );
      const pageElement = element.querySelector<HTMLElement>(
        `.pdf-page[data-page="${currentPage}"]`,
      )!;
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      return Math.abs(
        pageRect.left + pageRect.width / 2 - (containerRect.left + containerRect.width / 2),
      );
    }),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.fixture.primary.exitPresentationMode());
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.rotation))
    .toBe(before.rotation);
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
  await expect(root.locator(".pdf-sidebar")).not.toHaveCSS("display", "none");

  if (!(await root.locator(".pdf-presentation-toggle-btn").isVisible())) {
    await root.locator(".pdf-menu-toggle-btn").click();
  }
  await root.locator(".pdf-presentation-toggle-btn").click();
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.presentationMode))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(true);
  await root.locator(".pdf-presentation-exit-btn").click();
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.presentationMode))
    .toBe(false);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(false);
});

test("document-local Back and Forward restore explicit jumps and clear branches", async ({
  page,
}) => {
  const back = page.locator("#primary .pdf-navigation-history-back-btn");
  const forward = page.locator("#primary .pdf-navigation-history-forward-btn");
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  await page.evaluate(() => {
    window.fixture.primary.navigateToPage(2);
    window.fixture.primary.navigateToPage(3);
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
  await expect(back).toBeEnabled();
  expect(await page.evaluate(() => window.fixture.primary.goBack())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await expect(forward).toBeEnabled();
  expect(await page.evaluate(() => window.fixture.primary.goBack())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  expect(await page.evaluate(() => window.fixture.primary.goForward())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);

  await page.evaluate(() => window.fixture.primary.navigateToPage(3));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
  await expect(forward).toBeDisabled();
  expect(await page.evaluate(() => window.fixture.primary.goForward())).toBe(false);
});

test("history publication remains safe when a state listener navigates reentrantly", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const root = document.querySelector("#primary")!;
    const viewer = window.fixture.primary;
    const observed: Array<{ canGoBack: boolean; canGoForward: boolean }> = [];
    let reentered = false;
    const listener = (event: Event) => {
      const state = (event as CustomEvent<{ canGoBack: boolean; canGoForward: boolean }>).detail;
      observed.push({ canGoBack: state.canGoBack, canGoForward: state.canGoForward });
      if (!reentered && state.canGoBack) {
        reentered = true;
        viewer.goBack();
      }
    };
    root.addEventListener("pdf:statechange", listener);
    viewer.navigateToPage(2);
    root.removeEventListener("pdf:statechange", listener);
    return { observed, state: viewer.state, reentered };
  });
  expect(result.reentered).toBe(true);
  expect(result.state.canGoBack).toBe(false);
  expect(result.state.canGoForward).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
});

test("rapid smooth explicit navigation records the installed semantic destination", async ({
  page,
}) => {
  const container = page.locator("#primary .pdf-container");
  await container.focus();
  await page.keyboard.press("End");
  await page.evaluate(() => window.fixture.primary.navigateToPage(2));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  expect(await page.evaluate(() => window.fixture.primary.goBack())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
  expect(await page.evaluate(() => window.fixture.primary.goBack())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
});

test("unavailable geometry preserves a history entry for a later retry", async ({ page }) => {
  await page.evaluate(() => window.fixture.primary.navigateToPage(2));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  const hiddenAttempt = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#primary")!;
    root.style.display = "none";
    const result = window.fixture.primary.goBack();
    root.style.display = "";
    return { result, canGoBack: window.fixture.primary.state.canGoBack };
  });
  expect(hiddenAttempt).toEqual({ result: false, canGoBack: true });
  expect(await page.evaluate(() => window.fixture.primary.goBack())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
});

test("a superseded named destination cannot move or mutate history", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeSupersededNamedDestination()),
  ).resolves.toEqual({
    cancelled: true,
    beforeReleasePage: 3,
    afterReleasePage: 3,
    afterReleaseCanGoBack: true,
    restored: true,
    restoredPage: 1,
    canGoForward: true,
  });
});

test("neutral reading input and live search do not supersede a gated named destination", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeNeutralOperationsDuringNamedDestination()),
  ).resolves.toEqual({ completed: true, page: 2, canGoBack: true });
});

test("IME-deferred history navigation is cancelled by replacement or a newer intent", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeDeferredHistoryNavigation()),
  ).resolves.toEqual({
    cancelledAtPageThree: true,
    replacementAtFirstPage: true,
    historyReset: true,
  });
});

test("replacement and close reset document-local history without adding browser history entries", async ({
  page,
}) => {
  const historyLength = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    window.fixture.primary.navigateToPage(2);
    window.fixture.primary.navigateToPage(3);
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.canGoBack)).toBe(true);
  await page.evaluate(() => window.fixture.replacePrimary());
  await expect
    .poll(() =>
      page.evaluate(() => ({
        back: window.fixture.primary.state.canGoBack,
        forward: window.fixture.primary.state.canGoForward,
      })),
    )
    .toEqual({ back: false, forward: false });
  await page.evaluate(() => window.fixture.closePrimary());
  await expect
    .poll(() =>
      page.evaluate(() => ({
        back: window.fixture.primary.state.canGoBack,
        forward: window.fixture.primary.state.canGoForward,
      })),
    )
    .toEqual({ back: false, forward: false });
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test("same-page positional destinations execute both movement and history", async ({ page }) => {
  await page.evaluate(() => window.fixture.primary.nextRow(false));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  const before = await page
    .locator("#primary .pdf-container")
    .evaluate(element => element.scrollTop);
  const result = await page.evaluate(() =>
    window.fixture.primary.navigateToPdfNamedDestination("test:same-page-position", {
      spotWithinPage: true,
    }),
  );
  expect(result.ok && result.positioned).toBe(true);
  const after = await page
    .locator("#primary .pdf-container")
    .evaluate(element => element.scrollTop);
  expect(Math.abs(after - before)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.fixture.primary.goBack())).toBe(true);
  await expect
    .poll(() => page.locator("#primary .pdf-container").evaluate(element => element.scrollTop))
    .toBeCloseTo(before, 0);
});

test("disabled direct history bindings never hide unrelated host controls", async ({ page }) => {
  expect(
    await page.evaluate(() => window.fixture.probeNavigationHistoryBindingOwnership()),
  ).toEqual({
    unrelatedContainerVisible: true,
    unrelatedControlVisible: true,
    backHiddenAndDisabled: true,
    forwardHiddenAndDisabled: true,
  });
});

test("adapted XFA display and native-print table styles preserve functional layout", async ({
  page,
}) => {
  const styles = await page.evaluate(() => {
    // Representative scoped DOM: this fixture's sample does not naturally emit XFA tables.
    const root = document.createElement("div");
    root.dataset.pdfjsViewerRoot = "";
    root.innerHTML =
      '<div class="pdf-xfa-layer"><div class="xfaTb"><div></div></div></div>' +
      '<div class="pdf-native-print-slot"><div class="xfaTb"><div></div></div></div>';
    document.body.append(root);
    const values = [...root.querySelectorAll<HTMLElement>(".xfaTb")].map(table => ({
      display: getComputedStyle(table).display,
      justifyContent: getComputedStyle(table.firstElementChild!).justifyContent,
    }));
    root.remove();
    return values;
  });
  expect(styles).toEqual([
    { display: "flex", justifyContent: "left" },
    { display: "flex", justifyContent: "left" },
  ]);
});

test("runtime UI text refreshes generated static controls in place", async ({ page }) => {
  await page.locator("#primary .pdf-search-toggle-btn").click();
  const preserved = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#primary .pdf-search-input")!;
    input.value = "retain";
    input.focus();
    const details = document.querySelector<HTMLDetailsElement>("#primary .pdf-print-more");
    if (details) details.open = true;
    window.fixture.primary.setUiText({
      labels: {
        controls: "Controls X",
        search: "Search X",
        searchPlaceholder: "Placeholder X",
        menu: "Menu X",
        sidebar: "Sidebar X",
        outline: "Outline X",
        thumbnails: "Thumbs X",
        attachments: "Attachments X",
        layers: "Layers X",
        navigationHistory: "History X",
        navigationHistoryBack: "History back X",
        navigationHistoryForward: "History forward X",
        zoom: "Zoom X",
        pageLayout: "Layout X",
        fitMode: "Fit mode X",
        renderingProfile: "Profile X",
      },
    });
    return {
      value: input.value,
      focused: document.activeElement === input,
      detailsOpen: details?.open ?? null,
    };
  });
  expect(preserved.value).toBe("retain");
  expect(preserved.focused).toBe(true);
  await expect(page.getByRole("toolbar", { name: "Controls X" })).toBeVisible();
  await expect(page.locator("#primary .pdf-search-toggle-btn")).toHaveAttribute(
    "aria-label",
    "Search X",
  );
  await expect(page.locator("#primary .pdf-search-input")).toHaveAttribute(
    "placeholder",
    "Placeholder X",
  );
  await expect(page.locator("#primary .pdf-menu-toggle-btn")).toHaveAttribute(
    "aria-label",
    "Menu X",
  );
  await expect(page.locator("#primary .pdf-sidebar-toggle-btn")).toHaveAttribute(
    "aria-label",
    "Sidebar X",
  );
  await expect(
    page.locator('#primary .pdf-sidebar-view-button[data-pdf-sidebar-view="outline"]'),
  ).toHaveText("Outline X");
  await expect(page.locator("#primary .pdf-zoom-controls > legend")).toHaveText("Zoom X");
  await expect(page.locator("#primary .pdf-navigation-history-group > legend")).toHaveText(
    "History X",
  );
  await expect(page.locator("#primary .pdf-navigation-history-back-btn")).toHaveAttribute(
    "aria-label",
    "History back X",
  );
  await expect(page.locator("#primary .pdf-navigation-history-forward-btn")).toHaveAttribute(
    "aria-label",
    "History forward X",
  );
  await expect(
    page.locator("#primary .pdf-page-layout-group").locator("..").locator("legend"),
  ).toHaveText("Layout X");
  await expect(page.locator("#primary .pdf-search-input")).toHaveValue("retain");
  await expect(page.locator("#primary .pdf-search-input")).toBeFocused();
  await page.evaluate(() => {
    const decoy = document.createElement("button");
    decoy.className = "pdf-search-toggle-btn";
    decoy.title = "Host title";
    decoy.setAttribute("aria-label", "Host label");
    document.querySelector("#primary .pdf-menu-extension")!.append(decoy);
    window.fixture.primary.setUiText({ labels: { print: "Only print changes" } });
  });
  await expect(page.locator("#primary .pdf-search-toggle-btn").first()).toHaveAttribute(
    "aria-label",
    "Search",
  );
  await expect(page.locator("#primary .pdf-menu-extension .pdf-search-toggle-btn")).toHaveAttribute(
    "title",
    "Host title",
  );
  await expect(page.locator("#primary .pdf-menu-extension .pdf-search-toggle-btn")).toHaveAttribute(
    "aria-label",
    "Host label",
  );
});

test("public setUiText replaces text, refreshes live search and zoom state, and validates calls", async ({
  page,
}) => {
  await page.locator("#primary .pdf-search-toggle-btn").click();
  const search = page.locator("#primary .pdf-search-input");
  await search.fill("PDF");
  await expect(page.locator("#primary .pdf-search-count")).not.toHaveText("");
  const before = await page.evaluate(() => {
    const viewer = window.fixture.primary;
    const slider = document.querySelector<HTMLInputElement>("#primary .pdf-zoom-slider")!;
    const count = document.querySelector("#primary .pdf-search-count")!;
    const input = document.querySelector<HTMLInputElement>("#primary .pdf-search-input")!;
    window.fixture.primary.setUiText({
      labels: { search: "Recherche" },
      formatters: {
        searchResultCount: count => `zero:${count}`,
        searchResultPosition: (current, count) => `match:${current}/${count}`,
        zoom: scale => `zoom:${scale}`,
      },
    });
    return { input, count, slider, value: input.value };
  });
  await expect(search).toHaveValue(before.value);
  await expect(page.locator("#primary .pdf-search-count")).toHaveText(/^(?:match:|zero:0)/);
  await expect(page.locator("#primary .pdf-zoom-slider")).toHaveAttribute(
    "aria-valuetext",
    /zoom:/,
  );
  expect(
    await page.evaluate(() => {
      const viewer = window.fixture.primary;
      let unknown = false;
      let wrongValue = false;
      try {
        viewer.setUiText({ unknown: true } as never);
      } catch {
        unknown = true;
      }
      try {
        viewer.setUiText({ labels: { search: 1 } } as never);
      } catch {
        wrongValue = true;
      }
      viewer.destroy();
      let destroyed = false;
      try {
        viewer.setUiText({ labels: { search: "nope" } });
      } catch {
        destroyed = true;
      }
      return { unknown, wrongValue, destroyed };
    }),
  ).toEqual({ unknown: true, wrongValue: true, destroyed: true });
});

test("current page follows the viewport reading anchor instead of a page-edge sliver", async ({
  page,
}) => {
  await page.locator("#primary .pdf-container").evaluate((container: HTMLElement) => {
    const pageTwo = container.querySelector<HTMLElement>('.pdf-page[data-page="2"]');
    if (!pageTwo) throw new Error("Missing second page");
    container.scrollTop = pageTwo.offsetTop - 5;
    container.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
});

test("presentation mode preserves a viewport page before deferred page state is published", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const entry = await page.locator("#primary .pdf-container").evaluate(async container => {
    const pageTwo = container.querySelector<HTMLElement>('.pdf-page[data-page="2"]');
    if (!pageTwo) throw new Error("Missing second page");
    const pageBeforeScroll = window.fixture.primary.state.currentPage;
    container.scrollTop = pageTwo.offsetTop - 5;
    container.dispatchEvent(new Event("scroll"));
    const result = await window.fixture.primary.enterPresentationMode();
    return {
      pageBeforeScroll,
      result,
    };
  });

  expect(entry.pageBeforeScroll).toBe(1);
  expect(entry.result).toMatchObject({ ok: true, presentationMode: true });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  const exit = await page.evaluate(async () => {
    window.fixture.primary.navigateToPage(3);
    return window.fixture.primary.exitPresentationMode();
  });
  expect(exit).toMatchObject({ ok: true, presentationMode: false });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
});

test("presentation transition owns resize reflow until its page is committed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const documentState = document as Document & { fullscreenElement: Element | null };
    let owner: Element | null = null;
    Object.defineProperty(documentState, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(documentState, "fullscreenElement", {
      configurable: true,
      get: () => owner,
    });
    const root = document.querySelector<HTMLElement>("#primary")!;
    root.requestFullscreen = () => {
      owner = root;
      root.style.height = "1080px";
      document.dispatchEvent(new Event("fullscreenchange"));
      window.dispatchEvent(new Event("resize"));
      return Promise.resolve();
    };
    documentState.exitFullscreen = () => {
      owner = null;
      root.style.height = "720px";
      document.dispatchEvent(new Event("fullscreenchange"));
      window.dispatchEvent(new Event("resize"));
      return Promise.resolve();
    };
  });
  await page.evaluate(async () => {
    await window.fixture.primary.load("/queue-fixture.pdf?presentation-resize");
    await window.fixture.primary.setPageLayout("book");
    window.fixture.primary.navigateToPage(30);
  });
  await page.waitForTimeout(2100);
  const pageBeforePresentation = await page.evaluate(
    () => window.fixture.primary.state.currentPage,
  );
  expect(pageBeforePresentation).toBeGreaterThanOrEqual(30);
  expect(pageBeforePresentation).toBeLessThanOrEqual(31);
  const embeddedHeight = await page
    .locator("#primary .pdf-container")
    .evaluate((element: HTMLElement) => element.clientHeight);

  const entry = await page.evaluate(() => window.fixture.probePresentationResizeTransition());
  expect(entry).toMatchObject({
    ok: true,
    presentationMode: true,
    currentPage: pageBeforePresentation,
    pageLayout: "single",
    fitMode: "contain",
  });
  expect(entry.containerHeight).toBeGreaterThan(embeddedHeight);
  await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>("#primary")!;
    for (const height of [900, 760, 1040, 820]) {
      root.style.height = `${height}px`;
      window.dispatchEvent(new Event("resize"));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.currentPage))
    .toBe(pageBeforePresentation);
  await expect
    .poll(() =>
      page
        .locator(`#primary .pdf-page[data-page="${pageBeforePresentation}"]`)
        .evaluate((element: HTMLElement) => {
          const container = element.closest<HTMLElement>(".pdf-container")!;
          const viewport = container.getBoundingClientRect();
          const pageBounds = element.getBoundingClientRect();
          const anchorY = viewport.top + container.clientTop + container.clientHeight * 0.35;
          return anchorY >= pageBounds.top && anchorY <= pageBounds.bottom;
        }),
    )
    .toBe(true);

  await page.evaluate(() => window.fixture.primary.navigateToPage(35));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(35);
  await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>("#primary")!;
    for (const height of [980, 740, 1080]) {
      root.style.height = `${height}px`;
      window.dispatchEvent(new Event("resize"));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(35);

  const exit = await page.evaluate(() => window.fixture.primary.exitPresentationMode());
  expect(exit).toMatchObject({ ok: true, presentationMode: false, fullscreen: false });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(35);

  await page.evaluate(() => {
    const documentState = document as Document & { fullscreenElement: Element | null };
    let owner: Element | null = null;
    Object.defineProperty(documentState, "fullscreenElement", {
      configurable: true,
      get: () => owner,
    });
    const root = document.querySelector<HTMLElement>("#primary")!;
    root.requestFullscreen = () =>
      new Promise<void>(resolve => {
        setTimeout(() => {
          owner = root;
          root.style.height = "1080px";
          document.dispatchEvent(new Event("fullscreenchange"));
          window.dispatchEvent(new Event("resize"));
          resolve();
        }, 100);
      });
    documentState.exitFullscreen = () => {
      owner = null;
      root.style.height = "720px";
      document.dispatchEvent(new Event("fullscreenchange"));
      window.dispatchEvent(new Event("resize"));
      return Promise.resolve();
    };
  });
  const delayedFullscreenEntry = await page.evaluate(() =>
    window.fixture.primary.enterPresentationMode(),
  );
  expect(delayedFullscreenEntry).toMatchObject({
    ok: true,
    presentationMode: true,
    fullscreen: true,
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(35);
  await page.evaluate(() => window.fixture.primary.exitPresentationMode());
});

test("leading page gutter is manually reachable while initial and page-one navigation align the page top", async ({
  page,
}) => {
  const container = page.locator("#primary .pdf-container");
  const initial = await container.evaluate((element: HTMLElement) => {
    const row = element.querySelector<HTMLElement>(".pdf-row");
    const firstPage = element.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
    if (!row || !firstPage) throw new Error("Missing first-page geometry");
    const viewportRect = element.getBoundingClientRect();
    const pageRect = firstPage.getBoundingClientRect();
    return {
      rowTop: row.offsetTop,
      rowGap: Number.parseFloat(getComputedStyle(row).marginBottom),
      scrollTop: element.scrollTop,
      pageTopDelta: pageRect.top - viewportRect.top - element.clientTop,
    };
  });
  expect(initial.rowTop).toBeGreaterThan(0);
  expect(Math.abs(initial.rowTop - initial.rowGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.scrollTop - initial.rowTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.pageTopDelta)).toBeLessThanOrEqual(1);

  const zoomContinuity = await container.evaluate(async (element: HTMLElement) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
    const firstPage = element.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
    if (!firstPage) throw new Error("Missing first page");
    const viewportRect = element.getBoundingClientRect();
    const before = firstPage.getBoundingClientRect();
    const center = {
      x: viewportRect.left + element.clientWidth / 2,
      y: (viewportRect.top + element.clientTop + before.top) / 2,
    };
    if (document.elementFromPoint(center.x, center.y)?.closest(".pdf-page")) {
      throw new Error("Synthetic pinch center is inside the first page");
    }
    const pointer = (type: string, pointerId: number, x: number, isPrimary: boolean) => {
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary,
          clientX: x,
          clientY: center.y,
        }),
      );
    };
    pointer("pointerdown", 61, center.x - 40, true);
    pointer("pointerdown", 62, center.x + 40, false);
    pointer("pointermove", 61, center.x - 50, true);
    pointer("pointermove", 62, center.x + 50, false);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const transient = firstPage.getBoundingClientRect();
    pointer("pointerup", 62, center.x + 50, false);
    const committed = firstPage.getBoundingClientRect();
    pointer("pointerup", 61, center.x - 50, true);
    return {
      revealedGap: before.top - viewportRect.top - element.clientTop,
      topShift: committed.top - transient.top,
      currentPage: window.fixture.primary.state.currentPage,
    };
  });
  expect(zoomContinuity.revealedGap).toBeGreaterThan(0);
  expect(zoomContinuity.currentPage).toBe(1);
  expect(Math.abs(zoomContinuity.topShift), JSON.stringify(zoomContinuity)).toBeLessThanOrEqual(1);

  await page.evaluate(async () => {
    await window.fixture.primary.navigateToPage(2);
    await window.fixture.primary.navigateToPage(1);
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await expect
    .poll(() =>
      container.evaluate((element: HTMLElement) => {
        const firstPage = element.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
        if (!firstPage) return Number.POSITIVE_INFINITY;
        return Math.abs(
          firstPage.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            element.clientTop,
        );
      }),
    )
    .toBeLessThanOrEqual(1);
});

test("fit modes and document rotation publish canonical state", async ({ page }) => {
  const state = await page.evaluate(async () => {
    await window.fixture.primary.setFitMode("width");
    await window.fixture.primary.rotateTo(90);
    await window.fixture.primary.fit();
    await window.fixture.primary.resetRotation();
    return window.fixture.primary.state;
  });
  expect(state.fitMode).toBe("width");
  expect(state.effectiveFitMode).toBe("width");
  expect(state.fitActive).toBe(true);
  expect(state.rotation).toBe(0);
  await expect(page.locator("#primary .pdf-page").first()).toHaveAttribute(
    "data-main-rotation",
    "0",
  );
});

test("rapid rotation requests chain pending intent and ignore stale failure", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeRotationIntent())).resolves.toEqual({
    cumulative: 180,
    mixed: 0,
    staleFailure: 270,
  });
});

test("destroyed viewer rejects fit commands without mutating state", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeDestroyedFitMode())).resolves.toEqual({
    before: "auto",
    after: "auto",
    changes: 0,
    validRejected: true,
    invalidRejected: true,
  });
});

test("page navigation chains rapid button and keyboard requests from the pending destination", async ({
  page,
}) => {
  const next = page.locator("#primary .pdf-next-page-btn");
  const previous = page.locator("#primary .pdf-prev-page-btn");
  const pageNumber = page.locator("#primary .pdf-page-number-input");
  const isAtPage = (pageNumber: number) =>
    page.evaluate(targetPage => {
      const container = document.querySelector<HTMLElement>("#primary .pdf-container");
      const page = container?.querySelector<HTMLElement>(`.pdf-page[data-page="${targetPage}"]`);
      const row = page?.parentElement;
      if (!container || !row) throw new Error(`Missing page ${targetPage}`);
      const targetTop = row.offsetTop;
      const maximumTop = container.scrollHeight - container.clientHeight;
      return Math.abs(container.scrollTop - Math.min(targetTop, maximumTop)) < 2;
    }, pageNumber);
  const scrollTop = () =>
    page.locator("#primary .pdf-container").evaluate(container => container.scrollTop);

  await next.click();
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const firstScrollTop = await scrollTop();
  expect(firstScrollTop).toBeGreaterThan(0);
  await next.click();
  await expect(pageNumber).toHaveValue("3");
  await expect.poll(scrollTop).toBeGreaterThan(firstScrollTop);
  await expect.poll(() => isAtPage(3)).toBe(true);

  await previous.click();
  await previous.click();
  await expect(pageNumber).toHaveValue("1");
  await expect.poll(() => isAtPage(1)).toBe(true);

  await page.evaluate(() => window.fixture.primary.setActive(true));
  await page.locator("#primary .pdf-container").focus();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expect(pageNumber).toHaveValue("3");
  await expect.poll(() => isAtPage(3)).toBe(true);
});

test("page-number and thumbnail selection use bounded smooth navigation", async ({ page }) => {
  const container = page.locator("#primary .pdf-container");
  const observeScrollSamples = async () =>
    container.evaluate(element => {
      const observed = element as HTMLElement & { navigationScrollListener?: EventListener };
      if (observed.navigationScrollListener)
        element.removeEventListener("scroll", observed.navigationScrollListener);
      element.dataset.navigationScrollSamples = "0";
      const listener = () => {
        element.dataset.navigationScrollSamples = String(
          Number(element.dataset.navigationScrollSamples) + 1,
        );
      };
      observed.navigationScrollListener = listener;
      element.addEventListener("scroll", listener);
    });
  const scrollSamples = () =>
    container.evaluate(element => Number(element.dataset.navigationScrollSamples));

  await page.evaluate(() => window.fixture.primary.navigateToPage(1));
  await observeScrollSamples();
  const pageNumber = page.locator("#primary .pdf-page-number-input");
  await pageNumber.fill("3");
  await pageNumber.press("Enter");
  await expect.poll(scrollSamples).toBeGreaterThan(1);
  await expect(pageNumber).toHaveValue("3");

  await page.evaluate(() => window.fixture.primary.navigateToPage(1));
  await page.locator("#primary").evaluate(element => {
    element.style.width = "600px";
  });
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  await observeScrollSamples();
  await page.locator("#primary .pdf-thumbnail-button").nth(2).click();
  await expect.poll(scrollSamples).toBeGreaterThan(1);
  await expect(pageNumber).toHaveValue("3");
});

test("direct pointer and wheel input cancel smooth page navigation", async ({ page }) => {
  const stopWith = async (event: "pointerdown" | "wheel") => {
    const position = await page.evaluate(async inputEvent => {
      const viewer = window.fixture.primary;
      const container = document.querySelector<HTMLElement>("#primary .pdf-container");
      if (!container) throw new Error("Missing document container");
      viewer.navigateToPage(1);
      viewer.nextRow();
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const before = container.scrollTop;
      if (inputEvent === "pointerdown") {
        container.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      } else {
        container.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }));
      }
      await new Promise<void>(resolve => setTimeout(resolve, 600));
      return { before, after: container.scrollTop };
    }, event);
    expect(position.before).toBeGreaterThan(0);
    expect(position.after).toBeCloseTo(position.before, 0);
  };

  await stopWith("pointerdown");
  await stopWith("wheel");
});

test("text selection API publishes only real mode changes and survives host inactivity", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const root = document.querySelector("#primary")!;
    let changes = 0;
    root.addEventListener("pdf:statechange", () => {
      changes++;
    });
    const before = changes;
    window.fixture.primary.setTextSelectionMode(true);
    const afterEnable = changes;
    window.fixture.primary.setTextSelectionMode(true);
    const afterNoop = changes;
    window.fixture.primary.setActive(false);
    window.fixture.primary.setActive(true);
    const preserved = window.fixture.primary.state.textSelectionMode;
    window.fixture.primary.setTextSelectionMode(false);
    return {
      before,
      afterEnable,
      afterNoop,
      preserved,
      final: window.fixture.primary.state.textSelectionMode,
    };
  });
  expect(result).toEqual({
    before: 0,
    afterEnable: 1,
    afterNoop: 1,
    preserved: true,
    final: false,
  });
});

test("inactive selection and search do not compete with initial raster rendering", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await expect(root.locator(".pdf-text-layer")).toHaveCount(0);
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator(".pdf-text-layer").first()).toBeAttached();
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(false));
  await expect(root.locator(".pdf-text-layer")).toHaveCount(0);
});

test("never-settling optional form reads do not block ordinary document readiness or presentation", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeStalledFormPreparation())).resolves.toEqual({
    ready: true,
    raster: true,
    text: true,
    annotations: true,
  });
});

test("generated UI uses CSS-mask icons and keeps action labels in separate elements", async ({
  page,
}) => {
  const ui = page.locator("#primary .pdf-default-ui");
  expect(await ui.locator(".pdf-ui-icon").count()).toBeGreaterThanOrEqual(20);
  await expect(ui.locator(".pdf-ui-icon").first()).toHaveAttribute("aria-hidden", "true");
  await expect(ui.locator(".pdf-download-btn .pdf-ui-label")).toHaveText("Download original PDF");
  await expect(ui.locator(".pdf-print-btn .pdf-ui-label")).toHaveText("Print…");

  const iconStyles = await ui.locator(".pdf-download-btn .pdf-ui-icon").evaluate(icon => {
    const styles = getComputedStyle(icon);
    return {
      maskImage: styles.maskImage,
      iconVariable: styles.getPropertyValue("--pdf-ui-icon-download"),
    };
  });
  expect(iconStyles.maskImage).not.toBe("none");
  expect(iconStyles.iconVariable).toContain("data:image/svg+xml");
  const informationIcon = await ui
    .locator(".pdf-document-information-btn .pdf-ui-icon")
    .evaluate(icon => {
      const styles = getComputedStyle(icon);
      return {
        maskImage: styles.maskImage,
        iconVariable: styles.getPropertyValue("--pdf-ui-icon-information"),
      };
    });
  expect(informationIcon.maskImage).not.toBe("none");
  expect(informationIcon.iconVariable).toContain("viewBox");
});

test("generated and package-managed UI use direction and dynamic formatters", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeLocalization())).resolves.toEqual({
    directionApplied: true,
    searchFormatted: true,
    zoomFormatted: true,
    printStaticTextRefreshed: true,
  });
});

test("default UI mirrors logical sidebar, popover, outline, and zoom layout in RTL", async ({
  page,
}) => {
  await page.locator("#primary").evaluate(root => {
    root.style.width = "600px";
    root.querySelector<HTMLElement>(".pdf-default-ui")!.dir = "rtl";
    root.querySelector<HTMLElement>(".pdf-sidebar")!.style.transition = "none";
    const outline = root.querySelector<HTMLElement>(".pdf-outline")!;
    outline.innerHTML =
      '<ul class="pdf-outline-list"><li><ul class="pdf-outline-list"><li>Nested</li></ul></li></ul>';
  });
  await page.getByRole("button", { name: "PDF options" }).click();

  const layout = await page.locator("#primary").evaluate(root => {
    const style = (selector: string, pseudo?: string) =>
      getComputedStyle(root.querySelector<HTMLElement>(selector)!, pseudo);
    return {
      sidebarRight: style(".pdf-sidebar").right,
      sidebarTransform: style(".pdf-sidebar").transform,
      searchLeft: style(".pdf-search-panel").left,
      menuLeft: style(".pdf-menu-panel").left,
      overflowLeft: style(".pdf-sidebar-more-menu").left,
      outlinePaddingRight: style(".pdf-outline-list .pdf-outline-list").paddingRight,
      zoomMarkerLeft: style(".pdf-zoom-slider-wrap", "::after").left,
      zoomMarkerRight: style(".pdf-zoom-slider-wrap", "::after").right,
    };
  });
  expect(layout.sidebarRight).toBe("0px");
  expect(layout.sidebarTransform).toContain("320");
  expect(layout.searchLeft).toBe("0px");
  expect(layout.menuLeft).toBe("0px");
  expect(layout.overflowLeft).toBe("0px");
  expect(Number.parseFloat(layout.outlinePaddingRight)).toBeGreaterThan(0);
  expect(Number.parseFloat(layout.zoomMarkerLeft)).toBeGreaterThan(
    Number.parseFloat(layout.zoomMarkerRight),
  );

  await page.getByRole("button", { name: "Document navigation" }).click();
  const outline = page.getByRole("button", { name: "Table of contents" });
  const thumbnails = page.getByRole("button", { name: "Thumbnails" });
  await outline.press("ArrowLeft");
  await expect(thumbnails).toHaveAttribute("aria-pressed", "true");
  await thumbnails.press("ArrowRight");
  await expect(outline).toHaveAttribute("aria-pressed", "true");
});

test("generated document-history icons use logical Back and Forward arrows in RTL", async ({
  page,
}) => {
  const icons = page.locator("#primary .pdf-navigation-history-controls .pdf-ui-icon");
  const ltr = await icons.evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).getPropertyValue("--pdf-ui-icon")),
  );
  await page.locator("#primary .pdf-default-ui").evaluate(element => {
    (element as HTMLElement).dir = "rtl";
  });
  const rtl = await icons.evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).getPropertyValue("--pdf-ui-icon")),
  );
  expect(ltr).toHaveLength(2);
  expect(rtl).toEqual([...ltr].reverse());
});

test("constructor rejects mode-specific UI options and preserves initial custom ARIA and RTL", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeConstructorModePolicies())).resolves.toEqual(
    {
      customDirectionRejected: true,
      headlessControlsRejected: true,
      preservesCustomAriaAndDirection: true,
    },
  );
});

test("observable state includes host activity, capabilities, and feature preparation", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        search: window.fixture.primary.state.searchPreparation,
        outline: window.fixture.primary.state.outlinePreparation,
        attachments: window.fixture.primary.state.attachmentsPreparation,
      })),
    )
    .toEqual({ search: "ready", outline: "ready", attachments: "ready" });
  const state = await page.evaluate(() => window.fixture.primary.state);
  expect(state.active).toBe(true);
  expect(state.canDownload).toBe(true);
  expect(state.canPrint).toBe(true);
  expect(state.formDirty).toBe(false);

  const transitions = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#primary")!;
    const values: boolean[] = [];
    const listener = (event: Event) =>
      values.push((event as CustomEvent<{ active: boolean }>).detail.active);
    root.addEventListener("pdf:statechange", listener);
    window.fixture.primary.setActive(false);
    window.fixture.primary.setActive(true);
    root.removeEventListener("pdf:statechange", listener);
    return values;
  });
  expect(transitions).toEqual([false, true]);
});

test("exports the package-managed styling state contracts", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.stateClasses)).resolves.toEqual({
    zoomLimitHint: "pdf-zoom-limit-hint",
    zoomLimitHintIn: "pdf-zoom-limit-hint--in",
    zoomLimitHintOut: "pdf-zoom-limit-hint--out",
    documentProgressVisible: "pdf-document-progress--visible",
    outlineCurrent: "pdf-outline-current",
    searchPreparing: "pdf-search-count--preparing",
    outlinePreparing: "pdf-outline--preparing",
    attachmentsPreparing: "pdf-attachments--preparing",
    searchHighlight: "pdf-search-highlight",
    searchHighlightCurrent: "pdf-search-highlight-current",
    pinchActive: "pdf-pinch-active",
    fullscreen: "pdf-fullscreen",
    presentationMode: "pdf-presentation-mode",
    presentationControlsVisible: "pdf-presentation-controls-visible",
    thumbnailCurrent: "pdf-thumbnail-current",
    thumbnailError: "pdf-thumbnail-error",
  });
});

test("attachment metadata, sidebar presentation, and lazy download preserve identity and bytes", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.primary.getAttachments());
  expect(result).toEqual({
    ok: true,
    attachments: [
      { id: "attachment-alpha", filename: "fixture.txt", description: "First fixture attachment" },
      { id: "attachment-beta", filename: "fixture.txt", description: "Binary fixture attachment" },
    ],
  });

  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "More document views" }).click();
  await page.getByRole("menuitemradio", { name: "Attachments" }).click();
  const items = page.locator("#primary .pdf-attachment");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator(".pdf-attachment-name")).toHaveText("fixture.txt");
  await expect(items.nth(1).locator(".pdf-attachment-description")).toHaveText(
    "Binary fixture attachment",
  );

  const downloadEvent = page.waitForEvent("download");
  const activation = page.evaluate(() =>
    window.fixture.primary.downloadAttachment("attachment-beta"),
  );
  const download = await downloadEvent;
  await expect(activation).resolves.toEqual({ ok: true });
  expect(download.suggestedFilename()).toBe("fixture.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect([...Buffer.concat(chunks)]).toEqual([0, 255, 16, 128, 65, 127]);
});

test("optional-content API, radio behavior, UI, and raster identities share one revision", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.load("/ocg-fixture.pdf"));
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  const initial = await page.evaluate(() => window.fixture.primary.getLayers());
  expect(initial.ok).toBe(true);
  if (!initial.ok) return;
  type LayerNode = (typeof initial.layers)[number];
  type LayerGroup = Extract<LayerNode, { kind: "group" }>;
  const collectGroups = (nodes: readonly LayerNode[]): LayerGroup[] =>
    nodes.flatMap(node => (node.kind === "group" ? [node] : collectGroups(node.children)));
  const groups = collectGroups(initial.layers);
  const red = groups.find(group => group.kind === "group" && group.name === "Red block");
  const blue = groups.find(group => group.kind === "group" && group.name === "Blue block");
  const unnamed = groups.find(group => group.kind === "group" && group.name.startsWith("Layer "));
  expect(red?.kind === "group" && red.visible).toBe(true);
  expect(blue?.kind === "group" && blue.visible).toBe(false);
  expect(unnamed?.kind).toBe("group");
  if (!red || red.kind !== "group" || !blue || blue.kind !== "group")
    throw new Error("Missing fixture layers");

  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const thumbnail = page.locator("#primary .pdf-thumbnail").first();
  await expect(thumbnail).toHaveAttribute("data-pdf-thumbnail-ready", "");
  await thumbnail.locator("canvas").evaluate(canvas => {
    (window as typeof window & { oldLayerThumbnail?: Element }).oldLayerThumbnail = canvas;
  });
  const before = await page
    .locator('#primary .pdf-page[data-page="1"] canvas')
    .evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());

  const mutation = await page.evaluate(
    async ({ redId, blueId }) => {
      const root = document.querySelector("#primary")!;
      let events = 0;
      root.addEventListener("pdf:layerschange", () => {
        events++;
      });
      const result = await window.fixture.primary.setLayerVisibility([
        { id: redId, visible: false },
        { id: blueId, visible: true },
      ]);
      return { result, events };
    },
    { redId: red.id, blueId: blue.id },
  );
  expect(mutation.result.ok && mutation.result.revision).toBe(1);
  expect(mutation.events).toBe(1);
  expect(
    mutation.result.ok &&
      collectGroups(mutation.result.layers).find(group => group.id === red.id)?.visible,
  ).toBe(false);
  await expect
    .poll(() =>
      page
        .locator('#primary .pdf-page[data-page="1"] canvas')
        .evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()),
    )
    .not.toBe(before);
  await expect(thumbnail).toHaveAttribute("data-pdf-thumbnail-ready", "");
  const thumbnailReplaced = await thumbnail
    .locator("canvas")
    .evaluate(
      canvas =>
        canvas !== (window as typeof window & { oldLayerThumbnail?: Element }).oldLayerThumbnail,
    );
  expect(thumbnailReplaced).toBe(true);

  await page.getByRole("button", { name: "More document views" }).click();
  await page.getByRole("menuitemradio", { name: "Layers" }).click();
  await expect(
    page.locator(`#primary .pdf-layer-choice input[data-pdf-layer-id="${red.id}"]`),
  ).not.toBeChecked();
  await expect(
    page.locator(`#primary .pdf-layer-choice input[data-pdf-layer-id="${blue.id}"]`),
  ).toBeChecked();
  await page.getByRole("button", { name: "Reset layers" }).click();
  await expect(
    page.locator(`#primary .pdf-layer-choice input[data-pdf-layer-id="${red.id}"]`),
  ).toBeChecked();
  await expect(
    page.locator(`#primary .pdf-layer-choice input[data-pdf-layer-id="${blue.id}"]`),
  ).not.toBeChecked();
});

test("optional-content acquisition failure is feature-local and clears stale layer availability", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.load("/ocg-fixture.pdf"));
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  const layersAction = page.locator(
    '#primary [role="menuitemradio"][data-pdf-sidebar-view="layers"]',
  );
  await expect(layersAction).not.toHaveAttribute("hidden", "");

  await page.evaluate(() => {
    window.fixture.failNextOptionalContentAcquisition();
    return window.fixture.primary.load("/fixture.pdf");
  });
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await expect(page.evaluate(() => window.fixture.primary.getLayers())).resolves.toMatchObject({
    ok: false,
    reason: "error",
  });
  await expect(layersAction).toHaveAttribute("hidden", "");
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-page canvas")
        .first()
        .evaluate(canvas => (canvas as HTMLCanvasElement).width > 0),
    )
    .toBe(true);

  await page.evaluate(() => window.fixture.primary.close());
  await expect(layersAction).toHaveAttribute("hidden", "");
});

test("an attachment-free replacement removes only the attachments sidebar view", async ({
  page,
}) => {
  const attachmentsTab = page.locator(
    '#primary [role="menuitemradio"][data-pdf-sidebar-view="attachments"]',
  );
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.attachmentsPreparation))
    .toBe("ready");
  await expect(attachmentsTab).not.toHaveAttribute("hidden", "");
  await page.evaluate(() => window.fixture.primary.load("/replacement-fixture.pdf"));
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.attachmentsPreparation))
    .toBe("ready");
  await expect(attachmentsTab).toHaveAttribute("hidden", "");
  await expect(
    page.locator('#primary [role="menuitemradio"][data-pdf-sidebar-view="layers"]'),
  ).toHaveAttribute("hidden", "");
  await expect(page.evaluate(() => window.fixture.primary.getLayers())).resolves.toEqual({
    ok: true,
    revision: 0,
    layers: [],
  });
  await expect(page.locator("#primary .pdf-sidebar-more-toggle")).toBeHidden();
  await expect(
    page.locator('#primary .pdf-sidebar-primary-views [data-pdf-sidebar-view="outline"]'),
  ).toBeAttached();
  await expect(
    page.locator('#primary .pdf-sidebar-primary-views [data-pdf-sidebar-view="thumbnails"]'),
  ).toBeAttached();
});

test("zoom-limit hint appears immediately, stays held, and follows the CSS transition duration", async ({
  page,
}) => {
  const viewport = page.locator("#primary .pdf-container");
  const hint = page.locator("#primary .pdf-zoom-limit-hint");
  await page.locator("#primary .pdf-default-ui").evaluate(element => {
    (element as HTMLElement).style.setProperty("--pdf-ui-transition-normal", "600ms");
  });

  const before = await viewport.boundingBox();
  const heldImmediately = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (!viewport) throw new Error("Missing document viewport");
    const rect = viewport.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    window.fixture.primary.zoomTo(10);
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: center.x,
        clientY: center.y,
        deltaY: -100,
      }),
    );
    return new Promise<boolean>(resolve =>
      requestAnimationFrame(() => {
        const hint = viewport.parentElement?.querySelector(".pdf-zoom-limit-hint");
        resolve(Boolean(hint?.classList.contains("pdf-zoom-limit-hint--in")));
      }),
    );
  });
  expect(heldImmediately).toBe(true);
  await expect
    .poll(() => hint.evaluate(element => element.classList.contains("pdf-zoom-limit-hint--in")))
    .toBe(false);
  await expect(viewport).not.toHaveClass(/pdf-pinch-active/);

  const after = await viewport.boundingBox();
  expect(after).toEqual(before);
});

test("active touch pinch suppresses painting without clearing unrelated selection", async ({
  page,
}) => {
  const viewport = page.locator("#primary .pdf-container");
  await viewport.evaluate(container => {
    const marker = document.createElement("span");
    marker.textContent = "Temporary selection";
    container.append(marker);
    const range = document.createRange();
    range.selectNodeContents(marker);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const pageTwo = container.querySelector<HTMLElement>('.pdf-page[data-page="2"]');
    if (!pageTwo) throw new Error("Missing second page");
    (container as HTMLElement).scrollTop = pageTwo.offsetTop + 2;
    for (const [pointerId, clientX] of [
      [1, 100],
      [2, 200],
    ] as const) {
      container.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          clientX,
          clientY: 100,
        }),
      );
    }
  });

  await expect(viewport).toHaveClass(/pdf-pinch-active/);
  const content = viewport.locator(".pdf-content");
  await expect(content).toHaveCSS("transition-property", "none");
  expect(
    await viewport.evaluate(element => {
      const styles = getComputedStyle(element);
      return (
        styles.getPropertyValue("user-select") || styles.getPropertyValue("-webkit-user-select")
      );
    }),
  ).toBe("none");
  expect(await page.evaluate(() => document.getSelection()?.rangeCount)).toBe(1);
  await page.evaluate(() => {
    window.fixture.logs.length = 0;
  });
  await viewport.evaluate((element: HTMLElement) => {
    element.scrollTop += 10;
  });
  await page.waitForTimeout(50);
  expect(
    await page.evaluate(() =>
      window.fixture.logs.some(
        entry => entry.event === "render-motion-changed" || entry.event === "page-render-started",
      ),
    ),
  ).toBe(false);

  await viewport.dispatchEvent("pointercancel", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 200,
    clientY: 100,
    bubbles: true,
  });
  await expect(viewport).not.toHaveClass(/pdf-pinch-active/);
  await expect(page.locator("#primary .pdf-page-number-input")).toHaveValue("2");
});

test("WebKit gesture ownership releases pinch state before one-finger scrolling resumes", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const viewport = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (!viewport) throw new Error("Missing document viewport");
    const pointer = (type: string, pointerId: number, x: number) =>
      viewport.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          clientX: x,
          clientY: 100,
        }),
      );
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        scale: number;
      };
      event.scale = scale;
      viewport.dispatchEvent(event);
    };

    pointer("pointerdown", 1, 100);
    pointer("pointerdown", 2, 200);
    gesture("gesturestart", 1);
    gesture("gesturechange", 1.4);
    gesture("gestureend", 1.4);
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const touchMove = new Event("touchmove", { bubbles: true, cancelable: true });
    viewport.dispatchEvent(touchMove);
    return {
      pinchActive: viewport.classList.contains("pdf-pinch-active"),
      touchMovePrevented: touchMove.defaultPrevented,
    };
  });

  expect(result).toEqual({ pinchActive: false, touchMovePrevented: false });
});

test("zoom-limit hint avoids motion when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const viewport = page.locator("#primary .pdf-container");
  const hint = page.locator("#primary .pdf-zoom-limit-hint");

  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (!viewport) throw new Error("Missing document viewport");
    const rect = viewport.getBoundingClientRect();
    window.fixture.primary.zoomTo(10);
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaY: -100,
      }),
    );
  });

  await expect
    .poll(() => hint.evaluate(element => element.classList.contains("pdf-zoom-limit-hint--in")))
    .toBe(false);
});

test("search panel shrinks within a narrow viewer", async ({ page }) => {
  await page.locator("#primary").evaluate(root => {
    root.setAttribute("style", "width: 16rem; flex: 0 0 16rem");
  });
  await page.getByRole("button", { name: "Search" }).click();

  const panel = page.locator("#primary .pdf-search-panel");
  const dimensions = await panel.evaluate(panel => {
    const controls = panel.closest<HTMLElement>(".pdf-controls");
    if (!controls) throw new Error("Missing controls");
    const panelRect = panel.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    return { panelWidth: panelRect.width, controlsWidth: controlsRect.width };
  });
  await panel.locator(".pdf-search-input").fill("Fixture");
  await expect(panel.locator(".pdf-search-count")).toHaveText("1/3");
  const resultWidth = await panel.evaluate(element => element.getBoundingClientRect().width);
  expect(dimensions.panelWidth).toBeLessThanOrEqual(dimensions.controlsWidth);
  expect(resultWidth).toBe(dimensions.panelWidth);
});

test("search and menu panels animate from their top edge", async ({ page }) => {
  const origins = await page
    .locator("#primary :is(.pdf-search-panel, .pdf-menu-panel)")
    .evaluateAll(panels =>
      panels.map(panel => getComputedStyle(panel).transformOrigin.split(" ")[1]),
    );
  expect(origins).toEqual(["0px", "0px"]);
});

test("menu panel remains absolute and root-contained in a narrow viewer", async ({ page }) => {
  await page.locator("#primary").evaluate(root => {
    root.setAttribute("style", "width: 16rem; flex: 0 0 16rem");
  });
  await page.getByRole("button", { name: "PDF options" }).click();
  const bounds = await page.locator("#primary").evaluate(root => {
    const panel = root.querySelector<HTMLElement>(".pdf-menu-panel")!;
    const rootRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return { position: getComputedStyle(panel).position, panelRect, rootRect };
  });
  expect(bounds.position).toBe("absolute");
  expect(bounds.panelRect.left).toBeGreaterThanOrEqual(bounds.rootRect.left);
  expect(bounds.panelRect.right).toBeLessThanOrEqual(bounds.rootRect.right + 1);
  expect(bounds.panelRect.bottom).toBeLessThanOrEqual(bounds.rootRect.bottom + 1);
});

test("root container queries hide Fit in a narrow embedded viewer on a wide page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.locator("#primary").evaluate(root => {
    root.setAttribute("style", "width: 320px; flex: 0 0 320px");
  });
  await expect(page.locator("#primary .pdf-fit-main-btn")).toBeHidden();
});

test("menu panel remains root-contained in a short embedded viewer", async ({ page }) => {
  await page.locator("#primary").evaluate(root => {
    root.setAttribute("style", "width: 600px; height: 300px; flex: none");
  });
  await page.getByRole("button", { name: "PDF options" }).click();
  const contained = await page.locator("#primary").evaluate(root => {
    const rootRect = root.getBoundingClientRect();
    const panelRect = root.querySelector<HTMLElement>(".pdf-menu-panel")!.getBoundingClientRect();
    return panelRect.top >= rootRect.top - 1 && panelRect.bottom <= rootRect.bottom + 1;
  });
  expect(contained).toBe(true);
});

test("print conditional hidden state never reserves default dialog layout", async ({ page }) => {
  const range = page.locator("#primary .pdf-print-range-wrap");
  await expect(range).toHaveAttribute("hidden", "");
  await expect(range).toHaveCSS("display", "none");
});

test("dialogs remain viewport-constrained independently of a narrow viewer root", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.locator("#primary").evaluate(root => {
    root.setAttribute("style", "width: 16rem; flex: 0 0 16rem");
  });
  await page.getByRole("button", { name: "PDF options" }).click();
  await page.locator("#primary .pdf-document-information-btn").click();
  const bounds = await page
    .getByRole("dialog", { name: "Document information" })
    .evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { rect, width: innerWidth, height: innerHeight };
    });
  expect(bounds.rect.width).toBeLessThanOrEqual(bounds.width);
  expect(bounds.rect.height).toBeLessThanOrEqual(bounds.height);
});

test("page navigation reserves stable space for loaded page counts", async ({ page }) => {
  const dimensions = await page.locator("#primary .pdf-page-nav").evaluate(nav => {
    const count = nav.querySelector<HTMLElement>(".pdf-page-count");
    if (!count) throw new Error("Missing page count");
    return {
      navWidth: nav.getBoundingClientRect().width,
      navMinWidth: getComputedStyle(nav).minWidth,
      countWidth: count.getBoundingClientRect().width,
      countMinWidth: getComputedStyle(count).minWidth,
      countNumericVariant: getComputedStyle(count).fontVariantNumeric,
    };
  });

  expect(dimensions.navWidth).toBeGreaterThanOrEqual(150);
  expect(dimensions.navMinWidth).not.toBe("0px");
  expect(dimensions.countWidth).toBeGreaterThan(0);
  expect(dimensions.countMinWidth).not.toBe("0px");
  expect(dimensions.countNumericVariant).toContain("tabular-nums");
});

test("pre-rendered outline filter and close controls are wired", async ({ page }) => {
  await expect(page.locator("#primary .pdf-outline li[data-outline-key]").first()).toBeAttached();
  await page.evaluate(() => {
    const outline = document.querySelector<HTMLElement>("#primary .pdf-sidebar");
    const header = outline?.querySelector<HTMLElement>(".pdf-outline-filter");
    const list = outline?.querySelector<HTMLElement>(".pdf-outline");
    if (!outline || !header || !list) throw new Error("Missing outline fixture UI");

    header.replaceChildren();
    const input = document.createElement("input");
    input.className = "pdf-outline-filter-input";
    input.type = "search";
    input.setAttribute("aria-label", "Filter outline");
    const close = document.createElement("button");
    close.className = "pdf-sidebar-close-btn";
    close.type = "button";
    close.setAttribute("aria-label", "Close outline");
    header.append(input, close);

    const root = document.createElement("ul");
    for (const title of ["First chapter", "Second chapter"]) {
      const item = document.createElement("li");
      item.dataset.title = title;
      item.textContent = title;
      root.append(item);
    }
    list.replaceChildren(root);
  });

  await page.getByRole("button", { name: "Document navigation" }).click();
  const outline = page.locator("#primary .pdf-sidebar");
  await expect(outline).toHaveAttribute("data-open", "true");

  await page.getByRole("searchbox", { name: "Filter outline" }).fill("Second");
  await expect(outline.locator(".pdf-outline li").nth(0)).toHaveCSS("display", "none", {
    timeout: 1_000,
  });
  await expect(outline.locator(".pdf-outline li").nth(1)).not.toHaveCSS("display", "none");

  await page.getByRole("button", { name: "Close outline" }).click();
  await expect(outline).toHaveAttribute("data-open", "false");
});

test("outline filtering keeps only matching branches and restores them when cleared", async ({
  page,
}) => {
  await expect(page.locator("#primary .pdf-outline li[data-outline-key]").first()).toBeAttached();
  await page.evaluate(() => {
    const outline = document.querySelector<HTMLElement>("#primary .pdf-sidebar");
    const list = outline?.querySelector<HTMLElement>(".pdf-outline");
    if (!outline || !list) throw new Error("Missing outline fixture UI");
    const tree = document.createElement("ul");
    for (const [title, children] of [
      ["First chapter", ["First detail", "First appendix"]],
      ["Second chapter", ["Second detail", "Second appendix"]],
    ] as const) {
      const item = document.createElement("li");
      item.dataset.title = title;
      item.append(Object.assign(document.createElement("button"), { textContent: title }));
      const childList = document.createElement("ul");
      for (const childTitle of children) {
        const child = document.createElement("li");
        child.dataset.title = childTitle;
        child.append(Object.assign(document.createElement("button"), { textContent: childTitle }));
        childList.append(child);
      }
      item.append(childList);
      tree.append(item);
    }
    list.replaceChildren(tree);
  });

  await page.getByRole("button", { name: "Document navigation" }).click();
  const outline = page.locator("#primary .pdf-sidebar");
  const input = outline.locator(".pdf-outline-filter-input");
  await input.fill("Second detail");
  const items = outline.locator(".pdf-outline li");
  await expect(items.nth(0)).toHaveCSS("display", "none");
  await expect(items.nth(1)).toHaveCSS("display", "none");
  await expect(items.nth(2)).toHaveCSS("display", "none");
  await expect(items.nth(3)).not.toHaveCSS("display", "none");
  await expect(items.nth(4)).not.toHaveCSS("display", "none");
  await expect(items.nth(5)).toHaveCSS("display", "none");

  await input.fill("");
  await expect(items).toHaveCount(6);
  expect(
    await items.evaluateAll(entries =>
      entries.every(item => getComputedStyle(item).display !== "none"),
    ),
  ).toBe(true);
});

test("custom outlines receive minimal fallback controls and stable tree styling hooks", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeCustomOutlineMarkup())).resolves.toEqual({
    filterGenerated: true,
    inputGenerated: true,
    closeNotGenerated: true,
    fallbackHasNoInlineStyle: true,
    partialMarkupNormalized: true,
    fallbackUsesConfiguredLabel: true,
    contentHookGenerated: true,
    contentHasNoInlineVisualStyle: true,
    itemStateGeneratedWhenPresent: true,
    accessibleLabelRestored: true,
  });
});

test("outline filter feature preserves host ownership, query state, and persistent focus", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeOutlineFilterPolicy())).resolves.toEqual({
    disabledMarkupUntouched: true,
    persistentQueryPreserved: true,
    persistentFocusPreserved: true,
    queryClearedOnClose: true,
  });
});

test("pointer interaction with the document releases search and outline input focus", async ({
  page,
}) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  const searchInput = page.getByRole("searchbox", { name: "Search" });

  await page.getByRole("button", { name: "Search" }).click();
  await expect(searchInput).toBeFocused();
  await viewport.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await expect(viewport).toBeFocused();

  await page.getByRole("button", { name: "Document navigation" }).click();
  const outlineInput = page.getByRole("searchbox", { name: "Filter table of contents" });
  await outlineInput.focus();
  await expect(outlineInput).toBeFocused();
  await viewport.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await expect(viewport).toBeFocused();
});

test("document focus transfer preserves custom mouse drag scrolling", async ({ page }) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeFocused();

  const box = await viewport.boundingBox();
  if (!box) throw new Error("Missing document viewport bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25, { steps: 5 });
  await page.mouse.up();

  await expect(viewport).toBeFocused();
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test("focused document container does not draw a browser outline", async ({ page }) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });

  await viewport.focus();

  await expect(viewport).toBeFocused();
  await expect(viewport).toHaveCSS("outline-style", "none");
});

test("generated-control options are rejected in custom mode", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeDisabledPanelOwnership())).rejects.toThrow(
    "ui.controls is accepted only in default mode",
  );
});

test("generated UI omits disabled controls and feature-dependent controls", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeGeneratedUiComposition())).resolves.toEqual({
    searchOmitted: true,
    sidebarKeptWithoutFilter: true,
    sidebarCloseKept: true,
    attachmentsOmitted: true,
    pageNavigationOmitted: true,
    fitOmitted: true,
    menuKept: true,
    menuChildrenOmitted: true,
    navigationHistoryDisabled: true,
    nativeTouchActionRestored: true,
    browserfindShortcutReleased: true,
    allViewsCanUseOverflow: true,
  });
});

test("search indexing and outline loading are demand-driven with optional eager preparation", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeFeaturePreparation())).resolves.toEqual({
    deferredByDefault: true,
    demandRunsOnce: true,
    demandDetailsValid: true,
    pendingQueryResolved: true,
    searchPreparationVisible: true,
    searchPreparationLayoutStable: true,
    outlinePreparationVisible: true,
    eagerWorksWithoutControls: true,
    eagerEventsFollowReady: true,
  });
});

test("public search and outline APIs return detached query data and structured failures", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probePublicDataQueries())).resolves.toEqual({
    searchDataValid: true,
    outlineDataValid: true,
    resultsAreDetached: true,
    oneCharacterQueriesWork: true,
    matchingOptionsValid: true,
    preparationReused: true,
    uiStayedClosed: true,
    uiPoliciesRespected: true,
    distantOutlineDoesNotInferNavigation: true,
    nearbyOutlineUsesInferredNavigation: true,
    invalidQueryRejected: true,
    destroyedResults: true,
    disabledResults: true,
    loadingResults: true,
    navigationInferenceIsOptional: true,
    defaultPoliciesValid: true,
    cancelledResults: true,
    searchDidNotMutateUi: true,
  });
});

test("duplicate global IDs leave the rejected host without viewer residue", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeViewerIdentity())).resolves.toEqual({
    generatedIdsAreUnique: true,
    duplicateGlobalIdRejected: true,
  });
});

test("ready state is emitted once before ready and eager preparation events", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeReadinessOrdering())).resolves.toEqual({
    oneReadyState: true,
    statePrecedesReady: true,
    preparationsFollowReady: true,
    readyStateCount: 1,
  });
});

test("viewer-scoped keyboard routing uses the iframe owner document", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeIframeRouting())).resolves.toEqual({
    ready: true,
    ownerDocumentUsed: true,
    viewerScopedKeyRouted: true,
    ownerWindowDragStopped: true,
    shadowScrollOwnerUsed: true,
  });
});

test("document information API returns normalized detached metadata", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeDocumentInformation())).resolves.toEqual({
    pageCount: 3,
    pdfFormatVersion: "1.7",
    title: "Fixture metadata title",
    author: "Fixture author",
    creationDate: "D:20260814120000+03'00'",
    trapped: "False",
    customText: "Custom value",
    customNumber: 42,
    hasOriginalFingerprint: true,
    modifiedFingerprint: null,
    permissionsUnavailable: true,
    detached: true,
    capabilitiesValid: true,
  });
});

test("document information runtime text refreshes cached fields and excludes stale pending metadata", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeDocumentInformationUiTextRefresh()),
  ).resolves.toEqual({
    cachedFieldsRefreshed: true,
    pendingHidesStaleMetadata: true,
    pendingRendersFreshMetadata: true,
    requests: 2,
  });
});

test("generated document information dialog renders metadata and supports every dismissal path", async ({
  page,
}) => {
  const menu = page.getByRole("button", { name: "PDF options" });
  const action = page.locator(".pdf-document-information-btn");
  await expect(action.locator("..")).toHaveClass("pdf-menu-secondary-actions");
  const dialog = page.getByRole("dialog", { name: "Document information" });
  const open = async () => {
    await menu.click();
    await action.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".pdf-document-information-status")).toBeEmpty();
  };

  await open();
  await expect(dialog.locator("dt")).toContainText([
    "Title",
    "Author",
    "Creation date",
    "PDF version",
    "Page count",
    "Fast web view",
  ]);
  await expect(dialog.locator("dd")).toContainText([
    "Fixture metadata title",
    "Fixture author",
    "2026-08-14 12:00:00 +03:00",
    "1.7",
    "3",
    "No",
  ]);
  expect(await dialog.evaluate(element => getComputedStyle(element).transitionDuration)).not.toBe(
    "0s",
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();

  await open();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();

  await page.locator("#primary .pdf-default-ui").evaluate(root => {
    root.setAttribute("dir", "rtl");
  });
  await open();
  await expect(dialog).toHaveCSS("direction", "rtl");
  await expect(dialog.locator("dd").first()).toHaveAttribute("dir", "auto");
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
});

test("document information and print dialogs disable motion for reduced-motion users", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page.locator("#primary").evaluate(root => {
        const duration = (selector: string) =>
          getComputedStyle(root.querySelector(selector)!).transitionDuration;
        return {
          information: duration(".pdf-document-information"),
          print: duration(".pdf-print-setup"),
        };
      }),
    )
    .toEqual({ information: "0s", print: "0s" });
});

test("annotation link policy independently controls internal and external PDF links", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeAnnotationLinkPolicy())).resolves.toEqual({
    allDisabled: 0,
    internalOnly: 1,
    internalOnlyUsesAnchor: 1,
    externalOnly: 1,
    externalOnlyUsesAnchor: 1,
    bothEnabled: 2,
  });
});

test("internal PDF annotation links navigate after presentation settles", async ({ page }) => {
  const container = page.locator("#primary .pdf-container");
  await container.evaluate(element => {
    element.dataset.annotationNavigationScrollSamples = "0";
    element.addEventListener("scroll", () => {
      element.dataset.annotationNavigationScrollSamples = String(
        Number(element.dataset.annotationNavigationScrollSamples) + 1,
      );
    });
  });
  const internalLink = page.locator(
    "#primary .linkAnnotation[data-internal-link] > a.pdf-annotation-link",
  );
  await expect(internalLink).toBeVisible();
  await internalLink.click();
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await expect
    .poll(() =>
      container.evaluate(element => Number(element.dataset.annotationNavigationScrollSamples)),
    )
    .toBeGreaterThan(1);
});

test("annotation destination resolution survives neutral input and yields to a newer explicit jump", async ({
  page,
}) => {
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      "#primary .linkAnnotation[data-internal-link] > a.pdf-annotation-link",
    );
    link?.click();
    window.fixture.primary.nextRow(false);
    window.fixture.primary.nextRow(false);
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.canGoBack)).toBe(true);

  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      "#primary .linkAnnotation[data-internal-link] > a.pdf-annotation-link",
    );
    link?.click();
    window.fixture.primary.navigateToPage(3);
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
});

test("real AnnotationLayer keeps package classes and core geometry in headless UI", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeHeadlessAnnotationGeometry()),
  ).resolves.toEqual({
    runtimeLayerClass: true,
    packageLayerClass: true,
    packageLinkClass: true,
    layerMatchesPage: true,
    canvasCoversPage: true,
    linkMatchesSection: true,
    corePointerGeometry: true,
  });
});

test("rich read-only annotations enforce action policy, popup a11y, OCG, zoom, and attachment cleanup", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.load("/annotation-fixture.pdf"));
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  const layer = page.locator("#primary .pdf-annotation-layer").first();
  await expect(layer).toBeAttached();

  for (const family of [
    ".textAnnotation",
    ".highlightAnnotation",
    ".underlineAnnotation",
    ".squigglyAnnotation",
    ".strikeoutAnnotation",
    ".stampAnnotation",
    ".freeTextAnnotation",
    ".inkAnnotation",
    ".fileAttachmentAnnotation",
  ])
    await expect(layer.locator(family)).toHaveCount(1);
  await expect(layer.locator(".linkAnnotation")).toHaveCount(3);
  await expect(layer.locator(".pdf-annotation-popup")).not.toHaveCount(0);

  const note = layer.locator(".textAnnotation");
  await note.focus();
  await page.keyboard.press("Enter");
  const popup = layer.locator(".pdf-annotation-popup:not([hidden])").first();
  await expect(popup).toBeVisible();
  await expect(note).toHaveAttribute("aria-haspopup", "dialog");
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();

  const ocgRevision = await page.evaluate(() => {
    const result = window.fixture.primary.getLayers();
    return result.ok ? result.revision : -1;
  });
  await layer.locator(".linkAnnotation a").nth(2).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const result = window.fixture.primary.getLayers();
        return result.ok ? result.revision : -1;
      }),
    )
    .toBe(ocgRevision + 1);
  await expect(layer.locator(".highlightAnnotation")).toBeHidden();

  await page.evaluate(() => window.fixture.primary.zoomTo(1.25));
  await expect(page.locator("#primary .pdf-annotation-layer .freeTextAnnotation")).toBeAttached();

  const resources = await page.evaluate(async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const clicked: string[] = [];
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = () => {
      const value = `blob:annotation-${created.length}`;
      created.push(value);
      return value;
    };
    URL.revokeObjectURL = value => {
      revoked.push(String(value));
    };
    HTMLAnchorElement.prototype.click = function () {
      clicked.push(this.download);
    };
    try {
      document
        .querySelector<HTMLElement>("#primary .fileAttachmentAnnotation .popupTriggerArea")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 25));
      return { created, revoked, clicked };
    } finally {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      HTMLAnchorElement.prototype.click = click;
    }
  });
  expect(resources).toEqual({
    created: ["blob:annotation-0"],
    revoked: ["blob:annotation-0"],
    clicked: ["page-note.txt"],
  });

  await layer.locator(".linkAnnotation a").nth(1).click();
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
});

test("AcroForms are viewer-isolated, stateful across virtualization, resettable, and exportable", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.addAcroFormViewers());
  const first = page.locator("#form-viewer-a");
  const second = page.locator("#form-viewer-b");
  const third = page.locator("#form-viewer-c");
  const firstText = first.locator(".textWidgetAnnotation input").first();
  const secondText = second.locator(".textWidgetAnnotation input").first();
  const thirdText = third.locator(".textWidgetAnnotation input").first();
  expect(
    await page.evaluate(() =>
      window.fixture.logs.filter(
        entry =>
          entry.viewerId?.startsWith("form-viewer") &&
          entry.event === "annotation-presentation-failed",
      ),
    ),
  ).toEqual([]);
  await expect(firstText).toHaveValue("Loaded");
  await expect(secondText).toHaveValue("Loaded");
  await expect(thirdText).toHaveValue("Loaded");
  await expect(first.locator(".buttonWidgetAnnotation.checkBox input")).toBeChecked();
  const pageOneRadioWidget = first.locator(".buttonWidgetAnnotation.radioButton");
  await expect(pageOneRadioWidget.locator("input")).toBeChecked();
  await expect(pageOneRadioWidget.locator('[data-canvas-name="checked"]')).toHaveCSS(
    "display",
    "block",
  );
  await expect(pageOneRadioWidget.locator('[data-canvas-name="unchecked"]')).toHaveCSS(
    "display",
    "none",
  );
  const appearanceTextWidget = first.locator(".textWidgetAnnotation.hasOwnCanvas");
  await expect(appearanceTextWidget).toHaveCount(1);
  await expect(appearanceTextWidget.locator("input, textarea")).toBeHidden();
  await expect(appearanceTextWidget.locator("canvas.annotationContent")).toBeVisible();
  await appearanceTextWidget.evaluate(widget => widget.classList.add("sandboxModified"));
  await expect(appearanceTextWidget.locator("input, textarea")).toBeVisible();
  await expect(appearanceTextWidget.locator("canvas.annotationContent")).toBeHidden();
  await appearanceTextWidget.evaluate(widget => widget.classList.remove("sandboxModified"));
  await expect(first.locator(".choiceWidgetAnnotation select")).toHaveCount(2);
  await expect(first.locator(".signatureWidgetAnnotation input")).toHaveCount(0);
  await expect(first.locator(".pdf-default-ui")).toHaveCount(1);
  const downloadFilledDocumentButton = first.locator(".pdf-download-filled-document-btn");
  await expect(downloadFilledDocumentButton).not.toHaveAttribute("hidden", "");
  await expect(downloadFilledDocumentButton).toBeDisabled();
  expect(
    await first
      .locator(".pdf-download-btn .pdf-ui-icon, .pdf-download-filled-document-btn .pdf-ui-icon")
      .evaluateAll(icons =>
        icons.map(icon => getComputedStyle(icon).getPropertyValue("--pdf-ui-icon")),
      ),
  ).toEqual([
    await first
      .locator(".pdf-download-btn .pdf-ui-icon")
      .evaluate(icon => getComputedStyle(icon).getPropertyValue("--pdf-ui-icon")),
    await first
      .locator(".pdf-download-btn .pdf-ui-icon")
      .evaluate(icon => getComputedStyle(icon).getPropertyValue("--pdf-ui-icon")),
  ]);
  expect(
    await page.evaluate(() => {
      const viewers = (
        window as Window & {
          formViewers?: {
            first: typeof window.fixture.primary;
            second: typeof window.fixture.primary;
          };
        }
      ).formViewers!;
      return [viewers.first.state.formDirty, viewers.second.state.formDirty];
    }),
  ).toEqual([false, false]);

  const isolatedNames = await page.evaluate(() => {
    const a = document.querySelector<HTMLInputElement>(
      "#form-viewer-a .textWidgetAnnotation input",
    )!;
    const b = document.querySelector<HTMLInputElement>(
      "#form-viewer-b .textWidgetAnnotation input",
    )!;
    return {
      namesDiffer: a.name !== b.name,
      idsDiffer: a.dataset.elementId !== b.dataset.elementId,
    };
  });
  expect(isolatedNames).toEqual({ namesDiffer: true, idsDiffer: true });

  await page.evaluate(() => {
    const values: boolean[] = [];
    (window as Window & { formDirtyEvents?: boolean[] }).formDirtyEvents = values;
    document.querySelector("#form-viewer-a")?.addEventListener("pdf:formdirtychange", event => {
      values.push((event as CustomEvent<{ formDirty: boolean }>).detail.formDirty);
    });
  });
  await page.evaluate(() => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    viewers.first.setTextSelectionMode(true);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewers = (
          window as Window & { formViewers?: { first: typeof window.fixture.primary } }
        ).formViewers!;
        return viewers.first.state.textSelectionMode;
      }),
    )
    .toBe(true);
  await firstText.fill("Viewer A value");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewers = (
          window as Window & { formViewers?: { first: typeof window.fixture.primary } }
        ).formViewers;
        return viewers?.first.state.formDirty;
      }),
    )
    .toBe(true);
  await expect(downloadFilledDocumentButton).toBeEnabled();
  expect(
    await page.evaluate(() => (window as Window & { formDirtyEvents?: boolean[] }).formDirtyEvents),
  ).toEqual([true]);
  await expect(secondText).toHaveValue("Loaded");

  await first.locator(".buttonWidgetAnnotation.checkBox input").uncheck();
  await first.locator(".buttonWidgetAnnotation.radioButton input").first().check();
  await first.locator(".choiceWidgetAnnotation select").nth(0).selectOption("three");
  await first.locator(".choiceWidgetAnnotation select").nth(1).selectOption("beta");
  await secondText.fill("Headless value");
  await expect(secondText).toHaveValue("Headless value");
  await thirdText.fill("Custom value");
  await expect(thirdText).toHaveValue("Custom value");

  const focusBefore = await firstText.evaluate(element => {
    const input = element as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 8);
    input.dispatchEvent(new Event("select", { bubbles: true }));
    (window as Window & { focusedFormControl?: HTMLInputElement }).focusedFormControl = input;
    return input.value;
  });
  expect(focusBefore).toBe("Viewer A value");
  const renderCompletions = await page.evaluate(
    () =>
      window.fixture.logs.filter(
        entry => entry.viewerId === "form-viewer-a" && entry.event === "page-render-completed",
      ).length,
  );
  await page.evaluate(() => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    viewers.first.rotateBy(90);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewers = (
          window as Window & { formViewers?: { first: typeof window.fixture.primary } }
        ).formViewers!;
        return viewers.first.state.rotation;
      }),
    )
    .toBe(90);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.fixture.logs.filter(
            entry => entry.viewerId === "form-viewer-a" && entry.event === "page-render-completed",
          ).length,
      ),
    )
    .toBeGreaterThan(renderCompletions);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const retained = (window as Window & { focusedFormControl?: HTMLInputElement })
          .focusedFormControl;
        const active = document.activeElement as HTMLInputElement | null;
        return {
          oldDisconnected: retained?.isConnected === false,
          replacementFocused: active?.value === "Viewer A value",
          selectionStart: active?.selectionStart,
          selectionEnd: active?.selectionEnd,
        };
      }),
    )
    .toEqual({
      oldDisconnected: true,
      replacementFocused: true,
      selectionStart: 2,
      selectionEnd: 8,
    });

  const lastPageOneControl = first
    .locator('.pdf-page[data-page="1"] .choiceWidgetAnnotation select')
    .last();
  await lastPageOneControl.focus();
  await page.keyboard.press("Tab");
  await expect(first.locator('.pdf-page[data-page="2"] .textWidgetAnnotation input')).toBeFocused();
  await expect(
    first.locator('.pdf-page[data-page="2"] .choiceWidgetAnnotation select'),
  ).toHaveCount(1);
  await expect(first.locator('.pdf-page[data-page="2"] .textWidgetAnnotation input')).toHaveValue(
    "Viewer A value",
  );
  await expect(
    first.locator('.pdf-page[data-page="2"] .buttonWidgetAnnotation.pushButton > a'),
  ).toHaveAttribute("href", "https://example.test/form-button");
  await expect(secondText).toHaveValue("Headless value");

  const pageTwoText = first.locator('.pdf-page[data-page="2"] .textWidgetAnnotation input');
  const pageTwoRadioWidget = first.locator(
    '.pdf-page[data-page="2"] .buttonWidgetAnnotation.radioButton',
  );
  const pageTwoRadio = pageTwoRadioWidget.locator("input");
  const pageTwoButton = first.locator(
    '.pdf-page[data-page="2"] .buttonWidgetAnnotation.pushButton > a',
  );
  await expect(pageTwoRadio).not.toBeChecked();
  await expect(pageTwoRadioWidget.locator('[data-canvas-name="checked"]')).toHaveCSS(
    "display",
    "none",
  );
  await expect(pageTwoRadioWidget.locator('[data-canvas-name="unchecked"]')).toHaveCSS(
    "display",
    "block",
  );
  await pageTwoRadio.evaluate((control: HTMLInputElement) => {
    control.disabled = true;
  });
  await pageTwoText.focus();
  await page.keyboard.press("Tab");
  await expect(pageTwoButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(pageTwoText).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    first.locator('.pdf-page[data-page="1"] .choiceWidgetAnnotation select').last(),
  ).toBeFocused();
  await pageTwoRadio.evaluate((control: HTMLInputElement) => {
    control.disabled = false;
  });

  await first
    .locator('.pdf-page[data-page="2"] .choiceWidgetAnnotation select')
    .selectOption(["green"]);
  await pageTwoRadio.check();
  await expect(pageTwoRadioWidget.locator('[data-canvas-name="checked"]')).toHaveCSS(
    "display",
    "block",
  );
  await expect(pageTwoRadioWidget.locator('[data-canvas-name="unchecked"]')).toHaveCSS(
    "display",
    "none",
  );

  const exports = await page.evaluate(async () => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    const [one, two] = await Promise.all([
      viewers.first.getDocumentData({ document: "with-form-values" }),
      viewers.first.getDocumentData({ document: "with-form-values" }),
    ]);
    const detached = one.ok && two.ok && one.data !== two.data;
    const reopened = one.ok ? await window.fixture.readAcroFormValues(one.data) : {};
    if (one.ok) one.data[0] ^= 0xff;
    return {
      one: one.ok ? one.data.byteLength : one.reason,
      two: two.ok ? two.data.byteLength : two.reason,
      detached,
      secondCallerUnaffected: one.ok && two.ok && one.data[0] !== two.data[0],
      reopenedSharedText: reopened.sharedText,
      dirtyAfterExport: viewers.first.state.formDirty,
    };
  });
  expect(exports.one).toBeGreaterThan(0);
  expect(exports.two).toBe(exports.one);
  expect(exports.detached).toBe(true);
  expect(exports.secondCallerUnaffected).toBe(true);
  expect(exports.reopenedSharedText.filter(value => value !== undefined)).toEqual([
    "Viewer A value",
    "Viewer A value",
  ]);
  expect(exports.dirtyAfterExport).toBe(true);

  const saved = await page.evaluate(async () => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    const clicked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:filled-copy";
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {
      clicked.push(this.download);
    };
    try {
      const result = await viewers.first.download({ document: "with-form-values" });
      return { result, clicked, dirty: viewers.first.state.formDirty };
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
  expect(saved).toEqual({
    result: { ok: true },
    clicked: ["acroform-fixture-filled.pdf"],
    dirty: true,
  });

  const reset = await page.evaluate(async () => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    const result = await viewers.first.resetForms();
    return { result, dirty: viewers.first.state.formDirty };
  });
  expect(reset).toEqual({ result: { ok: true, formDirty: false }, dirty: false });
  await expect(downloadFilledDocumentButton).not.toHaveAttribute("hidden", "");
  await expect(downloadFilledDocumentButton).toBeDisabled();
  expect(
    await page.evaluate(() => (window as Window & { formDirtyEvents?: boolean[] }).formDirtyEvents),
  ).toEqual([true, false]);
  await expect(first.locator('.pdf-page[data-page="2"] .textWidgetAnnotation input')).toHaveValue(
    "Loaded",
  );
  await expect(
    first.locator('.pdf-page[data-page="2"] .buttonWidgetAnnotation.radioButton input'),
  ).not.toBeChecked();
  await expect(
    first.locator('.pdf-page[data-page="2"] .choiceWidgetAnnotation select'),
  ).toHaveValues(["red"]);
  await page.evaluate(() => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    viewers.first.navigateToPage(1);
  });
  await expect(first.locator(".buttonWidgetAnnotation.checkBox input")).toBeChecked();
  await expect(
    first.locator('.pdf-page[data-page="1"] .buttonWidgetAnnotation.radioButton input'),
  ).toBeChecked();
  await expect(first.locator(".choiceWidgetAnnotation select").nth(0)).toHaveValue("two");
  await expect(first.locator(".choiceWidgetAnnotation select").nth(1)).toHaveValue("alpha");
  await first
    .locator('.pdf-page[data-page="2"] .textWidgetAnnotation input')
    .fill("Edit after export");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewers = (
          window as Window & { formViewers?: { first: typeof window.fixture.primary } }
        ).formViewers!;
        return viewers.first.state.formDirty;
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const viewers = (window as Window & { formViewers?: { first: typeof window.fixture.primary } })
      .formViewers!;
    await viewers.first.resetForms();
  });
  await expect(first.locator('.pdf-page[data-page="2"] .textWidgetAnnotation input')).toHaveValue(
    "Loaded",
  );
});

test("simultaneous real XFA layers isolate DOM, radio groups, storage, labels, and ARIA references", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeSimultaneousXfaPresentation()),
  ).resolves.toEqual({
    domIdsIsolated: true,
    namesIsolated: true,
    labelRelationship: true,
    ariaRelationship: true,
    accessibleNameDeterministic: true,
    storageIsolated: true,
    virtualizedForwardTab: true,
    reverseTabSkipsUnavailable: true,
    xfaPrintInvoked: true,
    xfaPrintSlotsContained: true,
    xfaPrintShrinkCentered: true,
    xfaPrintFontClass: true,
    xfaPrintFontBaseline: true,
    xfaPrintCurrentValue: true,
    xfaPrintSnapshotImmutable: true,
    xfaPrintCleaned: true,
  });
});

test("annotation extraction failure does not suppress admitted text presentation", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeAnnotationFailureTextIsolation());
  expect(result.textLayers).toBeGreaterThan(0);
  expect(result.annotationLayers).toBe(0);
  expect(result.diagnostics).toBeGreaterThan(0);
});

test("default sidebar overlays narrow viewers and pushes wide viewer content", async ({ page }) => {
  const outline = page.locator("#primary .pdf-sidebar");
  const container = page.locator("#primary .pdf-container");
  const body = page.locator("#primary .pdf-viewer-body");

  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.locator("#primary").evaluate(element => {
    element.style.width = "600px";
  });
  await expect(outline).toHaveCSS("position", "absolute");
  await page.getByRole("button", { name: "Document navigation" }).click();
  await expect(outline).toHaveAttribute("data-open", "true");
  await expect
    .poll(() => body.evaluate(element => getComputedStyle(element, "::after").opacity))
    .toBe("1");
  await expect(container).toHaveCSS("margin-left", "0px");

  await page.locator("#primary").evaluate(element => {
    element.style.width = "900px";
  });
  await expect(outline).toHaveCSS("position", "relative");
  await expect
    .poll(() => container.evaluate(element => element.getBoundingClientRect().left))
    .toBeGreaterThan(200);
  await expect
    .poll(() => body.evaluate(element => getComputedStyle(element, "::after").opacity))
    .toBe("0");
});

test("pushing sidebar exposes stale Fit without changing fit state and closing restores it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.locator("#primary").evaluate(element => {
    element.style.width = "760px";
  });
  const fit = page.locator("#primary .pdf-fit-main-btn");
  const sidebar = page.locator("#primary .pdf-sidebar");
  const fitVisibility = () => fit.evaluate(element => getComputedStyle(element).visibility);

  await expect(sidebar).toHaveCSS("position", "relative");
  await expect.poll(fitVisibility).toBe("hidden");
  const scale = await page.evaluate(() => window.fixture.primary.state.scale);

  await page.getByRole("button", { name: "Document navigation" }).click();
  await expect(sidebar).toHaveAttribute("data-open", "true");
  await expect(sidebar).toHaveCSS("width", "320px");
  await expect.poll(fitVisibility).toBe("visible");
  expect(await page.evaluate(() => window.fixture.primary.state.fitActive)).toBe(true);
  expect(await page.evaluate(() => window.fixture.primary.state.scale)).toBe(scale);

  await fit.click();
  await expect.poll(fitVisibility).toBe("hidden");
  const fittedScale = await page.evaluate(() => window.fixture.primary.state.scale);
  await page.evaluate(() => window.fixture.primary.fit());
  expect(await page.evaluate(() => window.fixture.primary.state.scale)).toBe(fittedScale);

  await page.getByRole("button", { name: "Close" }).click();
  await expect(sidebar).toHaveAttribute("data-open", "false");
  await expect
    .poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width))
    .toBeLessThanOrEqual(1.5);
  await expect.poll(fitVisibility).toBe("hidden");
  expect(await page.evaluate(() => window.fixture.primary.state.fitActive)).toBe(true);
  expect(await page.evaluate(() => window.fixture.primary.state.scale)).toBe(fittedScale);
});

test("sidebar lifecycle keeps Fit visibility current without ResizeObserver delivery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.evaluate(() => {
    window.fixture.addSidebarLayoutFallbackViewer();
  });
  const root = page.locator("#sidebar-layout-fallback");
  const fit = root.locator(".pdf-fit-main-btn");
  const sidebar = root.locator(".pdf-sidebar");
  const fitVisibility = () => fit.evaluate(element => getComputedStyle(element).visibility);

  await expect(root).toHaveAttribute("data-status", "ready");
  await expect(sidebar).toHaveCSS("position", "relative");
  await expect.poll(fitVisibility).toBe("hidden");

  await root.getByRole("button", { name: "Document navigation" }).click();
  await expect.poll(fitVisibility).toBe("visible");

  await sidebar.getByRole("button", { name: "Close" }).click();
  await expect.poll(fitVisibility).toBe("hidden");
});

test("sidebar view switcher renders measured thumbnails and exposes overflow views", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  await expect(
    page.locator('#primary [role="region"][data-pdf-sidebar-view="thumbnails"]'),
  ).toHaveCSS("animation-name", "pdfjs-viewer-sidebar-panel-enter");
  const thumbnails = page.locator("#primary .pdf-thumbnail");
  await expect(thumbnails).toHaveCount(3);
  const firstCanvas = thumbnails.first().locator(".pdf-thumbnail-canvas");
  await expect
    .poll(() => firstCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);
  await expect(thumbnails.first()).toHaveAttribute("data-pdf-thumbnail-ready", "");
  await expect(firstCanvas).toHaveCSS("opacity", "1");
  await expect(firstCanvas).toHaveCSS("transition-duration", "0s");
  await expect(firstCanvas).toHaveCSS("transform", "none");
  const thumbnailTab = page.getByRole("button", { name: "Thumbnails" });
  await thumbnailTab.click();
  const selectedBackground = await thumbnailTab.evaluate(
    element => getComputedStyle(element).backgroundColor,
  );
  const inactiveBackground = await page
    .getByRole("button", { name: "Table of contents" })
    .evaluate(element => getComputedStyle(element).backgroundColor);
  expect(selectedBackground).not.toBe(inactiveBackground);
  await expect(page.locator("#primary .pdf-sidebar")).toHaveAttribute("data-open", "true");
  await thumbnailTab.press("Home");
  await expect(page.getByRole("button", { name: "Table of contents" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Table of contents" }).press("End");
  await expect(thumbnailTab).toHaveAttribute("aria-pressed", "true");
  const more = page.getByRole("button", { name: "More document views" });
  await more.press("ArrowDown");
  const attachmentsItem = page.getByRole("menuitemradio", { name: "Attachments" });
  await expect(attachmentsItem).toBeFocused();
  await attachmentsItem.press("Escape");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.press("ArrowDown");
  await attachmentsItem.press("Enter");
  await expect(more).toHaveAttribute("data-selected", "true");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await thumbnailTab.click();
  await thumbnails.nth(1).locator(".pdf-thumbnail-button").click();
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
});

test("directly bound sidebar views outside the sidebar follow selection and open state", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeExternalSidebarBindings())).resolves.toEqual(
    {
      outlineVisible: true,
      thumbnailsVisible: true,
      inactiveViewsHidden: true,
      bothHiddenWhenClosed: true,
    },
  );
});

test("viewer rotation invalidates and reorients thumbnail output", async ({ page }) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const canvas = page.locator("#primary .pdf-thumbnail-canvas").first();
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width))
    .toBeGreaterThan(0);
  const before = await canvas.evaluate(
    element => element.getBoundingClientRect().width / element.getBoundingClientRect().height,
  );
  await page.evaluate(() => window.fixture.primary.rotateBy(90));
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width))
    .toBeGreaterThan(0);
  const after = await canvas.evaluate(
    element => element.getBoundingClientRect().width / element.getBoundingClientRect().height,
  );
  expect(before).toBeLessThan(1);
  expect(after).toBeGreaterThan(1);
});

test("CSS thumbnail width changes retain usable output while replacement is pending", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator("#primary .pdf-thumbnails");
  const canvas = panel.locator(".pdf-thumbnail-canvas").first();
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width))
    .toBeGreaterThan(0);
  await panel.evaluate((element: HTMLElement) =>
    element.style.setProperty("--pdf-thumbnail-width", "220px"),
  );
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.clientWidth))
    .toBe(220);
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(220);
});

test("thumbnail reveal scrolls smoothly and inactive viewers hide managed canvases", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator("#primary .pdf-thumbnails");
  await panel.evaluate((element: HTMLElement) => {
    element.style.setProperty("--pdf-thumbnail-width", "220px");
    element.style.flex = "0 0 260px";
    element.style.height = "260px";
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((options: ScrollToOptions) => {
      element.dataset.observedScrollBehavior = options.behavior ?? "";
      scrollTo(options);
    }) as typeof element.scrollTo;
  });
  await page.evaluate(() => window.fixture.primary.navigateToPage(3));
  await expect.poll(() => panel.getAttribute("data-observed-scroll-behavior")).toBe("smooth");
  await page.evaluate(() => window.fixture.primary.setActive(false));
  await expect(
    page.locator('#primary .pdf-sidebar-panel[data-pdf-sidebar-view="thumbnails"]'),
  ).toBeHidden();
  await expect(panel.locator(".pdf-thumbnail-canvas").first()).toBeHidden();
  await page.evaluate(() => window.fixture.primary.setActive(true));
});

test("sidebar reveal motion is disabled and thumbnails stay untransformed for reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator('#primary [role="region"][data-pdf-sidebar-view="thumbnails"]');
  await expect(panel).toHaveCSS("animation-name", "none");
  const canvas = page.locator("#primary .pdf-thumbnail-canvas").first();
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width))
    .toBeGreaterThan(0);
  await expect(canvas).toHaveCSS("transition-duration", "0s");
  await expect(canvas).toHaveCSS("transform", "none");
  const scrollPanel = page.locator("#primary .pdf-thumbnails");
  await scrollPanel.evaluate((element: HTMLElement) => {
    element.style.setProperty("--pdf-thumbnail-width", "220px");
    element.style.flex = "0 0 260px";
    element.style.height = "260px";
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((options: ScrollToOptions) => {
      element.dataset.observedScrollBehavior = options.behavior ?? "";
      scrollTo(options);
    }) as typeof element.scrollTo;
  });
  await page.evaluate(() => window.fixture.primary.navigateToPage(3));
  await expect.poll(() => scrollPanel.getAttribute("data-observed-scroll-behavior")).toBe("auto");
});

test("opening thumbnails reveals navigation that happened while the sidebar was closed", async ({
  page,
}) => {
  const toggle = page.getByRole("button", { name: "Document navigation" });
  await toggle.click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator("#primary .pdf-thumbnails");
  await panel.evaluate((element: HTMLElement) => {
    element.style.setProperty("--pdf-thumbnail-width", "220px");
    element.style.maxHeight = "360px";
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((options: ScrollToOptions) => {
      element.dataset.observedScrollBehavior = options.behavior ?? "";
      scrollTo(options);
    }) as typeof element.scrollTo;
  });
  await toggle.click();
  await page.evaluate(() => window.fixture.primary.navigateToPage(3));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(3);
  await toggle.click();
  await expect.poll(() => panel.getAttribute("data-observed-scroll-behavior")).toBe("auto");
  const current = panel.locator(".pdf-thumbnail-current");
  await expect(current).toHaveCount(1);
  await expect
    .poll(() =>
      current.evaluate((item: HTMLElement) => {
        const viewport = item.closest<HTMLElement>(".pdf-thumbnails")!.getBoundingClientRect();
        const bounds = item.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
      }),
    )
    .toBe(true);
});

test("thumbnail reveal keeps a complete highlighted spread visible when it fits", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator("#primary .pdf-thumbnails");
  await page.evaluate(() => window.fixture.primary.setPageLayout("book"));
  await page.evaluate(() => window.fixture.primary.zoomTo(2));
  const items = panel.locator(".pdf-thumbnail");
  await expect(items).toHaveCount(3);
  const spreadHeight = await items.evaluateAll(entries => {
    const first = entries[1].getBoundingClientRect();
    const last = entries[2].getBoundingClientRect();
    return Math.ceil(last.bottom - first.top + 8);
  });
  await panel.evaluate((element: HTMLElement, height) => {
    element.style.flex = `0 0 ${height}px`;
    element.style.height = `${height}px`;
    element.scrollTop = 0;
  }, spreadHeight);
  await page.evaluate(() => window.fixture.primary.navigateToPage(2));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);
  const current = panel.locator(".pdf-thumbnail-current");
  await expect(current).toHaveCount(2);
  await expect
    .poll(() =>
      current.evaluateAll(entries => {
        const viewport = entries[0]
          .closest<HTMLElement>(".pdf-thumbnails")!
          .getBoundingClientRect();
        return entries.every(item => {
          const bounds = item.getBoundingClientRect();
          return bounds.top >= viewport.top - 0.5 && bounds.bottom <= viewport.bottom + 0.5;
        });
      }),
    )
    .toBe(true);
});

test("missing visible thumbnails preempt non-visible thumbnail work", async ({ page }) => {
  const result = await page.evaluate(() => window.fixture.probeThumbnailVisiblePreemption());
  expect(result).toMatchObject({
    cancelledOld: true,
    visibleStarted: true,
    firstReplacement: 3,
    placeholderVisibleBeforeSettlement: true,
    placeholderWidth: 0,
  });
});

test("manual thumbnail scrollbar movement is not undone by later geometry", async ({ page }) => {
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-page canvas")
        .evaluateAll(
          (canvases: HTMLCanvasElement[]) =>
            canvases.length === 3 && canvases.every(canvas => canvas.width > 0),
        ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator("#primary .pdf-thumbnails");
  await panel.evaluate((element: HTMLElement) => {
    element.style.setProperty("--pdf-thumbnail-width", "220px");
    element.style.flex = "0 0 260px";
    element.style.height = "260px";
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.scrollTop = element.scrollHeight;
    // WebKit does not reliably dispatch scroll for a script assignment in the synthetic driver.
    element.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() =>
      panel.evaluate(
        (element: HTMLElement) =>
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
  const lastCanvas = panel.locator(".pdf-thumbnail-canvas").last();
  await expect
    .poll(() => lastCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await expect
    .poll(() =>
      panel.evaluate(
        (element: HTMLElement) =>
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
});

test("thumbnail panel supports mouse fling and middle-mouse auto-scroll", async ({ page }) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await page.getByRole("button", { name: "Thumbnails" }).click();
  const panel = page.locator("#primary .pdf-thumbnails");
  await panel.evaluate((element: HTMLElement) => {
    element.style.setProperty("--pdf-thumbnail-width", "220px");
    element.style.maxHeight = "320px";
  });
  const box = await panel.boundingBox();
  if (!box) throw new Error("Missing thumbnail panel bounds");
  const currentPage = await page.evaluate(() => window.fixture.primary.state.currentPage);
  const thumbnailButton = panel.locator(".pdf-thumbnail-button").first();
  const thumbnailButtonBox = await thumbnailButton.boundingBox();
  if (!thumbnailButtonBox) throw new Error("Missing thumbnail button bounds");
  await page.mouse.move(
    thumbnailButtonBox.x + thumbnailButtonBox.width / 2,
    thumbnailButtonBox.y + 20,
  );
  await page.mouse.down();
  await expect(thumbnailButton).toHaveCSS("cursor", "grabbing");
  await page.mouse.up();
  await page.mouse.down({ button: "middle" });
  await expect(thumbnailButton).toHaveCSS("cursor", "all-scroll");
  await page.mouse.up({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => panel.evaluate((element: HTMLElement) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.currentPage))
    .toBe(currentPage);

  await panel.evaluate((element: HTMLElement) => {
    element.scrollTop = 0;
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 25, { steps: 2 });
  await page.waitForTimeout(100);
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(() => panel.evaluate((element: HTMLElement) => element.scrollTop))
    .toBeGreaterThan(0);
  const lastCanvas = panel.locator(".pdf-thumbnail-canvas").last();
  await expect
    .poll(() => lastCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      lastCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.clientWidth),
    )
    .toBeGreaterThanOrEqual(0.95);
});

test("outline panel supports mouse fling without selecting a destination", async ({ page }) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  const outline = page.locator("#primary .pdf-outline");
  await outline.evaluate((element: HTMLElement) => {
    element.style.flex = "0 0 120px";
    element.style.height = "120px";
    element.querySelector<HTMLElement>(".pdf-outline-list")!.style.minHeight = "500px";
    element.dataset.wheelProgrammaticScrolls = "0";
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((...args: Parameters<HTMLElement["scrollTo"]>) => {
      element.dataset.wheelProgrammaticScrolls = String(
        Number(element.dataset.wheelProgrammaticScrolls) + 1,
      );
      scrollTo(...args);
    }) as HTMLElement["scrollTo"];
  });
  await page.waitForTimeout(300);
  const box = await outline.boundingBox();
  if (!box) throw new Error("Missing outline bounds");
  const currentPage = await page.evaluate(() => window.fixture.primary.state.currentPage);
  const outlineButton = outline.locator(".pdf-outline-link").first();
  const outlineButtonBox = await outlineButton.boundingBox();
  if (!outlineButtonBox) throw new Error("Missing outline button bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => outline.evaluate((element: HTMLElement) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(outline).toHaveAttribute("data-wheel-programmatic-scrolls", "0");
  await outline.evaluate((element: HTMLElement) => {
    element.scrollTop = 0;
  });
  await page.mouse.move(
    outlineButtonBox.x + outlineButtonBox.width / 2,
    outlineButtonBox.y + outlineButtonBox.height / 2,
  );
  await page.mouse.down();
  await expect(outlineButton).toHaveCSS("cursor", "grabbing");
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => outline.evaluate((element: HTMLElement) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.currentPage))
    .toBe(currentPage);
});

test("document scrolling reveals a newly active outline item without pinning manual outline scrolling", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Document navigation" }).click();
  await expect(page.locator("#primary .pdf-outline-list")).toBeAttached();
  const outline = page.locator("#primary .pdf-outline");
  await page.evaluate(async () => {
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    const outline = document.querySelector<HTMLElement>("#primary .pdf-outline");
    const pageTwo = container?.querySelector<HTMLElement>('.pdf-page[data-page="2"]');
    if (!container || !outline || !pageTwo)
      throw new Error("Missing outline scrolling fixture elements");

    outline.style.flex = "none";
    outline.style.height = "1px";
    outline.style.overflowY = "auto";
    outline.style.scrollBehavior = "smooth";
    const scrollTo = outline.scrollTo.bind(outline);
    outline.scrollTo = ((options: ScrollToOptions) => {
      outline.dataset.observedScrollBehavior = options.behavior ?? "";
      if (options.behavior === "auto") {
        outline.dataset.pointerTakeoverTop = String(options.top);
      }
      scrollTo(options);
    }) as typeof outline.scrollTo;
    container.scrollTop = 0;
    container.dispatchEvent(new Event("scroll"));
    container.scrollTop = pageTwo.offsetTop + 2;
    container.dispatchEvent(new Event("scroll"));
  });

  await expect.poll(() => outline.getAttribute("data-observed-scroll-behavior")).toBe("smooth");
  await expect
    .poll(() => outline.evaluate((element: HTMLElement) => element.scrollTop))
    .toBeGreaterThan(0);

  await outline.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
  await expect.poll(() => outline.getAttribute("data-observed-scroll-behavior")).toBe("auto");
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      outline.evaluate(element => {
        const requested = Number((element as HTMLElement).dataset.pointerTakeoverTop);
        const maximum = Math.max(
          0,
          (element as HTMLElement).scrollHeight - (element as HTMLElement).clientHeight,
        );
        return Math.abs(
          Math.max(0, Math.min(requested, maximum)) - (element as HTMLElement).scrollTop,
        );
      }),
    )
    .toBeLessThan(0.01);
  await expect
    .poll(() => outline.evaluate((element: HTMLElement) => element.style.scrollBehavior))
    .toBe("smooth");

  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    const outline = document.querySelector<HTMLElement>("#primary .pdf-outline");
    if (!container || !outline) throw new Error("Missing outline scrolling fixture elements");
    outline.scrollTop = 0;
    container.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  await expect(outline).toHaveJSProperty("scrollTop", 0);
});

test("outline reveal respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Document navigation" }).click();
  const outline = page.locator("#primary .pdf-outline");
  await outline.evaluate((element: HTMLElement) => {
    element.style.flex = "none";
    element.style.height = "1px";
    element.style.overflowY = "auto";
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((options: ScrollToOptions) => {
      element.dataset.observedScrollBehavior = options.behavior ?? "";
      scrollTo(options);
    }) as typeof element.scrollTo;
  });

  await page.evaluate(() => window.fixture.primary.navigateToPage(2));
  await expect.poll(() => outline.getAttribute("data-observed-scroll-behavior")).toBe("auto");
});

test("opening the outline reveals the active item selected while it was hidden", async ({
  page,
}) => {
  const viewport = page.locator("#primary .pdf-container");
  const outline = page.locator("#primary .pdf-outline");
  await outline.evaluate((element: HTMLElement) => {
    element.style.flex = "none";
    element.style.height = "40px";
    element.style.padding = "0";
    element.style.overflowY = "auto";
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((options: ScrollToOptions) => {
      element.dataset.observedScrollBehavior = options.behavior ?? "";
      scrollTo(options);
    }) as typeof element.scrollTo;
  });
  await viewport.evaluate((container: HTMLElement) => {
    const pageTwo = container.querySelector<HTMLElement>('.pdf-page[data-page="2"]');
    if (!pageTwo) throw new Error("Missing second page");
    container.scrollTop = pageTwo.offsetTop + 2;
    container.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);

  await page.getByRole("button", { name: "Document navigation" }).click();
  await outline.dispatchEvent("scroll");
  await expect.poll(() => outline.getAttribute("data-observed-scroll-behavior")).toBe("auto");
  await expect
    .poll(() =>
      outline.evaluate((element: HTMLElement) => {
        const active = element.querySelector<HTMLElement>(".pdf-outline-link.pdf-outline-current");
        if (!active) return false;
        const viewport = element.getBoundingClientRect();
        const link = active.getBoundingClientRect();
        return link.top >= viewport.top && link.bottom <= viewport.top + element.clientHeight;
      }),
    )
    .toBe(true);
});

test("overlay sidebar closes on an outside document click without a backdrop", async ({ page }) => {
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.locator("#primary").evaluate(element => {
    element.style.width = "600px";
  });
  const outline = page.locator("#primary .pdf-sidebar");
  await page.getByRole("button", { name: "Document navigation" }).click();
  await expect(outline).toHaveAttribute("data-open", "true");

  await page.locator("#primary .pdf-container").click({ position: { x: 500, y: 100 } });
  await expect(outline).toHaveAttribute("data-open", "false");
});

test("touch swipes close the sidebar only toward its logical origin", async ({ page }) => {
  const root = page.locator("#primary");
  const sidebar = root.locator(".pdf-sidebar");
  const toggle = page.getByRole("button", { name: "Document navigation" });
  const swipe = async (startX: number, startY: number, endX: number, endY: number) => {
    await sidebar.evaluate(
      (element, points) => {
        const options = {
          bubbles: true,
          cancelable: true,
          pointerId: 41,
          pointerType: "touch",
          isPrimary: true,
        };
        element.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...options,
            clientX: points.startX,
            clientY: points.startY,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            ...options,
            clientX: points.endX,
            clientY: points.endY,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            ...options,
            clientX: points.endX,
            clientY: points.endY,
          }),
        );
      },
      { startX, startY, endX, endY },
    );
  };

  await toggle.click();
  await expect(sidebar).toHaveCSS("touch-action", "pan-y");
  await swipe(120, 100, 210, 105);
  await expect(sidebar).toHaveAttribute("data-open", "true");
  await swipe(180, 100, 170, 190);
  await expect(sidebar).toHaveAttribute("data-open", "true");
  await swipe(180, 100, 100, 105);
  await expect(sidebar).toHaveAttribute("data-open", "false");

  await root.evaluate(element => {
    element.style.width = "600px";
    element.setAttribute("dir", "rtl");
    element.querySelector<HTMLElement>(".pdf-sidebar")!.style.direction = "rtl";
  });
  await toggle.click();
  await expect(sidebar).toHaveCSS("position", "absolute");
  await expect(sidebar).toHaveCSS("direction", "rtl");
  await swipe(180, 100, 100, 105);
  await expect(sidebar).toHaveAttribute("data-open", "true");
  await swipe(100, 100, 180, 105);
  await expect(sidebar).toHaveAttribute("data-open", "false");
});

test("explicit sidebar interaction modes override responsive CSS detection", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeSidebarBehavior("overlay"))).resolves.toBe(
    false,
  );
  await expect(
    page.evaluate(() => window.fixture.probeSidebarBehavior("persistent")),
  ).resolves.toBe(true);
});

test("diagnostics estimate viewer-managed raster memory across zoom changes", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "canvas-memory-estimate" &&
            entry.details?.reason === "initial-render-ready" &&
            Number(entry.details.estimatedBytes) > 0,
        ),
      ),
    )
    .toBe(true);

  const { estimate, devicePixelRatio } = await page.evaluate(() => ({
    estimate: window.fixture.logs.find(
      entry =>
        entry.event === "canvas-memory-estimate" &&
        entry.details?.reason === "initial-render-ready",
    ),
    devicePixelRatio: window.devicePixelRatio,
  }));
  expect(estimate?.details).toMatchObject({
    estimateScope: "viewer-managed-raster-backing-stores-and-reservations",
    bytesPerPixelAssumption: 4,
    devicePixelRatio,
    maxCanvasPixels: 24_000_000,
    maxCanvasDimension: 8192,
    dprReducedByMemoryLimit: false,
    dprReducedByCanvasLimit: false,
    directRenderingPlanned: true,
  });
  expect(Number(estimate?.details?.activeOffscreenBufferCount)).toBeGreaterThanOrEqual(0);
  expect(Number(estimate?.details?.reservedBytes)).toBeGreaterThanOrEqual(0);
  expect(Number(estimate?.details?.renderedPageCount)).toBe(
    Number(estimate?.details?.attachedCanvasCount),
  );
  expect(typeof estimate?.details?.visibleDprReduced).toBe("boolean");
  expect(typeof estimate?.details?.concurrencyReduced).toBe("boolean");
  expect(Array.isArray(estimate?.details?.admittedRowIndexes)).toBe(true);
  expect(Array.isArray(estimate?.details?.plannedDirectRenderPages)).toBe(true);
  expect(Number(estimate?.details?.estimatedPlanPeakHeadroomBytes)).toBeGreaterThanOrEqual(0);
  expect(Number(estimate?.details?.effectiveMaxConcurrentRenders)).toBeGreaterThanOrEqual(1);
  const initialRerenderCount = await page.evaluate(
    () =>
      window.fixture.logs.filter(
        entry =>
          entry.event === "page-render-completed" && entry.details?.replacedExistingBitmap === true,
      ).length,
  );
  await page.locator("#primary .pdf-container").evaluate((container: HTMLElement) => {
    container.scrollTop += 200;
  });
  await page.waitForTimeout(250);
  const redundantRerenders = await page.evaluate(
    initialCount =>
      window.fixture.logs
        .filter(
          entry =>
            entry.event === "page-render-completed" &&
            entry.details?.replacedExistingBitmap === true,
        )
        .slice(initialCount)
        .filter(
          entry =>
            entry.details?.previousDpr === entry.details?.dpr &&
            entry.details?.previousScale === entry.details?.scale,
        ),
    initialRerenderCount,
  );
  expect(redundantRerenders).toEqual([]);
});

test("stationary planner admits whole rows within viewport-height and memory bounds", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "canvas-memory-estimate" &&
            Array.isArray(entry.details?.admittedRowIndexes),
        ),
      ),
    )
    .toBe(true);

  const details = await page.evaluate(
    () =>
      window.fixture.logs.find(
        entry =>
          entry.event === "canvas-memory-estimate" &&
          entry.details?.reason === "initial-render-ready",
      )?.details,
  );
  const rows = details?.admittedRowIndexes as number[];
  expect(rows.length).toBeLessThanOrEqual(
    Number(details?.effectiveBufferRowsBefore) + Number(details?.effectiveBufferRowsAfter),
  );
  expect(Number(details?.effectiveBufferViewportHeightsBefore)).toBeGreaterThanOrEqual(0);
  expect(Number(details?.effectiveBufferViewportHeightsAfter)).toBeGreaterThanOrEqual(0);
  expect(Number(details?.effectiveBufferPageCount)).toBeLessThanOrEqual(
    Number(details?.maxBufferPages),
  );
  expect(Number(details?.estimatedPlanPeakBytes)).toBeLessThanOrEqual(
    Number(details?.memoryLimitMiB) * 1024 * 1024,
  );
  expect(Number(details?.emergencyVisibleOverageBytes)).toBe(0);
});

test("fast navigation moves an already queued visible page ahead of unlimited speculative work", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.addQueuePriorityViewer());
  await expect(page.locator("#queue-priority .pdf-page-count")).toHaveText("40");

  await page.evaluate(() => {
    const viewer = (window as Window & { queuePriorityViewer?: typeof window.fixture.primary })
      .queuePriorityViewer;
    if (!viewer) throw new Error("Missing queue-priority viewer");
    window.fixture.logs.length = 0;
    viewer.navigateToPage(40);
  });

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.viewerId === "queue-priority" &&
            entry.event === "page-render-started" &&
            entry.details?.pageNo === 40,
        ),
      ),
    )
    .toBe(true);
  const starts = await page.evaluate(() =>
    window.fixture.logs
      .filter(entry => entry.viewerId === "queue-priority" && entry.event === "page-render-started")
      .map(entry => Number(entry.details?.pageNo)),
  );
  expect(starts.indexOf(40)).toBeLessThanOrEqual(3);
  await expect
    .poll(() =>
      page
        .locator("#queue-priority .pdf-page canvas")
        .nth(39)
        .evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0),
    )
    .toBe(true);
});

test("stale text completion is finalized for current search demand without zoom", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.addQueuePriorityViewer());
  const root = page.locator("#queue-priority");
  await expect(root.locator(".pdf-page-count")).toHaveText("40");
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("Queue fixture");
  await expect(root.locator(".pdf-search-count")).toHaveText(/1\/40/);
  await expect(
    root.locator('.pdf-page[data-page="1"] .pdf-search-highlight-current'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.viewerId === "queue-priority" && entry.details?.reason === "initial-render-ready",
        ),
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const viewer = (window as Window & { queuePriorityViewer?: typeof window.fixture.primary })
      .queuePriorityViewer;
    if (!viewer) throw new Error("Missing queue-priority viewer");
    viewer.navigateToPage(20);
  });
  for (const pageNo of [19, 20, 21]) {
    await expect(root.locator(`.pdf-page[data-page="${pageNo}"] .pdf-text-layer`)).toBeAttached();
    await expect(
      root.locator(`.pdf-page[data-page="${pageNo}"] .pdf-search-highlight`),
    ).toBeVisible({ timeout: 10_000 });
  }
});

test("transient zoom restores a distant-page anchor before publishing its render plan", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.addQueuePriorityViewer());
  await expect(page.locator("#queue-priority .pdf-page-count")).toHaveText("40");
  await page.evaluate(() => {
    const viewer = (window as Window & { queuePriorityViewer?: typeof window.fixture.primary })
      .queuePriorityViewer;
    if (!viewer) throw new Error("Missing queue-priority viewer");
    viewer.zoomTo(3.01049);
    viewer.navigateToPage(40);
  });
  await expect
    .poll(() =>
      page
        .locator("#queue-priority .pdf-page canvas")
        .nth(39)
        .evaluate((canvas: HTMLCanvasElement) => canvas.width > 0),
    )
    .toBe(true);

  await page.evaluate(() => {
    window.fixture.logs.length = 0;
  });
  await page.locator("#queue-priority .pdf-container").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewer = (window as Window & { queuePriorityViewer?: typeof window.fixture.primary })
          .queuePriorityViewer;
        return viewer?.state.scale;
      }),
    )
    .toBeGreaterThan(3.1);
  const committedScale = await page.evaluate(() => {
    const viewer = (window as Window & { queuePriorityViewer?: typeof window.fixture.primary })
      .queuePriorityViewer;
    return viewer?.state.scale;
  });
  await expect
    .poll(() =>
      page.evaluate(
        expectedScale =>
          window.fixture.logs.some(
            entry =>
              entry.viewerId === "queue-priority" &&
              entry.event === "page-render-started" &&
              entry.details?.scale === expectedScale,
          ),
        committedScale,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        expectedScale =>
          window.fixture.logs.some(
            entry =>
              entry.viewerId === "queue-priority" &&
              entry.event === "page-render-completed" &&
              entry.details?.pageNo === 40 &&
              entry.details?.scale === expectedScale,
          ),
        committedScale,
      ),
    )
    .toBe(true);

  const lifecycle = await page.evaluate(
    scale => ({
      starts: window.fixture.logs
        .filter(
          entry =>
            entry.viewerId === "queue-priority" &&
            entry.event === "page-render-started" &&
            entry.details?.scale === scale,
        )
        .map(entry => ({
          operationId: Number(entry.details?.operationId),
          pageNo: Number(entry.details?.pageNo),
          visible: entry.details?.visible === true,
        })),
      completions: window.fixture.logs
        .filter(
          entry =>
            entry.viewerId === "queue-priority" &&
            entry.event === "page-render-completed" &&
            entry.details?.scale === scale,
        )
        .map(entry => ({
          operationId: Number(entry.details?.operationId),
          pageNo: Number(entry.details?.pageNo),
        })),
    }),
    committedScale,
  );
  const { starts, completions } = lifecycle;
  expect(starts.filter(entry => entry.visible).every(entry => entry.pageNo >= 39)).toBe(true);
  const pageStarts = starts.filter(entry => entry.pageNo === 40);
  const pageCompletions = completions.filter(entry => entry.pageNo === 40);
  expect(pageStarts).toHaveLength(1);
  expect(pageCompletions).toEqual([{ operationId: pageStarts[0]?.operationId, pageNo: 40 }]);
});

test("Fit sizes unseen page surfaces before distant navigation", async ({ page }) => {
  await page.evaluate(() => window.fixture.addFitUnseenViewer());
  await expect(page.locator("#fit-unseen .pdf-page-count")).toHaveText("40");
  const distantCanvas = page.locator("#fit-unseen .pdf-page canvas").nth(39);
  await expect
    .poll(() => distantCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBe(0);

  await page.evaluate(async () => {
    const viewer = (window as Window & { fitUnseenViewer?: typeof window.fixture.primary })
      .fitUnseenViewer;
    if (!viewer) throw new Error("Missing fit-unseen viewer");
    viewer.zoomTo(2);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewer = (window as Window & { fitUnseenViewer?: typeof window.fixture.primary })
          .fitUnseenViewer;
        return viewer?.state.scale;
      }),
    )
    .toBe(2);
  const distantPage = distantCanvas.locator("..");
  const explicitZoomWidth = await distantPage.evaluate((pageEl: HTMLElement) => pageEl.style.width);
  await page.locator("#fit-unseen .pdf-fit-main-btn").click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewer = (window as Window & { fitUnseenViewer?: typeof window.fixture.primary })
          .fitUnseenViewer;
        return viewer?.state.scale;
      }),
    )
    .not.toBe(2);
  await expect
    .poll(() => distantPage.evaluate((pageEl: HTMLElement) => pageEl.style.width))
    .not.toBe(explicitZoomWidth);
  await page.evaluate(() => {
    window.fixture.logs.length = 0;
    const viewer = (window as Window & { fitUnseenViewer?: typeof window.fixture.primary })
      .fitUnseenViewer;
    if (!viewer) throw new Error("Missing fit-unseen viewer");
    const fit = document.querySelector<HTMLElement>("#fit-unseen .pdf-fit-main-btn");
    if (!fit) throw new Error("Missing fit-unseen Fit control");
    const record = {
      samples: [getComputedStyle(fit).visibility],
      observer: null as MutationObserver | null,
    };
    record.observer = new MutationObserver(() =>
      record.samples.push(getComputedStyle(fit).visibility),
    );
    record.observer.observe(fit, { attributes: true, attributeFilter: ["style"] });
    (window as Window & { fitVisibilityRecord?: typeof record }).fitVisibilityRecord = record;
    viewer.navigateToPage(40);
  });

  await expect
    .poll(() => distantCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.viewerId === "fit-unseen" &&
            entry.event === "page-render-completed" &&
            entry.details?.pageNo === 40,
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        window.fixture.logs.filter(
          entry =>
            entry.viewerId === "fit-unseen" &&
            entry.event === "page-render-started" &&
            entry.details?.pageNo === 40,
        ).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() => {
      const record = (
        window as Window & {
          fitVisibilityRecord?: { samples: string[]; observer: MutationObserver | null };
        }
      ).fitVisibilityRecord;
      record?.observer?.disconnect();
      return record?.samples;
    }),
  ).not.toContain("visible");
});

test("inactive viewers reduce their render window and restore it when active", async ({ page }) => {
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-page canvas")
        .evaluateAll(
          canvases =>
            canvases.filter(
              canvas =>
                (canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0,
            ).length,
        ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => window.fixture.primary.setActive(false));
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "view-deactivated" &&
            entry.details?.maxBufferViewportHeights === 0 &&
            entry.details?.maxBufferPages === 0 &&
            entry.details?.queuedPageCount === 0,
        ),
      ),
    )
    .toBe(true);

  await expect
    .poll(() =>
      page.locator("#primary .pdf-container").evaluate(container => {
        const viewport = container.getBoundingClientRect();
        return [...container.querySelectorAll<HTMLElement>(".pdf-row")].every(row => {
          const rect = row.getBoundingClientRect();
          const visible = rect.bottom >= viewport.top && rect.top <= viewport.bottom;
          const rendered = [...row.querySelectorAll<HTMLCanvasElement>("canvas")].some(
            canvas => canvas.width > 0 && canvas.height > 0,
          );
          return visible === rendered;
        });
      }),
    )
    .toBe(true);

  await page.evaluate(() => window.fixture.primary.setActive(true));
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "view-activated" &&
            entry.details?.maxBufferViewportHeights === 16 &&
            entry.details?.maxBufferPages === 512,
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-page canvas")
        .evaluateAll(
          canvases =>
            canvases.filter(
              canvas =>
                (canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0,
            ).length,
        ),
    )
    .toBeGreaterThan(0);
});

test("hidden owner documents reduce rendering without changing host activity", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        search: window.fixture.primary.state.searchPreparation,
        outline: window.fixture.primary.state.outlinePreparation,
        attachments: window.fixture.primary.state.attachmentsPreparation,
      })),
    )
    .toEqual({ search: "ready", outline: "ready", attachments: "ready" });

  const stateChangesBefore = await page.evaluate(() => window.fixture.states.length);
  await page.evaluate(() => {
    const target = window as Window & { fixtureVisibilityDescriptor?: PropertyDescriptor };
    target.fixtureVisibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
        const viewport = container.getBoundingClientRect();
        return [...container.querySelectorAll<HTMLElement>(".pdf-row")].every(row => {
          const rect = row.getBoundingClientRect();
          const visible = rect.bottom >= viewport.top && rect.top <= viewport.bottom;
          const rendered = [...row.querySelectorAll<HTMLCanvasElement>("canvas")].some(
            canvas => canvas.width > 0 && canvas.height > 0,
          );
          return visible === rendered;
        });
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.fixture.primary.state.active)).toBe(true);
  expect(await page.evaluate(() => window.fixture.states.length)).toBe(stateChangesBefore);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "document-visibility-changed" &&
            entry.details?.visibilityState === "hidden" &&
            entry.details?.hostActive === true &&
            entry.details?.renderingActive === false &&
            entry.details?.maxBufferViewportHeights === 0 &&
            entry.details?.maxBufferPages === 0,
        ),
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const target = window as Window & { fixtureVisibilityDescriptor?: PropertyDescriptor };
    if (target.fixtureVisibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", target.fixtureVisibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    delete target.fixtureVisibilityDescriptor;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "document-visibility-changed" &&
            entry.details?.visibilityState === "visible" &&
            entry.details?.renderingActive === true &&
            entry.details?.maxBufferViewportHeights === 16 &&
            entry.details?.maxBufferPages === 512,
        ),
      ),
    )
    .toBe(true);

  const optOut = await page.evaluate(() => window.fixture.probeDocumentVisibilityOptOut());
  expect(optOut).toMatchObject({ active: true, visibilityDiagnostic: false });
  expect(optOut.after).toBe(optOut.before);
});

test("partial rendering-profile overrides merge with defaults and reject invalid limits", async ({
  page,
}) => {
  await expect
    .poll(() => page.evaluate(() => window.fixture.probePerformanceOverrides()))
    .toEqual({
      applied: true,
      invalidRejected: true,
      invalidCanvasPixelsRejected: true,
      invalidCanvasDimensionRejected: true,
      invalidBufferViewportHeightsRejected: true,
      invalidBufferPagesRejected: true,
      invalidInactiveBufferRejected: true,
    });
});

test("container resize restores viewport-height buffering without forcing Fit", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeViewportBufferResize());
  expect(result.before).toBe(1);
  expect(result.after).toBeGreaterThan(result.before);
});

test("initial progress clears after normal and cache-bypassing loads", async ({ page }) => {
  await expect(page.locator("#primary .pdf-document-progress")).toHaveAttribute(
    "data-phase",
    "render",
  );
  const progress = page.locator("#primary .pdf-document-progress");

  await expect(progress).not.toHaveClass(/pdf-document-progress--visible/, { timeout: 2_000 });
  await expect(progress).toHaveJSProperty("value", 0);

  await page.setExtraHTTPHeaders({
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  });
  await page.goto(`/?cache-bust=${Date.now()}`);
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await expect(progress).not.toHaveClass(/pdf-document-progress--visible/, { timeout: 2_000 });
  await expect(progress).toHaveJSProperty("value", 0);
});

test("replacement progress ignores delayed callbacks from the previous document", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeProgressReplacement())).resolves.toBe(true);
});

test("rendering progress remains hidden after the initial document render", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeLaterRenderProgress())).resolves.toBe(false);
});

test("viewer-scoped keyboard input and reduced-motion navigation work", async ({ page }) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await viewport.focus();
  await page.keyboard.press("PageDown");
  await expect(page.locator(".pdf-page-number-input")).toHaveValue("2");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const result = await page.evaluate(() =>
    window.fixture.primary.navigateToPdfNamedDestination("section:two", {
      spotWithinPage: true,
      smooth: true,
    }),
  );
  expect(result).toMatchObject({ ok: true, page: 2 });

  const reducedMotionPageInput = await page.evaluate(() => {
    const viewer = window.fixture.primary;
    const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
    const input = document.querySelector<HTMLInputElement>("#primary .pdf-page-number-input")!;
    viewer.navigateToPage(1);
    input.value = "3";
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const pageThree = container.querySelector<HTMLElement>('.pdf-page[data-page="3"]')!;
    return {
      actual: container.scrollTop,
      expected: Math.min(
        pageThree.parentElement!.offsetTop,
        container.scrollHeight - container.clientHeight,
      ),
    };
  });
  expect(reducedMotionPageInput.actual).toBeCloseTo(reducedMotionPageInput.expected, 0);
});

test("search panel restores focus and exposes live result status", async ({ page }) => {
  const searchButton = page.getByRole("button", { name: "Search" });
  const searchPanel = page.locator(".pdf-search-panel");
  await expect(searchPanel).toHaveAttribute("data-open", "false");
  await searchButton.click();
  await expect(searchPanel).toHaveAttribute("data-open", "true");
  const searchInput = page.getByRole("searchbox", { name: "Search" });
  await expect(searchInput).toBeFocused();
  await expect(page.locator(".pdf-search-count")).toHaveAttribute("aria-live", "polite");
  await searchInput.fill("page");
  await expect(page.locator(".pdf-search-count")).not.toHaveText("0 / 0");
  await page.keyboard.press("Escape");
  await expect(searchPanel).toHaveAttribute("data-open", "false");
  await expect(searchButton).toBeFocused();
  await expect(searchPanel.locator(".pdf-search-input")).toHaveValue("");
  await expect(page.locator(".pdf-search-count")).toBeEmpty();
  await expect(page.locator(".pdf-search-highlight")).toHaveCount(0);
});

test("search UI reports zero results without retaining highlights", async ({ page }) => {
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("no matching fixture text");
  await expect(page.locator("#primary .pdf-search-count")).toHaveText("0");
  await expect(page.locator("#primary .pdf-search-highlight")).toHaveCount(0);
});

test("search matches and highlights one logical result across PDF.js text items", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.primary.search("CrossBoundary"));
  expect(result).toEqual({
    ok: true,
    query: "CrossBoundary",
    matches: [
      {
        page: 1,
        segments: [
          { text: "Cross", characterIndex: 0, length: 5 },
          { text: "Boundary", characterIndex: 0, length: 8 },
        ],
      },
    ],
  });

  const root = page.locator("#primary");
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("CrossBoundary");
  await expect(root.locator(".pdf-search-count")).toHaveText("1/1");
  await expect(root.locator('.pdf-page[data-page="1"] .pdf-search-highlight-current')).toHaveCount(
    2,
  );
});

test("menu popover announces state and restores focus after Escape", async ({ page }) => {
  const menuButton = page.getByRole("button", { name: "PDF options" });
  const menu = page.locator(".pdf-menu-panel");
  await expect(menu).toHaveAttribute("data-open", "false");
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toHaveAttribute("data-open", "true");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toHaveAttribute("data-open", "false");
  await expect(menuButton).toBeFocused();
});

test("menu retention restores the exact managed selection when it closes", async ({ page }) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator(".pdf-text-layer span").first()).toBeAttached();
  const selected = await page.evaluate(() => {
    const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing managed text node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 1, node, Math.min(12, node.textContent?.length ?? 0));
    return document.getSelection()?.toString() ?? "";
  });
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  await root.locator(".pdf-menu-toggle-btn").click();
  await expect(root.locator(".pdf-menu-panel")).toHaveAttribute("data-open", "true");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selected);
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
});

test("external host selection cancels retained PDF restoration", async ({ page }) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator(".pdf-text-layer span").first()).toBeAttached();
  await page.evaluate(() => {
    const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing managed text node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 1, node, Math.min(10, node.textContent?.length ?? 0));
  });
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  await root.locator(".pdf-search-toggle-btn").click();
  await expect(root.locator(".pdf-search-input")).toBeFocused();
  const hostText = await page.evaluate(() => {
    const marker = document.createElement("div");
    marker.id = "host-selection-marker";
    marker.textContent = "ordinary host selection";
    document.body.append(marker);
    const node = marker.firstChild!;
    document.getSelection()?.setBaseAndExtent(node, 0, node, node.textContent?.length ?? 0);
    return marker.textContent;
  });
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(hostText);
  await expect(root.locator(".pdf-text-selection-highlight")).toHaveCount(0);
  await page.evaluate(() =>
    document.querySelector<HTMLElement>("#primary .pdf-search-close-btn")?.click(),
  );
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(hostText);
  await expect(root.locator(".pdf-text-selection-highlight")).toHaveCount(0);
});

test("external collapsed input focus cancels toolbar retention", async ({ page }) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator(".pdf-text-layer span").first()).toBeAttached();
  await page.evaluate(() => {
    const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing managed text node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 1, node, Math.min(10, node.textContent?.length ?? 0));
  });
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  await root.locator(".pdf-menu-toggle-btn").click();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "external-caret-input";
    input.value = "external caret";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(4, 4);
    document.querySelector<HTMLElement>("#primary .pdf-menu-toggle-btn")?.click();
  });
  await expect(root.locator(".pdf-text-selection-highlight")).toHaveCount(0);
  await expect(page.locator("#external-caret-input")).toBeFocused();
  expect(
    await page
      .locator("#external-caret-input")
      .evaluate(input => (input as HTMLInputElement).selectionStart),
  ).toBe(4);
});

test("search matches render visible highlights above the page canvas", async ({ page }) => {
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("Fixture");
  await expect(page.locator(".pdf-search-count")).toHaveText(/1\/3/);

  const highlight = page.locator(".pdf-highlight-layer > div").first();
  await expect(highlight).toBeVisible();
  const stacking = await page
    .locator(".pdf-page")
    .first()
    .evaluate(pageEl => {
      const canvas = pageEl.querySelector("canvas");
      const layer = pageEl.querySelector<HTMLElement>(".pdf-highlight-layer");
      if (!canvas || !layer) throw new Error("Missing canvas or search highlight layer");
      return {
        canvas: Number.parseInt(getComputedStyle(canvas).zIndex, 10),
        highlight: Number.parseInt(getComputedStyle(layer).zIndex, 10),
      };
    });
  expect(stacking.highlight).toBeGreaterThan(stacking.canvas);
});

test("active search navigation presents the highlight before viewport demand settles", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.zoomTo(0.25));
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("Fixture");
  await expect(root.locator(".pdf-search-count")).toHaveText(/1\/3/);

  await root.locator(".pdf-search-next-btn").click();
  await expect(root.locator(".pdf-search-count")).toHaveText(/2\/3/);
  await expect(
    root.locator('.pdf-page[data-page="2"] .pdf-search-highlight-current'),
  ).toBeVisible();

  await root.locator(".pdf-search-next-btn").click();
  await expect(root.locator(".pdf-search-count")).toHaveText(/3\/3/);
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-search-highlight-current'),
  ).toBeVisible();
});

test("search retries highlight geometry after a newly attached text layer receives layout", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.zoomTo(0.25);
    const original = Range.prototype.getClientRects;
    let suppressPageThreeOnce = true;
    Range.prototype.getClientRects = function () {
      const element =
        this.commonAncestorContainer instanceof Element
          ? this.commonAncestorContainer
          : this.commonAncestorContainer.parentElement;
      if (suppressPageThreeOnce && element?.closest('.pdf-page[data-page="3"]')) {
        suppressPageThreeOnce = false;
        return [] as unknown as DOMRectList;
      }
      const rects = original.call(this);
      if (!suppressPageThreeOnce) Range.prototype.getClientRects = original;
      return rects;
    };
  });
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("page 3");
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-search-highlight-current'),
  ).toBeVisible();
});

test("search geometry resumes when its post-layout pass overlaps zoom suspension", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeSearchGeometryZoomResume());
  expect(result.missingWhileSuspended).toBe(true);
  expect(result.restoredAfterResume).toBe(true);
  expect(result.width).toBeGreaterThan(0);
});

test("real mouse input selects PDF text and paints the exact mirrored range", async ({ page }) => {
  const root = page.locator("#primary");
  const toggle = root.locator(".pdf-text-selection-toggle-btn");
  await root.locator(".pdf-menu-toggle-btn").click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const text = root.locator('.pdf-text-layer span[role="presentation"]').first();
  await expect(text).toBeVisible();
  const textTransform = await text.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      transform: style.transform,
      rotate: style.getPropertyValue("--rotate").trim(),
      scaleX: style.getPropertyValue("--scale-x").trim(),
      inlineRotate: (element as HTMLElement).style.getPropertyValue("--rotate"),
    };
  });
  expect(textTransform.inlineRotate).toBe("");
  expect(textTransform.rotate).toBe("0deg");
  expect(Number(textTransform.scaleX)).toBeGreaterThan(0);
  expect(textTransform.transform).not.toBe("none");
  const box = await text.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + Math.max(2, box.width * 0.1), y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(8, box.width * 0.7), y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .not.toBe("");
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  await expect(root.locator(".pdf-text-layer").first()).toHaveCSS("opacity", "0");

  const expectMirrorMatchesNativeRange = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const selection = document.getSelection();
          const rangeRect = selection?.rangeCount
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
          const mirrorRect = document
            .querySelector(".pdf-text-selection-highlight")
            ?.getBoundingClientRect();
          if (!rangeRect || !mirrorRect) return Number.POSITIVE_INFINITY;
          return Math.max(
            Math.abs(rangeRect.left - mirrorRect.left),
            Math.abs(rangeRect.top - mirrorRect.top),
            Math.abs(rangeRect.right - mirrorRect.right),
            Math.abs(rangeRect.bottom - mirrorRect.bottom),
          );
        }),
      )
      .toBeLessThan(1.1);
  };
  await expectMirrorMatchesNativeRange();

  const selectedText = await page.evaluate(() => document.getSelection()?.toString() ?? "");
  const viewport = root.locator(".pdf-container");
  await viewport.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: box.x + 20,
    clientY: y,
  });
  await viewport.dispatchEvent("pointerdown", {
    pointerId: 42,
    pointerType: "touch",
    clientX: box.x + 120,
    clientY: y,
  });
  await expect(viewport).toHaveClass(/pdf-pinch-active/);
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  expect(await page.evaluate(() => document.getSelection()?.rangeCount)).toBe(0);
  await viewport.dispatchEvent("pointermove", {
    pointerId: 42,
    pointerType: "touch",
    clientX: box.x + 145,
    clientY: y,
  });
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  await viewport.dispatchEvent("pointerup", {
    pointerId: 42,
    pointerType: "touch",
    clientX: box.x + 145,
    clientY: y,
    bubbles: true,
  });
  await expect(viewport).not.toHaveClass(/pdf-pinch-active/);
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selectedText);
  await viewport.dispatchEvent("pointercancel", {
    pointerId: 41,
    pointerType: "touch",
    clientX: box.x + 20,
    clientY: y,
    bubbles: true,
  });

  const initialScale = await page.evaluate(() => window.fixture.primary.state.scale);
  await viewport.dispatchEvent("wheel", {
    deltaY: -120,
    deltaMode: 0,
    ctrlKey: true,
    clientX: box.x + box.width / 2,
    clientY: y,
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.scale))
    .not.toBe(initialScale);
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selectedText);
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  // The native range remains the semantic/copy source, but browser glyph
  // remeasurement is deliberately not the mirror geometry authority after zoom.

  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("fixture");
  await expect(root.locator(".pdf-search-highlight")).not.toHaveCount(0);
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  await root.locator(".pdf-search-close-btn").click();
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selectedText);
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);

  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("fixture");
  await expect(root.locator(".pdf-search-highlight")).not.toHaveCount(0);

  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).not.toBeNull();
  if (!viewportBox) return;
  await viewport.click({ position: { x: 10, y: viewportBox.height / 2 } });
  await expect(root.locator(".pdf-text-selection-highlight")).toHaveCount(0);
  await expect(root.locator(".pdf-search-highlight")).not.toHaveCount(0);
});

test("text-selection mode drag-scrolls when the mouse starts on textless paper", async ({
  page,
}) => {
  const root = page.locator("#primary");
  const viewport = root.locator(".pdf-container");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator('.pdf-page[data-page="1"] .pdf-text-layer span').first()).toBeVisible();

  const start = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    const pageElement = document.querySelector<HTMLElement>('#primary .pdf-page[data-page="1"]');
    if (!container || !pageElement) throw new Error("Missing document geometry");
    const viewportRect = container.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const minY = Math.max(viewportRect.top + 130, pageRect.top + 8);
    const maxY = Math.min(viewportRect.bottom - 8, pageRect.bottom - 8);
    const xs = [pageRect.left + 6, pageRect.right - 6];
    for (let y = maxY; y >= minY; y -= 12) {
      for (const x of xs) {
        const target = document.elementFromPoint(x, y);
        if (
          target?.closest(".pdf-page") === pageElement &&
          !target.closest(".pdf-text-layer span")
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("Missing visible textless paper point");
  });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 120, { steps: 8 });
  await page.mouse.up();

  await expect(viewport).toBeFocused();
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? "")).toBe("");
});

test("mouse selection retains its last text endpoint while crossing a blank text gap", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(async () => {
    await window.fixture.primary.zoomTo(0.25);
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (container) container.scrollTop = 0;
    window.fixture.primary.setTextSelectionMode(true);
  });
  await expect(root.locator('.pdf-page[data-page="2"] .pdf-text-layer span').first()).toBeVisible();
  const points = await page.evaluate(() => {
    const firstSpan = [
      ...document.querySelectorAll<HTMLElement>(
        '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
      ),
    ].at(-1);
    const secondSpan = document.querySelector<HTMLElement>(
      '#primary .pdf-page[data-page="2"] .pdf-text-layer span',
    );
    if (!firstSpan || !secondSpan) throw new Error("Missing text-gap endpoints");
    const first = firstSpan.getBoundingClientRect();
    const second = secondSpan.getBoundingClientRect();
    const gap = { x: (first.left + first.right) / 2, y: (first.bottom + second.top) / 2 };
    if (document.elementFromPoint(gap.x, gap.y)?.closest(".pdf-text-layer span")) {
      throw new Error("Expected a blank point between page text layers");
    }
    return {
      start: { x: first.left + Math.max(1, first.width * 0.15), y: (first.top + first.bottom) / 2 },
      valid: { x: first.left + Math.max(2, first.width * 0.8), y: (first.top + first.bottom) / 2 },
      gap,
      next: {
        x: second.left + Math.max(1, second.width * 0.6),
        y: (second.top + second.bottom) / 2,
      },
    };
  });
  const snapshot = () =>
    page.evaluate(() => ({
      text: document.getSelection()?.toString() ?? "",
      highlights: [
        ...document.querySelectorAll<HTMLElement>("#primary .pdf-text-selection-highlight"),
      ].map(node => {
        const rect = node.getBoundingClientRect();
        return [rect.left, rect.top, rect.width, rect.height].map(value =>
          Number(value.toFixed(2)),
        );
      }),
    }));
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.valid.x, points.valid.y, { steps: 8 });
  await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
  const beforeGap = await snapshot();
  expect(beforeGap.text).not.toBe("");
  await page.evaluate(() => {
    const original = Element.prototype.replaceChildren;
    (window as Window & { gapSelectionReplacements?: number }).gapSelectionReplacements = 0;
    (window as Window & { gapMouseMoveCancelled?: boolean }).gapMouseMoveCancelled = false;
    const observeGapMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (
        event.buttons === 1 &&
        !target?.closest(".pdf-text-layer span") &&
        event.defaultPrevented
      ) {
        (window as Window & { gapMouseMoveCancelled?: boolean }).gapMouseMoveCancelled = true;
      }
    };
    document.addEventListener("mousemove", observeGapMove);
    (window as Window & { gapMoveObserver?: (event: MouseEvent) => void }).gapMoveObserver =
      observeGapMove;
    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
      if ((this as Element).classList?.contains("pdf-selection-highlight-channel")) {
        (window as Window & { gapSelectionReplacements?: number }).gapSelectionReplacements!++;
      }
      return original.apply(this, nodes);
    };
    (
      Element.prototype as Element & { __gapReplaceChildren?: typeof original }
    ).__gapReplaceChildren = original;
  });
  await page.mouse.move(points.gap.x, points.gap.y, { steps: 8 });
  await page.waitForTimeout(80);
  const inGap = await snapshot();
  const gapResult = await page.evaluate(() => {
    const prototype = Element.prototype as Element & {
      __gapReplaceChildren?: typeof Element.prototype.replaceChildren;
    };
    const count =
      (window as Window & { gapSelectionReplacements?: number }).gapSelectionReplacements ?? -1;
    Element.prototype.replaceChildren = prototype.__gapReplaceChildren!;
    delete prototype.__gapReplaceChildren;
    const target = window as Window & {
      gapMouseMoveCancelled?: boolean;
      gapMoveObserver?: (event: MouseEvent) => void;
    };
    if (target.gapMoveObserver) document.removeEventListener("mousemove", target.gapMoveObserver);
    return { replacements: count, cancelled: target.gapMouseMoveCancelled ?? false };
  });
  expect(inGap.text).not.toBe("");
  expect(inGap.highlights).toHaveLength(beforeGap.highlights.length);
  expect(gapResult).toEqual({ replacements: 0, cancelled: true });
  await page.mouse.move(points.next.x, points.next.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await snapshot()).text).not.toBe(beforeGap.text);
});

test("overlapping native range rectangles produce a non-overlapping selection mirror", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator('.pdf-page[data-page="1"] .pdf-text-layer span').first()).toBeVisible();
  const rectangles = await page.evaluate(async () => {
    const text = document.querySelector(
      '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
    )?.firstChild;
    if (!text) throw new Error("Missing overlap test text");
    const original = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      const rects = [...original.call(this)];
      const base = rects[0];
      if (
        !base ||
        !this.commonAncestorContainer.parentElement?.closest("#primary .pdf-text-layer")
      ) {
        return rects as unknown as DOMRectList;
      }
      return [
        base,
        base,
        new DOMRect(
          base.left + base.width / 2,
          base.top + base.height / 2,
          base.width,
          base.height,
        ),
      ] as unknown as DOMRectList;
    };
    try {
      document
        .getSelection()
        ?.setBaseAndExtent(text, 0, text, Math.min(12, text.textContent?.length ?? 0));
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return [
        ...document.querySelectorAll<HTMLElement>("#primary .pdf-text-selection-highlight"),
      ].map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
    } finally {
      Range.prototype.getClientRects = original;
    }
  });
  expect(rectangles.length).toBeGreaterThan(1);
  for (let index = 0; index < rectangles.length; index++) {
    for (let other = index + 1; other < rectangles.length; other++) {
      const a = rectangles[index];
      const b = rectangles[other];
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(
        true,
      );
    }
  }
});

test("mouse selection crosses a visible page boundary without requiring scroll", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(async () => {
    window.fixture.primary.setTextSelectionMode(true);
    await window.fixture.primary.zoomTo(0.25);
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (container) container.scrollTop = 0;
  });
  const first = root.locator(".pdf-text-layer span").nth(0);
  const second = root.locator(".pdf-text-layer").nth(1).locator("span").first();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  if (!firstBox || !secondBox) return;
  const before = await root.locator(".pdf-container").evaluate(element => element.scrollTop);
  await page.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width * 0.7, secondBox.y + secondBox.height / 2, {
    steps: 16,
  });
  await page.mouse.up();
  await expect(
    root.locator('.pdf-page[data-page="2"] .pdf-text-selection-highlight'),
  ).not.toHaveCount(0);
  expect(await root.locator(".pdf-container").evaluate(element => element.scrollTop)).toBe(before);
});

test("mouse selection crosses three visible pages and copies the intermediate page without scrolling", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit synthetic mouse dragging is not stable across three text-layer islands",
  );
  const root = page.locator("#primary");
  await page.evaluate(async () => {
    window.fixture.primary.setTextSelectionMode(true);
    await window.fixture.primary.zoomTo(0.2);
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (container) container.scrollTop = 0;
  });
  const first = root.locator('.pdf-page[data-page="1"] .pdf-text-layer span').first();
  const second = root.locator('.pdf-page[data-page="2"] .pdf-text-layer span').first();
  const third = root.locator('.pdf-page[data-page="3"] .pdf-text-layer span').first();
  await expect(third).toBeVisible();
  const [firstBox, secondBox, thirdBox] = await Promise.all([
    first.boundingBox(),
    second.boundingBox(),
    third.boundingBox(),
  ]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(thirdBox).not.toBeNull();
  if (!firstBox || !secondBox || !thirdBox) return;
  const container = root.locator(".pdf-container");
  const before = await container.evaluate(element => element.scrollTop);
  const point = (box: NonNullable<typeof firstBox>, fraction: number) => ({
    x: box.x + box.width * fraction,
    y: box.y + box.height / 2,
  });
  const firstPoint = point(firstBox, 0.1);
  const secondPoint = point(secondBox, 0.5);
  const thirdPoint = point(thirdBox, 0.8);
  await page.mouse.move(firstPoint.x, firstPoint.y);
  await page.mouse.down();
  await page.mouse.move(secondPoint.x, secondPoint.y, { steps: 12 });
  await expect(
    root.locator('.pdf-page[data-page="2"] .pdf-text-selection-highlight'),
  ).not.toHaveCount(0);
  await page.mouse.move(thirdPoint.x, thirdPoint.y, { steps: 12 });
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-text-selection-highlight'),
  ).not.toHaveCount(0);
  await page.mouse.up();
  const copiedText = await page.evaluate(() => {
    const focus = document.getSelection()?.focusNode;
    const element = focus instanceof Element ? focus : focus?.parentElement;
    const clipboardData = new DataTransfer();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: clipboardData });
    element?.closest(".pdf-text-layer")?.dispatchEvent(copy as ClipboardEvent);
    return clipboardData.getData("text/plain");
  });
  expect(copiedText).toContain("Fixture page 2");
  expect(await container.evaluate(element => element.scrollTop)).toBe(before);
});

test("three-page semantic copy includes intermediate text in every engine", async ({ page }) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.setTextSelectionMode(true);
    window.fixture.primary.zoomTo(0.2);
  });
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-text-layer span').first(),
  ).toBeAttached();
  const copied = await page.evaluate(() => {
    const first = document.querySelector(
      '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
    )?.firstChild;
    const third = document.querySelector(
      '#primary .pdf-page[data-page="3"] .pdf-text-layer span',
    )?.firstChild;
    if (!first || !third) throw new Error("Missing three-page semantic copy endpoints");
    document
      .getSelection()
      ?.setBaseAndExtent(first, 1, third, Math.min(12, third.textContent?.length ?? 0));
    const clipboardData = new DataTransfer();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: clipboardData });
    first.parentElement?.closest(".pdf-text-layer")?.dispatchEvent(copy as ClipboardEvent);
    return clipboardData.getData("text/plain");
  });
  expect(copied).toContain("Fixture page 2");
});

test("semantic selection pins all crossed pages and releases them when cleared", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.zoomTo(0.2);
    window.fixture.primary.setTextSelectionMode(true);
  });
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-text-layer span').first(),
  ).toBeAttached();
  await page.evaluate(() => {
    const first = document.querySelector(
      '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
    )?.firstChild;
    const third = document.querySelector(
      '#primary .pdf-page[data-page="3"] .pdf-text-layer span',
    )?.firstChild;
    if (!first || !third) throw new Error("Missing semantic pin endpoints");
    document
      .getSelection()
      ?.setBaseAndExtent(first, 1, third, Math.min(12, third.textContent?.length ?? 0));
  });
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-text-selection-highlight'),
  ).not.toHaveCount(0);
  await page.evaluate(() => window.fixture.primary.zoomTo(1));
  await expect(root.locator(".pdf-text-layer")).toHaveCount(3);
  await page.evaluate(async () => {
    const container = document.querySelector<HTMLElement>("#primary .pdf-container");
    if (container) {
      container.scrollTop = 0;
      container.dispatchEvent(new Event("scroll"));
    }
    const first = document.querySelector(
      '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
    )?.firstChild;
    if (!first) throw new Error("Missing replacement selection endpoint");
    document
      .getSelection()
      ?.setBaseAndExtent(first, 1, first, Math.min(8, first.textContent?.length ?? 0));
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(root.locator('.pdf-page[data-page="3"] .pdf-text-layer')).toHaveCount(0);
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(false));
  await expect(root.locator(".pdf-text-layer")).toHaveCount(0);
});

test("a touch tap on container chrome clears an existing managed selection", async ({ page }) => {
  const viewport = page.locator("#primary .pdf-container");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(page.locator("#primary .pdf-text-layer span").first()).toBeAttached();
  await page.evaluate(() => {
    const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing text node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 1, node, Math.min(10, node.textContent?.length ?? 0));
  });
  await expect(page.locator("#primary .pdf-text-selection-highlight")).not.toHaveCount(0);
  await viewport.dispatchEvent("pointerdown", {
    pointerId: 51,
    pointerType: "touch",
    isPrimary: true,
  });
  await viewport.dispatchEvent("pointerup", {
    pointerId: 51,
    pointerType: "touch",
    isPrimary: true,
  });
  await viewport.dispatchEvent("click");
  await expect(page.locator("#primary .pdf-text-selection-highlight")).toHaveCount(0);
});

test("cross-page selection mirrors only semantic page-local text ranges in both directions", async ({
  page,
  browserName,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator(".pdf-text-layer").nth(1)).toBeAttached();

  const select = async (reverse: boolean) =>
    page.evaluate(backward => {
      const layers = [...document.querySelectorAll<HTMLElement>("#primary .pdf-text-layer")];
      const first = layers[0]?.querySelector("span")?.firstChild;
      const second = layers[1]?.querySelector("span")?.firstChild;
      if (!first || !second) throw new Error("Missing adjacent text nodes");
      const selection = document.getSelection();
      if (!selection) throw new Error("Missing native selection");
      if (backward)
        selection.setBaseAndExtent(second, Math.min(10, second.textContent?.length ?? 0), first, 2);
      else
        selection.setBaseAndExtent(first, 2, second, Math.min(10, second.textContent?.length ?? 0));
    }, reverse);

  for (const reverse of [false, true]) {
    await select(reverse);
    await expect(root.locator(".pdf-text-selection-highlight")).not.toHaveCount(0);
    const result = await root.evaluate(viewer => {
      const highlights = [...viewer.querySelectorAll<HTMLElement>(".pdf-text-selection-highlight")];
      const pages = [
        ...new Set(highlights.map(item => item.closest<HTMLElement>(".pdf-page")?.dataset.page)),
      ];
      const rects = highlights.map(item => item.getBoundingClientRect());
      const contained = highlights.every(item => {
        const rect = item.getBoundingClientRect();
        const layer = item
          .closest(".pdf-page")
          ?.querySelector(".pdf-text-layer")
          ?.getBoundingClientRect();
        return (
          !!layer &&
          rect.left >= layer.left - 1 &&
          rect.top >= layer.top - 1 &&
          rect.right <= layer.right + 1 &&
          rect.bottom <= layer.bottom + 1 &&
          rect.width < layer.width * 0.9 &&
          rect.height < layer.height * 0.9
        );
      });
      const unique = new Set(
        rects.map(rect =>
          [rect.left, rect.top, rect.width, rect.height].map(value => value.toFixed(2)).join("|"),
        ),
      ).size;
      const sentinels = [...viewer.querySelectorAll<HTMLElement>(".pdf-text-layer")].map(layer => {
        const end = layer.querySelector<HTMLElement>(".endOfContent");
        if (!end) return { present: false };
        const rect = end.getBoundingClientRect();
        const style = getComputedStyle(end);
        return {
          present: true,
          selecting: layer.classList.contains("selecting"),
          width: end.style.width,
          height: end.style.height,
          userSelect: end.style.userSelect,
          rectWidth: rect.width,
          rectHeight: rect.height,
          computedUserSelect: style.userSelect,
        };
      });
      return { pages, contained, count: rects.length, unique, sentinels };
    });
    expect(result.pages).toEqual(["1", "2"]);
    expect(result.contained).toBe(true);
    expect(result.unique).toBe(result.count);
    expect(
      result.sentinels.every(
        sentinel =>
          sentinel.present &&
          sentinel.rectWidth === 0 &&
          sentinel.rectHeight === 0 &&
          (browserName === "webkit" || sentinel.computedUserSelect === "none"),
      ),
      JSON.stringify(result.sentinels),
    ).toBe(true);
  }

  const normalized = async () =>
    root.evaluate(viewer =>
      [...viewer.querySelectorAll<HTMLElement>(".pdf-text-selection-highlight")]
        .map(item => {
          const page = item.closest<HTMLElement>(".pdf-page")!;
          const rect = item.getBoundingClientRect();
          const pageRect = page.getBoundingClientRect();
          return [
            Number(page.dataset.page),
            (rect.left - pageRect.left) / pageRect.width,
            (rect.top - pageRect.top) / pageRect.height,
            rect.width / pageRect.width,
            rect.height / pageRect.height,
          ];
        })
        .sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]),
    );
  const before = await normalized();
  await page.evaluate(() => window.fixture.primary.zoomBy(1.35));
  await expect.poll(normalized).toHaveLength(before.length);
  const after = await normalized();
  for (let index = 0; index < before.length; index++) {
    expect(after[index][0]).toBe(before[index][0]);
    for (let coordinate = 1; coordinate < before[index].length; coordinate++) {
      expect(Math.abs(after[index][coordinate] - before[index][coordinate])).toBeLessThan(0.008);
    }
  }
});

test("search highlight geometry remains canonical across committed scales", async ({ page }) => {
  const root = page.locator("#primary");
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("fixture");
  const highlight = root.locator(".pdf-search-highlight").first();
  await expect(highlight).toBeVisible();
  const normalized = () =>
    highlight.evaluate(item => {
      const page = item.closest<HTMLElement>(".pdf-page")!;
      const rect = item.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      return [
        (rect.left - pageRect.left) / pageRect.width,
        (rect.top - pageRect.top) / pageRect.height,
        rect.width / pageRect.width,
        rect.height / pageRect.height,
      ];
    });
  const before = await normalized();
  await page.evaluate(() => window.fixture.primary.zoomBy(1.4));
  await expect(highlight).toBeVisible();
  const after = await normalized();
  for (let index = 0; index < before.length; index++) {
    expect(Math.abs(after[index] - before[index])).toBeLessThan(0.004);
  }
});

test("canonical API zoom preserves selection and headless highlight fallback remains visible", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(root.locator(".pdf-text-layer span").first()).toBeAttached();
  await page.evaluate(() => {
    const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing text node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 2, node, Math.min(15, node.textContent?.length ?? 0));
  });
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? "");
  await page.evaluate(() =>
    window.fixture.primary.zoomTo(window.fixture.primary.state.scale * 1.2),
  );
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selected);
  await page.evaluate(() => window.fixture.primary.zoomBy(0.9));
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selected);
  const color = await root.evaluate(viewer => {
    const shell = viewer.querySelector(".pdf-default-ui");
    shell?.classList.add("pdf-headless-ui");
    shell?.classList.remove("pdf-default-ui");
    return getComputedStyle(viewer.querySelector<HTMLElement>(".pdf-text-selection-highlight")!)
      .backgroundColor;
  });
  expect(color).not.toBe("rgba(0, 0, 0, 0)");
});

test("bounded zoom text failure retries once, retains a mirror, and later restores native selection", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeZoomTextFailureRecovery());
  expect(result).toMatchObject({
    failures: 2,
    retryRequests: 1,
    transientMirrorVisible: true,
    transientNativeSuspended: true,
    oneFallbackDiagnostic: true,
    fallbackVisible: true,
    nativeRetained: true,
    laterRestored: true,
    exactMirrorReplaced: true,
    scrollStable: true,
    fallbackReportedGeometry: true,
  });
});

test("stale text presentation failure emits no current-document diagnostic", async ({ page }) => {
  expect(await page.evaluate(() => window.fixture.probeStaleTextFailureDiagnostic())).toBe(0);
});

test("copy completion is owner-scoped and honors sticky and until-copy policies", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeSelectionCopyPolicies());
  expect(result).toMatchObject({
    stickySurvivedManagedCopy: true,
    stickyDeactivations: 0,
    stickyCompletedOnce: true,
    stickyManagedHandlerRan: true,
    stickyPostHandlerRan: true,
    stickyPayloadWrittenBeforeCompletion: true,
    stickyManagedSelectionOwned: true,
    stickyManagedSelectionBookmarked: true,
    untilCopySurvivedCancelled: true,
    untilCopySurvivedInput: true,
    untilCopyDeactivated: true,
    untilCopyDeactivatedOnce: true,
    untilCopyCompletedOnce: true,
    untilCopyManagedHandlerRan: true,
    untilCopyPostHandlerRan: true,
    untilCopyPayloadWrittenBeforeCompletion: true,
    untilCopyManagedSelectionOwned: true,
    untilCopyManagedSelectionBookmarked: true,
  });
});

test("search-only demand retains matched viewport pages and releases them on close", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.setTextSelectionMode(false);
    window.fixture.primary.zoomTo(0.25);
  });
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("page 3");
  await expect(root.locator('.pdf-page[data-page="3"] .pdf-search-highlight')).not.toHaveCount(0);
  expect(await root.locator('.pdf-page[data-page="1"] .pdf-text-layer').count()).toBe(0);
  expect(await root.locator('.pdf-page[data-page="2"] .pdf-text-layer').count()).toBe(0);
  expect(await root.locator('.pdf-page[data-page="3"] .pdf-text-layer').count()).toBe(1);
  await root.locator(".pdf-search-close-btn").click();
  await expect(root.locator(".pdf-text-layer")).toHaveCount(0);
});

test("query replacement skips geometry and DOM work on unchanged no-match pages", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.zoomTo(0.25);
    window.fixture.primary.setTextSelectionMode(true);
  });
  await root.locator(".pdf-search-toggle-btn").click();
  const input = root.locator(".pdf-search-input");
  await input.fill("page 3");
  await expect(root.locator('.pdf-page[data-page="3"] .pdf-search-highlight')).not.toHaveCount(0);
  await page.evaluate(() => {
    const counters = { geometry: 0, replacements: 0 };
    const originalRects = Range.prototype.getClientRects;
    const originalReplace = Element.prototype.replaceChildren;
    (window as Window & { noMatchSearchCounters?: typeof counters }).noMatchSearchCounters =
      counters;
    Range.prototype.getClientRects = function () {
      const element =
        this.commonAncestorContainer instanceof Element
          ? this.commonAncestorContainer
          : this.commonAncestorContainer.parentElement;
      if (element?.closest('.pdf-page[data-page="1"]')) counters.geometry++;
      return originalRects.call(this);
    };
    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
      if (
        (this as Element).classList?.contains("pdf-search-highlight-channel") &&
        (this as Element).closest('.pdf-page[data-page="1"]')
      )
        counters.replacements++;
      return originalReplace.apply(this, nodes);
    };
    (Range.prototype as Range & { __searchRects?: typeof originalRects }).__searchRects =
      originalRects;
    (Element.prototype as Element & { __searchReplace?: typeof originalReplace }).__searchReplace =
      originalReplace;
  });
  await input.fill("page 2");
  await expect(root.locator('.pdf-page[data-page="2"] .pdf-search-highlight')).not.toHaveCount(0);
  const counters = await page.evaluate(() => {
    const rangePrototype = Range.prototype as Range & {
      __searchRects?: typeof Range.prototype.getClientRects;
    };
    const elementPrototype = Element.prototype as Element & {
      __searchReplace?: typeof Element.prototype.replaceChildren;
    };
    const result = (
      window as Window & { noMatchSearchCounters?: { geometry: number; replacements: number } }
    ).noMatchSearchCounters!;
    Range.prototype.getClientRects = rangePrototype.__searchRects!;
    Element.prototype.replaceChildren = elementPrototype.__searchReplace!;
    delete rangePrototype.__searchRects;
    delete elementPrototype.__searchReplace;
    return result;
  });
  expect(counters).toEqual({ geometry: 0, replacements: 0 });
});

test("active search navigation preserves highlight nodes and performs no new range geometry", async ({
  page,
}) => {
  const root = page.locator("#primary");
  await page.evaluate(() => window.fixture.primary.zoomTo(0.25));
  await root.locator(".pdf-search-toggle-btn").click();
  await root.locator(".pdf-search-input").fill("Fixture");
  await expect(root.locator(".pdf-search-highlight")).toHaveCount(3);
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLElement>("#primary .pdf-search-highlight")
      .forEach((node, index) => {
        node.dataset.testSearchIdentity = String(index);
      });
    const rangePrototype = Range.prototype as Range & {
      __originalGetClientRects?: Range["getClientRects"];
    };
    rangePrototype.__originalGetClientRects = Range.prototype.getClientRects;
    (window as Window & { searchGeometryCalls?: number }).searchGeometryCalls = 0;
    Range.prototype.getClientRects = function () {
      (window as Window & { searchGeometryCalls?: number }).searchGeometryCalls!++;
      return rangePrototype.__originalGetClientRects!.call(this);
    };
  });
  await root.locator(".pdf-search-next-btn").click();
  await expect(root.locator(".pdf-search-highlight-current")).toHaveCount(1);
  const result = await page.evaluate(() => {
    const identities = [
      ...document.querySelectorAll<HTMLElement>("#primary .pdf-search-highlight"),
    ].map(node => node.dataset.testSearchIdentity);
    const calls = (window as Window & { searchGeometryCalls?: number }).searchGeometryCalls ?? -1;
    const rangePrototype = Range.prototype as Range & {
      __originalGetClientRects?: Range["getClientRects"];
    };
    Range.prototype.getClientRects = rangePrototype.__originalGetClientRects!;
    delete rangePrototype.__originalGetClientRects;
    return { identities, calls };
  });
  expect(result.identities).toEqual(["0", "1", "2"]);
  expect(result.calls).toBe(0);
});

test("rapid native selection changes coalesce to one geometry frame", async ({ page }) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.zoomTo(0.25);
    window.fixture.primary.setTextSelectionMode(true);
  });
  await expect(root.locator(".pdf-text-layer span").first()).toBeAttached();
  const result = await page.evaluate(async () => {
    const counters = { geometry: 0, replacements: 0 };
    const originalRects = Range.prototype.getClientRects;
    const originalReplace = Element.prototype.replaceChildren;
    Range.prototype.getClientRects = function () {
      counters.geometry++;
      return originalRects.call(this);
    };
    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
      if ((this as Element).classList?.contains("pdf-selection-highlight-channel"))
        counters.replacements++;
      return originalReplace.apply(this, nodes);
    };
    try {
      const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
      if (!node) throw new Error("Missing selection coalescing node");
      for (let offset = 2; offset <= 12; offset++) {
        document
          .getSelection()
          ?.setBaseAndExtent(node, 1, node, Math.min(offset, node.textContent?.length ?? 0));
      }
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return counters;
    } finally {
      Range.prototype.getClientRects = originalRects;
      Element.prototype.replaceChildren = originalReplace;
    }
  });
  expect(result.replacements).toBeLessThanOrEqual(1);
  expect(result.geometry).toBeLessThanOrEqual(1);
});

test("selection redraw is limited to page-local partitions that changed", async ({ page }) => {
  const root = page.locator("#primary");
  await page.evaluate(() => {
    window.fixture.primary.zoomTo(0.2);
    window.fixture.primary.setTextSelectionMode(true);
  });
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-text-layer span').first(),
  ).toBeAttached();
  await page.evaluate(() => {
    const first = document.querySelector(
      '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
    )?.firstChild;
    const third = document.querySelector(
      '#primary .pdf-page[data-page="3"] .pdf-text-layer span',
    )?.firstChild;
    if (!first || !third) throw new Error("Missing redraw endpoints");
    document
      .getSelection()
      ?.setBaseAndExtent(first, 1, third, Math.min(8, third.textContent?.length ?? 0));
  });
  await expect(
    root.locator('.pdf-page[data-page="3"] .pdf-text-selection-highlight'),
  ).not.toHaveCount(0);
  const result = await page.evaluate(async () => {
    const first = document.querySelector(
      '#primary .pdf-page[data-page="1"] .pdf-text-layer span',
    )?.firstChild;
    const third = document.querySelector(
      '#primary .pdf-page[data-page="3"] .pdf-text-layer span',
    )?.firstChild;
    if (!first || !third) throw new Error("Missing redraw endpoints");
    const replacements: string[] = [];
    const originalReplace = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
      if ((this as Element).classList?.contains("pdf-selection-highlight-channel")) {
        replacements.push(
          (this as Element).closest<HTMLElement>(".pdf-page")?.dataset.page ?? "missing",
        );
      }
      return originalReplace.apply(this, nodes);
    };
    try {
      document
        .getSelection()
        ?.setBaseAndExtent(first, 1, third, Math.min(14, third.textContent?.length ?? 0));
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return replacements;
    } finally {
      Element.prototype.replaceChildren = originalReplace;
    }
  });
  expect(result).toEqual(["3"]);
});

test("one viewer cannot clear or restore over another viewer selection", async ({ page }) => {
  await page.evaluate(() => window.fixture.addSecondary());
  await expect
    .poll(() => page.evaluate(() => window.fixture.secondary?.state.status))
    .toBe("ready");
  await page.evaluate(() => {
    window.fixture.primary.setTextSelectionMode(true);
    window.fixture.secondary!.setTextSelectionMode(true);
  });
  await expect(page.locator("#primary .pdf-text-layer span").first()).toBeAttached();
  await expect(page.locator("#secondary .pdf-text-layer span").first()).toBeAttached();
  await page.evaluate(() => {
    const primaryNode = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    const secondaryNode = document.querySelector("#secondary .pdf-text-layer span")?.firstChild;
    if (!primaryNode || !secondaryNode) throw new Error("Missing viewer text nodes");
    document.getSelection()?.setBaseAndExtent(primaryNode, 1, primaryNode, 8);
    document.getSelection()?.setBaseAndExtent(secondaryNode, 2, secondaryNode, 12);
  });
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? "");
  await page.evaluate(() => window.fixture.primary.zoomBy(1.15));
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString() ?? ""))
    .toBe(selected);
  await expect(page.locator("#secondary .pdf-text-selection-highlight")).not.toHaveCount(0);
  await expect(page.locator("#primary .pdf-text-selection-highlight")).toHaveCount(0);
});

test("destroying a viewer during toolbar retention releases document selection ownership", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.addSecondary());
  await expect
    .poll(() => page.evaluate(() => window.fixture.secondary?.state.status))
    .toBe("ready");
  await page.evaluate(() => window.fixture.secondary!.setTextSelectionMode(true));
  await expect(page.locator("#secondary .pdf-text-layer span").first()).toBeAttached();
  await page.evaluate(() => {
    const node = document.querySelector("#secondary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing secondary selection node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 1, node, Math.min(10, node.textContent?.length ?? 0));
  });
  await expect(page.locator("#secondary .pdf-text-selection-highlight")).not.toHaveCount(0);
  await page.locator("#secondary .pdf-menu-toggle-btn").click();
  await page.evaluate(() => window.fixture.destroySecondary());
  await expect(page.locator("#secondary")).toHaveCount(0);

  await page.evaluate(() => window.fixture.primary.setTextSelectionMode(true));
  await expect(page.locator("#primary .pdf-text-layer span").first()).toBeAttached();
  const selected = await page.evaluate(() => {
    const node = document.querySelector("#primary .pdf-text-layer span")?.firstChild;
    if (!node) throw new Error("Missing primary selection node");
    document
      .getSelection()
      ?.setBaseAndExtent(node, 2, node, Math.min(12, node.textContent?.length ?? 0));
    return document.getSelection()?.toString() ?? "";
  });
  expect(selected).not.toBe("");
  await expect(page.locator("#primary .pdf-text-selection-highlight")).not.toHaveCount(0);
});

test("document replacement and close preserve the UI without stale ready state", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.replacePrimary());
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.status)).toBe("ready");
  await expect(page.locator(".pdf-page-count")).toHaveText("3");

  await page.evaluate(() => window.fixture.closePrimary());
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.status)).toBe("closed");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await expect(page.getByRole("toolbar", { name: "PDF controls" })).toBeVisible();
  await expect(page.locator(".pdf-page-count")).toHaveText("?");
});

test("navigation is rejected while a replacement document is loading", async ({ page }) => {
  const reason = await page.evaluate(() => window.fixture.probeNavigationDuringReplacement());
  expect(reason).toBe("rejected");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.status)).toBe("ready");
});

test("overlapping replacements keep the latest document ready", async ({ page }) => {
  const result = await page.evaluate(() => window.fixture.probeOverlappingReplacements());
  expect(result.firstResult).toEqual({ ok: false, reason: "cancelled", cause: "superseded" });
  expect(result.secondResult).toEqual({ ok: true });
  expect(result.state).toMatchObject({
    status: "ready",
    sourceUrl: "/fixture.pdf?replacement=overlap-second",
  });
  expect((result.state as { pageCount: number }).pageCount).toBeGreaterThan(0);
});

test("load results, events, cleanup, and destroyed behavior form one terminal contract", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeLoadContract())).resolves.toEqual({
    successOrdered: true,
    stateFrozen: true,
    optionsCopiedAndReplaced: true,
    closeCancelled: true,
    closeCannotClobberReplacement: true,
    errorOrdered: true,
    failedDocumentDetached: true,
    passwordCancelled: true,
    externalEventsCannotSettleLoad: true,
    destroyCancelled: true,
    commandRejected: true,
    destroyedQueries: true,
  });
});

test("close during initial rendering defers proxy cleanup until captured work settles", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeCloseDuringInitialRenderCleanup()),
  ).resolves.toEqual({
    closeSettledBeforeRender: true,
    cleanupWaitedForRender: true,
    cleanupFollowedRender: true,
  });
});

test("a stale permission read cannot reset the replacement presentation owner", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeStalePermissionReplacement()),
  ).resolves.toEqual({
    status: "ready",
    currentPermissionPreserved: true,
    formPresentationPreserved: true,
    formStatePreserved: true,
  });
});

test("stale admitted page rendering cannot mutate a replacement document", async ({ page }) => {
  const result = await page.evaluate(() => window.fixture.probeStalePageRenderReplacement());
  expect(result).toMatchObject({
    status: "ready",
    sourceUrl: "/replacement-fixture.pdf",
    pageCount: 1,
    oldRenderStarts: 1,
    annotationCount: 0,
    surfaceStayedStable: true,
  });
  expect(result.replacementAspectRatio).toBeCloseTo(2 / 3, 2);
});

test("late attached render completion cannot mutate a replacement document", async ({ page }) => {
  const result = await page.evaluate(() => window.fixture.probeLateAttachedRenderReplacement());
  expect(result).toEqual({
    status: "ready",
    sourceUrl: "/replacement-fixture.pdf",
    surfaceStayedStable: true,
    annotationCount: 0,
  });
});

test("replacement first render planning ignores prior document page geometry", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeReplacementGeometryIsolation()),
  ).resolves.toEqual({
    replacementRenderStarts: 1,
    freshRenderStarts: 1,
    sameFirstPlan: true,
    sameCanvasDimensions: true,
  });
});

test("replacement interrupts deferred navigation, transient zoom, and pointer motion", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probeInterruptedDocumentInteractions()),
  ).resolves.toEqual({
    status: "ready",
    pageCount: 1,
    imeStable: true,
    motionStable: true,
    cursorCleared: true,
    interruptedTransformCleared: true,
    replacementTransformCleared: true,
    pinchFlagCleared: true,
    gapCursorCleared: true,
    gapTransformCleared: true,
    gapPinchFlagCleared: true,
    gapScaleStable: true,
    gapScrollStable: true,
    longPressGenerationSafe: true,
  });
});

test("equivalent render-plan refresh reuses the committed page without repainting", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeEquivalentPlanRefreshReuse());
  expect(result.startsBefore).toBeGreaterThan(0);
  expect(result.startsAfter).toBe(result.startsBefore);
  expect(result).toMatchObject({
    sameCanvas: true,
    sameDimensions: true,
    sameBitmap: true,
  });
});

test("invalid zoom inputs are rejected without corrupting viewer state", async ({ page }) => {
  const before = await page.evaluate(() => window.fixture.primary.state.scale);
  expect(await page.evaluate(() => window.fixture.probeInvalidZoom())).toEqual({
    scaleRejected: true,
    factorRejected: true,
  });
  expect(await page.evaluate(() => window.fixture.primary.state.scale)).toBe(before);
});

test("committed zoom scales use stable six-decimal identity", async ({ page }) => {
  await page.evaluate(() => window.fixture.primary.zoomTo(1.23456749));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.scale)).toBe(1.234567);
});

test("invalid behavior options are rejected during construction", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeInvalidBehaviorOptions())).resolves.toEqual({
    zoomRejected: true,
    longPressRejected: true,
    sidebarModeRejected: true,
    zoomGesturesRejected: true,
    documentVisibilityPolicyRejected: true,
    searchPolicyRejected: true,
    outlinePolicyRejected: true,
    removedMatchingPolicyRejected: true,
    destinationToleranceRejected: true,
    removedOutlineToleranceRejected: true,
  });
});

test("invalid constructor options are rejected before viewer setup", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeInvalidConstructorOptions()),
  ).resolves.toEqual({
    sourceRejected: true,
    emptyUint8ArrayRejected: true,
    emptyArrayBufferRejected: true,
    emptyUrlDescriptorRejected: true,
    emptyDataDescriptorRejected: true,
    malformedSourceDescriptorRejected: true,
    viewerIdRejected: true,
    navigationRejected: true,
    bindingRejected: true,
    featureRejected: true,
    navigationHistoryFeatureRejected: true,
    printFeatureRejected: true,
    printBooleanRejected: true,
    adapterMissingRejected: true,
    adapterWrongModeRejected: true,
    removedNativeQualificationsRejected: true,
    removedNativePolicyRejected: true,
    browserFallbackTypeRejected: true,
    browserFallbackWrongModeRejected: true,
    printDefaultsQualityRejected: true,
    printDefaultsScalingRejected: true,
    compatibilityArrayRejected: true,
    compatibilityEngineRejected: true,
    compatibilitySupportRejected: true,
    enableXfaEscapeHatchRejected: true,
    preparationPolicyRejected: true,
    removedTopLevelOptionRejected: true,
    removedNamedDestinationPrefixRejected: true,
    uiControlRejected: true,
    navigationHistoryControlRejected: true,
    printLimitsRejected: true,
    unknownPrimaryViewRejected: true,
    duplicatePrimaryViewRejected: true,
  });
});

test("device compatibility defaults and host refinements are viewer-local and deterministic", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "compatibility probe overrides Chromium UA classes");
  await expect(page.evaluate(() => window.fixture.probeDeviceCompatibility())).resolves.toEqual({
    defaultBefore: {
      nativePrintSupport: "portrait-and-landscape",
      engine: "chromium",
      browser: "chrome",
      platform: "desktop",
      operatingSystem: "windows",
      sourceFallbackRecommended: false,
    },
    desktop: {
      nativePrintSupport: "portrait",
      engine: "chromium",
      browser: "chrome",
      platform: "desktop",
      operatingSystem: "windows",
      sourceFallbackRecommended: false,
    },
    androidDefault: { orientation: "landscape", layout: "spread", support: "portrait" },
    androidAuto: { layout: "single", support: "portrait" },
    androidSpread: {
      nativePrintSupport: "portrait-and-landscape",
      engine: "chromium",
      browser: "chrome",
      platform: "android",
      operatingSystem: "android",
      sourceFallbackRecommended: false,
    },
    firefoxAndroidSingle: {
      nativePrintSupport: "portrait",
      engine: "firefox",
      browser: "firefox",
      platform: "android",
      operatingSystem: "android",
      sourceFallbackRecommended: false,
    },
    firefoxAndroidSpread: { orientation: "landscape", layout: "spread", support: "portrait" },
    defaultAfter: {
      nativePrintSupport: "portrait-and-landscape",
      engine: "chromium",
      browser: "chrome",
      platform: "desktop",
      operatingSystem: "windows",
      sourceFallbackRecommended: false,
    },
  });
});

test("viewer can start closed and load its first document later", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeDeferredInitialLoad())).resolves.toEqual({
    initialStatus: "closed",
    initialPageCount: 0,
    initialSourceUrl: null,
    controlsDisabled: true,
    loadedStatus: "ready",
    loadedPageCount: 3,
    loadedCurrentPage: 2,
    loadedSourceUrl: "/fixture.pdf",
  });
});

test("source descriptors preserve URL and filename metadata", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeSourceDescriptors())).resolves.toEqual({
    sourceUrl: "/fixture.pdf",
    sourceFilename: "fixture-name.pdf",
    printFilename: "fixture-name.pdf",
    downloadTarget: "_blank",
    downloadRel: "noopener",
  });
});

test("destroy disables caller-owned download controls", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeDestroyedDownloadControl()),
  ).resolves.toEqual({
    activeBeforeDestroy: true,
    disabledAfterDestroy: true,
  });
});

test("print adapters can request byte-backed document data with lifecycle cancellation", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probePrintAdapterData())).resolves.toEqual({
    canPrint: true,
    started: true,
    adapterSourceUrl: null,
    adapterFilename: "print-memory.pdf",
    adapterDataSize: expect.any(Number),
    currentValueDataSize: expect.any(Number),
    adapterDataDetached: true,
    adapterFormDirty: false,
    dataSizeMatches: true,
    normalizedOptions: {
      pages: [{ from: 1, to: 3 }],
      layout: { mode: "spread", firstPageSide: "right", gapPt: 0 },
      quality: { dpi: 300 },
      sheet: { width: 297, height: 210, unit: "mm" },
      orientation: "landscape",
      signalForwarded: true,
    },
    preAbortCancelled: true,
    preAbortSkippedAdapter: true,
    cancellationSettledPromptly: true,
    adapterErrorName: "AbortError",
  });
});

test("explicit print modes own routing, setup, logs, and operational state", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probePrintFeaturePolicies())).resolves.toEqual({
    offControlAbsent: true,
    offCanPrint: false,
    offPrintReason: "disabled",
    offSourceReason: "disabled",
    browserCanPrint: true,
    browserSetupAbsent: true,
    browserDialogAriaAbsent: true,
    openedSources: 2,
    adapterCalls: 1,
    adapterSetupAbsent: true,
    fallbackStatus: "source-opened",
    fallbackSetupAbsent: true,
    deniedCanPrint: false,
    deniedButtonHidden: true,
    deniedSetupAbsent: true,
    deniedPreflight: {
      reason: "unsupported",
      sourceFallbackAvailable: false,
      nativePrintSupport: "unsupported",
    },
    deniedPrint: { ok: false, reason: "unsupported" },
    deniedSource: { ok: false, reason: "disabled" },
    portraitSetupPresent: true,
    portraitSupport: "portrait",
    portraitLayoutOptions: ["auto", "single", "spread"],
    portraitLayoutHelp:
      '"Automatic spreads" uses two pages when the PDF prefers a spread and the pages fit on the selected paper.',
    updatedPortraitLayoutHelp: "Automatic layout X",
    portraitSideHidden: true,
    customPortraitLayoutOptions: ["auto", "single", "spread"],
    customPortraitLayoutHelp:
      '"Automatic spreads" uses two pages when the PDF prefers a spread and the pages fit on the selected paper.',
    customPortraitSideHidden: true,
    customDialogPreserved: true,
    customDialogUnbound: true,
    customDialogAriaRemoved: true,
    buttonLogValid: true,
    publicFallbackLogValid: true,
  });
});

test("controlled print setup keeps reduced-quality fallback, validation, parity, and replacement reset", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probePrintSetupPreflight());
  expect(result.reducedDetail).toMatch(/^Reduced quality \d+ DPI$/);
  expect(result.reducedSourceVisible).toBe(true);
  expect(result.protectedPlanFallback).toBe(false);
  expect(result.protectedSourceHidden).toBe(true);
  expect(result.protectedSourceReason).toBe("disabled");
  expect(result.configuredDefaults).toEqual({
    sheet: "letter",
    pageScaling: "shrink-to-fit",
    orientation: "landscape",
    quality: "600",
  });
  expect(result.parityOnlyWarning).toBe(true);
  expect(result.resetLayout).toBe("auto");
  expect(result.resetSide).toBe("auto");
  expect(result.resetDefaults).toEqual({
    sheet: "a4",
    pageScaling: "fit",
    orientation: "auto",
    quality: "300",
  });
  expect(result.memoryLimitPlan).toEqual({ reason: "memory-limit" });
  expect(result.memoryLimitStatus).toBe("Parent memory limit");
  expect(result.memoryLimitSourceVisible).toBe(true);
  expect(result.structuralPlan).toEqual({ reason: "too-large" });
  expect(result.structuralStatus).toBe("Parent structural limit");
  expect(result.sheetLimitResult).toEqual({
    reason: "too-many-sheets",
    sheetCount: 3,
    maxSheets: 1,
  });
  expect(result.sheetLimitPrintResult).toEqual({
    reason: "too-many-sheets",
    sheetCount: 3,
    maxSheets: 1,
  });
  expect(result.sheetLimitStatus).toBe("Limit 3/1");
  expect(result.sheetLimitSourceVisible).toBe(true);
  expect(result.singleSheetCount).toBe(3);
  expect(result.spreadSheetCount).toBe(2);
  expect(result.singleDpi).toEqual(expect.any(Number));
  expect(result.spreadDpi).toEqual(expect.any(Number));
  expect(result.recomputedStatus).toContain("2 landscape sheets");
  expect(result.invalidRangeStatus).toBe("Enter pages from 1 to 3, for example 2-6, 9.");
  expect(result.invalidRangeStatus).not.toContain("PdfjsViewer:");
  expect(result.validRangeStatus).toContain("Pages 1 → 1");
});

test("in-memory documents download on demand through generated and public controls", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeInMemoryDownload())).resolves.toEqual({
    canDownload: true,
    controlVisible: true,
    controlEnabled: true,
    publicResult: { ok: true },
    downloadCount: 2,
    filename: "memory-fixture.pdf",
    blobSizeMatches: true,
    blobType: "application/pdf",
    urlsRevoked: true,
  });
});

test("in-memory download is single-flight and cancels safely on replacement", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeInMemoryDownloadLifecycle()),
  ).resolves.toEqual({
    sharedOneRead: true,
    sharedResults: true,
    keyedDownloadCount: 2,
    cancellationSettledPromptly: true,
    cancellationResult: { ok: false, reason: "cancelled" },
    cleanupWaitedForRead: true,
    cleanupFollowedRead: true,
    replacementReady: true,
  });
});

test("invalid public method and factory arguments are rejected", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeInvalidPublicArguments())).resolves.toEqual({
    activeRejected: true,
    emptyUint8ArrayLoadRejected: true,
    emptyArrayBufferLoadRejected: true,
    pageLayoutRejected: true,
    renderingProfileRejected: true,
    anchorRejected: true,
    namedDestinationRejected: true,
    searchOptionsRejected: true,
    outlineOptionsRejected: true,
    documentDataOptionsRejected: true,
    downloadOptionsRejected: true,
    unknownOutlineOptionRejected: true,
    rowAnimationRejected: true,
    hashOptionsRejected: true,
    removedHashOptionRejected: true,
    defaultUiControlRejected: true,
    defaultUiLabelRejected: true,
    defaultUiFormatterRejected: true,
    defaultUiDirectionRejected: true,
    defaultUiOptionRejected: true,
  });
});

test("rendering profiles support programmatic selection and automatic reset", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeRuntimeRenderingProfileSelection()),
  ).resolves.toEqual({
    selections: [
      {
        renderingProfile: "conservative",
        effectiveRenderingProfile: "conservative",
        availableRenderingProfiles: ["conservative", "balanced", "aggressive"],
      },
      {
        renderingProfile: "auto",
        effectiveRenderingProfile: "balanced",
        availableRenderingProfiles: ["conservative", "balanced", "aggressive"],
      },
    ],
    availabilityIsStable: true,
    conservativeRadioChecked: true,
    automaticBalancedRadioChecked: true,
    unavailableRejected: true,
    destroyedRejected: true,
    singleProfileFieldsetHidden: true,
  });
});

test("viewers always expose unique identities and reject duplicate global IDs", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeViewerIdentity())).resolves.toEqual({
    generatedIdsAreUnique: true,
    duplicateGlobalIdRejected: true,
  });
});

test("custom UI setup identifies the sole required document-container hook", async ({ page }) => {
  await expect
    .poll(() => page.evaluate(() => window.fixture.probeErrorContext()))
    .toContain("ui: 'custom' requires .pdf-container below rootEl or a uiBindings.container");
});

test("UI discovery enforces unique typed hooks and complete scoped print schemas", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeUiDiscoveryContracts())).resolves.toEqual({
    duplicateRejected: true,
    wrongTypeRejected: true,
    directWins: true,
    ignoredPrintSchema: true,
    mappingPreserved: true,
    schemaMissingRejected: true,
    formContainmentRejected: true,
    containmentRejected: true,
  });
});

test("custom UI works with only a document container", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probeMinimalCustomUi())).resolves.toEqual({
    status: "ready",
    pageCount: 3,
    controls: false,
  });
});

test("multiple viewers remain independent and destroy removes only owned UI", async ({ page }) => {
  await page.evaluate(() => window.fixture.addSecondary());
  await expect(page.locator("#secondary")).toHaveAttribute("data-status", "ready");
  await expect(page.locator("#secondary .pdf-page-count")).toHaveText("3");

  await page.locator("#primary .pdf-next-page-btn").click();
  await expect(page.locator("#primary .pdf-page-number-input")).toHaveValue("2");
  await expect(page.locator("#secondary .pdf-page-number-input")).toHaveValue("1");

  await page.evaluate(() => window.fixture.destroySecondary());
  await expect(page.locator("#secondary")).toHaveCount(0);
  await expect(page.locator("#primary .pdf-controls")).toBeVisible();
});

test("global keyboard input is routed to the active viewer only", async ({ page }) => {
  await page.evaluate(() => window.fixture.addSecondary());
  await expect(page.locator("#secondary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(() => window.fixture.activateViewer("secondary"));
  await page.locator("body").focus();
  await page.keyboard.press("PageDown");
  await expect(page.locator("#secondary .pdf-page-number-input")).toHaveValue("2");
  await expect(page.locator("#primary .pdf-page-number-input")).toHaveValue("1");
});

test("runtime worker claims enforce compatibility and lifecycle", async ({ page }) => {
  const result = await page.evaluate(() => window.fixture.probeRuntimeLifecycle());
  expect(result).toEqual({
    compatible: true,
    conflictRejected: true,
    activeDestroyRejected: true,
    destroyedReuseRejected: true,
    invalidOptionsRejected: true,
    invalidPdfjsRejected: true,
    differentPdfjsRejected: true,
  });
});

test("compatible runtimes route global keyboard ownership by exact registration", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.addIsolatedRuntimeViewers());
  await expect(page.locator("#isolated-a .pdf-page-count")).toHaveText("3");
  await expect(page.locator("#isolated-b .pdf-page-count")).toHaveText("3");
  await expect(page.locator("#isolated-a .pdf-page-number-input")).toBeEnabled();
  await expect(page.locator("#isolated-b .pdf-page-number-input")).toBeEnabled();
  await page.locator("body").focus();
  await page.keyboard.press("PageDown");
  await expect(page.locator("#isolated-a .pdf-page-number-input")).toHaveValue("2");
  await expect(page.locator("#isolated-b .pdf-page-number-input")).toHaveValue("1");

  await page.evaluate(() => {
    const viewers = (
      window as unknown as { isolatedViewers: Array<{ setActive(active: boolean): void }> }
    ).isolatedViewers;
    viewers[1]!.setActive(true);
    viewers[0]!.setActive(false);
  });
  await page.keyboard.press("PageDown");
  await expect(page.locator("#isolated-a .pdf-page-number-input")).toHaveValue("2");
  await expect(page.locator("#isolated-b .pdf-page-number-input")).toHaveValue("2");
});

test("printing without an explicit PDF permission is denied before native invocation", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => {
      window.fixture.setPrintPermissions("denied");
      return window.fixture.primary.print();
    }),
  ).resolves.toEqual({
    ok: false,
    reason: "disabled",
  });
});

test("adapter form bytes stay bound to the synchronously admitted revision", async ({ page }) => {
  await expect(page.evaluate(() => window.fixture.probePrintAdapterRevision())).resolves.toEqual({
    result: { ok: true, status: "adapter-completed" },
    visibleValue: "later revision",
    admittedValueSerialized: true,
    laterValueExcluded: true,
    detachedBytes: true,
  });
});

test("unsupported native compatibility routes directly to an honest browser-source result without setup", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probePrintFeaturePolicies());
  expect(result.fallbackStatus).toBe("source-opened");
  expect(result.fallbackSetupAbsent).toBe(true);
  expect(result.publicFallbackLogValid).toBe(true);
});

test("automatic printing requires PDF spread preference and selected-sheet fit", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probeAutomaticPrintLayouts())).resolves.toEqual({
    a5Auto: { layout: "spread", sheetCount: 2 },
    noPreferenceAuto: { layout: "single", sheetCount: 2 },
    mixedAll: { layout: "single", sheetCount: 3 },
    mixedSmallRange: { layout: "spread", sheetCount: 1 },
    mixedLargeRange: { layout: "single", sheetCount: 2 },
    mixedLargeA3: { layout: "spread", sheetCount: 2 },
    rotatedAuto: { layout: "spread", sheetCount: 1 },
    explicitSpread: { layout: "spread", sheetCount: 2 },
    explicitSingle: { layout: "single", sheetCount: 3 },
  });
});

test("controlled printing synchronously admits one permission-gated job", async ({ page }) => {
  await expect(
    page.evaluate(() => window.fixture.probeControlledPrintAdmission()),
  ).resolves.toEqual({
    firstResult: { ok: true, status: "print-invoked", sheetCount: 1 },
    second: { ok: false, reason: "cancelled" },
    permissionReads: 1,
    lifecycle: ["pdf:printstart", "pdf:printprogress", "pdf:printinvoked", "pdf:printcleanup"],
    roots: 0,
  });
});

test("DocumentPrint raster execution releases every failed or completed resource boundary", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeDocumentPrintExecution());
  expect(result.success).toMatchObject({
    result: { ok: true, status: "print-invoked", sheetCount: 2 },
    events: ["start", "render:print", "progress", "render:print", "progress", "invoked", "cleanup"],
    counters: {
      acquire: 2,
      release: 2,
      render: 2,
      exclusive: 1,
      creates: 2,
      revokes: 2,
      prints: 1,
    },
    rootsBeforeAfterprint: 1,
    rootsAfter: 0,
    state: "idle",
    canvasesZeroed: true,
    stylesRestored: true,
  });
  expect(result.shrink).toMatchObject({
    result: { ok: true, status: "print-invoked", sheetCount: 2 },
    drawPlacements: [
      [250, 300, 100, 200],
      [250, 300, 100, 200],
    ],
  });
  expect((result.shrink as { viewports: number[][] }).viewports).toEqual([
    [100, 200],
    [100, 200],
  ]);
  expect(result.transport).toMatchObject({
    result: { ok: true, status: "print-invoked", sheetCount: 2 },
    encodedSizes: [
      [596, 842],
      [596, 842],
    ],
  });
  expect((result.transport as { transforms: number[][] }).transforms).toContainEqual([
    0, -1, 1, 0, 0, 842,
  ]);
  expect(result.stacked).toMatchObject({
    result: { ok: true, status: "print-invoked", sheetCount: 1 },
    encodedSizes: [[596, 842]],
  });
  const stackedPlacements = (result.stacked as { drawPlacements: number[][] }).drawPlacements;
  expect(stackedPlacements).toHaveLength(2);
  expect(stackedPlacements[0]![1]).toBeLessThan(stackedPlacements[1]![1]!);
  for (const [mode, failure] of Object.entries(
    result.failures as Record<string, Record<string, unknown>>,
  )) {
    expect(failure).toMatchObject({
      state: "idle",
      rootsAfter: 0,
      stylesRestored: true,
      canvasesZeroed: true,
    });
    const counters = failure.counters as {
      acquire: number;
      release: number;
      creates: number;
      revokes: number;
      prints: number;
      exclusive: number;
    };
    expect(counters.prints).toBe(0);
    expect(counters.exclusive).toBe(1);
    expect(counters.release).toBe(mode === "acquire" ? 0 : counters.acquire);
    expect(counters.revokes).toBe(mode === "url" ? 0 : counters.creates);
  }
  expect(result.decodeAbort).toMatchObject({
    result: { ok: false, reason: "cancelled" },
    counters: { acquire: 2, release: 2, exclusive: 1, creates: 2, revokes: 2, prints: 0 },
    roots: 0,
    state: "idle",
  });
  expect(result.fontAbort).toMatchObject({
    result: { ok: false, reason: "cancelled" },
    counters: { acquire: 2, release: 2, exclusive: 1, creates: 2, revokes: 2, prints: 0 },
    roots: 0,
    state: "idle",
  });
});

test.describe("strict CSP and Trusted Types", { tag: "@csp" }, () => {
  test("constructs the generated UI and enforces Trusted Types where supported", async ({
    page,
  }) => {
    const root = page.locator("#primary");
    await expect(root.locator(".pdf-default-ui")).toHaveCount(1);
    await expect(root.locator(".pdf-page canvas").first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [...window.fixture.securityPolicyViolations]))
      .toEqual([]);

    const enforcement = await page.evaluate(() => {
      const supported = "trustedTypes" in window;
      let blocked = false;
      try {
        document.createElement("div").innerHTML = "<span>blocked probe</span>";
      } catch (error) {
        blocked = error instanceof TypeError;
      }
      return { supported, blocked };
    });
    if (enforcement.supported) {
      expect(enforcement.blocked).toBe(true);
      await expect
        .poll(() => page.evaluate(() => [...window.fixture.securityPolicyViolations]))
        .toEqual([expect.stringContaining("require-trusted-types-for")]);
    } else {
      expect(enforcement.blocked).toBe(false);
      await expect
        .poll(() => page.evaluate(() => [...window.fixture.securityPolicyViolations]))
        .toEqual([]);
    }
  });

  test("supports generated search, outline, thumbnail, and attachment DOM", async ({ page }) => {
    const root = page.locator("#primary");
    await root.locator(".pdf-search-toggle-btn").click();
    await root.locator(".pdf-search-input").fill("Fixture");
    await expect(root.locator(".pdf-search-highlight-current").first()).toBeVisible();
    await expect(root.locator(".pdf-text-layer").first()).toBeAttached();
    await expect(root.locator(".pdf-annotation-layer a").first()).toBeAttached();

    await root.locator(".pdf-sidebar-toggle-btn").click();
    await root.getByRole("button", { name: "Thumbnails" }).click();
    await expect(root.locator(".pdf-thumbnail")).toHaveCount(3);
    await expect
      .poll(() =>
        root
          .locator(".pdf-thumbnail-canvas")
          .first()
          .evaluate((canvas: HTMLCanvasElement) => canvas.width),
      )
      .toBeGreaterThan(0);

    await root.getByRole("button", { name: "Table of contents" }).click();
    await expect(root.locator(".pdf-outline-list")).toBeAttached();
    await root.getByRole("button", { name: "More document views" }).click();
    await root.getByRole("menuitemradio", { name: "Attachments" }).click();
    await expect(root.locator(".pdf-attachment")).toHaveCount(2);
    await expect
      .poll(() => page.evaluate(() => [...window.fixture.securityPolicyViolations]))
      .toEqual([]);
  });

  test("supports generated optional-content controls", async ({ page }) => {
    await page.evaluate(async () => {
      const root = document.querySelector("#primary")!;
      const ready = new Promise<void>((resolve, reject) => {
        root.addEventListener("pdf:ready", () => resolve(), { once: true });
        root.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      void window.fixture.primary.load("/ocg-fixture.pdf");
      await ready;
    });
    const root = page.locator("#primary");
    await root.locator(".pdf-sidebar-toggle-btn").click();
    await root.getByRole("button", { name: "More document views" }).click();
    await root.getByRole("menuitemradio", { name: "Layers" }).click();
    await expect(root.locator('.pdf-layers input[type="checkbox"]')).toHaveCount(3);
    await expect(root.locator(".pdf-layers-reset")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [...window.fixture.securityPolicyViolations]))
      .toEqual([]);
  });

  test("preserves controlled print UI", async ({ page }) => {
    const result = await page.evaluate(async () => {
      window.fixture.setPrintPermissions("high");
      const originalPrint = window.print;
      const lifecycle: string[] = [];
      window.print = () => {
        lifecycle.push("beforeprint");
        window.dispatchEvent(new Event("beforeprint"));
        lifecycle.push("afterprint");
        window.dispatchEvent(new Event("afterprint"));
      };
      try {
        const print = await window.fixture.primary.print({
          pages: [{ from: 1, to: 1 }],
          quality: { dpi: 72 },
          sheet: "a4",
          orientation: "landscape",
        });
        return {
          print,
          lifecycle,
          roots: document.querySelectorAll(".pdf-native-print-root").length,
          generatedUi: document.querySelectorAll("#primary .pdf-default-ui").length,
          violations: [...window.fixture.securityPolicyViolations],
        };
      } finally {
        window.print = originalPrint;
      }
    });
    expect(result.print).toEqual({ ok: true, status: "print-invoked", sheetCount: 1 });
    expect(result.lifecycle).toEqual(["beforeprint", "afterprint"]);
    expect(result.roots).toBe(0);
    expect(result.generatedUi).toBe(1);
    expect(result.violations).toEqual([]);
  });
});

test("generated print action opens only the accessible package setup controls", async ({
  page,
}) => {
  await page.locator("#primary .pdf-menu-toggle-btn").click();
  await expect(page.locator("#primary .pdf-menu-panel")).toBeVisible();
  await page.locator("#primary .pdf-print-btn").click();
  const dialog = page.locator("#primary .pdf-print-setup");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#primary .pdf-menu-panel")).toBeHidden();
  await expect(dialog.locator(".pdf-print-layout")).toBeHidden();
  await expect(dialog.locator(".pdf-print-sheet")).toBeVisible();
  await expect(dialog.locator(".pdf-print-quality")).toBeHidden();
  await expect(dialog.locator(".pdf-print-basic .pdf-print-control > select")).toHaveClass([
    "pdf-print-pages",
    "pdf-print-sheet",
  ]);
  await expect(dialog.locator(".pdf-print-submit")).toBeEnabled();
  await dialog.locator(".pdf-print-pages").selectOption("custom");
  await expect(dialog.locator(".pdf-print-range-wrap")).toBeVisible();
  expect(
    await dialog
      .locator(".pdf-print-range-wrap")
      .evaluate(
        element => element.previousElementSibling?.querySelector(".pdf-print-pages") !== null,
      ),
  ).toBe(true);
  const rangeInput = dialog.locator(".pdf-print-range");
  await rangeInput.fill("1");
  await rangeInput.press("Enter");
  await expect(rangeInput).not.toBeFocused();
  await expect(rangeInput).toHaveAttribute("enterkeyhint", "done");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".pdf-print-submit")).toBeEnabled();
  await dialog.locator(".pdf-print-pages").selectOption("all");
  const topBeforeExpansion = await dialog.evaluate(element => element.getBoundingClientRect().top);
  await dialog.locator(".pdf-print-more summary").click();
  await expect(dialog.locator(".pdf-print-quality")).toBeVisible();
  await expect(dialog.locator(".pdf-print-layout")).toBeVisible();
  await expect(dialog.locator(".pdf-print-more .pdf-print-sheet")).toHaveCount(0);
  const topAfterExpansion = await dialog.evaluate(element => element.getBoundingClientRect().top);
  expect(Math.abs(topAfterExpansion - topBeforeExpansion)).toBeLessThan(1);
  await expect(dialog.locator(".pdf-print-close")).toHaveAccessibleName("Close");
  await expect(dialog.locator(".pdf-print-progress")).toHaveAttribute(
    "aria-label",
    "Preparing print sheets",
  );
  await expect(dialog.locator('input[type="radio"]')).toHaveCount(0);
  await expect(dialog).not.toContainText(/destination|color|margin|printer/i);
  await expect(dialog).toContainText("Pages per sheet: 1");
  await expect(dialog).not.toContainText(
    "Controlled printing is unavailable on this browser or platform.",
  );
  await expect(dialog.locator('label[for$="-print-layout"]')).toHaveText("Pages per sheet");
  await expect(dialog.locator(".pdf-print-pages option")).toHaveText(["All", "Custom range"]);
  await expect(dialog.locator(".pdf-print-layout option")).toHaveText([
    "Automatic spreads",
    "Single page",
    "Two pages",
  ]);
  await expect(dialog.locator(".pdf-print-sheet option")).toHaveText([
    "A3",
    "A4",
    "A5",
    "US Letter",
    "US Legal",
    "Custom",
  ]);
  await expect(dialog.locator(".pdf-print-sheet")).toHaveValue("a4");
  await expect(dialog.locator(".pdf-print-page-scaling option")).toHaveText([
    "Fit to sheet",
    "Keep smaller pages at actual size",
  ]);
  await expect(dialog.locator(".pdf-print-page-scaling")).toHaveValue("fit");
  await expect(dialog.locator(".pdf-print-quality option")).toHaveText(["300 DPI", "600 DPI"]);
  await expect(dialog.locator(".pdf-print-quality")).toHaveValue("300");
  await dialog.locator(".pdf-print-sheet").selectOption("custom");
  const widthInput = dialog.locator(".pdf-print-sheet-width");
  await widthInput.focus();
  await widthInput.press("Enter");
  await expect(widthInput).not.toBeFocused();
  await expect(widthInput).toHaveAttribute("enterkeyhint", "done");
  await expect(dialog.locator(".pdf-print-submit")).toBeEnabled();
  await dialog.locator(".pdf-print-sheet").selectOption("a4");
  for (const name of ["layout", "sheet", "orientation", "page-scaling", "quality"]) {
    await expect(dialog.locator(`.pdf-print-${name}`)).toHaveAttribute(
      "aria-describedby",
      new RegExp(`-print-${name}-help$`),
    );
  }
  await expect(dialog.locator(".pdf-print-layout-help")).toContainText(
    '"Automatic spreads" uses two pages',
  );
  await expect(dialog.locator(".pdf-print-quality-help")).toContainText('"300 DPI" and "600 DPI"');
  await expect(dialog.locator(".pdf-print-sheet-help")).toContainText(
    '"Custom" accepts another paper size',
  );
  await expect(dialog.locator(".pdf-print-page-scaling-help")).toContainText(
    "Oversized pages are always reduced",
  );
  await expect(dialog.locator(".pdf-print-orientation-help")).toContainText(
    '"Automatic" follows single-page proportions',
  );
  await expect(dialog.locator(".pdf-print-submit")).toContainText("Open system print dialog");
  await expect(dialog.locator(".pdf-print-source")).toContainText("Open PDF in browser");
  await expect(dialog.locator(".pdf-print-source")).toBeHidden();
  await dialog.locator(".pdf-print-orientation").selectOption("portrait");
  await dialog.locator(".pdf-print-layout").selectOption("spread");
  await expect(dialog.locator(".pdf-print-orientation")).toHaveValue("auto");
  await expect(dialog.locator(".pdf-print-side select option")).toHaveText([
    "Automatic",
    "Right",
    "Left",
  ]);
  expect(
    await dialog
      .locator(".pdf-print-side")
      .evaluate(
        element => element.previousElementSibling?.querySelector(".pdf-print-layout") !== null,
      ),
  ).toBe(true);
});

test("print feedback flows without overlap and custom sheet controls stay within the dialog", async ({
  page,
}) => {
  await page.locator("#primary .pdf-menu-toggle-btn").click();
  await page.locator("#primary .pdf-print-btn").click();
  const dialog = page.locator("#primary .pdf-print-setup");
  await dialog.locator(".pdf-print-more summary").click();
  const sheet = dialog.locator(".pdf-print-sheet");
  await expect(dialog.locator(".pdf-print-progress")).toBeHidden();
  await expect(dialog.locator(".pdf-print-fallback-warning")).toBeHidden();
  await sheet.selectOption("custom");
  await expect(dialog.locator(".pdf-print-custom-sheet")).toBeVisible();

  const inspect = () =>
    dialog.evaluate(element => {
      const form = element.querySelector<HTMLFormElement>("form")!;
      const sheetControl = element
        .querySelector<HTMLSelectElement>(".pdf-print-sheet")!
        .closest<HTMLElement>(".pdf-print-control")!;
      const custom = element.querySelector<HTMLElement>(".pdf-print-custom-sheet")!;
      const status = element.querySelector<HTMLElement>(".pdf-print-status")!;
      const progress = element.querySelector<HTMLProgressElement>(".pdf-print-progress")!;
      const warning = element.querySelector<HTMLElement>(".pdf-print-fallback-warning")!;
      status.textContent = "Status text that wraps safely at narrow widths.";
      progress.hidden = false;
      warning.textContent = "Fallback warning that also wraps without covering the status.";
      warning.hidden = false;
      const statusRect = status.getBoundingClientRect();
      const progressRect = progress.getBoundingClientRect();
      const warningRect = warning.getBoundingClientRect();
      return {
        dialogOverflow: element.scrollWidth - element.clientWidth,
        formOverflow: form.scrollWidth - form.clientWidth,
        customOverflow: custom.scrollWidth - custom.clientWidth,
        customFollowsSheet: custom.previousElementSibling === sheetControl,
        customSharesRow:
          Math.abs(custom.getBoundingClientRect().top - sheetControl.getBoundingClientRect().top) <
          1,
        statusBeforeProgress: statusRect.bottom <= progressRect.top + 0.5,
        progressBeforeWarning: progressRect.bottom <= warningRect.top + 0.5,
      };
    });

  expect(await inspect()).toEqual({
    dialogOverflow: 0,
    formOverflow: 0,
    customOverflow: 0,
    customFollowsSheet: true,
    customSharesRow: true,
    statusBeforeProgress: true,
    progressBeforeWarning: true,
  });
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await inspect()).toEqual({
    dialogOverflow: 0,
    formOverflow: 0,
    customOverflow: 0,
    customFollowsSheet: true,
    customSharesRow: false,
    statusBeforeProgress: true,
    progressBeforeWarning: true,
  });
});

test("newer print setup input wins over an older asynchronous preflight", async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.fixture.setPrintPermissions("high");
    const viewer = window.fixture.primary;
    const original = viewer.preflightPrint.bind(viewer);
    const mutable = viewer as typeof viewer & { preflightPrint: typeof viewer.preflightPrint };
    mutable.preflightPrint = async (options = {}) => {
      const mode = typeof options.layout === "object" ? options.layout.mode : options.layout;
      await new Promise(resolve => setTimeout(resolve, mode === "single" ? 80 : 0));
      return original(options);
    };
    const button = document.querySelector<HTMLButtonElement>("#primary .pdf-print-btn")!;
    button.click();
    const dialog = document.querySelector<HTMLDialogElement>("#primary .pdf-print-setup")!;
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    const layout = dialog.querySelector<HTMLSelectElement>(".pdf-print-layout")!;
    const sheet = dialog.querySelector<HTMLSelectElement>(".pdf-print-sheet")!;
    const quality = dialog.querySelector<HTMLSelectElement>(".pdf-print-quality")!;
    sheet.value = "a4";
    quality.value = "300";
    layout.value = "single";
    form.dispatchEvent(new Event("change", { bubbles: true }));
    layout.value = "spread";
    form.dispatchEvent(new Event("change", { bubbles: true }));
    const expected = await original({
      layout: { mode: "spread", firstPageSide: "auto" },
      sheet: "a4",
      quality: { dpi: 300 },
    });
    await new Promise(resolve => setTimeout(resolve, 120));
    const status = dialog.querySelector<HTMLElement>(".pdf-print-status")!.textContent ?? "";
    mutable.preflightPrint = original;
    dialog.close();
    return { status, expected };
  });
  expect(result.expected).toMatchObject({ ok: true, sheetCount: 2, layout: "spread" });
  expect(result.status).toContain("2 landscape sheets");
});

test("print setup reinitialization retains one listener lifetime and restores focus", async ({
  page,
}) => {
  await expect(
    page.evaluate(() => window.fixture.probePrintSetupReinitialization()),
  ).resolves.toEqual({
    firstCalls: 1,
    secondCalls: 1,
    focusRestored: true,
  });
});

test("print setup runtime text refreshes feedback and active dialog state without work", async ({
  page,
}) => {
  await expect(page.evaluate(() => window.fixture.probePrintSetupUiTextRefresh())).resolves.toEqual(
    {
      cachedPreflightReapplied: true,
      portraitTransportGuidance: true,
      invalidRefresh: true,
      installedProgressAriaRefresh: true,
      hostProgressAriaUntouched: true,
      preserved: true,
      preparingRefresh: true,
    },
  );
});

test("openPrintSource reserves and navigates a tab without invoking print", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const original = window.open;
    let opened = "";
    let printed = 0;
    window.open = (() => ({
      opener: window,
      closed: false,
      close() {},
      location: {
        replace(value: string) {
          opened = value;
        },
      },
      print() {
        printed++;
      },
    })) as typeof window.open;
    try {
      return {
        result: await window.fixture.primary.openPrintSource({ document: "original" }),
        opened,
        printed,
      };
    } finally {
      window.open = original;
    }
  });
  expect(result.result).toEqual({ ok: true, status: "source-opened", warnings: [] });
  expect(result.opened).toContain("/fixture.pdf");
  expect(result.printed).toBe(0);
});

test("openPrintSource validates nested print options before reserving a tab", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const original = window.open;
    let reservations = 0;
    window.open = (() => {
      reservations++;
      return null;
    }) as typeof window.open;
    try {
      let error = "";
      try {
        await window.fixture.primary.openPrintSource({
          print: { quality: { dpi: 1 } },
        });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      return { reservations, error };
    } finally {
      window.open = original;
    }
  });

  expect(result.reservations).toBe(0);
  expect(result.error).toContain("between 72 and 600");
});

test("print APIs accept an AbortSignal created in another window realm", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const frameWindow = frame.contentWindow as Window & typeof globalThis;
      const controller = new frameWindow.AbortController();
      return await window.fixture.primary.preflightPrint({ signal: controller.signal });
    } finally {
      frame.remove();
    }
  });

  expect(result.ok).toBe(true);
});

test("openPrintSource reserves synchronously before delayed permission and closes on denial", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    window.fixture.setPrintPermissions("denied");
    let release!: () => void;
    let permissionEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      permissionEntered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    window.fixture.onNextPrintPermissionRead(() => {
      permissionEntered();
      return gate;
    });
    const original = window.open;
    let reservations = 0;
    let closed = false;
    let navigated = false;
    window.open = (() => {
      reservations++;
      return {
        opener: window,
        closed: false,
        close() {
          closed = true;
        },
        location: {
          replace() {
            navigated = true;
          },
        },
      };
    }) as unknown as typeof window.open;
    try {
      const pending = window.fixture.primary.openPrintSource({ document: "original" });
      const reservedBeforeAwait = reservations === 1;
      await entered;
      const retainedWhilePending = !closed && !navigated;
      release();
      return {
        result: await pending,
        reservedBeforeAwait,
        retainedWhilePending,
        closed,
        navigated,
      };
    } finally {
      window.open = original;
    }
  });
  expect(result).toEqual({
    result: { ok: false, reason: "disabled" },
    reservedBeforeAwait: true,
    retainedWhilePending: true,
    closed: true,
    navigated: false,
  });
});

test("authenticated source fallback materializes or uses an explicit host resolver and reports semantic losses", async ({
  page,
}) => {
  const result = await page.evaluate(() => window.fixture.probeAuthenticatedPrintSource());
  expect(result.materialized).toEqual({
    ok: true,
    status: "source-opened",
    warnings: ["custom-range-lost", "spread-parity-lost"],
  });
  expect(result.materializedNavigation).toMatch(/^blob:/);
  expect(result.resolved).toEqual({ ok: true, status: "source-opened", warnings: [] });
  expect(result.resolvedNavigation).toContain("resolved-auth-source");
});

test("worker is active and page canvases render", async ({ page }) => {
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .first()
        .evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0),
    )
    .toBe(true);
  const dimensions = await page
    .locator(".pdf-page canvas")
    .first()
    .evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
    }));
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height).toBeGreaterThan(0);
});

test("maximum zoom keeps each canvas within backing-store safety limits", async ({ page }) => {
  await page.evaluate(() => window.fixture.primary.zoomTo(100));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.scale)).toBe(10);
  const canvases = page.locator("#primary .pdf-page canvas");
  await expect
    .poll(() =>
      canvases.evaluateAll(elements =>
        elements
          .map(element => element as HTMLCanvasElement)
          .filter(canvas => canvas.width > 0 && canvas.height > 0)
          .map(canvas => ({ width: canvas.width, height: canvas.height })),
      ),
    )
    .not.toEqual([]);

  const dimensions = await canvases.evaluateAll(elements =>
    elements
      .map(element => element as HTMLCanvasElement)
      .filter(canvas => canvas.width > 0 && canvas.height > 0)
      .map(canvas => ({ width: canvas.width, height: canvas.height })),
  );
  expect(dimensions.some(({ width, height }) => width * height > 16_777_216)).toBe(true);
  expect(
    dimensions.every(
      ({ width, height }) => width <= 8192 && height <= 8192 && width * height <= 24_000_000,
    ),
  ).toBe(true);
});

test.describe("@mobile mobile embedded viewer behavior", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile project only");
  });

  test("keeps chrome root-contained and supports tap focus at 320px", async ({ page }) => {
    await page.locator("#primary").evaluate(root => {
      root.setAttribute("style", "width: 320px; height: 600px; flex: none");
    });
    await page.getByRole("button", { name: "Search" }).tap();
    await expect(page.locator("#primary .pdf-search-input")).toBeFocused();
    await page.getByRole("button", { name: "Document navigation" }).tap();
    await page.getByRole("button", { name: "PDF options" }).tap();
    const layout = await page.locator("#primary").evaluate(root => {
      const rootRect = root.getBoundingClientRect();
      const controls = root.querySelector<HTMLElement>(".pdf-controls-toolbar")!;
      const menu = root.querySelector<HTMLElement>(".pdf-menu-panel")!;
      const sidebar = root.querySelector<HTMLElement>(".pdf-sidebar")!;
      const menuRect = menu.getBoundingClientRect();
      return {
        rootOverflow: root.scrollWidth <= root.clientWidth,
        controlsWidth: controls.getBoundingClientRect().width,
        sidebarWidth: sidebar.getBoundingClientRect().width,
        rootWidth: rootRect.width,
        menuLeft: menuRect.left,
        menuRight: menuRect.right,
        rootLeft: rootRect.left,
        rootRight: rootRect.right,
        menuPosition: getComputedStyle(menu).position,
        touchAction: getComputedStyle(root.querySelector<HTMLElement>(".pdf-container")!)
          .touchAction,
        overscrollBehavior: getComputedStyle(root.querySelector<HTMLElement>(".pdf-container")!)
          .overscrollBehavior,
      };
    });
    expect(layout.rootOverflow).toBe(true);
    expect(layout.controlsWidth).toBeLessThanOrEqual(layout.rootWidth);
    expect(layout.sidebarWidth).toBeLessThanOrEqual(layout.rootWidth);
    expect(layout.menuLeft).toBeGreaterThanOrEqual(layout.rootLeft - 1);
    expect(layout.menuRight).toBeLessThanOrEqual(layout.rootRight + 1);
    expect(layout.menuPosition).toBe("absolute");
    expect(layout.touchAction).toBe("pan-x pan-y");
    expect(layout.overscrollBehavior).toBe("contain");
  });

  test("uses touch-derived mobile zoom bounds without changing the user agent", async ({
    page,
  }) => {
    await page.evaluate(() => window.fixture.primary.zoomTo(100));
    await expect.poll(() => page.evaluate(() => window.fixture.primary.state.scale)).toBe(4);
  });

  test("presents settled canvases at the exact mobile render DPR", async ({ page }) => {
    const canvas = page.locator("#primary .pdf-page canvas").first();
    await expect
      .poll(() =>
        canvas.evaluate((element: HTMLCanvasElement, ratioEpsilon) => {
          const failures: string[] = [];
          if (element.width <= 0 || element.height <= 0) return ["missing settled canvas"];
          const pageNo = Number(element.closest<HTMLElement>(".pdf-page")!.dataset.page);
          const completion = [...window.fixture.logs]
            .reverse()
            .find(
              entry =>
                (entry.event === "page-render-started" ||
                  entry.event === "page-render-completed") &&
                Number(entry.details?.pageNo) === pageNo,
            );
          if (completion?.event !== "page-render-completed")
            return ["latest render is not completed"];
          const start = window.fixture.logs.find(
            entry =>
              entry.event === "page-render-started" &&
              entry.details?.operationId === completion.details?.operationId,
          );
          if (!start) return ["missing matching start diagnostics"];
          const pageEl = element.closest<HTMLElement>(".pdf-page")!;
          const renderDpr = Number(start?.details?.renderDpr);
          const horizontalRatio = element.width / Number.parseFloat(element.style.width);
          const verticalRatio = element.height / Number.parseFloat(element.style.height);
          const horizontalSurplus =
            Number.parseFloat(element.style.width) - Number.parseFloat(pageEl.style.width);
          const verticalSurplus =
            Number.parseFloat(element.style.height) - Number.parseFloat(pageEl.style.height);
          if (!(renderDpr > 1)) failures.push(`render DPR is ${renderDpr}`);
          if (
            Math.abs(horizontalRatio - renderDpr) >= ratioEpsilon ||
            Math.abs(verticalRatio - renderDpr) >= ratioEpsilon
          ) {
            failures.push("presentation ratio differs from render DPR");
          }
          if (
            horizontalSurplus < -1 / 64 ||
            verticalSurplus < -1 / 64 ||
            horizontalSurplus >= 1 / renderDpr ||
            verticalSurplus >= 1 / renderDpr
          ) {
            failures.push("canvas surplus is outside one render pixel");
          }
          return failures;
        }, CSSOM_DPR_RATIO_EPSILON),
      )
      .toEqual([]);
  });

  test("preserves ready state, page, fit, and sidebar mode through orientation resize", async ({
    page,
  }) => {
    const fitBefore = await page.evaluate(() => window.fixture.primary.state.fitMode);
    await page.getByRole("button", { name: "Document navigation" }).tap();
    await page.getByRole("button", { name: "Thumbnails" }).tap();
    await page.getByRole("button", { name: "Next page" }).tap();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
    await expect(page.locator("#primary .pdf-page-number-input")).toHaveValue("2");
    await expect(
      page.locator('#primary .pdf-sidebar-view-button[data-pdf-sidebar-view="thumbnails"]'),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.fixture.primary.state.fitMode)).toBe(fitBefore);
  });

  test("keeps synthetic pinch selection bounded after a one-pointer sequence", async ({ page }) => {
    const viewport = page.locator("#primary .pdf-container");
    const result = await viewport.evaluate(async container => {
      const marker = document.createElement("span");
      marker.textContent = "selection";
      container.append(marker);
      const range = document.createRange();
      range.selectNodeContents(marker);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      const dispatch = (type: string, pointerId: number, x: number, y: number) =>
        container.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      dispatch("pointerdown", 1, 100, 100);
      dispatch("pointermove", 1, 100, 150);
      dispatch("pointerup", 1, 100, 150);
      dispatch("pointerdown", 2, 100, 100);
      dispatch("pointerdown", 3, 200, 100);
      const active = container.classList.contains("pdf-pinch-active");
      dispatch("pointermove", 3, 240, 100);
      dispatch("pointerup", 3, 240, 100);
      dispatch("pointerup", 2, 100, 100);
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {
        active,
        released: !container.classList.contains("pdf-pinch-active"),
        selection: document.getSelection()?.rangeCount ?? 0,
      };
    });
    expect(result).toEqual({ active: true, released: true, selection: 1 });
  });

  test("supports touch activation for internal links and AcroForm controls", async ({ page }) => {
    await page
      .locator("#primary .linkAnnotation[data-internal-link] > a.pdf-annotation-link")
      .tap();
    await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(2);

    await page.evaluate(() => window.fixture.primary.load("/acroform-fixture.pdf"));
    await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
    const text = page.locator("#primary .textWidgetAnnotation input").first();
    const checkbox = page.locator("#primary .buttonWidgetAnnotation.checkBox input").first();
    const select = page.locator("#primary .choiceWidgetAnnotation select").first();
    await text.tap();
    await expect(text).toBeFocused();
    await text.fill("Mobile value");
    await checkbox.tap();
    await expect(checkbox).toBeFocused();
    await select.tap();
    await select.selectOption("three");
    await expect(select).toBeFocused();
    const focusedElementId = await select.getAttribute("data-element-id");
    expect(focusedElementId).not.toBeNull();
    await page.evaluate(() => window.fixture.primary.rotateBy(90));
    await expect(text).toHaveValue("Mobile value");
    await expect(checkbox).not.toBeChecked();
    await expect(select).toHaveValue("three");
    expect(
      await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset.elementId ?? null,
      ),
    ).toBe(focusedElementId);
  });

  test("keeps RTL panels and reduced-motion dialog feedback reachable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#primary .pdf-default-ui").evaluate(root => {
      root.setAttribute("dir", "rtl");
    });
    await page.getByRole("button", { name: "Document navigation" }).tap();
    const sidebarBounds = await page.locator("#primary").evaluate(root => {
      const rootRect = root.getBoundingClientRect();
      const sidebar = root.querySelector<HTMLElement>(".pdf-sidebar")!;
      const sidebarRect = sidebar.getBoundingClientRect();
      const panel = root.querySelector<HTMLElement>(".pdf-sidebar-panel:not([hidden])")!;
      return {
        rightAligned: Math.abs(rootRect.right - sidebarRect.right) <= 1,
        contained: sidebarRect.left >= rootRect.left - 1 && sidebarRect.right <= rootRect.right + 1,
        animation: getComputedStyle(panel).animationName,
      };
    });
    expect(sidebarBounds).toEqual({ rightAligned: true, contained: true, animation: "none" });

    await page.getByRole("button", { name: "Close" }).tap();
    await page.getByRole("button", { name: "PDF options" }).tap();
    await page.locator("#primary .pdf-document-information-btn").tap();
    const dialog = page.getByRole("dialog", { name: "Document information" });
    await expect(dialog).toBeVisible();
    const dialogState = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        contained:
          rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        transition: getComputedStyle(element).transitionDuration,
      };
    });
    expect(dialogState).toEqual({ contained: true, transition: "0s" });
    await dialog.getByRole("button", { name: "OK" }).tap();
  });
});

test("page wrappers keep an opaque paper surface behind prerendered canvases", async ({ page }) => {
  const background = await page
    .locator("#primary .pdf-page")
    .first()
    .evaluate(pageEl => getComputedStyle(pageEl).backgroundColor);
  expect(background).toBe("rgb(255, 255, 255)");
});

test("page canvases do not retain compositor promotion hints", async ({ page }) => {
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-page canvas")
        .evaluateAll(
          canvases => canvases.filter(canvas => (canvas as HTMLCanvasElement).width > 0).length,
        ),
    )
    .toBeGreaterThan(0);
  expect(
    await page
      .locator("#primary .pdf-page canvas")
      .evaluateAll(canvases =>
        canvases.every(canvas => (canvas as HTMLElement).style.willChange === ""),
      ),
  ).toBe(true);
});

test("settled page canvases cover fractional wrappers at their exact render DPR", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.locator("#primary .pdf-page").evaluateAll((pageEls, ratioEpsilon) => {
        const failures: string[] = [];
        if (pageEls.length !== 3) failures.push(`expected 3 pages, received ${pageEls.length}`);
        for (const pageEl of pageEls) {
          const pageNo = Number((pageEl as HTMLElement).dataset.page);
          const canvas = pageEl.querySelector<HTMLCanvasElement>("canvas");
          if (!canvas || !canvas.isConnected || canvas.width <= 0 || canvas.height <= 0) {
            failures.push(`page ${pageNo}: missing settled canvas`);
            continue;
          }
          const latest = [...window.fixture.logs]
            .reverse()
            .find(
              entry =>
                (entry.event === "page-render-started" ||
                  entry.event === "page-render-completed") &&
                Number(entry.details?.pageNo) === pageNo,
            );
          if (latest?.event !== "page-render-completed") {
            failures.push(`page ${pageNo}: latest render is not completed`);
            continue;
          }
          const start = window.fixture.logs.find(
            entry =>
              entry.event === "page-render-started" &&
              entry.details?.operationId === latest.details?.operationId,
          )?.details;
          if (!start) {
            failures.push(`page ${pageNo}: missing matching start diagnostics`);
            continue;
          }
          const renderDpr = Number(start.renderDpr);
          const canvasStyle = getComputedStyle(canvas);
          const pageRect = pageEl.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          const annotationRect = pageEl
            .querySelector<HTMLElement>(".pdf-annotation-layer")
            ?.getBoundingClientRect();
          const textRect = pageEl
            .querySelector<HTMLElement>(".pdf-text-layer")
            ?.getBoundingClientRect();
          if (
            Math.abs(canvas.width / canvasRect.width - renderDpr) > ratioEpsilon ||
            Math.abs(canvas.height / canvasRect.height - renderDpr) > ratioEpsilon
          ) {
            failures.push(
              `page ${pageNo}: backing-to-presentation ratio differs from DPR ${renderDpr}`,
            );
          }
          if (
            canvasRect.width + 1 / 64 < pageRect.width ||
            canvasRect.height + 1 / 64 < pageRect.height ||
            canvasRect.width - pageRect.width >= 1 / renderDpr + 1 / 64 ||
            canvasRect.height - pageRect.height >= 1 / renderDpr + 1 / 64
          ) {
            failures.push(`page ${pageNo}: canvas does not cover the fractional wrapper`);
          }
          if (
            Math.abs(pageRect.left - canvasRect.left) > 1 / 64 ||
            Math.abs(pageRect.top - canvasRect.top) > 1 / 64
          ) {
            failures.push(`page ${pageNo}: canvas origin differs from wrapper`);
          }
          if (annotationRect && Math.abs(annotationRect.width - pageRect.width) >= 1) {
            failures.push(`page ${pageNo}: annotation geometry differs from wrapper`);
          }
          if (textRect && Math.abs(textRect.width - pageRect.width) >= 1) {
            failures.push(`page ${pageNo}: text geometry differs from wrapper`);
          }
          if (canvasStyle.position !== "absolute" || canvasStyle.contain !== "content") {
            failures.push(`page ${pageNo}: canvas functional CSS is missing`);
          }
        }
        return failures;
      }, CSSOM_DPR_RATIO_EPSILON),
    )
    .toEqual([]);
});

test("visible first renders are buffered while offscreen first renders use attached canvases", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry => entry.event === "page-render-started" && entry.details?.visible === false,
        ),
      ),
    )
    .toBe(true);

  const initialBitmapStrategies = await page.evaluate(() =>
    window.fixture.logs
      .filter(
        entry =>
          entry.event === "page-render-started" && entry.details?.replacesExistingBitmap === false,
      )
      .map(entry => ({
        visible: entry.details?.visible,
        commitStrategy: entry.details?.commitStrategy,
      })),
  );

  expect(
    initialBitmapStrategies.some(
      render => render.visible === true && render.commitStrategy === "temporary-canvas",
    ),
  ).toBe(true);
  expect(
    initialBitmapStrategies.some(
      render => render.visible === false && render.commitStrategy === "attached-canvas",
    ),
  ).toBe(true);
});

test("settled offscreen first renders do not destabilize the render plan", async ({ page }) => {
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-page canvas")
        .evaluateAll(
          canvases => canvases.filter(canvas => (canvas as HTMLCanvasElement).width > 0).length,
        ),
    )
    .toBeGreaterThan(1);
  await page.waitForTimeout(100);

  const rerendersBeforeIdle = await page.evaluate(
    () =>
      window.fixture.logs.filter(
        entry =>
          entry.event === "page-render-completed" && entry.details?.replacedExistingBitmap === true,
      ).length,
  );
  await page.waitForTimeout(750);
  const rerendersAfterIdle = await page.evaluate(
    () =>
      window.fixture.logs.filter(
        entry =>
          entry.event === "page-render-completed" && entry.details?.replacedExistingBitmap === true,
      ).length,
  );

  expect(rerendersAfterIdle).toBe(rerendersBeforeIdle);
});

test("same-row-range pixel scrolling preserves rendered output", async ({ page }) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await expect
    .poll(() =>
      viewport.evaluate((container: HTMLElement) =>
        [...container.querySelectorAll<HTMLCanvasElement>(".pdf-page canvas")].every(
          canvas => canvas.width > 0 && canvas.height > 0,
        ),
      ),
    )
    .toBe(true);
  const before = await viewport.evaluate((container: HTMLElement) => ({
    scrollTop: container.scrollTop,
    canvases: [...container.querySelectorAll<HTMLCanvasElement>(".pdf-page canvas")].map(
      canvas => ({ width: canvas.width, height: canvas.height }),
    ),
  }));
  const rerendersBefore = await page.evaluate(
    () =>
      window.fixture.logs.filter(
        entry =>
          entry.event === "page-render-completed" && entry.details?.replacedExistingBitmap === true,
      ).length,
  );

  await viewport.evaluate((container: HTMLElement) => {
    container.scrollTop += 1;
  });
  await expect
    .poll(() => viewport.evaluate((container: HTMLElement) => container.scrollTop))
    .toBe(before.scrollTop + 1);
  await page.waitForTimeout(50);

  const after = await viewport.evaluate((container: HTMLElement) => ({
    canvases: [...container.querySelectorAll<HTMLCanvasElement>(".pdf-page canvas")].map(
      canvas => ({ width: canvas.width, height: canvas.height }),
    ),
  }));
  expect(after.canvases).toEqual(before.canvases);
  expect(
    await page.evaluate(
      () =>
        window.fixture.logs.filter(
          entry =>
            entry.event === "page-render-completed" &&
            entry.details?.replacedExistingBitmap === true,
        ).length,
    ),
  ).toBe(rerendersBefore);
});

test("render motion follows scroll direction and returns to stationary after idle", async ({
  page,
}) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await expect
    .poll(() =>
      viewport.evaluate((container: HTMLElement) =>
        [...container.querySelectorAll<HTMLCanvasElement>(".pdf-page canvas")].every(
          canvas => canvas.width > 0 && canvas.height > 0,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.fixture.logs.length = 0;
  });

  await viewport.evaluate((container: HTMLElement) => {
    container.scrollTop += 200;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry => entry.event === "render-motion-changed" && entry.details?.motion === "forward",
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry =>
            entry.event === "render-motion-changed" &&
            entry.details?.motion === "stationary" &&
            entry.details?.reason === "scroll-idle",
        ),
      ),
    )
    .toBe(true);

  await viewport.evaluate((container: HTMLElement) => {
    container.scrollTop -= 100;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          entry => entry.event === "render-motion-changed" && entry.details?.motion === "backward",
        ),
      ),
    )
    .toBe(true);
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() =>
      window.fixture.logs.filter(entry => entry.event === "page-render-started"),
    ),
  ).toEqual([]);
});

test("Ctrl-wheel gesture changes zoom without navigating the browser", async ({ page }) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await viewport.hover();
  const before = await page.evaluate(() => window.fixture.primary.state.scale);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.scale))
    .toBeGreaterThan(before);
});

test("high-resolution touchpad pinch wheel events produce a bounded visible zoom", async ({
  page,
}) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  const before = await page.evaluate(() => window.fixture.primary.state.scale);

  const dispatchedEvent = await viewport.evaluate((container: HTMLElement) => {
    let deltaY = 0;
    let deltaMode = -1;
    for (let index = 0; index < 3; index++) {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: container.getBoundingClientRect().left + container.clientWidth / 2,
        clientY: container.getBoundingClientRect().top + container.clientHeight / 2,
        ctrlKey: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -1,
      });
      deltaY = event.deltaY;
      deltaMode = event.deltaMode;
      container.dispatchEvent(event);
    }
    return { deltaY, deltaMode };
  });
  expect(dispatchedEvent).toEqual({ deltaY: -1, deltaMode: 0 });

  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.scale))
    .toBeGreaterThan(before * 1.02);
  expect(await page.evaluate(() => window.fixture.primary.state.scale)).toBeLessThan(1.06);
});

test("page chrome receives canonical scale when transient zoom commits", async ({ page }) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await viewport.hover();
  const before = await page.evaluate(() => window.fixture.primary.state.scale);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");

  await expect
    .poll(() => page.evaluate(scale => window.fixture.primary.state.scale !== scale, before))
    .toBe(true);
  const pageChrome = await page.locator("#primary .pdf-page").evaluateAll(elements =>
    elements.map(element => ({
      pageScale: (element as HTMLElement).style.getPropertyValue("--pdf-page-scale"),
      boxShadow: getComputedStyle(element).boxShadow,
    })),
  );
  const canonicalScale = await page.evaluate(() => window.fixture.primary.state.scale);
  expect(pageChrome.every(({ pageScale }) => Number(pageScale) === canonicalScale)).toBe(true);
  expect(pageChrome.every(({ boxShadow }) => boxShadow !== "none")).toBe(true);
});

test("page gaps follow displayed page size and retain configured bounds", async ({ page }) => {
  const fitted = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>("#primary .pdf-row")!;
    const page = row.querySelector<HTMLElement>(".pdf-page")!;
    const displayedShortEdge = Math.min(
      Number.parseFloat(page.style.width),
      Number.parseFloat(page.style.height),
    );
    return {
      scale: window.fixture.primary.state.scale,
      verticalGap: Number.parseFloat(row.style.marginBottom),
      expectedGap: Math.max(1, Math.min(256, (16 * displayedShortEdge) / 600)),
    };
  });
  expect(Math.abs(fitted.verticalGap - fitted.expectedGap)).toBeLessThan(0.001);

  await page.evaluate(scale => window.fixture.primary.zoomTo(scale * 1.5), fitted.scale);
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-row")
        .first()
        .evaluate(row => {
          const page = row.querySelector<HTMLElement>(".pdf-page")!;
          const displayedShortEdge = Math.min(
            Number.parseFloat(page.style.width),
            Number.parseFloat(page.style.height),
          );
          const gap = Number.parseFloat(row.style.marginBottom);
          const expected = Math.max(1, Math.min(256, (16 * displayedShortEdge) / 600));
          return Math.abs(gap - expected);
        }),
    )
    .toBeLessThan(0.001);

  await page.evaluate(() => window.fixture.primary.fit());
  await expect
    .poll(() =>
      page
        .locator("#primary .pdf-row")
        .first()
        .evaluate(row => {
          const page = row.querySelector<HTMLElement>(".pdf-page")!;
          const displayedShortEdge = Math.min(
            Number.parseFloat(page.style.width),
            Number.parseFloat(page.style.height),
          );
          const gap = Number.parseFloat(row.style.marginBottom);
          const expected = Math.max(1, Math.min(256, (16 * displayedShortEdge) / 600));
          return Math.abs(gap - expected);
        }),
    )
    .toBeLessThan(0.001);

  await page.addStyleTag({
    content: "#secondary { --pdf-page-hgap: 0px; --pdf-page-vgap: 0px; }",
  });
  await page.evaluate(() => window.fixture.addSecondary());
  await expect
    .poll(() => page.evaluate(() => window.fixture.secondary?.state.status))
    .toBe("ready");
  await expect(page.locator("#secondary .pdf-row").first()).toHaveCSS("margin-bottom", "0px");
});

test("book singleton zoom uses the widest-row envelope without an initial horizontal jump", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.fixture.primary.setPageLayout("book");
    await window.fixture.primary.zoomTo(1);
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.pageLayout))
    .toBe("book");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.scale)).toBe(1);

  const result = await page
    .locator("#primary .pdf-container")
    .evaluate(async (container: HTMLElement) => {
      const firstPage = container.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
      const spread = container.querySelector<HTMLElement>(".pdf-row:nth-child(2)");
      const content = container.querySelector<HTMLElement>(".pdf-content");
      if (!firstPage || !spread || !content) throw new Error("Missing book-mode geometry");
      container.scrollLeft = 0;

      const viewportRect = container.getBoundingClientRect();
      const before = firstPage.getBoundingClientRect();
      const center = {
        x:
          (Math.max(before.left, viewportRect.left) + Math.min(before.right, viewportRect.right)) /
          2,
        y: Math.max(
          viewportRect.top + 60,
          Math.min(before.top + before.height / 2, viewportRect.bottom - 60),
        ),
      };
      const pointer = (type: string, pointerId: number, x: number, isPrimary: boolean) => {
        container.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "touch",
            isPrimary,
            clientX: x,
            clientY: center.y,
          }),
        );
      };

      pointer("pointerdown", 91, center.x - 40, true);
      pointer("pointerdown", 92, center.x + 40, false);
      pointer("pointermove", 91, center.x - 40, true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const factorOne = firstPage.getBoundingClientRect();

      pointer("pointermove", 91, center.x - 44, true);
      pointer("pointermove", 92, center.x + 44, false);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const zoomed = firstPage.getBoundingClientRect();
      const factor = zoomed.width / before.width;
      const expectedZoomedLeft = center.x - factor * (center.x - before.left);

      pointer("pointerup", 92, center.x + 44, false);
      pointer("pointerup", 91, center.x - 44, true);
      return {
        firstPageFits: before.width < container.clientWidth,
        laterSpreadOverflows: spread.getBoundingClientRect().width > container.clientWidth,
        contentOverflows: content.getBoundingClientRect().width > container.clientWidth,
        factorOneShift: factorOne.left - before.left,
        zoomedLeft: zoomed.left,
        expectedZoomedLeft,
      };
    });

  expect(result.firstPageFits).toBe(true);
  expect(result.laterSpreadOverflows).toBe(true);
  expect(result.contentOverflows).toBe(true);
  expect(Math.abs(result.factorOneShift), JSON.stringify(result)).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(result.zoomedLeft - result.expectedZoomedLeft),
    JSON.stringify(result),
  ).toBeLessThanOrEqual(1);
});

test("transient zoom releases non-desired stale-scale canvases after its grace period without scrolling", async ({
  page,
}) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await viewport.hover();
  const initialScale = await page.evaluate(() => window.fixture.primary.state.scale);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect
    .poll(() => page.evaluate(scale => window.fixture.primary.state.scale !== scale, initialScale))
    .toBe(true);

  // Old-scale canvases remain briefly as visual placeholders.
  await expect
    .poll(() =>
      page.evaluate(
        scale =>
          window.fixture.logs.some(
            entry =>
              entry.event === "page-render-completed" &&
              entry.details?.replacedExistingBitmap === true &&
              entry.details?.previousScale === scale,
          ),
        initialScale,
      ),
    )
    .toBe(true);

  // The grace-period timer must reconcile by itself; no scroll is performed.
  // Optional pages may remain rendered, but they must now be current-scale
  // prerenders rather than old-scale placeholders that rerender on first view.
  await page.waitForTimeout(1_500);
  const oldScaleRerendersBeforeScroll = await page.evaluate(
    scale =>
      window.fixture.logs.filter(
        entry =>
          entry.event === "page-render-completed" &&
          entry.details?.replacedExistingBitmap === true &&
          entry.details?.previousScale === scale,
      ).length,
    initialScale,
  );
  await viewport.evaluate((container: HTMLElement) => {
    container.scrollTop = container.scrollHeight;
  });
  await page.waitForTimeout(500);
  const oldScaleRerendersAfterScroll = await page.evaluate(
    scale =>
      window.fixture.logs.filter(
        entry =>
          entry.event === "page-render-completed" &&
          entry.details?.replacedExistingBitmap === true &&
          entry.details?.previousScale === scale,
      ).length,
    initialScale,
  );
  expect(oldScaleRerendersAfterScroll).toBe(oldScaleRerendersBeforeScroll);
});

test("transient zoom crosses the horizontal overflow threshold without exposing blank sides", async ({
  page,
}) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  const box = await viewport.boundingBox();
  if (!box) throw new Error("Missing PDF viewport bounds");

  // Begin from a wide row and put the pointer near its right edge. Repeated
  // wheel events exercise both the transient transform and its final commit.
  await page.evaluate(() => window.fixture.primary.zoomTo(2));
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 180);
  await page.keyboard.up("Control");

  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.scale)).toBeLessThan(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>("#primary .pdf-container");
        const row = container?.querySelector<HTMLElement>(".pdf-row");
        if (!container || !row) return null;
        const containerRect = container.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        return {
          scale: window.fixture.primary.state.scale,
          overflowX: container.style.overflowX,
          scrollLeft: container.scrollLeft,
          leftGap: rowRect.left - containerRect.left,
          rightGap: containerRect.right - rowRect.right,
        };
      }),
    )
    .toMatchObject({ overflowX: "hidden", scrollLeft: 0 });

  const settled = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
    const row = container.querySelector<HTMLElement>(".pdf-row")!;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      scale: window.fixture.primary.state.scale,
      leftGap: rowRect.left - containerRect.left,
      rightGap: containerRect.right - rowRect.right,
    };
  });
  expect(Math.abs(settled.leftGap - settled.rightGap)).toBeLessThanOrEqual(1);
});

test("transient zoom preserves a moving gesture anchor that begins in a page gap", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.zoomTo(1));
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.scale)).toBe(1);

  const result = await page
    .locator("#primary .pdf-container")
    .evaluate(async (container: HTMLElement) => {
      const pages = [...container.querySelectorAll<HTMLElement>(".pdf-page")];
      const previous = pages.at(-2);
      const anchored = pages.at(-1);
      if (!previous || !anchored) throw new Error("Missing page-gap geometry");

      const gapContentY = (previous.offsetTop + previous.offsetHeight + anchored.offsetTop) / 2;
      container.scrollTop = gapContentY - container.clientHeight / 2;
      const containerRect = container.getBoundingClientRect();
      const previousRect = previous.getBoundingClientRect();
      const anchoredRect = anchored.getBoundingClientRect();
      const startCenter = {
        x: containerRect.left + container.clientWidth / 2,
        y: (previousRect.bottom + anchoredRect.top) / 2,
      };
      if (document.elementFromPoint(startCenter.x, startCenter.y)?.closest(".pdf-page")) {
        throw new Error("Synthetic pinch center is inside a page");
      }

      const fromScale = window.fixture.primary.state.scale;
      const dispatch = (
        type: string,
        pointerId: number,
        x: number,
        y: number,
        isPrimary: boolean,
      ) => {
        container.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "touch",
            isPrimary,
            clientX: x,
            clientY: y,
          }),
        );
      };

      dispatch("pointerdown", 71, startCenter.x - 50, startCenter.y, true);
      dispatch("pointerdown", 72, startCenter.x + 50, startCenter.y, false);
      dispatch("pointermove", 71, startCenter.x - 70, startCenter.y - 30, true);
      dispatch("pointermove", 72, startCenter.x + 100, startCenter.y + 10, false);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const transientPageRect = anchored.getBoundingClientRect();
      dispatch("pointerup", 72, startCenter.x + 100, startCenter.y + 10, false);

      const toScale = window.fixture.primary.state.scale;
      const committedPageRect = anchored.getBoundingClientRect();
      dispatch("pointerup", 71, startCenter.x - 70, startCenter.y - 30, true);
      await new Promise(resolve => setTimeout(resolve, 500));
      const settledPageRect = anchored.getBoundingClientRect();
      return {
        fromScale,
        toScale,
        transientPageRect: { left: transientPageRect.left, top: transientPageRect.top },
        committedPageRect: { left: committedPageRect.left, top: committedPageRect.top },
        leftShift: committedPageRect.left - transientPageRect.left,
        topShift: committedPageRect.top - transientPageRect.top,
        settledLeftShift: settledPageRect.left - committedPageRect.left,
        settledTopShift: settledPageRect.top - committedPageRect.top,
        settledHeightShift: settledPageRect.height - committedPageRect.height,
      };
    });

  expect(result.toScale).toBeGreaterThan(result.fromScale);
  expect(Math.abs(result.topShift), JSON.stringify(result)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.leftShift), JSON.stringify(result)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.settledTopShift), JSON.stringify(result)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.settledLeftShift), JSON.stringify(result)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.settledHeightShift), JSON.stringify(result)).toBeLessThanOrEqual(1);
});

test("zoom reversal cannot retain transformed blank overflow beside a wide row", async ({
  page,
}) => {
  const viewport = page.getByRole("region", { name: "primary PDF" });
  const box = await viewport.boundingBox();
  if (!box) throw new Error("Missing PDF viewport bounds");

  await page.evaluate(() => window.fixture.primary.zoomTo(3));
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(20);
  await page.mouse.wheel(0, 250);

  // The row remains wide throughout this reversal. While the transform exists,
  // its visual overflow must not become a native horizontal scroll range.
  await expect
    .poll(() =>
      viewport.evaluate((container: HTMLElement) => {
        const content = container.querySelector<HTMLElement>(".pdf-content");
        return {
          transformed: Boolean(content?.style.transform),
          overflowX: container.style.overflowX,
        };
      }),
    )
    .toEqual({ transformed: true, overflowX: "hidden" });
  await page.keyboard.up("Control");

  await expect
    .poll(() =>
      viewport.evaluate((container: HTMLElement) => {
        const content = container.querySelector<HTMLElement>(".pdf-content");
        return Boolean(content?.style.transform);
      }),
    )
    .toBe(false);

  const bounds = await viewport.evaluate((container: HTMLElement) => {
    const row = [...container.querySelectorAll<HTMLElement>(".pdf-row")].reduce(
      (widest, candidate) => (candidate.offsetWidth > widest.offsetWidth ? candidate : widest),
    );
    container.scrollLeft = 1_000_000;
    const viewportRight = container.getBoundingClientRect().left + container.clientWidth;
    return {
      overflowX: container.style.overflowX,
      scrollLeft: container.scrollLeft,
      expectedMax: Math.ceil(row.offsetWidth) - container.clientWidth,
      remainingRow: row.getBoundingClientRect().right - viewportRight,
    };
  });
  expect(bounds.overflowX).toBe("auto");
  expect(Math.abs(bounds.scrollLeft - bounds.expectedMax)).toBeLessThanOrEqual(1);
  expect(bounds.remainingRow).toBeGreaterThanOrEqual(-1);
});

test("committed wide zoom cannot scroll beyond the rendered row", async ({ page }) => {
  await page.evaluate(() => window.fixture.primary.zoomTo(2.2));
  const viewport = page.getByRole("region", { name: "primary PDF" });
  await viewport.evaluate((container: HTMLElement) => {
    container.scrollLeft = 1_000_000;
  });

  await expect
    .poll(() =>
      viewport.evaluate((container: HTMLElement) => {
        const rows = [...container.querySelectorAll<HTMLElement>(".pdf-row")];
        const widestRow = rows.reduce((widest, row) =>
          row.offsetWidth > widest.offsetWidth ? row : widest,
        );
        const rowRect = widestRow.getBoundingClientRect();
        const viewportRight = container.getBoundingClientRect().left + container.clientWidth;
        return rowRect.right - viewportRight;
      }),
    )
    .toBeGreaterThanOrEqual(-1);

  const bounds = await viewport.evaluate((container: HTMLElement) => ({
    scrollLeft: container.scrollLeft,
    maxScrollLeft: container.scrollWidth - container.clientWidth,
  }));

  expect(bounds.scrollLeft).toBeLessThanOrEqual(bounds.maxScrollLeft);
});

test("width-only resize recenters fixed-scale pages without rerendering", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(() => window.fixture.primary.zoomTo(0.8));
  const viewport = page.getByRole("region", { name: "primary PDF" });
  const canvas = page.locator("#primary .pdf-page canvas").first();
  await expect
    .poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width > 0 && el.height > 0))
    .toBe(true);
  const bitmapBefore = await canvas.evaluate((el: HTMLCanvasElement) => ({
    width: el.width,
    height: el.height,
  }));

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect
    .poll(() =>
      viewport.evaluate((container: HTMLElement) => {
        const row = container.querySelector<HTMLElement>(".pdf-row");
        if (!row) return Number.POSITIVE_INFINITY;
        const containerRect = container.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        return Math.abs(
          rowRect.left - containerRect.left - (container.clientWidth - rowRect.width) / 2,
        );
      }),
    )
    .toBeLessThanOrEqual(1);

  await expect(
    canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height })),
  ).resolves.toEqual(bitmapBefore);
  await expect
    .poll(() => page.evaluate(() => window.fixture.primary.state.scale))
    .toBeCloseTo(0.8, 4);
});
