import { checkFunction, checkRecord } from "../checks.js";

/** The source of the current time. The caller passes it, so that a page and a test control the time. */
export interface Clock {
  /** Returns the current time in whole milliseconds since 1970-01-01T00:00:00Z, as `Date.now()` does. */
  now(): number;
}

/** The clock of the browser: the time of the device in epoch milliseconds. */
export const BROWSER_CLOCK: Clock = { now: () => Date.now() };

/**
 * Checks a clock, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a function `now`.
 */
export function checkClock(value: unknown): asserts value is Clock {
  checkRecord(value, "The option clock must be an object");
  checkFunction(value.now, "The function now of the option clock must be a function");
}
