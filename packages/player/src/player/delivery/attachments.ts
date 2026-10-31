import { webSpeech } from "../speech/index.js";
import type { Body } from "./body.js";
import { createLexicons, type Lexicons } from "./lexicons.js";
import type { Sender } from "./sender.js";
import type { Settings } from "./settings.js";
import type { Shell } from "./shell.js";
import type { MountState } from "./state.js";
import { type DeliverySupports, mountDeliverySupports } from "./supports.js";
import { type DeliveryTools, mountDeliveryTools } from "./tools.js";

/** What the parts that follow the content need of the player. */
export interface AttachmentsContext
  extends Pick<Settings, "client" | "messages" | "language" | "chrome" | "fetch" | "hooks"> {
  /** The state of the mounted player. */
  readonly state: MountState;
  /** Sends the requests of the supports and the tools. */
  readonly sender: Sender;
  /** The elements of the player. */
  readonly shell: Shell;
  /** The content, which the supports and the tools lie over. */
  readonly body: Body;
}

/** The parts that follow the item and the profile of the view: the supports, the pronunciation lexicons and the tools. */
export interface Attachments {
  /** The panel and the effects of the supports. */
  readonly supports: DeliverySupports;
  /** The loader of the lexicons that reading aloud uses. */
  readonly lexicons: Lexicons;
  /** The tools, which only a player with chrome has. */
  readonly tools: DeliveryTools | undefined;
}

/**
 * Mounts the supports, the lexicons and the tools of the player.
 *
 * @remarks
 * A player without chrome draws no panel of supports and no tools: the host that draws its own actions asks for the
 * supports itself.
 *
 * @param context - See {@link AttachmentsContext}.
 * @returns The parts.
 */
export function mountAttachments(context: AttachmentsContext): Attachments {
  const { client, messages, language, chrome, hooks, state, sender, shell, body } = context;
  const assets = (path: string): string => client.assets(path);
  const supports = mountDeliverySupports({
    messages,
    language,
    slot: shell.supportsSlot,
    contentHost: shell.contentHost,
    content: body.content,
    pci: body.pci,
    voice: hooks.voice ?? webSpeech(),
    ...(chrome ? { request: sender.request } : {}),
  });
  const lexicons = createLexicons({
    fetch: context.fetch,
    assets,
    apply: (loaded) => {
      if (!state.destroyed) supports.setLexicons(loaded);
    },
  });
  const tools = chrome
    ? mountDeliveryTools({
        messages,
        language,
        slot: shell.toolsSlot,
        stage: body.content.stage,
        assets,
        slots: hooks.tools ?? {},
        request: sender.request,
      })
    : undefined;
  return { supports, lexicons, tools };
}
