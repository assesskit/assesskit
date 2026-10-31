import { checkChoice, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "./value.js";

/** The base types that an `integer` value becomes on promotion. */
export type PromotionTarget = "float" | "duration";

/**
 * Converts a value of base type `integer` to `float` or `duration`, keeping its numbers and its cardinality.
 *
 * @remarks
 * This is the type promotion of weighted outcomes and of assigning an integer to a `float` or `duration` variable. A
 * value that already has the target base type is returned as it is.
 *
 * @param value - A `single`, `multiple` or `ordered` value.
 * @param baseType - `float` or `duration`.
 * @returns The promoted value, or `value` itself when it has the target base type.
 * @throws `DataError` when `value` is not an object, `baseType` is not a target, or `value` is a record or has another
 * base type than `integer` and the target.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, outcome declarations and weights}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
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
