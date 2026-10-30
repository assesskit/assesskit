/**
 * The typed model of the assessment documents of QTI 3.0, its reader and writer, and the convention for externally scored
 * test outcomes.
 *
 * @module @luthfanwakan/olah/asi
 */
export { readScoreCovers, type ScoreCover, scoreCoversBlock } from "./covers.js";
export { type AsiDocument, type ReadAsiOptions, readAsi, writeAsi } from "./document.js";
export * from "./model.js";
export { ASI_NAMESPACE } from "./namespace.js";
