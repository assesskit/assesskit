/**
 * The typed model of the assessment documents of QTI 3.0, including the content of items, stimuli and feedback, its reader
 * and writer, and the convention for externally scored test outcomes.
 *
 * @module @luthfanwakan/olah/asi
 */
export * from "./body.js";
export { readScoreCovers, type ScoreCover, scoreCoversBlock } from "./covers.js";
export { type AsiDocument, type ReadAsiOptions, readAsi, writeAsi } from "./document.js";
export * from "./model.js";
export { ASI_NAMESPACE } from "./namespace.js";
