import type { Messages } from "../../messages/index.js";
import { html } from "../dom.js";
import type { TextField } from "./text.js";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * The elements that an answer in XHTML keeps, by the name they are written with: the markup that the editor offers and
 * that browsers make when the candidate types (tempuh design §3). Another element is replaced by what it holds, and has
 * no attributes in any case.
 */
const KEPT: ReadonlyMap<string, string> = new Map([
  ["p", "p"],
  ["br", "br"],
  ["strong", "strong"],
  ["b", "strong"],
  ["em", "em"],
  ["i", "em"],
  ["u", "u"],
  ["ul", "ul"],
  ["ol", "ol"],
  ["li", "li"],
  ["sub", "sub"],
  ["sup", "sup"],
]);

/** The elements that stand for a block of text: browsers make a `div` where the candidate presses Enter. */
const BLOCKS: ReadonlySet<string> = new Set(["p", "div", "ul", "ol"]);

/** The elements dropped with what they hold: it is not text of the answer. */
const DROPPED: ReadonlySet<string> = new Set([
  "script",
  "style",
  "template",
  "object",
  "iframe",
  "embed",
  "svg",
  "math",
]);

/** The buttons of the toolbar: the message that names it and the command of the browser that it runs. */
const COMMANDS: readonly (readonly [keyof Messages, string])[] = [
  ["editorBold", "bold"],
  ["editorItalic", "italic"],
  ["editorUnderline", "underline"],
  ["editorBulletList", "insertUnorderedList"],
  ["editorNumberedList", "insertOrderedList"],
];

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Writes a node of the editor as XHTML of the kept elements. */
function write(node: Node): string {
  if (node instanceof Text) return escapeText(node.data);
  if (!(node instanceof Element) || DROPPED.has(node.localName)) return "";
  const name = KEPT.get(node.localName);
  const inner = [...node.childNodes].map(write).join("");
  if (name === undefined) return inner;
  return name === "br" ? "<br/>" : `<${name}>${inner}</${name}>`;
}

/** Returns the text of a node that the answer keeps, without the markup and without the elements that are dropped. */
function keptText(node: Node): string {
  if (node instanceof Text) return node.data;
  if (!(node instanceof Element) || DROPPED.has(node.localName)) return "";
  return [...node.childNodes].map(keptText).join("");
}

/**
 * Writes what the candidate typed in an editor as XHTML. Text between blocks is a paragraph, and an element that is not in
 * the list of kept elements is replaced by its text, so that pasted markup cannot carry anything else.
 */
function writeXhtml(editor: Node): string {
  const paragraphs: string[] = [];
  let line = "";
  const flush = (): void => {
    if (line.replaceAll("<br/>", "").trim() !== "") paragraphs.push(`<p>${line}</p>`);
    line = "";
  };
  for (const child of editor.childNodes) {
    if (child instanceof Element && BLOCKS.has(child.localName)) {
      flush();
      // A div is a paragraph, and a paragraph that holds only a line break is an empty one.
      const text = child.localName === "div" ? `<p>${[...child.childNodes].map(write).join("")}</p>` : write(child);
      if (text.replaceAll(/<\/?(?:p|br\/)>/gu, "").trim() !== "") paragraphs.push(text);
    } else {
      line += write(child);
    }
  }
  flush();
  return paragraphs.join("");
}

/** Builds the nodes of an XHTML answer from the kept elements of its tree, with createElement and no attribute. */
function readNodes(nodes: NodeListOf<ChildNode>): Node[] {
  return [...nodes].flatMap((node): Node[] => {
    if (node instanceof Text) return [document.createTextNode(node.data)];
    if (!(node instanceof Element) || DROPPED.has(node.localName)) return [];
    const name = KEPT.get(node.localName);
    const children = readNodes(node.childNodes);
    if (name === undefined) return children;
    const element = document.createElement(name);
    element.append(...children);
    return [element];
  });
}

/** Reads an XHTML answer into nodes; an answer that is not well-formed XHTML is text. */
function readXhtml(xhtml: string): Node[] {
  const parsed = new DOMParser().parseFromString(
    `<div xmlns="${XHTML_NAMESPACE}">${xhtml}</div>`,
    "application/xhtml+xml",
  );
  if (parsed.getElementsByTagName("parsererror").length > 0) return [document.createTextNode(xhtml)];
  return readNodes(parsed.documentElement.childNodes);
}

/**
 * The field of an extended text with `format="xhtml"`: an editable area and the buttons that format it. Its text is XHTML
 * of a few elements ({@link writeXhtml}).
 */
export class EditorField implements TextField {
  /** The element for the interaction: the toolbar and the editable area. */
  readonly element: HTMLElement;
  /** The editable area, which the candidate types in. */
  readonly area: HTMLElement;

  /**
   * @param messages - The text of the interface.
   * @param label - The accessible name of the editable area.
   */
  constructor(messages: Messages, label: string) {
    this.area = html("div", {
      class: "tempuh-editable",
      contenteditable: "true",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label,
    });
    const buttons = COMMANDS.map(([key, command]) => {
      const button = html("button", { type: "button" }, messages[key]);
      // A button that takes the focus would end the selection that the command formats.
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        this.area.focus();
        // The commands of the browser are the one way to format a selection in an editable area without a model of the text.
        document.execCommand(command);
      });
      return button;
    });
    const toolbar = html("div", { role: "toolbar", "aria-label": messages.editorToolbar }, ...buttons);
    this.area.addEventListener("paste", (event) => {
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "");
    });
    this.element = html("div", { class: "tempuh-editor" }, toolbar, this.area);
  }

  /** The characters the candidate typed: those of the text, not of the markup (VOCAB §1.2.3.2). */
  get typedText(): string {
    return keptText(this.area);
  }

  get text(): string {
    return writeXhtml(this.area);
  }

  set text(text: string) {
    this.area.replaceChildren(...readXhtml(text));
  }

  get locked(): boolean {
    return this.area.contentEditable === "false";
  }

  set locked(locked: boolean) {
    this.area.contentEditable = locked ? "false" : "true";
    this.area.setAttribute("aria-readonly", String(locked));
    for (const button of this.element.querySelectorAll("button")) button.disabled = locked;
  }
}
