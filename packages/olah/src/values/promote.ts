import { checkChoice, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "./value.js";

/** The base types that an `integer` value becomes on promotion. */
export type PromotionTarget = "float" | "duration";

/**
 * Converts a value of base type `integer` to `float` or `duration`, keeping its numbers and its cardinality: the type
 * promotion of weighted outcomes (INFO §2.11.1.2, §7.39.6, §7.47.2) and of assigning an integer to a `float` or
 * `duration` variable. A value that already has the target base type is returned as it is.
 *
 * @param value - A `single`, `multiple` or `ordered` value.
 * @param baseType - `float` or `duration`.
 * @throws `DataError` when `value` is not an object, `baseType` is not a target, or `value` is a record or has another
 * base type than `integer` and the target.
 */
export function promote(value: Value, baseType: PromotionTarget): Value {
  checkRecord(value, "The value must be an object");
  checkChoice(baseType, "The base type to promote to", ["float", "duration"]);
  if (value.cardinality === "record" || !(value.baseType === "integer" || value.baseType === baseType)) {
    throw new DataError(
      `Only a value of base type integer can be promoted to ${baseType}, found ${describeType(value)}.`,
    );
  }
  return value.baseType === baseType ? value : { ...value, baseType };
}

function describeType(value: Value): string {
  return value.cardinality === "record" ? "a record" : `base type ${value.baseType}`;
}
