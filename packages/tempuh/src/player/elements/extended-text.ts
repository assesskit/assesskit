import type { ExtendedTextInteraction } from "@luthfanwakan/olah/asi";
import type { InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { EditorField } from "./editor.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { nameByPrompt, type RenderedPrompt, renderPrompt } from "./parts.js";
import { ControlField, TextElement, type TextField } from "./text.js";
import { cardinalityOf } from "./values.js";

/** The characters of a text, counted as code points, so that a character of several code units counts once. */
const codePoints = (text: string): number => [...text].length;

/** Where the candidate types one text: the field, the control that has the focus, and how many characters it holds. */
interface Source {
  readonly field: TextField;
  readonly control: HTMLElement;
  readonly element: HTMLElement;
  characters(): number;
}

/** One text of the interaction, with the counter of its characters when the item asks for one. */
interface Entry extends Source {
  readonly counter: HTMLElement | undefined;
}

/** Makes the text area of a plain or preformatted text. */
function areaSource(node: ExtendedTextInteraction, label: string): Source {
  const area = html("textarea", { "aria-label": label });
  if (node.placeholderText !== undefined) area.placeholder = node.placeholderText;
  if (node.expectedLines) area.rows = node.expectedLines;
  if (node.format === "preformatted") area.classList.add("tempuh-preformatted");
  return { field: new ControlField(area), control: area, element: area, characters: () => codePoints(area.value) };
}

/** Makes the editor of a text in XHTML. */
function editorSource(messages: Messages, label: string): Source {
  const editor = new EditorField(messages, label);
  return {
    field: editor,
    control: editor.area,
    element: editor.element,
    characters: () => codePoints(editor.typedText),
  };
}

/**
 * The element of `qti-extended-text-interaction` (INFO §5.48): an area for a longer text, or several texts, when the
 * response is a container of strings. The format says how the text is typed: `plain` in a text area, `preformatted` in
 * one that keeps its spaces, `xhtml` in an editor that writes a few elements of XHTML. The classes `qti-counter-up` and
 * `qti-counter-down` show how many characters the candidate typed, or has left, of `expected-length` (VOCAB §1.2.3.2).
 */
export class ExtendedTextInteractionElement extends TextElement {
  override readonly kind = "extended-text-interaction";
  readonly #entries: Entry[] = [];
  readonly #fields = html("div", { class: "tempuh-fields" });
  #node: ExtendedTextInteraction | undefined;
  #prompt: RenderedPrompt | undefined;

  /** Fills the element with the prompt of the node; the fields come when the descriptor is known. */
  build(node: ExtendedTextInteraction, renderer: BodyRenderer): void {
    this.#node = node;
    this.#prompt = renderPrompt(node.prompt, renderer);
    this.custom = { pattern: node.dataPatternmaskMessage };
    this.notes = new Notes();
    this.append(...(this.#prompt === undefined ? [] : [this.#prompt.element]), this.#fields, this.notes.element);
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    const node = this.#node;
    if (node === undefined) return;
    // INFO §5.48.6: a container takes up to max-strings separate texts, each in a field of its own.
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
    const entry: Entry = {
      ...source,
      counter: direction && node.expectedLength ? html("div", { class: "tempuh-counter" }) : undefined,
    };
    entry.control.addEventListener("input", () => {
      this.typedIn();
      this.#count(entry, messages);
    });
    return entry;
  }

  /** Shows the characters typed (`qti-counter-up`) or left (`qti-counter-down`) of the expected length. */
  #count({ counter, characters }: Entry, messages: Messages): void {
    const expected = this.#node?.expectedLength;
    if (counter === undefined || !expected) return;
    const typed = characters();
    counter.textContent = this.classList.contains("qti-counter-up")
      ? `${typed} / ${expected} ${messages.counterCharacters}`
      : `${expected - typed} ${messages.counterLeft}`;
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

/** Renders a `qti-extended-text-interaction`. */
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
