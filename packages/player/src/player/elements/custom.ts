import type { CustomInteraction } from "@assesskit/runtime/asi";
import { normalizeValue, type Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import { createInteraction, InteractionElement } from "./element.js";
import type { CustomInteractionHook } from "./options.js";

/**
 * The element of `qti-custom-interaction`, which is deprecated in favor of the portable custom interaction.
 *
 * @remarks
 * The player cannot know what it should show, so the host draws it with a hook; without one, the element says that the
 * kind of question is not supported, and the candidate cannot answer it.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, custom interaction}
 */
export class CustomInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "custom-interaction";
  readonly #host = html("div", { class: "ak-custom" });
  #node: CustomInteraction | undefined;
  #hook: CustomInteractionHook | undefined;
  #stop: (() => void) | undefined;

  /**
   * Fills the element with the place that the hook draws in, or with the notice that the player cannot.
   *
   * @param node - The interaction.
   * @param hook - The host's hook, or `undefined` when it gave none.
   * @param messages - The interface messages.
   */
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

/**
 * Renders a `qti-custom-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @param hook - The host's hook, or `undefined` when it gave none.
 * @returns The element.
 */
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
