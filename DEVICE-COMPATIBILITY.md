# Device Compatibility

## Policy Layers

`device-compatibility.ts` owns generic browser/device classification and compatibility rules.
Native printing consumes the `nativePrintSupport` field:

| Value                      | Controlled native behavior                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `"unsupported"`            | Use browser-source fallback.                                                                                     |
| `"portrait"`               | Permit every layout, rotating complete logical landscape sheets counterclockwise into portrait native transport. |
| `"portrait-and-landscape"` | Permit every layout and pass either logical sheet orientation to native transport directly.                      |

This policy never bypasses mechanical requirements. Constructed CSS stylesheets, PDF print
permission, canvas limits, memory limits, PDF.js rendering, and `window.print()` must still work.
Browser-source printing remains available when controlled native printing is unsupported.
Hosts that must not expose the source route can set native-mode `browserFallback: false`; this is an
application distribution policy rather than a compatibility decision or DRM boundary.

The public environment classification exposes four independent policy dimensions:

- `engine`: browser compatibility family (`"chromium"`, `"firefox"`, `"webkit"`, or `"unknown"`)
- `browser`: recognized browser brand
- `platform`: device/platform family (`"desktop"`, `"android"`, `"apple-mobile"`, or `"other-mobile"`)
- `operatingSystem`: OS compatibility family (`"linux"`, `"windows"`, `"macos"`, `"android"`, `"ios"`, or `"other"`)

`engine` is deliberately a **compatibility classification**, not a guarantee about the literal browser
engine executing the page. For example, a browser identified as Chrome belongs to the `"chromium"`
compatibility family for policy matching even on platforms where its underlying runtime engine may
differ. Consumers should use the field for viewer compatibility rules rather than browser-engine
telemetry.

`"apple-mobile"` represents Apple's mobile device/platform family, while `"ios"` is the corresponding
operating-system compatibility family. The classifier recognizes conventional iPhone, iPad, and iPod
user agents and also Macintosh-style iPadOS user agents that retain a `Mobile/<build>` token.
Unrecognized mobile environments remain `"other-mobile"`.

## Default Records

The package exports `PDFJS_VIEWER_DEVICE_COMPATIBILITY` with this baseline:

```ts
[
  { engine: "chromium", nativePrintSupport: "portrait" },
  { engine: "firefox", nativePrintSupport: "portrait" },
  { engine: "webkit", nativePrintSupport: "unsupported" },

  { engine: "chromium", platform: "desktop", nativePrintSupport: "portrait-and-landscape" },
  { engine: "firefox", platform: "desktop", nativePrintSupport: "portrait-and-landscape" },

  { engine: "chromium", platform: "apple-mobile", nativePrintSupport: "unsupported" },
  { engine: "firefox", platform: "apple-mobile", nativePrintSupport: "unsupported" },
  { engine: "webkit", platform: "apple-mobile", nativePrintSupport: "unsupported" },
];
```

Consequently, recognized Chromium and Firefox compatibility families normally receive controlled
printing for every layout through portrait native transport. Desktop Chromium and Firefox may
additionally send landscape media directly. WebKit remains unsupported by default and uses
browser-source fallback when the viewer's print configuration permits it.

Apple mobile devices are explicitly excluded from controlled native printing for every recognized
browser compatibility family and therefore use browser-source fallback. Unknown browser compatibility
families also use source fallback because no engine rule matches them.

Recognized Android and other non-Apple mobile environments retain portrait native transport unless a
more specific package or host rule says otherwise. Logical landscape sheets on those platforms are
rotated into portrait native transport.

## Deterministic Matching

Every rule requires `engine`. Optional `browser`, `platform`, and `operatingSystem` selectors narrow
that compatibility-engine rule. A rule matches when every selector it specifies equals the classified
environment.

Specificity is based on selector containment, not declaration order. A rule overrides another only
when it contains all selectors from the broader rule and adds at least one selector. For example,

```ts
{ engine: "chromium", platform: "android" }
```

overrides

```ts
{
  engine: "chromium";
}
```

on Android.

Likewise,

```ts
{ engine: "webkit", platform: "apple-mobile" }
```

is a deterministic refinement of

```ts
{
  engine: "webkit";
}
```

for Apple mobile devices.

A browser refinement and a platform or operating-system refinement are independent. If independent
rules overlap with different support decisions, their explicit intersection must also be present. For
example, if these rules disagree:

```ts
{ engine: "chromium", browser: "chrome", nativePrintSupport: "portrait" }
{ engine: "chromium", platform: "android", nativePrintSupport: "unsupported" }
```

then their intersection must be defined explicitly:

```ts
{
  engine: "chromium",
  browser: "chrome",
  platform: "android",
  nativePrintSupport: "..."
}
```

Unresolved overlaps, duplicate selector sets, invalid browser/compatibility-engine combinations, and
incoherent mobile platform/OS selectors are rejected during construction.

The following platform and operating-system combinations are treated as coherent mobile families:

```text
platform         operatingSystem
--------------------------------
android          android
apple-mobile     ios
```

A rule selecting `platform: "android"` may therefore only specify `operatingSystem: "android"`, and a
rule selecting `platform: "apple-mobile"` may only specify `operatingSystem: "ios"`. Conversely,
`operatingSystem: "android"` cannot be combined with another explicit platform, and
`operatingSystem: "ios"` cannot be combined with a platform other than `"apple-mobile"`.

`"desktop"` and `"other-mobile"` are broader platform classifications and may be paired with the
non-mobile OS families as appropriate.

Host `deviceCompatibility` records are normalized, detached, and frozen per viewer. An exact host
selector set replaces the corresponding package record; otherwise it adds a refinement. Rules do not
mutate the package baseline or another viewer. `evidenceId` is optional and can point to retained host
audit evidence for a narrower decision.

## Fullscreen and presentation capability

Browser fullscreen is intentionally capability-driven rather than part of the print compatibility
policy. The viewer checks the standard `requestFullscreen`, `exitFullscreen`, `fullscreenEnabled`,
and `fullscreenElement` surfaces at command time. Unsupported or denied fullscreen returns a typed
failure without preventing embedded presentation mode. Presentation itself uses ordinary package
layout and rendering surfaces and therefore remains available when fullscreen is unavailable.

Native fullscreen smoke tests are capability-gated because headless engines, mobile emulation, OS
policy, iframe permissions, and user activation may differ from physical devices. Deterministic
Fullscreen API stubs remain the primary command and lifecycle regression coverage.

## Qualification Procedure

1. Build and pack the exact release candidate with `npm run test:pack`; retain its commit, tarball,
   and SHA-256.
2. Test one exact engine, browser, platform, and operating-system class at a time.
3. Install the packed tarball with the supported `pdfjs-dist` release and run standard and legacy
   display-module smoke checks.
4. Print the required scenarios through the real system print dialog to a physical printer or OS
   print-to-PDF destination.
5. Inspect sheet dimensions, MediaBox, orientation, clipping, page order, spread parity, forms/XFA,
   annotations, and optional-content state as applicable.
6. Record browser, OS, WebView, print service, driver, fixture, package settings, output hashes, and
   deviations under a stable evidence ID.
7. Select `unsupported`, `portrait`, or `portrait-and-landscape` according to the native media
   orientations that passed. Exercise both single and spread composition as content scenarios.
8. Requalify after relevant browser, OS, WebView, print-service/driver, PDF.js, or package changes.

## Required Matrix

| Platform class              | Scenario                                                         | Required observation                                                                                   |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Chromium on each desktop OS | Direct portrait single and direct A4 landscape spread            | MediaBox, parity, values, and clipping match logical geometry.                                         |
| Firefox on each desktop OS  | Direct portrait single and direct A4 landscape spread            | MediaBox, parity, values, and clipping match logical geometry.                                         |
| Android Chrome              | Portrait single and counterclockwise-rotated A4 landscape spread | Native media remains portrait; physical size, orientation, guidance, parity, and clipping are correct. |
| Android Firefox             | Portrait single and counterclockwise-rotated A4 landscape spread | Native media remains portrait; physical size, orientation, guidance, parity, and clipping are correct. |
| Android Chrome and Firefox  | Changed AcroForm and pure-XFA values                             | Controlled output contains current values and contained layout.                                        |

Automated prepared-DOM checks and print preview are valuable regressions tests but do not establish
physical-output correctness by themselves.

## Evidence Record Template

- Evidence ID:
- Date and tester:
- Package commit and packed tarball SHA-256:
- PDF.js version/build (`standard` or `legacy`):
- Proposed compatibility selectors and `nativePrintSupport`:
- Physical device manufacturer/model:
- Exact OS and system WebView/print-service versions:
- Browser name and exact version:
- Printer or print-to-PDF destination and driver/service version:
- Fixture name and SHA-256:
- Package setup selections:
- Native-dialog selections:
- Expected dimensions, orientation, page order, parity, values, and clipping bounds:
- Actual result:
- Output PDF/photo/scan location and SHA-256:
- Pass/fail and deviations:
