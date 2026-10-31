import * as v from "valibot";
import { checkChoice } from "../checks.js";

/**
 * A cardinality of QTI values: a term of `CardinalityEnum`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, cardinality}
 */
export type Cardinality = "multiple" | "ordered" | "record" | "single";

/** Every cardinality, in alphabetical order. */
export const CARDINALITIES: readonly Cardinality[] = ["multiple", "ordered", "record", "single"];

/**
 * Returns whether a value is a cardinality.
 *
 * @param value - Any value; only a string spelled exactly as the enumeration spells it is a cardinality.
 * @returns `true` for a cardinality, which narrows the type of `value`.
 */
export function isCardinality(value: unknown): value is Cardinality {
  return CARDINALITIES.some((cardinality) => cardinality === value);
}

/**
 * Checks that a value is a cardinality.
 *
 * @param value - Any value.
 * @throws `DataError` when it is not a cardinality.
 */
export function checkCardinality(value: unknown): asserts value is Cardinality {
  checkChoice(value, "The cardinality", CARDINALITIES);
}

/** The schema of a cardinality, for the readers of JSON that name one. */
export const cardinalitySchema = v.picklist(CARDINALITIES);
