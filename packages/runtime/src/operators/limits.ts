import { checkPositiveInteger, checkProperties, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** The limits of what the operators read from a response; past one, the response is unreadable, never an error. */
export interface OperatorLimits {
  /**
   * The most characters of a response, all its strings together, as UTF-16 code units; also of a key's expression.
   *
   * @defaultValue `2000`
   */
  readonly maxInputLength: number;
  /**
   * The most levels of groups, fractions, roots, exponents, function arguments and bars in an expression, the top level being
   * 1: a sum of 1,000 terms has depth 1.
   *
   * @defaultValue `64`
   */
  readonly maxExpressionDepth: number;
  /**
   * The most values of a solution set once `\pm` is expanded.
   *
   * @defaultValue `16`
   */
  readonly maxSolutions: number;
  /**
   * The widest edit distance that a tier of text credit measures; a wider tier measures this far.
   *
   * @defaultValue `64`
   */
  readonly maxEditBand: number;
}

/** The default limits: the same wherever an item is scored, so that a verdict does not depend on the host. */
export const DEFAULT_OPERATOR_LIMITS: OperatorLimits = Object.freeze({
  maxInputLength: 2_000,
  maxExpressionDepth: 64,
  maxSolutions: 16,
  maxEditBand: 64,
});

/**
 * The highest value a host may set for each limit: ten, two, four and four times the default, at which the worst input stays
 * within the budget of memory (docs/runtime/operators.md, Limits).
 */
const CAPS: OperatorLimits = Object.freeze({
  maxInputLength: 20_000,
  maxExpressionDepth: 128,
  maxSolutions: 64,
  maxEditBand: 256,
});

const NAMES: readonly (keyof OperatorLimits)[] = [
  "maxInputLength",
  "maxExpressionDepth",
  "maxSolutions",
  "maxEditBand",
];

/**
 * Applies the defaults to the limits that a host sets.
 *
 * @throws `DataError` for limits that are not an object or hold another property, or a limit that is not a positive integer
 *   or is past its cap.
 */
export function resolveOperatorLimits(limits: unknown): OperatorLimits {
  if (limits === undefined) return DEFAULT_OPERATOR_LIMITS;
  checkRecord(limits, "The option limits must be an object");
  checkProperties(limits, "The option limits", NAMES);
  const resolved: Record<keyof OperatorLimits, number> = { ...DEFAULT_OPERATOR_LIMITS };
  for (const name of NAMES) {
    const value = limits[name];
    if (value === undefined) continue;
    checkPositiveInteger(value, `The limit ${name}`);
    if (value > CAPS[name])
      throw new DataError(`The limit ${name} must be at most ${CAPS[name]}, found ${describe(value)}.`);
    resolved[name] = value;
  }
  return Object.freeze(resolved);
}
