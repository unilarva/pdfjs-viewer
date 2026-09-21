// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentOutlinePresentation } from "../../src/document-outline-presentation.js";
import type {
  DocumentOutlineEntry,
  DocumentOutlinePreparationOutcome,
} from "../../src/document-navigation.js";
import { installTestPlatform } from "./test-platform.js";

class FakeClassList {
  readonly #values = new Set<string>();
  constructor(private readonly owner: FakeElement) {}
  toggle(name: string, force?: boolean): void {
    if (force) this.#values.add(name);
    else this.#values.delete(name);
    this.owner.className = [...this.#values].join(" ");
  }
}

class FakeElement {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  className = "";
  textContent = "";
  value = "";
  placeholder = "";
  type = "";
  id = "";
  autocomplete = "";
  isConnected = true;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string | undefined> = {};
  readonly style: Record<string, string> = {};
  readonly classList = new FakeClassList(this);

  constructor(readonly tagName = "DIV") {}
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.parentElement = this;
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0);
    this.append(...children);
  }
  before(element: FakeElement): void {
    this.parentElement?.insertBefore(element, this);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  getAnimations(): Animation[] {
    return [];
  }
  focus(): void {
    (globalThis.document as unknown as { activeElement: unknown }).activeElement = this;
  }
  blur(): void {}
  querySelector<T>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }
  querySelectorAll<T>(selector: string): T[] {
    const key = selector.match(/data-pdfjs-ui-text-content='([^']+)'/)?.[1];
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (
          (key && child.dataset.pdfjsUiTextContent === key) ||
          (className && child.className.split(/\s+/).includes(className))
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
  const platform = installTestPlatform(
    tagName => new FakeElement(tagName.toUpperCase()) as unknown as Element,
    {
      AbortController: globalThis.AbortController,
    },
  );
  return () => platform.restore();
}

const ready = Object.freeze({
  status: "ready",
  itemCount: 0,
  items: [],
}) as DocumentOutlinePreparationOutcome;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function owner(
  callbacks: Partial<ConstructorParameters<typeof DocumentOutlinePresentation>[2]> = {},
) {
  return new DocumentOutlinePresentation(
    { sidebar: null, content: null, filter: null, filterInput: null },
    {
      filterEnabled: false,
      filterLabel: "Filter",
      untitledLabel: "(Untitled)",
      noOutlineLabel: "Empty",
      preparationLabel: "Preparing",
      preparationErrorLabel: "Failed",
      filterOptions: { caseSensitive: false, diacritics: "smart" },
      viewerId: "test-viewer",
    },
    {
      select() {},
      preparationStateChanged() {},
      preparationCompleted() {},
      isOpen: () => false,
      isOverlay: () => false,
      hasTouch: () => false,
      scrollBehavior: () => "auto",
      ...callbacks,
    },
  );
}

test("joins one preparation handoff and publishes its current outcome once", async () => {
  const work = deferred<DocumentOutlinePreparationOutcome>();
  const states: string[] = [];
  const completed: DocumentOutlinePreparationOutcome[] = [];
  const presentation = owner({
    preparationStateChanged: state => states.push(state),
    preparationCompleted: outcome => completed.push(outcome),
  });
  let starts = 0;
  const first = presentation.prepare(() => {
    starts++;
    return work.promise;
  });
  const second = presentation.prepare(() => {
    starts++;
    return Promise.resolve(ready);
  });
  assert.equal(first, second);
  assert.equal(starts, 1);
  work.resolve(ready);
  await first;
  await Promise.resolve();
  assert.deepEqual(states, ["loading", "ready"]);
  assert.deepEqual(completed, [ready]);
});

test("reset rejects stale completion and permits a successor preparation", async () => {
  const stale = deferred<DocumentOutlinePreparationOutcome>();
  const completed: DocumentOutlinePreparationOutcome[] = [];
  const presentation = owner({ preparationCompleted: outcome => completed.push(outcome) });
  const first = presentation.prepare(() => stale.promise);
  presentation.reset();
  const second = presentation.prepare(() => Promise.resolve(ready));
  stale.resolve(ready);
  await Promise.all([first, second]);
  await Promise.resolve();
  assert.deepEqual(completed, [ready]);
});

test("reentrant loading callback cannot restore invalidated preparation ownership", async () => {
  let presentation!: DocumentOutlinePresentation;
  presentation = owner({
    preparationStateChanged: state => {
      if (state === "loading") presentation.reset();
    },
  });
  await presentation.prepare(() => Promise.resolve(ready));
  assert.equal(presentation.preparation, null);
});

test("reentrant ready-state callback cannot publish stale outline completion", async () => {
  let presentation!: DocumentOutlinePresentation;
  let completions = 0;
  presentation = owner({
    preparationStateChanged: state => {
      if (state === "ready") presentation.reset();
    },
    preparationCompleted: () => {
      completions++;
    },
  });
  await presentation.prepare(() => Promise.resolve(ready));
  await Promise.resolve();
  assert.equal(presentation.preparation, null);
  assert.equal(completions, 0);
});

test("UI text refreshes package outline filter, fallback, and status without touching host controls", async () => {
  const restore = installFakeDom();
  try {
    const sidebar = new FakeElement();
    const content = new FakeElement();
    content.setAttribute("aria-label", "Outline");
    sidebar.append(content);
    const hostFilter = new FakeElement();
    hostFilter.textContent = "Host filter";
    const hostInput = new FakeElement("INPUT");
    hostInput.value = "host query";
    hostFilter.append(hostInput);
    const presentation = new DocumentOutlinePresentation(
      {
        sidebar: sidebar as unknown as HTMLElement,
        content: content as unknown as HTMLElement,
        filter: null,
        filterInput: null,
      },
      {
        filterEnabled: true,
        filterLabel: "Filter",
        untitledLabel: "(Untitled)",
        noOutlineLabel: "Empty",
        preparationLabel: "Preparing",
        preparationErrorLabel: "Failed",
        filterOptions: { caseSensitive: false, diacritics: "smart" },
        viewerId: "test-viewer",
      },
      {
        select() {},
        preparationStateChanged() {},
        preparationCompleted() {},
        isOpen: () => false,
        isOverlay: () => false,
        hasTouch: () => false,
        scrollBehavior: () => "auto",
      },
    );
    presentation.open();
    const packageInput = sidebar.querySelector<FakeElement>(".pdf-outline-filter-input")!;
    await presentation.prepare(async () => ({ status: "ready", itemCount: 0, items: [] }));
    await Promise.resolve();
    const hostDecoy = new FakeElement();
    hostDecoy.textContent = "Host outline text";
    content.append(hostDecoy);
    hostInput.focus();
    presentation.setUiText({
      filterLabel: "Filter now",
      untitledLabel: "(Untitled now)",
      noOutlineLabel: "Empty now",
      preparationLabel: "Preparing now",
      preparationErrorLabel: "Failed now",
    });
    assert.equal(packageInput.placeholder, "Filter now");
    assert.equal(packageInput.attributes.get("aria-label"), "Filter now");
    assert.equal(content.children[0]?.textContent, "Empty now");
    assert.equal(hostFilter.textContent, "Host filter");
    assert.equal(hostInput.value, "host query");
    assert.equal(
      (globalThis.document as unknown as { activeElement: unknown }).activeElement,
      hostInput,
    );
    assert.equal(hostDecoy.textContent, "Host outline text");

    presentation.reset();
    await presentation.prepare(async () => ({
      status: "error",
      itemCount: 0,
      items: [],
      error: new Error("failed"),
    }));
    await Promise.resolve();
    presentation.setUiText({
      filterLabel: "Filter later",
      untitledLabel: "(Untitled later)",
      noOutlineLabel: "Empty later",
      preparationLabel: "Preparing later",
      preparationErrorLabel: "Failed later",
    });
    assert.equal(content.children[0]?.textContent, "Failed later");
  } finally {
    restore();
  }
});

test("renders a complete 20,000-depth outline before publishing completion", async () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    let completedItems = 0;
    const presentation = new DocumentOutlinePresentation(
      {
        sidebar: null,
        content: content as unknown as HTMLElement,
        filter: null,
        filterInput: null,
      },
      {
        filterEnabled: false,
        filterLabel: "Filter",
        untitledLabel: "(Untitled)",
        noOutlineLabel: "Empty",
        preparationLabel: "Preparing",
        preparationErrorLabel: "Failed",
        filterOptions: { caseSensitive: false, diacritics: "smart" },
        viewerId: "test-viewer",
      },
      {
        select() {},
        preparationStateChanged() {},
        preparationCompleted() {
          const elements = [...content.children];
          while (elements.length) {
            const element = elements.pop()!;
            if (element.tagName === "LI") completedItems++;
            elements.push(...element.children);
          }
        },
        isOpen: () => false,
        isOverlay: () => false,
        hasTouch: () => false,
        scrollBehavior: () => "auto",
      },
    );
    let entry: DocumentOutlineEntry = Object.freeze({
      key: "19999",
      title: "19999",
      destinationStatus: "none" as const,
      destination: null,
      children: Object.freeze([]),
    });
    for (let index = 19_998; index >= 0; index--)
      entry = Object.freeze({
        key: String(index),
        title: String(index),
        destinationStatus: "none" as const,
        destination: null,
        children: Object.freeze([entry]),
      });
    await presentation.prepare(async () => ({
      status: "ready",
      itemCount: 20_000,
      items: Object.freeze([entry]),
    }));
    await Promise.resolve();
    assert.equal(completedItems, 20_000);
  } finally {
    restore();
  }
});

test("relabels only package-owned fallback outline nodes in place", async () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    const filter = new FakeElement();
    const input = new FakeElement("INPUT");
    input.value = "(Untitled)";
    filter.append(input);
    const presentation = new DocumentOutlinePresentation(
      {
        sidebar: null,
        content: content as unknown as HTMLElement,
        filter: filter as unknown as HTMLElement,
        filterInput: input as unknown as HTMLInputElement,
      },
      {
        filterEnabled: true,
        filterLabel: "Filter",
        untitledLabel: "(Untitled)",
        noOutlineLabel: "Empty",
        preparationLabel: "Preparing",
        preparationErrorLabel: "Failed",
        filterOptions: { caseSensitive: false, diacritics: "smart" },
        viewerId: "test-viewer",
      },
      {
        select() {},
        preparationStateChanged() {},
        preparationCompleted() {},
        isOpen: () => false,
        isOverlay: () => false,
        hasTouch: () => false,
        scrollBehavior: () => "auto",
      },
    );
    const fallback = Object.freeze({
      key: "0",
      title: "(Untitled)",
      fallbackTitle: true as const,
      destinationStatus: "none" as const,
      destination: null,
      children: Object.freeze([]),
    });
    const source = Object.freeze({
      key: "1",
      title: "(Untitled)",
      destinationStatus: "none" as const,
      destination: null,
      children: Object.freeze([]),
    });
    await presentation.prepare(async () => ({
      status: "ready",
      itemCount: 2,
      items: Object.freeze([fallback, source]),
    }));
    await Promise.resolve();
    const list = content.children[0]!;
    const fallbackItem = list.children[0]!;
    const fallbackButton = fallbackItem.children[0]!;
    const sourceItem = list.children[1]!;
    fallbackButton.focus();
    presentation.setUiText({
      filterLabel: "Filter",
      untitledLabel: "(Nimetön)",
      noOutlineLabel: "Empty",
      preparationLabel: "Preparing",
      preparationErrorLabel: "Failed",
    });
    assert.equal(list.children[0], fallbackItem);
    assert.equal(fallbackItem.children[0], fallbackButton);
    assert.equal(
      (globalThis.document as unknown as { activeElement: unknown }).activeElement,
      fallbackButton,
    );
    assert.equal(fallbackButton.textContent, "(Nimetön)");
    assert.equal(fallbackItem.dataset.title, "(Nimetön)");
    assert.equal(sourceItem.children[0]?.textContent, "(Untitled)");
    assert.equal(sourceItem.dataset.title, "(Untitled)");
    assert.equal(fallbackItem.style.display, "none");
  } finally {
    restore();
  }
});
