/** `YYYY-MM-DD`, the form that the pattern of `DateDType` of the usage data schema allows. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DDThh:mm:ss`, a fraction of seconds and a time zone, starting with the four digits that the pattern of
 * `DateTimeDType` of the results reporting schema requires.
 */
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** A fraction of seconds that is zero, or none. */
const ZERO_FRACTION = /^(?:\.0+)?$/;

/** A signed offset `hh:mm`; `Z` is handled apart. */
const TIME_ZONE_OFFSET = /^[+-](\d{2}):(\d{2})$/;

/** The days of each month in a year that is not a leap year. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The greatest hour offset of a time zone. */
const MAX_OFFSET_HOURS = 14;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Returns whether the year, month and day name a day of the proleptic Gregorian calendar, which has no year 0. */
function isCalendarDay(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > DAYS_IN_MONTH.length || day < 1) return false;
  const leapDay = month === 2 && isLeapYear(year) ? 1 : 0;
  return day <= (DAYS_IN_MONTH[month - 1] ?? 0) + leapDay;
}

/** Returns whether a time zone is `Z` or an offset from -14:00 to +14:00. */
function isTimeZone(zone: string): boolean {
  if (zone === "Z") return true;
  const match = TIME_ZONE_OFFSET.exec(zone);
  if (match === null) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return minutes <= 59 && (hours < MAX_OFFSET_HOURS || (hours === MAX_OFFSET_HOURS && minutes === 0));
}

/** Returns whether the time of day is valid: hours to 23, minutes and seconds to 59, or 24:00:00 for the end of the day. */
function isTimeOfDay(hours: number, minutes: number, seconds: number, fraction: string): boolean {
  if (hours === 24) return minutes === 0 && seconds === 0 && ZERO_FRACTION.test(fraction);
  return hours < 24 && minutes <= 59 && seconds <= 59;
}

/**
 * Returns whether a text is a date as the usage data writes `lastUpdated`.
 *
 * @remarks
 * The form is `YYYY-MM-DD` with a four-digit year from 0001, a month and a day of that month, without a time zone. That
 * is the `xs:date` of XML Schema, restricted by the pattern of `DateDType` in the usage data schema.
 *
 * @param text - Any value; one that is not text is not a date.
 * @returns `true` for a date.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/ud-bind/index.html | QTI 3.0 Usage Data and Item Statistics}
 * @see {@link https://www.w3.org/TR/xmlschema-2/#date | XML Schema Part 2, date}
 */
export function isXsdDate(text: string): boolean {
  const match = typeof text === "string" ? DATE.exec(text) : null;
  return match !== null && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Returns whether a text is a date and time as the results reporting `datestamp` writes it.
 *
 * @remarks
 * The form is `YYYY-MM-DDThh:mm:ss` with a four-digit year from 0001, an optional fraction of seconds and an optional time
 * zone, `Z` or an offset of at most 14 hours. That is the `xs:dateTime` of XML Schema, restricted by the pattern of
 * `DateTimeDType` in the results reporting schema. `24:00:00` is the end of a day.
 *
 * @param text - Any value; one that is not text is not a date and time.
 * @returns `true` for a date and time.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 * @see {@link https://www.w3.org/TR/xmlschema-2/#dateTime | XML Schema Part 2, dateTime}
 */
export function isXsdDateTime(text: string): boolean {
  const match = typeof text === "string" ? DATE_TIME.exec(text) : null;
  if (match === null) return false;
  const [, year, month, day, hours, minutes, seconds, fraction = "", zone = "Z"] = match;
  return (
    isCalendarDay(Number(year), Number(month), Number(day)) &&
    isTimeOfDay(Number(hours), Number(minutes), Number(seconds), fraction) &&
    isTimeZone(zone)
  );
}
