// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { resolvePdfDestination } from "../../src/pdf-destinations.js";
import { DocumentPageUsage } from "../../src/document-page-usage.js";

function pdf(destination: unknown) {
  let cleaned = 0;
  return {
    proxy: {
      getDestination: async () => destination,
      getPageIndex: async () => 2,
      getPage: async () => ({
        getViewport: () => ({
          width: 100,
          height: 200,
          convertToViewportPoint: (x: number, y: number) => [x, 200 - y],
        }),
        cleanup: () => {
          cleaned++;
        },
      }),
    },
    pages: null as DocumentPageUsage | null,
    cleaned: () => cleaned,
  };
}

test("resolves named and direct XYZ destinations and cleans temporary pages", async () => {
  const fake = pdf([{ num: 5, gen: 0 }, { name: "XYZ" }, 25, 50]);
  fake.pages = new DocumentPageUsage(fake.proxy as never);
  assert.deepEqual(await resolvePdfDestination(fake.proxy as never, "chapter", fake.pages), {
    pageIndex: 2,
    xRatio: 0.25,
    yRatio: 0.75,
  });
  assert.equal(fake.cleaned(), 1);
});

test("handles supported fit modes and invalid references", async () => {
  const fit = pdf([1, { name: "Fit" }]);
  fit.pages = new DocumentPageUsage(fit.proxy as never);
  assert.deepEqual(
    await resolvePdfDestination(fit.proxy as never, [1, { name: "Fit" }], fit.pages),
    { pageIndex: 1, yRatio: 0, xRatio: undefined },
  );
  assert.equal(
    await resolvePdfDestination(fit.proxy as never, [null, { name: "XYZ" }], fit.pages),
    null,
  );
});

test("transforms rotated destinations as complete points and rectangles", async () => {
  let requestedRotation = -1;
  const proxy = {
    getDestination: async () => null,
    getPageIndex: async () => 0,
    getPage: async () => ({
      rotate: 90,
      getViewport: ({ rotation }: { rotation: number }) => {
        requestedRotation = rotation;
        return {
          rotation,
          width: 200,
          height: 100,
          convertToViewportPoint: (x: number, y: number) => [200 - y, 100 - x],
        };
      },
      cleanup: () => {},
    }),
  };
  const pages = new DocumentPageUsage(proxy as never);
  assert.deepEqual(
    await resolvePdfDestination(proxy as never, [0, { name: "XYZ" }, 40, 70], pages, 180),
    { pageIndex: 0, xRatio: 0.65, yRatio: 0.6 },
  );
  assert.equal(requestedRotation, 270);
  assert.deepEqual(
    await resolvePdfDestination(proxy as never, [0, { name: "FitR" }, 20, 10, 80, 70], pages, 180),
    { pageIndex: 0, xRatio: 0.65, yRatio: 0.2 },
  );
  assert.deepEqual(
    await resolvePdfDestination(proxy as never, [0, { name: "FitH" }, 70], pages, 180),
    { pageIndex: 0, yRatio: undefined, xRatio: 0.65 },
  );
});
