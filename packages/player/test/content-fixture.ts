import { parseXml, type XmlElement } from "@assesskit/runtime/xml";
import { type ContentRoot, mount } from "./css-fixture.js";

/** The namespaces that the markup of a fixture can use: HTML as the default, and the prefixes `ssml`, `m` and `cml`. */
const NAMESPACES =
  'xmlns="http://www.w3.org/1999/xhtml" xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:cml="http://www.xml-cml.org/schema"';

/** Builds the DOM of a parsed element, as the renderer does for the content it gets from the runtime: `createElementNS` for every element. */
function toDom(element: XmlElement): Element {
  const dom = document.createElementNS(
    element.namespace,
    element.prefix === undefined ? element.name : `${element.prefix}:${element.name}`,
  );
  for (const attribute of element.attributes) {
    if (attribute.namespace === "http://www.w3.org/2000/xmlns/") continue;
    const name = attribute.prefix === undefined ? attribute.name : `${attribute.prefix}:${attribute.name}`;
    dom.setAttributeNS(attribute.namespace === "" ? null : attribute.namespace, name, attribute.value);
  }
  for (const child of element.children) {
    if (child.kind === "element") dom.append(toDom(child));
    else if (child.kind === "text" || child.kind === "cdata") dom.append(child.value);
  }
  return dom;
}

/**
 * Mounts content that is written as XML, as a QTI item writes it, in a content root: the runtime parses it, and every element
 * is made with its namespace, so that `ssml:sub` is an element of SSML and `m:math` one of MathML.
 *
 * @param xml - The markup. It may use the prefixes `ssml`, `m` and `cml`, and HTML elements without a prefix.
 */
export function mountContent(xml: string): ContentRoot {
  const content = mount("");
  content.root.append(...[...toDom(parseXml(`<div ${NAMESPACES}>${xml}</div>`)).childNodes]);
  return content;
}

/** Returns a range around all the content of a content root. */
export function wholeRoot(content: ContentRoot): Range {
  const range = document.createRange();
  range.selectNodeContents(content.root);
  return range;
}
