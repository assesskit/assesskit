import type { RefusalCode } from "@luthfanwakan/olah/delivery";
import type { Messages } from "../../messages/index.js";

/**
 * The message for every refusal code of olah's engine (T55). It is a record over the whole type, so that a code that
 * olah adds fails the type check until its message exists.
 */
export const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, keyof Messages>> = {
  "attempts-exhausted": "refusalAttemptsExhausted",
  "awaiting-cat": "refusalAwaitingCat",
  "clock-regression": "refusalClockRegression",
  "comment-not-allowed": "refusalCommentNotAllowed",
  ended: "refusalEnded",
  "invalid-response": "refusalInvalidResponse",
  "item-closed": "refusalItemClosed",
  "linear-backward": "refusalLinearBackward",
  "min-time-not-reached": "refusalMinTimeNotReached",
  "not-current": "refusalNotCurrent",
  "review-not-allowed": "refusalReviewNotAllowed",
  "score-type-mismatch": "refusalScoreTypeMismatch",
  "skipping-not-allowed": "refusalSkippingNotAllowed",
  "solution-not-allowed": "refusalSolutionNotAllowed",
  "support-not-available": "refusalSupportNotAvailable",
  suspended: "refusalSuspended",
  "time-over": "refusalTimeOver",
  "unknown-item": "refusalUnknownItem",
  "unknown-request": "refusalUnknownRequest",
  "value-out-of-range": "refusalValueOutOfRange",
  "wrong-submission-mode": "refusalWrongSubmissionMode",
};
