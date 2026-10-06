// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";
import type { PdfjsViewer, PdfjsViewerScreenWakeLockPolicy } from "../../src/index";

const policies: PdfjsViewerScreenWakeLockPolicy[] = [
  "never",
  "always",
  "fullscreen-only",
  "presentation-only",
  "presentation-or-fullscreen",
];

type Sentinel = EventTarget & { released: boolean; releaseCalls: number; release(): Promise<void> };
type WakeLockMock = {
  requests: string[];
  sentinels: Sentinel[];
  pending: Array<() => void>;
  deferred: boolean;
  rejected: boolean;
  visible(value: boolean): void;
  fullscreen(element: Element | null): void;
  fullscreenDenied: boolean;
};

declare global {
  interface Window {
    wakeLockMock: WakeLockMock;
    wakeLockViewer: PdfjsViewer;
  }
}

// Install in every browsing context, including same-origin iframe owner documents.
function installWakeLockMock(): void {
  let visible = true;
  let fullscreen: Element | null = null;
  class MockSentinel extends EventTarget {
    released = false;
    releaseCalls = 0;
    async release(): Promise<void> {
      this.releaseCalls++;
      if (this.released) return;
      this.released = true;
      this.dispatchEvent(new Event("release"));
    }
  }
  const mock: WakeLockMock = {
    requests: [],
    sentinels: [],
    pending: [],
    deferred: false,
    rejected: false,
    fullscreenDenied: false,
    visible(value) {
      visible = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    fullscreen(element) {
      fullscreen = element;
      document.dispatchEvent(new Event("fullscreenchange"));
    },
  };
  window.wakeLockMock = mock;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => !visible });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  Element.prototype.requestFullscreen = function () {
    if (mock.fullscreenDenied) return Promise.reject(new DOMException("Denied", "NotAllowedError"));
    mock.fullscreen(this);
    return Promise.resolve();
  };
  document.exitFullscreen = () => {
    mock.fullscreen(null);
    return Promise.resolve();
  };
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request(type: string) {
        mock.requests.push(type);
        if (mock.rejected) return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        const acquire = () => {
          const sentinel = new MockSentinel();
          mock.sentinels.push(sentinel);
          return sentinel;
        };
        return mock.deferred
          ? new Promise<Sentinel>(resolve => mock.pending.push(() => resolve(acquire())))
          : Promise.resolve(acquire());
      },
    },
  });
}

async function held(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.wakeLockMock.sentinels.filter(s => !s.released).length))
    .toBe(count);
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error =>
    console.error(`fixture page error: ${error.stack ?? error.message}`),
  );
  await page.addInitScript(installWakeLockMock);
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
});

for (const policy of policies) {
  test(`@mobile ${policy} follows normal, fullscreen, embedded presentation, and both modes`, async ({
    page,
  }) => {
    await page.evaluate(policy => window.fixture.primary.setScreenWakeLock(policy), policy);
    await held(page, policy === "always" ? 1 : 0);
    await page.evaluate(() => window.wakeLockMock.fullscreen(document.querySelector("#primary")));
    await held(
      page,
      ["always", "fullscreen-only", "presentation-or-fullscreen"].includes(policy) ? 1 : 0,
    );
    expect(await page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(true);
    await page.evaluate(() =>
      window.wakeLockMock.fullscreen(document.querySelector("#primary .pdf-container")),
    );
    expect(await page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(false);
    await held(page, policy === "always" ? 1 : 0);
    await page.evaluate(() => {
      window.wakeLockMock.fullscreen(null);
      window.wakeLockMock.fullscreenDenied = true;
    });
    expect(await page.evaluate(() => window.fixture.primary.enterPresentationMode())).toMatchObject(
      { ok: true },
    );
    expect(await page.evaluate(() => window.fixture.primary.state.fullscreen)).toBe(false);
    await held(
      page,
      ["always", "presentation-only", "presentation-or-fullscreen"].includes(policy) ? 1 : 0,
    );
    await page.evaluate(() => window.wakeLockMock.fullscreen(document.querySelector("#primary")));
    await held(page, policy === "never" ? 0 : 1);
    await page.evaluate(() => window.fixture.primary.exitPresentationMode());
    await page.evaluate(() => window.wakeLockMock.fullscreen(null));
    await held(page, policy === "always" ? 1 : 0);
    expect(
      await page.evaluate(() => window.wakeLockMock.requests.every(type => type === "screen")),
    ).toBe(true);
  });
}

test("@mobile defaults, generated radios, validation, and state events expose desired policy", async ({
  page,
}) => {
  const group = page.locator("#primary .pdf-screen-wake-lock-group");
  await expect(group).toHaveCount(1);
  await expect(group.locator("input[data-pdf-screen-wake-lock]")).toHaveCount(5);
  await expect(group.locator('[data-pdf-screen-wake-lock="presentation-only"]')).toBeChecked();
  expect(await page.evaluate(() => window.fixture.primary.state.screenWakeLock)).toBe(
    "presentation-only",
  );
  await held(page, 0);
  await page.locator("#primary .pdf-menu-toggle-btn").click();
  await group.locator('[data-pdf-screen-wake-lock="always"]').check();
  await held(page, 1);
  expect(await page.evaluate(() => window.fixture.states.at(-1)?.screenWakeLock)).toBe("always");
  const result = await page.evaluate(() => {
    const before = window.fixture.states.length;
    window.fixture.primary.setScreenWakeLock("always");
    let rejected = false;
    try {
      window.fixture.primary.setScreenWakeLock("invalid" as PdfjsViewerScreenWakeLockPolicy);
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    return {
      unchanged: before === window.fixture.states.length,
      rejected,
      policy: window.fixture.primary.state.screenWakeLock,
    };
  });
  expect(result).toEqual({ unchanged: true, rejected: true, policy: "always" });
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("never"));
  await expect(group.locator('[data-pdf-screen-wake-lock="never"]')).toBeChecked();
  await held(page, 0);
});

test("@mobile qualifying policy and mode transitions retain the same sentinel", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("always"));
  await held(page, 1);
  await page.evaluate(() => {
    window.wakeLockMock.fullscreen(document.querySelector("#primary"));
    window.fixture.primary.setScreenWakeLock("fullscreen-only");
    window.fixture.primary.setScreenWakeLock("presentation-or-fullscreen");
  });
  await page.evaluate(() => window.fixture.primary.enterPresentationMode());
  await held(page, 1);
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("presentation-only"));
  await held(page, 1);
  expect(
    await page.evaluate(() => ({
      requests: window.wakeLockMock.requests.length,
      releases: window.wakeLockMock.sentinels[0]!.releaseCalls,
    })),
  ).toEqual({ requests: 1, releases: 0 });
  await page.evaluate(() => window.fixture.primary.exitPresentationMode());
  await held(page, 0);
});

test("constructor policies, disabled feature, and explicit custom bindings retain ownership boundaries", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const host = document.createElement("section");
    document.body.append(host);
    const group = document.createElement("fieldset");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.dataset.pdfScreenWakeLock = "always";
    group.append(radio);
    document.body.append(group);
    const invalid = [null, false, "sometimes", 1].map(value => {
      try {
        window.fixture.createScreenWakeLockViewer({
          rootEl: host,
          screenWakeLock: value as PdfjsViewerScreenWakeLockPolicy,
        });
        return false;
      } catch (error) {
        return error instanceof RangeError;
      }
    });
    const disabled = window.fixture.createScreenWakeLockViewer({
      rootEl: host,
      screenWakeLock: "always",
      features: { screenWakeLock: false },
      ui: "custom",
      uiBindings: { container: host, menu: { screenWakeLock: group } },
    });
    disabled.setScreenWakeLock("never");
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    const untouched = radio.checked;
    const unbound = disabled.state.screenWakeLock === "never";
    disabled.destroy();
    const generated = window.fixture.createScreenWakeLockViewer({
      rootEl: host,
      ui: "default",
      features: { screenWakeLock: false },
      screenWakeLock: "always",
    });
    const omitted = !host.querySelector(".pdf-screen-wake-lock-group");
    generated.destroy();
    const enabled = window.fixture.createScreenWakeLockViewer({
      rootEl: host,
      screenWakeLock: "never",
      ui: "custom",
      uiBindings: { container: host, menu: { screenWakeLock: group } },
    });
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    const bound = enabled.state.screenWakeLock;
    enabled.destroy();
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      invalid,
      untouched,
      unbound,
      omitted,
      bound,
      requests: window.wakeLockMock.requests.length,
    };
  });
  expect(result).toEqual({
    invalid: [true, true, true, true],
    untouched: true,
    unbound: true,
    omitted: true,
    bound: "always",
    requests: 1,
  });
  await held(page, 0);
});

for (const reduceRenderingWhenDocumentHidden of [true, false]) {
  test(`active/visible eligibility is independent of rendering visibility policy (${reduceRenderingWhenDocumentHidden})`, async ({
    page,
  }) => {
    await page.evaluate(reduceRenderingWhenDocumentHidden => {
      const rootEl = document.createElement("section");
      document.body.append(rootEl);
      window.wakeLockViewer = window.fixture.createScreenWakeLockViewer({
        rootEl,
        ui: "headless",
        screenWakeLock: "always",
        behavior: { reduceRenderingWhenDocumentHidden },
      });
    }, reduceRenderingWhenDocumentHidden);
    await held(page, 1);
    await page.evaluate(() => window.wakeLockViewer.setActive(false));
    await held(page, 0);
    await page.evaluate(() => {
      window.wakeLockMock.visible(false);
      window.wakeLockViewer.setActive(true);
    });
    await held(page, 0);
    await page.evaluate(() => window.wakeLockMock.visible(true));
    await held(page, 1);
    await page.evaluate(() => window.wakeLockMock.visible(false));
    await held(page, 0);
    await page.evaluate(() => window.wakeLockMock.visible(true));
    await held(page, 1);
  });
}

test("always survives close and replacement; destroy releases and rejects later setters", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("always"));
  await held(page, 1);
  await page.evaluate(() => window.fixture.closePrimary());
  await held(page, 1);
  await page.evaluate(() => window.fixture.replacePrimary());
  await held(page, 1);
  expect(await page.evaluate(() => window.wakeLockMock.requests.length)).toBe(1);
  await page.evaluate(() => window.fixture.primary.destroy());
  await held(page, 0);
  expect(
    await page.evaluate(() => {
      try {
        window.fixture.primary.setScreenWakeLock("always");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
});

test("embedded presentation works with fullscreen disabled and follows its owning iframe document", async ({
  page,
}) => {
  await page.evaluate(() => {
    const iframe = document.createElement("iframe");
    iframe.id = "wake-lock-frame";
    // WebKit throttles rendering in offscreen frames, so keep the fixture visible.
    iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:10";
    iframe.src = "/";
    document.body.append(iframe);
  });
  const frame = page.frameLocator("#wake-lock-frame");
  await expect(frame.locator("#primary")).toHaveAttribute("data-status", "ready");
  // Firefox may reuse the initial about:blank Window while replacing its Document.
  await frame.locator("body").evaluate(installWakeLockMock);
  await frame.locator("#primary").evaluate(async () => {
    window.fixture.primary.destroy();
    const rootEl = document.createElement("section");
    rootEl.className = "viewer-host";
    document.body.append(rootEl);
    window.wakeLockViewer = window.parent.fixture.createScreenWakeLockViewer({
      rootEl,
      ui: "default",
      features: { fullscreen: false },
      behavior: { reduceRenderingWhenDocumentHidden: false },
    });
    const load = await window.wakeLockViewer.load("/fixture.pdf");
    if (!load.ok) throw new Error("Iframe fixture failed to load");
    const entry = await window.wakeLockViewer.enterPresentationMode();
    if (!entry.ok) throw new Error("Embedded presentation failed");
  });
  const iframeHeld = () =>
    frame
      .locator("body")
      .evaluate(() => window.wakeLockMock.sentinels.filter(s => !s.released).length);
  await expect.poll(iframeHeld).toBe(1);
  await held(page, 0);
  await page.evaluate(() => window.wakeLockMock.visible(false));
  expect(await iframeHeld()).toBe(1);
  await frame.locator("body").evaluate(() => window.wakeLockMock.visible(false));
  await expect.poll(iframeHeld).toBe(0);
  await frame.locator("body").evaluate(() => window.wakeLockMock.visible(true));
  await expect.poll(iframeHeld).toBe(1);
  await frame.locator("body").evaluate(() => window.wakeLockViewer.destroy());
  await expect.poll(iframeHeld).toBe(0);
});

test("browser release reacquires only while eligible without duplicate owned sentinels", async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("always"));
  await held(page, 1);
  await page.evaluate(() => window.wakeLockMock.sentinels[0]!.release());
  await expect.poll(() => page.evaluate(() => window.wakeLockMock.requests.length)).toBe(2);
  await held(page, 1);
  await page.evaluate(() => {
    window.fixture.primary.setScreenWakeLock("never");
    window.wakeLockMock.sentinels[0]!.dispatchEvent(new Event("release"));
  });
  await held(page, 0);
  expect(await page.evaluate(() => window.wakeLockMock.requests.length)).toBe(2);
});

test("pending acquisitions are discarded after policy, visibility, or destruction changes", async ({
  page,
}) => {
  for (const change of ["policy", "hidden", "destroy"] as const) {
    await page.evaluate(() => {
      window.wakeLockMock.deferred = true;
      window.fixture.primary.setScreenWakeLock("always");
    });
    await expect.poll(() => page.evaluate(() => window.wakeLockMock.pending.length)).toBe(1);
    await page.evaluate(change => {
      if (change === "policy") window.fixture.primary.setScreenWakeLock("never");
      if (change === "hidden") window.wakeLockMock.visible(false);
      if (change === "destroy") window.fixture.primary.destroy();
      window.wakeLockMock.pending.shift()!();
    }, change);
    await expect
      .poll(() => page.evaluate(() => window.wakeLockMock.sentinels.at(-1)?.releaseCalls))
      .toBe(1);
    await held(page, 0);
    if (change === "hidden")
      await page.evaluate(() => {
        window.fixture.primary.setScreenWakeLock("never");
        window.wakeLockMock.visible(true);
      });
  }
});

test("multiple viewers release only their sentinels and coexist with external wake locks", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await navigator.wakeLock.request("screen");
    window.fixture.primary.setScreenWakeLock("always");
    window.fixture.addSecondary();
    window.fixture.secondary!.setScreenWakeLock("always");
    window.fixture.secondary!.setActive(true);
  });
  await held(page, 3);
  await page.evaluate(() => window.fixture.primary.setActive(false));
  await held(page, 2);
  await page.evaluate(() => window.fixture.destroySecondary());
  await held(page, 1);
  expect(await page.evaluate(() => window.wakeLockMock.sentinels[0]!.releaseCalls)).toBe(0);
});

test("unsupported and rejected requests preserve policy and report only silent diagnostics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.evaluate(() => {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
    window.fixture.primary.setScreenWakeLock("always");
  });
  await held(page, 0);
  expect(await page.evaluate(() => window.fixture.primary.state.screenWakeLock)).toBe("always");
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("never"));
  await page.evaluate(installWakeLockMock);
  await page.evaluate(() => {
    window.wakeLockMock.rejected = true;
    window.fixture.primary.setScreenWakeLock("always");
  });
  await expect.poll(() => page.evaluate(() => window.wakeLockMock.requests.length)).toBe(1);
  await page.evaluate(() => window.fixture.primary.setScreenWakeLock("always"));
  await held(page, 0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixture.logs.some(
          log => log.event === "screen-wake-lock-denied" && log.level === "debug",
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => ({
      policy: window.fixture.primary.state.screenWakeLock,
      errors: window.fixture.logs.filter(log => log.level === "error"),
    })),
  ).toEqual({ policy: "always", errors: [] });
  expect(errors).toEqual([]);
});
