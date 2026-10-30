import { html } from "../dom.js";

/** How long an announcement waits after the region is cleared, so that a screen reader reads a text again that it read before. */
const ANNOUNCE_DELAY_MS = 50;

/** A live region that announces status messages without moving the focus (WCAG 4.1.3). */
export interface Announcer {
  /** The region, which holds the text of the latest message in view. */
  readonly element: HTMLElement;
  /** Replaces the message in the region. */
  say(text: string): void;
  /** Takes the pending announcement away. */
  stop(): void;
}

/**
 * Creates a polite live region with `role="status"`. Its text is visible, so that the candidate who does not use a
 * screen reader reads it too (WCAG 4.1.3).
 *
 * @param className - The class of the region.
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
