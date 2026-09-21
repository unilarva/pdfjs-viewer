// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rule = (selector, property, value) => [selector, property, value];
const parseSelectorList = selector =>
  selectorParser()
    .astSync(selector, { lossless: false })
    .nodes.map(node => node.toString());
const normalizeSelector = selector => selectorParser().processSync(selector, { lossless: false });

/**
 * Deliberately small adapted-CSS contract. It checks behavior-critical rules, not
 * stylesheet identity. Runtime class strings are drift alarms, not proof of DOM shape.
 */
export const PDFJS_CSS_COMPATIBILITY_MANIFEST = Object.freeze([
  {
    category: "text",
    upstream: [
      rule(".textLayer", "position", "absolute"),
      rule(".textLayer", "inset", "0"),
      rule(".textLayer", "overflow", "clip"),
      rule(".textLayer", "line-height", "1"),
      rule(".textLayer", "--min-font-size", "1"),
      rule(
        ".textLayer",
        "--text-scale-factor",
        "calc(var(--total-scale-factor) * var(--min-font-size))",
      ),
      rule(".textLayer :is(span, br)", "position", "absolute"),
      rule(".textLayer :is(span, br)", "white-space", "pre"),
      rule(".textLayer :is(span, br)", "transform-origin", "0% 0%"),
      rule(
        ".textLayer > :not(.markedContent)",
        "transform",
        "rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))",
      ),
      rule(".textLayer .markedContent", "display", "contents"),
    ],
    local: [
      rule(".pdf-text-layer", "position", "absolute"),
      rule(".pdf-text-layer", "inset", "0"),
      rule(".pdf-text-layer", "overflow", "clip"),
      rule(".pdf-text-layer", "line-height", "1"),
      rule(".pdf-text-layer", "--min-font-size", "1"),
      rule(
        ".pdf-text-layer",
        "--text-scale-factor",
        "calc(var(--total-scale-factor) * var(--min-font-size))",
      ),
      rule(".pdf-text-layer :is(span, br)", "position", "absolute"),
      rule(".pdf-text-layer :is(span, br)", "white-space", "pre"),
      rule(".pdf-text-layer :is(span, br)", "transform-origin", "0% 0%"),
      rule(
        ".pdf-text-layer > :not(.markedContent)",
        "transform",
        "rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))",
      ),
      rule(".pdf-text-layer .markedContent", "display", "contents"),
    ],
    sentinels: ["markedContent"],
    divergences: [
      {
        id: "text-layer-prefix",
        reason: "Package-owned page layers are prefixed to prevent host CSS collisions.",
      },
    ],
  },
  {
    category: "annotation",
    upstream: [
      rule(".annotationLayer", "color-scheme", "only light"),
      rule(".annotationLayer section", "position", "absolute"),
      rule(".annotationLayer section", "box-sizing", "border-box"),
      rule(
        ".annotationLayer section:has(div.annotationContent) canvas.annotationContent",
        "display",
        "none",
      ),
      rule(".annotationLayer .annotationContent", "position", "absolute"),
      rule(
        ".annotationLayer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a",
        "width",
        "100%",
      ),
      rule(
        ".annotationLayer .textWidgetAnnotation :is(input, textarea)",
        "box-sizing",
        "border-box",
      ),
      rule(".annotationLayer .textWidgetAnnotation :is(input, textarea)", "width", "100%"),
      rule(".annotationLayer .textWidgetAnnotation input.comb", "--comb-width", "0px"),
      rule(".annotationLayer .textWidgetAnnotation input.comb", "font-family", "monospace"),
      rule(".annotationLayer .popup", "pointer-events", "auto"),
      rule(".annotationLayer .fileAttachmentAnnotation .popupTriggerArea", "width", "100%"),
    ],
    local: [
      rule(".pdf-annotation-layer", "position", "absolute"),
      rule(".pdf-annotation-layer", "color-scheme", "only light"),
      rule(".pdf-annotation-layer section", "position", "absolute"),
      rule(".pdf-annotation-layer section", "box-sizing", "border-box"),
      rule(
        ".pdf-annotation-layer section:has(div.annotationContent) canvas.annotationContent",
        "display",
        "none",
      ),
      rule(".pdf-annotation-layer .annotationContent", "position", "absolute"),
      rule(".pdf-annotation-layer .linkAnnotation > .pdf-annotation-link", "width", "100%"),
      rule(
        ".pdf-annotation-layer :is(.textWidgetAnnotation input, .textWidgetAnnotation textarea, .choiceWidgetAnnotation select, .buttonWidgetAnnotation.checkBox input, .buttonWidgetAnnotation.radioButton input)",
        "box-sizing",
        "border-box",
      ),
      rule(
        ".pdf-annotation-layer :is(.textWidgetAnnotation input, .textWidgetAnnotation textarea, .choiceWidgetAnnotation select, .buttonWidgetAnnotation.checkBox input, .buttonWidgetAnnotation.radioButton input)",
        "width",
        "100%",
      ),
      rule(".pdf-annotation-layer .textWidgetAnnotation input.comb", "--comb-width", "0px"),
      rule(".pdf-annotation-layer .textWidgetAnnotation input.comb", "font-family", "monospace"),
      rule(".pdf-annotation-layer .popup", "pointer-events", "auto"),
      rule(".pdf-annotation-layer .fileAttachmentAnnotation .popupTriggerArea", "width", "100%"),
    ],
    sentinels: [
      "textWidgetAnnotation",
      "buttonWidgetAnnotation",
      "popupAnnotation",
      "popupTriggerArea",
      "fileAttachmentAnnotation",
      "annotationContent",
    ],
    divergences: [
      {
        id: "annotation-markup-wrapper",
        reason:
          "Package markup wraps interactive PDF.js output for feature policy and safe controls.",
      },
    ],
  },
  {
    category: "xfa",
    upstream: [
      rule(".xfaLayer", "position", "absolute"),
      rule(".xfaLayer", "transform-origin", "0 0"),
      rule(".xfaLayer *", "box-sizing", "border-box"),
      rule(".xfaTb", "display", "flex"),
      rule(".xfaTb", "flex-direction", "column"),
      rule(".xfaTb > div", "justify-content", "left"),
      rule(".xfaTextfield", "width", "100%"),
      rule(".xfaTextfield", "border", "none"),
      rule(".xfaLink", "position", "absolute"),
      rule(".xfaImage", "object-fit", "contain"),
      rule(".xfaImage", "width", "100%"),
    ],
    local: [
      rule(".pdf-xfa-layer", "position", "absolute"),
      rule(".pdf-xfa-layer", "transform-origin", "0 0"),
      rule(".pdf-xfa-layer *", "box-sizing", "border-box"),
      rule(
        ".pdf-xfa-layer :is(.xfaLeft, .xfaRight, .xfaTop, .xfaBottom, .xfaLrTb, .xfaRlTb, .xfaTb, .xfaLr, .xfaRl, .xfaTable, .xfaRow, .xfaRlRow)",
        "display",
        "flex",
      ),
      rule(
        ".pdf-xfa-layer :is(.xfaTop, .xfaBottom, .xfaLrTb, .xfaRlTb, .xfaTb, .xfaTable)",
        "flex-direction",
        "column",
      ),
      rule(".pdf-xfa-layer .xfaTb > div", "justify-content", "left"),
      rule(".pdf-xfa-layer :is(.xfaTextfield, .xfaSelect)", "width", "100%"),
      rule(".pdf-xfa-layer :is(.xfaTextfield, .xfaSelect)", "border", "0"),
      rule(".pdf-xfa-layer .xfaLink", "position", "absolute"),
      rule(".pdf-xfa-layer .xfaImage", "object-fit", "contain"),
      rule(".pdf-xfa-layer .xfaImage", "width", "100%"),
    ],
    sentinels: ["xfaLayer", "xfaFont", "xfaNonInteractive"],
    divergences: [
      {
        id: "xfa-layer-prefix",
        reason: "Display XFA is inserted into the package-owned prefixed layer.",
      },
    ],
  },
  {
    category: "xfa-print",
    upstream: [
      rule(".xfaLayer *", "box-sizing", "border-box"),
      rule(".xfaTb", "display", "flex"),
      rule(".xfaTb > div", "justify-content", "left"),
      rule(".xfaTextfield", "width", "100%"),
      rule(".xfaLink", "position", "absolute"),
      rule(".xfaImage", "object-fit", "contain"),
    ],
    local: [
      rule(".pdf-native-print-slot", "box-sizing", "border-box"),
      rule(".pdf-native-print-slot *", "box-sizing", "border-box"),
      rule(
        ".pdf-native-print-slot :is(.xfaLeft, .xfaRight, .xfaTop, .xfaBottom, .xfaLrTb, .xfaRlTb, .xfaTb, .xfaLr, .xfaRl, .xfaTable, .xfaRow, .xfaRlRow)",
        "display",
        "flex",
      ),
      rule(".pdf-native-print-slot .xfaTb > div", "justify-content", "left"),
      rule(
        ".pdf-native-print-slot :is(.xfaLabel, .xfaWrapped, .xfaTextfield, .xfaSelect, .xfaButton, .xfaCheckbox, .xfaRadio, .xfaRich, .xfaImage)",
        "width",
        "100%",
      ),
      rule(".pdf-native-print-slot .xfaLink", "position", "absolute"),
      rule(".pdf-native-print-slot .xfaImage", "object-fit", "contain"),
    ],
    sentinels: ["xfaLayer", "xfaFont", "xfaNonInteractive"],
    divergences: [
      {
        id: "native-print-slot",
        reason:
          "Print XFA is contained in an off-screen package print slot rather than the viewer page layer.",
      },
    ],
  },
]);

function expandSelectors(parentSelectors, selectors) {
  return selectors.flatMap(selector =>
    parentSelectors.map(parent => {
      const child = selector.trim();
      return parent
        ? child.includes("&")
          ? child.replaceAll("&", parent)
          : `${parent} ${child}`
        : child;
    }),
  );
}

function resolvedSelectors(ruleNode) {
  const ancestry = [];
  for (let node = ruleNode; node; node = node.parent)
    if (node.type === "rule") ancestry.unshift(node);
  return ancestry.reduce(
    (selectors, node) => expandSelectors(selectors, parseSelectorList(node.selector)),
    [""],
  );
}

function declarations(css) {
  const rules = new Map();
  postcss.parse(css).walkRules(ruleNode => {
    for (let parent = ruleNode.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name !== "scope" && parent.name !== "layer") return;
    }
    const directDeclarations = ruleNode.nodes?.filter(node => node.type === "decl") ?? [];
    for (const selector of resolvedSelectors(ruleNode)) {
      const normalizedSelector = normalizeSelector(selector);
      const values = rules.get(normalizedSelector) ?? new Map();
      for (const declaration of directDeclarations) values.set(declaration.prop, declaration.value);
      rules.set(normalizedSelector, values);
    }
  });
  return rules;
}

function requireRule(rules, [selector, property, value], label, category, version, errors) {
  const values = rules.get(normalizeSelector(selector));
  if (!values)
    errors.push(`${category}: ${label} selector ${selector} is missing for PDF.js ${version}`);
  else if (values.get(property) !== value)
    errors.push(
      `${category}: ${label} selector ${selector} requires ${property}: ${value} for PDF.js ${version}`,
    );
}

function validateManifest(manifest, errors) {
  for (const entry of manifest) {
    if (
      !entry.category ||
      !Array.isArray(entry.upstream) ||
      !Array.isArray(entry.local) ||
      !Array.isArray(entry.sentinels) ||
      !Array.isArray(entry.divergences) ||
      !entry.divergences.length
    ) {
      errors.push("CSS manifest entry is incomplete");
    }
    for (const divergence of entry.divergences ?? [])
      if (!divergence.id?.trim() || !divergence.reason?.trim())
        errors.push(`${entry.category}: intentional divergence requires a nonempty id and reason`);
  }
}

/** Checks strings for tests and installed candidate files for compatibility qualification. */
export function validatePdfjsCssCompatibility({
  upstreamCss,
  localCss,
  runtimeSource,
  version,
  manifest = PDFJS_CSS_COMPATIBILITY_MANIFEST,
}) {
  const errors = [];
  validateManifest(manifest, errors);
  const upstream = declarations(upstreamCss);
  const local = declarations(localCss);
  for (const entry of manifest) {
    for (const requirement of entry.upstream)
      requireRule(upstream, requirement, "upstream", entry.category, version, errors);
    for (const requirement of entry.local)
      requireRule(local, requirement, "local", entry.category, version, errors);
    for (const sentinel of entry.sentinels)
      if (!runtimeSource.includes(sentinel))
        errors.push(
          `${entry.category}: runtime sentinel ${sentinel} is missing for PDF.js ${version}`,
        );
  }
  if (errors.length)
    throw new Error(
      `PDF.js CSS compatibility failed:\n${errors.map(error => `- ${error}`).join("\n")}`,
    );
}

export async function checkPdfjsCssCompatibility(
  candidateDir,
  runtimeModulePath,
  version,
  manifest = PDFJS_CSS_COMPATIBILITY_MANIFEST,
) {
  const [upstreamCss, localCss, runtimeSource] = await Promise.all([
    readFile(resolve(candidateDir, "web/pdf_viewer.css"), "utf8"),
    readFile(resolve(import.meta.dirname, "../src/core.css"), "utf8"),
    readFile(runtimeModulePath, "utf8"),
  ]);
  validatePdfjsCssCompatibility({ upstreamCss, localCss, runtimeSource, version, manifest });
}
