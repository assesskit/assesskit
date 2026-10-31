import type { ItemKey } from "@assesskit/runtime/delivery";
import type { AgsScore } from "../lti/index.js";

/**
 * The host's record of the latest score that the tool of each LTI item posted to its line item, by the session and the item
 * instance.
 *
 * @remarks
 * A store that serves several processes must make `keep` atomic.
 */
export interface AgsScoreStore {
  /**
   * Keeps a score if its time is later than that of the score kept for the line item, or if none is kept.
   *
   * @param session - The identifier of the session.
   * @param item - The item instance.
   * @param score - A score that passed the checks of `agsScores`. Keep it whole, whatever its `gradingProgress`: the
   * interim ones tell the host how far the tool is.
   * @returns `false` when the kept score is as late as the new one or later, and then stores nothing. The service requires
   * a platform to leave a result alone when the last timestamp on record is later than the incoming score.
   * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#score-publish-service | LTI AGS 2.0, score publish service}
   */
  keep(session: string, item: ItemKey, score: AgsScore): Promise<boolean>;
  /**
   * Returns the score kept for a line item.
   *
   * @param session - The identifier of the session.
   * @param item - The item instance.
   * @returns The score, or `undefined` when the tool has posted none.
   */
  latest(session: string, item: ItemKey): Promise<AgsScore | undefined>;
}
