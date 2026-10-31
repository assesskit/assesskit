import type { Messages } from "../../messages/index.js";
import { selectMessages } from "../../messages/index.js";
import type { DeliveryOptions } from "./options.js";

/** The options of the player with their defaults applied, which its parts read. */
export interface Settings
  extends Pick<DeliveryOptions, "client" | "files" | "staticUrl" | "stylesheet" | "fetch" | "mathjax"> {
  /** The text of the interface, in the language chosen. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag. */
  readonly language: string;
  /** The origins besides the asset origin that the content may load from. */
  readonly origins: readonly string[];
  /** Whether the player draws its chrome. */
  readonly chrome: boolean;
  /** The hooks of the host. */
  readonly hooks: NonNullable<DeliveryOptions["hooks"]>;
}

/**
 * Applies the defaults of the options of the player and chooses its messages.
 *
 * @param options - The options, which `checkDeliveryOptions` has checked.
 * @returns The settings.
 */
export function resolveSettings(options: DeliveryOptions): Settings {
  const { client, files, staticUrl, stylesheet, fetch, mathjax, language = "en", origins = [] } = options;
  const { chrome = true, hooks = {} } = options;
  return {
    client,
    files,
    staticUrl,
    stylesheet,
    fetch,
    mathjax,
    language,
    origins,
    chrome,
    hooks,
    messages: selectMessages(language, options.messages),
  };
}
