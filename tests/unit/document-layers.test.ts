// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentLayers } from "../../src/document-layers.js";

type GroupData = { id: string; name?: string; visible: boolean; rbGroups?: string[][] };

class FakeOptionalContentConfig {
  static fromSerializable(
    serializable: ReturnType<FakeOptionalContentConfig["snapshot"]>,
  ): FakeOptionalContentConfig {
    return new FakeOptionalContentConfig(serializable.groups, serializable.order);
  }

  readonly #groups: Map<string, GroupData>;
  readonly #order: unknown[];

  constructor(groups: readonly GroupData[], order: unknown[]) {
    this.#groups = new Map(
      groups.map(group => [
        group.id,
        {
          ...group,
          rbGroups: group.rbGroups?.map(ids => [...ids]) ?? [],
        },
      ]),
    );
    this.#order = structuredClone(order);
  }

  get serializable(): ReturnType<FakeOptionalContentConfig["snapshot"]> {
    return this.snapshot();
  }
  getOrder(): unknown[] {
    return structuredClone(this.#order);
  }
  getGroup(id: string): GroupData | null {
    return this.#groups.get(id) ?? null;
  }
  setVisibility(id: string, visible: boolean, preserveRB = true): void {
    const group = this.#groups.get(id);
    if (!group) return;
    if (visible && preserveRB) {
      for (const ids of group.rbGroups ?? []) {
        for (const other of ids) if (other !== id) this.#groups.get(other)!.visible = false;
      }
    }
    group.visible = visible;
  }
  *[Symbol.iterator](): IterableIterator<[string, GroupData]> {
    yield* this.#groups;
  }
  snapshot() {
    return {
      groups: [...this.#groups.values()].map(group => ({
        ...group,
        rbGroups: group.rbGroups?.map(ids => [...ids]),
      })),
      order: structuredClone(this.#order),
    };
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function pdf(configuration: FakeOptionalContentConfig | Promise<FakeOptionalContentConfig>) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getOptionalContentConfig: async ({ intent }: { intent: string }) => {
      calls++;
      assert.equal(intent, "display");
      return configuration;
    },
  };
}

function configuration() {
  const radio = [["radio-a", "radio-b"]];
  return new FakeOptionalContentConfig(
    [
      { id: "named", name: "Named", visible: true },
      { id: "unnamed", name: " ", visible: false },
      { id: "radio-a", name: "Radio A", visible: true, rbGroups: radio },
      { id: "radio-b", name: "Radio B", visible: false, rbGroups: radio },
    ],
    [{ name: "", order: ["named", { name: "Nested", order: ["unnamed"] }] }, "radio-a", "radio-b"],
  );
}

test("publishes a detached normalized tree and never mutates a published configuration", async () => {
  const commits: Array<{ revision: number; config: FakeOptionalContentConfig }> = [];
  const owner = new DocumentLayers(true, {
    committed: (state, render) => {
      void render.configurationPromise.then(config =>
        commits.push({
          revision: state.revision,
          config: config as unknown as FakeOptionalContentConfig,
        }),
      );
    },
  });
  const source = configuration();
  const render0 = await owner.beginDocument(pdf(source) as never);
  assert.ok(render0);
  const initialConfiguration = await render0.configurationPromise;
  assert.notEqual(initialConfiguration, source);
  const initial = owner.getLayers();
  assert.equal(initial.ok, true);
  if (!initial.ok) return;
  assert.deepEqual(initial.layers, [
    {
      kind: "label",
      name: "Group 1",
      children: [
        { kind: "group", id: "named", name: "Named", visible: true },
        {
          kind: "label",
          name: "Nested",
          children: [{ kind: "group", id: "unnamed", name: "Layer 1", visible: false }],
        },
      ],
    },
    { kind: "group", id: "radio-a", name: "Radio A", visible: true },
    { kind: "group", id: "radio-b", name: "Radio B", visible: false },
  ]);
  assert.ok(Object.isFrozen(initial.layers));
  assert.ok(Object.isFrozen(initial.layers[0]));

  const changed = await owner.setVisibility([{ id: "named", visible: false }]);
  assert.equal(changed.ok, true);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].revision, 1);
  assert.notEqual(commits[0].config, initialConfiguration);
  assert.equal(
    (initialConfiguration as unknown as FakeOptionalContentConfig).getGroup("named")!.visible,
    true,
  );
  assert.equal(commits[0].config.getGroup("named")!.visible, false);
  assert.equal(await owner.renderState()!.configurationPromise, commits[0].config);
});

test("rejects unknown IDs atomically and preserves PDF.js radio groups", async () => {
  const owner = new DocumentLayers(true);
  await owner.beginDocument(pdf(configuration()) as never);
  const unknown = await owner.setVisibility([
    { id: "named", visible: false },
    { id: "missing", visible: true },
  ]);
  assert.deepEqual(unknown, { ok: false, reason: "unknown-layer", ids: ["missing"] });
  assert.equal((owner.getLayers() as { layers: readonly unknown[] }).layers[0] != null, true);
  assert.equal(owner.visibilitySnapshot()!.visibility.named, true);

  await owner.setVisibility([{ id: "radio-b", visible: true }]);
  assert.deepEqual(owner.visibilitySnapshot()!.visibility, {
    named: true,
    unnamed: false,
    "radio-a": false,
    "radio-b": true,
  });
});

test("coalesces overlapping mutations as latest-wins without dropping staged choices", async () => {
  const revisions: number[] = [];
  const owner = new DocumentLayers(true, { committed: state => revisions.push(state.revision) });
  await owner.beginDocument(pdf(configuration()) as never);
  const first = owner.setVisibility([{ id: "named", visible: false }]);
  const second = owner.setVisibility([{ id: "unnamed", visible: true }]);
  assert.deepEqual(await first, { ok: false, reason: "cancelled" });
  const result = await second;
  assert.equal(result.ok, true);
  assert.deepEqual(owner.visibilitySnapshot()!.visibility, {
    named: false,
    unnamed: true,
    "radio-a": true,
    "radio-b": false,
  });
  assert.deepEqual(revisions, [1]);
});

test("reset restores loaded defaults with a fresh revision and replacement revokes stale work", async () => {
  const owner = new DocumentLayers(true);
  await owner.beginDocument(pdf(configuration()) as never);
  await owner.setVisibility([{ id: "named", visible: false }]);
  const changed = await owner.renderState()!.configurationPromise;
  const reset = await owner.resetLayers();
  assert.equal(reset.ok, true);
  assert.equal(reset.ok && reset.revision, 2);
  assert.notEqual(await owner.renderState()!.configurationPromise, changed);
  assert.equal(owner.visibilitySnapshot()!.visibility.named, true);

  const staged = owner.setVisibility([{ id: "named", visible: false }]);
  owner.resetDocument();
  assert.deepEqual(await staged, { ok: false, reason: "cancelled" });
  assert.deepEqual(owner.getLayers(), { ok: false, reason: "not-ready" });

  const acquisition = deferred<FakeOptionalContentConfig>();
  const oldPdf = pdf(acquisition.promise);
  const stale = owner.beginDocument(oldPdf as never);
  const replacement = owner.beginDocument(pdf(configuration()) as never);
  acquisition.resolve(configuration());
  assert.equal(await stale, null);
  assert.ok(await replacement);
});

test("disabled mode avoids OCG acquisition and no-layer documents become ready", async () => {
  const source = pdf(configuration());
  const disabled = new DocumentLayers(false);
  assert.equal(await disabled.beginDocument(source as never), null);
  assert.equal(source.calls, 0);
  assert.deepEqual(disabled.getLayers(), { ok: false, reason: "disabled" });

  const empty = new DocumentLayers(true);
  const ready = await empty.beginDocument(pdf(new FakeOptionalContentConfig([], [])) as never);
  assert.ok(ready);
  assert.equal(empty.hasLayers, false);
  assert.deepEqual(empty.getLayers(), { ok: true, revision: 0, layers: [] });
  empty.destroy();
  assert.deepEqual(empty.getLayers(), { ok: false, reason: "destroyed" });
});

test("malformed OCG acquisition fails soft with stable error APIs", async () => {
  const error = new Error("malformed OCG");
  const diagnostics: string[] = [];
  const owner = new DocumentLayers(true, { diagnostic: entry => diagnostics.push(entry.event) });
  const result = await owner.beginDocument({
    getOptionalContentConfig: async () => {
      throw error;
    },
  } as never);
  assert.equal(result, null);
  assert.deepEqual(owner.getLayers(), { ok: false, reason: "error", error });
  assert.deepEqual(await owner.setVisibility([]), { ok: false, reason: "error", error });
  assert.deepEqual(await owner.resetLayers(), { ok: false, reason: "error", error });
  assert.equal(owner.visibilitySnapshot(), null);
  assert.deepEqual(diagnostics, ["layers-acquisition-started", "layers-acquisition-failed"]);
});

test("each document lifetime advances identity exactly once", async () => {
  const owner = new DocumentLayers(true);
  const first = await owner.beginDocument(pdf(configuration()) as never);
  const second = await owner.beginDocument(pdf(configuration()) as never);
  assert.ok(first && second);
  assert.equal(second.documentId, first.documentId + 1);
});
