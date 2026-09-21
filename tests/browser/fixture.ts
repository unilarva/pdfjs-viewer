// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import {
  renderPdfjsViewerUi,
  createPdfjsViewerUi,
  createHashNavigationStateAdapter,
  PDFJS_VIEWER_STATE_CLASSES,
  PdfjsViewerRuntime,
  PdfjsViewer,
  type PdfjsViewerFeatureOptions,
  type PdfjsViewerLogEntry,
  type PdfjsViewerLoadResult,
  type PdfjsViewerPrintOptions,
  type PdfjsViewerPrintDefaults,
  type PdfjsViewerPrintState,
  type PdfjsViewerDeviceCompatibilityRule,
  type PdfjsViewerState,
  type PdfjsViewerTextQueryOptions,
} from "../../src/index";
import * as PDFJS from "pdfjs-dist";
import {
  DocumentTextPresentation,
  type DocumentTextPresentationDiagnostic,
} from "../../src/document-text-presentation";
import { DocumentPresentation } from "../../src/document-presentation";
import { DocumentPrint } from "../../src/document-print";
import { ViewerDocumentInformation } from "../../src/viewer-document-information";
import { ViewerPrintSetup } from "../../src/viewer-print-setup";
import { PDFJS_VIEWER_DEFAULT_FORMATTERS, PDFJS_VIEWER_DEFAULT_LABELS } from "../../src/default-ui";
import { discoverViewerUi } from "../../src/viewer-ui-discovery";
import { PDFJS_VIEWER_UI_HOOKS } from "../../src/viewer-contracts";
import type { RenderPresentationContext, RenderSurfaceLease } from "../../src/document-renderer";

declare global {
  interface Window {
    fixture: {
      primary: PdfjsViewer;
      secondary: PdfjsViewer | null;
      states: PdfjsViewerState[];
      logs: Readonly<PdfjsViewerLogEntry>[];
      securityPolicyViolations: string[];
      stateClasses: typeof PDFJS_VIEWER_STATE_CLASSES;
      setPrintPermissions(mode: "runtime" | "denied" | "ordinary" | "high" | "unrestricted"): void;
      onNextPrintPermissionRead(callback: () => void | Promise<void>): void;
      failNextOptionalContentAcquisition(): void;
      readAcroFormValues(data: Uint8Array): Promise<Record<string, readonly unknown[]>>;
      addSecondary(): void;
      addAcroFormViewers(): Promise<void>;
      probeSimultaneousXfaPresentation(): Promise<Record<string, boolean>>;
      probeAuthenticatedPrintSource(): Promise<Record<string, unknown>>;
      replacePrimary(): Promise<void>;
      closePrimary(): Promise<void>;
      destroySecondary(): void;
      probeRuntimeLifecycle(): {
        compatible: boolean;
        conflictRejected: boolean;
        activeDestroyRejected: boolean;
        destroyedReuseRejected: boolean;
        invalidOptionsRejected: boolean;
        invalidPdfjsRejected: boolean;
        differentPdfjsRejected: boolean;
      };
      probeNavigationDuringReplacement(): Promise<string>;
      probeOverlappingReplacements(): Promise<Record<string, unknown>>;
      probeLoadContract(): Promise<Record<string, boolean>>;
      probeStalePermissionReplacement(): Promise<Record<string, boolean | string>>;
      probeStalePageRenderReplacement(): Promise<Record<string, boolean | number | string | null>>;
      probeThumbnailVisiblePreemption(): Promise<Record<string, boolean | number>>;
      probeLateAttachedRenderReplacement(): Promise<
        Record<string, boolean | number | string | null>
      >;
      probeReplacementGeometryIsolation(): Promise<Record<string, boolean | number>>;
      probeInterruptedDocumentInteractions(): Promise<Record<string, boolean | number | string>>;
      probeSupersededNamedDestination(): Promise<Record<string, boolean | number | string>>;
      probeNeutralOperationsDuringNamedDestination(): Promise<
        Record<string, boolean | number | string>
      >;
      probeDeferredHistoryNavigation(): Promise<Record<string, boolean | number | string>>;
      probeEquivalentPlanRefreshReuse(): Promise<Record<string, boolean | number>>;
      probeStalledFormPreparation(): Promise<Record<string, boolean>>;
      probeInvalidZoom(): { scaleRejected: boolean; factorRejected: boolean };
      probeRotationIntent(): Promise<Record<string, number>>;
      probeDestroyedFitMode(): Promise<Record<string, boolean | number | string>>;
      probeInvalidBehaviorOptions(): Record<string, boolean>;
      probeDocumentVisibilityOptOut(): Promise<Record<string, boolean | number>>;
      probeSidebarBehavior(mode: "overlay" | "persistent"): Promise<boolean>;
      addSidebarLayoutFallbackViewer(): PdfjsViewer;
      probeInvalidConstructorOptions(): Record<string, boolean>;
      probeUiDiscoveryContracts(): Promise<Record<string, boolean>>;
      probeNavigationHistoryBindingOwnership(): Record<string, boolean>;
      probeDeferredInitialLoad(): Promise<Record<string, boolean | number | string | null>>;
      probeSourceDescriptors(): Promise<Record<string, string | null>>;
      probeDestroyedDownloadControl(): Promise<Record<string, boolean>>;
      probePrintAdapterData(): Promise<Record<string, unknown>>;
      probePrintAdapterRevision(): Promise<Record<string, unknown>>;
      probePrintFeaturePolicies(): Promise<Record<string, unknown>>;
      probeDeviceCompatibility(): Promise<Record<string, unknown>>;
      probeAutomaticPrintLayouts(): Promise<Record<string, unknown>>;
      probePrintSetupPreflight(): Promise<Record<string, unknown>>;
      probePrintSetupReinitialization(): Promise<Record<string, boolean | number>>;
      probePrintSetupUiTextRefresh(): Promise<Record<string, boolean | number | string>>;
      probeControlledPrintAdmission(): Promise<Record<string, unknown>>;
      probeDocumentPrintExecution(): Promise<Record<string, unknown>>;
      probeInMemoryDownload(): Promise<Record<string, unknown>>;
      probeInMemoryDownloadLifecycle(): Promise<Record<string, unknown>>;
      probeCloseDuringInitialRenderCleanup(): Promise<Record<string, unknown>>;
      probeInvalidPublicArguments(): Promise<Record<string, boolean>>;
      probeProgressReplacement(): Promise<boolean>;
      probeLaterRenderProgress(): Promise<boolean>;
      probeErrorContext(): string;
      probeMinimalCustomUi(): Promise<{ status: string; pageCount: number; controls: boolean }>;
      probeCustomOutlineMarkup(): Promise<Record<string, boolean>>;
      probeOutlineFilterPolicy(): Promise<Record<string, boolean>>;
      probeExternalSidebarBindings(): Record<string, boolean>;
      probeDisabledPanelOwnership(): Record<string, boolean>;
      probeAnnotationLinkPolicy(): Promise<Record<string, number>>;
      probeHeadlessAnnotationGeometry(): Promise<Record<string, boolean>>;
      probeAnnotationFailureTextIsolation(): Promise<Record<string, number>>;
      probeGeneratedUiComposition(): Record<string, boolean>;
      probeFeaturePreparation(): Promise<Record<string, boolean>>;
      probeLocalization(): Promise<Record<string, boolean>>;
      probeDocumentInformation(): Promise<Record<string, boolean | number | string | null>>;
      probeDocumentInformationUiTextRefresh(): Promise<Record<string, boolean | number | string>>;
      probePublicDataQueries(): Promise<Record<string, boolean>>;
      probeViewerIdentity(): { generatedIdsAreUnique: boolean; duplicateGlobalIdRejected: boolean };
      probeConstructorModePolicies(): Record<string, boolean>;
      probeReadinessOrdering(): Promise<Record<string, boolean | number>>;
      probeIframeRouting(): Promise<Record<string, boolean | number>>;
      activateViewer(viewerId: "primary" | "secondary"): void;
      addIsolatedRuntimeViewers(): void;
      probePerformanceOverrides(): {
        applied: boolean;
        invalidRejected: boolean;
        invalidCanvasPixelsRejected: boolean;
        invalidCanvasDimensionRejected: boolean;
        invalidBufferViewportHeightsRejected: boolean;
        invalidBufferPagesRejected: boolean;
        invalidInactiveBufferRejected: boolean;
      };
      probeViewportBufferResize(): Promise<{ before: number; after: number }>;
      probeRuntimeRenderingProfileSelection(): {
        selections: Array<{
          renderingProfile: string;
          effectiveRenderingProfile: string;
          availableRenderingProfiles: readonly string[];
        }>;
        availabilityIsStable: boolean;
        conservativeRadioChecked: boolean;
        automaticBalancedRadioChecked: boolean;
        unavailableRejected: boolean;
        destroyedRejected: boolean;
        singleProfileFieldsetHidden: boolean;
      };
      probeZoomTextFailureRecovery(): Promise<Record<string, boolean | number>>;
      probeSearchGeometryZoomResume(): Promise<Record<string, boolean | number>>;
      probeStaleTextFailureDiagnostic(): Promise<number>;
      probeSelectionCopyPolicies(): Promise<Record<string, boolean | number>>;
      addQueuePriorityViewer(): Promise<void>;
      addFitUnseenViewer(): Promise<void>;
    };
  }
}

const workerSrc = "/pdf.worker.min.mjs";
const STATE_SCALE_EPSILON = 1e-6;
type PageAcquisitionGate = {
  entered: Promise<void>;
  release(error?: Error): void;
};
type DocumentDataReadGate = PageAcquisitionGate & {
  cleanupCalls(): number;
};
const pageAcquisitionGates: Array<{
  entered(): void;
  settlement: Promise<void>;
}> = [];
const documentDataReadGates: Array<{
  entered(): void;
  settlement: Promise<void>;
  cleanupCalled(): void;
}> = [];
const loadingTaskDestroyGates: Array<{ entered(): void; settlement: Promise<void> }> = [];
const namedDestinationGates: Array<{ entered(): void; settlement: Promise<void> }> = [];
let documentDataReadCount = 0;
let documentLoadAdmissionCount = 0;
let documentCleanupCount = 0;
let printPermissions: "runtime" | "denied" | "ordinary" | "high" | "unrestricted" = "runtime";
let nextPrintPermissionRead: (() => void | Promise<void>) | null = null;
let printPermissionReads = 0;
let rejectNextOptionalContentAcquisition = false;
let stallNextFormPreparation = false;
let challengeNextPassword = false;
const admittedLoadOptions = new Map<string, Readonly<Record<string, unknown>>>();
const gateNextPageAcquisition = (): PageAcquisitionGate => {
  let markEntered!: () => void;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const entered = new Promise<void>(settle => {
    markEntered = settle;
  });
  const settlement = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  pageAcquisitionGates.push({ entered: markEntered, settlement });
  return { entered, release: error => (error ? reject(error) : resolve()) };
};
const gateNextDocumentDataRead = (): DocumentDataReadGate => {
  let markEntered!: () => void;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const entered = new Promise<void>(settle => {
    markEntered = settle;
  });
  const settlement = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  let cleanupCallCount = 0;
  documentDataReadGates.push({
    entered: markEntered,
    settlement,
    cleanupCalled: () => {
      cleanupCallCount++;
    },
  });
  return {
    entered,
    release: error => (error ? reject(error) : resolve()),
    cleanupCalls: () => cleanupCallCount,
  };
};
const gateNextLoadingTaskDestroy = (): PageAcquisitionGate => {
  let markEntered!: () => void;
  let resolve!: () => void;
  const entered = new Promise<void>(settle => {
    markEntered = settle;
  });
  const settlement = new Promise<void>(settle => {
    resolve = settle;
  });
  loadingTaskDestroyGates.push({ entered: markEntered, settlement });
  return { entered, release: () => resolve() };
};
const gateNextNamedDestination = (): PageAcquisitionGate => {
  let markEntered!: () => void;
  let resolve!: () => void;
  const entered = new Promise<void>(settle => {
    markEntered = settle;
  });
  const settlement = new Promise<void>(settle => {
    resolve = settle;
  });
  namedDestinationGates.push({ entered: markEntered, settlement });
  return { entered, release: () => resolve() };
};
const fixturePdfjs = {
  ...PDFJS,
  getDocument: (...args: Parameters<typeof PDFJS.getDocument>) => {
    documentLoadAdmissionCount++;
    const admittedSource = args[0];
    if (
      typeof admittedSource === "object" &&
      admittedSource !== null &&
      "url" in admittedSource &&
      typeof admittedSource.url === "string" &&
      admittedSource.url.includes("load-contract-options")
    ) {
      admittedLoadOptions.set(admittedSource.url, {
        withCredentials: admittedSource.withCredentials,
        httpHeaders: { ...admittedSource.httpHeaders },
      });
    }
    const loadingTask = PDFJS.getDocument(...args);
    const challengePassword = challengeNextPassword;
    challengeNextPassword = false;
    let activeDocumentDataGate: (typeof documentDataReadGates)[number] | null = null;
    const documentPromise = loadingTask.promise.then(pdf => {
      const stallFormPreparation = stallNextFormPreparation;
      stallNextFormPreparation = false;
      return new Proxy(pdf, {
        get(target, property) {
          if (
            stallFormPreparation &&
            (property === "getFieldObjects" || property === "getMetadata")
          ) {
            return () => new Promise<never>(() => {});
          }
          if (property === "getPage") {
            return async (pageNo: number) => {
              const gate = pageAcquisitionGates.shift();
              if (gate) {
                gate.entered();
                await gate.settlement;
              }
              return target.getPage(pageNo);
            };
          }
          if (property === "getDestination") {
            return async (name: string) => {
              const gate = namedDestinationGates.shift();
              if (gate) {
                gate.entered();
                await gate.settlement;
              }
              if (name === "test:same-page-position") {
                return [1, { name: "XYZ" }, 120, 520, null];
              }
              return target.getDestination(name);
            };
          }
          if (property === "getData") {
            return async () => {
              documentDataReadCount++;
              const gate = documentDataReadGates.shift();
              if (gate) {
                activeDocumentDataGate = gate;
                gate.entered();
                await gate.settlement;
              }
              return target.getData();
            };
          }
          if (property === "getPermissions" && printPermissions !== "runtime") {
            const admittedPermissions = printPermissions;
            return async () => {
              printPermissionReads++;
              const callback = nextPrintPermissionRead;
              nextPrintPermissionRead = null;
              await callback?.();
              return admittedPermissions === "unrestricted"
                ? null
                : admittedPermissions === "high"
                  ? new Set([0x04, 0x800])
                  : admittedPermissions === "ordinary"
                    ? new Set([0x04])
                    : new Set<number>();
            };
          }
          if (property === "getOptionalContentConfig" && rejectNextOptionalContentAcquisition) {
            return async () => {
              rejectNextOptionalContentAcquisition = false;
              throw new Error("injected malformed optional-content configuration");
            };
          }
          if (property === "cleanup") {
            return async () => {
              documentCleanupCount++;
              activeDocumentDataGate?.cleanupCalled();
              return target.cleanup();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    let rejectPasswordChallenge: ((reason?: unknown) => void) | null = null;
    const promise: typeof documentPromise = challengePassword
      ? new Promise((_resolve, reject) => {
          rejectPasswordChallenge = reject;
        })
      : documentPromise;
    if (challengePassword) void documentPromise.catch(() => {});
    return new Proxy(loadingTask, {
      get(target, property) {
        if (property === "promise") return promise;
        if (property === "destroy" && challengePassword) {
          return async () => {
            rejectPasswordChallenge?.(new DOMException("Password request cancelled", "AbortError"));
            return target.destroy();
          };
        }
        if (property === "destroy") {
          return async () => {
            const gate = loadingTaskDestroyGates.shift();
            if (gate) {
              gate.entered();
              await gate.settlement;
            }
            return target.destroy();
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value, receiver) {
        const assigned = Reflect.set(target, property, value, receiver);
        if (challengePassword && property === "onPassword" && typeof value === "function") {
          queueMicrotask(() => value(() => {}, 1));
        }
        return assigned;
      },
    });
  },
} as typeof PDFJS;
const trustedTypesFactory = (
  window as unknown as {
    trustedTypes?: {
      createPolicy(
        name: string,
        rules: { createScriptURL(value: string): string },
      ): { createScriptURL(value: string): unknown };
    };
  }
).trustedTypes;
const workerPolicy =
  location.pathname === "/csp"
    ? trustedTypesFactory?.createPolicy("pdfjs-viewer-worker", { createScriptURL: value => value })
    : undefined;
const runtime = new PdfjsViewerRuntime({
  pdfjs: fixturePdfjs,
  workerSrc,
  ...(workerPolicy
    ? {
        workerFactory: source =>
          new Worker(workerPolicy.createScriptURL(source) as string, { type: "module" }),
      }
    : {}),
});
const root = document.querySelector<HTMLElement>("#primary");
if (!root) throw new Error("Missing primary fixture root");

const states: PdfjsViewerState[] = [];
const logs: Readonly<PdfjsViewerLogEntry>[] = [];
const fixtureDeviceCompatibility = [
  {
    engine: "chromium",
    platform: "desktop",
    operatingSystem: "linux",
    nativePrintSupport: "portrait-and-landscape",
    evidenceId: "fixture-linux-chromium",
  },
  {
    engine: "chromium",
    platform: "desktop",
    operatingSystem: "windows",
    nativePrintSupport: "portrait-and-landscape",
    evidenceId: "fixture-windows-chromium",
  },
  {
    engine: "firefox",
    platform: "desktop",
    operatingSystem: "linux",
    nativePrintSupport: "portrait-and-landscape",
    evidenceId: "fixture-linux-firefox",
  },
  {
    engine: "firefox",
    platform: "desktop",
    operatingSystem: "windows",
    nativePrintSupport: "portrait-and-landscape",
    evidenceId: "fixture-windows-firefox",
  },
  {
    engine: "webkit",
    platform: "desktop",
    operatingSystem: "linux",
    nativePrintSupport: "portrait-and-landscape",
    evidenceId: "fixture-linux-webkit",
  },
  {
    engine: "webkit",
    platform: "desktop",
    operatingSystem: "macos",
    nativePrintSupport: "portrait-and-landscape",
    evidenceId: "fixture-macos-webkit",
  },
] as const;
const unsupportedDeviceCompatibility = [
  { engine: "chromium", nativePrintSupport: "unsupported" },
  { engine: "chromium", platform: "desktop", nativePrintSupport: "unsupported" },
  { engine: "firefox", nativePrintSupport: "unsupported" },
  { engine: "firefox", platform: "desktop", nativePrintSupport: "unsupported" },
  { engine: "webkit", nativePrintSupport: "unsupported" },
] as const;
const portraitOnlyDeviceCompatibility = [
  { engine: "chromium", nativePrintSupport: "portrait" },
  { engine: "chromium", platform: "desktop", nativePrintSupport: "portrait" },
  { engine: "firefox", nativePrintSupport: "portrait" },
  { engine: "firefox", platform: "desktop", nativePrintSupport: "portrait" },
  { engine: "webkit", nativePrintSupport: "portrait" },
] as const;
const makeViewer = (
  rootEl: HTMLElement,
  viewerId: string,
  keyboard: "viewer" | "global" = "viewer",
) => {
  const viewer = new PdfjsViewer({
    rootEl,
    runtime,
    ui: "default",
    viewerId,
    keyboard: { scope: keyboard },
    shareableNamedDestinationPrefix: "section:",
    navigationState: createHashNavigationStateAdapter(
      {
        navigationDestinationParam: "section",
      },
      rootEl.ownerDocument.defaultView!,
    ),
    accessibility: { documentLabel: `${viewerId} PDF` },
    renderingProfiles: { balanced: { thumbnailMemoryLimitMiB: 1 } },
    deviceCompatibility: fixtureDeviceCompatibility,
    features: {
      search: { prepareOnLoad: true },
      outline: { prepareOnLoad: true },
      print: { mode: "native" },
    },
    logger: entry => logs.push(entry),
  });
  rootEl.addEventListener("pdf:statechange", event => {
    const state = (event as CustomEvent<PdfjsViewerState>).detail;
    states.push(state);
    rootEl.dataset.status = state.status;
  });
  rootEl.dataset.status = viewer.state.status;
  void viewer.load("/fixture.pdf");
  return viewer;
};

const primary = makeViewer(root, "primary");
let secondary: PdfjsViewer | null = null;
const securityPolicyViolations: string[] = [];
document.addEventListener("securitypolicyviolation", event => {
  securityPolicyViolations.push(
    `${event.violatedDirective}: ${event.blockedURI}; ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}; ${event.sample}`,
  );
});

window.fixture = {
  primary,
  secondary,
  securityPolicyViolations,
  setPrintPermissions(mode) {
    printPermissions = mode;
  },
  onNextPrintPermissionRead(callback) {
    nextPrintPermissionRead = callback;
  },
  failNextOptionalContentAcquisition() {
    rejectNextOptionalContentAcquisition = true;
  },
  async readAcroFormValues(data) {
    const task = PDFJS.getDocument({ data: Uint8Array.from(data) });
    try {
      const pdf = await task.promise;
      const fields = await pdf.getFieldObjects();
      return Object.fromEntries(
        (fields ? [...fields] : []).map(([name, bindings]) => [
          name,
          bindings.map(binding => (binding as { value?: unknown }).value),
        ]),
      );
    } finally {
      await task.destroy();
    }
  },
  states,
  logs,
  stateClasses: PDFJS_VIEWER_STATE_CLASSES,
  addSecondary() {
    if (secondary) return;
    const secondaryRoot = document.createElement("section");
    secondaryRoot.id = "secondary";
    secondaryRoot.className = "viewer-host";
    document.body.append(secondaryRoot);
    secondary = makeViewer(secondaryRoot, "secondary", "global");
    secondary.setActive(false);
    window.fixture.secondary = secondary;
  },
  async addAcroFormViewers() {
    const extended = window as Window & {
      formViewers?: { first: PdfjsViewer; second: PdfjsViewer; third: PdfjsViewer };
    };
    if (extended.formViewers) return;
    const create = (id: string) => {
      const host = document.createElement("section");
      host.id = id;
      host.className = "viewer-host";
      host.style.cssText = "position:relative;width:600px;height:420px";
      if (id === "form-viewer-c") host.innerHTML = '<div class="pdf-container" tabindex="0"></div>';
      document.body.append(host);
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const viewer = new PdfjsViewer({
        rootEl: host,
        runtime,
        ui: id === "form-viewer-a" ? undefined : id === "form-viewer-b" ? "headless" : "custom",
        viewerId: id,
        renderingProfile: "balanced",
        renderingProfiles: { balanced: { maxBufferViewportHeights: 0, maxBufferPages: 0 } },
        features: { search: false, outline: false, thumbnails: true, forms: true },
        logger: entry => logs.push(entry),
      });
      return { viewer, ready, load: viewer.load("/acroform-fixture.pdf") };
    };
    const first = create("form-viewer-a");
    const second = create("form-viewer-b");
    const third = create("form-viewer-c");
    extended.formViewers = { first: first.viewer, second: second.viewer, third: third.viewer };
    const loads = await Promise.all([first.load, second.load, third.load]);
    if (loads.some(load => !load.ok)) throw new Error("AcroForm fixture did not load");
    await Promise.all([first.ready, second.ready, third.ready]);
  },
  async probeSimultaneousXfaPresentation() {
    class Storage {
      onSetModified: (() => void) | null = null;
      onResetModified: (() => void) | null = null;
      onAnnotationEditor: (() => void) | null = null;
      readonly values = new Map<string, Record<string, unknown>>();
      getValue(id: string, fallback: object): object {
        return Object.assign(fallback, this.values.get(id));
      }
      getRawValue(id: string): object | undefined {
        return this.values.get(id);
      }
      has(id: string): boolean {
        return this.values.has(id);
      }
      remove(id: string): void {
        this.values.delete(id);
      }
      setValue(id: string, value: object): void {
        this.values.set(id, { ...this.values.get(id), ...value });
        this.onSetModified?.();
      }
      get size(): number {
        return this.values.size;
      }
      resetModified(): void {
        this.onResetModified?.();
      }
      get print(): this {
        return this;
      }
      get serializable(): object {
        return {};
      }
      get editorStats(): object {
        return {};
      }
      resetModifiedIds(): void {}
      updateEditor(): boolean {
        return false;
      }
      getEditor(): undefined {
        return undefined;
      }
      get modifiedIds(): object {
        return { ids: new Set<string>(), hash: "" };
      }
      [Symbol.iterator](): MapIterator<[string, Record<string, unknown>]> {
        return this.values[Symbol.iterator]();
      }
    }
    const xfaPage = {
      name: "div",
      attributes: { class: ["xfaPage"], style: { width: "612px", height: "792px" } },
      children: [
        {
          name: "label",
          attributes: { id: "shared-label", for: "shared-control", textContent: "Account name" },
          children: [],
        },
        {
          name: "input",
          attributes: {
            id: "shared-control",
            dataId: "shared-storage",
            name: "shared-name",
            value: "Loaded",
            "aria-labelledby": "shared-label",
          },
          children: [],
        },
        {
          name: "input",
          attributes: {
            id: "shared-radio",
            dataId: "shared-radio-storage",
            name: "shared-radio-group",
            type: "radio",
            xfaOn: "yes",
            xfaOff: "no",
          },
          children: [],
        },
      ],
    };
    const xfaPageTwo = {
      name: "div",
      attributes: { class: ["xfaPage"], style: { width: "612px", height: "792px" } },
      children: [
        {
          name: "input",
          attributes: { id: "disabled-control", dataId: "disabled-storage", disabled: true },
          children: [],
        },
        {
          name: "input",
          attributes: { id: "readonly-control", dataId: "readonly-storage", readonly: true },
          children: [],
        },
        {
          name: "input",
          attributes: {
            id: "page-two-control",
            dataId: "page-two-storage",
            name: "page-two-name",
            value: "Page two",
            "aria-label": "Page two field",
          },
          children: [],
        },
      ],
    };
    const create = async () => {
      const storage = new Storage();
      const wrappers = new Map<number, HTMLDivElement>();
      let requestedPage = 0;
      let requestSettlement = Promise.resolve();
      let presentation!: DocumentPresentation;
      const presentPage = async (pageNo: number) => {
        let wrapper = wrappers.get(pageNo);
        if (!wrapper) {
          wrapper = document.createElement("div");
          document.body.append(wrapper);
          wrappers.set(pageNo, wrapper);
        }
        const canvas = document.createElement("canvas");
        const pageStructure = pageNo === 1 ? xfaPage : xfaPageTwo;
        const viewport = PDFJS.XfaLayer.getPageViewport(pageStructure, { scale: 1, rotation: 0 });
        const lease = {
          pageNo,
          wrapper,
          canvas,
          registrationEpoch: 1,
        } as unknown as RenderSurfaceLease;
        await presentation.present({
          documentId: 1,
          pageNo,
          lease,
          viewport,
          page: {
            getXfa: async () => pageStructure,
          } as unknown as import("pdfjs-dist").PDFPageProxy,
          generation: 1,
          capabilities: { annotations: true, text: false },
          isCurrent: capability => capability === "annotations",
          rasterState: {
            optionalContentRevision: 0,
            annotationMode: PDFJS.AnnotationMode.ENABLE_FORMS,
          },
          annotationCanvasMap: new Map(),
        } as RenderPresentationContext);
      };
      presentation = new DocumentPresentation(
        {
          AnnotationLayer: PDFJS.AnnotationLayer,
          XfaLayer: PDFJS.XfaLayer,
          annotationLinkLabel: "PDF link",
          annotationCommentLabel: "Comment",
          annotationAttachmentLabel: "Attachment",
          annotationAttachmentErrorLabel: "Unavailable",
          xfaUnavailableLabel: "XFA unavailable",
          xfaHybridFallbackLabel: "XFA fallback",
          optionalContentActions: false,
          links: { internalDestinations: false, externalUrls: false },
          markup: { enabled: false, popups: false, fileAttachments: false },
          forms: { interactive: true, xfa: true },
        },
        {
          requestFormPage: pageNo => {
            requestedPage = pageNo;
            requestSettlement = presentPage(pageNo);
          },
        },
      );
      const pdf = {
        annotationStorage: storage,
        isPureXfa: true,
        numPages: 2,
        allXfaHtml: { name: "div", attributes: {}, children: [xfaPage, xfaPageTwo] },
        getMetadata: async () => ({ info: { IsXFAPresent: true }, metadata: null }),
        getFieldObjects: async () => null,
      } as unknown as import("pdfjs-dist").PDFDocumentProxy;
      await presentation.beginDocument(pdf);
      await presentPage(1);
      return {
        presentation,
        storage,
        wrapper: wrappers.get(1)!,
        wrappers,
        requestedPage: () => requestedPage,
        waitForRequest: () => requestSettlement,
      };
    };
    const [first, second] = await Promise.all([create(), create()]);
    try {
      const firstControl = first.wrapper.querySelector<HTMLInputElement>(
        'input[type="text"], input:not([type])',
      )!;
      const secondControl = second.wrapper.querySelector<HTMLInputElement>(
        'input[type="text"], input:not([type])',
      )!;
      const firstRadio = first.wrapper.querySelector<HTMLInputElement>('input[type="radio"]')!;
      const secondRadio = second.wrapper.querySelector<HTMLInputElement>('input[type="radio"]')!;
      const label = first.wrapper.querySelector<HTMLLabelElement>("label")!;
      firstControl.value = "First viewer";
      firstControl.dispatchEvent(new InputEvent("input", { bubbles: true }));
      firstRadio.focus();
      firstRadio.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await first.waitForRequest();
      const pageTwoControl = first.wrappers
        .get(2)
        ?.querySelector<HTMLInputElement>('[data-pdf-form-id="page-two-storage"]');
      const forwardFocusRestored =
        first.requestedPage() === 2 && document.activeElement === pageTwoControl;
      pageTwoControl?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
      const snapshot = first.presentation.xfaPrintSnapshot()!;
      const immutableRadioName = snapshot.pages[0]!.xfaHtml.children?.find(
        node => node?.attributes?.type === "radio",
      )?.attributes?.name;
      const printOwner = new DocumentPrint({
        acquireExclusive: async () => ({ release() {} }),
      } as never);
      const originalPrint = window.print;
      window.print = () => {};
      const printResult = await printOwner.print(
        {
          pages: "all",
          layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
          quality: { dpi: 72 },
          sheet: { width: 1400, height: 1000, unit: "pt" },
          pageScaling: "shrink-to-fit",
          orientation: "landscape",
        },
        {
          pdf: { numPages: 2, getOptionalContentConfig: async () => ({ setVisibility() {} }) },
          pages: {
            acquire: async () => {
              throw new Error("XFA print must not acquire raster pages");
            },
          },
          information: { permissions: ["print-high-quality"] },
          geometry: {
            revision: 1,
            layout: { mode: "spread", firstPageSide: "left", gapPt: 0 },
            sizes: [snapshot.pages[0]!.size, snapshot.pages[1]!.size],
            sizeFor: (pageNo: number) => snapshot.pages[pageNo - 1]!.size,
          },
          layerVisibility: null,
          formStorageSnapshot: first.storage.print,
          xfaSnapshot: snapshot,
          revisions: {
            document: 1,
            layers: null,
            forms: first.presentation.formRevision,
            geometry: 1,
          },
          AnnotationMode: PDFJS.AnnotationMode,
          XfaLayer: PDFJS.XfaLayer,
          nativeCapabilities: () => ({
            nativePrintSupport: "portrait",
            engine: "chromium",
            browser: "chrome",
            platform: "desktop",
            operatingSystem: "linux",
            sourceFallbackRecommended: false,
          }),
          signal: new AbortController().signal,
          window,
        } as never,
      );
      const printRoot = document.querySelector<HTMLElement>(".pdf-native-print-root")!;
      const slots = [...printRoot.querySelectorAll<HTMLElement>(".pdf-native-print-slot")];
      const slotsContained =
        slots.length === 2 &&
        slots.every(slot => {
          const child = slot.firstElementChild?.getBoundingClientRect();
          const bounds = slot.getBoundingClientRect();
          return !!child && child.width <= bounds.width + 1 && child.height <= bounds.height + 1;
        });
      const firstSlotBounds = slots[0]?.getBoundingClientRect();
      const firstSheetBounds = slots[0]?.parentElement?.getBoundingClientRect();
      const xfaShrinkCentered =
        !!firstSlotBounds &&
        !!firstSheetBounds &&
        Math.abs(firstSlotBounds.width - (snapshot.pages[0]!.size.height * 4) / 3) < 1 &&
        Math.abs(firstSlotBounds.height - (snapshot.pages[0]!.size.width * 4) / 3) < 1 &&
        firstSlotBounds.left > firstSheetBounds.left &&
        firstSlotBounds.top > firstSheetBounds.top;
      const printXfaRoot = slots[0]?.firstElementChild as HTMLElement | null;
      const printXfaStyle = printXfaRoot ? getComputedStyle(printXfaRoot) : null;
      const printFontBaseline =
        printXfaStyle?.fontSize === "10px" &&
        printXfaStyle.lineHeight === "12px" &&
        printXfaStyle.fontFamily.includes("sans-serif");
      const printedValue = printRoot.querySelector<HTMLInputElement>(
        'input:not([type]), input[type="text"]',
      )?.value;
      const immutableAfter = snapshot.pages[0]!.xfaHtml.children?.find(
        node => node?.attributes?.type === "radio",
      )?.attributes?.name;
      window.dispatchEvent(new Event("afterprint"));
      window.print = originalPrint;
      return {
        domIdsIsolated:
          firstControl.id !== secondControl.id &&
          firstControl.dataset.elementId !== secondControl.dataset.elementId,
        namesIsolated:
          firstControl.name !== secondControl.name && firstRadio.name !== secondRadio.name,
        labelRelationship: label.htmlFor === firstControl.id,
        ariaRelationship: firstControl.getAttribute("aria-labelledby") === label.id,
        accessibleNameDeterministic: label.textContent === "Account name",
        storageIsolated:
          first.storage.values.get("shared-storage")?.value === "First viewer" &&
          !second.storage.values.has("shared-storage"),
        virtualizedForwardTab: forwardFocusRestored,
        reverseTabSkipsUnavailable: document.activeElement === firstRadio,
        xfaPrintInvoked: printResult.ok,
        xfaPrintSlotsContained: slotsContained,
        xfaPrintShrinkCentered: xfaShrinkCentered,
        xfaPrintFontClass: printXfaRoot?.classList.contains("xfaFont") === true,
        xfaPrintFontBaseline: printFontBaseline,
        xfaPrintCurrentValue: printedValue === "First viewer",
        xfaPrintSnapshotImmutable:
          immutableRadioName === "shared-radio-group" && immutableAfter === immutableRadioName,
        xfaPrintCleaned: !document.querySelector(".pdf-native-print-root"),
      };
    } finally {
      first.presentation.reset();
      second.presentation.reset();
      for (const wrapper of first.wrappers.values()) wrapper.remove();
      for (const wrapper of second.wrappers.values()) wrapper.remove();
    }
  },
  activateViewer(viewerId) {
    if (viewerId === "primary") {
      secondary?.setActive(false);
      primary.setActive(true);
      return;
    }
    primary.setActive(false);
    secondary?.setActive(true);
  },
  async replacePrimary() {
    await primary.load("/fixture.pdf?replacement=1");
  },
  async closePrimary() {
    await primary.close();
  },
  async probeNavigationDuringReplacement() {
    const replacement = primary.load("/fixture.pdf?replacement=navigation-probe");
    while (primary.state.status !== "loading") await Promise.resolve();
    let rejected = false;
    try {
      await primary.navigateToPdfNamedDestination("section:two");
    } catch (error) {
      rejected = error instanceof Error;
    }
    await replacement;
    return rejected ? "rejected" : "accepted";
  },
  async probeOverlappingReplacements() {
    const first = primary.load("/fixture.pdf?replacement=overlap-first");
    const second = primary.load("/fixture.pdf?replacement=overlap-second");
    const [firstResult, secondResult] = await Promise.all([first, second]);
    return { state: primary.state, firstResult, secondResult };
  },
  async probeLoadContract() {
    const host = document.createElement("section");
    host.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(host);
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "headless" });
    const order: string[] = [];
    host.addEventListener("pdf:statechange", event => {
      const status = (event as CustomEvent<PdfjsViewerState>).detail.status;
      if (status === "ready" || status === "error") order.push(`state:${status}`);
    });
    host.addEventListener("pdf:ready", () => order.push("ready"));
    host.addEventListener("pdf:error", () => order.push("error"));
    const success = await viewer.load("/fixture.pdf?load-contract=success");
    order.push("success-result");
    const state = viewer.state;
    const readyStateIndex = order.indexOf("state:ready");
    const readyEventIndex = order.indexOf("ready");
    const readyResultIndex = order.indexOf("success-result");
    const successOrdered =
      success.ok &&
      readyStateIndex >= 0 &&
      readyEventIndex > readyStateIndex &&
      readyResultIndex > readyEventIndex;
    const stateFrozen =
      Object.isFrozen(state) &&
      Object.isFrozen(state.print) &&
      Object.isFrozen(state.availableRenderingProfiles);

    const optionsHost = document.createElement("section");
    optionsHost.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(optionsHost);
    const defaults = { withCredentials: true, httpHeaders: { "X-Default": "original" } };
    const optionsViewer = new PdfjsViewer({
      rootEl: optionsHost,
      runtime,
      ui: "headless",
      defaultDocumentOptions: defaults,
    });
    defaults.withCredentials = false;
    defaults.httpHeaders["X-Default"] = "mutated";
    const defaultOptionsLoad = await optionsViewer.load(
      "/fixture.pdf?load-contract-options=default",
    );
    const perLoadOptions = { httpHeaders: { "X-Per-Load": "original" } };
    const perOptionsPromise = optionsViewer.load("/fixture.pdf?load-contract-options=per-load", {
      documentOptions: perLoadOptions,
    });
    perLoadOptions.httpHeaders["X-Per-Load"] = "mutated";
    const perOptionsLoad = await perOptionsPromise;
    const admittedDefaults = admittedLoadOptions.get("/fixture.pdf?load-contract-options=default");
    const admittedPerLoad = admittedLoadOptions.get("/fixture.pdf?load-contract-options=per-load");
    const optionsCopiedAndReplaced =
      defaultOptionsLoad.ok &&
      perOptionsLoad.ok &&
      admittedDefaults?.withCredentials === true &&
      (admittedDefaults.httpHeaders as Record<string, string>)["X-Default"] === "original" &&
      admittedPerLoad?.withCredentials === true &&
      !("X-Default" in (admittedPerLoad.httpHeaders as Record<string, string>)) &&
      (admittedPerLoad.httpHeaders as Record<string, string>)["X-Per-Load"] === "original";
    optionsViewer.destroy();
    optionsHost.remove();

    const closeLoad = viewer.load("/slow-fixture.pdf?load-contract=close");
    const closeOperation = viewer.close();
    const closeResult = await closeLoad;
    await closeOperation;
    const closeCancelled =
      !closeResult.ok &&
      closeResult.reason === "cancelled" &&
      closeResult.cause === "closed" &&
      viewer.state.status === "closed";

    const closeRaceHost = document.createElement("section");
    closeRaceHost.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(closeRaceHost);
    const closeRaceViewer = new PdfjsViewer({ rootEl: closeRaceHost, runtime, ui: "headless" });
    const admissionsBeforeRace = documentLoadAdmissionCount;
    const supersededByClose = closeRaceViewer.load(
      "/slow-fixture.pdf?load-contract=close-race-old",
    );
    while (documentLoadAdmissionCount === admissionsBeforeRace) await Promise.resolve();
    const destroyGate = gateNextLoadingTaskDestroy();
    const delayedClose = closeRaceViewer.close();
    await destroyGate.entered;
    const replacementAfterClose = closeRaceViewer.load("/fixture.pdf?load-contract=close-race-new");
    destroyGate.release();
    const [closedAttempt, replacementAttempt] = await Promise.all([
      supersededByClose,
      replacementAfterClose,
    ]);
    await delayedClose;
    const closeCannotClobberReplacement =
      !closedAttempt.ok &&
      closedAttempt.reason === "cancelled" &&
      closedAttempt.cause === "closed" &&
      replacementAttempt.ok &&
      closeRaceViewer.state.status === "ready";
    closeRaceViewer.destroy();
    closeRaceHost.remove();

    const errorResult = await viewer.load("/invalid-fixture.pdf");
    order.push("error-result");
    const errorOrdered =
      !errorResult.ok &&
      errorResult.reason === "error" &&
      order.slice(-3).join(",") === "state:error,error,error-result";
    const failedDocumentDetached =
      viewer.state.status === "error" &&
      viewer.state.pageCount === 0 &&
      viewer.state.sourceUrl === "/invalid-fixture.pdf" &&
      (await viewer.getDocumentInformation()).ok === false;

    await viewer.close();
    challengeNextPassword = true;
    const passwordHost = document.createElement("section");
    passwordHost.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(passwordHost);
    const passwordViewer = new PdfjsViewer({
      rootEl: passwordHost,
      runtime,
      ui: "headless",
      defaultDocumentOptions: { passwordProvider: async () => null },
    });
    const passwordResult = await passwordViewer.load("/fixture.pdf?load-contract=password");
    const passwordCancelled =
      !passwordResult.ok &&
      passwordResult.reason === "cancelled" &&
      passwordResult.cause === "password-cancelled" &&
      passwordViewer.state.status === "closed";
    passwordViewer.destroy();
    passwordHost.remove();

    const prototypeTask = PDFJS.getDocument({
      url: "/fixture.pdf?load-contract=event-spoof-prototype",
    });
    const prototypePdf = await prototypeTask.promise;
    const prototypePage = await prototypePdf.getPage(1);
    const prototype = Object.getPrototypeOf(prototypePage) as {
      render: typeof prototypePage.render;
    };
    const originalRender = prototype.render;
    let delayedRender = false;
    let releaseRender!: () => void;
    const renderGate = new Promise<void>(resolve => {
      releaseRender = resolve;
    });
    prototype.render = function (parameters) {
      const task = originalRender.call(this, parameters);
      if (delayedRender) return task;
      delayedRender = true;
      return new Proxy(task, {
        get(target, property) {
          if (property === "promise")
            return Promise.all([target.promise, renderGate]).then(() => undefined);
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, property, value) {
          return Reflect.set(target, property, value, target);
        },
      });
    };
    const spoofHost = document.createElement("section");
    spoofHost.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(spoofHost);
    const spoofViewer = new PdfjsViewer({ rootEl: spoofHost, runtime, ui: "headless" });
    let externalEventsCannotSettleLoad = false;
    try {
      const spoofLoad = spoofViewer.load("/fixture.pdf?load-contract=event-spoof");
      const renderDeadline = performance.now() + 2_000;
      while (!delayedRender && performance.now() < renderDeadline)
        await new Promise(resolve => setTimeout(resolve, 0));
      spoofHost.dispatchEvent(new CustomEvent("pdf:ready"));
      const externallySettled = await Promise.race([
        spoofLoad.then(() => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), 50)),
      ]);
      releaseRender();
      const realResult = await Promise.race([
        spoofLoad,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 2_000)),
      ]);
      externalEventsCannotSettleLoad = !externallySettled && realResult?.ok === true;
    } finally {
      releaseRender();
      prototype.render = originalRender;
      spoofViewer.destroy();
      spoofHost.remove();
      prototypePage.cleanup();
      await prototypeTask.destroy();
    }

    const destroyLoad = viewer.load("/slow-fixture.pdf?load-contract=destroy");
    viewer.destroy();
    const destroyResult = await destroyLoad;
    const destroyCancelled =
      !destroyResult.ok &&
      destroyResult.reason === "cancelled" &&
      destroyResult.cause === "destroyed" &&
      viewer.state.status === "destroyed";
    let commandRejected = false;
    try {
      viewer.setActive(false);
    } catch {
      commandRejected = true;
    }
    const information = await viewer.getDocumentInformation();
    const preflight = await viewer.preflightPrint();
    const destroyedQueries =
      !information.ok &&
      information.reason === "destroyed" &&
      !preflight.ok &&
      preflight.reason === "destroyed";
    host.remove();
    return {
      successOrdered,
      stateFrozen,
      optionsCopiedAndReplaced,
      closeCancelled,
      closeCannotClobberReplacement,
      errorOrdered,
      failedDocumentDetached,
      passwordCancelled,
      externalEventsCannotSettleLoad,
      destroyCancelled,
      commandRejected,
      destroyedQueries,
    };
  },
  async probeStalePermissionReplacement() {
    const host = document.createElement("section");
    host.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(host);
    let permissionEntered!: () => void;
    let releasePermission!: () => void;
    const entered = new Promise<void>(resolve => {
      permissionEntered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      releasePermission = resolve;
    });
    printPermissions = "denied";
    nextPrintPermissionRead = () => {
      permissionEntered();
      return gate;
    };
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      deviceCompatibility: fixtureDeviceCompatibility,
      features: {
        search: false,
        outline: false,
        thumbnails: false,
        forms: true,
        print: { mode: "native" },
      },
    });
    const initialLoad = viewer.load("/fixture.pdf?stale-permission=a");
    try {
      await entered;
      printPermissions = "high";
      await viewer.load("/acroform-fixture.pdf?stale-permission=b");
      await initialLoad;
      const inputDeadline = performance.now() + 2_000;
      let inputBefore = host.querySelector<HTMLInputElement>(".textWidgetAnnotation input");
      while (!inputBefore && performance.now() < inputDeadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        inputBefore = host.querySelector<HTMLInputElement>(".textWidgetAnnotation input");
      }
      releasePermission();
      for (let frame = 0; frame < 4; frame++)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const replacementDeadline = performance.now() + 2_000;
      let inputAfter = host.querySelector<HTMLInputElement>(".textWidgetAnnotation input");
      while (!inputAfter && performance.now() < replacementDeadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        inputAfter = host.querySelector<HTMLInputElement>(".textWidgetAnnotation input");
      }
      inputAfter?.focus();
      if (inputAfter) {
        inputAfter.value = "Current document edit";
        inputAfter.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await Promise.resolve();
      return {
        status: viewer.state.status,
        currentPermissionPreserved: viewer.state.canPrint,
        formPresentationPreserved: inputBefore !== null && inputAfter !== null,
        formStatePreserved: viewer.state.formDirty,
      };
    } finally {
      releasePermission();
      viewer.destroy();
      host.remove();
      printPermissions = "runtime";
      nextPrintPermissionRead = null;
    }
  },
  async probeThumbnailVisiblePreemption() {
    const host = document.createElement("section");
    host.className = "viewer-host";
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const prototypeLoadingTask = PDFJS.getDocument({ url: "/fixture.pdf?thumbnail-prototype" });
    const prototypeDocument = await prototypeLoadingTask.promise;
    const prototypePage = await prototypeDocument.getPage(1);
    const prototype = Object.getPrototypeOf(prototypePage) as {
      render: PDFJS.PDFPageProxy["render"];
      readonly pageNumber: number;
    };
    const originalRender = prototype.render;
    const starts: number[] = [];
    const cancellations: number[] = [];
    let releaseStall = () => {};
    let stalled = false;
    let viewer: PdfjsViewer | null = null;
    prototype.render = function (parameters) {
      const task = originalRender.call(this, parameters);
      const canvas = parameters.canvas;
      if (
        !(canvas instanceof HTMLCanvasElement) ||
        !canvas.classList.contains("pdf-thumbnail-canvas")
      )
        return task;
      starts.push(this.pageNumber);
      if (stalled || this.pageNumber !== 1) return task;
      stalled = true;
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      releaseStall = release;
      return {
        promise: task.promise.then(() => gate),
        cancel: (extraDelay?: number) => {
          cancellations.push(this.pageNumber);
          try {
            task.cancel(extraDelay);
          } finally {
            release();
          }
        },
      } as PDFJS.RenderTask;
    };
    try {
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      viewer = new PdfjsViewer({
        rootEl: host,
        runtime,
        ui: "default",
        renderingProfiles: { balanced: { thumbnailMemoryLimitMiB: 1 } },
      });
      void viewer.load("/fixture.pdf?thumbnail-visible-preemption");
      await ready;
      host.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")!.click();
      host.querySelector<HTMLButtonElement>('[data-pdf-sidebar-view="thumbnails"]')!.click();
      const panel = host.querySelector<HTMLElement>(".pdf-thumbnails")!;
      panel.style.setProperty("--pdf-thumbnail-width", "220px");
      // At the bottom both pages 2 and 3 intersect; downward motion must pick page 3.
      panel.style.flex = "0 0 400px";
      panel.style.height = "400px";
      for (let frame = 0; frame < 60 && !starts.includes(1); frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      const firstPlaceholder = panel.querySelector<HTMLCanvasElement>(
        'canvas[data-pdf-page-number="1"]',
      )!;
      const placeholderVisibility = getComputedStyle(firstPlaceholder).visibility;
      panel.scrollTop = panel.scrollHeight;
      panel.dispatchEvent(new Event("scroll"));
      for (let frame = 0; frame < 60 && !starts.includes(3); frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return {
        cancelledOld: cancellations.includes(1),
        firstReplacement: starts.find(pageNo => pageNo !== 1) ?? 0,
        placeholderVisibleBeforeSettlement:
          firstPlaceholder.width === 0 && placeholderVisibility === "visible",
        placeholderWidth: firstPlaceholder.width,
        visibleStarted: starts.includes(3),
      };
    } finally {
      releaseStall();
      prototype.render = originalRender;
      viewer?.destroy();
      prototypePage.cleanup();
      await prototypeLoadingTask.destroy();
      host.remove();
    }
  },
  async probeStalePageRenderReplacement() {
    const host = document.createElement("section");
    host.className = "viewer-host";
    document.body.append(host);
    let replacement: Promise<PdfjsViewerLoadResult> | null = null;
    let oldRenderStarts = 0;
    let viewer: PdfjsViewer | null = null;
    viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
      logger: entry => {
        if (entry.event !== "page-render-started" || replacement || !viewer) return;
        oldRenderStarts++;
        replacement = viewer.load("/replacement-fixture.pdf");
      },
    });
    const initialLoad = viewer.load("/queue-fixture.pdf");
    const deadline = performance.now() + 2_000;
    while (!replacement && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 0));
    if (!replacement)
      throw new Error("Replacement was not started from document A render admission");
    await replacement;
    await initialLoad;
    const activeViewer = viewer;
    if (!activeViewer) throw new Error("Replacement viewer was not initialized");

    const canvasDeadline = performance.now() + 2_000;
    let canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    while (
      (!canvas || canvas.width <= 0 || canvas.height <= 0) &&
      performance.now() < canvasDeadline
    ) {
      await new Promise(resolve => setTimeout(resolve, 16));
      canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    }
    if (!canvas) throw new Error("Replacement document canvas was not created");
    const initial = {
      width: canvas.width,
      height: canvas.height,
      annotationCount: host.querySelectorAll(".pdf-annotation-link").length,
    };
    await new Promise(resolve => setTimeout(resolve, 250));
    canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    const result = {
      status: activeViewer.state.status,
      sourceUrl: activeViewer.state.sourceUrl,
      pageCount: activeViewer.state.pageCount,
      oldRenderStarts,
      replacementAspectRatio: canvas ? canvas.width / canvas.height : 0,
      annotationCount: host.querySelectorAll(".pdf-annotation-link").length,
      surfaceStayedStable:
        !!canvas &&
        canvas.width === initial.width &&
        canvas.height === initial.height &&
        initial.annotationCount === 0,
    };
    activeViewer.destroy();
    host.remove();
    return result;
  },
  async probeLateAttachedRenderReplacement() {
    const host = document.createElement("section");
    host.className = "viewer-host";
    document.body.append(host);
    let replacement: Promise<PdfjsViewerLoadResult> | null = null;
    let replacementScheduled = false;
    let viewer: PdfjsViewer | null = null;
    viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
      logger: entry => {
        if (entry.event !== "page-render-started" || replacementScheduled || !viewer) return;
        replacementScheduled = true;
        queueMicrotask(() => {
          replacement = viewer!.load("/replacement-fixture.pdf");
        });
      },
    });
    const initialLoad = viewer.load("/queue-fixture.pdf");
    const deadline = performance.now() + 2_000;
    while (!replacement && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 0));
    if (!replacement) throw new Error("Replacement was not scheduled after task attachment");
    await replacement;
    await initialLoad;

    let canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    const canvasDeadline = performance.now() + 2_000;
    while (
      (!canvas || canvas.width <= 0 || canvas.height <= 0) &&
      performance.now() < canvasDeadline
    ) {
      await new Promise(resolve => setTimeout(resolve, 16));
      canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    }
    if (!canvas) throw new Error("Replacement document canvas was not created");
    const initial = { width: canvas.width, height: canvas.height };
    await new Promise(resolve => setTimeout(resolve, 250));
    canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    const result = {
      status: viewer.state.status,
      sourceUrl: viewer.state.sourceUrl,
      surfaceStayedStable:
        !!canvas && canvas.width === initial.width && canvas.height === initial.height,
      annotationCount: host.querySelectorAll(".pdf-annotation-link").length,
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  async probeReplacementGeometryIsolation() {
    type RenderStart = {
      renderDpr: number;
      cssWidth: number;
      cssHeight: number;
      bufferWidth: number;
      bufferHeight: number;
      presentationWidth: number;
      presentationHeight: number;
      commitStrategy: string;
    };
    const readStart = (entry: Readonly<PdfjsViewerLogEntry>): RenderStart => ({
      renderDpr: Number(entry.details?.renderDpr),
      cssWidth: Number(entry.details?.cssWidth),
      cssHeight: Number(entry.details?.cssHeight),
      bufferWidth: Number(entry.details?.bufferWidth),
      bufferHeight: Number(entry.details?.bufferHeight),
      presentationWidth: Number(entry.details?.presentationWidth),
      presentationHeight: Number(entry.details?.presentationHeight),
      commitStrategy: String(entry.details?.commitStrategy),
    });
    const waitForReady = (host: HTMLElement) =>
      new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Geometry probe render timed out")),
          3_000,
        );
        host.addEventListener(
          "pdf:ready",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
    const settle = () => new Promise<void>(resolve => window.setTimeout(resolve, 150));

    const replacementHost = document.createElement("section");
    replacementHost.className = "viewer-host";
    document.body.append(replacementHost);
    const replacementStarts: RenderStart[] = [];
    let collectReplacement = false;
    const giantReady = waitForReady(replacementHost);
    const replacementViewer = new PdfjsViewer({
      rootEl: replacementHost,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
      logger: entry => {
        if (collectReplacement && entry.event === "page-render-started")
          replacementStarts.push(readStart(entry));
      },
    });
    void replacementViewer.load("/giant-fixture.pdf");
    await giantReady;
    collectReplacement = true;
    const replacementReady = waitForReady(replacementHost);
    await replacementViewer.load("/replacement-fixture.pdf?geometry-isolation=B");
    await replacementReady;
    await settle();

    const freshHost = document.createElement("section");
    freshHost.className = "viewer-host";
    document.body.append(freshHost);
    const freshStarts: RenderStart[] = [];
    const freshReady = waitForReady(freshHost);
    const freshViewer = new PdfjsViewer({
      rootEl: freshHost,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
      logger: entry => {
        if (entry.event === "page-render-started") freshStarts.push(readStart(entry));
      },
    });
    void freshViewer.load("/replacement-fixture.pdf?geometry-isolation=fresh-B");
    await freshReady;
    await settle();

    const replacementFirst = replacementStarts[0];
    const freshFirst = freshStarts[0];
    const result = {
      replacementRenderStarts: replacementStarts.length,
      freshRenderStarts: freshStarts.length,
      sameFirstPlan:
        !!replacementFirst &&
        !!freshFirst &&
        replacementFirst.renderDpr === freshFirst.renderDpr &&
        replacementFirst.cssWidth === freshFirst.cssWidth &&
        replacementFirst.cssHeight === freshFirst.cssHeight &&
        replacementFirst.bufferWidth === freshFirst.bufferWidth &&
        replacementFirst.bufferHeight === freshFirst.bufferHeight &&
        replacementFirst.presentationWidth === freshFirst.presentationWidth &&
        replacementFirst.presentationHeight === freshFirst.presentationHeight &&
        replacementFirst.commitStrategy === freshFirst.commitStrategy,
      sameCanvasDimensions:
        replacementHost.querySelector<HTMLCanvasElement>(".pdf-page canvas")?.width ===
          freshHost.querySelector<HTMLCanvasElement>(".pdf-page canvas")?.width &&
        replacementHost.querySelector<HTMLCanvasElement>(".pdf-page canvas")?.height ===
          freshHost.querySelector<HTMLCanvasElement>(".pdf-page canvas")?.height,
    };
    replacementViewer.destroy();
    freshViewer.destroy();
    replacementHost.remove();
    freshHost.remove();
    return result;
  },
  async probeInterruptedDocumentInteractions() {
    const container = root.querySelector<HTMLElement>(".pdf-container");
    const searchToggle = root.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn");
    const searchInput = root.querySelector<HTMLInputElement>(".pdf-search-input");
    const searchNext = root.querySelector<HTMLButtonElement>(".pdf-search-next-btn");
    if (!container || !searchToggle || !searchInput || !searchNext)
      throw new Error("Missing interaction fixture UI");

    searchToggle.click();
    searchInput.value = "Page";
    searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Page" }));
    searchInput.focus();
    searchNext.click();
    const imeReplacement = primary.load("/replacement-fixture.pdf?replacement=ime");
    window.visualViewport?.dispatchEvent(new Event("resize"));
    await imeReplacement;
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const replacementFirstPage = root.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
    const imeStable =
      primary.state.currentPage === 1 &&
      !!replacementFirstPage &&
      Math.abs(container.scrollTop - replacementFirstPage.offsetTop) <= 1;

    await primary.load("/fixture.pdf?replacement=interaction-source");
    const interruptedContent = root.querySelector<HTMLElement>(".pdf-content");
    if (!interruptedContent) throw new Error("Missing interaction-source content");
    container.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -160,
        clientX: container.getBoundingClientRect().left + 100,
        clientY: container.getBoundingClientRect().top + 100,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 20 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 100, clientY: 20 }));
    const interactionReplacement = primary.load("/replacement-fixture.pdf?replacement=interaction");
    await interactionReplacement;
    const replacementContent = root.querySelector<HTMLElement>(".pdf-content");
    if (!replacementContent) throw new Error("Missing replacement content");
    const stableTop = container.scrollTop;
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const preGapScale = primary.state.scale;
    const gapReplacement = primary.load("/replacement-fixture.pdf?replacement=interaction-gap");
    container.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -240,
        clientX: container.getBoundingClientRect().left + 80,
        clientY: container.getBoundingClientRect().top + 80,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 80,
        clientY: 80,
      }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 20 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 20 }));
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 1,
        clientX: 80,
        clientY: 80,
      }),
    );
    container.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 120 }),
    );
    container.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, button: 1, clientX: 120, clientY: 120 }),
    );
    const touch = (type: string, pointerId: number, x: number, y: number) =>
      container.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: "touch",
          isPrimary: pointerId === 1,
          clientX: x,
          clientY: y,
        }),
      );
    touch("pointerdown", 1, 60, 60);
    touch("pointerdown", 2, 120, 120);
    touch("pointermove", 2, 180, 180);
    touch("pointerup", 1, 60, 60);
    touch("pointerup", 2, 180, 180);
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        scale: number;
      };
      event.scale = scale;
      container.dispatchEvent(event);
    };
    gesture("gesturestart", 1);
    gesture("gesturechange", 1.8);
    gesture("gestureend", 1.8);
    const slider = root.querySelector<HTMLInputElement>(".pdf-zoom-slider");
    slider?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }));
    if (slider) {
      slider.value = "100";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await gapReplacement;
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const gapContent = root.querySelector<HTMLElement>(".pdf-content");
    if (!gapContent) throw new Error("Missing replacement-gap content");
    const gapFirstPage = gapContent.querySelector<HTMLElement>('.pdf-page[data-page="1"]');
    const longPressHost = document.createElement("section");
    longPressHost.className = "viewer-host";
    document.body.append(longPressHost);
    let longPressViewer: PdfjsViewer | null = null;
    let longPressGenerationSafe = false;
    try {
      const ready = new Promise<void>(resolve =>
        longPressHost.addEventListener("pdf:ready", () => resolve(), { once: true }),
      );
      longPressViewer = new PdfjsViewer({
        rootEl: longPressHost,
        runtime,
        ui: "default",
        behavior: { longPressMs: 0 },
        features: { search: false, outline: false },
      });
      void longPressViewer.load("/fixture.pdf?long-press=A");
      await ready;
      const nextButton = longPressHost.querySelector<HTMLButtonElement>(".pdf-next-page-btn");
      if (!nextButton) throw new Error("Missing long-press next button");
      nextButton.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 21, isPrimary: true }),
      );
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await longPressViewer.load("/fixture.pdf?long-press=B");
      nextButton.click();
      for (let frame = 0; frame < 60 && longPressViewer.state.currentPage !== 2; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      longPressGenerationSafe = longPressViewer.state.currentPage === 2;
    } finally {
      longPressViewer?.destroy();
      longPressHost.remove();
    }
    return {
      status: primary.state.status,
      pageCount: primary.state.pageCount,
      imeStable,
      motionStable: container.scrollTop === stableTop,
      cursorCleared: container.style.cursor === "",
      interruptedTransformCleared:
        interruptedContent.style.transform === "" &&
        interruptedContent.style.transformOrigin === "",
      replacementTransformCleared:
        replacementContent.style.transform === "" &&
        replacementContent.style.transformOrigin === "",
      pinchFlagCleared: !container.classList.contains("pdf-pinch-active"),
      gapCursorCleared: container.style.cursor === "",
      gapTransformCleared:
        gapContent.style.transform === "" && gapContent.style.transformOrigin === "",
      gapPinchFlagCleared: !container.classList.contains("pdf-pinch-active"),
      gapScaleStable: Math.abs(primary.state.scale - preGapScale) < STATE_SCALE_EPSILON,
      gapScrollStable:
        !!gapFirstPage && Math.abs(container.scrollTop - gapFirstPage.offsetTop) <= 1,
      longPressGenerationSafe,
    };
  },
  async probeSupersededNamedDestination() {
    primary.navigateToPage(1);
    const gate = gateNextNamedDestination();
    const pending = primary.navigateToPdfNamedDestination("section:two", {
      spotWithinPage: true,
    });
    await gate.entered;
    primary.navigateToPage(3);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const beforeRelease = primary.state;
    gate.release();
    const result = await pending;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const afterRelease = primary.state;
    const restored = primary.goBack();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return {
      cancelled: !result.ok && result.reason === "cancelled",
      beforeReleasePage: beforeRelease.currentPage,
      afterReleasePage: afterRelease.currentPage,
      afterReleaseCanGoBack: afterRelease.canGoBack,
      restored,
      restoredPage: primary.state.currentPage,
      canGoForward: primary.state.canGoForward,
    };
  },
  async probeNeutralOperationsDuringNamedDestination() {
    const container = root.querySelector<HTMLElement>(".pdf-container");
    const searchToggle = root.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn");
    const searchInput = root.querySelector<HTMLInputElement>(".pdf-search-input");
    if (!container || !searchToggle || !searchInput)
      throw new Error("Missing neutral-navigation UI");
    primary.navigateToPage(1);
    const gate = gateNextNamedDestination();
    const pending = primary.navigateToPdfNamedDestination("section:two", {
      spotWithinPage: true,
      smooth: false,
    });
    await gate.entered;
    primary.nextRow(false);
    primary.nextRow(false);
    container.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    searchToggle.click();
    searchInput.value = "Page";
    searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Page" }));
    gate.release();
    const result = await pending;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return {
      completed: result.ok,
      page: primary.state.currentPage,
      canGoBack: primary.state.canGoBack,
    };
  },
  async probeDeferredHistoryNavigation() {
    const searchToggle = root.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn");
    const searchInput = root.querySelector<HTMLInputElement>(".pdf-search-input");
    const searchNext = root.querySelector<HTMLButtonElement>(".pdf-search-next-btn");
    if (!searchToggle || !searchInput || !searchNext) throw new Error("Missing IME navigation UI");
    primary.navigateToPage(1);
    searchToggle.click();
    searchInput.value = "Page";
    searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Page" }));
    searchInput.focus();
    searchNext.click();
    primary.navigateToPage(3);
    window.visualViewport?.dispatchEvent(new Event("resize"));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const cancelledAtPageThree = primary.state.currentPage === 3 && primary.state.canGoBack;
    const replacement = primary.load("/replacement-fixture.pdf?replacement=history-ime");
    window.visualViewport?.dispatchEvent(new Event("resize"));
    await replacement;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return {
      cancelledAtPageThree,
      replacementAtFirstPage: primary.state.currentPage === 1,
      historyReset: !primary.state.canGoBack && !primary.state.canGoForward,
    };
  },
  async probeEquivalentPlanRefreshReuse() {
    const host = document.createElement("section");
    host.className = "viewer-host";
    document.body.append(host);
    const renderStarts: number[] = [];
    const renderReady = new Promise<void>(resolve =>
      host.addEventListener("pdf:ready", () => resolve(), { once: true }),
    );
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
      logger: entry => {
        if (entry.event === "page-render-started") renderStarts.push(Number(entry.details?.pageNo));
      },
    });
    void viewer.load("/replacement-fixture.pdf");
    await Promise.race([
      renderReady,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Initial page render timed out")), 2_000),
      ),
    ]);
    const container = host.querySelector<HTMLElement>(".pdf-container");
    const canvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    if (!container || !canvas) throw new Error("Missing committed render surface");
    const startsBefore = renderStarts.filter(pageNo => pageNo === 1).length;
    const bitmapBefore = canvas.toDataURL();
    const widthBefore = canvas.width;
    const heightBefore = canvas.height;

    container.scrollTop += 1;
    container.dispatchEvent(new Event("scroll"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 100));

    const currentCanvas = host.querySelector<HTMLCanvasElement>(".pdf-page canvas");
    const result = {
      startsBefore,
      startsAfter: renderStarts.filter(pageNo => pageNo === 1).length,
      sameCanvas: currentCanvas === canvas,
      sameDimensions:
        currentCanvas?.width === widthBefore && currentCanvas?.height === heightBefore,
      sameBitmap: currentCanvas?.toDataURL() === bitmapBefore,
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  async probeStalledFormPreparation() {
    const host = document.createElement("section");
    host.className = "viewer-host";
    document.body.append(host);
    stallNextFormPreparation = true;
    const ready = new Promise<void>(resolve =>
      host.addEventListener("pdf:ready", () => resolve(), { once: true }),
    );
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
    });
    void viewer.load("/fixture.pdf?stalled-form-preparation=1");
    await Promise.race([
      ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Stalled form preparation blocked readiness")), 2_000),
      ),
    ]);
    viewer.setTextSelectionMode(true);
    for (
      let frame = 0;
      frame < 120 &&
      (!host.querySelector(".pdf-text-layer") || !host.querySelector(".pdf-annotation-layer"));
      frame++
    ) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const result = {
      ready: viewer.state.status === "ready",
      raster: host.querySelector<HTMLCanvasElement>(".pdf-page canvas")?.width! > 0,
      text: host.querySelector(".pdf-text-layer") != null,
      annotations: host.querySelector(".pdf-annotation-layer") != null,
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  probeInvalidZoom() {
    let scaleRejected = false;
    let factorRejected = false;
    try {
      primary.zoomTo(Number.NaN);
    } catch {
      scaleRejected = true;
    }
    try {
      primary.zoomBy(0);
    } catch {
      factorRejected = true;
    }
    return { scaleRejected, factorRejected };
  },
  async probeRotationIntent() {
    await primary.resetRotation();
    const cumulativeFirst = gateNextPageAcquisition();
    const cumulativeSecond = gateNextPageAcquisition();
    const cumulativeRequests = [primary.rotateBy(90), primary.rotateBy(90)];
    await Promise.all([cumulativeFirst.entered, cumulativeSecond.entered]);
    cumulativeFirst.release();
    cumulativeSecond.release();
    await Promise.all(cumulativeRequests);
    const cumulative = primary.state.rotation;

    await primary.resetRotation();
    const mixedFirst = gateNextPageAcquisition();
    const mixedSecond = gateNextPageAcquisition();
    const mixedRequests = [primary.rotateTo(270), primary.rotateBy(90)];
    await Promise.all([mixedFirst.entered, mixedSecond.entered]);
    mixedFirst.release();
    mixedSecond.release();
    await Promise.all(mixedRequests);
    const mixed = primary.state.rotation;

    const staleFirst = gateNextPageAcquisition();
    const staleSecond = gateNextPageAcquisition();
    const staleRequest = primary.rotateTo(90);
    const pendingRequest = primary.rotateTo(180);
    await Promise.all([staleFirst.entered, staleSecond.entered]);
    staleFirst.release(new Error("Fixture stale rotation preparation failure"));
    await staleRequest.catch(() => {});
    await primary.rotateBy(90);
    staleSecond.release();
    await pendingRequest;
    const staleFailure = primary.state.rotation;
    return { cumulative, mixed, staleFailure };
  },
  async probeDestroyedFitMode() {
    const host = document.createElement("section");
    document.body.append(host);
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "headless" });
    let changes = 0;
    host.addEventListener("pdf:statechange", () => {
      changes++;
    });
    const before = viewer.state.fitMode;
    viewer.destroy();
    changes = 0;
    let validRejected = false;
    try {
      await viewer.setFitMode("width");
    } catch (error) {
      validRejected = error instanceof Error;
    }
    const after = viewer.state.fitMode;
    let invalidRejected = false;
    try {
      await viewer.setFitMode("invalid" as never);
    } catch (error) {
      invalidRejected = error instanceof Error;
    }
    host.remove();
    return { before, after, changes, validRejected, invalidRejected };
  },
  probeInvalidBehaviorOptions() {
    const probe = (behavior: ConstructorParameters<typeof PdfjsViewer>[0]["behavior"]) => {
      const host = document.createElement("section");
      document.body.append(host);
      try {
        new PdfjsViewer({ rootEl: host, runtime, ui: "default", behavior });
        return false;
      } catch (error) {
        return error instanceof RangeError || error instanceof TypeError;
      } finally {
        host.remove();
      }
    };
    return {
      zoomRejected: probe({ zoom: { minDesktop: Number.NaN } }),
      longPressRejected: probe({ longPressMs: -1 }),
      sidebarModeRejected: probe({ sidebarMode: "invalid" as "auto" }),
      zoomGesturesRejected: probe({ zoomGestures: "yes" as never }),
      documentVisibilityPolicyRejected: probe({
        reduceRenderingWhenDocumentHidden: "yes" as never,
      }),
      searchPolicyRejected: probe({ searchQueryOptions: { caseSensitive: "yes" as never } }),
      outlinePolicyRejected: probe({ outlineFilterOptions: { diacritics: "fold" as never } }),
      removedMatchingPolicyRejected: probe({ ignoreDiacriticsInSearches: true } as never),
      destinationToleranceRejected: probe({ destinationMatchTolerance: -1 }),
      removedOutlineToleranceRejected: probe({ outlineDestinationTolerance: 0.1 } as never),
    };
  },
  async probeDocumentVisibilityOptOut() {
    const host = document.createElement("section");
    host.style.cssText = "position:relative;width:600px;height:420px";
    document.body.append(host);
    const localLogs: Readonly<PdfjsViewerLogEntry>[] = [];
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      behavior: { reduceRenderingWhenDocumentHidden: false },
      logger: entry => localLogs.push(entry),
    });
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    try {
      const result = await viewer.load("/fixture.pdf?visibility-opt-out");
      if (!result.ok) throw new Error("Visibility opt-out fixture did not load");
      const rendered = () =>
        [...host.querySelectorAll<HTMLCanvasElement>(".pdf-page canvas")].filter(
          canvas => canvas.width > 0 && canvas.height > 0,
        ).length;
      const before = rendered();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      return {
        active: viewer.state.active,
        before,
        after: rendered(),
        visibilityDiagnostic: localLogs.some(
          entry => entry.event === "document-visibility-changed",
        ),
      };
    } finally {
      if (originalVisibility)
        Object.defineProperty(document, "visibilityState", originalVisibility);
      else Reflect.deleteProperty(document, "visibilityState");
      document.dispatchEvent(new Event("visibilitychange"));
      viewer.destroy();
      host.remove();
    }
  },
  async probeSidebarBehavior(mode) {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      behavior: { sidebarMode: mode },
    });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    const load = await viewer.load("/fixture.pdf");
    if (!load.ok) throw new Error("Sidebar behavior fixture did not load");
    await ready;
    host.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")?.click();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const remainsOpen = host.querySelector<HTMLElement>(".pdf-sidebar")?.dataset.open === "true";
    viewer.destroy();
    host.remove();
    return remainsOpen;
  },
  probeInvalidConstructorOptions() {
    const probe = (options: Record<string, unknown>) => {
      const host = document.createElement("section");
      document.body.append(host);
      try {
        new PdfjsViewer({ rootEl: host, runtime, ui: "default", ...options } as never);
        return false;
      } catch (error) {
        return error instanceof TypeError || error instanceof RangeError;
      } finally {
        host.remove();
      }
    };
    const probeSource = (source: unknown) => {
      const host = document.createElement("section");
      document.body.append(host);
      try {
        const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "default" });
        viewer.load(source as never);
        return false;
      } catch (error) {
        return error instanceof TypeError || error instanceof RangeError;
      } finally {
        host.remove();
      }
    };
    return {
      sourceRejected: probeSource(""),
      emptyUint8ArrayRejected: probeSource(new Uint8Array()),
      emptyArrayBufferRejected: probeSource(new ArrayBuffer(0)),
      emptyUrlDescriptorRejected: probeSource({ type: "url", url: "" }),
      emptyDataDescriptorRejected: probeSource({ type: "data", data: new Uint8Array() }),
      malformedSourceDescriptorRejected: probeSource({
        type: "url",
        url: "/fixture.pdf",
        data: new Uint8Array([1]),
      }),
      viewerIdRejected: probe({ viewerId: 1 }),
      navigationRejected: probe({
        navigationState: {
          readNavigationDestinationId: null,
          writeNavigationDestinationId() {},
        },
      }),
      bindingRejected: probe({
        uiBindings: { navigation: { previous: document.createElement("div") } },
      }),
      featureRejected: probe({ features: { annotationLinks: { externalUrls: "yes" } } }),
      navigationHistoryFeatureRejected: probe({ features: { navigationHistory: "yes" } }),
      printFeatureRejected: probe({ features: { print: { mode: "yes" } } }),
      printBooleanRejected: probe({ features: { print: true } }),
      adapterMissingRejected: probe({ features: { print: "adapter" } }),
      adapterWrongModeRejected: probe({
        features: { print: "browser" },
        printAdapter: () => ({ status: "adapter-completed" }),
      }),
      removedNativeQualificationsRejected: probe({
        features: { print: { nativeQualifications: [] } },
      }),
      removedNativePolicyRejected: probe({
        features: { print: { nativePolicy: "allow-unqualified" } },
      }),
      browserFallbackTypeRejected: probe({
        features: { print: { mode: "native", browserFallback: "no" } },
      }),
      browserFallbackWrongModeRejected: probe({
        features: { print: { mode: "browser", browserFallback: false } },
      }),
      printDefaultsQualityRejected: probe({
        features: { print: { defaults: { quality: { dpi: 150 } } } },
      }),
      printDefaultsScalingRejected: probe({
        features: { print: { defaults: { pageScaling: "actual" } } },
      }),
      compatibilityArrayRejected: probe({ deviceCompatibility: {} }),
      compatibilityEngineRejected: probe({
        deviceCompatibility: [{ platform: "desktop", nativePrintSupport: "portrait" }],
      }),
      compatibilitySupportRejected: probe({
        deviceCompatibility: [{ engine: "chromium", nativePrintSupport: "all" }],
      }),
      enableXfaEscapeHatchRejected: probe({ defaultDocumentOptions: { enableXfa: true } }),
      preparationPolicyRejected: probe({ features: { search: { prepareOnLoad: "yes" } } }),
      removedTopLevelOptionRejected: probe({ ignoreDiacriticsInSearches: false }),
      removedNamedDestinationPrefixRejected: probe({ namedDestinationPrefix: "section:" }),
      uiControlRejected: probe({ ui: { mode: "default", controls: { print: "yes" } } }),
      navigationHistoryControlRejected: probe({
        ui: { mode: "default", controls: { navigationHistory: "yes" } },
      }),
      printLimitsRejected: probe({ printLimits: { maxSheets: 1 } }),
      unknownPrimaryViewRejected: probe({
        ui: { mode: "default", sidebar: { primaryViews: ["unknown-view"] } },
      }),
      duplicatePrimaryViewRejected: probe({
        ui: { mode: "default", sidebar: { primaryViews: ["outline", "outline"] } },
      }),
    };
  },
  async probeDeferredInitialLoad() {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
    });
    const before = viewer.state;
    const controlsDisabled = [
      host.querySelector<HTMLButtonElement>(".pdf-prev-page-btn"),
      host.querySelector<HTMLInputElement>(".pdf-page-number-input"),
      host.querySelector<HTMLButtonElement>(".pdf-next-page-btn"),
      host.querySelector<HTMLButtonElement>(".pdf-menu-toggle-btn"),
    ].every(control => control?.disabled === true);
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    const load = await viewer.load("/fixture.pdf", { initialPage: 2 });
    if (!load.ok) throw new Error("Deferred initial load fixture did not load");
    await ready;
    for (let frame = 0; frame < 20 && viewer.state.currentPage !== 2; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const after = viewer.state;
    viewer.destroy();
    host.remove();
    return {
      initialStatus: before.status,
      initialPageCount: before.pageCount,
      initialSourceUrl: before.sourceUrl,
      controlsDisabled,
      loadedStatus: after.status,
      loadedPageCount: after.pageCount,
      loadedCurrentPage: after.currentPage,
      loadedSourceUrl: after.sourceUrl,
    };
  },
  async probeSourceDescriptors() {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    let printFilename: string | null = null;
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      features: { print: "adapter" },
      printAdapter: context => {
        printFilename = context.sourceFilename;
        return { status: "adapter-completed" };
      },
    });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    await viewer.load({ type: "url", url: "/fixture.pdf", filename: "fixture-name.pdf" });
    await ready;
    const state = viewer.state;
    const download = host.querySelector<HTMLAnchorElement>(".pdf-download-btn");
    const downloadTarget = download?.target ?? null;
    const downloadRel = download?.rel ?? null;
    await viewer.print();
    viewer.destroy();
    host.remove();
    return {
      sourceUrl: state.sourceUrl,
      sourceFilename: state.sourceFilename,
      printFilename,
      downloadTarget,
      downloadRel,
    };
  },
  async probeDestroyedDownloadControl() {
    const host = document.createElement("section");
    host.innerHTML = '<a class="pdf-download-btn">Download</a><div class="pdf-container"></div>';
    document.body.append(host);
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "custom" });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    const load = await viewer.load("/fixture.pdf");
    if (!load.ok) throw new Error("Destroyed download control fixture did not load");
    await ready;
    const download = host.querySelector<HTMLAnchorElement>(".pdf-download-btn")!;
    const activeBeforeDestroy =
      download.hasAttribute("href") && download.target === "_blank" && download.rel === "noopener";
    viewer.destroy();
    const disabledAfterDestroy =
      !download.hasAttribute("href") &&
      !download.hasAttribute("download") &&
      !download.hasAttribute("target") &&
      !download.hasAttribute("rel") &&
      download.getAttribute("aria-disabled") === "true";
    host.remove();
    return { activeBeforeDestroy, disabledAfterDestroy };
  },
  async probePrintAdapterData() {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const source = await fetch("/fixture.pdf").then(response => response.arrayBuffer());
    const sourceSize = source.byteLength;
    let adapterSourceUrl: string | null = "unset";
    let adapterFilename: string | null = null;
    let adapterDataSize = 0;
    let currentValueDataSize = 0;
    let adapterDataDetached = false;
    let adapterFormDirty = true;
    let adapterErrorName: string | null = null;
    let adapterCalls = 0;
    let normalizedOptions: unknown = null;
    const forwardedAbort = new AbortController();
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      features: { print: "adapter" },
      printAdapter: async context => {
        adapterCalls++;
        adapterSourceUrl = context.sourceUrl;
        adapterFilename = context.sourceFilename;
        adapterFormDirty = context.formDirty;
        if (adapterCalls === 1) {
          normalizedOptions = {
            pages: context.options.pages,
            layout: context.options.layout,
            quality: context.options.quality,
            sheet: context.options.sheet,
            orientation: context.options.orientation,
            signalForwarded: context.options.signal === forwardedAbort.signal,
          };
        }
        try {
          const original = await context.getDocumentData({ document: "original" });
          adapterDataSize = original.byteLength;
          if (adapterCalls === 1) {
            const current = await context.getDocumentData({ document: "with-form-values" });
            currentValueDataSize = current.byteLength;
            adapterDataDetached = original !== current;
          }
        } catch (error) {
          adapterErrorName = error instanceof DOMException ? error.name : "unknown";
        }
        return { status: "adapter-completed" };
      },
    });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    await viewer.load({ type: "data", data: source, filename: "print-memory.pdf" });
    await ready;
    const canPrint = viewer.state.canPrint;
    const started = await viewer.print({
      pages: [
        { from: 2, to: 3 },
        { from: 1, to: 1 },
      ],
      layout: { mode: "spread", firstPageSide: "right" },
      quality: { dpi: 300 },
      sheet: { width: 297, height: 210, unit: "mm" },
      orientation: "landscape",
      signal: forwardedAbort.signal,
    });
    const preAborted = new AbortController();
    preAborted.abort();
    const callsBeforePreAbort = adapterCalls;
    const preAbortResult = await viewer.print({ signal: preAborted.signal });
    const cancellationGate = gateNextDocumentDataRead();
    const pendingPrint = viewer.print();
    await cancellationGate.entered;
    const replacement = viewer.load("/replacement-fixture.pdf");
    const cancellationSettledPromptly = await Promise.race([
      pendingPrint.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    cancellationGate.release();
    await replacement;
    viewer.destroy();
    host.remove();
    return {
      canPrint,
      started: started.ok && started.status === "adapter-completed",
      adapterSourceUrl,
      adapterFilename,
      adapterDataSize,
      currentValueDataSize,
      adapterDataDetached,
      adapterFormDirty,
      dataSizeMatches: adapterDataSize === sourceSize,
      normalizedOptions,
      preAbortCancelled: !preAbortResult.ok && preAbortResult.reason === "cancelled",
      preAbortSkippedAdapter: adapterCalls === callsBeforePreAbort + 1,
      cancellationSettledPromptly,
      adapterErrorName,
    };
  },
  async probePrintAdapterRevision() {
    printPermissions = "high";
    const host = document.createElement("section");
    host.style.cssText = "width:600px;height:420px";
    document.body.append(host);
    let adapterBytes: Uint8Array | null = null;
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      features: { search: false, outline: false, thumbnails: false, forms: true, print: "adapter" },
      printAdapter: async context => {
        adapterBytes = await context.getDocumentData({ document: "with-form-values" });
        return { status: "adapter-completed" };
      },
    });
    const load = await viewer.load("/acroform-fixture.pdf");
    if (!load.ok) throw new Error("Print adapter fixture did not load");
    await new Promise<void>((resolve, reject) => {
      if (viewer.state.status === "ready") {
        resolve();
        return;
      }
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    for (let frame = 0; frame < 60 && !host.querySelector(".textWidgetAnnotation input"); frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const input = host.querySelector<HTMLInputElement>(".textWidgetAnnotation input");
    if (!input) throw new Error("AcroForm control did not materialize");
    input.value = "admitted revision";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    nextPrintPermissionRead = () => {
      input.value = "later revision";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const result = await viewer.print();
    const capturedBytes = adapterBytes as Uint8Array | null;
    const values = capturedBytes ? await window.fixture.readAcroFormValues(capturedBytes) : {};
    const serialized = JSON.stringify(values);
    const detached = capturedBytes ? Uint8Array.from(capturedBytes) : null;
    if (capturedBytes) capturedBytes[0] = 0;
    viewer.destroy();
    host.remove();
    printPermissions = "runtime";
    return {
      result,
      visibleValue: input.value,
      admittedValueSerialized: serialized.includes("admitted revision"),
      laterValueExcluded: !serialized.includes("later revision"),
      detachedBytes: !!detached && detached[0] !== capturedBytes?.[0],
    };
  },
  async probePrintFeaturePolicies() {
    const makeHost = () => {
      const host = document.createElement("section");
      host.style.cssText = "width:600px;height:600px";
      document.body.append(host);
      return host;
    };
    const ready = (host: HTMLElement) =>
      new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });

    printPermissions = "high";
    const routeLogs: Readonly<PdfjsViewerLogEntry>[] = [];
    const offHost = makeHost();
    const offViewer = new PdfjsViewer({
      rootEl: offHost,
      runtime,
      ui: "default",
      keyboard: false,
      features: { print: "off" },
    });
    void offViewer.load("/fixture.pdf");
    await ready(offHost);
    const offPrint = await offViewer.print();
    const offSource = await offViewer.openPrintSource();

    const browserHost = makeHost();
    const browserViewer = new PdfjsViewer({
      rootEl: browserHost,
      runtime,
      ui: "default",
      keyboard: false,
      features: { print: "browser" },
      logger: entry => routeLogs.push(entry),
    });
    void browserViewer.load("/fixture.pdf");
    await ready(browserHost);
    const originalOpen = window.open;
    let openedSources = 0;
    window.open = (() => ({
      opener: window,
      closed: false,
      close() {},
      location: {
        replace() {
          openedSources++;
        },
      },
    })) as unknown as typeof window.open;
    browserHost.querySelector<HTMLButtonElement>(".pdf-print-btn")!.click();
    for (let attempt = 0; attempt < 20 && openedSources < 1; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve));
    }

    const adapterHost = makeHost();
    let adapterCalls = 0;
    const adapterViewer = new PdfjsViewer({
      rootEl: adapterHost,
      runtime,
      ui: "default",
      keyboard: false,
      features: { print: "adapter" },
      printAdapter: () => {
        adapterCalls++;
        return { status: "adapter-completed" };
      },
    });
    void adapterViewer.load("/fixture.pdf");
    await ready(adapterHost);
    adapterHost.querySelector<HTMLButtonElement>(".pdf-print-btn")!.click();
    await new Promise<void>(resolve => setTimeout(resolve));

    const fallbackHost = makeHost();
    const fallbackViewer = new PdfjsViewer({
      rootEl: fallbackHost,
      runtime,
      ui: "default",
      keyboard: false,
      deviceCompatibility: unsupportedDeviceCompatibility,
      features: { print: "native" },
      logger: entry => routeLogs.push(entry),
    });
    void fallbackViewer.load("/fixture.pdf");
    await ready(fallbackHost);
    const fallbackPrint = await fallbackViewer.print();

    const deniedHost = makeHost();
    const deniedViewer = new PdfjsViewer({
      rootEl: deniedHost,
      runtime,
      ui: "default",
      keyboard: false,
      deviceCompatibility: unsupportedDeviceCompatibility,
      features: { print: { mode: "native", browserFallback: false } },
    });
    void deniedViewer.load("/fixture.pdf");
    await ready(deniedHost);
    const deniedPreflight = await deniedViewer.preflightPrint({ quality: { dpi: 72 } });
    const deniedPrint = await deniedViewer.print();
    const deniedSource = await deniedViewer.openPrintSource();

    const portraitHost = makeHost();
    const portraitViewer = new PdfjsViewer({
      rootEl: portraitHost,
      runtime,
      ui: "default",
      keyboard: false,
      deviceCompatibility: portraitOnlyDeviceCompatibility,
      features: { print: "native" },
    });
    void portraitViewer.load("/fixture.pdf");
    await ready(portraitHost);
    const portraitPreflight = await portraitViewer.preflightPrint({ quality: { dpi: 72 } });
    const portraitLayout = portraitHost.querySelector<HTMLSelectElement>(".pdf-print-layout")!;
    const portraitLayoutOptions = [...portraitLayout.options]
      .filter(option => !option.disabled && !option.hidden)
      .map(option => option.value);
    const portraitLayoutHelp =
      portraitHost.querySelector<HTMLElement>(".pdf-print-layout-help")!.textContent;
    portraitViewer.setUiText({ labels: { printLayoutAutoHelp: "Automatic layout X" } });
    const updatedPortraitLayoutHelp =
      portraitHost.querySelector<HTMLElement>(".pdf-print-layout-help")!.textContent;
    const portraitSideHidden = portraitHost.querySelector<HTMLElement>(".pdf-print-side")!.hidden;

    const customPortraitHost = makeHost();
    customPortraitHost.innerHTML = renderPdfjsViewerUi({
      id: "custom-portrait-print",
      variant: "custom",
    });
    const customPortraitViewer = new PdfjsViewer({
      rootEl: customPortraitHost,
      runtime,
      ui: "custom",
      keyboard: false,
      deviceCompatibility: portraitOnlyDeviceCompatibility,
      features: { print: "native" },
    });
    void customPortraitViewer.load("/fixture.pdf");
    await ready(customPortraitHost);
    const customPortraitLayout =
      customPortraitHost.querySelector<HTMLSelectElement>(".pdf-print-layout")!;
    const customPortraitLayoutOptions = [...customPortraitLayout.options]
      .filter(option => !option.disabled && !option.hidden)
      .map(option => option.value);
    const customPortraitLayoutHelp =
      customPortraitHost.querySelector<HTMLElement>(".pdf-print-layout-help")!.textContent;
    const customPortraitSideHidden =
      customPortraitHost.querySelector<HTMLElement>(".pdf-print-side")!.hidden;

    const customHost = makeHost();
    customHost.innerHTML =
      '<button class="pdf-print-btn" aria-haspopup="dialog" aria-controls="owned-print">Print</button><dialog id="owned-print" class="pdf-print-setup"></dialog><div class="pdf-container"></div>';
    const customDialog = customHost.querySelector("dialog")!;
    const customViewer = new PdfjsViewer({
      rootEl: customHost,
      runtime,
      ui: "custom",
      keyboard: false,
      deviceCompatibility: unsupportedDeviceCompatibility,
      features: { print: "native" },
    });
    void customViewer.load("/fixture.pdf");
    await ready(customHost);

    window.open = originalOpen;
    const buttonLog = routeLogs.find(
      entry => entry.event === "print-route-selected" && entry.details?.trigger === "button",
    );
    const publicFallbackLog = routeLogs.find(
      entry =>
        entry.event === "print-route-selected" &&
        entry.details?.trigger === "public-api" &&
        entry.details?.configuredMode === "native",
    );
    const result = {
      offControlAbsent: !offHost.querySelector(".pdf-print-btn"),
      offCanPrint: offViewer.state.canPrint,
      offPrintReason: offPrint.ok ? "unexpected" : offPrint.reason,
      offSourceReason: offSource.ok ? "unexpected" : offSource.reason,
      browserCanPrint: browserViewer.state.canPrint,
      browserSetupAbsent: !browserHost.querySelector(".pdf-print-setup"),
      browserDialogAriaAbsent: !browserHost
        .querySelector(".pdf-print-btn")
        ?.hasAttribute("aria-haspopup"),
      openedSources,
      adapterCalls,
      adapterSetupAbsent: !adapterHost.querySelector(".pdf-print-setup"),
      fallbackStatus: fallbackPrint.ok ? fallbackPrint.status : fallbackPrint.reason,
      fallbackSetupAbsent: !fallbackHost.querySelector(".pdf-print-setup"),
      deniedCanPrint: deniedViewer.state.canPrint,
      deniedButtonHidden: deniedHost.querySelector<HTMLButtonElement>(".pdf-print-btn")!.hidden,
      deniedSetupAbsent: !deniedHost.querySelector(".pdf-print-setup"),
      deniedPreflight: deniedPreflight.ok
        ? "unexpected"
        : {
            reason: deniedPreflight.reason,
            sourceFallbackAvailable: deniedPreflight.sourceFallbackAvailable,
            nativePrintSupport: deniedPreflight.nativeCapabilities?.nativePrintSupport ?? null,
          },
      deniedPrint,
      deniedSource,
      portraitSetupPresent: !!portraitHost.querySelector(".pdf-print-setup"),
      portraitSupport: portraitPreflight.ok
        ? portraitPreflight.nativeCapabilities.nativePrintSupport
        : null,
      portraitLayoutOptions,
      portraitLayoutHelp,
      updatedPortraitLayoutHelp,
      portraitSideHidden,
      customPortraitLayoutOptions,
      customPortraitLayoutHelp,
      customPortraitSideHidden,
      customDialogPreserved: customDialog.isConnected,
      customDialogUnbound: !customDialog.open,
      customDialogAriaRemoved: !customHost
        .querySelector(".pdf-print-btn")
        ?.hasAttribute("aria-controls"),
      buttonLogValid:
        buttonLog?.details?.configuredMode === "browser" &&
        buttonLog.details?.route === "browser" &&
        buttonLog.details?.fallback === false,
      publicFallbackLogValid:
        publicFallbackLog?.details?.route === "browser" &&
        publicFallbackLog.details?.fallback === true &&
        (
          publicFallbackLog.details?.capabilities as
            { nativePrintSupport?: string } | null | undefined
        )?.nativePrintSupport === "unsupported",
    };
    printPermissions = "runtime";
    offViewer.destroy();
    browserViewer.destroy();
    adapterViewer.destroy();
    fallbackViewer.destroy();
    deniedViewer.destroy();
    portraitViewer.destroy();
    customPortraitViewer.destroy();
    customViewer.destroy();
    offHost.remove();
    browserHost.remove();
    adapterHost.remove();
    fallbackHost.remove();
    deniedHost.remove();
    portraitHost.remove();
    customPortraitHost.remove();
    customHost.remove();
    return result;
  },
  async probeDeviceCompatibility() {
    printPermissions = "high";
    const viewers: PdfjsViewer[] = [];
    const hosts: HTMLElement[] = [];
    const create = async (deviceCompatibility?: readonly PdfjsViewerDeviceCompatibilityRule[]) => {
      const host = document.createElement("section");
      host.style.cssText = "width:600px;height:600px";
      document.body.append(host);
      hosts.push(host);
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const viewer = new PdfjsViewer({
        rootEl: host,
        runtime,
        ui: "headless",
        keyboard: false,
        ...(deviceCompatibility ? { deviceCompatibility } : {}),
        features: { print: { mode: "native" } },
      });
      const load = await viewer.load("/fixture.pdf");
      if (!load.ok) throw new Error("Print route fixture did not load");
      viewers.push(viewer);
      await ready;
      return viewer;
    };
    const defaultViewer = await create();
    const defaultBefore = await defaultViewer.preflightPrint({ quality: { dpi: 72 } });
    const desktopViewer = await create([
      {
        engine: "chromium",
        platform: "desktop",
        nativePrintSupport: "portrait",
        evidenceId: "browser-desktop-portrait",
      },
    ]);
    const desktop = await desktopViewer.preflightPrint({ quality: { dpi: 72 } });

    const ownUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
    });
    let androidDefault: Awaited<ReturnType<PdfjsViewer["preflightPrint"]>> | undefined;
    let androidAuto: Awaited<ReturnType<PdfjsViewer["preflightPrint"]>> | undefined;
    let androidSpread: Awaited<ReturnType<PdfjsViewer["preflightPrint"]>> | undefined;
    let firefoxAndroidSingle: Awaited<ReturnType<PdfjsViewer["preflightPrint"]>> | undefined;
    let firefoxAndroidSpread: Awaited<ReturnType<PdfjsViewer["preflightPrint"]>> | undefined;
    try {
      const androidViewer = await create();
      androidDefault = await androidViewer.preflightPrint({
        quality: { dpi: 72 },
        layout: { mode: "spread" },
        sheet: "a4",
        orientation: "landscape",
      });
      androidAuto = await androidViewer.preflightPrint({
        quality: { dpi: 72 },
        layout: { mode: "auto" },
      });
      const androidSpreadViewer = await create([
        {
          engine: "chromium",
          platform: "android",
          nativePrintSupport: "portrait-and-landscape",
          evidenceId: "browser-android-landscape",
        },
      ]);
      androidSpread = await androidSpreadViewer.preflightPrint({
        quality: { dpi: 72 },
        layout: { mode: "spread" },
        sheet: "a4",
        orientation: "landscape",
      });
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Android 16; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0",
      });
      const firefoxViewer = await create();
      firefoxAndroidSingle = await firefoxViewer.preflightPrint({ quality: { dpi: 72 } });
      firefoxAndroidSpread = await firefoxViewer.preflightPrint({
        quality: { dpi: 72 },
        layout: { mode: "spread" },
      });
    } finally {
      if (ownUserAgent) Object.defineProperty(navigator, "userAgent", ownUserAgent);
      else delete (navigator as unknown as { userAgent?: string }).userAgent;
    }
    const defaultAfter = await defaultViewer.preflightPrint({ quality: { dpi: 72 } });
    for (const viewer of viewers) viewer.destroy();
    for (const host of hosts) host.remove();
    printPermissions = "runtime";
    return {
      defaultBefore: defaultBefore.ok ? defaultBefore.nativeCapabilities : null,
      desktop: desktop.ok ? desktop.nativeCapabilities : null,
      androidDefault: androidDefault?.ok
        ? {
            orientation: androidDefault.orientation,
            layout: androidDefault.layout,
            support: androidDefault.nativeCapabilities.nativePrintSupport,
          }
        : androidDefault?.reason,
      androidAuto: androidAuto?.ok
        ? { layout: androidAuto.layout, support: androidAuto.nativeCapabilities.nativePrintSupport }
        : null,
      androidSpread: androidSpread?.ok ? androidSpread.nativeCapabilities : null,
      firefoxAndroidSingle: firefoxAndroidSingle?.ok
        ? firefoxAndroidSingle.nativeCapabilities
        : null,
      firefoxAndroidSpread: firefoxAndroidSpread?.ok
        ? {
            orientation: firefoxAndroidSpread.orientation,
            layout: firefoxAndroidSpread.layout,
            support: firefoxAndroidSpread.nativeCapabilities.nativePrintSupport,
          }
        : firefoxAndroidSpread?.reason,
      defaultAfter: defaultAfter.ok ? defaultAfter.nativeCapabilities : null,
    };
  },
  async probeAuthenticatedPrintSource() {
    printPermissions = "high";
    const createHost = () => {
      const host = document.createElement("section");
      host.style.cssText = "width:600px;height:600px";
      document.body.append(host);
      return host;
    };
    const waitReady = (host: HTMLElement) =>
      new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
    const host = createHost();
    const ready = waitReady(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      keyboard: false,
      defaultDocumentOptions: { httpHeaders: { Authorization: "fixture-token" } },
    });
    const load = await viewer.load("/fixture.pdf");
    if (!load.ok) throw new Error("Print source fixture did not load");
    await ready;
    const originalOpen = window.open;
    let navigated = "";
    window.open = (() => ({
      opener: window,
      closed: false,
      close() {},
      location: {
        replace(value: string) {
          navigated = value;
        },
      },
    })) as unknown as typeof window.open;
    const materialized = await viewer.openPrintSource({
      document: "original",
      print: {
        pages: [{ from: 2, to: 2 }],
        layout: { mode: "spread", firstPageSide: "right" },
      },
    });
    viewer.destroy();
    host.remove();

    const resolverHost = createHost();
    const resolverReady = waitReady(resolverHost);
    const resolverViewer = new PdfjsViewer({
      rootEl: resolverHost,
      runtime,
      ui: "headless",
      keyboard: false,
      defaultDocumentOptions: { withCredentials: true },
      printSourceResolver: () => "/fixture.pdf?resolved-auth-source",
    });
    const resolverLoad = await resolverViewer.load("/fixture.pdf");
    if (!resolverLoad.ok) throw new Error("Resolved print source fixture did not load");
    await resolverReady;
    let resolvedNavigation = "";
    window.open = (() => ({
      opener: window,
      closed: false,
      close() {},
      location: {
        replace(value: string) {
          resolvedNavigation = value;
        },
      },
    })) as unknown as typeof window.open;
    const resolved = await resolverViewer.openPrintSource({
      document: "original",
      navigation: "direct",
    });
    window.open = originalOpen;
    resolverViewer.destroy();
    resolverHost.remove();
    printPermissions = "runtime";
    return { materialized, materializedNavigation: navigated, resolved, resolvedNavigation };
  },
  async probePrintSetupPreflight() {
    printPermissions = "high";
    const create = async ({
      memoryLimitMiB,
      maxSheets,
      maxCanvasDimension,
      printSheetLimitExceeded,
      printMemoryLimitExceeded,
      printPreparationUnavailable,
      browserFallback = true,
      printDefaults,
    }: {
      memoryLimitMiB: number;
      maxSheets?: number;
      maxCanvasDimension?: number;
      printSheetLimitExceeded?: (sheetCount: number, maxSheets: number) => string;
      printMemoryLimitExceeded?: string;
      printPreparationUnavailable?: string;
      browserFallback?: boolean;
      printDefaults?: PdfjsViewerPrintDefaults;
    }) => {
      const host = document.createElement("section");
      host.style.cssText = "width:600px;height:600px";
      document.body.append(host);
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const viewer = new PdfjsViewer({
        rootEl: host,
        runtime,
        ui: {
          mode: "default",
          ...(printMemoryLimitExceeded || printPreparationUnavailable
            ? {
                labels: {
                  ...(printMemoryLimitExceeded ? { printMemoryLimitExceeded } : {}),
                  ...(printPreparationUnavailable ? { printPreparationUnavailable } : {}),
                },
              }
            : {}),
          ...(printSheetLimitExceeded ? { formatters: { printSheetLimitExceeded } } : {}),
        },
        keyboard: false,
        renderingProfiles: {
          balanced: {
            memoryLimitMiB,
            ...(maxCanvasDimension === undefined ? {} : { maxCanvasDimension }),
            print: { ...(maxSheets === undefined ? {} : { maxSheets }) },
          },
        },
        deviceCompatibility: fixtureDeviceCompatibility,
        features: {
          print: {
            mode: "native",
            browserFallback,
            ...(printDefaults ? { defaults: printDefaults } : {}),
          },
        },
      });
      const load = await viewer.load("/fixture.pdf");
      if (!load.ok) throw new Error("Print limits fixture did not load");
      await ready;
      host.querySelector<HTMLButtonElement>(".pdf-print-btn")!.click();
      const dialog = host.querySelector<HTMLDialogElement>(".pdf-print-setup")!;
      const status = dialog.querySelector<HTMLElement>(".pdf-print-status")!;
      for (let frame = 0; frame < 30 && !status.textContent; frame++)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return { host, viewer, dialog, status };
    };
    const reduced = await create({ memoryLimitMiB: 100 });
    const reducedDetail =
      reduced.dialog.querySelector<HTMLElement>(".pdf-print-submit-detail")!.textContent ?? "";
    const reducedSourceVisible =
      !reduced.dialog.querySelector<HTMLButtonElement>(".pdf-print-source")!.hidden;
    const protectedReduced = await create({ memoryLimitMiB: 100, browserFallback: false });
    const protectedPlan = await protectedReduced.viewer.preflightPrint({ quality: { dpi: 300 } });
    const protectedSourceHidden =
      protectedReduced.dialog.querySelector<HTMLButtonElement>(".pdf-print-source")!.hidden;
    const protectedSource = await protectedReduced.viewer.openPrintSource();
    const configured = await create({
      memoryLimitMiB: 100,
      printDefaults: {
        sheet: "letter",
        pageScaling: "shrink-to-fit",
        orientation: "landscape",
        quality: { dpi: 600 },
      },
    });
    const configuredDefaults = {
      sheet: configured.dialog.querySelector<HTMLSelectElement>(".pdf-print-sheet")!.value,
      pageScaling:
        configured.dialog.querySelector<HTMLSelectElement>(".pdf-print-page-scaling")!.value,
      orientation:
        configured.dialog.querySelector<HTMLSelectElement>(".pdf-print-orientation")!.value,
      quality: configured.dialog.querySelector<HTMLSelectElement>(".pdf-print-quality")!.value,
    };
    const reducedForm = reduced.dialog.querySelector<HTMLFormElement>("form")!;
    const reducedLayout = reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-layout")!;
    const reducedSheet = reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-sheet")!;
    reducedSheet.value = "a4";
    reducedLayout.value = "single";
    reducedForm.dispatchEvent(new Event("change", { bubbles: true }));
    const singlePlan = await reduced.viewer.preflightPrint({
      layout: { mode: "single" },
      sheet: "a4",
      quality: { dpi: 300 },
    });
    reducedLayout.value = "spread";
    reducedForm.dispatchEvent(new Event("change", { bubbles: true }));
    const spreadPlan = await reduced.viewer.preflightPrint({
      layout: { mode: "spread", firstPageSide: "auto" },
      sheet: "a4",
      quality: { dpi: 300 },
    });
    for (
      let frame = 0;
      frame < 30 &&
      !reduced.status.textContent?.startsWith(
        `${spreadPlan.ok ? spreadPlan.sheetCount : 0} sheets`,
      );
      frame++
    ) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const recomputedStatus = reduced.status.textContent ?? "";
    const rangeMode = reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-pages")!;
    const range = reduced.dialog.querySelector<HTMLInputElement>(".pdf-print-range")!;
    rangeMode.value = "custom";
    reducedForm.dispatchEvent(new Event("change", { bubbles: true }));
    range.value = "2-";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    const invalidRangeStatus = reduced.status.textContent ?? "";
    range.value = "1";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    for (let frame = 0; frame < 30 && reduced.status.textContent === invalidRangeStatus; frame++)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const validRangeStatus = reduced.status.textContent ?? "";
    rangeMode.value = "all";
    reducedForm.dispatchEvent(new Event("change", { bubbles: true }));
    reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-layout")!.value = "spread";
    reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-side select")!.value = "right";
    reduced.dialog
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    const parityWarning = reduced.dialog.querySelector<HTMLElement>(".pdf-print-fallback-warning")!;
    for (let frame = 0; frame < 30 && parityWarning.hidden; frame++)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const parityOnlyWarning =
      !parityWarning.hidden &&
      /parity/i.test(parityWarning.textContent ?? "") &&
      !/layer/i.test(parityWarning.textContent ?? "");
    reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-side select")!.value = "left";
    reduced.dialog.close();
    const replacementReady = new Promise<void>(resolve =>
      reduced.host.addEventListener("pdf:ready", () => resolve(), { once: true }),
    );
    await reduced.viewer.load("/fixture.pdf");
    await replacementReady;
    reduced.host.querySelector<HTMLButtonElement>(".pdf-print-btn")!.click();
    const resetLayout = reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-layout")!.value;
    const resetSide =
      reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-side select")!.value;
    const resetDefaults = {
      sheet: reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-sheet")!.value,
      pageScaling:
        reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-page-scaling")!.value,
      orientation: reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-orientation")!.value,
      quality: reduced.dialog.querySelector<HTMLSelectElement>(".pdf-print-quality")!.value,
    };

    const memoryLimited = await create({
      memoryLimitMiB: 1,
      printMemoryLimitExceeded: "Parent memory limit",
    });
    const memoryLimitPlan = await memoryLimited.viewer.preflightPrint({
      layout: { mode: "single" },
      sheet: "a4",
      quality: { dpi: 72 },
    });
    const memoryLimitStatus = memoryLimited.status.textContent ?? "";
    const memoryLimitSourceVisible =
      !memoryLimited.dialog.querySelector<HTMLButtonElement>(".pdf-print-source")!.hidden;
    const structural = await create({
      memoryLimitMiB: 100,
      maxCanvasDimension: 10,
      printPreparationUnavailable: "Parent structural limit",
    });
    const structuralPlan = await structural.viewer.preflightPrint({
      layout: { mode: "single" },
      sheet: "a4",
      quality: { dpi: 72 },
    });
    const structuralStatus = structural.status.textContent ?? "";
    const sheetLimited = await create({
      memoryLimitMiB: 100,
      maxSheets: 1,
      printSheetLimitExceeded: (sheetCount, maxSheets) => `Limit ${sheetCount}/${maxSheets}`,
    });
    const sheetLimitPlan = await sheetLimited.viewer.preflightPrint({
      layout: { mode: "single" },
      sheet: "a4",
      quality: { dpi: 72 },
    });
    const sheetLimitPrint = await sheetLimited.viewer.print({
      layout: { mode: "single" },
      sheet: "a4",
      quality: { dpi: 72 },
    });
    const sheetLimitLayout =
      sheetLimited.dialog.querySelector<HTMLSelectElement>(".pdf-print-layout")!;
    sheetLimitLayout.value = "single";
    sheetLimited.dialog
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    for (let frame = 0; frame < 30 && sheetLimited.status.textContent !== "Limit 3/1"; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const sheetLimitStatus = sheetLimited.status.textContent ?? "";
    const sheetLimitSourceVisible =
      !sheetLimited.dialog.querySelector<HTMLButtonElement>(".pdf-print-source")!.hidden;
    const result = {
      reducedDetail,
      reducedSourceVisible,
      parityOnlyWarning,
      resetLayout,
      resetSide,
      resetDefaults,
      protectedPlanFallback: protectedPlan.ok ? protectedPlan.sourceFallbackAvailable : null,
      protectedSourceHidden,
      protectedSourceReason: protectedSource.ok ? "unexpected" : protectedSource.reason,
      configuredDefaults,
      memoryLimitPlan: memoryLimitPlan.ok ? null : { reason: memoryLimitPlan.reason },
      memoryLimitStatus,
      memoryLimitSourceVisible,
      structuralPlan: structuralPlan.ok ? null : { reason: structuralPlan.reason },
      structuralStatus,
      sheetLimitResult: sheetLimitPlan.ok
        ? null
        : {
            reason: sheetLimitPlan.reason,
            sheetCount: sheetLimitPlan.sheetCount,
            maxSheets:
              sheetLimitPlan.reason === "too-many-sheets" ? sheetLimitPlan.maxSheets : null,
          },
      sheetLimitPrintResult: sheetLimitPrint.ok
        ? null
        : {
            reason: sheetLimitPrint.reason,
            sheetCount:
              sheetLimitPrint.reason === "too-many-sheets" ? sheetLimitPrint.sheetCount : null,
            maxSheets:
              sheetLimitPrint.reason === "too-many-sheets" ? sheetLimitPrint.maxSheets : null,
          },
      sheetLimitStatus,
      sheetLimitSourceVisible,
      singleSheetCount: singlePlan.ok ? singlePlan.sheetCount : null,
      singleDpi: singlePlan.ok ? singlePlan.resolvedDpi : null,
      spreadSheetCount: spreadPlan.ok ? spreadPlan.sheetCount : null,
      spreadDpi: spreadPlan.ok ? spreadPlan.resolvedDpi : null,
      recomputedStatus,
      invalidRangeStatus,
      validRangeStatus,
    };
    reduced.viewer.destroy();
    protectedReduced.viewer.destroy();
    configured.viewer.destroy();
    memoryLimited.viewer.destroy();
    structural.viewer.destroy();
    sheetLimited.viewer.destroy();
    reduced.host.remove();
    protectedReduced.host.remove();
    configured.host.remove();
    memoryLimited.host.remove();
    structural.host.remove();
    sheetLimited.host.remove();
    printPermissions = "runtime";
    return result;
  },

  async probeAutomaticPrintLayouts() {
    printPermissions = "high";
    const viewers: PdfjsViewer[] = [];
    const hosts: HTMLElement[] = [];
    const create = async (source: string) => {
      const host = document.createElement("section");
      host.style.cssText = "width:600px;height:600px";
      document.body.append(host);
      hosts.push(host);
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const viewer = new PdfjsViewer({
        rootEl: host,
        runtime,
        ui: "headless",
        keyboard: false,
        deviceCompatibility: fixtureDeviceCompatibility,
        features: { print: { mode: "native" } },
      });
      const load = await viewer.load(source);
      if (!load.ok) throw new Error("Print layout fixture did not load");
      viewers.push(viewer);
      await ready;
      return viewer;
    };
    try {
      const a5 = await create("/print-a5-fixture.pdf");
      const noPreference = await create("/print-a5-no-preference-fixture.pdf");
      const mixed = await create("/print-mixed-fixture.pdf");
      const rotated = await create("/print-rotated-a5-fixture.pdf");
      const [
        a5Auto,
        noPreferenceAuto,
        mixedAll,
        mixedSmallRange,
        mixedLargeRange,
        mixedLargeA3,
        rotatedAuto,
        explicitSpread,
        explicitSingle,
      ] = await Promise.all([
        a5.preflightPrint({ layout: { mode: "auto" }, quality: { dpi: 72 } }),
        noPreference.preflightPrint({ layout: { mode: "auto" }, quality: { dpi: 72 } }),
        mixed.preflightPrint({ layout: { mode: "auto" }, quality: { dpi: 72 } }),
        mixed.preflightPrint({
          pages: [{ from: 1, to: 2 }],
          layout: { mode: "auto" },
          quality: { dpi: 72 },
        }),
        mixed.preflightPrint({
          pages: [{ from: 2, to: 3 }],
          layout: { mode: "auto" },
          quality: { dpi: 72 },
        }),
        mixed.preflightPrint({
          pages: [{ from: 2, to: 3 }],
          layout: { mode: "auto" },
          sheet: "a3",
          quality: { dpi: 72 },
        }),
        rotated.preflightPrint({ layout: { mode: "auto" }, quality: { dpi: 72 } }),
        mixed.preflightPrint({
          layout: { mode: "spread", firstPageSide: "right" },
          quality: { dpi: 72 },
        }),
        a5.preflightPrint({ layout: { mode: "single" }, quality: { dpi: 72 } }),
      ]);
      const summary = (result: Awaited<ReturnType<PdfjsViewer["preflightPrint"]>>) =>
        result.ok
          ? { layout: result.layout, sheetCount: result.sheetCount }
          : { layout: null, sheetCount: null };
      return {
        a5Auto: summary(a5Auto),
        noPreferenceAuto: summary(noPreferenceAuto),
        mixedAll: summary(mixedAll),
        mixedSmallRange: summary(mixedSmallRange),
        mixedLargeRange: summary(mixedLargeRange),
        mixedLargeA3: summary(mixedLargeA3),
        rotatedAuto: summary(rotatedAuto),
        explicitSpread: summary(explicitSpread),
        explicitSingle: summary(explicitSingle),
      };
    } finally {
      for (const viewer of viewers) viewer.destroy();
      for (const host of hosts) host.remove();
      printPermissions = "runtime";
    }
  },

  async probeControlledPrintAdmission() {
    printPermissions = "high";
    printPermissionReads = 0;
    let entered!: () => void;
    let release!: () => void;
    const permissionEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const permissionGate = new Promise<void>(resolve => {
      release = resolve;
    });
    const lifecycle: string[] = [];
    const root = document.querySelector<HTMLElement>("#primary")!;
    const record = (event: Event) => lifecycle.push(event.type);
    root.addEventListener("pdf:printstart", record);
    root.addEventListener("pdf:printprogress", record);
    root.addEventListener("pdf:printinvoked", record);
    root.addEventListener("pdf:printcleanup", record);
    const originalPrint = window.print;
    window.print = () => {
      window.dispatchEvent(new Event("beforeprint"));
      window.dispatchEvent(new Event("afterprint"));
    };
    nextPrintPermissionRead = () => {
      entered();
      return permissionGate;
    };
    try {
      const first = primary.print({
        pages: [{ from: 1, to: 1 }],
        quality: { dpi: 72 },
        sheet: "a4",
        orientation: "landscape",
      });
      await permissionEntered;
      const second = await primary.print({
        pages: [{ from: 1, to: 1 }],
        quality: { dpi: 72 },
        sheet: "a4",
        orientation: "landscape",
      });
      release();
      const firstResult = await first;
      return {
        firstResult,
        second,
        permissionReads: printPermissionReads,
        lifecycle,
        roots: document.querySelectorAll(".pdf-native-print-root").length,
      };
    } finally {
      release?.();
      nextPrintPermissionRead = null;
      window.print = originalPrint;
      root.removeEventListener("pdf:printstart", record);
      root.removeEventListener("pdf:printprogress", record);
      root.removeEventListener("pdf:printinvoked", record);
      root.removeEventListener("pdf:printcleanup", record);
      printPermissions = "runtime";
    }
  },

  async probeDocumentPrintExecution() {
    const originalPrint = window.print;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    const originalDecode = HTMLImageElement.prototype.decode;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalGetComputedStyle = window.getComputedStyle;
    const originalBodyAppend = document.body.append;
    const canvasSnapshots: HTMLCanvasElement[] = [];
    const makeContext = (
      mode: string,
      events: string[],
      counters: Record<string, number>,
      viewports: number[][] = [],
    ) => {
      const pages = {
        acquire: async (pageNo: number) => {
          counters.acquire++;
          if (mode === "acquire") throw new Error("acquire rejected");
          return {
            page: {
              rotate: 0,
              getViewport: ({ scale }: { scale: number }) => ({
                width: (mode === "geometry" ? 101 : mode === "stacked" ? 200 : 100) * scale,
                height: (mode === "stacked" ? 100 : 200) * scale,
              }),
              render: (parameters: Record<string, unknown>) => {
                counters.render++;
                events.push(`render:${parameters.intent}`);
                const viewport = parameters.viewport as
                  { width?: number; height?: number } | undefined;
                if (viewport?.width !== undefined && viewport.height !== undefined) {
                  viewports.push([viewport.width, viewport.height]);
                }
                return {
                  promise:
                    mode === "render"
                      ? Promise.reject(new Error("render rejected"))
                      : Promise.resolve(),
                  cancel() {},
                };
              },
            },
            release: () => {
              counters.release++;
            },
          };
        },
      };
      return {
        pdf: {
          numPages: 2,
          annotationStorage: { print: {} },
          getOptionalContentConfig: async () => ({ setVisibility() {} }),
        },
        pages,
        information: { permissions: ["print-high-quality"] },
        geometry: {
          revision: 1,
          layout:
            mode === "stacked"
              ? { mode: "spread", firstPageSide: "left", placement: "stacked", gapPt: 0 }
              : { mode: "single", gapPt: 0 },
          sizes:
            mode === "stacked"
              ? [
                  { width: 200, height: 100 },
                  { width: 200, height: 100 },
                ]
              : [
                  { width: 100, height: 200 },
                  { width: 100, height: 200 },
                ],
          sizeFor: () =>
            mode === "stacked" ? { width: 200, height: 100 } : { width: 100, height: 200 },
        },
        layerVisibility: null,
        formStorageSnapshot: {},
        xfaSnapshot: null,
        revisions: { document: 1, layers: null, forms: 1, geometry: 1 },
        AnnotationMode: { ENABLE_STORAGE: 3 },
        signal: new AbortController().signal,
        window,
        nativeCapabilities: () => ({
          nativePrintSupport: mode === "transport" ? "portrait" : "portrait-and-landscape",
          engine: "chromium",
          browser: "chrome",
          platform: "desktop",
          operatingSystem: "linux",
          sourceFallbackRecommended: false,
        }),
      };
    };
    const run = async (mode: string) => {
      const stylesBefore = document.adoptedStyleSheets.length;
      const events: string[] = [];
      const viewports: number[][] = [];
      const drawPlacements: number[][] = [];
      const encodedSizes: number[][] = [];
      const transforms: number[][] = [];
      const counters = {
        acquire: 0,
        release: 0,
        render: 0,
        exclusive: 0,
        creates: 0,
        revokes: 0,
        prints: 0,
      };
      let contextCalls = 0;
      const owner = new DocumentPrint(
        {
          acquireExclusive: async () => ({
            release: () => {
              counters.exclusive++;
            },
          }),
        } as never,
        {},
        {
          event: event => events.push(event.type),
        },
      );
      const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      const originalSetTransform = CanvasRenderingContext2D.prototype.setTransform;
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<CanvasRenderingContext2D["drawImage"]>
      ) {
        drawPlacements.push((args.slice(1) as number[]).map(value => Number(value)));
        return Reflect.apply(originalDrawImage, this, args);
      } as CanvasRenderingContext2D["drawImage"];
      CanvasRenderingContext2D.prototype.setTransform = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ) {
        if (typeof args[0] === "number") transforms.push(args as unknown as number[]);
        return Reflect.apply(originalSetTransform, this, args);
      } as CanvasRenderingContext2D["setTransform"];
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        canvasSnapshots.push(this);
        encodedSizes.push([this.width, this.height]);
        callback(mode === "blob" ? null : new Blob(["png"], { type: "image/png" }));
      };
      HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
        apply(target, receiver, args) {
          contextCalls++;
          if (mode === "context" && contextCalls === 2) return null;
          return Reflect.apply(target, receiver, args);
        },
      });
      HTMLImageElement.prototype.decode = () =>
        mode === "decode" ? Promise.reject(new Error("decode rejected")) : Promise.resolve();
      URL.createObjectURL = () => {
        counters.creates++;
        if (mode === "url") throw new Error("url rejected");
        return originalCreateObjectUrl(new Blob(["png"], { type: "image/png" }));
      };
      URL.revokeObjectURL = value => {
        counters.revokes++;
        originalRevokeObjectUrl(value);
      };
      if (mode === "append")
        document.body.append = () => {
          throw new Error("append rejected");
        };
      window.getComputedStyle = ((element: Element) => {
        const style = originalGetComputedStyle.call(window, element);
        if (mode === "css" && element.classList.contains("pdf-native-print-root")) {
          return new Proxy(style, {
            get(target, property) {
              return property === "position" ? "static" : Reflect.get(target, property);
            },
          });
        }
        return style;
      }) as typeof window.getComputedStyle;
      window.print = () => {
        counters.prints++;
      };
      try {
        let result: unknown;
        let error: string | null = null;
        try {
          result = await owner.print(
            {
              pages: "all",
              layout:
                mode === "stacked"
                  ? { mode: "spread", firstPageSide: "left", gapPt: 0 }
                  : { mode: "single" },
              quality: { dpi: 72 },
              sheet: mode === "shrink" ? { width: 600, height: 800, unit: "pt" } : "a4",
              pageScaling: mode === "shrink" ? "shrink-to-fit" : "fit",
              orientation:
                mode === "transport" ? "landscape" : mode === "stacked" ? "auto" : "portrait",
            },
            makeContext(mode, events, counters, viewports) as never,
          );
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
        }
        const rootsBeforeAfterprint = document.querySelectorAll(".pdf-native-print-root").length;
        if ((result as { ok?: boolean } | undefined)?.ok)
          window.dispatchEvent(new Event("afterprint"));
        return {
          result,
          events,
          viewports,
          drawPlacements,
          encodedSizes,
          transforms,
          counters,
          rootsBeforeAfterprint,
          rootsAfter: document.querySelectorAll(".pdf-native-print-root").length,
          state: owner.state.phase,
          error,
          canvasesZeroed: canvasSnapshots.every(
            canvas => canvas.width === 0 && canvas.height === 0,
          ),
          stylesRestored: document.adoptedStyleSheets.length === stylesBefore,
        };
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
        HTMLImageElement.prototype.decode = originalDecode;
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
        window.getComputedStyle = originalGetComputedStyle;
        window.print = originalPrint;
        document.body.append = originalBodyAppend;
        CanvasRenderingContext2D.prototype.drawImage = originalDrawImage;
        CanvasRenderingContext2D.prototype.setTransform = originalSetTransform;
      }
    };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const runDecodeAbort = async () => {
      const controller = new AbortController();
      let decodeEntered!: () => void;
      const entered = new Promise<void>(resolve => {
        decodeEntered = resolve;
      });
      const counters = {
        acquire: 0,
        release: 0,
        render: 0,
        exclusive: 0,
        creates: 0,
        revokes: 0,
        prints: 0,
      };
      const owner = new DocumentPrint({
        acquireExclusive: async () => ({
          release: () => {
            counters.exclusive++;
          },
        }),
      } as never);
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(new Blob(["png"], { type: "image/png" }));
      };
      HTMLImageElement.prototype.decode = () => {
        decodeEntered();
        return new Promise<void>(() => {});
      };
      URL.createObjectURL = value => {
        counters.creates++;
        return originalCreateObjectUrl(value);
      };
      URL.revokeObjectURL = value => {
        counters.revokes++;
        originalRevokeObjectUrl(value);
      };
      window.print = () => {
        counters.prints++;
      };
      try {
        const job = owner.print(
          {
            pages: "all",
            layout: { mode: "single" },
            quality: { dpi: 72 },
            sheet: "a4",
            pageScaling: "fit",
            orientation: "portrait",
          },
          {
            ...makeContext("success", [], counters),
            signal: controller.signal,
          } as never,
        );
        await entered;
        controller.abort();
        const result = await Promise.race([
          job,
          new Promise<null>(resolve => setTimeout(() => resolve(null), 250)),
        ]);
        return {
          result,
          counters,
          roots: document.querySelectorAll(".pdf-native-print-root").length,
          state: owner.state.phase,
        };
      } finally {
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
        HTMLImageElement.prototype.decode = originalDecode;
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
        window.print = originalPrint;
      }
    };
    const runFontAbort = async () => {
      const controller = new AbortController();
      let fontReadinessEntered!: () => void;
      const entered = new Promise<void>(resolve => {
        fontReadinessEntered = resolve;
      });
      const neverSettlingReady = {
        then() {
          fontReadinessEntered();
          return new Promise<void>(() => {});
        },
      };
      const ownFonts = Object.getOwnPropertyDescriptor(document, "fonts");
      const counters = {
        acquire: 0,
        release: 0,
        render: 0,
        exclusive: 0,
        creates: 0,
        revokes: 0,
        prints: 0,
      };
      const owner = new DocumentPrint({
        acquireExclusive: async () => ({
          release: () => {
            counters.exclusive++;
          },
        }),
      } as never);
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(new Blob(["png"], { type: "image/png" }));
      };
      HTMLImageElement.prototype.decode = () => Promise.resolve();
      URL.createObjectURL = value => {
        counters.creates++;
        return originalCreateObjectUrl(value);
      };
      URL.revokeObjectURL = value => {
        counters.revokes++;
        originalRevokeObjectUrl(value);
      };
      window.print = () => {
        counters.prints++;
      };
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { ready: neverSettlingReady },
      });
      try {
        const job = owner.print(
          {
            pages: "all",
            layout: { mode: "single" },
            quality: { dpi: 72 },
            sheet: "a4",
            pageScaling: "fit",
            orientation: "portrait",
          },
          {
            ...makeContext("success", [], counters),
            signal: controller.signal,
          } as never,
        );
        await entered;
        controller.abort();
        const result = await Promise.race([
          job,
          new Promise<null>(resolve => setTimeout(() => resolve(null), 250)),
        ]);
        return {
          result,
          counters,
          roots: document.querySelectorAll(".pdf-native-print-root").length,
          state: owner.state.phase,
        };
      } finally {
        if (ownFonts) Object.defineProperty(document, "fonts", ownFonts);
        else Reflect.deleteProperty(document, "fonts");
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
        HTMLImageElement.prototype.decode = originalDecode;
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
        window.print = originalPrint;
      }
    };
    try {
      const success = await run("success");
      const shrink = await run("shrink");
      const transport = await run("transport");
      const stacked = await run("stacked");
      const failures: Record<string, unknown> = {};
      for (const mode of [
        "acquire",
        "geometry",
        "context",
        "render",
        "blob",
        "url",
        "decode",
        "css",
        "append",
      ])
        failures[mode] = await run(mode);
      return {
        success,
        shrink,
        transport,
        stacked,
        failures,
        decodeAbort: await runDecodeAbort(),
        fontAbort: await runFontAbort(),
      };
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      HTMLImageElement.prototype.decode = originalDecode;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      window.getComputedStyle = originalGetComputedStyle;
      window.print = originalPrint;
      document.body.append = originalBodyAppend;
    }
  },

  async probePrintSetupReinitialization() {
    const host = document.createElement("section");
    host.innerHTML = renderPdfjsViewerUi({ id: "print-reinit", variant: "custom" });
    document.body.append(host);
    const menu = host.querySelector<HTMLElement>(".pdf-menu-panel")!;
    menu.hidden = false;
    menu.inert = false;
    const action = host.querySelector<HTMLButtonElement>(".pdf-print-btn")!;
    const dialog = host.querySelector<HTMLDialogElement>(".pdf-print-setup")!;
    const printBindings = discoverViewerUi(host, {}, PDFJS_VIEWER_UI_HOOKS).printSetup;
    let preflights = 0;
    const callbacks = {
      generation: () => 1,
      pageCount: () => 3,
      state: () =>
        ({
          phase: "idle",
          jobId: null,
          completedSheets: 0,
          totalSheets: 0,
          retainedBytes: 0,
          nativeResourcesRetained: false,
        }) as const,
      routeSelected: () => {},
      closeTransientUi: () => action,
      preflight: async () => {
        preflights++;
        return {
          ok: true,
          requestedDpi: 300,
          resolvedDpi: 300,
          reduced: false,
          sourceFallbackAvailable: true,
          sheetCount: 3,
          paritySensitive: false,
          layerWarning: false,
          orientation: "portrait",
          layout: "single",
          nativeCapabilities: {
            nativePrintSupport: "portrait-and-landscape",
            engine: "chromium",
            browser: "chrome",
            platform: "desktop",
            operatingSystem: "linux",
            sourceFallbackRecommended: false,
          },
        } as const;
      },
      print: async () => ({ ok: false, reason: "cancelled" }) as const,
      openSource: async () => ({ ok: false, reason: "cancelled" }) as const,
      cancelPreparation: () => {},
      failed: () => {},
    };
    const first = new ViewerPrintSetup(
      action,
      printBindings,
      PDFJS_VIEWER_DEFAULT_LABELS,
      PDFJS_VIEWER_DEFAULT_FORMATTERS,
      callbacks,
    );
    action.focus();
    action.click();
    await Promise.resolve();
    await Promise.resolve();
    const firstCalls = preflights;
    dialog.querySelector<HTMLButtonElement>(".pdf-print-cancel")!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const focusRestored = document.activeElement === action;
    first.destroy();
    const second = new ViewerPrintSetup(
      action,
      printBindings,
      PDFJS_VIEWER_DEFAULT_LABELS,
      PDFJS_VIEWER_DEFAULT_FORMATTERS,
      callbacks,
    );
    action.click();
    await Promise.resolve();
    await Promise.resolve();
    const secondCalls = preflights - firstCalls;
    dialog.close();
    second.destroy();
    host.remove();
    return { firstCalls, secondCalls, focusRestored };
  },
  async probePrintSetupUiTextRefresh() {
    const root = createPdfjsViewerUi({ id: "print-ui-text" });
    const host = document.createElement("section");
    host.append(root);
    document.body.append(host);
    const print = discoverViewerUi(root, {}, PDFJS_VIEWER_UI_HOOKS).printSetup;
    print.progress!.removeAttribute("aria-label");
    const action = root.querySelector<HTMLButtonElement>(".pdf-print-btn")!;
    let preflights = 0;
    let cancellations = 0;
    let state: Readonly<PdfjsViewerPrintState> = {
      phase: "idle",
      jobId: null,
      completedSheets: 0,
      totalSheets: 0,
      retainedBytes: 0,
      nativeResourcesRetained: false,
    };
    const preflight = async () => {
      preflights++;
      return {
        ok: true,
        requestedDpi: 300,
        resolvedDpi: 300,
        reduced: false,
        sourceFallbackAvailable: true,
        sheetCount: 2,
        paritySensitive: false,
        layerWarning: false,
        orientation: "landscape",
        layout: "spread",
        nativeCapabilities: {
          nativePrintSupport: "portrait",
          engine: "chromium",
          browser: "chrome",
          platform: "desktop",
          operatingSystem: "linux",
          sourceFallbackRecommended: false,
        },
      } as const;
    };
    const setup = new ViewerPrintSetup(
      action,
      print,
      PDFJS_VIEWER_DEFAULT_LABELS,
      PDFJS_VIEWER_DEFAULT_FORMATTERS,
      {
        generation: () => 1,
        pageCount: () => 3,
        state: () => state,
        routeSelected() {},
        closeTransientUi: () => null,
        preflight,
        print: async () => ({ ok: false, reason: "cancelled" }) as never,
        openSource: async () => ({ ok: false, reason: "cancelled" }) as never,
        cancelPreparation: () => {
          cancellations++;
        },
        failed() {},
      },
    );
    const hostAriaRoot = createPdfjsViewerUi({ id: "print-ui-text-host-aria" });
    const hostAriaHost = document.createElement("section");
    hostAriaHost.append(hostAriaRoot);
    document.body.append(hostAriaHost);
    const hostAriaPrint = discoverViewerUi(hostAriaRoot, {}, PDFJS_VIEWER_UI_HOOKS).printSetup;
    hostAriaPrint.progress!.setAttribute("aria-label", "Host print progress");
    const hostAriaSetup = new ViewerPrintSetup(
      hostAriaRoot.querySelector<HTMLButtonElement>(".pdf-print-btn")!,
      hostAriaPrint,
      PDFJS_VIEWER_DEFAULT_LABELS,
      PDFJS_VIEWER_DEFAULT_FORMATTERS,
      {
        generation: () => 1,
        pageCount: () => 3,
        state: () => state,
        routeSelected() {},
        closeTransientUi: () => null,
        preflight,
        print: async () => ({ ok: false }) as never,
        openSource: async () => ({ ok: false }) as never,
        cancelPreparation() {},
        failed() {},
      },
    );
    try {
      action.click();
      await Promise.resolve();
      await Promise.resolve();
      const cachedPreflights = preflights;
      setup.setUiText(
        {
          ...PDFJS_VIEWER_DEFAULT_LABELS,
          printAllPages: "All X",
          printKeepPortraitGuidance: "Portrait transport X",
          printDuplexLandscapeFlipGuidance: "Short-edge flip X",
        },
        {
          ...PDFJS_VIEWER_DEFAULT_FORMATTERS,
          printSummary: summary => `Summary X: ${summary.pages}`,
        },
      );
      const cachedPreflightReapplied =
        print.status!.textContent === "Summary X: All X" && preflights === cachedPreflights;
      const portraitTransportGuidance =
        print.guidance!.textContent?.includes("Portrait transport X") &&
        print.guidance!.textContent.includes("Short-edge flip X");

      print.pages!.value = "custom";
      print.form!.dispatchEvent(new Event("change", { bubbles: true }));
      print.range!.value = "invalid";
      print.more!.open = true;
      print.range!.focus();
      print.range!.dispatchEvent(new Event("input", { bubbles: true }));
      setup.setUiText(
        {
          ...PDFJS_VIEWER_DEFAULT_LABELS,
          printRangeInvalid: "Range X of {pageCount}",
          printProgress: "Progress X",
        },
        PDFJS_VIEWER_DEFAULT_FORMATTERS,
      );
      hostAriaSetup.setUiText(
        { ...PDFJS_VIEWER_DEFAULT_LABELS, printProgress: "Ignored host progress" },
        PDFJS_VIEWER_DEFAULT_FORMATTERS,
      );
      const invalidRefresh = print.status!.textContent === "Range X of 3";
      const installedProgressAriaRefresh =
        print.progress!.getAttribute("aria-label") === "Progress X";
      const hostProgressAriaUntouched =
        hostAriaPrint.progress!.getAttribute("aria-label") === "Host print progress";
      const preserved =
        print.dialog!.open &&
        print.range!.value === "invalid" &&
        print.more!.open &&
        document.activeElement === print.range;

      state = {
        phase: "preparing",
        jobId: 1,
        completedSheets: 1,
        totalSheets: 3,
        retainedBytes: 0,
        nativeResourcesRetained: false,
      };
      const beforePreparing = { preflights, cancellations };
      setup.setUiText(
        { ...PDFJS_VIEWER_DEFAULT_LABELS, printPreparationCancelGuidance: "Cancel X" },
        {
          ...PDFJS_VIEWER_DEFAULT_FORMATTERS,
          printProgress: (completed, total) => `Preparing X: ${completed}/${total}`,
        },
      );
      const preparingRefresh =
        print.status!.textContent === "Preparing X: 1/3" &&
        print.guidance!.textContent === "Cancel X" &&
        !print.progress!.hidden &&
        preflights === beforePreparing.preflights &&
        cancellations === beforePreparing.cancellations;
      return {
        cachedPreflightReapplied,
        portraitTransportGuidance,
        invalidRefresh,
        installedProgressAriaRefresh,
        hostProgressAriaUntouched,
        preserved,
        preparingRefresh,
      };
    } finally {
      setup.destroy();
      hostAriaSetup.destroy();
      host.remove();
      hostAriaHost.remove();
    }
  },
  async probeInMemoryDownload() {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const source = await fetch("/fixture.pdf").then(response => response.arrayBuffer());
    const sourceSize = source.byteLength;
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "default" });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    await viewer.load({ type: "data", data: source, filename: "memory-fixture.pdf" });
    await ready;

    const downloads: Array<{ href: string; filename: string }> = [];
    const blobs: Array<{ size: number; type: string }> = [];
    const revoked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () {
      downloads.push({ href: this.href, filename: this.download });
    };
    URL.createObjectURL = (value: Blob | MediaSource) => {
      if (value instanceof Blob) blobs.push({ size: value.size, type: value.type });
      return `blob:memory-download-${blobs.length}`;
    };
    URL.revokeObjectURL = value => {
      revoked.push(value);
    };

    try {
      const state = viewer.state;
      const control = host.querySelector<HTMLAnchorElement>(".pdf-download-btn")!;
      const controlVisible = !control.hidden;
      const controlEnabled = control.getAttribute("aria-disabled") !== "true";
      const publicResult = await viewer.download();
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      for (let attempt = 0; attempt < 50 && downloads.length < 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      return {
        canDownload: state.canDownload,
        controlVisible,
        controlEnabled,
        publicResult,
        downloadCount: downloads.length,
        filename: downloads[0]?.filename ?? "",
        blobSizeMatches: blobs.every(blob => blob.size === sourceSize),
        blobType: blobs[0]?.type ?? "",
        urlsRevoked: revoked.length === blobs.length,
      };
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      viewer.destroy();
      host.remove();
    }
  },
  async probeInMemoryDownloadLifecycle() {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const source = await fetch("/fixture.pdf").then(response => response.arrayBuffer());
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "headless" });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    await viewer.load({ type: "data", data: source });
    await ready;

    let browserDownloads = 0;
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () {
      browserDownloads++;
    };
    URL.createObjectURL = () => `blob:lifecycle-download-${browserDownloads}`;
    URL.revokeObjectURL = () => {};
    try {
      const readsBefore = documentDataReadCount;
      const sharedGate = gateNextDocumentDataRead();
      const first = viewer.download();
      await sharedGate.entered;
      const distinct = viewer.download({ filename: "alternate.pdf" });
      const second = viewer.download();
      await Promise.resolve();
      const sharedOneRead = documentDataReadCount - readsBefore === 1;
      sharedGate.release();
      const sharedResults = await Promise.all([first, distinct, second]);
      const keyedDownloadCount = browserDownloads;

      const cancellationGate = gateNextDocumentDataRead();
      const pending = viewer.download();
      await cancellationGate.entered;
      const replacement = viewer.load("/replacement-fixture.pdf");
      const cancellation = await Promise.race([
        pending.then(value => ({ settled: true, value })),
        new Promise<{ settled: false; value: null }>(resolve =>
          setTimeout(() => resolve({ settled: false, value: null }), 100),
        ),
      ]);
      const cleanupWaitedForRead = cancellationGate.cleanupCalls() === 0;
      cancellationGate.release();
      await replacement;
      for (let attempt = 0; attempt < 50 && cancellationGate.cleanupCalls() === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return {
        sharedOneRead,
        sharedResults: sharedResults.every(result => result.ok),
        keyedDownloadCount,
        cancellationSettledPromptly: cancellation.settled,
        cancellationResult: cancellation.value,
        cleanupWaitedForRead,
        cleanupFollowedRead: cancellationGate.cleanupCalls() > 0,
        replacementReady: viewer.state.status === "ready",
      };
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      viewer.destroy();
      host.remove();
    }
  },
  async probeCloseDuringInitialRenderCleanup() {
    const host = document.createElement("section");
    host.style.width = "600px";
    host.style.height = "600px";
    document.body.append(host);
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "headless" });
    const pageGate = gateNextPageAcquisition();
    const destroyGate = gateNextLoadingTaskDestroy();
    const cleanupBefore = documentCleanupCount;
    const load = viewer.load("/fixture.pdf?close-during-initial-render");
    await pageGate.entered;

    try {
      const closing = viewer.close();
      await destroyGate.entered;
      destroyGate.release();
      await closing;
      const cleanupWaitedForRender = documentCleanupCount === cleanupBefore;
      pageGate.release();
      await load;
      for (let attempt = 0; attempt < 50 && documentCleanupCount === cleanupBefore; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return {
        closeSettledBeforeRender: viewer.state.status === "closed",
        cleanupWaitedForRender,
        cleanupFollowedRender: documentCleanupCount > cleanupBefore,
      };
    } finally {
      pageGate.release();
      destroyGate.release();
      viewer.destroy();
      host.remove();
    }
  },
  async probeInvalidPublicArguments() {
    const rejects = (callback: () => unknown) => {
      try {
        callback();
        return false;
      } catch (error) {
        return error instanceof TypeError || error instanceof RangeError;
      }
    };
    const rejectsDefaultUi = (options: unknown) => {
      const host = document.createElement("section");
      try {
        renderPdfjsViewerUi({
          ...(options as object),
          id: "invalid-options-probe",
          initialUrl: "/fixture.pdf",
        } as never);
        return false;
      } catch (error) {
        return error instanceof TypeError;
      }
    };
    return {
      activeRejected: rejects(() => primary.setActive(1 as never)),
      emptyUint8ArrayLoadRejected: rejects(() => primary.load(new Uint8Array())),
      emptyArrayBufferLoadRejected: rejects(() => primary.load(new ArrayBuffer(0))),
      pageLayoutRejected: await primary.setPageLayout("invalid" as never).then(
        () => false,
        error => error instanceof RangeError,
      ),
      renderingProfileRejected: rejects(() => primary.setRenderingProfile("invalid" as never)),
      anchorRejected: rejects(() => primary.zoomBy(1.1, { x: Number.NaN, y: 0 })),
      namedDestinationRejected: await primary.navigateToPdfNamedDestination(1 as never).then(
        () => false,
        error => error instanceof TypeError,
      ),
      searchOptionsRejected: await primary
        .search("Fixture", { caseSensitive: "yes" as never })
        .then(
          () => false,
          error => error instanceof TypeError,
        ),
      outlineOptionsRejected: await primary.getOutline({ diacritics: "fold" as never }).then(
        () => false,
        error => error instanceof RangeError,
      ),
      documentDataOptionsRejected: await primary
        .getDocumentData({ document: "current" as never })
        .then(
          () => false,
          error => error instanceof RangeError,
        ),
      downloadOptionsRejected: await primary.download({ filename: "" }).then(
        () => false,
        error => error instanceof TypeError,
      ),
      unknownOutlineOptionRejected: await primary.getOutline({ unknown: true } as never).then(
        () => false,
        error => error instanceof TypeError,
      ),
      rowAnimationRejected: rejects(() => primary.nextRow("yes" as never)),
      hashOptionsRejected: rejects(() =>
        createHashNavigationStateAdapter(
          {
            navigationDestinationParam: 1 as never,
          },
          window,
        ),
      ),
      removedHashOptionRejected: rejects(() =>
        createHashNavigationStateAdapter(
          {
            destinationParam: "section",
          } as never,
          window,
        ),
      ),
      defaultUiControlRejected: rejectsDefaultUi({ controls: { print: "yes" } }),
      defaultUiLabelRejected: rejectsDefaultUi({ labels: { print: 1 } }),
      defaultUiFormatterRejected: rejectsDefaultUi({ formatters: { zoom: "100%" } }),
      defaultUiDirectionRejected: rejectsDefaultUi({ direction: "sideways" }),
      defaultUiOptionRejected: rejectsDefaultUi({ mode: "default" }),
    };
  },
  async probeProgressReplacement() {
    await primary.load("/fixture.pdf?progress-complete-a");
    const replacement = primary.load("/slow-fixture.pdf");
    const progress = root.querySelector<HTMLProgressElement>(".pdf-document-progress");
    if (!progress) throw new Error("Missing primary document progress UI");

    const deadline = performance.now() + 1_000;
    while (
      performance.now() < deadline &&
      (primary.state.status !== "loading" || progress.getAttribute("aria-valuenow") === "0")
    ) {
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    const remainedActive =
      primary.state.status === "loading" &&
      progress.classList.contains("pdf-document-progress--visible") &&
      (!progress.hasAttribute("value") || progress.value > 0);
    await replacement;
    return remainedActive;
  },
  async probeLaterRenderProgress() {
    await primary.load("/fixture.pdf?later-render-progress");
    const progress = root.querySelector<HTMLProgressElement>(".pdf-document-progress");
    if (!progress) throw new Error("Missing primary progress UI");
    await new Promise(resolve => setTimeout(resolve, 1_000));

    primary.zoomBy(1.1);
    let reopened = false;
    const deadline = performance.now() + 1_000;
    while (performance.now() < deadline) {
      if (progress.classList.contains("pdf-document-progress--visible")) {
        reopened = true;
        break;
      }
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    }
    return reopened;
  },
  probeErrorContext() {
    const host = document.createElement("section");
    document.body.append(host);
    try {
      new PdfjsViewer({ rootEl: host, runtime, ui: "custom" });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      host.remove();
    }
  },
  async probeUiDiscoveryContracts() {
    const root = document.createElement("section");
    const container = document.createElement("div");
    container.className = "pdf-container";
    root.append(container);
    document.body.append(root);
    const duplicates = document.createElement("div");
    duplicates.innerHTML =
      '<button class="duplicate-hook"></button><button class="duplicate-hook"></button>';
    root.append(duplicates);
    const direct = document.createElement("button");
    const wrong = document.createElement("div");
    wrong.className = "wrong-hook";
    root.append(direct, wrong);
    const hooks = {
      ...PDFJS_VIEWER_UI_HOOKS,
      navigation: { ...PDFJS_VIEWER_UI_HOOKS.navigation, previous: ".duplicate-hook" },
    };
    const duplicateRejected = (() => {
      try {
        discoverViewerUi(root, {}, hooks);
        return false;
      } catch (error) {
        return error instanceof Error && /navigation\.previous.*exactly one/.test(error.message);
      }
    })();
    const wrongTypeRejected = (() => {
      try {
        discoverViewerUi(
          root,
          {},
          { ...hooks, navigation: { ...hooks.navigation, previous: ".wrong-hook" } },
        );
        return false;
      } catch (error) {
        return (
          error instanceof TypeError &&
          /navigation\.previous.*HTMLButtonElement/.test(error.message)
        );
      }
    })();
    const directWins = (() => {
      try {
        return (
          discoverViewerUi(
            root,
            { navigation: { previous: direct } },
            {
              ...hooks,
              navigation: { ...hooks.navigation, previous: "[" },
            },
          ).navigation.previous === direct
        );
      } catch {
        return false;
      }
    })();
    const ignoredPrintRoot = document.createElement("section");
    ignoredPrintRoot.innerHTML =
      '<div class="pdf-container"></div><div class="pdf-print-setup"></div><div class="pdf-print-setup"></div>';
    const ignoredPrintSchema =
      discoverViewerUi(ignoredPrintRoot, {}, PDFJS_VIEWER_UI_HOOKS, false).printSetup.dialog ===
      null;

    const printRoot = createPdfjsViewerUi({ id: "discovery-print" });
    root.append(printRoot);
    const print = discoverViewerUi(printRoot, {}, PDFJS_VIEWER_UI_HOOKS).printSetup;
    const custom = print.customSheet!;
    custom.append(print.customSheetUnit!, print.customSheetHeight!, print.customSheetWidth!);
    const action = printRoot.querySelector<HTMLButtonElement>(".pdf-print-btn")!;
    const captured: { opened?: PdfjsViewerPrintOptions } = {};
    const setup = new ViewerPrintSetup(
      action,
      print,
      PDFJS_VIEWER_DEFAULT_LABELS,
      PDFJS_VIEWER_DEFAULT_FORMATTERS,
      {
        generation: () => 1,
        pageCount: () => 3,
        state: () => ({
          phase: "idle",
          jobId: null,
          totalSheets: 0,
          completedSheets: 0,
          retainedBytes: 0,
          nativeResourcesRetained: false,
        }),
        routeSelected() {},
        closeTransientUi: () => null,
        preflight: async () =>
          ({ ok: false, reason: "unsupported", sourceFallbackAvailable: true }) as never,
        print: async () => ({ ok: false }) as never,
        openSource: async options => {
          captured.opened = options;
          return { ok: true, status: "source-opened", warnings: [] };
        },
        cancelPreparation() {},
        failed() {},
      },
    );
    action.click();
    print.sheet!.value = "custom";
    print.customSheetWidth!.value = "216";
    print.customSheetHeight!.value = "279";
    print.customSheetUnit!.value = "mm";
    print.pageScaling!.value = "shrink-to-fit";
    print.quality!.value = "600";
    print.source!.click();
    await new Promise(resolve => setTimeout(resolve));
    const mappingPreserved =
      JSON.stringify(captured.opened?.sheet) ===
        JSON.stringify({ width: 216, height: 279, unit: "mm" }) &&
      captured.opened?.pageScaling === "shrink-to-fit" &&
      JSON.stringify(captured.opened?.quality) === JSON.stringify({ dpi: 600 });
    setup.destroy();
    const schemaMissingRejected = (() => {
      try {
        new ViewerPrintSetup(
          action,
          { dialog: print.dialog } as never,
          PDFJS_VIEWER_DEFAULT_LABELS,
          PDFJS_VIEWER_DEFAULT_FORMATTERS,
          {} as never,
        );
        return false;
      } catch (error) {
        return error instanceof Error && /binding missing: form/.test(error.message);
      }
    })();
    print.dialog!.append(print.customSheetWidth!);
    const formContainmentRejected = (() => {
      try {
        discoverViewerUi(printRoot, {}, PDFJS_VIEWER_UI_HOOKS);
        return false;
      } catch (error) {
        return (
          error instanceof TypeError &&
          /customSheetWidth.*contained by printSetup\.form/.test(error.message)
        );
      }
    })();
    custom.append(print.customSheetWidth!);
    const outside = document.createElement("input");
    outside.type = "number";
    outside.min = "1";
    document.body.append(outside);
    const containmentRejected = (() => {
      try {
        discoverViewerUi(
          printRoot,
          { printSetup: { dialog: print.dialog!, customSheetWidth: outside } },
          PDFJS_VIEWER_UI_HOOKS,
        );
        return false;
      } catch (error) {
        return error instanceof TypeError && /customSheetWidth.*contained/.test(error.message);
      }
    })();
    outside.remove();
    root.remove();
    return {
      duplicateRejected,
      wrongTypeRejected,
      directWins,
      ignoredPrintSchema,
      mappingPreserved,
      schemaMissingRejected,
      formContainmentRejected,
      containmentRejected,
    };
  },
  probeNavigationHistoryBindingOwnership() {
    const host = document.createElement("section");
    const controls = document.createElement("fieldset");
    const unrelated = document.createElement("button");
    const back = document.createElement("button");
    const forward = document.createElement("button");
    const container = document.createElement("div");
    unrelated.textContent = "Unrelated";
    back.textContent = "Back";
    forward.textContent = "Forward";
    container.className = "pdf-container";
    controls.append(unrelated, back, forward);
    host.append(controls, container);
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "custom",
      features: { navigationHistory: false },
      uiBindings: { container, navigationHistory: { back, forward } },
    });
    const result = {
      unrelatedContainerVisible: !controls.hidden,
      unrelatedControlVisible: !unrelated.hidden && !unrelated.disabled,
      backHiddenAndDisabled:
        back.hidden && back.disabled && back.getAttribute("aria-disabled") === "true",
      forwardHiddenAndDisabled:
        forward.hidden && forward.disabled && forward.getAttribute("aria-disabled") === "true",
    };
    viewer.destroy();
    result.unrelatedContainerVisible &&= !controls.hidden;
    result.unrelatedControlVisible &&= !unrelated.hidden && !unrelated.disabled;
    host.remove();
    return result;
  },
  async probeMinimalCustomUi() {
    const host = document.createElement("section");
    host.innerHTML = '<div class="pdf-container"></div>';
    document.body.append(host);
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "custom" });
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    const load = await viewer.load("/fixture.pdf");
    if (!load.ok) throw new Error("Minimal custom UI fixture did not load");
    await ready;
    const result = {
      status: viewer.state.status,
      pageCount: viewer.state.pageCount,
      controls: !!host.querySelector(".pdf-controls"),
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  async probeCustomOutlineMarkup() {
    const host = document.createElement("section");
    host.innerHTML = `
      <div class="pdf-sidebar">
        <div class="pdf-outline-filter"></div>
        <div class="pdf-outline" aria-label="Host outline"></div>
      </div>
      <div class="pdf-container"></div>
    `;
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: { mode: "custom", labels: { outlineFilter: "Narrow chapters" } },
      features: { outline: { prepareOnLoad: true } },
    });
    void viewer.load("/fixture.pdf");
    await new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    await new Promise<void>((resolve, reject) => {
      if (host.querySelector(".pdf-outline-list, .pdf-no-outline-text")) {
        resolve();
        return;
      }
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error("Timed out waiting for custom outline markup"));
      }, 2_000);
      const observer = new MutationObserver(() => {
        if (!host.querySelector(".pdf-outline-list, .pdf-no-outline-text")) return;
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve();
      });
      observer.observe(host, { childList: true, subtree: true });
    });
    const filter = host.querySelector<HTMLElement>(".pdf-outline-filter");
    const input = host.querySelector<HTMLInputElement>(".pdf-outline-filter-input");
    const list = host.querySelector<HTMLElement>(".pdf-outline-list");
    const link = host.querySelector<HTMLElement>(".pdf-outline-link");
    const item = list?.querySelector<HTMLElement>("li") ?? null;
    const empty = host.querySelector<HTMLElement>(".pdf-no-outline-text");
    const result = {
      filterGenerated: !!filter,
      inputGenerated: !!input,
      closeNotGenerated: !host.querySelector(".pdf-sidebar-close-btn"),
      fallbackHasNoInlineStyle: !filter?.hasAttribute("style") && !input?.hasAttribute("style"),
      partialMarkupNormalized: input?.parentElement === filter,
      fallbackUsesConfiguredLabel:
        input?.placeholder === "Narrow chapters" &&
        input?.getAttribute("aria-label") === "Narrow chapters",
      contentHookGenerated: (!!list && !!link) || !!empty,
      contentHasNoInlineVisualStyle:
        !list?.hasAttribute("style") &&
        !link?.hasAttribute("style") &&
        !empty?.hasAttribute("style"),
      itemStateGeneratedWhenPresent:
        !item || (item.dataset.title !== undefined && item.dataset.depth !== undefined),
      accessibleLabelRestored:
        host.querySelector(".pdf-outline")?.getAttribute("aria-label") === "Host outline",
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  async probeOutlineFilterPolicy() {
    const disabledHost = document.createElement("section");
    disabledHost.style.cssText = "width:600px;height:600px";
    disabledHost.innerHTML = `
      <div class="pdf-sidebar">
        <div class="pdf-outline-filter"><input class="pdf-outline-filter-input"></div>
        <div class="pdf-outline"></div>
      </div>
      <div class="pdf-container" style="width:100%;height:100%"></div>
    `;
    document.body.append(disabledHost);
    const disabledViewer = new PdfjsViewer({
      rootEl: disabledHost,
      runtime,
      ui: "custom",
      features: { outline: { filter: false } },
    });
    const suppliedFilter = disabledHost.querySelector<HTMLElement>(".pdf-outline-filter");
    const disabledMarkupUntouched =
      !suppliedFilter?.hasAttribute("hidden") &&
      suppliedFilter?.getAttribute("aria-hidden") === null &&
      !disabledHost.querySelector<HTMLInputElement>(".pdf-outline-filter-input")?.disabled;
    disabledViewer.destroy();
    disabledHost.remove();

    const persistentHost = document.createElement("section");
    persistentHost.style.cssText = "width:600px;height:600px";
    persistentHost.innerHTML = `
      <button class="pdf-sidebar-toggle-btn">Outline</button>
      <div class="pdf-sidebar" tabindex="-1"><div class="pdf-outline"></div></div>
      <div class="pdf-container" style="width:100%;height:100%"></div>
    `;
    document.body.append(persistentHost);
    const persistentViewer = new PdfjsViewer({
      rootEl: persistentHost,
      runtime,
      ui: "custom",
      behavior: { sidebarMode: "persistent" },
    });
    void persistentViewer.load("/fixture.pdf");
    await new Promise<void>((resolve, reject) => {
      persistentHost.addEventListener("pdf:ready", () => resolve(), { once: true });
      persistentHost.addEventListener(
        "pdf:error",
        event => reject((event as CustomEvent).detail.error),
        { once: true },
      );
    });
    const toggle = persistentHost.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")!;
    toggle.focus();
    toggle.click();
    const input = persistentHost.querySelector<HTMLInputElement>(".pdf-outline-filter-input")!;
    input.value = "chapter";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    toggle.click();
    toggle.click();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    const persistentQueryPreserved = input.value === "chapter";
    const persistentFocusPreserved = document.activeElement !== input;
    await persistentViewer.close();
    const queryClearedOnClose = input.value === "";
    persistentViewer.destroy();
    persistentHost.remove();
    return {
      disabledMarkupUntouched,
      persistentQueryPreserved,
      persistentFocusPreserved,
      queryClearedOnClose,
    };
  },
  probeExternalSidebarBindings() {
    const host = document.createElement("section");
    const toggle = document.createElement("button");
    const sidebar = document.createElement("aside");
    const primaryViews = document.createElement("div");
    const outlineTab = document.createElement("button");
    const thumbnailsTab = document.createElement("button");
    const container = document.createElement("div");
    const outline = document.createElement("div");
    const thumbnails = document.createElement("div");
    outlineTab.type = thumbnailsTab.type = "button";
    outlineTab.dataset.pdfSidebarView = "outline";
    thumbnailsTab.dataset.pdfSidebarView = "thumbnails";
    primaryViews.append(outlineTab, thumbnailsTab);
    sidebar.dataset.open = "false";
    host.append(toggle, sidebar, container);
    document.body.append(host, outline, thumbnails);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "custom",
      uiBindings: {
        container,
        sidebar: { container: sidebar, toggle, primaryViews },
        outline: { content: outline },
        thumbnails: { content: thumbnails },
      },
    });
    toggle.click();
    const outlineVisible = outline.hidden === false && thumbnails.hidden === true;
    thumbnailsTab.click();
    const thumbnailsVisible = outline.hidden === true && thumbnails.hidden === false;
    viewer.setActive(false);
    const inactiveViewsHidden =
      outline.hidden === true &&
      thumbnails.hidden === true &&
      outline.hasAttribute("inert") &&
      thumbnails.hasAttribute("inert");
    viewer.setActive(true);
    toggle.click();
    const bothHiddenWhenClosed = outline.hidden === true && thumbnails.hidden === true;
    viewer.destroy();
    host.remove();
    outline.remove();
    thumbnails.remove();
    return { outlineVisible, thumbnailsVisible, inactiveViewsHidden, bothHiddenWhenClosed };
  },
  probeDisabledPanelOwnership() {
    const host = document.createElement("section");
    host.innerHTML = `
      <button class="pdf-search-toggle-btn">Search</button>
      <div class="pdf-search-panel"><input class="pdf-search-input"></div>
      <button class="pdf-menu-toggle-btn">Menu</button>
      <div class="pdf-menu-panel"><button class="pdf-menu-close-btn">Close</button></div>
      <fieldset class="pdf-rendering-profile-group">
        <label><input type="radio" data-pdf-rendering-profile="conservative">Low memory</label>
        <label><input type="radio" data-pdf-rendering-profile="aggressive">High memory</label>
      </fieldset>
      <div class="pdf-container"></div>
    `;
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: { mode: "custom", controls: { menu: false } } as never,
      features: { search: false },
      renderingProfilePolicy: {
        other: { availableProfiles: ["conservative"], defaultProfile: "conservative" },
      },
    });
    void viewer.load("/fixture.pdf");
    const searchToggle = host.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")!;
    const searchPanel = host.querySelector<HTMLElement>(".pdf-search-panel")!;
    const menuToggle = host.querySelector<HTMLButtonElement>(".pdf-menu-toggle-btn")!;
    const menuPanel = host.querySelector<HTMLElement>(".pdf-menu-panel")!;
    const aggressiveProfile = host.querySelector<HTMLInputElement>(
      '[data-pdf-rendering-profile="aggressive"]',
    )!;
    const result = {
      searchMarkupUntouched:
        !searchToggle.disabled &&
        !searchToggle.hidden &&
        !searchPanel.hidden &&
        !searchPanel.hasAttribute("inert"),
      menuMarkupUntouched:
        !menuToggle.disabled &&
        !menuToggle.hidden &&
        !menuPanel.hidden &&
        !menuPanel.hasAttribute("inert"),
      renderingProfileMarkupUntouched:
        !aggressiveProfile.disabled &&
        !aggressiveProfile.hidden &&
        !aggressiveProfile.closest("label")?.hidden,
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  async probeAnnotationLinkPolicy() {
    const inspectLinks = async (features: PdfjsViewerFeatureOptions) => {
      const host = document.createElement("section");
      host.className = "viewer-host";
      document.body.append(host);
      const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "default", features });
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const load = await viewer.load("/fixture.pdf");
      if (!load.ok) throw new Error("Annotation link fixture did not load");
      await ready;
      await new Promise(resolve => window.setTimeout(resolve, 50));
      const links = Array.from(host.querySelectorAll<HTMLElement>(".pdf-annotation-link"));
      const result = {
        count: links.length,
        anchors: links.filter(link => link instanceof HTMLAnchorElement).length,
        internalAnchors: links.filter(
          link =>
            link instanceof HTMLAnchorElement &&
            link.closest(".linkAnnotation")?.hasAttribute("data-internal-link"),
        ).length,
      };
      viewer.destroy();
      host.remove();
      return result;
    };
    const allDisabled = await inspectLinks({ annotationLinks: false });
    const internalOnly = await inspectLinks({ annotationLinks: { externalUrls: false } });
    const externalOnly = await inspectLinks({ annotationLinks: { internalDestinations: false } });
    const bothEnabled = await inspectLinks({});
    return {
      allDisabled: allDisabled.count,
      internalOnly: internalOnly.count,
      internalOnlyUsesAnchor:
        internalOnly.internalAnchors === 1 && internalOnly.anchors === 1 ? 1 : 0,
      externalOnly: externalOnly.count,
      externalOnlyUsesAnchor:
        externalOnly.anchors === 1 && externalOnly.internalAnchors === 0 ? 1 : 0,
      bothEnabled: bothEnabled.count,
    };
  },
  async probeHeadlessAnnotationGeometry() {
    const host = document.createElement("section");
    host.className = "viewer-host";
    host.style.cssText = "position:relative;width:600px;height:500px";
    document.body.append(host);
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "headless" });
    try {
      const ready = new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const load = await viewer.load("/fixture.pdf");
      if (!load.ok) throw new Error("Headless annotation fixture did not load");
      await ready;
      for (
        let attempt = 0;
        attempt < 50 && !host.querySelector(".pdf-annotation-link");
        attempt++
      ) {
        await new Promise(resolve => window.setTimeout(resolve, 10));
      }
      const layer = host.querySelector<HTMLElement>(".pdf-annotation-link-layer")!;
      const section = layer.querySelector<HTMLElement>(".linkAnnotation")!;
      const link = section.querySelector<HTMLElement>(".pdf-annotation-link")!;
      const page = layer.closest<HTMLElement>(".pdf-page")!;
      const canvas = page.querySelector<HTMLCanvasElement>(":scope > canvas")!;
      const layerRect = layer.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const close = (left: number, right: number) => Math.abs(left - right) < 1;
      return {
        runtimeLayerClass: layer.classList.contains("annotationLayer"),
        packageLayerClass: layer.classList.contains("pdf-annotation-link-layer"),
        packageLinkClass: link.classList.contains("pdf-annotation-link"),
        layerMatchesPage:
          close(layerRect.left, pageRect.left) &&
          close(layerRect.top, pageRect.top) &&
          close(layerRect.width, pageRect.width) &&
          close(layerRect.height, pageRect.height),
        canvasCoversPage:
          close(canvasRect.left, pageRect.left) &&
          close(canvasRect.top, pageRect.top) &&
          canvasRect.width + 1 / 64 >= pageRect.width &&
          canvasRect.height + 1 / 64 >= pageRect.height,
        linkMatchesSection:
          close(linkRect.left, sectionRect.left) &&
          close(linkRect.top, sectionRect.top) &&
          close(linkRect.width, sectionRect.width) &&
          close(linkRect.height, sectionRect.height),
        corePointerGeometry:
          getComputedStyle(layer).pointerEvents === "none" &&
          getComputedStyle(section).pointerEvents === "auto",
      };
    } finally {
      viewer.destroy();
      host.remove();
    }
  },
  async probeAnnotationFailureTextIsolation() {
    const loadingTask = PDFJS.getDocument({ url: "/fixture.pdf" });
    const probeDocument = await loadingTask.promise;
    const probePage = await probeDocument.getPage(1);
    const prototype = Object.getPrototypeOf(probePage) as {
      getAnnotations(...args: unknown[]): Promise<unknown>;
    };
    const original = prototype.getAnnotations;
    const host = document.createElement("section");
    host.className = "viewer-host";
    document.body.append(host);
    const entries: Readonly<PdfjsViewerLogEntry>[] = [];
    prototype.getAnnotations = async () => {
      throw new Error("injected annotation failure");
    };
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      logger: entry => entries.push(entry),
    });
    void viewer.load("/fixture.pdf");
    viewer.setTextSelectionMode(true);
    try {
      await new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
      const deadline = performance.now() + 2_000;
      while (
        (!host.querySelector(".pdf-text-layer span") ||
          !entries.some(entry => entry.event === "annotation-presentation-failed")) &&
        performance.now() < deadline
      ) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return {
        textLayers: host.querySelectorAll(".pdf-text-layer span").length,
        annotationLayers: host.querySelectorAll(".pdf-annotation-link-layer").length,
        diagnostics: entries.filter(entry => entry.event === "annotation-presentation-failed")
          .length,
      };
    } finally {
      prototype.getAnnotations = original;
      viewer.destroy();
      host.remove();
      probePage.cleanup();
      await loadingTask.destroy();
    }
  },
  probeGeneratedUiComposition() {
    const allOverflow = document.createElement("div");
    allOverflow.innerHTML = renderPdfjsViewerUi({
      id: "sidebar-all-overflow",
      sidebar: { primaryViews: [] },
    });
    const host = document.createElement("section");
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      behavior: { zoomGestures: false },
      features: {
        navigationHistory: false,
        search: false,
        attachments: false,
      },
      ui: {
        mode: "default",
        controls: {
          navigation: false,
          fit: false,
          outlineFilter: false,
          download: false,
          print: false,
          documentInformation: false,
          zoom: false,
          pageLayout: false,
          renderingProfile: false,
        },
      },
    });
    void viewer.load("/fixture.pdf");
    const container = host.querySelector<HTMLElement>(".pdf-container")!;
    const findShortcut = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(findShortcut);
    const result = {
      searchOmitted: !host.querySelector(".pdf-search-toggle-btn, .pdf-search-panel"),
      sidebarKeptWithoutFilter:
        !!host.querySelector(".pdf-sidebar") && !host.querySelector(".pdf-outline-filter"),
      sidebarCloseKept: !!host.querySelector(".pdf-sidebar-close-btn"),
      attachmentsOmitted: !host.querySelector(
        '.pdf-attachments, [data-pdf-sidebar-view="attachments"]',
      ),
      pageNavigationOmitted: !host.querySelector(".pdf-page-nav"),
      fitOmitted: !host.querySelector(".pdf-fit-main-btn, .pdf-fit-menu-btn"),
      menuKept: !!host.querySelector(".pdf-menu-panel"),
      menuChildrenOmitted: !host.querySelector(
        [
          ".pdf-download-btn",
          ".pdf-print-btn",
          ".pdf-document-information-btn",
          ".pdf-zoom-controls",
          ".pdf-page-layout-group",
          ".pdf-rendering-profile-group",
          ".pdf-navigation-history-controls",
        ].join(", "),
      ),
      navigationHistoryDisabled:
        !viewer.state.canGoBack &&
        !viewer.state.canGoForward &&
        !viewer.goBack() &&
        !viewer.goForward(),
      nativeTouchActionRestored: container.style.touchAction === "auto",
      browserfindShortcutReleased: !findShortcut.defaultPrevented,
      allViewsCanUseOverflow:
        allOverflow.querySelectorAll(".pdf-sidebar-primary-views [data-pdf-sidebar-view]")
          .length === 0 &&
        allOverflow.querySelectorAll(".pdf-sidebar-more-menu [data-pdf-sidebar-view]").length === 4,
    };
    viewer.destroy();
    host.remove();
    allOverflow.remove();
    return result;
  },
  async probeFeaturePreparation() {
    const waitForReady = (host: HTMLElement) =>
      new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
    const waitForFeature = <T>(host: HTMLElement, type: string) =>
      new Promise<T>(resolve => {
        host.addEventListener(type, event => resolve((event as CustomEvent<T>).detail), {
          once: true,
        });
      });

    const demandHost = document.createElement("section");
    document.body.append(demandHost);
    let demandSearchEvents = 0;
    let demandOutlineEvents = 0;
    demandHost.addEventListener("pdf:searchindexcomplete", () => {
      demandSearchEvents++;
    });
    demandHost.addEventListener("pdf:outlinecomplete", () => {
      demandOutlineEvents++;
    });
    const demandViewer = new PdfjsViewer({
      rootEl: demandHost,
      runtime,
      ui: "default",
    });
    void demandViewer.load("/fixture.pdf");
    await waitForReady(demandHost);
    const deferredByDefault =
      demandSearchEvents === 0 &&
      demandOutlineEvents === 0 &&
      !demandHost.querySelector(".pdf-outline-list, .pdf-no-outline-text") &&
      demandViewer.state.searchPreparation === "idle" &&
      demandViewer.state.outlinePreparation === "idle";
    const demandSearch = waitForFeature<{ status: string; indexedPages: number }>(
      demandHost,
      "pdf:searchindexcomplete",
    );
    const demandOutline = waitForFeature<{ status: string; itemCount: number }>(
      demandHost,
      "pdf:outlinecomplete",
    );
    demandHost.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")?.click();
    const demandOutlineContent = demandHost.querySelector<HTMLElement>(".pdf-outline");
    const outlinePreparationVisible =
      demandOutlineContent?.classList.contains("pdf-outline--preparing") === true &&
      demandOutlineContent.getAttribute("aria-busy") === "true" &&
      demandOutlineContent.getAttribute("aria-label") === "Preparing table of contents…";
    demandHost.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")?.click();
    const demandSearchPanel = demandHost.querySelector<HTMLElement>(".pdf-search-panel");
    const demandSearchCount = demandHost.querySelector<HTMLElement>(".pdf-search-count");
    const panelWidthBeforeQuery = demandSearchPanel?.getBoundingClientRect().width ?? 0;
    const countWidthBeforeQuery = demandSearchCount?.getBoundingClientRect().width ?? 0;
    const demandSearchInput = demandHost.querySelector<HTMLInputElement>(".pdf-search-input")!;
    demandSearchInput.value = "Fixture";
    demandSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
    const preparingIndicatorStyle = demandSearchCount
      ? getComputedStyle(demandSearchCount, "::before")
      : null;
    const panelWidthPreparing = demandSearchPanel?.getBoundingClientRect().width ?? 0;
    const countWidthPreparing = demandSearchCount?.getBoundingClientRect().width ?? 0;
    const searchPreparationVisible =
      demandSearchCount?.textContent === "Preparing search…" &&
      demandSearchCount.classList.contains("pdf-search-count--preparing") &&
      getComputedStyle(demandSearchCount).fontSize === "0px" &&
      preparingIndicatorStyle?.content === '""' &&
      preparingIndicatorStyle.display === "block" &&
      Number.parseFloat(preparingIndicatorStyle.width) > 0 &&
      demandSearchPanel?.getAttribute("aria-busy") === "true";
    const [demandSearchDetail, demandOutlineDetail] = await Promise.all([
      demandSearch,
      demandOutline,
    ]);
    const pendingQueryResolved =
      demandHost.querySelector(".pdf-search-count")?.textContent === "1/3";
    const panelWidthReady = demandSearchPanel?.getBoundingClientRect().width ?? 0;
    const countWidthReady = demandSearchCount?.getBoundingClientRect().width ?? 0;
    const searchPreparationLayoutStable =
      panelWidthBeforeQuery > 0 &&
      countWidthBeforeQuery > 0 &&
      Math.abs(panelWidthBeforeQuery - panelWidthPreparing) < 0.01 &&
      Math.abs(panelWidthPreparing - panelWidthReady) < 0.01 &&
      Math.abs(countWidthBeforeQuery - countWidthPreparing) < 0.01 &&
      Math.abs(countWidthPreparing - countWidthReady) < 0.01;
    demandHost.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")?.click();
    demandHost.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")?.click();
    demandHost.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")?.click();
    demandHost.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")?.click();
    await new Promise(resolve => setTimeout(resolve, 25));
    const demandRunsOnce = demandSearchEvents === 1 && demandOutlineEvents === 1;
    const demandDetailsValid =
      demandSearchDetail.status === "ready" &&
      demandSearchDetail.indexedPages === demandViewer.state.pageCount &&
      demandOutlineDetail.status === "ready" &&
      Number.isInteger(demandOutlineDetail.itemCount) &&
      demandOutlineDetail.itemCount >= 0 &&
      demandViewer.state.searchPreparation === "ready" &&
      demandViewer.state.outlinePreparation === "ready" &&
      demandOutlineContent?.getAttribute("aria-busy") === null &&
      demandOutlineContent?.getAttribute("aria-label") === null &&
      !demandOutlineContent?.classList.contains("pdf-outline--preparing") &&
      !demandSearchCount?.classList.contains("pdf-search-count--preparing");
    demandViewer.destroy();
    demandHost.remove();

    const eagerHost = document.createElement("section");
    document.body.append(eagerHost);
    const eagerOrder: string[] = [];
    eagerHost.addEventListener("pdf:ready", () => eagerOrder.push("ready"));
    eagerHost.addEventListener("pdf:searchindexcomplete", () => eagerOrder.push("search"));
    eagerHost.addEventListener("pdf:outlinecomplete", () => eagerOrder.push("outline"));
    const eagerReady = waitForReady(eagerHost);
    const eagerSearch = waitForFeature<{ status: string; indexedPages: number }>(
      eagerHost,
      "pdf:searchindexcomplete",
    );
    const eagerOutline = waitForFeature<{ status: string; itemCount: number }>(
      eagerHost,
      "pdf:outlinecomplete",
    );
    const eagerViewer = new PdfjsViewer({
      rootEl: eagerHost,
      runtime,
      ui: "headless",
      features: {
        search: { prepareOnLoad: true },
        outline: { prepareOnLoad: true },
      },
    });
    void eagerViewer.load("/fixture.pdf");
    const [, eagerSearchDetail, eagerOutlineDetail] = await Promise.all([
      eagerReady,
      eagerSearch,
      eagerOutline,
    ]);
    const eagerWorksWithoutControls =
      eagerSearchDetail.status === "ready" &&
      eagerSearchDetail.indexedPages === eagerViewer.state.pageCount &&
      eagerOutlineDetail.status === "ready" &&
      Number.isInteger(eagerOutlineDetail.itemCount) &&
      eagerOutlineDetail.itemCount >= 0;
    const eagerEventsFollowReady =
      eagerOrder[0] === "ready" && eagerOrder.includes("search") && eagerOrder.includes("outline");
    eagerViewer.destroy();
    eagerHost.remove();

    return {
      deferredByDefault,
      demandRunsOnce,
      demandDetailsValid,
      pendingQueryResolved,
      searchPreparationVisible,
      searchPreparationLayoutStable,
      outlinePreparationVisible,
      eagerWorksWithoutControls,
      eagerEventsFollowReady,
    };
  },
  async probeLocalization() {
    const host = document.createElement("section");
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: {
        mode: "default",
        direction: "rtl",
        labels: { noOutline: "Empty contents", annotationLink: "PDF link" },
        formatters: {
          searchResultCount: total => `total ${total}`,
          searchResultPosition: (current, total) => `${current} of ${total}`,
          zoom: scale => `zoom ${Math.round(scale * 100)}`,
        },
      },
    });
    void viewer.load("/fixture.pdf");
    await new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    const searchComplete = new Promise<void>(resolve => {
      host.addEventListener("pdf:searchindexcomplete", () => resolve(), { once: true });
    });
    const input = host.querySelector<HTMLInputElement>(".pdf-search-input")!;
    input.value = "Fixture";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await searchComplete;
    const searchFormatted = host.querySelector(".pdf-search-count")?.textContent === "1 of 3";
    const zoomFormatted =
      host
        .querySelector(".pdf-zoom-slider")
        ?.getAttribute("aria-valuetext")
        ?.startsWith("zoom ") === true;
    viewer.setUiText({
      labels: {
        printLayoutAutoHelp: "Layout help X",
        printSheetHelp: "Sheet help X",
        printPageScalingHelp: "Scaling help X",
        printResolutionHelp: "Quality help X",
        printPrepare: "System print X",
        printSource: "Browser PDF X",
      },
    });
    const printSetup = host.querySelector(".pdf-print-setup");
    const result = {
      directionApplied: host.querySelector(".pdf-default-ui")?.getAttribute("dir") === "rtl",
      searchFormatted,
      zoomFormatted,
      printStaticTextRefreshed:
        !printSetup ||
        (host.querySelector(".pdf-print-layout-help")?.textContent === "Layout help X" &&
          host.querySelector(".pdf-print-sheet-help")?.textContent === "Sheet help X" &&
          host.querySelector(".pdf-print-page-scaling-help")?.textContent === "Scaling help X" &&
          host.querySelector(".pdf-print-quality-help")?.textContent === "Quality help X" &&
          host.querySelector(".pdf-print-submit")?.textContent?.includes("System print X") ===
            true &&
          host.querySelector(".pdf-print-source")?.textContent === "Browser PDF X"),
    };
    viewer.destroy();
    host.remove();
    return result;
  },
  async probeDocumentInformation() {
    const first = await primary.getDocumentInformation();
    if (!first.ok) throw new Error(`Document information failed: ${first.reason}`);
    const firstInformation = first.information;
    (firstInformation.custom as Record<string, string | number | boolean>).CustomText = "changed";
    const second = await primary.getDocumentInformation();
    if (!second.ok) throw new Error(`Second document information failed: ${second.reason}`);
    return {
      pageCount: second.information.pageCount,
      pdfFormatVersion: second.information.pdfFormatVersion,
      title: second.information.title,
      author: second.information.author,
      creationDate: second.information.creationDate,
      trapped: second.information.trapped,
      customText: second.information.custom.CustomText as string,
      customNumber: second.information.custom.CustomNumber as number,
      hasOriginalFingerprint: second.information.fingerprints.original.length > 0,
      modifiedFingerprint: second.information.fingerprints.modified,
      permissionsUnavailable: second.information.permissions === null,
      detached:
        firstInformation !== second.information &&
        firstInformation.custom !== second.information.custom &&
        second.information.custom.CustomText === "Custom value",
      capabilitiesValid:
        !second.information.isLinearized &&
        !second.information.hasAcroForm &&
        !second.information.hasXfa &&
        !second.information.isPureXfa &&
        !second.information.hasCollection &&
        !second.information.hasSignatures &&
        second.information.markInfo === null,
    };
  },
  async probeDocumentInformationUiTextRefresh() {
    const root = createPdfjsViewerUi({ id: "information-ui-text" });
    const host = document.createElement("section");
    host.append(root);
    document.body.append(host);
    const action = root.querySelector<HTMLButtonElement>(".pdf-document-information-btn")!;
    const dialog = root.querySelector<HTMLDialogElement>(".pdf-document-information")!;
    const first = {
      title: "Cached title",
      creationDate: "D:20260102030405Z",
      isLinearized: true,
      pageCount: 2,
    } as never;
    const second = {
      title: "Fresh title",
      creationDate: null,
      isLinearized: false,
      pageCount: 3,
    } as never;
    let requests = 0;
    const pending: { resolve?: (value: { ok: true; information: typeof second }) => void } = {};
    const owner = new ViewerDocumentInformation(
      action,
      dialog,
      PDFJS_VIEWER_DEFAULT_LABELS,
      value => `Date A: ${value}`,
      {
        closeTransientUi: () => null,
        getInformation: () => {
          requests++;
          if (requests === 1) return Promise.resolve({ ok: true, information: first });
          return new Promise(resolve => {
            pending.resolve = resolve;
          });
        },
        failed() {},
      },
    );
    try {
      action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      const cachedRequests = requests;
      owner.setUiText(
        {
          ...PDFJS_VIEWER_DEFAULT_LABELS,
          documentInformationFieldTitle: "Title X",
          documentInformationFieldCreationDate: "Created X",
          documentInformationFieldLinearized: "Fast X",
          documentInformationYes: "Yes X",
          documentInformationNo: "No X",
        },
        value => `Date X: ${value}`,
      );
      const cachedFieldsRefreshed =
        dialog.textContent?.includes("Title X") &&
        dialog.textContent?.includes("Date X: D:20260102030405Z") &&
        dialog.textContent?.includes("Yes X") &&
        requests === cachedRequests;

      dialog.querySelector<HTMLButtonElement>(".pdf-document-information-close")!.click();
      action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      owner.setUiText(
        { ...PDFJS_VIEWER_DEFAULT_LABELS, documentInformationLoading: "Loading X" },
        value => value,
      );
      const pendingHidesStaleMetadata =
        dialog.open &&
        dialog.textContent?.includes("Loading X") &&
        !dialog.textContent?.includes("Cached title");
      pending.resolve?.({ ok: true, information: second });
      await Promise.resolve();
      await Promise.resolve();
      const pendingRendersFreshMetadata =
        dialog.textContent?.includes("Fresh title") &&
        !dialog.textContent?.includes("Cached title");
      return {
        cachedFieldsRefreshed: Boolean(cachedFieldsRefreshed),
        pendingHidesStaleMetadata: Boolean(pendingHidesStaleMetadata),
        pendingRendersFreshMetadata: Boolean(pendingRendersFreshMetadata),
        requests,
      };
    } finally {
      owner.destroy();
      host.remove();
    }
  },
  async probePublicDataQueries() {
    const waitForReady = (host: HTMLElement) =>
      new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
          once: true,
        });
      });
    const host = document.createElement("section");
    document.body.append(host);
    let searchEvents = 0;
    let outlineEvents = 0;
    let navigationDestinationId: string | null = null;
    const searchQueryOptions: PdfjsViewerTextQueryOptions = {
      caseSensitive: true,
      diacritics: "ignore",
    };
    const outlineFilterOptions: PdfjsViewerTextQueryOptions = {
      caseSensitive: false,
      diacritics: "respect",
    };
    host.addEventListener("pdf:searchindexcomplete", () => {
      searchEvents++;
    });
    host.addEventListener("pdf:outlinecomplete", () => {
      outlineEvents++;
    });
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      viewerId: "public-query",
      shareableNamedDestinationPrefix: "section:",
      navigationState: {
        readNavigationDestinationId: () => navigationDestinationId,
        writeNavigationDestinationId: id => {
          navigationDestinationId = id;
        },
      },
      behavior: {
        searchQueryOptions,
        outlineFilterOptions,
      },
    });
    void viewer.load("/fixture.pdf");
    searchQueryOptions.caseSensitive = false;
    outlineFilterOptions.diacritics = "smart";
    await waitForReady(host);
    const queryContainer = host.querySelector<HTMLElement>(".pdf-container")!;
    const initialQueryScrollTop = queryContainer.scrollTop;

    const [searchResult, outlineResult] = await Promise.all([
      viewer.search("fixture", { caseSensitive: false }),
      viewer.getOutline(),
    ]);
    const searchDataValid =
      searchResult.ok &&
      searchResult.query === "fixture" &&
      searchResult.matches.length === 3 &&
      searchResult.matches.every(
        (match, index) =>
          match.page === index + 1 &&
          match.segments.length === 1 &&
          match.segments[0]?.text.startsWith(`Fixture page ${index + 1}`) &&
          match.segments[0]?.characterIndex === 0 &&
          match.segments[0]?.length === 7,
      );
    const outlineDataValid =
      outlineResult.ok &&
      outlineResult.items.length === 2 &&
      outlineResult.items[0]?.title === "Café chapter" &&
      outlineResult.items[0]?.destinationStatus === "resolved" &&
      outlineResult.items[0]?.destination?.page === 1 &&
      outlineResult.items[0]?.destination?.navigationDestinationId === undefined &&
      outlineResult.items[1]?.title === "Cafe chapter" &&
      outlineResult.items[1]?.destinationStatus === "resolved" &&
      outlineResult.items[1]?.destination?.page === 2 &&
      outlineResult.items[1]?.destination?.pdfNamedDestination === "section:two" &&
      outlineResult.items[1]?.destination?.navigationDestinationId === "two";

    if (searchResult.ok && searchResult.matches[0]) {
      (searchResult.matches[0]!.segments[0] as { text: string }).text = "mutated";
    }
    if (outlineResult.ok && outlineResult.items[0]) {
      (outlineResult.items[0] as { title: string }).title = "mutated";
    }
    const [secondSearch, secondOutline, singleCharacter] = await Promise.all([
      viewer.search("Fixture"),
      viewer.getOutline(),
      viewer.search("F"),
    ]);
    const resultsAreDetached =
      secondSearch.ok &&
      secondSearch.matches[0]?.segments[0]?.text.startsWith("Fixture page 1") &&
      secondOutline.ok &&
      secondOutline.items[0]?.title === "Café chapter";
    const oneCharacterQueriesWork =
      singleCharacter.ok && new Set(singleCharacter.matches.map(match => match.page)).size === 3;
    const [
      caseSensitiveSearch,
      defaultSearchPolicy,
      partialSearchOverride,
      smartSearch,
      smartAccentedSearch,
      respectingSearch,
      ignoringSearch,
      decomposedIgnoringSearch,
      defaultOutlinePolicy,
      partialOutlineOverride,
      caseSensitiveOutline,
      smartOutline,
      respectingOutline,
      ignoringOutline,
      decomposedRespectingOutline,
    ] = await Promise.all([
      viewer.search("fixture", { caseSensitive: true }),
      viewer.search("fixture"),
      viewer.search("Café", { caseSensitive: false }),
      viewer.search("Cafe", { diacritics: "smart" }),
      viewer.search("Café", { diacritics: "smart" }),
      viewer.search("Café", { diacritics: "respect" }),
      viewer.search("Café", { diacritics: "ignore" }),
      viewer.search("Cafe\u0301", { diacritics: "ignore" }),
      viewer.getOutline({ query: "café chapter" }),
      viewer.getOutline({ query: "café chapter", diacritics: "ignore" }),
      viewer.getOutline({ query: "cafe chapter", caseSensitive: true, diacritics: "ignore" }),
      viewer.getOutline({ query: "Cafe chapter", diacritics: "smart" }),
      viewer.getOutline({ query: "Cafe chapter", diacritics: "respect" }),
      viewer.getOutline({ query: "Café chapter", diacritics: "ignore" }),
      viewer.getOutline({ query: "Cafe\u0301 chapter", diacritics: "respect" }),
    ]);
    const matchingOptionsValid =
      caseSensitiveSearch.ok &&
      caseSensitiveSearch.matches.length === 0 &&
      defaultSearchPolicy.ok &&
      defaultSearchPolicy.matches.length === 0 &&
      partialSearchOverride.ok &&
      partialSearchOverride.matches.length === 2 &&
      smartSearch.ok &&
      smartSearch.matches.length === 2 &&
      smartAccentedSearch.ok &&
      smartAccentedSearch.matches.length === 0 &&
      respectingSearch.ok &&
      respectingSearch.matches.length === 0 &&
      ignoringSearch.ok &&
      ignoringSearch.matches.length === 2 &&
      decomposedIgnoringSearch.ok &&
      decomposedIgnoringSearch.matches.length === 2 &&
      decomposedIgnoringSearch.matches.every(
        match => match.segments.length === 1 && match.segments[0]?.length === 4,
      ) &&
      defaultOutlinePolicy.ok &&
      defaultOutlinePolicy.items.length === 1 &&
      defaultOutlinePolicy.items[0]?.title === "Café chapter" &&
      partialOutlineOverride.ok &&
      partialOutlineOverride.items.length === 2 &&
      caseSensitiveOutline.ok &&
      caseSensitiveOutline.items.length === 0 &&
      smartOutline.ok &&
      smartOutline.items.length === 2 &&
      respectingOutline.ok &&
      respectingOutline.items.length === 1 &&
      respectingOutline.items[0]?.title === "Cafe chapter" &&
      ignoringOutline.ok &&
      ignoringOutline.items.length === 2 &&
      decomposedRespectingOutline.ok &&
      decomposedRespectingOutline.items.length === 1 &&
      decomposedRespectingOutline.items[0]?.title === "Café chapter";
    const preparationReused = searchEvents === 1 && outlineEvents === 1;
    const uiStayedClosed =
      host.querySelector<HTMLElement>(".pdf-search-panel")?.hidden === true &&
      host.querySelector<HTMLInputElement>(".pdf-search-input")?.value === "" &&
      host.querySelector<HTMLElement>(".pdf-search-count")?.textContent === "" &&
      !host.querySelector(".pdf-highlight-layer") &&
      queryContainer.scrollTop === initialQueryScrollTop &&
      host.querySelector<HTMLElement>(".pdf-sidebar")?.dataset.open !== "true";
    host.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")?.click();
    const uiSearchInput = host.querySelector<HTMLInputElement>(".pdf-search-input")!;
    uiSearchInput.value = "fixture";
    uiSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
    const lowercaseSearchCount = host.querySelector(".pdf-search-count")?.textContent;
    uiSearchInput.value = "Fixture";
    uiSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
    const exactCaseSearchCount = host.querySelector(".pdf-search-count")?.textContent;
    host.querySelector<HTMLButtonElement>(".pdf-sidebar-toggle-btn")?.click();
    const uiOutlineInput = host.querySelector<HTMLInputElement>(".pdf-outline-filter-input")!;
    uiOutlineInput.value = "CAFÉ chapter";
    uiOutlineInput.dispatchEvent(new Event("input", { bubbles: true }));
    const outlineItems = Array.from(host.querySelectorAll<HTMLElement>(".pdf-outline-list > li"));
    const respectingOutlineMatch =
      outlineItems[0]?.dataset.hidden !== "1" && outlineItems[1]?.dataset.hidden === "1";
    uiOutlineInput.value = "Cafe chapter";
    uiOutlineInput.dispatchEvent(new Event("input", { bubbles: true }));
    const unaccentedOutlineMatch =
      outlineItems[0]?.dataset.hidden === "1" && outlineItems[1]?.dataset.hidden !== "1";
    const uiPoliciesRespected =
      lowercaseSearchCount === "0" &&
      exactCaseSearchCount === "1/3" &&
      respectingOutlineMatch &&
      unaccentedOutlineMatch;
    uiOutlineInput.value = "";
    uiOutlineInput.dispatchEvent(new Event("input", { bubbles: true }));
    const outlineLinks = Array.from(host.querySelectorAll<HTMLButtonElement>(".pdf-outline-link"));
    navigationDestinationId = "pending";
    outlineLinks[0]?.click();
    for (let attempt = 0; attempt < 30 && navigationDestinationId !== null; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const distantOutlineDoesNotInferNavigation = navigationDestinationId === null;
    outlineLinks[1]?.click();
    for (let attempt = 0; attempt < 30 && navigationDestinationId !== "two"; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const nearbyOutlineUsesInferredNavigation = navigationDestinationId === "two";
    let invalidQueryRejected = false;
    try {
      await viewer.search("   ");
    } catch (error) {
      invalidQueryRejected = error instanceof TypeError;
    }
    viewer.destroy();
    const destroyedSearch = await viewer.search("Fixture");
    const destroyedOutline = await viewer.getOutline();
    const destroyedResults =
      !destroyedSearch.ok &&
      destroyedSearch.reason === "destroyed" &&
      !destroyedOutline.ok &&
      destroyedOutline.reason === "destroyed";
    host.remove();

    const disabledHost = document.createElement("section");
    document.body.append(disabledHost);
    const disabledViewer = new PdfjsViewer({
      rootEl: disabledHost,
      runtime,
      ui: "headless",
      features: { search: false, outline: false },
    });
    void disabledViewer.load("/fixture.pdf");
    await waitForReady(disabledHost);
    const disabledSearch = await disabledViewer.search("Fixture");
    const disabledOutline = await disabledViewer.getOutline();
    const disabledResults =
      !disabledSearch.ok &&
      disabledSearch.reason === "disabled" &&
      !disabledOutline.ok &&
      disabledOutline.reason === "disabled";
    disabledViewer.destroy();
    disabledHost.remove();

    const loadingHost = document.createElement("section");
    document.body.append(loadingHost);
    const loadingViewer = new PdfjsViewer({
      rootEl: loadingHost,
      runtime,
      ui: "headless",
    });
    const loadingLoad = loadingViewer.load("/fixture.pdf");
    const loadingSearch = await loadingViewer.search("Fixture");
    const loadingOutline = await loadingViewer.getOutline();
    const loadingResults =
      !loadingSearch.ok &&
      loadingSearch.reason === "not-ready" &&
      !loadingOutline.ok &&
      loadingOutline.reason === "not-ready";
    await waitForReady(loadingHost);
    await loadingLoad;
    const noNavigationOutline = await loadingViewer.getOutline();
    const builtinDefaultSearch = await loadingViewer.search("fixture");
    const builtinDefaultOutline = await loadingViewer.getOutline({ query: "Cafe chapter" });
    const navigationInferenceIsOptional =
      noNavigationOutline.ok &&
      noNavigationOutline.items.every(
        item => item.destination?.navigationDestinationId === undefined,
      );
    const defaultPoliciesValid =
      builtinDefaultSearch.ok &&
      builtinDefaultSearch.matches.length === 3 &&
      builtinDefaultOutline.ok &&
      builtinDefaultOutline.items.length === 2;
    loadingViewer.destroy();
    loadingHost.remove();

    const cancellationHost = document.createElement("section");
    document.body.append(cancellationHost);
    let stalePreparationEvents = 0;
    cancellationHost.addEventListener("pdf:searchindexcomplete", () => {
      stalePreparationEvents++;
    });
    cancellationHost.addEventListener("pdf:outlinecomplete", () => {
      stalePreparationEvents++;
    });
    const cancellationViewer = new PdfjsViewer({
      rootEl: cancellationHost,
      runtime,
      ui: "headless",
    });
    void cancellationViewer.load("/fixture.pdf");
    await Promise.race([
      waitForReady(cancellationHost),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Cancellation viewer ready timed out")), 2_000),
      ),
    ]);
    const pendingSearch = cancellationViewer.search("Fixture");
    const pendingOutline = cancellationViewer.getOutline();
    const replacement = cancellationViewer.load("/fixture.pdf?query-replacement=1");
    const [cancelledSearch, cancelledOutline] = await Promise.race([
      Promise.all([pendingSearch, pendingOutline]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query cancellation timed out")), 2_000),
      ),
    ]);
    await Promise.race([
      replacement,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Replacement after query cancellation timed out")),
          2_000,
        ),
      ),
    ]);
    const cancelledResults =
      !cancelledSearch.ok &&
      cancelledSearch.reason === "cancelled" &&
      !cancelledOutline.ok &&
      cancelledOutline.reason === "cancelled" &&
      stalePreparationEvents === 0;
    cancellationViewer.destroy();
    cancellationHost.remove();

    const lifecycleHost = document.createElement("section");
    document.body.append(lifecycleHost);
    const lifecycleViewer = new PdfjsViewer({
      rootEl: lifecycleHost,
      runtime,
      ui: "default",
    });
    void lifecycleViewer.load("/fixture.pdf");
    await waitForReady(lifecycleHost);
    lifecycleHost.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")?.click();
    const lifecycleInput = lifecycleHost.querySelector<HTMLInputElement>(".pdf-search-input")!;
    lifecycleInput.value = "Fixture";
    lifecycleInput.dispatchEvent(new Event("input", { bubbles: true }));
    lifecycleHost.querySelector<HTMLButtonElement>(".pdf-search-toggle-btn")?.click();
    await lifecycleViewer.load("/fixture.pdf?search-lifecycle-replacement=1");
    const lifecyclePanel = lifecycleHost.querySelector<HTMLElement>(".pdf-search-panel")!;
    const lifecycleCount = lifecycleHost.querySelector<HTMLElement>(".pdf-search-count")!;
    lifecycleCount.textContent = "preserved";
    const replacementSearch = lifecycleViewer.search("Fixture");
    const searchDidNotMutateUi =
      lifecyclePanel.getAttribute("aria-busy") !== "true" &&
      lifecycleCount.textContent === "preserved" &&
      lifecyclePanel.dataset.open !== "true";
    await replacementSearch;
    lifecycleViewer.destroy();
    lifecycleHost.remove();

    return {
      searchDataValid,
      outlineDataValid,
      resultsAreDetached,
      oneCharacterQueriesWork,
      matchingOptionsValid,
      preparationReused,
      uiStayedClosed,
      uiPoliciesRespected,
      distantOutlineDoesNotInferNavigation,
      nearbyOutlineUsesInferredNavigation,
      invalidQueryRejected,
      destroyedResults,
      disabledResults,
      loadingResults,
      navigationInferenceIsOptional,
      defaultPoliciesValid,
      cancelledResults,
      searchDidNotMutateUi,
    };
  },
  probeViewerIdentity() {
    const createHost = () => {
      const host = document.createElement("section");
      document.body.append(host);
      return host;
    };
    const firstHost = createHost();
    const secondHost = createHost();
    const first = new PdfjsViewer({ rootEl: firstHost, runtime, ui: "default" });
    const second = new PdfjsViewer({ rootEl: secondHost, runtime, ui: "default" });
    const generatedIdsAreUnique =
      first.viewerId !== second.viewerId && first.viewerId.startsWith("pdfjs-viewer-");
    first.destroy();
    second.destroy();
    firstHost.remove();
    secondHost.remove();

    const globalFirstHost = createHost();
    const globalSecondHost = createHost();
    const globalFirst = new PdfjsViewer({
      rootEl: globalFirstHost,
      runtime,
      ui: "default",
      viewerId: "duplicate-global-viewer",
      keyboard: { scope: "global" },
    });
    let duplicateGlobalIdRejected = false;
    try {
      new PdfjsViewer({
        rootEl: globalSecondHost,
        runtime,
        ui: "default",
        viewerId: "duplicate-global-viewer",
        keyboard: { scope: "global" },
      });
    } catch (error) {
      duplicateGlobalIdRejected =
        error instanceof Error && error.message.includes("already registered");
    }
    globalFirst.destroy();
    globalFirstHost.remove();
    globalSecondHost.remove();
    const duplicateHostUntouched =
      !globalSecondHost.hasAttribute("data-pdfjs-viewer-root") &&
      globalSecondHost.childElementCount === 0;
    return {
      generatedIdsAreUnique,
      duplicateGlobalIdRejected: duplicateGlobalIdRejected && duplicateHostUntouched,
    };
  },
  probeConstructorModePolicies() {
    const rejects = (ui: unknown) => {
      const host = document.createElement("section");
      host.innerHTML = '<div class="pdf-container"></div>';
      document.body.append(host);
      try {
        new PdfjsViewer({ rootEl: host, runtime, ui: ui as never });
        return false;
      } catch {
        return true;
      } finally {
        host.remove();
      }
    };
    const host = document.createElement("section");
    host.dir = "rtl";
    host.innerHTML = '<div class="pdf-container" role="main" aria-label="Host document"></div>';
    document.body.append(host);
    let preservesCustomAriaAndDirection = false;
    try {
      const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "custom" });
      const container = host.querySelector<HTMLElement>(".pdf-container");
      preservesCustomAriaAndDirection =
        host.dir === "rtl" &&
        container?.getAttribute("role") === "main" &&
        container.getAttribute("aria-label") === "Host document";
      viewer.destroy();
    } finally {
      host.remove();
    }
    return {
      customDirectionRejected: rejects({ mode: "custom", direction: "rtl" }),
      headlessControlsRejected: rejects({ mode: "headless", controls: { search: false } }),
      preservesCustomAriaAndDirection,
    };
  },
  async probeReadinessOrdering() {
    const host = document.createElement("section");
    document.body.append(host);
    const events: string[] = [];
    let previousStatus: PdfjsViewerState["status"] = "closed";
    host.addEventListener("pdf:statechange", event => {
      const status = (event as CustomEvent<PdfjsViewerState>).detail.status;
      if (status === "ready" && previousStatus !== "ready") events.push("state-ready");
      previousStatus = status;
    });
    host.addEventListener("pdf:ready", () => events.push("ready"));
    host.addEventListener("pdf:searchindexcomplete", () => events.push("search"));
    host.addEventListener("pdf:outlinecomplete", () => events.push("outline"));
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "headless",
      features: { search: { prepareOnLoad: true }, outline: { prepareOnLoad: true } },
    });
    void viewer.load("/fixture.pdf?readiness-ordering=1");
    try {
      await new Promise<void>((resolve, reject) => {
        host.addEventListener("pdf:ready", () => resolve(), { once: true });
        host.addEventListener(
          "pdf:error",
          event => reject((event as CustomEvent<{ error: unknown }>).detail.error),
          { once: true },
        );
      });
      await new Promise<void>((resolve, reject) => {
        if (events.includes("search") && events.includes("outline")) return resolve();
        const timeout = window.setTimeout(
          () => reject(new Error("Preparation events did not settle")),
          2_000,
        );
        host.addEventListener(
          "pdf:outlinecomplete",
          () => {
            if (!events.includes("search")) return;
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        host.addEventListener(
          "pdf:searchindexcomplete",
          () => {
            if (!events.includes("outline")) return;
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
      const readyIndex = events.indexOf("ready");
      return {
        oneReadyState: events.filter(event => event === "state-ready").length === 1,
        statePrecedesReady:
          events.indexOf("state-ready") !== -1 && events.indexOf("state-ready") < readyIndex,
        preparationsFollowReady:
          events.indexOf("search") > readyIndex && events.indexOf("outline") > readyIndex,
        readyStateCount: events.filter(event => event === "state-ready").length,
      };
    } finally {
      viewer.destroy();
      host.remove();
    }
  },
  async probeIframeRouting() {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    await new Promise<void>(resolve => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.src = "about:blank";
    });
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!frameDocument || !frameWindow) throw new Error("Iframe document unavailable");
    const host = frameDocument.createElement("section");
    frameDocument.body.append(host);
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener(
        "pdf:error",
        event => reject((event as CustomEvent<{ error: unknown }>).detail.error),
        { once: true },
      );
    });
    const viewer = new PdfjsViewer({ rootEl: host, runtime, ui: "default" });
    void viewer.load("/fixture.pdf?iframe-routing=1");
    try {
      await ready;
      const container = host.querySelector<HTMLElement>(".pdf-container");
      const before = viewer.state.currentPage;
      const FrameKeyboardEvent = (frameWindow as Window & typeof globalThis).KeyboardEvent;
      container?.dispatchEvent(
        new FrameKeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
      );
      for (
        let frameCount = 0;
        frameCount < 30 && viewer.state.currentPage === before;
        frameCount++
      ) {
        await new Promise<void>(resolve => frameWindow.requestAnimationFrame(() => resolve()));
      }
      const FrameMouseEvent = (frameWindow as Window & typeof globalThis).MouseEvent;
      container?.dispatchEvent(
        new FrameMouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100, clientY: 120 }),
      );
      const dragStarted = container?.style.cursor === "grabbing";
      frameWindow.dispatchEvent(
        new FrameMouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 20 }),
      );
      frameWindow.dispatchEvent(
        new FrameMouseEvent("mouseup", { bubbles: true, button: 0, clientX: 100, clientY: 20 }),
      );

      const scrollOwner = frameDocument.createElement("div");
      scrollOwner.style.cssText = "height:10px;overflow-y:scroll";
      const shadowRoot = scrollOwner.attachShadow({ mode: "open" });
      const scrollContent = frameDocument.createElement("div");
      scrollContent.style.height = "100px";
      const scrollTarget = frameDocument.createElement("div");
      scrollTarget.tabIndex = 0;
      scrollContent.append(scrollTarget);
      shadowRoot.append(scrollContent);
      host.append(scrollOwner);
      const shadowScrollEvent = new FrameKeyboardEvent("keydown", {
        key: "PageDown",
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      scrollTarget.dispatchEvent(shadowScrollEvent);
      return {
        ready: viewer.state.status === "ready",
        ownerDocumentUsed: container?.ownerDocument === frameDocument,
        viewerScopedKeyRouted: viewer.state.currentPage === before + 1,
        ownerWindowDragStopped: dragStarted && container?.style.cursor === "",
        shadowScrollOwnerUsed: !shadowScrollEvent.defaultPrevented,
      };
    } finally {
      viewer.destroy();
      frame.remove();
    }
  },
  destroySecondary() {
    secondary?.destroy();
    secondary = null;
    document.querySelector("#secondary")?.remove();
    window.fixture.secondary = null;
  },
  probeRuntimeLifecycle() {
    const compatibleRuntime = new PdfjsViewerRuntime({ pdfjs: fixturePdfjs, workerSrc });
    let compatible = true;
    try {
      compatibleRuntime.startWorker();
    } catch {
      compatible = false;
    }
    compatibleRuntime.destroy();

    const conflictingRuntime = new PdfjsViewerRuntime({
      pdfjs: fixturePdfjs,
      workerSrc: "/different.worker.min.mjs",
    });
    let conflictRejected = false;
    try {
      conflictingRuntime.startWorker();
    } catch {
      conflictRejected = true;
    }
    conflictingRuntime.destroy();

    let activeDestroyRejected = false;
    try {
      runtime.destroy();
    } catch {
      activeDestroyRejected = true;
    }

    const destroyedRuntime = new PdfjsViewerRuntime({ pdfjs: fixturePdfjs, workerSrc });
    destroyedRuntime.destroy();
    let destroyedReuseRejected = false;
    try {
      destroyedRuntime.startWorker();
    } catch {
      destroyedReuseRejected = true;
    }

    let invalidOptionsRejected = false;
    try {
      new PdfjsViewerRuntime({ pdfjs: PDFJS, workerSrc: 1 as never });
    } catch (error) {
      invalidOptionsRejected = error instanceof TypeError;
    }

    let invalidPdfjsRejected = false;
    try {
      new PdfjsViewerRuntime({ pdfjs: {} as never, workerSrc });
    } catch (error) {
      invalidPdfjsRejected = error instanceof TypeError;
    }

    const alternateRuntime = new PdfjsViewerRuntime({ pdfjs: { ...PDFJS }, workerSrc });
    let differentPdfjsRejected = false;
    try {
      alternateRuntime.startWorker();
    } catch {
      differentPdfjsRejected = true;
    }
    alternateRuntime.destroy();

    return {
      compatible,
      conflictRejected,
      activeDestroyRejected,
      destroyedReuseRejected,
      invalidOptionsRejected,
      invalidPdfjsRejected,
      differentPdfjsRejected,
    };
  },
  addIsolatedRuntimeViewers() {
    const add = (id: string, activeId: string) => {
      const isolatedRuntime = new PdfjsViewerRuntime({ pdfjs: fixturePdfjs, workerSrc });
      const isolatedRoot = document.createElement("section");
      isolatedRoot.id = id;
      isolatedRoot.className = "viewer-host";
      document.body.append(isolatedRoot);
      const viewer = new PdfjsViewer({
        rootEl: isolatedRoot,
        runtime: isolatedRuntime,
        ui: "default",
        viewerId: activeId,
        keyboard: { scope: "global" },
      });
      void viewer.load("/fixture.pdf");
      return viewer;
    };
    // Keep the viewers reachable for the duration of the page fixture.
    const isolatedViewers = [add("isolated-a", "runtime-a"), add("isolated-b", "runtime-b")];
    isolatedViewers[0].setActive(true);
    isolatedViewers[1].setActive(false);
    (window as Window & { isolatedViewers?: PdfjsViewer[] }).isolatedViewers = isolatedViewers;
  },
  probePerformanceOverrides() {
    const host = document.createElement("section");
    document.body.append(host);
    const customLogs: Readonly<PdfjsViewerLogEntry>[] = [];
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      renderingProfile: "balanced",
      renderingProfiles: {
        balanced: { maxBufferViewportHeights: 2.5, maxBufferPages: 40, memoryLimitMiB: 9000 },
      },
      logger: entry => customLogs.push(entry),
    });
    void viewer.load("/fixture.pdf");
    const selected = customLogs.find(entry => entry.event === "rendering-profile-selected");
    const settings = selected?.details?.renderingSettings as Record<string, unknown> | undefined;
    const applied =
      settings?.maxBufferViewportHeights === 2.5 &&
      settings?.maxBufferPages === 40 &&
      settings?.memoryLimitMiB === 8192;
    viewer.destroy();
    host.remove();

    const rejects = (
      overrides: ConstructorParameters<typeof PdfjsViewer>[0]["renderingProfiles"],
    ): boolean => {
      const invalidHost = document.createElement("section");
      document.body.append(invalidHost);
      try {
        new PdfjsViewer({
          rootEl: invalidHost,
          runtime,
          ui: "default",
          renderingProfiles: overrides,
        });
        return false;
      } catch (error) {
        return error instanceof RangeError;
      } finally {
        invalidHost.remove();
      }
    };
    return {
      applied,
      invalidRejected: rejects({ conservative: { memoryLimitMiB: Number.NaN } }),
      invalidCanvasPixelsRejected: rejects({ balanced: { maxCanvasPixels: 0 } }),
      invalidCanvasDimensionRejected: rejects({ aggressive: { maxCanvasDimension: 1.5 } }),
      invalidBufferViewportHeightsRejected: rejects({
        balanced: { maxBufferViewportHeights: Number.NaN },
      }),
      invalidBufferPagesRejected: rejects({ balanced: { maxBufferPages: 1.5 } }),
      invalidInactiveBufferRejected: rejects({
        balanced: { bufferViewportHeightsWhenInactive: -1 },
      }),
    };
  },
  async probeViewportBufferResize() {
    const host = document.createElement("section");
    host.style.width = "700px";
    host.style.height = "0";
    document.body.append(host);
    const ready = new Promise<void>((resolve, reject) => {
      host.addEventListener("pdf:ready", () => resolve(), { once: true });
      host.addEventListener("pdf:error", event => reject((event as CustomEvent).detail.error), {
        once: true,
      });
    });
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      renderingProfile: "balanced",
      renderingProfiles: { balanced: { maxBufferViewportHeights: 1 } },
    });
    void viewer.load("/fixture.pdf");
    try {
      await ready;
      const renderedCount = () =>
        [...host.querySelectorAll<HTMLCanvasElement>(".pdf-page canvas")].filter(
          canvas => canvas.width > 0,
        ).length;
      const before = renderedCount();
      host.style.height = "600px";
      const deadline = performance.now() + 3_000;
      while (renderedCount() <= before && performance.now() < deadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return { before, after: renderedCount() };
    } finally {
      viewer.destroy();
      host.remove();
    }
  },
  probeRuntimeRenderingProfileSelection() {
    const selections: Array<{
      renderingProfile: string;
      effectiveRenderingProfile: string;
      availableRenderingProfiles: readonly string[];
    }> = [];
    const initialAvailability = primary.state.availableRenderingProfiles;
    const onStateChange = (event: Event) => {
      const state = (event as CustomEvent<PdfjsViewerState>).detail;
      selections.push({
        renderingProfile: state.renderingProfile,
        effectiveRenderingProfile: state.effectiveRenderingProfile,
        availableRenderingProfiles: state.availableRenderingProfiles,
      });
    };
    root.addEventListener("pdf:statechange", onStateChange);
    primary.setRenderingProfile("conservative");
    const conservativeRadioChecked =
      root.querySelector<HTMLInputElement>('[data-pdf-rendering-profile="conservative"]')
        ?.checked ?? false;
    primary.setRenderingProfile("auto");
    const availabilityIsStable = primary.state.availableRenderingProfiles === initialAvailability;
    const automaticBalancedRadioChecked =
      root.querySelector<HTMLInputElement>('[data-pdf-rendering-profile="balanced"]')?.checked ??
      false;
    root.removeEventListener("pdf:statechange", onStateChange);

    const unavailableHost = document.createElement("section");
    document.body.append(unavailableHost);
    const unavailableViewer = new PdfjsViewer({
      rootEl: unavailableHost,
      runtime,
      ui: "default",
      renderingProfilePolicy: {
        other: { availableProfiles: ["conservative"], defaultProfile: "conservative" },
      },
    });
    void unavailableViewer.load("/fixture.pdf");
    const unavailableRejected = (() => {
      try {
        unavailableViewer.setRenderingProfile("aggressive");
        return false;
      } catch (error) {
        return error instanceof RangeError;
      }
    })();
    unavailableViewer.destroy();
    unavailableHost.remove();

    const singleProfileHost = document.createElement("section");
    document.body.append(singleProfileHost);
    const singleProfileViewer = new PdfjsViewer({
      rootEl: singleProfileHost,
      runtime,
      ui: "default",
      renderingProfilePolicy: {
        other: { availableProfiles: ["conservative"], defaultProfile: "conservative" },
      },
    });
    const singleProfileFieldsetHidden =
      singleProfileHost.querySelector(".pdf-rendering-profile-group")?.closest("fieldset")
        ?.hidden === true;
    singleProfileViewer.destroy();
    singleProfileHost.remove();

    const destroyedHost = document.createElement("section");
    document.body.append(destroyedHost);
    const destroyedViewer = new PdfjsViewer({
      rootEl: destroyedHost,
      runtime,
      ui: "default",
    });
    destroyedViewer.destroy();
    const destroyedRejected = (() => {
      try {
        destroyedViewer.setRenderingProfile("balanced");
        return false;
      } catch (error) {
        return error instanceof Error;
      }
    })();
    destroyedHost.remove();

    return {
      selections,
      availabilityIsStable,
      conservativeRadioChecked,
      automaticBalancedRadioChecked,
      unavailableRejected,
      destroyedRejected,
      singleProfileFieldsetHidden,
    };
  },
  async probeZoomTextFailureRecovery() {
    const host = document.createElement("section");
    host.className = "viewer-host pdf-headless-ui pdf-container";
    host.dataset.pdfjsViewerRoot = "";
    host.style.cssText = "position:relative;width:600px;height:500px;overflow:auto";
    document.body.append(host);
    const diagnostics: Array<{ event: string; details: Readonly<Record<string, unknown>> }> = [];
    let injectFailures = false;
    let failures = 0;
    let retryEnabled = false;
    let retryRequests = 0;
    let retryPresentation: () => Promise<void> = async () => {};
    const owner = new DocumentTextPresentation({
      container: host,
      TextLayer: PDFJS.TextLayer,
      diagnostic: entry => diagnostics.push(entry),
      demandChanged: () => {
        if (!retryEnabled) return;
        retryRequests++;
        void retryPresentation();
      },
      createTextLayerBuilder: options => {
        const div = document.createElement("div");
        return {
          div,
          cancel() {
            div.replaceChildren();
          },
          async render() {
            if (injectFailures && failures < 2) {
              failures++;
              throw new Error(`Injected text render failure ${failures}`);
            }
            const span = document.createElement("span");
            span.textContent = "Fixture selection recovery text";
            span.style.cssText = "position:absolute;left:20px;top:20px;font:24px sans-serif";
            const spans = [span];
            const strings = [span.textContent];
            options.highlighter.setTextMapping(spans, strings);
            div.replaceChildren(span);
            options.onAppend(div);
          },
        };
      },
    });
    const makeSurface = (registrationEpoch: number) => {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      wrapper.style.cssText = "position:relative;width:600px;height:800px";
      const canvas = document.createElement("canvas");
      wrapper.append(canvas);
      host.append(wrapper);
      return { wrapper, canvas, registrationEpoch };
    };
    const page = {} as import("pdfjs-dist").PDFPageProxy;
    const viewport = (scale: number) => ({
      scale,
      rotation: 0,
      width: 600 * scale,
      height: 800 * scale,
    });
    const context = (
      generation: number,
      scale: number,
      surface: ReturnType<typeof makeSurface>,
    ) => ({
      pageNo: 1,
      page,
      generation,
      capabilities: { annotations: false, text: true },
      isCurrent: (capability: "annotations" | "text") => capability === "text",
      lease: { pageNo: 1, ...surface },
      viewport: viewport(scale),
    });
    try {
      owner.setMode(true);
      owner.setViewportPages([1]);
      const initialSurface = makeSurface(1);
      await owner.present(context(1, 1, initialSurface) as never);
      const textNode = host.querySelector(".pdf-text-layer span")?.firstChild ?? null;
      if (!textNode) throw new Error("Missing text node for zoom failure probe");
      document
        .getSelection()
        ?.setBaseAndExtent(textNode, 1, textNode, Math.min(12, textNode.textContent?.length ?? 0));
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const selectedText = document.getSelection()?.toString() ?? "";
      host.scrollTop = 7;
      const scrollTop = host.scrollTop;
      owner.suspendForZoom();
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const transientMirrorVisible = !!host.querySelector(".pdf-text-selection-highlight");
      const transientNativeSuspended = (document.getSelection()?.toString() ?? "") === "";
      owner.beginSurfaceReflow(false);
      initialSurface.wrapper.remove();
      const targetSurface = makeSurface(2);
      owner.setViewportPages([1]);
      owner.resumeAfterZoom(2);
      injectFailures = true;
      let generation = 2;
      retryPresentation = () => owner.present(context(++generation, 2, targetSurface) as never);
      retryEnabled = true;
      await owner.present(context(generation, 2, targetSurface) as never);
      const fallbackDeadline = performance.now() + 2_000;
      while (
        !diagnostics.some(entry => entry.event === "text-layer-zoom-recovery-fallback") &&
        performance.now() < fallbackDeadline
      ) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      const fallbackNode = host.querySelector(".pdf-text-selection-highlight");
      const fallbackVisible = !!fallbackNode;
      const fallbackDiagnostic = diagnostics.find(
        entry => entry.event === "text-layer-zoom-recovery-fallback",
      );
      const nativeRetained = (document.getSelection()?.toString() ?? "") === "";
      retryEnabled = false;
      await owner.present(context(++generation, 2, targetSurface) as never);
      const recoveredNode = host.querySelector(".pdf-text-selection-highlight");
      return {
        failures,
        retryRequests,
        transientMirrorVisible,
        transientNativeSuspended,
        oneFallbackDiagnostic:
          diagnostics.filter(entry => entry.event === "text-layer-zoom-recovery-fallback")
            .length === 1,
        fallbackVisible,
        nativeRetained,
        laterRestored: (document.getSelection()?.toString() ?? "") === selectedText,
        exactMirrorReplaced: !!recoveredNode && recoveredNode !== fallbackNode,
        scrollStable: host.scrollTop === scrollTop,
        fallbackReportedGeometry: fallbackDiagnostic?.details?.fallbackGeometryAvailable === true,
      };
    } finally {
      owner.destroy();
      host.remove();
    }
  },
  async probeSearchGeometryZoomResume() {
    const host = document.createElement("section");
    host.className = "viewer-host pdf-headless-ui pdf-container";
    host.dataset.pdfjsViewerRoot = "";
    host.style.cssText = "position:relative;width:600px;height:500px;overflow:auto";
    document.body.append(host);
    const owner = new DocumentTextPresentation({
      container: host,
      TextLayer: PDFJS.TextLayer,
      createTextLayerBuilder: options => {
        const div = document.createElement("div");
        return {
          div,
          cancel() {
            div.replaceChildren();
          },
          async render() {
            const span = document.createElement("span");
            span.textContent = "Fixture search geometry";
            span.style.cssText = "position:absolute;left:20px;top:20px;font:24px sans-serif";
            options.highlighter.setTextMapping([span], [span.textContent]);
            div.replaceChildren(span);
            options.onAppend(div);
          },
        };
      },
    });
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";
    wrapper.style.cssText = "position:relative;width:600px;height:800px";
    const canvas = document.createElement("canvas");
    wrapper.append(canvas);
    host.append(wrapper);
    const originalGetClientRects = Range.prototype.getClientRects;
    let suppressGeometry = true;
    Range.prototype.getClientRects = function () {
      const element =
        this.commonAncestorContainer instanceof Element
          ? this.commonAncestorContainer
          : this.commonAncestorContainer.parentElement;
      if (suppressGeometry && element?.closest(".pdf-page")) return [] as unknown as DOMRectList;
      return originalGetClientRects.call(this);
    };
    try {
      owner.setViewportPages([1]);
      owner.setSearchMatches([
        {
          page: 1,
          segments: [
            { textItemIndex: 0, characterIndex: 0, length: 7, text: "Fixture search geometry" },
          ],
        },
      ]);
      await owner.present({
        documentId: 1,
        pageNo: 1,
        page: {} as import("pdfjs-dist").PDFPageProxy,
        generation: 1,
        capabilities: { annotations: false, text: true },
        isCurrent: (capability: "annotations" | "text") => capability === "text",
        lease: { pageNo: 1, wrapper, canvas, registrationEpoch: 1 },
        viewport: { scale: 1, rotation: 0, width: 600, height: 800 },
      } as never);
      owner.suspendForZoom();
      suppressGeometry = false;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const missingWhileSuspended = !host.querySelector(".pdf-search-highlight");
      owner.resumeAfterZoom(1);
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const highlight = host.querySelector<HTMLElement>(".pdf-search-highlight");
      return {
        missingWhileSuspended,
        restoredAfterResume: !!highlight,
        width: highlight?.getBoundingClientRect().width ?? 0,
      };
    } finally {
      Range.prototype.getClientRects = originalGetClientRects;
      owner.destroy();
      host.remove();
    }
  },
  async probeStaleTextFailureDiagnostic() {
    const host = document.createElement("section");
    host.className = "viewer-host pdf-headless-ui pdf-container";
    document.body.append(host);
    const diagnostics: DocumentTextPresentationDiagnostic[] = [];
    let rejectRender!: (error: unknown) => void;
    const renderFailure = new Promise<void>((_resolve, reject) => {
      rejectRender = reject;
    });
    let current = true;
    const owner = new DocumentTextPresentation({
      container: host,
      TextLayer: PDFJS.TextLayer,
      diagnostic: entry => diagnostics.push(entry),
      createTextLayerBuilder: options => {
        const div = document.createElement("div");
        return {
          div,
          cancel() {
            div.replaceChildren();
          },
          async render() {
            const span = document.createElement("span");
            span.textContent = "Stale failure text";
            options.highlighter.setTextMapping([span], [span.textContent]);
            div.replaceChildren(span);
            options.onAppend(div);
            await renderFailure;
          },
        };
      },
    });
    const wrapper = document.createElement("div");
    const canvas = document.createElement("canvas");
    wrapper.append(canvas);
    host.append(wrapper);
    owner.setMode(true);
    owner.setViewportPages([1]);
    const presenting = owner.present({
      documentId: 1,
      pageNo: 1,
      page: {} as import("pdfjs-dist").PDFPageProxy,
      generation: 1,
      capabilities: { annotations: false, text: true },
      isCurrent: (capability: "annotations" | "text") => capability === "text" && current,
      lease: { pageNo: 1, wrapper, canvas, registrationEpoch: 1 },
      viewport: { scale: 1, rotation: 0, width: 600, height: 800 },
    } as never);
    await Promise.resolve();
    current = false;
    rejectRender(new Error("stale text failure"));
    await presenting;
    const count = diagnostics.length;
    owner.destroy();
    host.remove();
    return count;
  },
  async probeSelectionCopyPolicies() {
    const probe = async (policy: "sticky" | "until-copy") => {
      const host = document.createElement("section");
      host.className = "viewer-host pdf-headless-ui pdf-container";
      document.body.append(host);
      let deactivations = 0;
      let completions = 0;
      let managedHandlerCalls = 0;
      let postHandlerCalls = 0;
      let managedPayload = "";
      let payloadReadyAtCompletion = true;
      let owner: DocumentTextPresentation;
      owner = new DocumentTextPresentation({
        container: host,
        TextLayer: PDFJS.TextLayer,
        copied: () => {
          payloadReadyAtCompletion &&= managedPayload === "Fixture copy policy text";
          completions++;
          if (policy === "until-copy") {
            owner.setMode(false);
            deactivations++;
          }
        },
        createTextLayerBuilder: options => {
          const div = document.createElement("div");
          div.addEventListener("copy", event => {
            managedHandlerCalls++;
            event.clipboardData?.setData("text/plain", "Fixture copy policy text");
            managedPayload = event.clipboardData?.getData("text/plain") ?? "";
            event.preventDefault();
          });
          return {
            div,
            cancel() {
              div.replaceChildren();
            },
            async render() {
              const span = document.createElement("span");
              span.textContent = "Fixture copy policy text";
              options.highlighter.setTextMapping([span], [span.textContent]);
              div.replaceChildren(span);
              options.onAppend(div);
            },
          };
        },
      });
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      const canvas = document.createElement("canvas");
      wrapper.append(canvas);
      host.append(wrapper);
      const context = {
        pageNo: 1,
        page: {} as import("pdfjs-dist").PDFPageProxy,
        generation: 1,
        capabilities: { annotations: false, text: true },
        isCurrent: (capability: "annotations" | "text") => capability === "text",
        lease: { pageNo: 1, wrapper, canvas, registrationEpoch: 1 },
        viewport: { scale: 1, rotation: 0, width: 600, height: 800 },
      };
      try {
        owner.setMode(true);
        owner.setViewportPages([1]);
        await owner.present(context as never);
        const span = host.querySelector<HTMLSpanElement>(".pdf-text-layer span");
        const textNode = span?.firstChild;
        if (!span || !textNode) throw new Error("Missing copy policy text node");
        span.parentElement?.addEventListener("copy", () => {
          postHandlerCalls++;
        });
        const selectPdf = () => {
          document
            .getSelection()
            ?.setBaseAndExtent(
              textNode,
              1,
              textNode,
              Math.min(12, textNode.textContent?.length ?? 0),
            );
        };
        const copy = (target: EventTarget) => {
          let prevented = false;
          const values = new Map<string, string>();
          class ControlledCopyEvent extends Event {
            readonly clipboardData = {
              setData(type: string, value: string) {
                values.set(type, value);
              },
              getData(type: string) {
                return values.get(type) ?? "";
              },
            } as DataTransfer;
            override get defaultPrevented() {
              return prevented;
            }
            override preventDefault() {
              prevented = true;
            }
          }
          target.dispatchEvent(
            new ControlledCopyEvent("copy", { bubbles: true, cancelable: true }),
          );
        };
        selectPdf();
        for (let frame = 0; frame < 10 && !owner.selectionPageNos().length; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        const cancel = (event: Event) => event.preventDefault();
        host.addEventListener("copy", cancel, true);
        copy(span);
        host.removeEventListener("copy", cancel, true);
        const survivedCancelled = completions === 0;

        const input = document.createElement("input");
        input.value = "host input copy";
        host.append(input);
        input.select();
        copy(input);
        const survivedInput = completions === 0;
        selectPdf();
        for (let frame = 0; frame < 2; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        const managedSelection = document.getSelection();
        const managedSelectionOwned =
          !!managedSelection?.anchorNode &&
          !!managedSelection.focusNode &&
          host.contains(managedSelection.anchorNode) &&
          host.contains(managedSelection.focusNode);
        const managedSelectionBookmarked = owner.selectionPageNos().length === 1;
        copy(span);
        await Promise.resolve();
        return {
          survivedCancelled,
          survivedInput,
          activeAfterManagedCopy: policy === "sticky" || deactivations === 0,
          deactivations,
          completions,
          managedHandlerCalls,
          postHandlerCalls,
          payloadReadyAtCompletion,
          managedPayload,
          managedSelectionOwned,
          managedSelectionBookmarked,
        };
      } finally {
        owner.destroy();
        host.remove();
      }
    };
    const sticky = await probe("sticky");
    const untilCopy = await probe("until-copy");
    return {
      stickySurvivedManagedCopy: sticky.activeAfterManagedCopy,
      stickyDeactivations: sticky.deactivations,
      stickyCompletedOnce: sticky.completions === 1,
      stickyManagedHandlerRan: sticky.managedHandlerCalls === 2,
      stickyPostHandlerRan: sticky.postHandlerCalls === 2,
      stickyPayloadWrittenBeforeCompletion:
        sticky.payloadReadyAtCompletion && sticky.managedPayload === "Fixture copy policy text",
      stickyManagedSelectionOwned: sticky.managedSelectionOwned,
      stickyManagedSelectionBookmarked: sticky.managedSelectionBookmarked,
      untilCopySurvivedCancelled: untilCopy.survivedCancelled,
      untilCopySurvivedInput: untilCopy.survivedInput,
      untilCopyDeactivated: !untilCopy.activeAfterManagedCopy,
      untilCopyDeactivatedOnce: untilCopy.deactivations === 1,
      untilCopyCompletedOnce: untilCopy.completions === 1,
      untilCopyManagedHandlerRan: untilCopy.managedHandlerCalls === 2,
      untilCopyPostHandlerRan: untilCopy.postHandlerCalls === 2,
      untilCopyPayloadWrittenBeforeCompletion:
        untilCopy.payloadReadyAtCompletion &&
        untilCopy.managedPayload === "Fixture copy policy text",
      untilCopyManagedSelectionOwned: untilCopy.managedSelectionOwned,
      untilCopyManagedSelectionBookmarked: untilCopy.managedSelectionBookmarked,
    };
  },
  async addQueuePriorityViewer() {
    const host = document.createElement("section");
    host.id = "queue-priority";
    host.className = "viewer-host";
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      renderingProfile: "aggressive",
      viewerId: "queue-priority",
      logger: entry => logs.push(entry),
    });
    (window as Window & { queuePriorityViewer?: PdfjsViewer }).queuePriorityViewer = viewer;
    const result = await viewer.load("/queue-fixture.pdf");
    if (!result.ok) throw new Error("Queue-priority fixture did not load");
  },
  async addFitUnseenViewer() {
    const host = document.createElement("section");
    host.id = "fit-unseen";
    host.className = "viewer-host";
    document.body.append(host);
    const viewer = new PdfjsViewer({
      rootEl: host,
      runtime,
      ui: "default",
      renderingProfile: "balanced",
      renderingProfiles: { balanced: { maxBufferViewportHeights: 0 } },
      viewerId: "fit-unseen",
      logger: entry => logs.push(entry),
    });
    (window as Window & { fitUnseenViewer?: PdfjsViewer }).fitUnseenViewer = viewer;
    const result = await viewer.load("/queue-fixture.pdf");
    if (!result.ok) throw new Error("Fit-unseen fixture did not load");
  },
  addSidebarLayoutFallbackViewer() {
    const host = document.createElement("section");
    host.id = "sidebar-layout-fallback";
    host.className = "viewer-host";
    host.style.width = "760px";
    const parsedUi = new DOMParser().parseFromString(
      renderPdfjsViewerUi({
        id: "sidebar-layout-fallback-ui",
        variant: "custom",
      }),
      "text/html",
    );
    host.append(...parsedUi.body.children);
    const style = document.createElement("style");
    style.textContent = `
      #sidebar-layout-fallback .pdf-custom-ui { height: 100%; min-width: 0; display: flex; flex-direction: column; }
      #sidebar-layout-fallback .pdf-viewer-body { position: relative; flex: 1; min-height: 0; display: flex; overflow: hidden; }
      #sidebar-layout-fallback .pdf-sidebar { position: relative; width: 0; min-width: 0; flex: 0 0 0; overflow: hidden; visibility: hidden; transition: width 200ms ease, flex-basis 200ms ease; }
      #sidebar-layout-fallback .pdf-sidebar[data-open="true"] { width: 320px; flex-basis: 320px; visibility: visible; }
      #sidebar-layout-fallback .pdf-container { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; }
    `;
    document.head.append(style);
    document.body.append(host);
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    let viewer: PdfjsViewer;
    try {
      viewer = new PdfjsViewer({
        rootEl: host,
        runtime,
        ui: "custom",
        viewerId: "sidebar-layout-fallback",
      });
    } finally {
      window.ResizeObserver = NativeResizeObserver;
    }
    void viewer.load("/fixture.pdf");
    host.addEventListener("pdf:statechange", event => {
      host.dataset.status = (event as CustomEvent<PdfjsViewerState>).detail.status;
    });
    host.dataset.status = viewer.state.status;
    return viewer;
  },
};
