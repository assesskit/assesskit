import { ProcessingError } from "../errors.js";
import { type BaseType, type Cardinality, promote, type Value } from "../values/index.js";

/** The type of a variable: its cardinality and, unless it is a record, its base type. */
export interface VariableType {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type; a record has none. */
  readonly baseType?: BaseType;
}

/**
 * Returns a value as a variable of a type holds it, or `undefined` when it does not fit. An integer fits a float or a
 * duration variable and is promoted (D5); any other value fits only its own cardinality and base type.
 */
export function fitValue(value: Value, type: VariableType): Value | undefined {
  if (value.cardinality !== type.cardinality) return undefined;
  if (value.cardinality === "record" || value.baseType === type.baseType) return value;
  if (value.baseType === "integer" && (type.baseType === "float" || type.baseType === "duration")) {
    return promote(value, type.baseType);
  }
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
      "INFO §5.130.2",
      identifier,
    );
  }
  return fitted;
}
