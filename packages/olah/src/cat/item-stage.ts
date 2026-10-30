import * as v from "valibot";
import { nonNegativeIntegerSchema, parseWith, recordSchema, type Schema } from "../checks.js";
import type { ItemStage } from "./model.js";

/** The schema of an item stage; a field that is absent is `null`. */
export const itemStageSchema: Schema<ItemStage> = v.pipe(
  recordSchema,
  v.object({
    itemIdentifiers: v.optional(v.nullable(v.array(v.string())), null),
    stageLength: v.optional(v.nullable(nonNegativeIntegerSchema), null),
  }),
);

/**
 * Checks that a value is an item stage: an object whose `itemIdentifiers` are absent, `null` or an array of strings and
 * whose `stageLength` is absent, `null` or a non-negative safe integer (CAT §4.2).
 *
 * @param noun - Names the value in the error message, such as `pool` for `The pool must be an object`.
 * @throws `DataError` when it is not.
 */
export function checkStage(stage: unknown, noun: string): asserts stage is ItemStage {
  parseWith(itemStageSchema, stage, `The ${noun}`);
}

/**
 * Returns whether a stage ends the session: it is absent (`null` or `undefined`, as when a response omits `nextItems`) or
 * lists no item. The `stageLength` of such a stage does not matter, because there is nothing to present (CAT §3.4, §4.2).
 *
 * @throws `DataError` when the stage is not an item stage.
 */
export function isSessionEnd(stage: ItemStage | null | undefined): boolean {
  if (stage === null || stage === undefined) return true;
  checkStage(stage, "stage");
  return (stage.itemIdentifiers ?? []).length === 0;
}
