// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Generic replacement-aware native print admission, source identity and lifetime regressions. */
import { expect, test, type Page } from "@playwright/test";
import type { PdfjsViewer, PdfjsViewerPageSource } from "../../src/index";

declare global {
  interface Window {
    replacementPrintTest: { viewer: PdfjsViewer; sources: PdfjsViewerPageSource[] };
  }
}
test.setTimeout(60_000);

async function setup(page: Page, policy?: "base" | "display", count = 8, browser = false) {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(
    async ({ policy, count, browser }) => {
      await window.fixture.primary.close();
      window.fixture.primary.destroy();
      const api = window.fixture.pageSources;
      const viewer = api.createViewer({
        rootEl: document.querySelector<HTMLElement>("#primary")!,
        ui: "headless",
        // Exercise rendering with stubbed invocation, not the engine's production print policy.
        deviceCompatibility: (["chromium", "firefox", "webkit"] as const).map(engine => ({
          engine,
          nativePrintSupport: "portrait-and-landscape",
          evidenceId: `synthetic-print-${engine}`,
        })),
        features: {
          forms: true,
          print: {
            mode: browser ? "browser" : "native",
            ...(policy ? { pageSources: policy } : {}),
          },
        },
      });
      const loaded = await viewer.load({
        type: "data",
        data: api.makePdf({
          labels: Array.from({ length: count }, (_, index) => `Base ${index + 1}`),
        }),
      });
      if (!loaded.ok) throw new Error(JSON.stringify(loaded));
      viewer.setActive(false);
      window.replacementPrintTest = { viewer, sources: [] };
    },
    { policy, count, browser },
  );
}

async function prepare(page: Page, label: string, printHidden = false) {
  return page.evaluate(
    async ({ label, printHidden }) => {
      const { viewer, sources } = window.replacementPrintTest;
      const result = await viewer.preparePageSource(
        {
          data: window.fixture.pageSources.makePdf({
            labels: [label],
            color: [0, 0.8, 0.2],
            printHidden,
          }),
        },
        viewer.documentId!,
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
      sources.push(result.source);
      return sources.length - 1;
    },
    { label, printHidden },
  );
}

async function install(page: Page, mappings: Array<[number, number]>) {
  await page.evaluate(async mappings => {
    const { viewer, sources } = window.replacementPrintTest;
    const result = await viewer.setPageSourceOverrides(
      mappings.map(([page, source]) => ({ page, source: sources[source], sourcePage: 1 })),
      viewer.documentId!,
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
  }, mappings);
}

async function print(page: Page, spread = false, pages = [{ from: 2, to: 4 }]) {
  return page.evaluate(
    async ({ spread, pages }) => {
      const { viewer } = window.replacementPrintTest;
      window.fixture.setPrintPermissions("high");
      const trace = window.fixture.pageSources.startPrintTrace();
      const original = window.print;
      let invoked = 0;
      let retained = 0;
      window.print = () => {
        invoked++;
        retained = document.querySelectorAll(".pdf-native-print-root").length;
      };
      try {
        const result = await viewer.print({
          pages,
          quality: { dpi: 72 },
          sheet: "a4",
          layout: spread ? { mode: "spread", firstPageSide: "left", gapPt: 0 } : { mode: "single" },
        });
        window.dispatchEvent(new Event("afterprint"));
        return {
          result,
          trace,
          invoked,
          retained,
          roots: document.querySelectorAll(".pdf-native-print-root").length,
        };
      } finally {
        window.print = original;
      }
    },
    { spread, pages },
  );
}

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(async () => {
    const state = window.replacementPrintTest;
    if (!state) return;
    window.dispatchEvent(new Event("afterprint"));
    for (const source of state.sources) source.release();
    if (state.viewer.state.status !== "destroyed") {
      await state.viewer.close();
      state.viewer.destroy();
    }
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.pageSources.loadingStats().live))
    .toBe(0);
});

for (const policy of [undefined, "base", "display"] as const) {
  test(`native ${policy ?? "default"} content selection preserves canonical defaults`, async ({
    page,
  }) => {
    await setup(page, policy);
    const source = await prepare(page, "Replacement two");
    await install(page, [[2, source]]);
    const result = await print(page);
    expect(result.result).toMatchObject({ ok: true, status: "print-invoked", sheetCount: 3 });
    expect(result.trace.renders.map(render => render.text)).toEqual([
      policy === "display" ? "Replacement two" : "Base 2",
      "Base 3",
      "Base 4",
    ]);
    expect(result.trace.dataReads).toBe(0);
    expect(result.trace.saves).toBe(0);
    expect(result).toMatchObject({ invoked: 1, retained: 1, roots: 0 });
    for (const render of result.trace.renders) {
      expect(render.configDocument).toBe(render.document);
      expect(render.configIntent).toBe("print");
      expect(render.storage).toBe(render.text.startsWith("Base"));
    }
  });
}

test("display selected mixed ranges and two-up sheets stream more bundles than the live cap", async ({
  page,
}) => {
  await setup(page, "display", 10);
  const mappings: Array<[number, number]> = [];
  for (let logical = 2; logical <= 8; logical++)
    mappings.push([logical, await prepare(page, `Auxiliary ${logical}`)]);
  await install(page, mappings);
  await page.evaluate(() => window.fixture.pageSources.loadingStats(true));
  const result = await print(page, true, [
    { from: 1, to: 3 },
    { from: 5, to: 8 },
  ]);
  expect(result.result).toMatchObject({ ok: true, status: "print-invoked" });
  expect(result.trace.renders.map(render => render.text)).toEqual([
    "Base 1",
    "Auxiliary 2",
    "Auxiliary 3",
    "Auxiliary 5",
    "Auxiliary 6",
    "Auxiliary 7",
    "Auxiliary 8",
  ]);
  expect(result.trace.dataReads + result.trace.saves).toBe(0);
  const stats = await page.evaluate(() => window.fixture.pageSources.loadingStats());
  expect(stats.peak).toBeLessThanOrEqual(5);
  expect(stats.live).toBeLessThanOrEqual(5);
  expect(new Set(result.trace.renders.slice(1).map(render => render.document)).size).toBe(6);
});

test("display admission survives reset, replacement and caller release during permission preparation", async ({
  page,
}) => {
  await setup(page, "display");
  const first = await prepare(page, "Admitted two");
  const second = await prepare(page, "Admitted three");
  const later = await prepare(page, "Later two");
  await install(page, [
    [2, first],
    [3, second],
  ]);
  await page.evaluate(later => {
    window.fixture.onNextPrintPermissionRead(async () => {
      const { viewer, sources } = window.replacementPrintTest;
      const result = await viewer.setPageSourceOverrides(
        [
          { page: 2, source: sources[later], sourcePage: 1 },
          { page: 3, source: null },
          { page: 4, source: sources[later], sourcePage: 1 },
        ],
        viewer.documentId!,
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
      sources.forEach(source => source.release());
    });
  }, later);
  const result = await print(page);
  expect(result.result).toMatchObject({ ok: true, status: "print-invoked" });
  expect(result.trace.renders.map(render => render.text)).toEqual([
    "Admitted two",
    "Admitted three",
    "Base 4",
  ]);
  const next = await print(page);
  expect(next.trace.renders.map(render => render.text)).toEqual([
    "Later two",
    "Base 3",
    "Later two",
  ]);
});

test("invoked native images survive source retirement and document close until afterprint", async ({
  page,
}) => {
  await setup(page, "display");
  const source = await prepare(page, "Independently retained native bitmap");
  await install(page, [[2, source]]);
  const result = await page.evaluate(async () => {
    const { viewer, sources } = window.replacementPrintTest;
    window.fixture.setPrintPermissions("high");
    const trace = window.fixture.pageSources.startPrintTrace();
    const originalPrint = window.print;
    let invoked = 0;
    window.print = () => {
      invoked++;
    };
    try {
      const result = await viewer.print({ pages: [{ from: 2, to: 2 }], quality: { dpi: 72 } });
      await viewer.setPageSourceOverrides([{ page: 2, source: null }], viewer.documentId!);
      sources.forEach(source => source.release());
      await viewer.close();
      const retainedRoots = document.querySelectorAll(".pdf-native-print-root").length;
      return {
        result,
        invoked,
        trace,
        retainedRoots,
      };
    } finally {
      window.print = originalPrint;
    }
  });
  expect(result).toMatchObject({
    result: { ok: true, status: "print-invoked" },
    invoked: 1,
    retainedRoots: 1,
  });
  // close() detaches immediately; physical task disposal drains without afterprint.
  await expect
    .poll(() => page.evaluate(() => window.fixture.pageSources.loadingStats().live))
    .toBe(0);
  await expect(page.locator(".pdf-native-print-root")).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".pdf-native-print-root")).toHaveCount(0);
  expect(result.trace.renders.map(render => render.text)).toEqual([
    "Independently retained native bitmap",
  ]);
  expect(result.trace.dataReads + result.trace.saves).toBe(0);
});

test("auto browser output cancels if display mappings change during permission resolution", async ({
  page,
}) => {
  await setup(page, "display", 8, true);
  const source = await prepare(page, "Installed after auto admission");
  const result = await page.evaluate(async source => {
    const { viewer, sources } = window.replacementPrintTest;
    window.fixture.setPrintPermissions("high");
    const trace = window.fixture.pageSources.startPrintTrace();
    let opens = 0;
    let navigations = 0;
    const child = {
      closed: false,
      opener: null,
      close() {
        this.closed = true;
      },
      location: {
        replace() {
          navigations++;
        },
      },
    };
    const originalOpen = window.open;
    window.open = () => {
      opens++;
      return child as never;
    };
    window.fixture.onNextPrintPermissionRead(async () => {
      const installed = await viewer.setPageSourceOverrides(
        [{ page: 2, source: sources[source], sourcePage: 1 }],
        viewer.documentId!,
      );
      if (!installed.ok) throw new Error(JSON.stringify(installed));
    });
    try {
      const result = await viewer.openPrintSource();
      return { result, opens, navigations, closed: child.closed, trace };
    } finally {
      window.open = originalOpen;
    }
  }, source);
  expect(result).toMatchObject({
    result: { ok: false, reason: "cancelled" },
    opens: 1,
    navigations: 0,
    closed: true,
  });
  expect(result.trace.dataReads + result.trace.saves).toBe(0);
});

test("display preflight disables source fallback only while replacements are active", async ({
  page,
}) => {
  await setup(page, "display");
  const source = await prepare(page, "Optional replacement");
  await install(page, [[2, source]]);
  const result = await page.evaluate(async () => {
    const { viewer, sources } = window.replacementPrintTest;
    window.fixture.setPrintPermissions("high");
    const trace = window.fixture.pageSources.startPrintTrace();
    const selected = { pages: [{ from: 2, to: 2 }], quality: { dpi: 72 } };
    const active = await viewer.preflightPrint(selected);
    const reset = await viewer.setPageSourceOverrides(
      [{ page: 2, source: null }],
      viewer.documentId!,
    );
    sources.forEach(source => source.release());
    const base = await viewer.preflightPrint(selected);
    return { active, reset, base, trace };
  });
  expect(result.active).toMatchObject({ ok: true, sourceFallbackAvailable: false });
  expect(result.reset.ok).toBe(true);
  expect(result.base).toMatchObject({ ok: true, sourceFallbackAvailable: true });
  expect(result.trace.renders).toEqual([]);
  expect(result.trace.dataReads + result.trace.saves).toBe(0);
});

test("canonical permissions still deny display native printing without invoking or exporting", async ({
  page,
}) => {
  await setup(page, "display");
  const source = await prepare(page, "Permission-isolated replacement");
  await install(page, [[2, source]]);
  const result = await page.evaluate(async () => {
    const { viewer } = window.replacementPrintTest;
    window.fixture.setPrintPermissions("denied");
    const trace = window.fixture.pageSources.startPrintTrace();
    const original = window.print;
    let invoked = false;
    window.print = () => {
      invoked = true;
    };
    try {
      return {
        result: await viewer.print({ pages: [{ from: 2, to: 2 }], quality: { dpi: 72 } }),
        invoked,
        trace,
      };
    } finally {
      window.print = original;
    }
  });
  expect(result.result).toMatchObject({ ok: false, reason: "disabled" });
  expect(result.invoked).toBe(false);
  expect(result.trace.renders).toEqual([]);
  expect(result.trace.dataReads + result.trace.saves).toBe(0);
  // Permissions are a cached document-lifetime fact, not changed by later fixture policy.
  expect((await print(page)).result).toMatchObject({ ok: false, reason: "disabled" });
});

test("replacement uses its own Print OCG usage rather than screen View or base configuration", async ({
  page,
}) => {
  await setup(page, "display");
  const source = await prepare(page, "Print-hidden color", true);
  await install(page, [[2, source]]);
  await page.evaluate(() => {
    const { viewer } = window.replacementPrintTest;
    viewer.setActive(true);
    viewer.navigateToPage(2);
  });
  const canvas = page.locator('#primary .pdf-page[data-page="2"] > canvas');
  await expect
    .poll(() =>
      canvas.evaluate((canvas: HTMLCanvasElement) =>
        canvas.width > 0
          ? Array.from(
              canvas
                .getContext("2d")!
                .getImageData(
                  Math.floor((canvas.width * 150) / 612),
                  Math.floor((canvas.height * 252) / 792),
                  1,
                  1,
                ).data,
            ).slice(0, 3)
          : [],
      ),
    )
    .toEqual([0, 204, 51]);
  await page.evaluate(() => window.replacementPrintTest.viewer.setActive(false));
  const result = await print(page);
  expect(result.result.ok).toBe(true);
  expect(result.trace.renders[0]).toMatchObject({
    text: "Print-hidden color",
    configIntent: "print",
    storage: false,
    pixel: [255, 255, 255],
  });
  expect(result.trace.renders[0].configDocument).toBe(result.trace.renders[0].document);
  expect(result.trace.renders[1].pixel).toEqual([204, 26, 26]);
});

for (const interruption of ["abort", "load", "destroy", "render", "source"] as const) {
  test(`display ${interruption} failure releases preparation and auxiliary readers`, async ({
    page,
  }) => {
    await setup(page, "display");
    const source = await prepare(page, "Retired replacement");
    await install(page, [[2, source]]);
    const result = await page.evaluate(async interruption => {
      const { viewer, sources } = window.replacementPrintTest;
      window.fixture.setPrintPermissions("high");
      const trace = window.fixture.pageSources.startPrintTrace();
      const controller = new AbortController();
      const original = window.print;
      let invoked = 0;
      window.print = () => {
        invoked++;
      };
      let replacement: Promise<unknown> | undefined;
      window.fixture.onNextPrintPermissionRead(() => {
        sources.forEach(source => source.release());
        if (interruption === "abort") controller.abort();
        if (interruption === "destroy") viewer.destroy();
        if (interruption === "load")
          replacement = viewer.load({
            type: "data",
            data: window.fixture.pageSources.makePdf({ labels: ["Next document"] }),
          });
        if (interruption === "render") trace.failRender = true;
        if (interruption === "source") trace.failSource = true;
      });
      try {
        const result = await viewer
          .print({
            pages: [{ from: 2, to: 2 }],
            quality: { dpi: 72 },
            signal: controller.signal,
          })
          .catch(error => ({ ok: false, error: String(error) }));
        await replacement;
        if (interruption !== "destroy") await viewer.close();
        return {
          result,
          invoked,
          roots: document.querySelectorAll(".pdf-native-print-root").length,
          trace,
        };
      } finally {
        window.print = original;
      }
    }, interruption);
    if (interruption === "render" || interruption === "source") {
      expect(result.result).toMatchObject({
        ok: false,
        error: expect.stringContaining(
          interruption === "render"
            ? "Synthetic replacement print render error"
            : "Synthetic auxiliary page acquisition failure",
        ),
      });
    } else {
      expect(result.result).toMatchObject({ ok: false, reason: "cancelled" });
    }
    expect(result).toMatchObject({ invoked: 0, roots: 0 });
    expect(result.trace.dataReads + result.trace.saves).toBe(0);
    await expect
      .poll(() => page.evaluate(() => window.fixture.pageSources.loadingStats().live))
      .toBe(0);
  });
}

test("display auto source and browser route fail closed while explicit original and form bytes remain canonical", async ({
  page,
}) => {
  await setup(page, "display", 8, true);
  const source = await prepare(page, "Never silently discarded");
  await install(page, [[2, source]]);
  const result = await page.evaluate(async () => {
    const { viewer } = window.replacementPrintTest;
    window.fixture.setPrintPermissions("high");
    const originalOpen = window.open;
    let opens = 0;
    window.open = () => {
      opens++;
      return null;
    };
    try {
      const auto = await viewer.openPrintSource({ document: "auto" });
      const browser = await viewer.print();
      const blockedOpens = opens;
      const originalSource = await viewer.openPrintSource({ document: "original" });
      const filledSource = await viewer.openPrintSource({ document: "with-form-values" });
      const original = await viewer.getDocumentData({ document: "original" });
      const filled = await viewer.getDocumentData({ document: "with-form-values" });
      return {
        auto,
        browser,
        blockedOpens,
        originalSource,
        filledSource,
        opens,
        original: original.ok,
        filled: filled.ok,
        equal:
          original.ok &&
          filled.ok &&
          original.data.length === filled.data.length &&
          original.data.every((byte, index) => byte === filled.data[index]),
      };
    } finally {
      window.open = originalOpen;
    }
  });
  expect(result).toMatchObject({
    auto: { ok: false, reason: "unsupported" },
    browser: { ok: false, reason: "unsupported" },
    blockedOpens: 0,
    opens: 2,
    originalSource: { ok: false, reason: "popup-blocked" },
    filledSource: { ok: false, reason: "popup-blocked" },
    original: true,
    filled: true,
    equal: true,
  });
});
