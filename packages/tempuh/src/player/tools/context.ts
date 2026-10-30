import type { Messages } from "../../messages/index.js";
import type { SlotTool } from "./model.js";

/** What the host's tool gets besides the element to build in. */
export interface ToolOptions {
  /** The tool that the host builds. */
  readonly name: SlotTool;
  /** The language of the interface, a BCP 47 tag, such as `en`. */
  readonly language: string;
}

/**
 * The tools that the host provides, by name. A function builds the tool in `host` and returns the function that takes
 * it down again (tempuh design §2.8).
 */
export type ToolSlots = Partial<Record<SlotTool, (host: HTMLElement, options: ToolOptions) => () => void>>;

/** What a tool needs from the mount that opens it. */
export interface ToolContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface. */
  readonly language: string;
  /** The element that holds the rendered item. */
  readonly stage: HTMLElement;
  /** The layer over the stage that holds the tools which overlay the item. */
  readonly layer: HTMLElement;
  /** The place for the panels of the open tools. */
  readonly tray: HTMLElement;
  /** Turns the path of a file in the package into the URL to load it from. */
  readonly assets: (path: string) => string;
  /** The tools that the host provides. */
  readonly slots: ToolSlots;
}

/** A tool that is open: its panel in the tray and what it puts over the item. */
export interface OpenTool {
  /** Moves the focus to the part of the tool that the candidate works with first. */
  focus(): void;
  /** Takes the tool down. */
  destroy(): void;
}
