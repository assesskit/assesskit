// The checks of one value that only the runtime uses. `checks.ts` holds those that the player shares.
import * as v from "valibot";
import { checkRecord, describe } from "./checks.js";
import { DataError } from "./errors.js";

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
