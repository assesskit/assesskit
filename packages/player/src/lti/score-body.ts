import type { PendingWork } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { AssessmentResult, ResultVariable } from "@assesskit/runtime/results";
import { describe } from "../checks.js";

/** The values of `gradingProgress` that a tool publishes after a test. */
export type PublishedGradingProgress = "FullyGraded" | "Pending" | "PendingManual";

/** What the results report and the open scoring requests say about the score to publish. */
export interface ScoreFields {
  /** How far grading is. */
  readonly gradingProgress: PublishedGradingProgress;
  /** The time the report was last changed, as an ISO 8601 date and time in UTC with milliseconds. */
  readonly timestamp: string;
  /** The score, from 0; absent while a person scores and when the report has no `SCORE`. */
  readonly scoreGiven?: number;
  /** The outcome `MAXSCORE` of the report, above 0; absent when the report has none. */
  readonly maximum?: number;
  /** The score as the report had it, when a negative `SCORE` was sent as 0. */
  readonly comment?: string;
}

/** Returns the variables of the result that the score comes from: the test's, or those of the one item delivered alone. */
function scoredVariables(result: AssessmentResult): {
  readonly variables: readonly ResultVariable[];
  readonly datestamp: string;
} {
  if (result.testResult !== undefined) return result.testResult;
  const [only, ...others] = result.itemResults;
  if (only === undefined || others.length > 0) {
    throw new DataError(
      `The results report must have a test result or the result of one item to publish a score from, found ${result.itemResults.length} item results and no test result.`,
    );
  }
  return only;
}

/**
 * Reads a numeric outcome of the report: `undefined` when the report has no such outcome or its value is NULL.
 *
 * @throws `DataError` when the outcome is not one finite integer or float.
 */
function numericOutcome(variables: readonly ResultVariable[], identifier: string): number | undefined {
  const outcome = variables.find((variable) => variable.kind === "outcome" && variable.identifier === identifier);
  if (outcome?.kind !== "outcome" || outcome.value === null) return undefined;
  const { value } = outcome;
  if (
    value.cardinality !== "single" ||
    (value.baseType !== "integer" && value.baseType !== "float") ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value)
  ) {
    throw new DataError(
      `The outcome ${identifier} must be one finite integer or float to publish, found ${describe(value)}.`,
    );
  }
  return value.value;
}

/**
 * Returns how far grading is from the requests that are open: `PendingManual` while a person must score one, `Pending`
 * while only a scoring service must, and `FullyGraded` when none is open.
 */
export function gradingProgressOf(pending: PendingWork): PublishedGradingProgress {
  if (pending.scoring.some((request) => request.mode === "human")) return "PendingManual";
  return pending.scoring.length > 0 ? "Pending" : "FullyGraded";
}

/**
 * Reads the fields of a score from a results report and the work that is pending: `scoreGiven` is the outcome `SCORE`
 * raised to 0 when it is negative, with the report's value in the `comment`, and is left out while a person must still score.
 * The `timestamp` is the time of the report's last change, so it grows when the session changes.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#scoregiven-and-scoremaximum | LTI AGS 2.0, scoreGiven and scoreMaximum}
 * @throws `DataError` when the report has no test result and not exactly one item result, `SCORE` or `MAXSCORE` is not a finite
 * number, or `MAXSCORE` is not above 0.
 */
export function scoreFields(result: AssessmentResult, pending: PendingWork): ScoreFields {
  const { variables, datestamp } = scoredVariables(result);
  const gradingProgress = gradingProgressOf(pending);
  const raw = numericOutcome(variables, "SCORE");
  const maximum = numericOutcome(variables, "MAXSCORE");
  if (maximum !== undefined && maximum <= 0) {
    throw new DataError(`The outcome MAXSCORE must be above 0 to be the scoreMaximum of a score, found ${maximum}.`);
  }
  const scored = gradingProgress !== "PendingManual" && raw !== undefined;
  return {
    gradingProgress,
    timestamp: datestamp,
    ...(scored ? { scoreGiven: Math.max(0, raw) } : {}),
    ...(scored && raw < 0 ? { comment: `Raw score: ${raw}` } : {}),
    ...(maximum === undefined ? {} : { maximum }),
  };
}
