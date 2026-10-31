import { SVG_NAMESPACE } from "./namespaces.js";

/** The attributes of an element to build, by name. */
type Attributes = Readonly<Record<string, string>>;

/**
 * Builds an HTML element.
 *
 * @param tag - The tag name.
 * @param attributes - The attributes to set, by name; none without it.
 * @param children - The children in order; a string becomes a text node.
 * @returns The element.
 */
export function html<TTag extends keyof HTMLElementTagNameMap>(
  tag: TTag,
  attributes: Attributes = {},
  ...children: readonly (Node | string)[]
): HTMLElementTagNameMap[TTag] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

/**
 * Builds an SVG element.
 *
 * @param tag - The tag name.
 * @param attributes - The attributes to set, by name; none without it.
 * @param children - The children in order; a string becomes a text node.
 * @returns The element, in the SVG namespace.
 */
export function svg<TTag extends keyof SVGElementTagNameMap>(
  tag: TTag,
  attributes: Attributes = {},
  ...children: readonly (Node | string)[]
): SVGElementTagNameMap[TTag] {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

let lastId = 0;

/**
 * Returns an `id` that no other call returns, for the references of `aria-describedby` and `aria-labelledby`.
 *
 * @param prefix - The start of the id.
 * @returns The prefix, a hyphen and a number that counts the calls.
 */
export function uniqueId(prefix: string): string {
  lastId += 1;
  return `${prefix}-${lastId}`;
}

/**
 * Returns the element that has the focus, looking through open shadow roots.
 *
 * @returns The focused element, or `null` when nothing in the page has the focus.
 */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
