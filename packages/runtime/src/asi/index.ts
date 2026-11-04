/**
 * The typed model of the assessment documents of QTI 3.0, including the content of items, stimuli and feedback, its reader
 * and writer, and the conventions for externally scored outcomes: the covers of a test and the scoring rubric.
 *
 * @module @assesskit/runtime/asi
 */
export * from "./body.js";
export type { RubricBlockOptions, RubricContent, RubricNotes } from "./convention-markup.js";
export { buildScoreCoversBlock, readScoreCovers, type ScoreCover } from "./covers.js";
export { type AsiDocument, type ReadAsiOptions, readAsi, writeAsi } from "./document.js";
export * from "./model.js";
export { ASI_NAMESPACE } from "./namespace.js";
export { isModelNode, listChildNodes, listDescendantNodes, type ModelNode } from "./nodes.js";
export { type RubricRating, type RubricScoreRange, rubricScore, rubricScoreRange } from "./rubric-ratings.js";
export {
  checkScoringRubric,
  RUBRIC_KINDS,
  type RubricCriterion,
  type RubricKind,
  type RubricLevel,
  type ScoringRubric,
} from "./scoring-rubric.js";
export { buildScoringRubricBlock, readScoringRubrics, type ScoringRubricBlock } from "./scoring-rubric-block.js";
export { type AreaShape, fitsCoordinateCount } from "./shapes.js";
