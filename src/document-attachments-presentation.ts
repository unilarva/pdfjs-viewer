// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for the document attachments view.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentAttachmentsPresentation` owns the metadata preparation-to-DOM handoff,
 * accessible list and empty/error markup, delegated download interaction, per-item
 * busy/error state, reset, and stale completion identity. Byte acquisition and the
 * browser download effect remain facade responsibilities.
 *
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative model,
 * presentation, panel-shell, and facade boundaries.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-attachments-presentation
 */

import type { DocumentAttachmentsPreparationOutcome } from "./document-attachments.js";
import {
  PDFJS_VIEWER_STATE_CLASSES,
  type PdfjsViewerAttachment,
  type PdfjsViewerAttachmentDownloadResult,
} from "./viewer-contracts.js";

/** DOM bindings owned by the attachments view. */
interface DocumentAttachmentsPresentationBindings {
  readonly content: HTMLElement | null;
}

/** Immutable localized text for attachment presentation. */
interface DocumentAttachmentsPresentationOptions {
  readonly preparationLabel: string;
  readonly preparationErrorLabel: string;
  readonly noAttachmentsLabel: string;
  readonly downloadLabel: string;
  readonly downloadErrorLabel: string;
}

/** Semantic effects emitted across the presentation boundary. */
export interface DocumentAttachmentsPresentationCallbacks {
  readonly preparationStateChanged: (state: "loading" | "ready" | "error") => void;
  readonly preparationCompleted: (outcome: DocumentAttachmentsPreparationOutcome) => void;
  readonly download: (id: string) => Promise<PdfjsViewerAttachmentDownloadResult>;
}

/** Owns all attachment-view state, DOM, interaction, and asynchronous handoff. */
export class DocumentAttachmentsPresentation {
  #document: Document | null;
  #bindings: DocumentAttachmentsPresentationBindings;
  #options: Readonly<DocumentAttachmentsPresentationOptions>;
  #callbacks: DocumentAttachmentsPresentationCallbacks;
  #preparation: Promise<DocumentAttachmentsPreparationOutcome> | null = null;
  #generation = 0;
  #contentAriaLabel: string | null | undefined;
  readonly #clickListener = (event: Event) => this.#handleClick(event);

  constructor(
    bindings: Readonly<DocumentAttachmentsPresentationBindings>,
    options: Readonly<DocumentAttachmentsPresentationOptions>,
    callbacks: DocumentAttachmentsPresentationCallbacks,
  ) {
    this.#bindings = { ...bindings };
    this.#options = Object.freeze({ ...options });
    this.#callbacks = callbacks;
    this.#document = bindings.content?.ownerDocument ?? null;
    this.#bindings.content?.addEventListener("click", this.#clickListener);
  }

  /** The current document's exactly-once UI preparation handoff. */
  public get preparation(): Promise<DocumentAttachmentsPreparationOutcome> | null {
    return this.#preparation;
  }

  /** Starts or joins the current document's preparation-to-presentation handoff. */
  public prepare(
    read: () => Promise<DocumentAttachmentsPreparationOutcome>,
  ): Promise<DocumentAttachmentsPreparationOutcome> {
    if (this.#preparation) return this.#preparation;
    const generation = this.#generation;
    let preparation: Promise<DocumentAttachmentsPreparationOutcome>;
    try {
      preparation = read();
    } catch (error) {
      preparation = Promise.resolve({ status: "error", itemCount: 0, items: [], error });
    }
    this.#preparation = preparation;
    this.#callbacks.preparationStateChanged("loading");
    if (generation !== this.#generation || this.#preparation !== preparation) return preparation;
    this.#setPreparing(true);
    void preparation.then(outcome => {
      if (generation !== this.#generation || this.#preparation !== preparation) return;
      this.#setPreparing(false);
      if (outcome.status === "cancelled") return;
      this.#callbacks.preparationStateChanged(outcome.status);
      this.#present(outcome);
      this.#callbacks.preparationCompleted(outcome);
    });
    return preparation;
  }

  /** Invalidates document work and clears all document-derived attachment output. */
  public reset(): void {
    this.#generation++;
    this.#preparation = null;
    this.#setPreparing(false);
    this.#bindings.content?.replaceChildren();
  }

  /** Permanently releases interaction and document presentation. */
  public destroy(): void {
    this.reset();
    this.#bindings.content?.removeEventListener("click", this.#clickListener);
  }

  /** Refreshes package-created attachment status and action text in place. */
  public setUiText(options: Readonly<DocumentAttachmentsPresentationOptions>): void {
    this.#options = Object.freeze({ ...options });
    const root = this.#bindings.content;
    if (!root) return;
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-pdfjs-ui-text-content='attachmentDownload']",
    ))
      button.textContent = options.downloadLabel;
    for (const message of root.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='attachmentsError']",
    ))
      message.textContent = options.preparationErrorLabel;
    for (const message of root.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='noAttachments']",
    ))
      message.textContent = options.noAttachmentsLabel;
    for (const message of root.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='attachmentDownloadError']",
    ))
      message.textContent = options.downloadErrorLabel;
    if (root.getAttribute("aria-busy") === "true")
      root.setAttribute("aria-label", options.preparationLabel);
  }

  #setPreparing(preparing: boolean): void {
    const content = this.#bindings.content;
    if (!content) return;
    content.classList.toggle(PDFJS_VIEWER_STATE_CLASSES.attachmentsPreparing, preparing);
    if (preparing) {
      if (this.#contentAriaLabel === undefined)
        this.#contentAriaLabel = content.getAttribute("aria-label");
      content.setAttribute("aria-busy", "true");
      content.setAttribute("aria-label", this.#options.preparationLabel);
      return;
    }
    content.removeAttribute("aria-busy");
    if (this.#contentAriaLabel === undefined) return;
    if (this.#contentAriaLabel === null) content.removeAttribute("aria-label");
    else content.setAttribute("aria-label", this.#contentAriaLabel);
    this.#contentAriaLabel = undefined;
  }

  #present(outcome: Exclude<DocumentAttachmentsPreparationOutcome, { status: "cancelled" }>): void {
    const root = this.#bindings.content;
    if (!root) return;
    if (outcome.status === "error") {
      const failure = this.#document?.createElement("div");
      if (!failure) return;
      failure.className = "pdf-no-attachments-text pdf-attachments-error";
      failure.dataset.pdfjsUiTextContent = "attachmentsError";
      failure.textContent = this.#options.preparationErrorLabel;
      root.replaceChildren(failure);
      return;
    }
    if (!outcome.items.length) {
      const empty = this.#document?.createElement("div");
      if (!empty) return;
      empty.className = "pdf-no-attachments-text";
      empty.dataset.pdfjsUiTextContent = "noAttachments";
      empty.textContent = this.#options.noAttachmentsLabel;
      root.replaceChildren(empty);
      return;
    }
    root.replaceChildren(this.#renderItems(outcome.items));
  }

  #renderItems(attachments: readonly PdfjsViewerAttachment[]): HTMLUListElement {
    const ownerDocument = this.#document;
    if (!ownerDocument)
      throw new Error("DocumentAttachmentsPresentation requires an owner document");
    const list = ownerDocument.createElement("ul");
    list.className = "pdf-attachment-list";
    for (const attachment of attachments) {
      const item = ownerDocument.createElement("li");
      item.className = "pdf-attachment";
      const name = ownerDocument.createElement("span");
      name.className = "pdf-attachment-name";
      name.textContent = attachment.filename;
      item.append(name);
      if (attachment.description) {
        const description = ownerDocument.createElement("span");
        description.className = "pdf-attachment-description";
        description.textContent = attachment.description;
        item.append(description);
      }
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = "pdf-attachment-download";
      button.dataset.attachmentId = attachment.id;
      button.dataset.pdfjsUiTextContent = "attachmentDownload";
      button.textContent = this.#options.downloadLabel;
      item.append(button);
      list.append(item);
    }
    return list;
  }

  #handleClick(event: Event): void {
    const target = event.target;
    if (!target || typeof (target as Element).closest !== "function") return;
    const button = (target as Element).closest<HTMLButtonElement>(
      "button.pdf-attachment-download[data-attachment-id]",
    );
    const root = this.#bindings.content;
    if (!button || !root?.contains(button) || button.disabled) return;
    const id = button.dataset.attachmentId;
    if (id === undefined) return;
    event.preventDefault();
    const generation = this.#generation;
    const item = button.closest<HTMLElement>("li.pdf-attachment");
    item?.querySelector(".pdf-attachment-download-error")?.remove();
    button.disabled = true;
    button.setAttribute("aria-busy", "true");

    let download: Promise<PdfjsViewerAttachmentDownloadResult>;
    try {
      download = this.#callbacks.download(id);
    } catch (error) {
      download = Promise.reject(error);
    }
    void download.then(
      result => {
        if (generation !== this.#generation || !root.contains(button)) return;
        this.#finishDownload(button);
        if (!result.ok && result.reason !== "cancelled") this.#showDownloadError(item);
      },
      () => {
        if (generation !== this.#generation || !root.contains(button)) return;
        this.#finishDownload(button);
        this.#showDownloadError(item);
      },
    );
  }

  #finishDownload(button: HTMLButtonElement): void {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }

  #showDownloadError(item: HTMLElement | null): void {
    if (!item) return;
    const failure = this.#document?.createElement("span");
    if (!failure) return;
    failure.className = "pdf-attachment-download-error";
    failure.dataset.pdfjsUiTextContent = "attachmentDownloadError";
    failure.setAttribute("role", "status");
    failure.textContent = this.#options.downloadErrorLabel;
    item.append(failure);
  }
}
