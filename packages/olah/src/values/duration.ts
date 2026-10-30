import { checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/**
 * An ISO 8601 duration as XML Schema writes it, with weeks: years, months, weeks, days, and after `T` hours, minutes and
 * seconds with an optional fraction. Every part is optional here; `parseIsoDuration` requires one.
 */
const ISO_DURATION =
  /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Returns a number the way `Number.prototype.toString` does, but without an exponent. */
function plainDecimal(value: number): string {
  const text = String(value);
  const [mantissa = "", exponent] = text.split("e");
  if (exponent === undefined) return text;
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const pointAt = whole.length + Number(exponent);
  if (pointAt <= 0) return `0.${"0".repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length) return digits + "0".repeat(pointAt - digits.length);
  return `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

/**
 * Writes a finite duration in seconds as the ISO 8601 duration `PT<seconds>S`, with the shortest decimal that reads back
 * as the same number and a leading `-` for a negative one. It uses no parts above seconds, so it has no years or months,
 * whose length in seconds is not fixed (G14).
 */
export function formatIsoDuration(seconds: number): string {
  return `${seconds < 0 ? "-" : ""}PT${plainDecimal(Math.abs(seconds))}S`;
}

/** The parts of an ISO 8601 duration as the text gives them; `undefined` for a part that is absent. */
interface DurationParts {
  readonly negative: boolean;
  readonly years?: string;
  readonly months?: string;
  readonly weeks?: string;
  readonly days?: string;
  readonly hours?: string;
  readonly minutes?: string;
  readonly seconds?: string;
}

/** Splits a duration into its parts, or returns `undefined` when the text is not one: no parts, or a `T` without time. */
function splitDuration(text: string): DurationParts | undefined {
  const match = ISO_DURATION.exec(text);
  if (match === null) return undefined;
  const [, sign, years, months, weeks, days, hours, minutes, seconds] = match;
  const time = [hours, minutes, seconds].some((part) => part !== undefined);
  const date = [years, months, weeks, days].some((part) => part !== undefined);
  if (!(date || time) || (text.includes("T") && !time)) return undefined;
  return { negative: sign !== undefined, years, months, weeks, days, hours, minutes, seconds };
}

/**
 * Reads an ISO 8601 duration into seconds. Weeks, days, hours and minutes have fixed lengths of 7 days, 24 hours, 60 minutes
 * and 60 seconds; only the seconds may have a fraction. Years and months have no fixed length, so they are refused, as
 * in the example of BPIG Appendix C.1, `P10Y3M20DT4H30M25S` (G14, G39).
 *
 * @throws `DataError` when the text is not a duration, or has years or months.
 */
export function parseIsoDuration(text: string): number {
  checkString(text, "The duration");
  const parts = splitDuration(text);
  if (parts === undefined)
    throw new DataError(`The text ${describe(text)} is not an ISO 8601 duration such as PT1H30M.`);
  if (parts.years !== undefined || parts.months !== undefined) {
    throw new DataError(
      `The duration ${describe(text)} has years or months, which have no fixed length in seconds: write days, hours, minutes and seconds.`,
    );
  }
  const total =
    Number(parts.weeks ?? 0) * SECONDS_PER_WEEK +
    Number(parts.days ?? 0) * SECONDS_PER_DAY +
    Number(parts.hours ?? 0) * SECONDS_PER_HOUR +
    Number(parts.minutes ?? 0) * SECONDS_PER_MINUTE +
    Number(parts.seconds ?? 0);
  if (!Number.isFinite(total))
    throw new DataError(`The duration ${describe(text)} is too long to be a number of seconds.`);
  return parts.negative ? -total : total;
}
