/**
 * Interaction descriptors, the checks of response bindings and response validity, and the numeric record of a text entry.
 *
 * @module @assesskit/runtime/interactions
 */
export { describeInteractions } from "./describe.js";
export type {
  Binding,
  ChoiceDescriptor,
  InteractionConstraints,
  InteractionDescriptor,
  InteractionKind,
} from "./descriptor.js";
export { type ReadNumericRecordOptions, readNumericRecord } from "./read-numeric-record.js";
export { type ResponseCheck, type ResponseViolation, validateResponse } from "./response-check.js";
export type { ResponseStatus } from "./response-status.js";
export { validateBindings } from "./validate-bindings.js";
