/**
 * Differential tests of olah against the Longsight `qti3-core` item engine: the cases, the oracle, and the comparison.
 *
 * @module
 */
export { CORPUS_SEED, corpusCases } from "./cases.ts";
export { compare, type Difference, type Report, sameValue } from "./compare.ts";
export { correctResponses, longsight } from "./longsight.ts";
export type { Implementation, ItemCase, Observation, Observed, Run, Scalar } from "./model.ts";
