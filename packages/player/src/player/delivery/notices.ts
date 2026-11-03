import type { CandidateView } from "@assesskit/runtime/delivery";
import type { Messages } from "../../messages/index.js";
import { html, replaceAll } from "../internal.js";

/**
 * Shows what the view tells the candidate besides the item: that the test is suspended or ended, that an item is awaited, and
 * that the item is timed.
 *
 * @param region - The element that holds the notices.
 * @param view - The view.
 * @param messages - The text of the interface.
 */
export function renderNotices(region: HTMLElement, view: CandidateView, messages: Messages): void {
  const texts = [
    ...(view.status === "suspended" ? [messages.testSuspended] : []),
    ...(view.status === "ended" ? [messages.testEnded] : []),
    ...(view.status === "in-progress" && view.current === undefined ? [messages.awaitingItem] : []),
    ...(view.current?.timeDependent === true ? [messages.timeDependentNotice] : []),
  ];
  replaceAll(
    region,
    texts.map((text) => html("p", { class: "ak-notice", role: "note" }, text)),
  );
}

/**
 * Shows the attempts used and left of the item presented, when the item limits them or the candidate has made more than one.
 *
 * @param region - The element that holds the text.
 * @param view - The view.
 * @param messages - The text of the interface.
 */
export function renderAttempts(region: HTMLElement, view: CandidateView, messages: Messages): void {
  const item = view.current;
  const limited = item?.attemptsLeft !== undefined;
  region.hidden = item === undefined || !(limited || item.numAttempts > 1);
  region.textContent =
    item === undefined
      ? ""
      : `${messages.attemptsUsed}: ${item.numAttempts}${limited ? `. ${messages.attemptsLeft}: ${item.attemptsLeft}` : ""}`;
}
