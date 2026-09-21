// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

export function makeDemoSamplePdf() {
  const makeStream = content =>
    `<< /Type /EmbeddedFile /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`;
  const chapterCount = 3;
  const chapterStartPage = 3;
  const pageCount = chapterStartPage - 1 + chapterCount * 2;
  const firstPageObjectNumber = chapterCount + 5;
  const pageObjectNumbers = Array.from(
    { length: pageCount },
    (_, index) => firstPageObjectNumber + index * 2,
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 24 0 R >> /Outlines 4 0 R /PageMode /UseOutlines /PageLayout /TwoPageRight >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Outlines /First 5 0 R /Last ${chapterCount + 4} 0 R /Count ${chapterCount} >>`,
  ];
  for (let chapter = 1; chapter <= chapterCount; chapter += 1) {
    const itemObjectNumber = chapter + 4;
    const previous = chapter > 1 ? ` /Prev ${itemObjectNumber - 1} 0 R` : "";
    const next = chapter < chapterCount ? ` /Next ${itemObjectNumber + 1} 0 R` : "";
    objects.push(
      `<< /Title (Chapter ${chapter}) /Parent 4 0 R /Dest [${pageObjectNumbers[chapterStartPage - 1 + (chapter - 1) * 2]} 0 R /Fit]${previous}${next} >>`,
    );
  }
  for (let page = 1; page <= pageCount; page += 1) {
    const chapter = page >= chapterStartPage ? Math.ceil((page - chapterStartPage + 1) / 2) : 0;
    const pageNumberX = page % 2 === 1 ? 528 : 72;
    const pageNumber = ["BT", "/F1 10 Tf", `${pageNumberX} 750 Td (Page ${page}) Tj`, "ET"];
    let content;
    if (page === 1) {
      content = [
        ...pageNumber,
        "BT",
        "/F1 34 Tf",
        "210 600 Td (Sample PDF) Tj",
        "ET",
        "BT",
        "/F1 16 Tf",
        "175 555 Td (A small book for testing PDF viewers) Tj",
        "ET",
        "0.15 0.45 0.85 rg",
        "98 360 120 120 re f",
        "0.85 0.35 0.15 rg",
        "308 480 m 238 360 l 378 360 l h f",
        "0.2 0.65 0.35 rg",
        "513 420 m",
        "513 453.14 486.14 480 453 480 c",
        "419.86 480 393 453.14 393 420 c",
        "393 386.86 419.86 360 453 360 c",
        "486.14 360 513 386.86 513 420 c",
        "f",
      ].join("\n");
    } else if (page === 2) {
      const tocRows = Array.from({ length: chapterCount }, (_, index) => {
        const chapterNumber = index + 1;
        const y = 650 - index * 54;
        const destinationPage = chapterStartPage + index * 2;
        return `BT\n/F1 18 Tf\n72 ${y} Td (Chapter ${chapterNumber}................... page ${destinationPage}) Tj\nET`;
      });
      content = [
        ...pageNumber,
        "BT",
        "/F1 30 Tf",
        "72 700 Td (Table of Contents) Tj",
        "ET",
        ...tocRows,
        "0.15 0.45 0.85 RG",
        "2 w",
        "72 500 m 540 500 l S",
      ].join("\n");
    } else {
      const chapterHeading =
        page % 2 === 1 ? ["BT", "/F1 30 Tf", `72 700 Td (Chapter ${chapter}) Tj`, "ET"] : [];
      const chapterShape =
        chapter === 1
          ? ["0.15 0.45 0.85 rg", "256 350 100 100 re f"]
          : chapter === 2
            ? ["0.85 0.35 0.15 rg", "306 450 m 246 350 l 366 350 l h f"]
            : [
                "0.2 0.65 0.35 rg",
                "356 400 m",
                "356 427.61 333.61 450 306 450 c",
                "278.39 450 256 427.61 256 400 c",
                "256 372.39 278.39 350 306 350 c",
                "333.61 350 356 372.39 356 400 c",
                "f",
              ];
      content = [
        ...pageNumber,
        ...chapterHeading,
        "BT",
        "/F1 12 Tf",
        "18 TL",
        "72 620 Td",
        "(Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod) Tj",
        "T*",
        "(tempor incididunt ut labore et dolore magna aliqua.) Tj",
        "T*",
        "T*",
        "(Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi) Tj",
        "T*",
        "(ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit) Tj",
        "T*",
        "(in voluptate velit esse.) Tj",
        "ET",
        ...chapterShape,
      ].join("\n");
    }
    const contentObjectNumber = firstPageObjectNumber + 1 + (page - 1) * 2;
    const annotations =
      page === 2
        ? ` /Annots [${Array.from({ length: chapterCount }, (_, index) => {
            const y = 638 - index * 54;
            const destinationPage = chapterStartPage + index * 2;
            return `<< /Type /Annot /Subtype /Link /Rect [64 ${y} 548 ${y + 26}] /Border [0 0 0] /H /I /Dest [${pageObjectNumbers[destinationPage - 1]} 0 R /Fit] >>`;
          }).join(" ")}]`
        : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R${annotations} >>`,
      `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`,
    );
  }
  const readme = "Welcome to the `@unilarva/pdfjs-viewer` attachment demo.\n";
  const data = '{"viewer":"pdfjs-viewer","attachments":2}\n';
  objects.push(
    "<< /Names [(demo-data) 27 0 R (demo-readme) 25 0 R] >>",
    "<< /Type /Filespec /F (readme.txt) /UF (readme.txt) /Desc (Demo usage notes) /EF << /F 26 0 R /UF 26 0 R >> >>",
    makeStream(readme),
    "<< /Type /Filespec /F (data.json) /UF (data.json) /Desc (Demo attachment data) /EF << /F 28 0 R /UF 28 0 R >> >>",
    makeStream(data),
  );
  let pdf = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "binary");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}
