import { html } from "../internal.js";
import type { OpenTool, ToolContext } from "./context.js";

/** The choices that the eliminator crosses out. */
const INTERACTION = "qti-choice-interaction";
const CHOICE = "qti-simple-choice";

/** The attribute that crosses out a choice, through the stylesheet of the tools. */
const STRUCK = "data-ak-struck";

/** The class of the button that the eliminator puts in a choice. */
const BUTTON = "ak-eliminate";

/** Returns the name of a choice, which the button takes: its text, else the name its control has. */
function nameOf(choice: Element): string {
  const text = (choice.querySelector(".ak-face") ?? choice).textContent?.replace(/\s+/gu, " ").trim() ?? "";
  return text === ""
    ? (choice.querySelector("input")?.getAttribute("aria-label") ?? choice.getAttribute("identifier") ?? "")
    : text;
}

/**
 * Turns the answer eliminator on: each choice of a choice interaction gets a toggle button that crosses it out.
 *
 * @remarks
 * A crossed-out choice stays selectable, and the cross-out never reaches a response. The choices that are crossed out stay
 * in the memory of the mount by item, so that they come back with the item; the mount draws them again when the content is
 * drawn again.
 *
 * @param context - What the tool needs from the mount.
 * @returns The open tool.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, custom supports}
 */
export function openEliminator({ messages, stage, content, memory }: ToolContext): OpenTool {
  const keyOf = (choice: Element): string =>
    JSON.stringify([
      choice.closest(INTERACTION)?.getAttribute("response-identifier"),
      choice.getAttribute("identifier"),
    ]);

  const buttonOf = (choice: Element): HTMLButtonElement | null =>
    choice.querySelector<HTMLButtonElement>(`:scope > .${BUTTON}`);

  /** Crosses a choice out or takes the cross-out away, in the page and in the memory. */
  const set = (choice: Element, struck: boolean, remember: boolean): void => {
    choice.toggleAttribute(STRUCK, struck);
    buttonOf(choice)?.setAttribute("aria-pressed", String(struck));
    if (!remember) return;
    const { item } = content();
    const keys = memory.choices.get(item) ?? new Set<string>();
    if (struck) keys.add(keyOf(choice));
    else keys.delete(keyOf(choice));
    memory.choices.set(item, keys);
  };

  /** Gives each choice that has none a button. */
  const sync = (): void => {
    for (const choice of stage.querySelectorAll(`${INTERACTION} > ${CHOICE}`)) {
      if (buttonOf(choice) !== null) continue;
      const button = html(
        "button",
        {
          type: "button",
          class: BUTTON,
          "aria-pressed": "false",
          "aria-label": `${messages.toolCrossOut} ${nameOf(choice)}`,
        },
        messages.toolCrossOut,
      );
      button.addEventListener("click", () => set(choice, !choice.hasAttribute(STRUCK), true));
      choice.append(button);
    }
  };

  /** Crosses out the choices that the memory has for the item shown. */
  const restore = (): void => {
    const keys = memory.choices.get(content().item);
    for (const choice of stage.querySelectorAll(`${INTERACTION} > ${CHOICE}`)) {
      set(choice, keys?.has(keyOf(choice)) ?? false, false);
    }
  };

  const changes = new MutationObserver(sync);
  changes.observe(stage, { childList: true, subtree: true });
  sync();
  restore();

  return {
    focus: () => undefined,
    refresh: () => {
      sync();
      restore();
    },
    destroy: () => {
      changes.disconnect();
      for (const choice of stage.querySelectorAll(`${INTERACTION} > ${CHOICE}`)) {
        choice.removeAttribute(STRUCK);
        buttonOf(choice)?.remove();
      }
    },
  };
}
