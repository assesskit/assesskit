import type { ItemKey } from "@assesskit/runtime/delivery";
import type { CandidateView, NavigationEntry } from "@assesskit/runtime/delivery/wire";
import type { Messages } from "../../messages/index.js";
import { appendAll, html } from "../internal.js";

/** The message that names each status of an item session. */
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
  const item = html("li", { class: "ak-nav-section" }, html("span", {}, entry.title));
  item.style.setProperty("--ak-depth", String(entry.depth));
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
      class: "ak-nav-item",
      "data-focus-id": `item ${entry.key.ref} ${entry.key.instance}`,
      ...(entry.current ? { "aria-current": "true" } : {}),
    },
    html("span", {}, entry.title),
    html(
      "span",
      { class: "ak-nav-status" },
      ` (${messages[STATUS_MESSAGES[entry.status]]}${entry.marked ? `, ${messages.statusMarked}` : ""})`,
    ),
  );
  button.disabled = !entry.reachable && !entry.current;
  button.addEventListener("click", () => {
    if (!entry.current) move(entry.key);
  });
  const item = html("li", {}, button);
  item.style.setProperty("--ak-depth", String(entry.depth));
  return item;
}

/**
 * Builds the navigation map of a view: the visible sections and the item instances of the test part, in the order of
 * presentation, from the engine's map.
 *
 * @remarks
 * A linear part lists the items presented so far, and only the reachable ones can be chosen, so that the map moves
 * forward only where the part does. After the end of a test that allows review, it lists the items presented in every
 * part. It is a landmark named for the questions.
 *
 * @param view - The view.
 * @param messages - The interface messages.
 * @param move - Called with the item that the candidate chooses.
 * @returns The `nav` element, or `undefined` when the test part has fewer than two items to choose among.
 */
export function renderNavigation(
  view: CandidateView,
  messages: Messages,
  move: (key: ItemKey) => void,
): HTMLElement | undefined {
  const items = view.navigation.filter((entry) => entry.kind === "item");
  if (items.length < 2) return undefined;
  const list = html("ol", {});
  // The test decides how many entries there are, so they are appended in steps rather than spread into a call.
  appendAll(
    list,
    view.navigation.map((entry) => (entry.kind === "section" ? sectionEntry(entry) : itemEntry(entry, messages, move))),
  );
  return html("nav", { class: "ak-nav", "aria-label": messages.navigationLabel }, list);
}
