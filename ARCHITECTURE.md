# `@unilarva/pdfjs-viewer` Architecture And Maintenance Guide

This guide is the source of truth for module status, ownership boundaries, dependency
direction, lifecycle ordering, and cross-owner procedures in
`@unilarva/pdfjs-viewer`. It is maintainer documentation, not a replacement for the
public API reference. The current boundaries are intentional. Changes must preserve
cohesive ownership, lifecycle safety, and dependency direction as defined below. File
size alone is not a reason to move code.

Consumer documentation starts in [`README.md`](./README.md), with integration and API
details in [`USAGE.md`](./USAGE.md) and UI contracts in
[`CUSTOMIZATION.md`](./CUSTOMIZATION.md). All three ship in the npm package alongside
this guide and [`DEVICE-COMPATIBILITY.md`](./DEVICE-COMPATIBILITY.md), so documentation
links remain available to consumers of an installed release.

Every emitted TypeScript module has module-level TSDoc that states its role in this
architecture and links back here. When a header and this guide disagree,
update the implementation as needed and make this guide authoritative rather than
inventing a second boundary in module prose.

## Contents

- [Module Status And Audience](#module-status-and-audience)
- [Dependency Direction](#dependency-direction)
  - [Extensible Public Contracts](#extensible-public-contracts)
  - [UI And Stylesheet Ownership](#ui-and-stylesheet-ownership)
- [Lifecycle Hierarchy](#lifecycle-hierarchy)
  - [Download](#download)
- [Core Procedures](#core-procedures)
  - [Rendering](#rendering)
  - [Thumbnail Rendering](#thumbnail-rendering)
  - [Layout Reset](#layout-reset)
  - [Search Publication](#search-publication)
  - [Text Presentation And Selection](#text-presentation-and-selection)
  - [Navigation Intent](#navigation-intent)
  - [Forms, Layers, And Printing](#forms-layers-and-printing)
- [Facade Boundary](#facade-boundary)
  - [Current Facade Coordination](#current-facade-coordination)
- [Evolving The Architecture](#evolving-the-architecture)
  - [Complete Owner Checklist](#complete-owner-checklist)
- [Future Design Readiness](#future-design-readiness)
  - [Potential Facade Decomposition](#potential-facade-decomposition)
  - [Future Feature Readiness](#future-feature-readiness)
- [Release And Distribution](#release-and-distribution)
  - [Publication Boundary](#publication-boundary)
  - [Security And Browser Qualification](#security-and-browser-qualification)
  - [Standalone Publication And CI](#standalone-publication-and-ci)
  - [Qualifying A New PDF.js Release](#qualifying-a-new-pdfjs-release)
- [Development And Contributing](#development-and-contributing)
- [Mechanical Guardrails](#mechanical-guardrails)

## Module Status And Audience

The package `exports` map exposes only the package root, `core.css`, `default-ui.css`, and
`package.json`. Consumers import supported runtime values and types from
`@unilarva/pdfjs-viewer`; emitted internal files are not supported subpath APIs.

Consumer-facing source modules contribute package-root API:

| Module                         | Consumer role                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                     | Sole public TypeScript entry point and explicit re-export allowlist.                                                                                                              |
| `pdfjs-viewer.ts`              | Stateful `PdfjsViewer` facade and cross-owner lifecycle coordination.                                                                                                             |
| `pdfjs-viewer-runtime.ts`      | Explicit PDF.js display-module identity, worker ownership, viewer registration, and structured logger contracts.                                                                  |
| `pdfjs-version-policy.ts`      | Frozen exact qualified PDF.js release set and public runtime admission policy.                                                                                                    |
| `default-ui.ts`                | Pure deterministic `renderPdfjsViewerUi` markup rendering plus generated-shell semantic text metadata/refresh ownership; re-exports UI normalization for existing direct imports. |
| `hash-navigation-state.ts`     | `createHashNavigationStateAdapter` for URL-hash persistence.                                                                                                                      |
| `device-compatibility.ts`      | Generic browser/device classification, package defaults, deterministic rule resolution, and public compatibility contracts.                                                       |
| `native-print-capabilities.ts` | Mechanical controlled-print capability checks and native-dialog guidance over resolved device compatibility.                                                                      |
| `pdf-date.ts`                  | Public pure human-readable PDF-date projection that preserves source wall time and timezone offset.                                                                               |
| `print-sheet-planner.ts`       | Canonical `parsePrintPageRanges` implementation plus private print-planning helpers.                                                                                              |
| `viewer-contracts.ts`          | Authoritative public viewer options, state, event, result, UI hook, and styling contracts.                                                                                        |

All other source modules are private implementation details for package maintainers:

| Module                                 | Private responsibility                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document-renderer.ts`                 | Complete active-document raster lifecycle and output ownership.                                                                                                                         |
| `generated-ui-options.ts`              | Immutable generated-UI labels, formatters, controls, validation helpers, and shared UI-text/render-option normalization.                                                                |
| `document-thumbnails.ts`               | Complete demand-driven thumbnail DOM, raster, cache, and presentation ownership.                                                                                                        |
| `thumbnail-render-planner.ts`          | Pure thumbnail candidate ordering, eviction ordering, viewport distance, and raster budgeting.                                                                                          |
| `document-page-usage.ts`               | Document-scoped shared PDF.js page-proxy acquisition and cleanup ownership.                                                                                                             |
| `pdfjs-compatibility.ts`               | Qualified-contract diagnostics, narrow API-shape adapters, workerPort compatibility, and exact render-task mechanics.                                                                   |
| `raster-work-coordinator.ts`           | Primary/background/exclusive raster priority arbitration.                                                                                                                               |
| `print-route.ts`                       | Pure explicit-mode decision boundary shared by setup ownership, UI action, state, and public printing.                                                                                  |
| `render-scheduler.ts`                  | Renderer-internal queue, operation, task, and resource transitions.                                                                                                                     |
| `render-planner.ts`                    | Pure visible-first raster-memory planning.                                                                                                                                              |
| `rendering-profiles.ts`                | Pure profile defaults, validation, merging, and selection.                                                                                                                              |
| `page-layout-engine.ts`                | CSS-space page topology, geometry, surface registry, and exact leases.                                                                                                                  |
| `document-search.ts`                   | Atomic immutable document text index and query model.                                                                                                                                   |
| `document-information.ts`              | Atomic normalized metadata, permissions, identifiers, and document-capability model.                                                                                                    |
| `document-attachments.ts`              | Atomic normalized embedded-file metadata and transient lazy attachment-byte reads.                                                                                                      |
| `document-attachments-presentation.ts` | Attachment-view preparation handoff, safe DOM, download interaction, and reset.                                                                                                         |
| `document-layers.ts`                   | Display-intent optional-content configuration, detached tree, immutable revisions, and atomic mutation ownership.                                                                       |
| `document-layers-presentation.ts`      | Nested accessible layer controls, loading/empty/error/reset state, delegated mutation, and focus retention.                                                                             |
| `document-outline-presentation.ts`     | Outline-view handoff, DOM, filtering, active selection, focus, reveal, scrolling, and reset.                                                                                            |
| `document-form-state.ts`               | Loaded form baselines, logical bindings, storage translation, dirty/revision state, reset, snapshots, and revision-aware export queue.                                                  |
| `document-presentation.ts`             | Separate AcroForm/annotation and pure-XFA page presentation branches, exact output identity, interaction, and teardown.                                                                 |
| `document-xfa-print.ts`                | Immutable pure-XFA print-preparation page, viewport, and value boundary.                                                                                                                |
| `catalog-page-layout.ts`               | Sole pure interpretation of PDF.js catalog PageLayout into viewer topology and print preference.                                                                                        |
| `document-print.ts`                    | Complete document print-job, print-intent render, scratch/encoded resource, cancellation, and invocation-transfer owner.                                                                |
| `native-print-coordinator.ts`          | One window-scoped system print-dialog lease and post-invocation print-root/Blob lifetime owner.                                                                                         |
| `print-permission.ts`                  | Common PDF print-permission interpretation for every print entry point and state.                                                                                                       |
| `xfa-value-snapshot.ts`                | Pure XFA fake-DOM copying, field-default discovery, and job-start structural value snapshots.                                                                                           |
| `document-text-presentation.ts`        | Package adapters around runtime PDF.js `TextLayer`, exact text mappings/highlights, logical selection, containment, and zoom restoration.                                               |
| `document-view.ts`                     | Complete active-document canonical view, layout, and surface owner.                                                                                                                     |
| `viewer-fullscreen.ts`                 | Exact-root standard Fullscreen API capability, command, reconciliation, and listener owner.                                                                                             |
| `presentation-input.ts`                | Presentation-only overlay timing, keyboard, wheel, tap-zone, swipe/fling, and control long-press arbitration.                                                                           |
| `boundary-control-press.ts`            | Shared boundary-button primary-pointer admission, movement cancellation, long-press timing, synthetic-click suppression, and reset ownership.                                           |
| `document-location.ts`                 | Immutable normalized baseline rendered-page locations, validation/equality, and viewer-rotation conversion.                                                                             |
| `document-text-geometry.ts`            | Pure endpoint ordering, page partitioning, and linear rectangle merging.                                                                                                                |
| `text-content-policy.ts`               | Shared PDF.js text-content extraction parameters.                                                                                                                                       |
| `document-navigation.ts`               | Detached outline/destination model, selection, and persistence policy.                                                                                                                  |
| `document-navigation-history.ts`       | Bounded transactional document-local Back/Forward stacks.                                                                                                                               |
| `pdf-destinations.ts`                  | PDF destination normalization and annotation URL safety helpers.                                                                                                                        |
| `text-matching.ts`                     | Shared Unicode-aware matching policy.                                                                                                                                                   |
| `lifecycle-scope.ts`                   | Viewer/document callback, timer, frame, listener, and cleanup lifetime.                                                                                                                 |
| `pointer-scroll.ts`                    | Mouse-drag, fling, and middle-mouse gesture state.                                                                                                                                      |
| `zoom-gesture.ts`                      | Complete transient zoom input-session owner: wheel/WebKit/pointer pinch state, RAF/timer coalescing, anchors, transforms, touch lock, and semantic commit requests.                     |
| `document-progress-feedback.ts`        | Optional native document-progress DOM and transition timer state.                                                                                                                       |
| `viewer-options.ts`                    | Constructor option validation and immutable normalization.                                                                                                                              |
| `viewer-ui-discovery.ts`               | Direct-binding and stable-selector resolution into one DOM contract.                                                                                                                    |
| `viewer-dialog.ts`                     | Shared native-modal backdrop dismissal, opener restoration, and listener lifetime.                                                                                                      |
| `viewer-document-information.ts`       | Generated default-UI document-information handoff, safe DOM projection, stale-result rejection, and reset.                                                                              |
| `viewer-print-setup.ts`                | One generated/custom print-dialog listener lifetime, control normalization, latest-wins preflight, localized feedback, disclosure, cancellation, and cached no-work text refresh owner. |
| `viewer-panels.ts`                     | Sidebar and toolbar-popover state, overlay policy, dismissal, accessibility, focus, and listeners.                                                                                      |

Private modules are emitted because the build is intentionally non-bundled. Emission,
exported declarations inside a private file, or direct source imports in package tests do
not make a module a consumer API. A consumer-facing symbol becomes supported only through
an explicit re-export from `index.ts` and the package `exports` map. Within private modules,
declarations remain exported only when another source module or an intentional architectural
test seam imports them; constructor-local contracts stay file-local.

## Dependency Direction

`PdfjsViewer` is intentionally the facade and cross-owner coordinator. It owns public
lifecycle ordering, generated/custom control integration, cross-owner panel effects,
gesture integration, progress/events, and search presentation state. `DocumentView`
exclusively owns document content and page-surface DOM construction, attachment, canonical
wrapper sizing, and reflow. `DocumentRenderer` exclusively owns committed main-canvas sizing.
Private modules may
provide state owners, controllers, planners, policies, and validation, but they do not
import the facade.

The current owners are:

- `PdfjsViewerRuntime`: the PDF.js display API identity, worker configuration and lease,
  viewer registration, and participation in package-global keyboard routing. One router
  per owning `Window` owns that window's listener and sends each event to the exact runtime
  registration most recently selected by explicit `setActive(true)`; deactivation,
  unregistration, and runtime destruction release only matching ownership. Consumers
  explicitly supply every runtime with a compatible PDF.js display API module, such as
  `pdfjs-dist/legacy/build/pdf.mjs`. That module remains runtime-owned. The facade obtains
  `getDocument()` only through its resolved runtime. A worker lease is compatible only
  when the PDF.js module and worker configuration identities all match, preventing API
  and worker build/version mixing. The first claim stages its lease privately and publishes it
  only after installing PDF.js worker globals succeeds; failed installation restores changed
  globals and terminates any package-created worker. The first successful lease captures prior
  PDF.js worker globals; final release terminates only a package-created worker and restores each
  prior value only while the global still contains the package-installed value, preserving external mutation.
  Every viewer receives an explicit runtime. A package-private `PdfjsViewerRuntimeAccess`
  capability bridge exposes registration and worker checks to the facade without presenting
  the runtime itself as a controller.
- `PdfjsViewer` DOM context: one immutable `rootEl.ownerDocument` and its required
  `defaultView` define constructors, node creation, focus, selection, hit testing, media/DPR,
  timers/frames, observers, downloads, print context, and keyboard routing. Direct bindings
  must belong to that document. Exact mount documents remain the node-creation authority.
- `LifecycleScope`: tracked viewer- or document-lifetime callbacks, listeners, timers,
  animation frames, cancellation, and cleanup registration. The facade assigns work to
  a scope.
- `DocumentRenderer`: the complete active-document raster owner. It owns a renderer
  document ID, profile and effective rendering-activity policy, detached view snapshots,
  planning, queueing,
  renderer-mediated page acquisition and PDF.js `render()`, task/resources, immutable optional-content/
  annotation raster state, exact output identity and annotation-canvas map, atomic canvas commit,
  reuse, invalidation, placeholders, eviction, admission-suspension tokens, readiness, and diagnostics.
  Admission suspensions are viewer-scoped and survive document reset/replacement. Annotation backing
  stores use exact per-canvas owner references across active renders, committed/direct/placeholder
  output, replacement, and settling presentation; a backing store is zeroed only when its final exact
  owner releases it.
- `DocumentPageUsage`: the document-scoped page-proxy usage owner. It admits use before
  `getPage()`, coordinates cached proxy identities shared by rendering, text extraction,
  navigation, annotations, and text presentation, and delays cleanup until every admitted
  user releases. Document close rejects new use and settles after all admitted use ends.
- `DocumentThumbnails`: the complete open-view-only thumbnail owner. It measures CSS-owned
  surface width, acquires pages lazily, owns one background render, zero-backing-store all-page
  placeholders, detached staging-canvas commit,
  synchronously seeded visible/near-visible demand, visible-first and directional preemption,
  admission-aware viewport-distance cache eviction, optional-content/form-appearance bitmap identity,
  lazy retained-canvas refresh, scoped retries, admission-suspension tokens, active-row reveal, and reset.
  It shares page uses and raster arbitration but no main-renderer queue or canvas.
- `RasterWorkCoordinator`: viewer-scoped semantic arbitration. Urgent main-view pressure,
  motion, transient view work, and effective rendering/view inactivity revoke the one background lease; the
  lease remains occupied until PDF.js physically settles. Exclusive acquisition suspends both
  raster owners with exact tokens, revokes background work, awaits all captured physical drains,
  and resumes only those tokens when the exclusive lease is released.
- `pdfjs-compatibility`: the sole qualified PDF.js API-shape boundary. It owns capability
  diagnostics, narrow casts including the 6.3.289 `getMarkInfo()` runtime-Map/generated-type
  mismatch, workerPort access, optional-content cloning, annotation/XFA
  invocation, and policy-free exact render-task cancellation mechanics shared by raster owners.
- `RenderScheduler`: lower-level plan, queue, admission, operation, task, reservation,
  temporary-buffer, cancellation, and settlement machinery used only by
  `DocumentRenderer`. It does not own committed bitmap metadata.
- `PageLayoutEngine`: geometry/topology engine composed privately by `DocumentView`. It owns
  monotonic topology/geometry revisions, canonical viewport reading-position policy,
  and the exact registration-epoch surface registry;
  it is not instantiated or projected by the facade.
- `DocumentSearch`: the complete atomic immutable text index, preparation identity,
  readiness, and indexing error. The facade owns search-panel intent, UI match selection,
  ARIA state, IME behavior, and completion events.
- `DocumentInformation`: the complete lazy metadata and document-information owner. It
  joins concurrent requests, normalizes PDF.js `Map`-based custom information and mark
  information plus `Set`-based permissions, atomically publishes only package-owned data,
  caches one canonical settled document-lifetime result and creates a fresh detached
  projection for every public call. Info-dictionary values, parsed XMP properties, fingerprints,
  explicit permissions, form/signature capabilities, and tagged-PDF flags remain distinct.
  It does not call `getDownloadInfo()`, since reporting byte size must not force a
  range-loaded document to finish downloading.
- `ViewerDocumentInformation`: optional generated default-UI presentation of a detached
  `DocumentInformation` projection. The facade supplies the public query callback; the UI
  owner renders only localized common fields, rejects stale async results, and never acquires
  PDF.js metadata itself. `ViewerDialog` supplies shared native-modal backdrop dismissal and
  focus restoration to this owner and `ViewerPrintSetup`. Custom and headless integrations
  own their information presentation and consume `getDocumentInformation()` directly.
- `DocumentAttachments`: the complete document-level embedded-file model. It joins one
  catalog read, normalizes map keys into opaque document-scoped IDs and safe package-owned
  metadata, and returns detached public projections. Attachment bytes are read only on demand,
  joined per ID while in flight, and never cached after settlement. Uncancellable PDF.js reads
  remain cleanup dependencies after public callers have been cancelled.
- `DocumentAttachmentsPresentation`: the complete attachment-view owner. It owns one
  preparation-to-DOM handoff per document, loading/empty/error/list markup, delegated download
  controls, per-item busy/error state, localized labels, and stale-completion rejection. It emits
  semantic attachment IDs; the facade owns byte-to-Blob conversion and browser activation.
- `DocumentLayers`: the complete display-intent optional-content owner. It acquires the
  active proxy's initial configuration before first render, detaches order and group data,
  records loaded/default and current visibility, and publishes a monotonically
  revised fresh PDF.js configuration with its exact promise. Published configurations are
  never mutated. Atomic requests reject unknown IDs before staging and use PDF.js
  `setVisibility(..., true)` so radio-button groups retain PDF semantics. Same-turn requests
  are latest-wins while inheriting staged choices; replacement synchronously revokes them.
  Acquisition failure is a stable feature-local error: the Layers view becomes unavailable and
  ordinary rendering continues without retaining a previous document's configuration.
- `DocumentLayersPresentation`: the complete optional-content view owner. It renders the
  detached tree as nested fieldsets and checkboxes, delegates one atomic mutation at a time,
  owns loading/empty/error/reset presentation and focus retention, and never accesses PDF.js.
  The facade installs each committed configuration across main raster, thumbnail, and
  annotation owners and then dispatches `pdf:layerschange`.
- `DocumentFormState`: the complete document-scoped form-value owner. It captures visible loaded
  values from the PDF.js field-object `Map` plus initial annotation storage, keeps every widget binding and
  affected page for each logical ID, translates namespaced storage access, owns dirty/storage/page
  revisions, resets to loaded values, and queues uncancellable exports by revision. Equal revisions
  join one save, newer revisions queue one latest save, and every caller receives detached bytes.
  Optional field-index and metadata reads run behind a stable unavailable form facade and never gate
  ordinary document rendering. Their all-started settlement belongs to document teardown; late current
  completion publishes availability or degradation through `DocumentPresentation`. It owns no DOM,
  browser activation, raster work, or print job.
- `DocumentPresentation`: the complete annotation-derived page-presentation owner. It
  acquires annotations only through renderer-admitted exact presentation contexts and uses
  the runtime-injected PDF.js 6.3 `AnnotationLayer` through a narrow package link-service adapter.
  Before PDF.js sees data, an explicit action matrix admits only safe external/internal links,
  navigation-only named actions, atomic optional-content actions, and page-local attachments;
  Print, SaveAs, submit/network, rich media, and scripting are removed. The owner
  admits notes, markup, stamps, free text, ink, popup-parent pairs, and local files according to
  `annotationMarkup`, while raster appearances stay in the page render. It owns exact layer
  instances, safe icon/download URLs, localized fallback labels, focus/open-popup placeholder
  retention, exact surface/raster/map/data/config identity, synchronous destruction, and stale-work
  rejection. Renderer
  presentation currentness governs asynchronous acquisition and publication only; once
  published, durable interaction is admitted by the owner's exact layer, lease, and document
  generation identity rather than by the settled renderer lane. It consumes `DocumentFormState` and emits
  semantic destination/named-navigation intents; the facade executes movement, routes OCG
  transactions to `DocumentLayers`, and supplies lifecycle-tracked attachment reads. For forms it
  retains page DOM, focus pins, cross-page Tab continuation, and visible reset synchronization. Every
  AnnotationLayer-facing widget ID, field name, and field-object ID receives a package-owned
  per-viewer namespace; the adapter removes it before accessing original storage keys. This makes
  PDF.js 6.3's document-global `querySelector`/`getElementsByName` implementation safe without
  patching PDF.js or restricting the application to one form viewer.
- `DocumentTextPresentation`: the complete document-lifetime text-presentation owner. It
  owns package adapters around the runtime-injected PDF.js `TextLayer`, exact lease/page mappings, search and
  page-indexed search/highlight caches, semantic endpoint bookmarks, viewport demand and
  active-match and selection pins, exact toolbar-retention transactions, native-range observation/rollback,
  mouse edge autoscroll, managed-copy completion, bounded zoom recovery, and reset. The
  facade owns public mode state and cross-owner sequencing.
- `DocumentView`: the complete production canonical view owner. It composes
  `PageLayoutEngine` and exclusively owns scale, selected/effective fit mode, fit-active
  state, viewer rotation, page layout, document page count and
  preferred layout, topology, surface DOM, canonical wrapper CSS sizing, renderer reflow/reconciliation,
  detached render snapshots, text viewport demand, motion, and geometry batching as
  semantic transactions. The facade acquires exact reference-row pages through
  `DocumentPageUsage` before committing one latest-wins intent; failed or superseded
  preparation cannot partially mutate canonical mode, scale, or rotation. Facade-owned
  pending rotation intent lets unresolved relative requests accumulate while owner identity
  prevents stale settlement from clearing a newer target.
- `ViewerFullscreen`: the viewer-lifetime, exact-root standard Fullscreen API owner. It derives
  active state only from `document.fullscreenElement`, serializes browser requests toward the latest
  requested state, retains request failures for facade projection, and never exits another
  element's fullscreen session. The facade owns feature admission, public results/events, generated
  and custom control state, and the relationship with document-scoped presentation mode.
- Presentation mode remains facade coordination rather than a second renderer. Entry snapshots the
  canonical `DocumentView` configuration and location, suppresses `ViewerPanels` without discarding
  open/selected state, cancels continuous gestures, requests fullscreen synchronously while user
  activation exists, and commits single-page contain fitting through the existing view transaction.
  Exit preserves the page reached, restores the prior layout/fit/scale and same-page location,
  releases panel suppression and focus, and reconciles rendering/navigation. When fullscreen and
  presentation coexist they form one immersive session, so loss or explicit exit of either exits
  both. Replacement, close, host deactivation, root disconnection, and destroy invalidate stale
  document/mode work before asynchronous Fullscreen API settlement can publish state.
- `PresentationInputController` owns only presentation input and transient overlay mechanics. Its
  viewer-lifetime listeners translate keyboard, wheel, tap-zone, swipe/fling, and overlay-button
  input into semantic step, boundary, and exit callbacks; `setActive(false)` synchronously clears
  timers, pointer state, wheel accumulation, and click suppression. It does not know PDF.js,
  fullscreen, document generations, navigation history, or canonical view geometry. The facade
  remains the owner of those cross-feature transactions and supplies narrow semantic callbacks.
- `DocumentNavigation`: the detached outline, named-destination, resolved-destination
  selection, and persisted navigation-destination model. It returns semantic movement
  intents. `DocumentOutlinePresentation` owns outline-view markup, labels, filtering,
  focus, active reveal, and local scrolling. The facade owns movement execution and
  public preparation events. PDF named destinations, outline destinations, and
  prefix-stripped navigation destination IDs remain distinct concepts.
- `DocumentNavigationHistory`: the private document-local Back/Forward owner. It retains at most
  100 frozen `(page, xRatio, yRatio)` locations supplied by `document-location.ts` in normalized
  baseline rendered-page space neutral to viewer-added rotation. Selection is
  transactional: the facade restores through `DocumentView` before committing stack mutation, so
  unavailable geometry cannot consume a location. It has no dependency on browser history,
  URLs, or `PdfjsViewerNavigationStateAdapter`.
- `DocumentOutlinePresentation`: the complete outline-view owner. It owns one
  preparation-to-DOM handoff identity per document, tree/empty/error markup, filter
  controls and matching, accessible preparation state and its visual-state class,
  item listeners, active classes, transition-aware reveal,
  focus-on-open, local keyboard scrolling, immediate and next-frame user takeover of native
  smooth reveal through an unpainted non-no-op scroll cancellation without retaining host scroll
  styles, and reset. It consumes detached entries and
  emits semantic keys; it neither selects destinations nor moves the document.
- `ViewerPanels`: the complete viewer-lifetime sidebar and toolbar-popover interaction
  owner. It owns selected sidebar view, open state, overlay detection, outside dismissal,
  mutual exclusion, `inert`/ARIA state, focus restoration, host-active visibility,
  primary pressed-button selectors, the secondary-view menu, menu focus and keyboard
  navigation, logical-direction touch-swipe dismissal, dynamically discovered close controls,
  listeners, and selection-retention tokens. It
  emits semantic open/close effects; feature preparation and view content stay outside.
- `PointerScrollController` and `ZoomGestureController`: bounded gesture state machines. `ZoomGestureController` owns transient wheel, WebKit gesture, and touch-pointer pinch session state (including input RAFs and timers), while the facade admits DOM events, coordinates selection/pinch CSS, and performs the sole canonical `DocumentView` commit.
  The facade owns listener lifecycle, native-input arbitration, and cross-feature commit
  sequencing. In text-selection mode, the facade asks `DocumentTextPresentation` whether the
  primary-mouse target is mapped selectable text; mapped text retains native selection, while
  paper and other textless page presentation route to ordinary drag scrolling. WebKit gesture
  events take exclusive ownership when Safari also emits a
  Pointer Events stream for the same pinch; document-level terminal listeners guarantee
  that either stream releases its transient session when event targeting changes.
  Presentation bypasses continuous pointer-scroll ownership: `PresentationInputController`
  accumulates vertically dominant wheel deltas with one-step cooldown and recognizes one bounded
  vertical pointer fling, then routes both through the facade's same immediate discrete-page command
  as keyboard/navigation controls.
- `DocumentProgressFeedback`: optional native document-progress DOM, value interpolation, and timer presentation
  state. The facade chooses operation phase and progress values; unknown network totals use
  the `<progress>` element's indeterminate state rather than an estimated percentage. It
  publishes render progress only until the active renderer document first reaches readiness;
  later same-document rendering is intentionally silent. Print-sheet progress remains a
  separate `ViewerPrintSetup` concern because its exact values and dialog lifetime are distinct.
- Pure planner, policy, matching, destination, option, and validation helpers: values in,
  values/results out; they own no viewer lifecycle or DOM orchestration.

`viewer-contracts.ts` owns public viewer structure. The facade and private owners import those
contracts rather than defining or forwarding them through `pdfjs-viewer.ts`. The sole reverse
reference is type-only: `PdfjsViewerPrintContext.viewer` names the public facade instance supplied
to adapters and emits no runtime dependency.

### Extensible Public Contracts

Four public contracts define stable extension points for capabilities that can grow independently:

- PDF sources accept URL/byte shorthand and discriminated `url`/`data` descriptors.
  Public `load()` input is immediately normalized into one private discriminated
  source model used by state, diagnostics, generated UI, and PDF.js loading. Descriptors expose optional
  filename metadata. The viewer does not retain a second byte copy at load time. Byte-backed
  download asks the active PDF.js proxy for complete data only on demand, then uses a short-lived
  Blob URL; URL-backed download uses the source URL directly.
- Public and private search matches contain ordered source segments. `DocumentSearch` matches
  one concatenated original-text stream per page and maps each result back to exact PDF.js
  text-item UTF-16 ranges for `DocumentTextPresentation` and the detached public projection.
- The `ViewerPanels` sidebar shell (`sidebar.container`, `sidebar.toggle`,
  `sidebar.primaryViews`, `sidebar.moreToggle`, `sidebar.moreMenu`, `sidebar.close`, `.pdf-sidebar`)
  owns open state, active-view identity, overlay policy, focus restoration, and outside
  interaction. Host deactivation hides and inerts both the shell and every managed view,
  primary buttons expose `aria-pressed`, overflow entries expose radio-menu state, and
  all managed view panels remain labelled regions rather than mixing tab and menu semantics.
  including directly bound view elements outside the shell. `DocumentOutlinePresentation` owns only the current `"outline"` view's
  content, filtering, focus, reveal, scrolling, and preparation handoff.
  `DocumentThumbnails` owns the current `"thumbnails"` view, and
  `DocumentAttachmentsPresentation` owns the current `"attachments"` view. Future layer views
  may share the shell only through their own complete owners and view-specific bindings.
- Annotation and document-content policy uses separate `features.annotationLinks`,
  `features.annotationMarkup`, `features.forms`, and `features.layers` categories. `DocumentPresentation`
  keeps annotation/AcroForm and pure-XFA DOM as separate branches. Pure XFA uses only the runtime-injected
  `XfaLayer`; mixed XFA never calls `getXfa()` and uses its AcroForm fallback.

### UI And Stylesheet Ownership

`renderPdfjsViewerUi()` is a pure escaped string renderer. The `"default"` variant emits
the package-themed `.pdf-default-ui` shell; the `"custom"` variant emits neutral
`.pdf-custom-ui` structure for host styling. Browser-generated default markup is viewer-owned.
SSR or otherwise host-rendered markup is host-owned and is hydrated through custom UI mode.
Standalone rendering requires a non-empty instance-unique `id`; constructor generation supplies
the viewer ID internally. Constructor UI options are discriminated: labels/formatters are shared,
while direction/control/sidebar composition belongs only to default mode.
The optional document-information action and dialog are controlled by
`ui.controls.documentInformation` in default mode only. Custom and headless shells do not expose
information bindings or stable information-dialog hooks; they call the facade's detached metadata
query and own markup, translation, formatting, and lifecycle. Generated UI therefore remains
downstream of and optional to the metadata model and public API.
Document loading and first rendering use one optional native `.pdf-document-progress`
element. Print preparation uses a separate native `.pdf-print-progress` element owned by
`ViewerPrintSetup`; the two indicators share semantic markup but not lifecycle state.
Preparation indicators require no package-owned spinner elements: owners publish exported
state classes on existing bound presentation elements. `default-ui.css` supplies pulsing-circle
presentation, while custom consumers may replace or omit it without changing bindings.

Custom interactive elements resolve through `viewer-ui-discovery.ts`: typed direct bindings take
precedence, then stable categorized selectors provide fallback. Every singular fallback must
match exactly one element of its required native interface; absent optional hooks resolve to
`null`, and the container is the sole required discovery hook. Directly bound controls may
live outside their panel, the control discovery scope, or `rootEl`; generated document
surfaces remain descendants of the bound container. Print descendants always resolve within the
print dialog and its form. A direct print descendant requires and must be contained by the resolved dialog; the
controlled-native setup owner receives the complete resolved print schema and never re-queries
host markup. `.pdf-search-extension` and
`.pdf-menu-extension`, also marked by `data-pdfjs-viewer-extension`, are host-owned insertion
slots in generated markup. They are not discovered viewer bindings, and the pure renderer
does not accept raw HTML. The default menu places its menu slot after primary actions and
before the Text Selection action.

`core.css` is the functional viewer-surface contract: page geometry, annotations, XFA, text layers,
selection/search overlays, pinch behavior, sidebar-panel hidden state, thumbnail-canvas sizing,
pointer-scroll cursors, native print-output sheets, and custom/headless surface rules. It marks PDF.js-adapted
renderer sections separately from package-specific functional sections. It intentionally contains
no generated control, sidebar-content chrome, dialog layout, theme, backdrop, or motion rules. Custom
thumbnail UI must define `--pdf-thumbnail-width`. The build generates `default-ui.css` by appending the
`default-ui-theme.css` source fragment to `core.css`, aggregating those functional rules with the
default UI layout and theme. A custom
consumer imports `core.css` and owns control styling; importing `default-ui.css` opts into the
package theme. It is one aggregate output, so default consumers import `default-ui.css` alone;
custom/headless consumers import `core.css` alone. The neutral custom shell is intentionally outside
default-theme selectors.
The functional content geometry includes one zoom-relative leading row gap and the existing trailing
row gap. Initial layout and page-one navigation target the measured first-row top, keeping page 1
flush with the scrollport; only explicit upward scrolling reveals the leading space. The leading
inset remains part of measured DOM geometry so zoom, destinations, current-page selection, custom
CSS, and render planning do not need parallel offset rules.

`PageLayoutEngine` normalizes configured horizontal and vertical gaps against a named 600-CSS-pixel
reference-page short edge. Current canonical scale and the stable document base-page dimensions
therefore determine gap geometry without mutable Fit history: documents with different intrinsic
units but the same displayed reference-page size receive the same gaps, and both Fit-driven resizing
and explicit zoom scale them. Zero remains zero; nonzero results are bounded to 1 CSS pixel through
the greater of 1 CSS pixel and sixteen times the configured value. The engine uses the same resolved
values for DOM gaps, row bounds, overflow, visibility, Fit, and automatic spread eligibility. Both
axes use one shared multiplier, so reaching the upper bound caps them together and, outside the
intentional 1-pixel floor, preserves their configured proportion.
The default shell names its size container `pdfjs-viewer`; toolbar, sidebar, and popover behavior
responds to the embedded viewer's dimensions rather than the page viewport. Short/narrow menus stay
absolutely positioned inside that container. Top-layer dialog outer bounds remain viewport-based,
while dialog descendants query the `pdfjs-dialog` inline-size container. Custom UI consumers own
their responsive shell and receive none of these theme breakpoints from `core.css`.

Package-owned outer selectors use the hyphenated `.pdf-*` namespace; PDF.js does not use those
exact class names. Adapted renderer sections nevertheless retain descendant classes that PDF.js
itself emits, including text-layer `.markedContent`/`.endOfContent`, annotation subtype/content
classes, and `.xfa*` structure. Those descendant names are an engine integration contract, not
package naming: every supported PDF.js version qualification or upgrade must compare its generated
DOM and `pdf_viewer.css` against these selectors and update the adapted subset together.
`PDFJS_CSS_COMPATIBILITY_MANIFEST` makes a deliberately small part of that review mechanical: it
parses the candidate stylesheet, checks required upstream declarations and their translated local
counterparts, and checks emitted-class sentinels in the exact standard or legacy runtime module.
Conditional declarations cannot satisfy base requirements. The manifest is not a stylesheet
equality test and sentinel strings are not DOM-shape proof, so real browser fixtures remain the
authority for geometry, hit testing, form controls, rotation, forced colors, and XFA display/print.
Intentional differences include package-prefixed roots, package-owned selection/search overlays,
targeted annotation interaction policy, the form-field background replacement, and omission of
unsupported editor/media/highlight rules. Each adapted-rule change requires an explicit manifest
rationale and behavioral review. The adapted subset retains the upstream `.xfaTb > div`
table-cell alignment in both display and native-print subsets.

Every functional selector is bounded by `data-pdfjs-viewer-root`, which the facade adds to its
root, owned shells, and external bound functional surfaces without removing host-preexisting
markers. Only package-namespaced native-print roots/sheets remain global because their ownership
is transferred to the document body for native printing. Package keyframes are namespaced.

Automatic two-up eligibility is an internal `DocumentView`/`PageLayoutEngine` decision for
`pageLayout: "auto"`, based on PDF preference and current geometry. There is no separate public
`behavior.autoTwoPage` option.

`ARCHITECTURE.md` ships with the package so maintainers can inspect the exact release's boundaries.
Public symbol semantics remain documented on their package-root exports. The package also ships
every runtime module and transitive declaration needed by the non-bundled graph, plus JavaScript
source maps with embedded source content for debugging. Declaration maps are omitted because their
TypeScript source targets are not published.

## Lifecycle Hierarchy

The hierarchy is viewer lifetime, load-request identity, document lifetime, then
render-operation lifetime:

1. **Viewer lifetime** starts at construction and ends at `destroy()`. It owns permanent
   UI, listeners/observers, runtime registration, and viewer-scoped callbacks. Construction
   first completes validation and duplicate-ID/runtime preflight without mutation, then tracks
   each setup acquisition transactionally. Failure removes only package-owned UI/markers,
   cancels installed listeners, disconnects observers, releases initialized owners once,
   unregisters keyboard ownership, and detaches only a claimed runtime. Construction is always
   document-free and produces the same `closed` state as `close()`.
2. **Load request** begins only through explicit `load()`, uses a monotonically changing request
   identity, and owns one exactly-once public result. The latest request wins; an older load cannot
   publish a proxy, state, or error into its successor and settles as cancelled with a precise cause.
3. **Document lifetime** begins for each admitted document and ends on close,
   replacement, or destruction. It owns document callbacks, preparation, interaction,
   layout, search/navigation models, and document-relative scheduled work.
4. **Render-document and operation lifetime** is nested in one document and owned by
   `DocumentRenderer`. The scheduler owns operation slots underneath it. Immutable
   document, result, execution, and surface identity follow work through settlement.

Observable facade state is a detached snapshot rather than a mirror of private owners.
The facade composes canonical view state, host activity, document capabilities, and
search/outline/attachment preparation status, compares complete snapshots, and emits
`pdf:statechange` only for a real observable change. Preparation completion events retain
counts and errors; current preparation phase belongs in state so late subscribers do not
need to reconstruct it from event history.

Nested values are immutable and value-stable: print state is reused until a scalar changes and
profile arrays are detached/frozen, so shallow publication cannot emit identity-only changes.
Renderer readiness is the sole public milestone. The facade remains loading until the immutable
initial visible cohort succeeds, changes status before `pdf:ready`, then flushes eager preparation
events and starts ready-gated work. The successful load result settles after those synchronous
notifications. Initial-cohort or setup failure first detaches the proxy and document owners, then
changes status before one `pdf:error` and settles the error result. Expected cancellation emits no
ready/error event and can settle before physically uncancellable PDF.js cleanup. Stale
replacement/close/destroy callbacks publish nothing.
Renderer callbacks wake a private document-identity waiter; public DOM events are output-only and
cannot advance lifecycle state when redispatched by a consumer. Close finalization is also guarded
by load-request identity so a newer explicit load wins over an older teardown settlement.

Localization is immutable construction input normalized before stateful setup. The private
`generated-ui-options.ts` owner resolves static package-authored text into the completed label
set and runtime-derived search and zoom text into completed formatter callbacks. Generated
markup alone owns its `dir` attribute, while both generated and custom UI presentation use the
same normalized labels and formatters. This keeps locale policy out of document/search/layout
owners.

Replacement and teardown follow this order:

1. Invalidate request/document callbacks and call `DocumentRenderer.resetDocument()`
   first. It invalidates renderer ownership before cancellation callbacks.
2. Detach canonical document state and reset search, navigation, progress, layout, and
   DOM surfaces.
3. Start required loading-task destruction, then settle cancelled rendering/preparation, including
   uncancellable metadata and optional form reads, on-demand document-data reads, and PDF.js
   `PDFDocumentProxy.saveDocument()`. Final proxy cleanup waits for both loading-task destruction
   and every captured settlement.
4. Do not block a successor on old render, preparation, or proxy cleanup when ownership
   has already been invalidated. Await loading-task destruction only where PDF.js load
   replacement requires it.

Every stale completion must fail its current identity check before mutation. Cleanup is
idempotent and cannot restore ownership.

### Download

Original URL-backed download uses the normalized source URL and requires no document-data read or
package-owned byte retention. Its anchor uses a new-tab fallback so cross-origin responses
that ignore `download` cannot navigate the host application. Byte-backed download is a
facade-owned public/UI operation.
The facade's shared data-read lane calls `PDFDocumentProxy.getData()` only after public byte access,
download, source-print, or print-adapter demand, joins concurrent consumers, and clears its read
record on settlement. `getDocumentData()` selects `original` or `with-form-values` and returns a
detached array to every successful caller. `download()` selects the same document variant and adds
only browser activation plus optional filename policy.
Each consumer independently validates document generation after the uncancellable read. A
stale download cannot create a Blob or activate a link; an invalidated print-adapter accessor
rejects with `AbortError`. Close, replacement, and destruction let public operations settle
promptly but retain the underlying read as a cleanup settlement, preventing old-proxy cleanup
from racing PDF.js. Successful byte download creates one `application/pdf` Blob, activates a
temporary anchor with the descriptor filename or `document.pdf`, and revokes the object URL
in the next task. The print adapter receives bytes, not a package-owned generated URL, so it
owns any print-specific Blob or native resource lifetime. No Blob or extracted-byte cache
survives for the document lifetime; complete PDF data and Blob storage may coexist briefly
during a requested operation. Close and destruction clear download attributes from preserved
custom controls as well as package-owned UI so native behavior cannot outlive viewer state.

The filled-document UI action calls `download({ document: "with-form-values" })` rather than owning
a separate serialization API. `DocumentFormState` supplies revision-correct bytes; the facade owns
the default `-filled.pdf` filename, busy state, generation checks, Blob/anchor activation, and
revocation. Activation never changes the loaded baseline or clears dirty state. Generated UI shows
this action for supported forms and enables it only while the form is dirty; documents without
supported forms do not expose the generated action.

Attachment download follows the same facade-owned browser boundary but uses the attachment
model's safe filename and `application/octet-stream`. Catalog metadata is prepared separately
and contains no retained bytes. One selected attachment is read lazily; generation checks run
before Blob creation and activation, and the URL is revoked in the next task. The viewer never
previews embedded HTML, SVG, PDFs, executables, or other arbitrary content.

## Core Procedures

### Rendering

#### Render Planning And Admission

`render-planner.ts` is the pure policy boundary between current document/view facts and executable
raster demand. Every profile uses this same planner with different limits. It protects mandatory
visible and initial-readiness output first, admits complete nearby rows within cumulative distance,
page-count, canvas, and memory constraints, and considers retention of old off-window output last.
Consequently, disposable old canvases are evicted before new output allocation or DPR reduction.

Page layout deliberately keeps fractional CSS geometry. Exact scaled PDF dimensions preserve
continuous zoom, fit and spread calculations, scroll anchors, and alignment among canvas, text,
annotation, form, and XFA layers without accumulating per-page rounding drift. Only raster backing
stores are quantized to integer pixels. Raster quantization never changes canonical layout geometry
or feeds an integer axis ratio back into the requested quality target.

The plan uses exact integer backing dimensions and stable uniform render DPRs, models settled and
temporary replacement stores at their actual overlapping lifetimes, and reduces concurrency before
allowing direct visible rendering. Queue admission remains separate from policy: the scheduler renders
visible work first, favors the leading edge while scrolling, returns to center-out order when
stationary, and may preempt only speculative work. `PdfjsViewerRenderingProfileSettings` TSDoc is the
authoritative consumer-facing sequence for deciding which profile limits to configure; the lifecycle
below records the implementing owners and revalidation boundaries.

#### Rendering And Presentation Lifecycle

1. `DocumentView` supplies dynamic view facts plus layout-owned topology and page-geometry
   revisions, measured row bounds, and scrollport geometry. `PageLayoutEngine` measures row tops
   and heights together and reuses immutable bounds until either metric changes. `DocumentView`
   observes its owned content size and coalesces custom-CSS or intrinsic row-size changes into a
   fresh measurement and reconciliation. Container resize handling updates overflow, measures rows,
   and publishes rendering demand as one owner transaction before the facade refreshes UI state.
   `DocumentView` caches its detached rotated page-size map by geometry revision and viewer rotation,
   while `PageLayoutEngine` caches horizontal envelopes by topology, geometry, page scale, rotation,
   and scrollport width. The renderer additionally detaches rows and its page-to-row index
   by topology revision, so a quarter turn cannot reuse stale width/height caches and scroll-only
   reconciliation performs no repeated whole-document geometry cloning or scanning. It combines
   the snapshot with profile, effective rendering activity, placeholder, and
   committed-output facts and calls the pure planner.
   Scroll reconciliation also carries `forward`, `backward`, or `stationary` motion.
   Vertical movement keeps direction active for 120 ms after its latest sample; idle
   expiry republishes the same viewport as stationary without repainting sufficient output.
2. The planner exclusively selects each desired page's DPR and temporary- versus
   attached-canvas execution strategy. Its peak estimate models the two real replacement
   phases: old attached plus temporary output while PDF.js renders, then target attached
   plus temporary output during synchronous copy. Old and target attached stores are not
   double-counted as simultaneously live on the same surface. One shared raster-dimension resolver
   converts CSS geometry and target DPR into exact integer backing dimensions for planning,
   reservation, and execution. Near-integer products are normalized to PDF.js-compatible float
   precision before rounding so insignificant arithmetic residue cannot allocate a whole extra row
   or column. Unconstrained dimensions round upward so fractional page edges remain covered while
   preserving the requested uniform render DPR; hard canvas limits lower that scalar DPR and round
   constrained output downward. The scalar render DPR is the planning, rendering, diagnostics, and
   reuse identity. Integer coverage is a backing-store fact only and is never resolved again as a
   later quality target. PDF.js receives the same uniform X/Y transform in temporary and direct
   paths, preventing quantization from stretching page content. Retained placeholders remain charged
   alongside the full temporary raster that replaces them. The scheduler installs the immutable
   plan and admits operation requirements. The renderer captures the renderer document ID, exact
   surface lease, and immutable main raster state. The facade installs main and thumbnail state as
   one admission-suspended transaction, giving future layer/form owners one atomic handoff.
   `maxBufferViewportHeights` is one total CSS-distance budget measured against the current
   scrollport height. Stationary allocation is balanced, moving allocation gives two thirds to the
   leading side, and true document-edge shortages are redistributed. Complete rows intersecting
   each interval are selected atomically, so a boundary row may extend effective coverage.
   `maxBufferPages` is an independent strict ceiling on optional desired pages; a row that cannot
   fit in the remaining allowance is not split. Page-count or memory rejection stops farther rows
   on that side rather than creating a hole, while the opposite side may continue if it fits.
   Distance, optional-page, canvas-safety, and viewer-managed memory constraints are cumulative;
   relaxing one never bypasses another. Optional and retained output cannot exceed the planner's
   hysteresis-adjusted memory growth limit. Mandatory visible and initial-readiness pages are outside
   the optional page ceiling. Mandatory visible and initial-readiness output is also the sole
   memory-limit exception: required output is preserved instead of leaving the viewport blank or
   reporting false readiness. Motion orders
   visible queue work leading-edge-first;
   stationary work remains center-out. Equal-distance preemption victims come from the trailing
   side first while moving, and no current visible operation is eligible. Existing output beyond
   desired rows stays independently eligible for memory-based retention.
3. After `getPage()`, actual geometry observation and every diagnostic callback, the
   renderer revalidates document, operation, raster-content revision, requirement, and lease identity.
4. Temporary rendering preserves prior pixels and commits copy plus output identity in
   one synchronous transition. Direct rendering records the exact producing operation as
   `direct-mutating` before resize. Its attached surface remains exclusively locked through
   physical settlement, so cancelled PDF.js work cannot overlap or clear a replacement.
   `DocumentRenderer` owns the main canvas's presentation dimensions whenever direct-mutating
   or committed output exists. It displays the backing store at `bufferWidth / renderDpr` by
   `bufferHeight / renderDpr`, aligned to the wrapper's top-left corner. Any integer-coverage
   surplus remains blank and is clipped by the exact fractional wrapper; float-normalized residue
   below CSS precision does not trigger a whole-bitmap resize. PDF content is never stretched,
   and constrained geometry lowers render DPR after its final integer fit so it cannot crop.
   `DocumentView` never rewrites those committed dimensions. Empty output and old-scale placeholders use `100%`
   dimensions because placeholder interpolation is intentionally transient.
   Both paths pass the same explicit display intent, injected `AnnotationMode.ENABLE_FORMS` when
   interactive AcroForms are enabled (otherwise `ENABLE`), optional-
   content configuration promise, and one per-output `annotationCanvasMap`. Commit transfers that
   exact map and raster state to presentation. A renderer-owned reference ledger counts unique map
   canvases in committed, direct-mutating, placeholder, replacement, active, and settling memory;
   immutable output-record replacement transfers ownership before release, and presentation retains
   its own reference so reset or a newer output cannot clear a backing store still in use.
5. Bitmap commit publishes PDF.js scale, user-unit, total-scale, rounding, and normalized
   rotation variables on the exact wrapper. Text, search/selection highlights, annotations,
   forms, and XFA remain in that fractional wrapper/viewport coordinate system and never inherit
   quantized canvas-box geometry. Raster scheduler admission is then released.
   A per-page single-flight presentation lane merges compatible annotation/text
   capabilities without invalidating active work. Annotation and text currentness are
   checked independently after every await; only incompatible output, scale, lease, or
   document replacement is latest-wins. Per-page text-demand revisions distinguish
   withdrawn then renewed demand from stale active text work. One page use spans the complete lane, so
   `DocumentPageUsage` retains cleanup ownership until all admitted capabilities settle. The
   facade starts annotation and text owners independently and joins them with `allSettled`, so a
   blocked annotation acquisition cannot prevent text from starting and an early failure cannot
   release shared page use while its sibling still consumes it.
   Presentation-lane currentness expires at settlement and is not a lifetime token for
   interaction with published annotation DOM; `DocumentPresentation` validates those
   interactions against its still-owned exact layer and surface lease.
   Annotation presentation clones the canvas viewport with `{ dontFlip: true }`, resolves the
   exact optional-content promise, and gives PDF.js the committed output's exact
   `annotationCanvasMap`. `AnnotationLayer.update()` is used only when the document, page,
   surface, source annotation-array identity, map, raster state/configuration, and package policy
   are all unchanged. Every other presentation constructs a replacement and destroys the prior
   instance exactly once after the replacement is ready; reset and exact eviction also destroy
   constructed in-flight instances synchronously. OCG revision changes rebuild against the exact
   immutable configuration; viewport-only changes update in place. Popup parents are admitted
   only with an admitted popup, and focus/open-popup state may retain transient placeholders.
   Form controls are retained through viewport-only updates and focused output eviction; blur
   releases a pending pin. Form edits do not cancel or reinstall main raster state. Coalesced
   affected-page changes invalidate only stale thumbnails. Thumbnails compare page-local form revisions, create one frozen
   `annotationStorage.print` snapshot per admitted job, and render with `ENABLE_STORAGE` plus
   explicit `printAnnotationStorage`.
   Renderer reset returns pre-task render and presentation settlements. Facade coordination
   between `DocumentPresentation` and `DocumentTextPresentation` isolates annotation and
   text failures: malformed annotation data cannot suppress admitted
   text work, and stale text failures emit neither diagnostics nor retry mutation.
6. Scheduler cancellation immediately revokes commit authority but retains acquisition,
   task, reservation, temporary-buffer, concurrency, and direct-surface ownership until
   the exact operation physically settles. Desired work removed for neither success nor a
   terminal failure is rebuilt from the current immutable plan. Current raster failures
   receive bounded automatic retries; terminal failures remain explicit and emit structured
   diagnostics instead of disappearing from the queue. Terminal failure in the initial
   readiness cohort publishes the facade's normal error state/event rather than false readiness.
   When visible work waits behind
   admitted buffered work, the farthest non-visible authoritative operation is preempted;
   its resources remain charged until settlement and the visible page receives the next slot.
   Settling temporary buffers do not lower canonical planned quality. If a canonical plan plus
   those physically live buffers would exceed the memory limit, admission waits for settlement
   and resumes from the same plan. This prevents temporary cancellation pressure from producing
   a reduced bitmap that is immediately replaced at higher DPR.
7. Reuse requires renderer document, page, semantic raster identity, scale, epsilon-sufficient DPR, exact backing
   dimensions, current connected lease, and `committed` state. Preserving reflow reasserts the
   renderer-owned canvas presentation dimensions on the rebound exact lease. Execution strategy
   is not result identity. Equivalent plans and lower requirements do not repaint.
8. Old-scale zoom output is explicit `placeholder` state. Its bytes consume fixed planner
   headroom but cannot satisfy plans/readiness; grace expiry evicts it without scrolling.
9. The facade presents rendering progress only for a stable cohort containing the pages
   visible in the renderer document's first valid plan. Buffered pages do not delay readiness,
   and viewport or profile changes cannot replace or enlarge that cohort. Subsequent same-document
   plans caused by navigation, zoom, layout, resize, profile, or DPR changes do not reopen
   progress UI.
10. The facade derives effective rendering activity from host activity and, by default, the
    owning `Document`'s Page Visibility state. Host inactivity and a hidden owner document both
    apply the active profile's inactive buffer, disable committed offscreen retention, cancel
    undesired main work, and revoke background thumbnail admission. Visible rows remain mandatory.
    Document visibility is a viewer-lifetime input only: it does not mutate host activity,
    presentation, global-keyboard routing, navigation-state ownership, or observable facade state.
    The immutable `behavior.reduceRenderingWhenDocumentHidden` option can remove document
    visibility from this conjunction for consumers that intentionally warm hidden documents.

### Thumbnail Rendering

1. `DocumentThumbnails` creates one page item and attached zero-backing-store canvas for every
   page. CSS owns each canvas's presentation width and the fallback or observed aspect ratio,
   so the complete list is scrollable without eager page acquisition or full-document raster
   allocation. Positive rendered content-box measurements define raster identity; hidden panels
   remain unmeasurable and do not admit work.
2. The owner maintains separate near-visible and exact-visible demand. Opening the view seeds
   both synchronously, while intersection observation maintains them as the panel scrolls. The
   internal `THUMBNAIL_PREFETCH_VIEWPORTS` policy extends near-visible demand by three panel
   heights above and below the viewport and also drives the no-observer geometry fallback.
   Missing visible output preempts non-visible thumbnail work. During thumbnail motion, visible
   candidates are leading-edge-first and remaining near-visible work prefers the forward side;
   motion becomes stationary 120 ms after the latest scroll sample. Work sufficiently far behind
   current motion may be revoked.
3. `RasterWorkCoordinator` admits only one thumbnail background lease. Main-document vertical
   motion, any active primary raster work, transient view work, host/view inactivity, or acquired
   exclusive work revokes that lease. While thumbnails are visible, `DocumentRenderer` suppresses
   new speculative buffering so the background lane can make progress after required visible work
   settles without overlapping PDF.js page rendering. Closing the view restores profile buffering.
   Revocation removes commit authority immediately but retains the lease, page use, temporary
   bytes, and exact PDF.js task until physical settlement.
4. Before admission, completed canvases are evicted to make room for requested quality. The
   profile's independent `thumbnailMemoryLimitMiB` cap accounts for active and committed thumbnail
   backing stores. Eviction prefers output farthest from the panel viewport, then least recently
   needed. Only when one raster cannot fit after eviction may memory lower its DPR; canvas area,
   the thumbnail-specific 384-pixel backing-dimension ceiling, profile canvas limits, device DPR,
   and `thumbnails.maxDpr` remain independent constraints.
5. PDF.js renders into a detached staging canvas. A successful current operation replaces the
   attached placeholder atomically and transfers the same byte identity into the cache. CSS-size
   changes retain the last committed bitmap until replacement, with both old and staging bytes
   counted at peak; admission may evict the retained bitmap when its budget requires that space.
   Failed, stale, or cancelled staging canvases never enter the DOM and are cleared only after
   settlement. Eviction returns an attached canvas to a zero-backing-store placeholder without
   changing list topology.
   Operations capture optional-content and page-local form-appearance revisions and pass explicit display
   intent, annotation mode, and optional-content configuration. Revision changes immediately revoke
   stale commit authority but leave ready canvases attached as non-satisfying lazy-refresh output.
   Form changes invalidate only their affected pages; unrelated ready thumbnails retain current
   identity and active main-document raster work is not cancelled. Attempts and terminal state
   restart in the new revision scope.
6. The canonical viewport reading position's row supplies highlighted pages. Opening the thumbnail
   view or changing that row starts an automatic reveal generation; exact active-page geometry may retry it after
   layout. Pointer, wheel, touch, keyboard, or scrollbar intent transfers ownership to manual
   panel scrolling and cancels later geometry retries until a new row or view opening starts a new
   reveal generation. When the complete highlighted spread fits, reveal uses the minimum scroll
   adjustment that exposes every page. Opening and host reactivation position the row immediately;
   changed document selection while the view remains visible uses smooth scrolling unless the
   viewer's reduced-motion policy resolves it to immediate scrolling. Geometry retries retain the
   reveal generation's originating behavior.

### Layout Reset

`resetDocument()` removes all document-derived geometry, topology, mappings, offsets,
and surfaces after renderer invalidation. Every same-document rebuild calls renderer
`beginSurfaceReflow()` before `PageLayoutEngine.beginReflow()`. Reflow invalidates leases
for preserve and drop paths. After registration, `endSurfaceReflow()` may explicitly
rebind committed output only when the exact canvas/wrapper and backing dimensions remain;
in-flight operations are never revived. Topology revision advances on reset/reflow; page
geometry revision advances only when valid fallback or per-page dimensions materially change.
Preserving reflow reapplies current-scale CSS geometry to every registered page before row
measurement and the final render snapshot, even when raster invalidation left no committed output.
Visibility planning therefore never depends on which pages happened to render before a Fit action.
Current raster and text-only observations update the renderer's private planning cache in O(1)
and publish the same geometry to `DocumentView`. The owner batches exact per-page wrapper
sizing and row-offset reconciliation to one document-owned frame; the renderer refreshes its
canonical detached geometry once for that batched layout revision rather than once per page.
Surface registration epochs remain separate output identity. Device DPR belongs to raster
snapshots, not layout.

### Search Publication

`DocumentSearch` prepares a private candidate index using the same extraction policy as
PDF.js text layers, validates and copies text items with their original text-layer indices,
builds one concatenated original-string stream plus immutable item offsets per page, keeps
indexed empty pages distinct from missing pages, and releases each admitted shared
page use exactly once. `DocumentPageUsage` alone decides when proxy cleanup is safe. Search
atomically publishes a copied, frozen complete index only after every expected
page succeeds and the document/reset identity remains current. Acquisitions use the shared
document page-usage owner, so search cannot clean a proxy still used by rendering or text
presentation. Failure or cancellation
cannot expose partial candidate state. Queries return detached results; the facade owns UI
match selection while `DocumentTextPresentation` freezes and indexes result sets by page.
Matches never cross pages and introduce no synthetic separators: source whitespace remains
searchable when PDF.js includes it in an item. Each page-stream match is projected by binary
search and a short forward scan to its smallest ordered set of exact source-item segments.
Active-match changes use stable page/segment keys and toggle cached node classes;
they do not rebuild ranges or replace nodes. The active match independently pins and demands
its page until navigation moves or clears it, so scrolling and asynchronous viewport updates
cannot leave the current result without text presentation.

### Text Presentation And Selection

`DocumentTextPresentation` creates package-owned builder adapters around the resolved
runtime's PDF.js `TextLayer` constructor from current renderer-mediated page contexts.
The adapter preserves the upstream text-div/string mapping, end-of-content sentinel,
append timing, cancellation, and normalized copy ownership required by package selection
semantics. It deliberately does not import `pdfjs-dist/web/pdf_viewer.mjs`: that helper
reads `globalThis.pdfjsLib` during module evaluation, so it cannot reliably follow an
application-selected standard or legacy display API and can fail before runtime injection
is established. No package path requires or writes that global. The facade supplies the
same resolved PDF.js module to document loading, worker globals, and text presentation;
tests and custom builder injection remain the only alternate adapter boundary.
Builder completion and owner presentation completion are separate lifecycle states. A text
builder may finish after its renderer context becomes stale; that preserves its reusable DOM and
mapping but does not mark the page presented. Only a current context may index the mapping,
materialize search and selection state, and record the finalized scale. Demand remains active for
an unfinished same-scale presentation, allowing the renderer's serial lane to finalize it without
requiring an incidental scale change.

Transient zoom transforms existing mirrors without touching
text layout. Canonical scale commit preserves one stable PDF.js glyph-layout basis and scales it
through inherited page variables; it does not remeasure glyph `scaleX` values at each zoom.
Rotation and surface replacement still rebuild text layout. The facade supplies only visible
rows plus one adjacent row as viewport candidates. The owner demands all such pages in selection
mode, only matched candidates in search-only mode, the current search match as an independent pin,
and every page crossed by a semantic selection as independent pins. Active-match pin changes
synchronously reconcile facade demand; selection pin changes release unowned records and schedule
one facade reconciliation frame. Raster planning and admission happen before the atomic demand snapshot
starts text presentation, so inactive text features cannot delay the first current-scale bitmap.

Search matches map retained original item indices and UTF-16 spans to the builder's unchanged
text nodes; mapping disagreement suppresses only that page's highlights and never falls back to
proportional geometry. Result sets are immutable and page-indexed. Active navigation toggles
classes on nodes cached by stable match key, without recreating ranges or highlight DOM. Search
publication advances an owner revision, and each retained page records the revision whose exact
DOM geometry it has materialized. Geometry completion is tracked per source segment rather than
per logical match. Geometry that is temporarily unavailable immediately after text-layer
attachment receives an identity-checked post-layout retry rather than publishing an empty cache
indefinitely. Zoom suspension leaves an unmaterialized revision dirty; resume schedules a
zoom-commit-safe post-layout pass, so geometry cannot depend on a later incidental scale change.
Search matches and selection mirrors paint only from text-only, page-local DOM ranges. Cross-page
mirror geometry partitions semantic bookmarks into start, intermediate, and end page ranges, rejects
rectangles outside the owning text layer, and never uses rectangles from a document-wide range
that crosses wrappers or canvases. Selection-change capture is frame-coalesced, redraws only
page-local partitions whose ordered semantic bounds changed, batches DOM replacement, and uses
sorted line merging followed by an exact non-overlapping rectangle union, so overlapping PDF text
items cannot darken the same selected area twice. During mouse dragging, a capture-phase
`mousemove` guard cancels Chromium's native range update while the pointer is over unmapped paper,
before the page-sized end marker can paint. The package adapter retains upstream-compatible sentinel DOM ordering,
but package functional CSS intentionally omits upstream's page-sized `.selecting`
expansion and use `!important` zero-area/non-selectable rules to outrank its later inline mutation
before browser paint.
Synchronous `selectionchange` restoration and a post-mouse RAF remain defensive fallbacks before
mirror capture. Native
selection paint is suppressed by making the otherwise-transparent owned text layer fully
transparent; the semantic native range remains available for clipboard normalization and mobile
handles.

Mode changes alter interactivity, not text-layer existence. Raster eviction may release an
unselected text page; pages intersecting the logical selection remain pinned, then are released
when demand and selection ownership both end. Selection bookmarks retain page, item index,
UTF-16 offset, affinity, anchor, and focus. Native range ownership is explicitly viewer-scoped
despite the document-global browser `Selection`; ordinary presentation never restores a range,
and one viewer cannot clear or replace another viewer's range. Search/menu retention is one
tokenized transaction: transfer invalidates an older completion, both panels close symmetrically,
and any noncollapsed host or other-viewer selection yields ownership rather than being overwritten.
Reflow and scale transactions likewise restore only their own bookmarks.

Primary-mouse arbitration uses the text owner's exact node mapping rather than the page-sized text
layer bounds. A mapped text target starts browser-native selection; textless paper, canvases, page
gaps, and other unmapped presentation retain the viewer's normal drag-scroll and fling behavior.

Every canonical scale transition, including API zoom, fit, slider input, page-layout reflow,
resize fit, and transient gesture commit, first completes the mirror and clears only the managed
native range. Overlays transform with `.pdf-content` on the transient fast path. Restoration
waits for every selected page at the canonical scale and never calls `scrollIntoView()`. Full
topology replacement snapshots bookmarks before cancellation; reset cancels every builder so
PDF.js global selection bookkeeping remains balanced. Edge autoscroll begins only after a real
owned noncollapsed mouse drag and retains the last valid endpoint while crossing blank gaps.

Committed canonical scales are rounded once to six decimal places at `DocumentView`'s sole scale
writer. Transient gesture samples remain unquantized. Layout, raster planning, PDF.js viewports,
text presentation, annotations, state, and diagnostics all observe the same normalized committed
value, preventing arithmetically equivalent fit and gesture results from creating distinct render
identities without browser interpolation of an existing bitmap.
During zoom, a selected page that is still required by the render plan also pins its old
raster placeholder until the replacement bitmap commits, preventing a mirror-only gap.
The facade commits transient zoom as one layout transaction: it installs normalized scale,
updates scale-dependent page geometry, restores the source-scale offset from the page under the
gesture or the geometrically nearest page for a gesture that began outside page bounds, and only
then publishes a render snapshot. Resolving that offset against the page's actual target rectangle
absorbs accumulated page/gap rounding and horizontal row-centering changes while targeting the
gesture's latest client-space center. No intermediate new-scale plan may observe the old scroll
coordinate. Old-scale placeholders are retained only for currently visible pages and pages
explicitly pinned by selection; other cached placeholders are evicted before quality planning so
obsolete backing stores do not force avoidable DPR reduction.

Horizontal transient placement uses the same document envelope as canonical layout: the widest
installed row determines content width, centering inset, and scroll limits. The gesture controller
captures that immutable envelope once and projects each visual scale arithmetically. It never
clamps against the row under the gesture, because a narrower singleton row in book mode is centered
inside the wider document and is not a horizontal document boundary. This keeps factor-one
transforms at identity, preserves row centering through the fit threshold, and limits edge
constraint behavior to actual document edges.
Scale-dependent page geometry also publishes `--pdf-page-scale` before raster reconciliation.
Consumer page chrome uses this layout-owned value rather than renderer-owned PDF.js output
variables, so it cannot lag between transient-transform removal and replacement bitmap commit.
Canonical page dimensions and row gaps retain fractional CSS pixels so their geometry remains
continuous with the transform-only phase; integer rounding is confined to raster backing stores.
`DocumentRenderer` and presentation settlement publish PDF.js geometry variables but never rewrite
canvas or wrapper CSS dimensions, which remain exclusively owned by `DocumentView`.

The transient phase is transform-only. Gesture start snapshots invariant container and anchor-row
geometry and disables content transitions. Continuous pinch, touchpad, and slider samples coalesce
to one matrix-transform write per frame; continuous pixel-wheel touchpad input uses its own lower
sensitivity without affecting the other inputs. Discrete physical-wheel steps instead update the
final target immediately and interpolate only the visual transform through a short bounded frame
loop; commit flushes that loop to the target before canonical layout/raster work begins. Touch-scroll
lock events, including a scroll RAF queued before pinch ownership, cannot enter motion tracking or
render reconciliation; suppressed scroll-derived state is replayed after ownership ends. Resize or
row-topology mutation aborts the transient session before changing cached geometry. Commit/reset
restores the consumer's prior inline transition value.
Target-scale text failure requests one deferred retry after the active presentation lane settles.
A second failure ends suspension with retained mirror semantics and a structured diagnostic; a
later successful presentation may restore the native range without changing scroll position.
Managed `until-copy` completion is observed only on a current owned text layer after PDF.js writes
the clipboard payload; prior host cancellation and input copy do not complete it. Browser tests
assert normalized clipboard data directly; WebKit uses a semantic three-page range because its
synthetic mouse driver is unstable across three separate text-layer islands.

### Navigation Intent

`DocumentNavigation` prepares a detached outline and named-destination index, resolves
destinations, and atomically publishes immutable document-order targets, page ranges,
and stable-key lookup alongside each prepared model. Untrusted outline shape is normalized with
explicit iterative stacks: malformed nodes are skipped, ancestor cycles fail the feature locally,
and compact preorder keys avoid path-string quadratic growth. At most four outline destinations
resolve concurrently; invalidation stops workers from claiming queued jobs, and only the final
current generation publishes. Public cloning/filtering and `DocumentOutlinePresentation` DOM
rendering/filtering are iterative as well, so depth does not consume the JavaScript call stack.
Package-generated untitled fallbacks can be relabelled in place without re-resolving destinations;
PDF-authored titles remain source-owned. Active selection and persistence use
binary or page-local scans rather than rebuilding global projections. It owns sticky
semantic selection and persistence synchronization, checks document/timer identity before
publication or writes, and returns semantic movement intents. The facade maps those intents
to current layout and scroll movement and emits public events. `DocumentOutlinePresentation`
renders and filters outline UI. When document movement changes the active outline item,
that owner reveals it through the outline's own scroll owner; it
does not reapply the reveal while the same item remains active, preserving manual
outline scrolling. Opening through `ViewerPanels` defers an immediate reveal until the panel's CSS
transition and optional filter focus have settled, so it uses the final custom-UI viewport.
Terminal CSS transition objects drive this synchronization; panels without an active transition
reveal on the next animation frame. Selection changes while the outline remains visible use the
viewer motion policy. Lazy preparation republishes current semantic selection after installing DOM,
so opening never depends on a later incidental document scroll. Pointer, wheel, touch, and keyboard
intent cancel a pending opening reveal; layout-generated scroll events during sidebar transitions do
not take manual ownership or suppress final positioning.

`DocumentView` derives one canonical reading position from measured page rectangles. Its anchor is
horizontally centered and 35 percent down the scrollport, favoring content in the leading part of
the viewport. The page containing the anchor wins; a gap uses the nearest page, then greatest
viewport intersection, a previously selected spread page, and document order as deterministic
fallbacks. The resulting page-local `(page, yRatio, xRatio)` position drives public current page,
active thumbnail row, outline selection, and persisted named-destination selection. Outline and
named-destination indexes choose the latest target at or before that position in document order,
so a chapter remains active throughout later pages until the anchor crosses the next chapter.
Explicit navigation remains sticky until its selected destination has entered and then left the
viewport. Scroll, container resize, and observed page-geometry transactions all schedule the same
derived-state reconciliation.

For an admitted explicit jump, the facade captures that reading position before movement. One shared
facade navigation generation makes every newer semantic request authoritative over pending named
destinations, annotations, IME callbacks, animation frames, and timers. Synchronous movement records
the departure without publishing, installs the validated target, synchronizes controls, and only then
publishes deduplicated state. Deferred movement retains the departure without mutating history until
its current-generation callback executes. Neutral reading and live-search movement never advances
that semantic generation. A deferred neutral movement observes both the current semantic generation
and explicit-movement commit revision, so it cannot cancel an unresolved semantic request or execute
after that request commits. `DocumentView` converts displayed ratios to normalized
baseline rendered-page space on capture and back through the current viewer rotation on restore.
Back/Forward selects without mutation, restores precise geometry, commits the stack transition, and
then publishes. It keeps current zoom, rotation, viewport, and spread layout, aligns the saved point
with the same 50%/35% anchor, and remains history-neutral. Missing or zero geometry changes neither
scroll position nor stacks, so the same entry can be retried.

History records public page and named-destination jumps, page-number commits, outline and thumbnail
selection, internal annotation destinations, explicit search-result stepping, and explicit
first/last-page commands. Ordinary scrolling, row-by-row reading controls, Page Up/Down, arrows,
Space, view/zoom/layout/rotation changes, initial or host-persisted navigation, and Back/Forward
restoration do not add entries. A new explicit jump after Back clears Forward. Document replacement,
close, and destroy reset both stacks before publishing the resulting state.

The facade owns bounded smooth programmatic page and positioned-destination animation rather than
relying on browser smooth-scroll timing or retargeting. It treats the target as the baseline for
subsequent relative next/previous requests until that target is reached or expires; each request retargets
from the current physical scroll position and restarts the bounded animation. Rapid
button and keyboard navigation therefore extends one destination without skipping pages,
while reduced-motion navigation remains synchronous. Direct pointer or wheel input cancels
the programmatic target so native user scrolling wins. The document lifecycle also cancels
this facade-owned animation before replacing or closing its document.
When one explicit smooth destination is superseded by another, the first installed semantic target is
settled before capturing the second departure; history never retains an animation-intermediate point.

### Forms, Layers, And Printing

`DocumentPresentation` is the only extension point for annotation-derived and XFA page interaction.
Its pure-XFA branch consumes `DocumentFormState` for live annotation storage and dirty/reset/export policy while retaining exact surface lifetime,
safe links, focus pinning, and in-place viewport updates with the AcroForm branch without conflating
their PDF.js presentation APIs. Hybrid XFA is reported as `hybrid-acroform-fallback` because PDF.js
does not expose mixed XFA HTML.

The package supplies deterministic control names and direct label/ARIA ID relationships, but it does
not construct a PDF tagged-structure tree for annotation or XFA DOM. `AnnotationLayer` is intentionally
created without PDF.js `StructTreeLayer`/`TextAccessibilityManager`; therefore logical reading order
and relationships that exist only in a tagged PDF structure are not projected beyond relationships
already exposed by PDF.js field/XFA data. A browser IME composition session itself cannot be moved to
new DOM, although the committed value, focus, selection, and relevant control state survive a required
exact-identity rebuild.

`DocumentXfaPrintSnapshot` is preparation, not fake canvas printing. At job start it copies `allXfaHtml`,
derives immutable page-point geometry through the injected `XfaLayer.getPageViewport`, and freezes structural
field values behind a read-only adapter. It never uses `PrintAnnotationStorage` as an XFA DOM value
provider. `DocumentPrint` materializes a fresh mutable structure for every page, computes physical
contain scale, and creates the render viewport at `96 / 72 * containScale` in exact sheet slots;
ordinary pages use sequential canvas rendering and encoded sheet images.

The facade reserves one controlled print attempt synchronously with a first-wins identity before
permission or geometry work; concurrent controlled calls return cancelled without duplicate PDF
work. Document invalidation releases that admission for a successor while stale `finally` blocks
cannot clear newer ownership. The admitted operation then resolves permission and exact page
geometry while repeatedly checking document generation and revalidates post-layout native support.
After those waits it captures detached
layer visibility, AcroForm print storage, pure-XFA values, and their corresponding revisions as one
identity-validated job snapshot before events, exclusive-raster acquisition, or page work. Later
form, layer, or geometry changes belong to the next job and diagnostics identify the exact admitted
revisions. A pre-aborted caller or document signal is rejected before either admission stage.

Optional-content groups require a separate `DocumentLayers` owner. It must own the
detached hierarchy, visibility mutation and revision, PDF.js optional-content
configuration, persistence/reset policy, and sidebar-view state. The primary renderer,
thumbnail owner, and print owner consume immutable configuration plus revision;
none owns layer UI or mutates configuration independently.

The facade reads catalog `PageLayout` once through `catalog-page-layout.ts` and hands its two
projections to `DocumentView`: viewer topology and print preference. Neither `DocumentView` nor
print geometry reinterprets raw PDF.js strings or derives one projection from the other. Automatic
print spreads always require the PDF spread preference and every selected page must fit one half of the
selected sheet at unscaled physical size. Under automatic orientation, the planner evaluates
side-by-side placement on a landscape sheet and stacked placement on a portrait sheet, then selects the
candidate with the strongest minimum page scale. Explicit portrait selects stacked placement and
explicit landscape selects side-by-side placement. The boundary retains a one-millimetre edge epsilon;
missing or non-fitting
geometry uses single sheets unless explicitly overridden.
Single-page automatic orientation uses the same minimum-scale comparison across all selected source
pages, so landscape source pages resolve a landscape logical sheet rather than being placed on portrait
paper. Explicit single-page orientation remains authoritative.

`DocumentPrint` owns one cancellable job through preflight and preparation. A null PDF.js
permission list is unrestricted; explicit permission lists require ordinary or high-quality
print permission. The pure planner caps ordinary permission at 150 DPI and searches downward from
the permission-aware request to the highest safe integer DPI, stopping at 72. `maxSheets` is a
configurable pre-allocation workload, DOM, and system print-dialog safety guard, not an intrinsic printing
requirement; its profile default is 350 and profiles may raise it after browser-specific testing. Sheet
count is a hard non-DPI limit and is counted arithmetically before sheet arrays. Permission, canvas,
and one phase-aware package-controlled print raster envelope check happen before page
acquisition. It then freezes one form snapshot, creates a fresh print-intent OCG configuration,
holds an exclusive `RasterWorkCoordinator` lease, renders each page directly at its contained
sheet-slot resolution through `DocumentPageUsage`, and enforces actual Blob bytes after every
sheet. Cancellation is rechecked after uncancellable encoding before any progress publication.
Image decode and font-readiness waits are abort-raced: browser-owned promises remain observed, but
document replacement or caller cancellation can promptly release package DOM, URLs, and raster
admission without waiting for them to settle.
Scratch backing stores are released before native invocation. It never widens viewport raster
buffers or adds a print mode to `DocumentRenderer`.

The planner resolves strict A3, A4, A5, US Letter, and US Legal presets from their canonical metric or inch
dimensions before orientation normalization. Reported DPI always describes the final physical
sheet raster. Every job uses one explicit preset or custom logical sheet; spreads contain both pages
within that fixed sheet. Package defaults are A4, `fit`, automatic orientation, and a 300 DPI
target. Viewer-level defaults are normalized once and shared by generated/custom setup, direct calls,
source-warning analysis, and adapters; per-call options override them. `fit` enlarges or reduces a
page into its slot, while `shrink-to-fit` caps placement scale at one and reduces only oversized pages.
Both policies center after scaling and use the same geometry for raster and XFA output. Package
print-page margins remain zero.

Logical sheet geometry is separate from browser-facing native transport geometry. A
`portrait-and-landscape` capability passes either logical orientation through unchanged. A `portrait`
capability preserves portrait output but maps every logical landscape sheet to swapped portrait
dimensions and rotates the complete composition 90 degrees counterclockwise. Ordinary printing applies the
transform while drawing into the one reusable portrait sheet canvas, so encoded image dimensions,
sheet DOM, and `@page` all agree. Pure-XFA printing places the same logical slot tree in a transformed
content wrapper inside the portrait transport sheet. Pixel area, final-on-sheet DPI, page ordering,
spread parity, and logical result orientation remain unchanged. Duplex guidance follows logical rather
than transport orientation: long-edge flipping for portrait and short-edge flipping for landscape.

Each rendering profile owns nested print workload limits and shared top-level raster/canvas limits.
The 24-million-pixel/8,192-pixel built-ins therefore apply equally to main pages, thumbnails, and print.
Top-level `memoryLimitMiB` is the one phase-aware package-controlled print raster envelope and is copied into
the immutable internal print snapshot: preparation is retained
compressed PNG Blob sources plus reused sheet/page scratch and the larger of annotation or encoding scratch;
invocation is retained Blob sources plus decoded final image backing. The larger phase and safety margin determine admission. Blob sources remain retained through the native print lifecycle
so cross-browser image loading cannot outlive their object URLs; source page and sheet scratch canvases are reused,
not retained per PDF page. Actual encoded sizes vary by content and recompute this same envelope after every sheet.
PDF.js caches, browser internals, and
GPU resources are excluded. The facade captures profile identity, revision, and immutable limits for each
preflight/job. Preflight itself is observational. After exclusive admission drains physical work, `DocumentPrint`
evicts all renderer-owned main output, including visible, placeholder, and annotation backing stores, plus all
thumbnail backing stores. It reclaims safely releasable settled annotation owners, accounts every remaining
output, active, and presentation-lane backing store, and requires `residualRasterBytes === 0` before allocating
print resources. On successful native invocation the exclusive lease transfers with the retained native resources;
cleanup revokes URLs and removes the print root before the settlement callback releases that lease, so normal
reconciliation cannot overlap print rasters.

Public controlled-print failures preserve their admission cause: `too-many-sheets` carries exact
`sheetCount` and `maxSheets`; `memory-limit` covers preflight aggregate-envelope exhaustion, observed/projected
PNG Blob growth, and annotation resource overage; `too-large` is reserved for structural XFA or canvas
dimension/pixel impossibility. The generated and custom-dialog owner maps these three discriminants to its
sheet formatter, memory label, and generic structural-unavailable label respectively.

The private pure `print-route.ts` boundary resolves `off`, compatibility-supported controlled
native, browser source, and adapter routes. Constructor setup ownership, print-button actions,
`state.canPrint`, and `print()` all consume that decision; there is no adapter-precedence branch
outside it. `off` is operationally disabled. Browser routes reserve a popup synchronously. Adapter
routes skip native setup, preflight, planning, and limits. Only controlled native instantiates
`ViewerPrintSetup`; generated inactive setup markup is removed while caller-owned markup is left
unbound. Every button action logs `print-route-selected` before routing.

The public `preflightPrint()` projection performs the same allocation-free planning for package
and host setup dialogs on the controlled-native route. Generated print activation first closes the options menu through
`ViewerPanels`; adapter and browser routes bypass setup/preflight. The default setup
resets at successful document replacement and before its first open for that generation, reports
live sheet count and resolved quality from immutable latest-wins form snapshots, reports only sheet
progress during preparation, and sends requested/resolved DPI, estimates, exceeded limits, sheet
count, and actual retained bytes to the opt-in structured debug logger.
Generated setup exposes 300 and 600 DPI targets while the direct numeric API retains its 72-600 range;
permission and resource admission may resolve either target downward.
Each explanatory string is rendered directly below and referenced by its owning control. The dialog
uses a stable viewport-relative top anchor, grows downward, and scrolls at its height bound rather than
recentring controls as conditional fields, guidance, or feedback appear. Open/close motion remains
disabled under reduced-motion preference.
Each conditional control is the immediate sibling of its owner in one wrapping row. Primary rows contain
Pages with Page range and Sheet with custom dimensions. Advanced rows contain Pages per sheet with First
page side, Orientation, and Page scaling with Quality. A user change to Automatic spreads or Two pages
resets Orientation to Automatic before preflight; subsequent explicit orientation changes remain valid.
Generated help uses quoted option labels, while application-owned translation markup may use its own
safe inline formatting without being overwritten by the setup owner.
The setup owner intercepts Enter only for its three editable inputs, preserves IME composition, and
blurs the input instead of submitting. Select and button keyboard semantics remain native.

At invocation, the top-document print root, constructed stylesheet, and Blob URLs transfer to the sole `NativePrintCoordinator` for the
same-origin top-level `Window` (or the local window below a cross-origin ancestor).
All engines retain until an observed `afterprint`; user agent and `print()` return timing never
select cleanup. The coordinator accepts invocation after focus and publishes `printinvoked`
immediately before calling native `print()`, so even synchronous `afterprint` preserves
`start -> progress -> invoked -> cleanup` ordering. Replacement and viewer destruction cancel preparation but cannot
release transferred resources. A second native invocation is rejected while that window lease
is retained. Detached roots may be recovered conservatively and cleanup is idempotent. Test-only
print-owner construction may retain diagnostics, but the production facade exposes no artifact-retention
option or release method.

The public pure `device-compatibility.ts` boundary owns generic browser/device classification and
immutable compatibility rules. `PdfjsViewerBrowserCompatibilityEngine` classifies recognized browser
compatibility families as `chromium`, `firefox`, or `webkit`; this is a policy abstraction rather
than proof of the literal runtime engine executing the page. Chrome, Edge, and Chromium belong to the
`chromium` compatibility family, Firefox to `firefox`, and Safari to `webkit`. This distinction is
intentional on platforms where browser branding and the underlying runtime engine need not coincide.

Device classification separately exposes browser identity, compatibility engine, platform, and
operating-system family. Platforms are `desktop`, `android`, `apple-mobile`, and `other-mobile`;
operating-system families are `linux`, `windows`, `macos`, `android`, `ios`, and `other`.
`apple-mobile` is the Apple mobile platform family and pairs coherently with the `ios`
operating-system family. Classification recognizes conventional iPhone, iPad, and iPod user agents
and Macintosh-style iPadOS user agents carrying a `Mobile/<build>` token. An explicit environment
classification of `android` or `ios` also selects the corresponding `android` or `apple-mobile`
platform. Other detected mobile environments remain `other-mobile`.

Every compatibility rule requires a recognized compatibility engine and may refine it by browser,
platform, and operating system. Host rules replace package rules with the same selector set; all
other records are merged. Specificity is deterministic selector containment, never declaration
order: one matching rule overrides another only when it contains every selector of the broader rule
and adds at least one. Independent overlapping refinements with different `nativePrintSupport`
require an explicit intersection rule and otherwise fail constructor normalization. Duplicate selector
sets, invalid browser/compatibility-engine combinations, and incoherent mobile platform/OS pairs such
as `android`/`ios` or `apple-mobile`/`android` are rejected during normalization. This keeps
compatibility policy deterministic while allowing later compatibility fields to reuse the same
generic record model without coupling classification to print routing.

The package compatibility baseline grants `portrait` controlled native printing to recognized
Chromium and Firefox compatibility families, then refines their desktop environments to
`portrait-and-landscape`. WebKit is conservatively `unsupported` by default. Apple mobile platforms
are explicitly `unsupported` for all recognized compatibility families, and unknown compatibility
engines also remain unsupported because no engine rule matches them. Recognized Android and other
non-Apple mobile Chromium/Firefox environments therefore retain portrait native transport unless a
narrower package or host rule overrides the baseline.

`PdfjsViewerNativePrintCapabilities` combines the resolved `unsupported`, `portrait`, or `portrait-and-landscape`
policy with constructed-CSSOM checks, but owns no lifetime. Unknown compatibility engines, no matching
policy, or failed mechanical checks resolve unsupported. Both supported values permit every layout;
capability policy controls only native transport orientation. The setup owner derives
portrait-transport and duplex guidance from the successful preflight's logical orientation and
capability. The facade uses the same viewer-local detached and frozen rule list for setup, preflight,
native admission, and the callback passed to `DocumentPrint`; no global registry mutation or
cross-viewer policy is permitted. Explicit source fallback navigates only HTTP(S), Blob, or data URLs;
other source schemes are materialized into a package-owned PDF Blob before the reserved tab is
navigated. Authenticated URL loads materialize unless a host resolver supplies reproducible
navigation, and fallback results identify range, layer-state, and spread-parity losses. If cached
exact page geometry is incomplete, a spread-preferring automatic request is conservatively
parity-sensitive because native preparation may admit the spread.

Native `browserFallback` is a separate host distribution policy, not device compatibility. When false,
unsupported native resolves to an internal unavailable route, `state.canPrint` is false, explicit
source opening is disabled, and preflight plus late `DocumentPrint` failures carry false fallback
availability. This policy does not alter mechanical capability resolution.

## Facade Boundary

### Current Facade Coordination

The following responsibilities intentionally remain in `PdfjsViewer` because each
currently coordinates multiple independent owners or combines public policy with DOM
effects:

- Keep `#closeDocument` in the facade. It orders request/document invalidation,
  renderer settlement, search/navigation/progress reset, layout and DOM detachment,
  public state/UI changes, and PDF.js loading-task/proxy cleanup across several owners.
- Keep transient-zoom coordination in the facade. It bridges gesture state, transient DOM
  styles, lifecycle timers/frames, fit UI, outline state, and navigation-state
  synchronization, while `DocumentView.commitTransientZoom()` owns the canonical scale,
  surface geometry, anchor restoration, and renderer reconciliation transaction.
- Keep coordination between annotation and text presentation in the facade.
  `DocumentRenderer` publishes one exact post-commit context and keeps one admitted page
  use alive while `DocumentPresentation` and `DocumentTextPresentation` settle independently.
  `DocumentPageUsage` remains the sole page-proxy cleanup owner. The facade owns semantic
  navigation execution, not annotation DOM or listener lifecycle.
  These are legitimate facade responsibilities, not unfinished mechanical extractions.
  Moving one requires a complete replacement owner for the entire relevant state and
  policy rather than a facade-shaped host or thin method delegates.

## Evolving The Architecture

### Complete Owner Checklist

Adding or extracting a stateful owner is accepted only when the proposal identifies all of the
following:

- Cohesive state and invariants that the new module exclusively owns.
- Explicit lifecycle, reset procedure, asynchronous identity, and stale-work behavior.
- Narrow stable dependencies, preferably immutable values, semantic intents, and
  detached results instead of a facade projection.
- Encapsulated mutation and a deliberate readonly/snapshot/query API.
- Defined error, cancellation, cleanup, and settlement semantics.
- Focused unit tests and browser integration coverage across the facade boundary.
- A concrete facade responsibility that is removed, not copied or delegated through
  policy-free wrappers.
- Explicit build-entry and private/public API treatment for every new source module.
- A PDF.js compatibility extraction must contain the qualified API-shape casts and
  capability diagnostics without taking policy, lifecycle, or facade coordination ownership.

Reject proposals justified mainly by line count, copied methods, generic `Manager` or
`Service` naming, or a large host interface that mirrors the facade. A helper may remain
a pure helper; an owner must own the complete relevant state and policy.

## Future Design Readiness

This section records design possibilities rather than a committed roadmap. Any follow-up must
satisfy the [complete-owner checklist](#complete-owner-checklist), preserve document lifecycle and
cancellation behavior, preserve custom/headless ownership, and add exact package and browser-consumer
coverage. Do not introduce a generic plugin system merely to anticipate a feature.

### Potential Facade Decomposition

These are private implementation candidates, not public extension points or a commitment to perform
every extraction. Published consumers must continue to observe only the package-root API, documented
DOM/CSS hooks, state and event ordering, and generated/custom/headless ownership contracts. A private
refactor is not behavior-neutral merely because its classes are unexported.

#### Recommended Extraction Order

If these extractions are pursued, use the following order:

1. Extract a complete navigation coordinator after first capturing the current navigation behavior in
   focused tests. This has the clearest remaining state cluster and gives UI controls one semantic
   navigation boundary instead of facade methods and fields.
2. Consider a viewer UI controller only after the navigation boundary has settled. It is conditional,
   need not block the first stable release, and should proceed only when it removes complete control-DOM
   ownership rather than relocating listener wiring.
3. Consider a document lifecycle coordinator last, if the earlier boundaries leave a demonstrably
   cohesive lifecycle owner. It has the highest coupling and stale-work risk and is not a general target
   for reducing facade line count.

Do not perform the navigation and broad UI extractions in one change. Each step must leave a complete,
qualified boundary and must be independently revertible. Dogfood the packed package through the parent
application between steps; workspace-source use alone does not exercise the publication boundary.

#### Navigation Coordinator

A private navigation coordinator could own the complete transaction currently divided between
`DocumentNavigation`, `DocumentNavigationHistory`, `DocumentView` capabilities, and facade navigation
state. It should own:

- Semantic request identity and latest-wins generations for page, row, positioned destination,
  named-destination, annotation, outline, thumbnail, search-result, Back, and Forward commands.
- Pending explicit targets, smooth-motion state and frames, direct-input cancellation, reduced-motion
  settlement, IME/visual-viewport deferral, and commit revisions used by neutral deferred movement.
- Departure capture, history admission classification, transactional Back/Forward selection and commit,
  branch clearing, and history-availability publication.
- Scroll/resize/geometry-triggered reading-position reconciliation and the semantic result needed to
  update current page, outline, thumbnails, persisted navigation state, and public state.
- Document-lifetime reset that synchronously invalidates timers, frames, destination resolution, pending
  movement, history, and deferred callbacks before replacement geometry can become visible.

The coordinator must compose, not absorb, the existing owners. `DocumentNavigation` remains the detached
outline/destination and persistence model; `DocumentNavigationHistory` may remain its bounded stack
component; `DocumentView` remains the only canonical geometry and scroll-location authority. The
coordinator receives narrow capabilities for capture, restore, target resolution, and physical movement
and returns detached semantic outcomes. It must not import the facade, publish DOM events, mutate public
state, own outline/thumbnail DOM, or become a facade-shaped host interface.

Before extraction, characterization coverage must lock down at least: rapid smooth retargeting, same-page
positioned destinations, history admission exclusions, reentrant state listeners, named-destination
supersession, neutral versus semantic generations, IME deferral, reduced motion, direct-input takeover,
replacement/close invalidation, URL-state writes, and exact state/event ordering. Generated controls,
custom bindings outside `rootEl`, keyboard input, annotations, outline, thumbnails, and the public methods
must all route through the same semantic commands. No compatibility alias should preserve an old private
facade path after the new owner is installed.

#### Viewer UI Controller

A later private viewer UI controller could own the package-managed control DOM discovered by
`viewer-ui-discovery.ts`. Its purpose would be one-way projection of facade state into generated and
custom controls plus semantic user intents back to the facade or navigation coordinator. To be complete,
it would need to own:

- The structured discovered-control references instead of exploding them into parallel facade fields.
- Viewer-lifetime control listeners and exact teardown, readiness/disabled state, pressed/selected values,
  page and zoom control values, rendering-profile controls, download presentation, and control-local ARIA.
- Runtime label/formatter refresh for control text while leaving document-content presentation with its
  existing feature owners.
- Semantic callbacks such as navigate, set layout/fit/rotation/zoom/profile, search, download, print,
  enter presentation, and toggle selection, without direct access to PDF.js or mutable facade internals.

This controller must not become a second public-state owner or a catch-all presentation layer.
`ViewerPanels`, `ViewerPrintSetup`, `ViewerDocumentInformation`, outline/attachment/layer presentation,
`PresentationInputController`, and dialog owners retain their complete existing domains. The facade
continues to compose the public immutable state snapshot, validate public calls, dispatch browser events,
and coordinate cross-feature effects. Headless mode must not pay for or instantiate visible-control
ownership.

The extraction must preserve caller-owned custom markup, direct bindings outside `rootEl`, owner-document
identity, typed element validation, generated DOM and stable hook structure, host extension slots, focus
restoration, keyboard scope, `hidden`/`inert`/ARIA timing, dynamic localization, and destroy semantics.
Characterization tests must cover default, generated-custom, caller-custom, minimal-container, headless,
multi-viewer, iframe-owner-document, RTL, reduced-motion, CSP/Trusted Types, and disconnected-root cases.
Move cohesive control domains in reviewable steps only when every intermediate commit has one explicit
owner; do not leave duplicate listeners or dual state publication during a prolonged migration.

#### Document Lifecycle Coordinator

A document lifecycle coordinator could absorb the complete close/replacement procedure currently
implemented by `#closeDocument`. To be complete, it would need to own:

- Document-generation identity and synchronous invalidation of document callbacks, renderer work,
  preparation, gesture state, and deferred navigation.
- Ordered reset of rendering, search, navigation, progress, layout, presentation, and document-owned
  DOM resources.
- Detached settlement of cancelled render/preparation work and exactly-once cleanup of PDF.js loading
  tasks, proxies, pages, object URLs, and abort controllers.
- Latest-wins replacement behavior, including which cleanup may proceed without blocking a successor
  and which loading-task destruction must be awaited.
- A detached lifecycle result that lets the public facade update state, controls, and events without
  exposing facade internals to the coordinator.

This extraction has the highest coupling risk because ordering independent owners is a core reason for
a facade. It is justified only if the coordinator owns the actual lifecycle resources and invariants;
wrapping `#closeDocument` behind a large host interface would make the design worse. It should not begin
until navigation and any UI-control extraction have established their own reset APIs; otherwise the
lifecycle coordinator would merely reproduce the facade's current knowledge of their internal state.

#### Resulting Facade Boundary

If one or more of these owners become complete, `PdfjsViewer` should lose the corresponding mutable
state and policy. The long-term facade would primarily retain:

- Public constructor and method validation, public state snapshots, and browser events.
- Application-facing policy, semantic UI intent admission, labels, and public accessibility contracts;
  a complete UI controller may own control-DOM projection while existing presentation owners retain
  their domains.
- Coordination between genuinely independent owners where no single owner should absorb the others.

An extraction is incomplete if the facade still decides the moved subsystem's lifecycle, result
identity, reset policy, or mutation ordering through thin delegate methods.

### Future Feature Readiness

"Ready" means a feature can use an existing owner and normally extend the public API additively; it
does not mean the feature is implemented.

| Possible feature                                                                | Current seam                                                                                                                                                                                  | Readiness and required work                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial named destination, explicit open parameters, or initial zoom            | `PdfjsViewerLoadOptions`, `DocumentNavigation`, and the navigation-state adapter already separate per-load intent from reusable viewer configuration.                                         | **Additive-ready.** Add a typed, mutually exclusive initial-view field and document precedence over persisted navigation and `initialPage`. Resolve it before the initial render plan; never restore it on later replacement loads implicitly.                                                                                                  |
| Additional authenticated loading options                                        | `defaultDocumentOptions` plus per-load `documentOptions` already copy and shallowly override PDF.js loading options, with whole-object header replacement.                                    | **Additive-ready for qualified PDF.js options.** Continue to validate/copy admitted values. A custom range/network transport is not an escape-hatch option: add a validated source-descriptor union member with explicit cancellation and ownership.                                                                                            |
| Offline/cache integration                                                       | URL/data source descriptors and explicit load results provide a clean application boundary.                                                                                                   | **Host-ready, package storage not designed.** Applications can resolve cached bytes before `load()`. Package-owned persistent caching would need document identity, eviction, credential isolation, quota failure, and stale-version policy.                                                                                                    |
| Live localization, locale-specific number/date formatting, and catalog adapters | `setUiText()` replaces package-owned labels/formatters in place while host custom markup remains host-owned.                                                                                  | **Ready.** Catalog/plural adapters should remain above `PdfjsViewerUiTextOptions`; do not couple presenters to one i18n library or add package-specific keys to custom markup.                                                                                                                                                                  |
| Additional detached document queries or export formats                          | Document information, outline, search, attachments, layers, forms, and load/print APIs already use detached discriminated results.                                                            | **Additive-ready when an existing owner has the data.** Preserve immutable snapshots, structured unavailable/error reasons, current-generation checks, and no hidden download or preparation side effects.                                                                                                                                      |
| Annotation editing and comments                                                 | `DocumentPresentation`, `DocumentFormState`, exact surface identity, raster invalidation, and annotation-storage compatibility adapters are usable internal seams.                            | **Not ready as a flag.** A complete editor owner must define tool state, undo/redo, focus, persistence/export, modified-page invalidation, security, accessibility, memory, replacement, and PDF.js compatibility. Read-only annotations remain the supported contract.                                                                         |
| Digital signatures, submissions, and PDF JavaScript                             | Form state and export expose only values PDF.js can serialize; PDF JavaScript execution is never admitted.                                                                                    | **Requires a security architecture.** Signature validity/trust, key custody, sandboxing, network submission, user consent, audit state, unsupported XFA semantics, and teardown cannot be delegated to incidental PDF.js callbacks. Do not introduce a PDF JavaScript flag opportunistically.                                                   |
| Tagged-PDF structure, richer screen-reader reading order, or semantic reflow    | Current text, annotation, XFA, and form presentation owns visual page-local DOM and deterministic relationships, but intentionally omits PDF.js `StructTreeLayer`/`TextAccessibilityManager`. | **Requires a semantic document model.** Tagged structure, logical reading order, focus routing, virtualized semantics, and reflow are not a small presentation option and must be designed separately from visual page topology.                                                                                                                |
| Page-DOM virtualization for extremely large documents                           | Raster work, page use, render leases, and viewport-height buffering are bounded; page and surface identities are exact.                                                                       | **Partially ready.** Raster virtualization is strong, but `DocumentView` currently attaches all page wrappers. Detaching page DOM requires explicit pinning for focus, native/managed selection, search matches, forms, annotations, destinations, print snapshots, and accessibility before any wrapper can leave the document.                |
| Managed sidebar views beyond outline, thumbnails, attachments, and layers       | Each current view has a complete owner; custom markup has static search/menu extension slots.                                                                                                 | **Host extensions are ready; managed views are not generic.** Static extension slots suit application-owned content. Add another package-managed view with its own state, preparation, bindings, accessibility, reset, and styling. Introduce a typed view registry only after a concrete second external view proves the abstraction.          |
| Layer/form preference persistence                                               | Layers and forms expose detached state, revisions, mutation/reset results, and lifecycle events.                                                                                              | **Host integration is possible, automatic persistence is not designed.** A package adapter must be document-keyed, versioned, cancellation-aware, and explicit about default/reset semantics and storage failures; it must not reuse navigation-state ownership implicitly.                                                                     |
| Framework wrappers or a Web Component                                           | Synchronous document-free construction, explicit `load()` results, direct bindings, runtime text updates, frozen state, and deterministic `destroy()` provide suitable lifecycle seams.       | **Wrapper-ready.** A wrapper subscribes directly to non-bubbling/non-composed root events and may re-emit framework events. It must preserve one root/owner document, call `destroy()` on unmount, and avoid treating generated DOM as framework-owned children.                                                                                |
| Alternate raster backends, worker pooling, or off-main-thread preparation       | `DocumentRenderer`, `RasterWorkCoordinator`, page-use leases, rendering profiles, and exact PDF.js runtime ownership isolate most scheduling policy.                                          | **Internally extensible, not a public backend contract.** Add a real second backend first, preserve cancellation/memory accounting/surface identity, and expose only capabilities proven common to both. Do not publish renderer internals preemptively.                                                                                        |
| More print layouts, booklet/imposition, or additional physical controls         | The sheet planner, normalized adapter context, geometry snapshots, final-on-sheet DPI semantics, and native capability admission are explicit.                                                | **Planner-ready with physical constraints.** Every layout needs deterministic sheet order, parity, orientation, memory estimates, source fallback, and tests. Never imply control over system print-dialog settings the package cannot enforce.                                                                                                 |
| Additional qualified PDF.js releases                                            | Exact version policy, standard/legacy API probes, adapted-CSS manifest, runtime sentinels, real browser fixtures, and candidate tarball tests are in place.                                   | **Process-ready, never range-ready.** Follow [Qualifying a New PDF.js Release](#qualifying-a-new-pdfjs-release) and add only releases that pass. `allow-unqualified` remains an unsupported application-owned experiment.                                                                                                                       |
| Multiple simultaneous documents, tabs, or comparison views inside one facade    | Runtime worker sharing and global keyboard routing already support multiple independent viewer instances.                                                                                     | **Use one `PdfjsViewer` per document today.** One facade owning several active documents would require a new lifecycle, state partition, cache/memory arbitration, navigation identity, UI ownership, and print model; reusable `load()` does not imply this architecture.                                                                      |
| Richer mobile gestures beyond discrete-page presentation mode                   | Presentation reuses stable rows, single-page contain fit, canonical view/location snapshots, presentation-first input routing, and a private exact-root fullscreen owner.                     | **Feature-specific design required.** Browser-native touch scrolling and selection stay browser-owned; synthetic automation does not justify custom OS gesture emulation. Any additional gesture must preserve destination, form, selection, search, focus, history, lifecycle, and preparation behavior already enforced by presentation mode. |

The strongest current seams are explicit lifecycle/results, detached query models, complete feature
owners, exact page/surface identities, rendering/print planners, runtime text replacement, and the
qualified PDF.js boundary. The largest deliberate gaps are semantic/tagged structure, editable
annotation security and persistence, page-DOM virtualization, and multi-document ownership.

## Release And Distribution

### Publication Boundary

This package release qualifies only `pdfjs-dist 6.3.289`. The public frozen version set and ordered
exact peer union are mechanically kept identical; compatibility installers and CI iterate the peer
union, while the package development pin selects its newest entry. `pdfjs-compatibility.ts`
is the complete owner for all PDF.js compatibility casts and capability checks. CI exercises every
qualified release's standard and legacy display modules
and fails on missing `TextLayer`, `AnnotationLayer`, `XfaLayer`, `AnnotationStorage`,
`OptionalContentConfig.fromSerializable`, page display methods, or incompatible annotation modes.
Compatibility tests install that exact peer independently for both module trees. The peer range
must not widen until the same matrix passes for every newly admitted release.

Generated browser UI is constructed through `createPdfjsViewerUi()` using element, attribute,
text-node, and append operations. The SSR-only `renderPdfjsViewerUi()` returns an escaped string,
not `TrustedHTML`; client insertion of that string is a host policy boundary. Controlled print uses
DOM/CSSOM construction and a constructed stylesheet. A real Chromium response-header test enforces
`require-trusted-types-for 'script'` and records CSP violations.

### Security And Browser Qualification

`DocumentFormState` resets to loaded values rather than AcroForm `/DV`, and its export queue only
promises values PDF.js can serialize. Public byte access and download require an explicit
`with-form-values` document variant for modified bytes and do not claim proprietary scripts,
signatures, submissions, or unsupported XFA semantics.
Print permission treats a null PDF.js list as unrestricted for admission, while document metadata
continues to expose null as unknown/no-list rather than proof about encryption validity.

Automated browser tests cover current Chromium, Firefox, and WebKit desktop projects plus synthetic
touch projects with a 390x844 viewport, DPR 3, and touch enabled without a mobile UA or `isMobile` emulation.
They cannot qualify a native system print dialog, printer driver, physical MediaBox, or native mobile
selection handles. Production compatibility is defined by the package baseline and host refinements
documented in `DEVICE-COMPATIBILITY.md`; unmatched classes use source fallback when host policy allows it.

### Standalone Publication And CI

This directory is designed to become the standalone repository root. Publication metadata and
links target that standalone project. `.github/workflows/ci.yml` and `.gitlab-ci.yml` are
parallel standalone CI definitions with equivalent logical gates; syntax, caches, scheduling, and
artifact presentation are platform-specific. Both use the official Playwright image for all
browser gates, including desktop and mobile Chromium, Firefox, and direct WebKit execution.

Contributor tooling declares Node `>=22.13.0`; CI covers the minimum and current
supported lines where appropriate. `.github/workflows/release.yml` runs only for version tags,
requires exact `v${package.version}` equality, and pins every referenced GitHub Action to an
immutable commit. Its unprivileged `qualify` job runs the complete release gate and uploads one
checksummed candidate. A separate `publish` job has no source checkout or project dependency
installation, revalidates that downloaded candidate, and receives `id-token: write` only through
the protected `npm` environment before publishing with npm Trusted Publishing and provenance.

Publication runs strict Bundler and NodeNext declaration consumers without `skipLibCheck`, exact
dist/API/map/CSS validation, emitted public-API TSDoc coverage, and an exact `npm pack`
allowlist followed by a clean tarball installation. The pack audit enforces
license/provenance metadata, adapted PDF.js CSS attribution,
CSS and tarball size budgets, side-effect declarations, root exports, and private subpath rejection.
Bundler/NodeNext typechecks and esbuild/Vite/Webpack builds resolve from that clean installation.
Sequential browser smokes pair the installed standard and legacy display modules with matching
installed workers, explicitly load a generated visible PDF, observe `pdf:ready` and a successful
load result, and verify worker construction, painted canvas pixels, and each separate CSS entry
contract without checkout self-resolution.

### Qualifying A New PDF.js Release

PDF.js compatibility is an explicit qualified-version set, not a semver range. Do not
use `6.3.*`, `^6.3.289`, or another open range: PDF.js patch releases can change the
underdocumented DOM, CSS, and private surfaces used by forms, annotations, XFA, optional
content, and printing.

1. Discover the candidate exact release and its standard and legacy display/worker build
   pair. Keep the API and worker from that same installed package tree. Read the candidate's
   entry in the [PDF.js release notes](https://github.com/mozilla/pdf.js/releases) and compare
   its source with the currently qualified release. Inspect every API change and every change
   touching an API, generated DOM, stylesheet section, or rendering path consumed by this
   package; release-note summaries are an index, not a complete compatibility review.
2. Before editing package policy, run isolated candidate capability and CSS checks for both
   builds. The third argument is an
   intentional candidate and may be outside the peer set:
   `node ./scripts/test-pdfjs-compatibility.mjs standard 6.3.289` and
   `node ./scripts/test-pdfjs-compatibility.mjs legacy 6.3.289`. With no third argument,
   the command subprocesses every exact version in the peer union. A passing command proves
   only the capabilities, return-shape assertions, manifest entries, and sentinels that the
   scripts currently encode; it does not establish that those checks remain complete for the
   candidate. Keep populated fixtures for collection-valued APIs so an assertion cannot pass
   through an ambiguous `null` result.
   The demo may also be run provisionally with
   `PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY=allow-unqualified`; this is exploratory evidence only.
3. Manually review the small `PDFJS_CSS_COMPATIBILITY_MANIFEST` even when phase 2 passes.
   Compare the currently qualified and candidate `web/pdf_viewer.css` sections adapted by
   `core.css`, and inspect the candidate runtime code that emits the corresponding text,
   annotation, form, and XFA DOM. Validate the manifest's upstream selectors and declarations,
   translated local rules, and static runtime class sentinels in the exact standard or legacy
   `build/pdf.mjs` being checked. Add or change focused requirements when the candidate changes
   a behavior-critical contract used locally. Sentinels are drift alarms,
   not proof of emitted DOM shape. Record every intentional divergence with an identifier
   and reason. Do not turn this into a full stylesheet equality test.
4. On a dedicated qualification branch, provisionally append the candidate to
   `PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS` and the ordered exact `pdfjs-dist` peer union.
   Pin it as the newest package development dependency and update the lockfile. This provisional
   change is required so the actual full package, browser, tarball, and clean-consumer suites use
   the candidate; it is not a compatibility
   declaration until all evidence below passes.
5. Run the package typecheck, unit suite, compatibility suite, build, dist consumer,
   `npm pack` gate against that branch. Run focused browser behavior
   tests for real text, annotations, forms, optional content, XFA, display rendering, and
   native printing.
6. Run Chromium, Firefox, strict CSP, and Docker WebKit qualification. Exercise the
   candidate through a tarball installed by a clean sample consumer application. If native printing is
   relevant to the release, complete physical native-print qualification on the supported
   browser/platform combinations.
7. Revert the provisional qualification branch on any failure. When every check passes,
   retain it, document the evidence, keep CI matrix behavior driven by the peer union
   rather than literals, and update release documentation, changelog, package metadata,
   and release notes before publishing. The retained qualified list is the public
   consumer contract.

`pdfjsVersionPolicy: "allow-unqualified"` exists only for an application that has
independently qualified a version and used its package manager's peer override. It logs a
debug diagnostic, is unsupported, and carries no guarantees. It bypasses version-set
membership only; display, document, and adapter capability checks remain mandatory.

## Development And Contributing

These commands are for a source checkout, not the installed npm package. Maintainers
changing ownership boundaries or source modules should read the relevant sections of
this guide. Controlled-native print qualification is documented in
[`DEVICE-COMPATIBILITY.md`](./DEVICE-COMPATIBILITY.md).

Contributor tooling requires Node `>=22.13.0`. From the package directory,
install the exact lockfile, typecheck, and build:

```sh
npm ci
npm run typecheck
npm run build
```

To inspect the viewer interactively, start the development demo. It binds only
`127.0.0.1` by default:

```sh
npm run demo
```

Then open `http://127.0.0.1:8047`. Use `PDFJS_VIEWER_DEMO_PORT=9000` to select another port.
To deliberately expose it on a development LAN, set an explicit host such as
`PDFJS_VIEWER_DEMO_HOST=0.0.0.0 npm run demo`; this server is not a production host. The source
under `examples/` includes both the minimal default integration and the interactive
URL-loading demo.

For exploratory PDF.js compatibility and device-print testing, select native mode and, when needed,
opt into an unqualified PDF.js version. To force the public compatibility policy to portrait-only
or portrait-and-landscape native transport on every recognized engine, set
`PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT`:

```sh
npm run demo:print-test
```

Combine it with `PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY=allow-unqualified` when testing an
unqualified installed PDF.js release.

The native-print setting forces demo print mode to native and supplies viewer-local compatibility
rules for Chromium, Firefox, and WebKit; it does not recognize unknown engines or bypass mechanical
checks. The PDF.js candidate must still be installed in the demo checkout. These test settings do not
qualify a PDF.js release or device by themselves.

Install Playwright browser engines once, then run the Chromium and Firefox suite:

```sh
npm run test:browser:install
npm run test:browser
```

Use `npm run test:browser:chromium` for a fast check, `npm run test:browser:mobile:chromium`,
`npm run test:browser:mobile:firefox`, and `npm run test:browser:mobile:webkit` for the
individual synthetic-touch projects. `npm run test:browser:mobile:webkit:docker` runs the
mobile WebKit project through the local Playwright container. `npm run test:browser:all` runs every
configured evergreen engine, and `npm run test:pack` validates and installs the exact
publishable tarball in a clean consumer. The tag-triggered GitHub Trusted Publishing workflow
checks tag/version equality, qualifies and checksums one candidate without OIDC publication
permission, then revalidates and publishes that exact artifact in a separate protected job.

## Mechanical Guardrails

`npm run validate:architecture` enforces stable facts only: the complete emitted-source
manifest, its explicit consumer-facing classification and derived private complement,
module-header architecture links and audience status, all private-to-facade dependency
direction, the derived package-root source allowlist, and the
absence of DOM/presentation dependencies in the search and navigation models. The
dist validation gate follows the actual package-root declaration graph and requires TSDoc
for every exported declaration and package-owned member. The
complete-owner checklist, lifecycle ordering, procedure semantics, facade boundaries,
and future extraction acceptance conditions remain documentary because method-name,
size, or host-shape assertions would be brittle
and would reward superficial compliance rather than sound ownership.
