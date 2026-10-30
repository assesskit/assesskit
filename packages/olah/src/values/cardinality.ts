import * as v from "valibot";
import { checkChoice } from "../checks.js";

/** A cardinality of QTI values: a term of `CardinalityEnum` (INFO §8.16). */
export type Cardinality = "multiple" | "ordered" | "record" | "single";

/** Every cardinality, in alphabetical order (INFO §8.16, Table 8.16). */
export const CARDINALITIES: readonly Cardinality[] = ["multiple", "ordered", "record", "single"];

/** Returns whether a value is a term of `CardinalityEnum`, spelled exactly as the enumeration spells it. */
export function isCardinality(value: unknown): value is Cardinality {
  return CARDINALITIES.some((cardinality) => cardinality === value);
}

/**
 * Checks that a value is a cardinality.
 *
 * @throws `DataError` when it is not.
 */
export function checkCardinality(value: unknown): asserts value is Cardinality {
  checkChoice(value, "The cardinality", CARDINALITIES);
}

/** The schema of a cardinality. */
export const cardinalitySchema = v.picklist(CARDINALITIES);
