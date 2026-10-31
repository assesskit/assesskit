import { checkArray, checkRecord, checkString } from "../checks.js";
import { XML_NAMESPACE, type XmlAttribute, type XmlElement, type XmlNode, XSI_NAMESPACE } from "./tree.js";

/** The prefixes that an attribute name may carry, with their namespaces: no other prefix is declared by `buildElement`. */
const ATTRIBUTE_PREFIXES: ReadonlyMap<string, string> = new Map([
  ["xml", XML_NAMESPACE],
  ["xsi", XSI_NAMESPACE],
]);

function toAttribute(qualified: string, value: string): XmlAttribute {
  const colon = qualified.indexOf(":");
  if (colon < 0) return { namespace: "", name: qualified, value };
  const prefix = qualified.slice(0, colon);
  return { namespace: ATTRIBUTE_PREFIXES.get(prefix) ?? "", prefix, name: qualified.slice(colon + 1), value };
}

/**
 * Builds an element for a writer. Attributes whose value is `undefined` are left out, so that an optional field of a model
 * is written only when it is set; the others keep the order of the object.
 *
 * @param namespace - The namespace of the element; it is declared where `serializeXml` writes the element.
 * @param name - The local name.
 * @param attributes - The attributes by name. A name with the prefix `xml:` or `xsi:` is in that namespace; the others are
 * in none.
 * @param children - The child nodes. A string is a text node, and an empty string is left out.
 * @returns The element.
 * @throws `DataError` when an argument has the wrong type. The tree is checked further when `serializeXml` writes it.
 */
export function buildElement(
  namespace: string,
  name: string,
  attributes: Readonly<Record<string, string | undefined>> = {},
  children: readonly (XmlNode | string)[] = [],
): XmlElement {
  checkString(namespace, "The namespace of an element");
  checkString(name, "The name of an element");
  checkRecord(attributes, "The attributes of an element must be an object");
  checkArray(children, "The children of an element must be an array");
  return {
    kind: "element",
    namespace,
    name,
    attributes: Object.entries(attributes).flatMap(([qualified, value]) =>
      value === undefined ? [] : [toAttribute(qualified, value)],
    ),
    children: children.flatMap((child): XmlNode[] => {
      if (typeof child !== "string") return [child];
      return child === "" ? [] : [{ kind: "text", value: child }];
    }),
  };
}
