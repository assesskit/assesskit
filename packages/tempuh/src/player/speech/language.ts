import { XML_NAMESPACE } from "@luthfanwakan/olah/xml";

/**
 * Returns the language that a node states with `lang` or `xml:lang`, or inherits from its ancestors in the same tree.
 * `undefined` when none states one, and when the nearest states the empty string, which means the language is unknown
 * (HTML Standard, the `lang` attribute).
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
