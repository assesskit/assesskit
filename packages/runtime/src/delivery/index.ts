/**
 * The headless delivery engine: a pure reducer of candidate sessions over a test or an item, with the static gate of
 * the content, actions and refusals, navigation and submission, outcome processing, time limits and deadlines,
 * suspension, supports, variants, events and serializable states; the planning of a test session — the structure of a
 * test with its section references resolved, the selection and ordering of its items, the item instances, the order of
 * presentation in linear test parts under pre-conditions and branch rules, the inheritance of item session control, and
 * the time limits with a candidate's extra time — the item sessions: attempts, adaptive items, drafts and submitted
 * responses, review and solution, comments, PCI states, and processing failures as data — the candidate side: the
 * candidate view, which holds no answer key, processing or hidden content, and the JSON forms of views and actions,
 * with the limits that a server puts on the actions of its clients — and the pending work that the engine waits on the
 * host for: scoring requests with their scorer view, the sessions of adaptive sections with a CAT engine,
 * `drainCat` and `sendCatRequest`, links to tools scored by their tool, and the results report of a session.
 *
 * @module @assesskit/runtime/delivery
 */
export type { Action, CandidateAction, HostAction } from "./action.js";
export {
  type ActionLimits,
  actionToJson,
  DEFAULT_ACTION_LIMITS,
  type ParseCandidateActionOptions,
  parseCandidateAction,
} from "./action-json.js";
export type {
  CandidateItem,
  CandidateView,
  HazardView,
  LtiView,
  NavigationEntry,
  NavigationItem,
  NavigationSection,
  PartView,
  PciView,
  StimulusView,
  SupportView,
  TestView,
  TimerView,
  VariantView,
} from "./candidate-view.js";
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
  DeliveryStatus,
  Expiry,
  ScopeClock,
  SessionSupport,
  Step,
} from "./delivery-state.js";
export { STATE_VERSION } from "./delivery-state.js";
export { type DrainCatOptions, drainCat, type SendCatRequestOptions, sendCatRequest } from "./drain-cat.js";
export { createEngine, type Engine, type StartOptions } from "./engine.js";
export type { DeliveryEvent, DeliveryEventType } from "./events.js";
export { applyItemAction, type ItemAction } from "./item-action.js";
export { type ItemFeedback, itemFeedback, itemResponses } from "./item-display.js";
export {
  closeItem,
  presentItem,
  type StartItemSessionOptions,
  startItemSession,
  suspendItem,
} from "./item-lifecycle.js";
export type { ItemSession, ItemSessionContext, ItemSessionStatus, ItemStep } from "./item-session.js";
export { nextItem, previousItem, type RuleContext } from "./navigation.js";
export type { CatRequest, CatRequestBase, PendingWork } from "./pending-work.js";
export {
  DEFAULT_PLAN_LIMITS,
  type ItemKey,
  type PlanLimits,
  type PlannedChild,
  type PlannedItem,
  type PlannedPart,
  type PlannedSection,
  type PlanOptions,
  planItems,
  planTest,
  type TestPlan,
} from "./plan.js";
export type { Refusal, RefusalCode } from "./refusal.js";
export { resultStatus } from "./result-status.js";
export type { ScorerItem, ScorerView } from "./scorer-view.js";
export type {
  Scorer,
  ScoringCover,
  ScoringDeclaration,
  ScoringRequest,
  SuppliedScore,
} from "./scoring.js";
export { type EffectiveSessionControl, sessionControl, standaloneSessionControl } from "./session-control.js";
export { stamp } from "./stamp.js";
export { deserializeState, serializeState } from "./state-json.js";
export {
  ancestry,
  type ContentNode,
  type ItemRefNode,
  type PartNode,
  partOf,
  resolveStructure,
  type SectionNode,
  type StructureNode,
  type TestNode,
  type TestStructure,
} from "./structure.js";
export { additionalTestingTime, type EffectiveTimeLimits, timeLimits } from "./time-limits.js";
export { viewFromJson, viewToJson } from "./view-json.js";
