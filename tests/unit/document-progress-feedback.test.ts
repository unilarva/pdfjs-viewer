// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentProgressFeedback } from "../../src/document-progress-feedback.js";

class FakeProgress {
  public readonly dataset: Record<string, string | undefined> = {};
  public readonly classes = new Set<string>();
  public readonly attributes = new Map<string, string>();
  public max = 1;
  public value = 0;
  public readonly classList = {
    add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
  };

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class FakeTiming {
  #nextId = 0;
  #timers = new Map<number, { callback: () => void; delay: number; cleared: boolean }>();
  #frames = new Map<number, { callback: FrameRequestCallback; cancelled: boolean; ran: boolean }>();
  public reducedMotion = false;

  public setTimeout = (callback: () => void, delay: number): number => {
    const id = ++this.#nextId;
    this.#timers.set(id, { callback, delay, cleared: false });
    return id;
  };

  public clearTimeout = (id: unknown): void => {
    const timer = this.#timers.get(id as number);
    if (timer) timer.cleared = true;
  };

  public requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = ++this.#nextId;
    this.#frames.set(id, { callback, cancelled: false, ran: false });
    return id;
  };

  public cancelAnimationFrame = (id: number): void => {
    const frame = this.#frames.get(id);
    if (frame) frame.cancelled = true;
  };

  public prefersReducedMotion = (): boolean => this.reducedMotion;

  public run(delay: number, includeCleared = false): void {
    const timer = Array.from(this.#timers.values()).find(
      candidate => candidate.delay === delay && (includeCleared || !candidate.cleared),
    );
    if (!timer) throw new Error(`Missing ${delay}ms timer`);
    timer.callback();
  }

  public runFrame(timestamp: number): void {
    const frame = Array.from(this.#frames.values()).find(
      candidate => !candidate.cancelled && !candidate.ran,
    );
    if (!frame) throw new Error("Missing animation frame");
    frame.ran = true;
    frame.callback(timestamp);
  }
}

function createFeedback() {
  const progress = new FakeProgress();
  const timing = new FakeTiming();
  return {
    progress,
    timing,
    feedback: new DocumentProgressFeedback(
      progress as unknown as HTMLProgressElement,
      "PDF loading failed",
      timing,
    ),
  };
}

test("document progress clamps and smoothly interpolates determinate values", () => {
  const { feedback, progress, timing } = createFeedback();
  feedback.update(3, 2, false, "load");
  assert.equal(progress.dataset.phase, "load");
  assert.equal(progress.max, 1);
  assert.equal(progress.value, 0);
  assert.equal(progress.classes.has("pdf-document-progress--visible"), true);
  timing.runFrame(0);
  timing.runFrame(90);
  assert.ok(progress.value > 0 && progress.value < 1);
  timing.runFrame(180);
  assert.equal(progress.value, 1);

  feedback.update(0.25, 1, false, "render");
  assert.equal(progress.dataset.phase, "render");
  assert.equal(progress.max, 1);
  timing.runFrame(200);
  timing.runFrame(380);
  assert.equal(progress.value, 0.25);
});

test("document progress uses native indeterminate state when the target is unknown", () => {
  const { feedback, progress } = createFeedback();
  progress.attributes.set("value", "0");
  feedback.update(10, null, false, "load");
  assert.equal(progress.attributes.has("value"), false);
  assert.equal(progress.classes.has("pdf-document-progress--visible"), true);
});

test("document progress completes in two stages and replaces pending timers", () => {
  const { feedback, progress, timing } = createFeedback();
  feedback.update(1, 2);
  feedback.update(1, 1, true, "render");
  assert.equal(progress.max, 1);
  assert.equal(progress.value, 0);
  timing.runFrame(0);
  timing.runFrame(180);
  assert.equal(progress.value, 1);

  timing.run(200);
  assert.equal(progress.classes.has("pdf-document-progress--visible"), false);
  assert.equal(progress.value, 1);
  timing.run(700);
  assert.equal(progress.value, 0);
});

test("document progress cancellation preserves state and reset clears it", () => {
  const { feedback, progress, timing } = createFeedback();
  feedback.update(1, 2, false, "error");
  timing.runFrame(0);
  timing.runFrame(90);
  feedback.cancelPending();
  assert.ok(progress.value > 0 && progress.value < 0.5);
  assert.equal(progress.attributes.get("aria-live"), "polite");
  assert.equal(progress.attributes.get("aria-valuetext"), "PDF loading failed");

  feedback.reset();
  assert.equal(progress.classes.has("pdf-document-progress--visible"), false);
  assert.equal(progress.dataset.phase, undefined);
  assert.equal(progress.attributes.has("aria-live"), false);
  assert.equal(progress.attributes.has("aria-valuetext"), false);
  assert.equal(progress.max, 1);
  assert.equal(progress.value, 0);
});

test("refreshes an active error announcement without cancelling animation or resetting value", () => {
  const { feedback, progress, timing } = createFeedback();
  feedback.update(1, 2, false, "error");
  timing.runFrame(0);
  const value = progress.value;
  feedback.setUiText("Loading failed X");
  assert.equal(progress.attributes.get("aria-valuetext"), "Loading failed X");
  assert.equal(progress.value, value);
  timing.runFrame(90);
  assert.ok(progress.value > value, "the existing animation frame remains active");
});

test("document progress updates immediately when reduced motion is preferred", () => {
  const { feedback, progress, timing } = createFeedback();
  timing.reducedMotion = true;
  feedback.update(1, 2, false, "load");
  assert.equal(progress.value, 0.5);
});
