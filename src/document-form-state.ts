// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private document-scoped owner for interactive form values and persistence.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. It owns no page DOM, browser activation, raster
 * work, or print jobs.
 * See the [architecture guide](../ARCHITECTURE.md) for ownership and lifecycle
 * boundaries.
 * @packageDocumentation
 * @module document-form-state
 */

import type * as PDFJS from "pdfjs-dist";
import {
  createDocumentXfaPrintSnapshot,
  inspectDocumentXfaPrintSource,
  type DocumentXfaPrintAdmission,
  type DocumentXfaPrintAdmissionLimits,
  type DocumentXfaPrintSnapshot,
} from "./document-xfa-print.js";
import { cloneXfaStructure, collectXfaFields } from "./xfa-value-snapshot.js";
import {
  asPdfjsAnnotationStorage,
  assertAnnotationStorage,
  installAnnotationStorageCallbacks,
  type AnnotationStorage,
} from "./pdfjs-compatibility.js";

export type DocumentFormPresentation =
  "none" | "acroform" | "pure-xfa" | "hybrid-acroform-fallback" | "xfa-disabled";

export type DocumentFormFieldObject = Readonly<Record<string, unknown>> & {
  readonly id?: string;
  readonly page?: number;
  readonly name?: string;
  readonly type?: string;
  readonly value?: unknown;
  readonly defaultValue?: unknown;
  readonly exportValues?: unknown;
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
};

export interface DocumentFormBinding {
  readonly id: string;
  readonly pageNo: number;
  readonly domId: string | null;
  readonly order: number;
  readonly disabled: boolean;
  readonly readOnly: boolean;
}

interface DocumentFormField {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly accessibleName: string;
  readonly loadedState: Readonly<Record<string, unknown>>;
  readonly bindings: readonly DocumentFormBinding[];
}

export interface DocumentFormStateCallbacks {
  readonly dirtyChanged?: (dirty: boolean) => void;
  readonly appearanceChanged?: (pages: readonly number[]) => void;
  readonly stateChanged?: () => void;
  readonly diagnostic?: (event: string, error: unknown) => void;
}

interface ExportOperation {
  readonly pdf: PDFJS.PDFDocumentProxy;
  readonly revision: number;
  readonly promise: Promise<Uint8Array>;
}

interface ExportWaiter {
  readonly resolve: (value: Uint8Array | null) => void;
  readonly reject: (error: unknown) => void;
}

const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bRecord = b as Record<string, unknown>;
    return (
      aEntries.length === Object.keys(bRecord).length &&
      aEntries.every(([key, value]) => equal(value, bRecord[key]))
    );
  }
  return false;
};

const cloneState = (value: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value))
    clone[key] = Array.isArray(entry) ? [...entry] : entry;
  return clone;
};

export class DocumentFormState {
  #interactive: boolean;
  #xfa: boolean;
  #callbacks: DocumentFormStateCallbacks;
  #generation = 0;
  #pdf: PDFJS.PDFDocumentProxy | null = null;
  #storage: AnnotationStorage | null = null;
  #releaseStorageCallbacks: (() => void) | null = null;
  #fieldObjects: Map<string, DocumentFormFieldObject[]> | null = null;
  #fields = new Map<string, DocumentFormField>();
  #bindingOrder: readonly DocumentFormBinding[] = Object.freeze([]);
  #xfaStorageByDomId = new Map<string, string>();
  #observedStates = new Map<string, Readonly<Record<string, unknown>>>();
  #pageRevisions = new Map<number, number>();
  #pendingPages = new Set<number>();
  #notificationQueued = false;
  #dirty = false;
  #revision = 0;
  #available = false;
  #presentation: DocumentFormPresentation = "none";
  #preparation: Promise<void> | null = null;
  #activeExport: ExportOperation | null = null;
  #queuedExport: ExportWaiter[] = [];

  constructor(
    options: Readonly<{ interactive: boolean; xfa: boolean }>,
    callbacks: DocumentFormStateCallbacks = {},
  ) {
    this.#interactive = options.interactive;
    this.#xfa = options.xfa;
    this.#callbacks = callbacks;
  }

  get available(): boolean {
    return this.#available;
  }
  get dirty(): boolean {
    return this.#dirty;
  }
  get revision(): number {
    return this.#revision;
  }
  get presentation(): DocumentFormPresentation {
    return this.#presentation;
  }
  get fieldObjects(): Map<string, DocumentFormFieldObject[]> | null {
    return this.#fieldObjects;
  }
  get bindings(): readonly DocumentFormBinding[] {
    return this.#bindingOrder;
  }
  get storageAdapterSource(): AnnotationStorage | null {
    return this.#storage;
  }

  beginDocument(pdf: PDFJS.PDFDocumentProxy): Promise<void> {
    this.reset();
    const generation = this.#generation;
    this.#pdf = pdf;
    if (!this.#interactive && !this.#xfa) return Promise.resolve();

    if (pdf.isPureXfa) {
      this.#presentation = this.#xfa ? "pure-xfa" : "xfa-disabled";
    }
    this.#prepareStorage(pdf, generation);
    if (pdf.isPureXfa && this.#xfa) this.#publishFieldsSafely(pdf, generation, null);

    const start = <T>(read: () => T | PromiseLike<T>): Promise<T> => {
      try {
        return Promise.resolve(read());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const fieldsRead = start(() => (this.#interactive ? pdf.getFieldObjects() : null));
    const metadataRead = start(() => (this.#xfa ? pdf.getMetadata() : null));
    let fieldObjects: Map<string, DocumentFormFieldObject[]> | null | undefined;
    let metadataInfo: Readonly<Record<string, unknown>> | undefined;
    const publishPresentation = (): boolean => {
      if (!this.#isCurrent(pdf, generation) || pdf.isPureXfa) return false;
      const hasXfa = metadataInfo?.IsXFAPresent === true;
      const hasAcroForm = metadataInfo?.IsAcroFormPresent === true || fieldObjects != null;
      this.#presentation =
        hasXfa && hasAcroForm
          ? "hybrid-acroform-fallback"
          : hasXfa
            ? "none"
            : hasAcroForm
              ? "acroform"
              : "none";
      return true;
    };
    const publishState = () => {
      if (!this.#isCurrent(pdf, generation) || pdf.isPureXfa) return;
      try {
        this.#callbacks.stateChanged?.();
      } catch (error) {
        this.#diagnostic("form-state-publication-failed", error);
      }
    };
    const fieldsPublication = fieldsRead.then(
      value => {
        if (generation !== this.#generation || this.#pdf !== pdf) return;
        if (!this.#interactive) return;
        fieldObjects = value as Map<string, DocumentFormFieldObject[]> | null;
        publishPresentation();
        if (!pdf.isPureXfa && !this.#publishFieldsSafely(pdf, generation, fieldObjects)) return;
        publishState();
      },
      error => {
        if (generation !== this.#generation || this.#pdf !== pdf) return;
        if (!this.#interactive) return;
        publishPresentation();
        publishState();
        this.#diagnostic("form-field-index-unavailable", error);
      },
    );
    const metadataPublication = metadataRead.then(
      value => {
        if (generation !== this.#generation || this.#pdf !== pdf) return;
        if (!this.#xfa) return;
        metadataInfo = value?.info as Readonly<Record<string, unknown>> | undefined;
        publishPresentation();
        publishState();
      },
      error => {
        if (generation !== this.#generation || this.#pdf !== pdf) return;
        if (!this.#xfa) return;
        publishPresentation();
        publishState();
        this.#diagnostic("form-metadata-unavailable", error);
      },
    );
    const preparation = Promise.allSettled([fieldsPublication, metadataPublication]).then(() => {
      if (this.#preparation === preparation) this.#preparation = null;
    });
    this.#preparation = preparation;
    return preparation;
  }

  #publishFields(
    pdf: PDFJS.PDFDocumentProxy,
    fieldObjects: Map<string, DocumentFormFieldObject[]> | null,
  ): void {
    let order = 0;
    const mutable = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        accessibleName: string;
        loadedState: Readonly<Record<string, unknown>>;
        bindings: DocumentFormBinding[];
      }
    >();
    const xfaStorageByDomId = new Map<string, string>();
    if (this.#presentation === "pure-xfa" && pdf.allXfaHtml) {
      const structure = cloneXfaStructure(pdf.allXfaHtml);
      for (const value of collectXfaFields(structure)) {
        const loadedState = this.#loadedState(value.id, { value: value.defaultValue });
        const binding = Object.freeze({
          id: value.id,
          pageNo: value.pageNo,
          domId: value.domId,
          order: order++,
          disabled: value.disabled,
          readOnly: value.readOnly,
        });
        const existing = mutable.get(value.id);
        if (existing) existing.bindings.push(binding);
        else
          mutable.set(value.id, {
            id: value.id,
            name: value.id,
            type: "xfa",
            accessibleName: value.name ?? value.id,
            loadedState,
            bindings: [binding],
          });
        if (value.domId) xfaStorageByDomId.set(value.domId, value.id);
      }
    } else if (fieldObjects) {
      for (const [name, values] of fieldObjects) {
        for (const value of values) {
          if (
            typeof value.id !== "string" ||
            !value.id ||
            !Number.isInteger(value.page) ||
            Number(value.page) < 0
          )
            continue;
          const loadedState = this.#loadedState(value.id, { value: this.#loadedValue(value) });
          const binding = Object.freeze({
            id: value.id,
            pageNo: Number(value.page) + 1,
            domId: value.id,
            order: order++,
            disabled: value.disabled === true,
            readOnly:
              value.readOnly === true || String(value.type ?? "").toLowerCase() === "signature",
          });
          const existing = mutable.get(value.id);
          if (existing) existing.bindings.push(binding);
          else
            mutable.set(value.id, {
              id: value.id,
              name,
              type: String(value.type ?? ""),
              accessibleName: value.name ?? name,
              loadedState,
              bindings: [binding],
            });
        }
      }
    }

    const fields = new Map<string, DocumentFormField>();
    const observedStates = new Map<string, Readonly<Record<string, unknown>>>();
    const pageRevisions = new Map<number, number>();
    for (const value of mutable.values()) {
      const field = Object.freeze({ ...value, bindings: Object.freeze([...value.bindings]) });
      fields.set(field.id, field);
      observedStates.set(field.id, field.loadedState);
      for (const binding of field.bindings) pageRevisions.set(binding.pageNo, 0);
    }
    const bindingOrder = Object.freeze(
      [...fields.values()]
        .flatMap(field => field.bindings)
        .sort((a, b) => a.pageNo - b.pageNo || a.order - b.order),
    );

    this.#fieldObjects = fieldObjects;
    this.#fields = fields;
    this.#observedStates = observedStates;
    this.#pageRevisions = pageRevisions;
    this.#xfaStorageByDomId = xfaStorageByDomId;
    this.#bindingOrder = bindingOrder;
    this.#available = this.#interactive && this.#storage != null && this.#fields.size > 0;
    this.#recomputeDirty();
  }

  #publishFieldsSafely(
    pdf: PDFJS.PDFDocumentProxy,
    generation: number,
    fieldObjects: Map<string, DocumentFormFieldObject[]> | null,
  ): boolean {
    if (!this.#isCurrent(pdf, generation)) return false;
    try {
      this.#publishFields(pdf, fieldObjects);
      return true;
    } catch (error) {
      this.#diagnostic("form-field-publication-failed", error);
      return false;
    }
  }

  #prepareStorage(pdf: PDFJS.PDFDocumentProxy, generation: number): void {
    let storage: AnnotationStorage | null = null;
    try {
      storage = pdf.annotationStorage;
      assertAnnotationStorage(storage);
      const releaseCallbacks = installAnnotationStorageCallbacks(storage, () =>
        this.#observeStorageChanges(),
      );
      if (!this.#isCurrent(pdf, generation)) {
        releaseCallbacks();
        return;
      }
      this.#storage = storage;
      this.#releaseStorageCallbacks = releaseCallbacks;
    } catch (error) {
      if (storage) this.#disableStorage(storage);
      this.#diagnostic("form-storage-unavailable", error);
    }
  }

  #disableStorage(storage: AnnotationStorage): void {
    this.#releaseStorageCallbacks?.();
    this.#releaseStorageCallbacks = null;
    if (this.#storage === storage) this.#storage = null;
    this.#available = false;
  }

  #isCurrent(pdf: PDFJS.PDFDocumentProxy, generation: number): boolean {
    return generation === this.#generation && this.#pdf === pdf;
  }

  #diagnostic(event: string, error: unknown): void {
    try {
      this.#callbacks.diagnostic?.(event, error);
    } catch {}
  }

  hasField(id: string): boolean {
    return this.#fields.has(id);
  }
  storageIdForXfaDomId(id: string): string | undefined {
    return this.#xfaStorageByDomId.get(id);
  }
  accessibleName(id: string): string | undefined {
    return this.#fields.get(id)?.accessibleName;
  }
  loadedValue(id: string): unknown {
    return this.#fields.get(id)?.loadedState.value;
  }
  appearanceRevision(pageNo: number): number {
    return this.#pageRevisions.get(pageNo) ?? 0;
  }

  printStorage(pageNo: number, revision: number): AnnotationStorage["print"] | null {
    return this.#storage && revision === this.appearanceRevision(pageNo)
      ? this.#storage.print
      : null;
  }

  nativePrintStorage(): AnnotationStorage["print"] | null {
    return this.#storage?.print ?? null;
  }

  xfaPrintAdmission(
    pageNumbers: readonly number[],
    limits: Readonly<DocumentXfaPrintAdmissionLimits>,
  ): DocumentXfaPrintAdmission | null {
    return this.#pdf && this.#presentation === "pure-xfa"
      ? inspectDocumentXfaPrintSource(this.#pdf, pageNumbers, limits)
      : null;
  }

  xfaPrintSnapshot(
    XfaLayer: typeof PDFJS.XfaLayer,
    admission?: DocumentXfaPrintAdmission,
  ): DocumentXfaPrintSnapshot | null {
    return this.#pdf && this.#presentation === "pure-xfa"
      ? createDocumentXfaPrintSnapshot(this.#pdf, XfaLayer, admission)
      : null;
  }

  createStorageAdapter(namespace: string): AnnotationStorage | null {
    const storage = this.#storage;
    if (!storage) return null;
    try {
      assertAnnotationStorage(storage);
    } catch (error) {
      this.#disableStorage(storage);
      this.#diagnostic("form-storage-unavailable", error);
      return null;
    }
    const originalId = (id: string) => {
      const candidate = id.startsWith(namespace) ? id.slice(namespace.length) : id;
      return this.#fields.has(candidate) ? candidate : id;
    };
    const observe = () => this.#observeStorageChanges();
    const adapter = {
      get onSetModified() {
        return storage.onSetModified;
      },
      set onSetModified(value: typeof storage.onSetModified) {
        storage.onSetModified = value;
      },
      get onResetModified() {
        return storage.onResetModified;
      },
      set onResetModified(value: typeof storage.onResetModified) {
        storage.onResetModified = value;
      },
      get onAnnotationEditor() {
        return storage.onAnnotationEditor;
      },
      set onAnnotationEditor(value: typeof storage.onAnnotationEditor) {
        storage.onAnnotationEditor = value;
      },
      getValue: (id: string, fallback: object) => storage.getValue(originalId(id), fallback),
      getRawValue: (id: string) => storage.getRawValue(originalId(id)),
      has: (id: string) => storage.has(originalId(id)),
      remove: (id: string) => {
        storage.remove(originalId(id));
        observe();
      },
      setValue: (id: string, value: object) => {
        storage.setValue(originalId(id), value);
        // PDF.js notifies only on the first transition to modified. Every write
        // still owns a package form revision and affected-page invalidation.
        observe();
      },
      get size() {
        return storage.size;
      },
      resetModified: () => storage.resetModified(),
      get print() {
        return storage.print;
      },
      get serializable() {
        return storage.serializable;
      },
      get editorStats() {
        return storage.editorStats;
      },
      resetModifiedIds: () => storage.resetModifiedIds(),
      updateEditor: (annotationId: unknown, data: unknown) =>
        storage.updateEditor(annotationId, data),
      getEditor: (annotationId: unknown) => storage.getEditor(annotationId),
      get modifiedIds() {
        return storage.modifiedIds;
      },
      [Symbol.iterator]: () => storage[Symbol.iterator](),
    };
    return asPdfjsAnnotationStorage(adapter);
  }

  namespacedFieldObjects(namespace: string): Map<string, DocumentFormFieldObject[]> | null {
    if (!this.#fieldObjects) return null;
    return new Map(
      [...this.#fieldObjects].map(([name, fields]) => [
        namespace + name,
        fields.map(field =>
          Object.freeze({
            ...field,
            id: typeof field.id === "string" ? namespace + field.id : field.id,
          }),
        ),
      ]),
    );
  }

  resetForms(): boolean {
    if (!this.#available || !this.#storage || !this.#pdf) return false;
    for (const field of this.#fields.values())
      this.#storage.setValue(field.id, cloneState(field.loadedState));
    this.#observeStorageChanges();
    return true;
  }

  exportDocumentWithFormValues(): Promise<Uint8Array | null> {
    const pdf = this.#pdf;
    if (!pdf || !this.#available) return Promise.resolve(null);
    const active = this.#activeExport;
    if (!active) return this.#resultFor(this.#startExport(pdf, this.#revision));
    if (active.pdf === pdf && active.revision === this.#revision) return this.#resultFor(active);
    return new Promise<Uint8Array | null>((resolve, reject) => {
      this.#queuedExport.push({ resolve, reject });
    });
  }

  reset(): readonly Promise<unknown>[] {
    const settlements = [
      ...(this.#preparation ? [this.#preparation] : []),
      ...(this.#activeExport ? [this.#activeExport.promise] : []),
    ];
    this.#generation++;
    this.#releaseStorageCallbacks?.();
    this.#releaseStorageCallbacks = null;
    this.#pdf = null;
    this.#storage = null;
    this.#fieldObjects = null;
    this.#fields.clear();
    this.#bindingOrder = Object.freeze([]);
    this.#xfaStorageByDomId.clear();
    this.#observedStates.clear();
    this.#pageRevisions.clear();
    this.#pendingPages.clear();
    this.#notificationQueued = false;
    this.#available = false;
    this.#presentation = "none";
    this.#preparation = null;
    this.#revision = 0;
    this.#activeExport = null;
    for (const waiter of this.#queuedExport.splice(0)) waiter.resolve(null);
    this.#setDirty(false);
    return settlements;
  }

  #loadedState(
    id: string,
    fallback: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    const value =
      (this.#storage?.getValue(id, cloneState(fallback)) as Record<string, unknown>) ??
      cloneState(fallback);
    return Object.freeze(cloneState(value));
  }

  #loadedValue(field: DocumentFormFieldObject): unknown {
    if (field.type === "checkbox" || field.type === "radiobutton") {
      const values = Array.isArray(field.exportValues) ? field.exportValues : [field.exportValues];
      return values.includes(field.value);
    }
    return field.value ?? "";
  }

  #observeStorageChanges(): void {
    const storage = this.#storage;
    if (!storage) return;
    let changed = false;
    for (const field of this.#fields.values()) {
      const previous = this.#observedStates.get(field.id) ?? field.loadedState;
      const current = Object.freeze(
        cloneState(
          storage.getValue(field.id, cloneState(field.loadedState)) as Record<string, unknown>,
        ),
      );
      if (equal(previous, current)) continue;
      changed = true;
      this.#observedStates.set(field.id, current);
      for (const binding of field.bindings) this.#pendingPages.add(binding.pageNo);
    }
    if (!changed) return;
    this.#revision++;
    this.#recomputeDirty();
    this.#queueNotification();
  }

  #recomputeDirty(): void {
    this.#setDirty(
      [...this.#fields.values()].some(field => {
        const current = this.#observedStates.get(field.id) ?? field.loadedState;
        return !equal(current.value, field.loadedState.value);
      }),
    );
  }

  #setDirty(dirty: boolean): void {
    if (this.#dirty === dirty) return;
    this.#dirty = dirty;
    try {
      this.#callbacks.dirtyChanged?.(dirty);
    } catch {}
  }

  #queueNotification(): void {
    if (this.#notificationQueued) return;
    this.#notificationQueued = true;
    const generation = this.#generation;
    queueMicrotask(() => {
      if (generation !== this.#generation) return;
      this.#notificationQueued = false;
      if (!this.#pendingPages.size) return;
      const pages = Object.freeze([...this.#pendingPages].sort((a, b) => a - b));
      this.#pendingPages.clear();
      for (const pageNo of pages)
        this.#pageRevisions.set(pageNo, (this.#pageRevisions.get(pageNo) ?? 0) + 1);
      try {
        this.#callbacks.appearanceChanged?.(pages);
      } catch {}
    });
  }

  #startExport(pdf: PDFJS.PDFDocumentProxy, revision: number): ExportOperation {
    const operation: ExportOperation = Object.freeze({
      pdf,
      revision,
      promise: pdf.saveDocument().then(data => Uint8Array.from(data)),
    });
    this.#activeExport = operation;
    void operation.promise.then(
      () => this.#settleExport(operation),
      () => this.#settleExport(operation),
    );
    return operation;
  }

  #settleExport(operation: ExportOperation): void {
    if (this.#activeExport !== operation) return;
    this.#activeExport = null;
    const waiters = this.#queuedExport.splice(0);
    const pdf = this.#pdf;
    if (!waiters.length || pdf !== operation.pdf) {
      for (const waiter of waiters) waiter.resolve(null);
      return;
    }
    const next = this.#startExport(pdf, this.#revision);
    for (const waiter of waiters) this.#resultFor(next).then(waiter.resolve, waiter.reject);
  }

  async #resultFor(operation: ExportOperation): Promise<Uint8Array | null> {
    const data = await operation.promise;
    return this.#pdf === operation.pdf ? Uint8Array.from(data) : null;
  }
}
