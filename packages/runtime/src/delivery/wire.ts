/**
 * The wire forms of the candidate side of delivery: the JSON of a candidate view and of a candidate action, with the limits
 * that a server puts on the actions of its clients. No file of the engine is reachable from this module, so a client that
 * reads views and sends actions imports it rather than `@assesskit/runtime/delivery`: a bundler that splits code by file,
 * such as esbuild, then keeps the engine out of the first load of a page, even one that also loads the engine on demand.
 *
 * @module @assesskit/runtime/delivery/wire
 */

export type { CandidateAction } from "./action.js";
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
export { viewFromJson, viewToJson } from "./view-json.js";
