import type { PositionObjectInteraction } from "@luthfanwakan/olah/asi";
import type { InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import type { Point } from "@luthfanwakan/olah/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { createInteraction, InteractionElement } from "./element.js";
import { enableDragging } from "./graphic/drag.js";
import { enablePicker } from "./graphic/picker.js";
import { imageSize, type Stage, stageOf, watchStage } from "./graphic/stage.js";
import { Notes } from "./notes.js";
import { nameOf } from "./parts.js";
import { pointsOf, responseOf } from "./values.js";

/** The attribute of the element while the candidate holds the object to place it, which `player.css` also reads. */
const PLACING = "data-tempuh-placing";

/**
 * The element of `qti-position-object-interaction` (INFO §5.107): the candidate positions an image on the stage, and the
 * response is where the center point of the image lies. The areas that score the response are never drawn.
 *
 * - **Pointer:** drag the object from the tray onto the image with a mouse or a pen, or choose the object and click or tap
 *   the image. A placed object drags to a new place, and choosing it takes it away.
 * - **Keyboard:** choose the object, which moves the focus to the image with a crosshair; the arrow keys move it, and Enter
 *   or Space places the object there. Escape gives the object up.
 */
export class PositionObjectInteractionElement extends InteractionElement {
  override readonly kind = "position-object-interaction";
  /** The point of the object that lies on the response point, from the top left of the object (INFO §5.107.1). */
  #center: readonly number[] = [];
  #hand: HTMLButtonElement | undefined;
  #layer: HTMLElement | undefined;
  readonly #usage = html("p", { class: "tempuh-usage" });

  constructor() {
    super();
    enablePicker(this, { active: () => this.hasAttribute(PLACING), pick: (point) => this.#place(point) });
    enableDragging(this, {
      source: (target) => {
        const source = target.closest<HTMLElement>(".tempuh-draggable");
        return source !== null && this.contains(source) && !(source instanceof HTMLButtonElement && source.disabled)
          ? source
          : undefined;
      },
      drop: (source, clientX, clientY) => this.#drop(source, clientX, clientY),
    });
    this.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const object = target?.closest<HTMLElement>(".tempuh-object");
      if (object instanceof HTMLElement) this.#remove(Number(object.dataset.index));
      else if (target?.closest(".tempuh-pick")) this.#hold(!this.hasAttribute(PLACING));
    });
    this.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.hasAttribute(PLACING)) this.#hold(false);
    });
    // The picture of the object has a size once it has loaded, and the objects are placed by it.
    this.addEventListener("load", () => this.refresh(), true);
  }

  /** Fills the element with the layer that lies over the image of the stage, the tray with the object, and the notes. */
  build(node: PositionObjectInteraction, renderer: BodyRenderer): void {
    this.#center = node.centerPoint ?? [];
    this.#layer = html(
      "div",
      { class: "tempuh-layer" },
      html("div", { class: "tempuh-surface", role: "application" }),
      html("div", { class: "tempuh-crosshair", hidden: "", "aria-hidden": "true" }),
    );
    this.#hand = html(
      "button",
      { type: "button", class: "tempuh-pick tempuh-draggable" },
      ...renderer.nodes([node.image]),
      html("span", { class: "tempuh-pick-label" }),
    );
    this.notes = new Notes();
    this.replaceChildren(
      this.#layer,
      html("div", { class: "tempuh-tray" }, this.#hand, this.#usage, this.notes.element),
    );
  }

  /** Takes the object in hand, which moves the focus to the crosshair, or puts it down. */
  #hold(holding: boolean): void {
    this.toggleAttribute(PLACING, holding && !this.disabled && this.descriptor !== undefined);
    this.refresh();
    if (this.hasAttribute(PLACING)) this.#layer?.querySelector<HTMLElement>(".tempuh-surface")?.focus();
    else this.#hand?.focus();
  }

  #change(points: readonly Point[], notice: "graphicPlaced" | "graphicRemoved"): void {
    const { descriptor, messages } = this;
    if (descriptor === undefined || messages === undefined) return;
    this.respond(responseOf(descriptor, "point", points));
    this.notes?.announce(messages[notice]);
  }

  #place(point: Point): void {
    const points = pointsOf(this.value);
    // With a maximum of one point the new point moves the old; with more, a point beyond the maximum gets the hint.
    this.#change(this.descriptor?.constraints.maxChoices === 1 ? [point] : [...points, point], "graphicPlaced");
    this.#hold(false);
  }

  #remove(index: number): void {
    this.#change(
      pointsOf(this.value).filter((_, i) => i !== index),
      "graphicRemoved",
    );
    this.#hand?.focus();
  }

  #drop(source: HTMLElement, clientX: number, clientY: number): void {
    const point = stageOf(this.#layer ?? null)?.pointAt(clientX, clientY);
    if (point === undefined) return;
    if (source.classList.contains("tempuh-pick")) this.#place(point);
    else {
      const index = Number(source.dataset.index);
      this.#change(
        pointsOf(this.value).map((old, i) => (i === index ? point : old)),
        "graphicPlaced",
      );
    }
  }

  /** Returns the name of the object: the text alternative of its picture. */
  #nameOf(messages: Messages): string {
    const alternative = nameOf(this.#hand === undefined ? [] : [...this.#hand.querySelectorAll("img")]);
    return alternative === "" ? messages.graphicObject : alternative;
  }

  /** Shows whether the object is in hand, and what the tray and the object are called. */
  #drawHand(hand: HTMLButtonElement, messages: Messages): void {
    hand.disabled = this.disabled;
    hand.setAttribute("aria-pressed", String(this.hasAttribute(PLACING)));
    hand.setAttribute("aria-label", `${messages.graphicPlace} ${this.#nameOf(messages)}`);
    const surface = this.#layer?.querySelector<HTMLElement>(".tempuh-surface");
    if (surface !== null && surface !== undefined) surface.tabIndex = this.hasAttribute(PLACING) ? 0 : -1;
  }

  /** Draws the placed objects: one button for each point, at the point, so that its center point lies on it. */
  #drawObjects(layer: HTMLElement, stage: Stage, points: readonly Point[], messages: Messages): void {
    const template = this.#hand?.querySelector("img") ?? null;
    const size = imageSize(template);
    const objects = [...layer.querySelectorAll<HTMLButtonElement>(".tempuh-object")];
    for (const object of objects.slice(points.length)) {
      stage.untrack(object);
      object.remove();
    }
    if (size === undefined || template === null) return;
    const [centerX = size.width / 2, centerY = size.height / 2] = this.#center;
    points.forEach(([x, y], index) => {
      let object = objects[index];
      if (object === undefined) {
        const picture = template.cloneNode(true);
        if (picture instanceof HTMLImageElement) picture.alt = "";
        object = html("button", { type: "button", class: "tempuh-object tempuh-draggable" }, picture);
        stage.track(object, size);
        layer.append(object);
      }
      object.dataset.index = String(index);
      object.disabled = this.disabled;
      object.setAttribute("aria-label", `${messages.boardRemove} ${this.#nameOf(messages)} ${index + 1}: ${x}, ${y}`);
      object.style.setProperty("--tempuh-x", String(x - centerX));
      object.style.setProperty("--tempuh-y", String(y - centerY));
      object.style.setProperty("--tempuh-w", String(size.width));
      object.style.setProperty("--tempuh-h", String(size.height));
    });
  }

  protected override configure(_descriptor: InteractionDescriptor, messages: Messages): void {
    const label = this.#hand?.querySelector(".tempuh-pick-label");
    if (label !== null && label !== undefined) label.textContent = messages.graphicPlace;
    this.#layer?.querySelector(".tempuh-surface")?.setAttribute("aria-label", messages.graphicPicker);
    this.#usage.textContent = messages.graphicPlaceHint;
  }

  protected override sync(_descriptor: InteractionDescriptor, messages: Messages): void {
    const layer = this.#layer;
    const stageElement = this.closest("qti-position-object-stage");
    const hand = this.#hand;
    if (layer === undefined || !(stageElement instanceof HTMLElement) || hand === undefined) return;
    // The stage belongs to the content around the interaction, so it is found once the element stands in it.
    const stage = stageOf(layer) ?? watchStage(stageElement, layer);
    if (this.disabled) this.removeAttribute(PLACING);
    this.#drawHand(hand, messages);
    this.#drawObjects(layer, stage, pointsOf(this.value), messages);
  }

  protected override controls(): readonly Element[] {
    const surface = this.#layer?.querySelector(".tempuh-surface");
    return surface === null || surface === undefined ? [] : [surface];
  }
}

/** Renders a `qti-position-object-interaction` for the stage that the renderer draws around it. */
export function renderPositionObject(
  node: PositionObjectInteraction,
  renderer: BodyRenderer,
  messages: Messages,
): Element {
  const element = createInteraction(
    PositionObjectInteractionElement,
    "qti-position-object-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
