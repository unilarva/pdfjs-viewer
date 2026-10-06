// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private standard Screen Wake Lock API owner, independent of PDF.js.
 *
 * The facade supplies eligibility, policy, and visibility decisions. This module
 * only manages browser requests and its own sentinel; it is not a consumer export.
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for ownership boundaries.
 *
 * @packageDocumentation
 * @module viewer-screen-wake-lock
 */

/** Owns at most one screen wake lock for the facade's current intent. */
export class ViewerScreenWakeLock {
  readonly #navigator: Navigator;
  readonly #diagnostic: (level: "debug", event: string, message: string, cause?: unknown) => void;
  #owned: { sentinel: WakeLockSentinel; listener: () => void } | null = null;
  #desired = false;
  #destroyed = false;
  #pending = false;
  #generation = 0;
  #unavailableReported = false;

  /** Uses only the supplied navigator and a best-effort diagnostic callback. */
  public constructor(
    navigator: Navigator,
    diagnostic: (level: "debug", event: string, message: string, cause?: unknown) => void,
  ) {
    this.#navigator = navigator;
    this.#diagnostic = diagnostic;
  }

  /** Reconciles facade eligibility; repeated eligible calls may retry a denied request. */
  public reconcile(desired: boolean): void {
    if (this.#destroyed) return;
    if (this.#desired && !desired) this.#generation++;
    this.#desired = desired;
    if (!desired) this.#releaseOwned();
    else if (!this.#owned && !this.#pending) void this.#acquire();
  }

  /** Terminally stops acquisition and releases current or subsequently resolved ownership. */
  public destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#desired = false;
    this.#generation++;
    this.#releaseOwned();
  }

  /** Serializes requests and retries only an intent invalidated while pending. */
  async #acquire(): Promise<void> {
    const generation = this.#generation;
    this.#pending = true;
    try {
      const wakeLock = this.#navigator.wakeLock;
      if (!wakeLock || typeof wakeLock.request !== "function") {
        if (!this.#unavailableReported) {
          this.#unavailableReported = true;
          this.#log(
            "debug",
            "screen-wake-lock-unavailable",
            "Screen Wake Lock API is unavailable.",
          );
        }
        return;
      }
      const sentinel = await wakeLock.request("screen");
      if (this.#destroyed || !this.#desired || generation !== this.#generation) {
        this.#release(sentinel);
        return;
      }
      if (sentinel.released) {
        // Treat an already-revoked grant like denial; retry only on the next reconciliation.
        this.#log(
          "debug",
          "screen-wake-lock-released",
          "Requested screen wake lock was already released.",
        );
        return;
      }
      const listener = () => {
        if (this.#owned?.sentinel !== sentinel || this.#owned.listener !== listener) return;
        sentinel.removeEventListener("release", listener);
        this.#owned = null;
        this.#log("debug", "screen-wake-lock-released", "Browser released the screen wake lock.");
        if (this.#desired && !this.#destroyed && !this.#pending) void this.#acquire();
      };
      this.#owned = { sentinel, listener };
      sentinel.addEventListener("release", listener);
    } catch (cause) {
      this.#log("debug", "screen-wake-lock-denied", "Screen wake lock request failed.", cause);
    } finally {
      this.#pending = false;
      // A false transition permanently invalidates the old request, even after true resumes.
      if (!this.#destroyed && this.#desired && generation !== this.#generation) {
        void this.#acquire();
      }
    }
  }

  /** Detaches observation before deliberately releasing this owner's sentinel. */
  #releaseOwned(): void {
    const owned = this.#owned;
    if (!owned) return;
    this.#owned = null;
    owned.sentinel.removeEventListener("release", owned.listener);
    this.#release(owned.sentinel);
  }

  /** Contains synchronous and asynchronous browser release failures. */
  #release(sentinel: WakeLockSentinel): void {
    if (sentinel.released) return;
    try {
      void Promise.resolve(sentinel.release()).catch(cause => {
        this.#log(
          "debug",
          "screen-wake-lock-release-failed",
          "Screen wake lock release failed.",
          cause,
        );
      });
    } catch (cause) {
      this.#log(
        "debug",
        "screen-wake-lock-release-failed",
        "Screen wake lock release failed.",
        cause,
      );
    }
  }

  /** Diagnostics must never interrupt browser ownership cleanup. */
  #log(level: "debug", event: string, message: string, cause?: unknown): void {
    try {
      this.#diagnostic(level, event, message, cause);
    } catch {
      // Consumer diagnostics are best effort, including during late cleanup.
    }
  }
}
