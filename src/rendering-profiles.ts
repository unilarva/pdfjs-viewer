// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private pure rendering-profile defaults, validation, override merging, and selection.
 *
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. The facade resolves public and automatic profile selection;
 * `DocumentRenderer` consumes the resulting complete settings. See the
 * [architecture guide](../ARCHITECTURE.md) for the authoritative facade/renderer
 * policy boundary.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module rendering-profiles
 */

import type {
  PdfjsViewerRenderingProfile,
  PdfjsViewerRenderingProfilePolicy,
  PdfjsViewerRenderingProfilePolicyCategory,
  PdfjsViewerRenderingProfiles,
  PdfjsViewerRenderingProfileSettings,
} from "./viewer-contracts.js";

const profiles = ["conservative", "balanced", "aggressive"] as const;
const MIN_MEMORY_LIMIT_MIB = 5;
const MAX_MEMORY_LIMIT_MIB = 8192;
const MIN_THUMBNAIL_MEMORY_LIMIT_MIB = 1;
const MAX_THUMBNAIL_MEMORY_LIMIT_MIB = 1024;
const BYTES_PER_MIB = 1024 * 1024;
const print = () =>
  Object.freeze({
    maxSheets: 350,
    maxAnnotationCanvasBytesPerPage: 32 * BYTES_PER_MIB,
    estimatedEncodedBytesPerPixel: 0.5,
    encodingOverheadRatio: 1,
    safetyMarginRatio: 0.15,
    maxXfaPages: 350,
    maxXfaNodes: 500_000,
    maxXfaImages: 10_000,
    maxConcurrentImageDecodes: 4,
  });

/** Immutable built-in profile settings before per-viewer overrides. */
export const DEFAULT_RENDERING_PROFILE_SETTINGS: Readonly<
  Record<PdfjsViewerRenderingProfile, PdfjsViewerRenderingProfileSettings>
> = Object.freeze({
  conservative: Object.freeze({
    memoryLimitMiB: 256,
    thumbnailMemoryLimitMiB: 12,
    maxCanvasPixels: 24_000_000,
    maxCanvasDimension: 8192,
    maxConcurrentRenders: 2,
    maxBufferViewportHeights: 8,
    maxBufferPages: 128,
    bufferViewportHeightsWhenInactive: 0,
    maxRenderDpr: 3,
    minRenderDpr: 0.75,
    allowDprReduction: true,
    allowVisibleDirectRendering: false,
    memoryHysteresis: 0.1,
    print: print(),
  }),
  balanced: Object.freeze({
    memoryLimitMiB: 512,
    thumbnailMemoryLimitMiB: 24,
    maxCanvasPixels: 24_000_000,
    maxCanvasDimension: 8192,
    maxConcurrentRenders: 3,
    maxBufferViewportHeights: 16,
    maxBufferPages: 512,
    bufferViewportHeightsWhenInactive: 0,
    maxRenderDpr: 3,
    minRenderDpr: 1,
    allowDprReduction: true,
    allowVisibleDirectRendering: false,
    memoryHysteresis: 0.1,
    print: print(),
  }),
  aggressive: Object.freeze({
    memoryLimitMiB: 1024,
    thumbnailMemoryLimitMiB: 64,
    maxCanvasPixels: 24_000_000,
    maxCanvasDimension: 8192,
    maxConcurrentRenders: 4,
    maxBufferViewportHeights: "unlimited",
    maxBufferPages: "unlimited",
    bufferViewportHeightsWhenInactive: 0,
    maxRenderDpr: 3,
    minRenderDpr: 1,
    allowDprReduction: true,
    allowVisibleDirectRendering: false,
    memoryHysteresis: 0.08,
    print: print(),
  }),
});

/** Immutable built-in profile availability and automatic-selection policy. */
export const DEFAULT_RENDERING_PROFILE_POLICY: Readonly<PdfjsViewerRenderingProfilePolicy> =
  Object.freeze({
    likelyMobile: Object.freeze({
      availableProfiles: Object.freeze(["conservative"] as PdfjsViewerRenderingProfile[]),
      defaultProfile: "conservative" as PdfjsViewerRenderingProfile,
    }),
    other: Object.freeze({
      availableProfiles: Object.freeze([
        "conservative",
        "balanced",
        "aggressive",
      ] as PdfjsViewerRenderingProfile[]),
      defaultProfile: "balanced" as PdfjsViewerRenderingProfile,
    }),
  });

/** Validates sparse per-profile overrides and returns an immutable complete profile map. */
export function mergeRenderingProfiles(
  overrides?: PdfjsViewerRenderingProfiles,
): Record<PdfjsViewerRenderingProfile, PdfjsViewerRenderingProfileSettings> {
  const result = {} as Record<PdfjsViewerRenderingProfile, PdfjsViewerRenderingProfileSettings>;
  const allowed = new Set<keyof PdfjsViewerRenderingProfileSettings>([
    "memoryLimitMiB",
    "thumbnailMemoryLimitMiB",
    "maxCanvasPixels",
    "maxCanvasDimension",
    "maxConcurrentRenders",
    "maxBufferViewportHeights",
    "maxBufferPages",
    "bufferViewportHeightsWhenInactive",
    "maxRenderDpr",
    "minRenderDpr",
    "allowDprReduction",
    "allowVisibleDirectRendering",
    "memoryHysteresis",
    "print",
  ]);
  for (const profile of profiles) {
    for (const key of Object.keys(overrides?.[profile] ?? {}))
      if (!allowed.has(key as keyof PdfjsViewerRenderingProfileSettings))
        throw new TypeError(
          `PdfjsViewer: renderingProfiles.${profile}.${key} is not a supported setting`,
        );
    const override = overrides?.[profile];
    if (
      override?.print !== undefined &&
      (typeof override.print !== "object" ||
        override.print === null ||
        Array.isArray(override.print))
    )
      throw new TypeError(`PdfjsViewer: renderingProfiles.${profile}.print must be an object`);
    const value = {
      ...DEFAULT_RENDERING_PROFILE_SETTINGS[profile],
      ...override,
      print: { ...DEFAULT_RENDERING_PROFILE_SETTINGS[profile].print, ...override?.print },
    };
    if (!Number.isFinite(value.memoryLimitMiB))
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.memoryLimitMiB must be finite`,
      );
    value.memoryLimitMiB = Math.min(
      MAX_MEMORY_LIMIT_MIB,
      Math.max(MIN_MEMORY_LIMIT_MIB, value.memoryLimitMiB),
    );
    if (!Number.isFinite(value.thumbnailMemoryLimitMiB))
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.thumbnailMemoryLimitMiB must be finite`,
      );
    value.thumbnailMemoryLimitMiB = Math.min(
      MAX_THUMBNAIL_MEMORY_LIMIT_MIB,
      Math.max(MIN_THUMBNAIL_MEMORY_LIMIT_MIB, value.thumbnailMemoryLimitMiB),
    );
    for (const key of ["maxCanvasPixels", "maxCanvasDimension"] as const)
      if (!Number.isSafeInteger(value[key]) || value[key] < 1)
        throw new RangeError(
          `PdfjsViewer: renderingProfiles.${profile}.${key} must be a positive safe integer`,
        );
    if (!Number.isInteger(value.maxConcurrentRenders) || value.maxConcurrentRenders < 1)
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.maxConcurrentRenders must be a positive integer`,
      );
    if (
      value.maxBufferViewportHeights !== "unlimited" &&
      (!Number.isFinite(value.maxBufferViewportHeights) || value.maxBufferViewportHeights < 0)
    )
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.maxBufferViewportHeights must be finite and non-negative or "unlimited"`,
      );
    if (
      value.maxBufferPages !== "unlimited" &&
      (!Number.isSafeInteger(value.maxBufferPages) || value.maxBufferPages < 0)
    )
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.maxBufferPages must be a non-negative safe integer or "unlimited"`,
      );
    if (
      !Number.isFinite(value.bufferViewportHeightsWhenInactive) ||
      value.bufferViewportHeightsWhenInactive < 0
    )
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.bufferViewportHeightsWhenInactive must be finite and non-negative`,
      );
    for (const key of ["minRenderDpr", "maxRenderDpr"] as const)
      if (!Number.isFinite(value[key]) || value[key] <= 0)
        throw new RangeError(
          `PdfjsViewer: renderingProfiles.${profile}.${key} must be finite and greater than zero`,
        );
    if (value.minRenderDpr > value.maxRenderDpr)
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.minRenderDpr must not exceed maxRenderDpr`,
      );
    if (
      !Number.isFinite(value.memoryHysteresis) ||
      value.memoryHysteresis < 0 ||
      value.memoryHysteresis >= 1
    )
      throw new RangeError(
        `PdfjsViewer: renderingProfiles.${profile}.memoryHysteresis must be in [0, 1)`,
      );
    for (const key of ["allowDprReduction", "allowVisibleDirectRendering"] as const)
      if (typeof value[key] !== "boolean")
        throw new TypeError(`PdfjsViewer: renderingProfiles.${profile}.${key} must be boolean`);
    const printKeys = [
      "maxSheets",
      "maxAnnotationCanvasBytesPerPage",
      "estimatedEncodedBytesPerPixel",
      "encodingOverheadRatio",
      "safetyMarginRatio",
      "maxXfaPages",
      "maxXfaNodes",
      "maxXfaImages",
      "maxConcurrentImageDecodes",
    ] as const;
    for (const key of Object.keys(override?.print ?? {}))
      if (!printKeys.includes(key as (typeof printKeys)[number]))
        throw new TypeError(
          `PdfjsViewer: renderingProfiles.${profile}.print.${key} is not a supported setting`,
        );
    for (const key of printKeys) {
      const entry = value.print[key];
      const fractional =
        key === "estimatedEncodedBytesPerPixel" ||
        key === "encodingOverheadRatio" ||
        key === "safetyMarginRatio";
      if (!Number.isFinite(entry) || entry <= 0 || (!fractional && !Number.isInteger(entry)))
        throw new RangeError(
          `PdfjsViewer: renderingProfiles.${profile}.print.${key} must be a positive ${fractional ? "finite number" : "integer"}`,
        );
    }
    result[profile] = Object.freeze({ ...value, print: Object.freeze(value.print) });
  }
  return Object.freeze(result);
}

/** Validates device-category availability and automatic profile selections. */
export function mergeRenderingProfilePolicy(
  overrides:
    | Partial<Record<"likelyMobile" | "other", Partial<PdfjsViewerRenderingProfilePolicyCategory>>>
    | undefined,
): PdfjsViewerRenderingProfilePolicy {
  const result = {} as PdfjsViewerRenderingProfilePolicy;
  for (const category of ["likelyMobile", "other"] as const) {
    const defaults = DEFAULT_RENDERING_PROFILE_POLICY[category];
    const availableProfiles = [
      ...(overrides?.[category]?.availableProfiles ?? defaults.availableProfiles),
    ];
    const defaultProfile = overrides?.[category]?.defaultProfile ?? defaults.defaultProfile;
    if (
      !availableProfiles.length ||
      new Set(availableProfiles).size !== availableProfiles.length ||
      availableProfiles.some(profile => !profiles.includes(profile))
    )
      throw new RangeError(
        `PdfjsViewer: renderingProfilePolicy.${category}.availableProfiles must be a non-empty list of unique profiles`,
      );
    if (!availableProfiles.includes(defaultProfile))
      throw new RangeError(
        `PdfjsViewer: renderingProfilePolicy.${category}.defaultProfile must be available`,
      );
    result[category] = Object.freeze({
      availableProfiles: Object.freeze(availableProfiles),
      defaultProfile,
    });
  }
  return Object.freeze(result);
}

/** Resolves an automatic selection and rejects a profile unavailable to this viewer. */
export function resolveRenderingProfile(
  selection: PdfjsViewerRenderingProfile | "auto",
  available: readonly PdfjsViewerRenderingProfile[],
  automatic: PdfjsViewerRenderingProfile,
): PdfjsViewerRenderingProfile {
  const profile = selection === "auto" ? automatic : selection;
  if (!available.includes(profile))
    throw new RangeError(
      `PdfjsViewer: rendering profile ${profile} is unavailable for this device category`,
    );
  return profile;
}
