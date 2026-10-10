// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Minimal SFNT metadata fixture; native font acceptance is covered in browser tests. */
export function createTrueTypeFixture(prep = true): Uint8Array {
  const entries = [
    { tag: "head", bytes: new Uint8Array(54) },
    { tag: "maxp", bytes: new Uint8Array(32) },
    { tag: "glyf", bytes: new Uint8Array([0, 1, 2, 3, 4, 5, 6]) },
    { tag: "loca", bytes: new Uint8Array([0, 0, 0, 4]) },
    ...(prep ? [{ tag: "prep", bytes: new Uint8Array([0xb0, 0, 0x21]) }] : []),
  ];
  const align = (size: number) => Math.ceil(size / 4) * 4;
  const bytes = new Uint8Array(
    12 + entries.length * 16 + entries.reduce((sum, entry) => sum + align(entry.bytes.length), 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, entries.length);
  let offset = 12 + entries.length * 16;
  entries.forEach((entry, index) => {
    const start = 12 + index * 16;
    bytes.set(
      [...entry.tag].map(char => char.charCodeAt(0)),
      start,
    );
    view.setUint32(start + 8, offset);
    view.setUint32(start + 12, entry.bytes.length);
    bytes.set(entry.bytes, offset);
    offset += align(entry.bytes.length);
  });
  return bytes;
}
