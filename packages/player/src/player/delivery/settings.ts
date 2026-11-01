import type { Messages } from "../../messages/index.js";
import { selectMessages } from "../../messages/index.js";
import type { DeliveryOptions, ItemMountOptions } from "./options.js";
import { DEFAULT_RESUME_CHECK_MS } from "./resume.js";

/** The options of a player that draws content only, with their defaults applied, which its parts read. */
export interface ItemSettings
  extends Pick<ItemMountOptions, "client" | "files" | "staticUrl" | "stylesheet" | "fetch" | "mathjax"> {
  /** The text of the interface, in the language chosen. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag. */
  readonly language: string;
  /** The origins besides the asset origin that the content may load from. */
  readonly origins: readonly string[];
  /** The hooks of the host. */
  readonly hooks: NonNullable<ItemMountOptions["hooks"]>;
  /** Reports an error that the player can only report: the hook `onError`, or `reportError` of the page. */
  readonly report: (error: unknown) => void;
}

/** The options of the player with their defaults applied, which its parts read. */
export interface Settings extends Omit<ItemSettings, "hooks"> {
  /** Whether the player draws its chrome. */
  readonly chrome: boolean;
  /** How often a paused test is checked, in milliseconds; 0 for never. */
  readonly resumeCheckMs: number;
  /** The element that holds the player. */
  readonly landmark: "main" | "region";
  /** The level of the heading of the item. */
  readonly headingLevel: 1 | 2 | 3 | 4 | 5 | 6;
  /** The hooks of the host. */
  readonly hooks: NonNullable<DeliveryOptions["hooks"]>;
}

/**
 * Applies the defaults of the options of a player that draws content only and chooses its messages.
 *
 * @param options - The options, which `checkItemOptions` has checked.
 * @returns The settings.
 */
export function resolveItemSettings(options: ItemMountOptions): ItemSettings {
  const { client, files, staticUrl, stylesheet, fetch, mathjax, language = "en", origins = [], hooks = {} } = options;
  return {
    client,
    files,
    staticUrl,
    stylesheet,
    fetch,
    mathjax,
    language,
    origins,
    hooks,
    report: hooks.onError ?? ((error) => reportError(error)),
    messages: selectMessages(language, options.messages),
  };
}

/**
 * Applies the defaults of the options of the player and chooses its messages.
 *
 * @param options - The options, which `checkDeliveryOptions` has checked.
 * @returns The settings.
 */
export function resolveSettings(options: DeliveryOptions): Settings {
  const {
    chrome = true,
    hooks = {},
    resumeCheckMs = DEFAULT_RESUME_CHECK_MS,
    landmark = "region",
    headingLevel = 2,
    ...shared
  } = options;
  return { ...resolveItemSettings({ ...shared, hooks }), chrome, hooks, resumeCheckMs, landmark, headingLevel };
}
