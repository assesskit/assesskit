import { checkFinite, checkRecord } from "../checks.js";
import type { Action, CandidateAction, HostAction } from "./action.js";
import { checkState, type DeliveryState } from "./delivery-state.js";

/**
 * Stamps an action with the time it is applied: `now` on the host's clock, but never before the latest step of the
 * session (E5, G27). A clock of the server that steps back, or another node of the server whose clock is behind, so
 * never makes the engine refuse an action as `clock-regression`; only an action stamped elsewhere, such as a log of a
 * device, can be.
 *
 * @param state - The state the action applies to.
 * @param action - The action without its time.
 * @param now - The host's clock, in epoch milliseconds.
 * @returns The action with `at` = max(`now`, `state.at`).
 * @throws `DataError` when an argument has the wrong type.
 */
export function stamp(state: DeliveryState, action: CandidateAction | HostAction, now: number): Action {
  checkState(state);
  checkRecord(action, "The action must be an object with a type");
  checkFinite(now, "The time now");
  return { ...action, at: Math.max(now, state.at) };
}
