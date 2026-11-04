/**
 * Interaction descriptors, the checks of response bindings, response validity and the answered status, the shuffling of
 * choices, and the numeric record of a text entry.
 *
 * @module @assesskit/runtime/interactions
 */
export { deriveAnsweredStatus } from "./derive-answered-status.js";
export { describeInteractions } from "./describe.js";
export type {
  Binding,
  ChoiceDescriptor,
  InteractionConstraints,
  InteractionDescriptor,
  InteractionKind,
} from "./descriptor.js";
export { deriveInitialResponse } from "./initial-response.js";
export { type ReadNumericRecordOptions, readNumericRecord } from "./read-numeric-record.js";
export { type ResponseCheck, type ResponseViolation, validateResponse } from "./response-check.js";
export type { ResponseStatus } from "./response-status.js";
export { presentChoices, shuffleChoices } from "./shuffle.js";
export { validateBindings } from "./validate-bindings.js";
