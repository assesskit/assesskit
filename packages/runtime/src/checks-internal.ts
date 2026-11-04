// The checks of one value that only the runtime uses. `checks.ts` holds those that the player shares.
import * as v from "valibot";
import { checkRecord, describe, isRecord } from "./checks.js";
import { DataError, SecurityError } from "./errors.js";

/**
 * Checks a function's options: an object, as a caller from JavaScript may pass `null` or another value.
 *
 * @throws `DataError` when they are not.
 */
export function checkOptions(options: unknown): void {
  checkRecord(options, "The options must be an object");
}

/**
 * Checks that a value is bytes, such as the content of a file.
 *
 * @param label - Names the value in the error message, such as `The file settings`.
 * @throws `DataError` when it is not a `Uint8Array`.
 */
export function checkBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new DataError(`${label} must be a Uint8Array, found ${describe(value)}.`);
}

/**
 * Checks that a value is a finite number.
 *
 * @param label - Names the value in the error message, such as `The option tolerance`.
 * @throws `DataError` when it is not.
 */
export function checkFinite(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    throw new DataError(`${label} must be a finite number, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a finite number of at least 0.
 *
 * @param label - Names the value in the error message, such as `The option minTime`.
 * @throws `DataError` when it is not.
 */
export function checkNonNegative(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    throw new DataError(`${label} must be a non-negative number, found ${describe(value)}.`);
  }
}

/**
 * Checks that parsed JSON is not larger than a limit. Each string, number, boolean, `null`, array and object counts 1, and each
 * string and property name adds its length in code units. It counts without recursion and stops once the limit is passed, so
 * that the check costs no more than the limit, whatever the input.
 *
 * @param label - Names the JSON in the error message, such as `The action`.
 * @param name - The name of the limit, which the error carries, such as `maxActionSize`.
 * @throws `SecurityError` when the JSON is larger.
 */
export function checkJsonSize(json: unknown, limit: number, label: string, name: string): void {
  const pending: unknown[] = [json];
  let size = 0;
  while (pending.length > 0 && size <= limit) {
    const value = pending.pop();
    size += 1;
    if (typeof value === "string") size += value.length;
    else if (Array.isArray(value)) for (const member of value) pending.push(member);
    else if (isRecord(value)) {
      for (const [property, member] of Object.entries(value)) {
        size += property.length;
        pending.push(member);
      }
    }
  }
  if (size > limit) throw new SecurityError(`${label} is larger than the limit ${name} of ${limit}.`, name, limit);
}

/**
 * Checks a seed.
 *
 * @throws `DataError` when it is not a safe integer.
 */
export function checkSeed(seed: unknown): asserts seed is number {
  if (!(typeof seed === "number" && Number.isSafeInteger(seed))) {
    throw new DataError(`A seed must be a safe integer, found ${describe(seed)}.`);
  }
}

/** A finite number of at least 0. */
export const nonNegativeSchema = v.pipe(v.number(), v.finite(), v.minValue(0));
