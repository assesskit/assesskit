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

/**
 * The most nodes that one call appends. A spread of all the children of a wide element throws a RangeError above about
 * 100,000, and WebKit takes time that grows with the square of the text nodes that are appended one by one, so they go in
 * steps.
 */
const APPEND_STEP = 10_000;

/**
 * Appends nodes to a parent in steps, so that a document or a response decides their number and no call fails for it.
 *
 * @param parent - The parent.
 * @param children - The nodes, in order.
 */
export function appendAll(parent: ParentNode, children: readonly Node[]): void {
  for (let start = 0; start < children.length; start += APPEND_STEP) {
    parent.append(...children.slice(start, start + APPEND_STEP));
  }
}

/**
 * Replaces the children of a parent with nodes, appended in steps as {@link appendAll} does.
 *
 * @param parent - The parent.
 * @param children - The nodes, in order; a node that is a child of the parent already moves to its place.
 */
export function replaceAll(parent: ParentNode, children: readonly Node[]): void {
  parent.replaceChildren();
  appendAll(parent, children);
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
