/**
 * Every reason that the engine gives for refusing an action, in alphabetical order: a client that shows a message for each
 * reads them here.
 *
 * @remarks
 * The delivery guide lists the reasons and says when each is given.
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
] as const;

/**
 * Why the engine refuses an action that is well formed but that the rules do not allow: a term of
 * {@link REFUSAL_REASONS}.
 */
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** The engine's answer to a well-formed action that the rules do not allow; the state stays as it was. */
export interface Refusal {
  /** Why the action is refused. */
  readonly reason: RefusalReason;
  /** A sentence that says what the rule demands. */
  readonly message: string;
}

/** Returns a refusal. */
export function refusal(reason: RefusalReason, message: string): Refusal {
  return { reason, message };
}

/** Returns a refused step. */
export function refuse(reason: RefusalReason, message: string): { readonly ok: false; readonly refusal: Refusal } {
  return { ok: false, refusal: refusal(reason, message) };
}
