// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentTextPresentation } from "../../src/document-text-presentation.js";
import type { RenderPresentationContext } from "../../src/document-renderer.js";
import { PDFJS_TEXT_CONTENT_PARAMS } from "../../src/text-content-policy.js";
import { installTestPlatform } from "./test-platform.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class TextNode {
  static TEXT_NODE = 3;
  nodeType = 1;
  textContent = "";
  className = "";
  parentNode: TextNode | null = null;
  readonly childNodes: TextNode[] = [];
  readonly style: Record<string, string> = {};
  get ownerDocument(): Document {
    return globalThis.document;
  }
  get firstChild(): TextNode | null {
    return this.childNodes[0] ?? null;
  }
  get parentElement(): TextNode | null {
    return this.parentNode;
  }
  get isConnected(): boolean {
    return this.parentNode != null || this.root;
  }
  root = false;
  readonly classList = {
    add: (...names: string[]) => {
      this.className += ` ${names.join(" ")}`;
    },
    toggle: (name: string, enabled: boolean) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (enabled) names.add(name);
      else names.delete(name);
      this.className = [...names].join(" ");
    },
  };
  append(...nodes: TextNode[]): void {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  remove(): void {
    if (this.parentNode)
      this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren(...nodes: TextNode[]): void {
    for (const node of [...this.childNodes]) node.remove();
    this.append(...nodes);
  }
  contains(node: TextNode | null): boolean {
    return node === this || this.childNodes.some(child => child.contains(node));
  }
  closest(): null {
    return null;
  }
  querySelectorAll(): TextNode[] {
    return [];
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect;
  }
}

function platform() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const listeners = new Map<string, () => void>();
  const selection = {
    anchorNode: null as TextNode | null,
    focusNode: null as TextNode | null,
    anchorOffset: 0,
    focusOffset: 0,
    get isCollapsed() {
      return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset;
    },
    get rangeCount() {
      return this.anchorNode ? 1 : 0;
    },
    removeAllRanges() {
      this.anchorNode = this.focusNode = null;
    },
    setBaseAndExtent(anchor: TextNode, start: number, focus: TextNode, end: number) {
      this.anchorNode = anchor;
      this.anchorOffset = start;
      this.focusNode = focus;
      this.focusOffset = end;
    },
  };
  const installed = installTestPlatform(() => new TextNode() as unknown as Element, {
    Node: TextNode,
    HTMLElement: TextNode,
    Element: TextNode,
    addEventListener() {},
    removeEventListener() {},
    queueMicrotask,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
  } as unknown as Partial<Window & typeof globalThis>);
  Object.assign(installed.document, {
    addEventListener: (name: string, callback: () => void) => {
      listeners.set(name, callback);
    },
    removeEventListener: (name: string) => {
      listeners.delete(name);
    },
    getSelection: () => selection,
    createDocumentFragment: () => new TextNode(),
    createRange: () => ({ setStart() {}, setEnd() {}, detach() {}, getClientRects: () => [] }),
  });
  const previous = ["Node", "HTMLSpanElement"].map(
    name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name] of previous)
    Object.defineProperty(globalThis, name, { configurable: true, value: TextNode });
  return {
    selection,
    select(anchor: TextNode, focus: TextNode) {
      selection.setBaseAndExtent(anchor, 0, focus, 3);
      listeners.get("selectionchange")?.();
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    },
    restore() {
      installed.restore();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

function fonts() {
  const state = { retained: 0, released: 0, closed: false };
  const owner = {
    retain() {
      assert.equal(state.closed, false, "closed generation cannot admit a new font lease");
      state.retained++;
      let released = false;
      return {
        release() {
          if (!released) {
            released = true;
            state.released++;
          }
        },
      };
    },
  };
  return {
    state,
    owner: owner as unknown as NonNullable<
      NonNullable<RenderPresentationContext["source"]>["fonts"]
    >,
  };
}

function context(
  container: TextNode,
  pageNo: number,
  source?: RenderPresentationContext["source"],
): RenderPresentationContext {
  const wrapper = new TextNode();
  container.append(wrapper);
  return {
    pageNo,
    page: {} as never,
    documentId: 1,
    generation: 1,
    lease: { pageNo, wrapper, canvas: new TextNode(), registrationEpoch: 1 } as never,
    viewport: { scale: 1, rotation: 0 } as never,
    capabilities: { text: true, annotations: false },
    rasterState: { optionalContentRevision: 0, annotationMode: 1 },
    annotationCanvasMap: new Map(),
    isCurrent: () => true,
    source,
  };
}

function source(
  owner = fonts().owner,
  overrides: Partial<NonNullable<RenderPresentationContext["source"]>> = {},
): NonNullable<RenderPresentationContext["source"]> {
  return {
    id: "aux",
    revision: 1,
    logicalPage: 7,
    sourcePage: 1,
    pdf: {} as never,
    linkContext: "source",
    fonts: owner,
    isCurrent: () => true,
    ...overrides,
  };
}

function presenter(container: TextNode, gates: Promise<void>[] = [], onBuild?: () => void) {
  const builders: Array<{
    page: unknown;
    div: TextNode;
    renders: number;
    cancellations: number;
    params?: object;
  }> = [];
  const owner = new DocumentTextPresentation({
    container: container as unknown as HTMLElement,
    TextLayer: class {} as never,
    createTextLayerBuilder: options => {
      onBuild?.();
      const builder = {
        page: options.pdfPage,
        div: new TextNode(),
        renders: 0,
        cancellations: 0,
        params: undefined as object | undefined,
      };
      builders.push(builder);
      return {
        div: builder.div as unknown as HTMLDivElement,
        async render(params) {
          builder.renders++;
          builder.params = params.textContentParams;
          const span = new TextNode();
          const text = new TextNode();
          text.nodeType = 3;
          text.textContent = "visible";
          span.append(text);
          builder.div.append(span);
          options.highlighter.setTextMapping([span as unknown as HTMLSpanElement], ["visible"]);
          await gates.shift();
          options.onAppend(builder.div as unknown as HTMLDivElement);
        },
        cancel() {
          builder.cancellations++;
        },
      };
    },
  });
  owner.setMode(true);
  owner.setViewportPages([7, 8, 9]);
  return { owner, builders };
}

test("text admission retains source fonts before builder creation and uses the resolved source page", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const font = fonts();
  const { owner, builders } = presenter(container, [], () => assert.equal(font.state.retained, 1));
  try {
    const ctx = context(container, 7, source(font.owner));
    await owner.present(ctx);
    assert.equal(builders[0].page, ctx.page);
    assert.equal(builders[0].params, PDFJS_TEXT_CONTENT_PARAMS);
    assert.equal(font.state.released, 0);
    assert.equal(builders[0].div.isConnected, true);
    owner.invalidatePages(new Set([7]));
    assert.equal(builders[0].div.isConnected, false);
    assert.equal(font.state.released, 1);
    owner.destroy();
    assert.equal(font.state.released, 1);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("source font leases wait for every overlapping builder call after synchronous invalidation", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const first = deferred();
  const second = deferred();
  const font = fonts();
  const { owner, builders } = presenter(container, [first.promise, second.promise]);
  try {
    const ctx = context(container, 7, source(font.owner));
    const a = owner.present(ctx);
    const b = owner.present({ ...ctx, generation: 2 });
    assert.equal(builders[0].renders, 2);
    owner.invalidatePages(new Set([7]));
    assert.equal(font.state.released, 0);
    first.resolve();
    await a;
    assert.equal(font.state.released, 0);
    second.reject(new Error("cancel physically settled"));
    await b;
    assert.equal(font.state.released, 1);
    assert.equal(builders[0].div.isConnected, false);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("reopened source generations rebuild unfinished records but keep completed DOM on its original font owner", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const gate = deferred();
  const oldFont = fonts();
  const newFont = fonts();
  const { owner, builders } = presenter(container, [gate.promise]);
  try {
    const ctx = context(container, 7, source(oldFont.owner));
    const pending = owner.present(ctx);
    oldFont.state.closed = true;
    const reopened = { ...ctx, source: source(newFont.owner), page: {} as never };
    await owner.present(reopened);
    assert.equal(builders.length, 2);
    assert.equal(oldFont.state.released, 0);
    gate.resolve();
    await pending;
    assert.equal(oldFont.state.released, 1);
    const thirdFont = fonts();
    thirdFont.state.closed = true;
    await owner.present({ ...reopened, source: source(thirdFont.owner), page: {} as never });
    assert.equal(builders.length, 2, "completed DOM needs no expired page or new font admission");
    assert.equal(newFont.state.released, 0);
    const rotationFont = fonts();
    await owner.present({
      ...reopened,
      source: source(rotationFont.owner),
      viewport: { scale: 1, rotation: 90 } as never,
    });
    assert.equal(builders.length, 3);
    assert.equal(newFont.state.released, 1);
    owner.destroy();
    assert.equal(rotationFont.state.released, 1);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("targeted text invalidation clears spanning selection pins and stale node mappings, preserving unrelated work", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const pendingGate = deferred();
  const gates: Promise<void>[] = [];
  const { owner, builders } = presenter(container, gates);
  try {
    const a = context(container, 7, source());
    const b = context(container, 8, source());
    await owner.present(a);
    await owner.present(b);
    const firstText = builders[0].div.firstChild!.firstChild!;
    const secondText = builders[1].div.firstChild!.firstChild!;
    dom.select(firstText, secondText);
    assert.deepEqual(owner.selectionPageNos(), [7, 8]);
    assert.equal(owner.isTextSelectionTarget(firstText as unknown as EventTarget), true);
    const extraFont = fonts();
    // A different page's pending writer must remain admitted through invalidation.
    gates.push(pendingGate.promise);
    const pending = owner.present(context(container, 9, source(extraFont.owner)));
    owner.setViewportPages([7, 9]);
    owner.invalidatePages(new Set([7]));
    assert.deepEqual(owner.selectionPageNos(), []);
    assert.equal(dom.selection.rangeCount, 0);
    assert.equal(owner.isTextSelectionTarget(firstText as unknown as EventTarget), false);
    assert.equal(builders[1].div.isConnected, true);
    assert.equal(extraFont.state.released, 0);
    pendingGate.resolve();
    await pending;
    assert.equal(builders[2].div.isConnected, true);
    owner.destroy();
    assert.equal(extraFont.state.released, 1);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("source revocation rejects stale text append even when the renderer context remains current", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const gate = deferred();
  const font = fonts();
  let current = true;
  const { owner, builders } = presenter(container, [gate.promise]);
  try {
    const pending = owner.present(
      context(container, 7, source(font.owner, { isCurrent: () => current })),
    );
    current = false;
    assert.equal(font.state.released, 0);
    gate.resolve();
    await pending;
    assert.equal(builders[0].div.isConnected, false);
    assert.equal(font.state.released, 1);
    await owner.present(context(container, 8, source(font.owner, { isCurrent: () => false })));
    assert.equal(builders.length, 1);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("base text works without a source font lease and source revision changes rebuild records", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const { owner, builders } = presenter(container);
  try {
    const ctx = context(container, 7);
    await owner.present(ctx);
    await owner.present({ ...ctx, source: source(undefined, { revision: 1 }) });
    await owner.present({ ...ctx, source: source(undefined, { revision: 2 }) });
    assert.equal(builders.length, 3);
    assert.equal(builders[0].cancellations, 1);
    assert.equal(builders[1].cancellations, 1);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("default PDF.js TextLayer streams the derived page with the same policy as search", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const font = fonts();
  const gate = deferred();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ items: [], styles: {} });
      controller.close();
    },
  });
  let reads = 0;
  let cancellations = 0;
  class RuntimeTextLayer {
    readonly textDivs: HTMLSpanElement[] = [];
    readonly textContentItemsStr: string[] = [];
    constructor(readonly options: { textContentSource: unknown; container: TextNode }) {
      assert.equal(font.state.retained, 1);
      assert.ok(options.textContentSource instanceof ReadableStream);
    }
    async render() {
      const span = new TextNode();
      this.textDivs.push(span as unknown as HTMLSpanElement);
      this.textContentItemsStr.push("visible");
      this.options.container.append(span);
      await gate.promise;
    }
    cancel() {
      cancellations++;
    }
  }
  const owner = new DocumentTextPresentation({
    container: container as unknown as HTMLElement,
    TextLayer: RuntimeTextLayer as never,
  });
  owner.setMode(true);
  owner.setViewportPages([7]);
  try {
    const ctx = context(container, 7, source(font.owner));
    const pending = owner.present({
      ...ctx,
      page: {
        streamTextContent(params: unknown) {
          assert.equal(params, PDFJS_TEXT_CONTENT_PARAMS);
          reads++;
          return stream;
        },
      } as never,
    });
    assert.equal(reads, 1);
    owner.invalidatePages(new Set([7]));
    assert.equal(cancellations, 1);
    assert.equal(font.state.released, 0);
    gate.resolve();
    await pending;
    assert.equal(font.state.released, 1);
    assert.equal((ctx.lease.wrapper as unknown as TextNode).childNodes.length, 0);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("failed text builder admission releases its font retain without leaving a record", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const font = fonts();
  const owner = new DocumentTextPresentation({
    container: container as unknown as HTMLElement,
    TextLayer: class {} as never,
    createTextLayerBuilder() {
      throw new Error("builder construction failed");
    },
  });
  owner.setMode(true);
  owner.setViewportPages([7]);
  try {
    await assert.rejects(
      owner.present(context(container, 7, source(font.owner))),
      /builder construction failed/,
    );
    assert.equal(font.state.retained, 1);
    assert.equal(font.state.released, 1);
    assert.equal(owner.needsPresentation(7, 1), true);
  } finally {
    owner.destroy();
    dom.restore();
  }
});

test("default TextLayer cancellation waits for upstream worker stream cancellation, not its early render rejection", async () => {
  const dom = platform();
  const container = new TextNode();
  container.root = true;
  const font = fonts();
  const render = deferred();
  const drain = deferred();
  const cancelStarted = deferred();
  const stream = new ReadableStream({
    cancel() {
      cancelStarted.resolve();
      return drain.promise;
    },
  });
  class RuntimeTextLayer {
    readonly textDivs: HTMLSpanElement[] = [];
    readonly textContentItemsStr: string[] = [];
    readonly reader: ReadableStreamDefaultReader;
    constructor(options: { textContentSource: ReadableStream }) {
      this.reader = options.textContentSource.getReader();
    }
    render() {
      void this.reader.read().catch(() => {});
      return render.promise;
    }
    cancel() {
      void this.reader.cancel().catch(() => {});
      render.reject(new Error("TextLayer render revoked before worker cancellation settles"));
    }
  }
  const owner = new DocumentTextPresentation({
    container: container as unknown as HTMLElement,
    TextLayer: RuntimeTextLayer as never,
  });
  owner.setMode(true);
  owner.setViewportPages([7]);
  try {
    const ctx = context(container, 7, source(font.owner));
    const pending = owner.present({ ...ctx, page: { streamTextContent: () => stream } as never });
    owner.invalidatePages(new Set([7]));
    await cancelStarted.promise;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(font.state.released, 0, "worker cancellation is still physically pending");
    drain.resolve();
    await pending;
    assert.equal(font.state.released, 1);
  } finally {
    drain.resolve();
    owner.destroy();
    dom.restore();
  }
});
