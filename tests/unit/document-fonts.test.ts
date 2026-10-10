// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type * as PDFJS from "pdfjs-dist";
import { DocumentFonts } from "../../src/document-fonts.js";
import { createTrueTypeFixture } from "./truetype-fixture.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const faces = new Set<Face>();
  let loaded = 0;
  let load = (): Promise<void> => Promise.resolve();
  class Face {
    constructor(
      readonly family: string,
      readonly source: ArrayBuffer,
    ) {
      loaded++;
    }
    async load() {
      await load();
      return this;
    }
  }
  const document = { fonts: faces, defaultView: { FontFace: Face } } as unknown as Document;
  const data = createTrueTypeFixture();
  const font = { loadedName: "pdf_test", data, disableFontFace: false };
  const operators = {
    fnArray: [37, 37],
    argsArray: [
      ["f1", 12],
      ["f1", 12],
    ],
  };
  const page = {
    getOperatorList: async () => operators,
    commonObjs: { get: (_id: string, ready: (font: unknown) => void) => ready(font) },
  } as unknown as PDFJS.PDFPageProxy;
  return {
    document,
    faces,
    page,
    font,
    operators,
    loaded: () => loaded,
    waitForLoad: (work: () => Promise<void>) => {
      load = work;
    },
  };
}

test("font preparation joins aliases and changes only owned context families without globals", async () => {
  const f = fixture();
  const owner = new DocumentFonts(f.document);
  await Promise.all([owner.prepare(f.page, 2), owner.prepare(f.page, 2)]);
  assert.equal(f.loaded(), 1);
  assert.equal(f.faces.size, 1);
  const family = [...f.faces][0].family;
  const canvas = {};
  const context = {
    font: "10px sans-serif",
    canvas,
    getTransform() {
      return { c: 0, d: 4 };
    },
    fillText(this: { font: string }) {
      return this.font;
    },
  } as unknown as CanvasRenderingContext2D;
  const original = context.fillText;
  const adapted = owner.context(context, 1);
  assert.notEqual(adapted, context);
  assert.equal(adapted.canvas, canvas);
  assert.equal(context.fillText, original);
  assert.equal(adapted.fillText, adapted.fillText);
  for (const quoted of [false, true]) {
    adapted.font = `italic 16px ${quoted ? '"pdf_test"' : "pdf_test"}, sans-serif`;
    const originalFont = adapted.font;
    assert.equal(adapted.fillText("b", 0, 0) as unknown, `italic 16px "${family}", sans-serif`);
    assert.equal(context.font, originalFont);
  }
  adapted.font = "12px other_font, serif";
  assert.equal(context.font, "12px other_font, serif");
  await owner.close([]);
  assert.equal(f.faces.size, 0);
});

test("document owners never share aliases or delete another owner's fonts", async () => {
  const f = fixture();
  const first = new DocumentFonts(f.document),
    second = new DocumentFonts(f.document);
  await Promise.all([first.prepare(f.page, 2), second.prepare(f.page, 2)]);
  assert.equal(new Set([...f.faces].map(face => face.family)).size, 2);
  await first.close([]);
  assert.equal(f.faces.size, 1);
  await second.close([]);
  assert.equal(f.faces.size, 0);
});

test("font deletion waits for captured physical raster settlement", async () => {
  const f = fixture(),
    owner = new DocumentFonts(f.document);
  await owner.prepare(f.page, 2);
  const active = deferred<void>();
  const closing = owner.close([active.promise]);
  assert.equal(f.faces.size, 1);
  await owner.prepare(f.page, 2);
  assert.equal(f.loaded(), 1);
  active.resolve();
  await closing;
  assert.equal(f.faces.size, 0);
});

test("canceling one preparation caller releases it without canceling shared font loading", async () => {
  const f = fixture(),
    owner = new DocumentFonts(f.document);
  const pending = deferred<void>(),
    started = deferred<void>();
  f.waitForLoad(() => {
    started.resolve();
    return pending.promise;
  });
  const abort = new AbortController();
  const first = owner.prepare(f.page, 2, abort.signal);
  await started.promise;
  const second = owner.prepare(f.page, 2);
  abort.abort();
  await first;
  assert.equal(f.faces.size, 0);
  pending.resolve();
  await second;
  assert.equal(f.loaded(), 1);
  assert.equal(f.faces.size, 1);
  await owner.close([]);
});

test("closing revokes pending font loads without registering late aliases", async () => {
  const f = fixture(),
    owner = new DocumentFonts(f.document);
  const pending = deferred<void>();
  const started = deferred<void>();
  f.waitForLoad(() => {
    started.resolve();
    return pending.promise;
  });
  const preparing = owner.prepare(f.page, 2);
  await started.promise;
  assert.equal(f.loaded(), 1);
  await owner.close([preparing]);
  assert.equal(f.faces.size, 0);
  pending.resolve();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(f.faces.size, 0);
});

test("closing revokes pending operator-list preparation and consumes late rejections", async () => {
  for (const rejects of [false, true]) {
    const f = fixture(),
      owner = new DocumentFonts(f.document);
    const pending = deferred<typeof f.operators>();
    f.page.getOperatorList = () => pending.promise as never;
    const preparing = owner.prepare(f.page, 2);
    await owner.close([preparing]);
    if (rejects) pending.reject(new Error("late font dependency rejection"));
    else pending.resolve(f.operators);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(f.loaded(), 0);
    assert.equal(f.faces.size, 0);
  }
});

test("unsupported fonts, explicit outlines, failed reads, and rejected font loads keep the original context", async () => {
  for (const failure of ["unsupported", "outline", "read", "load"] as const) {
    const f = fixture(),
      owner = new DocumentFonts(f.document);
    if (failure === "unsupported") f.font.data = new Uint8Array([0x4f, 0x54, 0x54, 0x4f]);
    if (failure === "outline") f.font.disableFontFace = true;
    if (failure === "read")
      f.page.getOperatorList = async () => {
        throw new Error("read failed");
      };
    if (failure === "load")
      f.waitForLoad(async () => {
        throw new Error("unsupported native font");
      });
    await owner.prepare(f.page, 2);
    const context = {} as CanvasRenderingContext2D;
    assert.equal(owner.context(context, 1), context);
    assert.equal(f.faces.size, 0);
    await owner.close([]);
  }
});
