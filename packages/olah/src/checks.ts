import { DataError } from "./errors.js";

/**
 * Describes a value in a message: strings quoted; arrays, functions and other objects as "an array", "a function" and
 * "an object"; other values as `String` prints them.
 */
export function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "function") return "a function";
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

/** Returns whether a value is an object that is neither `null` nor an array. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that a value is a record, such as a set of limits.
 *
 * @param message - Says what the value should be, such as `The limits must be an object`.
 * @throws `DataError` when it is not.
 */
export function checkRecord(value: unknown, message: string): void {
  if (!isRecord(value)) throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is an array, such as a list of issues.
 *
 * @param message - Says what the value should be, such as `The issues must be an array`.
 * @throws `DataError` when it is not.
 */
export function checkArray(value: unknown, message: string): void {
  if (!Array.isArray(value)) throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks a function's options: an object, as a caller from JavaScript may pass `null` or another value.
 *
 * @throws `DataError` when they are not.
 */
export function checkOptions(options: unknown): void {
  checkRecord(options, "The options must be an object");
}

/**
 * Checks that a value is a function, such as a resolver.
 *
 * @param message - Says what the value should be, such as `The option resolve must be a function of an href and a base`.
 * @throws `DataError` when it is not.
 */
export function checkFunction(value: unknown, message: string): void {
  if (typeof value !== "function") throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is a string, such as an href.
 *
 * @param label - Names the value in the error message, such as `The option path`.
 * @throws `DataError` when it is not.
 */
export function checkString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new DataError(`${label} must be a string, found ${describe(value)}.`);
}

/**
 * Checks that a value is a boolean.
 *
 * @param label - Names the value in the error message, such as `The option allowLateSubmission`.
 * @throws `DataError` when it is not.
 */
export function checkBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new DataError(`${label} must be a boolean, found ${describe(value)}.`);
}

/**
 * Checks that a value is one of the given strings.
 *
 * @param label - Names the value in the error message, such as `The option severity`.
 * @throws `DataError` when it is not.
 */
export function checkChoice(value: unknown, label: string, choices: readonly string[]): void {
  if (!choices.some((choice) => choice === value)) {
    const quoted = choices.map((choice) => JSON.stringify(choice));
    const list = `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
    throw new DataError(`${label} must be ${list}, found ${describe(value)}.`);
  }
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
 * Checks that a value is a safe integer of at least 1, such as a size limit.
 *
 * @param label - Names the value in the error message, such as `The option maxBytes`.
 * @throws `DataError` when it is not.
 */
export function checkPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    throw new DataError(`${label} must be a positive integer, found ${describe(value)}.`);
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
