import type { ExtendedTextInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import { EditorField } from "./editor.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { nameByPrompt, type RenderedPrompt, renderPrompt } from "./parts.js";
import { ControlField, NO_ASSISTANCE, TextElement, type TextField } from "./text.js";
import { cardinalityOf } from "./values.js";

/** The characters of a text, counted as code points, so that a character of several code units counts once. */
const codePoints = (text: string): number => [...text].length;

/**
 * The words of a text: the runs of characters that are not white space. A text in a script that puts no space between words,
 * such as Chinese or Japanese, has one word for each run of characters, so its items count characters.
 */
const wordsIn = (text: string): number => text.split(/\s+/u).filter((word) => word !== "").length;

/** Where the candidate types one text: the field, the control that has the focus, and how many characters and words it holds. */
interface Source {
  readonly field: TextField;
  readonly control: HTMLElement;
  readonly element: HTMLElement;
  characters(): number;
  words(): number;
}

/** One text of the interaction, with the counter of its characters when the item asks for one. */
interface Entry extends Source {
  readonly counter: HTMLElement | undefined;
}

/** Makes the text area of a plain or preformatted text. */
function areaSource(node: ExtendedTextInteraction, label: string): Source {
  const area = html("textarea", { "aria-label": label, ...NO_ASSISTANCE });
  if (node.placeholderText !== undefined) area.placeholder = node.placeholderText;
  if (node.expectedLines) area.rows = node.expectedLines;
  if (node.format === "preformatted") area.classList.add("ak-preformatted");
  return {
    field: new ControlField(area),
    control: area,
    element: area,
    characters: () => codePoints(area.value),
    words: () => wordsIn(area.value),
  };
}

/** Makes the editor of a text in XHTML. */
function editorSource(messages: Messages, label: string): Source {
  const editor = new EditorField(messages, label);
  return {
    field: editor,
    control: editor.area,
    element: editor.element,
    characters: () => codePoints(editor.typedText),
    words: () => wordsIn(editor.spacedText),
  };
}

/**
 * The element of `qti-extended-text-interaction`: an area for a longer text, or several texts, when the response is a
 * container of strings.
 *
 * @remarks
 * The format says how the text is typed: `plain` in a text area, `preformatted` in one that keeps its spaces, `xhtml`
 * in an editor that writes a few elements of XHTML. The classes `qti-counter-up` and `qti-counter-down` show how many
 * characters the candidate typed, or has left, of `expected-length`, which counts characters as QTI defines it. The
 * attribute `data-ak-count="words"` shows the words typed instead, with no expected length.
 *
 * The text areas and the editor ask the browser for no spell check, correction, capital letters or completion, as the text
 * entry does; the property `spellChecked` turns the spell check on, for a candidate whose support asks for it.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, extended text interaction}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/vocab/ | QTI 3 Standardized Shared Vocabulary, extended text interaction}
 */
export class ExtendedTextInteractionElement extends TextElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "extended-text-interaction";
  readonly #entries: Entry[] = [];
  readonly #fields = html("div", { class: "ak-fields" });
  #node: ExtendedTextInteraction | undefined;
  #prompt: RenderedPrompt | undefined;
  #spellChecked = false;

  /**
   * Fills the element with the prompt of the node; the fields come when the descriptor is known.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: ExtendedTextInteraction, renderer: BodyRenderer): void {
    this.#node = node;
    this.#prompt = renderPrompt(node.prompt, renderer);
    this.custom = { pattern: node.dataPatternmaskMessage };
    this.notes = new Notes();
    this.append(...(this.#prompt === undefined ? [] : [this.#prompt.element]), this.#fields, this.notes.element);
  }

  /** Whether the browser checks the spelling of the texts, which only the support `spell-checker-on-screen` turns on. */
  get spellChecked(): boolean {
    return this.#spellChecked;
  }

  /**
   * Turns the spell check of the browser on or off for every text of the interaction.
   *
   * @param on - `true` to check the spelling.
   */
  set spellChecked(on: boolean) {
    this.#spellChecked = on;
    for (const { control } of this.#entries) control.setAttribute("spellcheck", String(on));
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    const node = this.#node;
    if (node === undefined) return;
    // A container takes up to max-strings separate texts, each in a field of its own.
    const cardinality = cardinalityOf(descriptor);
    const many = cardinality === "multiple" || cardinality === "ordered";
    const count = many ? (descriptor.constraints.maxStrings ?? 1) : 1;
    this.#entries.length = 0;
    for (let index = 0; index < count; index++) {
      const label = many ? `${messages.answerLabel} ${index + 1}` : messages.answerLabel;
      this.#entries.push(this.#entry(node, messages, label));
    }
    this.#fields.replaceChildren(
      ...this.#entries.map(({ element, counter }) => html("div", {}, element, ...(counter ? [counter] : []))),
    );
    const [first] = this.#entries;
    if (!many && first !== undefined && this.#prompt !== undefined) {
      first.control.removeAttribute("aria-label");
      nameByPrompt(first.control, this.#prompt);
    }
  }

  #entry(node: ExtendedTextInteraction, messages: Messages, label: string): Entry {
    const source = node.format === "xhtml" ? editorSource(messages, label) : areaSource(node, label);
    const direction = this.classList.contains("qti-counter-up") || this.classList.contains("qti-counter-down");
    const counted = this.getAttribute("data-ak-count") === "words" || (direction && node.expectedLength);
    const entry: Entry = { ...source, counter: counted ? html("div", { class: "ak-counter" }) : undefined };
    if (this.#spellChecked) entry.control.setAttribute("spellcheck", "true");
    entry.control.addEventListener("input", () => {
      this.typedIn();
      this.#count(entry, messages);
    });
    return entry;
  }

  /** Shows the words typed (`data-ak-count="words"`), or the characters typed (`qti-counter-up`) or left (`qti-counter-down`) of the expected length. */
  #count({ counter, characters, words }: Entry, messages: Messages): void {
    if (counter === undefined) return;
    if (this.getAttribute("data-ak-count") === "words") {
      counter.textContent = `${messages.counterWords} ${words()}`;
      return;
    }
    const expected = this.#node?.expectedLength;
    if (!expected) return;
    const typed = characters();
    counter.textContent = this.classList.contains("qti-counter-up")
      ? `${messages.counterCharacters} ${typed} / ${expected}`
      : `${messages.counterLeft} ${expected - typed}`;
  }

  protected override fields(): readonly TextField[] {
    return this.#entries.map(({ field }) => field);
  }

  protected override sync(descriptor: InteractionDescriptor, messages: Messages): void {
    super.sync(descriptor, messages);
    for (const entry of this.#entries) this.#count(entry, messages);
  }

  protected override controls(): readonly Element[] {
    return this.#entries.map(({ control }) => control);
  }
}

/**
 * Renders a `qti-extended-text-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderExtendedText(node: ExtendedTextInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(
    ExtendedTextInteractionElement,
    "qti-extended-text-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
