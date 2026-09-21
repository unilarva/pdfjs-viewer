// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private PDF destination resolution, coordinate normalization, and annotation-URL safety helpers.
 *
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. It uses shared page acquisitions for bounded PDF.js lookups and value
 * normalization without owning viewer lifecycle, navigation selection, movement,
 * or annotation DOM. See the [architecture guide](../ARCHITECTURE.md) for the
 * authoritative navigation and presentation boundaries.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module pdf-destinations
 */

import type * as PDFJS from "pdfjs-dist";
import type { DocumentPageAcquirer } from "./document-page-usage.js";

/** A PDF.js destination supplied by outlines, annotations, or named lookup. */
export type PdfDestinationInput = string | Array<unknown> | null | undefined;
/** A PDF destination normalized to a zero-based page and optional page ratios. */
export type ResolvedPdfDestination = { pageIndex: number; yRatio?: number; xRatio?: number };

type PdfReferenceLike = { num: number; gen: number };
type PdfDestinationModeLike = { name: unknown };

const SAFE_ANNOTATION_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
/** Clamps a normalized coordinate to a page boundary. */
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Narrows a PDF.js page reference used by an indirect destination. */
function isPdfReference(value: unknown): value is PdfReferenceLike {
  return (
    !!value &&
    typeof value === "object" &&
    "num" in value &&
    typeof value.num === "number" &&
    "gen" in value &&
    typeof value.gen === "number"
  );
}

/** Narrows a PDF.js destination mode name object. */
function isDestinationMode(value: unknown): value is PdfDestinationModeLike {
  return !!value && typeof value === "object" && "name" in value;
}

/** Resolves PDF.js destination forms and always cleans up temporary page proxies. */
export async function resolvePdfDestination(
  pdf: PDFJS.PDFDocumentProxy | null,
  destination: PdfDestinationInput,
  pages: DocumentPageAcquirer,
  viewerRotation: 0 | 90 | 180 | 270 = 0,
): Promise<ResolvedPdfDestination | null> {
  if (!pdf) return null;
  try {
    let resolved: PdfDestinationInput = destination;
    if (typeof resolved === "string") resolved = await pdf.getDestination(resolved);
    const values = Array.isArray(resolved) ? resolved : null;
    const pageReference = values?.[0];
    const pageIndex = isPdfReference(pageReference)
      ? await pdf.getPageIndex(pageReference)
      : typeof pageReference === "number"
        ? pageReference
        : undefined;
    if (pageIndex == null) return null;
    const rawMode = values?.[1];
    const mode = isDestinationMode(rawMode) ? String(rawMode.name) : String(rawMode ?? "");
    let viewport: PDFJS.PageViewport | null = null;
    const getViewport = async (): Promise<PDFJS.PageViewport> => {
      if (viewport) return viewport;
      const use = await pages.acquire(pageIndex + 1);
      try {
        viewport = use.page.getViewport({
          scale: 1,
          rotation: (((use.page.rotate + viewerRotation) % 360) + 360) % 360,
        });
      } finally {
        use.release();
      }
      return viewport;
    };
    const pointRatios = async (
      x: unknown,
      y: unknown,
    ): Promise<Readonly<{ xRatio: number; yRatio: number }> | null> => {
      if (
        typeof x !== "number" ||
        !Number.isFinite(x) ||
        typeof y !== "number" ||
        !Number.isFinite(y)
      )
        return null;
      const page = await getViewport();
      const [viewportX, viewportY] = page.convertToViewportPoint(x, y);
      return Object.freeze({
        xRatio: clamp(viewportX / page.width, 0, 1),
        yRatio: clamp(viewportY / page.height, 0, 1),
      });
    };
    let yRatio: number | undefined;
    let xRatio: number | undefined;
    if (mode === "XYZ") {
      const hasX = typeof values?.[2] === "number" && Number.isFinite(values[2]);
      const hasY = typeof values?.[3] === "number" && Number.isFinite(values[3]);
      const point =
        hasX || hasY ? await pointRatios(hasX ? values?.[2] : 0, hasY ? values?.[3] : 0) : null;
      if (hasX) xRatio = point?.xRatio;
      if (hasY) yRatio = point?.yRatio;
    } else if (mode === "FitH" || mode === "FitBH") {
      const page = await getViewport();
      const point = await pointRatios(0, values?.[2]);
      if (point) {
        if (page.rotation === 90 || page.rotation === 270) xRatio = point.xRatio;
        else yRatio = point.yRatio;
      }
    } else if (mode === "FitV" || mode === "FitBV") {
      const page = await getViewport();
      const point = await pointRatios(values?.[2], 0);
      if (point) {
        if (page.rotation === 90 || page.rotation === 270) yRatio = point.yRatio;
        else xRatio = point.xRatio;
      }
    } else if (mode === "FitR") {
      const left = values?.[2],
        bottom = values?.[3],
        right = values?.[4],
        top = values?.[5];
      const first = await pointRatios(left, bottom);
      const second = await pointRatios(right, top);
      if (first && second) {
        xRatio = Math.min(first.xRatio, second.xRatio);
        yRatio = Math.min(first.yRatio, second.yRatio);
      }
    } else if (mode === "Fit" || mode === "FitB") yRatio = 0;
    return { pageIndex, yRatio, xRatio };
  } catch {
    return null;
  }
}

/** Returns a safe absolute annotation URL, or null for malformed or unsafe schemes. */
export function safeAnnotationUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return SAFE_ANNOTATION_URL_PROTOCOLS.has(url.protocol.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

/** Returns an annotation URL's normalized protocol for non-sensitive diagnostics. */
export function annotationUrlProtocol(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).protocol.toLowerCase();
  } catch {
    return null;
  }
}
