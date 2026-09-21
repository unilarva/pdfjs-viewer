# Customizing `@unilarva/pdfjs-viewer`

This consumer guide describes UI composition, markup bindings, styling, localization,
and accessibility. Start with the [README quick start](./README.md#quick-start) to create
a runtime and viewer. Loading, public methods, events, and printing options are covered
in [USAGE.md](./USAGE.md).

## Contents

- [Contents](#contents)
- [UI modes](#ui-modes)
  - [Functional text-layer CSS](#functional-text-layer-css)
  - [`default`](#default)
  - [`custom`](#custom)
  - [`headless`](#headless)
- [Generated document content and states](#generated-document-content-and-states)
  - [Package-managed styling states](#package-managed-styling-states)
  - [Generated annotation markup](#generated-annotation-markup)
  - [Zoom-limit feedback](#zoom-limit-feedback)
- [Customize and localize the UI](#customize-and-localize-the-ui)
  - [Default sidebar, outline, thumbnails, attachments, and layers](#default-sidebar-outline-thumbnails-attachments-and-layers)
- [Generated controls and accessibility](#generated-controls-and-accessibility)
  - [Accessibility](#accessibility)
  - [Custom panels and progress](#custom-panels-and-progress)
- [Visual properties](#visual-properties)
- [Print setup UI](#print-setup-ui)

## UI modes

The only UI modes are `"default"`, `"custom"`, and `"headless"`. Omitting `ui` means
`"default"`; there is no automatic UI-discovery mode. The snippets below use the explicit
`runtime` shown in the [README quick start](./README.md#quick-start).

All modes accept `ui.labels` and `ui.formatters`. Only default mode accepts generated-shell
composition (`direction`, `controls`, and `sidebar`); supplying those options in custom or
headless mode is rejected rather than ignored.

### Functional text-layer CSS

PDF.js text layers are semantic DOM whose geometry depends on functional CSS, not merely
visual theming. This CSS is required when document search highlights or text selection are
enabled. Without it, native ranges may still contain the correct text while search and
selection boundaries drift horizontally from the rendered PDF canvas.

Importing `@unilarva/pdfjs-viewer/core.css` supplies functional rendering rules for every
UI mode. `default-ui.css` is a generated aggregate containing `core.css` followed by the
package default UI theme and layout. Do not import `core.css` in addition to `default-ui.css`;
doing so duplicates the same functional stylesheet. Import `core.css` alone for custom/headless
use and `default-ui.css` alone for default use.

Functional rules are scoped beneath the exported `PDFJS_VIEWER_ROOT_ATTRIBUTE`
(`data-pdfjs-viewer-root`). Construction adds this marker to `rootEl`, generated/headless
shells, and directly bound external functional elements, then removes only markers it added.
Preconstructed custom markup may include the marker itself. Native print sheets are the sole
global exception because they transfer to the owning document body; their names are package-prefixed.

Applications that replace `core.css` take responsibility for reproducing its complete
page, text-layer, annotation, XFA, selection, and zoom geometry contract. Custom thumbnail
UIs must also set `--pdf-thumbnail-width`. Extending the
published stylesheet is safer than copying individual rules from it. Do not add
`!important` transform transitions to `.pdf-content` or suppress text selection on an
ancestor of `.pdf-text-layer`; both interfere with viewer interaction.

The viewer owns main page-canvas dimensions and transforms. A settled canvas can be slightly
larger than its fractional `.pdf-page` wrapper because its integer backing store is presented at
the exact render DPR and the wrapper clips blank rounding surplus. Custom CSS must not override
the main canvas's inline `width`, `height`, or `transform`, and must retain the page wrapper's
clipping behavior. Text, search/selection highlights, annotations, forms, and XFA use the exact
fractional wrapper geometry rather than the quantized canvas box. Canvas or memory limits may
intentionally lower render DPR without changing document layout.

### `default`

This is the default when `ui` is omitted. It generates the complete package UI and
requires `default-ui.css`, which includes both the functional viewer surface rules and the
default chrome/theme.

```ts
const viewer = new PdfjsViewer({ rootEl, runtime, ui: "default" });
await viewer.load(pdfUrl);
```

### `custom`

Uses host-provided markup and never generates visible UI. The default stylesheet is
not appropriate for a host-owned shell. Import `core.css` for the document surface,
annotation, zoom, and functional text-layer contract, then provide application CSS for
controls and layout.

```ts
const viewer = new PdfjsViewer({ rootEl, runtime, ui: "custom" });
await viewer.load(pdfUrl);
```

Only the scrollable `.pdf-container` rendering surface is required. All controls
are optional, including previous/next buttons, page number and count,
search, outline, fit, zoom, layout, progress, download, print, and menu elements. A custom
menu uses `.pdf-menu-toggle-btn` and `.pdf-menu-panel` (with an optional
`.pdf-menu-close-btn`). A missing document container produces an actionable constructor
error.

#### Minimal custom UI

Start with just the rendering surface and style it with an explicit height:

```html
<div id="pdf-viewer">
  <div class="pdf-container"></div>
</div>
```

```ts
const rootEl = document.querySelector<HTMLElement>("#pdf-viewer");
if (!rootEl) throw new Error("Missing #pdf-viewer");

const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: "custom",
});
await viewer.load(pdfUrl);
```

Add only the controls the application needs. The viewer discovers the following optional
markup, or the equivalent elements supplied through `uiBindings`:

| Capability                                         | Hook or binding                                                                                                                                                                                    | Required descendants when supplied                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document surface                                   | `.pdf-container` / `container`                                                                                                                                                                     | Required                                                                                                                                                                  |
| Page and zoom controls                             | `.pdf-prev-page-btn`, `.pdf-next-page-btn`, `.pdf-page-number-input`, `.pdf-page-count`, `.pdf-fit-main-btn`, `.pdf-fit-menu-btn`, `.pdf-zoom-slider`, `.pdf-zoom-slider-wrap` / matching bindings | Page number uses `type=number` or `inputmode=numeric`; zoom slider uses `type=range`; optional `zoom.sliderWrap` receives `--pdf-fit-marker-f`                            |
| In-document history                                | `.pdf-navigation-history-back-btn`, `.pdf-navigation-history-forward-btn` / `navigationHistory.back`, `navigationHistory.forward`                                                                  | Optional buttons may be placed anywhere; the viewer owns `disabled` and `aria-disabled`                                                                                   |
| Fullscreen                                         | `.pdf-fullscreen-toggle-btn` / `fullscreen.toggle`                                                                                                                                                 | The viewer owns `disabled`, `aria-disabled`, and `aria-pressed`; active/inactive text remains host-owned in custom UI                                                     |
| Presentation                                       | `.pdf-presentation-toggle-btn`, `.pdf-presentation-controls`, `.pdf-presentation-previous-btn`, `.pdf-presentation-next-btn`, `.pdf-presentation-exit-btn` / matching `presentation` bindings      | The viewer owns availability, pressed state, transient-toolbar semantics, and presentation navigation                                                                     |
| Search                                             | `.pdf-search-toggle-btn`, `.pdf-search-panel` / `search.toggle`, `search.panel`                                                                                                                    | Explicit `search.input`, `search.previous`, `search.next`, `search.count`, and `search.close` descendants use selector fallback                                           |
| Sidebar views                                      | `.pdf-sidebar-toggle-btn`, `.pdf-sidebar`, `.pdf-sidebar-primary-views`, `.pdf-sidebar-more-toggle`, `.pdf-sidebar-more-menu` / matching `sidebar` bindings                                        | `outline.content`, `thumbnails.content`, `attachments.content`, and `layers.content` supply view mounts; `sidebar.close` is optional                                      |
| Menu                                               | `.pdf-menu-toggle-btn`, `.pdf-menu-panel` / `menu.toggle`, `menu.panel`                                                                                                                            | `.pdf-menu-close-btn` is optional inside the panel                                                                                                                        |
| Text selection                                     | `.pdf-text-selection-toggle-btn` / `menu.textSelectionToggle`                                                                                                                                      | Uses `aria-pressed`; may be placed in the menu or elsewhere                                                                                                               |
| Page layout                                        | `.pdf-page-layout-group` / `menu.pageLayout`                                                                                                                                                       | Radios use `data-pdf-page-layout`                                                                                                                                         |
| Fit mode                                           | `.pdf-fit-mode-group` / `menu.fitMode`                                                                                                                                                             | Radios use `data-pdf-fit-mode`                                                                                                                                            |
| Rotation                                           | `.pdf-rotate-counterclockwise-btn`, `.pdf-reset-rotation-btn`, `.pdf-rotate-clockwise-btn` / matching menu bindings                                                                                | None                                                                                                                                                                      |
| Rendering profile                                  | `.pdf-rendering-profile-group` / `menu.renderingProfile`                                                                                                                                           | Radios use `data-pdf-rendering-profile`                                                                                                                                   |
| Original download, filled-document download, print | `.pdf-download-btn`, `.pdf-download-filled-document-btn`, `.pdf-print-btn` / matching bindings                                                                                                     | None                                                                                                                                                                      |
| Document progress                                  | `<progress class="pdf-document-progress">` / `documentProgress`                                                                                                                                    | Must be an `HTMLProgressElement` with an accessible name                                                                                                                  |
| Print setup                                        | `.pdf-print-setup` / `printSetup`                                                                                                                                                                  | A controlled-native dialog requires every `PDFJS_VIEWER_UI_HOOKS.printSetup` descendant; direct descendants belong to the resolved dialog and controls belong to its form |

Selector names are exported as the categorized `PDFJS_VIEWER_UI_HOOKS` object. Custom
integrations may instead pass typed direct references through the current nested
`uiBindings` groups: `navigation`, `navigationHistory`, `fullscreen`, `presentation`, `zoom`, `search`, `menu`, `sidebar`, `outline`, `thumbnails`, `attachments`, `layers`, and `printSetup`,
plus direct `container`, `controlDiscoveryScope`, `download`, `downloadFilledDocument`, `print`, and
`documentProgress` bindings.
Supplied elements take precedence and omitted bindings fall back to selectors. Each fallback
selector must match exactly one element of its documented native type; missing optional hooks
resolve to `null`, while the document container remains required. The optional
`controlDiscoveryScope` scopes ordinary control-selector discovery; otherwise `.pdf-controls`
is used when present, then `rootEl`. The document container, sidebar, download action, and
progress elements use their documented root-level scopes. Search descendants are discovered
inside the search panel and outline descendants inside the sidebar. Page-layout and
rendering-profile radios are discovered inside their bound or selected groups and use
`data-pdf-page-layout` and `data-pdf-rendering-profile`. Direct bindings may point to elements
outside `rootEl`, including controls owned by another component or DOM region:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: "custom",
  uiBindings: {
    container: scrollContainerEl,
    navigation: {
      previous: previousButton,
      next: nextButton,
      pageNumber: pageInput,
      pageCount: pageCountEl,
    },
    print: printButton,
    menu: { textSelectionToggle: selectionButton },
  },
});
await viewer.load(pdfUrl);
```

Direct bindings make component wrappers and separately owned DOM less dependent on package
class names. Only `container` is required, either directly or through `.pdf-container`;
every other binding is optional. Directly bound controls do not need to be descendants of
the menu, toolbar, discovery scope, or `rootEl`. Only generated document surfaces remain
owned below the bound container. Every direct binding must belong to the same
`rootEl.ownerDocument`; cross-document binding graphs are rejected. A viewer rooted in a
same-origin iframe uses that document and its `defaultView` for DOM, focus, observers,
selection, downloads, printing, and global-keyboard routing.

#### Custom UI contract

The viewer owns the state of every supplied or discovered control. Applications provide the
initial semantic markup and styling, while the viewer updates control values, disabled state,
selection state, panel visibility, and relevant ARIA attributes. Do not independently mutate
viewer-managed state in response to the same interaction; observe `viewer.state` and package
events when application state must mirror it.

Search and menu panels use this managed state protocol:

- closed panels have `hidden`, `inert`, `data-open="false"`, and `aria-hidden="true"`;
- open panels omit `hidden` and `inert` and have `data-open="true"` and
  `aria-hidden="false"`;
- their toggle receives matching `aria-expanded`; custom markup should connect it to a
  panel `id` with `aria-controls`.

Custom CSS should treat `[hidden]` as authoritative. `data-open` is available for transitions
and layout effects, but should not be the only rule that makes a closed panel unavailable.
The sidebar similarly publishes `data-open` and `aria-hidden` and is inert while unavailable.

Custom sidebar selectors and view panels use `data-pdf-sidebar-view` with one of
`"outline"`, `"thumbnails"`, `"attachments"`, or `"layers"`:

- buttons in `sidebar.primaryViews` use `aria-pressed`;
- entries in `sidebar.moreMenu` use `role="menuitemradio"` and `aria-checked`;
- the overflow toggle uses `aria-haspopup="menu"` and `aria-expanded`;
- view panels should be labelled regions and use the same `data-pdf-sidebar-view` value.

The viewer owns those selection attributes, availability, keyboard navigation, and view-panel
visibility. Directly bound view mounts may live outside the sidebar shell.

Generated outline `<li>` elements expose `data-title`, `data-depth`, and
`data-has-children="true"` where applicable. Resolved destinations also expose `data-page` and
`data-y-ratio`; filtering publishes `data-hidden="0" | "1"`. These attributes and the stable
descendant classes documented below may be styled or inspected but must not be modified.

Direct bindings are runtime type-checked. In particular, navigation and action controls use
their corresponding `HTMLButtonElement`, `HTMLInputElement`, or `HTMLAnchorElement` types;
`documentProgress` must be an `HTMLProgressElement`; and `printSetup.dialog` must be an
`HTMLDialogElement`. A custom controlled-print dialog must contain every descendant in
`PDFJS_VIEWER_UI_HOOKS.printSetup`, including its form, conditional wrappers, status and
guidance regions, native progress element, close/cancel/source buttons, and submit controls.
Using `renderPdfjsViewerUi({ id: "invoice-viewer", variant: "custom" })` or
`createPdfjsViewerUi({ id: "invoice-viewer", variant: "custom" })` is the simplest way to obtain a complete neutral
shell before applying host styles.

CSS customization has three supported categories:

- `--pdf-ui-*` variables customize the generated default theme, including typography,
  colors, spacing, dimensions, transitions, shadows, and icon masks;
- `--pdf-page-hgap`, `--pdf-page-vgap`, and `--pdf-thumbnail-width` customize page spacing
  and thumbnail presentation;
- stable generated classes and package-managed state classes customize individual surfaces
  and states.

The default theme responds to the viewer element's own size through named container queries;
embedding it in a narrow region works independently of the page viewport. Top-layer dialogs remain
viewport-constrained. Custom UI integrations own their responsive control and sidebar layout.

The viewer writes geometry variables such as `--pdf-page-scale`, `--scale-factor`,
`--user-unit`, and `--total-scale-factor` on page wrappers. Consumers may read them for
scale-aware decoration but must not assign or remove them.

### `headless`

Creates only the scrollable rendering surface. Control the viewer through methods and
events. Import `core.css`; it provides the package's document-surface and functional
text-layer rules without the generated default chrome. A host may instead reproduce that
functional contract deliberately, but `default-ui.css` is unnecessary for headless use:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: "headless",
});
await viewer.load(pdfUrl);

viewer.navigateToPage(4);
viewer.zoomTo(1.5);
viewer.setPageLayout("single");
```

## Generated document content and states

These package-generated page descendants and state tokens apply independently of the selected UI
mode. Consumers may style and inspect them, but the viewer owns their content, geometry, and state.

### Package-managed styling states

Package-managed styling classes that are not discovered as UI bindings are exported as
bare class tokens through `PDFJS_VIEWER_STATE_CLASSES`:

| Class                                                         | Meaning                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `zoomLimitHint` (`.pdf-zoom-limit-hint`)                      | Generated zoom-limit feedback overlay                                     |
| `zoomLimitHintIn` (`.pdf-zoom-limit-hint--in`)                | An attempted zoom exceeded the maximum                                    |
| `zoomLimitHintOut` (`.pdf-zoom-limit-hint--out`)              | An attempted zoom exceeded the minimum                                    |
| `documentProgressVisible` (`.pdf-document-progress--visible`) | The bound document-progress element is visible                            |
| `outlineCurrent` (`.pdf-outline-current`)                     | The currently active outline destination                                  |
| `searchPreparing` (`.pdf-search-count--preparing`)            | A typed search query is waiting for the document text index               |
| `outlinePreparing` (`.pdf-outline--preparing`)                | The table of contents is being prepared                                   |
| `attachmentsPreparing` (`.pdf-attachments--preparing`)        | Embedded-file metadata is being prepared                                  |
| `searchHighlight` (`.pdf-search-highlight`)                   | A generated document-search highlight                                     |
| `searchHighlightCurrent` (`.pdf-search-highlight-current`)    | The active document-search highlight                                      |
| `pinchActive` (`.pdf-pinch-active`)                           | Touch pinch currently owns transient zoom on the bound document container |
| `thumbnailCurrent` (`.pdf-thumbnail-current`)                 | A thumbnail belongs to the current page row                               |
| `thumbnailError` (`.pdf-thumbnail-error`)                     | Thumbnail rendering exhausted its bounded retry                           |

Unlike the selector strings in `PDFJS_VIEWER_UI_HOOKS`, these values do not include a
leading `.` and are suitable for `classList` operations. They are package-owned states:
consumers may style and inspect them but should not mutate them.

Custom integrations can style these classes or render preparation state from
`viewer.state.searchPreparation`, `outlinePreparation`, and `attachmentsPreparation`.

### Generated annotation markup

PDF annotations are generated page descendants rather than controls discovered from consumer
markup. Each presented page can receive a `.pdf-annotation-layer` overlay.
Links receive `.pdf-annotation-link`; form controls receive `.pdf-form-control`; markup, popup triggers, popups, and page-local attachments
receive `.pdf-annotation-markup`, `.pdf-annotation-popup-trigger`, `.pdf-annotation-popup`, and
`.pdf-annotation-file-attachment`. Other descendant classes and nesting are not public hooks.

The layer presents internal/external links, navigation-only named actions, text notes, highlights,
underline/strikeout/squiggle, stamps, free text, ink, popups, and page-local files. Raster
appearances remain part of the page render; annotation DOM supplies interaction and fallback
content. External anchors use `target="_blank" rel="noreferrer noopener"`; destinations and named
navigation route through the viewer, optional-content actions update layer state, and attachment
downloads remain scoped to the active document.
Text fields, checkboxes, radio buttons, combo/list boxes, ordinary safe-link buttons, and supported
pure-XFA controls are interactive when `features.forms.interactive` and `features.forms.xfa`
permit them; signatures remain read-only. Print,
SaveAs, submit/network, rich-media, and scripting actions are removed before PDF.js receives
annotation data. Form reset is available only through the package-owned `resetForms()` API.

The viewer owns these elements and their page-relative geometry. Consumers may style their
visual states but should not move, remove, or mutate them. `core.css` provides the functional
layer geometry; custom integrations can style the stable classes above. Use
`features.annotationLinks` to independently permit internal destinations and external URLs.
Use `features.annotationMarkup` to disable rich read-only markup or independently disable
`popups` and `fileAttachments`. Text-selection mode suppresses only links and popup triggers;
interactive form controls remain usable.

### Zoom-limit feedback

When a pinch or Ctrl/Command-wheel gesture exceeds the configured zoom range, the viewer
creates a non-interactive, `aria-hidden` feedback overlay. `default-ui.css` styles it;
custom and headless integrations can use the exported `zoomLimitHint`, `zoomLimitHintIn`,
and `zoomLimitHintOut` state classes. Reduced-motion preferences are respected.

## Customize and localize the UI

The default UI includes English labels, dynamic text formatters, and CSS-mask SVG
icons. Override only the text your application needs. `direction` is applied to
generated default UI and accepts `"ltr"`, `"rtl"`, or the default `"auto"`:

```ts
const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: {
    mode: "default",
    labels: {
      download: "Save PDF",
      search: "Search in document",
      noOutline: "No contents",
    },
    formatters: {
      searchResultCount: total => `${total} results`,
      searchResultPosition: (current, total) => `${current} of ${total}`,
      zoom: scale => `${Math.round(scale * 100)} percent`,
    },
    direction: "ltr",
  },
});
await viewer.load(pdfUrl);
```

`ui.labels` contains static control, status, empty-state, and annotation-link text.
`ui.formatters` contains text derived from runtime values, so applications can use
locale-aware number formatting and natural word order rather than parsing package
strings. Both groups are completed from English defaults during construction and
validated before the viewer changes the DOM. Custom UIs use their own markup and
direction, but the viewer still uses configured labels and formatters for package-owned
outline, attachment, layer, thumbnail, annotation, print-feedback, search-count, and zoom-value
presentation. Document-information labels and presentation are package-owned only in default mode.

Use `viewer.setUiText({ labels, formatters })` to change package-owned text at runtime.
Each call is a replacement, not a merge: omitted entries immediately revert to the built-in
English defaults. The viewer updates generated package markup and current package-owned
feedback in place; it does not recreate dialogs, alter form values or focus, refetch document
information, restart search/thumbnail/print work, or change application-owned custom markup.
The generated `variant: "custom"` shell remains package-owned when the viewer created it;
independently supplied `ui: "custom"` markup is always host-owned and is not rewritten.
For package-generated controls, semantic labels update the appropriate visible text, `title`,
`aria-label`, and placeholder attributes automatically. Custom-markup consumers retain ownership
of those static attributes and may update them with their own localization system.

`renderPdfjsViewerUi(options)` is also exported for applications that need to render the
package markup before constructing `PdfjsViewer`, for example as part of a server-rendered
response. Its return value is trusted package-generated markup intended for that rendering
pipeline; ordinary browser setup should let `PdfjsViewer` create its UI rather than assigning
the string through `innerHTML`. Its `variant` is `"default"` when omitted and emits
`.pdf-default-ui` for use with `default-ui.css`; `variant: "custom"` emits the neutral
`.pdf-custom-ui` shell for use with `core.css` plus host layout/control CSS. Both variants
expose empty search and menu extension slots through `PDFJS_VIEWER_UI_HOOKS.extensions`.
Both standalone factories require a non-empty, instance-unique `id`; it prefixes generated
IDs and radio names. Constructor-generated default UI supplies its unique `viewerId`
automatically. `createPdfjsViewerUi(options, ownerDocument?)` returns the corresponding `HTMLElement`
without using an HTML parsing sink when explicit browser-side creation is useful.
After generated or server-rendered UI is present, compose host-owned controls with ordinary
DOM operations:

```ts
import { PDFJS_VIEWER_UI_HOOKS, PdfjsViewer } from "@unilarva/pdfjs-viewer";

const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ui: {
    mode: "default",
    controls: { print: false },
  },
});
await viewer.load(pdfUrl);

rootEl.querySelector(PDFJS_VIEWER_UI_HOOKS.extensions.menu)?.append(applicationMenuControl);
```

The renderer accepts composition and labels, not raw HTML. Insert extension content after
rendering. In the default menu, the menu extension slot appears after the primary
close/download/print row and before the text-selection action. The search extension is at
the end of the search panel. Viewer binding discovery ignores extension contents unless a
host explicitly supplies one of those elements as a direct binding.

The published `@unilarva/pdfjs-viewer/default-ui.css`, generated in part from
[`default-ui-theme.css`](https://github.com/unilarva/pdfjs-viewer/blob/main/src/default-ui-theme.css), supports the user's light or dark color
scheme. Its appearance and layout are easily customized by overriding the `--pdf-ui-*`
CSS custom properties on `.pdf-default-ui`, including the `--pdf-ui-icon-*` mask
variables.

The generated document-information action and dialog are included by default and can be
omitted with `ui.controls.documentInformation: false`. The default button text is
`"Document information"`; its heading, field names, loading/error text, boolean values, and
buttons are all members of `ui.labels`. `--pdf-ui-icon-information` customizes its CSS-mask
icon. Both document-information and print-setup dialogs animate quickly on opening and closing;
the default UI theme removes that motion when `prefers-reduced-motion: reduce` is active. Their close
button, acceptance/cancel action, Escape key, and a click on the viewport backdrop dismiss the
modal and restore focus to the opening control or its menu toggle.

### Default sidebar, outline, thumbnails, attachments, and layers

The generated sidebar places outline and thumbnail views in its primary selector and
attachments and layers in an overflow menu. Views that are disabled or unavailable for the
current document are omitted. Configure generated placement with:

```ts
ui: {
  sidebar: {
    primaryViews: ["outline", "thumbnails"], // default
  },
}
```

Enabled views omitted from `primaryViews` are placed in the overflow menu. An empty array places every view
there. Custom UI placement is determined by host markup instead. Use
`behavior.sidebarMode: "overlay" | "persistent" | "auto"` to select dismissal behavior;
`"auto"` derives it from the sidebar's computed positioning. Custom CSS should use
`[hidden]` for basic visibility and may use `data-open="true"` for transitions or layout.
The viewer enables vertical touch panning on the bound sidebar and closes it when a touch swipe
travels at least 60 CSS pixels toward logical inline-start (left in LTR, right in RTL).

#### Sidebar view markup contract

The shell uses `.pdf-sidebar` or `uiBindings.sidebar.container`. View mounts use
`.pdf-outline`, `.pdf-thumbnails`, `.pdf-attachments`, and `.pdf-layers`, or their matching
direct bindings. The outline optionally uses `.pdf-outline-filter` and
`.pdf-outline-filter-input`. All selector constants are available from
`PDFJS_VIEWER_UI_HOOKS`.

Stable generated descendants include:

| View        | Styling hooks                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Outline     | `.pdf-outline-list`, `.pdf-outline-link`, `.pdf-no-outline-text`, `.pdf-outline-current`                                     |
| Thumbnails  | `.pdf-thumbnail-list`, `.pdf-thumbnail`, `.pdf-thumbnail-button`, `.pdf-thumbnail-canvas`, `.pdf-thumbnail-page-number`      |
| Attachments | `.pdf-attachment-list`, `.pdf-attachment`, `.pdf-attachment-name`, `.pdf-attachment-description`, `.pdf-attachment-download` |
| Layers      | `.pdf-layers-tree`, `.pdf-layer-group`, `.pdf-layer-choice`, `.pdf-layers-reset`                                             |

The viewer owns generated descendants and their state attributes. Style and inspect them,
but do not move or mutate them. Use `--pdf-thumbnail-width` and `thumbnails.maxDpr` to
control thumbnail presentation and raster density.

## Generated controls and accessibility

Generated controls are composed under `ui.controls`, which is accepted only in default
mode and rejected in custom and headless modes. All controls default to included,
subject to their underlying capability:

```ts
new PdfjsViewer({
  rootEl,
  runtime,
  ui: {
    mode: "default",
    controls: {
      download: false,
      print: false,
      renderingProfile: false,
    },
  },
});
```

Available switches are `navigation`, `navigationHistory`, `fullscreen`, `presentation`, `fit`, `fitMode`, `rotation`, `search`, `textSelection`,
`outline`, `thumbnails`, `attachments`, `layers`, `outlineFilter`, `menu`, `download`,
`downloadFilledDocument`, `print`, `documentInformation`, `zoom`, `pageLayout`, and `renderingProfile`.
Menu-contained controls require `menu`. Generated history, fullscreen, and presentation toggles share
a two-column compact row immediately before Zoom: the labelled Navigation history fieldset contains
Back/Forward and the labelled View mode fieldset contains Fullscreen/Presentation. Presentation also
generates a transient previous/exit/next toolbar outside the normal controls.
When `features.navigationHistory` is false, `ui.controls.navigationHistory` normalizes off and any
discovered custom history controls are hidden and left unavailable. Other custom UI remains
application-owned and is not rewritten. A shared ancestor is hidden only when both bindings use the
same `.pdf-navigation-history-controls` element; unrelated host fieldsets and containers are never
hidden.

Custom UI can use `uiBindings.fullscreen.toggle` and `uiBindings.presentation.toggle`, `controls`,
`previous`, `next`, and `exit`; the matching selectors are exposed under
`PDFJS_VIEWER_UI_HOOKS.fullscreen` and `.presentation`. Bindings may be outside `rootEl` when they use
the same owner document. In that case root state classes cannot style them, so observe `state` or the
mode events for host visuals. The viewer updates pressed/disabled semantics for all bindings but only
replaces active/inactive labels in package-generated UI.

Functional mode classes are `.pdf-fullscreen`, `.pdf-presentation-mode`, and
`.pdf-presentation-controls-visible`. Import `core.css` for custom/headless row geometry and scroll
suppression. Presentation controls should use opacity and pointer-event transitions while active;
do not apply `hidden`, `visibility: hidden`, or `inert` merely because the inactivity timer elapsed,
because focused controls must remain available to keyboard users. Disable those transitions under
`prefers-reduced-motion: reduce`, as the generated theme does.
Presentation navigation keys intentionally keep this overlay hidden. Pointer holds on the bound
`previous` and `next` buttons are package-owned: after 500 ms they jump to the first and last page,
respectively, and suppress the subsequent synthetic click.

### Accessibility

Accessibility behavior is explicit and works with generated or custom UI:

```ts
new PdfjsViewer({
  rootEl,
  runtime,
  accessibility: {
    documentLabel: "Annual report PDF",
    respectReducedMotion: true,
    restorePanelFocus: true,
  },
});
```

The document viewport receives a `region` role, keyboard focus, and the configured label
unless the host already supplied its own role or label. Generated controls include a
labeled toolbar, search landmark, live search/page-count status, and progress semantics.
Search and menu panels are non-modal toolbar popovers. Their triggers expose `aria-expanded`
and `aria-controls`; panels are hidden and inert while closed, and Escape closes either
panel. An outside pointer closes the menu, so tapping or clicking the PDF dismisses an open
menu. It intentionally does not close the search panel, allowing the user to inspect and
navigate search results while the panel remains available. Opening one toolbar panel closes
the other, and opening an overlay sidebar closes both. Closing restores focus to the opener
by default.

This accessible baseline covers viewer controls, interaction, status, focus, and available
text-layer selection. It does not currently project a tagged PDF's structure tree, semantic
reading order, or structure-only relationships into the document DOM. Applications with a
requirement for fully structured accessible PDF content should evaluate documents and target
assistive technologies against that limitation rather than inferring content conformance from
the accessibility of the viewer chrome.

The viewer owns panel state. Consumers do not need to observe events or update attributes:
opening removes the native `hidden` attribute and `inert`, sets `data-open="true"`, and sets
`aria-hidden="false"`; closing restores `hidden` and `inert`, sets `data-open="false"`, and
sets `aria-hidden="true"`. Custom CSS should treat `[hidden]` as the authoritative hidden
state, for example `.my-panel[hidden] { display: none; }`. `data-open` is available for
optional transitions or other open-state styling, but is not required for basic hiding.

Programmatic smooth scrolling becomes immediate when `prefers-reduced-motion: reduce` matches; set
`respectReducedMotion: false` only when the host intentionally controls motion itself.

### Custom panels and progress

For custom search UI, `.pdf-search-panel` is the discovered panel and
`.pdf-search-toggle-btn` its optional trigger. Inside the panel, `.pdf-search-input` is
required for interactive searching; `.pdf-search-previous-btn`, `.pdf-search-next-btn`,
`.pdf-search-count`, and `.pdf-search-close-btn` are optional enhancements. The equivalent
direct bindings are `uiBindings.search.panel`, `toggle`, `input`, `previous`, `next`,
`count`, and `close`. Selector fallback for descendants is scoped to the discovered or
bound panel. The viewer does not generate missing search descendants. Opening the panel
focuses and selects the input; closing clears the query, matches, visible highlights, and
result count.

For custom menu UI, `.pdf-menu-toggle-btn`, `.pdf-menu-panel`, and
`.pdf-menu-close-btn` are independently discoverable. The menu feature manages only panel
open/close behavior; actions such as fit, print, zoom, page layout, and rendering profile
remain independently discoverable and may be placed outside the menu. Missing menu markup
is not generated. Place an optional `.pdf-menu-close-btn` inside the discovered menu panel.

Close buttons use nested bindings and panel-scoped selector fallback:
`.pdf-search-close-btn` is discovered inside `.pdf-search-panel`, `.pdf-menu-close-btn`
inside `.pdf-menu-panel`, and `.pdf-sidebar-close-btn` inside
`.pdf-sidebar`. All are optional and are wired only when present.

Visual colors are CSS concerns. The package default stylesheet supplies the generated
UI colors, while custom UIs style their own progress, annotation, and search-highlight
elements. Document progress is one native `<progress class="pdf-document-progress">`
element, discovered at the viewer root or supplied directly through
`uiBindings.documentProgress`. The viewer owns its value, visibility, accessible error text,
and `data-phase="load" | "render" | "error"` state. Unknown network totals use native
indeterminate progress. Rendering progress covers the initial visible pages only; ordinary
navigation and zoom rendering do not reopen it.

## Visual properties

CSS custom properties are reserved for visual styling and layout dimensions. They
are resolved from each viewer's `rootEl`, so multiple viewers can be themed
independently. The viewer currently reads `--pdf-page-hgap` and `--pdf-page-vgap`
for page spacing. Each value is the gap when the document reference page's displayed short
edge is 600 CSS pixels. Fit-driven resizing and explicit zoom therefore scale gaps with the
displayed page rather than with document-internal dimensions. A configured zero remains zero.
A nonzero gap is clamped between 1 CSS pixel and sixteen times its configured value, so extreme
zoom cannot make intentional separation disappear or grow without bound. For configured values
below `0.0625px`, the 1-pixel minimum is also the upper bound. Horizontal and vertical gaps share the
same scaling multiplier, so they stop growing together at the upper cap and preserve their configured
proportion whenever the 1-pixel floor is inactive. Generated default UI styling also exposes the
visual variables listed above.

## Print setup UI

For print modes, output options, resource limits, and device compatibility, see
[Printing](./USAGE.md#printing).

Generated UI calls the primary action **Open system print dialog** and the conditional fallback
**Open PDF in browser**. The latter appears only when preparation reduces quality or fails and source
fallback is allowed; it opens the PDF for the browser's own PDF-printing flow rather than opening the
system dialog directly. Guidance consistently calls the OS/browser-owned modal the system print dialog.
Logical portrait output recommends long-edge flipping for duplex printing; logical landscape output
recommends short-edge flipping. When landscape output is rotated for portrait transport, guidance also
asks the user to keep Portrait orientation in the system dialog. Source-page proportions do not change
this job-wide guidance.
Conditional controls directly follow their owners in wrapping rows: Pages with Page range and Sheet
with custom Width, Height, and Unit. More settings contains Pages per sheet with First page side,
Orientation, then Page scaling with Quality. Help text is associated with and displayed below its
relevant control. The print dialog is top-anchored,
grows downward, and becomes internally scrollable at the viewport bound so dynamic feedback does not
recenter existing controls.
In page-range and custom-dimension inputs, Enter confirms the field by removing focus instead of
submitting the form; supporting mobile keyboards receive a Done enter-key hint.

Bind a custom setup dialog with
`uiBindings.printSetup`; controlled-native setup requires its dialog, form, and every print
descendant binding or hook. It uses `.pdf-print-pages`, `.pdf-print-range`, `.pdf-print-range-wrap`, `.pdf-print-layout`, `.pdf-print-side`, `.pdf-print-side-select`,
`.pdf-print-sheet`, `.pdf-print-custom-sheet`, `.pdf-print-sheet-width`, `.pdf-print-sheet-height`, `.pdf-print-sheet-unit`, `.pdf-print-orientation`, `.pdf-print-quality`,
`.pdf-print-more`, `.pdf-print-status`, `.pdf-print-progress`, `.pdf-print-guidance`,
`.pdf-print-fallback-warning`, `.pdf-print-close`, `.pdf-print-cancel`, `.pdf-print-source`,
`.pdf-print-submit`, and `.pdf-print-submit-detail`. Conditional
controls are managed when unavailable. `default-ui.css` provides the generated dialog layout and
theme. Custom integrations import `core.css` and provide all print-dialog layout and styling.
`.pdf-print-progress` must be a native `HTMLProgressElement`. Generated markup labels it
with `ui.labels.printProgress`; custom markup retains a host-supplied accessible name.
`PdfjsViewerFormatters.printSummary` and `printProgress` localize dynamic text. Headless
integrations call `print(options)` and `openPrintSource(options)` directly.
