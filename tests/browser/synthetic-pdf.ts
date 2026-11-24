// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Generic synthetic page, geometry, link and optional-content fixture controls. */
export interface SyntheticPdfOptions {
  labels: readonly string[];
  color?: readonly [number, number, number];
  crop?: readonly [number, number, number, number];
  pageCrops?: Readonly<Record<number, readonly [number, number, number, number]>>;
  rotation?: number;
  userUnit?: number;
  links?: readonly { target: number; kind: "named" | "numeric" | "reference" }[];
  annotationSubtype?: "Text" | "Widget";
  /** Emit a NoRotate free-text annotation and its explicit NoRotate popup. */
  noRotateAnnotations?: boolean;
  /** Keep the colored rectangle visible for View usage but hidden for Print usage. */
  printHidden?: boolean;
}

/** Builds ASCII-only, self-contained PDFs with stable object IDs and a valid xref. */
export function makeSyntheticPdf(options: SyntheticPdfOptions): Uint8Array {
  const literal = (value: string) => {
    if (!/^[\x20-\x7e]*$/.test(value)) throw new Error("Synthetic PDF labels must be ASCII");
    return `(${value.replace(/[\\()]/g, "\\$&")})`;
  };
  const pages = options.labels.map((_, index) => 3 + index * 2);
  const font = 3 + pages.length * 2;
  const annotationStart = font + 1;
  const links = options.links ?? [];
  const annotations = links.map((_, index) => annotationStart + index);
  if (options.annotationSubtype) annotations.push(annotationStart + links.length);
  const noRotateStart = annotationStart + annotations.length;
  if (options.noRotateAnnotations) annotations.push(noRotateStart, noRotateStart + 1);
  const ocg = annotationStart + annotations.length;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(section:two) [${pages[1] ?? pages[0]} 0 R /Fit]] >> >>${options.printHidden ? ` /OCProperties << /OCGs [${ocg} 0 R] /D << /Order [${ocg} 0 R] /ON [${ocg} 0 R] /AS [<< /Event /View /Category [/View] /OCGs [${ocg} 0 R] >> << /Event /Print /Category [/Print] /OCGs [${ocg} 0 R] >>] >> >>` : ""} >>`,
    `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  options.labels.forEach((label, index) => {
    const crop = options.pageCrops?.[index + 1] ?? options.crop ?? [0, 0, 612, 792];
    const content = `${options.printHidden ? "/OC /Color BDC " : ""}${(options.color ?? [0.8, 0.1, 0.1]).join(" ")} rg 72 500 180 80 re f ${options.printHidden ? "EMC " : ""}0 g BT /F1 24 Tf 72 700 Td ${literal(label)} Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [${crop.join(" ")}] /Rotate ${options.rotation ?? 0} /UserUnit ${options.userUnit ?? 1} /Resources << /Font << /F1 ${font} 0 R >>${options.printHidden ? ` /Properties << /Color ${ocg} 0 R >>` : ""} >> /Contents ${pages[index] + 1} 0 R${index === 0 && annotations.length ? ` /Annots [${annotations.map(id => `${id} 0 R`).join(" ")}]` : ""} >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  links.forEach((link, index) => {
    const destination =
      link.kind === "named"
        ? "(section:two)"
        : `[${link.kind === "numeric" ? link.target - 1 : `${pages[link.target - 1]} 0 R`} /Fit]`;
    const y = 620 - index * 40;
    objects.push(
      `<< /Type /Annot /Subtype /Link /NM (duplicate-id) /Rect [72 ${y} 250 ${y + 25}] /Border [0 0 0] /Dest ${destination} >>`,
    );
  });
  if (options.annotationSubtype)
    objects.push(
      `<< /Type /Annot /Subtype /${options.annotationSubtype} /Rect [300 600 320 620] /Contents (Unsupported auxiliary annotation) >>`,
    );
  if (options.noRotateAnnotations)
    objects.push(
      `<< /Type /Annot /Subtype /FreeText /Rect [200 500 320 540] /F 16 /DA (/Helv 12 Tf 0 g) /Contents (NoRotate anchor) /Popup ${noRotateStart + 1} 0 R >>`,
      `<< /Type /Annot /Subtype /Popup /Rect [330 500 480 580] /F 16 /Parent ${noRotateStart} 0 R >>`,
    );
  if (options.printHidden)
    objects.push(
      "<< /Type /OCG /Name (Synthetic color) /Usage << /View << /ViewState /ON >> /Print << /PrintState /OFF >> >> >>",
    );
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
