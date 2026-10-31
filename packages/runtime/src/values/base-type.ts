import * as v from "valibot";
import { checkChoice } from "../checks.js";

/**
 * A base type of QTI values: a term of `BaseTypeEnum`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, base types}
 */
export type BaseType =
  | "boolean"
  | "directedPair"
  | "duration"
  | "file"
  | "float"
  | "identifier"
  | "integer"
  | "pair"
  | "point"
  | "string"
  | "uri";

/** Every base type, in alphabetical order. */
export const BASE_TYPES: readonly BaseType[] = [
  "boolean",
  "directedPair",
  "duration",
  "file",
  "float",
  "identifier",
  "integer",
  "pair",
  "point",
  "string",
  "uri",
];

/**
 * Returns whether a value is a base type.
 *
 * @param value - Any value; only a string spelled exactly as the enumeration spells it is a base type.
 * @returns `true` for a base type, which narrows the type of `value`.
 */
export function isBaseType(value: unknown): value is BaseType {
  return BASE_TYPES.some((baseType) => baseType === value);
}

/**
 * Checks that a value is a base type.
 *
 * @param value - Any value.
 * @throws `DataError` when it is not a base type.
 */
export function checkBaseType(value: unknown): asserts value is BaseType {
  checkChoice(value, "The base type", BASE_TYPES);
}

/** The schema of a base type, for the readers of JSON that name one. */
export const baseTypeSchema = v.picklist(BASE_TYPES);
