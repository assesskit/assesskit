import * as v from "valibot";
import { checkString, guardSchema, isRecord, parseWith, strictRecord } from "../checks.js";
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

/** The attributes of an element to build by name; one whose value is `undefined` is left out. */
export type ElementAttributes = Readonly<Record<string, string | undefined>>;

/** The options of {@link buildElement}. */
export interface BuildElementOptions {
  /**
   * The attributes by name. A name with the prefix `xml:` or `xsi:` is in that namespace; the others are in none.
   *
   * @defaultValue `{}`
   */
  readonly attributes?: ElementAttributes;
  /**
   * The child nodes. A string is a text node, and an empty string is left out.
   *
   * @defaultValue `[]`
   */
  readonly children?: readonly (XmlNode | string)[];
}

const buildElementOptionsSchema = strictRecord({
  attributes: v.optional(
    guardSchema((value): value is ElementAttributes => isRecord(value), "an object"),
    {},
  ),
  children: v.optional(
    v.array(v.union([v.string(), guardSchema((value): value is XmlNode => isRecord(value), "an object")])),
    [],
  ),
});

/**
 * Builds an element for a writer. Attributes whose value is `undefined` are left out, so that an optional field of a model
 * is written only when it is set; the others keep the order of the object.
 *
 * @param namespace - The namespace of the element; it is declared where `serializeXml` writes the element.
 * @param name - The local name.
 * @param options - See {@link BuildElementOptions}.
 * @returns The element.
 * @throws `DataError` when an argument has the wrong type. The tree is checked further when `serializeXml` writes it.
 */
export function buildElement(namespace: string, name: string, options: BuildElementOptions = {}): XmlElement {
  checkString(namespace, "The namespace of an element");
  checkString(name, "The name of an element");
  const { attributes, children } = parseWith(buildElementOptionsSchema, options, "The options object");
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

/**
 * Returns the function that builds elements of one namespace, as {@link buildElement} does: a writer names its namespace
 * once.
 *
 * @param namespace - The namespace of the elements.
 */
export function elementBuilder(
  namespace: string,
): (name: string, attributes?: ElementAttributes, children?: readonly (XmlNode | string)[]) => XmlElement {
  return (name, attributes = {}, children = []) => buildElement(namespace, name, { attributes, children });
}
