import * as v from "valibot";
import { checkChoice } from "../checks.js";

/** A base type of QTI values: a term of `BaseTypeEnum` (INFO §8.13). */
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

/** Every base type, in alphabetical order (INFO §8.13, Table 8.13). */
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

/** Returns whether a value is a term of `BaseTypeEnum`, spelled exactly as the enumeration spells it. */
export function isBaseType(value: unknown): value is BaseType {
  return BASE_TYPES.some((baseType) => baseType === value);
}

/**
 * Checks that a value is a base type.
 *
 * @throws `DataError` when it is not.
 */
export function checkBaseType(value: unknown): asserts value is BaseType {
  checkChoice(value, "The base type", BASE_TYPES);
}

/** The schema of a base type. */
export const baseTypeSchema = v.picklist(BASE_TYPES);
