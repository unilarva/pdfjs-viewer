// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private immutable XFA structure and value snapshots for presentation and print preparation.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export.
 *
 * The snapshot copies PDF.js's mutable fake-DOM tree and resolves every XFA `dataId`
 * against live annotation storage exactly once. Its narrow read-only storage adapter is
 * deliberately independent of PDF.js `PrintAnnotationStorage`, whose inherited value
 * lookup does not provide XFA DOM values. See the
 * [architecture guide](../ARCHITECTURE.md) for owner and print-boundary details.
 *
 * @packageDocumentation
 * @module xfa-value-snapshot
 */

export interface XfaStructuralNode {
  readonly name: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly value?: unknown;
  readonly children?: readonly (XfaStructuralNode | null)[];
}

export interface XfaValueReader {
  getValue(id: string, fallback: object): object;
}

interface XfaValueSnapshot {
  readonly structure: XfaStructuralNode;
  readonly values: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly annotationStorage: XfaValueReader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue));
  if (isRecord(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])),
    );
  }
  return value;
}

/** Copies a PDF.js XFA fake-DOM tree so XfaLayer cannot mutate shared worker data. */
export function cloneXfaStructure(value: unknown): XfaStructuralNode {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new TypeError("PdfjsViewer: PDF.js returned invalid XFA structure");
  }
  const children = Array.isArray(value.children)
    ? Object.freeze(value.children.map(child => (child == null ? null : cloneXfaStructure(child))))
    : Object.freeze([]);
  const attributes = isRecord(value.attributes)
    ? (cloneValue(value.attributes) as Readonly<Record<string, unknown>>)
    : undefined;
  return Object.freeze({
    name: value.name,
    ...(attributes ? { attributes } : {}),
    ...(Object.hasOwn(value, "value") ? { value: cloneValue(value.value) } : {}),
    children,
  });
}

/** Materializes a mutable render copy because PDF.js currently rewrites radio names. */
export function materializeXfaStructure(value: XfaStructuralNode): XfaStructuralNode {
  const attributes = value.attributes
    ? Object.fromEntries(
        Object.entries(value.attributes).map(([key, item]) => [key, mutableValue(item)]),
      )
    : undefined;
  return {
    name: value.name,
    ...(attributes ? { attributes } : {}),
    ...(Object.hasOwn(value, "value") ? { value: mutableValue(value.value) } : {}),
    children: (value.children ?? []).map(child => (child ? materializeXfaStructure(child) : null)),
  };
}

function mutableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mutableValue);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mutableValue(item)]),
    );
  return value;
}

function structuralDefault(node: XfaStructuralNode): unknown {
  const attributes = node.attributes ?? {};
  if (node.name === "input") {
    const type = String(attributes.type ?? "").toLowerCase();
    if (type === "radio" || type === "checkbox") {
      return attributes.checked ? (attributes.xfaOn ?? "") : (attributes.xfaOff ?? "");
    }
    return attributes.value ?? node.value ?? "";
  }
  if (node.name === "textarea") return node.value ?? "";
  if (node.name === "select") {
    const selected = node.children?.find(child => child?.attributes?.selected);
    return selected?.attributes?.value ?? attributes.value ?? "";
  }
  return node.value ?? null;
}

/** Returns detached XFA field defaults and optional page ownership from a copied tree. */
export function collectXfaFields(structure: XfaStructuralNode): readonly Readonly<{
  id: string;
  domId: string | null;
  pageNo: number;
  defaultValue: unknown;
  name: string | null;
  disabled: boolean;
  readOnly: boolean;
}>[] {
  const fields: Array<
    Readonly<{
      id: string;
      domId: string | null;
      pageNo: number;
      defaultValue: unknown;
      name: string | null;
      disabled: boolean;
      readOnly: boolean;
    }>
  > = [];
  const pages = structure.children?.length ? structure.children : [structure];
  pages.forEach((page, pageIndex) => {
    if (!page) return;
    const stack = [page];
    while (stack.length) {
      const node = stack.pop()!;
      const dataId = node.attributes?.dataId;
      if (typeof dataId === "string" && dataId) {
        const domId = node.attributes?.id;
        fields.push(
          Object.freeze({
            id: dataId,
            domId: typeof domId === "string" && domId ? domId : null,
            pageNo: pageIndex + 1,
            defaultValue: cloneValue(structuralDefault(node)),
            name:
              ([
                node.attributes?.["aria-label"],
                node.attributes?.title,
                node.attributes?.name,
              ].find(value => typeof value === "string" && value.trim()) as string | undefined) ??
              null,
            disabled:
              node.attributes?.disabled === true || node.attributes?.disabled === "disabled",
            readOnly:
              node.attributes?.readonly === true ||
              node.attributes?.readOnly === true ||
              node.attributes?.readonly === "readonly",
          }),
        );
      }
      for (const child of [...(node.children ?? [])].reverse()) if (child) stack.push(child);
    }
  });
  return Object.freeze(fields);
}

/** Freezes XFA values at one job boundary without using PrintAnnotationStorage. */
export function createXfaValueSnapshot(
  structureValue: unknown,
  storage: XfaValueReader,
): XfaValueSnapshot {
  const structure = cloneXfaStructure(structureValue);
  const values: Record<string, Readonly<Record<string, unknown>>> = Object.create(null) as Record<
    string,
    Readonly<Record<string, unknown>>
  >;
  for (const field of collectXfaFields(structure)) {
    const current = storage.getValue(field.id, { value: field.defaultValue }) as Record<
      string,
      unknown
    >;
    values[field.id] = cloneValue(current) as Readonly<Record<string, unknown>>;
  }
  Object.freeze(values);
  const annotationStorage = Object.freeze({
    getValue(id: string, fallback: object): object {
      const value = values[id];
      return value ? { ...fallback, ...value } : { ...fallback };
    },
  });
  return Object.freeze({ structure, values, annotationStorage });
}
