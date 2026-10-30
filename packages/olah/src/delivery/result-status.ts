import type { AssessmentItem } from "../asi/index.js";
import { checkItem } from "../processing/variables.js";
import type { SessionStatus } from "../results/index.js";
import { attemptsOf } from "./attempt.js";
import { checkSession, type ItemSession } from "./item-session.js";

/**
 * Returns the session status that the result of an item session reports (RR §2.7.7, B2):
 *
 * | Status                      | When                                                                               |
 * | --------------------------- | ---------------------------------------------------------------------------------- |
 * | `initial`                   | no attempt was made: `numAttempts` is 0                                            |
 * | `pendingSubmission`         | an attempt is open, so the responses are drafts                                    |
 * | `pendingResponseProcessing` | the response processing of the latest submission failed (E26)                      |
 * | `pendingExternalScoring`    | response processing ran and the item declares an externally scored outcome (INFO §4.5.10) |
 * | `final`                     | response processing ran                                                            |
 *
 * @param session - The item session.
 * @param item - The item of the session.
 * @throws `DataError` when an argument has the wrong type.
 */
export function resultStatus(session: ItemSession, item: AssessmentItem): SessionStatus {
  checkSession(session);
  checkItem(item);
  if (attemptsOf(session.variables) === 0) return "initial";
  if (session.attempting) return "pendingSubmission";
  if (session.processingFailed) return "pendingResponseProcessing";
  const external = item.outcomeDeclarations.some((declaration) => declaration.externalScored !== undefined);
  return external ? "pendingExternalScoring" : "final";
}
