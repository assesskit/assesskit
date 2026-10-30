import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { ItemStage } from "./model.js";

/**
 * Checks that a value is an item stage: an object whose `itemIdentifiers` are absent, `null` or an array of strings and
 * whose `stageLength` is absent, `null` or a non-negative safe integer (CAT §4.2).
 *
 * @param noun - Names the value in the error message, such as `pool` for `The pool must be an object`.
 * @throws `DataError` when it is not.
 */
export function checkStage(stage: unknown, noun: string): asserts stage is ItemStage {
  checkRecord(stage, `The ${noun} must be an object`);
  const { itemIdentifiers = null, stageLength = null } = stage;
  if (itemIdentifiers !== null) {
    checkArray(itemIdentifiers, `The itemIdentifiers of the ${noun} must be an array or null`);
    for (const identifier of itemIdentifiers) checkString(identifier, `An item identifier of the ${noun}`);
  }
  if (
    stageLength !== null &&
    !(typeof stageLength === "number" && Number.isSafeInteger(stageLength) && stageLength >= 0)
  ) {
    throw new DataError(
      `The stageLength of the ${noun} must be a non-negative integer or null, found ${describe(stageLength)}.`,
    );
  }
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
