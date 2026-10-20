// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

test("@mobile inactive page overlays cannot paint, receive input, or steal focus and restore the same DOM", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  // Ordinary consumer layout CSS must not override the package's inactive state.
  await page.addStyleTag({ content: ".pdf-page-overlay-host { display: block; }" });
  await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    const button = document.createElement("button");
    button.id = "activity-overlay";
    button.textContent = "Overlay activity";
    button.style.cssText = "visibility:visible;pointer-events:auto;width:100px;height:32px";
    button.dataset.clicks = "0";
    button.addEventListener("click", () => {
      button.dataset.clicks = String(Number(button.dataset.clicks) + 1);
    });
    const result = await viewer.registerPageOverlay(
      { page: 1, anchor: { x: 30, y: 100 }, element: button },
      viewer.documentId!,
    );
    if (!result.ok) throw new Error("Overlay registration failed");
  });
  const button = page.locator("#activity-overlay");
  const original = await button.elementHandle();
  await button.click();
  await button.focus();
  const before = await button.boundingBox();
  expect(before).not.toBeNull();
  await page.evaluate(() => window.fixture.primary.setActive(false));
  await expect(button).toBeHidden();
  expect(await button.evaluate(element => element.isConnected)).toBe(true);
  expect(
    await button.evaluate(element => element.closest<HTMLElement>(".pdf-page-overlay-host")!.inert),
  ).toBe(true);
  await button.evaluate(element => element.focus());
  await expect(button).not.toBeFocused();
  const x = before!.x + before!.width / 2;
  const y = before!.y + before!.height / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.keyboard.press("Tab");
  await expect(button).not.toBeFocused();
  await expect(button).toHaveAttribute("data-clicks", "1");

  await page.evaluate(() => window.fixture.primary.setActive(true));
  await expect(button).toBeVisible();
  expect(
    await original!.evaluate(element => element === document.getElementById("activity-overlay")),
  ).toBe(true);
  expect(
    await button.evaluate(element => element.closest<HTMLElement>(".pdf-page-overlay-host")!.inert),
  ).toBe(false);
  await button.focus();
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("data-clicks", "2");
});

test("@mobile late registrations and replacement documents inherit host inactivity independently per viewer", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    const element = document.createElement("button");
    element.id = "late-overlay";
    element.textContent = "Late overlay";
    element.style.visibility = "visible";
    const pending = viewer.registerPageOverlay(
      { page: 1, anchor: { x: 30, y: 100 }, element },
      viewer.documentId!,
    );
    viewer.setActive(false);
    if (!(await pending).ok) throw new Error("Late overlay registration failed");
    window.fixture.addSecondary();
  });
  await expect(page.locator("#late-overlay")).toBeAttached();
  await expect(page.locator("#late-overlay")).toBeHidden();
  await expect(page.locator("#secondary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(async () => {
    const viewer = window.fixture.secondary!;
    const element = document.createElement("button");
    element.id = "other-overlay";
    element.textContent = "Other viewer";
    if (
      !(
        await viewer.registerPageOverlay(
          { page: 1, anchor: { x: 30, y: 100 }, element },
          viewer.documentId!,
        )
      ).ok
    )
      throw new Error("Other viewer registration failed");
    viewer.setActive(true);
  });
  await expect(page.locator("#other-overlay")).toBeVisible();
  await expect(page.locator("#late-overlay")).toBeHidden();

  await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    await viewer.load("/fixture.pdf?inactive-overlay-replacement");
    const element = document.createElement("button");
    element.id = "replacement-overlay";
    element.textContent = "Replacement";
    if (
      !(
        await viewer.registerPageOverlay(
          { page: 1, anchor: { x: 30, y: 100 }, element },
          viewer.documentId!,
        )
      ).ok
    )
      throw new Error("Replacement overlay registration failed");
  });
  await expect(page.locator("#late-overlay")).toHaveCount(0);
  await expect(page.locator("#replacement-overlay")).toBeAttached();
  await expect(page.locator("#replacement-overlay")).toBeHidden();
  await page.evaluate(() => window.fixture.primary.setActive(true));
  await expect(page.locator("#replacement-overlay")).toBeVisible();
  await page.evaluate(() => {
    window.fixture.primary.setActive(false);
    window.fixture.primary.close();
    window.fixture.primary.setActive(true);
  });
  await expect(page.locator("#replacement-overlay")).toHaveCount(0);
  await expect(page.locator("#other-overlay")).toBeVisible();
  await page.evaluate(() => window.fixture.secondary!.destroy());
  await expect(page.locator("#other-overlay")).toHaveCount(0);
});

test("page overlay admission rejects invalid input and in-flight stale registrations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  const outcomes = await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    const documentId = viewer.documentId!;
    const element = document.createElement("button");
    const input = { page: 1, anchor: { x: 20, y: 100 }, element };
    const zeroPage = await viewer.registerPageOverlay({ ...input, page: 0 }, documentId);
    const outsidePage = await viewer.registerPageOverlay(
      { ...input, page: viewer.state.pageCount + 1 },
      documentId,
    );
    const invalidAnchor = await viewer.registerPageOverlay(
      { ...input, anchor: { x: NaN, y: 0 } },
      documentId,
    );
    const first = await viewer.registerPageOverlay(input, documentId);
    if (!first.ok) throw new Error("Initial registration failed");
    const duplicate = await viewer.registerPageOverlay(input, documentId);
    first.dispose();
    first.dispose();
    const successor = await viewer.registerPageOverlay(input, documentId);
    first.dispose();
    const oldDisposerSafe = element.isConnected;
    if (successor.ok) successor.dispose();
    const pending = viewer.registerPageOverlay(input, documentId);
    const replacement = viewer.load("/fixture.pdf?pending-overlay");
    const stale = await pending;
    await replacement;
    return {
      zeroPage,
      outsidePage,
      invalidAnchor,
      duplicate,
      successorOk: successor.ok,
      oldDisposerSafe,
      stale,
      connected: element.isConnected,
    };
  });
  for (const result of [
    outcomes.zeroPage,
    outcomes.outsidePage,
    outcomes.invalidAnchor,
    outcomes.duplicate,
  ])
    expect(result).toEqual({ ok: false, reason: "invalid-overlay" });
  expect(outcomes.successorOk).toBe(true);
  expect(outcomes.oldDisposerSafe).toBe(true);
  expect(outcomes.stale).toEqual({ ok: false, reason: "stale-document" });
  expect(outcomes.connected).toBe(false);
});

test("@mobile page overlays preserve consumer DOM, isolate presentation input, and never print", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  const registered = await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    const control = document.createElement("button");
    control.id = "consumer-overlay";
    control.type = "button";
    control.textContent = "Overlay";
    control.style.cssText = "width:64px;height:32px";
    control.dataset.clicks = "0";
    control.addEventListener("click", () => {
      control.dataset.clicks = String(Number(control.dataset.clicks) + 1);
    });
    const result = await viewer.registerPageOverlay(
      {
        page: 1,
        anchor: { x: 30, y: 100 },
        element: control,
        onGeometry: geometry => {
          control.dataset.geometry = JSON.stringify(geometry);
          control.dataset.changes = String(Number(control.dataset.changes ?? 0) + 1);
        },
      },
      viewer.documentId!,
    );
    if (!result.ok) return result;
    control.addEventListener("dispose-overlay", result.dispose);
    return { ok: true };
  });
  expect(registered.ok).toBe(true);
  const control = page.locator("#consumer-overlay");
  await expect(control).toHaveCount(1);
  const placement = await control.evaluate(element => {
    const geometry = JSON.parse((element as HTMLElement).dataset.geometry!) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const slot = element.parentElement!.getBoundingClientRect();
    const bounds = element.parentElement!.parentElement!.getBoundingClientRect();
    return [
      slot.left - bounds.left - geometry.x,
      slot.top - bounds.top - geometry.y,
      bounds.width - geometry.width,
      bounds.height - geometry.height,
    ];
  });
  expect(placement.every(delta => Math.abs(delta) < 0.05)).toBe(true);
  expect(
    await control.evaluate(element => {
      const slot = element.parentElement!;
      return [
        getComputedStyle(slot.parentElement!).pointerEvents,
        getComputedStyle(slot).pointerEvents,
        getComputedStyle(element).pointerEvents,
      ];
    }),
  ).toEqual(["none", "none", "auto"]);
  await page.evaluate(() => window.fixture.primary.zoomTo(1.5));
  await expect(control).toHaveCount(1);
  await expect.poll(() => control.getAttribute("data-changes")).not.toBe("1");
  const beforeScroll = await control.getAttribute("data-changes");
  await page.locator("#primary .pdf-container").evaluate(element => {
    element.scrollTop += 10;
    element.dispatchEvent(new Event("scroll"));
  });
  expect(await control.getAttribute("data-changes")).toBe(beforeScroll);
  await page.evaluate(() => window.fixture.primary.enterPresentationMode());
  if (testInfo.project.use.hasTouch) await control.tap();
  else await control.click();
  await expect(control).toHaveAttribute("data-clicks", "1");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await control.focus();
  await page.keyboard.press("Space");
  await expect(control).toHaveAttribute("data-clicks", "2");
  await expect.poll(() => page.evaluate(() => window.fixture.primary.state.currentPage)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(control).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.fixture.primary.exitPresentationMode());
  const replacement = await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    const control = document.querySelector("#consumer-overlay")!;
    const oldDocumentId = viewer.documentId!;
    await viewer.load("/fixture.pdf?overlay-replacement");
    const stale = await viewer.registerPageOverlay(
      {
        page: 1,
        anchor: { x: 0, y: 0 },
        element: control as HTMLElement,
      },
      oldDocumentId,
    );
    control.dispatchEvent(new Event("dispose-overlay"));
    return { connected: control.isConnected, staleAccepted: stale.ok };
  });
  expect(replacement).toEqual({ connected: false, staleAccepted: false });
  await expect(control).toHaveCount(0);
});
