// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentFormState, type DocumentFormFieldObject } from "../../src/document-form-state.js";

class FakeStorage {
  onSetModified: (() => void) | null = null;
  onResetModified: (() => void) | null = null;
  readonly values = new Map<string, Record<string, unknown>>();
  notifyEveryWrite = true;
  getValue(id: string, fallback: Record<string, unknown>): Record<string, unknown> {
    return Object.assign(fallback, this.values.get(id));
  }
  getRawValue(id: string): Record<string, unknown> | undefined {
    return this.values.get(id);
  }
  has(id: string): boolean {
    return this.values.has(id);
  }
  remove(id: string): void {
    this.values.delete(id);
  }
  setValue(id: string, value: Record<string, unknown>): void {
    this.values.set(id, { ...this.values.get(id), ...value });
    if (this.notifyEveryWrite) this.onSetModified?.();
  }
  get print(): object {
    return Object.freeze({ values: [...this.values] });
  }
  get size(): number {
    return this.values.size;
  }
  get serializable(): object {
    return {};
  }
  get editorStats(): object {
    return {};
  }
  get modifiedIds(): object {
    return { ids: new Set<string>(), hash: "" };
  }
  onAnnotationEditor: (() => void) | null = null;
  resetModified(): void {}
  resetModifiedIds(): void {}
  updateEditor(): boolean {
    return false;
  }
  getEditor(): undefined {
    return undefined;
  }
  [Symbol.iterator](): MapIterator<[string, Record<string, unknown>]> {
    return this.values[Symbol.iterator]();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function pdf(
  storage: FakeStorage,
  saveDocument: () => Promise<Uint8Array> = async () => new Uint8Array([1]),
) {
  return {
    annotationStorage: storage,
    isPureXfa: false,
    getMetadata: async () => ({ info: { IsAcroFormPresent: true }, metadata: null }),
    getFieldObjects: async () =>
      new Map([
        [
          "repeated",
          [
            {
              id: "shared",
              page: 0,
              type: "text",
              value: "Loaded visible",
              defaultValue: "PDF default",
            },
            {
              id: "shared",
              page: 2,
              type: "text",
              value: "Loaded visible",
              defaultValue: "PDF default",
            },
          ],
        ],
        [
          "checkbox",
          [
            {
              id: "check",
              page: 1,
              type: "checkbox",
              value: "Yes",
              defaultValue: "Off",
              exportValues: ["Yes"],
            },
          ],
        ],
      ]),
    saveDocument,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy;
}

test("loaded field.value, not /DV, defines clean state and reset across every binding page", async () => {
  const storage = new FakeStorage();
  const dirty: boolean[] = [];
  const changedPages: number[][] = [];
  const state = new DocumentFormState(
    { interactive: true, xfa: false },
    {
      dirtyChanged: value => dirty.push(value),
      appearanceChanged: pages => changedPages.push([...pages]),
    },
  );
  await state.beginDocument(pdf(storage));

  assert.equal(state.dirty, false, "/V != /DV must open clean");
  assert.deepEqual(
    state.bindings.map(binding => [binding.id, binding.pageNo]),
    [
      ["shared", 1],
      ["check", 2],
      ["shared", 3],
    ],
  );

  const adapter = state.createStorageAdapter("viewer-")!;
  adapter.setValue("viewer-shared", { value: "Edited" });
  assert.equal(state.dirty, true);
  assert.equal(state.revision, 1);
  await Promise.resolve();
  assert.deepEqual(changedPages, [[1, 3]], "one input turn coalesces all repeated-widget pages");
  assert.equal(state.appearanceRevision(1), 1);
  assert.equal(state.appearanceRevision(3), 1);

  storage.notifyEveryWrite = false;
  adapter.setValue("viewer-shared", { value: "Edited again" });
  assert.equal(
    state.revision,
    2,
    "translated writes are observed after AnnotationStorage is already modified",
  );
  await Promise.resolve();
  assert.deepEqual(changedPages, [
    [1, 3],
    [1, 3],
  ]);

  assert.equal(state.resetForms(), true);
  assert.deepEqual(storage.values.get("shared"), { value: "Loaded visible" });
  assert.deepEqual(storage.values.get("check"), { value: true });
  assert.equal(state.dirty, false);
  assert.deepEqual(dirty, [true, false]);
});

test("export joins an equal revision, queues the latest revision, and detaches bytes per caller", async () => {
  const storage = new FakeStorage();
  const first = deferred<Uint8Array>();
  const second = deferred<Uint8Array>();
  let saves = 0;
  const state = new DocumentFormState({ interactive: true, xfa: false });
  await state.beginDocument(pdf(storage, () => (++saves === 1 ? first.promise : second.promise)));
  const adapter = state.createStorageAdapter("viewer-")!;
  adapter.setValue("viewer-shared", { value: "first edit" });

  const firstCaller = state.exportDocumentWithFormValues();
  const equalRevisionCaller = state.exportDocumentWithFormValues();
  assert.equal(saves, 1);
  adapter.setValue("viewer-shared", { value: "newer edit" });
  const newerCaller = state.exportDocumentWithFormValues();
  assert.equal(saves, 1, "PDF.js save is uncancellable");

  first.resolve(new Uint8Array([1, 2]));
  const [firstBytes, equalBytes] = await Promise.all([firstCaller, equalRevisionCaller]);
  assert.deepEqual(firstBytes, new Uint8Array([1, 2]));
  assert.deepEqual(equalBytes, new Uint8Array([1, 2]));
  assert.notEqual(firstBytes, equalBytes);
  assert.equal(saves, 2, "latest revision starts after active save settles");

  second.resolve(new Uint8Array([3, 4]));
  const newerBytes = await newerCaller;
  assert.deepEqual(newerBytes, new Uint8Array([3, 4]));
  assert.notEqual(newerBytes, second.promise);
});

test("field-object failure degrades forms without rejecting document preparation", async () => {
  const storage = new FakeStorage();
  const diagnostics: string[] = [];
  const state = new DocumentFormState(
    { interactive: true, xfa: false },
    {
      diagnostic: event => diagnostics.push(event),
    },
  );
  await state.beginDocument({
    annotationStorage: storage,
    isPureXfa: false,
    getFieldObjects: async () => {
      throw new Error("malformed forms");
    },
    getMetadata: async () => null,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy);
  assert.equal(state.available, false);
  assert.equal(state.resetForms(), false);
  assert.equal(await state.exportDocumentWithFormValues(), null);
  assert.deepEqual(diagnostics, ["form-field-index-unavailable"]);
});

test("throwing and incompatible optional storage degrade locally without rejecting preparation", async () => {
  for (const annotationStorage of [
    () => {
      throw new Error("storage construction failed");
    },
    () => ({ getValue() {} }),
  ]) {
    const diagnostics: Array<{ event: string; error: unknown }> = [];
    const state = new DocumentFormState(
      { interactive: true, xfa: false },
      {
        diagnostic: (event, error) => diagnostics.push({ event, error }),
      },
    );
    const candidate = {
      isPureXfa: false,
      getFieldObjects: async () =>
        new Map([["text", [{ id: "field", page: 0, type: "text", value: "Loaded" }]]]),
      getMetadata: async () => null,
    } as Record<string, unknown>;
    Object.defineProperty(candidate, "annotationStorage", { get: annotationStorage });

    await state.beginDocument(candidate as unknown as import("pdfjs-dist").PDFDocumentProxy);
    assert.equal(state.presentation, "acroform");
    assert.equal(state.available, false);
    assert.equal(state.createStorageAdapter("viewer-"), null);
    assert.deepEqual(
      diagnostics.map(entry => entry.event),
      ["form-storage-unavailable"],
    );
  }
});

test("publication callback failures settle inside preparation and become diagnostics", async () => {
  const storage = new FakeStorage();
  const failure = new Error("state publication failed");
  const diagnostics: Array<{ event: string; error: unknown }> = [];
  const state = new DocumentFormState(
    { interactive: true, xfa: false },
    {
      stateChanged: () => {
        throw failure;
      },
      diagnostic: (event, error) => diagnostics.push({ event, error }),
    },
  );

  await state.beginDocument(pdf(storage));
  assert.equal(state.available, true);
  assert.deepEqual(diagnostics, [{ event: "form-state-publication-failed", error: failure }]);
  assert.deepEqual(
    state.reset(),
    [],
    "settled publication continuations must not remain teardown work",
  );
});

test("pending optional reads keep form APIs stable and remain teardown settlements", async () => {
  const storage = new FakeStorage();
  const fields = deferred<Map<string, DocumentFormFieldObject[]> | null>();
  const state = new DocumentFormState({ interactive: true, xfa: false });
  const preparation = state.beginDocument({
    annotationStorage: storage,
    isPureXfa: false,
    getFieldObjects: () => fields.promise,
    getMetadata: async () => null,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy);

  assert.equal(state.available, false);
  assert.equal(state.resetForms(), false);
  assert.equal(await state.exportDocumentWithFormValues(), null);
  const settlements = state.reset();
  assert.deepEqual(settlements, [preparation]);
  let settled = false;
  void Promise.allSettled(settlements).then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  fields.resolve(null);
  await Promise.allSettled(settlements);
  assert.equal(settled, true);
});

test("replacement waits for old publication continuations without publishing stale state", async () => {
  const oldFields = deferred<Map<string, DocumentFormFieldObject[]> | null>();
  const published: string[] = [];
  const state = new DocumentFormState(
    { interactive: true, xfa: false },
    {
      stateChanged: () => published.push(state.accessibleName("new") ?? "stale"),
    },
  );
  const oldPreparation = state.beginDocument({
    annotationStorage: new FakeStorage(),
    isPureXfa: false,
    getFieldObjects: () => oldFields.promise,
    getMetadata: async () => null,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy);
  const oldSettlements = state.reset();
  assert.deepEqual(oldSettlements, [oldPreparation]);

  await state.beginDocument({
    annotationStorage: new FakeStorage(),
    isPureXfa: false,
    getFieldObjects: async () =>
      new Map([["current", [{ id: "new", page: 0, type: "text", value: "Current", name: "New" }]]]),
    getMetadata: async () => null,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy);
  oldFields.resolve(new Map([["old", [{ id: "old", page: 0, type: "text", value: "Old" }]]]));
  await Promise.allSettled(oldSettlements);

  assert.equal(state.hasField("old"), false);
  assert.equal(state.hasField("new"), true);
  assert.ok(published.length > 0);
  assert.equal(published.includes("stale"), false);
});

test("an old appearance microtask cannot consume replacement notifications", async () => {
  const changedPages: number[][] = [];
  const state = new DocumentFormState(
    { interactive: true, xfa: false },
    {
      appearanceChanged: pages => changedPages.push([...pages]),
    },
  );
  const oldStorage = new FakeStorage();
  await state.beginDocument(pdf(oldStorage));
  state.createStorageAdapter("old-")!.setValue("old-shared", { value: "Old edit" });

  const replacementStorage = new FakeStorage();
  await state.beginDocument(pdf(replacementStorage));
  state.createStorageAdapter("new-")!.setValue("new-check", { value: false });
  await Promise.resolve();

  assert.deepEqual(changedPages, [[2]]);
  assert.equal(state.appearanceRevision(1), 0);
  assert.equal(state.appearanceRevision(2), 1);
  assert.equal(state.appearanceRevision(3), 0);
});

test("field availability publishes without waiting for a pending metadata sibling", async () => {
  const storage = new FakeStorage();
  const metadata = deferred<null>();
  const state = new DocumentFormState({ interactive: true, xfa: true });
  const preparation = state.beginDocument({
    annotationStorage: storage,
    isPureXfa: false,
    getFieldObjects: async () =>
      new Map([["text", [{ id: "field", page: 0, type: "text", value: "Loaded" }]]]),
    getMetadata: () => metadata.promise,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state.available, true);
  assert.equal(state.presentation, "acroform");
  const settlements = state.reset();
  assert.deepEqual(settlements, [preparation]);
  metadata.resolve(null);
  await Promise.allSettled(settlements);
});

test("the version-pinned storage adapter degrades if an admitted capability disappears", async () => {
  const storage = new FakeStorage();
  const diagnostics: string[] = [];
  const state = new DocumentFormState(
    { interactive: true, xfa: false },
    {
      diagnostic: event => diagnostics.push(event),
    },
  );
  await state.beginDocument(pdf(storage));
  Object.defineProperty(storage, "updateEditor", { configurable: true, value: undefined });
  assert.equal(state.createStorageAdapter("viewer-"), null);
  assert.equal(state.available, false);
  assert.deepEqual(diagnostics, ["form-storage-unavailable"]);
});
