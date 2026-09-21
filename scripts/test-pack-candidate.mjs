// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.env.PDFJS_VIEWER_CANDIDATE_DIR;
const candidateDir = requested
  ? resolve(requested)
  : await mkdtemp(resolve(tmpdir(), "pdfjs-viewer-candidate-"));
const retain = !!requested;
const npmEnv = { ...process.env, npm_config_cache: resolve(tmpdir(), "kilo/npm-cache") };
if (retain) {
  await access(dirname(candidateDir), constants.W_OK);
  if (!(await stat(dirname(candidateDir))).isDirectory())
    throw new Error("PDFJS_VIEWER_CANDIDATE_DIR parent must be a directory");
  await mkdir(candidateDir, { recursive: true });
  if (!(await stat(candidateDir)).isDirectory())
    throw new Error("PDFJS_VIEWER_CANDIDATE_DIR must be a directory path");
  if ((await readdir(candidateDir)).length)
    throw new Error("PDFJS_VIEWER_CANDIDATE_DIR must be empty");
}
try {
  execFileSync("npm", ["run", "build"], { cwd: packageDir, stdio: "inherit" });
  execFileSync(process.execPath, ["./scripts/validate-dist.mjs"], {
    cwd: packageDir,
    stdio: "inherit",
  });
  const result = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", candidateDir],
      { cwd: packageDir, encoding: "utf8", env: npmEnv },
    ),
  );
  const metadata = Array.isArray(result) ? result[0] : Object.values(result)[0];
  if (!metadata?.filename) throw new Error("npm pack returned no package metadata");
  const tarball = resolve(candidateDir, metadata.filename);
  const hash = createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex");
  const checksum = `${tarball}.sha256`;
  await writeFile(checksum, `${hash}  ${metadata.filename}\n`);
  const candidateFiles = await readdir(candidateDir);
  const candidates = candidateFiles.filter(file => file.endsWith(".tgz"));
  const checksums = candidateFiles.filter(file => file.endsWith(".tgz.sha256"));
  if (
    candidates.length !== 1 ||
    checksums.length !== 1 ||
    checksums[0] !== `${candidates[0]}.sha256`
  ) {
    throw new Error("Candidate directory must contain exactly one tarball and its checksum");
  }
  execFileSync(process.execPath, ["./scripts/validate-pack.mjs", tarball], {
    cwd: packageDir,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["./scripts/test-dist-consumer.mjs", tarball], {
    cwd: packageDir,
    stdio: "inherit",
  });
  if (retain)
    console.log(`Candidate tarball: ${tarball}\nCandidate SHA-256: ${checksum}\nSHA-256: ${hash}`);
} finally {
  if (!retain) await rm(candidateDir, { recursive: true, force: true });
}
