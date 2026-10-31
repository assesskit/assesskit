import { html } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";

/** The elements that answer masking covers: the choices of a choice interaction (BPIG §5.2.9.4). */
const INTERACTION = "qti-choice-interaction";
const CHOICE = "qti-simple-choice";

/** The attribute that hides the choices of an interaction, through the stylesheet of the tools. */
const MASKED = "data-ak-masked";

/** The mask of one interaction. */
interface Mask {
  readonly element: HTMLElement;
  readonly notice: HTMLElement;
  readonly button: HTMLButtonElement;
  masked: boolean;
}

/**
 * Turns answer masking on (BPIG §5.2.9.4): the choices of every choice interaction in the stage are hidden, visually and
 * to assistive technology, and a mask in their place says so and has a button that shows them. The mask covers an
 * interaction that the renderer adds later, too. It stays as a button that hides the choices again, so that the focus
 * stays where it was when the candidate shows them.
 */
export function openAnswerMasking({ messages, stage }: ToolContext): OpenTool {
  const masks = new Map<Element, Mask>();

  const render = (interaction: Element, mask: Mask): void => {
    interaction.toggleAttribute(MASKED, mask.masked);
    mask.notice.hidden = !mask.masked;
    mask.button.textContent = mask.masked ? messages.answerMaskingShow : messages.answerMaskingHide;
  };
  const maskFor = (interaction: Element): Mask => {
    const existing = masks.get(interaction);
    if (existing !== undefined) return existing;
    const notice = html("span", { class: "ak-mask-notice" }, messages.answerMaskingNotice);
    const button = html("button", { type: "button", class: "ak-button" });
    const mask: Mask = { element: html("div", { class: "ak-mask" }, notice, button), notice, button, masked: true };
    button.addEventListener("click", () => {
      mask.masked = !mask.masked;
      render(interaction, mask);
    });
    masks.set(interaction, mask);
    render(interaction, mask);
    return mask;
  };
  // Puts a mask in front of the choices of each interaction, and drops the masks of interactions that have gone.
  const sync = (): void => {
    for (const interaction of stage.querySelectorAll(INTERACTION)) {
      const choice = interaction.querySelector(CHOICE);
      if (choice === null) continue;
      const { element } = maskFor(interaction);
      if (choice.previousElementSibling !== element) choice.before(element);
    }
    for (const interaction of masks.keys()) if (!interaction.isConnected) masks.delete(interaction);
  };

  const changes = new MutationObserver(sync);
  changes.observe(stage, { childList: true, subtree: true });
  sync();

  return {
    focus: () => undefined,
    destroy: () => {
      changes.disconnect();
      for (const [interaction, { element }] of masks) {
        interaction.removeAttribute(MASKED);
        element.remove();
      }
    },
  };
}
