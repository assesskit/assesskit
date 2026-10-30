import type { Value } from "../values/index.js";
import { asBoolean, booleanResult, primitiveOf } from "./operands.js";

/** Returns a single boolean operand as true, false or NULL. */
function truthOf(value: Value | null): boolean | null {
  return value === null ? null : asBoolean(primitiveOf(value));
}

/** `qti-and`: false when an operand is false, else NULL when one is NULL, else true (INFO §2.11.3.10). */
export function and(operands: readonly (Value | null)[]): Value | null {
  const truths = operands.map(truthOf);
  if (truths.includes(false)) return booleanResult(false);
  return booleanResult(truths.includes(null) ? null : true);
}

/** `qti-or`: true when an operand is true, else NULL when one is NULL, else false (INFO §2.11.3.15). */
export function or(operands: readonly (Value | null)[]): Value | null {
  const truths = operands.map(truthOf);
  if (truths.includes(true)) return booleanResult(true);
  return booleanResult(truths.includes(null) ? null : false);
}

/** `qti-not`: the negation, NULL for NULL (INFO §2.11.3.35). */
export function not(operand: Value | null): Value | null {
  const truth = truthOf(operand);
  return booleanResult(truth === null ? null : !truth);
}

/**
 * `qti-any-n`: true when at least `min` and at most `max` operands are true, whatever the NULL ones are; false when no
 * value of the NULL ones could make that so; else NULL (INFO §2.11.3.1). NULL when `min` or `max` is NULL.
 */
export function anyN(operands: readonly (Value | null)[], min: number | null, max: number | null): Value | null {
  if (min === null || max === null) return null;
  const truths = operands.map(truthOf);
  const trues = truths.filter((truth) => truth === true).length;
  const unknown = truths.filter((truth) => truth === null).length;
  // The NULL operands could make from `trues` to `trues + unknown` true; false when no count in that range fits.
  if (min > max || trues > max || trues + unknown < min) return booleanResult(false);
  return booleanResult(trues >= min && trues + unknown <= max ? true : null);
}
