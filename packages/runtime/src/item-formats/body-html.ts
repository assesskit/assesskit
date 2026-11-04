import { ASI_NAMESPACE } from "../asi/index.js";
import { XML_NAMESPACE, type XmlElement, type XmlNode } from "../xml/index.js";

// The HTML of QTI content, as a browser parses it back: HTML elements of the ASI namespace with their attributes, void
// elements without an end tag, MathML with its namespace, and the elements that QTI adds to HTML left to the caller.

const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/** The elements of HTML that have no end tag. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** What the HTML of content leaves to its caller: an element of QTI's own, which `visit` writes or leaves out. */
export interface HtmlVisitor {
  /**
   * Returns the HTML of an element that QTI adds to HTML, such as an interaction or feedback, or `undefined` to leave it
   * out; the writer records what is left out.
   */
  readonly visit: (element: XmlElement) => string | undefined;
  /** The names of the elements left out. */
  readonly omitted: Set<string>;
}

/** Escapes text for the content of an HTML element. */
function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', "&quot;");
}

function attributesHtml(element: XmlElement): string {
  let html = "";
  for (const { namespace, name, value } of element.attributes) {
    if (namespace === XML_NAMESPACE && name === "lang") html += ` lang="${escapeAttribute(value)}"`;
    else if (namespace === "") html += ` ${name}="${escapeAttribute(value)}"`;
  }
  return html;
}

function mathHtml(element: XmlElement, root: boolean): string {
  const namespace = root ? ` xmlns="${MATHML_NAMESPACE}"` : "";
  const children = element.children
    .map((child) => (child.kind === "element" ? mathHtml(child, false) : nodeText(child)))
    .join("");
  return children === ""
    ? `<${element.name}${namespace}${attributesHtml(element)}/>`
    : `<${element.name}${namespace}${attributesHtml(element)}>${children}</${element.name}>`;
}

function nodeText(node: XmlNode): string {
  return node.kind === "text" || node.kind === "cdata" ? escapeText(node.value) : "";
}

/** Returns the HTML of content: its nodes in order, with the elements of QTI's own left to the visitor. */
export function writeHtml(nodes: readonly XmlNode[], visitor: HtmlVisitor): string {
  let html = "";
  for (const node of nodes) {
    if (node.kind !== "element") {
      html += nodeText(node);
      continue;
    }
    if (node.namespace === MATHML_NAMESPACE) {
      html += mathHtml(node, true);
      continue;
    }
    if (node.namespace !== ASI_NAMESPACE) {
      visitor.omitted.add(node.name);
      continue;
    }
    if (node.name.startsWith("qti-")) {
      const written = visitor.visit(node);
      if (written === undefined) visitor.omitted.add(node.name);
      else html += written;
      continue;
    }
    const open = `<${node.name}${attributesHtml(node)}>`;
    html += VOID_ELEMENTS.has(node.name) ? open : `${open}${writeHtml(node.children, visitor)}</${node.name}>`;
  }
  return html;
}

/** Returns the text of content without its markup, with runs of white space as one space. */
export function plainText(nodes: readonly XmlNode[]): string {
  let text = "";
  const visit = (node: XmlNode) => {
    if (node.kind === "element") for (const child of node.children) visit(child);
    else if (node.kind === "text" || node.kind === "cdata") text += node.value;
  };
  for (const node of nodes) visit(node);
  return text.replaceAll(/\s+/g, " ").trim();
}

/** Whether content holds markup besides text. */
export function hasMarkup(nodes: readonly XmlNode[]): boolean {
  return nodes.some((node) => node.kind === "element");
}
