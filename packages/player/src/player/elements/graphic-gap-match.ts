import type { GraphicGapMatchInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Pair, Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import type { Assignment, Board } from "./board/model.js";
import { BoardElement, type BoardLayout, limitsOf, poolOf, tokensOf } from "./board-element.js";
import { createInteraction } from "./element.js";
import { createArea } from "./graphic/areas.js";
import { createStage } from "./graphic/stage.js";
import { Notes } from "./notes.js";
import { type BuiltChoice, buildChoice, type RenderedPrompt, renderPrompt } from "./parts.js";
import { pairsOf, responseOf } from "./values.js";

/** A gap of the image: its identifier, its element, and the label that the author gave it. */
interface ImageGap {
  readonly id: string;
  readonly element: HTMLElement;
  readonly label: string | undefined;
}

/**
 * The element of `qti-graphic-gap-match-interaction`: the candidate puts choices from a list into gaps of an image, and
 * the response pairs each choice, the source, with its gap, the target.
 *
 * @remarks
 * A gap can take several choices, as far as its `match-max` allows, and a choice several gaps, as far as its own. It
 * works on a board like the other interactions that put choices in places: the candidate picks a choice up and chooses
 * the gap, with a click, a tap or the keyboard, and a mouse or a pen can drag it, so that no one has to drag (WCAG 2.2,
 * 2.1.1, 2.5.7).
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, graphic gap match interaction}
 */
export class GraphicGapMatchInteractionElement extends BoardElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "graphic-gap-match-interaction";
  readonly #choices: BuiltChoice[] = [];
  readonly #gaps: ImageGap[] = [];
  #stageElement: HTMLElement | undefined;
  #prompt: RenderedPrompt | undefined;
  /** The choices that the author named with `object-label`, by identifier. */
  readonly #labels = new Map<string, string>();

  /**
   * Fills the element with the prompt, the choices and the image with its gaps.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: GraphicGapMatchInteraction, renderer: BodyRenderer): void {
    this.#prompt = renderPrompt(node.prompt, renderer);
    for (const choice of node.choices) {
      const content = renderer.nodes(choice.kind === "gap-img" ? [choice.image] : choice.children);
      this.#choices.push(buildChoice(renderer, `qti-${choice.kind}`, choice, content));
      if (choice.kind === "gap-img" && choice.objectLabel !== undefined)
        this.#labels.set(choice.identifier, choice.objectLabel);
    }
    const { element, stage } = createStage(node.image, renderer);
    for (const hotspot of node.associableHotspots) {
      const area = createArea(hotspot, { renderer, stage });
      area.element.append(html("span", { class: "ak-face" }, ...area.content));
      stage.layer.append(area.element);
      this.#gaps.push({ id: hotspot.identifier, element: area.element, label: hotspot.hotspotLabel });
    }
    this.#stageElement = element;
    this.notes = new Notes();
  }

  protected override layout(descriptor: InteractionDescriptor, messages: Messages): BoardLayout {
    const limitOf = limitsOf(descriptor);
    const slots = this.#gaps.map(({ id, element, label }, index) => ({
      id,
      element,
      name: label ?? `${messages.boardGap} ${index + 1}`,
    }));
    const pool = poolOf(this.#choices, messages);
    // A choice that has only an `object-label` for a name is named by it, as the button of the choice has no text.
    const tokens = tokensOf(this.#choices, messages).map((token) => {
      const label = this.#labels.get(token.id);
      return label === undefined ? token : { ...token, name: label, named: false };
    });
    this.arrange(
      this.#prompt,
      pool,
      html("div", { class: "ak-targets" }, ...(this.#stageElement === undefined ? [] : [this.#stageElement])),
    );
    return {
      sources: this.#choices.map(({ id }) => ({ id, limit: limitOf(id) })),
      places: slots.map(({ id }) => ({ id, capacity: limitOf(id) })),
      tokens,
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

/**
 * Renders a `qti-graphic-gap-match-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderGraphicGapMatch(
  node: GraphicGapMatchInteraction,
  renderer: BodyRenderer,
  messages: Messages,
): Element {
  const element = createInteraction(
    GraphicGapMatchInteractionElement,
    "qti-graphic-gap-match-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
