// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExactPdfjsVersionUnion } from "./pdfjs-version-manifest.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(packageDir, "package.json");
const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
const versionPolicySource = await readFile(
  resolve(packageDir, "src/pdfjs-version-policy.ts"),
  "utf8",
);
const qualifiedArray = versionPolicySource.match(
  /PDFJS_VIEWER_QUALIFIED_PDFJS_VERSIONS\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*as const\s*\)/,
);
let qualifiedVersions = [];
if (qualifiedArray) {
  try {
    const inner = qualifiedArray[1].trim().replace(/,\s*$/, "");
    const parsed = JSON.parse(`[${inner}]`);
    if (
      Array.isArray(parsed) &&
      parsed.every(version => typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version))
    ) {
      qualifiedVersions = parsed;
    }
  } catch {}
}
const errors = [];

const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

const expectFile = async (relativePath, description) => {
  try {
    await access(resolve(packageDir, relativePath), constants.R_OK);
  } catch {
    errors.push(`${description} is missing or unreadable: ${relativePath}`);
  }
};

expect(pkg.name === "@unilarva/pdfjs-viewer", 'name must be "@unilarva/pdfjs-viewer"');
expect(pkg.type === "module", 'type must be "module"');
expect(
  typeof pkg.version === "string" && /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(pkg.version),
  "version must be a valid semver string",
);
expect(pkg.main === "./dist/index.js", 'main must be "./dist/index.js"');
expect(pkg.module === "./dist/index.js", 'module must be "./dist/index.js"');
expect(pkg.types === "./dist/index.d.ts", 'types must be "./dist/index.d.ts"');
expect(Array.isArray(pkg.files), "files must be an array");
for (const file of [
  "dist",
  "README.md",
  "USAGE.md",
  "CUSTOMIZATION.md",
  "ARCHITECTURE.md",
  "DEVICE-COMPATIBILITY.md",
  "CHANGELOG.md",
  "LICENSE",
  "assets/icons/unilarva-pdfjs-viewer-logo-adaptive.svg",
]) {
  expect(pkg.files?.includes(file), `files must include "${file}"`);
}

expect(
  pkg.exports?.["."]?.import === "./dist/index.js",
  'exports["."].import must be "./dist/index.js"',
);
expect(
  pkg.exports?.["."]?.types === "./dist/index.d.ts",
  'exports["."].types must be "./dist/index.d.ts"',
);
expect(
  pkg.exports?.["./core.css"] === "./dist/core.css",
  'exports["./core.css"] must be "./dist/core.css"',
);
expect(
  pkg.exports?.["./default-ui.css"] === "./dist/default-ui.css",
  'exports["./default-ui.css"] must be "./dist/default-ui.css"',
);
expect(
  pkg.exports?.["./package.json"] === "./package.json",
  'exports["./package.json"] must be "./package.json"',
);
expect(pkg.sideEffects?.includes("./dist/core.css"), 'sideEffects must include "./dist/core.css"');
expect(
  pkg.sideEffects?.includes("./dist/default-ui.css"),
  'sideEffects must include "./dist/default-ui.css"',
);
expect(
  typeof pkg.peerDependencies?.["pdfjs-dist"] === "string",
  "peerDependencies must declare pdfjs-dist",
);
expect(
  qualifiedVersions.length > 0,
  "pdfjs-version-policy must declare at least one qualified exact release",
);
expect(
  new Set(qualifiedVersions).size === qualifiedVersions.length,
  "pdfjs-version-policy qualified releases must not contain duplicates",
);
expect(
  qualifiedVersions.every(
    (version, index) =>
      index === 0 ||
      qualifiedVersions[index - 1].localeCompare(version, undefined, { numeric: true }) < 0,
  ),
  "pdfjs-version-policy qualified releases must be ascending",
);
let peerVersions = [];
try {
  peerVersions = [...parseExactPdfjsVersionUnion(pkg.peerDependencies?.["pdfjs-dist"])];
} catch {}
expect(
  peerVersions.length === qualifiedVersions.length &&
    peerVersions.every((version, index) => version === qualifiedVersions[index]),
  "pdfjs-dist peer dependency must be the exact ordered union of qualified releases",
);
expect(
  pkg.devDependencies?.["pdfjs-dist"] === qualifiedVersions.at(-1),
  "development pdfjs-dist must exactly match the newest qualified release",
);
expect(
  /^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.["@playwright/test"] ?? ""),
  "Playwright must be pinned to one exact browser revision set",
);
expect(typeof pkg.devDependencies?.prettier === "string", "devDependencies must declare Prettier");
expect(pkg.publishConfig?.provenance === true, "publishConfig.provenance must be true");
expect(pkg.engines?.node === ">=22.13.0", "engines.node must match the PDF.js minimum");
for (const dependencyField of [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]) {
  expect(
    !("@unilarva/pdfjs-viewer" in (pkg[dependencyField] ?? {})),
    `${dependencyField} must not self-reference the package`,
  );
}
expect(
  pkg.repository?.url === "git+https://github.com/unilarva/pdfjs-viewer.git",
  "repository.url must identify the standalone public repository",
);
expect(
  !("directory" in (pkg.repository ?? {})),
  "repository.directory must be absent for a standalone repository",
);
expect(
  pkg.bugs?.url === "https://github.com/unilarva/pdfjs-viewer/issues",
  "bugs.url must identify the standalone public issue tracker",
);
expect(
  pkg.homepage === "https://github.com/unilarva/pdfjs-viewer#readme",
  "homepage must identify the standalone public repository",
);
expect(
  pkg.scripts?.["test:consumer"] === "node ./scripts/test-dist-consumer.mjs",
  "test:consumer must run the built-package consumer test",
);
expect(
  pkg.scripts?.["demo:print-test"] ===
    "PDFJS_VIEWER_DEMO_HOST=0.0.0.0 PDFJS_VIEWER_DEMO_NATIVE_PRINT_SUPPORT=portrait-and-landscape npm run demo",
  "demo:print-test must run the externally reachable full native-print compatibility demo",
);
expect(
  pkg.scripts?.["test:pack"] === "node ./scripts/test-pack-candidate.mjs",
  "test:pack must run the single-candidate orchestrator",
);
expect(pkg.scripts?.format === "prettier --write .", "format must run Prettier in write mode");
expect(
  pkg.scripts?.["format:check"] === "prettier --check .",
  "format:check must verify formatting without modifying files",
);
expect(pkg.scripts?.validate?.includes("npm run format:check"), "validate must enforce formatting");
expect(
  pkg.scripts?.["validate:dist"]?.includes("npm run test:consumer"),
  "validate:dist must run the built-package consumer test",
);
expect(
  pkg.scripts?.["validate:dist"]?.includes("npm run validate:tsdoc"),
  "validate:dist must run public API TSDoc validation",
);
expect(
  pkg.scripts?.["validate:tsdoc"] === "node ./scripts/validate-public-tsdoc.mjs",
  "validate:tsdoc must inspect the built public declaration graph",
);
for (const engine of ["chromium", "firefox", "webkit"]) {
  expect(
    typeof pkg.scripts?.[`test:browser:mobile:${engine}`] === "string",
    `mobile ${engine} browser script must be declared`,
  );
}
for (const engine of ["chromium", "firefox"]) {
  expect(
    pkg.scripts?.[`test:browser:${engine}:non-csp`]?.includes("--grep-invert=@csp"),
    `${engine} non-CSP browser script must exclude the explicit CSP gate`,
  );
}
expect(
  typeof pkg.scripts?.["test:browser:mobile:webkit:docker"] === "string",
  "local mobile WebKit Docker script must be declared",
);

for (const [path, description] of [
  ["README.md", "README"],
  ["USAGE.md", "consumer integration and API guide"],
  ["CUSTOMIZATION.md", "consumer UI customization guide"],
  ["ARCHITECTURE.md", "maintainer architecture guide"],
  ["DEVICE-COMPATIBILITY.md", "device compatibility policy and qualification guide"],
  ["CHANGELOG.md", "changelog"],
  ["LICENSE", "license"],
  [".github/workflows/ci.yml", "standalone GitHub Actions pipeline"],
  [".github/workflows/release.yml", "Trusted Publishing release pipeline"],
  [".gitlab-ci.yml", "standalone GitLab pipeline"],
  ["src/index.ts", "public source entry"],
  ["src/pdfjs-version-policy.ts", "public PDF.js version policy"],
  ["src/core.css", "functional core stylesheet source"],
  ["src/default-ui-theme.css", "default UI theme stylesheet source"],
  ["scripts/test-dist-consumer.mjs", "built-package consumer test"],
  ["scripts/validate-public-tsdoc.mjs", "public API TSDoc validator"],
  ["scripts/test-pack-candidate.mjs", "single-candidate package gate"],
  ["scripts/demo-host.mjs", "demo host and policy configuration"],
  ["scripts/demo-pdf.mjs", "demo sample PDF generator"],
  ["scripts/demo-server.mjs", "demo server"],
  ["scripts/validate-pack.mjs", "packed tarball validator"],
  ["scripts/source-entries.mjs", "build and public API manifest"],
  ["tests/package-consumer/consumer.ts", "consumer TypeScript fixture"],
  ["tests/package-consumer/tsconfig.json", "consumer TypeScript configuration"],
  ["tests/package-consumer/tsconfig.nodenext.json", "NodeNext consumer TypeScript configuration"],
  ["tests/package-consumer/vite/main.ts", "Vite production consumer fixture"],
  ["tests/package-consumer/webpack/main.js", "Webpack production consumer fixture"],
  ["tsconfig.build.json", "build TypeScript configuration"],
]) {
  await expectFile(path, description);
}

try {
  const [ciWorkflow, releaseWorkflow] = await Promise.all([
    readFile(resolve(packageDir, ".github/workflows/ci.yml"), "utf8"),
    readFile(resolve(packageDir, ".github/workflows/release.yml"), "utf8"),
  ]);
  expect(
    ciWorkflow.includes("npm run validate") && ciWorkflow.includes("npm run typecheck"),
    "GitHub validation must run the complete source gate and typecheck",
  );
  expect(
    ciWorkflow.includes("chromium:non-csp") && ciWorkflow.includes("firefox:non-csp"),
    "GitHub desktop browser gates must leave CSP coverage to the explicit CSP gate",
  );
  expect(
    releaseWorkflow.includes('tags:\n      - "v*"'),
    "release workflow must run only for version tags",
  );
  expect(
    releaseWorkflow.includes("needs: qualify") &&
      releaseWorkflow.includes("name: npm") &&
      releaseWorkflow.includes("id-token: write"),
    "release workflow must isolate Trusted Publishing in the protected publish job",
  );
  const publishJob = releaseWorkflow.split("\n  publish:\n")[1] ?? "";
  expect(
    publishJob.includes("actions/download-artifact@") &&
      !publishJob.includes("actions/checkout@") &&
      !publishJob.includes("npm ci") &&
      !publishJob.includes("npm run"),
    "publish job must download the qualified candidate without source checkout or project execution",
  );
  expect(
    publishJob.includes("sha256sum --check"),
    "publish job must reverify the downloaded candidate checksum",
  );
  expect(
    releaseWorkflow.includes("Verify exact release tag"),
    "release workflow must verify tag/version equality",
  );
  expect(
    releaseWorkflow.includes("PDFJS_VIEWER_CANDIDATE_DIR"),
    "release workflow must retain the exact-pack candidate",
  );
  expect(
    releaseWorkflow.includes("npm run test:pack"),
    "release workflow must run the exact-pack gate",
  );
  for (const command of [
    "test:browser:mobile:chromium",
    "test:browser:mobile:firefox",
    "test:browser:mobile:webkit:docker",
  ])
    expect(releaseWorkflow.includes(`npm run ${command}`), `release workflow must run ${command}`);
  expect(
    releaseWorkflow.includes('npm publish "${{ steps.candidate.outputs.tarball }}"'),
    "release workflow must publish the verified tested tarball",
  );
  expect(
    releaseWorkflow.includes("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02") &&
      releaseWorkflow.includes(
        "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
      ) &&
      releaseWorkflow.includes("release-candidate") &&
      releaseWorkflow.includes("*.sha256"),
    "release workflow must transfer the candidate and checksum through pinned artifact actions",
  );
  expect(
    releaseWorkflow.includes("--provenance --access public"),
    "release workflow must publish the tested tarball publicly with provenance",
  );
  expect(
    !/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./.test(releaseWorkflow),
    "release workflow must not use stored npm credentials",
  );
  expect(
    !/^\s*- uses:\s+actions\/[^@\s]+@v\d+/m.test(`${ciWorkflow}\n${releaseWorkflow}`),
    "GitHub workflows must pin actions to immutable commit SHAs",
  );
} catch {
  // The required-file error above reports an absent workflow.
}

try {
  const [coreCss, defaultUiThemeCss] = await Promise.all([
    readFile(resolve(packageDir, "src/core.css"), "utf8"),
    readFile(resolve(packageDir, "src/default-ui-theme.css"), "utf8"),
  ]);
  expect(
    !/\.pdf-(?:document-information|print-(?!native-))/.test(coreCss),
    "core.css must not contain generated document-information or print-dialog UI selectors",
  );
  expect(
    !/\.pdf-thumbnails\s*\{[^}]*\bmin-height\s*:/.test(coreCss),
    "core.css must not define the default thumbnail panel layout",
  );
  for (const selector of [
    ".pdf-sidebar-panel:not([hidden])",
    ".pdf-thumbnail-list",
    ".pdf-attachment-list",
    ".pdf-layers-tree",
    ".pdf-layer-group",
    ".pdf-layer-choice",
  ])
    expect(
      !coreCss.includes(selector),
      `core.css must not contain default sidebar selector ${selector}`,
    );
  for (const selector of [
    ".pdf-sidebar-panel:not([hidden])",
    ".pdf-thumbnail-list",
    ".pdf-attachment-list",
    ".pdf-layers-tree",
    ".pdf-layer-group",
    ".pdf-layer-choice",
  ])
    expect(
      defaultUiThemeCss.includes(selector),
      `default-ui-theme.css must contain default sidebar selector ${selector}`,
    );
  expect(
    /\.pdf-thumbnails\s*\{[^}]*\bflex\s*:/.test(defaultUiThemeCss),
    "default-ui-theme.css must define the default thumbnail panel layout",
  );
  expect(
    coreCss.includes(".pdf-sidebar-panel[hidden]") && coreCss.includes(".pdf-thumbnail-canvas"),
    "core.css must retain functional sidebar visibility and thumbnail-canvas sizing",
  );
  expect(
    defaultUiThemeCss.includes("container: pdfjs-viewer / size") &&
      defaultUiThemeCss.includes("container: pdfjs-dialog / inline-size"),
    "default UI must name root and dialog query containers",
  );
  expect(
    !/@container\s*\(/.test(defaultUiThemeCss) &&
      defaultUiThemeCss.includes("@container pdfjs-viewer") &&
      defaultUiThemeCss.includes("@container pdfjs-dialog"),
    "default UI container queries must name their container",
  );
  expect(
    !defaultUiThemeCss.includes(".pdf-print-conditional[hidden]") &&
      /\.pdf-default-ui\s+\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/.test(
        defaultUiThemeCss,
      ),
    "hidden print conditionals must never reserve dialog layout space",
  );
  expect(
    defaultUiThemeCss.includes(".pdf-document-information") &&
      defaultUiThemeCss.includes(".pdf-print-setup"),
    "default-ui-theme.css must own generated document-information and print-dialog styling",
  );
} catch {
  // The required-file errors above report absent stylesheet sources.
}

if (errors.length) {
  console.error("Package validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Package metadata and source entry points are valid.");
}
