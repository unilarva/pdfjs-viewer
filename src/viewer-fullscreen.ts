// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private owner for one viewer root's standard Fullscreen API lifecycle.
 *
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. The facade owns viewer state and presentation;
 * this class only reconciles browser fullscreen ownership for its exact root.
 * See the [architecture guide](../ARCHITECTURE.md) for its ownership boundary.
 *
 * @packageDocumentation
 * @module viewer-fullscreen
 */

/** Expected, non-throwing reasons a fullscreen command cannot complete. */
export type ViewerFullscreenFailureReason =
  "disabled" | "unavailable" | "occupied" | "denied" | "cancelled";

/** Immutable successful fullscreen command result. */
export interface ViewerFullscreenActiveResult {
  readonly status: "active";
  readonly active: true;
}

/** Immutable successful fullscreen-exit or already-inactive command result. */
export interface ViewerFullscreenInactiveResult {
  readonly status: "inactive";
  readonly active: false;
}

/** Immutable expected fullscreen command failure. */
export interface ViewerFullscreenFailureResult {
  readonly status: ViewerFullscreenFailureReason;
  /** Browser-authoritative exact-root ownership at the time of this result. */
  readonly active: boolean;
  /** Underlying Fullscreen API rejection when one was available. */
  readonly cause?: unknown;
}

/** Immutable result returned from {@link ViewerFullscreen.enter} and {@link ViewerFullscreen.exit}. */
export type ViewerFullscreenResult =
  ViewerFullscreenActiveResult | ViewerFullscreenInactiveResult | ViewerFullscreenFailureResult;

/** Facade notifications emitted after browser-authoritative reconciliation. */
export interface ViewerFullscreenCallbacks {
  /** Called only when exact-root fullscreen ownership changes. */
  stateChanged(active: boolean): void;
  /** Called for an API rejection or a `fullscreenerror` event. */
  failed(result: ViewerFullscreenFailureResult): void;
}

/** Configuration for a private {@link ViewerFullscreen} owner. */
export interface ViewerFullscreenOptions {
  /** The only element this owner may request or exit fullscreen for. */
  readonly root: HTMLElement;
  /** Whether the facade has enabled its fullscreen feature. */
  readonly enabled: boolean;
  /** Semantic notifications consumed by the viewer facade. */
  readonly callbacks?: Partial<ViewerFullscreenCallbacks>;
}

type PendingIntent = {
  readonly desired: boolean;
  readonly promise: Promise<ViewerFullscreenResult>;
  readonly resolve: (result: ViewerFullscreenResult) => void;
};

type BrowserOperation = {
  readonly kind: "enter" | "exit";
  failure: ViewerFullscreenFailureResult | null;
};

function result(
  status: ViewerFullscreenResult["status"],
  active: boolean,
  cause?: unknown,
): ViewerFullscreenResult {
  return Object.freeze(
    cause === undefined ? { status, active } : { status, active, cause },
  ) as ViewerFullscreenResult;
}

/** Owns standard Fullscreen API requests and exact-root reconciliation. */
export class ViewerFullscreen {
  readonly #root: HTMLElement;
  readonly #document: Document;
  readonly #enabled: boolean;
  readonly #callbacks: Partial<ViewerFullscreenCallbacks>;
  #active: boolean;
  #intent: PendingIntent | null = null;
  #browserOperation: BrowserOperation | null = null;
  #destroyed = false;

  public constructor({ root, enabled, callbacks = {} }: ViewerFullscreenOptions) {
    this.#root = root;
    this.#document = root.ownerDocument;
    this.#enabled = enabled;
    this.#callbacks = callbacks;
    this.#active = this.active;
    this.#document.addEventListener("fullscreenchange", this.#fullscreenChanged);
    this.#document.addEventListener("fullscreenerror", this.#fullscreenErrored);
  }

  /** Whether this exact root currently owns browser fullscreen. */
  public get active(): boolean {
    return this.#document.fullscreenElement === this.#root;
  }

  /** Whether this root can issue a standard fullscreen request right now. */
  public get canEnter(): boolean {
    return this.#enabled && this.#hasStandardApi() && this.#document.fullscreenEnabled === true;
  }

  /** Requests browser fullscreen, without claiming success until browser state agrees. */
  public enter(): Promise<ViewerFullscreenResult> {
    if (this.#destroyed) return Promise.resolve(result("cancelled", this.active));
    if (this.#intent?.desired === true) return this.#intent.promise;
    if (!this.#enabled) return Promise.resolve(result("disabled", this.active));
    if (!this.#hasStandardApi() || this.#document.fullscreenEnabled !== true)
      return Promise.resolve(result("unavailable", this.active));
    if (this.active && !this.#browserOperation) return Promise.resolve(result("active", true));
    if (this.#document.fullscreenElement != null && !this.active)
      return Promise.resolve(result("occupied", false));
    return this.#requestState(true);
  }

  /** Exits browser fullscreen only when this exact root owns it. */
  public exit(): Promise<ViewerFullscreenResult> {
    if (this.#destroyed) return Promise.resolve(result("cancelled", this.active));
    if (this.#intent?.desired === false) return this.#intent.promise;
    if (!this.active && !this.#browserOperation) return Promise.resolve(result("inactive", false));
    if (!this.#hasStandardApi()) return Promise.resolve(result("unavailable", this.active));
    return this.#requestState(false);
  }

  /** Stops notifications and silently releases exact-root ownership after pending work settles. */
  public destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancelIntent();
    this.#document.removeEventListener("fullscreenchange", this.#fullscreenChanged);
    this.#document.removeEventListener("fullscreenerror", this.#fullscreenErrored);
    this.#cleanupAfterDestroy();
  }

  #hasStandardApi(): boolean {
    return (
      typeof this.#root.requestFullscreen === "function" &&
      typeof this.#document.exitFullscreen === "function"
    );
  }

  #requestState(desired: boolean): Promise<ViewerFullscreenResult> {
    this.#cancelIntent();
    let resolve!: (value: ViewerFullscreenResult) => void;
    const promise = new Promise<ViewerFullscreenResult>(settle => {
      resolve = settle;
    });
    this.#intent = { desired, promise, resolve };
    this.#pump();
    return promise;
  }

  #cancelIntent(): void {
    const intent = this.#intent;
    if (!intent) return;
    this.#intent = null;
    intent.resolve(result("cancelled", this.active));
  }

  #settleIntent(value: ViewerFullscreenResult): void {
    const intent = this.#intent;
    if (!intent) return;
    this.#intent = null;
    intent.resolve(value);
  }

  #pump(): void {
    if (this.#destroyed) {
      this.#cleanupAfterDestroy();
      return;
    }
    const intent = this.#intent;
    if (!intent || this.#browserOperation) return;
    this.#reconcile();
    if (this.active === intent.desired) {
      this.#settleIntent(result(intent.desired ? "active" : "inactive", intent.desired));
      return;
    }
    if (intent.desired && this.#document.fullscreenElement != null) {
      this.#settleIntent(result("occupied", false));
      return;
    }
    const kind = intent.desired ? "enter" : "exit";
    const operation: BrowserOperation = { kind, failure: null };
    this.#browserOperation = operation;
    void this.#runBrowserOperation(operation);
  }

  async #runBrowserOperation(operation: BrowserOperation): Promise<void> {
    let rejected = false;
    let rejection: unknown;
    try {
      if (operation.kind === "enter") await this.#root.requestFullscreen();
      else await this.#document.exitFullscreen();
    } catch (cause) {
      rejected = true;
      rejection = cause;
    }
    if (!rejected) {
      this.#reconcile();
      const expected = operation.kind === "enter";
      if (this.active !== expected) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        this.#reconcile();
      }
    }
    if (this.#browserOperation !== operation) return;
    this.#browserOperation = null;
    if (this.#destroyed) {
      this.#cleanupAfterDestroy();
      return;
    }

    const operationDesired = operation.kind === "enter";
    const intent = this.#intent;
    if (intent?.desired === operationDesired && this.active !== operationDesired) {
      const failure =
        operation.failure ??
        (result(
          "denied",
          this.active,
          rejected ? rejection : undefined,
        ) as ViewerFullscreenFailureResult);
      if (!operation.failure) this.#callbacks.failed?.(failure);
      this.#settleIntent(failure);
      return;
    }
    this.#pump();
  }

  #cleanupAfterDestroy(): void {
    if (this.#browserOperation || !this.active || !this.#hasStandardApi()) return;
    const operation: BrowserOperation = { kind: "exit", failure: null };
    this.#browserOperation = operation;
    void this.#document
      .exitFullscreen()
      .catch(() => undefined)
      .finally(() => {
        if (this.#browserOperation === operation) this.#browserOperation = null;
      });
  }

  #reconcile(): void {
    const active = this.active;
    if (active === this.#active) return;
    this.#active = active;
    if (!this.#destroyed) this.#callbacks.stateChanged?.(active);
  }

  #fullscreenChanged = (): void => {
    if (this.#destroyed) return;
    this.#reconcile();
  };

  #fullscreenErrored = (): void => {
    if (this.#destroyed) return;
    this.#reconcile();
    const failure = result("denied", this.active) as ViewerFullscreenFailureResult;
    const operation = this.#browserOperation;
    if (operation) {
      if (operation.failure) return;
      operation.failure = failure;
    }
    this.#callbacks.failed?.(failure);
  };
}
