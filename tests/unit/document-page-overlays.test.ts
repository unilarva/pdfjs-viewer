// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DocumentPageOverlays,
  type DocumentPageOverlayGeometry,
  type DocumentPageOverlayViewport,
} from "../../src/document-page-overlays.js";
import { installTestPlatform } from "./test-platform.js";

class Element extends EventTarget {
  declare ownerDocument: Document;
  className = "";
  style: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  contains(other: Element): boolean {
    return this === other || this.children.some(child => child.contains(other));
  }
  appendChild(child: Element): Element {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  getBoundingClientRect(): never {
    throw new Error("Overlay positioning must not measure DOM");
  }
}

function withOwner(
  run: (wrappers: Map<number, Element>, owner: DocumentPageOverlays) => void,
): void {
  const platform = installTestPlatform(() => new Element() as unknown as HTMLElement);
  const wrappers = new Map<number, Element>();
  for (const page of [1, 2])
    wrappers.set(page, platform.document.createElement("div") as unknown as Element);
  const owner = new DocumentPageOverlays(
    page => (wrappers.get(page) as unknown as HTMLDivElement) ?? null,
  );
  try {
    run(wrappers, owner);
  } finally {
    owner.reset();
    platform.restore();
  }
}

function element(): HTMLElement {
  return document.createElement("button");
}

const viewport: DocumentPageOverlayViewport = {
  rotation: 0,
  width: 200,
  height: 300,
  clone({ scale }) {
    return {
      ...this,
      width: 200 * scale,
      height: 300 * scale,
      convertToViewportPoint: (x, y) => [x * scale, (300 - y) * scale],
    };
  },
  convertToViewportPoint: (x, y) => [x, 300 - y],
};

test("rejects page surfaces and their ancestors before moving any DOM", () => {
  withOwner((wrappers, owner) => {
    const wrapper = wrappers.get(1)!;
    const ancestor = document.createElement("div") as unknown as Element;
    ancestor.appendChild(wrapper);
    for (const candidate of [wrapper, ancestor]) {
      assert.throws(
        () =>
          owner.register(
            { page: 1, anchor: { x: 0, y: 0 }, element: candidate as unknown as HTMLElement },
            viewport,
            1,
            0,
          ),
        /cannot contain/,
      );
      assert.equal(wrapper.parentElement, ancestor);
      assert.equal(ancestor.children.length, 1);
    }
  });
});

test("uses actual PDF viewport crop, intrinsic/viewer rotation, user units and CSS scale", async () => {
  const pdf = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 500 800] /CropBox [20 30 220 330] /Rotate 90 /UserUnit 2 /Resources << >> >> endobj
trailer << /Root 1 0 R >>
%%EOF`;
  const loading = getDocument({ data: new TextEncoder().encode(pdf) });
  const loaded = await loading.promise;
  try {
    const page = await loaded.getPage(1);
    const actual = page.getViewport({ scale: 1, rotation: page.rotate });
    withOwner((_wrappers, owner) => {
      const values: Readonly<DocumentPageOverlayGeometry>[] = [];
      owner.register(
        {
          page: 1,
          anchor: { x: 70, y: 130 },
          element: element(),
          onGeometry: value => values.push(value),
        },
        actual,
        1,
        0,
      );
      for (const rotation of [90, 180, 270]) owner.refresh(1, rotation);
      owner.refresh(0.5, 270);
      assert.deepEqual(values, [
        { x: 200, y: 100, width: 600, height: 400 },
        { x: 300, y: 200, width: 400, height: 600 },
        { x: 400, y: 300, width: 600, height: 400 },
        { x: 100, y: 400, width: 400, height: 600 },
        { x: 50, y: 200, width: 200, height: 300 },
      ]);
      assert.ok(values.every(Object.isFrozen));
    });
  } finally {
    await loading.destroy();
  }
});

test("stable shared hosts survive raster replacement and rebind to replacement page surfaces", () => {
  withOwner((wrappers, owner) => {
    const first = element();
    const second = element();
    const calls: Readonly<DocumentPageOverlayGeometry>[] = [];
    const disposeFirst = owner.register(
      { page: 1, anchor: { x: 20, y: 40 }, element: first, onGeometry: value => calls.push(value) },
      viewport,
      1,
      0,
    );
    const disposeSecond = owner.register(
      { page: 1, anchor: { x: 60, y: 40 }, element: second },
      viewport,
      1,
      0,
    );
    owner.register({ page: 2, anchor: { x: 2, y: 4 }, element: element() }, viewport, 1, 0);
    const host = wrappers.get(1)!.children[0]!;
    assert.equal(host.children.length, 2);
    const slot = first.parentElement;
    const raster = document.createElement("canvas") as unknown as Element;
    wrappers.get(1)!.appendChild(raster);
    raster.remove();
    owner.refresh(1, 0);
    assert.equal(calls.length, 1);
    const replacement = document.createElement("div") as unknown as Element;
    wrappers.set(1, replacement);
    owner.refresh(2, 0);
    assert.equal(replacement.children[0], host);
    assert.equal(first.parentElement, slot);
    assert.deepEqual(calls.at(-1), { x: 40, y: 520, width: 400, height: 600 });
    disposeFirst();
    disposeFirst();
    assert.equal(first.parentElement, null);
    assert.equal(host.children.length, 1);
    disposeSecond();
    assert.equal(replacement.children.length, 0);
  });
});

test("activity hides owned hosts before geometry callbacks and preserves consumers across topology changes", () => {
  withOwner((wrappers, owner) => {
    const control = element();
    control.style.visibility = "visible";
    control.inert = true;
    let callbacks = 0;
    owner.register(
      { page: 1, anchor: { x: 10, y: 20 }, element: control, onGeometry: () => callbacks++ },
      viewport,
      1,
      0,
    );
    const slot = control.parentElement!;
    const host = slot.parentElement!;
    owner.setActive(false);
    assert.equal(host.hidden, true);
    assert.equal(host.inert, true);
    assert.equal(callbacks, 1, "activity changes do not publish geometry");
    const replacement = document.createElement("div") as unknown as Element;
    wrappers.set(1, replacement);
    owner.refresh(2, 0);
    assert.equal(control.parentElement, slot);
    assert.equal(host.parentElement, replacement);
    assert.equal(host.hidden, true);
    assert.equal(host.inert, true);
    const late = element();
    let lateHidden: boolean | undefined;
    owner.register(
      {
        page: 2,
        anchor: { x: 10, y: 20 },
        element: late,
        onGeometry: () => {
          lateHidden = late.parentElement!.parentElement!.hidden === true;
        },
      },
      viewport,
      2,
      0,
    );
    assert.equal(lateHidden, true);
    const lateHost = late.parentElement!.parentElement!;
    owner.setActive(true);
    for (const current of [host, lateHost]) {
      assert.equal(current.hidden, false);
      assert.equal(current.inert, false);
    }
    assert.equal(control.parentElement, slot);
    assert.equal(control.style.visibility, "visible");
    assert.equal(control.inert, true, "consumer-owned inert state is not changed");
    assert.equal(callbacks, 2);
  });
});

test("document reset preserves host inactivity and stale disposers cannot affect a new registration", () => {
  withOwner((_wrappers, owner) => {
    const control = element();
    const dispose = owner.register(
      { page: 1, anchor: { x: 0, y: 0 }, element: control },
      viewport,
      1,
      0,
    );
    owner.setActive(false);
    owner.reset();
    assert.equal(control.parentElement, null);
    owner.register({ page: 1, anchor: { x: 0, y: 0 }, element: control }, viewport, 1, 0);
    const slot = control.parentElement!;
    assert.equal(slot.parentElement!.hidden, true);
    assert.equal(slot.parentElement!.inert, true);
    dispose();
    assert.equal(control.parentElement, slot);
    owner.setActive(true);
    assert.equal(slot.parentElement!.hidden, false);
  });
});

test("reset detaches consumers and removes input listeners; stale disposers cannot affect later registrations", () => {
  withOwner((_wrappers, owner) => {
    const control = element();
    let calls = 0;
    const dispose = owner.register(
      { page: 1, anchor: { x: 0, y: 0 }, element: control, onGeometry: () => calls++ },
      viewport,
      1,
      0,
    );
    const slot = control.parentElement!;
    for (const type of ["pointerdown", "pointerup", "click", "keydown", "wheel", "touchstart"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      let stopped = false;
      event.stopPropagation = () => {
        stopped = true;
      };
      slot.dispatchEvent(event);
      assert.equal(stopped, true, type);
      assert.equal(event.defaultPrevented, false, "native activation must remain available");
    }
    owner.reset();
    assert.equal(control.parentElement, null);
    const event = new Event("pointerdown");
    let stopped = false;
    event.stopPropagation = () => {
      stopped = true;
    };
    slot.dispatchEvent(event);
    assert.equal(stopped, false);
    owner.refresh(3, 0);
    assert.equal(calls, 1);
    owner.register({ page: 1, anchor: { x: 1, y: 2 }, element: control }, viewport, 1, 0);
    const newSlot = control.parentElement;
    dispose();
    assert.equal(control.parentElement, newSlot);
  });
});

test("isolates viewers, copies anchors, rejects duplicate elements and invalid input, and isolates callbacks", () => {
  withOwner((wrappers, owner) => {
    const anchor = { x: 10, y: 20 };
    const control = element();
    owner.register(
      {
        page: 1,
        anchor,
        element: control,
        onGeometry() {
          throw new Error("consumer");
        },
      },
      viewport,
      1,
      0,
    );
    anchor.x = 100;
    owner.refresh(2, 0);
    assert.equal(control.parentElement!.style.left, "20px");
    assert.throws(
      () => owner.register({ page: 1, anchor, element: control }, viewport, 1, 0),
      /already/,
    );
    assert.throws(
      () => owner.register({ page: 3, anchor, element: element() }, viewport, 1, 0),
      /Invalid/,
    );
    assert.throws(
      () =>
        owner.register({ page: 1, anchor: { x: NaN, y: 0 }, element: element() }, viewport, 1, 0),
      /Invalid/,
    );
    const otherWrapper = document.createElement("div") as unknown as Element;
    const other = new DocumentPageOverlays(() => otherWrapper as unknown as HTMLDivElement);
    other.register({ page: 1, anchor, element: element() }, viewport, 1, 0);
    owner.reset();
    assert.equal(wrappers.get(1)!.children.length, 0);
    assert.equal(otherWrapper.children.length, 1);
    other.reset();
  });
});
