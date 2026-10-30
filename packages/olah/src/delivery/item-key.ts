import * as v from "valibot";
import { parseWith, positiveIntegerSchema, type Schema } from "../checks.js";

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

/** The schema of an item instance in JSON; it reads the two properties and no other. */
export const itemKeySchema: Schema<ItemKey> = v.object({ ref: v.string(), instance: positiveIntegerSchema });

/**
 * Checks an item instance.
 *
 * @throws `DataError` when it is not an object with a string `ref` and a positive integer `instance`.
 */
export function checkKey(key: unknown): asserts key is ItemKey {
  parseWith(itemKeySchema, key, "The item instance");
}

/** Whether two keys name the same item instance. */
export function sameKey(first: ItemKey, second: ItemKey): boolean {
  return first.ref === second.ref && first.instance === second.instance;
}
