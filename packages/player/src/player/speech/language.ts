import { XML_NAMESPACE } from "@assesskit/runtime/xml";

/**
 * Returns the language that a node states with `lang` or `xml:lang`, or inherits from its ancestors in the same tree.
 *
 * @param node - The node.
 * @returns The language tag, or `undefined` when none states one, and when the nearest states the empty string, which
 * means that the language is unknown.
 * @see {@link https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes | HTML Standard, the lang attribute}
 */
export function languageOf(node: Node): string | undefined {
  for (
    let element = node instanceof Element ? node : node.parentElement;
    element !== null;
    element = element.parentElement
  ) {
    const language = element.getAttribute("lang") ?? element.getAttributeNS(XML_NAMESPACE, "lang");
    if (language !== null) return language === "" ? undefined : language;
  }
  return undefined;
}
