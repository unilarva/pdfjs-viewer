// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  NativePrintCoordinator,
  nativePrintCoordinatorFor,
  retainPrintSourceUrl,
} from "../../src/native-print-coordinator.js";

class FakeWindow extends EventTarget {
  navigator = { userAgent: "Chromium" };
  onafterprint: null = null;
  prints = 0;
  focus() {}
  print() {
    this.prints++;
  }
}

class MissingAfterPrintWindow extends FakeWindow {
  override print() {
    this.prints++;
    this.dispatchEvent(new Event("beforeprint"));
    this.dispatchEvent(new Event("focus"));
  }
}

class ThrowingPrintWindow extends FakeWindow {
  override print() {
    this.prints++;
    throw new Error("print rejected");
  }
}

class SynchronousAfterPrintWindow extends FakeWindow {
  override print() {
    this.prints++;
    this.dispatchEvent(new Event("beforeprint"));
    this.dispatchEvent(new Event("afterprint"));
  }
}

class ThrowingFocusWindow extends FakeWindow {
  override focus() {
    throw new Error("focus rejected");
  }
}

test("observed afterprint retains one immutable lease, rejects concurrency, and cleans exactly once", () => {
  const top = new FakeWindow();
  const frameWindow = new FakeWindow();
  let removed = 0;
  let cleanups = 0;
  const root = {
    isConnected: true,
    remove: () => {
      removed++;
    },
  };
  const coordinator = new NativePrintCoordinator(top as never);
  const resources = {
    jobId: 4,
    root,
    printWindow: frameWindow,
    urls: ["blob:a"],
    retainedBytes: 12,
    sheetCount: 2,
    cleanup: () => {
      cleanups++;
      root.remove();
    },
  };
  assert.equal(coordinator.invoke(resources as never), "invoked");
  assert.deepEqual(coordinator.diagnostics, {
    active: true,
    jobId: 4,
    retainedBytes: 12,
    sheetCount: 2,
    lifecycle: "awaiting-afterprint",
    beforePrintObserved: false,
    debugArtifactRetained: false,
  });
  assert.equal(coordinator.invoke({ ...resources, jobId: 5 } as never), "busy");
  frameWindow.dispatchEvent(new Event("afterprint"));
  top.dispatchEvent(new Event("afterprint"));
  assert.equal(cleanups, 1);
  assert.equal(removed, 1);
  assert.equal(coordinator.diagnostics.active, false);
});

test("resource cleanup precedes settlement so resumed rendering cannot overlap print rasters", () => {
  const top = new FakeWindow();
  const events: string[] = [];
  const coordinator = new NativePrintCoordinator(top as never);
  coordinator.invoke({
    jobId: 6,
    root: { isConnected: true },
    printWindow: top,
    urls: [],
    retainedBytes: 4,
    sheetCount: 1,
    cleanup: () => {
      events.push("cleanup");
    },
    settled: () => {
      events.push("lease-release-and-rerender");
    },
  } as never);
  top.dispatchEvent(new Event("afterprint"));
  assert.deepEqual(events, ["cleanup", "lease-release-and-rerender"]);
});

test("cleanup failure still clears the coordinator and settles its exclusive owner", () => {
  const win = new FakeWindow();
  let settled = 0;
  const coordinator = new NativePrintCoordinator(win as never);
  coordinator.invoke({
    jobId: 28,
    root: { isConnected: true },
    printWindow: win,
    urls: [],
    retainedBytes: 0,
    sheetCount: 1,
    cleanup: () => {
      throw new Error("cleanup failed");
    },
    settled: () => {
      settled++;
    },
  } as never);
  win.dispatchEvent(new Event("afterprint"));
  assert.equal(settled, 1);
  assert.equal(coordinator.busy, false);
  assert.equal(coordinator.diagnostics.active, false);
});

test("invocation is accepted before a synchronous afterprint can settle retained resources", () => {
  const win = new SynchronousAfterPrintWindow();
  const events: string[] = [];
  const coordinator = new NativePrintCoordinator(win as never);
  assert.equal(
    coordinator.invoke({
      jobId: 30,
      root: { isConnected: true },
      printWindow: win,
      urls: [],
      retainedBytes: 0,
      sheetCount: 1,
      invoked: () => {
        events.push(`invoked:${coordinator.diagnostics.active}`);
      },
      cleanup: () => {
        events.push("cleanup");
      },
      settled: () => {
        events.push("settled");
      },
    } as never),
    "invoked",
  );
  assert.deepEqual(events, ["invoked:true", "cleanup", "settled"]);
  assert.equal(coordinator.busy, false);
});

test("afterprint reentered from invocation waits until native print begins", () => {
  const win = new FakeWindow();
  const events: string[] = [];
  win.print = () => {
    events.push("print");
  };
  const coordinator = new NativePrintCoordinator(win as never);
  coordinator.invoke({
    jobId: 32,
    root: { isConnected: true },
    printWindow: win,
    urls: [],
    retainedBytes: 0,
    sheetCount: 1,
    invoked: () => {
      events.push("invoked");
      win.dispatchEvent(new Event("afterprint"));
    },
    cleanup: () => {
      events.push("cleanup");
    },
    settled: () => {
      events.push("settled");
    },
  } as never);
  assert.deepEqual(events, ["invoked", "print", "cleanup", "settled"]);
  assert.equal(coordinator.busy, false);
});

test("focus failure does not publish invocation and finalizes resources once", () => {
  const win = new ThrowingFocusWindow();
  const events: string[] = [];
  const coordinator = new NativePrintCoordinator(win as never);
  assert.throws(
    () =>
      coordinator.invoke({
        jobId: 31,
        root: { isConnected: true },
        printWindow: win,
        urls: [],
        retainedBytes: 0,
        sheetCount: 1,
        invoked: () => {
          events.push("invoked");
        },
        cleanup: () => {
          events.push("cleanup");
        },
        settled: () => {
          events.push("settled");
        },
      } as never),
    /focus rejected/,
  );
  assert.deepEqual(events, ["cleanup", "settled"]);
  assert.equal(coordinator.busy, false);
});

test("unsupported invocation retains no lease and a throwing print finalizes resources exactly once", () => {
  const unsupported = new FakeWindow();
  const coordinator = new NativePrintCoordinator(unsupported as never);
  const noPrint = { ...unsupported, print: undefined };
  assert.equal(
    coordinator.invoke({
      jobId: 20,
      root: { isConnected: true },
      printWindow: noPrint,
      urls: [],
      retainedBytes: 0,
      sheetCount: 1,
      cleanup() {},
    } as never),
    "unsupported",
  );
  assert.equal(coordinator.busy, false);

  const throwing = new ThrowingPrintWindow();
  const events: string[] = [];
  assert.throws(
    () =>
      coordinator.invoke({
        jobId: 21,
        root: { isConnected: true },
        printWindow: throwing,
        urls: [],
        retainedBytes: 0,
        sheetCount: 1,
        cleanup: () => {
          events.push("cleanup");
        },
        invoked: () => {
          events.push("invoked");
        },
        settled: () => {
          events.push("settled");
        },
      } as never),
    /print rejected/,
  );
  throwing.dispatchEvent(new Event("afterprint"));
  assert.deepEqual(events, ["invoked", "cleanup", "settled"]);
  assert.equal(coordinator.busy, false);
});

test("print return and user agent never release an unresolved lease", () => {
  const top = new FakeWindow();
  top.navigator.userAgent = "Firefox/141";
  const frameWindow = new FakeWindow();
  let cleanups = 0;
  const coordinator = new NativePrintCoordinator(top as never);
  const root = { isConnected: true };
  assert.equal(
    coordinator.invoke({
      jobId: 1,
      root,
      printWindow: frameWindow,
      urls: [],
      retainedBytes: 0,
      sheetCount: 1,
      cleanup: () => {
        cleanups++;
      },
    } as never),
    "invoked",
  );
  assert.equal(frameWindow.prints, 1);
  assert.equal(cleanups, 0);
  assert.equal(coordinator.diagnostics.active, true);
  frameWindow.dispatchEvent(new Event("beforeprint"));
  assert.equal(coordinator.diagnostics.beforePrintObserved, true);
  frameWindow.dispatchEvent(new Event("afterprint"));
  assert.equal(cleanups, 1);
  assert.equal(coordinator.diagnostics.active, false);
});

test("orphan recovery is conservative and cleanup remains idempotent", () => {
  const top = new FakeWindow();
  const root = { isConnected: true };
  let cleanups = 0;
  const coordinator = new NativePrintCoordinator(top as never);
  coordinator.invoke({
    jobId: 2,
    root,
    printWindow: top,
    urls: [],
    retainedBytes: 0,
    sheetCount: 1,
    cleanup: () => {
      cleanups++;
    },
  } as never);
  assert.equal(coordinator.recoverOrphanedLease(), false);
  root.isConnected = false;
  assert.equal(coordinator.recoverOrphanedLease(), true);
  assert.equal(cleanups, 1);
  assert.equal(coordinator.recoverOrphanedLease(), false);
  assert.equal(
    coordinator.invoke({
      jobId: 3,
      root: { isConnected: true },
      printWindow: top,
      urls: [],
      retainedBytes: 0,
      sheetCount: 1,
      cleanup() {},
    } as never),
    "invoked",
  );
  assert.equal(coordinator.diagnostics.jobId, 3);
  top.dispatchEvent(new Event("afterprint"));
  assert.equal(cleanups, 1);
});

test("source URL retention clears its timer and revokes exactly once after the child closes", () => {
  const interval: { callback?: () => void } = {};
  let cleared = 0;
  let revoked = 0;
  const win = {
    setInterval: (candidate: () => void) => {
      interval.callback = candidate;
      return 7;
    },
    clearInterval: (timer: number) => {
      assert.equal(timer, 7);
      cleared++;
    },
    URL: {
      revokeObjectURL: (url: string) => {
        assert.equal(url, "blob:source");
        revoked++;
      },
    },
  };
  const child = { closed: false };
  retainPrintSourceUrl(win as never, child as never, "blob:source");
  interval.callback?.();
  assert.equal(cleared, 0);
  assert.equal(revoked, 0);
  child.closed = true;
  interval.callback?.();
  interval.callback?.();
  assert.equal(cleared, 1);
  assert.equal(revoked, 1);
});

test("focus return observed inside print recovers a connected missing-afterprint lease", async () => {
  const top = new MissingAfterPrintWindow();
  let cleanups = 0;
  const coordinator = new NativePrintCoordinator(top as never);
  assert.equal(
    coordinator.invoke({
      jobId: 9,
      root: { isConnected: true },
      printWindow: top,
      urls: [],
      retainedBytes: 8,
      sheetCount: 1,
      cleanup: () => {
        cleanups++;
      },
    } as never),
    "invoked",
  );
  assert.equal(
    coordinator.invoke({
      jobId: 10,
      root: { isConnected: true },
      printWindow: top,
      urls: [],
      retainedBytes: 0,
      sheetCount: 1,
      cleanup() {},
    } as never),
    "busy",
  );
  assert.equal(cleanups, 0, "the second job remains blocked until observed recovery settles");
  await Promise.resolve();
  assert.equal(cleanups, 1);
  assert.equal(coordinator.busy, false);
});

test("debug artifacts retain the exclusive lease until explicit or next-invocation release", () => {
  const top = new FakeWindow();
  let cleanups = 0;
  let settlements = 0;
  const coordinator = new NativePrintCoordinator(top as never);
  const resources = {
    jobId: 7,
    root: { isConnected: true },
    printWindow: top,
    urls: [],
    retainedBytes: 4,
    sheetCount: 1,
    preserveArtifact: true,
    settled: () => {
      settlements++;
    },
    cleanup: () => {
      cleanups++;
    },
  };
  assert.equal(coordinator.invoke(resources as never), "invoked");
  top.dispatchEvent(new Event("afterprint"));
  assert.equal(settlements, 0);
  assert.equal(cleanups, 0);
  assert.equal(coordinator.diagnostics.debugArtifactRetained, true);
  assert.equal(coordinator.diagnostics.lifecycle, "debug-artifact-retained");
  assert.equal(coordinator.busy, true);
  assert.equal(coordinator.releaseDebugArtifact(), true);
  assert.equal(cleanups, 1);
  assert.equal(settlements, 1);
  assert.equal(coordinator.releaseDebugArtifact(), false);
  assert.equal(
    coordinator.invoke({ ...resources, jobId: 8, preserveArtifact: false } as never),
    "invoked",
  );
  top.dispatchEvent(new Event("afterprint"));
  assert.equal(cleanups, 2);
  assert.equal(settlements, 2);
});

test("a next invocation releases a retained debug artifact exactly once", () => {
  const top = new FakeWindow();
  let cleanups = 0;
  let settlements = 0;
  const coordinator = new NativePrintCoordinator(top as never);
  const resources = {
    jobId: 11,
    root: { isConnected: true },
    printWindow: top,
    urls: [],
    retainedBytes: 4,
    sheetCount: 1,
    preserveArtifact: true,
    settled: () => {
      settlements++;
    },
    cleanup: () => {
      cleanups++;
    },
  };
  assert.equal(coordinator.invoke(resources as never), "invoked");
  top.dispatchEvent(new Event("afterprint"));
  assert.equal(
    coordinator.invoke({ ...resources, jobId: 12, preserveArtifact: false } as never),
    "invoked",
  );
  assert.equal(cleanups, 1);
  assert.equal(settlements, 1);
});

test("same-origin child viewers share the top-level native print coordinator", () => {
  const top = Object.assign(new FakeWindow(), { document: {} });
  const child = Object.assign(new FakeWindow(), { top, document: {} });
  assert.equal(nativePrintCoordinatorFor(child as never), nativePrintCoordinatorFor(top as never));
});
