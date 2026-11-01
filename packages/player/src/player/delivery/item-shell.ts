import { html } from "../internal.js";

/** The elements of a player that draws content only. */
export interface ItemShell {
  /** The root of the player, which goes in the shadow root of the host. */
  readonly app: HTMLElement;
  /** The element that gets the notice of the variant and the controls of reading aloud. */
  readonly supportsSlot: HTMLElement;
  /** The element that becomes the content root. */
  readonly contentHost: HTMLElement;
}

/**
 * Creates the elements of a player that draws content only, in the order they stand on the page.
 *
 * @param language - The language of the interface, a BCP 47 tag.
 * @param status - The live region of the status messages.
 * @returns The shell.
 */
export function createItemShell(language: string, status: HTMLElement): ItemShell {
  const supportsSlot = html("div", { class: "ak-supports-slot" });
  const contentHost = html("div", { class: "ak-content-host" });
  const app = html("div", { class: "ak-item", lang: language }, supportsSlot, contentHost, status);
  return { app, supportsSlot, contentHost };
}
