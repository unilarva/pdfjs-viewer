// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentLayersPresentation } from "../../src/document-layers-presentation.js";
import { DocumentLayers } from "../../src/document-layers.js";
import type { PdfjsViewerLayerMutationResult } from "../../src/viewer-contracts.js";
import { installTestPlatform } from "./test-platform.js";

class FakeElement {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  className = "";
  textContent = "";
  type = "";
  #checked = false;
  checkedWrites = 0;
  get checked(): boolean {
    return this.#checked;
  }
  set checked(value: boolean) {
    this.checkedWrites++;
    this.#checked = value;
  }
  disabled = false;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string | undefined> = {};
  readonly classList = { add: () => {}, remove: () => {} };

  constructor(readonly tagName = "DIV") {}
  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0);
    this.append(...children);
  }
  contains(candidate: unknown): boolean {
    return candidate === this || this.children.some(child => child.contains(candidate));
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
  readonly listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatchEvent(event: Event): boolean {
    if (!event.target) Object.defineProperty(event, "target", { value: this });
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    if (event.bubbles) this.parentElement?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  closest(selector: string): FakeElement | null {
    if (
      (selector === "input[data-pdf-layer-id]" && this.dataset.pdfLayerId !== undefined) ||
      (selector === ".pdf-layers-reset" && this.className === "pdf-layers-reset")
    )
      return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  focus(): void {
    (globalThis.document as unknown as { activeElement: unknown }).activeElement = this;
  }
  querySelector<T>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }
  querySelectorAll<T>(selector: string): T[] {
    const textKey = selector.match(/data-pdfjs-ui-text-content='([^']+)'/)?.[1];
    const fallback = selector === "[data-pdfjs-layer-fallback]";
    const input = selector.startsWith("input");
    const controls = selector === "input, button";
    const id = selector.match(/data-pdf-layer-id="([^']+)"/)?.[1];
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (
          (textKey && child.dataset.pdfjsUiTextContent === textKey) ||
          (fallback && child.dataset.pdfjsLayerFallback !== undefined) ||
          (input && child.tagName === "input" && (!id || child.dataset.pdfLayerId === id)) ||
          (controls && (child.tagName === "input" || child.tagName === "button"))
        )
          matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches as T[];
  }
}

function installFakeDom(): () => void {
  const platform = installTestPlatform(tagName => new FakeElement(tagName) as unknown as Element, {
    HTMLInputElement: FakeElement as unknown as typeof HTMLInputElement,
  });
  return () => platform.restore();
}

const options = {
  loadingLabel: "Loading",
  emptyLabel: "Empty",
  errorLabel: "Error",
  resetLabel: "Reset",
  fallbackLayerLabel: "Layer",
  fallbackGroupLabel: "Group",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// The real DocumentLayers owner clones this serializable PDF.js boundary.
class LayerConfiguration {
  static fromSerializable(groups: LayerConfiguration["serializable"]): LayerConfiguration {
    return new LayerConfiguration(groups);
  }
  readonly groups: Map<string, { name: string; visible: boolean }>;
  constructor(
    groups = [
      { id: "a", name: "A", visible: true },
      { id: "b", name: "B", visible: false },
      { id: "c", name: "C", visible: false },
    ],
  ) {
    this.groups = new Map(groups.map(({ id, ...group }) => [id, { ...group }]));
  }
  get serializable() {
    return [...this.groups].map(([id, group]) => ({ id, ...group }));
  }
  getOrder(): string[] {
    return [...this.groups.keys()];
  }
  getGroup(id: string) {
    return this.groups.get(id);
  }
  setVisibility(id: string, visible: boolean, preserveRB: boolean): void {
    assert.equal(preserveRB, true);
    if (visible && (id === "a" || id === "b"))
      this.groups.get(id === "a" ? "b" : "a")!.visible = false;
    this.groups.get(id)!.visible = visible;
  }
  [Symbol.iterator]() {
    return this.groups[Symbol.iterator]();
  }
}

function change(control: FakeElement, checked: boolean): void {
  control.focus();
  control.checked = checked;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

for (const action of ["checkbox", "reset"] as const) {
  test(`${action} settlement cannot roll back a reentrant actual DocumentLayers commit or radio peers`, async () => {
    const restore = installFakeDom();
    try {
      const content = new FakeElement();
      const revisions: number[] = [];
      let successor: Promise<PdfjsViewerLayerMutationResult> | undefined;
      let reenter = false;
      const owner = new DocumentLayers(true, {
        committed: state => {
          presentation.ready(state);
          revisions.push(state.revision);
          if (reenter) {
            reenter = false;
            successor = owner.setVisibility([{ id: "b", visible: true }]);
          }
        },
      });
      let operation!: Promise<PdfjsViewerLayerMutationResult>;
      const presentation = new DocumentLayersPresentation(
        { ...options, content: content as unknown as HTMLElement },
        {
          setVisibility: changes => (operation = owner.setVisibility(changes)),
          reset: () => (operation = owner.resetLayers()),
        },
      );
      await owner.beginDocument({
        getOptionalContentConfig: async () => new LayerConfiguration(),
      } as never);
      const initial = owner.getLayers();
      assert.ok(initial.ok);
      presentation.ready(initial);
      presentation.setActive(true);
      if (action === "reset") await owner.setVisibility([{ id: "c", visible: true }]);
      revisions.length = 0;
      const controls = content.querySelectorAll<FakeElement>("input");
      const tree = content.children[0];
      reenter = true;
      if (action === "checkbox") change(controls[2], true);
      else content.children[1].dispatchEvent(new Event("click", { bubbles: true }));
      await operation;
      assert.ok(successor);
      await successor;
      assert.deepEqual(revisions, action === "checkbox" ? [1, 2] : [2, 3]);
      assert.equal(owner.visibilitySnapshot()!.visibility.b, true);
      assert.deepEqual(
        controls.map(control => [control.dataset.pdfLayerId, control.checked]),
        Object.entries(owner.visibilitySnapshot()!.visibility),
      );
      assert.equal(content.children[0], tree);
      assert.equal(content.attributes.has("aria-busy"), false);
      if (action === "checkbox") assert.equal(document.activeElement as unknown, controls[2]);
    } finally {
      restore();
    }
  });
}

for (const action of ["checkbox", "reset"] as const) {
  for (const settlement of ["success", "cancelled", "error", "throw"] as const) {
    test(`${action} obsolete ${settlement} settlement cannot replace ready state or clear successor busy`, async () => {
      const restore = installFakeDom();
      try {
        const content = new FakeElement();
        const first = deferred<PdfjsViewerLayerMutationResult>();
        const second = deferred<PdfjsViewerLayerMutationResult>();
        const diagnostics: unknown[] = [];
        let calls = 0;
        const mutate = () => (++calls === 1 ? first.promise : second.promise);
        const presentation = new DocumentLayersPresentation(
          { ...options, content: content as unknown as HTMLElement },
          { setVisibility: mutate, reset: mutate, diagnostic: error => diagnostics.push(error) },
        );
        const state = {
          revision: 0,
          layers: [{ kind: "group" as const, id: "a", name: "A", visible: true }],
        };
        presentation.ready(state);
        presentation.setActive(true);
        const control = content.querySelectorAll<FakeElement>("input")[0];
        if (action === "checkbox") change(control, false);
        else content.children[1].dispatchEvent(new Event("click", { bubbles: true }));
        const newest = { ...state, revision: 2 };
        presentation.ready(newest);
        change(control, false);
        assert.equal(calls, 2);
        if (settlement === "throw") first.reject(new Error("obsolete"));
        else
          first.resolve(
            settlement === "success"
              ? { ok: true, ...state, layers: [{ ...state.layers[0], visible: false }] }
              : settlement === "cancelled"
                ? { ok: false, reason: "cancelled" }
                : { ok: false, reason: "error", error: new Error("obsolete") },
          );
        await first.promise.catch(() => {});
        assert.equal(content.attributes.has("aria-busy"), true);
        assert.equal(content.querySelectorAll<FakeElement>("input")[0], control);
        assert.deepEqual(diagnostics, []);
        second.resolve({ ok: false, reason: "cancelled" });
        await second.promise;
        assert.equal(content.attributes.has("aria-busy"), false);
        assert.equal(control.checked, true);
      } finally {
        restore();
      }
    });
  }
}

for (const action of ["checkbox", "reset"] as const) {
  test(`${action} no-op and superseded actual model requests settle without losing controls`, async () => {
    const restore = installFakeDom();
    try {
      const content = new FakeElement();
      let commits = 0;
      const owner = new DocumentLayers(true, {
        committed: state => {
          commits++;
          presentation.ready(state);
        },
      });
      let operation!: Promise<PdfjsViewerLayerMutationResult>;
      const presentation = new DocumentLayersPresentation(
        { ...options, content: content as unknown as HTMLElement },
        {
          setVisibility: changes => (operation = owner.setVisibility(changes)),
          reset: () => (operation = owner.resetLayers()),
        },
      );
      await owner.beginDocument({
        getOptionalContentConfig: async () => new LayerConfiguration(),
      } as never);
      const initial = owner.getLayers();
      assert.ok(initial.ok);
      presentation.ready(initial);
      presentation.setActive(true);
      const controls = content.querySelectorAll<FakeElement>("input");
      const invoke = () => {
        if (action === "checkbox") change(controls[0], controls[0].checked);
        else content.children[1].dispatchEvent(new Event("click", { bubbles: true }));
      };
      invoke();
      assert.equal((await operation).ok, true);
      assert.equal(commits, 0);
      assert.equal(content.attributes.has("aria-busy"), false);
      if (action === "checkbox") change(controls[0], false);
      else invoke();
      // Supersede before the queued commit; the successor is a no-op and does
      // not publish ready(), so cancellation must restore optimistic controls.
      const successor = owner.resetLayers();
      assert.deepEqual(await operation, { ok: false, reason: "cancelled" });
      await successor;
      assert.equal(controls[0].checked, true);
      assert.equal(commits, 0);
      assert.equal(content.attributes.has("aria-busy"), false);
      assert.equal(content.querySelectorAll<FakeElement>("input")[0], controls[0]);
      presentation.setActive(false);
      await owner.setVisibility([{ id: "b", visible: true }]);
      assert.equal(controls[1].checked, false);
      presentation.setActive(true);
      assert.deepEqual(
        controls.map(control => control.checked),
        [false, true, false],
      );
    } finally {
      restore();
    }
  });

  for (const transition of ["loading", "error", "reset", "destroy", "replacement"] as const) {
    test(`${action} settlement loses ownership across ${transition} including reused revision zero`, async () => {
      const restore = installFakeDom();
      try {
        const content = new FakeElement();
        const pending = deferred<PdfjsViewerLayerMutationResult>();
        const diagnostics: unknown[] = [];
        const presentation = new DocumentLayersPresentation(
          { ...options, content: content as unknown as HTMLElement },
          {
            setVisibility: () => pending.promise,
            reset: () => pending.promise,
            diagnostic: error => diagnostics.push(error),
          },
        );
        const state = {
          revision: 0,
          layers: [{ kind: "group" as const, id: "a", name: "A", visible: true }],
        };
        presentation.ready(state);
        presentation.setActive(true);
        if (action === "checkbox") change(content.querySelectorAll<FakeElement>("input")[0], false);
        else content.children[1].dispatchEvent(new Event("click", { bubbles: true }));
        if (transition === "replacement") {
          presentation.loading();
          presentation.ready({ ...state, layers: [{ ...state.layers[0], name: "Replacement" }] });
        } else presentation[transition]();
        const children = [...content.children];
        const busy = content.attributes.has("aria-busy");
        pending.resolve({ ok: true, ...state, revision: 99 });
        await pending.promise;
        assert.deepEqual(content.children, children);
        assert.equal(content.attributes.has("aria-busy"), busy);
        assert.deepEqual(diagnostics, []);
        if (transition === "replacement") {
          const control = content.querySelectorAll<FakeElement>("input")[0];
          assert.equal(control.checked, true);
          assert.equal(control.parentElement!.children[1].textContent, "Replacement");
        }
      } finally {
        restore();
      }
    });
  }
}

test("UI text refreshes package layer status, reset, and fallbacks without touching controls or host markup", () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    const presentation = new DocumentLayersPresentation(
      {
        content: content as unknown as HTMLElement,
        loadingLabel: "Loading layers",
        emptyLabel: "No layers",
        errorLabel: "Layers failed",
        resetLabel: "Reset layers",
        fallbackLayerLabel: "Layer",
        fallbackGroupLabel: "Group",
      },
      {
        setVisibility: async () => ({ ok: true, revision: 1, layers: [] }),
        reset: async () => ({ ok: true, revision: 1, layers: [] }),
      },
    );
    presentation.setActive(true);
    presentation.ready({
      revision: 0,
      layers: [
        { kind: "group", id: "unnamed", name: "", visible: true },
        { kind: "group", id: "named", name: "PDF layer", visible: false },
      ],
    });
    const checkbox = content.querySelector<FakeElement>('input[data-pdf-layer-id="unnamed"]')!;
    const named = content.children[0]!.children[1]!.children[1]!;
    const reset = content.querySelectorAll<FakeElement>(
      "[data-pdfjs-ui-text-content='resetLayers']",
    )[0]!;
    const hostDecoy = new FakeElement();
    hostDecoy.textContent = "Host layer text";
    content.append(hostDecoy);
    checkbox.focus();
    presentation.setUiText({
      loadingLabel: "Loading now",
      emptyLabel: "None now",
      errorLabel: "Failed now",
      resetLabel: "Reset now",
      fallbackLayerLabel: "Layer now",
      fallbackGroupLabel: "Group now",
    });
    assert.equal(
      content.querySelectorAll<FakeElement>("[data-pdfjs-layer-fallback]")[0]!.textContent,
      "Layer now 1",
    );
    assert.equal(reset.textContent, "Reset now");
    assert.equal(named.textContent, "PDF layer");
    assert.equal(checkbox.checked, true);
    assert.equal(
      (globalThis.document as unknown as { activeElement: unknown }).activeElement,
      checkbox,
    );
    assert.equal(hostDecoy.textContent, "Host layer text");

    presentation.error();
    const status = content.children[0]!;
    content.append(hostDecoy);
    presentation.setUiText({
      loadingLabel: "Loading later",
      emptyLabel: "None later",
      errorLabel: "Failed later",
      resetLabel: "Reset later",
      fallbackLayerLabel: "Layer later",
      fallbackGroupLabel: "Group later",
    });
    assert.equal(status.textContent, "Failed later");
    assert.equal(hostDecoy.textContent, "Host layer text");
  } finally {
    restore();
  }
});

test("large layer panels build lazily and retain controls and focus through deferred changes", () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    const diagnostics: unknown[] = [];
    const presentation = new DocumentLayersPresentation(
      {
        content: content as unknown as HTMLElement,
        loadingLabel: "Loading",
        emptyLabel: "Empty",
        errorLabel: "Error",
        resetLabel: "Reset",
        fallbackLayerLabel: "Layer",
        fallbackGroupLabel: "Group",
      },
      {
        setVisibility: async () => ({ ok: true, revision: 0, layers: [] }),
        reset: async () => ({ ok: true, revision: 0, layers: [] }),
        measurement: entry => diagnostics.push(entry),
      },
    );
    const layers = Array.from({ length: 2000 }, (_, index) =>
      Object.freeze({
        kind: "group" as const,
        id: `layer-${index}`,
        name: `Layer ${index}`,
        visible: true as boolean,
      }),
    );
    presentation.loading();
    presentation.ready({ revision: 0, layers });
    assert.equal(content.children.length, 0);
    assert.equal(diagnostics.length, 0);
    presentation.setActive(true);
    const tree = content.children[0];
    const reset = content.children[1];
    const controls = content.querySelectorAll<FakeElement>("input");
    assert.equal(controls.length, 2000);
    controls[10].focus();
    const changed = [...layers];
    changed[10] = { ...changed[10], visible: false };
    presentation.ready({ revision: 1, layers: changed });
    assert.equal(content.children[0], tree);
    assert.equal(content.children[1], reset);
    assert.equal(controls[10].checked, false);
    assert.equal(controls[10].checkedWrites, 2);
    assert.equal(controls[11].checkedWrites, 1);
    assert.equal(globalThis.document.activeElement as unknown, controls[10]);
    presentation.setActive(false);
    const deferred = [...changed];
    deferred[11] = { ...deferred[11], visible: false };
    const count = diagnostics.length;
    presentation.ready({ revision: 2, layers: deferred });
    assert.equal(controls[11].checked, true);
    assert.equal(diagnostics.length, count);
    presentation.setUiText({
      loadingLabel: "Loading new",
      emptyLabel: "Empty new",
      errorLabel: "Error new",
      resetLabel: "Reset new",
      fallbackLayerLabel: "Layer",
      fallbackGroupLabel: "Group",
    });
    assert.equal(reset.textContent, "Reset");
    presentation.setActive(true);
    assert.equal(controls[11].checked, false);
    assert.equal(controls[11].checkedWrites, 2);
    assert.equal(controls[10].checkedWrites, 2);
    assert.equal(reset.textContent, "Reset new");
    assert.equal(content.children[0], tree);
    assert.equal(content.querySelectorAll<FakeElement>("input")[10], controls[10]);
    assert.equal(globalThis.document.activeElement as unknown, controls[10]);
    assert.equal(
      (diagnostics[1] as { details: { createdControls: number } }).details.createdControls,
      0,
    );
    assert.equal(
      (diagnostics[1] as { details: { updatedControls: number } }).details.updatedControls,
      1,
    );
    presentation.reset();
    presentation.ready({ revision: 0, layers: [] });
    assert.equal(content.children[0].textContent, "Empty new");
    presentation.destroy();
  } finally {
    restore();
  }
});

test("headless layers and closed error/loading state remain lazy", () => {
  const restore = installFakeDom();
  try {
    const options = {
      loadingLabel: "Loading",
      emptyLabel: "Empty",
      errorLabel: "Error",
      resetLabel: "Reset",
      fallbackLayerLabel: "Layer",
      fallbackGroupLabel: "Group",
    };
    const callbacks = {
      setVisibility: async () => ({ ok: true as const, revision: 0, layers: [] }),
      reset: async () => ({ ok: true as const, revision: 0, layers: [] }),
    };
    const content = new FakeElement();
    const owner = new DocumentLayersPresentation(
      { ...options, content: content as unknown as HTMLElement },
      callbacks,
    );
    owner.loading();
    owner.error();
    assert.equal(content.children.length, 0);
    owner.setActive(true);
    assert.equal(content.children[0].textContent, "Error");
    owner.setActive(false);
    owner.loading();
    assert.equal(content.children[0].textContent, "Error");
    owner.setActive(true);
    assert.equal(content.children[0].textContent, "Loading");
    const headless = new DocumentLayersPresentation({ ...options, content: null }, callbacks);
    headless.loading();
    headless.setActive(true);
    headless.ready({ revision: 0, layers: [] });
    headless.destroy();
  } finally {
    restore();
  }
});
