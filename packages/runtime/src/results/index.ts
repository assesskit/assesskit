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
  ANSWERED_STATUSES,
  type AnsweredStatus,
  OUTCOME_SCORERS,
  OUTCOME_VIEWS,
  type OutcomeScorer,
  type OutcomeView,
  SCORE_STATUSES,
  type ScoreStatus,
  SESSION_STATUSES,
  type SessionStatus,
  SUPPORT_ASSIGNMENTS,
  type SupportAssignment,
} from "./vocabularies.js";
export { writeResults } from "./write-results.js";
