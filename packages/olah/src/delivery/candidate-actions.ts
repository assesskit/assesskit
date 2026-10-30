import type { CandidateAction } from "./action.js";

/** The types of the actions of the candidate, in the order a view lists them (INFO §2.2.1, §2.8). */
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
