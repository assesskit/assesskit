import type { ItemKey } from "@luthfanwakan/olah/delivery";
import {
  checkChoice,
  checkFinite,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkRecord,
} from "../checks.js";
import { buildEvent } from "./build.js";
import { type CaliperContext, checkContext, checkIri } from "./context.js";
import { itemAttempt, testAttempt } from "./entities.js";
import type { CaliperEntity, CaliperEvent } from "./model.js";
import { caliperTime } from "./time.js";
import { mintUrn } from "./uuid.js";

/** A score that was given to the candidate's attempt at the test or at an item, for `caliperGrade`. */
export interface CaliperGrade {
  /** The position in `Step.events` of the event that reported the score: the event index that makes the identifier. */
  readonly index: number;
  /** When the score was given, in epoch milliseconds. */
  readonly at: number;
  /** The item instance that was graded. Default: the test. */
  readonly item?: ItemKey;
  /** The score awarded. */
  readonly scoreGiven: number;
  /** The greatest score possible. Default: none. */
  readonly maxScore?: number;
  /** Who scored it: a rater is a person, and an external scoring service is a software application. */
  readonly scorer: "human" | "externalMachine";
  /** The IRI of the rater or of the service. */
  readonly scoredBy: string;
}

const SCORERS = ["human", "externalMachine"] as const;

/**
 * Checks a grade, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a non-negative integer `index`, a valid `at`, a finite `scoreGiven`,
 * a `scorer`, an IRI as `scoredBy`, and, when present, an item instance as `item` and a finite `maxScore`.
 */
function checkGrade(value: unknown): asserts value is CaliperGrade {
  checkRecord(value, "The Caliper grade must be an object");
  checkNonNegativeInteger(value.index, "The index of the Caliper grade");
  checkFinite(value.scoreGiven, "The scoreGiven of the Caliper grade");
  const { maxScore, item } = value;
  if (maxScore !== undefined) checkFinite(maxScore, "The maxScore of the Caliper grade");
  if (item !== undefined) {
    checkRecord(item, "The item of the Caliper grade must be an object");
    checkNonEmptyString(item.ref, "The ref of the item of the Caliper grade");
    checkPositiveInteger(item.instance, "The instance of the item of the Caliper grade");
  }
  checkChoice(value.scorer, "The scorer of the Caliper grade", SCORERS);
  checkIri(value.scoredBy, "The scoredBy of the Caliper grade");
}

/**
 * Builds the GradeEvent Graded of the Grading Profile (Caliper 1.2 §3.6) for a score that was given to an attempt. The
 * event's object is the candidate's attempt at the test, or at the item; the score it generates names that attempt.
 *
 * @param grade - The score, who gave it and when.
 * @param context - The session, the step and the parties.
 * @throws `DataError` when an argument has the wrong type.
 */
export async function caliperGrade(grade: CaliperGrade, context: CaliperContext): Promise<CaliperEvent> {
  checkContext(context);
  checkGrade(grade);
  const { index, at, item, scoreGiven, maxScore, scorer, scoredBy } = grade;
  const time = caliperTime(at, "The time of the Caliper grade");
  const object = item === undefined ? await testAttempt(context, {}) : await itemAttempt(context, item, {});
  const generated: CaliperEntity = {
    id: await mintUrn(["score", context.session, context.step, index]),
    type: "Score",
    attempt: object.id,
    ...(maxScore === undefined ? {} : { maxScore }),
    scoreGiven,
    scoredBy,
    dateCreated: time,
  };
  const actor: CaliperEntity = { id: scoredBy, type: scorer === "human" ? "Person" : "SoftwareApplication" };
  return buildEvent(index, { type: "GradeEvent", action: "Graded", actor, object, generated, time }, context);
}
