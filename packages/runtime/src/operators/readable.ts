import type { Value } from "../values/index.js";
import { prepareExpression, readsAsExpression } from "./expression-equivalent.js";
import type { OperatorLimits } from "./limits.js";
import { isNumeric, prepareNumber, readsAsNumber } from "./number-equivalent.js";
import { checkOperandCount, flag, isBlank, stringsOf } from "./operands.js";
import type { OptionsOf } from "./options.js";
import { prepareText, readsAsText } from "./text-equivalent.js";

/**
 * Checks the key of `readable` as the operator of its kind checks it, so that a key which that operator refuses is refused
 * here too.
 *
 * @throws `DataError` or `SecurityError` as `prepareExpression`, `prepareNumber` or `prepareText` throws.
 */
export function prepareReadable(
  options: OptionsOf<"readable">,
  limits: OperatorLimits,
  prefix: string,
): OptionsOf<"readable"> {
  const { key } = options;
  if (key.kind === "expression") prepareExpression({ key, followThrough: null }, limits, prefix);
  else if (key.kind === "number") prepareNumber({ key, followThrough: null }, limits, prefix);
  else prepareText({ key }, prefix);
  return options;
}

/**
 * `readable`: true when every string of the response is not blank and reads as the operator of its key reads it, within the
 * limits; false for a NULL, blank or unreadable response. An integer or a float reads as a number key's response.
 */
export function scoreReadable(
  options: OptionsOf<"readable">,
  operands: readonly (Value | null)[],
  limits: OperatorLimits,
): Value {
  checkOperandCount(operands, 1);
  const { key } = options;
  const [operand] = operands;
  if (key.kind === "number" && isNumeric(operand)) return flag(true);
  const strings = stringsOf(operand, 0, { containers: true, numbers: false });
  if (strings === null || strings.length === 0) return flag(false);
  if (strings.reduce((total, text) => total + text.length, 0) > limits.maxInputLength) return flag(false);
  if (strings.some(isBlank)) return flag(false);
  if (key.kind === "expression") return flag(readsAsExpression(strings, key, limits));
  if (key.kind === "number") return flag(readsAsNumber(strings, key));
  return flag(readsAsText(strings));
}
