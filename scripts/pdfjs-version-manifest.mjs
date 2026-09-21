// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Parses an npm union containing only exact, stable semantic versions. */
export function parseExactPdfjsVersionUnion(range) {
  if (typeof range !== "string") throw new TypeError("pdfjs-dist peer dependency must be a string");
  const versions = range.split(/\s*\|\|\s*/).filter(Boolean);
  if (!versions.length || versions.some(version => !/^\d+\.\d+\.\d+$/.test(version))) {
    throw new TypeError("pdfjs-dist peer dependency must contain only exact stable versions");
  }
  return Object.freeze(versions);
}
