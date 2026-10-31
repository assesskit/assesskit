import { DataError } from "@assesskit/runtime/errors";

/**
 * The last millisecond of the year 9999, in epoch milliseconds: the latest time that the form `YYYY-MM-DDTHH:mm:ss.SSSZ`
 * of Caliper 1.2 can write.
 */
const LAST_TIME = 253_402_300_799_999;

/**
 * Writes a time as Caliper requires: millisecond precision, UTC, no offset.
 *
 * @param at - Epoch milliseconds, from 0 to the end of the year 9999.
 * @param label - Names the time in the error message, such as `The time of an event`.
 * @returns The time as `YYYY-MM-DDTHH:mm:ss.SSSZ`.
 * @throws `DataError` when it is not epoch milliseconds in that range.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function caliperTime(at: unknown, label: string): string {
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > LAST_TIME) {
    throw new DataError(
      `${label} must be epoch milliseconds from 1970 to the end of the year 9999, found ${String(at)}.`,
    );
  }
  return new Date(at).toISOString();
}
