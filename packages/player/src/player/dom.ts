const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The attributes of an element to build, by name. */
type Attributes = Readonly<Record<string, string>>;

/** Builds an HTML element with the given attributes and children; text children become text nodes. */
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

/** Builds an SVG element with the given attributes and children. */
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

/** Returns an `id` that no other call returns, for the references of `aria-describedby`. */
export function uniqueId(prefix: string): string {
  lastId += 1;
  return `${prefix}-${lastId}`;
}

/** Returns the element that has the focus, looking through open shadow roots, or `null`. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
