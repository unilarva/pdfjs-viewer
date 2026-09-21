// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import {
  PdfjsViewerRuntime,
  PdfjsViewer,
  type PdfjsViewerErrorEvent,
  type PdfjsViewerStateChangeEvent,
} from "../src/index.js";
import * as pdfjs from "pdfjs-dist";
import { resolveDemoPrintPolicy } from "./demo-policy.js";

declare const __PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY__: "qualified-only" | "allow-unqualified";
declare const __PDFJS_VIEWER_DEMO_PRINT_MODE__: "off" | "native" | "browser";
declare const __PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT__:
  "portrait" | "portrait-and-landscape" | null;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required demo element: ${selector}`);
  return element;
}

const form = requiredElement<HTMLFormElement>("#pdf-form");
const input = requiredElement<HTMLInputElement>("#pdf-url");
const fileInput = requiredElement<HTMLInputElement>("#pdf-file");
const fileButton = requiredElement<HTMLButtonElement>("#pdf-file-button");
const changeButton = requiredElement<HTMLButtonElement>("#pdf-change-button");
const controls = requiredElement<HTMLDetailsElement>("#pdf-controls");
const samplePdfButton = requiredElement<HTMLButtonElement>("#sample-pdf-button");
const rootEl = requiredElement<HTMLElement>("#pdf-viewer");
const statusEl = requiredElement<HTMLOutputElement>("#demo-status");
const mobileControls = window.matchMedia("(max-width: 40rem)");
const samplePdfUrl = "./sample.pdf";

const params = new URLSearchParams(window.location.search);
const restoredInputValue = input.value.trim();
const initialPdfUrl = isLocalFileName(restoredInputValue)
  ? samplePdfUrl
  : params.get("pdf")?.trim() || restoredInputValue;
setUrlInput(initialPdfUrl);

const runtime = new PdfjsViewerRuntime({
  pdfjs,
  workerSrc: "./pdf.worker.min.mjs",
  pdfjsVersionPolicy: __PDFJS_VIEWER_DEMO_PDFJS_VERSION_POLICY__,
});
const printPolicy = resolveDemoPrintPolicy(
  __PDFJS_VIEWER_DEMO_PRINT_MODE__,
  __PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT__,
);

const viewer = new PdfjsViewer({
  rootEl,
  runtime,
  ...(printPolicy.deviceCompatibility
    ? { deviceCompatibility: printPolicy.deviceCompatibility }
    : {}),
  defaultDocumentOptions: { standardFontDataUrl: "./standard_fonts/" },
  keyboard: { scope: "global" },
  features: { print: printPolicy.printMode },
});

function setStatus(message: string, error = false): void {
  statusEl.value = message;
  statusEl.title = message;
  statusEl.dataset.error = String(error);
}

function isLocalFileName(value: string): boolean {
  return value !== "" && !value.startsWith(".") && !/[/:\\]/.test(value);
}

function setUrlInput(url: string): void {
  input.value = url;
  delete input.dataset.localFile;
  input.removeAttribute("title");
}

function setLocalFileInput(file: File): void {
  input.value = file.name;
  input.dataset.localFile = "true";
  input.title = "Local PDF file, not a URL";
}

function setControlsOpen(open: boolean, focusUrl = false): void {
  controls.open = open;
  changeButton.setAttribute("aria-expanded", String(open));
  if (open && focusUrl) input.focus();
}

function syncControlsForViewport(): void {
  setControlsOpen(!mobileControls.matches);
}

function updateAddress(pdfUrl: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("pdf", pdfUrl);
  window.history.replaceState(null, "", url);
}

function clearPdfAddress(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("pdf");
  window.history.replaceState(null, "", url);
}

async function loadPdf(pdfUrl: string): Promise<void> {
  setStatus("Loading…");
  setUrlInput(pdfUrl);
  if (mobileControls.matches) setControlsOpen(false);
  updateAddress(pdfUrl);

  try {
    await viewer.load(pdfUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Unable to load PDF: ${message}`, true);
    setControlsOpen(true, true);
  }
}

async function loadLocalPdf(file: File): Promise<void> {
  setStatus(`Loading ${file.name}…`);
  if (mobileControls.matches) setControlsOpen(false);
  clearPdfAddress();
  setLocalFileInput(file);

  try {
    await viewer.load(await file.arrayBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Unable to load PDF: ${message}`, true);
    setControlsOpen(true, true);
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (input.dataset.localFile === "true") {
    setUrlInput("");
    input.focus();
    return;
  }
  const pdfUrl = input.value.trim();
  if (pdfUrl) void loadPdf(pdfUrl);
});

changeButton.addEventListener("click", () => {
  setControlsOpen(!controls.open, !controls.open);
});

controls.addEventListener("toggle", () => {
  changeButton.setAttribute("aria-expanded", String(controls.open));
});

fileButton.addEventListener("click", () => fileInput.click());

samplePdfButton.addEventListener("click", () => {
  void loadPdf(samplePdfUrl);
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files ?? [];
  if (file) void loadLocalPdf(file);
  fileInput.value = "";
});

input.addEventListener("dragover", event => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    input.dataset.dragging = "true";
  }
});

input.addEventListener("dragleave", () => {
  delete input.dataset.dragging;
});

input.addEventListener("drop", event => {
  const [file] = event.dataTransfer?.files ?? [];
  if (!file) return;
  event.preventDefault();
  delete input.dataset.dragging;
  void loadLocalPdf(file);
});

rootEl.addEventListener("pdf:statechange", event => {
  const state = (event as PdfjsViewerStateChangeEvent).detail;
  if (state.status === "loading") setStatus("Loading…");
  if (state.status === "ready") {
    setStatus(`Ready — ${state.pageCount} page${state.pageCount === 1 ? "" : "s"}`);
  }
});

rootEl.addEventListener("pdf:error", event => {
  const error = (event as PdfjsViewerErrorEvent).detail.error;
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`Unable to load PDF: ${message}`, true);
  setControlsOpen(true, true);
});

syncControlsForViewport();
mobileControls.addEventListener("change", syncControlsForViewport);
void loadPdf(initialPdfUrl);

window.addEventListener(
  "pagehide",
  () => {
    mobileControls.removeEventListener("change", syncControlsForViewport);
    viewer.destroy();
    runtime.destroy();
  },
  { once: true },
);
