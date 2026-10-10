// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Build a synthetic PDF using the licensed PDF.js font asset, with its hints intact. */
export async function makeHintedFontPdf(variant = "regular", fontFile) {
  const style = variant === "bold" ? "Bold" : variant === "italic" ? "Italic" : "Regular";
  const font = await readFile(
    fontFile ??
      fileURLToPath(import.meta.resolve(`pdfjs-dist/standard_fonts/LiberationSans-${style}.ttf`)),
  );
  const tables = new Map();
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const record = 12 + index * 16;
    tables.set(font.toString("ascii", record, record + 4), font.readUInt32BE(record + 8));
  }
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  const unitsPerEm = font.readUInt16BE(head + 18);
  const metric = value => Math.round((value * 1000) / unitsPerEm);
  const numberOfHMetrics = font.readUInt16BE(hhea + 34);
  let unicodeMap;
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const record = cmap + 4 + index * 8;
    const subtable = cmap + font.readUInt32BE(record + 4);
    if (
      font.readUInt16BE(record) === 3 &&
      font.readUInt16BE(record + 2) === 1 &&
      font.readUInt16BE(subtable) === 4
    ) {
      unicodeMap = subtable;
      break;
    }
  }
  if (unicodeMap === undefined)
    throw new Error("Fixture font has no Windows Unicode format-4 cmap");
  const segmentCount = font.readUInt16BE(unicodeMap + 6) / 2;
  const endCodes = unicodeMap + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  const widths = [];
  // All fixture text is ASCII, so WinAnsi character codes also map directly to Unicode.
  for (let code = 32; code <= 126; code++) {
    let glyph = 0;
    for (let index = 0; index < segmentCount; index++) {
      if (code > font.readUInt16BE(endCodes + index * 2)) continue;
      if (code < font.readUInt16BE(startCodes + index * 2)) break;
      const delta = font.readInt16BE(deltas + index * 2);
      const rangeAddress = rangeOffsets + index * 2;
      const rangeOffset = font.readUInt16BE(rangeAddress);
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        glyph = font.readUInt16BE(
          rangeAddress + rangeOffset + (code - font.readUInt16BE(startCodes + index * 2)) * 2,
        );
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      break;
    }
    if (glyph === 0) throw new Error(`Fixture font lacks ASCII character ${code}`);
    widths.push(metric(font.readUInt16BE(hmtx + Math.min(glyph, numberOfHMetrics - 1) * 4)));
  }
  const bbox = [36, 38, 40, 42].map(offset => metric(font.readInt16BE(head + offset)));
  const ascent = metric(font.readInt16BE(hhea + 4));
  const descent = metric(font.readInt16BE(hhea + 6));
  const os2 = tables.get("OS/2");
  const capHeight = font.readUInt16BE(os2) >= 2 ? metric(font.readInt16BE(os2 + 88)) : ascent;
  const stream = (content, extra = "") =>
    `<< /Length ${Buffer.byteLength(content, "binary")}${extra} >>\nstream\n${content}\nendstream`;
  // PDF coordinates are bottom-left based. Keep the reference and small text outside the b's crop.
  const content =
    "0 g BT /F1 24 Tf 72 700 Td (b) Tj ET BT /F1 12 Tf 72 650 Td (Small text: bdpq ilmn 0123456789 Cafe) Tj ET 180 700 24 18 re f";
  const resources = `/Font << /F1 7 0 R >>${variant === "transparent" ? " /ExtGState << /GS << /BM /Multiply >> >>" : ""}${variant === "group" ? " /XObject << /G 10 0 R >>" : ""}`;
  const pageContent =
    variant === "group" ? "/G Do" : variant === "transparent" ? `/GS gs ${content}` : content;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents 4 0 R >>`,
    stream(pageContent),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents 6 0 R >>`,
    stream(pageContent),
    `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${widths.join(" ")}] /FontDescriptor 8 0 R >>`,
    `<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [${bbox.join(" ")}] /ItalicAngle 0 /Ascent ${ascent} /Descent ${descent} /CapHeight ${capHeight} /StemV 80 /FontFile2 9 0 R >>`,
    stream(font.toString("binary"), ` /Length1 ${font.length}`),
  ];
  if (variant === "group")
    objects.push(
      stream(
        content,
        " /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Group << /S /Transparency /I true /CS /DeviceRGB >>",
      ),
    );
  let pdf = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "binary");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++)
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}
