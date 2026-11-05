import {
  checkFunction,
  checkNonNegativeInteger,
  checkRecord,
  methodsSchema,
  type Schema,
} from "@assesskit/runtime/checks";

/**
 * The longest delay in milliseconds that `setTimeout` and `setInterval` take, 2^31 - 1; a longer one fires at once.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers | HTML Standard, timers}
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The source of the current time. The caller passes it, so that a page, a server and a test control the time. */
export interface Clock {
  /**
   * Returns the current time.
   *
   * @returns Whole milliseconds since 1970-01-01T00:00:00Z, as `Date.now()` does.
   */
  now(): number;
}

/**
 * The clock of the machine, the time of the device or the server in epoch milliseconds: the default of every `clock`
 * option, and the one place where the player reads the time.
 */
export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/** The schema of a clock: an object with a function `now`. */
export const clockSchema: Schema<Clock> = methodsSchema<Clock>("now");

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
