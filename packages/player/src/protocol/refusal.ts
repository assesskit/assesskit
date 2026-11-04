import { parseWith, type Schema } from "@assesskit/runtime/checks";
import type { Refusal, RefusalReason } from "@assesskit/runtime/delivery";
import * as v from "valibot";

/**
 * The reasons of the refusals of the runtime's engine.
 *
 * @remarks
 * The tests compare the list with a record over `RefusalReason`, so that a reason that the runtime adds fails the type
 * check there until it is listed here.
 */
export const REFUSAL_REASONS = [
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
] as const satisfies readonly RefusalReason[];

/** The schema of a refusal. */
export const refusalSchema: Schema<Refusal> = v.strictObject({
  reason: v.picklist(REFUSAL_REASONS),
  message: v.string(),
});

/**
 * Checks a refusal that arrived as JSON, as the engine's `Refusal` writes it.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not an object with the properties `reason` and `message` only, `reason` one of
 * {@link REFUSAL_REASONS} and `message` a string.
 */
export function checkRefusal(value: unknown): asserts value is Refusal {
  parseWith(refusalSchema, value, "A refusal");
}
