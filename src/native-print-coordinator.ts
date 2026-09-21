// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private window-scoped native print-dialog and retained-resource coordinator.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. One immutable invoked lease may outlive every
 * viewer/document that prepared it. See the [architecture guide](../ARCHITECTURE.md)
 * for browser print lifecycle policy.
 * @packageDocumentation
 * @module native-print-coordinator
 */

interface NativePrintResources {
  readonly jobId: number;
  readonly root: HTMLElement;
  readonly printWindow: Window;
  readonly urls: readonly string[];
  readonly retainedBytes: number;
  readonly sheetCount: number;
  readonly preserveArtifact?: boolean;
  /** Called after focus succeeds and immediately before native print invocation. */
  readonly invoked?: () => void;
  readonly settled?: () => void;
  readonly cleanup: () => void;
}
interface NativePrintDiagnostics {
  readonly active: boolean;
  readonly jobId: number | null;
  readonly retainedBytes: number;
  readonly sheetCount: number;
  readonly lifecycle: "awaiting-afterprint" | "debug-artifact-retained" | null;
  readonly beforePrintObserved: boolean;
  readonly debugArtifactRetained: boolean;
}

const coordinators = new WeakMap<Window, NativePrintCoordinator>();

/** Returns the sole coordinator for a browser top-level Window identity. */
export function nativePrintCoordinatorFor(win: Window): NativePrintCoordinator {
  const owner = topLevelPrintWindow(win);
  let coordinator = coordinators.get(owner);
  if (!coordinator) {
    coordinator = new NativePrintCoordinator(owner);
    coordinators.set(owner, coordinator);
  }
  return coordinator;
}

export class NativePrintCoordinator {
  #window: Window;
  #active: NativePrintResources | null = null;
  #beforePrintObserved = false;
  #printReturned = false;
  #installedCleanup: (() => void) | null = null;
  #debugArtifactRetained = false;

  constructor(win: Window) {
    this.#window = win;
  }

  get diagnostics(): Readonly<NativePrintDiagnostics> {
    return Object.freeze({
      active: this.#active !== null,
      jobId: this.#active?.jobId ?? null,
      retainedBytes: this.#active?.retainedBytes ?? 0,
      sheetCount: this.#active?.sheetCount ?? 0,
      lifecycle: this.#active
        ? this.#debugArtifactRetained
          ? "debug-artifact-retained"
          : "awaiting-afterprint"
        : null,
      beforePrintObserved: this.#beforePrintObserved,
      debugArtifactRetained: this.#debugArtifactRetained,
    });
  }

  get busy(): boolean {
    return this.#active !== null;
  }

  /** Transfers immutable resources and invokes print exactly once. */
  invoke(resources: NativePrintResources): "invoked" | "busy" | "unsupported" {
    // A retained artifact occupies the same exclusive raster envelope as an active print.
    // A new invocation is its explicit automatic release path.
    this.releaseDebugArtifact();
    if (this.#active && !this.recoverOrphanedLease()) return "busy";
    if (typeof resources.printWindow.print !== "function") return "unsupported";

    this.#active = resources;
    this.#beforePrintObserved = false;
    this.#printReturned = false;
    let cleaned = false;
    let printEntered = false;
    let pendingAfterPrint = false;
    const beforePrint = () => {
      if (this.#active === resources) this.#beforePrintObserved = true;
    };
    const detachListeners = () => {
      resources.printWindow.removeEventListener("beforeprint", beforePrint);
      resources.printWindow.removeEventListener("afterprint", afterPrint);
      resources.printWindow.removeEventListener("focus", recoverAfterFocus);
      this.#window.removeEventListener("beforeprint", beforePrint);
      this.#window.removeEventListener("afterprint", afterPrint);
      this.#window.removeEventListener("focus", recoverAfterFocus);
    };
    const finalize = () => {
      if (cleaned) return;
      cleaned = true;
      detachListeners();
      // Release every raster-bearing browser resource before rendering resumes.
      try {
        resources.cleanup();
      } catch {
        /* Resource cleanup is idempotent and best effort. */
      }
      if (this.#active === resources) this.#active = null;
      if (this.#installedCleanup === finalize) this.#installedCleanup = null;
      this.#debugArtifactRetained = false;
      try {
        resources.settled?.();
      } catch {
        /* Observer settlement cannot retain the global lease. */
      }
    };
    const afterPrint = () => {
      if (this.#active !== resources) return;
      if (!printEntered) {
        pendingAfterPrint = true;
        return;
      }
      if (!resources.preserveArtifact) {
        finalize();
        return;
      }
      // Debug artifacts intentionally retain the root, Blob URLs, and exclusive lease.
      // `releaseDebugArtifact()` or the next invocation finalizes this exact resource set.
      detachListeners();
      this.#debugArtifactRetained = true;
    };
    const recoverAfterFocus = () => {
      if (this.#active !== resources || !this.#beforePrintObserved) return;
      if (this.#printReturned) {
        afterPrint();
        return;
      }
      // Some browsers dispatch focus while their blocking print() call is
      // unwinding. Recheck after the current stack so that observed
      // beforeprint -> focus remains a reachable missing-afterprint recovery.
      queueMicrotask(() => {
        if (this.#active === resources && this.#beforePrintObserved && this.#printReturned)
          afterPrint();
      });
    };
    this.#installedCleanup = finalize;
    resources.printWindow.addEventListener("beforeprint", beforePrint);
    resources.printWindow.addEventListener("afterprint", afterPrint, { once: true });
    resources.printWindow.addEventListener("focus", recoverAfterFocus);
    if (resources.printWindow !== this.#window) {
      this.#window.addEventListener("beforeprint", beforePrint);
      this.#window.addEventListener("afterprint", afterPrint, { once: true });
      this.#window.addEventListener("focus", recoverAfterFocus);
    }
    try {
      resources.printWindow.focus();
      resources.invoked?.();
      printEntered = true;
      resources.printWindow.print();
      if (this.#active === resources) {
        this.#printReturned = true;
        if (pendingAfterPrint) afterPrint();
      }
    } catch (error) {
      finalize();
      throw error;
    }
    return "invoked";
  }

  /**
   * Recovers a demonstrably detached orphan. Connected roots are released only
   * by observed print lifecycle: afterprint, or beforeprint followed by a focus
   * return after print() returned. Elapsed time and viewer destruction are never
   * sufficient.
   */
  recoverOrphanedLease(): boolean {
    const resources = this.#active;
    if (!resources || resources.root.isConnected) return false;
    this.#installedCleanup?.();
    return true;
  }

  /** Releases a test/manual artifact explicitly or before the next invocation. */
  releaseDebugArtifact(): boolean {
    if (!this.#debugArtifactRetained) return false;
    this.#installedCleanup?.();
    return true;
  }
}

/** Retains a source Blob URL until its reserved browser tab closes. */
export function retainPrintSourceUrl(win: Window, child: Window, url: string): void {
  let released = false;
  const timer = win.setInterval(() => {
    if (released || !child.closed) return;
    released = true;
    win.clearInterval(timer);
    (win as Window & { URL: typeof URL }).URL.revokeObjectURL(url);
  }, 1_000);
}

function topLevelPrintWindow(win: Window): Window {
  try {
    const top = win.top;
    if (top && top.document) return top;
  } catch {
    /* A cross-origin ancestor cannot share native print ownership. */
  }
  return win;
}
