// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Deterministic, synthetic PDF; page lists are authoritative fixture data, not PDF inference. */
export function makeOcgBenchmarkFixture({ pages = 240, alternatives = 12 } = {}) {
  if (!Number.isInteger(pages) || pages < 3 || pages > 1000)
    throw new RangeError("pages must be an integer from 3 through 1000");
  if (![0, 2, 6, 12].includes(alternatives))
    throw new RangeError("alternatives must be 0 (ordinary), 2, 6, or 12");
  const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const add = value => objects.push(value);
  const ref = id => `${id} 0 R`;
  const groups = [];
  const radios = [];
  const group = (name, affectedPages, visible = true, registered = true) => {
    const objectId = add(`<< /Type /OCG /Name (${name}) >>`);
    const item = { name, pages: affectedPages, visible, registered, objectId };
    groups.push(item);
    return item;
  };
  const locals = Array.from({ length: pages }, (_, index) => {
    const family = Array.from({ length: alternatives }, (_, alternative) =>
      group(`Page ${index + 1} alternative ${alternative + 1}`, [index + 1], alternative === 0),
    );
    if (family.length) radios.push(family);
    return family;
  });
  if (alternatives) {
    group("Shared span", [1, 2, pages]);
    group("Shared page A", [2]);
    group("Shared page B", [2]);
    group("Unknown span", [1, pages], true, false);
    radios.push([group("Radio left", [1]), group("Radio right", [2], false)]);
  }
  const pageIds = [];
  for (let page = 1; page <= pages; page++) {
    const pageGroups = groups.filter(item => item.pages.includes(page));
    const content = [`BT /F1 18 Tf 36 750 Td (Synthetic benchmark page ${page}) Tj ET`];
    // Same visible workload for ordinary and layered pages. Hidden alternatives
    // intentionally carry equal path complexity without sharing an operator list.
    for (let alternative = 0; alternative < Math.max(1, alternatives); alternative++) {
      const item = locals[page - 1][alternative];
      if (item) content.push(`/OC /G${item.objectId} BDC`);
      content.push(`${alternative % 2 ? "0.1 0.3 0.8" : "0.7 0.2 0.1"} rg`);
      for (let mark = 0; mark < 96; mark++) {
        const x = 36 + (mark % 12) * 44;
        const y = 660 - Math.floor(mark / 12) * 48;
        content.push(`${x} ${y} ${12 + (alternative % 4) * 3} 12 re f`);
      }
      if (item) content.push("EMC");
    }
    pageGroups
      .filter(item => !locals[page - 1].includes(item))
      .forEach((item, index) => {
        content.push(`/OC /G${item.objectId} BDC 0 0.5 0 rg ${36 + index * 60} 170 40 20 re f EMC`);
      });
    const stream = content.join("\n");
    const streamId = add(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /Properties << ${pageGroups.map(item => `/G${item.objectId} ${ref(item.objectId)}`).join(" ")} >> >> /Contents ${ref(streamId)} >>`,
      ),
    );
  }
  const refs = items => items.map(item => ref(item.objectId)).join(" ");
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${groups.length ? ` /OCProperties << /OCGs [${refs(groups)}] /D << /BaseState /OFF /ON [${refs(groups.filter(item => item.visible))}] /Order [${refs(groups)}] /RBGroups [${radios.map(items => `[${refs(items)}]`).join(" ")}] >> >>` : ""} >>`;
  objects[1] = `<< /Type /Pages /Count ${pages} /Kids [${pageIds.map(ref).join(" ")}] >>`;
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return {
    pdf: Buffer.from(pdf, "ascii"),
    manifest: {
      pages,
      alternatives,
      groups: groups.map(({ objectId: _objectId, ...item }) => item),
      radioFamilies: radios.map(items => items.map(item => item.name)),
    },
  };
}
