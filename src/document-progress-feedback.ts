// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private optional document-loading and first-render progress presentation owner.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentProgressFeedback` owns native progress-element mutations, delayed
 * hide/reset transitions, and timer identity. Reset synchronously invalidates
 * pending transitions so an old document cannot alter successor presentation.
 * The facade selects lifecycle timing, loading/first-render phase, and progress
 * values; this module does not inspect PDF.js, rendering, or viewer state. See the
 * [architecture guide](../ARCHITECTURE.md) for the authoritative progress and
 * lifecycle boundaries.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-progress-feedback
 */

import { PDFJS_VIEWER_STATE_CLASSES } from "./viewer-contracts.js";

type TimingApi = {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(id: unknown): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  prefersReducedMotion(): boolean;
};

function timingForDocument(ownerDocument: Document): TimingApi {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow)
    throw new Error("DocumentProgressFeedback requires an owner document with a window");
  return {
    setTimeout: (callback, delay) => ownerWindow.setTimeout(callback, delay),
    clearTimeout: id => ownerWindow.clearTimeout(id as number),
    requestAnimationFrame: callback => ownerWindow.requestAnimationFrame(callback),
    cancelAnimationFrame: id => ownerWindow.cancelAnimationFrame(id),
    prefersReducedMotion: () => ownerWindow.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

const VALUE_TRANSITION_MS = 180;

/** Controls optional document progress UI without depending on viewer or PDF.js state. */
export class DocumentProgressFeedback {
  readonly #progress: HTMLProgressElement | null;
  #errorText: string;
  readonly #timing: TimingApi;
  #clearTimer: unknown | null = null;
  #animationFrame: number | null = null;
  #animationToken = 0;
  #displayedValue: number | null = 0;

  public constructor(progress: HTMLProgressElement | null, errorText: string, timing?: TimingApi) {
    this.#progress = progress;
    this.#errorText = errorText;
    this.#timing =
      timing ??
      (progress
        ? timingForDocument(progress.ownerDocument)
        : {
            setTimeout: () => null,
            clearTimeout: () => {},
            requestAnimationFrame: () => -1,
            cancelAnimationFrame: () => {},
            prefersReducedMotion: () => true,
          });
  }

  /** Updates the displayed progress for the facade-selected operation phase. */
  public update(
    current: number,
    target: number | null,
    done = false,
    phase?: "load" | "render" | "error",
  ): void {
    if (!this.#progress) return;
    if (phase) {
      this.#progress.dataset.phase = phase;
      if (phase === "error") {
        this.#progress.setAttribute("aria-live", "polite");
        this.#progress.setAttribute("aria-valuetext", this.#errorText);
      } else {
        this.#progress.removeAttribute("aria-live");
        this.#progress.removeAttribute("aria-valuetext");
      }
    }
    this.cancelPending();

    if (done) {
      this.#progress.classList.add(PDFJS_VIEWER_STATE_CLASSES.documentProgressVisible);
      this.#animateTo(1, () => this.#scheduleHide());
      return;
    }

    if (target == null || !Number.isFinite(target) || target <= 0) {
      this.#progress.removeAttribute("value");
      this.#displayedValue = null;
    } else {
      this.#animateTo(Math.max(0, Math.min(1, current / target)));
    }
    this.#progress.classList.add(PDFJS_VIEWER_STATE_CLASSES.documentProgressVisible);
  }

  /** Updates the package-owned error announcement without resetting progress. */
  public setUiText(errorText: string): void {
    this.#errorText = errorText;
    if (this.#progress?.dataset.phase === "error")
      this.#progress.setAttribute("aria-valuetext", errorText);
  }

  /** Cancels scheduled transitions while retaining the current visual state. */
  public cancelPending(): void {
    if (this.#clearTimer != null) this.#timing.clearTimeout(this.#clearTimer);
    if (this.#animationFrame != null) this.#timing.cancelAnimationFrame(this.#animationFrame);
    this.#clearTimer = null;
    this.#animationFrame = null;
    this.#animationToken++;
  }

  /** Clears progress state so delayed callbacks cannot affect a replacement document. */
  public reset(): void {
    this.cancelPending();
    this.#progress?.classList.remove(PDFJS_VIEWER_STATE_CLASSES.documentProgressVisible);
    if (this.#progress) {
      delete this.#progress.dataset.phase;
      this.#progress.removeAttribute("aria-live");
      this.#progress.removeAttribute("aria-valuetext");
      this.#progress.max = 1;
      this.#progress.value = 0;
      this.#displayedValue = 0;
    }
  }

  #animateTo(target: number, complete?: () => void): void {
    if (!this.#progress) return;
    const start = this.#displayedValue ?? 0;
    this.#progress.max = 1;
    this.#progress.value = start;
    this.#displayedValue = start;
    if (this.#timing.prefersReducedMotion() || Math.abs(target - start) < Number.EPSILON) {
      this.#progress.value = target;
      this.#displayedValue = target;
      complete?.();
      return;
    }

    const token = ++this.#animationToken;
    let startedAt: number | null = null;
    const frame = (timestamp: number): void => {
      if (token !== this.#animationToken || !this.#progress) return;
      startedAt ??= timestamp;
      const elapsed = Math.min(1, (timestamp - startedAt) / VALUE_TRANSITION_MS);
      const eased = 1 - (1 - elapsed) ** 3;
      this.#displayedValue = start + (target - start) * eased;
      this.#progress.value = this.#displayedValue;
      if (elapsed < 1) {
        this.#animationFrame = this.#timing.requestAnimationFrame(frame);
        return;
      }
      this.#animationFrame = null;
      complete?.();
    };
    this.#animationFrame = this.#timing.requestAnimationFrame(frame);
  }

  #scheduleHide(): void {
    const hideTimer = this.#timing.setTimeout(() => {
      if (this.#clearTimer !== hideTimer) return;
      this.#clearTimer = null;
      this.#progress?.classList.remove(PDFJS_VIEWER_STATE_CLASSES.documentProgressVisible);
      const resetTimer = this.#timing.setTimeout(() => {
        if (this.#clearTimer !== resetTimer) return;
        this.#clearTimer = null;
        if (this.#progress) this.#progress.value = 0;
        this.#displayedValue = 0;
      }, 700);
      this.#clearTimer = resetTimer;
    }, 200);
    this.#clearTimer = hideTimer;
  }
}
