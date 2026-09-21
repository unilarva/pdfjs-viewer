// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private owner for package-managed generated and custom print setup dialogs.
 * The owner binds one dialog lifetime and delegates PDF policy and work to the
 * public viewer callbacks supplied by the facade. This is not a supported consumer
 * subpath or package-root export. See the
 * [architecture guide](../ARCHITECTURE.md) for its ownership boundary.
 * @packageDocumentation
 * @module viewer-print-setup
 */

import type {
  PdfjsViewerFormatters,
  PdfjsViewerLabels,
  PdfjsViewerPrintOptions,
  PdfjsViewerNormalizedPrintDefaults,
  PdfjsViewerPrintPreflightResult,
  PdfjsViewerPrintResult,
  PdfjsViewerPrintSourceResult,
  PdfjsViewerPrintState,
  PdfjsViewerUiBindings,
} from "./viewer-contracts.js";
import { PDFJS_VIEWER_PRINT_DEFAULTS } from "./viewer-contracts.js";
import { parsePrintPageRanges } from "./print-sheet-planner.js";
import { ViewerDialog } from "./viewer-dialog.js";

interface ViewerPrintSetupCallbacks {
  readonly generation: () => number;
  readonly pageCount: () => number;
  readonly state: () => Readonly<PdfjsViewerPrintState>;
  readonly routeSelected: () => void;
  readonly closeTransientUi: () => HTMLElement | null;
  readonly preflight: (
    options: PdfjsViewerPrintOptions,
  ) => Promise<PdfjsViewerPrintPreflightResult>;
  readonly print: (options: PdfjsViewerPrintOptions) => Promise<PdfjsViewerPrintResult>;
  readonly openSource: (options: PdfjsViewerPrintOptions) => Promise<PdfjsViewerPrintSourceResult>;
  readonly cancelPreparation: () => void;
  readonly failed: (error: unknown) => void;
}

type PrintSetupBindings = Required<NonNullable<PdfjsViewerUiBindings["printSetup"]>>;
type DiscoveredPrintSetupBindings = {
  [Name in keyof PrintSetupBindings]: PrintSetupBindings[Name] | null;
};

function requirePrintBindings(
  bindings: Readonly<Partial<DiscoveredPrintSetupBindings>>,
): PrintSetupBindings {
  for (const [name, element] of Object.entries(bindings)) {
    if (!element) throw new Error(`PdfjsViewer: required print setup binding missing: ${name}`);
  }
  const names: Array<keyof PrintSetupBindings> = [
    "dialog",
    "form",
    "pages",
    "range",
    "rangeWrap",
    "layout",
    "side",
    "sideSelect",
    "more",
    "sheet",
    "customSheet",
    "customSheetWidth",
    "customSheetHeight",
    "customSheetUnit",
    "pageScaling",
    "orientation",
    "quality",
    "status",
    "progress",
    "guidance",
    "fallbackWarning",
    "close",
    "cancel",
    "source",
    "submit",
    "submitDetail",
  ];
  for (const name of names) {
    if (!bindings[name])
      throw new Error(`PdfjsViewer: required print setup binding missing: ${name}`);
  }
  return bindings as PrintSetupBindings;
}

/** Owns exactly one print setup dialog and its listener lifetime. */
export class ViewerPrintSetup {
  readonly #action: HTMLButtonElement;
  readonly #dialog: HTMLDialogElement;
  #labels: Readonly<PdfjsViewerLabels>;
  #formatters: Readonly<PdfjsViewerFormatters>;
  readonly #callbacks: ViewerPrintSetupCallbacks;
  readonly #lifetime = new AbortController();
  readonly #form: HTMLFormElement;
  readonly #pages: HTMLSelectElement;
  readonly #range: HTMLInputElement;
  readonly #rangeWrap: HTMLElement;
  readonly #layout: HTMLSelectElement;
  readonly #side: HTMLElement;
  readonly #sideSelect: HTMLSelectElement;
  readonly #more: HTMLDetailsElement;
  readonly #sheet: HTMLSelectElement;
  readonly #customSheet: HTMLElement;
  readonly #customSheetWidth: HTMLInputElement;
  readonly #customSheetHeight: HTMLInputElement;
  readonly #customSheetUnit: HTMLSelectElement;
  readonly #pageScaling: HTMLSelectElement;
  readonly #orientation: HTMLSelectElement;
  readonly #quality: HTMLSelectElement;
  readonly #status: HTMLElement;
  readonly #progress: HTMLProgressElement;
  readonly #guidance: HTMLElement;
  readonly #warning: HTMLElement;
  readonly #source: HTMLButtonElement;
  readonly #submit: HTMLButtonElement;
  readonly #submitDetail: HTMLElement;
  readonly #closeButton: HTMLButtonElement;
  readonly #cancelButton: HTMLButtonElement;
  readonly #modal: ViewerDialog;
  readonly #defaults: PdfjsViewerNormalizedPrintDefaults;
  #documentGeneration = -1;
  #request = 0;
  #preparation: AbortController | null = null;
  #lastPreflight: Readonly<{
    result: PdfjsViewerPrintPreflightResult;
    options: PdfjsViewerPrintOptions;
  }> | null = null;
  #installedProgressAriaLabel = false;
  #invalidFeedback = false;

  constructor(
    action: HTMLButtonElement,
    bindings: Readonly<Partial<DiscoveredPrintSetupBindings>>,
    labels: Readonly<PdfjsViewerLabels>,
    formatters: Readonly<PdfjsViewerFormatters>,
    callbacks: ViewerPrintSetupCallbacks,
    defaults: PdfjsViewerNormalizedPrintDefaults = PDFJS_VIEWER_PRINT_DEFAULTS,
  ) {
    this.#action = action;
    const print = requirePrintBindings(bindings);
    this.#dialog = print.dialog;
    this.#labels = labels;
    this.#formatters = formatters;
    this.#callbacks = callbacks;
    this.#defaults = defaults;
    this.#form = print.form;
    this.#pages = print.pages;
    this.#range = print.range;
    this.#rangeWrap = print.rangeWrap;
    this.#layout = print.layout;
    this.#side = print.side;
    this.#sideSelect = print.sideSelect;
    this.#more = print.more;
    this.#sheet = print.sheet;
    this.#customSheet = print.customSheet;
    this.#customSheetWidth = print.customSheetWidth;
    this.#customSheetHeight = print.customSheetHeight;
    this.#customSheetUnit = print.customSheetUnit;
    for (const input of [this.#range, this.#customSheetWidth, this.#customSheetHeight])
      input.setAttribute("enterkeyhint", "done");
    this.#pageScaling = print.pageScaling;
    this.#orientation = print.orientation;
    this.#quality = print.quality;
    this.#status = print.status;
    this.#progress = print.progress;
    if (
      !this.#progress.hasAttribute("aria-label") &&
      !this.#progress.hasAttribute("aria-labelledby")
    ) {
      this.#progress.setAttribute("aria-label", labels.printProgress);
      this.#installedProgressAriaLabel = true;
    }
    this.#guidance = print.guidance;
    this.#warning = print.fallbackWarning;
    this.#source = print.source;
    this.#submit = print.submit;
    this.#submitDetail = print.submitDetail;
    this.#closeButton = print.close;
    this.#cancelButton = print.cancel;
    this.#modal = new ViewerDialog(this.#dialog, { requestClose: () => this.#close(true) });
    this.#bind();
    this.resetDocument();
  }

  destroy(): void {
    this.#invalidate(true);
    this.#modal.destroy();
    this.#lifetime.abort();
  }

  /** Repaints package-owned text without changing dialog state or print work. */
  setUiText(
    labels: Readonly<PdfjsViewerLabels>,
    formatters: Readonly<PdfjsViewerFormatters>,
  ): void {
    this.#labels = labels;
    this.#formatters = formatters;
    if (this.#installedProgressAriaLabel)
      this.#progress.setAttribute("aria-label", labels.printProgress);
    const state = this.#callbacks.state();
    if (state.phase === "preparing" || state.phase === "preflight") {
      this.#renderPreparing(state);
    } else if (this.#invalidFeedback) {
      this.#renderInvalid();
    } else if (this.#lastPreflight) {
      this.#apply(this.#lastPreflight.result, this.#lastPreflight.options);
    }
  }

  resetDocument(): void {
    this.#invalidate(true);
    this.#form.reset();
    this.#applyDefaults();
    this.#range.value = "";
    this.#more.open = false;
    this.#documentGeneration = -1;
    this.#lastPreflight = null;
    this.#invalidFeedback = false;
    this.#updateAvailability();
    this.#clearFeedback();
  }

  syncState(): void {
    if (!this.#dialog.open) return;
    const state = this.#callbacks.state();
    const preparing = state.phase === "preparing" || state.phase === "preflight";
    this.#progress.hidden = !preparing;
    this.#progress.max = Math.max(1, state.totalSheets);
    this.#progress.value = state.completedSheets;
    if (preparing && state.totalSheets) {
      this.#renderPreparing(state);
      return;
    }
    this.#preflight();
  }

  #bind(): void {
    const signal = this.#lifetime.signal;
    this.#action.addEventListener(
      "click",
      () => {
        this.#callbacks.routeSelected();
        this.#open();
      },
      { signal },
    );
    this.#form.addEventListener(
      "change",
      event => {
        if (event.target === this.#layout && this.#layout.value !== "single")
          this.#orientation.value = "auto";
        this.#updateAvailability();
        this.#preflight();
      },
      { signal },
    );
    this.#form.addEventListener(
      "input",
      event => {
        if (
          event.target === this.#range ||
          event.target === this.#customSheetWidth ||
          event.target === this.#customSheetHeight
        )
          this.#preflight();
      },
      { signal },
    );
    this.#form.addEventListener(
      "keydown",
      event => {
        if (event.key !== "Enter" || event.isComposing) return;
        const target = event.target;
        const input =
          target === this.#range
            ? this.#range
            : target === this.#customSheetWidth
              ? this.#customSheetWidth
              : target === this.#customSheetHeight
                ? this.#customSheetHeight
                : null;
        if (!input) return;
        event.preventDefault();
        input.blur();
      },
      { signal },
    );
    this.#form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        void this.#submitPrint().catch(this.#callbacks.failed);
      },
      { signal },
    );
    this.#closeButton.addEventListener("click", () => this.#close(true), { signal });
    this.#cancelButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        this.#close(true);
      },
      { signal },
    );
    this.#source.addEventListener(
      "click",
      () => {
        let options: PdfjsViewerPrintOptions;
        try {
          options = this.#options();
        } catch {
          this.#invalid();
          return;
        }
        void this.#callbacks
          .openSource(options)
          .then(result => {
            if (result.ok) this.#dialog.close();
          })
          .catch(this.#callbacks.failed);
      },
      { signal },
    );
    this.#dialog.addEventListener("cancel", () => this.#invalidate(true), { signal });
    this.#dialog.addEventListener(
      "close",
      () => {
        this.#invalidate(false);
      },
      { signal },
    );
  }

  #open(): void {
    const opener = this.#callbacks.closeTransientUi();
    const generation = this.#callbacks.generation();
    if (this.#documentGeneration !== generation) {
      this.resetDocument();
      this.#documentGeneration = generation;
    }
    this.#modal.open(opener, this.#pages);
    this.#preflight();
  }

  #close(cancel: boolean): void {
    this.#invalidate(cancel);
    this.#modal.close();
  }

  #invalidate(cancel: boolean): void {
    this.#request++;
    this.#preparation?.abort();
    this.#preparation = null;
    if (cancel) this.#callbacks.cancelPreparation();
  }

  #setAvailable(
    element: HTMLElement,
    controls: readonly (HTMLInputElement | HTMLSelectElement)[],
    available: boolean,
  ): void {
    element.hidden = !available;
    element.inert = !available;
    element.setAttribute("aria-hidden", String(!available));
    for (const control of controls) control.disabled = !available;
  }

  #updateAvailability(): void {
    this.#setAvailable(this.#rangeWrap, [this.#range], this.#pages.value === "custom");
    this.#setAvailable(this.#side, [this.#sideSelect], this.#layout.value === "spread");
    this.#setAvailable(
      this.#customSheet,
      [this.#customSheetWidth, this.#customSheetHeight, this.#customSheetUnit],
      this.#sheet.value === "custom",
    );
  }

  #applyDefaults(): void {
    const sheet = this.#defaults.sheet;
    if (typeof sheet === "string") {
      this.#sheet.value = sheet;
    } else {
      this.#sheet.value = "custom";
      this.#customSheetWidth.value = String(sheet.width);
      this.#customSheetHeight.value = String(sheet.height);
      this.#customSheetUnit.value = sheet.unit;
    }
    this.#pageScaling.value = this.#defaults.pageScaling;
    this.#orientation.value = this.#defaults.orientation;
    this.#quality.value = String(this.#defaults.quality.dpi);
    for (const [name, control] of [
      ["sheet", this.#sheet],
      ["pageScaling", this.#pageScaling],
      ["orientation", this.#orientation],
      ["quality", this.#quality],
    ] as const) {
      if (!control.value)
        throw new Error(`PdfjsViewer: print setup cannot represent configured default ${name}`);
    }
  }

  #options(signal?: AbortSignal): PdfjsViewerPrintOptions {
    const mode = this.#layout.value as "auto" | "single" | "spread";
    const sheet = this.#sheet.value;
    const unit = this.#customSheetUnit.value as "pt" | "mm" | "in";
    const quality = this.#quality.value;
    return {
      pages:
        this.#pages.value === "custom"
          ? parsePrintPageRanges(this.#range.value, this.#callbacks.pageCount())
          : "all",
      layout:
        mode === "spread"
          ? { mode, firstPageSide: this.#sideSelect.value as "auto" | "left" | "right" }
          : { mode },
      sheet:
        sheet === "custom"
          ? {
              width: Number(this.#customSheetWidth.value),
              height: Number(this.#customSheetHeight.value),
              unit,
            }
          : (sheet as "a3" | "a4" | "a5" | "letter" | "legal"),
      pageScaling: this.#pageScaling.value as "fit" | "shrink-to-fit",
      orientation: this.#orientation.value as "auto" | "portrait" | "landscape",
      quality: { dpi: Number(quality) },
      ...(signal ? { signal } : {}),
    };
  }

  #preflight(): void {
    if (!this.#dialog.open || this.#callbacks.state().phase !== "idle") return;
    const request = ++this.#request;
    let options: PdfjsViewerPrintOptions;
    try {
      options = this.#options();
    } catch {
      this.#invalid();
      return;
    }
    this.#submit.disabled = true;
    void this.#callbacks
      .preflight(options)
      .then(result => {
        if (request === this.#request && this.#dialog.open) this.#apply(result, options);
      })
      .catch(error => {
        if (request !== this.#request || !this.#dialog.open) return;
        this.#callbacks.failed(error);
        this.#invalid();
      });
  }

  async #submitPrint(): Promise<void> {
    const controller = new AbortController();
    this.#preparation?.abort();
    this.#preparation = controller;
    let options: PdfjsViewerPrintOptions;
    try {
      options = this.#options(controller.signal);
    } catch {
      this.#invalid();
      return;
    }
    const request = ++this.#request;
    const preflight = await this.#callbacks.preflight(options);
    if (request !== this.#request || !this.#dialog.open || controller.signal.aborted) return;
    this.#apply(preflight, options);
    if (!preflight.ok) return;
    this.#submit.disabled = true;
    this.#guidance.textContent = this.#labels.printPreparationCancelGuidance;
    const result = await this.#callbacks.print({
      ...options,
      quality: { dpi: preflight.resolvedDpi },
    });
    if (this.#preparation === controller) this.#preparation = null;
    if (result.ok) this.#dialog.close();
    else if (this.#dialog.open && !controller.signal.aborted) this.#preflight();
  }

  #apply(result: PdfjsViewerPrintPreflightResult, options: PdfjsViewerPrintOptions): void {
    this.#lastPreflight = Object.freeze({ result, options });
    this.#invalidFeedback = false;
    const busy = this.#callbacks.state().phase !== "idle";
    if (result.ok) {
      const pages =
        options.pages === "all" || options.pages === undefined
          ? this.#labels.printAllPages
          : options.pages
              .map(range =>
                range.from === range.to ? String(range.from) : `${range.from}-${range.to}`,
              )
              .join(", ");
      this.#status.textContent = this.#formatters.printSummary({
        pages,
        sheetCount: result.sheetCount,
        orientation: result.orientation,
        layout: result.layout,
        dpi: result.resolvedDpi,
      });
      this.#submitDetail.textContent = result.reduced
        ? this.#formatters.printReducedQuality(result.resolvedDpi)
        : "";
      this.#submit.disabled = busy;
      this.#source.hidden = !result.reduced || !result.sourceFallbackAvailable;
    } else {
      this.#status.textContent =
        result.reason === "unsupported"
          ? this.#labels.printUnsupportedPlatform
          : result.reason === "too-many-sheets"
            ? this.#formatters.printSheetLimitExceeded(result.sheetCount, result.maxSheets)
            : result.reason === "memory-limit"
              ? this.#labels.printMemoryLimitExceeded
              : result.reason === "too-large"
                ? this.#labels.printPreparationUnavailable
                : "";
      this.#submitDetail.textContent = "";
      this.#submit.disabled = true;
      this.#source.hidden = !result.sourceFallbackAvailable;
    }
    const orientation = result.ok ? result.orientation : this.#orientation.value;
    const guidance = [
      result.ok ? this.#labels.printSystemDialogGuidance : "",
      result.ok &&
      orientation === "landscape" &&
      result.nativeCapabilities.nativePrintSupport === "portrait"
        ? this.#labels.printKeepPortraitGuidance
        : "",
      result.ok
        ? orientation === "landscape"
          ? this.#labels.printDuplexLandscapeFlipGuidance
          : this.#labels.printDuplexPortraitFlipGuidance
        : "",
      result.ok && result.reduced
        ? this.#formatters.printReducedExplanation(result.resolvedDpi)
        : "",
    ].filter(Boolean);
    this.#guidance.textContent = guidance.join(" ");
    const warnings = [
      !this.#source.hidden && options.pages !== undefined && options.pages !== "all"
        ? this.#labels.printSourceRangeWarning
        : "",
      !this.#source.hidden && result.layerWarning ? this.#labels.printSourceLayerWarning : "",
      !this.#source.hidden && result.paritySensitive ? this.#labels.printSourceParityWarning : "",
      !this.#source.hidden && result.ok && result.reduced
        ? this.#labels.printSourceQualityWarning
        : "",
    ].filter(Boolean);
    this.#warning.textContent = warnings.join(" ");
    this.#warning.hidden = warnings.length === 0;
  }

  #invalid(): void {
    this.#request++;
    this.#lastPreflight = null;
    this.#invalidFeedback = true;
    this.#renderInvalid();
  }

  #renderInvalid(): void {
    this.#status.textContent = this.#labels.printRangeInvalid.replace(
      "{pageCount}",
      String(this.#callbacks.pageCount()),
    );
    this.#submit.disabled = true;
    this.#source.hidden = true;
    this.#warning.hidden = true;
    this.#guidance.textContent = "";
    this.#submitDetail.textContent = "";
  }

  #clearFeedback(): void {
    this.#invalidFeedback = false;
    this.#status.textContent = "";
    this.#progress.hidden = true;
    this.#progress.value = 0;
    this.#guidance.textContent = "";
    this.#warning.textContent = "";
    this.#warning.hidden = true;
    this.#source.hidden = true;
    this.#submitDetail.textContent = "";
  }

  #renderPreparing(state: Readonly<PdfjsViewerPrintState>): void {
    if (!this.#dialog.open) return;
    this.#progress.hidden = false;
    this.#progress.max = Math.max(1, state.totalSheets);
    this.#progress.value = state.completedSheets;
    this.#status.textContent = state.totalSheets
      ? this.#formatters.printProgress(state.completedSheets, state.totalSheets)
      : "";
    this.#submit.disabled = true;
    this.#guidance.textContent = this.#labels.printPreparationCancelGuidance;
  }
}
