// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public pure browser/device compatibility policy shared by optional viewer
 * capabilities. Consumers import its contracts from the package root. See the
 * [architecture guide](../ARCHITECTURE.md) for the ownership boundary.
 * @packageDocumentation
 * @module device-compatibility
 */

/** Browser compatibility family used by viewer capability policy. */
export type PdfjsViewerBrowserCompatibilityEngine = "chromium" | "firefox" | "webkit" | "unknown";
/** Browser brand recognized by viewer capability policy. */
export type PdfjsViewerBrowser = "chrome" | "edge" | "chromium" | "firefox" | "safari" | "unknown";
/** Device form-factor platform used by viewer capability policy. */
export type PdfjsViewerPlatform = "desktop" | "android" | "apple-mobile" | "other-mobile";
/** Operating-system classification used by viewer capability policy. */
export type PdfjsViewerOperatingSystem =
  "linux" | "windows" | "macos" | "android" | "ios" | "other";
/** Native print orientations admitted by compatibility policy. */
export type PdfjsViewerNativePrintSupport = "unsupported" | "portrait" | "portrait-and-landscape";

/** Browser facts used to resolve device compatibility without reading global state. */
export interface PdfjsViewerDeviceEnvironment {
  /** Browser user-agent string to classify. */
  readonly userAgent: string;
  /** Explicit User-Agent Client Hints mobile flag when available. */
  readonly mobile?: boolean;
  /** Explicit OS classification; omitted values are conservatively inferred from the user agent. */
  readonly operatingSystem?: PdfjsViewerOperatingSystem;
}

/**
 * One compatibility-engine-scoped compatibility rule.
 *
 * `engine` identifies the browser compatibility family used by this package,
 * not necessarily the literal runtime engine executing the page. Omitted
 * selectors match every value on that axis.
 */
export interface PdfjsViewerDeviceCompatibilityRule {
  /** Required compatibility family matched by this rule. */
  readonly engine: Exclude<PdfjsViewerBrowserCompatibilityEngine, "unknown">;
  /** Optional browser-brand refinement. */
  readonly browser?: Exclude<PdfjsViewerBrowser, "unknown">;
  /** Optional device-platform refinement. */
  readonly platform?: PdfjsViewerPlatform;
  /** Optional operating-system refinement. */
  readonly operatingSystem?: PdfjsViewerOperatingSystem;
  /** Native print orientation support granted to matching environments. */
  readonly nativePrintSupport: PdfjsViewerNativePrintSupport;
  /** Optional audit reference supporting a narrower compatibility decision. */
  readonly evidenceId?: string;
}

/** Fully resolved compatibility classification and native print policy. */
export interface PdfjsViewerDeviceCompatibility {
  /** Resolved browser compatibility family. */
  readonly engine: PdfjsViewerBrowserCompatibilityEngine;
  /** Resolved browser brand. */
  readonly browser: PdfjsViewerBrowser;
  /** Resolved device platform. */
  readonly platform: PdfjsViewerPlatform;
  /** Resolved operating system. */
  readonly operatingSystem: PdfjsViewerOperatingSystem;
  /** Native print orientations admitted for this environment. */
  readonly nativePrintSupport: PdfjsViewerNativePrintSupport;
}

/** Package compatibility baseline. More specific host rules may refine these decisions. */
export const PDFJS_VIEWER_DEVICE_COMPATIBILITY: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[] =
  Object.freeze([
    Object.freeze({ engine: "chromium", nativePrintSupport: "portrait" }),
    Object.freeze({ engine: "firefox", nativePrintSupport: "portrait" }),
    Object.freeze({ engine: "webkit", nativePrintSupport: "unsupported" }),

    Object.freeze({
      engine: "chromium",
      platform: "desktop",
      nativePrintSupport: "portrait-and-landscape",
    }),
    Object.freeze({
      engine: "firefox",
      platform: "desktop",
      nativePrintSupport: "portrait-and-landscape",
    }),

    Object.freeze({
      engine: "chromium",
      platform: "apple-mobile",
      nativePrintSupport: "unsupported",
    }),
    Object.freeze({
      engine: "firefox",
      platform: "apple-mobile",
      nativePrintSupport: "unsupported",
    }),
    Object.freeze({
      engine: "webkit",
      platform: "apple-mobile",
      nativePrintSupport: "unsupported",
    }),
  ]);

/**
 * Browser-brand to compatibility-engine mapping.
 *
 * These values describe the compatibility family used by viewer policy. They
 * must not be interpreted as proof of the browser's literal runtime engine on
 * every platform.
 */
const BROWSER_COMPATIBILITY_ENGINES = Object.freeze({
  chrome: "chromium",
  edge: "chromium",
  chromium: "chromium",
  firefox: "firefox",
  safari: "webkit",
} as const);

const SELECTORS = ["engine", "browser", "platform", "operatingSystem"] as const;
type Selector = (typeof SELECTORS)[number];

const MOBILE_PLATFORM_OPERATING_SYSTEMS = Object.freeze({
  android: "android",
  "apple-mobile": "ios",
} as const);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function selectorKey(rule: Readonly<PdfjsViewerDeviceCompatibilityRule>): string {
  return SELECTORS.map(selector => rule[selector] ?? "*").join("\0");
}

function rulesOverlap(
  a: Readonly<PdfjsViewerDeviceCompatibilityRule>,
  b: Readonly<PdfjsViewerDeviceCompatibilityRule>,
): boolean {
  return SELECTORS.every(
    selector =>
      a[selector] === undefined || b[selector] === undefined || a[selector] === b[selector],
  );
}

function ruleRefines(
  a: Readonly<PdfjsViewerDeviceCompatibilityRule>,
  b: Readonly<PdfjsViewerDeviceCompatibilityRule>,
): boolean {
  let narrower = false;

  for (const selector of SELECTORS) {
    if (b[selector] === undefined) {
      narrower ||= a[selector] !== undefined;
    } else if (a[selector] !== b[selector]) {
      return false;
    }
  }

  return narrower;
}

function intersectionKey(
  a: Readonly<PdfjsViewerDeviceCompatibilityRule>,
  b: Readonly<PdfjsViewerDeviceCompatibilityRule>,
): string {
  return SELECTORS.map(selector => a[selector] ?? b[selector] ?? "*").join("\0");
}

/** Validates, detaches, freezes, and rejects unresolved overlapping rules. */
export function normalizeDeviceCompatibilityRules(
  value: unknown,
  path = "deviceCompatibility",
): readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError(`PdfjsViewer: ${path} must be an array when provided`);
  }

  const keys = new Set<string>();
  const evidenceIds = new Set<string>();

  const rules = value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;

    if (!isObject(entry)) {
      throw new TypeError(`PdfjsViewer: ${entryPath} must be an object`);
    }

    for (const name of Object.keys(entry)) {
      if (![...SELECTORS, "nativePrintSupport", "evidenceId"].includes(name as Selector)) {
        throw new TypeError(`PdfjsViewer: unknown ${entryPath}.${name} option`);
      }
    }

    if (
      !Object.hasOwn(entry, "engine") ||
      !["chromium", "firefox", "webkit"].includes(entry.engine as string)
    ) {
      throw new RangeError(`PdfjsViewer: ${entryPath}.engine must be chromium, firefox, or webkit`);
    }

    if (
      entry.browser !== undefined &&
      !["chrome", "edge", "chromium", "firefox", "safari"].includes(entry.browser as string)
    ) {
      throw new RangeError(
        `PdfjsViewer: ${entryPath}.browser must be chrome, edge, chromium, firefox, or safari`,
      );
    }

    if (
      entry.platform !== undefined &&
      !["desktop", "android", "apple-mobile", "other-mobile"].includes(entry.platform as string)
    ) {
      throw new RangeError(
        `PdfjsViewer: ${entryPath}.platform must be desktop, android, apple-mobile, or other-mobile`,
      );
    }

    if (
      entry.operatingSystem !== undefined &&
      !["linux", "windows", "macos", "android", "ios", "other"].includes(
        entry.operatingSystem as string,
      )
    ) {
      throw new RangeError(
        `PdfjsViewer: ${entryPath}.operatingSystem must be linux, windows, macos, android, ios, or other`,
      );
    }

    if (
      !["unsupported", "portrait", "portrait-and-landscape"].includes(
        entry.nativePrintSupport as string,
      )
    ) {
      throw new RangeError(
        `PdfjsViewer: ${entryPath}.nativePrintSupport must be unsupported, portrait, or portrait-and-landscape`,
      );
    }

    if (
      entry.browser !== undefined &&
      BROWSER_COMPATIBILITY_ENGINES[entry.browser as keyof typeof BROWSER_COMPATIBILITY_ENGINES] !==
        entry.engine
    ) {
      throw new RangeError(
        `PdfjsViewer: ${entryPath}.browser does not belong to its compatibility engine`,
      );
    }

    if (entry.platform === "android" || entry.platform === "apple-mobile") {
      const expectedOperatingSystem = MOBILE_PLATFORM_OPERATING_SYSTEMS[entry.platform];

      if (
        entry.operatingSystem !== undefined &&
        entry.operatingSystem !== expectedOperatingSystem
      ) {
        throw new RangeError(
          `PdfjsViewer: ${entryPath} has incompatible platform and operatingSystem selectors`,
        );
      }
    }

    if (entry.operatingSystem === "android" || entry.operatingSystem === "ios") {
      const expectedPlatform = entry.operatingSystem === "android" ? "android" : "apple-mobile";

      if (entry.platform !== undefined && entry.platform !== expectedPlatform) {
        throw new RangeError(
          `PdfjsViewer: ${entryPath} has incompatible platform and operatingSystem selectors`,
        );
      }
    }

    if (
      entry.evidenceId !== undefined &&
      (typeof entry.evidenceId !== "string" || !entry.evidenceId.trim())
    ) {
      throw new TypeError(
        `PdfjsViewer: ${entryPath}.evidenceId must be a non-blank string when provided`,
      );
    }

    const evidenceId = typeof entry.evidenceId === "string" ? entry.evidenceId.trim() : undefined;

    if (evidenceId && evidenceIds.has(evidenceId)) {
      throw new TypeError(`PdfjsViewer: duplicate ${entryPath}.evidenceId`);
    }

    if (evidenceId) evidenceIds.add(evidenceId);

    const rule = Object.freeze({
      engine: entry.engine,
      ...(entry.browser === undefined ? {} : { browser: entry.browser }),
      ...(entry.platform === undefined ? {} : { platform: entry.platform }),
      ...(entry.operatingSystem === undefined ? {} : { operatingSystem: entry.operatingSystem }),
      nativePrintSupport: entry.nativePrintSupport,
      ...(evidenceId === undefined ? {} : { evidenceId }),
    }) as Readonly<PdfjsViewerDeviceCompatibilityRule>;

    const key = selectorKey(rule);

    if (keys.has(key)) {
      throw new TypeError(`PdfjsViewer: duplicate ${entryPath} selectors`);
    }

    keys.add(key);
    return rule;
  });

  const byKey = new Map(rules.map(rule => [selectorKey(rule), rule]));

  for (let left = 0; left < rules.length; left++) {
    for (let right = left + 1; right < rules.length; right++) {
      const a = rules[left];
      const b = rules[right];

      if (
        a.nativePrintSupport === b.nativePrintSupport ||
        !rulesOverlap(a, b) ||
        ruleRefines(a, b) ||
        ruleRefines(b, a)
      ) {
        continue;
      }

      if (!byKey.has(intersectionKey(a, b))) {
        throw new TypeError(
          `PdfjsViewer: ${path}[${left}] and ${path}[${right}] overlap with different nativePrintSupport; add their explicit intersection`,
        );
      }
    }
  }

  return Object.freeze(rules);
}

/** Merges host refinements over package defaults by exact selector identity. */
export function mergeDeviceCompatibilityRules(
  hostRules: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[],
): readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[] {
  const merged = new Map(PDFJS_VIEWER_DEVICE_COMPATIBILITY.map(rule => [selectorKey(rule), rule]));

  for (const rule of hostRules) {
    merged.set(selectorKey(rule), rule);
  }

  return normalizeDeviceCompatibilityRules([...merged.values()], "deviceCompatibility");
}

function classifyEnvironment(
  environment: PdfjsViewerDeviceEnvironment,
): Omit<PdfjsViewerDeviceCompatibility, "nativePrintSupport"> {
  if (!environment || typeof environment.userAgent !== "string") {
    throw new TypeError("PdfjsViewer: device environment requires a userAgent string");
  }

  const ua = environment.userAgent;

  const uaAndroid = /\bAndroid\b/i.test(ua);

  /*
   * iPadOS may present a Macintosh-style user agent while retaining the
   * Mobile/<build> token. Treat that combination as Apple mobile in addition
   * to the traditional iPhone/iPad/iPod identifiers.
   */
  const uaAppleMobile =
    /\b(?:iPhone|iPad|iPod)\b/i.test(ua) ||
    (/\bMacintosh\b/i.test(ua) && /\bMobile\/[A-Za-z0-9._-]+\b/i.test(ua));

  const inferredOperatingSystem: PdfjsViewerOperatingSystem = uaAndroid
    ? "android"
    : uaAppleMobile
      ? "ios"
      : /\bWindows NT\b/i.test(ua)
        ? "windows"
        : /\b(?:Macintosh|Mac OS X)\b/i.test(ua)
          ? "macos"
          : /\b(?:Linux|X11)\b/i.test(ua)
            ? "linux"
            : "other";

  const operatingSystem = environment.operatingSystem ?? inferredOperatingSystem;

  const mobile =
    operatingSystem === "android" ||
    operatingSystem === "ios" ||
    environment.mobile === true ||
    /\b(?:Mobile|iPhone|iPad|iPod)\b/i.test(ua);

  const firefox = /\b(?:Firefox|FxiOS)\//i.test(ua);
  const edge = /\bEdg(?:A|iOS)?\//i.test(ua);
  const chrome = /\b(?:Chrome|CriOS|HeadlessChrome)\//i.test(ua);
  const chromium = /\bChromium\//i.test(ua);
  const safari = /\bAppleWebKit\//i.test(ua) && /\bSafari\//i.test(ua);

  const browser: PdfjsViewerBrowser = firefox
    ? "firefox"
    : edge
      ? "edge"
      : chrome
        ? "chrome"
        : chromium
          ? "chromium"
          : safari
            ? "safari"
            : "unknown";

  /*
   * This is a browser compatibility-family classification, not a claim about
   * the literal runtime engine. That distinction matters especially on Apple
   * mobile platforms.
   */
  const engine: PdfjsViewerBrowserCompatibilityEngine =
    browser === "unknown" ? "unknown" : BROWSER_COMPATIBILITY_ENGINES[browser];

  const platform: PdfjsViewerPlatform =
    operatingSystem === "android"
      ? "android"
      : operatingSystem === "ios"
        ? "apple-mobile"
        : mobile
          ? "other-mobile"
          : "desktop";

  return Object.freeze({
    engine,
    browser,
    platform,
    operatingSystem,
  });
}

/**
 * Classifies the environment and resolves the most-specific matching rule.
 * Omitted `rules` use the package baseline; an explicit empty array makes
 * every environment resolve to `nativePrintSupport: "unsupported"`.
 */
export function resolveDeviceCompatibility(
  environment: PdfjsViewerDeviceEnvironment,
  rules: readonly Readonly<PdfjsViewerDeviceCompatibilityRule>[] = PDFJS_VIEWER_DEVICE_COMPATIBILITY,
): Readonly<PdfjsViewerDeviceCompatibility> {
  const classified = classifyEnvironment(environment);
  const normalized = normalizeDeviceCompatibilityRules(rules, "compatibility");

  const matching = normalized.filter(rule =>
    SELECTORS.every(
      selector => rule[selector] === undefined || rule[selector] === classified[selector],
    ),
  );

  const maximal = matching.filter(
    candidate => !matching.some(other => ruleRefines(other, candidate)),
  );

  const support = maximal[0]?.nativePrintSupport ?? "unsupported";

  if (maximal.some(rule => rule.nativePrintSupport !== support)) {
    throw new TypeError(
      "PdfjsViewer: matching device compatibility rules have ambiguous nativePrintSupport",
    );
  }

  return Object.freeze({
    ...classified,
    nativePrintSupport: support,
  });
}
