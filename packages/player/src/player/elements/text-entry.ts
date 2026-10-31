import type { TextEntryInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { ControlField, TextElement, type TextField } from "./text.js";

/** The `inputmode` that brings up the right keyboard for the base type of the response (HTML Standard §6.8.3). */
const INPUT_MODES: ReadonlyMap<string, string> = new Map([
  ["integer", "numeric"],
  ["float", "decimal"],
]);

/**
 * The element of `qti-text-entry-interaction` (INFO §5.162): a line of text inside a sentence. The response is the text,
 * or the number it reads as, or the record of the runtime's `numericRecord`, as the declaration of the variable says.
 */
export class TextEntryInteractionElement extends TextElement {
  override readonly kind = "text-entry-interaction";
  readonly #input = html("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  readonly #field = new ControlField(this.#input);
  #label: string | undefined;

  /** Fills the element with the field of the node. */
  build(node: TextEntryInteraction): void {
    if (node.placeholderText !== undefined) this.#input.placeholder = node.placeholderText;
    // expected-length is a hint for the size of the box, not a rule (INFO §5.162.4).
    if (node.expectedLength) this.#input.size = node.expectedLength;
    this.#label = node.placeholderText;
    this.custom = { pattern: node.dataPatternmaskMessage };
    this.notes = new Notes(true);
    this.append(this.#input, this.notes.element);
    this.#input.addEventListener("input", () => this.typedIn());
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    this.#input.setAttribute("aria-label", this.#label ?? messages.answerLabel);
    const mode = INPUT_MODES.get(descriptor.declaration?.baseType ?? "string");
    if (mode === undefined) this.#input.removeAttribute("inputmode");
    else this.#input.inputMode = mode;
  }

  protected override fields(): readonly TextField[] {
    return [this.#field];
  }

  protected override controls(): readonly Element[] {
    return [this.#input];
  }
}

/** Renders a `qti-text-entry-interaction`. */
export function renderTextEntry(node: TextEntryInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(
    TextEntryInteractionElement,
    "qti-text-entry-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node);
  return element;
}
