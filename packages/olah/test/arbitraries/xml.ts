import fc from "fast-check";
import { isRecord } from "../../src/checks.js";
import { XMLNS_NAMESPACE, type XmlElement, type XmlNode } from "../../src/index.js";
import { identifier, nonEmptyText } from "./values.js";

/** The namespace of the extension elements that the generators build. */
const EXTENSION_NAMESPACE = "urn:example:extension";

/**
 * An element of a namespace the schemas do not know, as `parseXml` returns it: its own namespace declaration is one of its
 * attributes.
 */
export const extensionElement: fc.Arbitrary<XmlElement> = fc.tuple(identifier, nonEmptyText).map(([name, content]) => ({
  kind: "element",
  namespace: EXTENSION_NAMESPACE,
  name,
  attributes: [{ namespace: XMLNS_NAMESPACE, name: "xmlns", value: EXTENSION_NAMESPACE }],
  children: [{ kind: "text", value: content }],
}));

/**
 * Returns a copy of a model without the `line` and `column` that `parseXml` adds to the elements it reads, so that a model
 * that was read can be compared with the one that was built. Maps and sets are copied with their contents.
 */
export function withoutPositions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPositions);
  if (value instanceof Map) return new Map([...value].map(([key, entry]) => [key, withoutPositions(entry)]));
  if (value instanceof Set) return new Set([...value].map(withoutPositions));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "line" && key !== "column")
      .map(([key, entry]) => [key, withoutPositions(entry)]),
  );
}

/** A decimal number, as `xs:double` and `xs:integer` write it. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Returns a number in its shortest form, so that `0.0` and `0` are one value; any other text stays. */
const numeric = (text: string): string => (NUMBER.test(text.trim()) ? String(Number(text)) : text);

/**
 * Returns the canonical form of a document for comparing what a writer writes with what a reader read: without positions,
 * comments, white space between elements and namespace declarations; with the attributes sorted by namespace and name and
 * the numbers in their shortest form, because a number is a value and not a spelling.
 */
export function canonical(node: XmlNode): XmlNode | undefined {
  if (node.kind === "element") return canonicalElement(node);
  return node.kind === "text" || node.kind === "cdata" ? { ...node, value: numeric(node.value) } : undefined;
}

function canonicalElement(node: XmlElement): XmlElement {
  const children = node.children
    .map(canonical)
    .filter((child): child is XmlNode => child !== undefined)
    .filter((child) => !(child.kind === "text" && child.value.trim() === ""));
  const attributes = node.attributes
    .filter(({ namespace }) => namespace !== XMLNS_NAMESPACE)
    .map((attribute) => ({ ...attribute, value: numeric(attribute.value) }))
    .toSorted((a, b) => `${a.namespace} ${a.name}`.localeCompare(`${b.namespace} ${b.name}`));
  const { line: _line, column: _column, ...rest } = node;
  return { ...rest, attributes, children };
}
