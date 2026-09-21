// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Minimal owner-document platform for DOM-free unit tests. */
export interface TestPlatform {
  readonly document: Document;
  readonly window: Window & typeof globalThis;
  restore(): void;
}

export function installTestPlatform(
  createElement: (name: string) => Element,
  overrides: Partial<Window & typeof globalThis> = {},
): TestPlatform {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const ownerWindow = {
    setTimeout: (callback: () => void, delay: number) =>
      nativeSetTimeout(callback, delay) as unknown as number,
    clearTimeout: (id: number) => nativeClearTimeout(id),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    },
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
    IntersectionObserver: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    },
    getComputedStyle: () => ({
      borderLeftWidth: "0",
      borderRightWidth: "0",
      paddingLeft: "0",
      paddingRight: "0",
    }),
    ...overrides,
  } as unknown as Window & typeof globalThis;
  const ownerDocument = {
    baseURI: "https://viewer.example/document",
    defaultView: ownerWindow,
    createElement: (name: string) => {
      const element = createElement(name);
      Object.defineProperty(element, "ownerDocument", { configurable: true, value: ownerDocument });
      return element;
    },
  } as unknown as Document;
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: ownerDocument },
    window: { configurable: true, value: ownerWindow },
  });
  return {
    document: ownerDocument,
    window: ownerWindow,
    restore() {
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else delete (globalThis as { document?: unknown }).document;
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else delete (globalThis as { window?: unknown }).window;
    },
  };
}

/** Connects manually constructed fake nodes to the current test owner document. */
export function withTestOwnerDocument<T extends object>(element: T): T {
  Object.defineProperty(element, "ownerDocument", {
    configurable: true,
    value: globalThis.document,
  });
  return element;
}
