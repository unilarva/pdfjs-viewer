// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private complete owner for the document outline view.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * `DocumentOutlinePresentation` owns the outline preparation-to-DOM handoff,
 * tree and empty/error markup, filter controls and matching, item listeners,
 * active-item classes, transition-aware reveal, view focus, scrolling, reset,
 * and stale completion identity. It accepts detached navigation-model entries
 * and emits semantic outline keys; destination selection and document movement
 * remain outside this presentation owner.
 *
 * See the [architecture guide](../ARCHITECTURE.md) for the authoritative model,
 * presentation, panel-shell, and facade boundaries.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module document-outline-presentation
 */

import { LifecycleScope, type LifecycleScopePlatform } from "./lifecycle-scope.js";
import type {
  DocumentOutlineEntry,
  DocumentOutlinePreparationOutcome,
} from "./document-navigation.js";
import { compileTextQuery, findCompiledTextMatches } from "./text-matching.js";
import type { NormalizedTextQueryOptions } from "./viewer-options.js";
import { PDFJS_VIEWER_STATE_CLASSES } from "./viewer-contracts.js";

/** DOM bindings owned by the outline view. */
interface DocumentOutlinePresentationBindings {
  readonly sidebar: HTMLElement | null;
  readonly content: HTMLElement | null;
  readonly filter: HTMLElement | null;
  readonly filterInput: HTMLInputElement | null;
}

/** Immutable text and feature policy for outline presentation. */
interface DocumentOutlinePresentationOptions {
  readonly filterEnabled: boolean;
  readonly filterLabel: string;
  readonly untitledLabel: string;
  readonly noOutlineLabel: string;
  readonly preparationLabel: string;
  readonly preparationErrorLabel: string;
  readonly filterOptions: Readonly<NormalizedTextQueryOptions>;
  /** Owning viewer's unique id, used to give a synthesized filter input a page-unique `id`. */
  readonly viewerId: string;
}

/** Semantic effects emitted across the presentation boundary. */
interface DocumentOutlinePresentationCallbacks {
  readonly select: (key: string) => void;
  readonly preparationStateChanged: (state: "loading" | "ready" | "error") => void;
  readonly preparationCompleted: (outcome: DocumentOutlinePreparationOutcome) => void;
  readonly isOpen: () => boolean;
  readonly isOverlay: () => boolean;
  readonly hasTouch: () => boolean;
  readonly scrollBehavior: () => ScrollBehavior;
}

type OutlineRevealReason = "opening" | "selection-change";

/** Owns all outline-view state, DOM, interaction, and asynchronous handoff. */
export class DocumentOutlinePresentation {
  #document: Document | null;
  #window: (Window & typeof globalThis) | null;
  #bindings: DocumentOutlinePresentationBindings;
  #options: Readonly<DocumentOutlinePresentationOptions>;
  #callbacks: DocumentOutlinePresentationCallbacks;
  #lifetime: LifecycleScope;
  #documentLifetime: LifecycleScope;
  #preparation: Promise<DocumentOutlinePreparationOutcome> | null = null;
  #generation = 0;
  #revealGeneration = 0;
  #filter: HTMLElement | null;
  #filterInput: HTMLInputElement | null;
  #packageFilterInput: HTMLInputElement | null = null;
  #contentAriaLabel: string | null | undefined;

  constructor(
    bindings: Readonly<DocumentOutlinePresentationBindings>,
    options: Readonly<DocumentOutlinePresentationOptions>,
    callbacks: DocumentOutlinePresentationCallbacks,
  ) {
    this.#bindings = { ...bindings };
    this.#document = bindings.content?.ownerDocument ?? bindings.sidebar?.ownerDocument ?? null;
    this.#window = this.#document?.defaultView as (Window & typeof globalThis) | null;
    const platform = this.#platform();
    this.#lifetime = new LifecycleScope(platform);
    this.#documentLifetime = new LifecycleScope(platform);
    this.#options = Object.freeze({
      ...options,
      filterOptions: Object.freeze({ ...options.filterOptions }),
    });
    this.#callbacks = callbacks;
    this.#filter = bindings.filter;
    this.#filterInput = bindings.filterInput;
    const manualIntentTargets = new Set(
      [bindings.sidebar, bindings.content].filter((element): element is HTMLElement => !!element),
    );
    for (const target of manualIntentTargets) {
      for (const type of ["pointerdown", "touchstart", "keydown"] as const) {
        this.#lifetime.listen(target, type, () => this.#takeOverScroll(), { capture: true });
      }
      this.#lifetime.listen(target, "wheel", () => this.cancelReveal(), {
        capture: true,
        passive: true,
      });
    }
    this.#wireFilterInput();
  }

  /** The current document's exactly-once UI preparation handoff. */
  get preparation(): Promise<DocumentOutlinePreparationOutcome> | null {
    return this.#preparation;
  }

  /** Invalidates document work and clears all document-derived outline output. */
  reset(): void {
    this.#generation++;
    this.#preparation = null;
    this.cancelReveal();
    this.#documentLifetime.cancel();
    this.#documentLifetime = new LifecycleScope(this.#platform());
    if (this.#filterInput) this.#filterInput.value = "";
    this.#setPreparing(false);
    this.#bindings.content?.replaceChildren();
  }

  /** Permanently releases listeners and document presentation. */
  destroy(): void {
    this.reset();
    this.#lifetime.cancel();
  }

  /** Refreshes package-owned fallback, filter, and preparation text in place. */
  setUiText(
    options: Pick<
      DocumentOutlinePresentationOptions,
      | "filterLabel"
      | "untitledLabel"
      | "noOutlineLabel"
      | "preparationLabel"
      | "preparationErrorLabel"
    >,
  ): void {
    this.#options = Object.freeze({ ...this.#options, ...options });
    if (this.#packageFilterInput) {
      this.#packageFilterInput.placeholder = options.filterLabel;
      this.#packageFilterInput.setAttribute("aria-label", options.filterLabel);
    }
    const root = this.#bindings.content;
    if (!root) return;
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='outlineError']",
    ))
      element.textContent = options.preparationErrorLabel;
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='noOutline']",
    ))
      element.textContent = options.noOutlineLabel;
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-pdfjs-ui-text-content='outlineUntitled']",
    )) {
      if (element.tagName === "LI") element.dataset.title = options.untitledLabel;
      else element.textContent = options.untitledLabel;
    }
    this.#applyFilter();
    if (root.getAttribute("aria-busy") === "true")
      root.setAttribute("aria-label", options.preparationLabel);
  }

  /** Starts or joins the current document's preparation-to-presentation handoff. */
  prepare(
    start: () => Promise<DocumentOutlinePreparationOutcome>,
  ): Promise<DocumentOutlinePreparationOutcome> {
    if (this.#preparation) return this.#preparation;
    const generation = this.#generation;
    let preparation: Promise<DocumentOutlinePreparationOutcome>;
    try {
      preparation = start();
    } catch (error) {
      preparation = Promise.resolve({ status: "error", itemCount: 0, items: [], error });
    }
    this.#preparation = preparation;
    this.#callbacks.preparationStateChanged("loading");
    if (generation !== this.#generation || this.#preparation !== preparation) return preparation;
    this.#setPreparing(true);
    void preparation.then(outcome => {
      if (generation !== this.#generation || this.#preparation !== preparation) return;
      this.#setPreparing(false);
      if (outcome.status === "cancelled") return;
      this.#present(outcome);
      this.#callbacks.preparationStateChanged(outcome.status);
      if (generation !== this.#generation || this.#preparation !== preparation) return;
      this.#callbacks.preparationCompleted(outcome);
    });
    return preparation;
  }

  /** Publishes visual and accessible preparation state without owning spinner markup. */
  #setPreparing(preparing: boolean): void {
    const content = this.#bindings.content;
    if (!content) return;
    content.classList.toggle(PDFJS_VIEWER_STATE_CLASSES.outlinePreparing, preparing);
    if (preparing) {
      if (this.#contentAriaLabel === undefined)
        this.#contentAriaLabel = content.getAttribute("aria-label");
      content.setAttribute("aria-busy", "true");
      content.setAttribute("aria-label", this.#options.preparationLabel);
      return;
    }
    content.removeAttribute("aria-busy");
    if (this.#contentAriaLabel === undefined) return;
    if (this.#contentAriaLabel === null) content.removeAttribute("aria-label");
    else content.setAttribute("aria-label", this.#contentAriaLabel);
    this.#contentAriaLabel = undefined;
  }

  /** Applies view-specific focus and reveal behavior after the sidebar opens. */
  open(): void {
    this.#installFilterUi();
    const revealAfterFocus = () => this.#scheduleReveal();
    if (this.#filterInput && this.#callbacks.isOverlay()) {
      this.#lifetime.setTimeout(() => {
        if (!this.#callbacks.isOpen()) return;
        if (this.#callbacks.hasTouch()) this.#bindings.sidebar?.focus();
        else this.#filterInput?.focus();
        revealAfterFocus();
      }, 0);
    } else {
      revealAfterFocus();
    }
  }

  /** Releases view-specific focus and pending reveal when the sidebar closes. */
  close(): void {
    this.cancelReveal();
    this.#filterInput?.blur();
  }

  /** Whether a keyboard event target is the owned outline filter. */
  isFilterInput(element: Element | null): boolean {
    return element === this.#filterInput;
  }

  /** Updates the active semantic key and reveals only a changed item. */
  setActiveKey(key: string | null, reason: OutlineRevealReason = "selection-change"): void {
    const root = this.#bindings.content;
    if (!root) return;
    const selected =
      Array.from(root.querySelectorAll<HTMLLIElement>("li[data-outline-key]")).find(
        item => item.dataset.outlineKey === key,
      ) ?? null;
    const previous = root.querySelector<HTMLElement>(".pdf-outline-link.pdf-outline-current");
    const next = selected?.querySelector<HTMLElement>(".pdf-outline-link") ?? null;
    if (previous && previous !== next) previous.classList.remove("pdf-outline-current");
    next?.classList.add("pdf-outline-current");
    if (previous !== next) {
      if (reason === "opening") this.#scheduleReveal();
      else this.#scrollActiveIntoView(this.#callbacks.scrollBehavior());
    }
  }

  /** Invalidates pending opening reveal work. */
  cancelReveal(): void {
    this.#revealGeneration++;
  }

  /** Gives direct user input immediate ownership over an in-flight native smooth reveal. */
  #takeOverScroll(): void {
    this.cancelReveal();
    const scroll = this.#scrollElement();
    if (!scroll) return;
    const freeze = () => {
      const scrollBehavior = scroll.style.scrollBehavior;
      scroll.style.scrollBehavior = "auto";
      try {
        const top = scroll.scrollTop;
        const maximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
        const nudge = top < maximum ? Math.min(maximum, top + 1) : Math.max(0, top - 1);
        if (nudge !== top) scroll.scrollTo({ top: nudge, behavior: "auto" });
        scroll.scrollTo({ top, behavior: "auto" });
      } finally {
        scroll.style.scrollBehavior = scrollBehavior;
      }
    };
    freeze();
    this.#lifetime.requestAnimationFrame(freeze);
  }

  /** Scrolls the outline by line or page increments for navigation keys. */
  scrollByKey(key: string): void {
    const scroll = this.#scrollElement();
    if (!scroll) return;
    const line = Math.max(80, Math.round(scroll.clientHeight * 0.15));
    const page = Math.max(120, Math.round(scroll.clientHeight * 0.9));
    const delta =
      key === "ArrowUp"
        ? -line
        : key === "ArrowDown"
          ? line
          : key === "PageUp"
            ? -page
            : key === "PageDown"
              ? page
              : 0;
    if (delta) scroll.scrollBy({ top: delta, behavior: this.#callbacks.scrollBehavior() });
  }

  #present(outcome: Exclude<DocumentOutlinePreparationOutcome, { status: "cancelled" }>): void {
    const root = this.#bindings.content;
    if (root) {
      if (outcome.status === "error") {
        const failure = this.#document?.createElement("div");
        if (!failure) return;
        failure.className = "pdf-no-outline-text pdf-outline-error";
        failure.dataset.pdfjsUiTextContent = "outlineError";
        failure.textContent = this.#options.preparationErrorLabel;
        root.replaceChildren(failure);
      } else if (!outcome.items.length) {
        const empty = this.#document?.createElement("div");
        if (!empty) return;
        empty.className = "pdf-no-outline-text";
        empty.dataset.pdfjsUiTextContent = "noOutline";
        empty.textContent = this.#options.noOutlineLabel;
        root.replaceChildren(empty);
      } else {
        // Render the complete detached tree before attaching it, so observers never see a partial outline.
        root.replaceChildren(this.#renderEntries(outcome.items));
      }
    }
    this.#installFilterUi();
    this.#applyFilter();
    if (this.#callbacks.isOpen()) this.cancelReveal();
  }

  #renderEntries(entries: readonly DocumentOutlineEntry[]): HTMLUListElement {
    const ownerDocument = this.#document;
    if (!ownerDocument) throw new Error("DocumentOutlinePresentation requires an owner document");
    const root = ownerDocument.createElement("ul");
    root.className = "pdf-outline-list";
    type Task = { entry: DocumentOutlineEntry; parent: HTMLUListElement; depth: number };
    const tasks: Task[] = [];
    for (let index = entries.length - 1; index >= 0; index--)
      tasks.push({ entry: entries[index]!, parent: root, depth: 0 });
    while (tasks.length) {
      const { entry, parent, depth } = tasks.pop()!;
      const item = ownerDocument.createElement("li");
      item.dataset.outlineKey = entry.key;
      item.dataset.title = entry.title;
      item.dataset.depth = String(depth);
      if (entry.fallbackTitle) item.dataset.pdfjsUiTextContent = "outlineUntitled";
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = "pdf-outline-link";
      button.textContent = entry.title;
      if (entry.fallbackTitle) button.dataset.pdfjsUiTextContent = "outlineUntitled";
      this.#documentLifetime.listen(button, "click", () => this.#callbacks.select(entry.key));
      item.append(button);
      if (entry.destination) {
        item.dataset.page = String(entry.destination.page);
        item.dataset.yRatio = String(entry.destination.yRatio);
      }
      if (entry.children.length) {
        item.dataset.hasChildren = "true";
        const children = ownerDocument.createElement("ul");
        children.className = "pdf-outline-list";
        item.append(children);
        for (let index = entry.children.length - 1; index >= 0; index--)
          tasks.push({ entry: entry.children[index]!, parent: children, depth: depth + 1 });
      }
      parent.append(item);
    }
    return root;
  }

  #installFilterUi(): void {
    const sidebar = this.#bindings.sidebar;
    if (!sidebar || !this.#options.filterEnabled) return;
    let filter = this.#filter?.isConnected
      ? this.#filter
      : sidebar.querySelector<HTMLElement>(".pdf-outline-filter");
    let input = this.#filterInput?.isConnected
      ? this.#filterInput
      : sidebar.querySelector<HTMLInputElement>(".pdf-outline-filter-input");
    if (!input) {
      if (!filter) {
        filter = this.#document?.createElement("div") ?? null;
        if (!filter) return;
        filter.className = "pdf-outline-filter";
        sidebar.insertBefore(filter, sidebar.firstChild);
      }
      input = this.#document?.createElement("input") ?? null;
      if (!input) return;
      input.className = "pdf-outline-filter-input";
      input.type = "search";
      input.id = `${this.#options.viewerId}-outline-filter-input`;
      input.autocomplete = "off";
      input.placeholder = this.#options.filterLabel;
      input.setAttribute("aria-label", this.#options.filterLabel);
      input.dataset.pdfjsUiText = "outlineFilter";
      input.dataset.pdfjsUiTextAttribute = "placeholder aria-label";
      filter.appendChild(input);
      this.#packageFilterInput = input;
    } else if (!filter) {
      filter = this.#document?.createElement("div") ?? null;
      if (!filter) return;
      filter.className = "pdf-outline-filter";
      input.before(filter);
      filter.appendChild(input);
    }
    this.#filter = filter;
    if (input !== this.#filterInput) {
      this.#filterInput = input;
      this.#wireFilterInput();
    }
  }

  #wireFilterInput(): void {
    if (this.#filterInput)
      this.#lifetime.listen(this.#filterInput, "input", () => this.#applyFilter());
  }

  #directOutlineItems(parent: Element): HTMLLIElement[] {
    const list = Array.from(parent.children).find(child => child.tagName === "UL");
    return list
      ? Array.from(list.children).filter((child): child is HTMLLIElement => child.tagName === "LI")
      : [];
  }

  #applyFilter(): void {
    const content = this.#bindings.content;
    if (!content) return;
    const query = this.#filterInput?.value.trim() ?? "";
    const compiledQuery = query ? compileTextQuery(query, this.#options.filterOptions) : null;
    type Task = { item: HTMLLIElement; visited: boolean };
    const matches = new Map<HTMLLIElement, boolean>();
    const tasks = this.#directOutlineItems(content)
      .slice()
      .reverse()
      .map(item => ({ item, visited: false }));
    while (tasks.length) {
      const task = tasks.pop()!;
      if (!task.visited) {
        tasks.push({ item: task.item, visited: true });
        const children = this.#directOutlineItems(task.item);
        for (let index = children.length - 1; index >= 0; index--)
          tasks.push({ item: children[index]!, visited: false });
        continue;
      }
      const childMatch = this.#directOutlineItems(task.item).some(
        child => matches.get(child) === true,
      );
      const titleMatch =
        !compiledQuery ||
        findCompiledTextMatches(task.item.dataset.title ?? "", compiledQuery).length > 0;
      const match = titleMatch || childMatch;
      task.item.dataset.hidden = match ? "0" : "1";
      task.item.style.display = match ? "" : "none";
      matches.set(task.item, match);
    }
  }

  #scheduleReveal(): void {
    const panel = this.#bindings.sidebar;
    if (!panel) return;
    this.cancelReveal();
    const generation = this.#revealGeneration;
    const reveal = () =>
      this.#window?.requestAnimationFrame(() => {
        if (generation === this.#revealGeneration && this.#callbacks.isOpen())
          this.#scrollActiveIntoView("auto");
      });
    const CSSTransition = this.#window?.CSSTransition;
    const transitions = panel
      .getAnimations({ subtree: false })
      .filter(animation => !!CSSTransition && animation instanceof CSSTransition);
    if (!transitions.length) reveal();
    else void Promise.allSettled(transitions.map(transition => transition.finished)).then(reveal);
  }

  #scrollActiveIntoView(behavior: ScrollBehavior): void {
    if (!this.#callbacks.isOpen()) return;
    const scroll = this.#scrollElement();
    const link = this.#bindings.content?.querySelector<HTMLElement>(
      ".pdf-outline-link.pdf-outline-current",
    );
    if (!scroll || !link) return;
    const viewport = scroll.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const top = viewport.top + scroll.clientTop;
    const bottom = top + scroll.clientHeight;
    const delta =
      linkRect.top < top
        ? Math.floor(linkRect.top - top)
        : linkRect.bottom > bottom
          ? Math.ceil(linkRect.bottom - bottom)
          : 0;
    if (delta) scroll.scrollTo({ top: scroll.scrollTop + delta, behavior });
  }

  #scrollElement(): HTMLElement | null {
    const panel = this.#bindings.sidebar;
    const content = this.#bindings.content;
    if (!panel) return null;
    for (let element = content; element; element = element.parentElement) {
      const overflowY = this.#window?.getComputedStyle(element).overflowY ?? "visible";
      if (
        element.scrollHeight > element.clientHeight &&
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      )
        return element;
      if (element === panel) break;
    }
    return content ?? panel;
  }

  #platform(): LifecycleScopePlatform | null {
    const ownerWindow = this.#window;
    return ownerWindow
      ? {
          createAbortController: () => new ownerWindow.AbortController(),
          requestAnimationFrame: callback => ownerWindow.requestAnimationFrame(callback),
          cancelAnimationFrame: id => ownerWindow.cancelAnimationFrame(id),
          setTimeout: (callback, delay) => ownerWindow.setTimeout(callback, delay),
          clearTimeout: id => ownerWindow.clearTimeout(id),
        }
      : null;
  }
}
