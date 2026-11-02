import { AccessError } from "@assesskit/player";
import type { SessionHost, ToolScoreIntake } from "@assesskit/player/server";
import type { ItemKey } from "@assesskit/runtime/delivery";
import type { CallOptions } from "@interopkit/core";
import type { GradebookStore, ServiceCaller } from "@interopkit/tool-integration/platform";
import { parseItemId, toToolScore } from "./tool-item.ts";

/** What the host knows of the line item of an item instance: the tool it launches, and how the tool's score is scaled. */
export interface LinkedItem {
  /** The client identifier of the tool whose link the item holds. Only that tool may read the line item and score it. */
  readonly clientId: string;
  /** The name of the line item, such as the title of the link. */
  readonly label: string;
  /** The highest score of the item, above 0. */
  readonly scoreMaximum: number;
}

/** What the gradebook needs. */
export interface GradebookOptions {
  /** The session host, of which the gradebook uses `check`. */
  readonly host: Pick<SessionHost, "check">;
  /** The intake, of which the gradebook uses `onScore`. */
  readonly intake: Pick<ToolScoreIntake, "onScore">;
  /** Returns the line item of an item instance of a session, or `undefined` when that item is not an LTI item of the session. */
  readonly linkOf: (session: string, item: ItemKey, options?: CallOptions) => Promise<LinkedItem | undefined>;
}

/**
 * Returns the gradebook behind the grade services of the platform role: the context is a session, the line item is an item
 * instance of it, and a score that the tool posts goes to the intake.
 *
 * @remarks
 * Only the line item and its scores exist here, so the methods for the container, for changing a line item and for the results
 * answer that they have nothing: `undefined` and `false` are the 404 of a tool that is not the caller's. A score is kept only
 * when the item is a link of the caller's tool, and the session is bound to the user that the score names, so that a tool cannot
 * score a candidate whom it was not launched for. The platform answers 204 whether the intake kept the score or an earlier one
 * kept a later score, so `keepScore` need not tell which.
 */
export function createGradebook(options: GradebookOptions): GradebookStore {
  const { host, intake, linkOf } = options;
  /** Finds the item instance and the link of a line item, when the caller's tool is the one that holds it. */
  const find = async (caller: ServiceCaller, session: string, lineItemId: string, call?: CallOptions) => {
    const item = parseItemId(lineItemId);
    const link = item === undefined ? undefined : await linkOf(session, item, call);
    return item === undefined || link?.clientId !== caller.clientId ? undefined : { item, link };
  };
  return {
    lineItems: async () => undefined,
    lineItem: async (caller, session, lineItemId, call) => {
      const found = await find(caller, session, lineItemId, call);
      return found && { id: lineItemId, label: found.link.label, scoreMaximum: found.link.scoreMaximum };
    },
    createLineItem: async () => undefined,
    updateLineItem: async () => undefined,
    deleteLineItem: async () => false,
    results: async () => undefined,
    keepScore: async (caller, session, lineItemId, score, call) => {
      const found = await find(caller, session, lineItemId, call);
      if (found === undefined) return undefined;
      try {
        await host.check({ session, principal: score.userId }, call);
      } catch (error) {
        if (error instanceof AccessError) return undefined;
        throw error;
      }
      await intake.onScore(session, found.item, toToolScore(score), call);
      return "kept";
    },
  };
}
