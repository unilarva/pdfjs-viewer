// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private DOM owner for the optional-content sidebar view.
 *
 * `DocumentLayersPresentation` renders only detached public layer state. Nested
 * labels become accessible fieldsets, groups become checkboxes, and all mutation
 * input is delegated through one listener to the facade's atomic owner API. It
 * owns loading, empty, error, reset, busy, and focus-retention presentation but
 * never reads or mutates a PDF.js configuration. Reset and destroy invalidate
 * asynchronous callbacks before clearing package-created DOM.
 *
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for owner boundaries.
 * @packageDocumentation
 * @module document-layers-presentation
 */

import type {
  PdfjsViewerLayerMutationResult,
  PdfjsViewerLayerNode,
  PdfjsViewerLayerState,
  PdfjsViewerLayerVisibilityChange,
} from "./viewer-contracts.js";

interface DocumentLayersPresentationOptions {
  readonly content: HTMLElement | null;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly errorLabel: string;
  readonly resetLabel: string;
  readonly fallbackLayerLabel: string;
  readonly fallbackGroupLabel: string;
}

interface DocumentLayersPresentationCallbacks {
  readonly setVisibility: (
    changes: readonly PdfjsViewerLayerVisibilityChange[],
  ) => Promise<PdfjsViewerLayerMutationResult>;
  readonly reset: () => Promise<PdfjsViewerLayerMutationResult>;
  readonly diagnostic?: (error: unknown) => void;
}

/** Owns nested accessible layer controls and delegated interaction. */
export class DocumentLayersPresentation {
  #document: Document | null;
  #options: DocumentLayersPresentationOptions;
  #callbacks: DocumentLayersPresentationCallbacks;
  #generation = 0;
  #state: Readonly<PdfjsViewerLayerState> | null = null;
  #busy = false;
  #onChange: (event: Event) => void;
  #onClick: (event: Event) => void;

  constructor(
    options: Readonly<DocumentLayersPresentationOptions>,
    callbacks: DocumentLayersPresentationCallbacks,
  ) {
    this.#options = { ...options };
    this.#callbacks = callbacks;
    this.#document = options.content?.ownerDocument ?? null;
    this.#onChange = event => {
      const input =
        event.target && typeof (event.target as Element).closest === "function"
          ? (event.target as Element).closest<HTMLInputElement>("input[data-pdf-layer-id]")
          : null;
      if (!input || this.#busy || !this.#options.content?.contains(input)) return;
      void this.#mutate(
        [{ id: input.dataset.pdfLayerId!, visible: input.checked }],
        input.dataset.pdfLayerId!,
      );
    };
    this.#onClick = event => {
      const reset =
        event.target && typeof (event.target as Element).closest === "function"
          ? (event.target as Element).closest<HTMLButtonElement>(".pdf-layers-reset")
          : null;
      if (!reset || this.#busy || !this.#options.content?.contains(reset)) return;
      void this.#reset();
    };
    options.content?.addEventListener("change", this.#onChange);
    options.content?.addEventListener("click", this.#onClick);
  }

  loading(): void {
    this.#generation++;
    this.#state = null;
    this.#busy = false;
    const content = this.#options.content;
    if (!content) return;
    content.classList.add("pdf-layers--loading");
    content.setAttribute("aria-busy", "true");
    content.replaceChildren(
      this.#message(this.#options.loadingLabel, "status", "pdf-layers-status"),
    );
  }

  ready(state: Readonly<PdfjsViewerLayerState>, preferredFocusId?: string): void {
    this.#state = state;
    this.#busy = false;
    const content = this.#options.content;
    if (!content) return;
    const activeElement = this.#document?.activeElement;
    const Input = this.#document?.defaultView?.HTMLInputElement;
    const focusId =
      preferredFocusId ??
      (Input && activeElement instanceof Input && content.contains(activeElement)
        ? activeElement.dataset.pdfLayerId
        : undefined);
    content.classList.remove("pdf-layers--loading", "pdf-layers--error");
    content.removeAttribute("aria-busy");
    if (!state.layers.length) {
      content.replaceChildren(
        this.#message(this.#options.emptyLabel, "status", "pdf-layers-empty"),
      );
      return;
    }
    const ownerDocument = this.#document;
    if (!ownerDocument) return;
    const tree = ownerDocument.createElement("div");
    tree.className = "pdf-layers-tree";
    tree.append(...state.layers.map((node, index) => this.#node(node, index + 1)));
    const reset = ownerDocument.createElement("button");
    reset.type = "button";
    reset.className = "pdf-layers-reset";
    reset.dataset.pdfjsUiTextContent = "resetLayers";
    reset.textContent = this.#options.resetLabel;
    content.replaceChildren(tree, reset);
    if (focusId)
      content
        .querySelector<HTMLInputElement>(
          `input[data-pdf-layer-id="${this.#selectorValue(focusId)}"]`,
        )
        ?.focus();
  }

  error(error?: unknown): void {
    this.#generation++;
    this.#state = null;
    this.#busy = false;
    const content = this.#options.content;
    if (content) {
      content.classList.remove("pdf-layers--loading");
      content.classList.add("pdf-layers--error");
      content.removeAttribute("aria-busy");
      content.replaceChildren(
        this.#message(this.#options.errorLabel, "alert", "pdf-layers-status"),
      );
    }
    if (error !== undefined) this.#diagnostic(error);
  }

  reset(): void {
    this.#generation++;
    this.#state = null;
    this.#busy = false;
    const content = this.#options.content;
    content?.classList.remove("pdf-layers--loading", "pdf-layers--error");
    content?.removeAttribute("aria-busy");
    content?.replaceChildren();
  }

  destroy(): void {
    this.reset();
    this.#options.content?.removeEventListener("change", this.#onChange);
    this.#options.content?.removeEventListener("click", this.#onClick);
  }

  /** Refreshes package fallback and status nodes without replacing layer controls. */
  setUiText(options: Omit<DocumentLayersPresentationOptions, "content">): void {
    this.#options = { ...this.#options, ...options };
    const content = this.#options.content;
    if (!content) return;
    for (const message of content.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='layersLoading']",
    ))
      message.textContent = options.loadingLabel;
    for (const message of content.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='layersError']",
    ))
      message.textContent = options.errorLabel;
    for (const message of content.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='noLayers']",
    ))
      message.textContent = options.emptyLabel;
    for (const reset of content.querySelectorAll<HTMLButtonElement>(
      "[data-pdfjs-ui-text-content='resetLayers']",
    ))
      reset.textContent = options.resetLabel;
    for (const fallback of content.querySelectorAll<HTMLElement>("[data-pdfjs-layer-fallback]")) {
      const kind = fallback.dataset.pdfjsLayerFallback;
      const index = fallback.dataset.pdfjsLayerFallbackIndex;
      fallback.textContent = `${kind === "group" ? options.fallbackGroupLabel : options.fallbackLayerLabel} ${index}`;
    }
  }

  async #mutate(
    changes: readonly PdfjsViewerLayerVisibilityChange[],
    focusId: string,
  ): Promise<void> {
    const generation = this.#generation;
    this.#setBusy(true);
    try {
      const result = await this.#callbacks.setVisibility(changes);
      if (generation !== this.#generation) return;
      if (result.ok) this.#focusLayer(focusId);
      else if (result.reason !== "cancelled")
        this.error("error" in result ? result.error : result.reason);
    } catch (error) {
      if (generation === this.#generation) this.error(error);
    } finally {
      if (generation === this.#generation) this.#setBusy(false);
    }
  }

  async #reset(): Promise<void> {
    const generation = this.#generation;
    this.#setBusy(true);
    try {
      const result = await this.#callbacks.reset();
      if (generation !== this.#generation) return;
      if (result.ok) return;
      else if (result.reason !== "cancelled")
        this.error("error" in result ? result.error : result.reason);
    } catch (error) {
      if (generation === this.#generation) this.error(error);
    } finally {
      if (generation === this.#generation) this.#setBusy(false);
    }
  }

  #node(node: PdfjsViewerLayerNode, fallbackIndex: number): HTMLElement {
    const ownerDocument = this.#document;
    if (!ownerDocument) throw new Error("DocumentLayersPresentation requires an owner document");
    if (node.kind === "group") {
      const label = ownerDocument.createElement("label");
      label.className = "pdf-layer-choice";
      const input = ownerDocument.createElement("input");
      input.type = "checkbox";
      input.checked = node.visible;
      input.dataset.pdfLayerId = node.id;
      const text = ownerDocument.createElement("span");
      if (node.name.trim()) text.textContent = node.name;
      else {
        text.dataset.pdfjsLayerFallback = "layer";
        text.dataset.pdfjsLayerFallbackIndex = String(fallbackIndex);
        text.dataset.pdfjsUiTextContent = "fallbackLayer";
        text.textContent = `${this.#options.fallbackLayerLabel} ${fallbackIndex}`;
      }
      label.append(input, text);
      return label;
    }
    const fieldset = ownerDocument.createElement("fieldset");
    fieldset.className = "pdf-layer-group";
    const legend = ownerDocument.createElement("legend");
    if (node.name.trim()) legend.textContent = node.name;
    else {
      legend.dataset.pdfjsLayerFallback = "group";
      legend.dataset.pdfjsLayerFallbackIndex = String(fallbackIndex);
      legend.dataset.pdfjsUiTextContent = "fallbackLayerGroup";
      legend.textContent = `${this.#options.fallbackGroupLabel} ${fallbackIndex}`;
    }
    fieldset.append(legend, ...node.children.map((child, index) => this.#node(child, index + 1)));
    return fieldset;
  }

  #message(text: string, role: string, className: string): HTMLParagraphElement {
    const ownerDocument = this.#document;
    if (!ownerDocument) throw new Error("DocumentLayersPresentation requires an owner document");
    const message = ownerDocument.createElement("p");
    message.className = className;
    message.setAttribute("role", role);
    message.dataset.pdfjsUiTextContent =
      className === "pdf-layers-empty"
        ? "noLayers"
        : role === "alert"
          ? "layersError"
          : "layersLoading";
    message.textContent = text;
    return message;
  }

  #focusLayer(id: string): void {
    this.#options.content
      ?.querySelector<HTMLInputElement>(`input[data-pdf-layer-id="${this.#selectorValue(id)}"]`)
      ?.focus();
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy;
    const content = this.#options.content;
    if (!content) return;
    content.toggleAttribute("aria-busy", busy);
    for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "input, button",
    )) {
      control.disabled = busy;
    }
  }

  #diagnostic(error: unknown): void {
    try {
      this.#callbacks.diagnostic?.(error);
    } catch {}
  }

  /** Escapes the only characters that can terminate this quoted attribute selector. */
  #selectorValue(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
  }
}
