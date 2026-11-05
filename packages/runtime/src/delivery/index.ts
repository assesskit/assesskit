/**
 * The headless delivery engine: a pure reducer of candidate sessions over a test or an item, with the static gate of
 * the content, actions and refusals, navigation and submission, outcome processing, time limits and deadlines,
 * suspension, supports, variants, events and serializable states; the planning of a test session — the structure of a
 * test with its section references resolved, the selection and ordering of its items, the item instances, the order of
 * presentation in linear test parts under pre-conditions and branch rules, the inheritance of item session control, and
 * the time limits with a candidate's extra time — the item sessions: attempts, adaptive items, drafts and submitted
 * responses, review and solution, comments, PCI states, and processing failures as data — the candidate side: the
 * candidate view, which holds no answer key, processing or hidden content, and whose types and JSON forms, with the
 * limits that a server puts on the actions of its clients, `@assesskit/runtime/delivery/wire` exports — and the pending
 * work that the engine waits on the host for: scoring requests with their scorer view, the sessions of adaptive sections with a CAT engine,
 * `drainCat` and `sendCatRequest`, links to tools scored by their tool, the results report of a session, and the readers that
 * take a stored report back to the inputs of response and outcome processing.
 *
 * @module @assesskit/runtime/delivery
 */
export type { Action, HostAction } from "./action.js";
export { ADJUSTABLE_SETTINGS } from "./adjustable-settings.js";
export type {
  CatOutcome,
  CatSectionRef,
  CatSession,
  CatStatus,
  CatWait,
  ReportedItem,
} from "./cat-session.js";
export type { DeliveryDefinition, EngineOptions } from "./course.js";
export type { Deadline } from "./deadlines.js";
export type {
  CandidateNeeds,
  DeliveredItem,
  DeliveryState,
  Expiry,
  ScopeClock,
  SessionSupport,
  Step,
} from "./delivery-state.js";
export { STATE_VERSION } from "./delivery-state.js";
export { drainCat, sendCatRequest } from "./drain-cat.js";
export { createEngine, type Engine, type StartOptions } from "./engine.js";
export type { DeliveryEvent, DeliveryEventType } from "./events.js";
export type { ItemAction } from "./item-action.js";
export type { ItemSession } from "./item-session.js";
export type { CatRequest, PendingWork } from "./pending-work.js";
export {
  DEFAULT_PLAN_LIMITS,
  type ItemKey,
  type PlanLimits,
  type PlannedChild,
  type PlannedItem,
  type PlannedPart,
  type PlannedSection,
  type TestPlan,
} from "./plan.js";
export type { Refusal, RefusalReason } from "./refusal.js";
export { type ReadTestInputsOptions, readTestInputs, type TestInputs } from "./result-scope.js";
export { readItemVariables } from "./result-variables.js";
export type { ScorerItem, ScorerView } from "./scorer-view.js";
export type {
  Scorer,
  ScoringCover,
  ScoringDeclaration,
  ScoringRequest,
  SuppliedScore,
} from "./scoring.js";
export type { DeliveryStatus, ItemSessionStatus } from "./session-statuses.js";
export { stamp } from "./stamp.js";
export { deserializeState, serializeState } from "./state-json.js";
export {
  type ContentNode,
  type ItemRefNode,
  type PartNode,
  resolveStructure,
  type SectionNode,
  type StructureNode,
  type TestNode,
  type TestStructure,
} from "./structure.js";
