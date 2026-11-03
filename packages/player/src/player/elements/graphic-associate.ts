import type { GraphicAssociateInteraction } from "@assesskit/runtime/asi";
import { checkResponse, type InteractionDescriptor, type ResponseViolation } from "@assesskit/runtime/interactions";
import type { Pair } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html, replaceAll, svg, uniqueId } from "../internal.js";
import { createInteraction, InteractionElement } from "./element.js";
import { boxOf, createArea } from "./graphic/areas.js";
import { centerOf } from "./graphic/geometry.js";
import { createStage, stageOf } from "./graphic/stage.js";
import { Notes } from "./notes.js";
import { choiceName, nameByPrompt, type RenderedPrompt, renderPrompt } from "./parts.js";
import { pairsOf, responseOf } from "./values.js";

/** The separator of the two ends of an association in text. */
const JOIN = " – ";

/** The rules that make a pair impossible, as against the incomplete response that more pairs repair. */
const IMPOSSIBLE: ReadonlySet<ResponseViolation> = new Set([
  "binding",
  "match-group",
  "match-max",
  "max-associations",
  "unknown-choice",
]);

/** A hotspot that the candidate joins with another: its element, its control and the label that the author gave it. */
interface PairHotspot {
  readonly identifier: string;
  readonly element: HTMLElement;
  readonly control: HTMLButtonElement;
  readonly label: string | undefined;
}

/**
 * The element of `qti-graphic-associate-interaction`: the candidate joins hotspots of an image in pairs.
 *
 * @remarks
 * No gesture along a path is needed (WCAG 2.2, 2.5.1): the candidate chooses one hotspot, which stays pressed, and then
 * the hotspot to join it with; choosing the pressed one again lets it go. Each association is a line between the
 * hotspots and an entry of a list below the image with a button that removes it, so that a screen reader and the
 * keyboard have the same information as the drawing. A hotspot that the runtime's rules leave no pair for, such as one
 * used as often as its `match-max` allows, is unavailable.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, graphic associate interaction}
 */
export class GraphicAssociateInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "graphic-associate-interaction";
  readonly #hotspots: PairHotspot[] = [];
  readonly #links = svg("svg", {
    class: "ak-links",
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false",
  });
  readonly #list = html("ul", { class: "ak-associations", hidden: "" });
  readonly #usage = html("p", { class: "ak-usage" });
  #layer: HTMLElement | undefined;

  constructor() {
    super();
    this.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLButtonElement>("button.ak-control");
      const remove = target?.closest<HTMLElement>(".ak-remove");
      if (control instanceof HTMLButtonElement) this.#choose(control);
      else if (remove instanceof HTMLElement) this.#remove(Number(remove.dataset.index));
    });
  }

  /**
   * Fills the element with the prompt, the image with its hotspots and lines, the instructions, the list of pairs and the notes.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: GraphicAssociateInteraction, renderer: BodyRenderer): void {
    const prompt: RenderedPrompt | undefined = renderPrompt(node.prompt, renderer);
    const { element: stageElement, stage } = createStage(node.image, renderer);
    this.#layer = stage.layer;
    stage.layer.append(this.#links);
    for (const hotspot of node.associableHotspots) {
      const area = createArea(hotspot, { renderer, stage });
      const id = uniqueId("ak-hotspot");
      const control = html("button", {
        class: "ak-control",
        type: "button",
        id,
        value: hotspot.identifier,
        "aria-pressed": "false",
      });
      area.element.append(control, html("label", { class: "ak-face", for: id }, ...area.content));
      stage.layer.append(area.element);
      this.#hotspots.push({
        identifier: hotspot.identifier,
        element: area.element,
        control,
        label: hotspot.hotspotLabel,
      });
    }
    this.notes = new Notes();
    this.replaceChildren(
      ...(prompt === undefined ? [] : [prompt.element]),
      stageElement,
      this.#usage,
      this.#list,
      this.notes.element,
    );
    this.setAttribute("role", "group");
    nameByPrompt(this, prompt);
  }

  #pending(): PairHotspot | undefined {
    return this.#hotspots.find(({ control }) => control.getAttribute("aria-pressed") === "true");
  }

  /** Returns whether the runtime's rules leave room for the pair of two hotspots, besides those that stand already. */
  #allows(descriptor: InteractionDescriptor, pairs: readonly Pair[], first: string, second: string): boolean {
    const { reasons } = checkResponse(descriptor, responseOf(descriptor, "pair", [...pairs, [first, second]]));
    return !reasons.some((reason) => IMPOSSIBLE.has(reason));
  }

  #change(pairs: readonly Pair[], notice: "graphicJoined" | "graphicRemoved"): void {
    const { descriptor, messages } = this;
    if (descriptor === undefined || messages === undefined) return;
    this.respond(responseOf(descriptor, "pair", pairs));
    this.notes?.announce(messages[notice]);
  }

  /** Takes a hotspot as the first end of an association, or as the second end of the one that the pressed hotspot began. */
  #choose(control: HTMLButtonElement): void {
    if (control.getAttribute("aria-disabled") === "true") return;
    const first = this.#pending();
    if (first === undefined) {
      control.setAttribute("aria-pressed", "true");
      this.notes?.announce(this.messages?.graphicChooseSecond ?? "");
      this.refresh();
    } else if (first.control === control) {
      control.setAttribute("aria-pressed", "false");
      this.refresh();
    } else {
      first.control.setAttribute("aria-pressed", "false");
      this.#change([...pairsOf(this.value), [first.identifier, control.value]], "graphicJoined");
    }
  }

  #remove(index: number): void {
    this.#change(
      pairsOf(this.value).filter((_, i) => i !== index),
      "graphicRemoved",
    );
    (
      this.querySelector<HTMLElement>(".ak-remove") ?? this.#hotspots.find(({ control }) => !control.disabled)?.control
    )?.focus();
  }

  protected override configure(_descriptor: InteractionDescriptor, messages: Messages): void {
    this.#usage.textContent = messages.graphicAssociateHint;
    this.#hotspots.forEach(({ control, label }, index) => {
      if (label === undefined) control.setAttribute("aria-label", choiceName("", index, messages));
    });
  }

  protected override sync(descriptor: InteractionDescriptor, messages: Messages): void {
    const pairs = pairsOf(this.value);
    const pending = this.#pending();
    for (const { identifier, control } of this.#hotspots) {
      const unavailable =
        pending === undefined
          ? this.#hotspots.every(
              (other) =>
                other.identifier === identifier || !this.#allows(descriptor, pairs, identifier, other.identifier),
            )
          : pending.identifier !== identifier && !this.#allows(descriptor, pairs, pending.identifier, identifier);
      control.disabled = this.disabled;
      control.setAttribute("aria-disabled", String(unavailable));
      if (this.disabled) control.setAttribute("aria-pressed", "false");
    }
    this.#drawLines(pairs);
    this.#drawList(pairs, messages);
  }

  /** Draws a line between the centers of the two hotspots of each association, in the units of the image. */
  #drawLines(pairs: readonly Pair[]): void {
    const size = stageOf(this.#layer ?? null)?.size;
    if (size === undefined) {
      stageOf(this.#layer ?? null)?.whenSized(() => this.refresh());
      return;
    }
    this.#links.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    const centers = new Map(
      this.#hotspots.flatMap(({ identifier, element }) => {
        const box = boxOf(element);
        return box === undefined ? [] : [[identifier, centerOf(box)] as const];
      }),
    );
    replaceAll(
      this.#links,
      pairs.flatMap(([first, second]) => {
        const [from, to] = [centers.get(first), centers.get(second)];
        if (from === undefined || to === undefined) return [];
        const line = {
          x1: String(from[0]),
          y1: String(from[1]),
          x2: String(to[0]),
          y2: String(to[1]),
          "vector-effect": "non-scaling-stroke",
        };
        return [svg("line", { ...line, class: "ak-halo" }), svg("line", line)];
      }),
    );
  }

  /** Lists the associations in words, each with the button that removes it. */
  #drawList(pairs: readonly Pair[], messages: Messages): void {
    const names = new Map(
      this.#hotspots.map(({ identifier, label }, index) => [identifier, label ?? choiceName("", index, messages)]),
    );
    const nameOf = (identifier: string): string => names.get(identifier) ?? identifier;
    replaceAll(
      this.#list,
      pairs.map(([first, second], index) => {
        const text = `${nameOf(first)}${JOIN}${nameOf(second)}`;
        const remove = html("button", {
          type: "button",
          class: "ak-remove",
          "data-index": String(index),
          "aria-label": `${messages.boardRemove}: ${text}`,
        });
        remove.disabled = this.disabled;
        return html("li", {}, html("span", {}, text), remove);
      }),
    );
    this.#list.toggleAttribute("hidden", pairs.length === 0);
  }

  protected override controls(): readonly Element[] {
    return this.#hotspots.map(({ control }) => control);
  }
}

/**
 * Renders a `qti-graphic-associate-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderGraphicAssociate(
  node: GraphicAssociateInteraction,
  renderer: BodyRenderer,
  messages: Messages,
): Element {
  const element = createInteraction(
    GraphicAssociateInteractionElement,
    "qti-graphic-associate-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
