import { checkArray, checkNonEmptyString, checkRecord, describe, isRecord } from "@assesskit/runtime/checks";
import type { PendingWork } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { checkHttpsUrl } from "../checks.js";
import { LtiError } from "../errors.js";
import { isOfficialResult, type OfficialResult } from "../protocol/index.js";
import { type AccessToken, ltiAccessToken } from "./access-token.js";
import { AGS_SCOPE } from "./claims.js";
import type { LtiLaunch } from "./launch-model.js";
import { type AccessTokenOptions, checkToolOptions } from "./options.js";
import { type ScoreFields, scoreFields } from "./score-body.js";
import { callService, DEFAULT_TIMEOUT_MS, type ServiceCall } from "./service.js";

const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const SCORES_SUFFIX = "/scores";

/** Returns the line item scope to ask for when the line item must be read: the read-only one if the launch offers it. */
function lineItemScope(offered: readonly string[]): string {
  const scope = [AGS_SCOPE.lineitemReadonly, AGS_SCOPE.lineitem].find((each) => offered.includes(each));
  if (scope === undefined) {
    throw new LtiError(
      "The results have no MAXSCORE, so the score needs the scoreMaximum of the line item, and the launch offers no scope to read it.",
      "scope-unavailable",
    );
  }
  return scope;
}

/** Checks the launch that the score is published for, and returns the parts of it that the service calls use. */
function serviceOf(launch: unknown): {
  readonly lineItem: string;
  readonly offered: readonly string[];
  readonly userId: string;
} {
  checkRecord(launch, "The launch must be an object");
  if (launch.messageType !== "LtiResourceLinkRequest") {
    throw new DataError(
      `A score is published for a resource link launch, found the message type ${describe(launch.messageType)}.`,
    );
  }
  const { ags, subject } = launch;
  if (ags === undefined || (isRecord(ags) && ags.lineitem === undefined)) {
    throw new LtiError("The launch offers no line item to publish a score to.", "line-item-unavailable");
  }
  checkRecord(ags, "The grade services of the launch must be an object");
  checkArray(ags.scopes, "The scopes of the grade services of the launch must be an array");
  const scopes = ags.scopes.map((scope) => {
    checkNonEmptyString(scope, "A scope of the grade services of the launch");
    return scope;
  });
  checkHttpsUrl(ags.lineitem, "The line item of the launch");
  if (!scopes.includes(AGS_SCOPE.score)) {
    throw new LtiError("The launch does not offer the scope to publish a score.", "scope-unavailable");
  }
  if (subject === undefined) {
    throw new LtiError("The launch is anonymous, so the score has no user to be for.", "subject-unavailable");
  }
  checkNonEmptyString(subject, "The subject of the launch");
  return { lineItem: ags.lineitem, offered: scopes, userId: subject };
}

/** Checks that the token holds the scopes the calls need: the platform may grant fewer than were asked. */
function checkGranted(token: AccessToken, needed: readonly string[]): void {
  const missing = needed.find((scope) => !token.scopes.includes(scope));
  if (missing !== undefined) {
    throw new LtiError(`The platform did not grant the scope ${missing}.`, "scope-denied");
  }
}

/** Reads the `scoreMaximum` of the line item, which a score needs when the results have no MAXSCORE. */
async function readLineItemMaximum(service: ServiceCall, lineItem: string, token: AccessToken): Promise<number> {
  const body = await callService(service, `The line item ${lineItem}`, lineItem, {
    method: "GET",
    headers: { accept: LINE_ITEM_TYPE, authorization: `Bearer ${token.value}` },
  });
  let line: unknown;
  try {
    line = JSON.parse(body);
  } catch {
    throw new DataError("The line item must be JSON.");
  }
  checkRecord(line, "The line item must be an object");
  const { scoreMaximum } = line;
  if (typeof scoreMaximum !== "number" || !Number.isFinite(scoreMaximum) || scoreMaximum <= 0) {
    throw new DataError(
      `The scoreMaximum of the line item must be a number above 0 when the results have no MAXSCORE, found ${describe(scoreMaximum)}.`,
    );
  }
  return scoreMaximum;
}

/** Returns the URL of the scores of a line item: its path with `/scores` appended, and its query kept. */
function scoresUrl(lineItem: string): string {
  const url = new URL(lineItem);
  url.pathname = `${url.pathname}${SCORES_SUFFIX}`;
  return url.href;
}

/** Builds the body of the score request. */
function scoreBody(fields: ScoreFields, userId: string, scoreMaximum: number | undefined): Record<string, unknown> {
  const { gradingProgress, timestamp, scoreGiven, comment } = fields;
  return {
    userId,
    timestamp,
    activityProgress: "Completed",
    gradingProgress,
    ...(scoreGiven === undefined ? {} : { scoreGiven, scoreMaximum }),
    ...(comment === undefined ? {} : { comment }),
  };
}

/**
 * Publishes the score of a finished test to the line item of the launch that started it, to the learning platform that
 * launched the tool (LTI AGS 2.0 score publish service).
 *
 * @remarks
 * - **Official results only.** `result` must be the report that `SessionHost.results` returned. A copy of it, a report of a
 *   practice session and any other object are refused.
 * - **The score.** `scoreGiven` is the outcome `SCORE` raised to 0 when it is negative, with the report's value in the
 *   `comment`. `scoreMaximum` is the outcome `MAXSCORE`, else the `scoreMaximum` of the line item, which the function reads.
 * - **The progress.** `activityProgress` is `Completed`, so call it once the test has ended. `gradingProgress` is
 *   `PendingManual` while a person must score a request, and then `scoreGiven` is left out; `Pending` while only scoring
 *   services must, with the score so far; and `FullyGraded` when no request is open.
 * - **The time.** `timestamp` is the time of the last change of the report, so it grows with the session, as the service
 *   requires. Read `result` and `pending` of one session at one moment, and publish again when the session changes.
 *
 * The call requests an access token for the scopes it needs and does not keep it.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#score-publish-service | LTI AGS 2.0, score publish service}
 * @param result - The report of the session, from `SessionHost.results`.
 * @param launch - The resource link launch that started the session, from `ltiLaunch`; a Deep Linking request is refused.
 * @param pending - What the session waits on the host for, from `SessionHost.pending` for the same session.
 * @param options - The registration lookup, the clock and the `fetch` of `ltiAccessToken`.
 * @throws `DataError` when an argument has the wrong type, `result` is not official, the results have no `SCORE` or `MAXSCORE`
 * to publish, or the line item has no `scoreMaximum` above 0 where one is needed.
 * @throws `LtiError` (`line-item-unavailable`, `scope-unavailable`, `subject-unavailable`, `scope-denied`) when the launch
 * offers no line item, no scope for the calls, or no user, and when the platform grants fewer scopes than were asked.
 * @throws `ServiceError` when the token endpoint, the line item or the score service does not answer with a success.
 */
export async function publishScore(
  result: OfficialResult,
  launch: LtiLaunch,
  pending: PendingWork,
  options: AccessTokenOptions,
): Promise<void> {
  checkToolOptions(options);
  if (!isOfficialResult(result)) {
    throw new DataError(
      "A score is published from the results report that SessionHost.results returned; a copy, or the report of a practice session, is not official.",
    );
  }
  checkRecord(pending, "The pending work must be an object");
  checkArray(pending.scoring, "The scoring requests of the pending work must be an array");
  for (const request of pending.scoring)
    checkRecord(request, "A scoring request of the pending work must be an object");
  const { lineItem, offered, userId } = serviceOf(launch);
  const fields = scoreFields(result, pending);
  const needsMaximum = fields.scoreGiven !== undefined && fields.maximum === undefined;
  const scopes = needsMaximum ? [AGS_SCOPE.score, lineItemScope(offered)] : [AGS_SCOPE.score];
  const token = await ltiAccessToken(launch, scopes, options);
  checkGranted(token, scopes);
  const service = { fetch: options.fetch, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const scoreMaximum = needsMaximum ? await readLineItemMaximum(service, lineItem, token) : fields.maximum;
  await callService(service, `The score service of ${lineItem}`, scoresUrl(lineItem), {
    method: "POST",
    headers: { "content-type": SCORE_TYPE, authorization: `Bearer ${token.value}` },
    body: JSON.stringify(scoreBody(fields, userId, scoreMaximum)),
  });
}
