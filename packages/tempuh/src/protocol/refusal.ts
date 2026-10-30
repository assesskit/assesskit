import type { Refusal, RefusalCode } from "@luthfanwakan/olah/delivery";
import { checkChoice, checkProperties, checkRecord, checkString } from "../checks.js";

/**
 * The refusal codes of olah's engine. The tests compare the list with a record over `RefusalCode`, so that a code that
 * olah adds fails the type check there until it is listed here.
 */
export const REFUSAL_CODES = [
  "attempts-exhausted",
  "awaiting-cat",
  "clock-regression",
  "comment-not-allowed",
  "ended",
  "invalid-response",
  "item-closed",
  "linear-backward",
  "min-time-not-reached",
  "not-current",
  "review-not-allowed",
  "score-type-mismatch",
  "skipping-not-allowed",
  "solution-not-allowed",
  "support-not-available",
  "suspended",
  "time-over",
  "unknown-item",
  "unknown-request",
  "value-out-of-range",
  "wrong-submission-mode",
] as const satisfies readonly RefusalCode[];

/**
 * Checks a refusal that arrived as JSON, as the engine's `Refusal` writes it.
 *
 * @throws `DataError` when it is not an object with the properties `code`, `message` and `source` only, `code` one of
 * {@link REFUSAL_CODES} and the others strings.
 */
export function checkRefusal(value: unknown): asserts value is Refusal {
  checkRecord(value, "A refusal must be an object");
  checkProperties(value, "A refusal", ["code", "message", "source"]);
  checkChoice(value.code, "The property code of a refusal", REFUSAL_CODES);
  checkString(value.message, "The property message of a refusal");
  checkString(value.source, "The property source of a refusal");
}
