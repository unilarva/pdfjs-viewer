// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for annotation-derived page presentation.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * The owner filters every annotation and action before invoking the runtime-injected
 * PDF.js `AnnotationLayer`. Raster appearances remain authoritative; this layer adds
 * only supported links, read-only markup fallback/interaction, popups, and page-local
 * attachment actions. Exact renderer surface, raster, canvas-map, optional-content,
 * and generation identity govern publication and in-place viewport updates.
 * See the [architecture guide](../ARCHITECTURE.md) for authoritative owner boundaries.
 *
 * @packageDocumentation
 * @module document-presentation
 */

import type * as PDFJS from "pdfjs-dist";
import type {
  PdfjsViewerAnnotationLinkFeatureOptions,
  PdfjsViewerAnnotationMarkupFeatureOptions,
  PdfjsViewerFormsFeatureOptions,
} from "./viewer-contracts.js";
import type { DocumentLayersSetOCGStateAction } from "./document-layers.js";
import type { RenderPresentationContext, RenderSurfaceLease } from "./document-renderer.js";
import type {
  DocumentXfaPrintAdmission,
  DocumentXfaPrintAdmissionLimits,
  DocumentXfaPrintSnapshot,
} from "./document-xfa-print.js";
import { DocumentFormState, type DocumentFormPresentation } from "./document-form-state.js";
import {
  cloneXfaStructure,
  materializeXfaStructure,
  type XfaStructuralNode,
} from "./xfa-value-snapshot.js";
import {
  annotationUrlProtocol,
  safeAnnotationUrl,
  type PdfDestinationInput,
} from "./pdf-destinations.js";
import {
  createPdfjsAnnotationLayer,
  renderPdfjsAnnotationLayer,
  renderPdfjsXfaLayer,
  updatePdfjsAnnotationLayer,
  updatePdfjsXfaLayer,
  type PdfjsAnnotationLayerInstance,
} from "./pdfjs-compatibility.js";

const ANNOTATION_TYPE = Object.freeze({
  TEXT: 1,
  LINK: 2,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12,
  STAMP: 13,
  INK: 15,
  POPUP: 16,
  FILEATTACHMENT: 17,
  WIDGET: 20,
});
const MARKUP_TYPES = new Set<number>([
  ANNOTATION_TYPE.TEXT,
  ANNOTATION_TYPE.FREETEXT,
  ANNOTATION_TYPE.HIGHLIGHT,
  ANNOTATION_TYPE.UNDERLINE,
  ANNOTATION_TYPE.SQUIGGLY,
  ANNOTATION_TYPE.STRIKEOUT,
  ANNOTATION_TYPE.STAMP,
  ANNOTATION_TYPE.INK,
]);
const NAMED_NAVIGATION_ACTIONS = new Set([
  "FirstPage",
  "LastPage",
  "NextPage",
  "PrevPage",
  "PageDown",
  "PageUp",
]);
const OCG_OPERATORS = new Set(["ON", "OFF", "Toggle"]);

/** Auditable action ownership applied before annotation data reaches PDF.js. */
const ANNOTATION_ACTION_POLICY = Object.freeze({
  externalUrl: "annotationLinks.externalUrls",
  internalDestination: "annotationLinks.internalDestinations",
  namedNavigation: "annotationLinks.internalDestinations",
  optionalContent: "features.layers",
  pageAttachment: "annotationMarkup.fileAttachments",
  print: "blocked",
  saveAs: "blocked",
  resetForm: "DocumentPresentation.resetForms",
  submitOrNetwork: "blocked",
  richMedia: "blocked",
  scripting: "blocked",
});

const SAFE_ANNOTATION_ICON_PATH =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23f5c542' stroke='%235c4a00' d='M3 3h18v14H8l-5 4z'/%3E%3C/svg%3E#";

type AnnotationLike = Readonly<Record<string, unknown>> & {
  readonly annotationType?: number;
  readonly subtype?: string;
  readonly id?: string;
  readonly popupRef?: string | null;
  readonly url?: string;
  readonly dest?: PdfDestinationInput;
  readonly action?: string;
  readonly attachmentId?: string;
  readonly attachment?: unknown;
  readonly setOCGState?: unknown;
  readonly fieldName?: string;
  readonly fieldType?: string;
  readonly pushButton?: boolean;
};

type OptionalContentConfig = Awaited<
  NonNullable<RenderPresentationContext["rasterState"]["optionalContentConfigPromise"]>
>;

/** Runtime-injected PDF.js display-layer constructor used without a second module identity. */
type DocumentPresentationAnnotationLayer = typeof PDFJS.AnnotationLayer;
type DocumentPresentationXfaLayer = typeof PDFJS.XfaLayer;
interface DocumentPresentationDestinationIntent {
  readonly destination: PdfDestinationInput;
}

interface DocumentPresentationDiagnostic {
  readonly event: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
}

interface DocumentPresentationCallbacks {
  readonly internalDestination?: (
    intent: Readonly<DocumentPresentationDestinationIntent>,
  ) => void | Promise<void>;
  readonly namedNavigation?: (action: string) => void | Promise<void>;
  readonly setOptionalContent?: (
    action: Readonly<DocumentLayersSetOCGStateAction>,
  ) => void | Promise<unknown>;
  readonly attachmentContent?: (id: string) => Promise<Uint8Array | null>;
  readonly diagnostic?: (entry: Readonly<DocumentPresentationDiagnostic>) => void;
  readonly dirtyChanged?: (dirty: boolean) => void;
  readonly formStateChanged?: () => void;
  readonly formAppearanceChanged?: (pageNo: number, revision: number) => void;
  readonly requestFormPage?: (pageNo: number) => void;
}

interface DocumentPresentationOptions {
  readonly ownerDocument?: Document;
  readonly AnnotationLayer: DocumentPresentationAnnotationLayer;
  readonly XfaLayer?: DocumentPresentationXfaLayer;
  readonly annotationLinkLabel: string;
  readonly annotationCommentLabel: string;
  readonly annotationAttachmentLabel: string;
  readonly annotationAttachmentErrorLabel: string;
  readonly xfaUnavailableLabel: string;
  readonly xfaHybridFallbackLabel: string;
  readonly optionalContentActions: boolean;
  readonly links: Required<PdfjsViewerAnnotationLinkFeatureOptions>;
  readonly markup: Readonly<
    { enabled: boolean } & Required<PdfjsViewerAnnotationMarkupFeatureOptions>
  >;
  readonly forms: Required<PdfjsViewerFormsFeatureOptions>;
}

interface PresentedLayer {
  readonly documentId: number;
  readonly page: PDFJS.PDFPageProxy;
  lease: Readonly<RenderSurfaceLease>;
  readonly element: HTMLDivElement;
  readonly instance: PdfjsAnnotationLayerInstance;
  readonly annotations: readonly unknown[];
  readonly annotationCanvasMap: Map<string, HTMLCanvasElement>;
  readonly optionalContentConfigPromise?: RenderPresentationContext["rasterState"]["optionalContentConfigPromise"];
  readonly optionalContentConfig?: OptionalContentConfig;
  readonly optionalContentRevision: number;
  readonly annotationMode: number;
  readonly policy: object;
  readonly generation: number;
  published: boolean;
  destroyed: boolean;
  evictionPending: boolean;
}

interface PresentedXfaLayer {
  readonly documentId: number;
  readonly page: PDFJS.PDFPageProxy;
  lease: Readonly<RenderSurfaceLease>;
  readonly element: HTMLDivElement;
  readonly xfaHtml: XfaStructuralNode | null;
  readonly linkService: DocumentPresentationLinkService;
  readonly policy: object;
  readonly generation: number;
  published: boolean;
  destroyed: boolean;
  evictionPending: boolean;
}

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;

interface FormControlSnapshot {
  readonly order: number;
  readonly value?: string;
  readonly checked?: boolean;
  readonly selectedValues?: readonly string[];
  readonly selectionStart?: number | null;
  readonly selectionEnd?: number | null;
  readonly selectionDirection?: "forward" | "backward" | "none" | null;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

interface FormLayerSnapshot {
  readonly controls: readonly FormControlSnapshot[];
  readonly focusedOrder: number | null;
}

/** Narrow package-owned contract consumed by supported PDF.js annotation data. */
interface DocumentPresentationLinkService {
  readonly eventBus: null;
  addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow?: boolean): void;
  getDestinationHash(destination: PdfDestinationInput): string;
  getAnchorUrl(anchor: string): string;
  goToDestination(destination: PdfDestinationInput): void;
  executeNamedAction(action: string): void;
  executeSetOCGState(state: unknown): void;
  getAttachmentContent(id: string): Promise<Uint8Array | null>;
}

export class DocumentPresentation {
  static #nextNamespace = 0;
  #AnnotationLayer: DocumentPresentationAnnotationLayer;
  #XfaLayer: DocumentPresentationXfaLayer | null;
  #options: Readonly<Omit<DocumentPresentationOptions, "AnnotationLayer">>;
  #policy: object;
  #callbacks: DocumentPresentationCallbacks;
  #layers = new Map<number, PresentedLayer>();
  #pending = new Set<PresentedLayer>();
  #xfaLayers = new Map<number, PresentedXfaLayer>();
  #pendingXfa = new Set<PresentedXfaLayer>();
  #resourceUrls = new Set<string>();
  #resourceTimers = new Map<string, number>();
  #generation = 0;
  #namespace = `pdf-form-${++DocumentPresentation.#nextNamespace}-`;
  #pdf: PDFJS.PDFDocumentProxy | null = null;
  #formState: DocumentFormState;
  #storageAdapter: PDFJS.PDFDocumentProxy["annotationStorage"] | null = null;
  #pendingFocus: Readonly<{ order: number; direction: 1 | -1 }> | null = null;
  #retainedControlState = new Map<number, FormLayerSnapshot>();
  #document: Document | null = null;

  constructor(
    options: Readonly<DocumentPresentationOptions>,
    callbacks: DocumentPresentationCallbacks = {},
  ) {
    this.#document = options.ownerDocument ?? null;
    this.#AnnotationLayer = options.AnnotationLayer;
    this.#XfaLayer = options.XfaLayer ?? null;
    this.#options = Object.freeze({
      annotationLinkLabel: options.annotationLinkLabel,
      annotationCommentLabel: options.annotationCommentLabel ?? "Annotation comment",
      annotationAttachmentLabel: options.annotationAttachmentLabel ?? "Open attached file",
      annotationAttachmentErrorLabel:
        options.annotationAttachmentErrorLabel ?? "Attached file unavailable",
      xfaUnavailableLabel: options.xfaUnavailableLabel ?? "XFA form unavailable",
      xfaHybridFallbackLabel:
        options.xfaHybridFallbackLabel ?? "Hybrid XFA is using its AcroForm fallback",
      optionalContentActions: options.optionalContentActions ?? false,
      links: Object.freeze({ ...options.links }),
      markup: Object.freeze({ ...options.markup }),
      forms: Object.freeze({ ...options.forms }),
    });
    this.#policy = Object.freeze({
      links: this.#options.links,
      markup: this.#options.markup,
      forms: this.#options.forms,
    });
    this.#callbacks = callbacks;
    this.#formState = new DocumentFormState(this.#options.forms, {
      dirtyChanged: dirty => this.#callbacks.dirtyChanged?.(dirty),
      appearanceChanged: pages => {
        for (const pageNo of pages) {
          try {
            this.#callbacks.formAppearanceChanged?.(
              pageNo,
              this.#formState.appearanceRevision(pageNo),
            );
          } catch {}
        }
      },
      stateChanged: () => {
        if (this.#formState.presentation === "hybrid-acroform-fallback") {
          this.#diagnostic("xfa-hybrid-acroform-fallback", this.#options.xfaHybridFallbackLabel, {
            hasAcroForm: true,
            xfaEnabled: this.#options.forms.xfa,
          });
        }
        try {
          this.#callbacks.formStateChanged?.();
        } catch {}
      },
      diagnostic: (event, error) =>
        this.#diagnostic(event, "Interactive form preparation is unavailable", {}, error),
    });
  }

  get annotationsEnabled(): boolean {
    return (
      this.#options.markup.enabled ||
      this.#options.links.internalDestinations ||
      this.#options.links.externalUrls ||
      this.#options.forms.interactive ||
      this.#options.forms.xfa
    );
  }

  get formDirty(): boolean {
    return this.#formState.dirty;
  }
  get formsEnabled(): boolean {
    return this.#options.forms.interactive && this.#formState.available;
  }
  get formPresentation(): DocumentFormPresentation {
    return this.#formState.presentation;
  }

  /** Updates package-installed fallback text without rerendering PDF.js-owned markup. */
  setUiText(
    labels: Pick<
      DocumentPresentationOptions,
      | "annotationLinkLabel"
      | "annotationCommentLabel"
      | "annotationAttachmentLabel"
      | "annotationAttachmentErrorLabel"
      | "xfaUnavailableLabel"
      | "xfaHybridFallbackLabel"
    >,
  ): void {
    this.#options = Object.freeze({ ...this.#options, ...labels });
    for (const layer of this.#xfaLayers.values()) {
      if (!layer.xfaHtml) {
        layer.element.textContent = labels.xfaUnavailableLabel!;
        layer.element.setAttribute("aria-label", labels.xfaUnavailableLabel!);
      }
    }
    for (const layer of this.#layers.values())
      this.#refreshOwnedFallbackLabels(layer.element, labels);
  }

  /** Prepares optional form state without making it part of document renderability. */
  beginDocument(pdf: PDFJS.PDFDocumentProxy): Promise<void> {
    this.reset();
    this.#pdf = pdf;
    try {
      const preparation = this.#formState.beginDocument(pdf);
      void preparation.catch(error => {
        if (this.#pdf !== pdf) return;
        this.#diagnostic(
          "form-preparation-failed",
          "Interactive form preparation is unavailable",
          {},
          error,
        );
        try {
          this.#callbacks.formStateChanged?.();
        } catch {}
      });
      this.#storageAdapter = this.#formState.createStorageAdapter(this.#namespace);
      return preparation;
    } catch (error) {
      this.#formState.reset();
      this.#diagnostic(
        "form-preparation-failed",
        "Interactive form preparation is unavailable",
        {},
        error,
      );
      return Promise.resolve();
    }
  }

  /** Immutable pure-XFA print-preparation boundary consumed by `DocumentPrint`. */
  xfaPrintAdmission(
    pageNumbers: readonly number[],
    limits: Readonly<DocumentXfaPrintAdmissionLimits>,
  ): DocumentXfaPrintAdmission | null {
    return this.#formState.xfaPrintAdmission(pageNumbers, limits);
  }

  xfaPrintSnapshot(admission?: DocumentXfaPrintAdmission): DocumentXfaPrintSnapshot | null {
    return this.#XfaLayer ? this.#formState.xfaPrintSnapshot(this.#XfaLayer, admission) : null;
  }

  nativePrintStorage(): PDFJS.PDFDocumentProxy["annotationStorage"]["print"] | null {
    return this.#formState.nativePrintStorage();
  }

  get formRevision(): number {
    return this.#formState.revision;
  }

  /** Frozen exact storage snapshot for one admitted thumbnail render. */
  thumbnailStorage(
    pageNo: number,
    revision: number,
  ): PDFJS.PDFDocumentProxy["annotationStorage"]["print"] | null {
    return this.#formState.printStorage(pageNo, revision);
  }

  formAppearanceRevision(pageNo: number): number {
    return this.#formState.appearanceRevision(pageNo);
  }

  /** Restores every indexed field to the value loaded from the PDF. */
  resetForms(): boolean {
    if (!this.#formState.resetForms()) return false;
    for (const layer of this.#layers.values()) {
      for (const control of layer.element.querySelectorAll<HTMLElement>("[data-pdf-form-id]")) {
        control.dispatchEvent(new Event("resetform"));
      }
      this.#syncFormLayerValues(layer.element);
    }
    for (const layer of this.#xfaLayers.values()) this.#syncFormLayerValues(layer.element);
    return true;
  }

  /** Shares one uncancellable PDF.js save and rejects bytes from stale ownership. */
  exportDocumentWithFormValues(): Promise<Uint8Array | null> {
    return this.#formState.exportDocumentWithFormValues();
  }

  /** Retains transient placeholders while focus or an open popup depends on the page. */
  retainsPage(pageNo: number): boolean {
    const layer = this.#layers.get(pageNo) ?? this.#xfaLayers.get(pageNo);
    if (!layer || layer.destroyed || !layer.element.isConnected) return false;
    return (
      layer.element.contains(this.#document?.activeElement ?? null) ||
      layer.element.querySelector(".pdf-annotation-popup:not([hidden])") != null
    );
  }

  reset(): readonly Promise<unknown>[] {
    const settlements = [...this.#formState.reset()];
    this.#generation++;
    for (const layer of this.#pending) this.#destroyLayer(layer);
    for (const layer of this.#layers.values()) this.#destroyLayer(layer);
    for (const layer of this.#pendingXfa) this.#destroyXfaLayer(layer);
    for (const layer of this.#xfaLayers.values()) this.#destroyXfaLayer(layer);
    this.#pending.clear();
    this.#layers.clear();
    this.#pendingXfa.clear();
    this.#xfaLayers.clear();
    for (const timer of this.#resourceTimers.values())
      this.#document?.defaultView?.clearTimeout(timer);
    this.#resourceTimers.clear();
    const ownerWindow = this.#document?.defaultView;
    if (ownerWindow) for (const url of this.#resourceUrls) ownerWindow.URL.revokeObjectURL(url);
    this.#resourceUrls.clear();
    this.#pdf = null;
    this.#storageAdapter = null;
    this.#pendingFocus = null;
    this.#retainedControlState.clear();
    return settlements;
  }

  evict(pageNo: number, lease: Readonly<RenderSurfaceLease>): void {
    for (const layer of this.#pending) {
      if (layer.lease.pageNo === pageNo && this.#sameLease(layer.lease, lease)) {
        this.#pending.delete(layer);
        this.#destroyLayer(layer);
      }
    }
    for (const layer of this.#pendingXfa) {
      if (layer.lease.pageNo === pageNo && this.#sameLease(layer.lease, lease)) {
        this.#pendingXfa.delete(layer);
        this.#destroyXfaLayer(layer);
      }
    }
    const layer = this.#layers.get(pageNo);
    if (layer && this.#sameLease(layer.lease, lease)) {
      if (this.retainsPage(pageNo)) {
        layer.evictionPending = true;
        return;
      }
      this.#layers.delete(pageNo);
      this.#destroyLayer(layer);
    }
    const xfaLayer = this.#xfaLayers.get(pageNo);
    if (xfaLayer && this.#sameLease(xfaLayer.lease, lease)) {
      if (this.retainsPage(pageNo)) {
        xfaLayer.evictionPending = true;
        return;
      }
      this.#xfaLayers.delete(pageNo);
      this.#destroyXfaLayer(xfaLayer);
    }
  }

  async present(context: Readonly<RenderPresentationContext>): Promise<void> {
    this.#document ??= context.lease.wrapper.ownerDocument;
    if (
      !this.annotationsEnabled ||
      !context.capabilities.annotations ||
      !context.isCurrent("annotations")
    )
      return;
    if (this.#formState.presentation === "pure-xfa") {
      await this.#presentXfa(context);
      return;
    }
    const generation = this.#generation;
    try {
      const optionalContentConfigPromise = context.rasterState.optionalContentConfigPromise;
      const [annotations, optionalContentConfig] = await Promise.all([
        context.page.getAnnotations({ intent: "display" }),
        optionalContentConfigPromise ?? Promise.resolve(undefined),
      ]);
      if (!Array.isArray(annotations))
        throw new TypeError("PDF.js returned invalid annotation data");
      if (!this.#isCurrent(context, generation)) return;
      const viewport = context.viewport.clone({ dontFlip: true });
      const existing = this.#layers.get(context.pageNo);
      if (
        existing &&
        this.#canUpdate(
          existing,
          context,
          annotations,
          optionalContentConfigPromise,
          optionalContentConfig,
          generation,
        )
      ) {
        existing.evictionPending = false;
        updatePdfjsAnnotationLayer(existing.instance, {
          viewport,
          ...(optionalContentConfig ? { optionalContentConfig } : {}),
        });
        return;
      }
      await this.#rebuild(
        context,
        annotations,
        viewport,
        optionalContentConfigPromise,
        optionalContentConfig,
        generation,
      );
    } catch (error) {
      if (!this.#isCurrent(context, generation)) return;
      this.#diagnostic(
        "annotation-presentation-failed",
        "PDF annotation presentation failed",
        {
          documentId: context.documentId,
          pageNo: context.pageNo,
          generation: context.generation,
        },
        error,
      );
    }
  }

  async #presentXfa(context: Readonly<RenderPresentationContext>): Promise<void> {
    const XfaLayer = this.#XfaLayer;
    if (!XfaLayer) return;
    const generation = this.#generation;
    try {
      const source = await context.page.getXfa();
      if (!this.#isCurrent(context, generation)) return;
      if (!source) {
        this.#diagnostic("xfa-presentation-unavailable", this.#options.xfaUnavailableLabel, {
          documentId: context.documentId,
          pageNo: context.pageNo,
        });
        this.#publishXfaUnavailable(context, generation);
        return;
      }
      const viewport = context.viewport.clone({ dontFlip: true });
      const existing = this.#xfaLayers.get(context.pageNo);
      if (
        existing?.xfaHtml &&
        !existing.destroyed &&
        existing.generation === generation &&
        existing.page === context.page &&
        existing.policy === this.#policy &&
        this.#sameLease(existing.lease, context.lease)
      ) {
        existing.evictionPending = false;
        updatePdfjsXfaLayer(XfaLayer, {
          viewport,
          div: existing.element,
          xfaHtml: existing.xfaHtml,
          annotationStorage: this.#storageAdapter ?? undefined,
          linkService: existing.linkService,
        });
        return;
      }
      const xfaHtml = materializeXfaStructure(cloneXfaStructure(source));
      this.#namespaceXfaStructure(xfaHtml);
      const element = this.#ownerDocument().createElement("div");
      const state = {} as PresentedXfaLayer;
      const linkService = this.#createLinkService(context.pageNo, state);
      Object.assign(state, {
        documentId: context.documentId,
        page: context.page,
        lease: context.lease,
        element,
        xfaHtml,
        linkService,
        policy: this.#policy,
        generation,
        published: false,
        destroyed: false,
        evictionPending: false,
      } satisfies PresentedXfaLayer);
      this.#pendingXfa.add(state);
      try {
        renderPdfjsXfaLayer(XfaLayer, {
          viewport,
          div: element,
          xfaHtml,
          annotationStorage: this.#storageAdapter ?? undefined,
          linkService,
          intent: "display",
        });
        if (state.destroyed || !this.#isCurrent(context, generation)) return;
        element.classList.add("pdf-xfa-layer");
        this.#decorateXfa(element, context.pageNo);
        if (!this.#isCurrent(context, generation)) return;
        const previous = this.#xfaLayers.get(context.pageNo);
        if (previous) this.#destroyXfaLayer(previous);
        state.published = true;
        this.#xfaLayers.set(context.pageNo, state);
        context.lease.wrapper.appendChild(element);
        this.#restorePendingFocus(element);
      } finally {
        this.#pendingXfa.delete(state);
        if (!state.published) this.#destroyXfaLayer(state);
      }
    } catch (error) {
      if (!this.#isCurrent(context, generation)) return;
      this.#diagnostic(
        "xfa-presentation-failed",
        this.#options.xfaUnavailableLabel,
        {
          documentId: context.documentId,
          pageNo: context.pageNo,
          generation: context.generation,
        },
        error,
      );
      this.#publishXfaUnavailable(context, generation);
    }
  }

  /** Publishes a visible and screen-reader-readable page when PDF.js cannot expose pure XFA. */
  #publishXfaUnavailable(context: Readonly<RenderPresentationContext>, generation: number): void {
    if (!this.#isCurrent(context, generation)) return;
    const existing = this.#xfaLayers.get(context.pageNo);
    if (
      existing &&
      !existing.destroyed &&
      existing.xfaHtml === null &&
      existing.generation === generation &&
      this.#sameLease(existing.lease, context.lease)
    )
      return;
    if (existing) this.#destroyXfaLayer(existing);
    const element = this.#ownerDocument().createElement("div");
    element.className = "pdf-xfa-layer pdf-xfa-unavailable";
    element.setAttribute("role", "status");
    element.setAttribute("aria-label", this.#options.xfaUnavailableLabel);
    element.dataset.pdfjsUiText = "xfaUnavailable";
    element.dataset.pdfjsUiTextAttribute = "textContent aria-label";
    element.textContent = this.#options.xfaUnavailableLabel;
    const state = {} as PresentedXfaLayer;
    const linkService = this.#createLinkService(context.pageNo, state);
    Object.assign(state, {
      documentId: context.documentId,
      page: context.page,
      lease: context.lease,
      element,
      xfaHtml: null,
      linkService,
      policy: this.#policy,
      generation,
      published: true,
      destroyed: false,
      evictionPending: false,
    } satisfies PresentedXfaLayer);
    this.#xfaLayers.set(context.pageNo, state);
    context.lease.wrapper.appendChild(element);
  }

  async #rebuild(
    context: Readonly<RenderPresentationContext>,
    annotations: readonly unknown[],
    viewport: PDFJS.PageViewport,
    optionalContentConfigPromise: RenderPresentationContext["rasterState"]["optionalContentConfigPromise"],
    optionalContentConfig: OptionalContentConfig | undefined,
    generation: number,
  ): Promise<void> {
    const previous = this.#layers.get(context.pageNo);
    const controlState = previous
      ? this.#captureFormLayer(previous.element, this.#retainedControlState.get(context.pageNo))
      : (this.#retainedControlState.get(context.pageNo) ?? null);
    if (previous) {
      this.#layers.delete(context.pageNo);
      this.#destroyLayer(previous);
    }
    const filtered = this.#namespaceAnnotations(
      this.#filterAnnotations(annotations, context, generation),
    );
    if (!this.#isCurrent(context, generation)) return;
    const element = this.#ownerDocument().createElement("div");
    element.className = "annotationLayer pdf-annotation-layer pdf-annotation-link-layer";
    const state = {} as PresentedLayer;
    const linkService = this.#createLinkService(context.pageNo, state);
    const annotationCanvasMap = this.#namespaceCanvasMap(context.annotationCanvasMap);
    const instance = createPdfjsAnnotationLayer(this.#AnnotationLayer, {
      div: element,
      page: context.page,
      viewport,
      linkService,
      annotationCanvasMap,
      accessibilityManager: null,
      annotationEditorUIManager: null,
      structTreeLayer: null,
      commentManager: null,
      annotationStorage: this.#storageAdapter,
    });
    Object.assign(state, {
      documentId: context.documentId,
      page: context.page,
      lease: context.lease,
      element,
      instance,
      annotations,
      annotationCanvasMap: context.annotationCanvasMap,
      optionalContentConfigPromise,
      optionalContentConfig,
      optionalContentRevision: context.rasterState.optionalContentRevision,
      annotationMode: context.rasterState.annotationMode,
      policy: this.#policy,
      generation,
      published: false,
      destroyed: false,
      evictionPending: false,
    } satisfies PresentedLayer);
    this.#pending.add(state);
    try {
      await renderPdfjsAnnotationLayer(instance, {
        viewport,
        div: element,
        annotations: filtered,
        page: context.page,
        linkService,
        downloadManager: this.#createDownloadManager(context.pageNo, state),
        imageResourcesPath: SAFE_ANNOTATION_ICON_PATH,
        renderForms: this.formsEnabled,
        enableScripting: false,
        hasJSActions: false,
        annotationStorage: this.#storageAdapter ?? undefined,
        fieldObjects: this.#namespacedFieldObjects(),
        annotationCanvasMap,
        ...(optionalContentConfig ? { optionalContentConfig } : {}),
      });
      if (state.destroyed || !this.#isCurrent(context, generation)) return;
      this.#decorate(element, context.pageNo);
      if (!this.#isCurrent(context, generation)) return;
      state.published = true;
      this.#layers.set(context.pageNo, state);
      context.lease.wrapper.appendChild(element);
      if (controlState) this.#restoreFormLayer(element, controlState);
      if (controlState?.focusedOrder != null)
        this.#retainedControlState.set(context.pageNo, controlState);
      this.#restorePendingFocus(element);
    } finally {
      this.#pending.delete(state);
      if (!state.published) this.#destroyLayer(state);
    }
  }

  #filterAnnotations(
    annotations: readonly unknown[],
    context: Readonly<RenderPresentationContext>,
    generation: number,
  ): AnnotationLike[] {
    const parents: AnnotationLike[] = [];
    const popups = new Map<string, AnnotationLike>();
    for (const value of annotations) {
      if (!value || typeof value !== "object") continue;
      const annotation = value as AnnotationLike;
      const type = this.#annotationType(annotation);
      if (type === ANNOTATION_TYPE.POPUP) {
        if (
          this.#options.markup.enabled &&
          this.#options.markup.popups &&
          typeof annotation.id === "string"
        ) {
          popups.set(annotation.id, annotation);
        }
        continue;
      }
      let safe: AnnotationLike | null = null;
      if (type === ANNOTATION_TYPE.LINK) safe = this.#filterLink(annotation, context);
      else if (this.#options.markup.enabled && MARKUP_TYPES.has(type))
        safe = this.#filterMarkup(annotation);
      else if (
        this.#options.markup.enabled &&
        this.#options.markup.fileAttachments &&
        type === ANNOTATION_TYPE.FILEATTACHMENT
      )
        safe = this.#filterAttachment(annotation);
      else if (this.formsEnabled && type === ANNOTATION_TYPE.WIDGET)
        safe = this.#filterWidget(annotation, context);
      if (safe) parents.push(safe);
      if (!this.#isCurrent(context, generation)) return parents;
    }
    if (!this.#options.markup.popups) return parents;
    const referenced = new Set(
      parents.map(item => item.popupRef).filter((id): id is string => typeof id === "string"),
    );
    return [
      ...parents,
      ...[...referenced].flatMap(id =>
        popups.has(id) ? [this.#stripUnsafe(popups.get(id)!)] : [],
      ),
    ];
  }

  #filterWidget(
    annotation: AnnotationLike,
    context: Readonly<RenderPresentationContext>,
  ): AnnotationLike | null {
    const safe = { ...this.#stripUnsafe(annotation) } as Record<string, unknown>;
    const fieldType = String(annotation.fieldType ?? "");
    if (fieldType === "Sig") safe.readOnly = true;
    if (annotation.pushButton) {
      const externalUrl =
        typeof annotation.url === "string"
          ? safeAnnotationUrl(annotation.url, this.#baseUrl())
          : null;
      if (externalUrl && this.#options.links.externalUrls) safe.url = externalUrl;
      else if (annotation.dest != null && this.#options.links.internalDestinations)
        safe.dest = annotation.dest;
      else if (
        typeof annotation.action === "string" &&
        this.#options.links.internalDestinations &&
        NAMED_NAVIGATION_ACTIONS.has(annotation.action)
      )
        safe.action = annotation.action;
      else if (
        annotation.url ||
        annotation.dest ||
        annotation.action ||
        annotation.actions ||
        annotation.resetForm
      ) {
        this.#diagnostic(
          "annotation-action-blocked",
          "Blocked an unsupported PDF form button action",
          {
            action: this.#actionCategory(annotation),
            page: context.pageNo,
          },
        );
      }
    }
    return Object.freeze(safe) as AnnotationLike;
  }

  #filterLink(
    annotation: AnnotationLike,
    context: Readonly<RenderPresentationContext>,
  ): AnnotationLike | null {
    const safe = this.#stripUnsafe(annotation);
    const externalUrl =
      typeof annotation.url === "string"
        ? safeAnnotationUrl(annotation.url, this.#baseUrl())
        : null;
    if (externalUrl && this.#options.links.externalUrls)
      return Object.freeze({ ...safe, url: externalUrl });
    if (annotation.url && !externalUrl && this.#options.links.externalUrls) {
      this.#diagnostic("annotation-url-blocked", "Blocked an unsafe PDF annotation URL", {
        protocol: annotationUrlProtocol(annotation.url, this.#baseUrl()),
        page: context.pageNo,
      });
      return null;
    }
    if (annotation.dest != null && this.#options.links.internalDestinations) {
      return Object.freeze({ ...safe, dest: annotation.dest });
    }
    if (
      typeof annotation.action === "string" &&
      this.#options.links.internalDestinations &&
      NAMED_NAVIGATION_ACTIONS.has(annotation.action)
    ) {
      return Object.freeze({ ...safe, action: annotation.action });
    }
    const ocg = this.#parseOCGAction(annotation.setOCGState);
    if (ocg && this.#options.optionalContentActions && this.#callbacks.setOptionalContent) {
      return Object.freeze({ ...safe, setOCGState: ocg });
    }
    if (
      this.#options.markup.enabled &&
      this.#options.markup.fileAttachments &&
      typeof annotation.attachmentId === "string" &&
      annotation.attachment &&
      typeof annotation.attachment === "object"
    ) {
      return Object.freeze({
        ...safe,
        attachmentId: annotation.attachmentId,
        attachment: annotation.attachment,
      });
    }
    if (
      annotation.action ||
      annotation.actions ||
      annotation.resetForm ||
      annotation.setOCGState ||
      annotation.attachment ||
      annotation.url ||
      annotation.dest
    ) {
      this.#diagnostic(
        "annotation-action-blocked",
        "Blocked an unsupported PDF annotation action",
        {
          action: this.#actionCategory(annotation),
          page: context.pageNo,
        },
      );
    }
    return null;
  }

  #filterMarkup(annotation: AnnotationLike): AnnotationLike {
    const safe = { ...this.#stripUnsafe(annotation) } as Record<string, unknown>;
    if (!this.#options.markup.popups) {
      delete safe.popupRef;
      delete safe.contentsObj;
      delete safe.richText;
      delete safe.titleObj;
      delete safe.modificationDate;
      delete safe.creationDate;
    }
    return Object.freeze(safe) as AnnotationLike;
  }

  #filterAttachment(annotation: AnnotationLike): AnnotationLike | null {
    if (
      typeof annotation.attachmentId !== "string" &&
      typeof (annotation as Record<string, unknown>).fileId !== "string"
    )
      return null;
    const safe = { ...this.#filterMarkup(annotation) } as Record<string, unknown>;
    return Object.freeze(safe) as AnnotationLike;
  }

  #stripUnsafe(annotation: AnnotationLike): AnnotationLike {
    const safe: Record<string, unknown> = { ...annotation };
    for (const key of [
      "action",
      "actions",
      "attachment",
      "attachmentDest",
      "attachmentId",
      "dest",
      "resetForm",
      "setOCGState",
      "unsafeUrl",
      "url",
      "richMedia",
    ])
      delete safe[key];
    return safe as AnnotationLike;
  }

  #createLinkService(
    pageNo: number,
    layer: PresentedLayer | PresentedXfaLayer,
  ): DocumentPresentationLinkService {
    const current = () =>
      this.#isPresentedLayer(pageNo, layer) ||
      (this.#pending.has(layer as PresentedLayer) && !layer.destroyed) ||
      (this.#pendingXfa.has(layer as PresentedXfaLayer) && !layer.destroyed);
    return Object.freeze({
      eventBus: null,
      addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
        if (!this.#options.links.externalUrls) return;
        const safeUrl = safeAnnotationUrl(url, this.#baseUrl());
        if (!safeUrl) return;
        link.href = safeUrl;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
      },
      getDestinationHash: () => "#pdf-destination",
      getAnchorUrl: (anchor: string) => `#${anchor}`,
      goToDestination: (destination: PdfDestinationInput) => {
        if (!current()) return;
        this.#invoke(layer, "annotation-navigation-failed", () =>
          this.#callbacks.internalDestination?.({ destination }),
        );
      },
      executeNamedAction: (action: string) => {
        if (!current() || !NAMED_NAVIGATION_ACTIONS.has(action)) return;
        this.#invoke(layer, "annotation-navigation-failed", () =>
          this.#callbacks.namedNavigation?.(action),
        );
      },
      executeSetOCGState: (value: unknown) => {
        const action = this.#parseOCGAction(value);
        if (!current() || !action) return;
        this.#invoke(layer, "annotation-ocg-action-failed", () =>
          this.#callbacks.setOptionalContent?.(action),
        );
      },
      getAttachmentContent: async (id: string) => {
        if (!current() || typeof id !== "string" || !id) return null;
        try {
          const content = (await this.#callbacks.attachmentContent?.(id)) ?? null;
          return current() && content instanceof Uint8Array ? content : null;
        } catch (error) {
          this.#diagnostic(
            "annotation-attachment-read-failed",
            this.#options.annotationAttachmentErrorLabel,
            {
              documentId: layer.documentId,
              pageNo: layer.lease.pageNo,
            },
            error,
          );
          return null;
        }
      },
    });
  }

  #createDownloadManager(pageNo: number, layer: PresentedLayer): object {
    return Object.freeze({
      openOrDownloadData: (content: Uint8Array, filename: string) => {
        if (!this.#isPresentedLayer(pageNo, layer) || !(content instanceof Uint8Array)) return;
        const bytes =
          content.buffer instanceof ArrayBuffer
            ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
            : Uint8Array.from(content);
        const ownerWindow = this.#ownerWindow();
        const url = ownerWindow.URL.createObjectURL(
          new ownerWindow.Blob([bytes], { type: "application/octet-stream" }),
        );
        this.#resourceUrls.add(url);
        const anchor = this.#ownerDocument().createElement("a");
        anchor.href = url;
        anchor.download = this.#safeFilename(filename);
        anchor.rel = "noopener";
        anchor.click();
        const timer = this.#ownerDocument().defaultView?.setTimeout(
          () => this.#revokeResource(url),
          0,
        );
        if (timer == null) return;
        this.#resourceTimers.set(url, timer);
      },
    });
  }

  #decorate(element: HTMLDivElement, pageNo: number): void {
    for (const link of element.querySelectorAll<HTMLAnchorElement>(".linkAnnotation > a")) {
      link.classList.add("pdf-annotation-link");
      if (!link.hasAttribute("aria-label")) {
        link.setAttribute("aria-label", this.#options.annotationLinkLabel);
        link.dataset.pdfjsUiOwnedAriaLabel = "annotationLink";
      }
    }
    for (const section of element.querySelectorAll<HTMLElement>("section")) {
      if (!section.classList.contains("linkAnnotation"))
        section.classList.add("pdf-annotation-markup");
    }
    for (const trigger of element.querySelectorAll<HTMLElement>(".popupTriggerArea")) {
      trigger.classList.add("pdf-annotation-popup-trigger");
      if (!trigger.hasAttribute("aria-label")) {
        trigger.setAttribute("aria-label", this.#options.annotationCommentLabel);
        trigger.dataset.pdfjsUiOwnedAriaLabel = "annotationComment";
      }
      const ImageElementType = this.#ownerWindow().HTMLImageElement;
      if (
        typeof ImageElementType === "function" &&
        trigger instanceof ImageElementType &&
        !trigger.alt
      ) {
        trigger.alt = this.#options.annotationCommentLabel;
        trigger.dataset.pdfjsUiOwnedAlt = "annotationComment";
      }
    }
    for (const popup of element.querySelectorAll<HTMLElement>(".popupAnnotation")) {
      popup.classList.add("pdf-annotation-popup");
    }
    for (const attachment of element.querySelectorAll<HTMLElement>(".fileAttachmentAnnotation")) {
      attachment.classList.add("pdf-annotation-file-attachment");
      if (!attachment.hasAttribute("aria-label")) {
        attachment.setAttribute("aria-label", this.#options.annotationAttachmentLabel);
        attachment.dataset.pdfjsUiOwnedAriaLabel = "annotationAttachment";
      }
    }
    if (this.formsEnabled) {
      const unused = new Set(
        this.#formState.bindings
          .filter(binding => binding.pageNo === pageNo)
          .map(binding => binding.order),
      );
      for (const control of element.querySelectorAll<HTMLElement>("[data-element-id]")) {
        const originalId = this.#originalId(control.getAttribute("data-element-id") ?? "");
        if (!originalId || !this.#formState.hasField(originalId)) continue;
        const binding = this.#formState.bindings.find(
          candidate => candidate.id === originalId && unused.has(candidate.order),
        );
        if (!binding) continue;
        unused.delete(binding.order);
        control.dataset.pdfFormId = originalId;
        control.dataset.pdfFormOrder = String(binding.order);
        control.classList.add("pdf-form-control");
        this.#ensureAccessibleName(control, originalId);
      }
      element.addEventListener("keydown", event => this.#continueTab(event), true);
      element.addEventListener("focusout", () =>
        this.#ownerWindow().queueMicrotask(() => this.#releasePendingEviction(element)),
      );
      this.#trackFormLayerState(pageNo, element);
    }
  }

  #refreshOwnedFallbackLabels(
    element: HTMLElement,
    labels: Pick<
      DocumentPresentationOptions,
      "annotationLinkLabel" | "annotationCommentLabel" | "annotationAttachmentLabel"
    >,
  ): void {
    for (const target of element.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-owned-aria-label]",
    )) {
      const key = target.dataset.pdfjsUiOwnedAriaLabel;
      if (key === "annotationLink") target.setAttribute("aria-label", labels.annotationLinkLabel);
      else if (key === "annotationComment")
        target.setAttribute("aria-label", labels.annotationCommentLabel!);
      else if (key === "annotationAttachment")
        target.setAttribute("aria-label", labels.annotationAttachmentLabel!);
    }
    for (const target of element.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-owned-alt='annotationComment']",
    )) {
      target.setAttribute("alt", labels.annotationCommentLabel!);
    }
  }

  #decorateXfa(element: HTMLDivElement, pageNo: number): void {
    for (const identified of element.querySelectorAll<HTMLElement>("[data-element-id]")) {
      const id = identified.getAttribute("data-element-id");
      if (id) identified.id = id;
    }
    for (const control of element.querySelectorAll<HTMLElement>(
      "input, textarea, select, button",
    )) {
      const domId = this.#originalId(control.getAttribute("data-element-id") ?? "");
      const storageId = this.#formState.storageIdForXfaDomId(domId);
      const binding = storageId
        ? this.#formState.bindings.find(
            candidate =>
              candidate.id === storageId &&
              candidate.pageNo === pageNo &&
              candidate.domId === domId,
          )
        : undefined;
      if (storageId) {
        control.dataset.pdfFormId = storageId;
        this.#ensureAccessibleName(control, storageId);
      }
      if (binding) control.dataset.pdfFormOrder = String(binding.order);
      control.classList.add("pdf-form-control");
      if (!this.formsEnabled) {
        const ownerWindow = this.#ownerWindow();
        if (
          control instanceof ownerWindow.HTMLInputElement ||
          control instanceof ownerWindow.HTMLTextAreaElement
        )
          control.readOnly = true;
        if (
          control instanceof ownerWindow.HTMLSelectElement ||
          control instanceof ownerWindow.HTMLButtonElement
        )
          control.disabled = true;
      }
    }
    element.addEventListener("keydown", event => this.#continueTab(event), true);
    element.addEventListener("focusout", () =>
      this.#ownerWindow().queueMicrotask(() => this.#releasePendingEviction(element)),
    );
    this.#trackFormLayerState(pageNo, element);
  }

  #syncFormLayerValues(element: HTMLElement): void {
    const ownerWindow = this.#ownerWindow();
    for (const control of element.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("[data-pdf-form-id]")) {
      const value = this.#formState.loadedValue(control.dataset.pdfFormId ?? "");
      if (value === undefined) continue;
      if (
        typeof ownerWindow.HTMLInputElement === "function" &&
        control instanceof ownerWindow.HTMLInputElement &&
        (control.type === "checkbox" || control.type === "radio")
      ) {
        control.checked =
          typeof value === "boolean" ? value : value === control.getAttribute("xfaOn");
      } else if (
        typeof ownerWindow.HTMLSelectElement === "function" &&
        control instanceof ownerWindow.HTMLSelectElement &&
        control.multiple
      ) {
        const selected = new Set(Array.isArray(value) ? value.map(String) : [String(value ?? "")]);
        for (const option of control.options) option.selected = selected.has(option.value);
      } else {
        control.value = value == null ? "" : String(value);
      }
    }
  }

  isFormControlTarget(target: EventTarget | null): boolean {
    return (
      target instanceof this.#ownerWindow().Element &&
      (target as Element).closest(".pdf-form-control") != null
    );
  }

  #continueTab(event: KeyboardEvent): void {
    if (
      event.key !== "Tab" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const target =
      event.target instanceof this.#ownerWindow().Element
        ? (event.target as Element).closest<HTMLElement>("[data-pdf-form-id]")
        : null;
    const order = Number(target?.dataset.pdfFormOrder);
    if (!Number.isInteger(order)) return;
    const bindings = this.#formState.bindings;
    const index = bindings.findIndex(field => field.order === order);
    const direction = event.shiftKey ? -1 : 1;
    for (
      let cursor = index + direction;
      cursor >= 0 && cursor < bindings.length;
      cursor += direction
    ) {
      const next = bindings[cursor]!;
      if (next.disabled || next.readOnly) continue;
      const control = this.#controlFor(next.order);
      if (control && !this.#isNavigableControl(control)) continue;
      event.preventDefault();
      if (control) {
        this.#pendingFocus = null;
        control.focus({ preventScroll: true });
      } else {
        this.#pendingFocus = Object.freeze({ order: next.order, direction });
        this.#callbacks.requestFormPage?.(next.pageNo);
      }
      return;
    }
  }

  #restorePendingFocus(element: HTMLElement): void {
    const pending = this.#pendingFocus;
    if (!pending) return;
    const bindings = this.#formState.bindings;
    let index = bindings.findIndex(binding => binding.order === pending.order);
    while (index >= 0 && index < bindings.length) {
      const binding = bindings[index]!;
      if (!binding.disabled && !binding.readOnly) {
        const control =
          this.#controlFor(binding.order) ??
          element.querySelector<HTMLElement>(`[data-pdf-form-order="${binding.order}"]`);
        if (control && this.#isNavigableControl(control)) {
          this.#pendingFocus = null;
          control.focus({ preventScroll: true });
          return;
        }
        if (!control) {
          this.#pendingFocus = Object.freeze({
            order: binding.order,
            direction: pending.direction,
          });
          this.#callbacks.requestFormPage?.(binding.pageNo);
          return;
        }
      }
      index += pending.direction;
    }
    this.#pendingFocus = null;
  }

  #controlFor(order: number): HTMLElement | null {
    for (const layer of this.#layers.values()) {
      const control = layer.element.querySelector<HTMLElement>(`[data-pdf-form-order="${order}"]`);
      if (control) return control;
    }
    for (const layer of this.#xfaLayers.values()) {
      const control = layer.element.querySelector<HTMLElement>(`[data-pdf-form-order="${order}"]`);
      if (control) return control;
    }
    return null;
  }

  #isNavigableControl(control: HTMLElement): boolean {
    if (
      control.hidden ||
      control.tabIndex < 0 ||
      control.getAttribute("aria-disabled") === "true" ||
      control.getAttribute("aria-readonly") === "true"
    )
      return false;
    const ownerWindow = this.#ownerWindow();
    if (
      control instanceof ownerWindow.HTMLInputElement ||
      control instanceof ownerWindow.HTMLTextAreaElement
    ) {
      return !control.disabled && !control.readOnly;
    }
    return (
      !(
        control instanceof ownerWindow.HTMLSelectElement ||
        control instanceof ownerWindow.HTMLButtonElement
      ) || !control.disabled
    );
  }

  #releasePendingEviction(element: HTMLElement): void {
    for (const [pageNo, layer] of this.#layers) {
      if (layer.element !== element || !layer.evictionPending || this.retainsPage(pageNo)) continue;
      this.#layers.delete(pageNo);
      this.#destroyLayer(layer);
      return;
    }
    for (const [pageNo, layer] of this.#xfaLayers) {
      if (layer.element !== element || !layer.evictionPending || this.retainsPage(pageNo)) continue;
      this.#xfaLayers.delete(pageNo);
      this.#destroyXfaLayer(layer);
      return;
    }
  }

  #namespaceXfaStructure(node: XfaStructuralNode): void {
    const attributes = node.attributes as Record<string, unknown> | undefined;
    if (attributes) {
      for (const key of ["id", "dataId", "name"] as const) {
        const value = attributes[key];
        if (typeof value === "string" && value) attributes[key] = this.#namespace + value;
      }
      for (const key of [
        "for",
        "list",
        "form",
        "headers",
        "aria-labelledby",
        "aria-describedby",
        "aria-controls",
        "aria-owns",
        "aria-activedescendant",
      ] as const) {
        const value = attributes[key];
        if (typeof value === "string" && value.trim()) {
          attributes[key] = value
            .trim()
            .split(/\s+/)
            .map(id => this.#namespace + id)
            .join(" ");
        }
      }
      if (typeof attributes.href === "string" && attributes.href.startsWith("#")) {
        attributes.href = `#${this.#namespace}${attributes.href.slice(1)}`;
      }
    }
    for (const child of node.children ?? []) if (child) this.#namespaceXfaStructure(child);
  }

  #ensureAccessibleName(control: HTMLElement, storageId: string): void {
    if (
      control.hasAttribute("aria-label") ||
      control.hasAttribute("aria-labelledby") ||
      control.getAttribute("title")?.trim()
    )
      return;
    if ("labels" in control && (control as FormControl).labels?.length) return;
    const name = this.#formState.accessibleName(storageId)?.trim();
    if (name) control.setAttribute("aria-label", name);
  }

  #captureFormLayer(element: HTMLElement, fallback?: FormLayerSnapshot): FormLayerSnapshot {
    const ownerWindow = this.#ownerWindow();
    const activeElement = this.#document?.activeElement ?? null;
    const active = element.contains(activeElement) ? activeElement : null;
    const controls: FormControlSnapshot[] = [];
    let focusedOrder: number | null = null;
    for (const control of element.querySelectorAll<FormControl>("[data-pdf-form-order]")) {
      const order = Number(control.dataset.pdfFormOrder);
      if (!Number.isInteger(order)) continue;
      const common = { order, scrollLeft: control.scrollLeft, scrollTop: control.scrollTop };
      let snapshot: FormControlSnapshot;
      if (
        typeof ownerWindow.HTMLInputElement === "function" &&
        control instanceof ownerWindow.HTMLInputElement
      ) {
        snapshot = Object.freeze({
          ...common,
          value: control.value,
          checked: control.checked,
          selectionStart: control.selectionStart,
          selectionEnd: control.selectionEnd,
          selectionDirection: control.selectionDirection,
        });
      } else if (
        typeof ownerWindow.HTMLTextAreaElement === "function" &&
        control instanceof ownerWindow.HTMLTextAreaElement
      ) {
        snapshot = Object.freeze({
          ...common,
          value: control.value,
          selectionStart: control.selectionStart,
          selectionEnd: control.selectionEnd,
          selectionDirection: control.selectionDirection,
        });
      } else if (
        typeof ownerWindow.HTMLSelectElement === "function" &&
        control instanceof ownerWindow.HTMLSelectElement
      ) {
        snapshot = Object.freeze({
          ...common,
          value: control.value,
          selectedValues: Object.freeze([...control.selectedOptions].map(option => option.value)),
        });
      } else snapshot = Object.freeze(common);
      controls.push(snapshot);
      if (control === active) focusedOrder = order;
    }
    return Object.freeze({
      controls: Object.freeze(controls.length ? controls : [...(fallback?.controls ?? [])]),
      focusedOrder: focusedOrder ?? fallback?.focusedOrder ?? null,
    });
  }

  #restoreFormLayer(element: HTMLElement, snapshot: FormLayerSnapshot): void {
    const ownerWindow = this.#ownerWindow();
    for (const state of snapshot.controls) {
      const control = element.querySelector<FormControl>(`[data-pdf-form-order="${state.order}"]`);
      if (!control) continue;
      if (
        typeof ownerWindow.HTMLInputElement === "function" &&
        control instanceof ownerWindow.HTMLInputElement
      ) {
        if (state.value !== undefined) control.value = state.value;
        if (state.checked !== undefined) control.checked = state.checked;
      } else if (
        typeof ownerWindow.HTMLTextAreaElement === "function" &&
        control instanceof ownerWindow.HTMLTextAreaElement
      ) {
        if (state.value !== undefined) control.value = state.value;
      } else if (
        typeof ownerWindow.HTMLSelectElement === "function" &&
        control instanceof ownerWindow.HTMLSelectElement &&
        state.selectedValues
      ) {
        const selected = new Set(state.selectedValues);
        for (const option of control.options) option.selected = selected.has(option.value);
      }
      control.scrollLeft = state.scrollLeft;
      control.scrollTop = state.scrollTop;
    }
    if (snapshot.focusedOrder == null) return;
    const focused = element.querySelector<FormControl>(
      `[data-pdf-form-order="${snapshot.focusedOrder}"]`,
    );
    const state = snapshot.controls.find(control => control.order === snapshot.focusedOrder);
    if (!focused || !state || !this.#isNavigableControl(focused)) return;
    focused.focus({ preventScroll: true });
    if (
      ((typeof ownerWindow.HTMLInputElement === "function" &&
        focused instanceof ownerWindow.HTMLInputElement) ||
        (typeof ownerWindow.HTMLTextAreaElement === "function" &&
          focused instanceof ownerWindow.HTMLTextAreaElement)) &&
      state.selectionStart != null &&
      state.selectionEnd != null
    ) {
      focused.setSelectionRange(
        state.selectionStart,
        state.selectionEnd,
        state.selectionDirection ?? undefined,
      );
    }
  }

  #trackFormLayerState(pageNo: number, element: HTMLElement): void {
    const retain = () => {
      const snapshot = this.#captureFormLayer(element, this.#retainedControlState.get(pageNo));
      if (snapshot.focusedOrder != null) this.#retainedControlState.set(pageNo, snapshot);
    };
    element.addEventListener("focusin", retain, true);
    for (const type of [
      "input",
      "change",
      "select",
      "compositionstart",
      "compositionupdate",
      "compositionend",
    ] as const) {
      element.addEventListener(type, retain, true);
    }
    element.addEventListener(
      "focusout",
      () =>
        this.#ownerWindow().queueMicrotask(() => {
          if (element.isConnected && !element.contains(this.#document?.activeElement ?? null))
            this.#retainedControlState.delete(pageNo);
        }),
      true,
    );
  }

  #namespaceAnnotations(annotations: readonly AnnotationLike[]): AnnotationLike[] {
    if (!this.formsEnabled) return annotations as AnnotationLike[];
    return annotations.map(annotation => {
      const value: Record<string, unknown> = { ...annotation };
      for (const key of ["id", "popupRef", "parentId"] as const) {
        if (typeof value[key] === "string") value[key] = this.#namespace + value[key];
      }
      if (typeof value.fieldName === "string") value.fieldName = this.#namespace + value.fieldName;
      return Object.freeze(value) as AnnotationLike;
    });
  }

  #namespaceCanvasMap(source: Map<string, HTMLCanvasElement>): Map<string, HTMLCanvasElement> {
    if (!this.formsEnabled) return source;
    const map = new Map(source);
    for (const [id, canvas] of source) map.set(this.#namespace + id, canvas);
    return map;
  }

  #namespacedFieldObjects() {
    return this.#formState.namespacedFieldObjects(this.#namespace);
  }

  #originalId(id: string): string {
    return id.startsWith(this.#namespace) ? id.slice(this.#namespace.length) : id;
  }
  #baseUrl(): string {
    return this.#document?.baseURI ?? "about:blank";
  }
  #ownerDocument(): Document {
    if (!this.#document) throw new Error("DocumentPresentation requires an owner document");
    return this.#document;
  }

  #ownerWindow(): Window & typeof globalThis {
    const ownerWindow = this.#ownerDocument().defaultView as (Window & typeof globalThis) | null;
    if (!ownerWindow)
      throw new Error("DocumentPresentation requires an owner document with a window");
    return ownerWindow;
  }
  #parseOCGAction(value: unknown): DocumentLayersSetOCGStateAction | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as { state?: unknown; preserveRB?: unknown };
    if (
      !Array.isArray(record.state) ||
      !record.state.length ||
      record.state.some(item => typeof item !== "string")
    )
      return null;
    let hasOperator = false;
    let hasId = false;
    for (const item of record.state as string[]) {
      if (OCG_OPERATORS.has(item)) hasOperator = true;
      else if (!hasOperator || !item) return null;
      else hasId = true;
    }
    if (!hasId) return null;
    return Object.freeze({
      state: Object.freeze([...(record.state as string[])]),
      preserveRB: record.preserveRB !== false,
    });
  }

  #annotationType(annotation: AnnotationLike): number {
    if (Number.isInteger(annotation.annotationType)) return Number(annotation.annotationType);
    const subtype = String(annotation.subtype ?? "").toLowerCase();
    return (
      Object.entries(ANNOTATION_TYPE).find(([name]) => name.toLowerCase() === subtype)?.[1] ?? 0
    );
  }

  #actionCategory(annotation: AnnotationLike): string {
    if (annotation.action) return annotation.action;
    if (annotation.resetForm) return "ResetForm";
    if (annotation.setOCGState) return "SetOCGState";
    if (annotation.attachment) return "Attachment";
    if (annotation.actions) return "Scripting";
    if (annotation.url) return "ExternalURL";
    if (annotation.dest) return "Destination";
    return "unknown";
  }

  #canUpdate(
    layer: PresentedLayer,
    context: Readonly<RenderPresentationContext>,
    annotations: readonly unknown[],
    optionalContentConfigPromise: RenderPresentationContext["rasterState"]["optionalContentConfigPromise"],
    optionalContentConfig: OptionalContentConfig | undefined,
    generation: number,
  ): boolean {
    return (
      !layer.destroyed &&
      layer.generation === generation &&
      layer.documentId === context.documentId &&
      layer.page === context.page &&
      this.#sameLease(layer.lease, context.lease) &&
      layer.annotations === annotations &&
      layer.annotationCanvasMap === context.annotationCanvasMap &&
      layer.optionalContentRevision === context.rasterState.optionalContentRevision &&
      layer.annotationMode === context.rasterState.annotationMode &&
      layer.optionalContentConfigPromise === optionalContentConfigPromise &&
      layer.optionalContentConfig === optionalContentConfig &&
      layer.policy === this.#policy
    );
  }

  #isCurrent(context: Readonly<RenderPresentationContext>, generation: number): boolean {
    return (
      generation === this.#generation &&
      context.isCurrent("annotations") &&
      context.lease.wrapper.isConnected
    );
  }

  #isPresentedLayer(pageNo: number, layer: PresentedLayer | PresentedXfaLayer): boolean {
    return (
      !layer.destroyed &&
      layer.published &&
      layer.generation === this.#generation &&
      (this.#layers.get(pageNo) === layer || this.#xfaLayers.get(pageNo) === layer) &&
      layer.element.isConnected &&
      layer.lease.wrapper.isConnected
    );
  }

  #sameLease(a: Readonly<RenderSurfaceLease>, b: Readonly<RenderSurfaceLease>): boolean {
    return (
      a.pageNo === b.pageNo &&
      a.registrationEpoch === b.registrationEpoch &&
      a.wrapper === b.wrapper &&
      a.canvas === b.canvas
    );
  }

  #destroyLayer(layer: PresentedLayer): void {
    if (layer.destroyed) return;
    layer.destroyed = true;
    try {
      layer.instance.destroy();
    } catch {}
    layer.element.remove();
  }

  #destroyXfaLayer(layer: PresentedXfaLayer): void {
    if (layer.destroyed) return;
    layer.destroyed = true;
    layer.element.remove();
  }

  #invoke(
    layer: PresentedLayer | PresentedXfaLayer,
    event: string,
    action: () => void | Promise<unknown>,
  ): void {
    try {
      void Promise.resolve(action()).catch(error =>
        this.#interactionDiagnostic(layer, event, error),
      );
    } catch (error) {
      this.#interactionDiagnostic(layer, event, error);
    }
  }

  #interactionDiagnostic(
    layer: PresentedLayer | PresentedXfaLayer,
    event: string,
    error: unknown,
  ): void {
    this.#diagnostic(
      event,
      "PDF annotation interaction failed",
      {
        documentId: layer.documentId,
        pageNo: layer.lease.pageNo,
        generation: layer.generation,
      },
      error,
    );
  }

  #safeFilename(value: unknown): string {
    if (typeof value !== "string") return "attachment.bin";
    const name = value
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
      .trim();
    return name && name !== "." && name !== ".." ? name : "attachment.bin";
  }

  #revokeResource(url: string): void {
    const timer = this.#resourceTimers.get(url);
    if (timer != null) this.#document?.defaultView?.clearTimeout(timer);
    this.#resourceTimers.delete(url);
    if (!this.#resourceUrls.delete(url)) return;
    this.#document?.defaultView?.URL.revokeObjectURL(url);
  }

  #diagnostic(
    event: string,
    message: string,
    details: Readonly<Record<string, unknown>>,
    error?: unknown,
  ): void {
    try {
      this.#callbacks.diagnostic?.({ event, message, details, error });
    } catch {}
  }
}
