import type { CandidateAction } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { SupportName } from "@assesskit/runtime/pnp";
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
   * @param identifier - The response identifier.
   * @param value - The response.
   * @param pciState - The opaque state of the interaction.
   */
  respond(identifier: string, value: Value | null, pciState?: string): void;
  /** Asks to turn a support on or off: the next view says whether it took effect. */
  request(name: SupportName, active: boolean): void;
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
      else status.say(messages[REFUSAL_MESSAGES[refusal.code]]);
    } catch (error) {
      const rejected = error instanceof DataError || error instanceof AccessError;
      status.say(rejected ? messages.sendRejected : messages.sendFailed);
      if (!rejected) report(error);
    }
  };

  return {
    send,
    respond: (identifier, value, pciState) => {
      const item = state.view.current?.key;
      if (item === undefined || state.destroyed) return;
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
    comment: (text) => {
      const item = state.view.current?.key;
      if (item !== undefined) void send({ type: "comment", item, text }, () => status.say(messages.commentSaved));
    },
  };
}
