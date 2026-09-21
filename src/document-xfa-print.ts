// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure-XFA print-preparation boundary.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * This owner freezes immutable structural pages, page viewports, and XFA values for
 * `DocumentPrint` to consume during its native job lifecycle. It does not own print
 * invocation, rendering, or browser-resource lifetime. See the
 * [architecture guide](../ARCHITECTURE.md) for the print ownership boundary.
 *
 * @packageDocumentation
 * @module document-xfa-print
 */

import type * as PDFJS from "pdfjs-dist";
import {
  createXfaValueSnapshot,
  type XfaStructuralNode,
  type XfaValueReader,
} from "./xfa-value-snapshot.js";
import { getPdfjsXfaPageViewport } from "./pdfjs-compatibility.js";

interface DocumentXfaPrintPageSnapshot {
  readonly pageNo: number;
  readonly intent: "print";
  readonly xfaHtml: XfaStructuralNode;
  readonly size: Readonly<{ width: number; height: number }>;
  readonly nodeCount: number;
  readonly imageCount: number;
}

export interface DocumentXfaPrintSnapshot {
  readonly pages: readonly Readonly<DocumentXfaPrintPageSnapshot>[];
  readonly pageFor: (pageNo: number) => Readonly<DocumentXfaPrintPageSnapshot>;
  readonly annotationStorage: XfaValueReader;
  readonly nodeCount: number;
  readonly imageCount: number;
}

export interface DocumentXfaPrintAdmission {
  readonly source: object;
  readonly pages: readonly Readonly<{ pageNo: number; nodeCount: number; imageCount: number }>[];
  readonly nodeCount: number;
  readonly imageCount: number;
  readonly exceeded: boolean;
}

export interface DocumentXfaPrintAdmissionLimits {
  readonly maxPages: number;
  readonly maxNodes: number;
  readonly maxImages: number;
}

/** Counts selected source pages without copying the PDF.js fake-DOM tree. */
export function inspectDocumentXfaPrintSource(
  pdf: PDFJS.PDFDocumentProxy,
  pageNumbers: readonly number[],
  limits: Readonly<DocumentXfaPrintAdmissionLimits>,
): DocumentXfaPrintAdmission | null {
  const source = pdf.allXfaHtml as XfaStructuralNode | null;
  if (!pdf.isPureXfa || !source) return null;
  if (!Array.isArray(source.children) || source.children.length !== pdf.numPages) {
    throw new TypeError("PdfjsViewer: PDF.js returned inconsistent XFA print pages");
  }
  let nodeCount = 0;
  let imageCount = 0;
  const pages: Array<Readonly<{ pageNo: number; nodeCount: number; imageCount: number }>> = [];
  for (const pageNo of pageNumbers) {
    const page = source.children[pageNo - 1];
    if (!page) throw new TypeError("PdfjsViewer: PDF.js returned an empty XFA print page");
    const counts = countXfaSource(page, limits.maxNodes - nodeCount, limits.maxImages - imageCount);
    nodeCount += counts.nodeCount;
    imageCount += counts.imageCount;
    pages.push(Object.freeze({ pageNo, ...counts }));
    if (
      pages.length > limits.maxPages ||
      nodeCount > limits.maxNodes ||
      imageCount > limits.maxImages
    )
      break;
  }
  return Object.freeze({
    source,
    pages: Object.freeze(pages),
    nodeCount,
    imageCount,
    exceeded:
      pages.length > limits.maxPages ||
      nodeCount > limits.maxNodes ||
      imageCount > limits.maxImages,
  });
}

/** Captures one immutable pure-XFA job-start preparation snapshot. */
export function createDocumentXfaPrintSnapshot(
  pdf: PDFJS.PDFDocumentProxy,
  XfaLayer: typeof PDFJS.XfaLayer,
  admission?: DocumentXfaPrintAdmission,
): DocumentXfaPrintSnapshot | null {
  const allXfaHtml = pdf.allXfaHtml as XfaStructuralNode | null;
  if (!pdf.isPureXfa || !allXfaHtml) return null;
  const admitted =
    admission ??
    inspectDocumentXfaPrintSource(
      pdf,
      Array.from({ length: pdf.numPages }, (_, index) => index + 1),
      {
        maxPages: Number.MAX_SAFE_INTEGER,
        maxNodes: Number.MAX_SAFE_INTEGER,
        maxImages: Number.MAX_SAFE_INTEGER,
      },
    )!;
  if (admitted.source !== allXfaHtml || admitted.exceeded) {
    throw new TypeError("PdfjsViewer: stale or oversized XFA print admission");
  }
  const selectedSource = Object.freeze({
    name: allXfaHtml.name,
    children: admitted.pages.map(page => allXfaHtml.children![page.pageNo - 1]),
  });
  const values = createXfaValueSnapshot(selectedSource, pdf.annotationStorage);
  const children = values.structure.children ?? [];
  const pages = children.map((page, index) => {
    if (!page) throw new TypeError("PdfjsViewer: PDF.js returned an empty XFA print page");
    const xfaHtml = page;
    const viewport = getPdfjsXfaPageViewport(XfaLayer, xfaHtml, { scale: 1, rotation: 0 });
    return Object.freeze({
      pageNo: admitted.pages[index]!.pageNo,
      intent: "print" as const,
      xfaHtml,
      size: Object.freeze({ width: viewport.width, height: viewport.height }),
      nodeCount: admitted.pages[index]!.nodeCount,
      imageCount: admitted.pages[index]!.imageCount,
    });
  });
  const byPage = new Map(pages.map(page => [page.pageNo, page]));
  return Object.freeze({
    pages: Object.freeze(pages),
    annotationStorage: values.annotationStorage,
    pageFor: (pageNo: number) => {
      const page = byPage.get(pageNo);
      if (!page) throw new RangeError(`PdfjsViewer: XFA page ${pageNo} was not admitted`);
      return page;
    },
    nodeCount: admitted.nodeCount,
    imageCount: admitted.imageCount,
  });
}

function countXfaSource(
  root: unknown,
  remainingNodes: number,
  remainingImages: number,
): Readonly<{ nodeCount: number; imageCount: number }> {
  let nodeCount = 0;
  let imageCount = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      typeof (node as { name?: unknown }).name !== "string"
    ) {
      throw new TypeError("PdfjsViewer: PDF.js returned invalid XFA structure");
    }
    nodeCount++;
    if ((node as { name: string }).name.toLowerCase() === "img") imageCount++;
    if (nodeCount > remainingNodes || imageCount > remainingImages) break;
    const children = (node as { children?: unknown }).children;
    if (children !== undefined && !Array.isArray(children))
      throw new TypeError("PdfjsViewer: PDF.js returned invalid XFA children");
    for (const child of children ?? []) if (child) stack.push(child);
  }
  return Object.freeze({ nodeCount, imageCount });
}
