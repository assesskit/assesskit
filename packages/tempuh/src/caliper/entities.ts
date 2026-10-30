import type { ItemKey } from "@luthfanwakan/olah/delivery";
import type { CaliperContext } from "./context.js";
import type { CaliperEntity } from "./model.js";
import { mintUrn } from "./uuid.js";

/** The times of an attempt, when the event knows them. */
export type AttemptTimes = Pick<CaliperEntity, "startedAtTime" | "endedAtTime">;

/** Returns a person, named by the IRI the host gave. */
export function person(id: string): CaliperEntity {
  return { id, type: "Person" };
}

/** Returns the test as an assessment, named by the IRI the host gave. */
export function assessmentOf(context: CaliperContext): CaliperEntity {
  return { id: context.assessment, type: "Assessment" };
}

/** Returns the IRI of an item: the same in every session of the test, because the test and the item reference name it. */
function itemId(context: CaliperContext, key: ItemKey): Promise<string> {
  return mintUrn(["item", context.assessment, key.ref]);
}

/** Returns the item of an item reference, named by the identifier of the reference. */
export async function itemOf(context: CaliperContext, key: ItemKey): Promise<CaliperEntity> {
  return { id: await itemId(context, key), type: "AssessmentItem", name: key.ref, isPartOf: context.assessment };
}

/**
 * Returns a section of the test. Caliper's Assessment Profile has no section, and a section is a group of items that is part
 * of the test, so it is an assessment that is part of the assessment.
 */
export async function sectionOf(context: CaliperContext, identifier: string): Promise<CaliperEntity> {
  return {
    id: await mintUrn(["section", context.assessment, identifier]),
    type: "Assessment",
    name: identifier,
    isPartOf: context.assessment,
  };
}

/** Returns the IRI of the attempt at the test, which is the candidate session. */
function testAttemptId(context: CaliperContext): Promise<string> {
  return mintUrn(["attempt", context.session]);
}

/** Returns the candidate's attempt at the test: the candidate session. */
export async function testAttempt(context: CaliperContext, times: AttemptTimes): Promise<CaliperEntity> {
  return {
    id: await testAttemptId(context),
    type: "Attempt",
    assignee: context.actor,
    assignable: context.assessment,
    ...times,
  };
}

/** Returns the candidate's attempt at an item instance, which is part of the attempt at the test. */
export async function itemAttempt(context: CaliperContext, key: ItemKey, times: AttemptTimes): Promise<CaliperEntity> {
  return {
    id: await mintUrn(["attempt", context.session, key.ref, key.instance]),
    type: "Attempt",
    assignee: context.actor,
    assignable: await itemId(context, key),
    isPartOf: await testAttemptId(context),
    ...times,
  };
}
