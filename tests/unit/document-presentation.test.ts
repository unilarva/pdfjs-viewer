// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { DocumentPresentation } from "../../src/document-presentation.js";
import type {
  RenderPresentationCapabilities,
  RenderPresentationContext,
  RenderSurfaceLease,
} from "../../src/document-renderer.js";
import { installTestPlatform } from "./test-platform.js";

class FakeClassList {
  constructor(private readonly element: FakeElement) {}
  add(...names: string[]): void {
    const values = new Set(this.element.className.split(/\s+/).filter(Boolean));
    for (const name of names) values.add(name);
    this.element.className = [...values].join(" ");
  }
  contains(name: string): boolean {
    return this.element.className.split(/\s+/).includes(name);
  }
}

class FakeElement {
  get ownerDocument(): Document {
    return globalThis.document;
  }
  public className = "";
  public href = "";
  public target = "";
  public rel = "";
  public isConnected = true;
  public parent: FakeElement | null = null;
  public onclick: (() => boolean) | null = null;
  public readonly children: FakeElement[] = [];
  public readonly attributes = new Map<string, string>();
  public readonly style: Record<string, string> = {};
  public readonly dataset: Record<string, string> = {};
  public readonly classList = new FakeClassList(this);

  public append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  public appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    child.#setConnected(this.isConnected);
    this.children.push(child);
    return child;
  }
  public remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.#setConnected(false);
  }
  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  public querySelectorAll<T>(): T[] {
    const links: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      if (element.classList.contains("linkAnnotation")) {
        for (const child of element.children) links.push(child);
      }
      for (const child of element.children) visit(child);
    };
    visit(this);
    return links as T[];
  }
  public querySelector<T>(): T | null {
    return null;
  }
  public contains(candidate: unknown): boolean {
    let current = candidate instanceof FakeElement ? candidate : null;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }
  public click(): void {
    this.onclick?.();
  }
  public addEventListener(): void {}
  public dispatchEvent(): boolean {
    return true;
  }
  #setConnected(connected: boolean): void {
    this.isConnected = connected;
    for (const child of this.children) child.#setConnected(connected);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type FakeLayerParams = {
  div: FakeElement;
  page: unknown;
  viewport: unknown;
  linkService: {
    addLinkAttributes(link: FakeElement, url: string): void;
    getDestinationHash(destination: unknown): string;
    goToDestination(destination: unknown): void;
    executeNamedAction(action: string): void;
    executeSetOCGState(action: unknown): void;
    getAttachmentContent(id: string): Promise<Uint8Array | null>;
  };
  annotationCanvasMap: Map<string, HTMLCanvasElement>;
};

class FakeAnnotationLayer {
  static instances: FakeAnnotationLayer[] = [];
  static renderGate: Promise<void> | null = null;
  static renderError: unknown = null;
  readonly updates: unknown[] = [];
  readonly renders: Array<Record<string, unknown>> = [];
  destroyCount = 0;

  constructor(readonly params: FakeLayerParams) {
    FakeAnnotationLayer.instances.push(this);
  }
  async render(params: Record<string, unknown>): Promise<void> {
    this.renders.push(params);
    if (FakeAnnotationLayer.renderGate) await FakeAnnotationLayer.renderGate;
    if (FakeAnnotationLayer.renderError) throw FakeAnnotationLayer.renderError;
    for (const annotation of params.annotations as Array<Record<string, unknown>>) {
      const section = new FakeElement();
      section.className = "linkAnnotation";
      const link = new FakeElement();
      if (annotation.url) this.params.linkService.addLinkAttributes(link, annotation.url as string);
      else if (annotation.dest) {
        link.href = this.params.linkService.getDestinationHash(annotation.dest);
        link.onclick = () => {
          this.params.linkService.goToDestination(annotation.dest);
          return false;
        };
      }
      section.append(link);
      this.params.div.append(section);
    }
  }
  update(params: unknown): void {
    this.updates.push(params);
  }
  destroy(): void {
    this.destroyCount++;
  }
}

class FakeXfaLayer {
  static renders: Array<Record<string, unknown>> = [];
  static updates: Array<Record<string, unknown>> = [];
  static render(params: Record<string, unknown>): void {
    this.renders.push(params);
    (params.div as FakeElement).className = "xfaLayer xfaFont";
  }
  static update(params: Record<string, unknown>): void {
    this.updates.push(params);
  }
  static getPageViewport(): object {
    return { printViewport: true };
  }
}

function resetFakeLayer(): void {
  FakeAnnotationLayer.instances = [];
  FakeAnnotationLayer.renderGate = null;
  FakeAnnotationLayer.renderError = null;
  FakeXfaLayer.renders = [];
  FakeXfaLayer.updates = [];
}

function installFakeDocument(): () => void {
  const platform = installTestPlatform(() => new FakeElement() as unknown as Element);
  return () => platform.restore();
}

function owner(
  callbacks: ConstructorParameters<typeof DocumentPresentation>[1] = {},
  links = { internalDestinations: true, externalUrls: true },
  markup = { enabled: false, popups: false, fileAttachments: false },
  forms = { interactive: false, xfa: false },
): DocumentPresentation {
  return new DocumentPresentation(
    {
      AnnotationLayer:
        FakeAnnotationLayer as unknown as typeof import("pdfjs-dist").AnnotationLayer,
      XfaLayer: FakeXfaLayer as unknown as typeof import("pdfjs-dist").XfaLayer,
      annotationLinkLabel: "PDF link",
      annotationCommentLabel: "Annotation comment",
      annotationAttachmentLabel: "Open attachment",
      annotationAttachmentErrorLabel: "Attachment unavailable",
      xfaUnavailableLabel: "XFA unavailable",
      xfaHybridFallbackLabel: "XFA fallback",
      optionalContentActions: true,
      links,
      markup,
      forms,
    },
    callbacks,
  );
}

function context(
  wrapper: FakeElement,
  annotations: unknown[] | Promise<unknown[]>,
  overrides: Partial<RenderPresentationContext> = {},
): RenderPresentationContext {
  const canvas = new FakeElement();
  canvas.style.width = "600px";
  canvas.style.height = "800px";
  const lease = {
    pageNo: 1,
    wrapper,
    canvas,
    registrationEpoch: 1,
  } as unknown as RenderSurfaceLease;
  const viewport = {
    scale: 1,
    rotation: 0,
    clone: (params: unknown) => ({ scale: 1, rotation: 0, unflipped: true, cloneParams: params }),
  };
  return {
    documentId: 1,
    pageNo: 1,
    lease,
    viewport,
    page: { getAnnotations: () => Promise.resolve(annotations) },
    generation: 1,
    capabilities: { annotations: true, text: false },
    isCurrent: (capability: keyof RenderPresentationCapabilities) => capability === "annotations",
    rasterState: { optionalContentRevision: 0, annotationMode: 1 },
    annotationCanvasMap: new Map(),
    ...overrides,
  } as unknown as RenderPresentationContext;
}

test("runtime AnnotationLayer receives only policy-filtered links and stable package classes", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const destinations: unknown[] = [];
    let presentationCurrent = true;
    const destination = [0, { name: "Fit" }];
    const annotations = [
      {
        annotationType: 2,
        id: "external",
        rect: [0, 0, 10, 10],
        url: "/external",
        action: "Print",
      },
      { subtype: "Link", id: "internal", rect: [0, 0, 10, 10], dest: destination, resetForm: {} },
      { annotationType: 2, id: "named", rect: [0, 0, 10, 10], action: "NextPage" },
      { annotationType: 2, id: "ocg", rect: [0, 0, 10, 10], setOCGState: {} },
      { annotationType: 2, id: "attachment", rect: [0, 0, 10, 10], attachment: {} },
      { annotationType: 1, id: "not-link", rect: [0, 0, 10, 10], url: "https://ignored.example" },
    ];
    const presentation = owner({
      internalDestination: intent => {
        destinations.push(intent.destination);
      },
    });
    await presentation.present(
      context(wrapper, annotations, {
        isCurrent: capability => presentationCurrent && capability === "annotations",
      }),
    );

    assert.equal(FakeAnnotationLayer.instances.length, 1);
    const instance = FakeAnnotationLayer.instances[0];
    assert.deepEqual(instance.params.viewport, {
      scale: 1,
      rotation: 0,
      unflipped: true,
      cloneParams: { dontFlip: true },
    });
    const filtered = instance.renders[0].annotations as Array<Record<string, unknown>>;
    assert.deepEqual(
      filtered.map(item => item.id),
      ["external", "internal", "named"],
    );
    assert.equal(filtered[0].url, "https://viewer.example/external");
    assert.equal("action" in filtered[0], false);
    assert.equal("resetForm" in filtered[1], false);

    const layer = wrapper.children[0];
    assert.equal(layer.className, "annotationLayer pdf-annotation-layer pdf-annotation-link-layer");
    const links = layer.querySelectorAll<FakeElement>();
    assert.equal(links.length, 3);
    assert.ok(links.every(link => link.classList.contains("pdf-annotation-link")));
    assert.ok(links.every(link => link.attributes.get("aria-label") === "PDF link"));
    assert.equal(links[0].target, "_blank");
    assert.equal(links[0].rel, "noreferrer noopener");

    presentationCurrent = false;
    links[1].click();
    assert.deepEqual(
      destinations,
      [destination],
      "durable interaction does not use an expired renderer closure",
    );
    presentation.reset();
    links[1].click();
    assert.deepEqual(destinations, [destination]);
    assert.equal(instance.destroyCount, 1);
  } finally {
    restoreDocument();
  }
});

test("UI text refreshes only package-installed annotation fallback labels", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const presentation = owner();
    await presentation.present(
      context(wrapper, [
        { annotationType: 2, id: "link", rect: [0, 0, 10, 10], url: "https://example.com" },
      ]),
    );
    const layer = wrapper.children[0]!;
    const packageLink = layer.querySelectorAll<FakeElement>()[0]!;
    const section = new FakeElement();
    section.className = "linkAnnotation";
    const pdfLink = new FakeElement();
    pdfLink.setAttribute("aria-label", "PDF supplied label");
    const hostLabel = new FakeElement();
    hostLabel.setAttribute("aria-label", "Host supplied label");
    const packageComment = new FakeElement();
    packageComment.dataset.pdfjsUiOwnedAriaLabel = "annotationComment";
    packageComment.dataset.pdfjsUiOwnedAlt = "annotationComment";
    packageComment.setAttribute("aria-label", "Annotation comment");
    packageComment.setAttribute("alt", "Annotation comment");
    section.append(pdfLink, hostLabel, packageComment);
    layer.append(section);

    presentation.setUiText({
      annotationLinkLabel: "Package link",
      annotationCommentLabel: "Package comment",
      annotationAttachmentLabel: "Package attachment",
      annotationAttachmentErrorLabel: "Attachment failed",
      xfaUnavailableLabel: "XFA unavailable now",
      xfaHybridFallbackLabel: "XFA fallback",
    });

    assert.equal(packageLink.attributes.get("aria-label"), "Package link");
    assert.equal(packageComment.attributes.get("aria-label"), "Package comment");
    assert.equal(packageComment.attributes.get("alt"), "Package comment");
    assert.equal(pdfLink.attributes.get("aria-label"), "PDF supplied label");
    assert.equal(hostLabel.attributes.get("aria-label"), "Host supplied label");
  } finally {
    restoreDocument();
  }
});

test("viewport-only presentation updates the same exact layer and optional-content config", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const annotations = [
      { annotationType: 2, id: "link", rect: [0, 0, 10, 10], url: "https://example.com" },
    ];
    const map = new Map<string, HTMLCanvasElement>();
    const config = {} as never;
    const configPromise = Promise.resolve(config);
    const base = context(wrapper, annotations, {
      annotationCanvasMap: map,
      rasterState: {
        optionalContentRevision: 4,
        annotationMode: 1,
        optionalContentConfigPromise: configPromise,
      },
    });
    const presentation = owner();
    await presentation.present(base);
    await presentation.present({
      ...base,
      viewport: {
        ...base.viewport,
        scale: 2,
        clone: () => ({ scale: 2, rotation: 0, unflipped: true }),
      },
    } as unknown as RenderPresentationContext);

    assert.equal(FakeAnnotationLayer.instances.length, 1);
    const instance = FakeAnnotationLayer.instances[0];
    assert.equal(instance.params.annotationCanvasMap, map);
    assert.equal(instance.renders[0].annotationCanvasMap, map);
    assert.equal(instance.renders[0].optionalContentConfig, config);
    assert.deepEqual(instance.updates, [
      {
        viewport: { scale: 2, rotation: 0, unflipped: true },
        optionalContentConfig: config,
      },
    ]);
    assert.equal(instance.destroyCount, 0);
  } finally {
    restoreDocument();
  }
});

test("rich families and popup pairs are admitted while unsafe and unowned actions are removed", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const named: string[] = [];
    const ocg: unknown[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const presentation = owner(
      {
        namedNavigation: action => {
          named.push(action);
        },
        setOptionalContent: action => {
          ocg.push(action);
        },
        attachmentContent: async () => bytes,
      },
      { internalDestinations: true, externalUrls: true },
      {
        enabled: true,
        popups: true,
        fileAttachments: true,
      },
    );
    const annotations = [
      { annotationType: 1, id: "text", rect: [0, 0, 10, 10], contentsObj: { str: "note" } },
      { annotationType: 3, id: "free", rect: [0, 0, 10, 10] },
      { annotationType: 9, id: "highlight", popupRef: "popup", rect: [0, 0, 10, 10] },
      { annotationType: 10, id: "underline", rect: [0, 0, 10, 10] },
      { annotationType: 11, id: "squiggly", rect: [0, 0, 10, 10] },
      { annotationType: 12, id: "strikeout", rect: [0, 0, 10, 10] },
      { annotationType: 13, id: "stamp", rect: [0, 0, 10, 10] },
      { annotationType: 15, id: "ink", rect: [0, 0, 10, 10] },
      { annotationType: 16, id: "popup", rect: [0, 0, 10, 10], contentsObj: { str: "popup" } },
      { annotationType: 17, id: "file", fileId: "file-id", rect: [0, 0, 10, 10] },
      { annotationType: 2, id: "next", action: "NextPage", rect: [0, 0, 10, 10] },
      {
        annotationType: 2,
        id: "ocg",
        setOCGState: { state: ["Toggle", "layer"], preserveRB: true },
        rect: [0, 0, 10, 10],
      },
      { annotationType: 2, id: "print", action: "Print", rect: [0, 0, 10, 10] },
      { annotationType: 2, id: "reset", resetForm: {}, rect: [0, 0, 10, 10] },
      { annotationType: 2, id: "script", actions: { Action: "secret" }, rect: [0, 0, 10, 10] },
      { annotationType: 20, id: "widget", rect: [0, 0, 10, 10] },
      { annotationType: 27, id: "media", richMedia: {}, rect: [0, 0, 10, 10] },
    ];
    await presentation.present(context(wrapper, annotations));
    const filtered = FakeAnnotationLayer.instances[0].renders[0].annotations as Array<
      Record<string, unknown>
    >;
    assert.deepEqual(
      filtered.map(item => item.id),
      [
        "text",
        "free",
        "highlight",
        "underline",
        "squiggly",
        "strikeout",
        "stamp",
        "ink",
        "file",
        "next",
        "ocg",
        "popup",
      ],
    );
    assert.ok(
      filtered.every(
        item => !("actions" in item) && !("resetForm" in item) && !("richMedia" in item),
      ),
    );

    const service = FakeAnnotationLayer.instances[0].params.linkService;
    service.executeNamedAction("NextPage");
    service.executeNamedAction("Print");
    service.executeSetOCGState({ state: ["Toggle", "layer"] });
    assert.equal(await service.getAttachmentContent("file-id"), bytes);
    assert.deepEqual(named, ["NextPage"]);
    assert.deepEqual(ocg, [{ state: ["Toggle", "layer"], preserveRB: true }]);
  } finally {
    restoreDocument();
  }
});

test("disabled popup and attachment policy keeps base markup but removes popup metadata and pairs", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const presentation = owner(
      {},
      { internalDestinations: false, externalUrls: false },
      {
        enabled: true,
        popups: false,
        fileAttachments: false,
      },
    );
    await presentation.present(
      context(wrapper, [
        {
          annotationType: 9,
          id: "highlight",
          popupRef: "popup",
          rect: [0, 0, 10, 10],
          contentsObj: { str: "hidden" },
        },
        { annotationType: 16, id: "popup", rect: [0, 0, 10, 10], contentsObj: { str: "hidden" } },
        { annotationType: 17, id: "file", fileId: "file-id", rect: [0, 0, 10, 10] },
      ]),
    );
    const filtered = FakeAnnotationLayer.instances[0].renders[0].annotations as Array<
      Record<string, unknown>
    >;
    assert.deepEqual(
      filtered.map(item => item.id),
      ["highlight"],
    );
    assert.equal("popupRef" in filtered[0], false);
    assert.equal("contentsObj" in filtered[0], false);
  } finally {
    restoreDocument();
  }
});

test("annotation data, map, raster state, page, document, and surface identity changes rebuild exactly", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const firstAnnotations = [
      { annotationType: 2, id: "first", rect: [0, 0, 10, 10], url: "https://example.com" },
    ];
    const presentation = owner();
    let current = context(wrapper, firstAnnotations);
    await presentation.present(current);
    const variants: RenderPresentationContext[] = [
      context(wrapper, [{ ...firstAnnotations[0] }], { lease: current.lease }),
      { ...current, annotationCanvasMap: new Map() },
      { ...current, rasterState: { ...current.rasterState, optionalContentRevision: 1 } },
      { ...current, page: { getAnnotations: () => Promise.resolve(firstAnnotations) } as never },
      { ...current, documentId: 2 },
      context(wrapper, firstAnnotations, { documentId: 2 }),
    ];
    for (const variant of variants) {
      await presentation.present(variant);
      current = variant;
    }
    assert.equal(FakeAnnotationLayer.instances.length, 7);
    for (const instance of FakeAnnotationLayer.instances.slice(0, -1))
      assert.equal(instance.destroyCount, 1);
    assert.equal(FakeAnnotationLayer.instances.at(-1)?.destroyCount, 0);
    assert.equal(wrapper.children.length, 1);
  } finally {
    restoreDocument();
  }
});

test("focused annotation DOM never relaxes annotation-array or canvas-map identity", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const annotations = [
      { annotationType: 2, id: "link", rect: [0, 0, 10, 10], url: "https://example.com" },
    ];
    const presentation = owner();
    const first = context(wrapper, annotations);
    await presentation.present(first);
    (document as unknown as { activeElement: unknown }).activeElement =
      wrapper.children[0]?.children[0]?.children[0];

    await presentation.present({ ...first, annotationCanvasMap: new Map() });
    assert.equal(FakeAnnotationLayer.instances.length, 2);
    assert.equal(FakeAnnotationLayer.instances[0].destroyCount, 1);
    assert.equal(wrapper.children.length, 1);
  } finally {
    restoreDocument();
  }
});

test("reset synchronously destroys an in-flight layer and prevents stale render publication", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const gate = deferred<void>();
    FakeAnnotationLayer.renderGate = gate.promise;
    const presentation = owner();
    const pending = presentation.present(
      context(wrapper, [{ annotationType: 2, rect: [0, 0, 10, 10], url: "https://example.com" }]),
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(FakeAnnotationLayer.instances.length, 1);
    presentation.reset();
    assert.equal(FakeAnnotationLayer.instances[0].destroyCount, 1);
    gate.resolve();
    await pending;
    assert.equal(wrapper.children.length, 0);
    assert.equal(FakeAnnotationLayer.instances[0].destroyCount, 1);
  } finally {
    restoreDocument();
  }
});

test("reset rejects stale annotation reads before construction", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const annotations = deferred<unknown[]>();
    const presentation = owner();
    const pending = presentation.present(context(wrapper, annotations.promise));
    presentation.reset();
    annotations.resolve([{ annotationType: 2, rect: [0, 0, 10, 10], url: "https://example.com" }]);
    await pending;
    assert.equal(FakeAnnotationLayer.instances.length, 0);
    assert.equal(wrapper.children.length, 0);
  } finally {
    restoreDocument();
  }
});

test("eviction requires the exact surface and destroys it once", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const presentation = owner();
    const presentationContext = context(wrapper, [
      { annotationType: 2, rect: [0, 0, 10, 10], url: "https://example.com" },
    ]);
    await presentation.present(presentationContext);
    presentation.evict(1, { ...presentationContext.lease, registrationEpoch: 2 });
    assert.equal(wrapper.children.length, 1);
    assert.equal(FakeAnnotationLayer.instances[0].destroyCount, 0);
    presentation.evict(1, presentationContext.lease);
    presentation.evict(1, presentationContext.lease);
    assert.equal(wrapper.children.length, 0);
    assert.equal(FakeAnnotationLayer.instances[0].destroyCount, 1);
  } finally {
    restoreDocument();
  }
});

test("unsafe URLs stay blocked with non-sensitive diagnostics", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const diagnostics: Array<{ event: string; protocol: unknown }> = [];
    const presentation = owner(
      {
        diagnostic: entry =>
          diagnostics.push({ event: entry.event, protocol: entry.details.protocol }),
      },
      { internalDestinations: false, externalUrls: true },
    );
    await presentation.present(
      context(wrapper, [{ annotationType: 2, rect: [0, 0, 10, 10], url: "javascript:secret()" }]),
    );
    assert.deepEqual(FakeAnnotationLayer.instances[0].renders[0].annotations, []);
    assert.deepEqual(diagnostics, [{ event: "annotation-url-blocked", protocol: "javascript:" }]);
  } finally {
    restoreDocument();
  }
});

test("render failures destroy exactly once and remain isolated diagnostics", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const wrapper = new FakeElement();
    const diagnostics: string[] = [];
    FakeAnnotationLayer.renderError = new Error("render failed");
    const presentation = owner({ diagnostic: entry => diagnostics.push(entry.event) });
    await presentation.present(
      context(wrapper, [{ annotationType: 2, rect: [0, 0, 10, 10], url: "https://example.com" }]),
    );
    assert.equal(FakeAnnotationLayer.instances[0].destroyCount, 1);
    assert.equal(wrapper.children.length, 0);
    assert.deepEqual(diagnostics, ["annotation-presentation-failed"]);
  } finally {
    restoreDocument();
  }
});

class FakeAnnotationStorage {
  onSetModified: (() => void) | null = null;
  onResetModified: (() => void) | null = null;
  readonly values = new Map<string, Record<string, unknown>>();
  printReads = 0;
  getValue(id: string, fallback: Record<string, unknown>): Record<string, unknown> {
    return Object.assign(fallback, this.values.get(id));
  }
  getRawValue(id: string): Record<string, unknown> | undefined {
    return this.values.get(id);
  }
  has(id: string): boolean {
    return this.values.has(id);
  }
  remove(id: string): void {
    this.values.delete(id);
  }
  setValue(id: string, value: Record<string, unknown>): void {
    this.values.set(id, { ...this.values.get(id), ...value });
    this.onSetModified?.();
  }
  get print(): object {
    this.printReads++;
    return Object.freeze({ snapshot: this.printReads });
  }
  get size(): number {
    return this.values.size;
  }
  get serializable(): object {
    return {};
  }
  get editorStats(): object {
    return {};
  }
  get modifiedIds(): object {
    return { ids: new Set<string>(), hash: "" };
  }
  onAnnotationEditor: (() => void) | null = null;
  resetModified(): void {}
  resetModifiedIds(): void {}
  updateEditor(): boolean {
    return false;
  }
  getEditor(): undefined {
    return undefined;
  }
  [Symbol.iterator](): MapIterator<[string, Record<string, unknown>]> {
    return this.values[Symbol.iterator]();
  }
}

function formPdf(
  storage: FakeAnnotationStorage,
  saveDocument: () => Promise<Uint8Array> = async () => new Uint8Array([1, 2, 3]),
): import("pdfjs-dist").PDFDocumentProxy {
  return {
    annotationStorage: storage,
    getFieldObjects: async () =>
      new Map([
        [
          "sharedText",
          [
            { id: "field-1", page: 0, type: "text", value: "Loaded", defaultValue: "PDF default" },
            { id: "field-2", page: 1, type: "text", value: "Loaded", defaultValue: "PDF default" },
          ],
        ],
      ]),
    saveDocument,
  } as unknown as import("pdfjs-dist").PDFDocumentProxy;
}

test("forms namespace PDF.js global lookup keys per owner while translating storage to original IDs", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const firstStorage = new FakeAnnotationStorage();
    const secondStorage = new FakeAnnotationStorage();
    const dirty: boolean[] = [];
    const appearances: Array<[number, number]> = [];
    const first = owner(
      {
        dirtyChanged: value => dirty.push(value),
        formAppearanceChanged: (page, revision) => appearances.push([page, revision]),
      },
      { internalDestinations: true, externalUrls: true },
      {
        enabled: false,
        popups: false,
        fileAttachments: false,
      },
      { interactive: true, xfa: false },
    );
    const second = owner(
      {},
      { internalDestinations: true, externalUrls: true },
      {
        enabled: false,
        popups: false,
        fileAttachments: false,
      },
      { interactive: true, xfa: false },
    );
    await Promise.all([
      first.beginDocument(formPdf(firstStorage)),
      second.beginDocument(formPdf(secondStorage)),
    ]);
    const annotations = [
      {
        annotationType: 20,
        id: "field-1",
        fieldType: "Tx",
        fieldName: "sharedText",
        rect: [0, 0, 10, 10],
      },
    ];
    await first.present(
      context(new FakeElement(), annotations, {
        rasterState: { optionalContentRevision: 0, annotationMode: 2 },
      }),
    );
    await second.present(
      context(new FakeElement(), annotations, {
        rasterState: { optionalContentRevision: 0, annotationMode: 2 },
      }),
    );

    const firstRender = FakeAnnotationLayer.instances[0].renders[0];
    const secondRender = FakeAnnotationLayer.instances[1].renders[0];
    const firstWidget = (firstRender.annotations as Array<Record<string, unknown>>)[0];
    const secondWidget = (secondRender.annotations as Array<Record<string, unknown>>)[0];
    assert.notEqual(firstWidget.id, secondWidget.id);
    assert.notEqual(firstWidget.fieldName, secondWidget.fieldName);
    assert.equal(firstRender.renderForms, true);
    assert.equal(firstRender.enableScripting, false);
    assert.equal(firstRender.fieldObjects instanceof Map, true);
    assert.equal(
      (firstRender.fieldObjects as Map<string, unknown[]>).has(String(firstWidget.fieldName)),
      true,
    );
    const adapter = firstRender.annotationStorage as { setValue(id: string, value: object): void };
    adapter.setValue(String(firstWidget.id), { value: "Changed" });
    await Promise.resolve();
    assert.deepEqual(firstStorage.values.get("field-1"), { value: "Changed" });
    assert.equal(secondStorage.values.has("field-1"), false);
    assert.equal(first.formDirty, true);
    assert.deepEqual(dirty, [true]);
    assert.deepEqual(appearances, [[1, 1]]);
    assert.equal(first.formAppearanceRevision(1), 1);
    assert.deepEqual(first.thumbnailStorage(1, 1), { snapshot: 1 });
    assert.equal(firstStorage.printReads, 1);

    assert.equal(first.resetForms(), true);
    assert.deepEqual(firstStorage.values.get("field-1"), { value: "Loaded" });
    assert.equal(first.formDirty, false);
    assert.deepEqual(dirty, [true, false]);
  } finally {
    restoreDocument();
  }
});

test("form export joins concurrent saves, preserves dirty truth, and settles before stale cleanup", async () => {
  const gate = deferred<Uint8Array>();
  const storage = new FakeAnnotationStorage();
  let saves = 0;
  const presentation = owner(
    {},
    { internalDestinations: false, externalUrls: false },
    {
      enabled: false,
      popups: false,
      fileAttachments: false,
    },
    { interactive: true, xfa: false },
  );
  await presentation.beginDocument(
    formPdf(storage, () => {
      saves++;
      return gate.promise;
    }),
  );
  storage.setValue("field-1", { value: "Edited" });
  const first = presentation.exportDocumentWithFormValues();
  const second = presentation.exportDocumentWithFormValues();
  assert.equal(saves, 1);
  assert.equal(
    presentation.formDirty,
    true,
    "PDF.js modified callbacks do not define package dirty state",
  );
  const settlements = presentation.reset();
  assert.equal(settlements.length, 1);
  let drained = false;
  void settlements[0].then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  gate.resolve(new Uint8Array([9, 8, 7]));
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  await Promise.allSettled(settlements);
  assert.equal(drained, true);
});

test("form export exposes save failure without clearing authoritative dirty state", async () => {
  const storage = new FakeAnnotationStorage();
  const failure = new Error("save failed");
  const presentation = owner(
    {},
    { internalDestinations: false, externalUrls: false },
    {
      enabled: false,
      popups: false,
      fileAttachments: false,
    },
    { interactive: true, xfa: false },
  );
  await presentation.beginDocument(
    formPdf(storage, async () => {
      throw failure;
    }),
  );
  storage.setValue("field-1", { value: "Edited" });
  await assert.rejects(presentation.exportDocumentWithFormValues(), failure);
  assert.equal(presentation.formDirty, true);
});

test("pure XFA owns presentation, viewport updates, storage, reset, export, and print snapshots", async () => {
  const restoreDocument = installFakeDocument();
  resetFakeLayer();
  try {
    const storage = new FakeAnnotationStorage();
    const xfaPage = {
      name: "div",
      attributes: { class: ["xfaPage"], style: { width: "612px", height: "792px" } },
      children: [
        {
          name: "input",
          attributes: { id: "xfa-dom", dataId: "xfa-field", value: "Loaded" },
          children: [],
        },
      ],
    };
    const pdf = {
      annotationStorage: storage,
      isPureXfa: true,
      numPages: 1,
      allXfaHtml: { name: "div", attributes: {}, children: [xfaPage] },
      getMetadata: async () => ({
        info: { IsXFAPresent: true, IsAcroFormPresent: false },
        metadata: null,
      }),
      getFieldObjects: async () => null,
      saveDocument: async () => new Uint8Array([7, 8, 9]),
    } as unknown as import("pdfjs-dist").PDFDocumentProxy;
    const dirty: boolean[] = [];
    const presentation = owner({ dirtyChanged: value => dirty.push(value) }, undefined, undefined, {
      interactive: true,
      xfa: true,
    });
    await presentation.beginDocument(pdf);
    assert.equal(presentation.formPresentation, "pure-xfa");
    const wrapper = new FakeElement();
    const page = { getXfa: async () => xfaPage } as unknown as import("pdfjs-dist").PDFPageProxy;
    const renderContext = context(wrapper, [], { page });
    await presentation.present(renderContext);
    await presentation.present(renderContext);
    assert.equal(FakeXfaLayer.renders.length, 1);
    assert.equal(FakeXfaLayer.updates.length, 1);
    assert.match(wrapper.children[0].className, /pdf-xfa-layer/);
    const adapter = FakeXfaLayer.renders[0].annotationStorage as {
      setValue(id: string, value: object): void;
    };
    adapter.setValue("xfa-field", { value: "Edited" });
    assert.equal(presentation.formDirty, true);
    assert.deepEqual(dirty, [true]);
    assert.equal(presentation.xfaPrintSnapshot()?.pages.length, 1);
    assert.equal(presentation.resetForms(), true);
    assert.deepEqual(storage.values.get("xfa-field"), { value: "Loaded" });
    assert.equal(presentation.formDirty, false);
    assert.deepEqual(await presentation.exportDocumentWithFormValues(), new Uint8Array([7, 8, 9]));
    presentation.reset();
    assert.equal(wrapper.children.length, 0);
  } finally {
    restoreDocument();
  }
});

test("hybrid XFA stays on AcroForm presentation and reports the fallback", async () => {
  const diagnostics: string[] = [];
  const storage = new FakeAnnotationStorage();
  const presentation = owner(
    { diagnostic: entry => diagnostics.push(entry.event) },
    undefined,
    undefined,
    {
      interactive: true,
      xfa: true,
    },
  );
  const pdf = {
    ...formPdf(storage),
    isPureXfa: false,
    getMetadata: async () => ({
      info: { IsXFAPresent: true, IsAcroFormPresent: true },
      metadata: null,
    }),
  } as unknown as import("pdfjs-dist").PDFDocumentProxy;
  await presentation.beginDocument(pdf);
  assert.equal(presentation.formPresentation, "hybrid-acroform-fallback");
  assert.deepEqual(diagnostics, ["xfa-hybrid-acroform-fallback"]);
});

test("unsupported proprietary pure XFA publishes an accessible unavailable page", async () => {
  const restoreDocument = installFakeDocument();
  const diagnostics: string[] = [];
  try {
    const pdf = {
      isPureXfa: true,
      numPages: 1,
      allXfaHtml: { name: "div", attributes: {}, children: [] },
      getMetadata: async () => ({ info: { IsXFAPresent: true }, metadata: null }),
      getFieldObjects: async () => null,
    } as Record<string, unknown>;
    Object.defineProperty(pdf, "annotationStorage", {
      get: () => {
        throw new Error("optional storage unavailable");
      },
    });
    const presentation = owner(
      { diagnostic: entry => diagnostics.push(entry.event) },
      undefined,
      undefined,
      {
        interactive: true,
        xfa: true,
      },
    );
    await presentation.beginDocument(pdf as unknown as import("pdfjs-dist").PDFDocumentProxy);
    assert.equal(
      presentation.formPresentation,
      "pure-xfa",
      "storage failure must not select ordinary annotations",
    );
    assert.equal(presentation.formsEnabled, false);
    const wrapper = new FakeElement();
    await presentation.present(
      context(wrapper, [], {
        page: { getXfa: async () => null } as unknown as import("pdfjs-dist").PDFPageProxy,
      }),
    );
    assert.equal(wrapper.children.length, 1);
    assert.match(wrapper.children[0].className, /pdf-xfa-unavailable/);
    assert.equal(wrapper.children[0].attributes.get("role"), "status");
    assert.equal(wrapper.children[0].attributes.get("aria-label"), "XFA unavailable");
    assert.equal(
      (wrapper.children[0] as FakeElement & { textContent?: string }).textContent,
      "XFA unavailable",
    );
    presentation.setUiText({
      annotationLinkLabel: "PDF link",
      annotationCommentLabel: "Annotation comment",
      annotationAttachmentLabel: "Open attachment",
      annotationAttachmentErrorLabel: "Attachment unavailable",
      xfaUnavailableLabel: "XFA unavailable now",
      xfaHybridFallbackLabel: "XFA fallback",
    });
    assert.equal(wrapper.children[0].attributes.get("aria-label"), "XFA unavailable now");
    assert.equal(
      (wrapper.children[0] as FakeElement & { textContent?: string }).textContent,
      "XFA unavailable now",
    );
    assert.equal(FakeAnnotationLayer.instances.length, 0);
    assert.deepEqual(diagnostics, ["form-storage-unavailable", "xfa-presentation-unavailable"]);
  } finally {
    restoreDocument();
  }
});

test("failed pure-XFA acquisition publishes the same accessible unavailable page", async () => {
  const restoreDocument = installFakeDocument();
  try {
    const storage = new FakeAnnotationStorage();
    const presentation = owner({}, undefined, undefined, {
      interactive: true,
      xfa: true,
    });
    await presentation.beginDocument({
      annotationStorage: storage,
      isPureXfa: true,
      numPages: 1,
      allXfaHtml: { name: "div", attributes: {}, children: [] },
      getMetadata: async () => null,
      getFieldObjects: async () => null,
    } as unknown as import("pdfjs-dist").PDFDocumentProxy);
    const wrapper = new FakeElement();
    await presentation.present(
      context(wrapper, [], {
        page: {
          getXfa: async () => {
            throw new Error("unsupported XFA packet");
          },
        } as unknown as import("pdfjs-dist").PDFPageProxy,
      }),
    );
    assert.equal(wrapper.children[0].attributes.get("role"), "status");
    assert.equal(
      (wrapper.children[0] as FakeElement & { textContent?: string }).textContent,
      "XFA unavailable",
    );
  } finally {
    restoreDocument();
  }
});
