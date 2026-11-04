import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";
import { ASI_NAMESPACE } from "../asi/index.js";
import { parseAttributeValue, type TypeInfo, typeNamed } from "../asi/internal.js";
import { SecurityError } from "../errors.js";
import type { XmlAttribute, XmlElement, XmlNode } from "../xml/index.js";
import type { ItemFormatLimits } from "./limits.js";
import type { FormattedText } from "./question.js";

type ParsedNode = DefaultTreeAdapterTypes.ChildNode;
type ParsedElement = DefaultTreeAdapterTypes.Element;

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/** Elements whose content is code or a document of its own, which is left out with them rather than kept as text. */
const DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "embed",
  "applet",
  "svg",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "select",
  "textarea",
  "button",
  "input",
  "form",
]);

/** Elements of blocks whose content, in a place that takes a line only, loses nothing but its line breaks. */
const BLOCKS: ReadonlySet<string> = new Set(["p", "div"]);

/** The element that holds text and inline elements where the parent takes blocks only. */
const WRAPPER = "div";

/** The text that stands for a missing word that could not become an interaction. */
const BLANK = "_____";

/** What the conversion of the texts of one file counts and what it leaves out of one item. */
export interface ContentState {
  readonly limits: ItemFormatLimits;
  /** The elements of the items of the file so far. */
  elements: number;
  /** The names of the elements of the item that are not in QTI's content, whose content is kept. */
  readonly unwrapped: Set<string>;
  /** The names of the elements of the item that are left out with their content. */
  readonly dropped: Set<string>;
  /** The names of the attributes of the item that are left out. */
  readonly attributes: Set<string>;
  /** The identifiers that the item's content holds, each once. */
  readonly ids: Set<string>;
  /** Whether a text of the item is Markdown, which is kept as plain text. */
  markdown: boolean;
}

/** An interaction that takes the place of the missing word, and whether it was placed. */
export interface Blank {
  readonly marker: string;
  readonly element: XmlElement;
  placed: boolean;
}

/** Creates the state of the texts of a file. */
export function createContentState(limits: ItemFormatLimits): ContentState {
  return {
    limits,
    elements: 0,
    unwrapped: new Set(),
    dropped: new Set(),
    attributes: new Set(),
    ids: new Set(),
    markdown: false,
  };
}

/** Clears what the state records of one item, before the next. */
export function startItem(state: ContentState): void {
  state.unwrapped.clear();
  state.dropped.clear();
  state.attributes.clear();
  state.ids.clear();
  state.markdown = false;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** PHP's `nl2br`: `<br />` before each line break, which stays. */
function nl2br(text: string): string {
  return text.replaceAll(/\r\n|\n\r|\n|\r/g, (lineBreak) => `<br />${lineBreak}`);
}

/**
 * Returns the HTML that Moodle shows for a text, as `format_text` makes it: HTML as it is; Moodle's auto-format with the
 * spaces between tags removed and line breaks made `<br />`; plain text escaped, with runs of two spaces kept and line
 * breaks made `<br />`. Markdown is shown as plain text, which the state records.
 *
 * @see {@link https://github.com/moodle/moodle/blob/v5.3.0/public/lib/classes/formatting.php | Moodle, format_text}
 */
function moodleHtml(text: FormattedText, state: ContentState): string {
  switch (text.format) {
    case "html":
      return text.text;
    case "moodle":
      return nl2br(
        text.text
          .replaceAll(/>[ \t\n\r\v\f]+</g, "><")
          .replaceAll(/[\n\r]</g, " <")
          .replaceAll(/>[\n\r]/g, "> "),
      );
    case "markdown":
      state.markdown = true;
      return nl2br(escapeHtml(text.text).replaceAll("  ", "&nbsp; "));
    case "plain":
      return nl2br(escapeHtml(text.text).replaceAll("  ", "&nbsp; "));
  }
}

/** Returns the type of the table that an element has in a parent of the given type. */
export function childType(parent: TypeInfo, element: string): TypeInfo | undefined {
  const accept = parent.slotOfElement.get(element)?.byElement.get(element);
  return accept === undefined ? undefined : typeNamed(accept.type);
}

function accepts(parent: TypeInfo, element: string): boolean {
  return parent.slotOfElement.has(element);
}

function acceptsMath(parent: TypeInfo): boolean {
  return parent.slotOfForeign.has(`{${MATHML_NAMESPACE}}math`);
}

/** Returns an attribute that the element's type gives it with a valid value, or a `data-*` one; else records its loss. */
function keepAttribute(
  attribute: ParsedElement["attrs"][number],
  type: TypeInfo,
  state: ContentState,
): XmlAttribute | undefined {
  const { name, value, namespace } = attribute;
  const def = namespace === undefined ? type.attributes.get(name) : undefined;
  if (def === undefined) {
    if (namespace === undefined && name.startsWith("data-") && type.def.attributeWildcard !== undefined) {
      return { namespace: "", name, value };
    }
    state.attributes.add(name);
    return undefined;
  }
  try {
    parseAttributeValue(def.type, value);
  } catch {
    state.attributes.add(name);
    return undefined;
  }
  // An identifier stands once in an item.
  if (name === "id" && state.ids.has(value)) return undefined;
  if (name === "id") state.ids.add(value);
  return { namespace: "", name, value };
}

/**
 * Keeps the attributes of an element that its type gives it with a valid value, and its `data-*` attributes; `undefined`
 * when a required attribute is missing, other than an image's `alt`, which is then empty: an image without a text of its own
 * is decoration.
 */
function keepAttributes(element: ParsedElement, type: TypeInfo, state: ContentState): XmlAttribute[] | undefined {
  const kept = element.attrs.flatMap((attribute) => keepAttribute(attribute, type, state) ?? []);
  for (const def of type.attributeList) {
    if (def.use !== "required" || kept.some(({ name }) => name === def.name)) continue;
    if (def.name !== "alt") return undefined;
    kept.push({ namespace: "", name: "alt", value: "" });
  }
  return kept;
}

/** Copies MathML as it is, without what is not MathML inside it. */
function copyMath(element: ParsedElement, depth: number, state: ContentState): XmlElement {
  const children: XmlNode[] = [];
  for (const child of element.childNodes) {
    if (child.nodeName === "#text" && "value" in child) children.push({ kind: "text", value: child.value });
    else if ("tagName" in child) {
      if (child.namespaceURI === MATHML_NAMESPACE) children.push(copyMath(child, checkDepth(depth + 1, state), state));
      else state.dropped.add(child.tagName);
    }
  }
  return {
    kind: "element",
    namespace: MATHML_NAMESPACE,
    name: element.tagName,
    attributes: element.attrs.flatMap(({ name, value, namespace }) =>
      namespace === undefined ? [{ namespace: "", name, value }] : [],
    ),
    children,
  };
}

function checkDepth(depth: number, state: ContentState): number {
  const { maxDepth } = state.limits;
  if (depth > maxDepth) {
    throw new SecurityError(
      `A text nests elements more than ${maxDepth} deep, the limit maxDepth.`,
      "maxDepth",
      maxDepth,
    );
  }
  return depth;
}

/** Splits a text at the marker of the missing word and puts the interaction there when the parent takes it. */
function textNodes(value: string, parent: TypeInfo, blank: Blank | undefined): XmlNode[] {
  if (blank === undefined || !value.includes(blank.marker)) return [{ kind: "text", value }];
  const at = value.indexOf(blank.marker);
  const before = value.slice(0, at);
  const after = value.slice(at + blank.marker.length);
  const nodes: XmlNode[] = [];
  if (before !== "") nodes.push({ kind: "text", value: before });
  if (!blank.placed && accepts(parent, blank.element.name)) {
    nodes.push(blank.element);
    blank.placed = true;
  } else nodes.push({ kind: "text", value: BLANK });
  if (after !== "") nodes.push({ kind: "text", value: after });
  return nodes;
}

/** The conversion of the children of one parent: what it has made, and the inline nodes that wait for a `div`. */
interface Run {
  readonly parent: TypeInfo;
  /** The type of the `div` that holds text and inline elements where the parent takes blocks only. */
  readonly wrapper: TypeInfo | undefined;
  readonly depth: number;
  readonly state: ContentState;
  readonly blank: Blank | undefined;
  readonly out: XmlNode[];
  pending: ParsedNode[];
}

/** Puts the inline nodes that wait into a `div`, unless they hold only white space. */
function flush(run: Run): void {
  if (run.pending.length === 0 || run.wrapper === undefined) return;
  const children = convertNodes(run.pending, run.wrapper, run.depth + 1, run.state, run.blank);
  run.pending = [];
  if (children.some((node) => node.kind !== "text" || node.value.trim() !== "")) {
    run.out.push({ kind: "element", namespace: ASI_NAMESPACE, name: WRAPPER, attributes: [], children });
  }
}

function placeText(run: Run, node: ParsedNode, value: string): void {
  if (run.parent.textSlot !== undefined) for (const text of textNodes(value, run.parent, run.blank)) run.out.push(text);
  else if (value.trim() !== "" && run.wrapper !== undefined) run.pending.push(node);
}

function placeMath(run: Run, node: ParsedElement): void {
  if (acceptsMath(run.parent)) {
    flush(run);
    run.out.push(copyMath(node, checkDepth(run.depth + 1, run.state), run.state));
  } else if (run.wrapper !== undefined && acceptsMath(run.wrapper)) run.pending.push(node);
  else run.state.dropped.add(node.tagName);
}

function placeElement(run: Run, node: ParsedElement): void {
  const { parent, wrapper, state } = run;
  const name = node.tagName;
  const type = childType(parent, name);
  const attributes = type === undefined ? undefined : keepAttributes(node, type, state);
  if (type !== undefined && attributes !== undefined) {
    flush(run);
    const children = convertNodes(node.childNodes, type, checkDepth(run.depth + 1, state), state, run.blank);
    run.out.push({ kind: "element", namespace: ASI_NAMESPACE, name, attributes, children });
  } else if (wrapper !== undefined && childType(wrapper, name) !== undefined) run.pending.push(node);
  else {
    if (!BLOCKS.has(name)) state.unwrapped.add(name);
    for (const child of convertNodes(node.childNodes, parent, checkDepth(run.depth + 1, state), state, run.blank)) {
      run.out.push(child);
    }
  }
}

/** Converts parsed nodes into the content that a parent of the given type takes. */
function convertNodes(
  nodes: readonly ParsedNode[],
  parent: TypeInfo,
  depth: number,
  state: ContentState,
  blank: Blank | undefined,
): XmlNode[] {
  const wrapper = parent.textSlot === undefined ? childType(parent, WRAPPER) : undefined;
  const run: Run = { parent, wrapper, depth, state, blank, out: [], pending: [] };
  for (const node of nodes) {
    if (node.nodeName === "#text" && "value" in node) placeText(run, node, node.value);
    else if (!("tagName" in node)) continue;
    else if (node.namespaceURI === MATHML_NAMESPACE && node.tagName === "math") placeMath(run, node);
    else if (node.namespaceURI !== HTML_NAMESPACE || DROPPED_WITH_CONTENT.has(node.tagName))
      state.dropped.add(node.tagName);
    else placeElement(run, node);
  }
  flush(run);
  return run.out;
}

/** Throws when the elements of the file and those to come would pass `maxNodes`. */
function checkElements(count: number, state: ContentState): void {
  const { maxNodes } = state.limits;
  if (state.elements + count > maxNodes) {
    throw new SecurityError(
      `The items of the file hold more than ${maxNodes} elements, the limit maxNodes.`,
      "maxNodes",
      maxNodes,
    );
  }
}

/** Adds the elements of an item to those of the file, against `maxNodes`. */
export function countElements(count: number, state: ContentState): void {
  checkElements(count, state);
  state.elements += count;
}

/** Refuses a text of more tags than `maxTextTags`, or whose tags would pass `maxNodes`, before it is parsed. */
function checkTags(html: string, state: ContentState): void {
  const { maxTextTags } = state.limits;
  let count = 0;
  for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at + 1)) {
    count += 1;
    if (count > maxTextTags) {
      throw new SecurityError(
        `A text holds more than ${maxTextTags} tags, the limit maxTextTags.`,
        "maxTextTags",
        maxTextTags,
      );
    }
  }
  checkElements(count, state);
}

/**
 * Converts a text of a question into the content that a QTI element of the given type takes: the HTML that Moodle shows,
 * parsed as a browser parses it, keeping the elements and attributes that QTI's content has. An element outside it gives
 * its content to its parent, text and inline elements where only blocks go are held by a `div`, and code (`script`,
 * `style`) is left out; the state records each.
 *
 * @throws `SecurityError` when the items of the file pass `maxNodes`, a text holds more tags than `maxTextTags`, or it nests
 * deeper than `maxDepth`.
 */
export function readMoodleText(
  text: FormattedText,
  parentType: string | TypeInfo,
  state: ContentState,
  blank?: Blank,
): XmlNode[] {
  const html = moodleHtml(text, state);
  if (html.trim() === "") return [];
  checkTags(html, state);
  const parent = typeof parentType === "string" ? typeNamed(parentType) : parentType;
  return convertNodes(parseFragment(html).childNodes, parent, 0, state, blank);
}
