/**
 * The hand-off of externally scored outcomes: the submission that a rater or a scorer service reads, and the action that
 * gives the score back to the delivery engine.
 *
 * @module @luthfanwakan/tempuh/scoring
 */
export { toSubmission } from "./submission.js";
export { type ScoreInput, type SupplyScores, toSupplyScores } from "./supply-scores.js";
