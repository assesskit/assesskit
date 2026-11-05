import * as v from "valibot";
import { isRecord, parseWith, positiveIntegerSchema, type Schema } from "../checks.js";

/**
 * One occurrence of an item reference in a session: the identifier of the item reference and the instance, counted from
 * 1 in the order of the plan.
 *
 * @remarks
 * Selection with replacement makes several instances of one reference.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export interface ItemKey {
  /** The identifier of the item reference. */
  readonly ref: string;
  /** The position of this occurrence among the occurrences of the reference in the plan, from 1. */
  readonly instance: number;
}

/** The schema of an item instance in JSON: the two properties and no other, which no state or action holds. */
export const itemKeySchema: Schema<ItemKey> = v.strictObject({ ref: v.string(), instance: positiveIntegerSchema });

/**
 * Checks an item instance.
 *
 * @throws `DataError` when it is not an object with a string `ref` and a positive integer `instance`.
 */
export function checkKey(key: unknown): asserts key is ItemKey {
  // Every call on an item session checks its key, so a key that the schema accepts returns at once; the schema reads the
  // others, for the message of the first issue.
  const { ref, instance } = isRecord(key) ? key : {};
  if (typeof ref === "string" && typeof instance === "number" && Number.isSafeInteger(instance) && instance >= 1)
    return;
  parseWith(itemKeySchema, key, "The item instance");
}

/** Whether two keys name the same item instance. */
export function sameKey(first: ItemKey, second: ItemKey): boolean {
  return first.ref === second.ref && first.instance === second.instance;
}
