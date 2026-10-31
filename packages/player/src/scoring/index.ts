/**
 * The hand-off of scores between the delivery engine and its host: the submission that a rater or a scorer service reads,
 * the action that gives an external score back to the engine, and the score of a session as plain data.
 *
 * @module @assesskit/player/scoring
 */
export { type ScoringProgress, type SessionScore, sessionScore } from "./session-score.js";
export { toSubmission } from "./submission.js";
export { type ScoreInput, type SupplyScores, toSupplyScores } from "./supply-scores.js";
