// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type {} from "./destroy-fixture";

let fixture: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./destroy-fixture.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  fixture = result.outputFiles[0].text;
});

for (const failure of [false, true]) {
  test(`last source ${failure ? "rejection" : "retired document"} is collectible while its resolver stays alive`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Explicit CDP GC reachability control");
    await page.route("**/destroy-fixture.js", route =>
      route.fulfill({ contentType: "text/javascript", body: fixture }),
    );
    await page.goto("/");
    await page.addScriptTag({ type: "module", url: "/destroy-fixture.js" });
    await page.waitForFunction(() => !!window.createSourceQueueLifetime);
    await page.evaluate(failure => {
      window.sourceQueueLifetime = window.createSourceQueueLifetime(failure);
    }, failure);
    const cdp = await page.context().newCDPSession(page);
    try {
      for (let cycle = 1; cycle <= 3; cycle++) {
        expect(await page.evaluate(() => window.sourceQueueLifetime.cycle())).toBe(!failure);
        await expect
          .poll(() => page.evaluate(() => window.sourceQueueLifetime.snapshot().disposed))
          .toBe(failure ? 0 : cycle);
        await expect
          .poll(async () => {
            await cdp.send("HeapProfiler.collectGarbage");
            return page.evaluate(() => window.sourceQueueLifetime.snapshot().reachable);
          })
          .toBe(false);
      }
      await page.evaluate(() => window.sourceQueueLifetime.close());
    } finally {
      await cdp.detach();
    }
  });
}

for (const mode of ["ordinary", "pending-read", "cleanup-failure", "task-failure"] as const) {
  test(`destroy physically releases canonical task and runtime worker: ${mode}`, async ({
    page,
  }) => {
    await page.route("**/destroy-fixture.js", route =>
      route.fulfill({ contentType: "text/javascript", body: fixture }),
    );
    await page.route("**/destroy-test", route =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><body><div id="viewer" style="height:700px"></div><script type="module" src="/destroy-fixture.js"></script></body></html>',
      }),
    );
    await page.goto("/destroy-test");
    await page.waitForFunction(() => !!window.createDestroyLifecycle);
    await page.evaluate(async mode => {
      window.destroyLifecycle = await window.createDestroyLifecycle({
        holdRead: mode === "pending-read",
        cleanupFails: mode === "cleanup-failure",
        taskFails: mode === "task-failure",
      });
    }, mode);
    expect(await page.evaluate(() => window.destroyLifecycle.destroy())).toBe(true);
    expect(await page.evaluate(() => window.destroyLifecycle.snapshot())).toMatchObject({
      liveTasks: 1,
      terminations: 0,
      status: "destroyed",
    });
    if (mode === "pending-read") {
      // Give detached teardown a turn while the physical read remains held.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      expect(await page.evaluate(() => window.destroyLifecycle.snapshot().events)).toEqual([
        "read-start",
      ]);
      await page.evaluate(() => window.destroyLifecycle.releaseRead());
    }
    await expect
      .poll(() => page.evaluate(() => window.destroyLifecycle.snapshot().events))
      .toContain("cleanup-start");
    expect(await page.evaluate(() => window.destroyLifecycle.snapshot())).toMatchObject({
      liveTasks: 1,
      terminations: 0,
    });
    expect(await page.evaluate(() => window.destroyLifecycle.snapshot().events)).not.toContain(
      "task-start",
    );
    await page.evaluate(() => window.destroyLifecycle.releaseCleanup());
    await expect
      .poll(() => page.evaluate(() => window.destroyLifecycle.snapshot().events))
      .toContain("task-start");
    expect(await page.evaluate(() => window.destroyLifecycle.snapshot())).toMatchObject({
      liveTasks: 1,
      terminations: 0,
    });
    await page.evaluate(() => window.destroyLifecycle.releaseTask());
    await expect
      .poll(() => page.evaluate(() => window.destroyLifecycle.snapshot()))
      .toMatchObject({
        liveTasks: 0,
        terminations: 1,
      });
    expect(await page.evaluate(() => window.destroyLifecycle.snapshot().events)).toEqual([
      ...(mode === "pending-read" ? ["read-start", "read-end"] : []),
      "cleanup-start",
      "cleanup-end",
      "task-start",
      "task-end",
      "worker-end",
    ]);
  });
}
