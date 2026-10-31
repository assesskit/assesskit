import type { Messages } from "../../messages/index.js";
import { html } from "../internal.js";

/** The parts of the player that the shell puts in the page. */
export interface ShellParts {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag. */
  readonly language: string;
  /** Whether the player draws its chrome: the timers, the navigation map and the actions. */
  readonly chrome: boolean;
  /** The region of the timers, which the shell shows only with the chrome. */
  readonly timers: HTMLElement;
  /** The live region that announces the warnings of the timers. */
  readonly timerStatus: HTMLElement;
  /** The live region of the status messages. */
  readonly status: HTMLElement;
  /** The slot of the tool of an LTI item. */
  readonly lti: HTMLElement;
  /** The form of the comment. */
  readonly comment: HTMLElement;
}

/** The elements of the player, which the parts of the chrome and the content fill. */
export interface Shell {
  /** The root of the player, which goes in the shadow root of the host. */
  readonly app: HTMLElement;
  /** The element around the map and the main part, which says whether there is a map. */
  readonly layout: HTMLElement;
  /** The heading of the item, which gets the focus when the item changes. */
  readonly heading: HTMLElement;
  /** The notices of the view. */
  readonly notices: HTMLElement;
  /** The attempts used and left. */
  readonly attempts: HTMLElement;
  /** The navigation map. */
  readonly mapSlot: HTMLElement;
  /** The buttons of the actions. */
  readonly actionsSlot: HTMLElement;
  /** The panel of the supports. */
  readonly supportsSlot: HTMLElement;
  /** The toolbar of the tools. */
  readonly toolsSlot: HTMLElement;
  /** The element that becomes the content root. */
  readonly contentHost: HTMLElement;
}

/**
 * Creates the elements of the player in the order they stand on the page.
 *
 * @param parts - See {@link ShellParts}.
 * @returns The shell.
 */
export function createShell(parts: ShellParts): Shell {
  const { messages, language, chrome } = parts;
  const heading = html("h1", { class: "ak-heading", tabindex: "-1" });
  const notices = html("div", { class: "ak-notices" });
  const attempts = html("p", { class: "ak-attempts" });
  const mapSlot = html("div", { class: "ak-map" });
  const actionsSlot = html("div", { class: "ak-actions", role: "group", "aria-label": messages.actionsLabel });
  const supportsSlot = html("div", { class: "ak-supports-slot" });
  const toolsSlot = html("div", { class: "ak-supports-slot" });
  const contentHost = html("div", { class: "ak-content-host" });
  const layout = html(
    "div",
    { class: "ak-layout" },
    mapSlot,
    html(
      "main",
      { class: "ak-main" },
      heading,
      notices,
      supportsSlot,
      toolsSlot,
      contentHost,
      parts.lti,
      attempts,
      parts.comment,
      actionsSlot,
    ),
  );
  const app = html(
    "div",
    { class: "ak-player", lang: language },
    ...(chrome ? [parts.timers] : []),
    parts.timerStatus,
    layout,
    parts.status,
  );
  return {
    app,
    layout,
    heading,
    notices,
    attempts,
    mapSlot,
    actionsSlot,
    supportsSlot,
    toolsSlot,
    contentHost,
  };
}
