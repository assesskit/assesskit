import * as v from "valibot";
import { nonNegativeIntegerSchema, parseWith, recordSchema, type Schema } from "../checks.js";
import type { ItemStage } from "./model.js";

/** The schema of an item stage; a field that is absent is `null`. */
const itemStageSchema: Schema<ItemStage> = v.pipe(
  recordSchema,
  v.object({
    itemIdentifiers: v.optional(v.nullable(v.array(v.string())), null),
    stageLength: v.optional(v.nullable(nonNegativeIntegerSchema), null),
  }),
);

/**
 * Checks that a value is an item stage.
 *
 * @remarks
 * An item stage is an object whose `itemIdentifiers` are absent, `null` or an array of strings and whose `stageLength`
 * is absent, `null` or a non-negative safe integer.
 *
 * @param stage - The value to check.
 * @param noun - Names the value in the error message, such as `pool` for `The pool must be an object`.
 * @throws `DataError` when it is not an item stage.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, item stage}
 */
export function checkStage(stage: unknown, noun: string): asserts stage is ItemStage {
  parseWith(itemStageSchema, stage, `The ${noun}`);
}

/**
 * Returns whether a stage ends the session.
 *
 * @remarks
 * A stage ends the session when it is absent (`null` or `undefined`, as when a response omits `nextItems`) or lists no
 * item. The `stageLength` of such a stage does not matter, because there is nothing to present.
 *
 * @param stage - The stage of an answer, if it has one.
 * @returns `true` when there is nothing to present.
 * @throws `DataError` when the stage is not an item stage.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, item stage}
 */
export function isSessionEnd(stage: ItemStage | null | undefined): boolean {
  if (stage === null || stage === undefined) return true;
  checkStage(stage, "stage");
  return (stage.itemIdentifiers ?? []).length === 0;
}

/**
 * Reads an item stage that a CAT engine returned.
 *
 * @remarks
 * `itemIdentifiers` and `stageLength` may each be absent or `null`, which is how a stage that ends the session looks.
 *
 * @param json - The parsed JSON, which is untrusted.
 * @param noun - Names the stage in the error message, such as `nextItems of the answer` for
 * `The nextItems of the answer must be an object`.
 * @returns The stage, with an absent field as `null`.
 * @throws `DataError` when it is not an item stage.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, item stage}
 */
export function itemStageFromJson(json: unknown, noun: string): ItemStage {
  return parseWith(itemStageSchema, json, `The ${noun}`);
}
