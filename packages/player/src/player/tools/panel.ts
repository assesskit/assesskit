import { html } from "../dom.js";
import type { ToolContext } from "./context.js";

/** The panel of an open tool, in the tray. */
export interface Panel {
  /** The panel. */
  readonly element: HTMLElement;
  /** The part under the heading, which the tool fills. */
  readonly body: HTMLElement;
  /** Moves the focus to the heading. */
  focus(): void;
  /** Takes the panel out of the tray. */
  remove(): void;
}

/**
 * Appends a panel to the tray: a group named after the tool, with a heading and a button that closes it.
 *
 * @param title - The name of the tool.
 * @param close - Called when the candidate presses the button.
 */
export function createPanel({ messages, tray }: ToolContext, title: string, close: () => void): Panel {
  const heading = html("h3", { tabindex: "-1" }, title);
  // The name starts with the visible text, so that it contains the label of the button (WCAG 2.5.3).
  const closeButton = html(
    "button",
    { type: "button", class: "ak-button", "aria-label": `${messages.toolClose} ${title}` },
    messages.toolClose,
  );
  closeButton.addEventListener("click", close);
  const body = html("div");
  const element = html(
    "div",
    { class: "ak-panel", role: "group", "aria-label": title },
    html("div", { class: "ak-panel-header" }, heading, closeButton),
    body,
  );
  tray.append(element);
  return { element, body, focus: () => heading.focus(), remove: () => element.remove() };
}
