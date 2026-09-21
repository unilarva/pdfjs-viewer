// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentNavigationHistory } from "../../src/document-navigation-history.js";
import {
  documentLocationFromDisplay,
  documentLocationToDisplay,
} from "../../src/document-location.js";

const location = (page: number, xRatio = 0.5, yRatio = 0.35) => ({ page, xRatio, yRatio });

test("starts empty, transitions atomically, branches, and resets", () => {
  const history = new DocumentNavigationHistory();
  assert.equal(history.canGoBack, false);
  assert.equal(history.takeBack(location(1)), null);
  assert.equal(history.recordDeparture(location(1)), true);
  const back = history.takeBack(location(2));
  assert.deepEqual(back?.target, location(1));
  assert.equal(history.canGoBack, true);
  assert.equal(history.canGoForward, false);
  assert.equal(back?.commit(), true);
  assert.equal(back?.commit(), false);
  assert.equal(history.canGoBack, false);
  assert.equal(history.canGoForward, true);
  assert.equal(history.recordDeparture(location(3)), true);
  assert.equal(history.canGoForward, false);
  history.reset();
  assert.equal(history.canGoBack, false);
});

test("detaches, freezes, clamps, validates, and suppresses epsilon duplicates", () => {
  const history = new DocumentNavigationHistory();
  const mutable = { page: 1, xRatio: -1, yRatio: 2 };
  assert.equal(history.recordDeparture(mutable), true);
  mutable.page = 9;
  assert.equal(history.recordDeparture({ page: 1, xRatio: 0.00001, yRatio: 0.99999 }), false);
  assert.equal(history.recordDeparture({ page: 0, xRatio: 0.5, yRatio: 0.5 }), false);
  const transition = history.takeBack(location(2));
  assert.deepEqual(transition?.target, { page: 1, xRatio: 0, yRatio: 1 });
  assert.equal(Object.isFrozen(transition?.target), true);
});

test("bounds combined locations and evicts oldest Back first", () => {
  const history = new DocumentNavigationHistory();
  for (let page = 1; page <= 101; page++) history.recordDeparture(location(page));
  const pages: number[] = [];
  let current = location(102);
  while (history.canGoBack) {
    const transition = history.takeBack(current)!;
    pages.push(transition.target.page);
    current = transition.target;
    assert.equal(transition.commit(), true);
  }
  assert.equal(pages.length, 100);
  assert.equal(pages.at(-1), 2);
});

test("keeps the combined bound while locations move into Forward", () => {
  const history = new DocumentNavigationHistory();
  for (let page = 1; page <= 101; page++) history.recordDeparture(location(page));
  let current = location(102);
  for (let count = 0; count < 40; count++) {
    const transition = history.takeBack(current)!;
    current = transition.target;
    assert.equal(transition.commit(), true);
  }
  let remainingBack = 0;
  let oldestBack = 0;
  while (history.canGoBack) {
    const transition = history.takeBack(current)!;
    oldestBack = transition.target.page;
    current = transition.target;
    remainingBack++;
    assert.equal(transition.commit(), true);
  }
  assert.equal(remainingBack, 60);
  assert.equal(oldestBack, 2);
});

test("stale or abandoned transitions leave stacks unchanged", () => {
  const history = new DocumentNavigationHistory();
  history.recordDeparture(location(1));
  const abandoned = history.takeBack(location(2))!;
  assert.equal(history.canGoBack, true);
  history.recordDeparture(location(3));
  assert.equal(abandoned.commit(), false);
  assert.equal(history.canGoBack, true);
});

test("rotation conversion round-trips normalized coordinates", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const captured = documentLocationFromDisplay(4, 0.2, 0.7, rotation)!;
    const displayed = documentLocationToDisplay(captured, rotation)!;
    assert.equal(displayed.page, 4);
    assert.ok(Math.abs(displayed.xRatio - 0.2) < 1e-12);
    assert.ok(Math.abs(displayed.yRatio - 0.7) < 1e-12);
  }
});

test("rotation conversion follows known viewer-rotation mappings", () => {
  const expected = [
    [0, 0.2, 0.7],
    [90, 0.7, 0.8],
    [180, 0.8, 0.3],
    [270, 0.3, 0.2],
  ] as const;
  for (const [rotation, xRatio, yRatio] of expected) {
    const actual = documentLocationFromDisplay(4, 0.2, 0.7, rotation)!;
    assert.equal(actual.page, 4);
    assert.ok(Math.abs(actual.xRatio - xRatio) < 1e-12);
    assert.ok(Math.abs(actual.yRatio - yRatio) < 1e-12);
  }
  for (const [rotation, xRatio, yRatio] of [
    [90, 0.3, 0.2],
    [180, 0.8, 0.3],
    [270, 0.7, 0.8],
  ] as const) {
    const actual = documentLocationToDisplay(location(4, 0.2, 0.7), rotation)!;
    assert.ok(Math.abs(actual.xRatio - xRatio) < 1e-12);
    assert.ok(Math.abs(actual.yRatio - yRatio) < 1e-12);
  }
});
