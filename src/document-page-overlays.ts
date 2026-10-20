// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private document-scoped owner for consumer DOM anchored in PDF user space.
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for view ownership and lifecycle.
 *
 * @packageDocumentation
 * @module document-page-overlays
 */

/** Anchor and full page bounds in page-local CSS pixels, independent of DPR. */
export interface DocumentPageOverlayGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Structural consumer input shared with the facade's public contract. */
export interface DocumentPageOverlay {
  readonly page: number;
  readonly anchor: Readonly<{ x: number; y: number }>;
  readonly element: HTMLElement;
  readonly onGeometry?: (geometry: Readonly<DocumentPageOverlayGeometry>) => void;
}

/** Detached PDF.js viewport capability; retains neither the page nor its resources. */
export interface DocumentPageOverlayViewport {
  readonly rotation: number;
  readonly width: number;
  readonly height: number;
  clone(options: { scale: number; rotation: number }): DocumentPageOverlayViewport;
  convertToViewportPoint(x: number, y: number): number[];
}

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "contextmenu",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
  "keydown",
  "keyup",
  "wheel",
] as const;

interface Registration {
  input: DocumentPageOverlay | null;
  viewport: DocumentPageOverlayViewport | null;
  slot: HTMLDivElement;
  geometry: Readonly<DocumentPageOverlayGeometry> | null;
}

/** Owns stable hosts and registration cleanup, with no viewport DOM measurements. */
export class DocumentPageOverlays {
  #registrations = new Set<Registration>();
  #elements = new Set<HTMLElement>();
  #hosts = new Map<number, HTMLDivElement>();
  #active = true;
  #wrapperFor: (page: number) => HTMLDivElement | null;

  /** Uses only the owning view's exact page registry. */
  constructor(wrapperFor: (page: number) => HTMLDivElement | null) {
    this.#wrapperFor = wrapperFor;
  }

  /** Mounts a consumer element and returns an idempotent document-scoped disposer. */
  register(
    input: Readonly<DocumentPageOverlay>,
    viewport: DocumentPageOverlayViewport,
    scale: number,
    rotation: number,
  ): () => void {
    const wrapper = this.#wrapperFor(input.page);
    if (!wrapper || !Number.isFinite(input.anchor.x) || !Number.isFinite(input.anchor.y))
      throw new Error("Invalid page overlay anchor or page");
    if (input.element.contains(wrapper))
      throw new Error("Page overlay element cannot contain its page surface");
    if (this.#elements.has(input.element))
      throw new Error("Page overlay element is already registered");
    const slot = wrapper.ownerDocument.createElement("div");
    slot.className = "pdf-page-overlay";
    for (const type of INPUT_EVENTS) slot.addEventListener(type, stopOverlayInput);
    const entry: Registration = {
      input: { ...input, anchor: { ...input.anchor } },
      viewport,
      slot,
      geometry: null,
    };
    this.#registrations.add(entry);
    this.#elements.add(input.element);
    slot.appendChild(input.element);
    try {
      this.#update(entry, scale, rotation);
    } catch (error) {
      this.#dispose(entry);
      throw error;
    }
    return () => this.#dispose(entry);
  }

  /** Rebinds hosts after topology replacement and publishes changed canonical geometry. */
  refresh(scale: number, rotation: number): void {
    for (const entry of this.#registrations) this.#update(entry, scale, rotation);
  }

  /** Hides and inerts owned hosts without changing consumer DOM or registrations. */
  setActive(active: boolean): void {
    this.#active = active;
    for (const host of this.#hosts.values()) {
      host.hidden = !active;
      host.inert = !active;
    }
  }

  /** Releases consumer elements, callbacks, and input listeners before document teardown. */
  reset(): void {
    for (const entry of this.#registrations) this.#dispose(entry);
  }

  #update(entry: Registration, scale: number, rotation: number): void {
    const input = entry.input;
    if (!input || !entry.viewport) return;
    const wrapper = this.#wrapperFor(input.page);
    if (!wrapper) return;
    let host = this.#hosts.get(input.page);
    if (!host) {
      host = wrapper.ownerDocument.createElement("div");
      host.className = "pdf-page-overlay-host";
      host.hidden = !this.#active;
      host.inert = !this.#active;
      this.#hosts.set(input.page, host);
    }
    if (host.parentElement !== wrapper) wrapper.appendChild(host);
    if (entry.slot.parentElement !== host) host.appendChild(entry.slot);
    const viewport = entry.viewport.clone({
      scale,
      rotation: (((entry.viewport.rotation + rotation) % 360) + 360) % 360,
    });
    const [x, y] = viewport.convertToViewportPoint(input.anchor.x, input.anchor.y);
    const geometry = Object.freeze({
      x: x!,
      y: y!,
      width: viewport.width,
      height: viewport.height,
    });
    entry.slot.style.left = `${geometry.x}px`;
    entry.slot.style.top = `${geometry.y}px`;
    const previous = entry.geometry;
    if (
      previous &&
      previous.x === x &&
      previous.y === y &&
      previous.width === geometry.width &&
      previous.height === geometry.height
    )
      return;
    entry.geometry = geometry;
    // Consumer exceptions must not interrupt canonical view/layout transactions.
    try {
      input.onGeometry?.(geometry);
    } catch {
      /* Consumer owns callback failures. */
    }
  }

  #dispose(entry: Registration): void {
    const input = entry.input;
    if (!input) return;
    this.#registrations.delete(entry);
    this.#elements.delete(input.element);
    if (input.element.parentElement === entry.slot) input.element.remove();
    for (const type of INPUT_EVENTS) entry.slot.removeEventListener(type, stopOverlayInput);
    entry.slot.remove();
    entry.input = null;
    entry.viewport = null;
    entry.geometry = null;
    if (this.#hosts.get(input.page)?.children.length === 0) {
      this.#hosts.get(input.page)?.remove();
      this.#hosts.delete(input.page);
    }
  }
}

/** Preserve native activation and scrolling while isolating viewer gesture/navigation listeners. */
function stopOverlayInput(event: Event): void {
  event.stopPropagation();
}
