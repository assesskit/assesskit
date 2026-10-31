import type { ItemKey } from "@assesskit/runtime/delivery";
import { type CaliperEntity, type CaliperEvent, caliperTime, mintUrn } from "@interopkit/learning-analytics";
import { assemble } from "./build.ts";
import type { CaliperContext } from "./context.ts";
import { itemAttempt, testAttempt } from "./entities.ts";

/** A score that was given to the candidate's attempt at the test or at an item. */
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

/**
 * Builds the GradeEvent Graded of the Grading Profile for a score that was given to an attempt.
 *
 * @remarks
 * The event's object is the candidate's attempt at the test, or at the item; the score it generates names that attempt.
 *
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}, Grading Profile
 */
export function caliperGrade(grade: CaliperGrade, context: CaliperContext): CaliperEvent {
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
  return assemble(index, { type: "GradeEvent", action: "Graded", actor, object, generated, time }, context);
}
