import { isRecord } from "../checks.js";
import type { XmlAttribute, XmlElement, XmlNode } from "../xml/index.js";

/** Returns whether a value has the fields of an element; `serializeXml` checks the rest when it writes the tree. */
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

/** Returns whether a value has the fields of an attribute; `serializeXml` checks the rest when it writes the tree. */
export function isAttribute(value: unknown): value is XmlAttribute {
  return (
    isRecord(value) &&
    typeof value.namespace === "string" &&
    typeof value.name === "string" &&
    typeof value.value === "string" &&
    (value.prefix === undefined || typeof value.prefix === "string")
  );
}

/** Returns whether a value has the fields of a node; `serializeXml` checks the rest when it writes the tree. */
export function isNode(value: unknown): value is XmlNode {
  if (isElement(value)) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "instruction") return typeof value.target === "string" && typeof value.data === "string";
  return (
    (value.kind === "text" || value.kind === "cdata" || value.kind === "comment") && typeof value.value === "string"
  );
}
