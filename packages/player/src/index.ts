/**
 * The errors the player throws and the text of its interface, and the types of `@assesskit/runtime` that its declarations
 * name, which a program that installs the player imports from here: a strict installer does not let it import a
 * dependency of a dependency.
 *
 * @module @assesskit/player
 */

export type {
  AdaptiveSelection,
  BodyNode,
  Catalog,
  CompanionMaterialsInfo,
  CustomInteraction,
  Interaction,
  ModalFeedback,
  ModelNode,
  RubricRating,
  ScoringRubric,
  TestFeedback,
} from "@assesskit/runtime/asi";
export type { CatPort, CatSessionPort } from "@assesskit/runtime/cat";
export type { CallOptions } from "@assesskit/runtime/checks";
export type { ContentVariables, HazardExposure, View } from "@assesskit/runtime/content";
export type {
  DeliveryDefinition,
  DeliveryEvent,
  Engine,
  EngineOptions,
  HostAction,
  ItemKey,
  PendingWork,
  Refusal,
  Scorer,
  ScorerView,
  ScoringDeclaration,
  ScoringRequest,
  StartOptions,
} from "@assesskit/runtime/delivery";
export type { ActionLimits, CandidateAction, CandidateView, SupportView } from "@assesskit/runtime/delivery/wire";
// The base class of `AccessError`, exported as a value so that `instanceof` works on the errors of the family.
export { AssesskitError } from "@assesskit/runtime/errors";
export type { QtiPackage } from "@assesskit/runtime/package";
export type { Braille, Spoken, SupportName, SupportSetting } from "@assesskit/runtime/pnp";
export type { AssessmentResult } from "@assesskit/runtime/results";
export type { FileValue, Value, WireValue } from "@assesskit/runtime/values";
export { AccessError, type AccessErrorReason } from "./errors.js";
export { EN_MESSAGES, type Messages, type SelectMessagesOptions, selectMessages } from "./messages/index.js";
