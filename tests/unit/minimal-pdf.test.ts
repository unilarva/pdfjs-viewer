import assert from "node:assert/strict";
import test from "node:test";
import { createMinimalPdf } from "../../scripts/minimal-pdf.mjs";

test("minimal PDF has valid xref offsets and a visible rectangle", () => {
  const pdf = createMinimalPdf();
  const text = pdf.toString("ascii");
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /0\.1 0\.5 0\.9 rg\n30 40 140 120 re f/);
  const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(text.slice(xref, xref + 5), "xref\n");
  for (const [index, offset] of [...text.matchAll(/^(\d{10}) 00000 n $/gm)].entries()) {
    assert.equal(text.slice(Number(offset[1])).startsWith(`${index + 1} 0 obj`), true);
  }
});
