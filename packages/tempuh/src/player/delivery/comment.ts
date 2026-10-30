import type { CandidateView } from "@luthfanwakan/olah/delivery";
import type { Messages } from "../../messages/index.js";
import { html, uniqueId } from "../dom.js";

/** The comment box of the item presented (T59, INFO §7.19.5). */
export interface CommentBox {
  /** The form, hidden while the view does not allow a comment. */
  readonly element: HTMLFormElement;
  /** Shows or hides the box for a view; it keeps what the candidate typed while the item stays the same. */
  update(view: CandidateView): void;
}

/**
 * Creates the comment box: a labelled field and a button that sends the text. It is built once and only shown or hidden,
 * so that a new view does not take away what the candidate is typing. A new comment replaces the one before.
 *
 * @param messages - The text of the interface.
 * @param save - Called with the text when the candidate presses the button.
 */
export function createCommentBox(messages: Messages, save: (text: string) => void): CommentBox {
  const field = html("textarea", { id: uniqueId("tempuh-comment"), rows: "4" });
  const label = html("label", { for: field.id }, messages.commentLabel);
  const button = html(
    "button",
    { type: "submit", class: "tempuh-button", "data-focus-id": "comment" },
    messages.actionComment,
  );
  const element = html("form", { class: "tempuh-comment" }, label, field, button);
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
