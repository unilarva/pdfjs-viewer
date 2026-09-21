// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public PDF.js runtime, worker configuration, and diagnostic contracts.
 *
 * Package consumers use {@link PdfjsViewerRuntime} through the package root to
 * supply the required explicit PDF.js module identity, configure explicit/shared
 * worker ownership, and isolate compatible viewer groups. The public runtime
 * options and structured logger contracts are also
 * re-exported there.
 *
 * For maintainers, this module coordinates the unavoidable process-global PDF.js
 * worker binding and window keyboard router; each runtime contributes viewer
 * registrations and explicit active selection.
 * The access bridge in this source module is package-private and must not be
 * re-exported. See the [architecture guide](../ARCHITECTURE.md) for the
 * authoritative public/private inventory and runtime/facade boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module pdfjs-viewer-runtime
 */

import type * as DefaultPdfjs from "pdfjs-dist";
import { readPdfjsWorkerPort, writePdfjsWorkerPort } from "./pdfjs-compatibility.js";
import {
  PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS,
  type PdfjsViewerPdfjsVersionPolicy,
} from "./pdfjs-version-policy.js";

/** PDF.js display API surface consumed by the viewer runtime. */
export type PdfjsViewerPdfjsModule = typeof DefaultPdfjs;

/** Severity attached to an opt-in viewer diagnostic entry. */
export type PdfjsViewerLogLevel = "debug" | "error";

/** Structured diagnostic emitted through a configured {@link PdfjsViewerLogger}. */
export interface PdfjsViewerLogEntry {
  /** Diagnostic severity. */
  level: PdfjsViewerLogLevel;
  /** Package component that emitted the entry. */
  component: "runtime" | "viewer";
  /** Stable machine-readable event identifier. */
  event: string;
  /** Human-readable diagnostic summary. */
  message: string;
  /** Viewer identity when the entry concerns one viewer. */
  viewerId?: string;
  /** Immutable structured context specific to the event. */
  details?: Readonly<Record<string, unknown>>;
  /** Original error when an operation failed. */
  error?: unknown;
}

/** Receives opt-in structured diagnostics from runtimes and viewers. */
export type PdfjsViewerLogger = (entry: Readonly<PdfjsViewerLogEntry>) => void;

function isQualifiedPdfjsVersion(version: unknown): boolean {
  return (
    typeof version === "string" &&
    PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS.some(qualified => qualified === version)
  );
}

/** Worker configuration used by a {@link PdfjsViewerRuntime}. */
export interface PdfjsViewerRuntimeOptions {
  /** Explicit PDF.js display API module paired with the configured worker. */
  pdfjs: PdfjsViewerPdfjsModule;
  /** URL of the matching PDF.js module worker. */
  workerSrc?: string;
  /** Host-created matching PDF.js module worker. */
  workerPort?: Worker;
  /** Optional factory used to create a worker for {@link workerSrc}. */
  workerFactory?: (workerSrc: string) => Worker;
  /** Optional sink for structured runtime and viewer diagnostics. */
  logger?: PdfjsViewerLogger;
  /**
   * Defaults to `"qualified-only"`. `"allow-unqualified"` admits an exact
   * unqualified PDF.js version only after application-owned qualification; it is
   * unsupported and carries no compatibility guarantees. Capability checks remain active.
   */
  pdfjsVersionPolicy?: PdfjsViewerPdfjsVersionPolicy;
}

function validateRuntimeOptions(options: PdfjsViewerRuntimeOptions): PdfjsViewerPdfjsVersionPolicy {
  if (!options || typeof options !== "object")
    throw new TypeError("PdfjsViewerRuntime: options must be an object");
  if (
    !options.pdfjs ||
    typeof options.pdfjs !== "object" ||
    typeof options.pdfjs.getDocument !== "function" ||
    !options.pdfjs.GlobalWorkerOptions
  )
    throw new TypeError("PdfjsViewerRuntime: pdfjs must be a PDF.js display API module");
  const policy = options.pdfjsVersionPolicy ?? "qualified-only";
  if (policy !== "qualified-only" && policy !== "allow-unqualified")
    throw new TypeError(
      "PdfjsViewerRuntime: pdfjsVersionPolicy must be qualified-only or allow-unqualified",
    );
  if (typeof options.pdfjs.version !== "string" || !/^\d+\.\d+\.\d+$/.test(options.pdfjs.version)) {
    throw new TypeError(
      `PdfjsViewerRuntime: pdfjs.version must be an exact stable release, got ${String(options.pdfjs.version)}`,
    );
  }
  if (policy === "qualified-only" && !isQualifiedPdfjsVersion(options.pdfjs.version)) {
    throw new TypeError(
      `PdfjsViewerRuntime: pdfjs must be one of the qualified releases (${PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS.join(", ")}), got ${String(options.pdfjs.version)}`,
    );
  }
  if (
    options.workerSrc !== undefined &&
    (typeof options.workerSrc !== "string" || !options.workerSrc.trim())
  )
    throw new TypeError("PdfjsViewerRuntime: workerSrc must be a non-empty string when provided");
  if (
    options.workerPort !== undefined &&
    (!options.workerPort ||
      typeof options.workerPort !== "object" ||
      typeof options.workerPort.postMessage !== "function" ||
      typeof options.workerPort.terminate !== "function")
  ) {
    throw new TypeError("PdfjsViewerRuntime: workerPort must be a Worker when provided");
  }
  if (options.workerFactory !== undefined && typeof options.workerFactory !== "function")
    throw new TypeError("PdfjsViewerRuntime: workerFactory must be a function when provided");
  if (options.logger !== undefined && typeof options.logger !== "function")
    throw new TypeError("PdfjsViewerRuntime: logger must be a function when provided");
  return policy;
}

/** Package-private viewer registration used for global keyboard routing. */
export interface RuntimeViewerRegistration {
  viewerId: string;
  ownerWindow: Window;
  handleKeyboardEvent(event: KeyboardEvent): void;
}

interface PdfjsWorkerLease {
  pdfjs: PdfjsViewerPdfjsModule;
  workerSrc: string | null;
  workerPort: Worker | null;
  workerFactory: ((workerSrc: string) => Worker) | null;
  boundWorker: Worker | null;
  ownsBoundWorker: boolean;
  previousWorkerSrc: string;
  installedWorkerSrc: string | null;
  hadWorkerPort: boolean;
  previousWorkerPort: Worker | null | undefined;
  installedWorkerPort: Worker | null;
  runtimes: Set<PdfjsViewerRuntime>;
}

interface PdfjsGlobalWorkerOptionsCompat {
  workerSrc: string;
  workerPort?: Worker | null;
}

/** Package-private capabilities through which viewers coordinate with a runtime. */
export interface PdfjsViewerRuntimeAccess {
  readonly pdfjs: PdfjsViewerPdfjsModule;
  assertWorkerCompatible(): void;
  assertViewerIdAvailable(viewerId: string, ownerWindow: Window): void;
  register(registration: RuntimeViewerRegistration): void;
  unregister(registration: RuntimeViewerRegistration): void;
  activateViewer(viewerId: string, ownerWindow: Window): void;
  deactivateViewer(viewerId: string, ownerWindow: Window): void;
  attachViewer(): void;
  detachViewer(): void;
  isActiveViewer(viewerId: string, ownerWindow: Window): boolean;
}

const runtimeAccessByRuntime = new WeakMap<PdfjsViewerRuntime, PdfjsViewerRuntimeAccess>();
let pdfjsWorkerLease: PdfjsWorkerLease | null = null;

/** Routes each window-level keyboard event to one exact runtime registration. */
class GlobalKeyboardRouter {
  readonly #ownerWindow: Window;
  readonly #release: () => void;
  #registrations = new Map<PdfjsViewerRuntime, Set<RuntimeViewerRegistration>>();
  #active: { runtime: PdfjsViewerRuntime; registration: RuntimeViewerRegistration } | null = null;
  #installed = false;

  constructor(ownerWindow: Window, release: () => void) {
    this.#ownerWindow = ownerWindow;
    this.#release = release;
  }

  public register(runtime: PdfjsViewerRuntime, registration: RuntimeViewerRegistration): void {
    let registrations = this.#registrations.get(runtime);
    if (!registrations) this.#registrations.set(runtime, (registrations = new Set()));
    registrations.add(registration);
    if (!this.#installed) {
      this.#ownerWindow.addEventListener("keydown", this.#handleKeydown);
      this.#installed = true;
    }
  }

  public unregister(runtime: PdfjsViewerRuntime, registration: RuntimeViewerRegistration): void {
    const registrations = this.#registrations.get(runtime);
    registrations?.delete(registration);
    if (!registrations?.size) this.#registrations.delete(runtime);
    if (this.#active?.runtime === runtime && this.#active.registration === registration)
      this.#active = null;
    this.#removeHandlerIfEmpty();
  }

  public activate(runtime: PdfjsViewerRuntime, viewerId: string): void {
    const registration = [...(this.#registrations.get(runtime) ?? [])].find(
      candidate => candidate.viewerId === viewerId,
    );
    if (registration) this.#active = { runtime, registration };
  }

  public deactivate(runtime: PdfjsViewerRuntime, viewerId: string): void {
    if (this.#active?.runtime === runtime && this.#active.registration.viewerId === viewerId)
      this.#active = null;
  }

  #handleKeydown = (event: KeyboardEvent): void => {
    const active = this.#active;
    if (active && this.#registrations.get(active.runtime)?.has(active.registration))
      active.registration.handleKeyboardEvent(event);
  };

  #removeHandlerIfEmpty(): void {
    if (!this.#installed || this.#registrations.size) return;
    this.#ownerWindow.removeEventListener("keydown", this.#handleKeydown);
    this.#installed = false;
    this.#release();
  }
}

const globalKeyboardRouters = new WeakMap<Window, GlobalKeyboardRouter>();

function keyboardRouterFor(ownerWindow: Window): GlobalKeyboardRouter {
  const existing = globalKeyboardRouters.get(ownerWindow);
  if (existing) return existing;
  const router = new GlobalKeyboardRouter(ownerWindow, () =>
    globalKeyboardRouters.delete(ownerWindow),
  );
  globalKeyboardRouters.set(ownerWindow, router);
  return router;
}

/** Retrieves a runtime's package-private viewer coordination capabilities. */
export function getPdfjsViewerRuntimeAccess(runtime: PdfjsViewerRuntime): PdfjsViewerRuntimeAccess {
  const access = runtimeAccessByRuntime.get(runtime);
  if (!access)
    throw new Error("PdfjsViewer: runtime must be created with new PdfjsViewerRuntime()");
  return access;
}

/** Owns worker configuration and its registrations in package-global keyboard routing. */
export class PdfjsViewerRuntime {
  readonly #pdfjs: PdfjsViewerPdfjsModule;
  readonly #workerSrc: string | null;
  readonly #workerPort: Worker | null;
  readonly #workerFactory: ((workerSrc: string) => Worker) | null;
  readonly #logger: PdfjsViewerLogger | null;
  #registrations = new Set<RuntimeViewerRegistration>();
  #viewerCount = 0;
  #prewarmed = false;
  #activeViewerIds = new WeakMap<Window, string>();
  #destroyed = false;

  /**
   * Creates a reusable runtime around one explicit PDF.js module and worker
   * configuration. Configure at least one of `workerSrc` or `workerPort`.
   *
   * @throws When options are invalid, the PDF.js release is not admitted, or
   * the worker configuration conflicts with an active runtime lease.
   */
  constructor(options: PdfjsViewerRuntimeOptions) {
    const pdfjsVersionPolicy = validateRuntimeOptions(options);
    this.#pdfjs = options.pdfjs;
    this.#workerSrc = options.workerSrc?.trim() || null;
    this.#workerPort = options.workerPort ?? null;
    this.#workerFactory = options.workerFactory ?? null;
    this.#logger = options.logger ?? null;
    if (
      pdfjsVersionPolicy === "allow-unqualified" &&
      !isQualifiedPdfjsVersion(options.pdfjs.version)
    ) {
      this.#log(
        "debug",
        "unqualified-pdfjs-version",
        "Using an unqualified PDF.js version without compatibility guarantees",
        {
          actualVersion: options.pdfjs.version,
          qualifiedVersions: PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS,
        },
      );
    }
    if (!this.#workerSrc && !this.#workerPort)
      throw new Error(
        "PdfjsViewerRuntime: configure workerSrc or workerPort; workerFactory only customizes workerSrc creation",
      );
    runtimeAccessByRuntime.set(this, {
      get pdfjs() {
        return options.pdfjs;
      },
      assertWorkerCompatible: () => this.#assertWorkerCompatible(),
      assertViewerIdAvailable: (viewerId, ownerWindow) =>
        this.#assertViewerIdAvailable(viewerId, ownerWindow),
      register: registration => this.#register(registration),
      unregister: registration => this.#unregister(registration),
      activateViewer: (viewerId, ownerWindow) => this.#activateViewer(viewerId, ownerWindow),
      deactivateViewer: (viewerId, ownerWindow) => this.#deactivateViewer(viewerId, ownerWindow),
      attachViewer: () => this.#attachViewer(),
      detachViewer: () => this.#detachViewer(),
      isActiveViewer: (viewerId, ownerWindow) => this.#isActiveViewer(viewerId, ownerWindow),
    });
  }

  /** Prewarms the configured worker without attaching a viewer. */
  public startWorker(): void {
    this.#assertAlive();
    this.#claimPdfjsGlobals();
    this.#prewarmed = true;
    this.#log("debug", "worker-prewarmed", "PDF.js worker was prewarmed");
  }

  /** Releases runtime-owned resources after all attached viewers are destroyed. */
  public destroy(): void {
    if (this.#destroyed) return;
    if (this.#viewerCount)
      throw new Error(
        `PdfjsViewerRuntime: cannot destroy runtime while ${this.#viewerCount} viewer${this.#viewerCount === 1 ? " is" : "s are"} attached; call destroy() on every viewer first`,
      );
    this.#releasePdfjsGlobals();
    this.#activeViewerIds = new WeakMap();
    this.#destroyed = true;
    this.#log("debug", "destroyed", "Runtime resources were released");
  }

  #assertWorkerCompatible(): void {
    this.#assertAlive();
    if (pdfjsWorkerLease && !this.#isCompatibleWith(pdfjsWorkerLease))
      throw new Error(
        "PdfjsViewerRuntime: a different PDF.js worker configuration is already active; use matching workerSrc/workerPort settings or destroy all viewers using the active runtime first",
      );
  }

  #assertViewerIdAvailable(viewerId: string, ownerWindow: Window): void {
    this.#assertAlive();
    if (
      [...this.#registrations].some(
        existing => existing.viewerId === viewerId && existing.ownerWindow === ownerWindow,
      )
    ) {
      throw new Error(
        `PdfjsViewerRuntime: viewerId "${viewerId}" is already registered for global keyboard routing in this window; use a unique viewerId for each live viewer sharing this runtime and window`,
      );
    }
  }

  #log(
    level: PdfjsViewerLogLevel,
    event: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    error?: unknown,
  ): void {
    try {
      this.#logger?.({ level, component: "runtime", event, message, details, error });
    } catch {
      /* Logger failures never affect runtime behavior. */
    }
  }

  #register(registration: RuntimeViewerRegistration): void {
    this.#assertViewerIdAvailable(registration.viewerId, registration.ownerWindow);
    this.#registrations.add(registration);
    keyboardRouterFor(registration.ownerWindow).register(this, registration);
  }

  #unregister(registration: RuntimeViewerRegistration): void {
    this.#registrations.delete(registration);
    keyboardRouterFor(registration.ownerWindow).unregister(this, registration);
  }

  #activateViewer(viewerId: string, ownerWindow: Window): void {
    this.#assertAlive();
    this.#activeViewerIds.set(ownerWindow, viewerId);
    keyboardRouterFor(ownerWindow).activate(this, viewerId);
  }
  #deactivateViewer(viewerId: string, ownerWindow: Window): void {
    this.#assertAlive();
    if (this.#activeViewerIds.get(ownerWindow) === viewerId)
      this.#activeViewerIds.delete(ownerWindow);
    keyboardRouterFor(ownerWindow).deactivate(this, viewerId);
  }
  #attachViewer(): void {
    this.#assertAlive();
    this.#claimPdfjsGlobals();
    this.#viewerCount++;
  }
  #detachViewer(): void {
    if (this.#viewerCount > 0) this.#viewerCount--;
    if (!this.#viewerCount && !this.#prewarmed) this.#releasePdfjsGlobals();
  }
  #isActiveViewer(viewerId: string, ownerWindow: Window): boolean {
    const active = this.#activeViewerIds.get(ownerWindow);
    return !active || active === viewerId;
  }

  #claimPdfjsGlobals(): void {
    this.#assertWorkerCompatible();
    if (!pdfjsWorkerLease) {
      const globals = this.#pdfjs.GlobalWorkerOptions as PdfjsGlobalWorkerOptionsCompat;
      const workerPort = readPdfjsWorkerPort(globals);
      const boundWorker = this.#createWorker();
      const lease: PdfjsWorkerLease = {
        pdfjs: this.#pdfjs,
        workerSrc: this.#workerSrc,
        workerPort: this.#workerPort,
        workerFactory: this.#workerFactory,
        boundWorker,
        ownsBoundWorker: !this.#workerPort && !!boundWorker,
        previousWorkerSrc: globals.workerSrc,
        installedWorkerSrc: this.#workerSrc,
        hadWorkerPort: workerPort.present,
        previousWorkerPort: workerPort.value,
        installedWorkerPort: boundWorker,
        runtimes: new Set(),
      };
      try {
        if (lease.workerSrc) globals.workerSrc = lease.workerSrc;
        writePdfjsWorkerPort(globals, lease.boundWorker);
      } catch (error) {
        try {
          if (lease.installedWorkerSrc !== null && globals.workerSrc === lease.installedWorkerSrc)
            globals.workerSrc = lease.previousWorkerSrc;
        } catch {}
        try {
          if (readPdfjsWorkerPort(globals).value === lease.installedWorkerPort)
            writePdfjsWorkerPort(globals, lease.previousWorkerPort);
        } catch {}
        if (lease.ownsBoundWorker) {
          try {
            lease.boundWorker?.terminate();
          } catch {}
        }
        throw error;
      }
      pdfjsWorkerLease = lease;
      this.#log("debug", "worker-created", "Created the shared PDF.js worker lease", {
        source: this.#workerPort
          ? "workerPort"
          : this.#workerFactory
            ? "workerFactory"
            : "workerSrc",
        workerCreated: !!boundWorker,
      });
    }
    pdfjsWorkerLease.runtimes.add(this);
  }

  #releasePdfjsGlobals(): void {
    const lease = pdfjsWorkerLease;
    if (!lease || !lease.runtimes.delete(this) || lease.runtimes.size) return;
    if (lease.ownsBoundWorker)
      try {
        lease.boundWorker?.terminate();
      } catch {
        /* Worker may already be terminated. */
      }
    try {
      const globals = this.#pdfjs.GlobalWorkerOptions as PdfjsGlobalWorkerOptionsCompat;
      if (lease.installedWorkerSrc !== null && globals.workerSrc === lease.installedWorkerSrc)
        globals.workerSrc = lease.previousWorkerSrc;
      if (lease.hadWorkerPort && readPdfjsWorkerPort(globals).value === lease.installedWorkerPort)
        writePdfjsWorkerPort(globals, lease.previousWorkerPort);
    } catch {
      /* PDF.js worker globals may be unavailable during teardown. */
    }
    pdfjsWorkerLease = null;
  }

  #isCompatibleWith(lease: PdfjsWorkerLease): boolean {
    return (
      this.#pdfjs === lease.pdfjs &&
      this.#workerSrc === lease.workerSrc &&
      this.#workerPort === lease.workerPort &&
      this.#workerFactory === lease.workerFactory
    );
  }

  #createWorker(): Worker | null {
    if (this.#workerPort) return this.#workerPort;
    if (!this.#workerSrc) return null;
    try {
      return this.#workerFactory
        ? this.#workerFactory(this.#workerSrc)
        : new Worker(this.#workerSrc, { type: "module" });
    } catch {
      this.#log(
        "debug",
        "worker-fallback",
        "Worker construction failed; PDF.js will use workerSrc fallback",
      );
      return null;
    }
  }

  #assertAlive(): void {
    if (this.#destroyed)
      throw new Error(
        "PdfjsViewerRuntime: runtime is destroyed and cannot be reused; create a new runtime instead",
      );
  }
}
