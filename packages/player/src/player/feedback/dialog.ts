import type { ModalFeedback } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html, uniqueId } from "../internal.js";
import { renderFeedback } from "./render.js";

/**
 * Shows modal feedback in a `<dialog>` in a shadow root, after processing.
 *
 * @remarks
 * A modal dialog is in the top layer, makes the rest of the root inert and keeps the focus inside it. Escape and the Close
 * button close it, and the focus returns to where it was. The focus starts on the heading, so that a screen reader reads
 * the dialog from its name and the candidate tabs on into the content.
 *
 * @param root - The shadow root of the content root, which holds the dialog.
 * @param feedback - The feedback to show, in order.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns A promise that resolves when the candidate has closed the dialog.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, modal feedback}
 */
export function showFeedbackDialog(
  root: ShadowRoot,
  feedback: readonly ModalFeedback[],
  renderer: BodyRenderer,
  messages: Messages,
): Promise<void> {
  const heading = html("h2", { id: uniqueId("ak-feedback"), tabindex: "-1", autofocus: "" }, messages.feedbackTitle);
  const dialog = html(
    "dialog",
    { class: "ak-dialog", "aria-labelledby": heading.id },
    heading,
    ...feedback.map((entry) => renderFeedback(entry, "h3", renderer)),
    html("form", { method: "dialog" }, html("button", { type: "submit" }, messages.toolClose)),
  );
  root.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        resolve();
      },
      { once: true },
    );
    dialog.showModal();
  });
}
