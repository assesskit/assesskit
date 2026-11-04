/**
 * Custom operators that score what QTI's own operators cannot (an expression, a number with units or significant figures,
 * a text by its normalization and credit, points matched to areas, whether a response reads), the calling convention that
 * writes them into response processing, the reader and comparator of a LaTeX subset of mathematics, the checks of worked
 * steps and the length of a text.
 *
 * @module @assesskit/runtime/operators
 */
export {
  buildOperatorCall,
  type ExpressionCall,
  type HotspotCall,
  type NumberCall,
  type OperatorCall,
  type ReadableCall,
  type TextCall,
} from "./build-operator-call.js";
export { countLength } from "./count-length.js";
export { type CreateScoringOperatorsOptions, createScoringOperators } from "./create-scoring-operators.js";
export { OPERATOR_DEFINITIONS, OPERATOR_NAMESPACE, type OperatorName } from "./definitions.js";
export { DEFAULT_KEY_LIMITS, type KeyLimits } from "./key-limits.js";
export type {
  Area,
  AreasKey,
  ExpressionKey,
  FollowThrough,
  Interval,
  Key,
  KeyedAreasKey,
  LengthEffect,
  LengthRule,
  LengthUnit,
  NumberCredit,
  NumberKey,
  TextAnswer,
  TextCredit,
  TextKey,
  TextNormalization,
  Tolerance,
  VariableRange,
} from "./keys.js";
export { DEFAULT_OPERATOR_LIMITS, type OperatorLimits } from "./limits.js";
export { type CompareMathStepsOptions, compareMathSteps, type StepCheck } from "./math-steps.js";
