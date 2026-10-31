import type { AssessmentItem } from "../asi/index.js";
import { checkItem } from "../processing/internal.js";
import type { SessionStatus } from "../results/index.js";
import { attemptsOf } from "./attempt.js";
import { checkSession, type ItemSession } from "./item-session.js";

/**
 * Returns the session status that the result of an item session reports:
 *
 * | Status                      | When                                                                       |
 * | --------------------------- | -------------------------------------------------------------------------- |
 * | `initial`                   | no attempt was made: `numAttempts` is 0                                    |
 * | `pendingSubmission`         | an attempt is open, so the responses are drafts                            |
 * | `pendingResponseProcessing` | the response processing of the latest submission failed                    |
 * | `pendingExternalScoring`    | response processing ran and the item declares an externally scored outcome |
 * | `final`                     | response processing ran                                                    |
 *
 * @param session - The item session.
 * @param item - The item of the session.
 * @returns The status.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
