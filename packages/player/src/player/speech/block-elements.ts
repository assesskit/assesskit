import { MATHML_NAMESPACE, SSML_NAMESPACE, XHTML_NAMESPACE } from "../namespaces.js";

/**
 * Returns whether an element is an expression: MathML, or what MathJax made of it.
 *
 * @param element - The element.
 * @returns `true` for an expression.
 */
export const isMath = (element: Element): boolean =>
  (element.namespaceURI === MATHML_NAMESPACE && element.localName === "math") || element.localName === "mjx-container";

/**
 * The HTML elements that sit in the line of a paragraph: the phrasing content that the ASI schema allows in an `a`, and
 * the inline elements of QTI, which are the custom, end attempt, gap, hottext, inline choice and text entry interactions,
 * the printed variable, and the inline feedback and template.
 *
 * @remarks
 * Any other HTML element is a paragraph of its own. The CSS `display` does not tell: an absolutely positioned or floated
 * element is a block whatever it was, as `qti-visually-hidden` is.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, inline content}
 */
const INLINE_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "acronym",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "br",
  "button",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "mark",
  "object",
  "picture",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "textarea",
  "time",
  "tt",
  "u",
  "var",
  "video",
  "wbr",
  "qti-custom-interaction",
  "qti-end-attempt-interaction",
  "qti-feedback-inline",
  "qti-gap",
  "qti-hottext",
  "qti-inline-choice-interaction",
  "qti-printed-variable",
  "qti-template-inline",
  "qti-text-entry-interaction",
]);

/**
 * Returns whether an element is a paragraph of its own, or holds one.
 *
 * @remarks
 * An element of another namespace, and MathJax's, sits in the line, except an SSML element that is a `p` or has one
 * inside.
 *
 * @param element - The element.
 * @returns `true` for a paragraph of its own.
 */
export function isBlock(element: Element): boolean {
  if (element.namespaceURI === SSML_NAMESPACE) {
    return element.localName === "p" || element.getElementsByTagNameNS(SSML_NAMESPACE, "p").length > 0;
  }
  return (
    element.namespaceURI === XHTML_NAMESPACE &&
    !element.localName.startsWith("mjx-") &&
    !INLINE_ELEMENTS.has(element.localName)
  );
}
