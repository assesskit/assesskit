import { isRecord } from "../checks.js";
import type { XmlAttribute, XmlElement } from "../xml/index.js";

/**
 * Returns whether a value has the fields of an element; `serializeXml` checks the rest when it writes the tree.
 *
 * @param value - The value to test.
 * @returns `true` for an element of the tree that `parseXml` returns.
 */
export function isElement(value: unknown): value is XmlElement {
  return (
    isRecord(value) &&
    value.kind === "element" &&
    typeof value.namespace === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.attributes) &&
    Array.isArray(value.children)
  );
}

/**
 * Returns whether a value has the fields of an attribute; `serializeXml` checks the rest when it writes the tree.
 *
 * @param value - The value to test.
 * @returns `true` for an attribute of the tree that `parseXml` returns.
 */
export function isAttribute(value: unknown): value is XmlAttribute {
  return (
    isRecord(value) &&
    typeof value.namespace === "string" &&
    typeof value.name === "string" &&
    typeof value.value === "string" &&
    (value.prefix === undefined || typeof value.prefix === "string")
  );
}
