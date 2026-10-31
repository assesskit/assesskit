import { ProcessingError } from "../errors.js";
import { type BaseType, type Cardinality, type PromotionTarget, promote, type Value } from "../values/index.js";

/** The type of a variable: its cardinality and, unless it is a record, its base type. */
export interface VariableType {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type; a record has none. */
  readonly baseType?: BaseType;
}

/**
 * Returns whether an integer value is promoted to a base type on assignment: `float` and `duration`.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function isPromotionTarget(baseType: BaseType | undefined): baseType is PromotionTarget {
  return baseType === "float" || baseType === "duration";
}

/**
 * Returns whether a value of a base type fits a variable of a base type: the same base type, or an integer, which fits
 * a float or duration variable.
 *
 * @param valueType - The base type of the value.
 * @param variableType - The base type of the variable.
 * @returns `true` when the value fits.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function fitsBaseType(valueType: BaseType, variableType: BaseType): boolean {
  return valueType === variableType || (valueType === "integer" && isPromotionTarget(variableType));
}

/**
 * Returns a value as a variable of a type holds it, or `undefined` when it does not fit.
 *
 * @remarks
 * An integer fits a float or a duration variable and is promoted; any other value fits only its own cardinality and
 * base type.
 *
 * @param value - The value.
 * @param type - The type of the variable.
 * @returns The value as the variable holds it, or `undefined`.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function fitValue(value: Value, type: VariableType): Value | undefined {
  if (value.cardinality !== type.cardinality) return undefined;
  if (value.cardinality === "record" || value.baseType === type.baseType) return value;
  if (value.baseType === "integer" && isPromotionTarget(type.baseType)) return promote(value, type.baseType);
  return undefined;
}

/**
 * Describes the type of a variable or value in a message, such as `a single float`.
 *
 * @param type - The type of a variable, or a value, which has the same two properties.
 * @returns The description.
 */
export function describeType(type: VariableType): string {
  if (type.cardinality === "record") return "a record";
  return `${type.cardinality === "ordered" ? "an" : "a"} ${type.cardinality} ${type.baseType ?? "value"}`;
}

/**
 * Returns the value to store when an expression sets a variable: NULL, or the value promoted to the variable's type.
 *
 * @param value - The value, or `null` for NULL.
 * @param type - The type of the variable.
 * @param identifier - The identifier of the variable, for the message.
 * @returns The value to store.
 * @throws `ProcessingError` when the value has another cardinality or base type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
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
