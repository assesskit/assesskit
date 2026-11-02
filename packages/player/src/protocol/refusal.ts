import { parseWith, type Schema } from "@assesskit/runtime/checks";
import type { Refusal, RefusalCode } from "@assesskit/runtime/delivery";
import * as v from "valibot";

/**
 * The refusal codes of the runtime's engine.
 *
 * @remarks
 * The tests compare the list with a record over `RefusalCode`, so that a code that the runtime adds fails the type
 * check there until it is listed here.
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
  "setting-not-adjustable",
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

/** The schema of a refusal. */
export const refusalSchema: Schema<Refusal> = v.strictObject({
  code: v.picklist(REFUSAL_CODES),
  message: v.string(),
});

/**
 * Checks a refusal that arrived as JSON, as the engine's `Refusal` writes it.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not an object with the properties `code` and `message` only, `code` one of
 * {@link REFUSAL_CODES} and `message` a string.
 */
export function checkRefusal(value: unknown): asserts value is Refusal {
  parseWith(refusalSchema, value, "A refusal");
}
