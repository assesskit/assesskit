import { checkRecord } from "../checks.js";
import { checkFinite } from "../checks-internal.js";
import type { Action, CandidateAction, HostAction } from "./action.js";
import { checkAction } from "./action-check.js";
import { checkState, type DeliveryState } from "./delivery-state.js";

/**
 * Stamps an action with the time it is applied: `now` on the host's clock, but never before the latest step of the
 * session.
 *
 * @remarks
 * A clock of the server that steps back, or another node of the server whose clock is behind, so never makes the engine
 * refuse an action as `clock-regression`; only an action stamped elsewhere, such as a log of a device, can be.
 *
 * @param state - The state the action applies to.
 * @param action - The action without its time; a time it has is replaced. A server passes the result of
 * `readCandidateAction`, which has none.
 * @param now - The host's clock, in epoch milliseconds.
 * @returns The action with `at` = max(`now`, `state.at`).
 * @throws `DataError` when an argument has the wrong type, or the action is not an action.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function stamp(state: DeliveryState, action: CandidateAction | HostAction, now: number): Action {
  checkState(state);
  checkRecord(action, "The action must be an object with a type");
  checkFinite(now, "The time now");
  const stamped = { ...action, at: Math.max(now, state.at) };
  checkAction(stamped);
  return stamped;
}
