import type { Scorer, ScoringRequest } from "@luthfanwakan/olah/delivery";
import { describeType, fitsBaseType } from "@luthfanwakan/olah/processing";
import { normalizeValue, promote, single, type Value } from "@luthfanwakan/olah/values";
import { checkChoice, checkNonEmptyString, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { checkDeclaration } from "../protocol/submission.js";

/**
 * The `supply-scores` action of the host, which olah's engine applies in any state while the request exists (E15). The host
 * adds the time `at` before it applies the action.
 */
export interface SupplyScores {
  /** The type of the action. */
  readonly type: "supply-scores";
  /** The identifier of the scoring request. */
  readonly request: string;
  /** The value of the outcome, or NULL. */
  readonly value: Value | null;
  /** Who scored it. */
  readonly scorer: Scorer;
}

/** The score of a supply as a caller gives it: a value, a number, a string or a boolean for a single outcome, or NULL. */
export type ScoreInput = Value | number | string | boolean | null;

/** The scorers of a request (INFO §4.5.10, W18). */
const SCORERS: readonly Scorer[] = ["human", "externalMachine"];

/** Returns the value as the declaration holds it: an integer fits a float or duration outcome (D5); else `undefined`. */
function fitted(value: Value, request: ScoringRequest): Value | undefined {
  const { cardinality, baseType } = request.declaration;
  if (value.cardinality !== cardinality) return undefined;
  if (value.cardinality === "record") return value;
  if (baseType === undefined || !fitsBaseType(value.baseType, baseType)) return undefined;
  return baseType === "float" || baseType === "duration" ? promote(value, baseType) : value;
}

/**
 * Returns the typed value of a score: a plain number, string or boolean becomes a single value of the outcome's base type;
 * anything else is checked as a value. The empty string is NULL (INFO §2.2.2).
 */
function typedScore(request: ScoringRequest, score: ScoreInput): Value | null {
  if (score === null) return null;
  const { declaration, outcome } = request;
  if (typeof score === "object") {
    const value = normalizeValue(score);
    const fit = fitted(value, request);
    if (fit === undefined) {
      throw new DataError(`The outcome ${outcome} is ${describeType(declaration)}, found ${describeType(value)}.`);
    }
    return fit;
  }
  if (declaration.cardinality !== "single" || declaration.baseType === undefined) {
    throw new DataError(
      `The outcome ${outcome} is ${describeType(declaration)}, which a ${typeof score} does not fit: give a value that the values of olah build.`,
    );
  }
  return single(declaration.baseType, score);
}

/**
 * Builds the `supply-scores` action that gives the value of one externally scored outcome (tempuh design §2.9, E15). The
 * value is checked against the declaration of the request first, as the engine refuses a mismatch with
 * `score-type-mismatch`: the cardinality and the base type must be the outcome's, and an integer fits a float or
 * duration outcome. A number, string or boolean is taken as a single value of the outcome's base type. NULL fits.
 *
 * The engine accepts the action while the request exists, also after the test ended, and a second one for the same
 * request replaces the first and reports `scores-replaced`. The host stamps the action with `at` before it applies it.
 *
 * @param request - The scoring request, such as one of `Engine.pending(state).scoring`.
 * @param score - The value of the outcome; NULL when the scorer gives none.
 * @param scorer - Who scored it: `human` or `externalMachine`.
 * @throws `DataError` when `request` is not a scoring request, `scorer` is not a scorer, or the score does not fit the
 * declaration of the outcome, and a `DataError` of olah when the score is not a value of its base type.
 */
export function toSupplyScores(request: ScoringRequest, score: ScoreInput, scorer: Scorer): SupplyScores {
  checkRecord(request, "The request must be an object");
  checkNonEmptyString(request.id, "The id of the request");
  checkNonEmptyString(request.outcome, "The outcome of the request");
  checkDeclaration(request.declaration);
  checkChoice(scorer, "The scorer", SCORERS);
  return { type: "supply-scores", request: request.id, value: typedScore(request, score), scorer };
}
