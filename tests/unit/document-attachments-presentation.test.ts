// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  DocumentAttachmentsPresentation,
  type DocumentAttachmentsPresentationCallbacks,
} from "../../src/document-attachments-presentation.js";
import type { DocumentAttachmentsPreparationOutcome } from "../../src/document-attachments.js";
import { installTestPlatform } from "./test-platform.js";

class FakeClassList {
  readonly #classes = new Set<string>();
  constructor(private readonly owner: FakeElement) {}
  toggle(name: string, force: boolean): void {
    if (force) this.#classes.add(name);
    else this.#classes.delete(name);
    this.owner.className = [...this.#classes].join(" ");
  }
}

class FakeElement {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  public className = "";
  public textContent: string | null = null;
  public type = "";
  public disabled = false;
  public readonly dataset: Record<string, string | undefined> = {};
  public readonly attributes = new Map<string, string>();
  public readonly children: FakeElement[] = [];
  public parentElement: FakeElement | null = null;
  public readonly classList = new FakeClassList(this);
  readonly #listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(public readonly tagName = "div") {}

  public append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  public replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.splice(0);
    this.append(...children);
  }
  public contains(candidate: FakeElement): boolean {
    return candidate === this || this.children.some(child => child.contains(candidate));
  }
  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  public addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }
  public removeEventListener(type: string, listener: (event: Event) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }
  public closest<T>(selector: string): T | null {
    for (let current: FakeElement | null = this; current; current = current.parentElement) {
      if (
        selector.startsWith("button.") &&
        current.tagName === "button" &&
        current.className.includes("pdf-attachment-download") &&
        current.dataset.attachmentId !== undefined
      )
        return current as T;
      if (
        selector === "li.pdf-attachment" &&
        current.tagName === "li" &&
        current.className === "pdf-attachment"
      )
        return current as T;
    }
    return null;
  }
  public querySelector<T>(selector: string): T | null {
    for (const child of this.children) {
      if (
        selector === ".pdf-attachment-download-error" &&
        child.className === "pdf-attachment-download-error"
      )
        return child as T;
      const nested = child.querySelector<T>(selector);
      if (nested) return nested;
    }
    return null;
  }
  public querySelectorAll<T>(selector: string): T[] {
    const key = selector.match(/data-pdfjs-ui-text-content='([^']+)'/)?.[1];
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (key && child.dataset.pdfjsUiTextContent === key) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches as T[];
  }
  public remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  public click(target: FakeElement): void {
    const event = { target, preventDefault() {} } as unknown as Event;
    for (const listener of this.#listeners.get("click") ?? []) listener(event);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function installFakeDom(): () => void {
  const platform = installTestPlatform(tagName => new FakeElement(tagName) as unknown as Element);
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });
  return () => {
    if (previousElement) Object.defineProperty(globalThis, "Element", previousElement);
    else delete (globalThis as { Element?: unknown }).Element;
    platform.restore();
  };
}

function owner(
  content: FakeElement,
  callbacks: Partial<DocumentAttachmentsPresentationCallbacks> = {},
) {
  return new DocumentAttachmentsPresentation(
    { content: content as unknown as HTMLElement },
    {
      preparationLabel: "Preparing attachments",
      preparationErrorLabel: "Could not read attachments",
      noAttachmentsLabel: "No attachments",
      downloadLabel: "Download",
      downloadErrorLabel: "Download failed",
    },
    {
      preparationStateChanged() {},
      preparationCompleted() {},
      download: async () => ({ ok: true }),
      ...callbacks,
    },
  );
}

const ready = Object.freeze({
  status: "ready" as const,
  itemCount: 1,
  items: Object.freeze([
    { id: "opaque/id", filename: "<img src=x>.txt", description: "<b>description</b>" },
  ]),
}) satisfies DocumentAttachmentsPreparationOutcome;

test("renders attachment text safely and performs exactly one preparation handoff", async () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    content.setAttribute("aria-label", "Attachments");
    const states: string[] = [];
    const completed: DocumentAttachmentsPreparationOutcome[] = [];
    const presentation = owner(content, {
      preparationStateChanged: state => states.push(state),
      preparationCompleted: outcome => completed.push(outcome),
    });
    let reads = 0;
    const first = presentation.prepare(() => {
      reads++;
      return Promise.resolve(ready);
    });
    const concurrent = presentation.prepare(() => {
      reads++;
      return Promise.resolve(ready);
    });
    assert.equal(first, concurrent);
    assert.equal(content.attributes.get("aria-busy"), "true");
    assert.equal(content.attributes.get("aria-label"), "Preparing attachments");
    await first;
    await Promise.resolve();

    assert.equal(reads, 1);
    assert.deepEqual(states, ["loading", "ready"]);
    assert.deepEqual(completed, [ready]);
    assert.equal(content.attributes.get("aria-busy"), undefined);
    assert.equal(content.attributes.get("aria-label"), "Attachments");
    const list = content.children[0]!;
    assert.equal(list.className, "pdf-attachment-list");
    const item = list.children[0]!;
    assert.equal(item.children[0]?.className, "pdf-attachment-name");
    assert.equal(item.children[0]?.textContent, "<img src=x>.txt");
    assert.equal(item.children[1]?.textContent, "<b>description</b>");
    assert.equal(item.children[2]?.dataset.attachmentId, "opaque/id");
  } finally {
    restore();
  }
});

test("owns download busy and localized failure state without stale DOM mutation", async () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    const download = deferred<{ ok: false; reason: "error"; error: Error }>();
    const requested: string[] = [];
    const presentation = owner(content, {
      download: id => {
        requested.push(id);
        return download.promise;
      },
    });
    await presentation.prepare(() => Promise.resolve(ready));
    await Promise.resolve();
    const item = content.children[0]!.children[0]!;
    const button = item.children[2]!;
    content.click(button);
    content.click(button);
    assert.deepEqual(requested, ["opaque/id"]);
    assert.equal(button.disabled, true);
    assert.equal(button.attributes.get("aria-busy"), "true");
    download.resolve({ ok: false, reason: "error", error: new Error("failed") });
    await download.promise;
    await Promise.resolve();
    assert.equal(button.disabled, false);
    assert.equal(button.attributes.get("aria-busy"), undefined);
    const error = item.children[3]!;
    assert.equal(error.className, "pdf-attachment-download-error");
    assert.equal(error.attributes.get("role"), "status");
    assert.equal(error.textContent, "Download failed");

    presentation.destroy();
    const staleDownload = deferred<{ ok: true }>();
    const successor = owner(content, { download: () => staleDownload.promise });
    await successor.prepare(() => Promise.resolve(ready));
    await Promise.resolve();
    const staleButton = content.children[0]!.children[0]!.children[2]!;
    content.click(staleButton);
    successor.reset();
    staleDownload.resolve({ ok: true });
    await staleDownload.promise;
    await Promise.resolve();
    assert.equal(content.children.length, 0);
    assert.equal(staleButton.disabled, true);
    assert.equal(staleButton.attributes.get("aria-busy"), "true");
    successor.destroy();
  } finally {
    restore();
  }
});

test("refreshes only package attachment output without restarting preparation or download", async () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    const pending = deferred<{ ok: false; reason: "error"; error: Error }>();
    let preparations = 0;
    const presentation = owner(content, { download: () => pending.promise });
    await presentation.prepare(() => {
      preparations++;
      return Promise.resolve(ready);
    });
    await Promise.resolve();
    const item = content.children[0]!.children[0]!;
    const button = item.children[2]!;
    content.click(button);
    pending.resolve({ ok: false, reason: "error", error: new Error("failed") });
    await Promise.resolve();
    const decoy = new FakeElement("button");
    decoy.className = "pdf-attachment-download";
    decoy.textContent = "Host download";
    content.append(decoy);
    presentation.setUiText({
      preparationLabel: "Preparing X",
      preparationErrorLabel: "Error X",
      noAttachmentsLabel: "Empty X",
      downloadLabel: "Download X",
      downloadErrorLabel: "Download error X",
    });
    assert.equal(button.textContent, "Download X");
    assert.equal(item.children[3]?.textContent, "Download error X");
    assert.equal(decoy.textContent, "Host download");
    assert.equal(preparations, 1);
    presentation.destroy();
  } finally {
    restore();
  }
});

test("reset rejects stale preparation completion and cancellation renders nothing", async () => {
  const restore = installFakeDom();
  try {
    const content = new FakeElement();
    const stale = deferred<DocumentAttachmentsPreparationOutcome>();
    const completed: DocumentAttachmentsPreparationOutcome[] = [];
    const presentation = owner(content, {
      preparationCompleted: outcome => completed.push(outcome),
    });
    const first = presentation.prepare(() => stale.promise);
    presentation.reset();
    const cancelled = presentation.prepare(async () => ({
      status: "cancelled",
      itemCount: 0,
      items: [],
    }));
    stale.resolve(ready);
    await Promise.all([first, cancelled]);
    await Promise.resolve();
    assert.deepEqual(completed, []);
    assert.equal(content.children.length, 0);
    assert.equal(content.attributes.get("aria-busy"), undefined);
  } finally {
    restore();
  }
});
