import type { InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import type { Messages } from "../../messages/index.js";
import { html, uniqueId } from "../dom.js";
import { InteractionElement } from "./element.js";
import { choiceName, nameByPrompt, nameOf, type RenderedPrompt } from "./parts.js";
import { responseOf, stringsOf } from "./values.js";

/** One choice that the candidate selects: its element, its text and, once the descriptor is known, its control. */
export interface SelectableChoice {
  /** The identifier, which the response names. */
  readonly identifier: string;
  /** The element of the choice, which holds the control and the face. */
  readonly element: Element;
  /** What the choice shows, which the face holds. */
  readonly content: readonly Node[];
  /** The radio button or checkbox; absent until the descriptor is set. */
  control?: HTMLInputElement;
}

/**
 * The element of an interaction whose response is the identifiers of the choices that the candidate selects: a choice
 * interaction (INFO §5.30) or a hot text interaction (INFO §5.66). Each choice has a radio button where the candidate
 * may select at most one, else a checkbox, and a label that is the face of the choice; the control is first, as the
 * stylesheet expects ([styling](../../../docs/styling.md)).
 */
export abstract class SelectionElement extends InteractionElement {
  /** The choices, in the order of the node. */
  protected readonly choices: SelectableChoice[] = [];
  /** The prompt, which names the group of controls. */
  protected prompt: RenderedPrompt | undefined;

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    const single = descriptor.constraints.maxChoices === 1;
    this.setAttribute("role", single ? "radiogroup" : "group");
    nameByPrompt(this, this.prompt);
    const group = uniqueId("tempuh-choice");
    this.choices.forEach((choice, index) => {
      const id = uniqueId("tempuh-choice-control");
      choice.control = html("input", { class: "tempuh-control", type: single ? "radio" : "checkbox", name: group, id });
      // A choice that shows no text, such as an image without an alternative, still names its control.
      if (nameOf(choice.content) === "") choice.control.setAttribute("aria-label", choiceName("", index, messages));
      choice.element.replaceChildren(
        choice.control,
        html("label", { class: "tempuh-face", for: id }, ...choice.content),
      );
    });
  }

  protected override sync(): void {
    const selected = new Set(stringsOf(this.value));
    for (const { identifier, control } of this.choices) {
      if (control === undefined) continue;
      control.checked = selected.has(identifier);
      control.disabled = this.disabled;
    }
  }

  protected override controls(): readonly Element[] {
    return this.choices.flatMap(({ control }) => (control === undefined ? [] : [control]));
  }

  /** Listens for the candidate's selections and gives the response of the controls that are checked. */
  protected listen(): void {
    this.addEventListener("change", () => {
      const descriptor = this.descriptor;
      if (descriptor === undefined) return;
      const identifiers = this.choices.flatMap(({ identifier, control }) => (control?.checked ? [identifier] : []));
      this.respond(responseOf(descriptor, "identifier", identifiers));
    });
  }
}
