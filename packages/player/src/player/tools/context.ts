import type { Messages } from "../../messages/index.js";
import type { SlotTool, ToolContent } from "./model.js";

/**
 * The file at which an item says that a calculator is available.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, calculator info}
 */
export interface ToolFile {
  /** The URL to load the file from, which `assets` made of its path in the package. */
  readonly url: string;
  /** The media type of the file, or `null` when the item gives none. */
  readonly mimeType: string | null;
  /** A short name of the file, or `null` when the item gives none. */
  readonly label: string | null;
}

/** What the host's tool gets besides the element to build in. */
export interface ToolOptions {
  /** The tool that the host builds. */
  readonly name: SlotTool;
  /** The language of the interface, a BCP 47 tag, such as `en`. */
  readonly language: string;
  /** For a calculator: the file at which the item says that the calculator is available, or `null` for none. */
  readonly file: ToolFile | null;
}

/**
 * Builds a tool of the host in `host` and returns the function that takes it down again, which runs when the tool closes.
 *
 * @param host - The panel of the tool.
 * @param options - What the tool needs to know besides the panel.
 */
export type ToolSlot = (host: HTMLElement, options: ToolOptions) => () => void;

/**
 * The tools that the host provides, by name; a tool without a function says that it is not available.
 *
 * @remarks
 * The names are those of {@link SlotTool}.
 */
export interface ToolSlots {
  /** The scientific calculator, in place of the built-in one. */
  readonly "scientific-calculator"?: ToolSlot;
  /** The graphing calculator, which the player does not build in. */
  readonly "graphing-calculator"?: ToolSlot;
  /** A dictionary. */
  readonly dictionary?: ToolSlot;
  /** A thesaurus. */
  readonly thesaurus?: ToolSlot;
  /** A checker of homophones. */
  readonly "homophone-checker"?: ToolSlot;
  /** A place to take notes. */
  readonly "note-taking"?: ToolSlot;
  /** A visual organizer. */
  readonly "visual-organizer"?: ToolSlot;
  /** An outliner. */
  readonly outliner?: ToolSlot;
  /** A way to talk with a peer. */
  readonly "peer-interaction"?: ToolSlot;
  /** A spell checker. */
  readonly "spell-checker"?: ToolSlot;
}

/** What the tools remember of the content shown, which outlasts a tool that is turned off. */
export interface ToolMemory {
  /** The marked words of each part of the content, by the key of the part. */
  readonly words: Map<string, Set<number>>;
  /** The crossed-out choices of each item, by the key of the item. */
  readonly choices: Map<string, Set<string>>;
}

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
  /** The names of the content shown now. */
  readonly content: () => ToolContent;
  /** What the tools remember of the content shown. */
  readonly memory: ToolMemory;
}

/** A tool that is open: its panel in the tray and what it puts over the item. */
export interface OpenTool {
  /** Moves the focus to the part of the tool that the candidate works with first. */
  focus(): void;
  /** Draws the tool again after the content changed or was drawn again; a tool that does not depend on the content has none. */
  refresh?(): void;
  /** Takes the tool down. */
  destroy(): void;
}
