import type { Clock } from "../protocol/index.js";

/** The clock of the server: the time of the machine in epoch milliseconds. A host passes it where a session host or a gate needs the time. */
export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };
