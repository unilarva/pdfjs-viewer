// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  RenderScheduler,
  renderOperationSatisfies,
  type RenderAdmissionCandidate,
  type RenderOperation,
} from "../../src/render-scheduler.js";
import { createRenderPlan, type RenderPlannerInput } from "../../src/render-planner.js";

function input(overrides: Partial<RenderPlannerInput> = {}): RenderPlannerInput {
  const rows = overrides.rows ?? [[1], [2], [3], [4]];
  const visibleRange = overrides.visibleRange ?? { first: 1, last: 1 };
  return {
    rows,
    rowBounds: rows.map((_, index) => ({ top: index * 100, bottom: (index + 1) * 100 })),
    viewport: { top: visibleRange.first * 100, height: 100 },
    visibleRange,
    maxBufferViewportHeights: "unlimited",
    maxBufferPages: "unlimited",
    motion: "stationary",
    requestedDpr: 1,
    currentScale: 1,
    pageBaseSizes: new Map(),
    fallbackPageSize: { width: 100, height: 100 },
    settings: {
      memoryLimitMiB: 5,
      maxCanvasPixels: 24_000_000,
      maxCanvasDimension: 8192,
      maxConcurrentRenders: 3,
      minRenderDpr: 0.5,
      allowDprReduction: true,
      allowVisibleDirectRendering: false,
      memoryHysteresis: 0,
    },
    retainCommittedPages: true,
    retainedCandidates: [],
    committedPageRenderDprs: new Map(),
    fixedOccupiedBytes: 0,
    ...overrides,
  };
}

function fakePdf(): import("pdfjs-dist").PDFDocumentProxy {
  return {} as import("pdfjs-dist").PDFDocumentProxy;
}

function fakeTask(cancel: () => void = () => {}): import("pdfjs-dist").RenderTask {
  return { promise: Promise.resolve(), cancel } as unknown as import("pdfjs-dist").RenderTask;
}

function admission(candidate: RenderAdmissionCandidate, generation = 1) {
  return {
    pdf: fakePdf(),
    documentGeneration: generation,
    requestedDpr: candidate.renderDpr,
    useDirectCanvas: candidate.requiresDirectCanvas,
    maxCanvasPixels: 24_000_000,
    maxCanvasDimension: 8192,
    reservedBytes: 100,
    surfaceIdentity: {},
  };
}

function prepare(scheduler: RenderScheduler, planInput = input()): void {
  scheduler.applyPlan(createRenderPlan(planInput), planInput.visibleRange, planInput.currentScale);
  const centerRow = Math.floor((planInput.visibleRange.first + planInput.visibleRange.last) / 2);
  scheduler.rebuildQueue(
    centerRow,
    planInput.motion,
    () => false,
    page => page - 1,
  );
}

function admit(scheduler: RenderScheduler, generation = 1): RenderOperation {
  return scheduler.admitNext(candidate => admission(candidate, generation))!;
}

test("plans and admits visible-first work with detached snapshots", () => {
  const scheduler = new RenderScheduler(3);
  prepare(scheduler);
  const queued = scheduler.queuedPages();
  const plan = scheduler.planSnapshot()!;
  assert.equal(Object.isFrozen(queued), true);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(queued.at(-1), 2);
  const operation = admit(scheduler);
  assert.equal(operation.pageNo, 2);
  assert.equal(scheduler.snapshot().admittedRenderCount, 1);
});

test("orders visible pages center-out when stationary and leading-edge-first while moving", () => {
  const admissionOrder = (motion: RenderPlannerInput["motion"]): number[] => {
    const scheduler = new RenderScheduler(10);
    const planInput = input({
      rows: [[1], [2], [3], [4], [5]],
      visibleRange: { first: 1, last: 3 },
      maxBufferViewportHeights: 0,
      motion,
      settings: { ...input().settings, maxConcurrentRenders: 10 },
    });
    prepare(scheduler, planInput);
    const pages: number[] = [];
    while (true) {
      const operation = scheduler.admitNext(candidate => admission(candidate));
      if (!operation) break;
      pages.push(operation.pageNo);
    }
    return pages;
  };

  assert.deepEqual(admissionOrder("stationary"), [3, 2, 4]);
  assert.deepEqual(admissionOrder("forward"), [4, 3, 2]);
  assert.deepEqual(admissionOrder("backward"), [2, 3, 4]);
});

test("preemption protects visible work and breaks equal-distance victim ties behind motion", () => {
  const scheduler = new RenderScheduler(2);
  const planInput = input({
    rows: [[1], [2], [3], [4], [5]],
    visibleRange: { first: 2, last: 2 },
    motion: "forward",
    settings: { ...input().settings, maxConcurrentRenders: 2 },
  });
  prepare(scheduler, planInput);
  const admitNonVisible = () =>
    scheduler.admitNext(candidate => (candidate.pageNo === 3 ? null : admission(candidate)));
  assert.equal(admitNonVisible()?.pageNo, 4);
  assert.equal(admitNonVisible()?.pageNo, 2);

  const victims = scheduler.preemptForVisible(
    page => page - 1,
    2,
    "forward",
    () => {},
  );
  assert.deepEqual(
    victims.map(operation => operation.pageNo),
    [2],
  );
  assert.equal(
    victims.some(operation => operation.pageNo === 3),
    false,
  );
});

test("admission is rejected when its callback reentrantly replaces the plan", () => {
  const scheduler = new RenderScheduler(1);
  prepare(scheduler, input({ settings: { ...input().settings, maxConcurrentRenders: 1 } }));
  const replacement = input({ rows: [[9]], visibleRange: { first: 0, last: 0 } });
  const operation = scheduler.admitNext(candidate => {
    scheduler.applyPlan(
      createRenderPlan(replacement),
      replacement.visibleRange,
      replacement.currentScale,
    );
    return admission(candidate);
  });
  assert.equal(operation, null);
  assert.equal(scheduler.snapshot().admittedRenderCount, 0);
});

test("task attachment, reservation, temporary allocation, and exact settlement balance", () => {
  const scheduler = new RenderScheduler(1);
  prepare(scheduler, input({ settings: { ...input().settings, maxConcurrentRenders: 1 } }));
  const operation = admit(scheduler);
  assert.equal(scheduler.updateReservation(operation, 400), true);
  assert.equal(scheduler.recordOffscreenAllocation(operation, 50), true);
  assert.equal(scheduler.attachTask(operation, fakeTask()), true);
  assert.equal(scheduler.attachTask(operation, fakeTask()), false);
  assert.deepEqual(scheduler.snapshot(), {
    queuedPageCount: 3,
    admittedRenderCount: 1,
    inFlightRenderCount: 1,
    activeOffscreenBufferCount: 1,
    activeOffscreenPixels: 50,
    reservedBytes: 400,
    authoritativeRenderCount: 1,
    settlingRenderCount: 0,
    directSurfaceLockCount: 0,
    settlingOffscreenPixels: 0,
    maxConcurrentRenders: 1,
    idle: false,
  });
  assert.equal(scheduler.settleOperation(operation), true);
  assert.equal(scheduler.settleOperation(operation), false);
  assert.equal(scheduler.snapshot().reservedBytes, 0);
  assert.equal(scheduler.snapshot().activeOffscreenPixels, 0);
});

test("same-page stale settlement cannot remove a replacement operation", () => {
  const scheduler = new RenderScheduler(2);
  prepare(scheduler, input({ settings: { ...input().settings, maxConcurrentRenders: 2 } }));
  const stale = admit(scheduler, 1);
  scheduler.cancelActiveOperations(() => {});
  scheduler.rebuildQueue(
    1,
    "stationary",
    () => false,
    page => page - 1,
  );
  const replacement = admit(scheduler, 2);
  assert.equal(stale.pageNo, replacement.pageNo);
  assert.equal(scheduler.settleOperation(stale), true);
  assert.equal(scheduler.ownsOperation(replacement), true);
});

test("cancellation exceptions invalidate authority but retain resources until settlement", () => {
  const scheduler = new RenderScheduler(3);
  prepare(scheduler);
  const first = admit(scheduler);
  const second = admit(scheduler);
  scheduler.attachTask(first, fakeTask());
  scheduler.attachTask(second, fakeTask());
  scheduler.recordOffscreenAllocation(first, 10);
  scheduler.recordOffscreenAllocation(second, 20);
  let calls = 0;
  scheduler.cancelActiveOperations(() => {
    calls++;
    throw new Error("PDF.js cancellation failed");
  });
  assert.equal(calls, 2);
  assert.equal(scheduler.ownsOperation(first), false);
  assert.equal(scheduler.ownsOperation(second), false);
  assert.equal(scheduler.snapshot().admittedRenderCount, 2);
  assert.equal(scheduler.snapshot().authoritativeRenderCount, 0);
  assert.equal(scheduler.snapshot().settlingRenderCount, 2);
  assert.equal(scheduler.snapshot().reservedBytes, 200);
  assert.equal(scheduler.settleOperation(first), true);
  assert.equal(scheduler.settleOperation(second), true);
  assert.equal(scheduler.snapshot().admittedRenderCount, 0);
  assert.equal(scheduler.snapshot().reservedBytes, 0);
});

test("reset invalidates callback-admitted work and returns to an empty boundary", () => {
  const scheduler = new RenderScheduler(3);
  prepare(scheduler);
  const original = admit(scheduler);
  scheduler.attachTask(original, fakeTask());
  let reentered: RenderOperation | null = null;
  scheduler.reset(() => {
    reentered = scheduler.admitNext(candidate => admission(candidate));
  });
  assert.ok(reentered);
  assert.equal(scheduler.ownsOperation(original), false);
  assert.equal(scheduler.ownsOperation(reentered), false);
  assert.equal(scheduler.planSnapshot(), null);
  assert.deepEqual(scheduler.queuedPages(), []);
  assert.equal(scheduler.snapshot().idle, false, "physical work remains accounted after reset");
  assert.equal(scheduler.settleOperation(original), true);
  assert.equal(scheduler.snapshot().idle, true);
});

test("direct surface ownership survives cancellation until physical settlement", () => {
  const scheduler = new RenderScheduler(2);
  const planInput = input({ settings: { ...input().settings, maxConcurrentRenders: 2 } });
  const plan = createRenderPlan(planInput);
  plan.directRenderPages.add(2);
  scheduler.applyPlan(plan, planInput.visibleRange, planInput.currentScale);
  scheduler.rebuildQueue(
    1,
    "stationary",
    () => false,
    pageNo => pageNo - 1,
  );
  const surface = {};
  const direct = scheduler.admitNext(candidate => ({
    ...admission(candidate),
    useDirectCanvas: true,
    surfaceIdentity: surface,
  }))!;
  scheduler.cancelActiveOperations(() => {});
  scheduler.rebuildQueue(
    1,
    "stationary",
    () => false,
    pageNo => pageNo - 1,
  );
  const blocked = scheduler.admitNext(candidate => ({
    ...admission(candidate),
    surfaceIdentity: surface,
  }));
  assert.equal(blocked, null);
  assert.equal(scheduler.snapshot().directSurfaceLockCount, 1);
  assert.equal(scheduler.settleOperation(direct), true);
  const replacement = scheduler.admitNext(candidate => ({
    ...admission(candidate),
    surfaceIdentity: surface,
  }));
  assert.ok(replacement);
});

test("result sufficiency ignores execution strategy and uses epsilon-aware DPR", () => {
  const scheduler = new RenderScheduler(1);
  prepare(
    scheduler,
    input({ requestedDpr: 2, settings: { ...input().settings, maxConcurrentRenders: 1 } }),
  );
  const operation = admit(scheduler);
  const requirement = {
    scale: 1,
    renderDpr: operation.requirement.renderDpr + 5e-7,
    rasterState: operation.requirement.rasterState,
  };
  assert.equal(renderOperationSatisfies(operation, requirement), true);
  assert.equal(
    renderOperationSatisfies(operation, requirement, operation.requirement.renderDpr),
    true,
  );
  assert.equal(
    renderOperationSatisfies(operation, {
      ...requirement,
      renderDpr: operation.requirement.renderDpr + 0.1,
    }),
    false,
  );
  assert.equal(renderOperationSatisfies(operation, { ...requirement, scale: 1.25 }), false);
});
