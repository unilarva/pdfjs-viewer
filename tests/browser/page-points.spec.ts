// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Browser contract checks for PDF page-point geometry, movement, and document ownership. */
import { expect, test, type Page } from "@playwright/test";
import type { SyntheticPdfOptions } from "./synthetic-pdf";

test.use({ deviceScaleFactor: 2 });

async function load(
  page: Page,
  pdf: SyntheticPdfOptions,
  layout: "single" | "double" = "single",
  gatedPage?: number,
) {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  return page.evaluate(
    async ({ pdf, layout, gatedPage }) => {
      const fixture = window.fixture;
      fixture.primary.destroy();
      const rootEl = document.querySelector<HTMLElement>("#primary")!;
      if (gatedPage !== undefined) {
        const gate = fixture.pageSources.gatePageAcquisitions(gatedPage);
        rootEl.addEventListener("release-point-fixture-page", () => gate.release(), { once: true });
      }
      const viewer = fixture.pageSources.createViewer({
        rootEl,
        ui: "headless",
        pageLayout: layout,
        fitMode: "contain",
        // Keep the host editor focusable when testing windowed presentation mode.
        features: { navigationHistory: true, fullscreen: false },
      });
      fixture.primary = viewer;
      const result = await viewer.load({ type: "data", data: fixture.pageSources.makePdf(pdf) });
      if (!result.ok) throw new Error(`Page point fixture did not load: ${result.reason}`);
      return viewer.documentId!;
    },
    { pdf, layout, gatedPage },
  );
}

test("hit-tests both spread pages, not the gutter, at HiDPI and across zoom and rotation", async ({
  page,
}) => {
  const documentId = await load(
    page,
    { labels: ["Left", "Right", "Next"], crop: [40, 50, 560, 750], rotation: 90, userUnit: 1.25 },
    "double",
  );
  expect(await page.evaluate(() => devicePixelRatio)).toBe(2);

  const sample = (pageNo: number, xRatio: number, yRatio: number) =>
    page.locator(`#primary .pdf-page[data-page="${pageNo}"]`).evaluate(
      (wrapper, { xRatio, yRatio }) => {
        const bounds = wrapper.getBoundingClientRect();
        return window.fixture.primary.getPagePointAtClientPosition(
          bounds.left + bounds.width * xRatio,
          bounds.top + bounds.height * yRatio,
        );
      },
      { xRatio, yRatio },
    );
  const expectPoint = async (pageNo: number, xRatio: number, yRatio: number) => {
    await expect.poll(async () => (await sample(pageNo, xRatio, yRatio))?.page).toBe(pageNo);
    const hit = (await sample(pageNo, xRatio, yRatio))!;
    expect(hit.documentId).toBe(documentId);
    expect(hit.x).toBeCloseTo(196, 5);
    expect(hit.y).toBeCloseTo(190, 5);
  };

  // Intrinsic 90 degrees: display fractions map to (left + v * width, bottom + u * height).
  await expectPoint(1, 0.2, 0.3);
  await expectPoint(2, 0.2, 0.3);
  const gutter = await page.evaluate(() => {
    const left = document
      .querySelector('#primary .pdf-page[data-page="1"]')!
      .getBoundingClientRect();
    const right = document
      .querySelector('#primary .pdf-page[data-page="2"]')!
      .getBoundingClientRect();
    const x = (left.right + right.left) / 2;
    const y = left.top + left.height / 2;
    const viewer = window.fixture.primary;
    return {
      gap: right.left - left.right,
      hit: viewer.getPagePointAtClientPosition(x, y),
      invalid: viewer.getPagePointAtClientPosition(NaN, y),
      outside: viewer.getPagePointAtClientPosition(-10, y),
    };
  });
  expect(gutter).toMatchObject({ hit: null, invalid: null, outside: null });
  expect(gutter.gap).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    await viewer.setPageLayout("single");
    await viewer.rotateTo(90);
    viewer.zoomTo(1.2);
    viewer.navigateToPage(1);
  });
  // Combined 180 degrees: same native point, different CSS position.
  await expectPoint(1, 0.7, 0.2);
  const point = (await sample(1, 0.7, 0.2))!;
  const rotatedJump = await page.evaluate(async hit => {
    const viewer = window.fixture.primary;
    const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
    const wrapper = document.querySelector('#primary .pdf-page[data-page="1"]')!;
    const result = await viewer.navigateToPagePoint(hit, hit.documentId);
    const bounds = wrapper.getBoundingClientRect();
    const yOffset = bounds.top + bounds.height * 0.2 - container.getBoundingClientRect().top;
    container.scrollTop -= 16;
    return { result, yOffset };
  }, point);
  expect(rotatedJump.result).toEqual({ ok: true, page: 1, positioned: true });
  expect(Math.abs(rotatedJump.yOffset)).toBeLessThan(15);
  await expectPoint(1, 0.7, 0.2);
});

test("round-trips a point on an offscreen mixed-size page without changing the view or taking focus", async ({
  page,
}) => {
  const documentId = await load(
    page,
    {
      labels: Array.from({ length: 16 }, (_, index) => `Page ${index + 1}`),
      pageCrops: { 14: [35, 100, 605, 650] },
    },
    "single",
    14,
  );
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "host-input";
    input.setAttribute("aria-label", "Host editor");
    input.style.cssText = "position:fixed;inset:auto auto 0 0;z-index:10000";
    document.body.append(input);
  });
  const hostInput = page.getByRole("textbox", { name: "Host editor" });
  await hostInput.focus();
  await expect(hostInput).toBeFocused();
  const point = { page: 14, x: 330, y: 480 };
  const jump = await page.evaluate(
    async ({ point, documentId }) => {
      const viewer = window.fixture.primary;
      const wrapper = document.querySelector<HTMLElement>('#primary .pdf-page[data-page="14"]')!;
      const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
      viewer.zoomTo(2.4);
      const view = () => {
        const { pageLayout, effectivePageLayout, rotation, scale, fitActive } = viewer.state;
        return { pageLayout, effectivePageLayout, rotation, scale, fitActive };
      };
      const before = view();
      const startTop = container.scrollTop;
      const offscreen =
        wrapper.getBoundingClientRect().top >= container.getBoundingClientRect().bottom;
      const estimate = wrapper.offsetHeight;
      const pending = viewer.navigateToPagePoint(point, documentId);
      document.querySelector("#primary")!.dispatchEvent(new Event("release-point-fixture-page"));
      const result = await pending;
      const bounds = wrapper.getBoundingClientRect();
      const clip = container.getBoundingClientRect();
      const x = bounds.left + ((point.x - 35) / 570) * bounds.width;
      const y = bounds.top + ((650 - point.y) / 550) * bounds.height;
      return {
        result,
        offscreen,
        estimate,
        height: bounds.height,
        before,
        after: view(),
        startTop,
        yOffset: y - clip.top - container.clientTop,
        xOffset: x - clip.left - container.clientLeft - container.clientWidth / 2,
      };
    },
    { point, documentId },
  );
  expect(jump.result).toEqual({ ok: true, page: 14, positioned: true });
  await expect(hostInput).toBeFocused();
  expect(jump.offscreen).toBe(true);
  expect(jump.estimate - jump.height).toBeGreaterThan(100);
  expect(jump.after).toEqual(jump.before);
  // The shared destination path aligns to the row's measured origin, including the page gap.
  expect(Math.abs(jump.yOffset)).toBeLessThan(15);
  expect(Math.abs(jump.xOffset)).toBeLessThan(2);

  const history = await page.evaluate(() => {
    const viewer = window.fixture.primary;
    const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
    const targetTop = container.scrollTop;
    const back = viewer.goBack();
    const backTop = container.scrollTop;
    const forward = viewer.goForward();
    return { targetTop, back, backTop, forward, forwardTop: container.scrollTop };
  });
  expect(history).toMatchObject({ back: true, forward: true });
  expect(Math.abs(history.backTop - jump.startTop)).toBeLessThan(2);
  expect(Math.abs(history.forwardTop - history.targetTop)).toBeLessThan(2);

  // Nudge the destination below the clipped top edge, then invert the actual on-screen point.
  await page.locator("#primary .pdf-container").evaluate(container => {
    container.scrollTop -= 16;
  });
  await expect
    .poll(() =>
      page.evaluate(point => {
        const bounds = document
          .querySelector('#primary .pdf-page[data-page="14"]')!
          .getBoundingClientRect();
        const hit = window.fixture.primary.getPagePointAtClientPosition(
          bounds.left + ((point.x - 35) / 570) * bounds.width,
          bounds.top + ((650 - point.y) / 550) * bounds.height,
        );
        return (
          hit && { ...hit, x: Math.round(hit.x * 100) / 100, y: Math.round(hit.y * 100) / 100 }
        );
      }, point),
    )
    .toEqual({ ...point, documentId });
  await expect(hostInput).toBeFocused();

  const entered = await page.evaluate(() => window.fixture.primary.enterPresentationMode());
  expect(entered.ok).toBe(true);
  await hostInput.focus();
  await expect(hostInput).toBeFocused();
  const presentationJump = await page.evaluate(
    documentId =>
      window.fixture.primary.navigateToPagePoint({ page: 4, x: 150, y: 300 }, documentId),
    documentId,
  );
  expect(presentationJump).toEqual({ ok: true, page: 4, positioned: false });
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(4);
  await expect(hostInput).toBeFocused();
});

test("rejects invalid points, superseded work, and replacement during page acquisition", async ({
  page,
}) => {
  const documentId = await load(page, {
    labels: Array.from({ length: 12 }, (_, index) => `Page ${index + 1}`),
  });
  const results = await page.evaluate(async documentId => {
    const { primary: viewer, pageSources: fixture } = window.fixture;
    const point = { page: 12, x: 70, y: 320 };
    const invalid = await Promise.all([
      viewer.navigateToPagePoint({ ...point, page: 0 }, documentId),
      viewer.navigateToPagePoint({ ...point, page: 2.5 }, documentId),
      viewer.navigateToPagePoint({ ...point, page: 13 }, documentId),
      viewer.navigateToPagePoint({ ...point, y: Infinity }, documentId),
      viewer.navigateToPagePoint({ ...point, x: -100 }, documentId),
    ]);
    const validGate = fixture.gatePageAcquisitions(12);
    const valid = viewer.navigateToPagePoint(point, documentId);
    await validGate.entered;
    const invalidDuringValid = await viewer.navigateToPagePoint(
      { page: 1, x: -100, y: 320 },
      documentId,
    );
    validGate.release();
    const accepted = await valid;

    const gate = fixture.gatePageAcquisitions(12);
    const old = viewer.navigateToPagePoint(point, documentId);
    await gate.entered;
    viewer.navigateToPage(1);
    gate.release();
    const cancelled = await old;

    const replacementGate = fixture.gatePageAcquisitions(12);
    const pending = viewer.navigateToPagePoint(point, documentId);
    await replacementGate.entered;
    const replacement = viewer.load({ type: "data", data: fixture.makePdf({ labels: ["New"] }) });
    replacementGate.release();
    const during = await pending;
    const replaced = await replacement;
    const stale = await viewer.navigateToPagePoint({ ...point, page: 1 }, documentId);
    return {
      invalid,
      invalidDuringValid,
      accepted,
      cancelled,
      during,
      replaced: replaced.ok,
      stale,
      current: viewer.state.currentPage,
      back: viewer.state.canGoBack,
    };
  }, documentId);
  expect(results.invalid).toEqual(Array(5).fill({ ok: false, reason: "invalid-point" }));
  expect(results).toMatchObject({
    cancelled: { ok: false, reason: "cancelled" },
    invalidDuringValid: { ok: false, reason: "invalid-point" },
    accepted: { ok: true, page: 12, positioned: true },
    during: { ok: false, reason: "stale-document" },
    replaced: true,
    stale: { ok: false, reason: "stale-document" },
    current: 1,
    back: false,
  });
});

test("keeps focused Forward and Next controls inert until focus leaves them", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(async () => {
    const fixture = window.fixture;
    fixture.primary.destroy();
    const rootEl = document.querySelector<HTMLElement>("#primary")!;
    const container = document.createElement("div");
    container.className = "pdf-container";
    container.style.cssText = "height: 90%; overflow: auto";
    const forward = document.createElement("button");
    const back = document.createElement("button");
    forward.textContent = "Custom Forward";
    back.textContent = "Custom Back";
    const next = document.createElement("button");
    next.textContent = "Custom Next";
    const external = document.createElement("aside");
    external.attachShadow({ mode: "open" }).append(next);
    document.body.append(external);
    rootEl.replaceChildren(back, forward, container);
    const viewer = fixture.pageSources.createViewer({
      rootEl,
      ui: "custom",
      uiBindings: { container, navigationHistory: { back, forward }, navigation: { next } },
    });
    fixture.primary = viewer;
    const data = fixture.pageSources.makePdf({ labels: ["Start", "Forward", "Branch"] });
    await viewer.load({ type: "data", data });
    viewer.navigateToPage(2);
    if (!viewer.goBack()) throw new Error("Could not create Forward history");
  });
  const forward = page.getByRole("button", { name: "Custom Forward" });
  await expect(forward).toBeEnabled();
  await forward.focus();
  await expect(forward).toBeFocused();
  const result = await page.evaluate(() => {
    const viewer = window.fixture.primary;
    return viewer.navigateToPagePoint({ page: 3, x: 60, y: 600 }, viewer.documentId!);
  });
  expect(result).toMatchObject({ ok: true, page: 3 });
  await expect(forward).toBeFocused();
  await expect(forward).toHaveAttribute("aria-disabled", "true");
  expect(
    await forward.evaluate((el: HTMLButtonElement) => ({
      nativeDisabled: el.disabled,
      clickBlocked: !el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    })),
  ).toEqual({ nativeDisabled: false, clickBlocked: true });
  await page.getByRole("button", { name: "Custom Back" }).focus();
  expect(await forward.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(true);
  const next = page.getByRole("button", { name: "Custom Next" });
  await page.evaluate(() => window.fixture.primary.navigateToPage(1));
  await expect(next).toBeEnabled();
  await next.focus();
  await expect(next).toBeFocused();
  await page.evaluate(() => {
    const viewer = window.fixture.primary;
    return viewer.navigateToPagePoint({ page: 3, x: 60, y: 600 }, viewer.documentId!);
  });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next).toBeFocused();
  await page.getByRole("button", { name: "Custom Back" }).focus();
  expect(await next.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(true);
  const mutations = await next.evaluate(async el => {
    const container = document.querySelector<HTMLElement>("#primary .pdf-container")!;
    let count = 0;
    const observer = new MutationObserver(records => {
      count += records.length;
    });
    observer.observe(el, { attributes: true, attributeFilter: ["disabled"] });
    for (let i = 0; i < 3; i++) {
      container.dispatchEvent(new Event("scroll"));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    count += observer.takeRecords().length;
    observer.disconnect();
    return count;
  });
  expect(mutations).toBe(0);
});

test("repeating a fractional jump does not move or add a history entry", async ({ page }) => {
  const documentId = await load(page, { labels: ["Start", "Target", "Next"] });
  const result = await page.evaluate(async documentId => {
    const viewer = window.fixture.primary;
    viewer.zoomTo(1.337);
    const point = { page: 2, x: 309.027, y: 512.1875 };
    const first = await viewer.navigateToPagePoint(point, documentId);
    const second = await viewer.navigateToPagePoint(point, documentId);
    const back = viewer.goBack();
    return { first, second, back, hasAnotherBack: viewer.state.canGoBack };
  }, documentId);
  expect(result).toEqual({
    first: { ok: true, page: 2, positioned: true },
    second: { ok: true, page: 2, positioned: false },
    back: true,
    hasAnotherBack: false,
  });
});

test("replacement edge hits stay in the canonical page's crop box", async ({ page }) => {
  const documentId = await load(page, { labels: ["Base"], crop: [40, 50, 560, 750] });
  await page.evaluate(async documentId => {
    const { primary: viewer, pageSources: fixture } = window.fixture;
    viewer.zoomTo(1);
    const prepared = await viewer.preparePageSource(
      { data: fixture.makePdf({ labels: ["Replacement"], crop: [39.99992, 50, 560, 750] }) },
      documentId,
    );
    if (!prepared.ok) throw new Error(prepared.reason);
    const root = document.querySelector("#primary")!;
    const painted = new Promise<void>(resolve => {
      root.addEventListener("pdf:pagecontent", () => resolve(), { once: true });
    });
    const result = await viewer.setPageSourceOverrides(
      [{ page: 1, source: prepared.source, sourcePage: 1 }],
      documentId,
    );
    prepared.source.release();
    if (!result.ok) throw new Error(result.reason);
    await painted;
  }, documentId);
  const edge = await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    const bounds = document
      .querySelector('#primary .pdf-page[data-page="1"]')!
      .getBoundingClientRect();
    const hit = viewer.getPagePointAtClientPosition(
      bounds.left + bounds.width * 1e-8,
      bounds.top + 50,
    );
    if (!hit) throw new Error("No hit near the replacement's left edge");
    return { hit, result: await viewer.navigateToPagePoint(hit, hit.documentId) };
  });
  expect(edge.hit.x).toBeGreaterThanOrEqual(40);
  expect(edge.hit.x).toBeLessThan(40.00002);
  expect(edge.result).toMatchObject({ ok: true, page: 1 });
});
