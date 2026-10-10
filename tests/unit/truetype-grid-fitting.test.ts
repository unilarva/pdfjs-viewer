// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { inhibitTrueTypeGridFitting } from "../../src/truetype-grid-fitting.js";
import { createTrueTypeFixture as fixture } from "./truetype-fixture.js";

function tables(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Map<string, Uint8Array>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const start = 12 + 16 * i;
    const tag = String.fromCharCode(...bytes.subarray(start, start + 4));
    const offset = view.getUint32(start + 8),
      length = view.getUint32(start + 12);
    result.set(tag, bytes.slice(offset, offset + length));
  }
  return result;
}

test("inhibits grid fitting while preserving outlines, hint programs, and the original source", () => {
  for (const hasPrep of [false, true]) {
    const source = fixture(hasPrep);
    const original = source.slice();
    const output = inhibitTrueTypeGridFitting(source)!;
    assert.deepEqual(source, original);
    assert.notEqual(output, source);
    const before = tables(source),
      after = tables(output);
    assert.deepEqual(after.get("glyf"), before.get("glyf"));
    assert.deepEqual(after.get("loca"), before.get("loca"));
    assert.deepEqual(
      after.get("prep"),
      new Uint8Array([...(before.get("prep") ?? []), 0x22, 0xb1, 1, 1, 0x8e]),
    );
    assert.equal(new DataView(after.get("maxp")!.buffer).getUint16(24), 2);
  }
});

test("rebuilds aligned sorted SFNT tables, checksums, and the font checksum adjustment", () => {
  const output = inhibitTrueTypeGridFitting(fixture())!;
  const view = new DataView(output.buffer);
  let total = 0;
  for (let i = 0; i < output.length; i += 4) total = (total + view.getUint32(i)) >>> 0;
  assert.equal(total, 0xb1b0afba);
  const names = [...tables(output).keys()];
  assert.deepEqual(names, [...names].sort());
  for (let i = 0; i < names.length; i++) {
    const start = 12 + i * 16;
    const offset = view.getUint32(start + 8),
      length = view.getUint32(start + 12);
    assert.equal(offset % 4, 0);
    let sum = 0;
    for (let j = 0; j < Math.ceil(length / 4) * 4; j += 4) {
      sum = (sum + (names[i] === "head" && j === 8 ? 0 : view.getUint32(offset + j))) >>> 0;
    }
    assert.equal(view.getUint32(start + 4), sum);
  }
});

test("prep suffix clears leftover operands without exceeding the declared stack", () => {
  const source = fixture();
  const view = new DataView(source.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const start = 12 + 16 * i;
    const tag = String.fromCharCode(...source.subarray(start, start + 4));
    const offset = view.getUint32(start + 8);
    if (tag === "prep") source.set([0xb0, 1, 0], offset); // PUSHB[1] 1; SVTCA[y], leaving one operand.
    if (tag === "maxp") view.setUint16(offset + 24, 1);
  }
  const output = tables(inhibitTrueTypeGridFitting(source)!);
  assert.deepEqual(output.get("prep"), new Uint8Array([0xb0, 1, 0, 0x22, 0xb1, 1, 1, 0x8e]));
  assert.equal(new DataView(output.get("maxp")!.buffer).getUint16(24), 2);
});

test("reads nonzero-offset byte views and rejects malformed or unsupported fonts", () => {
  const source = fixture();
  const storage = new Uint8Array(source.length + 20);
  storage.set(source, 8);
  assert.ok(inhibitTrueTypeGridFitting(storage.subarray(8, 8 + source.length)));
  for (const length of [0, 4, 11, 30])
    assert.equal(inhibitTrueTypeGridFitting(source.slice(0, length)), null);
  for (const signature of [0x4f54544f, 0x74746366, 0x774f4646]) {
    const invalid = source.slice();
    new DataView(invalid.buffer).setUint32(0, signature);
    assert.equal(inhibitTrueTypeGridFitting(invalid), null);
  }
  for (const corruption of ["offset", "length", "duplicate"] as const) {
    const invalid = source.slice();
    const view = new DataView(invalid.buffer);
    if (corruption === "offset") view.setUint32(20, 0xfffffff0);
    if (corruption === "length") view.setUint32(24, 0xfffffff0);
    if (corruption === "duplicate") invalid.set(invalid.subarray(12, 16), 28);
    assert.equal(inhibitTrueTypeGridFitting(invalid), null);
  }
});
