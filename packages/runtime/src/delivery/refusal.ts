/**
 * Why the engine refuses an action that is well formed but that the rules do not allow.
 *
 * @remarks
 * The delivery guide lists the codes and says when each is given.
 */
export type RefusalCode =
  | "attempts-exhausted"
  | "awaiting-cat"
  | "clock-regression"
  | "comment-not-allowed"
  | "ended"
  | "invalid-response"
  | "item-closed"
  | "linear-backward"
  | "min-time-not-reached"
  | "not-current"
  | "review-not-allowed"
  | "score-type-mismatch"
  | "skipping-not-allowed"
  | "solution-not-allowed"
  | "support-not-available"
  | "suspended"
  | "time-over"
  | "unknown-item"
  | "unknown-request"
  | "value-out-of-range"
  | "wrong-submission-mode";

/** The engine's answer to a well-formed action that the rules do not allow; the state stays as it was. */
export interface Refusal {
  /** Why the action is refused. */
  readonly code: RefusalCode;
  /** A sentence that says what the rule demands. */
  readonly message: string;
}

/** Returns a refusal. */
export function refusal(code: RefusalCode, message: string): Refusal {
  return { code, message };
}

/** Returns a refused step. */
export function refuse(code: RefusalCode, message: string): { readonly ok: false; readonly refusal: Refusal } {
  return { ok: false, refusal: refusal(code, message) };
}
