// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

// Guard the exact upstream file-URL sites in the Webpack production qualification fixture.

/**
 * Reject unexpected file URLs or drift in known upstream expressions/occurrence counts.
 *
 * Both qualified releases share this policy. The two recognized OpenJPEG bootstraps
 * count as one site, not independent allowances. Matching uses URL offsets, so another
 * occurrence of an already allowed URL cannot inherit its exemption. This deliberately
 * fails closed on upstream/minifier changes, including missing expected sites.
 *
 * @param {{ source: string, file: string, variant: "standard" | "legacy", displayUrl: string, workerUrl: string }} input
 *   Emitted JavaScript and the exact selected installation's display/worker URLs.
 * @returns {string[]} Known URL occurrences that still require explicit upstream warnings.
 */
export function validateWebpackPdfjsFileUrls({ source, file, variant, displayUrl, workerUrl }) {
  if (variant !== "standard" && variant !== "legacy")
    throw new TypeError(`Unknown PDF.js build variant: ${variant}`);

  const id = String.raw`[A-Za-z_$][\w$]*`;
  const url = String.raw`"(?<url>file:\/\/[^"\\]+)"`;
  const requireModule = String.raw`process\.getBuiltinModule\("module"\)\.createRequire\(${url}\)`;
  const factory = String.raw`const ${id}=async function\((?<arg>${id})=\{\}\)\{var ${id}=\k<arg>`;
  const quit = String.raw`,${id}=\(${id},(?<thrown>${id})\)=>\{throw \k<thrown>\}`;
  const workerSite = String.raw`;try\{new URL\("\.",${url}\)\.href\}catch\{\}`;
  const displayRules = [
    [
      "NodeCanvasFactory",
      String.raw`_createCanvas\((?<width>${id}),(?<height>${id})\)\{return ${requireModule}\("@napi-rs/canvas"\)\.createCanvas\(\k<width>,\k<height>\)\}`,
    ],
    [
      "Node polyfill",
      String.raw`if\(${id}\)\{let (?<canvas>${id});try\{const (?<require>${id})=${requireModule};try\{\k<canvas>=\k<require>\("@napi-rs/canvas"\)\}catch\(`,
    ],
  ];
  const workerRules = [
    [
      "JBig2",
      String.raw`${factory}${quit}${workerSite}console\.log\.bind\(console\);var ${id},${id},${id}=console\.error\.bind\(console\),${id}=!1;function `,
    ],
    [
      "OpenJPEG",
      String.raw`${factory},${id}="\./this\.program"${quit}${workerSite}var ${id},${id},${id}=console\.log\.bind\(console\),${id}=console\.error\.bind\(console\),${id}=!1;function `,
    ],
    [
      "OpenJPEG",
      String.raw`${factory}${workerSite}var ${id},${id}=console\.log\.bind\(console\),${id}=console\.error\.bind\(console\);function `,
    ],
  ];
  const rules = file === "consumer.js" ? displayRules : file === "worker.js" ? workerRules : [];
  const expected =
    file === "consumer.js"
      ? new Map([
          ["NodeCanvasFactory", 1],
          ["Node polyfill", variant === "legacy" ? 1 : 0],
        ])
      : file === "worker.js"
        ? new Map([
            ["JBig2", 1],
            ["OpenJPEG", 1],
          ])
        : new Map();
  const expectedUrl = file === "consumer.js" ? displayUrl : workerUrl;
  const counts = new Map();
  const allowed = new Map();
  for (const [kind, pattern] of rules) {
    for (const match of source.matchAll(new RegExp(pattern, "dg"))) {
      if (match.groups.url !== expectedUrl)
        throw new Error(
          `Unexpected local file URL in ${variant} Webpack ${file}: ${match.groups.url}`,
        );
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      allowed.set(match.indices.groups.url[0], match.groups.url);
    }
  }
  const urls = [];
  for (const match of source.matchAll(/file:\/\/[^\s"'`\\<>]+/g)) {
    if (!allowed.has(match.index))
      throw new Error(`Unexpected local file URL in ${variant} Webpack ${file}: ${match[0]}`);
    urls.push(allowed.get(match.index));
  }
  for (const [kind, count] of expected) {
    if ((counts.get(kind) ?? 0) !== count)
      throw new Error(
        `Unexpected ${kind} file-URL occurrence count in ${variant} Webpack ${file}: expected ${count}, found ${counts.get(kind) ?? 0}`,
      );
  }
  return urls;
}
