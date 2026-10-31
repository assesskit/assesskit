import { ProcessingError } from "../errors.js";
import { type BaseType, type Cardinality, type PromotionTarget, promote, type Value } from "../values/index.js";

/** The type of a variable: its cardinality and, unless it is a record, its base type. */
export interface VariableType {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type; a record has none. */
  readonly baseType?: BaseType;
}

/** Returns whether an integer value is promoted to a base type on assignment: `float` and `duration` (D5). */
function isPromotionTarget(baseType: BaseType | undefined): baseType is PromotionTarget {
  return baseType === "float" || baseType === "duration";
}

/**
 * Returns whether a value of a base type fits a variable of a base type: the same base type, or an integer, which fits a
 * float or duration variable (D5).
 */
export function fitsBaseType(valueType: BaseType, variableType: BaseType): boolean {
  return valueType === variableType || (valueType === "integer" && isPromotionTarget(variableType));
}

/**
 * Returns a value as a variable of a type holds it, or `undefined` when it does not fit. An integer fits a float or a
 * duration variable and is promoted (D5); any other value fits only its own cardinality and base type.
 */
export function fitValue(value: Value, type: VariableType): Value | undefined {
  if (value.cardinality !== type.cardinality) return undefined;
  if (value.cardinality === "record" || value.baseType === type.baseType) return value;
  if (value.baseType === "integer" && isPromotionTarget(type.baseType)) return promote(value, type.baseType);
  return undefined;
}

/** Describes the type of a variable or value in a message, such as `a single float`. */
export function describeType(type: VariableType): string {
  if (type.cardinality === "record") return "a record";
  return `${type.cardinality === "ordered" ? "an" : "a"} ${type.cardinality} ${type.baseType ?? "value"}`;
}

/**
 * Returns the value to store when an expression sets a variable: NULL, or the value promoted to the variable's type
 * (INFO §5.130.2, D5).
 *
 * @throws `ProcessingError` when the value has another cardinality or base type.
 */
export function assign(value: Value | null, type: VariableType, identifier: string): Value | null {
  if (value === null) return null;
  const fitted = fitValue(value, type);
  if (fitted === undefined) {
    throw new ProcessingError(
      `The variable ${identifier} is ${describeType(type)} and cannot be set to ${describeType(value)}.`,
      identifier,
    );
  }
  return fitted;
}
