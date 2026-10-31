import type { ItemKey } from "@assesskit/runtime/delivery";
import type { CaliperContext } from "./context.js";
import type { CaliperEntity } from "./model.js";
import { mintUrn } from "./uuid.js";

/** The times of an attempt, when the event knows them. */
export type AttemptTimes = Pick<CaliperEntity, "startedAtTime" | "endedAtTime">;

/**
 * Returns a person, named by the IRI the host gave.
 *
 * @param id - The IRI of the person.
 * @returns The entity.
 */
export function person(id: string): CaliperEntity {
  return { id, type: "Person" };
}

/**
 * Returns the test as an assessment, named by the IRI the host gave.
 *
 * @param context - The session, the step and the parties.
 * @returns The entity.
 */
export function assessmentOf(context: CaliperContext): CaliperEntity {
  return { id: context.assessment, type: "Assessment" };
}

/** Returns the IRI of an item: the same in every session of the test, because the test and the item reference name it. */
function itemId(context: CaliperContext, key: ItemKey): string {
  return mintUrn(["item", context.assessment, key.ref]);
}

/**
 * Returns the item of an item reference, named by the identifier of the reference.
 *
 * @param context - The session, the step and the parties.
 * @param key - The item instance.
 * @returns The entity.
 */
export function itemOf(context: CaliperContext, key: ItemKey): CaliperEntity {
  return { id: itemId(context, key), type: "AssessmentItem", name: key.ref, isPartOf: context.assessment };
}

/**
 * Returns a section of the test.
 *
 * @remarks
 * Caliper's Assessment Profile has no section, and a section is a group of items that is part of the test, so it is an
 * assessment that is part of the assessment.
 *
 * @param context - The session, the step and the parties.
 * @param identifier - The identifier of the section.
 * @returns The entity.
 */
export function sectionOf(context: CaliperContext, identifier: string): CaliperEntity {
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

/**
 * Returns the candidate's attempt at the test: the candidate session.
 *
 * @param context - The session, the step and the parties.
 * @param times - The times of the attempt that the event knows.
 * @returns The entity.
 */
export function testAttempt(context: CaliperContext, times: AttemptTimes): CaliperEntity {
  return {
    id: testAttemptId(context),
    type: "Attempt",
    assignee: context.actor,
    assignable: context.assessment,
    ...times,
  };
}

/**
 * Returns the candidate's attempt at an item instance, which is part of the attempt at the test.
 *
 * @param context - The session, the step and the parties.
 * @param key - The item instance.
 * @param times - The times of the attempt that the event knows.
 * @returns The entity.
 */
export function itemAttempt(context: CaliperContext, key: ItemKey, times: AttemptTimes): CaliperEntity {
  return {
    id: mintUrn(["attempt", context.session, key.ref, key.instance]),
    type: "Attempt",
    assignee: context.actor,
    assignable: itemId(context, key),
    isPartOf: testAttemptId(context),
    ...times,
  };
}
