import type { CandidateAction, ItemKey } from "@assesskit/runtime/delivery";
import { DataError, SecurityError } from "@assesskit/runtime/errors";
import type { SupportName, SupportSetting } from "@assesskit/runtime/pnp";
import type { Value } from "@assesskit/runtime/values";
import { AccessError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import type { SessionClient } from "../../protocol/index.js";
import type { Announcer } from "./announcer.js";
import { REFUSAL_MESSAGES } from "./refusals.js";
import type { MountState } from "./state.js";

/** What the sender needs of the player. */
export interface SenderContext {
  /** The session client that takes the actions. */
  readonly client: SessionClient;
  /** The text of the interface. */
  readonly messages: Messages;
  /** The region that tells what the engine refused and what was saved. */
  readonly status: Announcer;
  /** The state of the mounted player, which tells the item presented and whether the player is gone. */
  readonly state: MountState;
  /** Reports an error that the player can only report. */
  readonly report: (error: unknown) => void;
}

/** The actions that the parts of the player send to the session. */
export interface Sender {
  /**
   * Sends an action and says what the engine refused, or that the send failed.
   *
   * @param action - The action.
   * @param applied - Called once the engine has taken the action.
   */
  send(action: CandidateAction, applied?: () => void): Promise<void>;
  /**
   * Sends a response that an interaction gave, with the state of a portable custom interaction when it has one.
   *
   * @remarks
   * The response goes to the item instance whose content holds the interaction, which the caller names: a view that
   * presents another item arrives before that item's content is drawn, and a response given in the meantime is not the
   * other item's.
   *
   * @param item - The item instance that the interaction belongs to.
   * @param identifier - The response identifier.
   * @param value - The response.
   * @param pciState - The opaque state of the interaction.
   */
  respond(item: ItemKey, identifier: string, value: Value | null, pciState?: string): void;
  /** Asks to turn a support on or off: the next view says whether it took effect. */
  request(name: SupportName, active: boolean): void;
  /** Asks to change the settings of a support that is on: the next view says whether they took effect. */
  adjust(settings: SupportSetting): void;
  /** Sends the comment of the candidate on the item presented. */
  comment(text: string): void;
}

/**
 * Creates the sender of the player.
 *
 * @param context - See {@link SenderContext}.
 * @returns The sender.
 */
export function createSender(context: SenderContext): Sender {
  const { client, messages, status, state, report } = context;

  const send = async (action: CandidateAction, applied?: () => void): Promise<void> => {
    try {
      const { refusal } = await client.dispatch(action);
      if (refusal === undefined) applied?.();
      else status.say(messages[REFUSAL_MESSAGES[refusal.reason]]);
    } catch (error) {
      // An action above a limit is the content's, such as a PCI state that is too long: it is not sent again, and the page
      // hears of it.
      const oversized = error instanceof SecurityError;
      const rejected = oversized || error instanceof DataError || error instanceof AccessError;
      status.say(rejected ? messages.sendRejected : messages.sendFailed);
      if (!rejected || oversized) report(error);
    }
  };

  return {
    send,
    respond: (item, identifier, value, pciState) => {
      if (state.destroyed) return;
      void send(
        {
          type: "set-responses",
          item,
          responses: new Map([[identifier, value]]),
          ...(pciState === undefined ? {} : { pciStates: new Map([[identifier, pciState]]) }),
        },
        () => status.say(messages.answersSaved),
      );
    },
    request: (name, active) => void send({ type: "support", name, active }),
    adjust: (settings) => void send({ type: "support-settings", settings }),
    comment: (text) => {
      const item = state.view.current?.key;
      if (item !== undefined) void send({ type: "comment", item, text }, () => status.say(messages.commentSaved));
    },
  };
}
