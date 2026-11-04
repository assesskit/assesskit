import { describe } from "../checks.js";
import { checkFinite } from "../checks-internal.js";
import { DataError } from "../errors.js";

/** The time `0001-01-01T00:00:00.000Z` in epoch milliseconds, the first that a datestamp with a four-digit year can show. */
const FIRST_INSTANT = -62_135_596_800_000;

/** The time `9999-12-31T23:59:59.999Z` in epoch milliseconds, the last that a datestamp with a four-digit year can show. */
const LAST_INSTANT = 253_402_300_799_999;

/**
 * Checks a time of the engine: epoch milliseconds, between the years 1 and 9999, so that a results report can write it
 * as a datestamp (RR `DateTimeDType`).
 *
 * @param label - Names the time in the error message, such as `The time of the action`.
 * @throws `DataError` when it is not a finite number in that range.
 */
export function checkInstant(value: unknown, label: string): asserts value is number {
  checkFinite(value, label);
  if (value < FIRST_INSTANT || value > LAST_INSTANT) {
    throw new DataError(
      `${label} must be epoch milliseconds from the year 1 to the year 9999, found ${describe(value)}.`,
    );
  }
}

/**
 * Returns a time as a datestamp: RFC 3339 `date-time` in UTC with milliseconds, such as `2026-10-30T12:00:00.000Z`.
 *
 * @remarks
 * The offset is always written because the JSON binding of CAT 1.0 declares `datestamp` as `format: date-time` while an
 * `xs:dateTime` of Results Reporting may lack one; the form is an `xs:dateTime` too, so the same text fills a report in
 * either binding.
 */
export function datestampOf(instant: number): string {
  return new Date(instant).toISOString();
}
