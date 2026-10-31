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

/**
 * Text that breaks the rules of XML or of a reader's controls: a DOCTYPE, entities, characters XML 1.0 forbids, a
 * declaration of another version or encoding, namespace declarations that the Namespaces in XML rules forbid, includes,
 * and the delimiters of every kind of node.
 */
const HOSTILE_FRAGMENTS: readonly string[] = [
  '<!DOCTYPE a [<!ENTITY x "y">]>',
  '<!DOCTYPE a SYSTEM "http://example.com/a.dtd">',
  "<!DOCTYPE",
  "&x;",
  "&#0;",
  "&#xD800;",
  "&#x110000;",
  "&#x1;",
  "&amp",
  "<![CDATA[",
  "]]>",
  "<!--",
  "-->",
  "--",
  "<?",
  "?>",
  '<?xml version="1.1"?>',
  '<?xml version="1.0" encoding="utf-16"?>',
  '<?xml version="1.0" encoding="x-user-defined"?>',
  ' xmlns:xml="urn:x"',
  ' xmlns:xmlns="urn:x"',
  ' xmlns:p=""',
  ' xmlns=""',
  ' xmlns="http://www.w3.org/2000/xmlns/"',
  ' xml:lang="not a tag"',
  ' xml:base="//example.com/"',
  '<xi:include href="a.xml"/>',
  '<xi:include href="a.xml" xpointer="x"/>',
  "\u0000",
  "\u0001",
  "﻿",
  "￾",
  "\r",
  "\u0085",
  " ",
  "\ud800",
  "\udc00",
  "<",
  ">",
  "&",
  '"',
  "'",
  ":",
  "a:b:c",
  "p:",
  ":p",
  "=",
];

/** One change to a document: what to do, where, how much, and what to put in. */
export interface Mutation {
  readonly kind: "delete" | "insert" | "overwrite" | "duplicate" | "truncate";
  /** The position, taken modulo the length of the document. */
  readonly at: number;
  /** The number of units to delete, overwrite or duplicate. */
  readonly length: number;
  /** The text to insert or overwrite with. */
  readonly fragment: string;
}

/** Short runs of changes, which together turn a text into almost anything; they insert the fragments or short strings. */
export const mutationsOf = (fragments: readonly string[]): fc.Arbitrary<Mutation[]> =>
  fc.array(
    fc.record({
      kind: fc.constantFrom("delete", "insert", "overwrite", "duplicate", "truncate"),
      at: fc.nat(),
      length: fc.integer({ min: 1, max: 24 }),
      fragment: fc.oneof(fc.constantFrom(...fragments), fc.string({ maxLength: 4 })),
    }),
    { minLength: 1, maxLength: 4 },
  );

/** Changes that turn a document into one that breaks the rules of XML. */
export const mutations: fc.Arbitrary<Mutation[]> = mutationsOf(HOSTILE_FRAGMENTS);

/** How each kind of change rewrites a text at a position. */
const CHANGES: Readonly<Record<Mutation["kind"], (text: string, position: number, change: Mutation) => string>> = {
  delete: (text, position, { length }) => text.slice(0, position) + text.slice(position + length),
  insert: (text, position, { fragment }) => text.slice(0, position) + fragment + text.slice(position),
  overwrite: (text, position, { fragment }) =>
    text.slice(0, position) + fragment + text.slice(position + fragment.length),
  duplicate: (text, position, { length }) =>
    text.slice(0, position) + text.slice(position, position + length) + text.slice(position),
  truncate: (text, position) => text.slice(0, position),
};

/** Returns a text with the changes applied. */
export function mutateText(source: string, changes: readonly Mutation[]): string {
  return changes.reduce(
    (text, change) => CHANGES[change.kind](text, text.length === 0 ? 0 : change.at % text.length, change),
    source,
  );
}

/** Returns the bytes as a text with one character per byte, in which a change to bytes is a change to a text. */
const asCharacters = (bytes: Uint8Array): string => Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

const encoder = new TextEncoder();

/** Returns bytes with the changes applied; a fragment is inserted as its UTF-8 encoding. */
export function mutateBytes(source: Uint8Array, changes: readonly Mutation[]): Uint8Array {
  const mutated = mutateText(
    asCharacters(source),
    changes.map((one) => ({ ...one, fragment: asCharacters(encoder.encode(one.fragment)) })),
  );
  return Uint8Array.from(mutated, (character) => character.charCodeAt(0));
}
