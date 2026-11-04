/**
 * Response, template and outcome processing: the variables of an item session, a tree interpreter for every expression
 * and rule of QTI 3.0, the standard response processing templates, and custom operators.
 *
 * @module @assesskit/runtime/processing
 */
export { describeType, fitsBaseType, type VariableType } from "./assign.js";
export { QTI_CONTEXT } from "./built-ins.js";
export type { CustomOperator, CustomOperatorExpression, ProcessingContext } from "./context.js";
export { DEFAULT_PROCESSING_LIMITS, type ProcessingLimits } from "./limits.js";
export { runOutcomeProcessing } from "./outcome-processing.js";
export { runResponseProcessing } from "./response-processing.js";
export { isInsideShape } from "./shapes.js";
export { runTemplateProcessing } from "./template-processing.js";
export type { ItemSessionFilter, ItemSessionView, TestScope } from "./test-scope.js";
export { type CreateItemVariablesOptions, createItemVariables, type ItemVariables } from "./variables.js";
