import type { Expression } from "../asi/index.js";
import { ProcessingError } from "../errors.js";
import { describeType } from "./assign.js";
import { evaluateIn } from "./evaluate.js";
import { asBoolean, primitiveOf } from "./operands.js";
import type { Scope } from "./scope.js";

/** A branch of a condition: its expression and the rules to run when it is true. */
export interface Branch<TRule> {
  readonly condition: Expression;
  readonly rules: readonly TRule[];
}

/**
 * Returns whether the expression of a branch is true. NULL counts as false (INFO §5.150 for constraints, B47 for
 * conditions).
 *
 * @throws `ProcessingError` when it is not a single boolean.
 */
export function holds(condition: Expression, scope: Scope, element: string, source: string): boolean {
  const value = evaluateIn(condition, scope);
  if (value === null) return false;
  if (value.cardinality !== "single" || value.baseType !== "boolean") {
    throw new ProcessingError(
      `The expression of ${element} must be a single boolean, found ${describeType(value)}.`,
      source,
    );
  }
  return asBoolean(primitiveOf(value));
}

/**
 * Returns the rules of the first branch whose expression is true, else those of the else branch, `undefined` when there
 * is neither: a NULL or false expression skips its branch (B47).
 *
 * @throws `ProcessingError` when an expression is not a single boolean.
 */
export function chosenRules<TRule>(
  branches: readonly Branch<TRule>[],
  otherwise: readonly TRule[] | undefined,
  scope: Scope,
  element: string,
  source: string,
): readonly TRule[] | undefined {
  return branches.find((branch) => holds(branch.condition, scope, element, source))?.rules ?? otherwise;
}
