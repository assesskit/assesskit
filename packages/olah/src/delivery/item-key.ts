import { checkPositiveInteger, checkRecord, checkString } from "../checks.js";

/**
 * One occurrence of an item reference in a session: the identifier of the item reference and the instance, counted
 * from 1 in the order of the plan. Selection with replacement makes several instances of one reference (INFO
 * §2.11.1.2, E11).
 */
export interface ItemKey {
  /** The identifier of the item reference. */
  readonly ref: string;
  /** The position of this occurrence among the occurrences of the reference in the plan, from 1. */
  readonly instance: number;
}

/**
 * Checks an item instance.
 *
 * @throws `DataError` when it is not an object with a string `ref` and a positive integer `instance`.
 */
export function checkKey(key: unknown): asserts key is ItemKey {
  checkRecord(key, "The item instance must be an object with a ref and an instance");
  checkString(key.ref, "The ref of the item instance");
  checkPositiveInteger(key.instance, "The instance of the item instance");
}

/** Whether two keys name the same item instance. */
export function sameKey(first: ItemKey, second: ItemKey): boolean {
  return first.ref === second.ref && first.instance === second.instance;
}
