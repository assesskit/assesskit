import { checkFunction, checkNonNegativeInteger, checkRecord } from "../checks.js";

/**
 * The leeway for clock skew between the platform and the tool, in seconds. Security Framework §5.1.2 allows "some small
 * leeway, usually no more than a few minutes".
 */
export const CLOCK_SKEW_SECONDS = 60;

/** The source of the current time. The caller passes it, so that a host and a test control the time. */
export interface Clock {
  /** Returns the current time in whole milliseconds since 1970-01-01T00:00:00Z, as `Date.now()` does. */
  now(): number;
}

/**
 * Checks a clock, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a function `now`.
 */
export function checkClock(value: unknown): asserts value is Clock {
  checkRecord(value, "The option clock must be an object");
  checkFunction(value.now, "The function now of the option clock must be a function");
}

/**
 * Reads the time from a clock that has been checked.
 *
 * @throws `DataError` when the clock does not answer with a non-negative integer.
 */
export function readClock(clock: Clock): number {
  const now = clock.now();
  checkNonNegativeInteger(now, "The time of the clock");
  return now;
}
