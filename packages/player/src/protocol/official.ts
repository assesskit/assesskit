import type { AssessmentResult } from "@assesskit/runtime/results";

declare const official: unique symbol;

/**
 * The results report of an official session: the one that `SessionHost.results` returned. The brand exists in the type
 * only; {@link isOfficialResult} proves it at run time, so a copy of a report or the report of a practice session is not
 * official.
 */
export type OfficialResult = AssessmentResult & {
  /** The brand, which exists in the type only. */
  readonly [official]: true;
};

/** The reports that {@link markOfficial} returned. Only this file reaches the set. */
const OFFICIAL_RESULTS = new WeakSet<object>();

/**
 * Brands a results report as official. Only the session host calls it, on the report of a session it ran (the player design
 * §2.3); `server/` and `lti/` are the folders that import this file.
 *
 * @param result - A report that `Engine.results` assembled.
 * @returns The same object, now official.
 */
export function markOfficial(result: AssessmentResult): OfficialResult {
  OFFICIAL_RESULTS.add(result);
  // The brand has no runtime form, so the type assertion only names what the set records.
  return result as OfficialResult;
}

/**
 * Tells whether a value is a report that the session host branded as official. A structural copy, and a report from anywhere else,
 * is not.
 */
export function isOfficialResult(value: unknown): value is OfficialResult {
  return typeof value === "object" && value !== null && OFFICIAL_RESULTS.has(value);
}
