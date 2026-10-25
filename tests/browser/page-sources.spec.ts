// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";
import type {
  PdfjsViewer,
  PdfjsViewerPageSource,
  PdfjsViewerPageContentDetail,
} from "../../src/index";
import type { SyntheticPdfOptions } from "./synthetic-pdf";

declare global {
  interface Window {
    pageSourceTest: {
      viewer: PdfjsViewer;
      sources: PdfjsViewerPageSource[];
      original: Uint8Array;
      printed: number[][];
      changes: Array<{ documentId: number; revision: number; pages: number[] }>;
      content: PdfjsViewerPageContentDetail[];
      retiredCanvas?: WeakRef<HTMLCanvasElement>;
      retiredThumbnail?: WeakRef<HTMLCanvasElement>;
    };
  }
}

test.setTimeout(60_000);

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const diagnostics = await page.evaluate(() => ({
    state: window.pageSourceTest?.viewer.state,
    content: window.pageSourceTest?.content,
    logs: window.fixture.logs.slice(-30),
    pages: Array.from(document.querySelectorAll<HTMLElement>("#primary .pdf-page")).map(
      element => ({
        page: element.dataset.page,
        annotations: element.querySelectorAll(".linkAnnotation").length,
        rect: element.getBoundingClientRect().toJSON(),
        classes: element.className,
      }),
    ),
  }));
  await info.attach("page-source-diagnostics", {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: "application/json",
  });
});

async function setup(page: Page, fontRendering: "native" | "geometric" = "native", pageCount = 8) {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(
    async ({ fontRendering, pageCount }) => {
      await window.fixture.primary.close();
      window.fixture.primary.destroy();
      const rootEl = document.querySelector<HTMLElement>("#primary")!;
      const original = window.fixture.pageSources.makePdf({
        labels: Array.from({ length: pageCount }, (_, index) => `Canonical page ${index + 1}`),
      });
      const printed: number[][] = [];
      const viewer = window.fixture.pageSources.createViewer({
        rootEl,
        viewerId: "page-sources",
        ui: "default",
        fontRendering,
        logger: entry => window.fixture.logs.push(entry),
        renderingProfiles: {
          balanced: { maxBufferPages: 0, maxBufferViewportHeights: 0 },
          conservative: { thumbnailMemoryLimitMiB: 1 },
        },
        features: { search: true, thumbnails: true, print: "adapter" },
        printAdapter: async context => {
          printed.push(Array.from(await context.getDocumentData({ document: "original" })));
          return { status: "adapter-completed" };
        },
      });
      const state: Window["pageSourceTest"] = {
        viewer,
        original,
        printed,
        sources: [],
        changes: [],
        content: [],
      };
      window.pageSourceTest = state;
      rootEl.addEventListener("pdf:pagesourceschange", event =>
        state.changes.push((event as CustomEvent).detail),
      );
      rootEl.addEventListener("pdf:pagecontent", event =>
        state.content.push((event as CustomEvent).detail),
      );
      const result = await viewer.load({
        type: "data",
        data: original.slice(),
        filename: "canonical.pdf",
      });
      if (!result.ok) throw new Error("Synthetic base load failed");
      viewer.setTextSelectionMode(true);
      window.fixture.pageSources.loadingStats(true);
    },
    { fontRendering, pageCount },
  );
}

for (const failure of ["allocation", "render"] as const) {
  test(`@mobile retired direct-render surface preserves ${failure} failure accounting`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
    const result = await page.evaluate(async failure => {
      window.fixture.primary.destroy();
      const viewer = window.fixture.pageSources.createViewer({
        rootEl: document.querySelector<HTMLElement>("#primary")!,
        ui: "default",
        pageLayout: "single",
        behavior: { zoom: { minDesktop: 2, maxDesktop: 2, minMobile: 2, maxMobile: 2 } },
        renderingProfile: "conservative",
        renderingProfiles: {
          conservative: {
            memoryLimitMiB: 5,
            maxBufferPages: 0,
            maxBufferViewportHeights: 0,
            maxRenderDpr: 1,
            minRenderDpr: 1,
            allowDprReduction: false,
            allowVisibleDirectRendering: true,
          },
        },
        logger: entry => window.fixture.logs.push(entry),
      });
      const prototype = HTMLCanvasElement.prototype;
      const original = prototype.getContext;
      let failures = 0;
      Object.defineProperty(prototype, "getContext", {
        configurable: true,
        writable: true,
        value: function (this: HTMLCanvasElement, ...args: unknown[]) {
          const direct = args[0] === "2d" && this.parentElement?.classList.contains("pdf-page");
          if (direct && failure === "allocation" && failures++ === 0) return null;
          const context = Reflect.apply(original, this, args) as CanvasRenderingContext2D | null;
          if (direct && failure === "render" && context) {
            const fill = context.fillRect.bind(context);
            context.fillRect = (...rect) => {
              // Bound the broken implementation too, so this regression cannot spin forever.
              if (failures++ < 10) throw new Error("Synthetic direct raster failure");
              fill(...rect);
            };
          }
          return context;
        },
      });
      const start = window.fixture.logs.length;
      try {
        const loaded = await viewer.load({
          type: "data",
          data: window.fixture.pageSources.makePdf({ labels: ["Direct failure control"] }),
        });
        const entries = window.fixture.logs.slice(start);
        return {
          ok: loaded.ok,
          retries: entries.filter(entry => entry.event === "page-render-retry").length,
          terminal: entries.filter(entry => entry.event === "page-render-terminal-failure").length,
          fallback: entries.some(entry => Number(entry.details?.allocationFallbackDpr) > 0),
          direct: entries.some(entry => entry.details?.commitStrategy === "attached-canvas"),
        };
      } finally {
        prototype.getContext = original;
        viewer.destroy();
      }
    }, failure);
    expect(result).toEqual({
      ok: failure === "allocation",
      retries: failure === "allocation" ? 1 : 2,
      terminal: failure === "allocation" ? 0 : 1,
      fallback: failure === "allocation",
      direct: true,
    });
  });
}

for (const font of ["native", "geometric"] as const) {
  test(`@mobile evicted thumbnail host is collectible while reader remains open: ${font}`, async ({
    page,
    browserName,
  }) => {
    await setup(page, font, 40);
    await page.getByRole("button", { name: "Document navigation", exact: true }).click();
    await page.getByRole("button", { name: "Thumbnails", exact: true }).click();
    const first = page.locator('#primary .pdf-thumbnail[data-pdf-page-number="1"]');
    await expect(first).toHaveAttribute("data-pdf-thumbnail-ready", "");
    const geometry = await first.evaluate(element => {
      const canvas = element.querySelector("canvas")!;
      window.pageSourceTest.retiredThumbnail = new WeakRef(canvas);
      const bounds = canvas.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        number: element.querySelector("span")?.textContent,
      };
    });
    // Populate more than the conservative 1 MiB budget through actual sidebar demand.
    for (const pageNo of [5, 9, 13, 17, 21, 25, 29, 33, 37, 40]) {
      const item = page.locator(`#primary .pdf-thumbnail[data-pdf-page-number="${pageNo}"]`);
      await item.evaluate(element => {
        const panel = element.closest<HTMLElement>(".pdf-thumbnails")!;
        panel.dispatchEvent(new Event("wheel"));
        panel.scrollTop +=
          element.getBoundingClientRect().top - panel.getBoundingClientRect().top - 40;
      });
      await expect(item).toHaveAttribute("data-pdf-thumbnail-ready", "");
    }
    await page.evaluate(() => window.pageSourceTest.viewer.setRenderingProfile("conservative"));
    await expect(first).not.toHaveAttribute("data-pdf-thumbnail-ready");
    expect(
      await first.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => window.pageSourceTest.retiredThumbnail?.deref()?.isConnected ?? false,
      ),
    ).toBe(false);
    expect(
      await first.evaluate(element => {
        const bounds = element.querySelector("canvas")!.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          number: element.querySelector("span")?.textContent,
        };
      }),
    ).toEqual(geometry);
    if (browserName === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      try {
        await expect
          .poll(async () => {
            await cdp.send("HeapProfiler.collectGarbage");
            return page.evaluate(
              () => window.pageSourceTest.retiredThumbnail?.deref() === undefined,
            );
          })
          .toBe(true);
      } finally {
        await cdp.detach();
      }
    }
    expect(await page.evaluate(() => window.pageSourceTest.viewer.state.status)).toBe("ready");
    await first.evaluate(element => {
      const panel = element.closest<HTMLElement>(".pdf-thumbnails")!;
      panel.scrollTop = 0;
    });
    await expect(first).toHaveAttribute("data-pdf-thumbnail-ready", "");
    expect(
      await first.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width),
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.pageSourceTest.viewer.state.status)).toBe("ready");
  });

  test(`@mobile ordinary evicted canvas releases its context while reader remains open: ${font}`, async ({
    page,
    browserName,
  }) => {
    await setup(page, font);
    const first = page.locator('#primary .pdf-page[data-page="1"] > canvas');
    await expect
      .poll(() => first.evaluate(canvas => (canvas as HTMLCanvasElement).width))
      .toBeGreaterThan(0);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '#primary .pdf-page[data-page="1"] > canvas',
      )!;
      window.pageSourceTest.retiredCanvas = new WeakRef(canvas);
      window.pageSourceTest.viewer.navigateToPage(8);
    });
    await expect
      .poll(() =>
        page
          .locator('#primary .pdf-page[data-page="8"] > canvas')
          .evaluate(canvas => (canvas as HTMLCanvasElement).width),
      )
      .toBeGreaterThan(0);
    await page.evaluate(() => window.pageSourceTest.viewer.setActive(false));
    await expect.poll(() => first.evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBe(0);
    expect(
      await page.evaluate(() => window.pageSourceTest.retiredCanvas?.deref()?.isConnected ?? false),
    ).toBe(false);
    if (browserName === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      try {
        await expect
          .poll(async () => {
            await cdp.send("HeapProfiler.collectGarbage");
            return page.evaluate(() => window.pageSourceTest.retiredCanvas?.deref() === undefined);
          })
          .toBe(true);
      } finally {
        await cdp.detach();
      }
    }
    await page.evaluate(() => {
      window.pageSourceTest.viewer.setActive(true);
      window.pageSourceTest.viewer.navigateToPage(1);
    });
    await expect
      .poll(() => first.evaluate(canvas => (canvas as HTMLCanvasElement).width))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.pageSourceTest.viewer.state.status)).toBe("ready");
  });
}

async function prepare(
  page: Page,
  options: SyntheticPdfOptions,
  linkContext: "source" | "base" = "source",
) {
  const result = await page.evaluate(
    async ({ options, linkContext }) => {
      const state = window.pageSourceTest;
      const data = window.fixture.pageSources.makePdf(options);
      const length = data.byteLength;
      const pending = state.viewer.preparePageSource({ data }, state.viewer.documentId!, {
        linkContext,
      });
      // Preparation must snapshot rather than detach or retain caller-mutable bytes.
      data.fill(0);
      const result = await pending;
      if (!result.ok) return result;
      state.sources.push(result.source);
      return {
        ok: true,
        index: state.sources.length - 1,
        pageCount: result.source.pageCount,
        byteLength: result.source.byteLength,
        length,
        callerLength: data.byteLength,
      };
    },
    { options, linkContext },
  );
  expect(result).toMatchObject({ ok: true, pageCount: options.labels.length });
  if (!("index" in result)) throw new Error(`Source preparation failed: ${JSON.stringify(result)}`);
  expect(result.byteLength).toBe(result.length);
  expect(result.callerLength).toBe(result.length);
  return result.index;
}

async function install(
  page: Page,
  assignments: Array<{ page: number; index: number; sourcePage: number }>,
) {
  const result = await page.evaluate(assignments => {
    const { viewer, sources } = window.pageSourceTest;
    return viewer.setPageSourceOverrides(
      assignments.map(({ page, index, sourcePage }) => ({
        page,
        source: sources[index],
        sourcePage,
      })),
      viewer.documentId!,
    );
  }, assignments);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

async function show(page: Page, logicalPage: number, text: string) {
  await page.evaluate(logicalPage => {
    window.pageSourceTest.viewer.setTextSelectionMode(true);
    window.pageSourceTest.viewer.navigateToPage(logicalPage);
  }, logicalPage);
  await expect
    .poll(() => page.evaluate(() => window.pageSourceTest.viewer.state.currentPage))
    .toBe(logicalPage);
  await expect(
    page.locator(`#primary .pdf-page[data-page="${logicalPage}"] .pdf-text-layer`),
  ).toContainText(text);
}

async function pixel(page: Page, logicalPage: number, thumbnail = false) {
  const selector = thumbnail
    ? `#primary .pdf-thumbnail:nth-child(${logicalPage}) canvas`
    : `#primary .pdf-page[data-page="${logicalPage}"] > canvas`;
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    return Array.from(
      canvas
        .getContext("2d")!
        .getImageData(
          Math.floor((canvas.width * 150) / 612),
          Math.floor((canvas.height * 252) / 792),
          1,
          1,
        ).data,
    ).slice(0, 3);
  });
}

test("@mobile Blob-backed sources survive cold reopening and reject ambiguous descriptors", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { viewer, sources } = window.pageSourceTest;
    const token = viewer.documentId!;
    const data = window.fixture.pageSources.makePdf({ labels: ["Immutable Blob replacement"] });
    const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" });
    const invalid = await viewer.preparePageSource({ data, blob } as never, token);
    const prepared = await viewer.preparePageSource({ blob }, token);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    sources.push(prepared.source);
    const installed = await viewer.setPageSourceOverrides(
      [{ page: 7, source: prepared.source, sourcePage: 1 }],
      token,
    );
    prepared.source.release();
    for (let index = 0; index < 5; index++) {
      const cold = await viewer.preparePageSource({ blob }, token);
      if (!cold.ok) throw new Error(JSON.stringify(cold));
      sources.push(cold.source);
    }
    return { invalid, installed, stats: window.fixture.pageSources.loadingStats() };
  });
  expect(result.invalid).toEqual({ ok: false, reason: "invalid-source" });
  expect(result.installed.ok).toBe(true);
  expect(result.stats).toBeDefined();
  await show(page, 7, "Immutable Blob replacement");
  await page.evaluate(async () => {
    const { viewer, sources } = window.pageSourceTest;
    await viewer.setPageSourceOverrides([{ page: 7, source: null }], viewer.documentId!);
    for (const source of sources) source.release();
  });
  await show(page, 7, "Canonical page 7");
});

for (const fontRendering of ["native", "geometric"] as const) {
  test(`@mobile ${fontRendering}: source page one maps to logical 2/7 without replacing base identity or overlay DOM`, async ({
    page,
  }) => {
    await setup(page, fontRendering);
    const before = await page.evaluate(async () => {
      const { viewer } = window.pageSourceTest;
      const button = document.createElement("button");
      button.id = "source-overlay";
      button.textContent = "Persistent overlay";
      const result = await viewer.registerPageOverlay(
        { page: 2, anchor: { x: 20, y: 100 }, element: button },
        viewer.documentId!,
      );
      if (!result.ok) throw new Error("Overlay registration failed");
      return {
        documentId: viewer.documentId,
        information: await viewer.getDocumentInformation(),
        count: viewer.state.pageCount,
      };
    });
    await show(page, 2, "Canonical page 2");
    const overlay = await page.locator("#source-overlay").elementHandle();
    const wrapper = await page.locator('#primary .pdf-page[data-page="2"]').elementHandle();
    const source = await prepare(page, { labels: ["Auxiliary cobalt"], color: [0.1, 0.2, 0.9] });
    const single = await install(page, [{ page: 2, index: source, sourcePage: 1 }]);
    await show(page, 2, "Auxiliary cobalt");
    await expect.poll(() => pixel(page, 2)).toEqual([26, 51, 230]);
    await expect
      .poll(() =>
        page.evaluate(
          revision =>
            window.pageSourceTest.content.some(
              event =>
                event.page === 2 &&
                event.revision === revision &&
                event.status === "ready" &&
                event.sourceId === window.pageSourceTest.sources[0].id,
            ),
          single.revision,
        ),
      )
      .toBe(true);
    const multiple = await install(page, [
      { page: 2, index: source, sourcePage: 1 },
      { page: 7, index: source, sourcePage: 1 },
    ]);
    expect(multiple.pages).toEqual([7]);
    await show(page, 7, "Auxiliary cobalt");
    await expect.poll(() => pixel(page, 7)).toEqual([26, 51, 230]);
    const after = await page.evaluate(async () => {
      const { viewer, original } = window.pageSourceTest;
      const data = await viewer.getDocumentData();
      return {
        documentId: viewer.documentId,
        information: await viewer.getDocumentInformation(),
        count: viewer.state.pageCount,
        bytesEqual:
          data.ok &&
          data.data.length === original.length &&
          data.data.every((value, index) => value === original[index]),
        auxiliary: await viewer.search("Auxiliary cobalt"),
        base: await viewer.search("Canonical page 2"),
        unchanged: await viewer.search("Canonical page 3"),
      };
    });
    expect(after).toMatchObject({
      ...before,
      bytesEqual: true,
      auxiliary: { ok: true, matches: [{ page: 2 }, { page: 7 }] },
      base: { ok: true, matches: [] },
      unchanged: { ok: true, matches: [{ page: 3 }] },
    });
    expect(
      await overlay!.evaluate(element => element === document.getElementById("source-overlay")),
    ).toBe(true);
    expect(
      await wrapper!.evaluate(
        element => element === document.querySelector('#primary .pdf-page[data-page="2"]'),
      ),
    ).toBe(true);
    await show(page, 2, "Auxiliary cobalt");
    const copied = await page.evaluate(() => {
      const node = document.querySelector(
        '#primary .pdf-page[data-page="2"] .pdf-text-layer span',
      )!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const data = new DataTransfer();
      // Firefox ignores ClipboardEventInit.clipboardData for synthetic events.
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      node.dispatchEvent(event);
      return { selected: selection.toString(), copied: data.getData("text/plain") };
    });
    expect(copied.selected).toBe("Auxiliary cobalt");
    expect(copied.copied).toBe("Auxiliary cobalt");
    expect(await page.evaluate(() => window.pageSourceTest.changes)).toEqual([
      { documentId: before.documentId, revision: single.revision, pages: [2] },
      { documentId: before.documentId, revision: multiple.revision, pages: [7] },
    ]);
    await page.getByRole("button", { name: "Document navigation", exact: true }).click();
    await page.getByRole("button", { name: "Thumbnails", exact: true }).click();
    await expect(page.locator("#primary .pdf-thumbnail").nth(1)).toHaveAttribute(
      "data-pdf-thumbnail-ready",
      "",
    );
    await expect.poll(() => pixel(page, 2, true)).toEqual([26, 51, 230]);
  });
}

test("@mobile clear/no-op and invalid batches preserve atomic mappings and canonical download/print bytes", async ({
  page,
}) => {
  await setup(page);
  const source = await prepare(page, { labels: ["Installed emerald"], color: [0, 0.8, 0.2] });
  const installed = await install(page, [{ page: 2, index: source, sourcePage: 1 }]);
  const outcomes = await page.evaluate(async () => {
    const { viewer, sources, changes, original, printed } = window.pageSourceTest;
    const token = viewer.documentId!;
    const assignment = { page: 2, source: sources[0], sourcePage: 1 };
    const noop = await viewer.setPageSourceOverrides([assignment], token);
    const count = changes.length;
    const invalid = await viewer.setPageSourceOverrides(
      [
        { page: 2, source: null },
        { page: 7, source: sources[0], sourcePage: 2 },
      ],
      token,
    );
    const stale = await viewer.setPageSourceOverrides([{ page: 2, source: null }], token + 1);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await viewer.setPageSourceOverrides([{ page: 2, source: null }], token, {
      signal: controller.signal,
    });
    const print = await viewer.print();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    let downloaded: Blob | undefined;
    URL.createObjectURL = blob => {
      downloaded = blob as Blob;
      return "blob:source-test";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    let download;
    try {
      download = await viewer.download();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
    }
    const downloadBytes = downloaded
      ? new Uint8Array(await downloaded.arrayBuffer())
      : new Uint8Array();
    return {
      noop,
      invalid,
      stale,
      cancelled,
      eventCount: changes.length,
      count,
      print,
      download,
      printedEqual:
        printed[0]?.length === original.length &&
        printed[0].every((value, index) => value === original[index]),
      downloadedEqual:
        downloadBytes.length === original.length &&
        downloadBytes.every((value, index) => value === original[index]),
    };
  });
  expect(outcomes).toMatchObject({
    noop: { ok: true, revision: installed.revision, pages: [] },
    invalid: { ok: false, reason: "invalid-page" },
    stale: { ok: false, reason: "stale-document" },
    cancelled: { ok: false, reason: "cancelled" },
    print: { ok: true, status: "adapter-completed" },
    download: { ok: true },
    printedEqual: true,
    downloadedEqual: true,
  });
  expect(outcomes.eventCount).toBe(outcomes.count);
  await show(page, 2, "Installed emerald");
  const clear = await page.evaluate(async () => {
    const state = window.pageSourceTest;
    state.sources[0].release();
    state.sources[0].release();
    const released = await state.viewer.setPageSourceOverrides(
      [{ page: 7, source: state.sources[0], sourcePage: 1 }],
      state.viewer.documentId!,
    );
    const clear = await state.viewer.setPageSourceOverrides(
      [{ page: 2, source: null }],
      state.viewer.documentId!,
    );
    return { released, clear, changes: state.changes };
  });
  expect(clear.released).toMatchObject({ ok: false, reason: "invalid-source" });
  expect(clear.clear).toMatchObject({ ok: true, revision: installed.revision + 1, pages: [2] });
  expect(clear.changes).toHaveLength(2);
  await show(page, 2, "Canonical page 2");
  await expect.poll(() => pixel(page, 2)).toEqual([204, 26, 26]);
});

test("geometry, foreign handles, non-Link annotations and oversized source-page counts fail closed", async ({
  page,
}) => {
  await setup(page);
  await prepare(page, { labels: ["Valid source"] });
  const results = await page.evaluate(async () => {
    const { viewer, sources } = window.pageSourceTest;
    const token = viewer.documentId!;
    const geometry = [];
    for (const options of [
      { crop: [1, 0, 612, 792] as const },
      { rotation: 90 },
      { userUnit: 2 },
    ]) {
      const result = await viewer.preparePageSource(
        { data: window.fixture.pageSources.makePdf({ labels: ["Wrong geometry"], ...options }) },
        token,
      );
      if (!result.ok) throw new Error(`Geometry source preparation failed: ${result.reason}`);
      geometry.push(
        await viewer.setPageSourceOverrides(
          [
            { page: 2, source: sources[0], sourcePage: 1 },
            { page: 7, source: result.source, sourcePage: 1 },
          ],
          token,
        ),
      );
      result.source.release();
    }
    const rootEl = document.createElement("section");
    document.body.append(rootEl);
    const other = window.fixture.pageSources.createViewer({ rootEl, ui: "headless" });
    await other.load({ type: "data", data: window.pageSourceTest.original.slice() });
    const foreign = await other.setPageSourceOverrides(
      [{ page: 2, source: sources[0], sourcePage: 1 }],
      other.documentId!,
    );
    other.destroy();
    rootEl.remove();
    const rejected = [];
    for (const annotationSubtype of ["Text", "Widget"] as const)
      rejected.push(
        await viewer.preparePageSource(
          {
            data: window.fixture.pageSources.makePdf({
              labels: ["Unsupported"],
              annotationSubtype,
            }),
          },
          token,
        ),
      );
    const oversized = await viewer.preparePageSource(
      {
        data: window.fixture.pageSources.makePdf({
          labels: Array.from({ length: 129 }, () => "Too many pages"),
        }),
      },
      token,
    );
    return { geometry, foreign, rejected, oversized, changes: window.pageSourceTest.changes };
  });
  expect(results.geometry).toEqual(
    Array.from({ length: 3 }, () => ({ ok: false, reason: "geometry-mismatch" })),
  );
  expect(results.foreign).toMatchObject({ ok: false, reason: "invalid-source" });
  expect(results.rejected).toEqual([
    { ok: false, reason: "unsupported" },
    { ok: false, reason: "unsupported" },
  ]);
  expect(results.oversized).toMatchObject({ ok: false, reason: "resource-limit" });
  expect(results.changes).toEqual([]);
  await show(page, 2, "Canonical page 2");
});

test("@mobile source-local named/numeric links map physical pages and refuse unmapped or ambiguous targets", async ({
  page,
}) => {
  await setup(page);
  const source = await prepare(page, {
    labels: ["Source origin", "Source target", "Unmapped source"],
    links: [
      { target: 2, kind: "named" },
      { target: 2, kind: "numeric" },
      { target: 3, kind: "reference" },
    ],
  });
  await install(page, [
    { page: 2, index: source, sourcePage: 1 },
    { page: 7, index: source, sourcePage: 2 },
  ]);
  for (const index of [0, 1]) {
    await show(page, 2, "Source origin");
    await page.evaluate(() => window.pageSourceTest.viewer.setTextSelectionMode(false));
    await page.locator('#primary .pdf-page[data-page="2"] .linkAnnotation a').nth(index).click();
    await expect
      .poll(() => page.evaluate(() => window.pageSourceTest.viewer.state.currentPage))
      .toBe(7);
  }
  await show(page, 2, "Source origin");
  await page.evaluate(() => window.pageSourceTest.viewer.setTextSelectionMode(false));
  await page.locator('#primary .pdf-page[data-page="2"] .linkAnnotation a').nth(2).click();
  expect(await page.evaluate(() => window.pageSourceTest.viewer.state.currentPage)).toBe(2);
  await install(page, [{ page: 6, index: source, sourcePage: 2 }]);
  await page.locator('#primary .pdf-page[data-page="2"] .linkAnnotation a').first().click();
  expect(await page.evaluate(() => window.pageSourceTest.viewer.state.currentPage)).toBe(2);
});

for (const linkContext of ["source", "base"] as const) {
  for (const interruption of ["none", "navigate", "replace", "restore"] as const) {
    test(`@mobile ${linkContext}-context link retains only current authority after ${interruption} during destination resolution`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setup(page);
      const source = await prepare(
        page,
        {
          labels: ["Gated origin", "Gated target"],
          links: [{ target: 2, kind: "named" }],
        },
        linkContext,
      );
      await install(page, [
        { page: 2, index: source, sourcePage: 1 },
        { page: 7, index: source, sourcePage: 2 },
      ]);
      await show(page, 2, "Gated origin");
      const link = page.locator('#primary .pdf-page[data-page="2"] .linkAnnotation a').first();
      await expect(link).toBeAttached();
      const result = await page.evaluate(
        async ({ linkContext, interruption, source }) => {
          const { viewer, sources } = window.pageSourceTest;
          viewer.setTextSelectionMode(false);
          // Numeric Fit results leave no unrelated page/ref RPC after the controlled gate.
          const gate = window.fixture.pageSources.gateNextNamedDestination([
            linkContext === "source" ? 1 : 6,
            { name: "Fit" },
          ]);
          try {
            document
              .querySelector<HTMLAnchorElement>(
                '#primary .pdf-page[data-page="2"] .linkAnnotation a',
              )!
              .click();
            await gate.entered;
            if (interruption === "navigate") viewer.navigateToPage(4);
            else if (interruption !== "none") {
              const mutation = await viewer.setPageSourceOverrides(
                interruption === "restore"
                  ? [{ page: 2, source: null }]
                  : [{ page: 2, source: sources[source], sourcePage: 2 }],
                viewer.documentId!,
              );
              if (!mutation.ok) throw new Error(JSON.stringify(mutation));
            }
            gate.release();
            // All post-gate destination work is local microtasks; frames flush scroll state too.
            await new Promise<void>(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            return {
              page: viewer.state.currentPage,
              forward: viewer.state.canGoForward,
            };
          } finally {
            gate.release();
          }
        },
        { linkContext, interruption, source },
      );
      expect(result.page).toBe(interruption === "none" ? 7 : interruption === "navigate" ? 4 : 2);
      expect(result.forward).toBe(false);
    });
  }
}

test("@mobile base-context named and numeric destinations retain canonical identity despite duplicate annotation IDs", async ({
  page,
}) => {
  await setup(page);
  const first = await prepare(
    page,
    {
      labels: ["Base-context origin"],
      links: [
        { target: 2, kind: "named" },
        { target: 7, kind: "numeric" },
      ],
    },
    "base",
  );
  const second = await prepare(
    page,
    { labels: ["Second origin"], links: [{ target: 2, kind: "named" }] },
    "base",
  );
  await install(page, [
    { page: 4, index: first, sourcePage: 1 },
    { page: 5, index: second, sourcePage: 1 },
  ]);
  for (const [origin, link, target, label] of [
    [4, 0, 2, "Base-context origin"],
    [4, 1, 7, "Base-context origin"],
    [5, 0, 2, "Second origin"],
  ] as const) {
    await show(page, origin, label);
    await expect(
      page.locator(`#primary .pdf-page[data-page="${origin}"] .linkAnnotation a`).first(),
    ).toBeAttached({ timeout: 5000 });
    await page.evaluate(() => window.pageSourceTest.viewer.setTextSelectionMode(false));
    await expect(
      page.locator(`#primary .pdf-page[data-page="${origin}"] .linkAnnotation a`).first(),
    ).toBeAttached({ timeout: 5000 });
    await page
      .locator(`#primary .pdf-page[data-page="${origin}"] .linkAnnotation a`)
      .nth(link)
      .click();
    await expect
      .poll(() => page.evaluate(() => window.pageSourceTest.viewer.state.currentPage))
      .toBe(target);
  }
  const refused = await page.evaluate(() =>
    window.pageSourceTest.viewer.preparePageSource(
      {
        data: window.fixture.pageSources.makePdf({
          labels: ["Foreign refs", "Target"],
          links: [{ target: 2, kind: "reference" }],
        }),
      },
      window.pageSourceTest.viewer.documentId!,
      { linkContext: "base" },
    ),
  );
  expect(refused).toMatchObject({ ok: false, reason: "unsupported" });
});

test("@mobile more than four shared-font sources cold-reopen within bounded live PDF slots", async ({
  page,
}) => {
  await setup(page);
  // This existing generic fixture embeds the licensed PDF.js Liberation font, not an external asset.
  const retained = await page.evaluate(async () => {
    const state = window.pageSourceTest;
    const response = await fetch("/hinted-font.pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let families: string[] = [];
    for (let index = 0; index < 7; index++) {
      const result = await state.viewer.preparePageSource(
        { data: bytes },
        state.viewer.documentId!,
      );
      if (!result.ok) throw new Error(`Embedded source ${index}: ${result.reason}`);
      state.sources.push(result.source);
      const ready =
        index === 0
          ? new Promise<void>(resolve => {
              const root = document.querySelector("#primary")!;
              const listener = (event: Event) => {
                const detail = (event as CustomEvent<PdfjsViewerPageContentDetail>).detail;
                if (
                  detail.page !== 1 ||
                  detail.sourceId !== result.source.id ||
                  detail.status !== "ready"
                )
                  return;
                root.removeEventListener("pdf:pagecontent", listener);
                resolve();
              };
              root.addEventListener("pdf:pagecontent", listener);
            })
          : undefined;
      const installed = await state.viewer.setPageSourceOverrides(
        [{ page: index + 1, source: result.source, sourcePage: 1 }],
        state.viewer.documentId!,
      );
      if (!installed.ok) throw new Error(`Embedded install ${index}: ${installed.reason}`);
      if (ready) {
        await ready;
        families = Array.from(document.fonts)
          .filter(font => /^g_d/.test(font.family) && font.status === "loaded")
          .map(font => font.family);
      }
    }
    return {
      families,
      retained: families.every(family =>
        Array.from(document.fonts).some(font => font.family === family && font.status === "loaded"),
      ),
    };
  });
  expect(retained.families.length).toBeGreaterThan(0);
  expect(retained.retained).toBe(true);
  const before = await page.evaluate(() => window.fixture.pageSources.loadingStats());
  expect(before.live).toBeLessThanOrEqual(5);
  expect(before.peak).toBeLessThanOrEqual(5);
  for (const logicalPage of [1, 7, 2, 6, 1]) {
    await show(page, logicalPage, "Small text:");
    await expect
      .poll(() =>
        page.evaluate(
          logicalPage =>
            window.pageSourceTest.content.some(
              event =>
                event.page === logicalPage && event.sourceId !== null && event.status === "ready",
            ),
          logicalPage,
        ),
      )
      .toBe(true);
  }
  const after = await page.evaluate(() => window.fixture.pageSources.loadingStats());
  expect(after.admissions).toBeGreaterThan(before.admissions);
  expect(after.peak).toBeLessThanOrEqual(5);
  expect(after.live).toBeLessThanOrEqual(5);
  const search = await page.evaluate(() => window.pageSourceTest.viewer.search("Small text:"));
  expect(search).toMatchObject({
    ok: true,
    matches: Array.from({ length: 7 }, (_, index) => ({ page: index + 1 })),
  });
  await page.evaluate(() => window.pageSourceTest.viewer.close());
  await expect
    .poll(() => page.evaluate(() => window.fixture.pageSources.loadingStats().live))
    .toBe(0);
});

test("mapping publication precedes gated lazy source pixels and reports the logical page revision", async ({
  page,
}) => {
  await setup(page);
  const first = await prepare(page, { labels: ["First pixels"] });
  await install(page, [{ page: 2, index: first, sourcePage: 1 }]);
  await show(page, 2, "First pixels");
  await page.evaluate(() =>
    window.pageSourceTest.viewer.setPageSourceOverrides(
      [{ page: 2, source: null }],
      window.pageSourceTest.viewer.documentId!,
    ),
  );
  await show(page, 2, "Canonical page 2");
  const second = await prepare(page, { labels: ["Delayed pixels"], color: [0.1, 0.2, 0.9] });
  const published = await page.evaluate(async second => {
    const state = window.pageSourceTest;
    const gate = window.fixture.pageSources.gateNextPageAcquisition();
    try {
      const result = await state.viewer.setPageSourceOverrides(
        [{ page: 2, source: state.sources[second], sourcePage: 1 }],
        state.viewer.documentId!,
      );
      if (!result.ok) throw new Error(`Gated install failed: ${result.reason}`);
      await gate.entered;
      return {
        result,
        change: state.changes.at(-1),
        prematurePixels: state.content.some(
          event => event.page === 2 && event.revision === result.revision,
        ),
      };
    } finally {
      gate.release();
    }
  }, second);
  expect(published.result).toMatchObject({ ok: true, pages: [2] });
  expect(published.change).toMatchObject({ revision: published.result.revision, pages: [2] });
  expect(published.prematurePixels).toBe(false);
  await show(page, 2, "Delayed pixels");
  await expect
    .poll(() =>
      page.evaluate(
        revision =>
          window.pageSourceTest.content.some(
            event =>
              event.page === 2 &&
              event.revision === revision &&
              event.sourceId === window.pageSourceTest.sources[1].id &&
              event.status === "ready",
          ),
        published.result.revision,
      ),
    )
    .toBe(true);
  await expect.poll(() => pixel(page, 2)).toEqual([26, 51, 230]);
});

test("lazy pixel failure reports the published source revision and can clear to base", async ({
  page,
}) => {
  await setup(page);
  const first = await prepare(page, { labels: ["Usable pixels"], color: [0, 0.8, 0.2] });
  await install(page, [{ page: 2, index: first, sourcePage: 1 }]);
  await show(page, 2, "Usable pixels");
  await expect.poll(() => pixel(page, 2)).toEqual([0, 204, 51]);
  const second = await prepare(page, { labels: ["Failed replacement"] });
  const published = await page.evaluate(async second => {
    const { viewer, sources } = window.pageSourceTest;
    viewer.setTextSelectionMode(false);
    const gate = window.fixture.pageSources.gateNextPageAcquisition();
    try {
      const result = await viewer.setPageSourceOverrides(
        [{ page: 2, source: sources[second], sourcePage: 1 }],
        viewer.documentId!,
      );
      if (!result.ok) throw new Error(`Failure probe publication failed: ${result.reason}`);
      await gate.entered;
      return result;
    } finally {
      gate.release(new Error("Synthetic source page acquisition failure"));
    }
  }, second);
  await expect
    .poll(() =>
      page.evaluate(
        revision =>
          window.pageSourceTest.content.some(
            event =>
              event.page === 2 &&
              event.revision === revision &&
              event.sourceId === window.pageSourceTest.sources[1].id &&
              event.status === "error" &&
              event.error != null,
          ),
        published.revision,
      ),
    )
    .toBe(true);
  const restored = await page.evaluate(() =>
    window.pageSourceTest.viewer.setPageSourceOverrides(
      [{ page: 2, source: null }],
      window.pageSourceTest.viewer.documentId!,
    ),
  );
  expect(restored).toMatchObject({ ok: true, revision: published.revision + 1, pages: [2] });
  await show(page, 2, "Canonical page 2");
  await expect.poll(() => pixel(page, 2)).toEqual([204, 26, 26]);
});

test("delayed source preparation aborts or becomes stale across book replacement without publication", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const state = window.pageSourceTest;
    const api = window.fixture.pageSources;
    const token = state.viewer.documentId!;
    // Finish eager search first so the acquisition gate belongs to auxiliary preparation.
    await state.viewer.search("Canonical");
    const gate = api.gateNextPageAcquisition();
    const controller = new AbortController();
    const pending = state.viewer.preparePageSource(
      { data: api.makePdf({ labels: ["Cancelled source"] }) },
      token,
      { signal: controller.signal },
    );
    await gate.entered;
    controller.abort();
    gate.release();
    const aborted = await pending;
    const secondGate = api.gateNextPageAcquisition();
    const second = state.viewer.preparePageSource(
      { data: api.makePdf({ labels: ["Stale source"] }) },
      token,
    );
    await secondGate.entered;
    const replacement = state.viewer.load({
      type: "data",
      data: api.makePdf({ labels: ["Replacement book"] }),
    });
    secondGate.release();
    const stale = await second;
    await replacement;
    return {
      aborted,
      stale,
      changes: state.changes,
      sourceContent: state.content.filter(event => event.sourceId !== null),
      oldToken: await state.viewer.setPageSourceOverrides([{ page: 1, source: null }], token),
    };
  });
  expect(result).toMatchObject({
    aborted: { ok: false, reason: "cancelled" },
    stale: { ok: false, reason: "stale-document" },
    changes: [],
    sourceContent: [],
    oldToken: { ok: false, reason: "stale-document" },
  });
  await show(page, 1, "Replacement book");
});
