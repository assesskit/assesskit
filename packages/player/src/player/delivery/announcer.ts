import { html } from "../internal.js";

/** How long an announcement waits after the region is cleared, in milliseconds, so that a screen reader reads a text again that it read before. */
const ANNOUNCE_DELAY_MS = 50;

/**
 * A live region that announces status messages without moving the focus.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#status-messages | WCAG 2.2, status messages}
 */
export interface Announcer {
  /** The region, which holds the text of the latest message in view. */
  readonly element: HTMLElement;
  /**
   * Replaces the message in the region.
   *
   * @param text - The message.
   */
  say(text: string): void;
  /** Takes the pending announcement away. */
  stop(): void;
}

/**
 * Creates a polite live region with `role="status"`.
 *
 * @remarks
 * Its text is visible, so that the candidate who does not use a screen reader reads it too. The style of the class keeps the room
 * of a line for the region whether or not it holds text, so that writing a message moves nothing.
 *
 * @param className - The class of the region.
 * @returns The announcer.
 * @see {@link https://www.w3.org/TR/WCAG22/#status-messages | WCAG 2.2, status messages}
 */
export function createAnnouncer(className: string): Announcer {
  const element = html("div", { class: className, role: "status", "aria-live": "polite", "aria-atomic": "true" });
  let pending: ReturnType<typeof setTimeout> | undefined;
  return {
    element,
    say: (text) => {
      clearTimeout(pending);
      element.textContent = "";
      pending = setTimeout(() => {
        element.textContent = text;
      }, ANNOUNCE_DELAY_MS);
    },
    stop: () => clearTimeout(pending),
  };
}
