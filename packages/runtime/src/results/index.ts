/**
 * Results Reporting (RR): the model of a report on a candidate's assessment session, and a reader and writer for its XML
 * binding.
 *
 * @module @assesskit/runtime/results
 */
export type {
  AssessmentResult,
  ContextVariable,
  ItemResult,
  OutcomeVariable,
  ResponseVariable,
  ResultContext,
  ResultCorrectResponse,
  ResultVariable,
  ResultVariableType,
  SessionIdentifier,
  SupportUse,
  TemplateVariable,
  TestResult,
  ValuedResultVariable,
} from "./model.js";
export { RESULTS_NAMESPACE } from "./namespace.js";
export { readResults } from "./read-results.js";
export {
  type AnsweredStatus,
  OUTCOME_SCORERS,
  type OutcomeScorer,
  type OutcomeView,
  type ScoreStatus,
  type SessionStatus,
  type SupportAssignment,
} from "./vocabularies.js";
export { writeResults } from "./write-results.js";
