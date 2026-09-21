// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentNavigation, type DocumentNavigationHost } from "../../src/document-navigation.js";

function host(overrides: Partial<DocumentNavigationHost> = {}): DocumentNavigationHost {
  const pdf = {
    getDestination: async () => [2, { name: "Fit" }],
    getOutline: async () => [],
  };
  const result: DocumentNavigationHost = {
    destinationMatchTolerance: 0.1,
    shareableNamedDestinationPrefix: "section:",
    navigationState: null,
    getPdf: () => pdf as never,
    getDocumentGeneration: () => 1,
    getDocumentSignal: () => new AbortController().signal,
    isCurrentDocument: () => true,
    pageTopFor: () => 0,
    pageHeightFor: () => 100,
    rotation: () => 0,
    scrollTop: () => 0,
    viewportHeight: () => 100,
    viewportPosition: () => {
      const anchor = result.scrollTop() + result.viewportHeight() * 0.35;
      const pageNo = Math.max(1, Math.floor(anchor / 100) + 1);
      return { pageNo, yRatio: (anchor % 100) / 100, xRatio: 0.5 };
    },
    canWriteNavigationState: () => false,
    setNavigationStateTimeout: (callback, delay) =>
      globalThis.setTimeout(callback, delay) as unknown as number,
    clearNavigationStateTimeout: timer => globalThis.clearTimeout(timer),
    acquirePage: async pageNo => {
      const page = await result.getPdf()!.getPage(pageNo);
      return { page, release: () => page.cleanup() };
    },
    ...overrides,
  };
  return result;
}

function destinationHost(
  destinations: ReadonlyMap<string, unknown>,
  writes: Array<string | null> = [],
): DocumentNavigationHost {
  const pdf = {
    getDestinations: async () => destinations,
    getDestination: async () => null,
    getOutline: async () => [],
    getPage: async () => ({
      getViewport: () => ({
        width: 100,
        height: 100,
        convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
      }),
      cleanup: () => {},
    }),
  };
  return host({
    getPdf: () => pdf as never,
    navigationState: {
      readNavigationDestinationId: () => null,
      writeNavigationDestinationId: id => {
        writes.push(id);
      },
    },
    canWriteNavigationState: () => true,
  });
}

function referenceNearbyDestination(
  destinations: Array<{
    navigationDestinationId: string;
    pageNo: number;
    yRatio: number;
    xRatio?: number;
  }>,
  page: number,
  y: number,
  x: number | undefined,
  tolerance: number,
): string | null {
  return (
    destinations
      .filter(
        destination => destination.pageNo === page && Math.abs(destination.yRatio - y) <= tolerance,
      )
      .sort(
        (a, b) =>
          Math.abs(a.yRatio - y) - Math.abs(b.yRatio - y) ||
          Math.abs((a.xRatio ?? Infinity) - (x ?? Infinity)) -
            Math.abs((b.xRatio ?? Infinity) - (x ?? Infinity)) ||
          a.navigationDestinationId.localeCompare(b.navigationDestinationId),
      )[0]?.navigationDestinationId ?? null
  );
}

function xyzDestination(pageIndex: number, yRatio: number, xRatio?: number): unknown[] {
  return [
    pageIndex,
    { name: "XYZ" },
    xRatio == null ? null : xRatio * 100,
    100 * (1 - yRatio),
    null,
  ];
}

function stubTimers(): {
  callbacks: Map<number, () => void>;
  cleared: number[];
  restore(): void;
} {
  const callbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let nextTimer = 0;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    const timer = ++nextTimer;
    callbacks.set(timer, callback as () => void);
    return timer;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: number) => {
    cleared.push(Number(timer));
  }) as typeof globalThis.clearTimeout;
  return {
    callbacks,
    cleared,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test("outline preparation joins one detached immutable outcome", async () => {
  const feature = new DocumentNavigation();
  let calls = 0;
  let release!: (outline: unknown[]) => void;
  const outline = new Promise<unknown[]>(resolve => {
    release = resolve;
  });
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => {
          calls++;
          return outline;
        },
        getDestination: async () => [0, { name: "Fit" }],
      }) as never,
  });

  const first = feature.prepareOutline(navigationHost);
  const second = feature.prepareOutline(navigationHost);
  assert.equal(first, second);
  release([
    {
      title: "Parent",
      dest: [0, { name: "Fit" }],
      items: [{ title: "Child", dest: [1, { name: "Fit" }] }],
    },
  ]);
  const outcome = await first;

  assert.equal(calls, 1);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.itemCount, 2);
  assert.deepEqual(
    outcome.items.map(item => ({
      key: item.key,
      title: item.title,
      childKey: item.children[0]?.key,
    })),
    [{ key: "0", title: "Parent", childKey: "1" }],
  );
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(Object.isFrozen(outcome.items), true);
  assert.equal(Object.isFrozen(outcome.items[0]), true);
  assert.equal(Object.isFrozen(outcome.items[0]!.destination), true);
  assert.equal(Object.isFrozen(outcome.items[0]!.children), true);
  assert.equal(Object.isFrozen(outcome.items[0]!.children[0]), true);
  assert.equal(Object.isFrozen(outcome.items[0]!.children[0]!.destination), true);
  assert.equal("element" in outcome.items[0]!, false);
  assert.equal(feature.prepareOutline(navigationHost), first);
});

test("outline preparation errors are model outcomes", async () => {
  const feature = new DocumentNavigation();
  const error = new Error("outline failed");
  const outcome = await feature.prepareOutline(
    host({
      getPdf: () =>
        ({
          getOutline: async () => {
            throw error;
          },
        }) as never,
    }),
  );
  assert.deepEqual(outcome, { status: "error", itemCount: 0, items: [], error });
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(Object.isFrozen(outcome.items), true);
  assert.equal(feature.error, error);
});

test("outline normalization tolerates malformed nodes while preserving valid siblings", async () => {
  const feature = new DocumentNavigation();
  const outcome = await feature.prepareOutline(
    host({
      getPdf: () =>
        ({
          getOutline: async () => [
            null,
            [],
            { title: 4, dest: 7, items: {} },
            { title: "Valid", items: ["bad", { title: "Child", dest: null }] },
          ],
        }) as never,
    }),
  );
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(
    outcome.items.map(item => ({
      key: item.key,
      title: item.title,
      status: item.destinationStatus,
      children: item.children.map(child => ({ key: child.key, title: child.title })),
    })),
    [
      { key: "0", title: "(Untitled)", status: "unresolved", children: [] },
      { key: "1", title: "Valid", status: "none", children: [{ key: "2", title: "Child" }] },
    ],
  );
});

test("prepared fallback titles relabel without PDF work while source-owned matching text remains intact", async () => {
  const feature = new DocumentNavigation();
  let outlineCalls = 0;
  let destinationCalls = 0;
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => {
          outlineCalls++;
          return [{ dest: null }, { title: "(Untitled)", dest: null }];
        },
        getDestination: async () => {
          destinationCalls++;
          return null;
        },
      }) as never,
  });
  await feature.prepareOutline(navigationHost);
  feature.setUntitledLabel("(Nimetön)");
  const result = await feature.getOutline(navigationHost, "", {
    caseSensitive: false,
    diacritics: "smart",
  });
  assert.deepEqual(result, {
    ok: true,
    items: [
      { title: "(Nimetön)", destinationStatus: "none", destination: null, children: [] },
      { title: "(Untitled)", destinationStatus: "none", destination: null, children: [] },
    ],
  });
  assert.equal(outlineCalls, 1);
  assert.equal(destinationCalls, 0);
});

test("pending outline preparation freezes the latest fallback title", async () => {
  const feature = new DocumentNavigation();
  let entered!: () => void;
  let release!: () => void;
  const destinationEntered = new Promise<void>(resolve => {
    entered = resolve;
  });
  const destinationGate = new Promise<void>(resolve => {
    release = resolve;
  });
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => [{ dest: "held" }],
        getDestination: async () => {
          entered();
          await destinationGate;
          return null;
        },
      }) as never,
  });
  const preparation = feature.prepareOutline(navigationHost);
  await destinationEntered;
  feature.setUntitledLabel("(Nimetön)");
  release();
  const outcome = await preparation;
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") assert.equal(outcome.items[0]?.title, "(Nimetön)");
});

test("malformed outline roots and ancestor cycles produce frozen errors", async () => {
  for (const outline of [
    { items: [] },
    (() => {
      const node: { title: string; items: unknown[] } = { title: "loop", items: [] };
      node.items.push(node);
      return [node];
    })(),
  ]) {
    const outcome = await new DocumentNavigation().prepareOutline(
      host({ getPdf: () => ({ getOutline: async () => outline }) as never }),
    );
    assert.equal(outcome.status, "error");
    assert.equal(Object.isFrozen(outcome), true);
    assert.equal(Object.isFrozen(outcome.items), true);
  }
});

test("deep outline preparation and public cloning use compact preorder keys without recursion", async () => {
  let outline: { title: string; items: unknown[] } = { title: "19999", items: [] };
  for (let index = 19_998; index >= 0; index--)
    outline = { title: String(index), items: [outline] };
  const feature = new DocumentNavigation();
  const navigationHost = host({ getPdf: () => ({ getOutline: async () => [outline] }) as never });
  const outcome = await feature.prepareOutline(navigationHost);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.itemCount, 20_000);
  let entry = outcome.items[0]!;
  for (let index = 0; index < 19_999; index++) {
    assert.equal(entry.key, String(index));
    entry = entry.children[0]!;
  }
  assert.equal(entry.key, "19999");
  const result = await feature.getOutline(navigationHost, "", {
    caseSensitive: false,
    diacritics: "smart",
  });
  assert.equal(result.ok, true);
});

test("outline destination resolution is capped at four concurrent source-order jobs", async () => {
  const feature = new DocumentNavigation();
  const releases = new Map<string, () => void>();
  const started: string[] = [];
  let active = 0;
  let maximum = 0;
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () =>
          Array.from({ length: 8 }, (_, index) => ({ title: String(index), dest: `d${index}` })),
        getDestination: (name: string) =>
          new Promise(resolve => {
            started.push(name);
            active++;
            maximum = Math.max(maximum, active);
            releases.set(name, () => {
              active--;
              resolve([0, { name: "Fit" }]);
            });
          }),
      }) as never,
  });
  const preparation = feature.prepareOutline(navigationHost);
  while (started.length < 4) await Promise.resolve();
  assert.equal(maximum, 4);
  for (const name of [...started].reverse()) releases.get(name)!();
  while (started.length < 8) await Promise.resolve();
  for (const name of started.slice(4).reverse()) releases.get(name)!();
  const outcome = await preparation;
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready")
    assert.deepEqual(
      outcome.items.map(item => item.title),
      ["0", "1", "2", "3", "4", "5", "6", "7"],
    );
});

test("outline reset stops queued destination claims and permits a successor", async () => {
  const feature = new DocumentNavigation();
  let active = true;
  const releases: Array<() => void> = [];
  let claims = 0;
  const navigationHost = host({
    getPdf: () =>
      (active
        ? {
            getOutline: async () =>
              Array.from({ length: 5 }, (_, index) => ({
                title: String(index),
                dest: `d${index}`,
              })),
            getDestination: () =>
              new Promise(resolve => {
                claims++;
                releases.push(() => resolve([0, { name: "Fit" }]));
              }),
          }
        : { getOutline: async () => [{ title: "Successor" }] }) as never,
    isCurrentDocument: pdf =>
      active ? !!(pdf as { getDestination?: unknown }).getDestination : true,
  });
  const stale = feature.prepareOutline(navigationHost);
  while (claims < 4) await Promise.resolve();
  feature.reset();
  for (const release of releases) release();
  assert.equal((await stale).status, "cancelled");
  assert.equal(claims, 4);
  active = false;
  const successor = await feature.prepareOutline(navigationHost);
  assert.equal(successor.status, "ready");
  if (successor.status === "ready") assert.equal(successor.items[0]?.title, "Successor");
});

test("reset invalidates stale outline completion without replacing newer preparation identity", async () => {
  const feature = new DocumentNavigation();
  let release!: (outline: unknown[]) => void;
  const outline = new Promise<unknown[]>(resolve => {
    release = resolve;
  });
  const oldPdf = { getOutline: async () => outline };
  const newPdf = { getOutline: async () => [{ title: "Current" }] };
  let activePdf = oldPdf;
  const navigationHost = host({
    getPdf: () => activePdf as never,
    isCurrentDocument: pdf => pdf === (activePdf as never),
  });
  const oldPreparation = feature.prepareOutline(navigationHost);
  feature.reset();
  assert.equal(feature.preparation, null);
  activePdf = newPdf;
  const newPreparation = feature.prepareOutline(navigationHost);
  const newOutcome = await newPreparation;
  assert.equal(newOutcome.status, "ready");
  release([{ title: "Stale" }]);
  const cancelled = await oldPreparation;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(Object.isFrozen(cancelled), true);
  assert.equal(Object.isFrozen(cancelled.items), true);
  assert.equal(feature.prepareOutline(navigationHost), newPreparation);
  assert.equal(feature.error, null);
});

test("stable semantic keys drive sticky and viewport active selection", async () => {
  const feature = new DocumentNavigation();
  let scrollTop = 0;
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => [
          { title: "First", dest: [0, { name: "Fit" }] },
          { title: "Second", dest: [1, { name: "Fit" }] },
        ],
      }) as never,
    pageTopFor: page => (page - 1) * 100,
    scrollTop: () => scrollTop,
    viewportHeight: () => 80,
  });
  await feature.prepareOutline(navigationHost);
  assert.equal(feature.activeOutlineKey(navigationHost), "0");
  assert.deepEqual(feature.selectOutlineDestination(navigationHost, "1"), {
    page: 2,
    yRatio: 0,
    usePosition: false,
    smooth: true,
  });
  assert.equal(feature.activeOutlineKey(navigationHost), "1");
  scrollTop = 100;
  assert.equal(feature.activeOutlineKey(navigationHost), "1");
  scrollTop = 0;
  assert.equal(feature.activeOutlineKey(navigationHost), "0");
});

test("outline selection keeps the latest chapter destination preceding the reading anchor", async () => {
  const feature = new DocumentNavigation();
  let position = { pageNo: 4, yRatio: 0.35, xRatio: 0.5 };
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => [
          { title: "Chapter 1", dest: [0, { name: "Fit" }] },
          { title: "Chapter 2", dest: [5, { name: "Fit" }] },
        ],
      }) as never,
    viewportPosition: () => position,
  });
  await feature.prepareOutline(navigationHost);

  assert.equal(feature.activeOutlineKey(navigationHost), "0");
  position = { pageNo: 6, yRatio: 0, xRatio: 0.5 };
  assert.equal(feature.activeOutlineKey(navigationHost), "1");
});

test("outline preparation reconciles a sticky destination selected before targets exist", async () => {
  const feature = new DocumentNavigation();
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => [
          { title: "First", dest: [0, { name: "Fit" }] },
          { title: "Second", dest: [1, { name: "Fit" }] },
        ],
      }) as never,
    pageTopFor: page => (page - 1) * 100,
    scrollTop: () => 100,
    viewportHeight: () => 80,
  });

  feature.selectResolvedDestination(navigationHost, { pageNo: 2, yRatio: 0 });
  await feature.prepareOutline(navigationHost);
  assert.equal(feature.activeOutlineKey(navigationHost), "1");
});

test("PDF named navigation returns an intent without host scrolling capabilities", async () => {
  const feature = new DocumentNavigation();
  assert.deepEqual(
    await feature.resolvePdfNamedDestination(host(), "section:intro", {
      spotWithinPage: true,
      smooth: true,
    }),
    {
      ok: true,
      pdfNamedDestination: "section:intro",
      intent: { page: 3, yRatio: 0, usePosition: true, smooth: true },
    },
  );
});

test("persisted state returns a facade navigation request", () => {
  const feature = new DocumentNavigation();
  assert.equal(feature.navigationRequestFromState(host(), false), null);
  assert.deepEqual(
    feature.navigationRequestFromState(
      host({
        navigationState: {
          readNavigationDestinationId: () => "intro",
          writeNavigationDestinationId: () => {},
        },
      }),
      true,
    ),
    { pdfNamedDestination: "section:intro", smooth: true },
  );
});

test("resolved destinations preserve named IDs and choose nearby indexed IDs", async () => {
  const feature = new DocumentNavigation();
  const writes: Array<string | null> = [];
  const navigationHost = destinationHost(
    new Map([
      ["section:intro", [1, { name: "Fit" }]],
      ["section:chapter", [2, { name: "Fit" }]],
    ]),
    writes,
  );
  await feature.prepareDestinations(navigationHost);

  feature.selectResolvedDestination(navigationHost, { pageNo: 3, yRatio: 0 }, "section:chapter");
  await new Promise(resolve => setTimeout(resolve, 70));
  feature.selectResolvedDestination(navigationHost, { pageNo: 2, yRatio: 0 });
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.deepEqual(writes, ["chapter", "intro"]);
});

test("indexed destination selection is equivalent across ties, tolerance edges, and page fallbacks", async () => {
  const feature = new DocumentNavigation();
  const writes: Array<string | null> = [];
  const indexed = [
    { navigationDestinationId: "alpha", pageNo: 2, yRatio: 0.4, xRatio: 0.8 },
    { navigationDestinationId: "beta", pageNo: 2, yRatio: 0.4, xRatio: 0.2 },
    { navigationDestinationId: "gamma", pageNo: 2, yRatio: 0.6 },
    { navigationDestinationId: "first", pageNo: 3, yRatio: 0.1 },
  ];
  const destinations = new Map(
    indexed.map(destination => [
      `section:${destination.navigationDestinationId}`,
      xyzDestination(destination.pageNo - 1, destination.yRatio, destination.xRatio),
    ]),
  );
  const cases = [
    { pageNo: 2, yRatio: 0.5, xRatio: 0.25 },
    { pageNo: 2, yRatio: 0.5 },
    { pageNo: 2, yRatio: 0.3, xRatio: 0.9 },
    { pageNo: 4, yRatio: 0.5 },
  ];
  const timers = stubTimers();
  try {
    const navigationHost = destinationHost(destinations, writes);
    let state = navigationHost.navigationState!.readNavigationDestinationId();
    Object.assign(navigationHost, {
      navigationState: {
        readNavigationDestinationId: () => state,
        writeNavigationDestinationId: (id: string | null) => {
          state = id;
          writes.push(id);
        },
      },
    });
    await feature.prepareDestinations(navigationHost);
    timers.callbacks.clear();
    for (const destination of cases) {
      feature.selectResolvedDestination(navigationHost, destination);
      timers.callbacks.get(Math.max(...timers.callbacks.keys()))!();
    }
    feature.selectResolvedDestination(navigationHost, { pageNo: 3 });
    timers.callbacks.get(Math.max(...timers.callbacks.keys()))!();
  } finally {
    timers.restore();
  }

  assert.deepEqual(
    writes,
    [
      ...cases.map(destination =>
        referenceNearbyDestination(
          indexed,
          destination.pageNo,
          destination.yRatio,
          destination.xRatio,
          0.1,
        ),
      ),
      "first",
    ].filter((id, index, values) => index === 0 || id !== values[index - 1]),
  );
});

test("outline indexes preserve stable-order tie semantics and predecessor fallback", async () => {
  const feature = new DocumentNavigation();
  let scrollTop = 0;
  const navigationHost = host({
    getPdf: () =>
      ({
        getOutline: async () => [
          { title: "Later page", dest: xyzDestination(2, 0.2) },
          { title: "First tie", dest: xyzDestination(1, 0.4) },
          { title: "Second tie", dest: xyzDestination(1, 0.4) },
          { title: "Previous", dest: xyzDestination(0, 0.9) },
        ],
        getPage: async () => ({
          getViewport: () => ({
            width: 100,
            height: 100,
            convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
          }),
          cleanup: () => {},
        }),
      }) as never,
    destinationMatchTolerance: 0.05,
    pageTopFor: page => (page - 1) * 100,
    scrollTop: () => scrollTop,
    viewportHeight: () => 20,
  });
  await feature.prepareOutline(navigationHost);

  feature.selectResolvedDestination(navigationHost, { pageNo: 2, yRatio: 0.4 });
  scrollTop = 140;
  assert.equal(feature.activeOutlineKey(navigationHost), "1");
  scrollTop = 0;
  feature.activeOutlineKey(navigationHost);
  scrollTop = 140;
  assert.equal(feature.activeOutlineKey(navigationHost), "1");
  feature.selectResolvedDestination(navigationHost, { pageNo: 2, yRatio: 0.8 });
  assert.equal(feature.activeOutlineKey(navigationHost), "2");
});

test("large prepared indexes keep steady-state geometry work logarithmic or page-local", async () => {
  const itemCount = 20_000;
  const outline = Array.from({ length: itemCount }, (_, index) => ({
    title: `Item ${index}`,
    dest: [index, { name: "Fit" }],
  }));
  const destinations = new Map(
    Array.from(
      { length: itemCount },
      (_, index) => [`section:item-${index}`, [index, { name: "Fit" }]] as const,
    ),
  );
  let pageTopReads = 0;
  const writes: Array<string | null> = [];
  const pdf = {
    getOutline: async () => outline,
    getDestinations: async () => destinations,
  };
  const navigationHost = host({
    getPdf: () => pdf as never,
    navigationState: {
      readNavigationDestinationId: () => null,
      writeNavigationDestinationId: id => {
        writes.push(id);
      },
    },
    canWriteNavigationState: () => true,
    pageTopFor: page => {
      pageTopReads++;
      return (page - 1) * 100;
    },
    scrollTop: () => 1_234_500,
    viewportHeight: () => 100,
  });
  const feature = new DocumentNavigation();
  await feature.prepareOutline(navigationHost);

  pageTopReads = 0;
  assert.equal(feature.activeOutlineKey(navigationHost), "12345");
  assert.ok(pageTopReads <= 20, `active outline read ${pageTopReads} page tops`);

  const timers = stubTimers();
  try {
    pageTopReads = 0;
    feature.scheduleNavigationStateSync(navigationHost);
    timers.callbacks.get(1)!();
    assert.deepEqual(writes, ["item-12345"]);
    assert.ok(pageTopReads <= 20, `state sync read ${pageTopReads} page tops`);
  } finally {
    timers.restore();
  }
});

test("a cancelled persistence callback delivered after reset cannot write", () => {
  const timers = stubTimers();
  try {
    const feature = new DocumentNavigation();
    const writes: Array<string | null> = [];
    const navigationHost = host({
      navigationState: {
        readNavigationDestinationId: () => "previous",
        writeNavigationDestinationId: id => {
          writes.push(id);
        },
      },
      canWriteNavigationState: () => true,
    });
    feature.scheduleNavigationStateSync(navigationHost);
    const stale = timers.callbacks.get(1)!;
    feature.reset();
    stale();
    assert.deepEqual(writes, []);
  } finally {
    timers.restore();
  }
});

test("reset and replacement clear navigation persistence through their owner timer scheduler", () => {
  const ownerTimers = (): {
    callbacks: Map<number, () => void>;
    cleared: number[];
    set(callback: () => void, delay: number): number;
    clear(timer: number): void;
  } => {
    const callbacks = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextTimer = 0;
    return {
      callbacks,
      cleared,
      set: callback => {
        const timer = ++nextTimer;
        callbacks.set(timer, callback);
        return timer;
      },
      clear: timer => {
        cleared.push(timer);
      },
    };
  };
  const firstOwner = ownerTimers();
  const replacementOwner = ownerTimers();
  const feature = new DocumentNavigation();
  const writes: Array<string | null> = [];
  const navigationHost = (owner: ReturnType<typeof ownerTimers>) =>
    host({
      navigationState: {
        readNavigationDestinationId: () => null,
        writeNavigationDestinationId: id => {
          writes.push(id);
        },
      },
      canWriteNavigationState: () => true,
      setNavigationStateTimeout: (callback, delay) => owner.set(callback, delay),
      clearNavigationStateTimeout: timer => owner.clear(timer),
    });

  feature.scheduleNavigationStateSync(navigationHost(firstOwner));
  feature.reset();
  feature.scheduleNavigationStateSync(navigationHost(replacementOwner));
  feature.reset();
  firstOwner.callbacks.get(1)!();
  replacementOwner.callbacks.get(1)!();

  assert.deepEqual(firstOwner.cleared, [1]);
  assert.deepEqual(replacementOwner.cleared, [1]);
  assert.deepEqual(writes, []);
});

test("an old persistence callback cannot clear newer timer ownership", () => {
  const timers = stubTimers();
  try {
    const feature = new DocumentNavigation();
    const writes: Array<string | null> = [];
    const navigationHost = host({
      navigationState: {
        readNavigationDestinationId: () => "previous",
        writeNavigationDestinationId: id => {
          writes.push(id);
        },
      },
      canWriteNavigationState: () => true,
    });
    feature.scheduleNavigationStateSync(navigationHost);
    feature.scheduleNavigationStateSync(navigationHost);
    timers.callbacks.get(1)!();
    feature.scheduleNavigationStateSync(navigationHost);
    assert.deepEqual(timers.cleared, [1, 2]);
    timers.callbacks.get(2)!();
    assert.deepEqual(writes, []);
    timers.callbacks.get(3)!();
    assert.deepEqual(writes, [null]);
  } finally {
    timers.restore();
  }
});

test("destination preparation remains awaitable after reset clears its reference", async () => {
  const feature = new DocumentNavigation();
  let release!: () => void;
  const destinations = new Promise<Map<string, unknown>>(resolve => {
    release = () => resolve(new Map([["section:intro", [0, { name: "Fit" }]]]));
  });
  const navigationHost = destinationHost(new Map());
  const pendingHost = host({
    ...navigationHost,
    getPdf: () =>
      ({ getDestinations: async () => destinations, getDestination: async () => null }) as never,
  });
  const preparation = feature.prepareDestinations(pendingHost);
  assert.equal(feature.destinationPreparation, preparation);
  feature.reset();
  assert.equal(feature.destinationPreparation, null);
  release();
  await preparation;
});
