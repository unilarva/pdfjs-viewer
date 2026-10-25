// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PdfjsViewerRuntime, type PdfjsViewerPdfjsModule } from "../../src/pdfjs-viewer-runtime.js";
import { PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS } from "../../src/pdfjs-version-policy.js";
import { validatePdfjsDisplayCapabilities } from "../../src/pdfjs-compatibility.js";
import { getPdfjsViewerRuntimeAccess } from "../../src/pdfjs-viewer-runtime.js";

function worker(): Worker {
  return { postMessage() {}, terminate() {} } as unknown as Worker;
}

function pdfjsGlobals(
  workerSrc: string,
  workerPort: Worker | null | undefined,
): PdfjsViewerPdfjsModule {
  return {
    version: "6.4.299",
    getDocument() {},
    GlobalWorkerOptions: { workerSrc, workerPort },
  } as unknown as PdfjsViewerPdfjsModule;
}

test("worker lease preserves external mutations across compatible claims and final release", () => {
  const previousPort = worker();
  const installedPort = worker();
  const externalPort = worker();
  const pdfjs = pdfjsGlobals("previous.js", previousPort);
  const first = new PdfjsViewerRuntime({
    pdfjs,
    workerSrc: "installed.js",
    workerPort: installedPort,
  });
  const second = new PdfjsViewerRuntime({
    pdfjs,
    workerSrc: "installed.js",
    workerPort: installedPort,
  });

  first.startWorker();
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "installed.js");
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, installedPort);

  pdfjs.GlobalWorkerOptions.workerSrc = "external.js";
  pdfjs.GlobalWorkerOptions.workerPort = externalPort;
  second.startWorker();
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "external.js");
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, externalPort);

  second.destroy();
  first.destroy();
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "external.js");
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, externalPort);
});

test("worker lease restores untouched prior globals on final release", () => {
  const previousPort = worker();
  const installedPort = worker();
  const pdfjs = pdfjsGlobals("previous.js", previousPort);
  const runtime = new PdfjsViewerRuntime({
    pdfjs,
    workerSrc: "installed.js",
    workerPort: installedPort,
  });

  runtime.startWorker();
  runtime.destroy();

  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "previous.js");
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, previousPort);
});

test("worker lease restores an explicitly present undefined workerPort", () => {
  const installedPort = worker();
  const pdfjs = pdfjsGlobals("previous.js", undefined);
  const runtime = new PdfjsViewerRuntime({
    pdfjs,
    workerSrc: "installed.js",
    workerPort: installedPort,
  });

  runtime.startWorker();
  runtime.destroy();

  assert.equal("workerPort" in pdfjs.GlobalWorkerOptions, true);
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, undefined);
});

test("failed worker global installation rolls back globals, lease, and owned worker", () => {
  let workerSrc = "previous.js";
  let rejectWorkerSrc = true;
  let terminations = 0;
  const globals = {
    get workerSrc() {
      return workerSrc;
    },
    set workerSrc(value: string) {
      workerSrc = value;
      if (rejectWorkerSrc) {
        rejectWorkerSrc = false;
        throw new Error("workerSrc rejected");
      }
    },
    workerPort: null as Worker | null,
  };
  const pdfjs = {
    version: "6.4.299",
    getDocument() {},
    GlobalWorkerOptions: globals,
  } as unknown as PdfjsViewerPdfjsModule;
  const createRuntime = () =>
    new PdfjsViewerRuntime({
      pdfjs,
      workerSrc: "installed.js",
      workerFactory: () =>
        ({
          postMessage() {},
          terminate() {
            terminations++;
          },
        }) as unknown as Worker,
    });

  const failed = createRuntime();
  assert.throws(() => failed.startWorker(), /workerSrc rejected/);
  assert.equal(workerSrc, "previous.js");
  assert.equal(globals.workerPort, null);
  assert.equal(terminations, 1);

  const recovered = createRuntime();
  recovered.startWorker();
  recovered.destroy();
  failed.destroy();
  assert.equal(workerSrc, "previous.js");
  assert.equal(globals.workerPort, null);
  assert.equal(terminations, 2);
});

test("PDF.js version policy freezes qualified releases and rejects unsupported defaults", () => {
  assert.equal(Object.isFrozen(PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS), true);
  assert.deepEqual(PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS, ["6.4.299"]);
  for (const version of PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS) {
    const pdfjs = pdfjsGlobals("previous.js", null);
    pdfjs.version = version;
    const runtime = new PdfjsViewerRuntime({ pdfjs, workerPort: worker() });
    runtime.destroy();
  }
  const candidate = pdfjsGlobals("previous.js", null);
  for (const version of ["6.3.289", "6.2.999"]) {
    candidate.version = version;
    assert.throws(
      () => new PdfjsViewerRuntime({ pdfjs: candidate, workerPort: worker() }),
      /qualified releases \(6\.4\.299\)/,
    );
  }
  assert.throws(
    () =>
      new PdfjsViewerRuntime({
        pdfjs: candidate,
        workerPort: worker(),
        pdfjsVersionPolicy: "anything" as never,
      }),
    /pdfjsVersionPolicy/,
  );
});

test("unqualified PDF.js admission logs but does not bypass structural runtime checks", () => {
  const logs: import("../../src/pdfjs-viewer-runtime.js").PdfjsViewerLogEntry[] = [];
  const candidate = pdfjsGlobals("previous.js", null);
  candidate.version = "6.2.999";
  const runtime = new PdfjsViewerRuntime({
    pdfjs: candidate,
    workerPort: worker(),
    pdfjsVersionPolicy: "allow-unqualified",
    logger: entry => logs.push(entry),
  });
  assert.equal(logs[0]?.event, "unqualified-pdfjs-version");
  assert.deepEqual(logs[0]?.details?.qualifiedVersions, ["6.4.299"]);
  runtime.destroy();
  assert.throws(
    () =>
      new PdfjsViewerRuntime({
        pdfjs: { version: "6.2.999", getDocument() {}, GlobalWorkerOptions: null } as never,
        workerPort: worker(),
        pdfjsVersionPolicy: "allow-unqualified",
      }),
    /display API module/,
  );
  const malformed = pdfjsGlobals("previous.js", null);
  malformed.version = undefined as never;
  assert.throws(
    () =>
      new PdfjsViewerRuntime({
        pdfjs: malformed,
        workerPort: worker(),
        pdfjsVersionPolicy: "allow-unqualified",
      }),
    /pdfjs\.version must be an exact stable release/,
  );
});

test("allow-unqualified does not bypass facade display capability validation", () => {
  const candidate = pdfjsGlobals("previous.js", null);
  candidate.version = "6.2.999";
  const runtime = new PdfjsViewerRuntime({
    pdfjs: candidate,
    workerPort: worker(),
    pdfjsVersionPolicy: "allow-unqualified",
  });
  assert.throws(
    () => validatePdfjsDisplayCapabilities(candidate, { text: true, annotations: true, xfa: true }),
    /TextLayer/,
  );
  runtime.destroy();
});

test("auxiliary documents share one public PDFWorker and defer its final disposal", () => {
  const port = worker();
  const previous = worker();
  const pdfjs = pdfjsGlobals("previous.js", previous);
  let creations = 0,
    destructions = 0,
    factoryCalls = 0;
  class DocumentWorker {
    constructor(options: { port?: Worker }) {
      assert.equal(options.port, port);
      creations++;
    }
    static create() {
      factoryCalls++;
      throw new Error("An owned wrapper must not use the cached factory");
    }
    destroy() {
      destructions++;
    }
  }
  Object.assign(pdfjs, {
    PDFWorker: DocumentWorker,
  });
  const first = new PdfjsViewerRuntime({ pdfjs, workerSrc: "source.js", workerPort: port });
  const second = new PdfjsViewerRuntime({ pdfjs, workerSrc: "source.js", workerPort: port });
  const a = getPdfjsViewerRuntimeAccess(first).acquireDocumentWorker();
  const b = getPdfjsViewerRuntimeAccess(second).acquireDocumentWorker();
  assert.ok(a.worker instanceof DocumentWorker);
  assert.equal(b.worker, a.worker);
  assert.equal(creations, 1);
  assert.equal(factoryCalls, 0);
  first.destroy();
  second.destroy();
  assert.equal(destructions, 0);
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, port);
  a.release();
  a.release();
  assert.equal(destructions, 0);
  b.release();
  assert.equal(destructions, 1);
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, previous);
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "previous.js");
});

test("compatible runtimes reuse a lease while old auxiliary documents settle", () => {
  const port = worker();
  const pdfjs = pdfjsGlobals("previous.js", null);
  let destructions = 0;
  Object.assign(pdfjs, {
    PDFWorker: class {
      static create() {
        throw new Error("Unexpected cached factory call");
      }
      destroy() {
        destructions++;
      }
    },
  });
  const first = new PdfjsViewerRuntime({ pdfjs, workerPort: port });
  const active = getPdfjsViewerRuntimeAccess(first).acquireDocumentWorker();
  first.destroy();
  const second = new PdfjsViewerRuntime({ pdfjs, workerPort: port });
  second.startWorker();
  active.release();
  assert.equal(destructions, 0);
  second.destroy();
  assert.equal(destructions, 1);
});

test("cached worker ownership diagnostics can originate in another window realm", () => {
  const pdfjs = pdfjsGlobals("previous.js", null);
  const collision = runInNewContext('new Error("Cannot use more than one PDFWorker per port.")');
  assert.equal(collision instanceof Error, false);
  let destroyed = 0;
  const cached = { destroy: () => destroyed++ };
  Object.assign(pdfjs, {
    PDFWorker: class {
      constructor() {
        throw collision;
      }
      static create() {
        return cached;
      }
    },
  });
  const runtime = new PdfjsViewerRuntime({ pdfjs, workerPort: worker() });
  const use = getPdfjsViewerRuntimeAccess(runtime).acquireDocumentWorker();
  assert.equal(use.worker, cached);
  runtime.destroy();
  use.release();
  assert.equal(destroyed, 0);
});

test("auxiliary worker capability failure does not strand a physical worker lease", () => {
  const pdfjs = pdfjsGlobals("previous.js", null);
  const runtime = new PdfjsViewerRuntime({ pdfjs, workerPort: worker() });
  assert.throws(
    () => getPdfjsViewerRuntimeAccess(runtime).acquireDocumentWorker(),
    /PDFWorker.create/,
  );
  runtime.destroy();
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "previous.js");
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, null);
});

test("deferred auxiliary release preserves external global mutations", () => {
  const port = worker(),
    external = worker();
  const pdfjs = pdfjsGlobals("previous.js", null);
  Object.assign(pdfjs, {
    PDFWorker: class {
      static create() {
        throw new Error("Unexpected cached factory call");
      }
      destroy() {}
    },
  });
  const runtime = new PdfjsViewerRuntime({ pdfjs, workerPort: port });
  const active = getPdfjsViewerRuntimeAccess(runtime).acquireDocumentWorker();
  runtime.destroy();
  pdfjs.GlobalWorkerOptions.workerSrc = "external.js";
  pdfjs.GlobalWorkerOptions.workerPort = external;
  active.release();
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "external.js");
  assert.equal(pdfjs.GlobalWorkerOptions.workerPort, external);
});

test("real PDF.js 6.4.299 cached host wrappers survive final runtime release", async () => {
  const realPdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  assert.equal(realPdfjs.version, "6.4.299");
  let terminations = 0;
  const listeners = new Set<unknown>();
  const port = {
    addEventListener(_type: string, listener: unknown, options?: AddEventListenerOptions) {
      listeners.add(listener);
      options?.signal?.addEventListener("abort", () => listeners.delete(listener), { once: true });
    },
    removeEventListener(_type: string, listener: unknown) {
      listeners.delete(listener);
    },
    postMessage() {},
    terminate() {
      terminations++;
    },
  } as unknown as Worker;
  // Isolate runtime global writes while retaining the real constructor and port cache.
  const pdfjs = {
    ...realPdfjs,
    GlobalWorkerOptions: {
      workerSrc: "previous.js",
      workerPort: null,
    },
  } as unknown as PdfjsViewerPdfjsModule;
  // The qualified runtime accepts a Worker, but its constructor declaration infers port?: null.
  const host = new realPdfjs.PDFWorker({ port } as unknown as ConstructorParameters<
    typeof realPdfjs.PDFWorker
  >[0]);
  const runtime = new PdfjsViewerRuntime({ pdfjs, workerPort: port });
  let use:
    ReturnType<ReturnType<typeof getPdfjsViewerRuntimeAccess>["acquireDocumentWorker"]> | undefined;
  try {
    await host.promise;
    assert.equal(realPdfjs.PDFWorker.create({ port }), host);
    assert.equal(listeners.size, 1);
    use = getPdfjsViewerRuntimeAccess(runtime).acquireDocumentWorker();
    assert.equal(use.worker, host);
    runtime.destroy();
    assert.equal(host.destroyed, false);
    assert.equal(pdfjs.GlobalWorkerOptions.workerPort, port);
    use.release();
    use.release();
    assert.equal(host.destroyed, false);
    assert.equal(host.port, port);
    assert.equal(listeners.size, 1, "The host message handler remains registered");
    assert.equal(terminations, 0);
    assert.equal(pdfjs.GlobalWorkerOptions.workerPort, null);
    assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "previous.js");
    assert.equal(realPdfjs.PDFWorker.create({ port }), host);
  } finally {
    runtime.destroy();
    use?.release();
    host.destroy();
  }
  assert.equal(host.destroyed, true);
  assert.equal(listeners.size, 0);
  assert.equal(terminations, 0);
});

test("non-collision constructor failures propagate without borrowing or stranding a lease", () => {
  for (const { failure, boundPort } of [
    { failure: new Error("worker initialization failed"), boundPort: true },
    { failure: new Error("Cannot use more than one PDFWorker per port. extra"), boundPort: true },
    { failure: "Cannot use more than one PDFWorker per port.", boundPort: true },
    { failure: new Error("Cannot use more than one PDFWorker per port."), boundPort: false },
  ]) {
    const port = worker();
    const pdfjs = pdfjsGlobals("previous.js", null);
    let factoryCalls = 0,
      destructions = 0,
      attempts = 0;
    class DocumentWorker {
      constructor() {
        if (++attempts === 1) throw failure;
      }
      static create() {
        factoryCalls++;
        throw new Error("Must not guess ownership after an unrelated constructor failure");
      }
      destroy() {
        destructions++;
      }
    }
    Object.assign(pdfjs, { PDFWorker: DocumentWorker });
    const runtime = new PdfjsViewerRuntime({
      pdfjs,
      ...(boundPort
        ? { workerPort: port }
        : {
            workerSrc: "source.js",
            workerFactory: () => {
              throw new Error("Use workerSrc fallback without a bound port");
            },
          }),
    });
    const access = getPdfjsViewerRuntimeAccess(runtime);
    try {
      assert.throws(
        () => access.acquireDocumentWorker(),
        error => error === failure,
      );
      assert.equal(factoryCalls, 0);
      const use = access.acquireDocumentWorker();
      runtime.destroy();
      assert.equal(destructions, 0);
      use.release();
      assert.equal(destructions, 1);
      assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "previous.js");
      assert.equal(pdfjs.GlobalWorkerOptions.workerPort, null);
    } finally {
      runtime.destroy();
    }
  }
});
