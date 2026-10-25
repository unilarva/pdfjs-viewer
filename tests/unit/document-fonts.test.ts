// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import type * as PDFJS from "pdfjs-dist";
import {
  DocumentFontBudgetError,
  DocumentFonts,
  SourceFontError,
} from "../../src/document-fonts.js";
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
    pageNumber: 1,
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

test("caller abort releases operator-list preparation without waiting for its late settlement", async () => {
  for (const rejects of [false, true]) {
    const f = fixture();
    const owner = new DocumentFonts(f.document);
    const pending = deferred<typeof f.operators>();
    f.page.getOperatorList = () => pending.promise as never;
    const abort = new AbortController();
    const preparing = owner.prepare(f.page, 2, abort.signal);
    abort.abort();
    await preparing;
    assert.equal(f.loaded(), 0);

    // Another page can prepare while the abandoned PDF.js request is still pending.
    await owner.prepare(fixture().page, 2);
    assert.equal(f.loaded(), 1);
    if (rejects) pending.reject(new Error("late operator-list rejection"));
    else pending.resolve(f.operators);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(f.loaded(), 1);
    assert.equal(f.faces.size, 1);
    await owner.close([]);
  }
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
  let closed = false;
  const closing = owner.close([preparing]).then(() => {
    closed = true;
  });
  await preparing;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(closed, false, "close drains the uncancellable native load");
  assert.equal(f.faces.size, 0);
  pending.resolve();
  await closing;
  assert.equal(f.faces.size, 0);
});

test("closing revokes pending operator-list preparation and consumes late rejections", async () => {
  for (const rejects of [false, true]) {
    const f = fixture(),
      owner = new DocumentFonts(f.document);
    const pending = deferred<typeof f.operators>();
    f.page.getOperatorList = () => pending.promise as never;
    const preparing = owner.prepare(f.page, 2);
    let closed = false;
    const closing = owner.close([preparing]).then(() => {
      closed = true;
    });
    await preparing;
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(closed, false, "close drains the physical operator/dependency read");
    if (rejects) pending.reject(new Error("late font dependency rejection"));
    else pending.resolve(f.operators);
    await closing;
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

test("source owners copy exact native bytes and optionally prepare separate geometric aliases", async () => {
  for (const geometric of [false, true]) {
    const f = fixture();
    // A qualified view need not cover the complete transferred backing buffer.
    const backing = new Uint8Array(f.font.data.length + 8);
    backing.set(f.font.data, 4);
    f.font.data = backing.subarray(4, backing.length - 4);
    f.font.loadedName = "g_d42_f7";
    const owner = new DocumentFonts(f.document, { retainNativeFaces: true, geometric });
    await Promise.all([owner.prepare(f.page, 2), owner.prepare(f.page, 2)]);
    assert.equal(f.loaded(), geometric ? 2 : 1);
    const native = [...f.faces].find(face => face.family === f.font.loadedName)!;
    assert.ok(native);
    assert.deepEqual(new Uint8Array(native.source), f.font.data);
    assert.notEqual(native.source, f.font.data.buffer);
    const expectedBytes = [...f.faces].reduce((bytes, face) => bytes + face.source.byteLength, 0);
    assert.equal(owner.byteLength, expectedBytes);
    const context = {} as CanvasRenderingContext2D;
    assert.equal(owner.context(context, 1) === context, !geometric);
    await owner.close([]);
    assert.equal(owner.byteLength, 0);
  }
});

test("source generations isolate aliases and native document-scoped families", async () => {
  const f = fixture(),
    other = fixture();
  other.font.loadedName = "g_d2_f1";
  const first = new DocumentFonts(f.document, { retainNativeFaces: true });
  const second = new DocumentFonts(f.document, { retainNativeFaces: true });
  await first.prepare(f.page, 2);
  await second.prepare(other.page, 2);
  assert.equal(new Set([...f.faces].map(face => face.family)).size, 4);
  await first.close([]);
  assert.equal(f.faces.size, 2);
  assert.ok([...f.faces].every(face => face.family.startsWith("g_d2_f1")));
  await second.close([]);
});

test("source deletion never removes a still-registered PDF.js face with the same family", async () => {
  const f = fixture();
  const Original = f.document.defaultView!.FontFace;
  const original = new Original(f.font.loadedName, f.font.data.slice().buffer as ArrayBuffer);
  f.document.fonts.add(original);
  const owner = new DocumentFonts(f.document, { retainNativeFaces: true });
  await owner.prepare(f.page, 2);
  await owner.close([]);
  assert.deepEqual([...f.document.fonts], [original]);
});

test("base owners can disable geometry without copying a native face", async () => {
  const f = fixture();
  const owner = new DocumentFonts(f.document, { geometric: false });
  await owner.prepare(f.page, 2);
  assert.equal(f.loaded(), 0);
  assert.equal(owner.byteLength, 0);
  await owner.close([]);
});

test("source read failures reject instead of silently authorizing cold eviction", async () => {
  const f = fixture();
  f.page.getOperatorList = async () => {
    throw new Error("source read failed");
  };
  const owner = new DocumentFonts(f.document, { retainNativeFaces: true });
  await assert.rejects(owner.prepare(f.page, 2), SourceFontError);
  await owner.close([]);
});

test("native font ownership survives PDF.js identity deletion and retains survive close", async () => {
  const f = fixture();
  const Original = f.document.defaultView!.FontFace;
  const original = new Original(f.font.loadedName, f.font.data.slice().buffer as ArrayBuffer);
  f.document.fonts.add(original);
  const unrelated = new Original("unrelated", f.font.data.slice().buffer as ArrayBuffer);
  f.document.fonts.add(unrelated);
  const owner = new DocumentFonts(f.document, { retainNativeFaces: true, geometric: false });
  const lease = owner.retain();
  await owner.prepare(f.page, 2);
  const owned = [...f.document.fonts].find(face => face !== original && face !== unrelated)!;
  f.document.fonts.delete(original);
  assert.ok(f.document.fonts.has(owned));
  const closing = owner.close([]);
  assert.throws(() => owner.retain(), SourceFontError);
  await Promise.resolve();
  assert.ok(f.document.fonts.has(owned));
  lease.release();
  lease.release();
  await closing;
  assert.deepEqual([...f.document.fonts], [unrelated]);
  await owner.close([]);
  assert.deepEqual([...f.document.fonts], [unrelated]);
});

test("both retained text and physical raster drains are required, including repeated close drains", async () => {
  for (const releaseFirst of [false, true]) {
    const f = fixture();
    let charged = 0;
    const owner = new DocumentFonts(f.document, {
      retainNativeFaces: true,
      reserveBytes: bytes => {
        charged += bytes;
        return () => {
          charged -= bytes;
        };
      },
    });
    const lease = owner.retain();
    await owner.prepare(f.page, 2);
    const first = deferred<void>(),
      second = deferred<void>();
    const closing = owner.close([first.promise]);
    const again = owner.close([second.promise]);
    first.resolve();
    if (releaseFirst) lease.release();
    await Promise.resolve();
    assert.equal(f.faces.size, 2);
    assert.ok(charged > 0);
    second.resolve();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    if (!releaseFirst) {
      assert.equal(f.faces.size, 2);
      lease.release();
    }
    await Promise.all([closing, again]);
    assert.equal(f.faces.size, 0);
    assert.equal(charged, 0);
    // Even a close after completed disposal must wait for its newly supplied drain.
    const later = deferred<void>();
    let finished = false;
    const last = owner.close([later.promise]).then(() => {
      finished = true;
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(finished, false);
    later.resolve();
    await last;
  }
});

test("source budget refusal propagates for each native or alias buffer and releases admitted bytes", async () => {
  for (const denyAt of [1, 2]) {
    const f = fixture();
    let reservations = 0,
      releases = 0;
    const owner = new DocumentFonts(f.document, {
      retainNativeFaces: true,
      reserveBytes: () =>
        ++reservations === denyAt
          ? null
          : () => {
              releases++;
            },
    });
    await assert.rejects(owner.prepare(f.page, 2), DocumentFontBudgetError);
    assert.equal(reservations, denyAt);
    assert.equal(f.faces.size, denyAt - 1);
    await owner.close([]);
    assert.equal(releases, denyAt - 1);
    assert.equal(owner.byteLength, 0);
  }
  const f = fixture();
  const base = new DocumentFonts(f.document, { reserveBytes: () => null });
  await base.prepare(f.page, 2);
  assert.equal(f.loaded(), 0);
  assert.equal(base.context({} as CanvasRenderingContext2D, 1).font, undefined);
  await base.close([]);
});

test("source copy failures reject, while late successful or rejected loads release their budget", async () => {
  for (const late of [false, true]) {
    for (const rejects of [false, true]) {
      const f = fixture();
      const pending = deferred<void>(),
        started = deferred<void>();
      let charged = 0,
        releases = 0;
      const owner = new DocumentFonts(f.document, {
        retainNativeFaces: true,
        reserveBytes: bytes => {
          charged += bytes;
          return () => {
            charged -= bytes;
            releases++;
          };
        },
      });
      f.waitForLoad(() => {
        started.resolve();
        return pending.promise;
      });
      const preparing = owner.prepare(f.page, 2);
      const outcome = preparing.then(
        () => null,
        error => error as unknown,
      );
      await started.promise;
      assert.ok(charged > 0);
      let closed = false;
      const closing = late
        ? owner.close([]).then(() => {
            closed = true;
          })
        : undefined;
      if (late) {
        await preparing;
        for (let i = 0; i < 8; i++) await Promise.resolve();
        assert.equal(closed, false);
        assert.ok(charged > 0, "an unsettled native load keeps its byte reservation");
      }
      if (rejects) pending.reject(new Error("font load rejected"));
      else pending.resolve();
      const error = await outcome;
      await closing;
      if (!late && rejects) assert.ok(error instanceof SourceFontError);
      else assert.equal(error, null);
      for (let i = 0; i < 16; i++) await Promise.resolve();
      if (late || rejects) {
        assert.equal(f.faces.size, 0);
        assert.equal(charged, 0);
        assert.equal(releases, 1);
      }
      await owner.close([]);
      assert.equal(charged, 0);
      assert.equal(owner.byteLength, 0);
    }
  }
});

test("a rejected sibling font cannot release physical page ownership before other face loads settle", async () => {
  const f = fixture();
  const pending = deferred<void>(),
    started = deferred<void>();
  f.waitForLoad(() => {
    started.resolve();
    return pending.promise;
  });
  f.operators.argsArray[1] = ["f2", 12];
  f.page.commonObjs.get = ((id: string, ready: (font: unknown) => void) =>
    ready({ ...f.font, loadedName: id })) as never;
  let reservations = 0,
    charged = 0,
    released = 0;
  const owner = new DocumentFonts(f.document, {
    retainNativeFaces: true,
    geometric: false,
    reserveBytes: bytes => {
      if (++reservations === 2) return null;
      charged += bytes;
      return () => {
        charged -= bytes;
      };
    },
  });
  owner.bindPageUsage({
    acquire: async () => ({
      page: f.page,
      release: () => {
        released++;
      },
    }),
  });
  const abort = new AbortController();
  const preparing = owner.prepare(f.page, 2, abort.signal);
  await started.promise;
  abort.abort();
  await preparing;
  let closed = false;
  const closing = owner.close([]).then(() => {
    closed = true;
  });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.equal(reservations, 2);
  assert.equal(released, 0);
  assert.equal(closed, false);
  assert.ok(charged > 0);
  pending.resolve();
  await closing;
  assert.equal(released, 1);
  assert.equal(charged, 0);
  assert.equal(owner.byteLength, 0);
  assert.equal(f.faces.size, 0);
});
