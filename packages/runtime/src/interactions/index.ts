/**
 * Interaction descriptors, the checks of response bindings, response validity and the answered status, the shuffling of
 * choices, and the numeric record of a text entry.
 *
 * @module @assesskit/runtime/interactions
 */
export { answeredStatus } from "./answered-status.js";
export { checkBindings } from "./check-bindings.js";
export { describeInteractions } from "./describe.js";
export type {
  Binding,
  ChoiceDescriptor,
  InteractionConstraints,
  InteractionDescriptor,
  InteractionKind,
} from "./descriptor.js";
export { initialResponse } from "./initial-response.js";
export { numericRecord } from "./numeric-record.js";
export { checkResponse, type ResponseCheck, type ResponseViolation } from "./response-check.js";
export type { ResponseStatus } from "./response-status.js";
export { presentChoices, shuffleChoices } from "./shuffle.js";
