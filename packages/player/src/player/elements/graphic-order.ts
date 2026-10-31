import type { GraphicOrderInteraction } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import { createInteraction } from "./element.js";
import { AreaSelectionElement } from "./hotspot.js";
import { responseOf, stringsOf } from "./values.js";

/**
 * The element of `qti-graphic-order-interaction`: the candidate puts the hotspots in order by selecting them one after
 * the other, and selecting one again takes it out of the order.
 *
 * @remarks
 * Each selected hotspot shows its place in the order as a number that is also in its name, so that no state relies on
 * color (WCAG 2.2, 1.4.1).
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, graphic order interaction}
 */
export class GraphicOrderInteractionElement extends AreaSelectionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "graphic-order-interaction";

  protected override extras(): readonly Node[] {
    return [html("span", { class: "ak-badge", hidden: "" })];
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
      const badge = element.querySelector<HTMLElement>(".ak-badge");
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

/**
 * Renders a `qti-graphic-order-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
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
