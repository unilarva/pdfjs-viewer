// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { PdfjsViewerRuntime, type PdfjsViewerPdfjsModule } from "../../src/pdfjs-viewer-runtime.js";
import { PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS } from "../../src/pdfjs-version-policy.js";
import { validatePdfjsDisplayCapabilities } from "../../src/pdfjs-compatibility.js";

function worker(): Worker {
  return { postMessage() {}, terminate() {} } as unknown as Worker;
}

function pdfjsGlobals(
  workerSrc: string,
  workerPort: Worker | null | undefined,
): PdfjsViewerPdfjsModule {
  return {
    version: "6.3.289",
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
    version: "6.3.289",
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
  assert.deepEqual(PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS, ["6.3.289"]);
  const candidate = pdfjsGlobals("previous.js", null);
  candidate.version = "6.2.999";
  assert.throws(
    () => new PdfjsViewerRuntime({ pdfjs: candidate, workerPort: worker() }),
    /qualified releases \(6\.3\.289\)/,
  );
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
  assert.deepEqual(logs[0]?.details?.qualifiedVersions, ["6.3.289"]);
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
