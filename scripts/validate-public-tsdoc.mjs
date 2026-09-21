// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import { API, SymbolFlags } from "typescript/unstable/sync";

import { rootApiManifest } from "./source-entries.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(packageDir, "dist");
const normalizedDistDir = distDir.split(sep).join("/");
const indexPath = resolve(distDir, "index.d.ts");
const expectedExports = new Set([...rootApiManifest.values, ...rootApiManifest.types]);
const classExports = new Set(["PdfjsViewer", "PdfjsViewerRuntime"]);
const errors = [];

const api = new API();
const snapshot = api.updateSnapshot({ openFiles: [indexPath] });

try {
  const project = snapshot.getDefaultProjectForFile(indexPath);
  if (!project)
    throw new Error(`TypeScript could not load ${indexPath}; run the package build first`);
  const sourceFile = project.program.getSourceFile(indexPath);
  if (!sourceFile)
    throw new Error(`TypeScript could not read ${indexPath}; run the package build first`);
  const checker = project.checker;
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol)
    throw new Error(`TypeScript could not resolve the package declaration module ${indexPath}`);

  const isLocalDeclaration = declaration => {
    const path = String(declaration.path).split(sep).join("/");
    return path === normalizedDistDir || path.startsWith(`${normalizedDistDir}/`);
  };
  const localDeclaration = symbol => symbol.declarations.find(isLocalDeclaration);
  const isVisibleMember = symbol =>
    !symbol.name.includes("#") && !/^\d+$/.test(symbol.name) && symbol.name !== "length";
  const locationForNode = node => {
    const declarationSource = node.getSourceFile();
    const location = declarationSource.getLineAndCharacterOfPosition(
      node.getStart(declarationSource),
    );
    return `${declarationSource.fileName}:${location.line + 1}:${location.character + 1}`;
  };
  const locationForSymbol = symbol => {
    const declaration = localDeclaration(symbol);
    return declaration ? locationForNode(declaration.resolve(project)) : indexPath;
  };
  const hasDocumentation = symbol => symbol.getDocumentationComment(checker).trim().length > 0;
  const reportUndocumented = (symbol, apiPath) => {
    if (!hasDocumentation(symbol))
      errors.push(`${locationForSymbol(symbol)}: ${apiPath} has no TSDoc`);
  };

  const visitedTypes = new Set();
  const inspectType = (type, apiPath) => {
    if (!type || visitedTypes.has(type.id)) return;
    visitedTypes.add(type.id);

    for (const constituent of type.getTypes?.() ?? []) inspectType(constituent, apiPath);
    for (const property of checker.getPropertiesOfType(type)) {
      if (!isVisibleMember(property) || !localDeclaration(property)) continue;
      const propertyPath = `${apiPath}.${property.name}`;
      reportUndocumented(property, propertyPath);
      inspectType(checker.getTypeOfSymbol(property), propertyPath);
    }
  };

  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const name of expectedExports) {
    const exported = exports.find(symbol => symbol.name === name);
    if (!exported) {
      errors.push(`${indexPath}: expected root export ${name} is missing`);
      continue;
    }
    const symbol =
      exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    reportUndocumented(symbol, name);

    const type =
      rootApiManifest.types.includes(name) || classExports.has(name)
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbol(symbol);
    inspectType(type, name);

    if (classExports.has(name)) {
      const declaration = localDeclaration(symbol)?.resolve(project);
      declaration?.forEachChild(member => {
        if (member.kind !== SyntaxKind.Constructor) return;
        const documented = /\/\*\*[\s\S]*?\*\//.test(member.getFullText());
        if (!documented)
          errors.push(`${locationForNode(member)}: ${name}.constructor has no TSDoc`);
      });
    }
  }
} finally {
  snapshot.dispose();
  api.close();
}

if (errors.length) {
  console.error("Public API TSDoc validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public API TSDoc covers ${expectedExports.size} package-root exports and their members.`,
  );
}
