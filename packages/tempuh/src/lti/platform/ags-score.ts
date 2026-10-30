import { checkRecord, describe } from "../../checks.js";
import { DataError } from "../../errors.js";

/** The values of `activityProgress` (LTI AGS 2.0 §3.4.7). */
const ACTIVITY_PROGRESS = ["Initialized", "Started", "InProgress", "Submitted", "Completed"] as const;
/** The values of `gradingProgress` (LTI AGS 2.0 §3.4.8). */
const GRADING_PROGRESS = ["FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"] as const;
// LTI AGS 2.0 §3.4.9: ISO 8601 with a time zone designator (`Z`, `+00:00` or `+00`) and, in the examples, a fraction of a second.
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/u;
const MS_PER_MINUTE = 60_000;

/** A score that a tool posted to a line item (LTI AGS 2.0 §3.4). */
export interface AgsScore {
  /** The `sub` of the launch: the user the score is for. */
  readonly userId: string;
  /** The score, from 0; absent when the tool clears the score. It may be higher than `scoreMaximum` (§3.4.4). */
  readonly scoreGiven?: number;
  /** The denominator of `scoreGiven`, above 0; present whenever `scoreGiven` is. */
  readonly scoreMaximum?: number;
  /** How far the user is with the activity. */
  readonly activityProgress: (typeof ACTIVITY_PROGRESS)[number];
  /** How far grading is: `FullyGraded` means the score is final; `PendingManual` waits for a person. */
  readonly gradingProgress: (typeof GRADING_PROGRESS)[number];
  /** The time of the change as the tool wrote it. */
  readonly timestamp: string;
  /** The same time in milliseconds since 1970-01-01T00:00:00Z; a later score has a larger value (§3.4.9). */
  readonly timestampMs: number;
}

/** Reads a timestamp into milliseconds since 1970-01-01T00:00:00Z, or returns `undefined` when it is not valid. */
function readTimestamp(text: string): number | undefined {
  const match = TIMESTAMP.exec(text);
  if (match === null) return undefined;
  const [, year = "", month = "", day = "", hour = "", minute = "", second = "", fraction = "", zone = ""] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = parts;
  const local = Date.UTC(y, mo - 1, d, h, mi, s, Number(fraction.padEnd(3, "0").slice(0, 3)));
  const check = new Date(local);
  const valid =
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === mo - 1 &&
    check.getUTCDate() === d &&
    check.getUTCHours() === h &&
    check.getUTCMinutes() === mi &&
    check.getUTCSeconds() === s;
  if (!valid) return undefined;
  if (zone === "Z") return local;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || "0");
  return local - sign * offset * MS_PER_MINUTE;
}

/** Returns the value if it is one of the allowed strings. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new DataError(`The ${name} of a score must be ${allowed.join(", ")}, found ${describe(value)}.`);
  }
  return found;
}

/** Reads a number that may be absent or `null`: from 0 when `positive` is false, above 0 when it is true. */
function optionalNumber(value: unknown, name: string, positive: boolean): number | undefined {
  if (value === undefined || value === null) return undefined;
  const valid = typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0);
  if (!valid) {
    throw new DataError(
      `The ${name} of a score must be a number ${positive ? "above" : "from"} 0, found ${describe(value)}.`,
    );
  }
  return value;
}

/**
 * Reads the body of a score request (media type `application/vnd.ims.lis.v1.score+json`, LTI AGS 2.0 §3.4.3). Properties
 * that it does not know, such as `comment` and the extensions of §3.1.2, are ignored.
 *
 * @throws `DataError` when it is not a score: `userId`, `timestamp`, `activityProgress` or `gradingProgress` is missing or
 * invalid; `scoreGiven` is not a number from 0; or `scoreMaximum` is absent with `scoreGiven`, or not above 0.
 */
export function readAgsScore(body: unknown): AgsScore {
  checkRecord(body, "A score must be an object");
  const { userId, timestamp } = body;
  if (typeof userId !== "string" || userId === "") {
    throw new DataError(`The userId of a score must be a non-empty string, found ${describe(userId)}.`);
  }
  const timestampMs = typeof timestamp === "string" ? readTimestamp(timestamp) : undefined;
  if (typeof timestamp !== "string" || timestampMs === undefined) {
    throw new DataError(`The timestamp of a score must be ISO 8601 with a time zone, found ${describe(timestamp)}.`);
  }
  const scoreGiven = optionalNumber(body.scoreGiven, "scoreGiven", false);
  const scoreMaximum = optionalNumber(body.scoreMaximum, "scoreMaximum", true);
  if (scoreGiven !== undefined && scoreMaximum === undefined) {
    throw new DataError("A score with a scoreGiven must have a scoreMaximum.");
  }
  return {
    userId,
    scoreGiven,
    scoreMaximum,
    activityProgress: oneOf(body.activityProgress, ACTIVITY_PROGRESS, "activityProgress"),
    gradingProgress: oneOf(body.gradingProgress, GRADING_PROGRESS, "gradingProgress"),
    timestamp,
    timestampMs,
  };
}
