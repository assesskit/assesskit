import type { AssociateInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Pair, Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import type { Assignment, Board } from "./board/model.js";
import { BoardElement, type BoardLayout, limitsOf, poolOf, tokensOf } from "./board-element.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { type BuiltChoice, buildChoice, type RenderedPrompt, renderPrompt } from "./parts.js";
import { pairsOf, responseOf } from "./values.js";

/** The ends of a pair. */
const ENDS = [0, 1] as const;

/**
 * The element of `qti-associate-interaction` (INFO §5.8): the candidate makes pairs of choices, each in a box with two
 * places. A pair counts once both its places are filled, and a choice can be in as many pairs as its `match-max` allows
 * (INFO §5.131.6). The boxes are as many as `max-associations`, or as the choices when it is unlimited.
 */
export class AssociateInteractionElement extends BoardElement {
  override readonly kind = "associate-interaction";
  readonly #choices: BuiltChoice[] = [];
  #prompt: RenderedPrompt | undefined;
  #boxes = 0;

  /** Fills the element with the prompt and the choices of the node. */
  build(node: AssociateInteraction, renderer: BodyRenderer): void {
    this.#prompt = renderPrompt(node.prompt, renderer);
    for (const choice of node.simpleAssociableChoices) {
      this.#choices.push(
        buildChoice(renderer, "qti-simple-associable-choice", choice, renderer.nodes(choice.children)),
      );
    }
    this.notes = new Notes();
  }

  protected override layout(descriptor: InteractionDescriptor, messages: Messages): BoardLayout {
    const limitOf = limitsOf(descriptor);
    this.#boxes = descriptor.constraints.maxAssociations ?? this.#choices.length;
    const slots = Array.from({ length: this.#boxes }, (_, box) =>
      ENDS.map((end) => {
        const pair = `${messages.boardPair} ${box + 1}`;
        const name = `${pair}, ${end === 0 ? messages.boardFirst : messages.boardSecond}`;
        return {
          id: `${box}:${end}`,
          element: html("div", { class: "ak-target", role: "group", "aria-label": name }),
          name,
        };
      }),
    );
    const pool = poolOf(this.#choices, messages);
    const targets = html(
      "div",
      { class: "ak-targets", role: "group", "aria-label": messages.boardPair },
      ...slots.map((ends, box) =>
        html(
          "div",
          { class: "ak-pair", role: "group", "aria-label": `${messages.boardPair} ${box + 1}` },
          ...ends.map(({ element }) => element),
        ),
      ),
    );
    this.arrange(this.#prompt, pool, targets);
    return {
      sources: this.#choices.map(({ id }) => ({ id, limit: limitOf(id) })),
      places: slots.flat().map(({ id }) => ({ id, capacity: 1 })),
      tokens: tokensOf(this.#choices, messages),
      slots: slots.flat(),
      pool,
    };
  }

  protected override toValue(descriptor: InteractionDescriptor, board: Board): Value | null {
    const pairs: Pair[] = [];
    for (let box = 0; box < this.#boxes; box++) {
      const [first] = board.occupants(`${box}:0`);
      const [second] = board.occupants(`${box}:1`);
      if (first !== undefined && second !== undefined) pairs.push([first, second]);
    }
    return responseOf(descriptor, "pair", pairs);
  }

  protected override assignments(_descriptor: InteractionDescriptor, value: Value | null): Iterable<Assignment> {
    return pairsOf(value)
      .slice(0, this.#boxes)
      .flatMap(([first, second], box): Assignment[] => [
        [`${box}:0`, first],
        [`${box}:1`, second],
      ]);
  }
}

/** Renders a `qti-associate-interaction`. */
export function renderAssociate(node: AssociateInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(AssociateInteractionElement, "qti-associate-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
