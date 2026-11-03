import type { InlineChoiceInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html, replaceAll, uniqueId } from "../internal.js";
import { createInteraction, InteractionElement } from "./element.js";
import { Notes } from "./notes.js";
import { nameOf } from "./parts.js";
import { responseOf, stringsOf } from "./values.js";

/** One choice of the menu: its identifier and its text, which an option can hold. */
interface MenuChoice {
  readonly identifier: string;
  readonly text: string;
}

/**
 * The element of `qti-inline-choice-interaction`: a menu inside a sentence, so that the candidate reads the choice in
 * its context.
 *
 * @remarks
 * The menu starts with an entry that is no choice, whose text is `data-prompt`; choosing it gives NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, inline choice interaction}
 */
export class InlineChoiceInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "inline-choice-interaction";
  readonly #menu = html("select");
  #choices: readonly MenuChoice[] = [];
  #prompt: string | undefined;

  /**
   * Fills the element with the label and the menu of the node.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: InlineChoiceInteraction, renderer: BodyRenderer): void {
    this.#choices = node.inlineChoices.map((choice) => ({
      identifier: choice.identifier,
      text: nameOf(renderer.nodes(choice.children)),
    }));
    this.#prompt = node.dataPrompt;
    this.custom = { min: node.dataMinSelectionsMessage };
    const label = node.labelElement;
    if (label !== undefined) {
      // The label of the choice is the visible name of the menu.
      const element = renderer.element("qti-label", label, renderer.nodes(label.children));
      element.id = element.id || uniqueId("ak-label");
      this.#menu.setAttribute("aria-labelledby", element.id);
      this.append(element);
    }
    this.notes = new Notes(true);
    this.append(this.#menu, this.notes.element);
    this.#menu.addEventListener("change", () => this.#choose());
  }

  protected override configure(_descriptor: InteractionDescriptor, messages: Messages): void {
    const prompt = this.#prompt ?? messages.inlineChoicePrompt;
    if (!this.#menu.hasAttribute("aria-labelledby")) this.#menu.setAttribute("aria-label", prompt);
    replaceAll(this.#menu, [
      html("option", { value: "" }, prompt),
      ...this.#choices.map(({ identifier, text }) => html("option", { value: identifier }, text)),
    ]);
  }

  protected override sync(): void {
    this.#menu.value = stringsOf(this.value)[0] ?? "";
    this.#menu.disabled = this.disabled;
  }

  protected override controls(): readonly Element[] {
    return [this.#menu];
  }

  #choose(): void {
    const descriptor = this.descriptor;
    if (descriptor === undefined) return;
    const identifier = this.#menu.value;
    this.respond(responseOf(descriptor, "identifier", identifier === "" ? [] : [identifier]));
  }
}

/**
 * Renders a `qti-inline-choice-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderInlineChoice(node: InlineChoiceInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(
    InlineChoiceInteractionElement,
    "qti-inline-choice-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
