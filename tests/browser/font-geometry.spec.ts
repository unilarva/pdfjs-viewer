// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

const aliases = () =>
  [...document.fonts].filter(face => face.family.includes("_pdfjs_viewer_linear_")).length;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#primary .pdf-page > canvas").first()).toBeVisible();
});

for (const variant of ["regular", "bold", "italic", "transparent", "group"]) {
  test(`@mobile embedded TrueType ${variant} base and detail preserve outline bounds`, async ({
    page,
  }) => {
    await page.evaluate(
      variant =>
        window.fixture.createDetailViewer(
          32,
          `/hinted-font.pdf?variant=${variant}`,
          750_000,
          1024,
          "geometric",
        ),
      variant,
    );
    await page.evaluate(() => window.fixture.detailViewer!.zoomTo(3));
    await page.locator("#detail-viewer .pdf-container").evaluate(container => {
      container.scrollLeft = 0;
      container.scrollTop = 180;
    });
    await expect.poll(() => page.evaluate(aliases)).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.fixture.compareFontGeometry()).detail?.[2] ?? 0),
      )
      .toBeGreaterThan(0);
    const geometry = await page.evaluate(() => window.fixture.compareFontGeometry());
    expect(geometry.baseDpr).toBeLessThan(0.5);
    expect(geometry.detailDpr).toBeGreaterThan(geometry.baseDpr * 1.1);
    expect(geometry.reference[3]).toBeGreaterThan(45);
    for (const [bounds, dpr] of [
      [geometry.base, geometry.baseDpr],
      [geometry.detail!, geometry.detailDpr!],
    ] as const) {
      expect(bounds).toHaveLength(4);
      const tolerance = 1 / dpr + 1 / 3;
      for (let i = 0; i < 4; i++)
        expect(Math.abs(bounds[i] - geometry.reference[i])).toBeLessThanOrEqual(tolerance);
    }
    const contexts = await page.evaluate(() =>
      window.fixture.detailRenderCalls
        .filter(call => call.canvas.closest("#detail-viewer") && call.canvas.width > 0)
        .map(call => call.explicitContext),
    );
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every(Boolean)).toBe(true);
    for (const [index, expected] of [180 * 3, 74 * 3, 24 * 3, 18 * 3].entries()) {
      expect(Math.abs(geometry.rectangle[index] - expected)).toBeLessThanOrEqual(
        1 / geometry.baseDpr,
      );
    }
    expect(await page.evaluate(() => String(FontFace).includes("[native code]"))).toBe(true);
  });
}

test("@mobile small TrueType text retains native contrast while larger text preserves vector geometry", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.fixture.createDetailViewer(96, "/hinted-font.pdf", 24_000_000, 8192, "geometric"),
  );
  for (const scale of [0.333, 0.5, 0.731, 1, 1.125]) {
    await page.evaluate(scale => window.fixture.detailViewer!.zoomTo(scale), scale);
    await expect
      .poll(() =>
        page.evaluate(scale => {
          const completion = [...window.fixture.logs]
            .reverse()
            .find(
              entry =>
                entry.event === "page-render-completed" &&
                entry.viewerId !== "primary" &&
                entry.viewerId !== "secondary" &&
                entry.details?.pageNo === 1,
            );
          return completion?.details?.scale === scale;
        }, scale),
      )
      .toBe(true);
    await expect(page.locator("#detail-viewer .pdf-detail-canvas")).toHaveCount(0);
    const geometry = await page.evaluate(() => window.fixture.compareFontGeometry());
    expect(geometry.base).toHaveLength(4);
    expect(geometry.base[2]).toBeGreaterThan(0);
    expect(geometry.base[3]).toBeGreaterThan(0);
    if (24 * scale <= 24) {
      expect(geometry.base).toEqual(geometry.nativeReference);
    } else {
      const tolerance = 1 / geometry.baseDpr + 1 / 3;
      for (let i = 0; i < 4; i++)
        expect(Math.abs(geometry.base[i] - geometry.reference[i])).toBeLessThanOrEqual(tolerance);
    }
  }
});

test("@mobile font aliases are isolated across viewers and removed on close and replacement", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.fixture.createDetailViewer(32, "/hinted-font.pdf", 750_000, 1024, "geometric"),
  );
  await expect.poll(() => page.evaluate(aliases)).toBe(1);
  await page.evaluate(async () => {
    const host = document.createElement("section");
    host.className = "viewer-host";
    document.body.append(host);
    const viewer = window.fixture.createScreenWakeLockViewer({
      rootEl: host,
      fontRendering: "geometric",
      features: { search: false, outline: false, thumbnails: false },
    });
    window.fixture.fontPeer = viewer;
    await viewer.load("/hinted-font.pdf");
  });
  await expect.poll(() => page.evaluate(aliases)).toBe(2);
  await page.evaluate(() => window.fixture.detailViewer!.close());
  await expect.poll(() => page.evaluate(aliases)).toBe(1);
  await page.evaluate(() => window.fixture.fontPeer!.load("/fixture.pdf"));
  await expect.poll(() => page.evaluate(aliases)).toBe(0);
  await page.evaluate(() => window.fixture.detailViewer!.destroy());
  await expect.poll(() => page.evaluate(aliases)).toBe(0);
});

test("@mobile default native policy creates no aliases for embedded TrueType fonts", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer(32, "/hinted-font.pdf"));
  await expect(page.locator("#detail-viewer .pdf-page > canvas").first()).toBeVisible();
  expect(await page.evaluate(aliases)).toBe(0);
  expect(
    await page.evaluate(() =>
      window.fixture.detailRenderCalls.some(
        call => call.canvas.closest("#detail-viewer") && call.explicitContext,
      ),
    ),
  ).toBe(false);
});
