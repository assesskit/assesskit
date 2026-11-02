import type { Messages } from "../../messages/index.js";
import { deepActiveElement, html } from "../internal.js";

/**
 * Asks the candidate to confirm an action in a modal dialog.
 *
 * @remarks
 * The focus starts on the answer that goes back, so that pressing Enter by habit cannot end anything; Escape goes back
 * too. The dialog keeps the focus inside while it is open, and the focus returns to the control that asked. When the signal
 * aborts, as it does when the player is destroyed, the dialog closes and nothing is confirmed.
 *
 * @param root - The shadow root that holds the dialog.
 * @param messages - The text of the interface.
 * @param sentences - What to tell the candidate, one paragraph each.
 * @param signal - Aborts when the player is destroyed.
 * @returns A promise of whether the candidate confirmed.
 * @see {@link https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data | WCAG 2.2, error prevention}
 * @see {@link https://www.w3.org/TR/WCAG22/#focus-order | WCAG 2.2, focus order}
 */
export function confirmAction(
  root: ShadowRoot,
  messages: Messages,
  sentences: readonly string[],
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
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
    const close = (): void => dialog.close();
    dialog.addEventListener("close", () => {
      signal.removeEventListener("abort", close);
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(confirmed);
    });
    signal.addEventListener("abort", close);
    dialog.showModal();
    no.focus();
  });
}
