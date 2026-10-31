/**
 * Helpers of the tools that other folders of the player and its tests use.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export {
  BASIC_KEYS,
  type CalculatorKey,
  type CalculatorState,
  DIGIT_KEYS,
  INITIAL_STATE,
  KEYBOARD_KEYS,
  press,
  STANDARD_ONLY_KEYS,
} from "./calculator-engine.js";
export { checkToolsInput } from "./check-input.js";
export { ANGLE_UNITS, LENGTH_UNITS, type ProtractorSpec, type RuleSpec } from "./model.js";
export { formatNumber } from "./numbers.js";
export { resolveTools } from "./resolve.js";
export {
  CSS_PX_PER_MM,
  degrees,
  MIN_LABEL_PX,
  MIN_TICK_PX,
  millimeters,
  protractorScale,
  ruleScale,
  unitSymbol,
} from "./scale.js";
