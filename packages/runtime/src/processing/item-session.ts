import type { AssessmentItemRef } from "../asi/index.js";
import type { Value } from "../values/index.js";
import { asNumber } from "./operands.js";
import type { ItemVariables } from "./variables.js";

/**
 * The weight of an item variable when the item ref defines none with the identifier.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_WEIGHT = 1;

/**
 * Returns the identifier an item declares a variable with, from the identifier a test reads it by: variable mappings
 * let a test read the item variable `source-identifier` as `target-identifier`.
 *
 * @param ref - The item ref.
 * @param identifier - The identifier that the test uses.
 * @returns The identifier that the item uses.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function itemIdentifier(ref: AssessmentItemRef, identifier: string): string {
  return (
    ref.variableMappings.find((mapping) => mapping.targetIdentifier === identifier)?.sourceIdentifier ?? identifier
  );
}

/**
 * Returns the weight that an item ref defines with an identifier, 1 when it defines none.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function weightOf(ref: AssessmentItemRef, weightIdentifier: string): number {
  return ref.weights.find((weight) => weight.identifier === weightIdentifier)?.value ?? DEFAULT_WEIGHT;
}

/**
 * Returns a value times a weight: an integer or float value becomes a float, and a value of any other base type is
 * returned as it is.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function weigh(value: Value | null, weight: number): Value | null {
  if (value === null || value.cardinality === "record") return value;
  if (value.baseType !== "integer" && value.baseType !== "float") return value;
  if (value.cardinality === "single") {
    return { cardinality: "single", baseType: "float", value: asNumber(value.value) * weight };
  }
  return {
    cardinality: value.cardinality,
    baseType: "float",
    values: value.values.map((item) => asNumber(item) * weight),
  };
}

/** Returns the value of an item variable of any kind, `undefined` when the item has no such variable. */
export function itemValue(variables: ItemVariables, identifier: string): Value | null | undefined {
  for (const values of [variables.responses, variables.outcomes, variables.templates, variables.contexts]) {
    if (values.has(identifier)) return values.get(identifier) ?? null;
  }
  return undefined;
}
