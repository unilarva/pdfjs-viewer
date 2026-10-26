// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Synthetic host-output admission, browser navigation, and operation-lifetime regressions. */
import { expect, test, type Page } from "@playwright/test";
import type {
  PdfjsViewer,
  PdfjsViewerPageSource,
  PdfjsViewerPrintOutputContext,
  PdfjsViewerPrintOutputProvider,
  PdfjsViewerPrintResult,
} from "../../src/index";

type ProviderMode =
  | "bytes"
  | "buffer"
  | "blob"
  | "absent"
  | "null"
  | "throw"
  | "malformed"
  | "thenable"
  | "reject"
  | "empty"
  | "invalid"
  | "opaque"
  | "realm-bytes"
  | "realm-buffer"
  | "realm-blob"
  | "class"
  | "deferred";

interface OutputTestState {
  viewer: PdfjsViewer;
  sources: PdfjsViewerPageSource[];
  contexts: PdfjsViewerPrintOutputContext[];
  captures: string[];
  hostValue: string;
  resolves: number;
  releases: number[];
  aborts: number[];
  opens: number;
  invoked: number;
  legacyCalls: number;
  denyPopup: boolean;
  failNavigation: boolean;
  failInvocation: boolean;
  children: Array<{ closed: boolean; close(): void }>;
  urls: string[];
  revoked: string[];
  texts: Promise<string>[];
  baseText: string;
  pending?: Promise<PdfjsViewerPrintResult>;
  settled: boolean;
  settle?: (reject?: boolean) => void;
  admissionHook?: () => void;
  routeHook?: () => void;
  rendered?: { text: string }[];
  restore(): void;
}

declare global {
  interface Window {
    printOutputTest: OutputTestState;
  }
}

test.setTimeout(60_000);

/** Installs only browser-facing stubs; PDFs still load and render through the real fixture runtime. */
async function setup(
  page: Page,
  options: {
    provider?: ProviderMode;
    route?: "browser" | "native" | "fallback";
    input?: "data" | "url" | "authenticated";
    policy?: "base" | "display";
    ui?: "headless" | "default" | "custom";
    legacyDeferred?: boolean;
    sheetLimit?: boolean;
  } = {},
) {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  await page.evaluate(async options => {
    await window.fixture.primary.close();
    window.fixture.primary.destroy();
    const api = window.fixture.pageSources;
    const root = document.querySelector<HTMLElement>("#primary")!;
    const ui = options.ui ?? "headless";
    root.replaceChildren();
    if (ui === "custom")
      root.innerHTML =
        '<button class="pdf-print-btn">Print</button><div class="pdf-container"></div>';
    const originalOpen = window.open;
    const originalPrint = window.print;
    const originalRevoke = URL.revokeObjectURL;
    const mode = options.provider ?? "bytes";
    const base = api.makePdf({ labels: ["Canonical first", "Canonical second"] });
    const baseUrl = URL.createObjectURL(new Blob([base as BlobPart], { type: "application/pdf" }));
    const state: OutputTestState = {
      viewer: undefined as unknown as PdfjsViewer,
      sources: [],
      contexts: [],
      captures: [],
      hostValue: "Admitted current output",
      resolves: 0,
      releases: [],
      aborts: [],
      opens: 0,
      invoked: 0,
      legacyCalls: 0,
      denyPopup: false,
      failNavigation: false,
      failInvocation: false,
      children: [],
      urls: [],
      revoked: [],
      texts: [],
      baseText: new TextDecoder().decode(base),
      settled: false,
      restore() {
        window.open = originalOpen;
        window.print = originalPrint;
        URL.revokeObjectURL = originalRevoke;
        originalRevoke.call(URL, baseUrl);
        document.querySelectorAll("[data-print-output-realm]").forEach(frame => frame.remove());
      },
    };
    window.printOutputTest = state;
    window.open = () => {
      state.opens++;
      if (state.denyPopup) return null;
      const child = {
        closed: false,
        opener: null,
        close() {
          this.closed = true;
        },
        location: {
          replace(url: string) {
            state.urls.push(url);
            if (state.failNavigation) throw new Error("Synthetic navigation failure");
            state.texts.push(fetch(url).then(response => response.text()));
          },
        },
      };
      state.children.push(child);
      return child as unknown as Window;
    };
    window.print = () => {
      state.invoked++;
      if (state.failInvocation) throw new Error("Synthetic invocation failure");
    };
    URL.revokeObjectURL = url => {
      state.revoked.push(url);
      originalRevoke.call(URL, url);
    };
    const provider: PdfjsViewerPrintOutputProvider = context => {
      const index = state.contexts.push(context) - 1;
      state.captures.push(state.hostValue);
      state.releases.push(0);
      state.aborts.push(0);
      context.signal.addEventListener("abort", () => state.aborts[index]++);
      const bytes = api.makePdf({ labels: [state.hostValue] });
      state.admissionHook?.();
      if (mode === "null") return null;
      if (mode === "throw") throw new Error("Synthetic admission failure");
      if (mode === "malformed") return {} as never;
      // A rejecting promise is deliberately invalid synchronous admission, not an exporter.
      if (mode === "thenable")
        return Promise.reject(new Error("Late admission rejection")) as never;
      if (mode === "class")
        return new (class {
          constructor(readonly bytes: Uint8Array) {}
          release() {
            state.releases[index]++;
          }
          resolveSource() {
            state.resolves++;
            return this.bytes;
          }
        })(bytes);
      return {
        release() {
          state.releases[index]++;
        },
        resolveSource() {
          state.resolves++;
          if (mode === "reject") return Promise.reject(new Error("Synthetic export failure"));
          if (mode === "empty") return new Uint8Array();
          if (mode === "invalid") return "not byte output" as never;
          if (mode === "opaque") return new TextEncoder().encode("Nonempty host-owned byte output");
          if (mode.startsWith("realm-")) {
            const frame = document.createElement("iframe");
            frame.dataset.printOutputRealm = "";
            frame.hidden = true;
            document.body.append(frame);
            const realm = frame.contentWindow as Window & typeof globalThis;
            if (mode === "realm-blob") return new realm.Blob([bytes as BlobPart]);
            const foreign = new realm.Uint8Array(bytes);
            return mode === "realm-buffer" ? foreign.buffer : foreign;
          }
          if (mode === "buffer") return bytes.slice().buffer;
          if (mode === "blob") return new Blob([bytes as BlobPart], { type: "application/pdf" });
          if (mode === "deferred")
            return new Promise<Uint8Array>((resolve, reject) => {
              state.settle = fail => {
                if (fail) reject(new Error("Late resolver rejection"));
                else resolve(bytes);
              };
            });
          return bytes;
        },
      };
    };
    state.viewer = api.createViewer({
      rootEl: root,
      ui,
      ...(options.sheetLimit
        ? { renderingProfiles: { balanced: { print: { maxSheets: 1 } } } }
        : {}),
      deviceCompatibility: (["chromium", "firefox", "webkit"] as const).map(engine => ({
        engine,
        platform: "desktop",
        nativePrintSupport: options.route === "fallback" ? "unsupported" : "portrait-and-landscape",
        evidenceId: `synthetic-output-${engine}`,
      })),
      features: {
        forms: true,
        print: {
          mode: options.route === "native" || options.route === "fallback" ? "native" : "browser",
          pageSources: options.policy ?? "display",
        },
      },
      ...(mode === "absent" ? {} : { printOutputProvider: provider }),
      logger: entry => {
        if (entry.event === "print-route-selected") state.routeHook?.();
      },
      ...(options.input === "authenticated"
        ? {
            defaultDocumentOptions: {
              httpHeaders: { "X-Synthetic-Auth": "fixture" },
              withCredentials: true,
            },
          }
        : {}),
      printSourceResolver: () => {
        state.legacyCalls++;
        if (options.legacyDeferred)
          return new Promise<Uint8Array>((resolve, reject) => {
            state.settle = fail => {
              if (fail) reject(new Error("Late legacy resolver rejection"));
              else resolve(api.makePdf({ labels: ["Delayed legacy output"] }));
            };
          });
        return api.makePdf({ labels: ["Legacy resolver must not win"] });
      },
    });
    const loaded = await state.viewer.load(
      options.input === "url" || options.input === "authenticated"
        ? {
            type: "url",
            url: baseUrl,
          }
        : { type: "data", data: base },
    );
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    state.viewer.setActive(ui !== "headless");
    window.fixture.setPrintPermissions("high");
  }, options);
}

/** Adds a real replacement so fail-closed assertions cannot accidentally exercise canonical output. */
async function install(page: Page) {
  await page.evaluate(async () => {
    const state = window.printOutputTest;
    // Auxiliary source admission rejects permission-bearing PDFs; do not apply the canonical print stub.
    window.fixture.setPrintPermissions("runtime");
    const prepared = await state.viewer.preparePageSource(
      { data: window.fixture.pageSources.makePdf({ labels: ["Display replacement"] }) },
      state.viewer.documentId!,
    );
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    state.sources.push(prepared.source);
    const installed = await state.viewer.setPageSourceOverrides(
      [{ page: 2, source: prepared.source, sourcePage: 1 }],
      state.viewer.documentId!,
    );
    window.fixture.setPrintPermissions("high");
    if (!installed.ok) throw new Error(JSON.stringify(installed));
  });
}

/** Reads serializable observations while leaving actual AbortSignals in the browser. */
async function observations(page: Page) {
  return page.evaluate(async () => {
    const state = window.printOutputTest;
    return {
      contexts: state.contexts.map(context => ({
        operationId: context.operationId,
        documentId: context.documentId,
        pageSources: context.pageSources,
        pageSourcesRevision: context.pageSourcesRevision,
        aborted: context.signal.aborted,
      })),
      captures: state.captures,
      resolves: state.resolves,
      releases: state.releases,
      aborts: state.aborts,
      opens: state.opens,
      invoked: state.invoked,
      legacyCalls: state.legacyCalls,
      closed: state.children.map(child => child.closed),
      urls: state.urls,
      revoked: state.revoked,
      texts: await Promise.all(state.texts),
    };
  });
}

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(async () => {
    const state = window.printOutputTest;
    if (!state) return;
    state.children.forEach(child => child.close());
    state.settle?.();
    window.dispatchEvent(new Event("afterprint"));
    state.sources.forEach(source => source.release());
    try {
      if (state.viewer.state.status !== "destroyed") {
        await state.viewer.close();
        state.viewer.destroy();
      }
    } finally {
      state.restore();
    }
  });
  await expect
    .poll(() => page.evaluate(() => window.fixture.pageSources.loadingStats().live))
    .toBe(0);
});

test("native admission captures IDs, mapping revision and host state synchronously; preflight never admits", async ({
  page,
}) => {
  await setup(page, { route: "native" });
  await install(page);
  const result = await page.evaluate(async () => {
    const state = window.printOutputTest;
    const options = { pages: [{ from: 2, to: 2 }], quality: { dpi: 72 } };
    const preflight = await state.viewer.preflightPrint(options);
    const preflightCalls = state.contexts.length;
    const documentId = state.viewer.documentId;
    const trace = window.fixture.pageSources.startPrintTrace();
    const pending = state.viewer.print(options);
    state.hostValue = "Changed after admission";
    const synchronous = {
      calls: state.contexts.length,
      aborted: state.contexts[0]?.signal.aborted,
      captures: [...state.captures],
    };
    const result = await pending;
    return { preflight, preflightCalls, documentId, synchronous, result, trace };
  });
  expect(result.preflight.ok).toBe(true);
  expect(result.preflightCalls).toBe(0);
  expect(result.synchronous).toEqual({
    calls: 1,
    aborted: false,
    captures: ["Admitted current output"],
  });
  expect(result.result).toMatchObject({ ok: true, status: "print-invoked" });
  expect(result.trace.renders.map(render => render.text)).toEqual(["Display replacement"]);
  expect(result.trace.dataReads + result.trace.saves).toBe(0);
  const state = await observations(page);
  expect(state).toMatchObject({ resolves: 0, releases: [1], aborts: [1], opens: 0, invoked: 1 });
  expect(state.contexts[0]).toMatchObject({
    documentId: result.documentId,
    pageSources: "display",
    aborted: true,
  });
  expect(state.contexts[0].operationId).toBeGreaterThan(0);
  expect(state.contexts[0].pageSourcesRevision).toBeGreaterThan(0);
  // Host admission ends at invocation, independently of retained native images.
  await expect(page.locator(".pdf-native-print-root")).toHaveCount(1);
});

for (const input of ["data", "url", "authenticated"] as const) {
  for (const document of ["auto", "current"] as const) {
    test(`${input} ${document} opens captured current bytes rather than original URL or legacy resolver`, async ({
      page,
    }) => {
      await setup(page, { input });
      await install(page);
      const result = await page.evaluate(async document => {
        const state = window.printOutputTest;
        const pending = state.viewer.openPrintSource({ document });
        const synchronous = { admissions: state.contexts.length, opens: state.opens };
        state.hostValue = "Not the admitted output";
        return { synchronous, result: await pending };
      }, document);
      expect(result).toMatchObject({
        synchronous: { admissions: 1, opens: 1 },
        result: { ok: true, status: "source-opened" },
      });
      const state = await observations(page);
      expect(state).toMatchObject({
        resolves: 1,
        releases: [1],
        aborts: [1],
        legacyCalls: 0,
        closed: [false],
      });
      expect(state.urls[0]).toMatch(/^blob:/);
      expect(state.texts[0]).toContain("Admitted current output");
      expect(state.texts[0]).not.toContain("Canonical first");
      expect(state.texts[0]).not.toContain("Not the admitted output");
      expect(state.revoked).not.toContain(state.urls[0]);
    });
  }
}

for (const provider of ["buffer", "blob"] as const) {
  test(`${provider} provider output is materialized without requiring a parser`, async ({
    page,
  }) => {
    await setup(page, { provider });
    expect(
      await page.evaluate(() =>
        window.printOutputTest.viewer.openPrintSource({
          document: "current",
          navigation: "materialize",
        }),
      ),
    ).toMatchObject({ ok: true });
    const state = await observations(page);
    expect(state.texts[0]).toContain("Admitted current output");
    expect(state).toMatchObject({ resolves: 1, releases: [1], aborts: [1] });
  });
}

test("nonempty provider bytes are not parsed or mistaken for canonical input", async ({ page }) => {
  await setup(page, { provider: "opaque", policy: "base" });
  expect(await page.evaluate(() => window.printOutputTest.viewer.openPrintSource())).toMatchObject({
    ok: true,
  });
  const state = await observations(page);
  expect(state.texts).toEqual(["Nonempty host-owned byte output"]);
  expect(state.contexts[0]).toMatchObject({ pageSources: "base", aborted: true });
  expect(state).toMatchObject({ resolves: 1, releases: [1], aborts: [1], legacyCalls: 0 });
});

test("explicit URL original preserves legacy direct-URL precedence and bypasses current provider", async ({
  page,
}) => {
  await setup(page, { input: "url", provider: "throw" });
  await install(page);
  expect(
    await page.evaluate(() =>
      window.printOutputTest.viewer.openPrintSource({ document: "original" }),
    ),
  ).toMatchObject({ ok: true });
  const state = await observations(page);
  expect(state).toMatchObject({ contexts: [], resolves: 0, legacyCalls: 1 });
  expect(state.texts[0]).toContain("Canonical first");
  expect(state.texts[0]).not.toContain("Legacy resolver must not win");
});

test("explicit original/form source and data requests bypass provider and retain canonical bytes", async ({
  page,
}) => {
  await setup(page, { provider: "throw" });
  await install(page);
  const result = await page.evaluate(async () => {
    const state = window.printOutputTest;
    const original = await state.viewer.openPrintSource({
      document: "original",
      navigation: "materialize",
    });
    const filled = await state.viewer.openPrintSource({
      document: "with-form-values",
      navigation: "materialize",
    });
    const data = await state.viewer.getDocumentData({ document: "original" });
    const form = await state.viewer.getDocumentData({ document: "with-form-values" });
    return {
      original,
      filled,
      originalEqual: data.ok && new TextDecoder().decode(data.data) === state.baseText,
      formEqual: form.ok && new TextDecoder().decode(form.data) === state.baseText,
      openedEqual: (await Promise.all(state.texts)).every(text => text === state.baseText),
    };
  });
  expect(result).toMatchObject({
    original: { ok: true },
    filled: { ok: true },
    originalEqual: true,
    formEqual: true,
    openedEqual: true,
  });
  expect(await observations(page)).toMatchObject({ contexts: [], resolves: 0, releases: [] });
});

for (const provider of [
  "absent",
  "null",
  "throw",
  "malformed",
  "thenable",
  "reject",
  "empty",
  "invalid",
] as const) {
  test(`${provider} provider fails closed without navigating canonical content or leaking rejection`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await setup(page, { provider });
    await install(page);
    const result = await page.evaluate(() => window.printOutputTest.viewer.openPrintSource());
    expect(result).toMatchObject({
      ok: false,
      reason: provider === "absent" || provider === "null" ? "unsupported" : "export-failed",
    });
    const state = await observations(page);
    expect(state.urls).toEqual([]);
    expect(state.legacyCalls).toBe(0);
    expect(state.closed.every(Boolean)).toBe(true);
    if (["reject", "empty", "invalid"].includes(provider))
      expect(state).toMatchObject({ resolves: 1, releases: [1], aborts: [1] });
    await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    expect(errors).toEqual([]);
  });
}

test("null admission denies even canonical output with no replacements", async ({ page }) => {
  await setup(page, { provider: "null", policy: "base" });
  expect(await page.evaluate(() => window.printOutputTest.viewer.openPrintSource())).toMatchObject({
    ok: false,
    reason: "unsupported",
  });
  expect(await observations(page)).toMatchObject({ resolves: 0, urls: [] });
});

for (const route of ["native", "browser"] as const) {
  test(`${route} accepts a stateful class implementing the structural output contract`, async ({
    page,
  }) => {
    await setup(page, { provider: "class", route });
    expect(
      await page.evaluate(() => window.printOutputTest.viewer.print({ quality: { dpi: 72 } })),
    ).toMatchObject({ ok: true });
    expect(await observations(page)).toMatchObject({
      resolves: route === "browser" ? 1 : 0,
      releases: [1],
      aborts: [1],
    });
  });
}

for (const provider of ["null", "throw", "malformed", "thenable"] as const) {
  test(`native ${provider} admission fails before rendering or invoking`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await setup(page, { route: "native", provider });
    const result = await page.evaluate(async () => {
      const trace = window.fixture.pageSources.startPrintTrace();
      const result = await window.printOutputTest.viewer.print({ quality: { dpi: 72 } });
      return { result, trace };
    });
    expect(result.result).toMatchObject({
      ok: false,
      reason: provider === "null" ? "unsupported" : "export-failed",
    });
    expect(result.trace.renders).toEqual([]);
    expect(await observations(page)).toMatchObject({ resolves: 0, invoked: 0, urls: [] });
    await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    expect(errors).toEqual([]);
  });
}

test("explicit current without provider and direct current navigation never resolve bytes", async ({
  page,
}) => {
  await setup(page, { provider: "absent" });
  expect(
    await page.evaluate(() =>
      window.printOutputTest.viewer.openPrintSource({ document: "current" }),
    ),
  ).toMatchObject({ ok: false, reason: "unsupported" });
  await setup(page);
  expect(
    await page.evaluate(() =>
      window.printOutputTest.viewer.openPrintSource({ document: "current", navigation: "direct" }),
    ),
  ).toMatchObject({ ok: false, reason: "unsupported" });
  expect(await observations(page)).toMatchObject({ resolves: 0, urls: [] });
});

for (const failure of ["permission", "render", "invoke", "abort"] as const) {
  test(`native ${failure} exits release admission exactly once without resolving output`, async ({
    page,
  }) => {
    await setup(page, { route: "native" });
    const result = await page.evaluate(async failure => {
      const state = window.printOutputTest;
      const controller = new AbortController();
      const trace = window.fixture.pageSources.startPrintTrace();
      if (failure === "permission") window.fixture.setPrintPermissions("denied");
      if (failure === "render") trace.failRender = true;
      if (failure === "invoke") state.failInvocation = true;
      if (failure === "abort") window.fixture.onNextPrintPermissionRead(() => controller.abort());
      return state.viewer
        .print({ pages: [{ from: 1, to: 1 }], quality: { dpi: 72 }, signal: controller.signal })
        .catch(error => ({ ok: false, error: String(error) }));
    }, failure);
    expect(result.ok).toBe(false);
    expect(await observations(page)).toMatchObject({
      resolves: 0,
      releases: [1],
      aborts: [1],
      opens: 0,
    });
  });
}

for (const trigger of ["button", "keyboard"] as const) {
  test(`direct ${trigger} popup failure is translated, dismissible and cleared by retry`, async ({
    page,
  }) => {
    await setup(page, { ui: "default" });
    await page.evaluate(() => {
      window.printOutputTest.denyPopup = true;
      window.printOutputTest.viewer.setUiText({
        labels: { printPreparationUnavailable: "Print failed; retry", close: "Dismiss" },
      });
    });
    if (trigger === "button") {
      await page.locator("#primary .pdf-menu-toggle-btn").click();
      await page.locator("#primary .pdf-print-btn").click();
    } else {
      await page.locator("#primary .pdf-container").click();
      await page.keyboard.press("Control+p");
    }
    const feedback = page.locator("#primary .pdf-print-action-feedback");
    await expect(feedback).toContainText("Print failed; retry");
    await expect(feedback.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await page.evaluate(() =>
      window.printOutputTest.viewer.setUiText({
        labels: { printPreparationUnavailable: "Translated failure", close: "Close" },
      }),
    );
    await expect(feedback).toContainText("Translated failure");
    await feedback.getByRole("button", { name: "Close" }).click();
    await expect(feedback).toHaveCount(0);
    await page.evaluate(() => {
      window.printOutputTest.denyPopup = false;
    });
    await page.locator("#primary .pdf-container").click();
    await page.keyboard.press("Control+p");
    await expect.poll(() => page.evaluate(() => window.printOutputTest.urls.length)).toBe(1);
    await expect(feedback).toHaveCount(0);
  });
}

test("popup denial releases admission before invoking the expensive resolver", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.printOutputTest.denyPopup = true;
    return window.printOutputTest.viewer.print();
  });
  expect(result).toMatchObject({ ok: false, reason: "popup-blocked" });
  expect(await observations(page)).toMatchObject({
    resolves: 0,
    releases: [1],
    aborts: [1],
    opens: 1,
    urls: [],
  });
});

test("late native capability loss fails explicitly without an unactivated browser fallback", async ({
  page,
}) => {
  await setup(page, { route: "native" });
  const result = await page.evaluate(async () => {
    const state = window.printOutputTest;
    const invoke = window.print;
    const pending = state.viewer.print({ pages: [{ from: 1, to: 1 }], quality: { dpi: 72 } });
    Reflect.set(window, "print", undefined);
    try {
      return await pending;
    } finally {
      window.print = invoke;
    }
  });
  expect(result).toMatchObject({ ok: false, reason: "unsupported" });
  expect(await observations(page)).toMatchObject({
    resolves: 0,
    releases: [1],
    aborts: [1],
    opens: 0,
    invoked: 0,
  });
});

test("browser permission denial never resolves and closes its reserved child", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.fixture.setPrintPermissions("denied");
    return window.printOutputTest.viewer.print();
  });
  expect(result).toMatchObject({ ok: false, reason: "disabled" });
  expect(await observations(page)).toMatchObject({
    resolves: 0,
    releases: [1],
    aborts: [1],
    closed: [true],
    urls: [],
  });
});

test("delayed resolver cannot navigate early and preserves admitted bytes", async ({ page }) => {
  await setup(page, { provider: "deferred" });
  await page.evaluate(() => {
    const state = window.printOutputTest;
    state.pending = state.viewer.print().finally(() => {
      state.settled = true;
    });
  });
  await expect.poll(() => page.evaluate(() => window.printOutputTest.resolves)).toBe(1);
  expect(await observations(page)).toMatchObject({ urls: [], releases: [0], aborts: [0] });
  await page.evaluate(() => {
    window.printOutputTest.hostValue = "Later host selection";
    window.printOutputTest.settle!();
  });
  expect(await page.evaluate(() => window.printOutputTest.pending)).toMatchObject({ ok: true });
  const state = await observations(page);
  expect(state.texts[0]).toContain("Admitted current output");
  expect(state).toMatchObject({ releases: [1], aborts: [1] });
});

for (const interruption of ["abort", "load", "close", "destroy", "reset", "child"] as const) {
  for (const late of ["resolve", "reject"] as const) {
    test(`delayed ${interruption} cancellation observes late ${late} without navigation or double release`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await setup(page, { provider: "deferred" });
      await install(page);
      await page.evaluate(() => {
        const state = window.printOutputTest;
        const controller = new AbortController();
        state.contexts.length = 0;
        state.admissionHook = () => {
          state.admissionHook = () => controller.abort();
        };
        state.pending = state.viewer.print({ signal: controller.signal }).finally(() => {
          state.settled = true;
        });
      });
      await expect.poll(() => page.evaluate(() => window.printOutputTest.resolves)).toBe(1);
      await page.evaluate(async interruption => {
        const state = window.printOutputTest;
        if (interruption === "abort") state.admissionHook!();
        if (interruption === "destroy") state.viewer.destroy();
        if (interruption === "close") await state.viewer.close();
        if (interruption === "load") {
          const loaded = await state.viewer.load({
            type: "data",
            data: window.fixture.pageSources.makePdf({ labels: ["New document"] }),
          });
          if (!loaded.ok) throw new Error(JSON.stringify(loaded));
        }
        if (interruption === "reset")
          await state.viewer.setPageSourceOverrides(
            [{ page: 2, source: null }],
            state.viewer.documentId!,
          );
        if (interruption === "child") state.children[0].close();
      }, interruption);
      // Document/caller cancellation must not wait for uncooperative host computation.
      if (["abort", "load", "close", "destroy", "child"].includes(interruption))
        await expect.poll(() => page.evaluate(() => window.printOutputTest.settled)).toBe(true);
      await page.evaluate(late => window.printOutputTest.settle!(late === "reject"), late);
      expect(await page.evaluate(() => window.printOutputTest.pending)).toMatchObject({
        ok: false,
        reason: "cancelled",
      });
      await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
      expect(await observations(page)).toMatchObject({
        urls: [],
        releases: [1],
        aborts: [1],
        closed: [true],
      });
      expect(errors).toEqual([]);
    });
  }
}

test("closing a pending source tab releases a keyboard print action so it can retry", async ({
  page,
}) => {
  await setup(page, { provider: "deferred", ui: "custom" });
  await page.locator("#primary .pdf-container").click();
  await page.keyboard.press("Control+p");
  await expect.poll(() => page.evaluate(() => window.printOutputTest.resolves)).toBe(1);
  await page.evaluate(() => {
    const state = window.printOutputTest;
    const settleCancelledExport = state.settle!;
    state.admissionHook = () => {
      state.admissionHook = undefined;
      settleCancelledExport(true);
    };
    state.children[0].close();
  });
  await expect.poll(() => page.evaluate(() => window.printOutputTest.releases[0])).toBe(1);
  await page.keyboard.press("Control+p");
  await expect.poll(() => page.evaluate(() => window.printOutputTest.resolves)).toBe(2);
  await page.evaluate(() => {
    window.printOutputTest.settle!();
  });
  await expect.poll(() => page.evaluate(() => window.printOutputTest.urls.length)).toBe(1);
  expect(await observations(page)).toMatchObject({
    releases: [1, 1],
    aborts: [1, 1],
    closed: [true, false],
  });
});

test("navigation errors revoke newly created URLs and release admission", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.printOutputTest.failNavigation = true;
    return window.printOutputTest.viewer.openPrintSource();
  });
  expect(result).toMatchObject({ ok: false, reason: "export-failed" });
  const state = await observations(page);
  expect(state).toMatchObject({ releases: [1], aborts: [1], closed: [true] });
  expect(state.urls).toHaveLength(1);
  expect(state.revoked.filter(url => url === state.urls[0])).toHaveLength(1);
});

test("successful browser Blob survives host release and document close until its child closes", async ({
  page,
}) => {
  await setup(page);
  expect(await page.evaluate(() => window.printOutputTest.viewer.print())).toMatchObject({
    ok: true,
  });
  const before = await observations(page);
  const url = before.urls[0];
  await page.evaluate(() => window.printOutputTest.viewer.close());
  expect(await page.evaluate(url => fetch(url).then(response => response.text()), url)).toContain(
    "Admitted current output",
  );
  expect((await observations(page)).revoked).not.toContain(url);
  await page.evaluate(() => window.printOutputTest.children[0].close());
  await expect
    .poll(
      async () => (await observations(page)).revoked.filter(candidate => candidate === url).length,
    )
    .toBe(1);
  expect(await observations(page)).toMatchObject({ releases: [1], aborts: [1] });
});

test("capability-selected native-to-browser route has one admission and reports lost native semantics", async ({
  page,
}) => {
  await setup(page, { route: "fallback" });
  await install(page);
  const result = await page.evaluate(() =>
    window.printOutputTest.viewer.print({
      pages: [{ from: 2, to: 2 }],
      layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
    }),
  );
  expect(result).toMatchObject({
    ok: true,
    status: "source-opened",
    warnings: expect.arrayContaining(["custom-range-lost", "spread-parity-lost"]),
  });
  const state = await observations(page);
  expect(state.contexts).toHaveLength(1);
  expect(state).toMatchObject({ resolves: 1, releases: [1], aborts: [1], invoked: 0, opens: 1 });
  expect(state.texts[0]).toContain("Admitted current output");
});

test("reset during capability fallback cancels old admission; a fresh submission captures new revision", async ({
  page,
}) => {
  await setup(page, { route: "fallback" });
  await install(page);
  const result = await page.evaluate(async () => {
    const state = window.printOutputTest;
    const pending = state.viewer.print();
    state.hostValue = "Fresh after reset";
    const reset = await state.viewer.setPageSourceOverrides(
      [{ page: 2, source: null }],
      state.viewer.documentId!,
    );
    if (!reset.ok) throw new Error(JSON.stringify(reset));
    const first = await pending;
    const next = await state.viewer.print();
    return { first, next };
  });
  expect(result.first).toMatchObject({ ok: false, reason: "cancelled" });
  expect(result.next).toMatchObject({ ok: true, status: "source-opened" });
  const state = await observations(page);
  expect(state.contexts).toHaveLength(2);
  expect(state.contexts[1].operationId).toBeGreaterThan(state.contexts[0].operationId);
  expect(state.contexts[1].pageSourcesRevision).toBeGreaterThan(
    state.contexts[0].pageSourcesRevision,
  );
  expect(state).toMatchObject({
    captures: ["Admitted current output", "Fresh after reset"],
    releases: [1, 1],
    aborts: [1, 1],
    closed: [true, false],
  });
  expect(state.texts).toHaveLength(1);
  expect(state.texts[0]).toContain("Fresh after reset");
});

test("provider reentrant mapping mutation cancels rather than pairing incompatible snapshots", async ({
  page,
}) => {
  await setup(page);
  await install(page);
  const result = await page.evaluate(async () => {
    const state = window.printOutputTest;
    state.admissionHook = () => {
      void state.viewer.setPageSourceOverrides(
        [{ page: 2, source: null }],
        state.viewer.documentId!,
      );
    };
    return state.viewer.print();
  });
  expect(result).toMatchObject({ ok: false, reason: "cancelled" });
  expect(await observations(page)).toMatchObject({
    resolves: 0,
    releases: [1],
    aborts: [1],
    urls: [],
  });
});

for (const ui of ["default", "custom"] as const) {
  for (const trigger of ["button", "keyboard"] as const) {
    test(`${ui} ${trigger} browser action uses the same current-output policy`, async ({
      page,
    }) => {
      await setup(page, { ui });
      await install(page);
      if (trigger === "button") {
        if (ui === "default") await page.locator("#primary .pdf-menu-toggle-btn").click();
        await page.locator("#primary .pdf-print-btn").click();
      } else {
        await page.locator("#primary .pdf-container").click();
        await page.keyboard.press("Control+p");
      }
      await expect.poll(() => page.evaluate(() => window.printOutputTest.urls.length)).toBe(1);
      const state = await observations(page);
      expect(state.contexts).toHaveLength(1);
      expect(state).toMatchObject({ resolves: 1, releases: [1], aborts: [1], invoked: 0 });
      expect(state.texts[0]).toContain("Admitted current output");
    });
  }
}

for (const provider of ["realm-bytes", "realm-buffer", "realm-blob"] as const) {
  test(`${provider} output from a same-origin iframe is valid byte output`, async ({ page }) => {
    await setup(page, { provider });
    expect(
      await page.evaluate(() => window.printOutputTest.viewer.openPrintSource()),
    ).toMatchObject({ ok: true });
    const state = await observations(page);
    expect(state.texts[0]).toContain("Admitted current output");
    expect(state).toMatchObject({ resolves: 1, releases: [1], aborts: [1] });
  });
}

test("custom native button admits before reentrant route diagnostics reset mapping and host state", async ({
  page,
}) => {
  await setup(page, { ui: "custom", route: "native" });
  await install(page);
  await page.evaluate(() => {
    const state = window.printOutputTest;
    state.routeHook = () => {
      state.routeHook = undefined;
      state.hostValue = "Diagnostic callback changed state";
      void state.viewer.setPageSourceOverrides(
        [{ page: 2, source: null }],
        state.viewer.documentId!,
      );
    };
    state.rendered = window.fixture.pageSources.startPrintTrace().renders;
  });
  await page.locator("#primary .pdf-print-btn").click();
  await expect.poll(() => page.evaluate(() => window.printOutputTest.releases[0])).toBe(1);
  const state = await observations(page);
  expect(state).toMatchObject({
    captures: ["Admitted current output"],
    resolves: 0,
    invoked: 1,
    aborts: [1],
  });
  expect(
    await page.evaluate(() => window.printOutputTest.rendered!.map(render => render.text)),
  ).toEqual(["Canonical first", "Display replacement"]);
  expect(await page.evaluate(() => window.printOutputTest.hostValue)).toBe(
    "Diagnostic callback changed state",
  );
});

for (const interruption of ["abort", "load", "map", "child", "form"] as const) {
  test(`legacy delayed resolver never navigates stale canonical URL after ${interruption}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await setup(page, { input: "url", provider: "absent", legacyDeferred: true });
    if (interruption === "form") {
      const loaded = await page.evaluate(() =>
        window.printOutputTest.viewer.load("/acroform-fixture.pdf"),
      );
      expect(loaded.ok).toBe(true);
      await page.evaluate(() => window.printOutputTest.viewer.setActive(true));
      await expect(page.locator("#primary .textWidgetAnnotation input").first()).toBeVisible();
    }
    await page.evaluate(() => {
      const state = window.printOutputTest;
      const controller = new AbortController();
      state.admissionHook = () => controller.abort();
      state.pending = state.viewer.openPrintSource({ print: { signal: controller.signal } });
    });
    await expect.poll(() => page.evaluate(() => window.printOutputTest.legacyCalls)).toBe(1);
    if (interruption === "map") await install(page);
    if (interruption === "form") {
      await page
        .locator("#primary .textWidgetAnnotation input")
        .first()
        .fill("Changed while resolving");
      await expect
        .poll(() => page.evaluate(() => window.printOutputTest.viewer.state.formDirty))
        .toBe(true);
    }
    await page.evaluate(async interruption => {
      const state = window.printOutputTest;
      if (interruption === "abort") state.admissionHook!();
      if (interruption === "child") state.children[0].close();
      if (interruption === "load")
        await state.viewer.load({
          type: "data",
          data: window.fixture.pageSources.makePdf({ labels: ["New legacy document"] }),
        });
      state.settle!();
    }, interruption);
    expect(await page.evaluate(() => window.printOutputTest.pending)).toMatchObject({
      ok: false,
      reason: "cancelled",
    });
    expect(await observations(page)).toMatchObject({ contexts: [], urls: [], closed: [true] });
    expect(errors).toEqual([]);
  });
}

for (const previous of ["success", "rejection"] as const) {
  for (const closePending of [false, true]) {
    test(`generated setup Source is a fresh admission after native ${previous}${closePending ? " and closing setup cancels export" : ""}`, async ({
      page,
    }) => {
      await setup(page, {
        ui: "default",
        route: "native",
        sheetLimit: true,
        provider: closePending ? "deferred" : "bytes",
      });
      await install(page);
      const first = await page.evaluate(async previous => {
        const state = window.printOutputTest;
        const result = await state.viewer.print({
          pages: previous === "success" ? [{ from: 1, to: 1 }] : "all",
          layout: { mode: "single" },
          quality: { dpi: 72 },
        });
        window.dispatchEvent(new Event("afterprint"));
        state.hostValue = "New setup Source admission";
        const reset = await state.viewer.setPageSourceOverrides(
          [{ page: 2, source: null }],
          state.viewer.documentId!,
        );
        if (!reset.ok) throw new Error(JSON.stringify(reset));
        return result;
      }, previous);
      expect(first).toMatchObject(
        previous === "success"
          ? { ok: true, status: "print-invoked" }
          : { ok: false, reason: "too-many-sheets" },
      );
      expect(await observations(page)).toMatchObject({ resolves: 0, releases: [1], aborts: [1] });
      await page.locator("#primary .pdf-menu-toggle-btn").click();
      await page.locator("#primary .pdf-print-btn").click();
      const dialog = page.locator("#primary .pdf-print-setup");
      await expect(dialog).toBeVisible();
      await dialog.locator(".pdf-print-more summary").click();
      await dialog.locator(".pdf-print-layout").selectOption("single");
      await expect(dialog.locator(".pdf-print-source")).toBeVisible();
      // Opening/planning setup must not retain another host output closure.
      expect((await observations(page)).contexts).toHaveLength(1);
      await dialog.locator(".pdf-print-source").click();
      await expect.poll(() => page.evaluate(() => window.printOutputTest.resolves)).toBe(1);
      if (closePending) {
        await expect(dialog).toBeVisible();
        await dialog.locator(".pdf-print-close").click();
        await expect(dialog).not.toBeVisible();
        await expect.poll(() => page.evaluate(() => window.printOutputTest.releases[1])).toBe(1);
        expect(await observations(page)).toMatchObject({
          urls: [],
          closed: [true],
          aborts: [1, 1],
        });
        await page.evaluate(() => window.printOutputTest.settle!());
        await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
      } else {
        await expect.poll(() => page.evaluate(() => window.printOutputTest.urls.length)).toBe(1);
        await expect(dialog).not.toBeVisible();
      }
      const state = await observations(page);
      expect(state.contexts).toHaveLength(2);
      expect(state.contexts[1].operationId).toBeGreaterThan(state.contexts[0].operationId);
      expect(state.contexts[1].pageSourcesRevision).toBeGreaterThan(
        state.contexts[0].pageSourcesRevision,
      );
      expect(state).toMatchObject({
        captures: ["Admitted current output", "New setup Source admission"],
        releases: [1, 1],
        aborts: [1, 1],
      });
      if (closePending) expect(state.urls).toEqual([]);
      else expect(state.texts[0]).toContain("New setup Source admission");
    });
  }
}
