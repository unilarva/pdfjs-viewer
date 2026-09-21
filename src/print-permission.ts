// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private common print-permission interpretation boundary. This emitted module
 * is for package maintainers and is not a supported consumer subpath or
 * package-root export. See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module print-permission
 */

import type { PdfjsViewerDocumentInformation, PdfjsViewerPermission } from "./viewer-contracts.js";

/** One policy shared by preflight, native, adapter, source fallback, UI, and public state. */
export function resolvePrintPermission(
  permissions: readonly PdfjsViewerPermission[] | null,
): Readonly<{
  allowed: boolean;
  highQuality: boolean;
}> {
  const unrestricted = permissions === null;
  const ordinary = unrestricted || permissions.includes("print");
  const highQuality = unrestricted || permissions.includes("print-high-quality");
  return Object.freeze({ allowed: ordinary || highQuality, highQuality });
}

export function resolveDocumentPrintPermission(
  information: PdfjsViewerDocumentInformation,
): ReturnType<typeof resolvePrintPermission> {
  return resolvePrintPermission(information.permissions);
}

/** Adapts PDF.js numeric PermissionFlag values at initial-load state publication. */
export function resolvePdfjsPrintPermission(
  permissions: ReadonlySet<number> | null,
): ReturnType<typeof resolvePrintPermission> {
  if (permissions === null) return resolvePrintPermission(null);
  return Object.freeze({
    allowed: permissions.has(0x04) || permissions.has(0x800),
    highQuality: permissions.has(0x800),
  });
}
