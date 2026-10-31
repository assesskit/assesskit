import { describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import type { Value } from "../values/index.js";
import { normalizeValue } from "../values/value.js";
import { type CustomOperatorExpression, checkContainerSize, type Environment } from "./context.js";
import { primitivesOf } from "./operands.js";

/**
 * `qti-custom-operator` (INFO §2.11.3.2, §10.1.5): the value that the custom operator registered for its `definition`,
 * else for its `class`, computes from the values of the operands. What the operator returns is checked like any input.
 *
 * @throws `ProcessingError` when no operator is registered for either (G7).
 * @throws `DataError` when the operator returns something that is not a value or `null`.
 * @throws `SecurityError` when it returns a container of more than `maxContainerSize` values.
 */
export function customOperator(
  expression: CustomOperatorExpression,
  operands: readonly (Value | null)[],
  environment: Environment,
): Value | null {
  const names = [expression.definition, expression.class].filter((name) => name !== undefined);
  const name = names.find((candidate) => environment.customOperators.has(candidate));
  const operator = name === undefined ? undefined : environment.customOperators.get(name);
  if (name === undefined || operator === undefined) {
    const named =
      names.length === 0
        ? "no definition or class"
        : `the definition or class ${names.map((each) => JSON.stringify(each)).join(" or ")}`;
    throw new ProcessingError(`No custom operator is registered for qti-custom-operator with ${named}.`);
  }
  const result: unknown = operator(operands, expression);
  if (result === null) return null;
  let value: Value;
  try {
    value = normalizeValue(result);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    throw new DataError(
      `The custom operator ${JSON.stringify(name)} returned ${describe(result)}, which is not a value: ${error.message}`,
    );
  }
  checkContainerSize(environment, primitivesOf(value).length, "qti-custom-operator");
  return value;
}
