import type { OrderInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import type { Assignment, Board } from "./board/model.js";
import { BoardElement, type BoardLayout, poolOf, tokensOf } from "./board-element.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import {
  applyContainerWidth,
  applyOrientation,
  type BuiltChoice,
  buildChoice,
  type RenderedPrompt,
  renderPrompt,
} from "./parts.js";
import { responseOf, stringsOf } from "./values.js";

/**
 * The element of `qti-order-interaction`: the candidate puts the choices in order in numbered places, or, with
 * `min-choices`, only some of them.
 *
 * @remarks
 * The places are as many as the choices the candidate may order. A restored response puts the choices in the places in
 * its order, which overrides the initial order of the choices.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, order interaction}
 */
export class OrderInteractionElement extends BoardElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "order-interaction";
  readonly #choices: BuiltChoice[] = [];
  #prompt: RenderedPrompt | undefined;
  #places: readonly string[] = [];

  /**
   * Fills the element with the prompt and the choices of the node.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: OrderInteraction, renderer: BodyRenderer): void {
    this.#prompt = renderPrompt(node.prompt, renderer);
    for (const choice of node.simpleChoices) {
      this.#choices.push(buildChoice(renderer, "qti-simple-choice", choice, renderer.nodes(choice.children)));
    }
    this.custom = { min: node.dataMinSelectionsMessage, max: node.dataMaxSelectionsMessage };
    applyOrientation(this, node.orientation);
    applyContainerWidth(this, node.dataChoicesContainerWidth);
    this.notes = new Notes();
  }

  protected override layout(descriptor: InteractionDescriptor, messages: Messages): BoardLayout {
    const count = Math.min(descriptor.constraints.maxChoices ?? this.#choices.length, this.#choices.length);
    const slots = Array.from({ length: count }, (_, index) => {
      const name = `${messages.boardPosition} ${index + 1}`;
      return {
        id: `${index + 1}`,
        element: html("div", { class: "ak-target", role: "group", "aria-label": name }),
        name,
      };
    });
    this.#places = slots.map(({ id }) => id);
    const pool = poolOf(this.#choices, messages);
    const targets = html(
      "div",
      { class: "ak-targets", role: "group", "aria-label": messages.boardOrder },
      ...slots.map(({ element }) => element),
    );
    this.arrange(this.#prompt, pool, targets);
    return {
      sources: this.#choices.map(({ id }) => ({ id, limit: 1 })),
      places: slots.map(({ id }) => ({ id, capacity: 1 })),
      tokens: tokensOf(this.#choices, messages),
      slots,
      pool,
    };
  }

  protected override toValue(descriptor: InteractionDescriptor, board: Board): Value | null {
    const ordered = this.#places.flatMap((place) => board.occupants(place).slice(0, 1));
    return responseOf(descriptor, "identifier", ordered, true);
  }

  protected override assignments(_descriptor: InteractionDescriptor, value: Value | null): Iterable<Assignment> {
    return stringsOf(value).flatMap((source, index): Assignment[] => {
      const place = this.#places[index];
      return place === undefined ? [] : [[place, source]];
    });
  }
}

/**
 * Renders a `qti-order-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderOrder(node: OrderInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(OrderInteractionElement, "qti-order-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
