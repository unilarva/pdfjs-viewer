// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = resolve(import.meta.dirname, "..");
let project = "webkit";
const forwardedArgs = [];
let projectSpecified = false;
const argumentsToParse = process.argv.slice(2);
for (let index = 0; index < argumentsToParse.length; index++) {
  const argument = argumentsToParse[index];
  if (argument === "--project") {
    if (projectSpecified || !argumentsToParse[index + 1])
      throw new Error("test-webkit-docker.mjs accepts one project value");
    project = argumentsToParse[++index];
    projectSpecified = true;
    if (project !== "webkit" && project !== "mobile-webkit") {
      throw new Error(
        "test-webkit-docker.mjs accepts only --project=webkit or --project=mobile-webkit",
      );
    }
    continue;
  }
  if (argument.startsWith("--project=")) {
    if (projectSpecified) throw new Error("test-webkit-docker.mjs accepts one project value");
    const requestedProject = argument.slice("--project=".length);
    if (requestedProject !== "webkit" && requestedProject !== "mobile-webkit") {
      throw new Error(
        "test-webkit-docker.mjs accepts only --project=webkit or --project=mobile-webkit",
      );
    }
    project = requestedProject;
    projectSpecified = true;
    continue;
  }
  if (argument === "--workers") {
    if (!argumentsToParse[index + 1]) throw new Error("Missing --workers value");
    index++;
    continue;
  }
  if (argument.startsWith("--workers=")) continue;
  forwardedArgs.push(argument);
}
let dependencyRoot = packageDir;
let playwrightPackage;

while (true) {
  try {
    playwrightPackage = JSON.parse(
      await readFile(resolve(dependencyRoot, "node_modules/@playwright/test/package.json"), "utf8"),
    );
    break;
  } catch (error) {
    const parent = dirname(dependencyRoot);
    if (parent === dependencyRoot) {
      throw new Error(
        "Cannot find installed @playwright/test in the package or an ancestor directory",
        { cause: error },
      );
    }
    dependencyRoot = parent;
  }
}

const packageRelativePath = relative(dependencyRoot, packageDir).split(sep).join("/");
const containerPackageDir = packageRelativePath ? `/work/${packageRelativePath}` : "/work";
const containerInstall = process.platform !== "linux";
const userArgs =
  !containerInstall && typeof process.getuid === "function" && typeof process.getgid === "function"
    ? ["--user", `${process.getuid()}:${process.getgid()}`]
    : [];
const dependencyVolumeArgs = containerInstall
  ? [
      "-v",
      "/work/node_modules",
      ...(packageRelativePath ? ["-v", `${containerPackageDir}/node_modules`] : []),
    ]
  : [];
const testCommand = [
  "node",
  "./scripts/playwright-run.mjs",
  `--project=${project}`,
  "--workers=1",
  ...forwardedArgs,
];
const commandArgs = containerInstall
  ? [
      "bash",
      "-lc",
      `cd /work && npm ci && cd ${JSON.stringify(containerPackageDir)} && ${testCommand.join(" ")}`,
    ]
  : testCommand;
const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--init",
    "--ipc=host",
    "--network=host",
    ...userArgs,
    "-e",
    "HOME=/tmp",
    "-v",
    `${dependencyRoot}:/work`,
    ...dependencyVolumeArgs,
    "-w",
    containerPackageDir,
    `mcr.microsoft.com/playwright:v${playwrightPackage.version}-noble`,
    ...commandArgs,
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
