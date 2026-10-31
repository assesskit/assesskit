import type { SelectPointInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Point } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import { createInteraction, InteractionElement } from "./element.js";
import { enablePicker } from "./graphic/picker.js";
import { createStage } from "./graphic/stage.js";
import { Notes } from "./notes.js";
import { nameByPrompt, type RenderedPrompt, renderPrompt } from "./parts.js";
import { pointsOf, responseOf } from "./values.js";

/**
 * The element of `qti-select-point-interaction`: the candidate marks points on an image.
 *
 * @remarks
 * The areas that the response may be scored against are never drawn: only the points the candidate marked show. A click
 * on the image marks a point; with the keyboard a crosshair moves over the image and Enter marks it. A marked point is
 * a button that takes the point away. With a maximum of one point, marking another moves it.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, select point interaction}
 */
export class SelectPointInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "select-point-interaction";
  #prompt: RenderedPrompt | undefined;
  #surface: HTMLElement | undefined;
  readonly #usage = html("p", { class: "ak-usage" });

  constructor() {
    super();
    enablePicker(this, {
      active: () => this.descriptor !== undefined && !this.disabled,
      pick: (point) => this.#mark(point),
    });
    this.addEventListener("click", (event) => {
      const marker = event.target instanceof Element ? event.target.closest(".ak-marker") : null;
      if (marker instanceof HTMLElement) this.#unmark(Number(marker.dataset.index));
    });
  }

  /**
   * Fills the element with the prompt, the image with its surface and crosshair, the instructions and the notes.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: SelectPointInteraction, renderer: BodyRenderer): void {
    this.#prompt = renderPrompt(node.prompt, renderer);
    const { element: stageElement, stage } = createStage(node.image, renderer);
    this.#surface = html("div", { class: "ak-surface", role: "application" });
    stage.layer.append(this.#surface, html("div", { class: "ak-crosshair", hidden: "", "aria-hidden": "true" }));
    this.notes = new Notes();
    this.replaceChildren(
      ...(this.#prompt === undefined ? [] : [this.#prompt.element]),
      stageElement,
      this.#usage,
      this.notes.element,
    );
    this.setAttribute("role", "group");
    nameByPrompt(this, this.#prompt);
  }

  #change(points: readonly Point[], notice: "graphicPointMarked" | "graphicRemoved"): void {
    const { descriptor, messages } = this;
    if (descriptor === undefined || messages === undefined) return;
    this.respond(responseOf(descriptor, "point", points));
    this.notes?.announce(messages[notice]);
  }

  #mark(point: Point): void {
    const points = pointsOf(this.value);
    // With a maximum of one point the new point moves the old; with more, a point beyond the maximum gets the hint.
    this.#change(this.descriptor?.constraints.maxChoices === 1 ? [point] : [...points, point], "graphicPointMarked");
  }

  #unmark(index: number): void {
    this.#change(
      pointsOf(this.value).filter((_, i) => i !== index),
      "graphicRemoved",
    );
    this.#surface?.focus();
  }

  protected override configure(_descriptor: InteractionDescriptor, messages: Messages): void {
    this.#surface?.setAttribute("aria-label", messages.graphicPicker);
    this.#usage.textContent = messages.graphicPickerHint;
  }

  protected override sync(_descriptor: InteractionDescriptor, messages: Messages): void {
    const surface = this.#surface;
    const layer = surface?.parentElement;
    if (surface === undefined || layer === null || layer === undefined) return;
    for (const marker of layer.querySelectorAll(".ak-marker")) marker.remove();
    surface.tabIndex = this.disabled ? -1 : 0;
    surface.setAttribute("aria-disabled", String(this.disabled));
    pointsOf(this.value).forEach(([x, y], index) => {
      const name = `${messages.boardRemove} ${messages.graphicPoint} ${index + 1}: ${x}, ${y}`;
      const marker = html(
        "button",
        { type: "button", class: "ak-marker", "data-index": String(index), "aria-label": name },
        String(index + 1),
      );
      marker.disabled = this.disabled;
      marker.style.setProperty("--ak-x", String(x));
      marker.style.setProperty("--ak-y", String(y));
      layer.append(marker);
    });
  }

  protected override controls(): readonly Element[] {
    return this.#surface === undefined ? [] : [this.#surface];
  }
}

/**
 * Renders a `qti-select-point-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderSelectPoint(node: SelectPointInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(
    SelectPointInteractionElement,
    "qti-select-point-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node, renderer);
  return element;
}
