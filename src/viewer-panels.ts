// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for viewer sidebar and toolbar-popover interaction.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `ViewerPanels` owns selected sidebar view, sidebar and toolbar open state,
 * overlay detection, outside pointer/focus dismissal, mutual exclusion, focus
 * restoration, accessibility attributes, host-active visibility, dynamically
 * discovered sidebar close controls, and selection-retention tokens. It emits
 * semantic open/close effects; feature preparation and feature-state reset stay
 * with the coordinating facade and feature owners.
 *
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative shell,
 * feature-view, and facade coordination boundaries.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module viewer-panels
 */

import { LifecycleScope } from "./lifecycle-scope.js";
import type { PdfjsViewerSidebarMode, PdfjsViewerSidebarView } from "./viewer-contracts.js";

type ViewerWindow = Window & typeof globalThis;

type ViewerToolbarPanel = "search" | "menu";
const VIEWER_SIDEBAR_VIEWS = ["outline", "thumbnails", "attachments", "layers"] as const;
const SIDEBAR_SWIPE_AXIS_SLOP_PX = 8;
const SIDEBAR_SWIPE_CLOSE_DISTANCE_PX = 60;
const SIDEBAR_SWIPE_AXIS_RATIO = 1.2;

type SidebarSwipe = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly closingDirection: -1 | 1;
  horizontal: boolean;
};

interface ViewerPanelsBindings {
  readonly sidebar: HTMLElement | null;
  readonly sidebarClose: HTMLButtonElement | null;
  readonly sidebarToggle: HTMLButtonElement | null;
  readonly sidebarPrimaryViews: HTMLElement | null;
  readonly sidebarMoreToggle: HTMLButtonElement | null;
  readonly sidebarMoreMenu: HTMLElement | null;
  readonly sidebarViews: Readonly<Partial<Record<PdfjsViewerSidebarView, readonly HTMLElement[]>>>;
  readonly toolbar: Readonly<
    Record<
      ViewerToolbarPanel,
      Readonly<{
        panel: HTMLElement | null;
        toggle: HTMLButtonElement | null;
        close: HTMLButtonElement | null;
      }>
    >
  >;
}

interface ViewerPanelsOptions {
  readonly ownerDocument: Document;
  readonly sidebarMode: PdfjsViewerSidebarMode;
  readonly restoreFocus: boolean;
  readonly initialSidebarView: PdfjsViewerSidebarView | null;
  readonly sidebarCloseSelector: string;
}

interface ViewerPanelsCallbacks {
  readonly sidebarOpened: (view: PdfjsViewerSidebarView) => void;
  readonly sidebarClosed: (view: PdfjsViewerSidebarView | null) => void;
  readonly toolbarOpened: (panel: ViewerToolbarPanel) => void;
  readonly toolbarClosed: (panel: ViewerToolbarPanel) => void;
  readonly beginToolbarInteraction: (elements: readonly HTMLElement[]) => number;
  readonly completeToolbarInteraction: (token: number) => boolean;
}

/** Owns panel DOM state, focus, dismissal, exclusion, and listeners. */
export class ViewerPanels {
  #bindings: ViewerPanelsBindings;
  #options: ViewerPanelsOptions;
  #callbacks: ViewerPanelsCallbacks;
  #ownerDocument: Document;
  #ownerWindow: ViewerWindow;
  #lifetime: LifecycleScope;
  #sidebarOutsideAbort: AbortController | null = null;
  #sidebarReturnFocus: HTMLElement | null = null;
  #sidebarView: PdfjsViewerSidebarView | null;
  #userSelectedView: PdfjsViewerSidebarView | null = null;
  #availableViews = new Set<PdfjsViewerSidebarView>();
  #hostActive = true;
  #presentationSuppressed = false;
  #returnFocus = new Map<ViewerToolbarPanel, HTMLElement>();
  #selectionTokens = new Map<ViewerToolbarPanel, number>();
  #sidebarSwipe: SidebarSwipe | null = null;
  #sidebarInlineTouchAction: string | null = null;
  #sidebarPresentationDisplay: string | null = null;
  #suppressSidebarClick = false;

  constructor(
    bindings: Readonly<ViewerPanelsBindings>,
    options: Readonly<ViewerPanelsOptions>,
    callbacks: ViewerPanelsCallbacks,
  ) {
    this.#bindings = bindings;
    this.#options = { ...options };
    this.#callbacks = callbacks;
    this.#ownerDocument = options.ownerDocument;
    const ownerWindow = options.ownerDocument.defaultView as ViewerWindow | null;
    if (!ownerWindow) throw new Error("ViewerPanels: ownerDocument must have a defaultView");
    this.#ownerWindow = ownerWindow;
    this.#lifetime = new LifecycleScope({
      createAbortController: () => new ownerWindow.AbortController(),
      requestAnimationFrame: callback => ownerWindow.requestAnimationFrame(callback),
      cancelAnimationFrame: id => ownerWindow.cancelAnimationFrame(id),
      setTimeout: (callback, delay) => ownerWindow.setTimeout(callback, delay),
      clearTimeout: id => ownerWindow.clearTimeout(id),
    });
    this.#sidebarView = options.initialSidebarView;
    for (const view of VIEWER_SIDEBAR_VIEWS) {
      if (bindings.sidebarViews[view]?.length) this.#availableViews.add(view);
    }
    if (!this.#availableViews.size && this.#sidebarView)
      this.#availableViews.add(this.#sidebarView);
    if (!this.#sidebarView || !this.#availableViews.has(this.#sidebarView)) {
      this.#sidebarView = this.#availableViews.values().next().value ?? null;
    }
    if (bindings.sidebar) {
      this.#sidebarInlineTouchAction = bindings.sidebar.style.touchAction;
      bindings.sidebar.style.touchAction = "pan-y";
    }
    this.#syncToolbarInitialState();
    this.#wire();
    this.#syncSidebar();
  }

  get sidebarOpen(): boolean {
    return this.#bindings.sidebar?.dataset.open === "true";
  }
  get sidebarMoreOpen(): boolean {
    return this.#bindings.sidebarMoreToggle?.getAttribute("aria-expanded") === "true";
  }

  /** Permanently releases all panel listeners and temporary outside closers. */
  destroy(): void {
    if (this.#sidebarPresentationDisplay != null && this.#bindings.sidebar) {
      this.#bindings.sidebar.style.display = this.#sidebarPresentationDisplay;
    }
    this.#sidebarPresentationDisplay = null;
    this.#cancelSidebarSwipe();
    this.#removeSidebarOutsideCloser();
    this.#setSidebarMoreOpen(false, false);
    this.#lifetime.cancel();
    if (
      this.#bindings.sidebar?.style.touchAction === "pan-y" &&
      this.#sidebarInlineTouchAction != null
    ) {
      this.#bindings.sidebar.style.touchAction = this.#sidebarInlineTouchAction;
    }
    this.#sidebarInlineTouchAction = null;
    this.#returnFocus.clear();
    this.#selectionTokens.clear();
  }

  /** Applies host visibility and interaction ownership without losing open state. */
  setHostActive(active: boolean): void {
    const becameActive = active && !this.#hostActive;
    this.#hostActive = active;
    const sidebar = this.#bindings.sidebar;
    if (!sidebar) return;
    if (!active || this.#presentationSuppressed) {
      this.#cancelSidebarSwipe();
      this.#setSidebarMoreOpen(false, false);
      this.#syncSidebar();
      sidebar.style.visibility = "hidden";
      sidebar.style.pointerEvents = "none";
      sidebar.setAttribute("aria-hidden", "true");
      sidebar.setAttribute("inert", "");
      this.#removeSidebarOutsideCloser();
      return;
    }
    sidebar.style.visibility = "";
    sidebar.style.pointerEvents = "";
    this.#syncSidebar();
    if (this.sidebarOpen) {
      sidebar.removeAttribute("inert");
      sidebar.setAttribute("aria-hidden", "false");
      this.#installSidebarOutsideCloser();
      if (becameActive && this.#sidebarView) this.#callbacks.sidebarOpened(this.#sidebarView);
    } else {
      sidebar.setAttribute("inert", "");
      sidebar.setAttribute("aria-hidden", "true");
      this.#removeSidebarOutsideCloser();
    }
  }

  /** Suppresses panel DOM without changing selected views or open-state bookkeeping. */
  setPresentationSuppressed(suppressed: boolean): void {
    if (this.#presentationSuppressed === suppressed) return;
    this.#presentationSuppressed = suppressed;
    if (suppressed) {
      this.#cancelSidebarSwipe();
      this.#removeSidebarOutsideCloser();
      const sidebar = this.#bindings.sidebar;
      if (sidebar) {
        this.#sidebarPresentationDisplay = sidebar.style.display;
        sidebar.style.display = "none";
        sidebar.style.visibility = "hidden";
        sidebar.style.pointerEvents = "none";
        sidebar.setAttribute("aria-hidden", "true");
        sidebar.setAttribute("inert", "");
      }
      for (const { panel } of Object.values(this.#bindings.toolbar)) {
        if (!panel) continue;
        panel.style.visibility = "hidden";
        panel.style.pointerEvents = "none";
        panel.setAttribute("aria-hidden", "true");
        panel.setAttribute("inert", "");
      }
      return;
    }
    const sidebar = this.#bindings.sidebar;
    if (sidebar && this.#sidebarPresentationDisplay != null) {
      sidebar.style.display = this.#sidebarPresentationDisplay;
    }
    this.#sidebarPresentationDisplay = null;
    for (const { panel } of Object.values(this.#bindings.toolbar)) {
      if (!panel) continue;
      panel.style.visibility = "";
      panel.style.pointerEvents = "";
      const open = panel.dataset.open === "true";
      panel.toggleAttribute("inert", !open);
      panel.setAttribute("aria-hidden", String(!open));
    }
    this.setHostActive(this.#hostActive);
  }

  /** Resolves whether the sidebar uses transient overlay interaction. */
  isSidebarOverlay(): boolean {
    const sidebar = this.#bindings.sidebar;
    if (!sidebar) return false;
    if (this.#options.sidebarMode !== "auto") return this.#options.sidebarMode === "overlay";
    try {
      const position = this.#ownerWindow.getComputedStyle(sidebar).position;
      return position === "absolute" || position === "fixed";
    } catch {
      return false;
    }
  }

  isSidebarViewOpen(view: PdfjsViewerSidebarView): boolean {
    return this.#sidebarView === view && this.sidebarOpen;
  }

  get sidebarView(): PdfjsViewerSidebarView | null {
    return this.#sidebarView;
  }

  /** Reconciles document-scoped view availability without retaining unavailable selection. */
  setAvailableViews(
    views: readonly PdfjsViewerSidebarView[],
    preferred?: PdfjsViewerSidebarView | null,
  ): void {
    this.#availableViews = new Set(views);
    const next =
      this.#userSelectedView && this.#availableViews.has(this.#userSelectedView)
        ? this.#userSelectedView
        : preferred && this.#availableViews.has(preferred)
          ? preferred
          : this.#sidebarView && this.#availableViews.has(this.#sidebarView)
            ? this.#sidebarView
            : (views[0] ?? null);
    const previous = this.#sidebarView;
    if (!next && previous && this.sidebarOpen) {
      this.#sidebarView = previous;
      this.setSidebarOpen(false);
    }
    this.#sidebarView = next;
    if (next && previous !== next && this.sidebarOpen) {
      if (previous) this.#callbacks.sidebarClosed(previous);
      this.#callbacks.sidebarOpened(next);
    }
    this.#syncSidebar();
  }

  toggleSidebarView(view: PdfjsViewerSidebarView): void {
    if (!this.#availableViews.has(view)) return;
    const open = this.isSidebarViewOpen(view);
    const previous = this.#sidebarView;
    this.#sidebarView = view;
    this.#syncSidebar();
    if (open) this.setSidebarOpen(false);
    else if (this.sidebarOpen) {
      if (previous && previous !== view) this.#callbacks.sidebarClosed(previous);
      this.#callbacks.sidebarOpened(view);
    } else this.setSidebarOpen(true);
  }

  /** Selects an available tab as an explicit user preference without toggling the shell. */
  selectSidebarView(view: PdfjsViewerSidebarView): void {
    if (!this.#availableViews.has(view)) return;
    this.#userSelectedView = view;
    this.#setSidebarMoreOpen(false, false);
    if (this.#sidebarView === view) return;
    const previous = this.#sidebarView;
    this.#sidebarView = view;
    this.#syncSidebar();
    if (this.sidebarOpen) {
      if (previous) this.#callbacks.sidebarClosed(previous);
      this.#callbacks.sidebarOpened(view);
    }
  }

  setSidebarOpen(open: boolean): void {
    const sidebar = this.#bindings.sidebar;
    if (!sidebar || (open && !this.#sidebarView)) return;
    const wasOpen = this.sidebarOpen;
    if (open === wasOpen) return;
    if (!open) {
      this.#cancelSidebarSwipe();
      this.#setSidebarMoreOpen(false, false);
    }
    sidebar.dataset.open = open.toString();
    this.#syncSidebar();
    if (open) {
      if (this.isSidebarOverlay()) {
        this.toggleToolbar("search", false, false);
        this.toggleToolbar("menu", false, false);
      }
      if (!wasOpen)
        this.#sidebarReturnFocus =
          this.#ownerDocument.activeElement instanceof this.#ownerWindow.HTMLElement
            ? (this.#ownerDocument.activeElement as HTMLElement)
            : this.#bindings.sidebarToggle;
      sidebar.removeAttribute("inert");
      sidebar.setAttribute("aria-hidden", "false");
      this.#installSidebarOutsideCloser();
      this.#callbacks.sidebarOpened(this.#sidebarView!);
    } else {
      sidebar.setAttribute("inert", "");
      sidebar.setAttribute("aria-hidden", "true");
      this.#removeSidebarOutsideCloser();
      this.#callbacks.sidebarClosed(this.#sidebarView);
      if (wasOpen && this.#options.restoreFocus && this.#sidebarReturnFocus?.isConnected) {
        this.#sidebarReturnFocus.focus();
      }
      this.#sidebarReturnFocus = null;
    }
  }

  toggleToolbar(name: ViewerToolbarPanel, force?: boolean, restoreFocus = true): void {
    const binding = this.#bindings.toolbar[name];
    const { panel, toggle } = binding;
    if (!panel || !toggle) return;
    const isOpen = panel.dataset.open === "true";
    const next = force ?? !isOpen;
    if (next && this.#presentationSuppressed) return;
    if (next === isOpen) return;
    if (next) {
      this.#setSidebarMoreOpen(false, false);
      const token = this.#callbacks.beginToolbarInteraction([panel, toggle]);
      this.#selectionTokens.set(name, token);
      this.toggleToolbar(name === "search" ? "menu" : "search", false, false);
      this.#returnFocus.set(
        name,
        this.#ownerDocument.activeElement instanceof this.#ownerWindow.HTMLElement
          ? (this.#ownerDocument.activeElement as HTMLElement)
          : toggle,
      );
      panel.hidden = false;
      panel.dataset.open = "true";
      panel.removeAttribute("inert");
      panel.setAttribute("aria-hidden", "false");
      toggle.setAttribute("aria-expanded", "true");
      if (name === "search" && this.sidebarOpen && this.isSidebarOverlay())
        this.setSidebarOpen(false);
      this.#callbacks.toolbarOpened(name);
      return;
    }
    const token = this.#selectionTokens.get(name);
    const restore = token == null || this.#callbacks.completeToolbarInteraction(token);
    if (
      !restore &&
      this.#ownerDocument.activeElement instanceof this.#ownerWindow.HTMLElement &&
      panel.contains(this.#ownerDocument.activeElement)
    ) {
      (this.#ownerDocument.activeElement as HTMLElement).blur();
    }
    panel.hidden = true;
    panel.dataset.open = "false";
    panel.setAttribute("inert", "");
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    this.#callbacks.toolbarClosed(name);
    const returnFocus = this.#returnFocus.get(name);
    if (restore && restoreFocus && this.#options.restoreFocus && returnFocus?.isConnected)
      returnFocus.focus();
    this.#selectionTokens.delete(name);
    this.#returnFocus.delete(name);
  }

  closeMenuFromOutside(event: Event): void {
    const target = event.target;
    if (!(target instanceof this.#ownerWindow.Node)) return;
    const { panel, toggle } = this.#bindings.toolbar.menu;
    if (panel && !panel.hidden && !panel.contains(target) && !toggle?.contains(target)) {
      this.toggleToolbar("menu", false, false);
    }
  }

  #syncToolbarInitialState(): void {
    for (const binding of Object.values(this.#bindings.toolbar)) {
      const { panel, toggle } = binding;
      if (!panel || !toggle) continue;
      panel.hidden = true;
      panel.dataset.open = "false";
      panel.setAttribute("inert", "");
      panel.setAttribute("aria-hidden", "true");
      toggle.setAttribute("aria-expanded", "false");
      if (panel.id) toggle.setAttribute("aria-controls", panel.id);
    }
  }

  #wire(): void {
    if (this.#bindings.sidebarToggle)
      this.#lifetime.listen(this.#bindings.sidebarToggle, "click", () => {
        if (this.sidebarOpen) this.setSidebarOpen(false);
        else this.setSidebarOpen(true);
      });
    if (this.#bindings.sidebarPrimaryViews) {
      this.#lifetime.listen(this.#bindings.sidebarPrimaryViews, "click", event =>
        this.#selectSidebarViewFromEvent(event),
      );
      this.#lifetime.listen(this.#bindings.sidebarPrimaryViews, "keydown", event =>
        this.#onPrimaryViewKeydown(event as KeyboardEvent),
      );
    }
    if (this.#bindings.sidebarMoreToggle) {
      this.#lifetime.listen(this.#bindings.sidebarMoreToggle, "click", () =>
        this.#setSidebarMoreOpen(!this.sidebarMoreOpen),
      );
      this.#lifetime.listen(this.#bindings.sidebarMoreToggle, "keydown", event =>
        this.#onMoreToggleKeydown(event as KeyboardEvent),
      );
    }
    if (this.#bindings.sidebarMoreMenu) {
      this.#lifetime.listen(this.#bindings.sidebarMoreMenu, "click", event =>
        this.#selectSidebarViewFromEvent(event),
      );
      this.#lifetime.listen(this.#bindings.sidebarMoreMenu, "keydown", event =>
        this.#onMoreMenuKeydown(event as KeyboardEvent),
      );
    }
    if (
      this.#bindings.sidebarClose &&
      !this.#bindings.sidebar?.contains(this.#bindings.sidebarClose)
    ) {
      this.#lifetime.listen(this.#bindings.sidebarClose, "click", () => this.setSidebarOpen(false));
    }
    if (this.#bindings.sidebar) {
      this.#lifetime.listen(
        this.#bindings.sidebar,
        "pointerdown",
        event => this.#startSidebarSwipe(event as PointerEvent),
        { capture: true },
      );
      this.#lifetime.listen(
        this.#bindings.sidebar,
        "click",
        event => {
          if (!this.#suppressSidebarClick) return;
          this.#suppressSidebarClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        { capture: true },
      );
      this.#lifetime.listen(this.#bindings.sidebar, "click", event => {
        const target =
          event.target instanceof this.#ownerWindow.Element
            ? event.target.closest(this.#options.sidebarCloseSelector)
            : null;
        if (target) this.setSidebarOpen(false);
      });
      this.#lifetime.listen(
        this.#ownerWindow,
        "pointermove",
        event => this.#continueSidebarSwipe(event as PointerEvent),
        { capture: true, passive: false },
      );
      this.#lifetime.listen(
        this.#ownerWindow,
        "pointerup",
        event => this.#finishSidebarSwipe(event as PointerEvent),
        { capture: true },
      );
      this.#lifetime.listen(
        this.#ownerWindow,
        "pointercancel",
        event => this.#cancelSidebarSwipe((event as PointerEvent).pointerId),
        { capture: true },
      );
    }
    for (const [name, binding] of Object.entries(this.#bindings.toolbar) as Array<
      [ViewerToolbarPanel, ViewerPanelsBindings["toolbar"][ViewerToolbarPanel]]
    >) {
      if (binding.toggle)
        this.#lifetime.listen(binding.toggle, "click", () => this.toggleToolbar(name));
      if (binding.close)
        this.#lifetime.listen(binding.close, "click", () => this.toggleToolbar(name, false));
    }
    this.#lifetime.listen(
      this.#ownerDocument,
      "pointerdown",
      event => this.closeMenuFromOutside(event),
      { capture: true },
    );
    this.#lifetime.listen(
      this.#ownerDocument,
      "pointerdown",
      event => this.#closeSidebarMoreFromOutside(event),
      { capture: true },
    );
    this.#lifetime.listen(
      this.#ownerDocument,
      "focusin",
      event => this.#closeSidebarMoreFromOutside(event),
      { capture: true },
    );
  }

  /** Admits one primary touch that begins over the open sidebar. */
  #startSidebarSwipe(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    if (!event.isPrimary || this.#sidebarSwipe) {
      this.#cancelSidebarSwipe();
      return;
    }
    const sidebar = this.#bindings.sidebar;
    if (!sidebar || !this.#hostActive || !this.sidebarOpen) return;
    const rtl = this.#ownerWindow.getComputedStyle(sidebar).direction === "rtl";
    this.#sidebarSwipe = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      closingDirection: rtl ? 1 : -1,
      horizontal: false,
    };
  }

  /** Classifies an admitted touch without interfering with vertical sidebar scrolling. */
  #continueSidebarSwipe(event: PointerEvent): void {
    const swipe = this.#sidebarSwipe;
    if (!swipe || event.pointerId !== swipe.pointerId) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (!swipe.horizontal) {
      if (Math.max(absX, absY) < SIDEBAR_SWIPE_AXIS_SLOP_PX) return;
      if (absY * SIDEBAR_SWIPE_AXIS_RATIO >= absX || dx * swipe.closingDirection <= 0) {
        this.#cancelSidebarSwipe();
        return;
      }
      swipe.horizontal = true;
    }
    event.preventDefault();
  }

  /** Closes after a completed logical inline-start swipe and suppresses its synthetic click. */
  #finishSidebarSwipe(event: PointerEvent): void {
    const swipe = this.#sidebarSwipe;
    if (!swipe || event.pointerId !== swipe.pointerId) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    const close =
      swipe.horizontal &&
      this.#hostActive &&
      this.sidebarOpen &&
      dx * swipe.closingDirection >= SIDEBAR_SWIPE_CLOSE_DISTANCE_PX &&
      Math.abs(dx) >= Math.abs(dy) * SIDEBAR_SWIPE_AXIS_RATIO;
    this.#sidebarSwipe = null;
    if (!close) return;
    event.preventDefault();
    this.#suppressSidebarClick = true;
    this.#lifetime.setTimeout(() => {
      this.#suppressSidebarClick = false;
    }, 0);
    this.setSidebarOpen(false);
  }

  /** Cancels the active sidebar touch, optionally only for its owning pointer. */
  #cancelSidebarSwipe(pointerId?: number): void {
    if (pointerId != null && this.#sidebarSwipe?.pointerId !== pointerId) return;
    this.#sidebarSwipe = null;
  }

  #syncSidebar(): void {
    const sidebar = this.#bindings.sidebar;
    const toggle = this.#bindings.sidebarToggle;
    toggle?.setAttribute("aria-expanded", this.sidebarOpen.toString());
    if (sidebar?.id) toggle?.setAttribute("aria-controls", sidebar.id);
    if (toggle) {
      const available = this.#availableViews.size > 0;
      toggle.disabled = !available;
      toggle.setAttribute("aria-disabled", (!available).toString());
    }
    if (sidebar && this.#sidebarView) sidebar.dataset.pdfSidebarView = this.#sidebarView;
    const primaryButtons = this.#sidebarViewButtons(this.#bindings.sidebarPrimaryViews);
    const moreItems = this.#sidebarViewButtons(this.#bindings.sidebarMoreMenu);
    let availablePrimaryCount = 0;
    let availableMoreCount = 0;
    for (const button of primaryButtons) {
      const view = button.dataset.pdfSidebarView as PdfjsViewerSidebarView;
      const available = this.#availableViews.has(view);
      const selected = available && view === this.#sidebarView;
      button.hidden = !available;
      button.setAttribute("aria-pressed", selected.toString());
      if (available) availablePrimaryCount++;
    }
    for (const item of moreItems) {
      const view = item.dataset.pdfSidebarView as PdfjsViewerSidebarView;
      const available = this.#availableViews.has(view);
      const selected = available && view === this.#sidebarView;
      item.hidden = !available;
      item.setAttribute("aria-checked", selected.toString());
      if (available) availableMoreCount++;
    }
    if (this.#bindings.sidebarPrimaryViews)
      this.#bindings.sidebarPrimaryViews.hidden = availablePrimaryCount === 0;
    const moreSelected = moreItems.some(
      item => !item.hidden && item.dataset.pdfSidebarView === this.#sidebarView,
    );
    if (this.#bindings.sidebarMoreToggle) {
      this.#bindings.sidebarMoreToggle.hidden = availableMoreCount === 0;
      this.#bindings.sidebarMoreToggle.dataset.selected = moreSelected.toString();
    }
    if (availableMoreCount === 0) this.#setSidebarMoreOpen(false, false);
    for (const view of VIEWER_SIDEBAR_VIEWS) {
      const active = this.#availableViews.has(view) && view === this.#sidebarView;
      for (const element of this.#bindings.sidebarViews[view] ?? []) {
        const visible = this.#hostActive && active && this.sidebarOpen;
        element.hidden = !visible;
        if (visible) element.removeAttribute("inert");
        else element.setAttribute("inert", "");
        if (element.dataset.pdfSidebarView !== view) continue;
        element.setAttribute("role", "region");
        element.removeAttribute("aria-labelledby");
      }
    }
  }

  #onPrimaryViewKeydown(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = this.#sidebarViewButtons(this.#bindings.sidebarPrimaryViews).filter(
      button => !button.hidden,
    );
    if (!buttons.length) return;
    const target =
      event.target instanceof this.#ownerWindow.HTMLElement
        ? event.target.closest<HTMLElement>("[data-pdf-sidebar-view]")
        : null;
    const current = Math.max(0, buttons.indexOf(target ?? buttons[0]));
    const rtl = this.#bindings.sidebarPrimaryViews
      ? this.#ownerWindow.getComputedStyle(this.#bindings.sidebarPrimaryViews).direction === "rtl"
      : false;
    const forward = event.key === "ArrowRight" ? !rtl : rtl;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    event.stopPropagation();
    const next = buttons[nextIndex];
    this.selectSidebarView(next.dataset.pdfSidebarView as PdfjsViewerSidebarView);
    next.focus();
  }

  #selectSidebarViewFromEvent(event: Event): void {
    const target =
      event.target instanceof this.#ownerWindow.Element
        ? event.target.closest<HTMLElement>("[data-pdf-sidebar-view]")
        : null;
    const view = target?.dataset.pdfSidebarView;
    if (VIEWER_SIDEBAR_VIEWS.includes(view as PdfjsViewerSidebarView))
      this.selectSidebarView(view as PdfjsViewerSidebarView);
  }

  #sidebarViewButtons(container: HTMLElement | null): HTMLElement[] {
    return [...(container?.querySelectorAll<HTMLElement>("[data-pdf-sidebar-view]") ?? [])];
  }

  #setSidebarMoreOpen(open: boolean, restoreFocus = true): void {
    const toggle = this.#bindings.sidebarMoreToggle;
    const menu = this.#bindings.sidebarMoreMenu;
    if (!toggle || !menu || (open && toggle.hidden)) return;
    const wasOpen = this.sidebarMoreOpen;
    if (wasOpen === open) return;
    if (open) {
      this.toggleToolbar("search", false, false);
      this.toggleToolbar("menu", false, false);
    }
    toggle.setAttribute("aria-expanded", open.toString());
    menu.hidden = !open;
    menu.toggleAttribute("inert", !open);
    menu.setAttribute("aria-hidden", (!open).toString());
    if (!open && restoreFocus && menu.contains(this.#ownerDocument.activeElement)) toggle.focus();
  }

  #onMoreToggleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.sidebarMoreOpen) {
      event.preventDefault();
      event.stopPropagation();
      this.#setSidebarMoreOpen(false, false);
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.#setSidebarMoreOpen(true, false);
    const items = this.#sidebarViewButtons(this.#bindings.sidebarMoreMenu).filter(
      item => !item.hidden,
    );
    const selected = items.find(item => item.dataset.pdfSidebarView === this.#sidebarView);
    (selected ?? (event.key === "ArrowUp" ? items.at(-1) : items[0]))?.focus();
  }

  #onMoreMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#setSidebarMoreOpen(false);
      return;
    }
    if (event.key === "Tab") {
      this.#setSidebarMoreOpen(false, false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = this.#sidebarViewButtons(this.#bindings.sidebarMoreMenu).filter(
      item => !item.hidden,
    );
    if (!items.length) return;
    const target =
      event.target instanceof this.#ownerWindow.HTMLElement
        ? event.target.closest<HTMLElement>("[data-pdf-sidebar-view]")
        : null;
    const current = Math.max(0, items.indexOf(target ?? items[0]));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    event.stopPropagation();
    items[nextIndex].focus();
  }

  #closeSidebarMoreFromOutside(event: Event): void {
    if (!this.sidebarMoreOpen) return;
    const target = event.target;
    if (!(target instanceof this.#ownerWindow.Node)) return;
    if (
      this.#bindings.sidebarMoreToggle?.contains(target) ||
      this.#bindings.sidebarMoreMenu?.contains(target)
    )
      return;
    this.#setSidebarMoreOpen(false, false);
  }

  #removeSidebarOutsideCloser(): void {
    if (!this.#sidebarOutsideAbort) return;
    try {
      this.#sidebarOutsideAbort.abort();
    } catch {}
    this.#sidebarOutsideAbort = null;
  }

  #installSidebarOutsideCloser(): void {
    const sidebar = this.#bindings.sidebar;
    if (!sidebar || !this.#hostActive || !this.isSidebarOverlay()) {
      this.#removeSidebarOutsideCloser();
      return;
    }
    this.#removeSidebarOutsideCloser();
    const abort = new this.#ownerWindow.AbortController();
    this.#sidebarOutsideAbort = abort;
    const closeOutside = (event: Event) => {
      if (!this.#hostActive || !this.isSidebarOverlay()) return;
      const target = event.target as Node | null;
      if (!target) return;
      const toggle = this.#bindings.sidebarToggle;
      if (!sidebar.contains(target) && !toggle?.contains(target)) this.setSidebarOpen(false);
    };
    this.#ownerDocument.addEventListener("pointerdown", closeOutside, {
      capture: true,
      signal: abort.signal,
    });
    this.#ownerDocument.addEventListener("focusin", closeOutside, {
      capture: true,
      signal: abort.signal,
    });
  }
}
