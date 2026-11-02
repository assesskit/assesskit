import type { ItemKey } from "@assesskit/runtime/delivery";
import {
  type Assessment,
  type AssessmentItem,
  type Attempt,
  mintUrn,
  type Person,
} from "@interopkit/learning-analytics";
import type { CaliperContext } from "./context.ts";

/** The times of an attempt, when the event knows them. */
export type AttemptTimes = Pick<Attempt, "startedAtTime" | "endedAtTime">;

/** Returns a person, named by the IRI the host gave. */
export function person(id: string): Person {
  return { id, type: "Person" };
}

/** Returns the test as an assessment, named by the IRI the host gave. */
export function assessmentOf(context: CaliperContext): Assessment {
  return { id: context.assessment, type: "Assessment" };
}

/** Returns the IRI of an item: the same in every session of the test, because the test and the item reference name it. */
function itemId(context: CaliperContext, key: ItemKey): string {
  return mintUrn(["item", context.assessment, key.ref]);
}

/** Returns the item of an item reference, named by the identifier of the reference. */
export function itemOf(context: CaliperContext, key: ItemKey): AssessmentItem {
  return { id: itemId(context, key), type: "AssessmentItem", name: key.ref, isPartOf: context.assessment };
}

/**
 * Returns a section of the test.
 *
 * @remarks
 * Caliper's Assessment Profile has no section, and a section is a group of items that is part of the test, so it is an
 * assessment that is part of the assessment.
 */
export function sectionOf(context: CaliperContext, identifier: string): Assessment {
  return {
    id: mintUrn(["section", context.assessment, identifier]),
    type: "Assessment",
    name: identifier,
    isPartOf: context.assessment,
  };
}

/** Returns the IRI of the attempt at the test, which is the candidate session. */
function testAttemptId(context: CaliperContext): string {
  return mintUrn(["attempt", context.session]);
}

/** Returns the candidate's attempt at the test: the candidate session. */
export function testAttempt(context: CaliperContext, times: AttemptTimes): Attempt {
  return {
    id: testAttemptId(context),
    type: "Attempt",
    assignee: context.actor,
    assignable: context.assessment,
    ...times,
  };
}

/** Returns the candidate's attempt at an item instance, which is part of the attempt at the test. */
export function itemAttempt(context: CaliperContext, key: ItemKey, times: AttemptTimes): Attempt {
  return {
    id: mintUrn(["attempt", context.session, key.ref, key.instance]),
    type: "Attempt",
    assignee: context.actor,
    assignable: itemId(context, key),
    isPartOf: testAttemptId(context),
    ...times,
  };
}
