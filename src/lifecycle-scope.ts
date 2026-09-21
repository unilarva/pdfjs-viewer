// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private synchronous owner for one facade callback lifetime.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * A {@link LifecycleScope} owns viewer- or document-scoped abort state, frames, timers,
 * temporary listeners, and optional cleanup callbacks. {@link LifecycleScope.cancel}
 * invalidates callbacks before releasing them and is idempotent, so a replaced
 * document cannot mutate its successor even if the platform delivers an
 * already-queued callback. Timers and listeners also expose early-release APIs
 * that remove their scope bookkeeping immediately.
 *
 * The viewer facade decides which scope browser work belongs to. Render-document
 * and PDF.js task lifetimes are owned separately by `DocumentRenderer`; this
 * module supplies the callback invalidation boundary the facade applies before
 * renderer reset. See the [architecture guide](../ARCHITECTURE.md) for the
 * authoritative lifecycle hierarchy and teardown order.
 *
 * @packageDocumentation
 * @module lifecycle-scope
 */

/** Explicit scheduling capabilities owned by the facade's document window. */
export interface LifecycleScopePlatform {
  createAbortController?(): AbortController;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}

/** Owns cancellable browser work for one explicit lifecycle boundary. */
export class LifecycleScope {
  #platform: LifecycleScopePlatform | null;
  #abort: AbortController;
  #active = true;
  #rafs = new Set<number>();
  #timers = new Set<number>();
  #cleanups = new Set<() => void>();

  /** Creates a scope with scheduling supplied by its owner document window. */
  public constructor(platform: LifecycleScopePlatform | null = null) {
    this.#platform = platform;
    this.#abort = platform?.createAbortController?.() ?? new AbortController();
  }

  /** Signal aborted synchronously at the start of {@link cancel}. */
  public get signal(): AbortSignal {
    return this.#abort.signal;
  }
  /** Whether callbacks may still run. */
  public get active(): boolean {
    return this.#active;
  }

  /** Schedules a frame owned by this scope, or returns `null` after cancellation. */
  public requestAnimationFrame(callback: FrameRequestCallback): number | null {
    if (!this.#active) return null;
    const platform = this.#platform;
    if (!platform) return null;
    const id = platform.requestAnimationFrame(time => {
      this.#rafs.delete(id);
      if (this.#active) callback(time);
    });
    this.#rafs.add(id);
    return id;
  }

  /** Schedules a timer owned by this scope, or returns `null` after cancellation. */
  public setTimeout(callback: () => void, delay: number): number | null {
    if (!this.#active) return null;
    const platform = this.#platform;
    if (!platform) return null;
    const id = platform.setTimeout(() => {
      this.#timers.delete(id);
      if (this.#active) callback();
    }, delay);
    this.#timers.add(id);
    return id;
  }

  /**
   * Releases a timer before it fires, removing both platform work and scope
   * bookkeeping. Returns `null` for direct assignment back to the owner field.
   */
  public clearTimeout(id: number | null): null {
    if (id != null && this.#timers.delete(id)) this.#platform?.clearTimeout(id);
    return null;
  }

  /**
   * Adds a temporary listener removed by {@link cancel}.
   *
   * @returns An idempotent disposer that removes the listener immediately and
   * unregisters its scope cleanup, avoiding retention until scope cancellation.
   */
  public listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    if (!this.#active) return () => {};
    target.addEventListener(type, listener, options);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      this.#cleanups.delete(dispose);
      target.removeEventListener(type, listener, options);
    };
    this.#cleanups.add(dispose);
    return dispose;
  }

  /** Registers state cleanup that must accompany callback cancellation. */
  public onCancel(cleanup: () => void): void {
    if (this.#active) this.#cleanups.add(cleanup);
    else cleanup();
  }

  /**
   * Invalidates callbacks first, then aborts, cancels scheduled work, removes
   * listeners, and runs state resets. Repeated calls are no-ops.
   */
  public cancel(): void {
    if (!this.#active) return;
    this.#active = false;
    const cleanups = [...this.#cleanups];
    this.#cleanups.clear();
    this.#abort.abort();
    for (const id of this.#rafs) this.#platform?.cancelAnimationFrame(id);
    for (const id of this.#timers) this.#platform?.clearTimeout(id);
    this.#rafs.clear();
    this.#timers.clear();
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {}
    }
  }
}
