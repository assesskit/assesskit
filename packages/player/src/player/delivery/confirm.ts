import type { Messages } from "../../messages/index.js";
import { deepActiveElement, html } from "../dom.js";

/**
 * Asks the candidate to confirm an action in a modal dialog (WCAG 3.3.4). The focus starts on the answer that goes back, so
 * that pressing Enter by habit cannot end anything; Escape goes back too. The dialog keeps the focus inside while it is
 * open, and the focus returns to the control that asked (WCAG 2.4.3).
 *
 * @param root - The shadow root that holds the dialog.
 * @param messages - The text of the interface.
 * @param sentences - What to tell the candidate, one paragraph each.
 * @returns A promise of whether the candidate confirmed.
 */
export function confirmAction(root: ShadowRoot, messages: Messages, sentences: readonly string[]): Promise<boolean> {
  const opener = deepActiveElement();
  const yes = html("button", { type: "button", class: "ak-button", value: "yes" }, messages.confirmYes);
  const no = html("button", { type: "button", class: "ak-button", value: "no", autofocus: "" }, messages.confirmNo);
  const dialog = html(
    "dialog",
    { class: "ak-confirm", "aria-label": messages.confirmTitle },
    ...sentences.map((sentence) => html("p", {}, sentence)),
    html("div", { class: "ak-row" }, yes, no),
  );
  root.append(dialog);
  return new Promise((resolve) => {
    let confirmed = false;
    yes.addEventListener("click", () => {
      confirmed = true;
      dialog.close();
    });
    no.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(confirmed);
    });
    dialog.showModal();
    no.focus();
  });
}
