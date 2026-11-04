import type { CandidateView } from "@assesskit/runtime/delivery/wire";
import type { Messages } from "../../messages/index.js";
import { html, uniqueId } from "../internal.js";

/**
 * The comment box of the item presented.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, candidate comment}
 */
export interface CommentBox {
  /** The form, hidden while the view does not allow a comment. */
  readonly element: HTMLFormElement;
  /**
   * Shows or hides the box for a view; it keeps what the candidate typed while the item stays the same.
   *
   * @param view - The view.
   */
  update(view: CandidateView): void;
}

/**
 * Creates the comment box: a labelled field and a button that sends the text.
 *
 * @remarks
 * It is built once and only shown or hidden, so that a new view does not take away what the candidate is typing. A new
 * comment replaces the one before.
 *
 * @param messages - The text of the interface.
 * @param save - Called with the text when the candidate presses the button.
 * @returns The comment box.
 */
export function createCommentBox(messages: Messages, save: (text: string) => void): CommentBox {
  const field = html("textarea", { id: uniqueId("ak-comment"), rows: "4" });
  const label = html("label", { for: field.id }, messages.commentLabel);
  const button = html(
    "button",
    { type: "submit", class: "ak-button", "data-focus-id": "comment" },
    messages.actionComment,
  );
  const element = html("form", { class: "ak-comment" }, label, field, button);
  element.hidden = true;
  element.addEventListener("submit", (event) => {
    event.preventDefault();
    save(field.value);
  });
  let shownFor = "";
  return {
    element,
    update: (view) => {
      const { current } = view;
      const key = current === undefined ? "" : `${current.key.ref} ${current.key.instance}`;
      if (key !== shownFor) field.value = "";
      shownFor = key;
      element.hidden = current === undefined || !view.actions.includes("comment");
    },
  };
}
