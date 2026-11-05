import { checkString } from "../checks.js";
import { checkOptionNames } from "../checks-internal.js";
import type { XmlElement } from "./tree.js";

/**
 * Returns the child elements of an element in document order, without the text, comments and instructions between them.
 *
 * @param element - The element.
 * @returns Its child elements.
 */
export function listChildElements(element: XmlElement): readonly XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === "element");
}

/** The options of {@link findAttribute}. */
export interface FindAttributeOptions {
  /**
   * The namespace URI of the attribute; the empty string is an attribute without a prefix.
   *
   * @defaultValue `""`
   */
  readonly namespace?: string;
}

/** The options of {@link findAttribute}, which a reader or a writer reads for every attribute it looks up. */
const FIND_ATTRIBUTE_OPTIONS = ["namespace"] as const;

/**
 * Returns the value of an attribute of an element, or `undefined` when it has none.
 *
 * @param element - The element.
 * @param name - The local name of the attribute.
 * @param options - See {@link FindAttributeOptions}.
 * @returns The value of the attribute.
 */
export function findAttribute(
  element: XmlElement,
  name: string,
  options: FindAttributeOptions = {},
): string | undefined {
  checkOptionNames(options, FIND_ATTRIBUTE_OPTIONS);
  const { namespace = "" } = options;
  checkString(namespace, "The option namespace");
  return element.attributes.find((attribute) => attribute.namespace === namespace && attribute.name === name)?.value;
}

/**
 * Returns the text of an element: its text and CDATA children joined, without comments, instructions and child elements.
 *
 * @param element - The element.
 * @returns The text.
 */
export function collectText(element: XmlElement): string {
  let text = "";
  for (const child of element.children) if (child.kind === "text" || child.kind === "cdata") text += child.value;
  return text;
}
