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
 * Checks that a value is a record, such as an envelope.
 *
 * @param message - Says what the value should be, such as `The caller must be an object`.
 * @throws `DataError` when it is not.
 */
export function checkRecord(value: unknown, message: string): asserts value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is an array, such as a list of origins.
 *
 * @param message - Says what the value should be, such as `The origins must be an array`.
 * @throws `DataError` when it is not.
 */
export function checkArray(value: unknown, message: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is a function, such as a listener.
 *
 * @param message - Says what the value should be, such as `The listener must be a function`.
 * @throws `DataError` when it is not.
 */
export function checkFunction(value: unknown, message: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a record has no property but the given ones.
 *
 * @param label - Names the record in the error message, such as `An action envelope`.
 * @param known - The names of the properties it may have.
 * @throws `DataError` when it has another property.
 */
export function checkProperties(
  value: Readonly<Record<string, unknown>>,
  label: string,
  known: readonly string[],
): void {
  const unexpected = Object.keys(value).find((key) => !known.includes(key));
  if (unexpected === undefined) return;
  const quoted = known.map((key) => JSON.stringify(key));
  throw new DataError(
    `${label} has the properties ${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}, found ${describe(unexpected)}.`,
  );
}

/**
 * Checks that a value is a string.
 *
 * @param label - Names the value in the error message, such as `The option language`.
 * @throws `DataError` when it is not.
 */
export function checkString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new DataError(`${label} must be a string, found ${describe(value)}.`);
}

/**
 * Checks that a value is a string of at least one character, such as an identifier.
 *
 * @param label - Names the value in the error message, such as `The session of a caller`.
 * @throws `DataError` when it is not.
 */
export function checkNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "") {
    throw new DataError(`${label} must be a non-empty string, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a safe integer of at least 0, such as a sequence number.
 *
 * @param label - Names the value in the error message, such as `The property seq`.
 * @throws `DataError` when it is not.
 */
export function checkNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    throw new DataError(`${label} must be a non-negative integer, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a safe integer of at least 1, such as a time limit.
 *
 * @param label - Names the value in the error message, such as `The option timeoutMs`.
 * @throws `DataError` when it is not.
 */
export function checkPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    throw new DataError(`${label} must be a positive integer, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a boolean.
 *
 * @param label - Names the value in the error message, such as `The property active`.
 * @throws `DataError` when it is not.
 */
export function checkBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new DataError(`${label} must be true or false, found ${describe(value)}.`);
}

/**
 * Checks that a value is a finite number greater than 0, such as a length.
 *
 * @param label - Names the value in the error message, such as `The property minimumLength`.
 * @throws `DataError` when it is not.
 */
export function checkPositive(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw new DataError(`${label} must be a positive number, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is one of the given strings, such as a unit.
 *
 * @param label - Names the value in the error message, such as `The property unit`.
 * @param allowed - The strings it may be, at least two.
 * @throws `DataError` when it is not.
 */
export function checkChoice<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): asserts value is T {
  if (allowed.some((choice) => choice === value)) return;
  const quoted = allowed.map((choice) => JSON.stringify(choice));
  throw new DataError(
    `${label} must be ${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}, found ${describe(value)}.`,
  );
}
