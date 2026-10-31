import type { Clock } from "../protocol/index.js";

/** The clock of the browser: the time of the device in epoch milliseconds. */
export const BROWSER_CLOCK: Clock = { now: () => Date.now() };
