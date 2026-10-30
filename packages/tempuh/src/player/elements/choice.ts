import type { ChoiceInteraction } from "@luthfanwakan/olah/asi";
import type { InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { applyOrientation, renderPrompt } from "./parts.js";
import { SelectionElement } from "./selection.js";

/** The class of the shared vocabulary that stacks the choices in N columns (VOCAB §1.2.1.5). */
const STACKING = /(?:^|\s)qti-choices-stacking-(\d)(?:\s|$)/u;

/**
 * The element of `qti-choice-interaction` (INFO §5.30). The choices keep the order of the node, which the view gave. The
 * candidate starts with none selected (INFO §2.4.1.1).
 */
export class ChoiceInteractionElement extends SelectionElement {
  override readonly kind = "choice-interaction";

  /** Fills the element with the prompt and the choices of the node. */
  build(node: ChoiceInteraction, renderer: BodyRenderer): void {
    this.prompt = renderPrompt(node.prompt, renderer);
    for (const choice of node.simpleChoices) {
      this.choices.push({
        identifier: choice.identifier,
        element: renderer.element("qti-simple-choice", choice, []),
        content: renderer.nodes(choice.children),
      });
    }
    this.custom = { min: node.dataMinSelectionsMessage, max: node.dataMaxSelectionsMessage };
    applyOrientation(this, node.orientation);
    this.notes = new Notes();
    this.append(
      ...(this.prompt === undefined ? [] : [this.prompt.element]),
      ...this.choices.map(({ element }) => element),
      this.notes.element,
    );
    this.listen();
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    super.configure(descriptor, messages);
    // CSS cannot count the choices, and a stack of several columns reads down each column (docs/styling.md).
    const columns = Number(STACKING.exec(this.className)?.[1] ?? 1);
    this.style.setProperty("--tempuh-rows", String(Math.ceil(this.choices.length / columns)));
  }
}

/** Renders a `qti-choice-interaction`. */
export function renderChoice(node: ChoiceInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(ChoiceInteractionElement, "qti-choice-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
