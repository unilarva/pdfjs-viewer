// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private presentation owner for generated document-information UI.
 * Metadata acquisition remains owned by the public viewer facade and its
 * document-information model. This is not a supported consumer subpath or
 * package-root export. See the [architecture guide](../ARCHITECTURE.md) for the
 * model, facade, and UI ownership boundaries.
 * @packageDocumentation
 * @module viewer-document-information
 */

import type {
  PdfjsViewerDocumentInformation,
  PdfjsViewerDocumentInformationResult,
  PdfjsViewerLabels,
} from "./viewer-contracts.js";
import { ViewerDialog } from "./viewer-dialog.js";

interface ViewerDocumentInformationCallbacks {
  readonly closeTransientUi: () => HTMLElement | null;
  readonly getInformation: () => Promise<PdfjsViewerDocumentInformationResult>;
  readonly failed: (error: unknown) => void;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element)
    throw new Error(`PdfjsViewer: generated document information element missing: ${selector}`);
  return element;
}

/** Owns exactly one document-information dialog and its rendered snapshot. */
export class ViewerDocumentInformation {
  readonly #action: HTMLButtonElement;
  readonly #dialog: HTMLDialogElement;
  #labels: Readonly<PdfjsViewerLabels>;
  #formatDate: (value: string) => string;
  readonly #callbacks: ViewerDocumentInformationCallbacks;
  readonly #lifetime = new AbortController();
  readonly #content: HTMLElement;
  readonly #status: HTMLElement;
  readonly #modal: ViewerDialog;
  #request = 0;
  #information: Readonly<PdfjsViewerDocumentInformation> | null = null;

  constructor(
    action: HTMLButtonElement,
    dialog: HTMLDialogElement,
    labels: Readonly<PdfjsViewerLabels>,
    formatDate: (value: string) => string,
    callbacks: ViewerDocumentInformationCallbacks,
  ) {
    this.#action = action;
    this.#dialog = dialog;
    this.#labels = labels;
    this.#formatDate = formatDate;
    this.#callbacks = callbacks;
    this.#content = required(dialog, ".pdf-document-information-content");
    this.#status = required(dialog, ".pdf-document-information-status");
    const close = required<HTMLButtonElement>(dialog, ".pdf-document-information-close");
    const accept = required<HTMLButtonElement>(dialog, ".pdf-document-information-accept");
    this.#modal = new ViewerDialog(dialog, { requestClose: () => this.#close() });
    const signal = this.#lifetime.signal;
    action.addEventListener("click", () => this.#open(close), { signal });
    close.addEventListener("click", () => this.#close(), { signal });
    accept.addEventListener("click", () => this.#close(), { signal });
    dialog.addEventListener(
      "close",
      () => {
        this.#request++;
        dialog.removeAttribute("aria-busy");
      },
      { signal },
    );
  }

  resetDocument(): void {
    this.#request++;
    this.#modal.close();
    this.#content.replaceChildren();
    this.#status.textContent = "";
    this.#information = null;
  }

  destroy(): void {
    this.#request++;
    this.#modal.destroy();
    this.#lifetime.abort();
  }

  /** Refreshes an open package-owned dialog from its cached information snapshot. */
  setUiText(labels: Readonly<PdfjsViewerLabels>, formatDate: (value: string) => string): void {
    this.#labels = labels;
    this.#formatDate = formatDate;
    if (!this.#dialog.open) return;
    if (this.#information) this.#render(this.#information);
    else if (this.#dialog.hasAttribute("aria-busy"))
      this.#status.textContent = labels.documentInformationLoading;
    else this.#status.textContent = labels.documentInformationUnavailable;
  }

  #open(initialFocus: HTMLElement): void {
    const opener = this.#callbacks.closeTransientUi();
    this.#information = null;
    this.#content.replaceChildren();
    this.#status.textContent = this.#labels.documentInformationLoading;
    this.#dialog.setAttribute("aria-busy", "true");
    this.#modal.open(opener, initialFocus);
    const request = ++this.#request;
    void this.#callbacks
      .getInformation()
      .then(result => {
        if (request !== this.#request || !this.#dialog.open) return;
        this.#dialog.removeAttribute("aria-busy");
        if (!result.ok) {
          this.#status.textContent = this.#labels.documentInformationUnavailable;
          if (result.reason === "error") this.#callbacks.failed(result.error);
          return;
        }
        this.#status.textContent = "";
        this.#information = result.information;
        this.#render(result.information);
      })
      .catch(error => {
        if (request !== this.#request || !this.#dialog.open) return;
        this.#dialog.removeAttribute("aria-busy");
        this.#status.textContent = this.#labels.documentInformationUnavailable;
        this.#callbacks.failed(error);
      });
  }

  #close(): void {
    this.#request++;
    this.#dialog.removeAttribute("aria-busy");
    this.#modal.close();
  }

  #render(information: Readonly<PdfjsViewerDocumentInformation>): void {
    const fields: ReadonlyArray<readonly [string, string | number | null]> = [
      [this.#labels.documentInformationFieldTitle, information.title],
      [this.#labels.documentInformationFieldAuthor, information.author],
      [this.#labels.documentInformationFieldSubject, information.subject],
      [this.#labels.documentInformationFieldKeywords, information.keywords],
      [
        this.#labels.documentInformationFieldCreationDate,
        information.creationDate === null ? null : this.#formatDate(information.creationDate),
      ],
      [
        this.#labels.documentInformationFieldModificationDate,
        information.modificationDate === null
          ? null
          : this.#formatDate(information.modificationDate),
      ],
      [this.#labels.documentInformationFieldCreator, information.creator],
      [this.#labels.documentInformationFieldProducer, information.producer],
      [this.#labels.documentInformationFieldPdfVersion, information.pdfFormatVersion],
      [this.#labels.documentInformationFieldPageCount, information.pageCount],
      [this.#labels.documentInformationFieldLanguage, information.language],
      [
        this.#labels.documentInformationFieldLinearized,
        information.isLinearized
          ? this.#labels.documentInformationYes
          : this.#labels.documentInformationNo,
      ],
    ];
    const list = this.#dialog.ownerDocument.createElement("dl");
    list.className = "pdf-document-information-list";
    for (const [label, value] of fields) {
      if (value === null || value === "") continue;
      const term = this.#dialog.ownerDocument.createElement("dt");
      term.textContent = label;
      const description = this.#dialog.ownerDocument.createElement("dd");
      description.textContent = String(value);
      description.dir = "auto";
      list.append(term, description);
    }
    this.#content.replaceChildren(list);
  }
}
