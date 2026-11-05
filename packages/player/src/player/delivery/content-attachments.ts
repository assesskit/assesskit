import { createWebSpeech } from "../speech/index.js";
import type { Body } from "./body.js";
import { createLexicons, type Lexicons } from "./lexicons.js";
import type { ItemSettings } from "./settings.js";
import type { MountState } from "./state.js";
import { type DeliverySupports, mountDeliverySupports, type SupportsContext } from "./supports.js";

/** What the parts that follow the content need of the player. */
export interface ContentAttachmentsContext
  extends Pick<ItemSettings, "client" | "messages" | "language" | "fetch" | "voice" | "report"> {
  /** The state of the mounted player. */
  readonly state: MountState;
  /** The element that gets the notice of the variant, the panel and the controls of reading aloud. */
  readonly slot: HTMLElement;
  /** The element that holds the content root, which takes the look of the supports. */
  readonly contentHost: HTMLElement;
  /** The content, which the supports lie over. */
  readonly body: Body;
  /** Mounts the panel of the supports, which a player without chrome leaves out. */
  readonly panel?: SupportsContext["panel"];
}

/** The parts that follow the item and the profile of the view and that every player has: the supports and the pronunciation lexicons. */
export interface ContentAttachments {
  /** The effects of the supports, and the panel where the player has one. */
  readonly supports: DeliverySupports;
  /** The loader of the lexicons that reading aloud uses. */
  readonly lexicons: Lexicons;
}

/**
 * Mounts the supports and the lexicons of the player.
 *
 * @param context - See {@link ContentAttachmentsContext}.
 * @returns The parts.
 */
export function mountContentAttachments(context: ContentAttachmentsContext): ContentAttachments {
  const { client, messages, language, voice, state, slot, contentHost, body, panel } = context;
  const supports = mountDeliverySupports({
    report: context.report,
    messages,
    language,
    slot,
    contentHost,
    content: body.content,
    pci: body.pci,
    voice: voice ?? createWebSpeech(),
    ...(panel === undefined ? {} : { panel }),
  });
  const lexicons = createLexicons({
    report: context.report,
    fetch: context.fetch,
    assets: (path) => client.assets(path),
    apply: (loaded) => {
      if (!state.destroyed) supports.setLexicons(loaded);
    },
  });
  return { supports, lexicons };
}
