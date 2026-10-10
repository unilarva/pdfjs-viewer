// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private SFNT transformation of already-sanitized PDF.js fonts.
 * This emitted module is not a supported consumer subpath or package-root export.
 * See the [architecture guide](../ARCHITECTURE.md) for font preparation and ownership.
 * @packageDocumentation
 * @module truetype-grid-fitting
 */

/** Clones a TrueType font with grid fitting inhibited; unsupported/invalid data stays untouched. */
export function inhibitTrueTypeGridFitting(source: Uint8Array): Uint8Array | null {
  if (source.length < 12) return null;
  const input = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (input.getUint32(0) !== 0x00010000 && input.getUint32(0) !== 0x74727565) return null;
  const count = input.getUint16(4);
  if (!count || count > 4095 || 12 + count * 16 > source.length) return null;
  const tables: { tag: string; data: Uint8Array }[] = [];
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) {
    const start = 12 + i * 16;
    const tag = String.fromCharCode(...source.subarray(start, start + 4));
    const offset = input.getUint32(start + 8);
    const length = input.getUint32(start + 12);
    if (tags.has(tag) || offset < 12 + count * 16 || offset > source.length - length) return null;
    tags.add(tag);
    tables.push({ tag, data: source.slice(offset, offset + length) });
  }
  const head = tables.find(table => table.tag === "head");
  const maxp = tables.find(table => table.tag === "maxp");
  if (
    !tags.has("glyf") ||
    !tags.has("loca") ||
    !head ||
    head.data.length < 54 ||
    !maxp ||
    maxp.data.length < 32
  )
    return null;
  let prep = tables.find(table => table.tag === "prep");
  if (!prep) {
    if (count === 4095) return null;
    prep = { tag: "prep", data: new Uint8Array() };
    tables.push(prep);
  }
  // Inhibit native TrueType grid fitting without stripping glyph/composite
  // instructions or converting text to outlines. CLEAR discards any operands
  // left by the original prep before PUSHB[2] 1,1; INSTCTRL, keeping maxp valid.
  const program = new Uint8Array(prep.data.length + 5);
  program.set(prep.data);
  program.set([0x22, 0xb1, 1, 1, 0x8e], prep.data.length);
  prep.data = program;
  new DataView(head.data.buffer).setUint32(8, 0);
  const maxpView = new DataView(maxp.data.buffer);
  maxpView.setUint16(24, Math.max(2, maxpView.getUint16(24)));
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const align = (length: number): number => Math.ceil(length / 4) * 4;
  const directoryBytes = 12 + tables.length * 16;
  const length =
    directoryBytes + tables.reduce((total, table) => total + align(table.data.length), 0);
  const result = new Uint8Array(length);
  const output = new DataView(result.buffer);
  result.set(source.subarray(0, 4));
  output.setUint16(4, tables.length);
  const selector = Math.floor(Math.log2(tables.length));
  const searchRange = 16 * 2 ** selector;
  output.setUint16(6, searchRange);
  output.setUint16(8, selector);
  output.setUint16(10, tables.length * 16 - searchRange);
  const checksum = (offset: number, bytes: number): number => {
    let sum = 0;
    for (let end = offset + align(bytes); offset < end; offset += 4)
      sum = (sum + output.getUint32(offset)) >>> 0;
    return sum;
  };
  let offset = directoryBytes;
  let headOffset = 0;
  for (let i = 0; i < tables.length; i++) {
    const { tag, data } = tables[i];
    const start = 12 + i * 16;
    result.set(
      [...tag].map(character => character.charCodeAt(0)),
      start,
    );
    result.set(data, offset);
    output.setUint32(start + 4, checksum(offset, data.length));
    output.setUint32(start + 8, offset);
    output.setUint32(start + 12, data.length);
    if (tag === "head") headOffset = offset;
    offset += align(data.length);
  }
  output.setUint32(headOffset + 8, (0xb1b0afba - checksum(0, result.length)) >>> 0);
  return result;
}
