import type { ItemKey } from "@assesskit/runtime/delivery";
import type { SessionCallOptions } from "../protocol/index.js";

/** The score that the tool of an item gave, as delivery needs it. */
export interface ToolScore {
  /**
   * The score the tool gave.
   *
   * @defaultValue none, so that the `SCORE` request of the item gets NULL
   */
  readonly scoreGiven?: number;
  /**
   * The highest score the tool gives.
   *
   * @defaultValue none, so that the `MAXSCORE` request of the item gets NULL
   */
  readonly scoreMaximum?: number;
  /** Whether the tool has finished grading. Only a final score goes to the session. */
  readonly final: boolean;
  /** The time of the score in epoch milliseconds, which orders the scores of one item instance. */
  readonly timestampMs: number;
}

/**
 * The host's record of the latest score that the tool of each item gave, by the session and the item instance.
 *
 * @remarks
 * A store that serves several processes must make `keep` atomic. Every method takes the `signal` of the call that waits for
 * it, and a store that waits on a service bounds its own time.
 */
export interface ToolScoreStore {
  /**
   * Keeps a score unless the kept one is later, and returns whether it kept it. An equal time keeps it again and returns
   * `true`, so that a retry finishes a supply that failed halfway. A store that rejects keeps nothing.
   *
   * @param session - The identifier of the session.
   * @param item - The item instance.
   * @param score - A score that passed the checks of the adapter. Keep it whole, whatever its `final`.
   * @param options - See {@link SessionCallOptions}.
   * @returns `false` when the kept score is later than the new one, and then nothing is stored. A platform has to leave a
   * result alone when the last timestamp on record is later than the incoming score.
   * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#score-publish-service | LTI AGS 2.0, score publish service}
   */
  keep(session: string, item: ItemKey, score: ToolScore, options?: SessionCallOptions): Promise<boolean>;
  /**
   * Returns the score kept for an item instance.
   *
   * @param session - The identifier of the session.
   * @param item - The item instance.
   * @param options - See {@link SessionCallOptions}.
   * @returns The score, or `undefined` when the tool has given none.
   */
  latest(session: string, item: ItemKey, options?: SessionCallOptions): Promise<ToolScore | undefined>;
}
