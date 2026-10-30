import { fitsBaseType, type VariableType } from "../processing/index.js";
import type { BaseType, Cardinality } from "../values/index.js";

/**
 * What is known of the type of a value before anything runs: a field is absent when the type depends on the value, as
 * the base type of a record field does, or on what the check cannot see, as an item that could not be resolved.
 */
export interface StaticType {
  /** The cardinality, when known. */
  readonly cardinality?: Cardinality;
  /** The base type, when known; a record has none. */
  readonly baseType?: BaseType;
}

/** Nothing is known of the value. */
export const UNKNOWN: StaticType = {};

/** Returns the type that the declaration of a variable gives it. */
export function typeOfVariable({ cardinality, baseType }: VariableType): StaticType {
  return baseType === undefined ? { cardinality } : { cardinality, baseType };
}

/** Describes a type for a message: `a single float`, `a multiple value`, or `a value of another cardinality`. */
export function describeStatic({ cardinality, baseType }: StaticType): string {
  if (cardinality === undefined) return baseType === undefined ? "a value" : `a ${baseType} value`;
  if (cardinality === "record") return "a record";
  const article = cardinality === "ordered" ? "an" : "a";
  return `${article} ${cardinality} ${baseType ?? "value"}`;
}

/**
 * Returns whether a value of a type could be assigned to a variable: the same cardinality and, except for a record, the
 * same base type or an integer that promotes to a float or duration (INFO §5.130.2, D5). A part of the type that is
 * unknown fits.
 */
export function fitsVariable(value: StaticType, variable: VariableType): boolean {
  if (value.cardinality !== undefined && value.cardinality !== variable.cardinality) return false;
  return (
    value.baseType === undefined || variable.baseType === undefined || fitsBaseType(value.baseType, variable.baseType)
  );
}
