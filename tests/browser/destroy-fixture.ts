// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import * as PDFJS from "pdfjs-dist";
import { PdfjsViewer, PdfjsViewerRuntime } from "../../src/index";
import { makeSyntheticPdf } from "./synthetic-pdf";
import { DocumentPageSources } from "../../src/document-page-sources";
import { DocumentPageUsage } from "../../src/document-page-usage";

declare global {
  interface Window {
    destroyLifecycle: Awaited<ReturnType<typeof createDestroyLifecycle>>;
    createDestroyLifecycle: typeof createDestroyLifecycle;
    createSourceQueueLifetime: typeof createSourceQueueLifetime;
    sourceQueueLifetime: ReturnType<typeof createSourceQueueLifetime>;
  }
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => (release = resolve));
  return { promise, release };
}

/** Instruments only public PDF.js task/proxy APIs and the host worker factory. */
async function createDestroyLifecycle(options: {
  holdRead: boolean;
  cleanupFails: boolean;
  taskFails: boolean;
}) {
  const readGate = gate();
  const readEntered = gate();
  const cleanupGate = gate();
  const taskGate = gate();
  const events: string[] = [];
  let liveTasks = 0;
  let terminations = 0;
  const runtime = new PdfjsViewerRuntime({
    pdfjs: {
      ...PDFJS,
      getDocument: (...args: Parameters<typeof PDFJS.getDocument>) => {
        const task = PDFJS.getDocument(...args);
        liveTasks++;
        const promise = task.promise.then(
          pdf =>
            new Proxy(pdf, {
              get(target, property) {
                if (property === "getData")
                  return async () => {
                    events.push("read-start");
                    readEntered.release();
                    await readGate.promise;
                    const data = await target.getData();
                    events.push("read-end");
                    return data;
                  };
                if (property === "cleanup")
                  return async () => {
                    events.push("cleanup-start");
                    await cleanupGate.promise;
                    await target.cleanup();
                    events.push("cleanup-end");
                    if (options.cleanupFails) throw new Error("Injected cleanup failure");
                  };
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
        );
        return new Proxy(task, {
          get(target, property) {
            if (property === "promise") return promise;
            if (property === "destroy")
              return async () => {
                events.push("task-start");
                await taskGate.promise;
                await target.destroy();
                liveTasks--;
                events.push("task-end");
                if (options.taskFails) throw new Error("Injected task failure");
              };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    },
    workerSrc: "/pdf.worker.min.mjs",
    workerFactory: source => {
      const worker = new Worker(source, { type: "module" });
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminations++;
        events.push("worker-end");
        terminate();
      };
      return worker;
    },
  });
  const rootEl = document.querySelector<HTMLElement>("#viewer")!;
  const viewer = new PdfjsViewer({ rootEl, runtime, ui: "default" });
  const result = await viewer.load({
    type: "data",
    data: makeSyntheticPdf({ labels: ["Ordinary loaded document"] }),
  });
  if (!result.ok) throw new Error("Ordinary document failed to load");
  if (options.holdRead) {
    void viewer.getDocumentData();
    await readEntered.promise;
  }
  return {
    snapshot: () => ({ events: [...events], liveTasks, terminations, status: viewer.state.status }),
    destroy: () => {
      const result = viewer.destroy();
      viewer.destroy();
      return result === undefined;
    },
    releaseRead: readGate.release,
    releaseCleanup: cleanupGate.release,
    releaseTask: taskGate.release,
  };
}

window.createDestroyLifecycle = createDestroyLifecycle;

/** Keeps the resolver alive while weakly observing its last retired result or rejected error. */
function createSourceQueueLifetime(failure = false) {
  const page = {
    view: [0, 0, 600, 800],
    rotate: 0,
    userUnit: 1,
    cleanup() {},
    getAnnotations: async () => [],
  } as unknown as PDFJS.PDFPageProxy;
  const makePdf = () =>
    ({
      numPages: 1,
      isPureXfa: false,
      getPage: async () => page,
      getPermissions: async () => null,
      getMetadata: async () => ({
        info: { IsAcroFormPresent: false, IsXFAPresent: false, IsSignaturesPresent: false },
      }),
      getFieldObjects: async () => null,
      getOptionalContentConfig: async () => ({}),
    }) as unknown as PDFJS.PDFDocumentProxy;
  const base = makePdf();
  let reference: WeakRef<object> | undefined;
  let disposed = 0;
  const owner = new DocumentPageSources(base, new DocumentPageUsage(base), {
    load: async () => {
      if (failure) {
        const error = new Error("Injected source loading failure");
        reference = new WeakRef(error);
        throw error;
      }
      const pdf = makePdf();
      reference = new WeakRef(pdf);
      return {
        pdf,
        dispose: async () => {
          disposed++;
        },
      };
    },
  });
  return {
    cycle: async () => {
      const result = await owner.prepare(new Uint8Array([1]));
      if (result.ok) result.source.release();
      return result.ok;
    },
    snapshot: () => ({ disposed, reachable: reference?.deref() !== undefined }),
    close: () => owner.close(),
  };
}
window.createSourceQueueLifetime = createSourceQueueLifetime;
