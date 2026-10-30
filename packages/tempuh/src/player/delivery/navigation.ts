import type { CandidateView, ItemKey, NavigationEntry } from "@luthfanwakan/olah/delivery";
import type { Messages } from "../../messages/index.js";
import { html } from "../dom.js";

const STATUS_MESSAGES = {
  initial: "statusInitial",
  interacting: "statusInteracting",
  suspended: "statusSuspended",
  closed: "statusClosed",
  review: "statusReview",
  solution: "statusSolution",
} as const satisfies Readonly<Record<string, keyof Messages>>;

/** Builds the entry of a section of the map: a heading in the list, indented by its depth. */
function sectionEntry(entry: Extract<NavigationEntry, { readonly kind: "section" }>): HTMLElement {
  const item = html("li", { class: "tempuh-nav-section" }, html("span", {}, entry.title));
  item.style.setProperty("--tempuh-depth", String(entry.depth));
  return item;
}

/** Builds the entry of an item of the map: a button that moves to it when the item is reachable. */
function itemEntry(
  entry: Extract<NavigationEntry, { readonly kind: "item" }>,
  messages: Messages,
  move: (key: ItemKey) => void,
): HTMLElement {
  const button = html(
    "button",
    {
      type: "button",
      class: "tempuh-nav-item",
      "data-focus-id": `item ${entry.key.ref} ${entry.key.instance}`,
      ...(entry.current ? { "aria-current": "true" } : {}),
    },
    html("span", {}, entry.title),
    html("span", { class: "tempuh-nav-status" }, ` (${messages[STATUS_MESSAGES[entry.status]]})`),
  );
  button.disabled = !entry.reachable && !entry.current;
  button.addEventListener("click", () => {
    if (!entry.current) move(entry.key);
  });
  const item = html("li", {}, button);
  item.style.setProperty("--tempuh-depth", String(entry.depth));
  return item;
}

/**
 * Builds the navigation map of a view (T54): the visible sections and the item instances of the test part, in the order of
 * presentation, from the engine's map. A linear part lists the items presented so far, and only the reachable ones can
 * be chosen, so that the map moves forward only where the part does. It is a landmark named for the questions.
 *
 * @returns The `nav` element, or `undefined` when the test part has fewer than two items to choose among.
 */
export function renderNavigation(
  view: CandidateView,
  messages: Messages,
  move: (key: ItemKey) => void,
): HTMLElement | undefined {
  const items = view.navigation.filter((entry) => entry.kind === "item");
  if (items.length < 2) return undefined;
  const entries = view.navigation.map((entry) =>
    entry.kind === "section" ? sectionEntry(entry) : itemEntry(entry, messages, move),
  );
  return html("nav", { class: "tempuh-nav", "aria-label": messages.navigationLabel }, html("ol", {}, ...entries));
}
