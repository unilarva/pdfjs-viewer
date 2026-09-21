// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentLayersPresentation } from "../../src/document-layers-presentation.js";
import { installTestPlatform } from "./test-platform.js";

class FakeElement {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  className = "";
  textContent = "";
  type = "";
  checked = false;
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
  addEventListener(): void {}
  removeEventListener(): void {}
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
