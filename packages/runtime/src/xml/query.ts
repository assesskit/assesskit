import type { XmlElement } from "./tree.js";

/**
 * Returns the child elements of an element in document order, without the text, comments and instructions between them.
 *
 * @param element - The element.
 * @returns Its child elements.
 */
export function childElements(element: XmlElement): readonly XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === "element");
}

/**
 * Returns the value of an attribute of an element, or `undefined` when it has none.
 *
 * @param element - The element.
 * @param name - The local name of the attribute.
 * @param namespace - The namespace URI of the attribute; the empty string is an attribute without a prefix.
 * @defaultValue `""`
 * @returns The value of the attribute.
 */
export function attributeOf(element: XmlElement, name: string, namespace = ""): string | undefined {
  return element.attributes.find((attribute) => attribute.namespace === namespace && attribute.name === name)?.value;
}

/**
 * Returns the text of an element: its text and CDATA children joined, without comments, instructions and child elements.
 *
 * @param element - The element.
 * @returns The text.
 */
export function textOf(element: XmlElement): string {
  let text = "";
  for (const child of element.children) if (child.kind === "text" || child.kind === "cdata") text += child.value;
  return text;
}
