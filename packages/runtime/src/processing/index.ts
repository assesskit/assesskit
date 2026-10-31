/**
 * Response, template and outcome processing: the variables of an item session, a tree interpreter for every expression
 * and rule of QTI 3.0, the standard response processing templates, custom operators, and the signatures of the
 * operators.
 *
 * @module @assesskit/runtime/processing
 */
export { describeType, fitsBaseType, type VariableType } from "./assign.js";
export {
  BUILT_IN_CONTEXTS,
  BUILT_IN_OUTCOMES,
  BUILT_IN_RESPONSES,
  COMPLETION_STATUS,
  COMPLETION_STATUSES,
  DURATION,
  NUM_ATTEMPTS,
  QTI_CONTEXT,
} from "./built-ins.js";
export { describeCount, describeOperand } from "./check-operands.js";
export type { CustomOperator, CustomOperatorExpression, ProcessingContext } from "./context.js";
export { declaredValue, readPrimitive } from "./declared-value.js";
export { evaluate, operandsOf } from "./evaluate.js";
export { itemIdentifier } from "./item-session.js";
export { DEFAULT_PROCESSING_LIMITS, type ProcessingLimits } from "./limits.js";
export { evaluateTestExpression, runOutcomeProcessing } from "./outcome-processing.js";
export { DEFAULT_RANDOM_MIN, DEFAULT_RANDOM_STEP } from "./random-values.js";
export { runResponseProcessing } from "./response-processing.js";
export {
  OPERATOR_SIGNATURES,
  type OperandSignature,
  type OperatorSignature,
  type ResultSignature,
} from "./signatures.js";
export { isQti2TemplateUri, STANDARD_TEMPLATES, standardTemplateUri } from "./standard-templates.js";
export { runTemplateProcessing } from "./template-processing.js";
export type { ItemSessionFilter, ItemSessionView, TestScope } from "./test-scope.js";
export { type CreateItemVariablesOptions, createItemVariables, type ItemVariables } from "./variables.js";
