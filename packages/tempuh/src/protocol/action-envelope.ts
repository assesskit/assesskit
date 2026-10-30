import { checkNonNegativeInteger, checkProperties, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";

/** What a client sends to a session host: one candidate action in olah's JSON form, with its sequence number. */
export interface ActionEnvelope {
  /**
   * The sequence number of the request. A repeated number returns the answer already given and a stale one is refused,
   * so a retry changes nothing.
   */
  readonly seq: number;
  /** The action as olah's `actionToJson` writes it. Untrusted until olah's `parseCandidateAction` has read it. */
  readonly action: unknown;
}

/**
 * Checks the shape of an action envelope that arrived as JSON. The action is not read: that is `parseCandidateAction`,
 * with its size limits.
 *
 * @throws `DataError` when it is not an object with the properties `seq` and `action` only, `seq` a non-negative integer.
 */
export function checkActionEnvelope(value: unknown): asserts value is ActionEnvelope {
  checkRecord(value, "An action envelope must be an object");
  checkProperties(value, "An action envelope", ["seq", "action"]);
  checkNonNegativeInteger(value.seq, "The property seq of an action envelope");
  if (value.action === undefined) throw new DataError('An action envelope must have the property "action".');
}
