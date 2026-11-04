import { describe } from "@assesskit/runtime/checks";
import type { PendingWork } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { AssessmentResult, ResultVariable } from "@assesskit/runtime/results";
import { isOfficialResult, type OfficialResult } from "../protocol/index.js";

/** How far the scoring of a session is. */
export type ScoringProgress = "complete" | "awaiting-service" | "awaiting-person";

/** What the report of a session says about its score, as plain data. */
export interface SessionScore {
  /** How far scoring is: `awaiting-person` while a person must score a request, `awaiting-service` while only scoring services must. */
  readonly progress: ScoringProgress;
  /** The time of the report's last change, in ISO 8601 UTC with milliseconds. Two steps may share it, as the clock of a session never goes back. */
  readonly timestamp: string;
  /**
   * The outcome `SCORE`, raised to 0 when it is negative.
   *
   * @defaultValue absent while a person must score, and when the report has no `SCORE`
   */
  readonly score?: number;
  /**
   * The outcome `MAXSCORE`, above 0.
   *
   * @defaultValue absent when the report has none
   */
  readonly maximum?: number;
  /**
   * The value of a negative `SCORE`.
   *
   * @defaultValue absent when `score` is not a raised negative value
   */
  readonly rawScore?: number;
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
      `The results report must have a test result or the result of one item to read a score from, found ${result.itemResults.length} item results and no test result.`,
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
    throw new DataError(`The outcome ${identifier} must be one finite integer or float, found ${describe(value)}.`);
  }
  return value.value;
}

/** Returns how far scoring is from the requests that are open: a person first, then a scoring service. */
function progressOf(pending: PendingWork): ScoringProgress {
  if (pending.scoring.some((request) => request.mode === "human")) return "awaiting-person";
  return pending.scoring.length > 0 ? "awaiting-service" : "complete";
}

/**
 * Reads the score of a session from its official report and the work that is still pending. A host reads both from
 * `session(id)`, at the time it needs the score.
 *
 * @remarks
 * `score` is the outcome `SCORE` raised to 0 when it is negative, with the report's value in `rawScore`, and is left out
 * while a person must still score. `timestamp` is the time of the report's last change, so it grows as the session changes.
 * The function is pure: the same report and pending work give the same score.
 *
 * @param result - The report that `SessionHost.results` returned.
 * @param pending - The work that `SessionHost.pending` returned for the same session.
 * @returns The score.
 * @throws `DataError` when `result` is not the report of a session host, has no test result and not exactly one item
 * result, or `SCORE` or `MAXSCORE` is not a finite number, or `MAXSCORE` is not above 0.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, outcome variables}
 */
export function buildSessionScore(result: OfficialResult, pending: PendingWork): SessionScore {
  if (!isOfficialResult(result)) {
    throw new DataError(
      "A score is read from the results report that SessionHost.results returned; a copy, or the report of a practice session, is not official.",
    );
  }
  const { variables, datestamp } = scoredVariables(result);
  const progress = progressOf(pending);
  const raw = numericOutcome(variables, "SCORE");
  const maximum = numericOutcome(variables, "MAXSCORE");
  if (maximum !== undefined && maximum <= 0) {
    throw new DataError(`The outcome MAXSCORE must be above 0, found ${maximum}.`);
  }
  const scored = progress !== "awaiting-person" && raw !== undefined;
  return {
    progress,
    timestamp: datestamp,
    ...(scored ? { score: Math.max(0, raw) } : {}),
    ...(maximum === undefined ? {} : { maximum }),
    ...(scored && raw < 0 ? { rawScore: raw } : {}),
  };
}
