// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";

const wrapper = '#detail-viewer .pdf-page[data-page="1"]';
const detail = `${wrapper} canvas.pdf-detail-canvas`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
});

test("@mobile base and detail glyph bounds agree within low-resolution pixel coverage", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer());
  await zoom(page, 3);
  await page.locator("#detail-viewer .pdf-container").evaluate(container => {
    container.scrollLeft = 0;
    container.scrollTop = 180;
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.compareDetailGlyphBounds().detail[2]))
    .toBeGreaterThan(0);
  const geometry = await page.evaluate(() => window.fixture.compareDetailGlyphBounds());
  expect(geometry.baseDpr).toBeLessThan(0.5);
  expect(geometry.detailDpr).toBeGreaterThan(geometry.baseDpr * 1.1);
  expect(geometry.base[3]).toBeGreaterThan(45);
  expect(geometry.detail[3]).toBeGreaterThan(45);
  // Edge coverage/hinting can differ by raster pixels, but neither image may
  // acquire a different page-space scale or translation when detail replaces it.
  const tolerance = 2 / geometry.baseDpr + 1 / geometry.detailDpr;
  for (let i = 0; i < geometry.base.length; i++) {
    expect(Math.abs(geometry.base[i] - geometry.detail[i])).toBeLessThanOrEqual(tolerance);
  }
});

async function zoom(page: Page, scale = 12.375): Promise<void> {
  await page.evaluate(scale => window.fixture.detailViewer!.zoomTo(scale), scale);
  await expect(page.locator(detail)).toHaveCount(1);
}

async function checkCrop(page: Page, rotation = 0): Promise<void> {
  const geometry = await page.locator(detail).evaluate(canvasElement => {
    const canvas = canvasElement as HTMLCanvasElement;
    const parent = canvas.parentElement!;
    const base = parent.querySelector<HTMLCanvasElement>("canvas:not(.pdf-detail-canvas)")!;
    const call = [...window.fixture.detailRenderCalls]
      .reverse()
      .find(call => call.canvas === canvas)!;
    const bounds = canvas.getBoundingClientRect();
    const page = parent.getBoundingClientRect();
    const container = document.querySelector<HTMLElement>("#detail-viewer .pdf-container")!;
    const visible = container.getBoundingClientRect();
    return {
      transform: call.transform,
      viewportWidth: call.width,
      viewportHeight: call.height,
      rotation: call.rotation,
      width: canvas.width,
      height: canvas.height,
      baseDpr: base.width / page.width,
      dpr: canvas.width / bounds.width,
      x: bounds.left - page.left,
      y: bounds.top - page.top,
      cssWidth: bounds.width,
      cssHeight: bounds.height,
      pageWidth: page.width,
      pageHeight: page.height,
      coversVisible:
        bounds.left <= Math.max(page.left, visible.left) + 1 &&
        bounds.top <= Math.max(page.top, visible.top) + 1 &&
        bounds.right >= Math.min(page.right, visible.right) - 1 &&
        bounds.bottom >= Math.min(page.bottom, visible.bottom) - 1,
      pointerEvents: getComputedStyle(canvas).pointerEvents,
    };
  });
  const [dpr, b, c, verticalDpr, tx, ty] = geometry.transform;
  expect(geometry.rotation).toBe(rotation);
  expect(b).toBe(0);
  expect(c).toBe(0);
  expect(verticalDpr).toBe(dpr);
  expect(geometry.dpr).toBeGreaterThan(geometry.baseDpr * 1.1);
  // CSSOM quantizes fractional positions to layout pixels; use a subpixel tolerance.
  expect(
    Math.abs(geometry.x + (tx / dpr) * (geometry.pageWidth / geometry.viewportWidth)),
  ).toBeLessThan(0.05);
  expect(
    Math.abs(geometry.y + (ty / dpr) * (geometry.pageHeight / geometry.viewportHeight)),
  ).toBeLessThan(0.05);
  expect(
    Math.abs(
      geometry.cssWidth - (geometry.width / dpr) * (geometry.pageWidth / geometry.viewportWidth),
    ),
  ).toBeLessThan(0.05);
  expect(
    Math.abs(
      geometry.cssHeight -
        (geometry.height / dpr) * (geometry.pageHeight / geometry.viewportHeight),
    ),
  ).toBeLessThan(0.05);
  expect(geometry.x).toBeGreaterThanOrEqual(-0.05);
  expect(geometry.y).toBeGreaterThanOrEqual(-0.05);
  expect(geometry.x + geometry.cssWidth).toBeLessThanOrEqual(geometry.pageWidth + 1);
  expect(geometry.y + geometry.cssHeight).toBeLessThanOrEqual(geometry.pageHeight + 1);
  expect(geometry.coversVisible).toBe(true);
  expect(geometry.width * geometry.height).toBeLessThanOrEqual(750_000);
  expect(Math.max(geometry.width, geometry.height)).toBeLessThanOrEqual(1024);
  expect(geometry.pointerEvents).toBe("none");
  await expect(page.locator(detail)).toHaveAttribute("aria-hidden", "true");
}

test("@mobile detail crops improve constrained bases at fractional high zoom and follow scrolling and rotation", async ({
  page,
}, testInfo) => {
  await page.evaluate(() => window.fixture.createDetailViewer());
  await zoom(page);
  await checkCrop(page);
  const previous = await page.locator(detail).elementHandle();
  await page.locator("#detail-viewer .pdf-container").evaluate(container => {
    container.scrollLeft += 900;
    container.scrollTop += 800;
  });
  await expect.poll(() => previous!.evaluate(canvas => canvas.isConnected)).toBe(false);
  await expect(page.locator(detail)).toHaveCount(1);
  await checkCrop(page);
  await page.evaluate(() => window.fixture.detailViewer!.rotateTo(90));
  await expect
    .poll(() =>
      page.locator(detail).evaluateAll(canvases => {
        const call = [...window.fixture.detailRenderCalls]
          .reverse()
          .find(call => call.canvas === canvases[0]);
        return call?.rotation;
      }),
    )
    .toBe(90);
  await checkCrop(page, 90);
  const maximum = testInfo.project.name.startsWith("mobile-") ? 16 : 32;
  await page.evaluate(maximum => window.fixture.detailViewer!.zoomTo(maximum), maximum);
  await expect
    .poll(() => page.evaluate(() => window.fixture.detailViewer!.state.scale))
    .toBe(maximum);
  await expect(page.locator(detail)).toHaveCount(1);
  await checkCrop(page, 90);
});

test("@mobile detail rendering preserves interactive layers and releases backing stores on close and destroy", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer());
  await zoom(page, 4.125);
  await checkCrop(page);
  await page.evaluate(() => window.fixture.detailViewer!.setTextSelectionMode(true));
  await expect(page.locator(`${wrapper} .pdf-text-layer span`).first()).toBeAttached();
  expect(
    await page
      .locator(`${wrapper} .pdf-text-layer span`)
      .first()
      .evaluate(span => getComputedStyle(span).pointerEvents),
  ).toBe("auto");
  await page.evaluate(() => window.fixture.detailViewer!.setTextSelectionMode(false));
  await expect(page.locator(`${wrapper} .pdf-annotation-layer a`)).toHaveCount(2);
  const hit = await page
    .locator(`${wrapper} .pdf-annotation-layer a`)
    .first()
    .evaluate(link => {
      link.scrollIntoView({ block: "center", inline: "center" });
      const rect = link.getBoundingClientRect();
      return (
        document
          .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.closest("a") === link
      );
    });
  expect(hit).toBe(true);
  await expect(page.locator(detail)).toHaveCount(1);
  const closedCanvas = await page.locator(detail).elementHandle();
  await page.evaluate(() => window.fixture.detailViewer!.close());
  await expect(page.locator("#detail-viewer canvas.pdf-detail-canvas")).toHaveCount(0);
  expect(
    await closedCanvas!.evaluate(canvas => ({
      connected: canvas.isConnected,
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    })),
  ).toEqual({ connected: false, width: 0, height: 0 });
  await page.evaluate(() => window.fixture.detailViewer!.load("/fixture.pdf?detail=reopen"));
  await zoom(page);
  const destroyedCanvas = await page.locator(detail).elementHandle();
  await page.evaluate(() => window.fixture.detailViewer!.destroy());
  await expect(page.locator("#detail-viewer canvas.pdf-detail-canvas")).toHaveCount(0);
  expect(
    await destroyedCanvas!.evaluate(canvas => ({
      connected: canvas.isConnected,
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    })),
  ).toEqual({ connected: false, width: 0, height: 0 });
});

test("@mobile fractional detail pixels match an independent PDF.js crop raster", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer());
  await zoom(page, 4.125);
  const comparison = await page.evaluate(() => window.fixture.compareDetailPixels());
  expect(comparison.darkPixels).toBeGreaterThan(100);
  expect(comparison.differentPixels / comparison.pixelCount).toBeLessThan(0.005);
});

test("@mobile detail does not duplicate separately presented annotation appearances", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.fixture.createDetailViewer();
    const appearance = "/GS0 gs 1 0 0 rg 0 0 80 80 re f";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [4 0 R] >>",
      "<< /Type /Annot /Subtype /Stamp /Rect [0 700 80 780] /F 16 /AP << /N 5 0 R >> >>",
      `<< /Type /XObject /Subtype /Form /BBox [0 0 80 80] /Resources << /ExtGState << /GS0 << /Type /ExtGState /ca 0.5 >> >> >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`,
    ];
    let source = "%PDF-1.7\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(source.length);
      source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = source.length;
    source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1))
      source += `${String(offset).padStart(10, "0")} 00000 n \n`;
    source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const result = await window.fixture.detailViewer!.load(new TextEncoder().encode(source));
    if (!result.ok) throw new Error("Annotation fixture failed to load");
  });
  await zoom(page, 4.125);
  const appearance = page.locator(`${wrapper} .pdf-annotation-layer canvas`);
  await expect(appearance).toHaveCount(1);
  await appearance.evaluate(canvas => canvas.scrollIntoView({ block: "center", inline: "center" }));
  await expect(async () => {
    const pixel = await page.locator(detail).evaluate(canvasElement => {
      const canvas = canvasElement as HTMLCanvasElement;
      const annotation = canvas.parentElement!.querySelector<HTMLCanvasElement>(
        ".pdf-annotation-layer canvas",
      )!;
      const bounds = canvas.getBoundingClientRect();
      const mark = annotation.getBoundingClientRect();
      const x = mark.left + mark.width / 2 - bounds.left;
      const y = mark.top + mark.height / 2 - bounds.top;
      if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return [];
      return [
        ...canvas
          .getContext("2d")!
          .getImageData(
            Math.floor((x * canvas.width) / bounds.width),
            Math.floor((y * canvas.height) / bounds.height),
            1,
            1,
          ).data,
      ];
    });
    expect(pixel).toEqual([255, 255, 255, 255]);
  }).toPass();
});

test("@mobile fractional high zoom settles at clipped page edges without cancellation churn", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer());
  const start = await page.evaluate(() => window.fixture.logs.length);
  for (const scale of [2.375, 7.333333333333333, 15.875]) {
    await zoom(page, scale);
    await page
      .locator(wrapper)
      .evaluate(element => element.scrollIntoView({ block: "end", inline: "end" }));
    await expect(async () => checkCrop(page)).toPass();
  }
  const cancelled = await page.evaluate(
    start =>
      window.fixture.logs.slice(start).filter(entry => entry.event === "detail-render-cancelled")
        .length,
    start,
  );
  expect(cancelled).toBeLessThan(10);
});

test("@mobile detail regions follow spreads, resizing and presentation transitions", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer());
  await zoom(page);
  await page.evaluate(() => window.fixture.detailViewer!.setPageLayout("double"));
  await zoom(page);
  await page
    .locator(wrapper)
    .evaluate(element => element.scrollIntoView({ block: "start", inline: "start" }));
  await expect(page.locator(detail)).toHaveCount(1);
  await expect(async () => checkCrop(page)).toPass();
  await page.locator("#detail-viewer").evaluate(host => {
    (host as HTMLElement).style.width = "min(500px,100vw)";
    (host as HTMLElement).style.height = "560px";
  });
  await expect(async () => checkCrop(page)).toPass();
  const entered = await page.evaluate(() => window.fixture.detailViewer!.enterPresentationMode());
  expect(entered.ok).toBe(true);
  await expect(page.locator("#detail-viewer .pdf-detail-canvas")).toHaveCount(0);
  await page.evaluate(() => window.fixture.detailViewer!.exitPresentationMode());
  await expect(page.locator(detail)).toHaveCount(1);
  await expect(async () => checkCrop(page)).toPass();
});

test("@mobile details are unnecessary at native resolution and obey a constrained shared memory profile", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.createDetailViewer(8));
  await page.evaluate(() => window.fixture.detailViewer!.zoomTo(0.5));
  await expect
    .poll(() =>
      page
        .locator(`${wrapper} canvas:not(.pdf-detail-canvas)`)
        .evaluate(canvas => (canvas as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await expect(page.locator(detail)).toHaveCount(0);
  await zoom(page);
  await checkCrop(page);
  const allocations = await page.evaluate(() => {
    const calls = window.fixture.detailRenderCalls;
    const canvases = [
      ...new Set([
        ...calls.map(call => call.canvas),
        ...document.querySelectorAll<HTMLCanvasElement>("#detail-viewer canvas"),
      ]),
    ];
    return {
      bytes: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
      dimensions: canvases.map(canvas => [canvas.width, canvas.height]),
    };
  });
  expect(allocations.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(await page.evaluate(() => window.fixture.detailAllocationPeakBytes)).toBeLessThanOrEqual(
    8 * 1024 * 1024,
  );
  for (const [width, height] of allocations.dimensions) {
    expect(width * height).toBeLessThanOrEqual(750_000);
    expect(Math.max(width, height)).toBeLessThanOrEqual(1024);
  }
});

test("@mobile a tight memory profile retains its base fallback without oversized allocations", async ({
  page,
}) => {
  // Public rendering profiles clamp the main memory budget to at least 5 MiB.
  await page.evaluate(() => window.fixture.createDetailViewer(5));
  await page.evaluate(() => window.fixture.detailViewer!.zoomTo(12.375));
  await expect
    .poll(() =>
      page.evaluate(() => window.fixture.detailRenderCalls.some(call => call.width > 6000)),
    )
    .toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator(`${wrapper} canvas:not(.pdf-detail-canvas)`)).toBeVisible();
  expect(await page.evaluate(() => window.fixture.detailAllocationPeakBytes)).toBeLessThanOrEqual(
    5 * 1024 * 1024,
  );
  const allocations = await page.evaluate(() =>
    [
      ...new Set([
        ...window.fixture.detailRenderCalls.map(call => call.canvas),
        ...document.querySelectorAll<HTMLCanvasElement>("#detail-viewer canvas"),
      ]),
    ].map(canvas => [canvas.width, canvas.height]),
  );
  expect(
    allocations.reduce((bytes, [width, height]) => bytes + width * height * 4, 0),
  ).toBeLessThanOrEqual(5 * 1024 * 1024);
  for (const [width, height] of allocations) {
    expect(width * height).toBeLessThanOrEqual(750_000);
    expect(Math.max(width, height)).toBeLessThanOrEqual(1024);
  }
  if (await page.locator(detail).count()) await checkCrop(page);
});

test.describe("high-DPR detail geometry", () => {
  test.use({ deviceScaleFactor: 2 });

  test("@mobile fractional crops remain aligned on a high-DPR viewport", async ({ page }) => {
    await page.evaluate(() => window.fixture.createDetailViewer());
    await page.locator("#detail-viewer").evaluate(host => {
      (host as HTMLElement).style.width = "300px";
    });
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    await zoom(page);
    await checkCrop(page);
    const achievedDpr = await page
      .locator(detail)
      .evaluate(
        canvas =>
          [...window.fixture.detailRenderCalls].reverse().find(call => call.canvas === canvas)!
            .transform[0],
      );
    expect(achievedDpr).toBe(2);
    await page.evaluate(() => window.fixture.detailViewer!.rotateTo(270));
    await expect
      .poll(() =>
        page.locator(detail).evaluateAll(canvases => {
          const call = [...window.fixture.detailRenderCalls]
            .reverse()
            .find(call => call.canvas === canvases[0]);
          return call?.rotation;
        }),
      )
      .toBe(270);
    await checkCrop(page, 270);
  });
});
