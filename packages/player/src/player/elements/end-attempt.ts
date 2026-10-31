import type { EndAttemptInteraction } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import { createInteraction, InteractionElement } from "./element.js";

/** The name of the event that an end attempt element dispatches when the candidate presses its button. */
export const END_ATTEMPT_EVENT = "ak-end-attempt";

/** What an {@link EndAttemptEvent} says: the response variable of the interaction that the candidate pressed. */
export interface EndAttemptDetail {
  /** The response variable of the end attempt interaction. */
  readonly responseIdentifier: string;
}

/** The event that an end attempt element dispatches, and that bubbles to the content root, when the candidate ends the attempt. */
export type EndAttemptEvent = CustomEvent<EndAttemptDetail>;

declare global {
  interface HTMLElementEventMap {
    [END_ATTEMPT_EVENT]: EndAttemptEvent;
  }
  interface ShadowRootEventMap {
    [END_ATTEMPT_EVENT]: EndAttemptEvent;
  }
}

/**
 * The element of `qti-end-attempt-interaction`: a button, titled as the item says, with which the candidate ends the
 * attempt, typically to ask for a hint.
 *
 * @remarks
 * The element gives no response: the engine sets the variable to `true` when the attempt ends this way, and to `false`
 * otherwise, so the element tells the host with an {@link EndAttemptEvent}.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, end attempt interaction}
 */
export class EndAttemptInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "end-attempt-interaction";
  readonly #button = html("button", { type: "button" });

  /**
   * Fills the element with the button of the node.
   *
   * @param node - The interaction.
   */
  build(node: EndAttemptInteraction): void {
    this.#button.textContent = node.title;
    this.append(this.#button);
    this.#button.addEventListener("click", () => {
      const detail: EndAttemptDetail = { responseIdentifier: this.responseIdentifier };
      this.dispatchEvent(new CustomEvent(END_ATTEMPT_EVENT, { detail, bubbles: true }));
    });
  }

  protected override configure(): void {
    // The button has no controls to build.
  }

  protected override sync(): void {
    this.#button.disabled = this.disabled;
  }
}

/**
 * Renders a `qti-end-attempt-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderEndAttempt(node: EndAttemptInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(
    EndAttemptInteractionElement,
    "qti-end-attempt-interaction",
    node,
    renderer,
    messages,
  );
  element.build(node);
  return element;
}
