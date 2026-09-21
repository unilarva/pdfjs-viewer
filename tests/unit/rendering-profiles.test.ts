// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeRenderingProfilePolicy,
  mergeRenderingProfiles,
  resolveRenderingProfile,
} from "../../src/rendering-profiles.js";

test("merges profile overrides without mutating defaults", () => {
  const profiles = mergeRenderingProfiles({
    balanced: { maxRenderDpr: 2, print: { maxSheets: 20 } },
  });
  assert.equal(profiles.balanced.maxRenderDpr, 2);
  assert.equal(profiles.conservative.maxRenderDpr, 3);
  assert.deepEqual(
    [
      profiles.conservative.thumbnailMemoryLimitMiB,
      profiles.balanced.thumbnailMemoryLimitMiB,
      profiles.aggressive.thumbnailMemoryLimitMiB,
    ],
    [12, 24, 64],
  );
  assert.deepEqual(
    [
      profiles.conservative.maxBufferViewportHeights,
      profiles.balanced.maxBufferViewportHeights,
      profiles.aggressive.maxBufferViewportHeights,
    ],
    [8, 16, "unlimited"],
  );
  assert.deepEqual(
    [
      profiles.conservative.maxBufferPages,
      profiles.balanced.maxBufferPages,
      profiles.aggressive.maxBufferPages,
    ],
    [128, 512, "unlimited"],
  );
  assert.throws(() => {
    (profiles.balanced as { maxRenderDpr: number }).maxRenderDpr = 4;
  });
  assert.equal(profiles.balanced.print.maxSheets, 20);
  assert.equal(profiles.balanced.memoryLimitMiB, 512);
  assert.throws(() => {
    (profiles.balanced.print as { maxSheets: number }).maxSheets = 4;
  });
  assert.deepEqual(
    Object.values(profiles).map(profile => [profile.maxCanvasPixels, profile.maxCanvasDimension]),
    [
      [24_000_000, 8192],
      [24_000_000, 8192],
      [24_000_000, 8192],
    ],
  );
});

test("rejects invalid profile settings and unavailable selection", () => {
  assert.throws(() => mergeRenderingProfiles({ balanced: { maxCanvasPixels: 0 } }));
  assert.throws(() =>
    mergeRenderingProfiles({ balanced: { thumbnailMemoryLimitMiB: Number.NaN } }),
  );
  assert.throws(() =>
    mergeRenderingProfiles({ balanced: { maxBufferViewportHeights: Number.NaN } }),
  );
  assert.throws(() => mergeRenderingProfiles({ balanced: { maxBufferPages: 1.5 } }));
  assert.throws(() =>
    mergeRenderingProfiles({ balanced: { bufferViewportHeightsWhenInactive: -1 } }),
  );
  assert.throws(() => mergeRenderingProfiles({ balanced: { print: { maxSheets: 1.5 } } }));
  assert.throws(() =>
    mergeRenderingProfiles({ balanced: { print: { maxPeakBytes: 1 } as never } }),
  );
  assert.throws(() => resolveRenderingProfile("aggressive", ["conservative"], "conservative"));
});

test("accepts fractional viewport-height buffering and bounded or unbounded page ceilings", () => {
  const profiles = mergeRenderingProfiles({
    balanced: {
      maxBufferViewportHeights: 2.5,
      maxBufferPages: 40,
      bufferViewportHeightsWhenInactive: 0.25,
    },
    aggressive: { maxBufferViewportHeights: "unlimited", maxBufferPages: "unlimited" },
  });
  assert.equal(profiles.balanced.maxBufferViewportHeights, 2.5);
  assert.equal(profiles.balanced.maxBufferPages, 40);
  assert.equal(profiles.balanced.bufferViewportHeightsWhenInactive, 0.25);
  assert.equal(profiles.aggressive.maxBufferViewportHeights, "unlimited");
  assert.equal(profiles.aggressive.maxBufferPages, "unlimited");
});

test("clamps main and thumbnail memory to their independent ranges", () => {
  const low = mergeRenderingProfiles({
    balanced: { memoryLimitMiB: 0, thumbnailMemoryLimitMiB: 0 },
  });
  assert.equal(low.balanced.memoryLimitMiB, 5);
  assert.equal(low.balanced.thumbnailMemoryLimitMiB, 1);

  const high = mergeRenderingProfiles({
    balanced: { memoryLimitMiB: 20_000, thumbnailMemoryLimitMiB: 20_000 },
  });
  assert.equal(high.balanced.memoryLimitMiB, 8192);
  assert.equal(high.balanced.thumbnailMemoryLimitMiB, 1024);
});

test("derives print memory from the immutable top-level profile and rejects nested memory", () => {
  const profile = mergeRenderingProfiles({
    balanced: { memoryLimitMiB: 640, print: { maxSheets: 20 } },
  });
  assert.equal(profile.balanced.memoryLimitMiB, 640);
  assert.equal(profile.balanced.print.maxSheets, 20);
  assert.throws(() => {
    (profile.balanced as { memoryLimitMiB: number }).memoryLimitMiB = 9;
  });
  assert.throws(() =>
    mergeRenderingProfiles({ balanced: { print: { memoryLimitMiB: 100 } as never } }),
  );
});

test("uses category policy defaults and validates partial overrides", () => {
  const policy = mergeRenderingProfilePolicy({
    likelyMobile: { availableProfiles: ["balanced"], defaultProfile: "balanced" },
  });
  assert.equal(
    resolveRenderingProfile(
      "auto",
      policy.likelyMobile.availableProfiles,
      policy.likelyMobile.defaultProfile,
    ),
    "balanced",
  );
  assert.throws(() => mergeRenderingProfilePolicy({ other: { availableProfiles: [] } }));
});
