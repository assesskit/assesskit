import { DataError } from "@assesskit/runtime/errors";
import type { LinkIndication } from "@assesskit/runtime/pnp";
import type { XmlElement, XmlNode } from "@assesskit/runtime/xml";
import { checkNonEmptyString, checkRecord, describe } from "../../checks.js";
import type { Messages } from "../../messages/index.js";
import { applyDataSsml, readDataSsml } from "./data-ssml.js";
import { languageOf } from "./language.js";
import { checkLexicons, type Lexicon, type Pronounced, pronounce } from "./lexicon.js";
import type { SpeechRequest } from "./request.js";
import { checkSpeechSettings, restrictionsOf, type SpeechSettings } from "./settings.js";
import {
  plainText,
  readSsmlElement,
  SSML_NAMESPACE,
  type SsmlPart,
  speakDocument,
  ssmlElement,
  xmlSafe,
} from "./ssml.js";

/** The namespace of HTML elements (HTML Standard §3.2.6). */
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** The namespace of MathML (MathML 3 §2.1.1). */
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/** The namespace of Chemical Markup Language, which BPIG §5.2.1.2 names as one way to mark chemical equations. */
const CML_NAMESPACE = "http://www.xml-cml.org/schema";

/** The types of `input` whose value is text that the candidate typed. */
const TEXT_INPUT_TYPES: readonly string[] = ["text", "search", "tel", "url", "email", "number"];

/** The value of the SSML `variant` attribute that makes a link sound like another voice (SSML 1.1 §3.2.1). */
const LINK_VOICE_VARIANT = "2";

/** The options of {@link buildSpeechRequest}. */
export interface SpeechOptions {
  /** What the candidate's spoken support asks for. */
  readonly settings: SpeechSettings;
  /** The text of the interface that a request speaks: the word that marks a link. */
  readonly messages: Pick<Messages, "speechLink">;
  /** The language of the content that states none, a BCP 47 tag. */
  readonly language: string;
  /** The pronunciation lexicons of the item, in order of preference. Default: none. */
  readonly lexicons?: readonly Lexicon[];
}

/** What reading an element gives: the nodes, and whether they are paragraphs of their own. */
interface Read {
  readonly nodes: readonly XmlNode[];
  readonly block: boolean;
}

const textNode = (value: string): XmlNode => ({ kind: "text", value });

/** Parses a URL against a base, and returns it only when it is `http` or `https`. */
function parseUrl(reference: string, base: string): URL | undefined {
  try {
    const url = new URL(reference, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

const isMath = (element: Element): boolean =>
  (element.namespaceURI === MATHML_NAMESPACE && element.localName === "math") || element.localName === "mjx-container";

/**
 * The HTML elements that sit in the line of a paragraph: the phrasing content that the ASI schema allows in an `a`, and
 * the inline elements of QTI, which are the custom, end attempt, gap, hottext, inline choice and text entry
 * interactions, the printed variable, and the inline feedback and template (INFO §5.36, §5.45, §5.55, §5.65, §5.74,
 * §5.162, §7.30, §5.52, §5.124). Any other HTML element is a paragraph of its own. The CSS `display` does not tell: an
 * absolutely positioned or floated element is a block whatever it was, as `qti-visually-hidden` is.
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
 * Returns whether an element is a paragraph of its own, or holds one. An element of another namespace, and MathJax's,
 * sits in the line, except an SSML element that is a `p` or has one inside.
 */
function isBlock(element: Element): boolean {
  if (element.namespaceURI === SSML_NAMESPACE) {
    return element.localName === "p" || element.getElementsByTagNameNS(SSML_NAMESPACE, "p").length > 0;
  }
  return (
    element.namespaceURI === XHTML_NAMESPACE &&
    !element.localName.startsWith("mjx-") &&
    !INLINE_ELEMENTS.has(element.localName)
  );
}

/** Counts the words of a text that has single spaces between them. */
function wordsIn(text: string): number {
  return text.split(" ").filter((word) => word !== "").length;
}

function pronouncedElement({ text, pronunciation }: Pronounced): XmlNode {
  return pronunciation.kind === "alias"
    ? ssmlElement("sub", { alias: pronunciation.alias }, [text])
    : ssmlElement("phoneme", { alphabet: pronunciation.alphabet, ph: pronunciation.ph }, [text]);
}

/** Removes the space at the start of a paragraph and the second of two in a row, across the nodes. */
function collapseSpaces(nodes: readonly XmlNode[]): XmlNode[] {
  let afterSpace = true;
  const walk = (list: readonly XmlNode[]): XmlNode[] =>
    list.flatMap((node): XmlNode[] => {
      if (node.kind === "element") return [{ ...node, children: walk(node.children) }];
      if (node.kind !== "text") return [node];
      const value = afterSpace ? node.value.replace(/^ /u, "") : node.value;
      if (value === "") return [];
      afterSpace = value.endsWith(" ");
      return [textNode(value)];
    });
  return walk(nodes);
}

/** Removes the space at the end of a paragraph. */
function trimEnd(nodes: readonly XmlNode[]): XmlNode[] {
  const last = nodes.at(-1);
  if (last === undefined) return [];
  const rest = nodes.slice(0, -1);
  if (last.kind === "element") return [...rest, { ...last, children: trimEnd(last.children) }];
  if (last.kind !== "text") return [...rest, last];
  const value = last.value.replace(/ $/u, "");
  return value === "" ? trimEnd(rest) : [...rest, textNode(value)];
}

/** Makes a paragraph of a run of inline nodes, or nothing when the run says nothing. */
function paragraph(run: readonly XmlNode[]): XmlElement | undefined {
  const nodes = trimEnd(collapseSpaces(run));
  return plainText(nodes) === "" ? undefined : ssmlElement("p", {}, nodes);
}

/** Reads the content of a range, in reading order, into the nodes of an SSML document. */
class Reader {
  private readonly range: Range;
  private readonly options: SpeechOptions & { readonly lexicons: readonly Lexicon[] };
  private readonly restrictions: ReadonlySet<string>;
  /** The number of rubric blocks the reading is inside, for `directions-only`. */
  private directions = 0;
  /** The words read from the text, for `word-by-word`. */
  words = 0;
  /** The language of the first text read, which is the language of the request. */
  language: string | undefined;
  /** Whether text goes through the lexicons; off inside the elements that hold text for SSML. */
  private pronouncing = true;

  constructor(range: Range, options: SpeechOptions) {
    this.range = range;
    this.options = { ...options, lexicons: options.lexicons ?? [] };
    this.restrictions = restrictionsOf(options.settings);
  }

  /** Returns whether the reading leaves out an element and everything in it. */
  private skips(element: Element): boolean {
    return (
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true" ||
      element.classList.contains("qti-hidden") ||
      getComputedStyle(element).display === "none" ||
      ["computer-read-aloud", "all"].includes(element.getAttribute("data-qti-suppress-tts") ?? "") ||
      element.getAttribute("data-qti-a11y-content-role") === "screen-reader-orientation" ||
      (this.restrictions.has("skip-math-equations") && isMath(element)) ||
      (this.restrictions.has("skip-chemistry-equations") && element.namespaceURI === CML_NAMESPACE)
    );
  }

  /** Reads the range. Returns `undefined` when an ancestor of the range keeps all of it from being read. */
  read(): XmlNode[] | undefined {
    const container = this.range.commonAncestorContainer;
    for (
      let element = container instanceof Element ? container : container.parentElement;
      element !== null;
      element = element.parentElement
    ) {
      if (this.skips(element)) return undefined;
      if (element.localName === "qti-rubric-block") this.directions++;
    }
    return this.children(container instanceof Element ? container : (container.parentNode ?? container), false);
  }

  /** Returns whether the range holds all of an element, so that the SSML the element carries applies to what is said. */
  private covers(element: Element): boolean {
    return this.range.comparePoint(element, 0) >= 0 && this.range.comparePoint(element, element.childNodes.length) <= 0;
  }

  /** Reads the children of a node: paragraphs, or in an inline context the inline nodes themselves. */
  private children(parent: Node, inline: boolean): XmlNode[] {
    const out: XmlNode[] = [];
    let run: XmlNode[] = [];
    for (const child of parent.childNodes) {
      if (!this.range.intersectsNode(child)) continue;
      const read = this.child(child, inline);
      if (!read.block) {
        run.push(...read.nodes);
        continue;
      }
      const made = paragraph(run);
      if (made !== undefined) out.push(made);
      run = [];
      out.push(...read.nodes);
    }
    if (inline) return run;
    const made = paragraph(run);
    return made === undefined ? out : [...out, made];
  }

  private child(node: Node, inline: boolean): Read {
    if (node instanceof Text) return { nodes: this.text(node), block: false };
    return (node instanceof Element ? this.element(node, inline) : undefined) ?? { nodes: [], block: false };
  }

  private text(node: Text): XmlNode[] {
    const start = node === this.range.startContainer ? this.range.startOffset : 0;
    const end = node === this.range.endContainer ? this.range.endOffset : node.length;
    return this.said(node.data.slice(start, end), node, this.pronouncing);
  }

  /**
   * Makes the nodes that say a text. A text outside the rubric blocks is left out under `directions-only`; the white
   * space is reduced to a space, and the lexicons give pronunciations when `withLexicons` is set.
   */
  private said(raw: string, at: Node, withLexicons: boolean): XmlNode[] {
    if (this.restrictions.has("directions-only") && this.directions === 0) return [];
    const text = xmlSafe(raw).replace(/\s+/gu, " ");
    if (text.trim() === "") return text === "" ? [] : [textNode(" ")];
    this.words += wordsIn(text);
    const language = languageOf(at) ?? this.options.language;
    this.language ??= language;
    if (!withLexicons) return [textNode(text)];
    return pronounce(text, language, this.options.lexicons).map((piece) =>
      typeof piece === "string" ? textNode(piece) : pronouncedElement(piece),
    );
  }

  /** Reads an element, or returns `undefined` when it is left out. */
  private element(element: Element, inline: boolean): Read | undefined {
    if (this.skips(element)) return undefined;
    const whole = this.covers(element);
    const part = whole ? readSsmlElement(element) : undefined;
    const raw = whole ? element.getAttribute("data-ssml") : null;
    const data = raw === null ? undefined : readDataSsml(raw);
    const isRubric = element.localName === "qti-rubric-block";
    if (isRubric) this.directions++;
    try {
      const block = !inline && data === undefined && isBlock(element);
      const own = part === undefined ? this.content(element, !block) : this.ssml(element, part, block);
      const nodes = data === undefined ? own : applyDataSsml(data, plainText(own).replace(/\n/gu, " "), own);
      return { nodes: this.marked(element, nodes), block };
    } finally {
      if (isRubric) this.directions--;
    }
  }

  /** Reads what an element holds by what it is. */
  private content(element: Element, inline: boolean): XmlNode[] {
    if (isMath(element)) return this.said(this.mathSpeech(element), element, false);
    switch (element.localName) {
      case "img":
        return this.said(element.getAttribute("alt") ?? "", element, this.pronouncing);
      case "br":
        return [ssmlElement("break", {}, [])];
      case "textarea":
        return element instanceof HTMLTextAreaElement ? this.said(element.value, element, this.pronouncing) : [];
      case "input":
        return element instanceof HTMLInputElement && TEXT_INPUT_TYPES.includes(element.type)
          ? this.said(element.value, element, this.pronouncing)
          : [];
      default:
        return this.children(element, inline);
    }
  }

  /** The words for an expression: what MathJax made of it, else its text alternative, else its text. */
  private mathSpeech(element: Element): string {
    if (element.localName === "mjx-container")
      return element.querySelector("mjx-speech")?.getAttribute("aria-label") ?? "";
    return element.getAttribute("alttext") ?? element.textContent ?? "";
  }

  /** Marks a link as the candidate's link indication asks (BPIG §5.2.1.7). */
  private marked(element: Element, nodes: readonly XmlNode[]): readonly XmlNode[] {
    if (!element.matches("a[href]") || nodes.length === 0) return nodes;
    const indication: LinkIndication | undefined = this.options.settings.linkIndication;
    if (indication === "different-voice") return [ssmlElement("voice", { variant: LINK_VOICE_VARIANT }, nodes)];
    // A sound effect needs an audio file that the player does not have, so it marks the link with the word as well.
    if (indication === "speak-link" || indication === "sound-effect") {
      return [textNode(`${xmlSafe(this.options.messages.speechLink)} `), ...nodes];
    }
    return nodes;
  }

  /** Reads an SSML element of the content into an SSML element of the request. */
  private ssml(element: Element, { name, attributes, content }: SsmlPart, block: boolean): XmlNode[] {
    if (content === "none") return [ssmlElement(name, attributes, [])];
    if (content === "text") {
      const text = this.flatText(element);
      return text === "" ? [] : [ssmlElement(name, attributes, [text])];
    }
    const nodes = this.children(element, !block);
    if (name === "p") return nodes;
    if (name === "audio") return this.audio(element, attributes, nodes);
    return nodes.length === 0 ? [] : [ssmlElement(name, attributes, nodes)];
  }

  /**
   * Keeps the audio of an `audio` element only when its `src` is an `http` or `https` URL, which the renderer resolved to
   * the asset origin; otherwise the fallback content is what is said (SSML 1.1 §3.3.1).
   */
  private audio(
    element: Element,
    attributes: Readonly<Record<string, string>>,
    fallback: readonly XmlNode[],
  ): XmlNode[] {
    const source = attributes.src === undefined ? undefined : parseUrl(attributes.src, element.baseURI);
    if (source === undefined) return [...fallback];
    return [ssmlElement("audio", { ...attributes, src: source.href }, fallback)];
  }

  /** Reads the text of an element for an SSML element that holds text only, with no pronunciation from the lexicons. */
  private flatText(element: Element): string {
    const before = this.pronouncing;
    this.pronouncing = false;
    try {
      return plainText(this.children(element, true)).replace(/\n/gu, " ").trim();
    } finally {
      this.pronouncing = before;
    }
  }
}

/**
 * Builds the request that reads the content of a range aloud, in reading order. Content is left out when it is hidden
 * (`hidden`, `aria-hidden="true"`, `qti-hidden`, or `display: none`), when `data-qti-suppress-tts` is
 * `computer-read-aloud` or `all`, when its `data-qti-a11y-content-role` is `screen-reader-orientation`, and as the
 * restriction types of the support say. `qti-visually-hidden` content is read, because it is there for assistive
 * technology. It reads the SSML elements of the content, the functions of `data-ssml`, the pronunciations of the
 * lexicons, the `alt` of images, the value of text fields, and expressions by their speech or text alternative.
 *
 * It returns `undefined` when there is nothing to say: no content, or only content that is left out. It also returns
 * `undefined` for a candidate whose reading type is `screen-reader` (the default), who reads the page with the screen
 * reader, and for `word-by-word` when the range holds more than one word.
 *
 * @param range - The content to read, such as a content root, a paragraph, a selection or a word.
 * @param options - See {@link SpeechOptions}.
 * @throws `DataError` when `range` is not a range or an option is not valid.
 */
export function buildSpeechRequest(range: Range, options: SpeechOptions): SpeechRequest | undefined {
  if (!(range instanceof Range)) throw new DataError(`The range must be a Range, found ${describe(range)}.`);
  checkRecord(options, "The options must be an object");
  checkSpeechSettings(options.settings);
  checkRecord(options.messages, "The option messages must be an object");
  checkNonEmptyString(options.messages.speechLink, "The message speechLink");
  checkNonEmptyString(options.language, "The option language");
  if (options.lexicons !== undefined) checkLexicons(options.lexicons);
  const { settings, language } = options;
  if ((settings.readingType ?? "screen-reader") !== "computer-read-aloud") return undefined;
  const reader = new Reader(range, options);
  const paragraphs = reader.read();
  if (paragraphs === undefined) return undefined;
  const text = plainText(paragraphs);
  if (text === "" || (restrictionsOf(settings).has("word-by-word") && reader.words > 1)) return undefined;
  const lang = reader.language ?? languageOf(range.commonAncestorContainer) ?? language;
  return {
    ssml: speakDocument(paragraphs, lang),
    text,
    lang,
    ...(settings.speechRate === undefined ? {} : { rate: settings.speechRate }),
    ...(settings.pitch === undefined ? {} : { pitch: settings.pitch }),
    ...(settings.volume === undefined ? {} : { volume: settings.volume }),
  };
}
