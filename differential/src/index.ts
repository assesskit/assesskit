/**
 * Differential tests of olah against the Longsight `qti3-core` item engine: the cases, the oracle, and the comparison.
 *
 * @module
 */
export { CORPUS_SEED, corpusCases, SESSION_TURNS, sessionCases } from "./cases.ts";
export { compare, compareSessions, type Difference, type Report, sameValue } from "./compare.ts";
export { correctResponses, longsight, longsightRandom } from "./longsight.ts";
export type {
  Implementation,
  ItemCase,
  Observation,
  Observed,
  Play,
  Run,
  Scalar,
  SessionCase,
  Turn,
  TurnObservation,
} from "./model.ts";
export { olah } from "./olah.ts";
