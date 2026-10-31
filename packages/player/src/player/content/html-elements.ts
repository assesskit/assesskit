/**
 * The 76 HTML elements of the ASI schema.
 *
 * @remarks
 * A node of the model names an HTML element by its name and an element of QTI by its name without `qti-`, so this set
 * tells the two apart.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, HTML elements}
 */
const HTML_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "acronym",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "kbd",
  "label",
  "li",
  "nav",
  "object",
  "ol",
  "p",
  "param",
  "picture",
  "pre",
  "q",
  "rb",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "tfoot",
  "th",
  "thead",
  "tr",
  "track",
  "tt",
  "ul",
  "var",
  "video",
]);

/** The prefix of the elements of QTI. */
const QTI_PREFIX = "qti-";

/**
 * Returns the name of the DOM element for the `kind` of a node: an HTML element keeps its name, the others get `qti-`.
 *
 * @param kind - The `kind` of the node.
 * @returns The element name.
 */
export function elementName(kind: string): string {
  return HTML_ELEMENTS.has(kind) ? kind : `${QTI_PREFIX}${kind}`;
}

/**
 * Returns whether a DOM element name is that of an HTML element, whose attributes are those of HTML.
 *
 * @param name - The element name.
 * @returns `true` unless the name has the prefix of the elements of QTI.
 */
export function isHtmlName(name: string): boolean {
  return !name.startsWith(QTI_PREFIX);
}

/** The names of the HTML elements, for the test that compares them with the inventory. */
export const HTML_ELEMENT_NAMES: readonly string[] = [...HTML_ELEMENTS];
