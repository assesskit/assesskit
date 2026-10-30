import type { GraphicOrderInteraction } from "@luthfanwakan/olah/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { createInteraction } from "./element.js";
import { AreaSelectionElement } from "./hotspot.js";
import { responseOf, stringsOf } from "./values.js";

/**
 * The element of `qti-graphic-order-interaction` (INFO §5.61): the candidate puts the hotspots in order by selecting them
 * one after the other, and selecting one again takes it out of the order. Each selected hotspot shows its place in the
 * order as a number that is also in its name, so that no state relies on color (WCAG 2.2, 1.4.1).
 */
export class GraphicOrderInteractionElement extends AreaSelectionElement {
  override readonly kind = "graphic-order-interaction";

  protected override extras(): readonly Node[] {
    return [html("span", { class: "tempuh-badge", hidden: "" })];
  }

  protected override listen(): void {
    this.addEventListener("change", (event) => {
      const descriptor = this.descriptor;
      const changed = this.choices.find(({ control }) => control === event.target);
      if (descriptor === undefined || changed?.control === undefined) return;
      const rest = stringsOf(this.value).filter((identifier) => identifier !== changed.identifier);
      const order = changed.control.checked ? [...rest, changed.identifier] : rest;
      this.respond(responseOf(descriptor, "identifier", order, true));
    });
  }

  protected override sync(): void {
    super.sync();
    const { messages } = this;
    if (messages === undefined) return;
    const order = stringsOf(this.value);
    for (const { identifier, element } of this.choices) {
      const badge = element.querySelector<HTMLElement>(".tempuh-badge");
      const place = order.indexOf(identifier) + 1;
      if (badge === null) continue;
      badge.hidden = place === 0;
      badge.replaceChildren(
        ...(place === 0
          ? []
          : [html("span", { class: "qti-visually-hidden" }, `${messages.boardPosition} `), String(place)]),
      );
    }
  }
}

/** Renders a `qti-graphic-order-interaction`. */
export function renderGraphicOrder(node: GraphicOrderInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(
    GraphicOrderInteractionElement,
    "qti-graphic-order-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
