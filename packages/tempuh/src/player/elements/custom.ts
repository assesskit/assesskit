import type { CustomInteraction } from "@luthfanwakan/olah/asi";
import { normalizeValue, type Value } from "@luthfanwakan/olah/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { createInteraction, InteractionElement } from "./element.js";
import type { CustomInteractionHook } from "./options.js";

/**
 * The element of `qti-custom-interaction` (INFO §5.36), which is deprecated in favor of the portable custom interaction.
 * The player cannot know what it should show, so the host draws it with a hook; without one, the element says that the
 * kind of question is not supported, and the candidate cannot answer it.
 */
export class CustomInteractionElement extends InteractionElement {
  override readonly kind = "custom-interaction";
  readonly #host = html("div", { class: "tempuh-custom" });
  #node: CustomInteraction | undefined;
  #hook: CustomInteractionHook | undefined;
  #stop: (() => void) | undefined;

  /** Fills the element with the place that the hook draws in, or with the notice that the player cannot. */
  build(node: CustomInteraction, hook: CustomInteractionHook | undefined, messages: Messages): void {
    this.#node = node;
    this.#hook = hook;
    if (hook === undefined) this.append(html("p", { role: "note" }, messages.customUnsupported));
    else this.append(this.#host);
  }

  protected override configure(): void {
    // The host sets the descriptor, the value and disabled one after the other, and the hook reads them when it mounts.
    queueMicrotask(() => this.#mount());
  }

  protected override sync(): void {
    // The hook draws the response, and gives it back with `set`.
  }

  /** Mounts the hook when the element enters the page and knows its descriptor. */
  connectedCallback(): void {
    this.#mount();
  }

  /** Takes the hook away when the element leaves the page. */
  disconnectedCallback(): void {
    this.#stop?.();
    this.#stop = undefined;
  }

  #mount(): void {
    const node = this.#node;
    if (this.#hook === undefined || node === undefined || this.#stop !== undefined) return;
    if (!this.isConnected || this.descriptor === undefined) return;
    const state = { value: this.value, disabled: this.disabled };
    this.#stop = this.#hook(node, this.#host, (value) => this.#set(value), state);
  }

  #set(value: Value | null): void {
    // A hook that answers while the candidate cannot respond has nothing to give.
    if (!this.disabled) this.respond(value === null ? null : normalizeValue(value));
  }
}

/** Renders a `qti-custom-interaction`. */
export function renderCustom(
  node: CustomInteraction,
  renderer: BodyRenderer,
  messages: Messages,
  hook: CustomInteractionHook | undefined,
): Element {
  const element = createInteraction(CustomInteractionElement, "qti-custom-interaction", node, renderer, messages);
  element.build(node, hook, messages);
  return element;
}
