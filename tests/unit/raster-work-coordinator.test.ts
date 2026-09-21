// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { RasterWorkCoordinator } from "../../src/raster-work-coordinator.js";

test("admits one background lease only through all interaction gates", () => {
  const coordinator = new RasterWorkCoordinator();
  assert.equal(coordinator.canStartBackground, false);
  coordinator.setViewActive(true);
  assert.equal(coordinator.canStartBackground, true);
  coordinator.setPrimaryPressure("speculative");
  assert.equal(coordinator.canStartBackground, false);
  coordinator.setPrimaryPressure("idle");
  const lease = coordinator.acquireBackground(() => {});
  assert.ok(lease);
  assert.equal(
    coordinator.acquireBackground(() => {}),
    null,
  );
  lease.release();
  assert.equal(coordinator.canStartBackground, true);
  coordinator.setStationary(false);
  assert.equal(coordinator.canStartBackground, false);
  coordinator.setStationary(true);
  coordinator.setTransient(true);
  assert.equal(coordinator.canStartBackground, false);
});

test("urgent pressure revokes idempotently and retains occupancy until settlement", () => {
  const coordinator = new RasterWorkCoordinator();
  coordinator.setViewActive(true);
  let cancels = 0;
  const lease = coordinator.acquireBackground(() => {
    cancels++;
  })!;
  coordinator.setPrimaryPressure("urgent");
  coordinator.setPrimaryPressure("idle");
  assert.equal(cancels, 1);
  assert.equal(lease.revoked, true);
  assert.equal(coordinator.canStartBackground, false);
  lease.release();
  assert.equal(coordinator.canStartBackground, true);
});

test("exclusive acquisition suspends owners and waits for physical background drain", async () => {
  const coordinator = new RasterWorkCoordinator();
  coordinator.setViewActive(true);
  let cancels = 0;
  let rendererResumes = 0;
  let thumbnailResumes = 0;
  let resolveRendererDrain!: () => void;
  let resolveThumbnailDrain!: () => void;
  const rendererDrain = new Promise<void>(resolve => {
    resolveRendererDrain = resolve;
  });
  const thumbnailDrain = new Promise<void>(resolve => {
    resolveThumbnailDrain = resolve;
  });
  coordinator.setAdmissionOwners(
    {
      suspendAdmission: () => ({ token: Symbol("renderer"), settlement: rendererDrain }),
      resumeAdmission: () => {
        rendererResumes++;
      },
    },
    {
      suspendAdmission: () => ({ token: Symbol("thumbnails"), settlement: thumbnailDrain }),
      resumeAdmission: () => {
        thumbnailResumes++;
      },
    },
  );
  const lease = coordinator.acquireBackground(() => {
    cancels++;
  })!;
  let acquired = false;
  const exclusivePromise = coordinator.acquireExclusive().then(exclusive => {
    acquired = true;
    return exclusive;
  });
  await Promise.resolve();
  assert.equal(cancels, 1);
  assert.equal(acquired, false);
  resolveRendererDrain();
  resolveThumbnailDrain();
  await Promise.resolve();
  assert.equal(acquired, false, "background lease still represents physical occupancy");
  lease.release();
  assert.equal(coordinator.canStartBackground, false);
  const exclusive = await exclusivePromise;
  exclusive.release();
  assert.equal(rendererResumes, 1);
  assert.equal(thumbnailResumes, 1);
  coordinator.setRenderingActive(false);
  assert.equal(coordinator.canStartBackground, false);
});
