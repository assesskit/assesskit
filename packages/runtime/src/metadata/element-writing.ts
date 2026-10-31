import { buildElement, type XmlElement } from "../xml/index.js";
import type { QualifiedName } from "./qualified-name.js";

/**
 * Builds an element of a namespace with the prefix the writers give it; see `buildElement`.
 *
 * @param qualified - The namespace and prefix.
 * @param name - The local name.
 * @param children - The child nodes; a string is text.
 * @param attributes - The attributes by name; an attribute whose value is `undefined` is left out.
 * @defaultValue `{}`
 * @returns The element.
 */
export function branch(
  qualified: QualifiedName,
  name: string,
  children: readonly (XmlElement | string)[],
  attributes: Readonly<Record<string, string | undefined>> = {},
): XmlElement {
  const { namespace, prefix } = qualified;
  return { ...buildElement(namespace, name, attributes, children), prefix };
}

/**
 * Builds an element of a namespace that holds text.
 *
 * @param qualified - The namespace and prefix.
 * @param name - The local name.
 * @param text - The text.
 * @returns The element.
 */
export function leaf(qualified: QualifiedName, name: string, text: string): XmlElement {
  return branch(qualified, name, [text]);
}

/**
 * Appends an element that holds text, unless the text is `undefined`.
 *
 * @param children - The children of the parent, which the element joins.
 * @param qualified - The namespace and prefix.
 * @param name - The local name.
 * @param text - The text, or `undefined` to append nothing.
 */
export function appendLeaf(
  children: XmlElement[],
  qualified: QualifiedName,
  name: string,
  text: string | undefined,
): void {
  if (text !== undefined) children.push(leaf(qualified, name, text));
}
