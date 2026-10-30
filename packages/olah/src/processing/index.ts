/**
 * Response, template and outcome processing: the variables of an item session, a tree interpreter for every expression
 * and rule of QTI 3.0, the standard response processing templates, custom operators, and the signatures of the
 * operators.
 *
 * @module @luthfanwakan/olah/processing
 */
export type { CustomOperator, CustomOperatorExpression, ProcessingContext } from "./context.js";
export { evaluate } from "./evaluate.js";
export { DEFAULT_PROCESSING_LIMITS, type ProcessingLimits } from "./limits.js";
export { evaluateTestExpression, runOutcomeProcessing } from "./outcome-processing.js";
export { runResponseProcessing } from "./response-processing.js";
export {
  OPERATOR_SIGNATURES,
  type OperandSignature,
  type OperatorSignature,
  type ResultSignature,
} from "./signatures.js";
export { STANDARD_TEMPLATES, standardTemplateUri } from "./standard-templates.js";
export { runTemplateProcessing } from "./template-processing.js";
export type { ItemSessionFilter, ItemSessionView, TestScope } from "./test-scope.js";
export { type CreateItemVariablesOptions, createItemVariables, type ItemVariables } from "./variables.js";
