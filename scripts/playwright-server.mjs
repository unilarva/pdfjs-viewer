// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(
  packageDir,
  process.env.PLAYWRIGHT_DIST_DIR ?? ".playwright-dist/default",
);
const pdfWorkerPath = fileURLToPath(import.meta.resolve("pdfjs-dist/build/pdf.worker.min.mjs"));
const port = Number.parseInt(process.env.PORT ?? "4179", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
await rm(outDir, { recursive: true, force: true });
const [coreCss, defaultUiThemeCss] = await Promise.all([
  readFile(path.join(packageDir, "src/core.css"), "utf8"),
  readFile(path.join(packageDir, "src/default-ui-theme.css"), "utf8"),
]);
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(packageDir, "tests/browser/fixture.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: path.join(outDir, "fixture.js"),
  sourcemap: true,
});

function makePdf() {
  const makeStream = content =>
    `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`;
  const makeEmbeddedFile = content =>
    `<< /Type /EmbeddedFile /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names << /Dests 9 0 R /EmbeddedFiles 18 0 R >> /Outlines 13 0 R /PageMode /UseOutlines >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 10 0 R /F2 17 0 R >> >> /Contents 4 0 R /Annots [11 0 R 12 0 R] >>",
    makeStream(
      "BT /F1 24 Tf 72 700 Td (Fixture page 1 Cafe Cafe) Tj ET BT /F1 24 Tf 72 650 Td (Cross) Tj /F2 24 Tf (Boundary) Tj ET",
    ),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 10 0 R >> >> /Contents 6 0 R >>",
    makeStream("BT /F1 24 Tf 72 700 Td (Fixture page 2) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 10 0 R >> >> /Contents 8 0 R >>",
    makeStream("BT /F1 24 Tf 72 700 Td (Fixture page 3) Tj ET"),
    "<< /Names [(section:far) [3 0 R /XYZ 0 0 null] (section:two) [5 0 R /XYZ 0 792 null]] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Annot /Subtype /Link /Rect [72 650 250 680] /Border [0 0 0] /A << /S /URI /URI (https://example.test/pdf-link) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [72 600 250 630] /Border [0 0 0] /Dest [5 0 R /XYZ 0 792 null] >>",
    "<< /Type /Outlines /First 14 0 R /Last 15 0 R /Count 2 >>",
    "<< /Title (Caf\\351 chapter) /Parent 13 0 R /Next 15 0 R /Dest [3 0 R /XYZ 0 792 null] >>",
    "<< /Title (Cafe chapter) /Parent 13 0 R /Prev 14 0 R /Dest (section:two) >>",
    "<< /Title (Fixture metadata title) /Author (Fixture author) /Subject (Viewer metadata test) /Keywords (pdf, viewer) /Creator (Playwright fixture) /Producer (Unilarva) /CreationDate (D:20260814120000+03'00') /ModDate (D:20260814123000+03'00') /Trapped /False /CustomText (Custom value) /CustomNumber 42 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  const firstAttachment = "First fixture attachment.\n";
  const secondAttachment = "\x00\xff\x10\x80A\x7f";
  objects.push(
    "<< /Names [(attachment-alpha) 19 0 R (attachment-beta) 21 0 R] >>",
    "<< /Type /Filespec /F (fixture.txt) /UF (fixture.txt) /Desc (First fixture attachment) /EF << /F 20 0 R /UF 20 0 R >> >>",
    makeEmbeddedFile(firstAttachment),
    "<< /Type /Filespec /F (fixture.txt) /UF (fixture.txt) /Desc (Binary fixture attachment) /EF << /F 22 0 R /UF 22 0 R >> >>",
    makeEmbeddedFile(secondAttachment),
  );
  let pdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "binary");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 16 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

function makeOcgPdf() {
  const content =
    "/OC /LayerA BDC 1 0 0 rg 72 500 180 80 re f EMC /OC /LayerB BDC 0 0 1 rg 72 500 180 80 re f EMC /OC /LayerUnnamed BDC 0 0.7 0 rg 280 500 80 80 re f EMC BT /F1 24 Tf 72 700 Td (Optional content fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /OCProperties 6 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /Properties << /LayerA 7 0 R /LayerB 8 0 R /LayerUnnamed 9 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /OCGs [7 0 R 8 0 R 9 0 R] /D << /Name (Display layers) /BaseState /ON /ON [7 0 R 9 0 R] /OFF [8 0 R] /Order [(Color choice) 7 0 R 8 0 R [(Nested controls) 9 0 R]] /RBGroups [[7 0 R 8 0 R]] >> >>",
    "<< /Type /OCG /Name (Red block) >>",
    "<< /Type /OCG /Name (Blue block) >>",
    "<< /Type /OCG >>",
  ];
  let ocgPdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(ocgPdf, "binary");
    ocgPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(ocgPdf, "binary");
  ocgPdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    ocgPdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  ocgPdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(ocgPdf, "binary");
}

function makeAnnotationPdf() {
  const makeStream = value =>
    `<< /Length ${Buffer.byteLength(value, "binary")} >>\nstream\n${value}\nendstream`;
  const makeEmbeddedFile = value =>
    `<< /Type /EmbeddedFile /Length ${Buffer.byteLength(value, "binary")} >>\nstream\n${value}\nendstream`;
  const content = "BT /F1 18 Tf 36 756 Td (Rich annotation fixture) Tj ET";
  const annotations = Array.from({ length: 21 }, (_, index) => `${8 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /BaseState /ON /ON [7 0 R] /Order [7 0 R] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [${annotations}] >>`,
    makeStream(content),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 29 0 R >>",
    "<< /Type /OCG /Name (Annotation layer) >>",
    "<< /Type /Annot /Subtype /Link /Rect [36 710 180 732] /Border [0 0 0] /Contents (External link) /A << /S /URI /URI (https://example.test/annotation) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [190 710 330 732] /Border [0 0 0] /Contents (Next page action) /A << /S /Named /N /NextPage >> >>",
    "<< /Type /Annot /Subtype /Text /Rect [36 650 60 674] /Name /Note /Contents (Keyboard popup body) /T (Fixture author) /Popup 11 0 R >>",
    "<< /Type /Annot /Subtype /Popup /Rect [70 610 300 690] /Parent 10 0 R /Open false >>",
    "<< /Type /Annot /Subtype /Highlight /Rect [90 650 230 674] /QuadPoints [90 674 230 674 90 650 230 650] /Contents (Layer-bound highlight) /OC 7 0 R >>",
    "<< /Type /Annot /Subtype /Underline /Rect [36 600 160 622] /QuadPoints [36 622 160 622 36 600 160 600] /Contents (Underline comment) >>",
    "<< /Type /Annot /Subtype /Squiggly /Rect [180 600 300 622] /QuadPoints [180 622 300 622 180 600 300 600] /Contents (Squiggle comment) >>",
    "<< /Type /Annot /Subtype /StrikeOut /Rect [320 600 450 622] /QuadPoints [320 622 450 622 320 600 450 600] /Contents (Strikeout comment) >>",
    "<< /Type /Annot /Subtype /Stamp /Rect [36 540 130 580] /Name /Approved /Contents (Stamp comment) >>",
    "<< /Type /Annot /Subtype /FreeText /Rect [150 540 300 580] /DA (/Helv 12 Tf 0 g) /Contents (Free text annotation) >>",
    "<< /Type /Annot /Subtype /Ink /Rect [320 530 460 580] /InkList [[325 540 350 570 390 545 450 570]] /BS << /W 2 >> /Contents (Ink comment) >>",
    "<< /Type /Annot /Subtype /FileAttachment /Rect [36 480 60 504] /Name /Paperclip /Contents (Attachment comment) /FS 20 0 R >>",
    "<< /Type /Filespec /F (page-note.txt) /UF (page-note.txt) /Desc (Page local attachment) /EF << /F 21 0 R /UF 21 0 R >> >>",
    makeEmbeddedFile("Page-local fixture attachment.\n"),
    "<< /Type /Annot /Subtype /Link /Rect [80 480 170 504] /Border [0 0 0] /Contents (Toggle OCG) /A << /S /SetOCGState /State [/Toggle 7 0 R] /PreserveRB true >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [180 480 250 504] /Border [0 0 0] /A << /S /Named /N /Print >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [260 480 330 504] /Border [0 0 0] /A << /S /Named /N /SaveAs >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [340 480 410 504] /Border [0 0 0] /A << /S /ResetForm >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [420 480 500 504] /Border [0 0 0] /A << /S /SubmitForm /F (https://example.test/submit) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [510 480 570 504] /Border [0 0 0] /A << /S /JavaScript /JS (app.alert\\(secret\\)) >> >>",
    "<< /Type /Annot /Subtype /RichMedia /Rect [36 420 160 460] /Contents (Blocked rich media) >>",
    makeStream("BT /F1 18 Tf 36 756 Td (Annotation fixture page 2) Tj ET"),
  ];
  let annotationPdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(annotationPdf, "binary");
    annotationPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(annotationPdf, "binary");
  annotationPdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    annotationPdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  annotationPdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(annotationPdf, "binary");
}

function makeAcroFormPdf() {
  const stream = value =>
    `<< /Length ${Buffer.byteLength(value, "binary")} >>\nstream\n${value}\nendstream`;
  const appearance = value => stream(`q 0 0 0 RG 1 w 0 0 18 18 re S ${value} Q`);
  const textAppearance = value => {
    const content = `q 1 1 198 28 re W n BT /Helv 12 Tf 4 9 Td (${value}) Tj ET Q`;
    return `<< /Type /XObject /Subtype /Form /BBox [0 0 200 30] /Resources << /Font << /Helv 19 0 R >> >> /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`;
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm 7 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /Helv 19 0 R >> >> /Contents 4 0 R /Annots [9 0 R 10 0 R 12 0 R 13 0 R 14 0 R 26 0 R] >>",
    stream("BT /Helv 16 Tf 36 756 Td (AcroForm fixture page 1) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /Helv 19 0 R >> >> /Contents 6 0 R /Annots [17 0 R 18 0 R 15 0 R 16 0 R 24 0 R] >>",
    stream("BT /Helv 16 Tf 36 756 Td (AcroForm fixture page 2) Tj ET"),
    "<< /Fields [8 0 R 10 0 R 11 0 R 13 0 R 14 0 R 15 0 R 16 0 R 24 0 R 25 0 R] /NeedAppearances true /DA (/Helv 10 Tf 0 g) /DR << /Font << /Helv 19 0 R >> >> >>",
    "<< /FT /Tx /T (sharedText) /V (Loaded) /DV (PDF default) /DA (/Helv 12 Tf 0 g) /Kids [9 0 R 17 0 R] >>",
    "<< /Type /Annot /Subtype /Widget /Parent 8 0 R /P 3 0 R /Rect [72 680 300 710] /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /V /Yes /DV /Yes /AS /Yes /P 3 0 R /Rect [72 625 92 645] /F 4 /AP << /N << /Yes 20 0 R /Off 21 0 R >> >> >>",
    "<< /FT /Btn /Ff 32768 /T (choice) /V /A /DV /A /Kids [12 0 R 18 0 R] >>",
    "<< /Type /Annot /Subtype /Widget /Parent 11 0 R /P 3 0 R /Rect [72 570 92 590] /F 4 /AS /A /AP << /N << /A 22 0 R /Off 21 0 R >> >> >>",
    "<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (combo) /Opt [(one) (two) (three)] /V (two) /DV (two) /P 3 0 R /Rect [72 510 260 540] /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /FT /Ch /T (list) /Opt [(alpha) (beta) (gamma)] /V (alpha) /DV (alpha) /P 3 0 R /Rect [72 420 260 490] /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (safeButton) /P 5 0 R /Rect [72 570 220 605] /F 4 /A << /S /URI /URI (https://example.test/form-button) >> >>",
    "<< /Type /Annot /Subtype /Widget /FT /Sig /T (signature) /Ff 1 /P 5 0 R /Rect [72 490 300 540] /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /Parent 8 0 R /P 5 0 R /Rect [72 680 300 710] /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /Parent 11 0 R /P 5 0 R /Rect [72 625 92 645] /F 4 /AS /Off /AP << /N << /B 23 0 R /Off 21 0 R >> >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    appearance("2 3 m 7 9 l 16 16 l S"),
    appearance(""),
    appearance("3 9 m 15 9 l S"),
    appearance("9 3 m 9 15 l S"),
    "<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 2097152 /T (multi) /Opt [(red) (green) (blue)] /V (red) /DV (red) /I [0] /P 5 0 R /Rect [320 620 500 690] /F 4 >>",
    "<< /FT /Tx /Ff 1 /T (appearanceText) /V (Appearance only) /DV (Appearance only) /DA (/Helv 12 Tf 0 g) /Kids [26 0 R] >>",
    "<< /Type /Annot /Subtype /Widget /Parent 25 0 R /P 3 0 R /Rect [320 680 520 710] /F 4 /AP << /N 27 0 R >> >>",
    textAppearance("Appearance only"),
  ];
  let formPdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(formPdf, "binary");
    formPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(formPdf, "binary");
  formPdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    formPdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  formPdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(formPdf, "binary");
}

function makeQueuePdf(pageCount = 40) {
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const fontObjectId = 3 + pageCount * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  ];
  for (let index = 0; index < pageCount; index++) {
    const contentObjectId = pageObjectIds[index] + 1;
    const stream = `BT /F1 24 Tf 72 700 Td (Queue fixture page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "binary");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

function makeReplacementPdf(width = 360, height = 540, label = "Replacement document B") {
  const content = `BT /F1 24 Tf 36 500 Td (${label}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let replacementPdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(replacementPdf, "binary");
    replacementPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(replacementPdf, "binary");
  replacementPdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    replacementPdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  replacementPdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(replacementPdf, "binary");
}

function makePrintLayoutPdf(sizes, pageLayout = null, rotations = []) {
  const pageObjectIds = Array.from({ length: sizes.length }, (_, index) => 3 + index * 2);
  const fontObjectId = 3 + sizes.length * 2;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${pageLayout ? ` /PageLayout /${pageLayout}` : ""} >>`,
    `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${sizes.length} >>`,
  ];
  sizes.forEach(([width, height], index) => {
    const contentObjectId = pageObjectIds[index] + 1;
    const stream = `BT /F1 18 Tf 36 ${Math.max(40, height - 40)} Td (Print layout page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]${rotations[index] ? ` /Rotate ${rotations[index]}` : ""} /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let result = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(result, "binary");
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result, "binary");
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    result += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result, "binary");
}

const pdf = makePdf();
const ocgPdf = makeOcgPdf();
const annotationPdf = makeAnnotationPdf();
const acroFormPdf = makeAcroFormPdf();
const queuePdf = makeQueuePdf();
const replacementPdf = makeReplacementPdf();
const giantPdf = makeReplacementPdf(12_000, 12_000, "Giant source document A");
const a5 = [(148 * 72) / 25.4, (210 * 72) / 25.4];
const a4 = [(210 * 72) / 25.4, (297 * 72) / 25.4];
const printA5Pdf = makePrintLayoutPdf([a5, a5, a5], "TwoPageRight");
const printA5NoPreferencePdf = makePrintLayoutPdf([a5, a5]);
const printMixedPdf = makePrintLayoutPdf([a5, a5, a4], "TwoColumnLeft");
const printRotatedA5Pdf = makePrintLayoutPdf([a5, a5], "TwoPageLeft", [90, 270]);
const printA4ReplacementPdf = makePrintLayoutPdf([a4, a4], "TwoPageRight");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/default-ui.css">
</head><body><main id="primary" class="viewer-host"></main><script type="module" src="/fixture.js"></script></body></html>`;

const mime = new Map([
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".css", "text/css"],
  [".map", "application/json"],
  [".woff2", "font/woff2"],
]);
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.end("ok");
    return;
  }
  if (url.pathname === "/" || url.pathname === "/csp") {
    res.setHeader("Content-Type", "text/html");
    if (url.pathname === "/csp")
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self' data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; trusted-types pdfjs-viewer-worker; require-trusted-types-for 'script'",
      );
    res.end(html);
    return;
  }
  if (url.pathname === "/default-ui.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(
      `${coreCss}\n${defaultUiThemeCss}\nbody{margin:0;font-family:sans-serif}.viewer-host{height:720px;border:1px solid #999;margin:8px}`,
    );
    return;
  }
  if (url.pathname === "/fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Accept-Ranges", "bytes");
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (match) {
      const start = Number(match[1]);
      const end = Math.min(match[2] ? Number(match[2]) : pdf.length - 1, pdf.length - 1);
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${pdf.length}`,
        "Content-Length": end - start + 1,
      });
      res.end(pdf.subarray(start, end + 1));
      return;
    }
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf);
    return;
  }
  if (url.pathname === "/ocg-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", ocgPdf.length);
    res.end(ocgPdf);
    return;
  }
  if (url.pathname === "/annotation-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", annotationPdf.length);
    res.end(annotationPdf);
    return;
  }
  if (url.pathname === "/acroform-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", acroFormPdf.length);
    res.end(acroFormPdf);
    return;
  }
  if (url.pathname === "/slow-fixture.pdf") {
    const splitAt = Math.ceil(pdf.length / 2);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.write(pdf.subarray(0, splitAt));
    setTimeout(() => res.end(pdf.subarray(splitAt)), 500);
    return;
  }
  if (url.pathname === "/invalid-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.end("%PDF-1.7\ninvalid fixture");
    return;
  }
  if (url.pathname === "/queue-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", queuePdf.length);
    res.end(queuePdf);
    return;
  }
  if (url.pathname === "/replacement-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", replacementPdf.length);
    res.end(replacementPdf);
    return;
  }
  if (url.pathname === "/giant-fixture.pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", giantPdf.length);
    res.end(giantPdf);
    return;
  }
  const printFixtures = new Map([
    ["/print-a5-fixture.pdf", printA5Pdf],
    ["/print-a5-no-preference-fixture.pdf", printA5NoPreferencePdf],
    ["/print-mixed-fixture.pdf", printMixedPdf],
    ["/print-rotated-a5-fixture.pdf", printRotatedA5Pdf],
    ["/print-a4-replacement-fixture.pdf", printA4ReplacementPdf],
  ]);
  const printFixture = printFixtures.get(url.pathname);
  if (printFixture) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", printFixture.length);
    res.end(printFixture);
    return;
  }
  const files = new Map([
    ["/fixture.js", path.join(outDir, "fixture.js")],
    ["/fixture.js.map", path.join(outDir, "fixture.js.map")],
    ["/pdf.worker.min.mjs", pdfWorkerPath],
  ]);
  const file = files.get(url.pathname);
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    res.setHeader("Content-Type", mime.get(path.extname(file)) ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Playwright fixture server: http://127.0.0.1:${port}`),
);
