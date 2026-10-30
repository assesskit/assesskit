import type { SliderInteraction } from "@luthfanwakan/olah/asi";
import type { InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import { single } from "@luthfanwakan/olah/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { createInteraction, InteractionElement } from "./element.js";
import { Notes } from "./notes.js";
import { nameByPrompt, renderPrompt } from "./parts.js";
import { primitivesOf } from "./values.js";

/**
 * The steps of a slider on an approximately continuous scale, which INFO §5.134.3 leaves to the engine: a float without
 * `step` moves in a hundredth of its range.
 */
const CONTINUOUS_STEPS = 100;

/** The most steps that get a label of their own: more would not fit in a line (INFO §5.134.4 allows the request to be declined). */
const MAX_STEP_LABELS = 50;

/** The steps a page key moves, as a share of the steps of the slider (WAI-ARIA Authoring Practices, Slider). */
const PAGE_STEPS = 10;

/** What a slider knows of its scale, once the descriptor is known. */
interface Scale {
  readonly lower: number;
  readonly upper: number;
  readonly step: number;
  readonly integer: boolean;
}

/** The number of digits after the point of a step, so that sums of steps are rounded to them. */
const decimalsOf = (step: number): number => (String(step).split(".")[1] ?? "").length;

/** Returns the share of the scale that a value is at, from 0 at the lower bound to 1 at the upper. */
const shareOf = (scale: Scale, value: number): number => (value - scale.lower) / (scale.upper - scale.lower);

/** Returns the nearest value on a step of the scale to a value. */
function snap(scale: Scale, value: number): number {
  const steps = Math.round((value - scale.lower) / scale.step);
  const snapped = scale.lower + steps * scale.step;
  const clamped = Math.min(scale.upper, Math.max(scale.lower, snapped));
  return scale.integer ? Math.round(clamped) : Number(clamped.toFixed(decimalsOf(scale.step)));
}

/**
 * The element of `qti-slider-interaction` (INFO §5.134): a thumb on a scale between two bounds. The slider has no
 * position until the candidate moves it or the variable has a default (INFO §5.134): until then the thumb is an empty
 * mark and the slider reads out that no value is chosen. A click or tap on the scale, the arrow, page, Home and End keys,
 * and a drag move the thumb; none needs a drag (WCAG 2.5.7).
 */
export class SliderInteractionElement extends InteractionElement {
  override readonly kind = "slider-interaction";
  readonly #thumb = html("div", { class: "tempuh-slider-thumb", role: "slider", tabindex: "0" });
  readonly #track = html("div", { class: "tempuh-slider-track" }, this.#thumb);
  readonly #widget = html("div", { class: "tempuh-slider" });
  #node: SliderInteraction | undefined;
  #scale: Scale | undefined;

  /** Fills the element with the prompt and the scale of the node. */
  build(node: SliderInteraction, renderer: BodyRenderer): void {
    this.#node = node;
    const prompt = renderPrompt(node.prompt, renderer);
    nameByPrompt(this.#thumb, prompt);
    this.#thumb.setAttribute("aria-orientation", node.orientation === "vertical" ? "vertical" : "horizontal");
    this.#widget.dataset.orientation = node.orientation === "vertical" ? "vertical" : "horizontal";
    this.notes = new Notes();
    this.append(...(prompt === undefined ? [] : [prompt.element]), this.#widget, this.notes.element);
    this.#thumb.addEventListener("keydown", (event) => this.#key(event));
    this.#track.addEventListener("pointerdown", (event) => this.#press(event));
    this.#track.addEventListener("pointermove", (event) => {
      if (this.#track.hasPointerCapture(event.pointerId)) this.#move(event);
    });
  }

  protected override configure(descriptor: InteractionDescriptor, _messages: Messages): void {
    const node = this.#node;
    if (node === undefined) return;
    const { lowerBound = node.lowerBound, upperBound = node.upperBound, step } = descriptor.constraints;
    const integer = descriptor.declaration?.baseType === "integer";
    const scale: Scale = {
      lower: lowerBound,
      upper: upperBound,
      step: step ?? (upperBound - lowerBound) / CONTINUOUS_STEPS,
      integer,
    };
    this.#scale = scale;
    this.#thumb.setAttribute("aria-valuemin", String(scale.lower));
    this.#thumb.setAttribute("aria-valuemax", String(scale.upper));
    const vertical = node.orientation === "vertical";
    const reversed = node.reverse === true;
    // The first end of the scale is at the left of a horizontal slider and at the top of a vertical one, which has its
    // upper bound there unless the item reverses it (INFO §5.134.5, §5.134.6).
    const startsAtLower = vertical === reversed;
    const [first, second] = startsAtLower ? [scale.lower, scale.upper] : [scale.upper, scale.lower];
    this.#widget.replaceChildren(
      html("span", { class: "tempuh-slider-end" }, String(first)),
      this.#track,
      html("span", { class: "tempuh-slider-end" }, String(second)),
    );
    this.#ticks(scale, node.stepLabel === true);
  }

  /** Draws a label at each step, when the item asks and the steps are few. */
  #ticks(scale: Scale, wanted: boolean): void {
    this.#track.querySelector(".tempuh-slider-ticks")?.remove();
    const count = Math.round((scale.upper - scale.lower) / scale.step);
    const labelled = wanted && count >= 1 && count <= MAX_STEP_LABELS;
    this.#widget.classList.toggle("tempuh-slider-stepped", labelled);
    if (!labelled) return;
    const labels = Array.from({ length: count + 1 }, (_, index) => {
      const value = snap(scale, scale.lower + index * scale.step);
      const tick = html("span", { class: "tempuh-slider-tick" }, String(value));
      tick.style.setProperty("--tempuh-slider-position", String(this.#position(shareOf(scale, value))));
      return tick;
    });
    this.#track.prepend(html("div", { class: "tempuh-slider-ticks", "aria-hidden": "true" }, ...labels));
  }

  /** Returns where a share of the scale is along the track, from its first end to its second. */
  #position(share: number): number {
    const node = this.#node;
    const vertical = node?.orientation === "vertical";
    return vertical === (node?.reverse === true) ? share : 1 - share;
  }

  protected override sync(): void {
    const scale = this.#scale;
    if (scale === undefined) return;
    const [value] = primitivesOf(this.value);
    const chosen = typeof value === "number" ? value : undefined;
    const messages = this.messages;
    this.#widget.toggleAttribute("data-tempuh-unset", chosen === undefined);
    this.#thumb.setAttribute("aria-valuenow", String(chosen ?? scale.lower));
    this.#thumb.setAttribute("aria-valuetext", chosen === undefined ? (messages?.sliderNotSet ?? "") : String(chosen));
    this.#thumb.setAttribute("aria-disabled", String(this.disabled));
    this.#widget.toggleAttribute("data-tempuh-disabled", this.disabled);
    this.#thumb.style.setProperty(
      "--tempuh-slider-position",
      String(this.#position(shareOf(scale, chosen ?? scale.lower))),
    );
  }

  protected override controls(): readonly Element[] {
    return [this.#thumb];
  }

  /** Gives the value, rounded to a step of the scale. */
  #choose(value: number): void {
    const scale = this.#scale;
    if (scale === undefined || this.disabled) return;
    const snapped = snap(scale, value);
    this.respond(single(scale.integer ? "integer" : "float", snapped));
  }

  #key(event: KeyboardEvent): void {
    const scale = this.#scale;
    if (scale === undefined) return;
    const [value] = primitivesOf(this.value);
    // Without a value the keys move from the lower bound (INFO §5.134).
    const current = typeof value === "number" ? value : scale.lower;
    const target = new Map<string, number>([
      ["ArrowRight", current + scale.step],
      ["ArrowUp", current + scale.step],
      ["ArrowLeft", current - scale.step],
      ["ArrowDown", current - scale.step],
      ["PageUp", current + PAGE_STEPS * scale.step],
      ["PageDown", current - PAGE_STEPS * scale.step],
      ["Home", scale.lower],
      ["End", scale.upper],
    ]).get(event.key);
    if (target === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.#choose(target);
  }

  #press(event: PointerEvent): void {
    if (event.button !== 0 || this.disabled) return;
    this.#track.setPointerCapture(event.pointerId);
    this.#thumb.focus();
    this.#move(event);
  }

  /** Moves the thumb to the pointer. */
  #move(event: PointerEvent): void {
    const scale = this.#scale;
    if (scale === undefined) return;
    const box = this.#track.getBoundingClientRect();
    const vertical = this.#node?.orientation === "vertical";
    const along = vertical ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width;
    const position = Math.min(1, Math.max(0, along));
    const share = vertical === (this.#node?.reverse === true) ? position : 1 - position;
    this.#choose(scale.lower + share * (scale.upper - scale.lower));
  }
}

/** Renders a `qti-slider-interaction`. */
export function renderSlider(node: SliderInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(SliderInteractionElement, "qti-slider-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
