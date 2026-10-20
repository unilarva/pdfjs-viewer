// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

for (const action of ["checkbox", "reset"] as const) {
  test(`${action} controls retain the newest reentrant public layerschange revision`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
    await page.evaluate(() => window.fixture.primary.load("/ocg-fixture.pdf"));
    const root = page.locator("#primary");
    await root.getByRole("button", { name: "Document navigation" }).click();
    await root.getByRole("button", { name: "More document views" }).click();
    await root.getByRole("menuitemradio", { name: "Layers" }).click();
    await expect(root.locator(".pdf-layer-choice input")).toHaveCount(3);
    const outcome = await page.evaluate(async action => {
      const viewer = window.fixture.primary;
      const root = document.querySelector("#primary")!;
      const initial = viewer.getLayers();
      if (!initial.ok) throw new Error("Layers unavailable");
      type Node = (typeof initial.layers)[number];
      const groups = (nodes: readonly Node[]): Extract<Node, { kind: "group" }>[] =>
        nodes.flatMap(node => (node.kind === "group" ? [node] : groups(node.children)));
      const red = groups(initial.layers).find(group => group.name === "Red block")!;
      const blue = groups(initial.layers).find(group => group.name === "Blue block")!;
      if (action === "reset") await viewer.setLayerVisibility([{ id: blue.id, visible: true }]);
      const controls = [...root.querySelectorAll<HTMLInputElement>(".pdf-layer-choice input")];
      const revisions: number[] = [];
      let successor: ReturnType<typeof viewer.setLayerVisibility> | undefined;
      const listener = (event: Event) => {
        revisions.push((event as CustomEvent<{ revision: number }>).detail.revision);
        if (revisions.length === 1)
          successor = viewer.setLayerVisibility([{ id: blue.id, visible: true }]);
      };
      root.addEventListener("pdf:layerschange", listener);
      const trigger =
        action === "checkbox"
          ? controls.find(control => control.dataset.pdfLayerId === red.id)!
          : root.querySelector<HTMLButtonElement>(".pdf-layers-reset")!;
      trigger.focus();
      trigger.click();
      // Flush the first commit, then await its reentrant successor without timers.
      await Promise.resolve();
      if (!successor) throw new Error("Missing reentrant mutation");
      await successor;
      root.removeEventListener("pdf:layerschange", listener);
      const state = viewer.getLayers();
      if (!state.ok) throw new Error("Layers unavailable after mutation");
      return {
        revisions,
        revision: state.revision,
        model: groups(state.layers).map(group => [group.id, group.visible]),
        controls: controls.map(control => [control.dataset.pdfLayerId, control.checked]),
        retained: controls.every(control => root.contains(control)),
        focused: document.activeElement === trigger,
        busy: root.querySelector(".pdf-layers")!.hasAttribute("aria-busy"),
      };
    }, action);
    expect(outcome.revisions).toEqual(action === "checkbox" ? [1, 2] : [2, 3]);
    expect(outcome.revision).toBe(action === "checkbox" ? 2 : 3);
    expect(outcome.controls).toEqual(outcome.model);
    expect(outcome.retained).toBe(true);
    expect(outcome.focused).toBe(true);
    expect(outcome.busy).toBe(false);
  });
}

test("dependency registration validates atomically and rejects captured tokens after replacement", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#primary")).toHaveAttribute("data-status", "ready");
  const outcomes = await page.evaluate(async () => {
    const viewer = window.fixture.primary;
    await viewer.load("/ocg-fixture.pdf");
    const documentId = viewer.documentId!;
    const result = viewer.getLayers();
    if (!result.ok) throw new Error("Layers unavailable");
    const groups = (nodes: typeof result.layers): string[] =>
      nodes.flatMap(node => (node.kind === "group" ? [node.id] : groups(node.children)));
    const id = groups(result.layers)[0]!;
    const valid = viewer.setLayerPageDependencies([{ id, pages: [1] }], documentId);
    const zeroBased = viewer.setLayerPageDependencies([{ id, pages: [0] }], documentId);
    const duplicateId = viewer.setLayerPageDependencies(
      [
        { id, pages: [] },
        { id, pages: [1] },
      ],
      documentId,
    );
    const duplicatePage = viewer.setLayerPageDependencies([{ id, pages: [1, 1] }], documentId);
    const unknown = viewer.setLayerPageDependencies(
      [{ id: "not-an-ocg-id", pages: [1] }],
      documentId,
    );
    const clear = viewer.setLayerPageDependencies([], documentId);
    const loading = viewer.load("/ocg-fixture.pdf");
    const revokedAtAdmission = viewer.documentId;
    const staleWhileLoading = viewer.setLayerPageDependencies([], documentId);
    await loading;
    const replacementId = viewer.documentId;
    const staleAfterReady = viewer.setLayerPageDependencies([{ id, pages: [1] }], documentId);
    await viewer.close();
    return {
      valid,
      zeroBased,
      duplicateId,
      duplicatePage,
      unknown,
      clear,
      revokedAtAdmission,
      staleWhileLoading,
      replacementId,
      documentId,
      staleAfterReady,
      closedId: viewer.documentId,
    };
  });
  expect(outcomes.valid).toEqual({ ok: true });
  expect(outcomes.clear).toEqual({ ok: true });
  for (const result of [
    outcomes.zeroBased,
    outcomes.duplicateId,
    outcomes.duplicatePage,
    outcomes.unknown,
  ])
    expect(result).toEqual({ ok: false, reason: "invalid-dependencies" });
  expect(outcomes.revokedAtAdmission).toBeNull();
  expect(outcomes.closedId).toBeNull();
  expect(outcomes.replacementId).not.toBe(outcomes.documentId);
  expect(outcomes.staleWhileLoading).toEqual({ ok: false, reason: "stale-document" });
  expect(outcomes.staleAfterReady).toEqual({ ok: false, reason: "stale-document" });
});
