/**
 * The compiler of an item's keys into QTI response processing: response declarations with their correct responses and
 * mappings, `SCORE`, `MAXSCORE`, the score of each response and `FEEDBACK`, written with QTI's own expressions where they
 * score a key exactly and with the operators of `@assesskit/runtime/operators` where they cannot.
 *
 * @module @assesskit/runtime/scoring
 */
export { compileScoring } from "./compile-scoring.js";
export type { CompileScoringOptions, InteractionAttributes, ItemScoring, MatchMax } from "./item-scoring.js";
