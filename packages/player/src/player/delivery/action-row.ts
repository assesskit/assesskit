import type { Messages } from "../../messages/index.js";
import { html, replaceAll } from "../internal.js";
import type { PlannedAction } from "./actions.js";

/**
 * Draws the buttons of the actions the engine lists, in a row for each group.
 *
 * @param region - The element that holds the rows.
 * @param planned - The actions to draw.
 * @param messages - The text of the interface.
 * @param act - Called with the action of the button that the candidate presses.
 */
export function renderActionRow(
  region: HTMLElement,
  planned: readonly PlannedAction[],
  messages: Messages,
  act: (planned: PlannedAction) => void,
): void {
  const groups = (["navigate", "answer", "session"] as const).map((group) =>
    html(
      "div",
      { class: "ak-row" },
      ...planned
        .filter((each) => each.group === group)
        .map((each) => {
          const button = html(
            "button",
            { type: "button", class: "ak-button", "data-focus-id": each.id },
            messages[each.label],
          );
          button.disabled = each.disabled === true;
          if (each.pressed !== undefined) button.setAttribute("aria-pressed", String(each.pressed));
          button.addEventListener("click", () => act(each));
          return button;
        }),
    ),
  );
  replaceAll(
    region,
    groups.filter((group) => group.childElementCount > 0),
  );
}
