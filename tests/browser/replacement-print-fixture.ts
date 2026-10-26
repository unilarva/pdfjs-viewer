// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Private browser instrumentation for real PDF.js source-local native print renders. */
import * as PDFJS from "pdfjs-dist";

interface RenderRecord {
  document: number;
  page: number;
  text: string;
  configDocument: number | null;
  configIntent: string | null;
  storage: boolean;
  pixel: number[];
}
interface PrintTrace {
  renders: RenderRecord[];
  dataReads: number;
  saves: number;
  failRender: boolean;
  failSource: boolean;
}
let trace: PrintTrace | null = null;
let nextDocument = 0;
const configs = new WeakMap<object, { document: number; intent: string }>();

/** Starts an isolated trace; calls are recorded only while explicitly enabled. */
export function startPrintTrace(): PrintTrace {
  return (trace = { renders: [], dataReads: 0, saves: 0, failRender: false, failSource: false });
}

/** Preserves PDF.js receiver identities while observing render inputs and settled pixels. */
export function instrumentPrintDocument(pdf: PDFJS.PDFDocumentProxy): PDFJS.PDFDocumentProxy {
  const document = ++nextDocument;
  return new Proxy(pdf, {
    get(target, key) {
      if (key === "getData" || key === "saveDocument")
        return (...args: unknown[]) => {
          if (trace) trace[key === "getData" ? "dataReads" : "saves"]++;
          return Reflect.apply(target[key], target, args);
        };
      if (key === "getOptionalContentConfig")
        return async (options?: { intent?: string }) => {
          const config = await target.getOptionalContentConfig(options);
          configs.set(config, { document, intent: options?.intent ?? "display" });
          return config;
        };
      if (key === "getPage")
        return async (pageNo: number) => {
          if (trace?.failSource && target.numPages === 1)
            throw new Error("Synthetic auxiliary page acquisition failure");
          const page = await target.getPage(pageNo);
          return new Proxy(page, {
            get(target, key) {
              if (key === "render")
                return (parameters: Parameters<PDFJS.PDFPageProxy["render"]>[0]) => {
                  const admitted = trace;
                  if (!admitted || parameters.intent !== "print") return target.render(parameters);
                  if (admitted.failRender)
                    throw new Error("Synthetic replacement print render error");
                  const task = target.render(parameters);
                  const promise = task.promise.then(async () => {
                    const config = await parameters.optionalContentConfigPromise;
                    const owner = config ? configs.get(config) : undefined;
                    const canvas = parameters.canvas as HTMLCanvasElement;
                    const pixel = canvas
                      .getContext("2d")!
                      .getImageData(
                        Math.floor((canvas.width * 150) / 612),
                        Math.floor((canvas.height * 252) / 792),
                        1,
                        1,
                      ).data;
                    admitted.renders.push({
                      document,
                      page: pageNo,
                      text: (await target.getTextContent()).items
                        .map(item => ("str" in item ? item.str : ""))
                        .join(" "),
                      configDocument: owner?.document ?? null,
                      configIntent: owner?.intent ?? null,
                      storage: parameters.printAnnotationStorage !== undefined,
                      pixel: Array.from(pixel).slice(0, 3),
                    });
                  });
                  return new Proxy(task, {
                    get(target, key) {
                      if (key === "promise") return promise;
                      const value = Reflect.get(target, key, target);
                      return typeof value === "function" ? value.bind(target) : value;
                    },
                  });
                };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
