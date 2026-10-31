import { methodsSchema, type Schema } from "../checks.js";

/** The source of the current time. The caller passes it, so that a page and a test control the time. */
export interface Clock {
  /** Returns the current time in whole milliseconds since 1970-01-01T00:00:00Z, as `Date.now()` does. */
  now(): number;
}

/** The schema of a clock: an object with a function `now`. */
export const clockSchema: Schema<Clock> = methodsSchema<Clock>("now");

/** The clock of the browser: the time of the device in epoch milliseconds. */
export const BROWSER_CLOCK: Clock = { now: () => Date.now() };
