import type { LinkIndication } from "@assesskit/runtime/pnp";
import type { XmlNode } from "@assesskit/runtime/xml";
import { CML_NAMESPACE } from "../internal.js";
import { isBlock, isMath } from "./block-elements.js";
import { applyDataSsml, readDataSsml } from "./data-ssml.js";
import { languageOf } from "./language.js";
import type { Lexicon } from "./lexicon.js";
import type { SpeechOptions } from "./options.js";
import { paragraph, textNode, wordsIn } from "./paragraphs.js";
import { type Pronounced, pronounce } from "./pronounce.js";
import { restrictionsOf } from "./settings.js";
import { plainText, readSsmlElement, type SsmlPart, ssmlElement, xmlSafe } from "./ssml.js";

/** The types of `input` whose value is text that the candidate typed. */
const TEXT_INPUT_TYPES: readonly string[] = ["text", "search", "tel", "url", "email", "number"];

/**
 * The value of the SSML `variant` attribute that makes a link sound like another voice.
 *
 * @see {@link https://www.w3.org/TR/speech-synthesis11/#edef_voice | SSML 1.1, voice}
 */
const LINK_VOICE_VARIANT = "2";

/** What reading an element gives: the nodes, and whether they are paragraphs of their own. */
interface Read {
  readonly nodes: readonly XmlNode[];
  readonly block: boolean;
}

/** Parses a URL against a base, and returns it only when it is `http` or `https`. */
function parseUrl(reference: string, base: string): URL | undefined {
  try {
    const url = new URL(reference, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function pronouncedElement({ text, pronunciation }: Pronounced): XmlNode {
  return pronunciation.kind === "alias"
    ? ssmlElement("sub", { alias: pronunciation.alias }, [text])
    : ssmlElement("phoneme", { alphabet: pronunciation.alphabet, ph: pronunciation.ph }, [text]);
}

/** Reads the content of a range, in reading order, into the nodes of an SSML document. */
export class Reader {
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

  /**
   * Reads the range.
   *
   * @returns The nodes of the SSML document, or `undefined` when an ancestor of the range keeps all of it from being read.
   */
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
   * Makes the nodes that say a text.
   *
   * @remarks
   * A text outside the rubric blocks is left out under `directions-only`; the white space is reduced to a space, and
   * the lexicons give pronunciations when `withLexicons` is set.
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

  /** Marks a link as the candidate's link indication asks. */
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
   * the asset origin; otherwise the fallback content is what is said.
   *
   * @see {@link https://www.w3.org/TR/speech-synthesis11/#edef_audio | SSML 1.1, audio}
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
