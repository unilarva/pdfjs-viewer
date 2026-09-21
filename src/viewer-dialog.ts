// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private lifecycle owner shared by package-managed modal dialogs.
 *
 * HTML dialog semantics retain focus containment and Escape handling, while
 * this owner adds consistent viewport-backdrop dismissal and opener restoration.
 * This is not a supported consumer subpath or package-root export. See the
 * [architecture guide](../ARCHITECTURE.md) for the UI ownership boundary.
 * @packageDocumentation
 * @module viewer-dialog
 */

interface ViewerDialogCallbacks {
  readonly requestClose: () => void;
}

/** Owns the common interaction lifetime of one native modal dialog. */
export class ViewerDialog {
  readonly #dialog: HTMLDialogElement;
  readonly #callbacks: ViewerDialogCallbacks;
  readonly #lifetime = new AbortController();
  #opener: HTMLElement | null = null;

  constructor(dialog: HTMLDialogElement, callbacks: ViewerDialogCallbacks) {
    this.#dialog = dialog;
    this.#callbacks = callbacks;
    const signal = this.#lifetime.signal;
    dialog.addEventListener(
      "click",
      event => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        )
          return;
        this.#callbacks.requestClose();
      },
      { signal },
    );
    dialog.addEventListener(
      "close",
      () => {
        const opener = this.#opener;
        this.#opener = null;
        dialog.ownerDocument.defaultView?.setTimeout(() => {
          if (!this.#lifetime.signal.aborted && opener?.isConnected) opener.focus();
        }, 0);
      },
      { signal },
    );
  }

  open(opener: HTMLElement | null, initialFocus?: HTMLElement | null): void {
    this.#opener = opener;
    this.#dialog.showModal();
    initialFocus?.focus();
  }

  close(): void {
    if (this.#dialog.open) this.#dialog.close();
  }

  destroy(): void {
    this.close();
    this.#lifetime.abort();
    this.#opener = null;
  }
}
