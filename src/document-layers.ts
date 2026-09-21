// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for one document's display-intent optional-content state.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentLayers` acquires exactly one initial display configuration from the
 * active `PDFDocumentProxy`, detaches PDF.js order/group data into an immutable
 * normalized tree, and records loaded defaults plus committed visibility.
 * It is the sole writer of layer visibility. A configuration handed to raster or
 * annotation consumers is immutable by ownership: later changes are applied to a
 * newly reconstructed PDF.js `OptionalContentConfig`, never to a published object.
 * Every committed change therefore publishes a fresh configuration and exact
 * already-resolved promise under a monotonically increasing semantic revision.
 *
 * Mutation requests are atomic and latest-wins. Unknown IDs reject the complete
 * request before desired state changes. Valid requests are applied in caller order
 * through PDF.js `setVisibility(..., true)`, preserving radio-button groups using
 * PDF.js's own configuration semantics. Requests staged in the same turn supersede
 * earlier settlement while inheriting their desired state, allowing rapid checkbox
 * interaction to coalesce without dropping independent choices. Replacement,
 * reset, and destruction synchronously revoke authority; all superseded public
 * settlements resolve deterministically and stale acquisition cannot publish.
 *
 * The owner also exposes a detached visibility snapshot for `DocumentPrint`.
 * It deliberately does not persist state, render UI, invalidate raster owners, or
 * dispatch public events. Those cross-owner effects belong to the viewer facade.
 * See the [architecture guide](../ARCHITECTURE.md) for lifecycle and dependency
 * boundaries.
 *
 * @packageDocumentation
 * @module document-layers
 */

import type * as PDFJS from "pdfjs-dist";
import type {
  PdfjsViewerLayerMutationResult,
  PdfjsViewerLayerNode,
  PdfjsViewerLayersResult,
  PdfjsViewerLayerState,
  PdfjsViewerLayerVisibilityChange,
  PdfjsViewerQueryFailure,
} from "./viewer-contracts.js";
import { clonePdfjsOptionalContentConfig } from "./pdfjs-compatibility.js";

type OptionalContentConfig = Awaited<
  ReturnType<PDFJS.PDFDocumentProxy["getOptionalContentConfig"]>
>;
type SerializableConfig = OptionalContentConfig["serializable"];

/** Exact immutable render handoff for one committed display configuration. */
interface DocumentLayersRenderState {
  readonly documentId: number;
  readonly revision: number;
  readonly configurationPromise: Promise<OptionalContentConfig>;
}

/** Detached current visibility for `DocumentPrint` configuration creation. */
export interface DocumentLayersVisibilitySnapshot {
  readonly documentId: number;
  readonly revision: number;
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly hasLayers: boolean;
  readonly differsFromDefaults: boolean;
}

/** Validated PDF SetOCGState action detached from annotation data. */
export interface DocumentLayersSetOCGStateAction {
  readonly state: readonly string[];
  readonly preserveRB: boolean;
}

/** Structured non-fatal owner diagnostic. */
interface DocumentLayersDiagnostic {
  readonly level: "debug" | "error";
  readonly event: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
}

/** Facade-owned effects invoked only for authoritative state. */
interface DocumentLayersCallbacks {
  readonly committed?: (
    state: Readonly<PdfjsViewerLayerState>,
    renderState: Readonly<DocumentLayersRenderState>,
  ) => void;
  readonly diagnostic?: (entry: Readonly<DocumentLayersDiagnostic>) => void;
}

type LayerStatus = "idle" | "loading" | "ready" | "error" | "destroyed";
type PendingMutation = {
  readonly id: number;
  readonly documentId: number;
  readonly configuration: OptionalContentConfig;
  readonly resolve: (result: PdfjsViewerLayerMutationResult) => void;
};

function freezeNodes(nodes: readonly PdfjsViewerLayerNode[]): readonly PdfjsViewerLayerNode[] {
  return Object.freeze(
    nodes.map(node =>
      node.kind === "group"
        ? Object.freeze({ ...node })
        : Object.freeze({ ...node, children: freezeNodes(node.children) }),
    ),
  );
}

function cancelled(): PdfjsViewerQueryFailure {
  return Object.freeze({ ok: false, reason: "cancelled" });
}

/** Owns acquisition, normalized state, immutable configurations, and mutations. */
export class DocumentLayers {
  #enabled: boolean;
  #callbacks: DocumentLayersCallbacks;
  #status: LayerStatus = "idle";
  #documentId = 0;
  #pdf: PDFJS.PDFDocumentProxy | null = null;
  #configuration: OptionalContentConfig | null = null;
  #configurationPromise: Promise<OptionalContentConfig> | null = null;
  #defaultSerializable: SerializableConfig | null = null;
  #defaultVisibility = new Map<string, boolean>();
  #currentVisibility = new Map<string, boolean>();
  #order: unknown = null;
  #ids: readonly string[] = Object.freeze([]);
  #revision = 0;
  #error: unknown = null;
  #nextMutationId = 0;
  #pending: PendingMutation | null = null;

  constructor(enabled: boolean, callbacks: DocumentLayersCallbacks = {}) {
    this.#enabled = enabled;
    this.#callbacks = callbacks;
  }

  get enabled(): boolean {
    return this.#enabled;
  }
  get ready(): boolean {
    return this.#status === "ready";
  }
  get hasLayers(): boolean {
    return this.#status === "ready" && this.#ids.length > 0;
  }

  /** Acquires and publishes the initial display configuration before rendering. */
  async beginDocument(
    pdf: PDFJS.PDFDocumentProxy,
  ): Promise<Readonly<DocumentLayersRenderState> | null> {
    this.resetDocument();
    const documentId = this.#documentId;
    this.#pdf = pdf;
    if (!this.#enabled) {
      this.#status = "idle";
      return null;
    }
    this.#status = "loading";
    this.#diagnostic(
      "debug",
      "layers-acquisition-started",
      "Started optional-content configuration acquisition",
      { documentId },
    );
    try {
      const acquired = await pdf.getOptionalContentConfig({ intent: "display" });
      if (!this.#isCurrent(pdf, documentId)) return null;
      const configuration = this.#clone(acquired.serializable, acquired);
      this.#defaultSerializable = acquired.serializable;
      this.#order = acquired.getOrder();
      this.#ids = Object.freeze([...configuration].map(([id]) => String(id)));
      this.#defaultVisibility = this.#readVisibility(configuration);
      this.#currentVisibility = new Map(this.#defaultVisibility);
      this.#configuration = configuration;
      this.#configurationPromise = Promise.resolve(configuration);
      this.#revision = 0;
      this.#status = "ready";
      this.#error = null;
      this.#diagnostic(
        "debug",
        "layers-acquisition-complete",
        "Optional-content configuration is ready",
        {
          documentId,
          layerCount: this.#ids.length,
        },
      );
      return this.renderState();
    } catch (error) {
      if (!this.#isCurrent(pdf, documentId)) return null;
      this.#status = "error";
      this.#error = error;
      this.#diagnostic(
        "error",
        "layers-acquisition-failed",
        "Optional-content configuration acquisition failed",
        { documentId },
        error,
      );
      return null;
    }
  }

  /** Returns detached public state or a deterministic lifecycle failure. */
  getLayers(): PdfjsViewerLayersResult {
    const failure = this.#failure();
    if (failure) return failure;
    const state = this.#publicState();
    return Object.freeze({ ok: true, ...state });
  }

  /** Returns the exact configuration identity for the current committed revision. */
  renderState(): Readonly<DocumentLayersRenderState> | null {
    if (this.#status !== "ready" || !this.#configuration || !this.#configurationPromise)
      return null;
    return Object.freeze({
      documentId: this.#documentId,
      revision: this.#revision,
      configurationPromise: this.#configurationPromise,
    });
  }

  /** Returns a deeply detached visibility record for `DocumentPrint`. */
  visibilitySnapshot(): Readonly<DocumentLayersVisibilitySnapshot> | null {
    if (this.#status !== "ready") return null;
    return Object.freeze({
      documentId: this.#documentId,
      revision: this.#revision,
      visibility: Object.freeze(Object.fromEntries(this.#currentVisibility)),
      hasLayers: this.#ids.length > 0,
      differsFromDefaults: this.#ids.some(
        id => this.#currentVisibility.get(id) !== this.#defaultVisibility.get(id),
      ),
    });
  }

  /** Stages an atomic PDF.js-preserving visibility mutation. */
  setVisibility(
    changes: readonly PdfjsViewerLayerVisibilityChange[],
  ): Promise<PdfjsViewerLayerMutationResult> {
    const failure = this.#failure();
    if (failure) return Promise.resolve(failure);
    const unknown = [
      ...new Set(changes.map(change => change.id).filter(id => !this.#currentVisibility.has(id))),
    ];
    if (unknown.length) {
      return Promise.resolve(
        Object.freeze({ ok: false, reason: "unknown-layer", ids: Object.freeze(unknown) }),
      );
    }
    const base = this.#pending?.configuration ?? this.#configuration!;
    const staged = this.#clone(base.serializable, base);
    for (const change of changes) staged.setVisibility(change.id, change.visible, true);
    return this.#stage(staged);
  }

  /** Stages restoration of the loaded display defaults. */
  resetLayers(): Promise<PdfjsViewerLayerMutationResult> {
    const failure = this.#failure();
    if (failure) return Promise.resolve(failure);
    const defaults = this.#clone(this.#defaultSerializable!, this.#configuration!);
    return this.#stage(defaults);
  }

  /** Applies one prevalidated annotation SetOCGState action atomically. */
  executeSetOCGState(
    action: Readonly<DocumentLayersSetOCGStateAction>,
  ): Promise<PdfjsViewerLayerMutationResult> {
    const failure = this.#failure();
    if (failure) return Promise.resolve(failure);
    const operators = new Set(["ON", "OFF", "Toggle"]);
    let operatorSeen = false;
    let idSeen = false;
    for (const item of action.state) {
      if (operators.has(item)) {
        operatorSeen = true;
      } else if (!operatorSeen || !this.#currentVisibility.has(item)) {
        return Promise.resolve(
          Object.freeze({ ok: false, reason: "unknown-layer", ids: Object.freeze([item]) }),
        );
      } else idSeen = true;
    }
    if (!idSeen)
      return Promise.resolve(
        Object.freeze({ ok: false, reason: "unknown-layer", ids: Object.freeze([]) }),
      );
    const source = this.#pending?.configuration ?? this.#configuration!;
    const staged = this.#clone(source.serializable, source);
    staged.setOCGState({ state: [...action.state], preserveRB: action.preserveRB });
    return this.#stage(staged);
  }

  /** Synchronously revokes document authority and settles a staged mutation. */
  resetDocument(): void {
    this.#settlePending(cancelled());
    this.#documentId++;
    this.#pdf = null;
    this.#configuration = null;
    this.#configurationPromise = null;
    this.#defaultSerializable = null;
    this.#defaultVisibility.clear();
    this.#currentVisibility.clear();
    this.#order = null;
    this.#ids = Object.freeze([]);
    this.#revision = 0;
    this.#error = null;
    if (this.#status !== "destroyed") this.#status = "idle";
  }

  destroy(): void {
    if (this.#status === "destroyed") return;
    this.resetDocument();
    this.#status = "destroyed";
  }

  #stage(staged: OptionalContentConfig): Promise<PdfjsViewerLayerMutationResult> {
    this.#settlePending(cancelled());
    const id = ++this.#nextMutationId;
    const documentId = this.#documentId;
    return new Promise(resolve => {
      this.#pending = { id, documentId, configuration: staged, resolve };
      queueMicrotask(() => this.#commit(id, documentId));
    });
  }

  #commit(id: number, documentId: number): void {
    const pending = this.#pending;
    if (
      !pending ||
      pending.id !== id ||
      pending.documentId !== documentId ||
      documentId !== this.#documentId ||
      this.#status !== "ready"
    )
      return;
    this.#pending = null;
    const nextVisibility = this.#readVisibility(pending.configuration);
    const changed = this.#ids.some(
      layerId => nextVisibility.get(layerId) !== this.#currentVisibility.get(layerId),
    );
    if (!changed) {
      pending.resolve(Object.freeze({ ok: true, ...this.#publicState() }));
      return;
    }
    const configuration = this.#clone(pending.configuration.serializable, pending.configuration);
    this.#configuration = configuration;
    this.#configurationPromise = Promise.resolve(configuration);
    this.#currentVisibility = nextVisibility;
    this.#revision++;
    const state = this.#publicState();
    const renderState = this.renderState()!;
    try {
      this.#callbacks.committed?.(state, renderState);
    } catch (error) {
      this.#diagnostic(
        "error",
        "layers-commit-effect-failed",
        "A committed optional-content effect failed",
        {
          documentId,
          revision: this.#revision,
        },
        error,
      );
    }
    this.#diagnostic("debug", "layers-committed", "Committed optional-content visibility", {
      documentId,
      revision: this.#revision,
    });
    pending.resolve(Object.freeze({ ok: true, ...state }));
  }

  #publicState(): Readonly<PdfjsViewerLayerState> {
    return Object.freeze({ revision: this.#revision, layers: this.#normalizedTree() });
  }

  #normalizedTree(): readonly PdfjsViewerLayerNode[] {
    const seen = new Set<string>();
    let groupFallback = 0;
    let labelFallback = 0;
    const groupNode = (id: string): PdfjsViewerLayerNode | null => {
      if (!this.#currentVisibility.has(id) || seen.has(id)) return null;
      seen.add(id);
      const rawName = this.#configuration?.getGroup(id)?.name;
      const name =
        typeof rawName === "string" && rawName.trim() ? rawName.trim() : `Layer ${++groupFallback}`;
      return { kind: "group", id, name, visible: this.#currentVisibility.get(id)! };
    };
    const visit = (value: unknown): PdfjsViewerLayerNode[] => {
      if (typeof value === "string") {
        const node = groupNode(value);
        return node ? [node] : [];
      }
      if (Array.isArray(value)) return value.flatMap(visit);
      if (!value || typeof value !== "object") return [];
      const record = value as { name?: unknown; order?: unknown };
      const rawName = typeof record.name === "string" ? record.name.trim() : "";
      const children = visit(Array.isArray(record.order) ? record.order : []);
      if (!children.length) return [];
      return [{ kind: "label", name: rawName || `Group ${++labelFallback}`, children }];
    };
    const nodes = visit(Array.isArray(this.#order) ? this.#order : []);
    for (const id of this.#ids) {
      const node = groupNode(id);
      if (node) nodes.push(node);
    }
    return freezeNodes(nodes);
  }

  #clone(serializable: SerializableConfig, source: OptionalContentConfig): OptionalContentConfig {
    return clonePdfjsOptionalContentConfig(serializable, source);
  }

  #readVisibility(configuration: OptionalContentConfig): Map<string, boolean> {
    return new Map([...configuration].map(([id, group]) => [String(id), Boolean(group.visible)]));
  }

  #failure(): PdfjsViewerQueryFailure | null {
    if (!this.#enabled) return Object.freeze({ ok: false, reason: "disabled" });
    if (this.#status === "destroyed") return Object.freeze({ ok: false, reason: "destroyed" });
    if (this.#status === "error")
      return Object.freeze({ ok: false, reason: "error", error: this.#error });
    if (this.#status !== "ready") return Object.freeze({ ok: false, reason: "not-ready" });
    return null;
  }

  #settlePending(result: PdfjsViewerLayerMutationResult): void {
    const pending = this.#pending;
    this.#pending = null;
    pending?.resolve(result);
  }

  #isCurrent(pdf: PDFJS.PDFDocumentProxy, documentId: number): boolean {
    return this.#status !== "destroyed" && this.#pdf === pdf && this.#documentId === documentId;
  }

  #diagnostic(
    level: DocumentLayersDiagnostic["level"],
    event: string,
    message: string,
    details: Readonly<Record<string, unknown>>,
    error?: unknown,
  ): void {
    try {
      this.#callbacks.diagnostic?.({ level, event, message, details, error });
    } catch {}
  }
}
