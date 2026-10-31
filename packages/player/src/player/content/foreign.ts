import { XML_NAMESPACE, type XmlElement, type XmlNode } from "@assesskit/runtime/xml";
import { CML_NAMESPACE, MATHML_NAMESPACE, SSML_NAMESPACE } from "../internal.js";
import { resolveUrl, type UrlPolicy, type UrlUse } from "./urls.js";

/**
 * The namespaces of the elements that the model keeps as XML and that the player draws: MathML for the typesetter and
 * the screen reader, SSML for the speech model, and CML.
 *
 * @remarks
 * Elements of any other namespace, such as `xi:include`, HTML in a MathML annotation and SVG, are left out with what
 * they hold.
 */
const FOREIGN_NAMESPACES: ReadonlySet<string> = new Set([MATHML_NAMESPACE, SSML_NAMESPACE, CML_NAMESPACE]);

/** A name that is safe to give to the DOM: the ASCII part of an XML name, which is every name of MathML, SSML and CML. */
const SAFE_NAME = /^[A-Za-z_][\w.-]*$/u;

/** The attributes of foreign elements that hold a reference: MathML links, SSML `audio` and lexicons. */
const URL_ATTRIBUTES: ReadonlyMap<string, UrlUse> = new Map([
  ["href", "navigate"],
  ["src", "load"],
  ["uri", "load"],
]);

/** Sets the attributes of a foreign element that the player keeps: no event handler, no `style`, no other namespace. */
function setForeignAttributes(element: Element, source: XmlElement, urls: UrlPolicy): void {
  for (const { namespace, name, value } of source.attributes) {
    if (namespace === XML_NAMESPACE && name === "lang") {
      element.setAttributeNS(XML_NAMESPACE, "xml:lang", value);
      continue;
    }
    if (namespace !== "" || !SAFE_NAME.test(name)) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || lower === "style") continue;
    const use = URL_ATTRIBUTES.get(lower);
    const kept = use === undefined ? value : resolveUrl(value, urls, use);
    if (kept !== undefined) element.setAttribute(name, kept);
  }
}

function renderForeignNode(node: XmlNode, urls: UrlPolicy): Node | undefined {
  if (node.kind === "text" || node.kind === "cdata") return document.createTextNode(node.value);
  return node.kind === "element" ? renderForeign(node, urls) : undefined;
}

/**
 * Builds the DOM for an element that the model keeps as XML, with `createElementNS`, so that the typesetter and the speech
 * model find MathML and SSML by namespace.
 *
 * @param source - The element.
 * @param urls - The URL policy, for the references of links, audio and lexicons.
 * @returns The element, or `undefined` for one of a namespace that the player does not draw.
 */
export function renderForeign(source: XmlElement, urls: UrlPolicy): Element | undefined {
  if (!(FOREIGN_NAMESPACES.has(source.namespace) && SAFE_NAME.test(source.name))) return undefined;
  const element = document.createElementNS(source.namespace, source.name);
  setForeignAttributes(element, source, urls);
  for (const child of source.children) {
    const node = renderForeignNode(child, urls);
    if (node !== undefined) element.append(node);
  }
  return element;
}
