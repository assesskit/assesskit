import type { GraphicOrderInteraction, HotspotInteraction } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { createInteraction } from "./element.js";
import { createArea } from "./graphic/areas.js";
import { createStage } from "./graphic/stage.js";
import { Notes } from "./notes.js";
import { renderPrompt } from "./parts.js";
import { SelectionElement } from "./selection.js";
import { stringsOf } from "./values.js";

/**
 * The element of an interaction that selects hotspots of an image: a hotspot interaction (INFO §5.68) or a graphic order
 * interaction (INFO §5.61). Each hotspot is a hidden native control with a face that draws its shape, so that the keyboard,
 * the screen reader and the pointer all use the control. The hotspots keep the order of the node, which the view gave.
 */
export abstract class AreaSelectionElement extends SelectionElement {
  /** Returns the nodes of the face of a hotspot besides its label and its outline. Default: none. */
  protected extras(): readonly Node[] {
    return [];
  }

  /** Fills the element with the prompt, the image with its hotspots, and the notes. */
  build(node: HotspotInteraction | GraphicOrderInteraction, renderer: BodyRenderer): void {
    this.prompt = renderPrompt(node.prompt, renderer);
    const { element: stageElement, stage } = createStage(node.image, renderer);
    for (const hotspot of node.hotspotChoices) {
      const area = createArea(hotspot, { renderer, stage });
      stage.layer.append(area.element);
      this.choices.push({
        identifier: hotspot.identifier,
        element: area.element,
        content: [...area.content, ...this.extras()],
      });
    }
    this.notes = new Notes();
    this.append(...(this.prompt === undefined ? [] : [this.prompt.element]), stageElement, this.notes.element);
    this.listen();
  }
}

/**
 * The element of `qti-hotspot-interaction` (INFO §5.68): the candidate selects one hotspot or several. With a maximum of one
 * choice the controls are radio buttons, and choosing the selected hotspot again clears the choice, so that the candidate
 * can return to no answer.
 */
export class HotspotInteractionElement extends AreaSelectionElement {
  override readonly kind = "hotspot-interaction";

  protected override listen(): void {
    super.listen();
    this.addEventListener("click", (event) => {
      const choice = this.choices.find(({ control }) => control === event.target);
      if (choice?.control?.type !== "radio" || !stringsOf(this.value).includes(choice.identifier)) return;
      choice.control.checked = false;
      this.respond(null);
    });
  }
}

/** Renders a `qti-hotspot-interaction`. */
export function renderHotspot(node: HotspotInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(HotspotInteractionElement, "qti-hotspot-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
