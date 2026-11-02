import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { CandidateAction } from "./action.js";

/**
 * The types of the actions of the candidate, in the order a view lists them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const CANDIDATE_ACTION_TYPES: readonly CandidateAction["type"][] = [
  "set-responses",
  "submit",
  "end-attempt",
  "next-attempt",
  "skip",
  "review",
  "solution",
  "comment",
  "mark",
  "move",
  "support",
  "support-settings",
  "end-part",
  "end-test",
  "suspend",
  "resume",
];

/**
 * Checks the maps of a `set-responses` action: the responses by response identifier, and the states of portable custom
 * interactions when it has them.
 *
 * @throws `DataError` when one is not a `Map`.
 */
export function checkResponseMaps(action: { readonly responses?: unknown; readonly pciStates?: unknown }): void {
  if (!(action.responses instanceof Map)) {
    throw new DataError(
      `The responses of set-responses must be a Map from response identifier to value, found ${describe(action.responses)}.`,
    );
  }
  if (action.pciStates !== undefined && !(action.pciStates instanceof Map)) {
    throw new DataError(
      `The pciStates of set-responses must be a Map from response identifier to state, found ${describe(action.pciStates)}.`,
    );
  }
}
