import { descendantNodes, type Gap, type GapMatchInteraction } from "@assesskit/runtime/asi";
import { AssesskitError } from "@assesskit/runtime/errors";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Pair, Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import type { Assignment, Board } from "./board/model.js";
import { BoardElement, type BoardLayout, limitsOf, poolOf, tokensOf } from "./board-element.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import {
  applyContainerWidth,
  type BuiltChoice,
  buildChoice,
  elementsNamed,
  type RenderedPrompt,
  renderPrompt,
} from "./parts.js";
import { pairsOf, responseOf } from "./values.js";

const isGap = (node: { readonly kind: string }): node is Gap => node.kind === "gap";

/**
 * The element of `qti-gap-match-interaction` (INFO §5.57): choices that the candidate puts in the gaps of a passage, so
 * that the passage can be read with the gaps filled, in context. A gap holds one choice, and a choice can fill as many
 * gaps as its `match-max` allows.
 */
export class GapMatchInteractionElement extends BoardElement {
  override readonly kind = "gap-match-interaction";
  readonly #choices: BuiltChoice[] = [];
  readonly #gaps: { readonly id: string; readonly element: Element }[] = [];
  #passage: readonly Node[] = [];
  #prompt: RenderedPrompt | undefined;

  /** Fills the element with the prompt, the choices and the passage of the node, and pairs the gaps with their identifiers. */
  build(node: GapMatchInteraction, renderer: BodyRenderer): void {
    this.#prompt = renderPrompt(node.prompt, renderer);
    for (const choice of node.choices) {
      const content = renderer.nodes(choice.kind === "gap-img" ? [choice.image] : choice.children);
      this.#choices.push(buildChoice(renderer, `qti-${choice.kind}`, choice, content));
    }
    this.#passage = renderer.nodes(node.children);
    const identifiers = node.children.flatMap((child) => [child, ...descendantNodes(child)]).filter(isGap);
    // The renderer drew the gaps where the text has them and dropped their identifiers, which the model keeps in the same order.
    const elements = elementsNamed(this.#passage, "qti-gap");
    if (identifiers.length !== elements.length) {
      throw new AssesskitError(`The passage has ${elements.length} gaps drawn for ${identifiers.length} in the model.`);
    }
    identifiers.forEach(({ identifier }, index) => {
      const element = elements[index];
      if (element !== undefined) this.#gaps.push({ id: identifier, element });
    });
    this.custom = { min: node.dataMinSelectionsMessage, max: node.dataMaxSelectionsMessage };
    applyContainerWidth(this, node.dataChoicesContainerWidth);
    this.notes = new Notes();
  }

  protected override layout(descriptor: InteractionDescriptor, messages: Messages): BoardLayout {
    const limitOf = limitsOf(descriptor);
    const slots = this.#gaps.map(({ id, element }, index) => {
      const name = `${messages.boardGap} ${index + 1}`;
      element.setAttribute("role", "group");
      element.setAttribute("aria-label", name);
      return { id, element, name };
    });
    const pool = poolOf(this.#choices, messages);
    const targets = html("div", { class: "ak-targets" }, ...this.#passage);
    this.arrange(this.#prompt, pool, targets);
    return {
      sources: this.#choices.map(({ id }) => ({ id, limit: limitOf(id) })),
      places: slots.map(({ id }) => ({ id, capacity: 1 })),
      tokens: tokensOf(this.#choices, messages),
      slots,
      pool,
    };
  }

  protected override toValue(descriptor: InteractionDescriptor, board: Board): Value | null {
    const pairs = board.assignments().map(([gap, choice]): Pair => [choice, gap]);
    return responseOf(descriptor, "directedPair", pairs);
  }

  protected override assignments(_descriptor: InteractionDescriptor, value: Value | null): Iterable<Assignment> {
    return pairsOf(value).map(([choice, gap]): Assignment => [gap, choice]);
  }
}

/** Renders a `qti-gap-match-interaction`. */
export function renderGapMatch(node: GapMatchInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(GapMatchInteractionElement, "qti-gap-match-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
