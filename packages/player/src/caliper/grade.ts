import {
  finiteSchema,
  looseRecord,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
  positiveIntegerSchema,
} from "@assesskit/runtime/checks";
import type { ItemKey } from "@assesskit/runtime/delivery";
import * as v from "valibot";
import { buildEvent } from "./build.js";
import { type CaliperContext, checkContext, iriSchema } from "./context.js";
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
  /**
   * The item instance that was graded.
   *
   * @defaultValue none, the test was graded
   */
  readonly item?: ItemKey;
  /** The score awarded. */
  readonly scoreGiven: number;
  /**
   * The greatest score possible.
   *
   * @defaultValue none
   */
  readonly maxScore?: number;
  /** Who scored it: a rater is a person, and an external scoring service is a software application. */
  readonly scorer: "human" | "externalMachine";
  /** The IRI of the rater or of the service. */
  readonly scoredBy: string;
}

// The time `at` is checked where the event is built.
const gradeSchema = looseRecord({
  index: nonNegativeIntegerSchema,
  scoreGiven: finiteSchema,
  maxScore: v.optional(finiteSchema),
  item: v.optional(looseRecord({ ref: nonEmptyStringSchema, instance: positiveIntegerSchema })),
  scorer: v.picklist(["human", "externalMachine"]),
  scoredBy: iriSchema,
});

/**
 * Checks a grade, as a host passes it from JavaScript.
 *
 * @param value - The grade.
 * @throws `DataError` when it is not an object with a non-negative integer `index`, a valid `at`, a finite `scoreGiven`,
 * a `scorer`, an IRI as `scoredBy`, and, when present, an item instance as `item` and a finite `maxScore`.
 */
function checkGrade(value: unknown): asserts value is CaliperGrade {
  parseWith(gradeSchema, value, "The Caliper grade");
}

/**
 * Builds the GradeEvent Graded of the Grading Profile for a score that was given to an attempt.
 *
 * @remarks
 * The event's object is the candidate's attempt at the test, or at the item; the score it generates names that attempt.
 *
 * @param grade - The score, who gave it and when.
 * @param context - The session, the step and the parties.
 * @returns The event.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}, Grading Profile
 */
export function caliperGrade(grade: CaliperGrade, context: CaliperContext): CaliperEvent {
  checkContext(context);
  checkGrade(grade);
  const { index, at, item, scoreGiven, maxScore, scorer, scoredBy } = grade;
  const time = caliperTime(at, "The time of the Caliper grade");
  const object = item === undefined ? testAttempt(context, {}) : itemAttempt(context, item, {});
  const generated: CaliperEntity = {
    id: mintUrn(["score", context.session, context.step, index]),
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
