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
  "move",
  "support",
  "end-part",
  "end-test",
  "suspend",
  "resume",
];
