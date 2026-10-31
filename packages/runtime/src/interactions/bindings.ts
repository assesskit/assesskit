import { BASE_TYPES, type BaseType, CARDINALITIES, type Cardinality } from "../values/index.js";
import type { Binding } from "./descriptor.js";

/**
 * The base types of a response to a text interaction that is not a record.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const TEXT_BASE_TYPES: readonly BaseType[] = ["float", "integer", "string"];

/**
 * Returns the binding of one cardinality to the given base types.
 *
 * @param cardinality - The cardinality.
 * @param baseTypes - The base types that fit with it; none for a record.
 * @returns The binding.
 */
export function bind(cardinality: Cardinality, ...baseTypes: readonly BaseType[]): Binding {
  return { cardinality, baseTypes };
}

/**
 * Returns the bindings of an interaction that selects, pairs or marks values of one base type.
 *
 * @remarks
 * A container always fits, and a single value fits only when at most one value can be given: an interaction whose
 * `max-choices` is greater than 1, or 0, must be bound to a response of multiple cardinality.
 *
 * @param baseType - The base type of the values.
 * @param mayBeSingle - Whether at most one value can be given.
 * @returns The bindings.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-choice-interaction}
 */
export function containerBindings(baseType: BaseType, mayBeSingle: boolean): readonly Binding[] {
  return mayBeSingle ? [bind("single", baseType), bind("multiple", baseType)] : [bind("multiple", baseType)];
}

/**
 * Returns the bindings of an interaction that the specification does not bind: every cardinality with every base type.
 *
 * @returns The bindings.
 */
export function anyBindings(): readonly Binding[] {
  return CARDINALITIES.map((cardinality) => bind(cardinality, ...(cardinality === "record" ? [] : BASE_TYPES)));
}
