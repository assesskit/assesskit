/**
 * The hand-off of scores between the delivery engine and its host: the submission that a rater or a scorer service reads,
 * the action that gives an external score back to the engine, and the score of a session as plain data.
 *
 * @module @assesskit/player/scoring
 */
export { buildSessionScore, type ScoringProgress, type SessionScore } from "./session-score.js";
export { buildSubmission } from "./submission.js";
export { buildSupplyScores, type ScoreInput, type SupplyScores } from "./supply-scores.js";
