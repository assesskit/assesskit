/**
 * The typed model of the assessment documents of QTI 3.0, including the content of items, stimuli and feedback, its reader
 * and writer, and the convention for externally scored test outcomes.
 *
 * @module @assesskit/runtime/asi
 */
export * from "./body.js";
export {
  readScoreCovers,
  SCORE_COVERS_CLASS,
  type ScoreCover,
  type ScoreCoverBlock,
  type ScoreCoverEntry,
  scoreCoverBlocks,
  scoreCoversBlock,
} from "./covers.js";
export { type AsiDocument, type ReadAsiOptions, readAsi, walkDocument, writeAsi } from "./document.js";
export * from "./model.js";
export { ASI_NAMESPACE } from "./namespace.js";
export { childNodes, descendantNodes, isBodyNode, isModelNode, type ModelNode } from "./nodes.js";
export { type AreaShape, coordinateCountFits } from "./shapes.js";
export type { AttributeDef, AttributeType, StringFormat } from "./table.js";
export type { ElementVisit } from "./walk.js";
