// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

export function demoHost(value = process.env.PDFJS_VIEWER_DEMO_HOST) {
  if (value === undefined) return "127.0.0.1";
  if (typeof value !== "string" || !value)
    throw new TypeError("PDFJS_VIEWER_DEMO_HOST must be a nonempty host");
  if (/\s/.test(value)) throw new TypeError("PDFJS_VIEWER_DEMO_HOST must not contain whitespace");
  if (/[/?#\\]/.test(value))
    throw new TypeError("PDFJS_VIEWER_DEMO_HOST must be a host, not a URL or path");
  return value;
}

export function demoPort(value = process.env.PDFJS_VIEWER_DEMO_PORT) {
  if (value === undefined) return 8047;
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new TypeError("PDFJS_VIEWER_DEMO_PORT must be an integer from 1 to 65535");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new RangeError("PDFJS_VIEWER_DEMO_PORT must be an integer from 1 to 65535");
  return port;
}

export function demoPdfjsVersionPolicy(value = process.env.PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY) {
  if (value === undefined) return "qualified-only";
  if (value !== "qualified-only" && value !== "allow-unqualified") {
    throw new TypeError(
      "PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY must be qualified-only or allow-unqualified",
    );
  }
  return value;
}

export function demoPrintMode(value = process.env.PDFJS_VIEWER_DEMO_PRINT_MODE) {
  if (value === undefined) return "native";
  if (value !== "native" && value !== "browser" && value !== "off") {
    throw new TypeError("PDFJS_VIEWER_DEMO_PRINT_MODE must be native, browser, or off");
  }
  return value;
}

export function demoNativePrintSupport(value = process.env.PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT) {
  if (value === undefined) return null;
  if (value !== "portrait" && value !== "portrait-and-landscape") {
    throw new TypeError(
      "PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT must be portrait or portrait-and-landscape",
    );
  }
  return value;
}
