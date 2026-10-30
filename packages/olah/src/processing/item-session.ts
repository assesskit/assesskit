import type { AssessmentItemRef } from "../asi/index.js";
import type { Value } from "../values/index.js";
import { asNumber } from "./operands.js";
import type { ItemVariables } from "./variables.js";

/** The weight of an item variable when the item ref defines none with the identifier (INFO §7.47.2). */
const DEFAULT_WEIGHT = 1;

/**
 * Returns the identifier an item declares a variable with, from the identifier a test reads it by: variable mappings
 * let a test read the item variable `source-identifier` as `target-identifier` (INFO §7.48).
 */
export function itemIdentifier(ref: AssessmentItemRef, identifier: string): string {
  return (
    ref.variableMappings.find((mapping) => mapping.targetIdentifier === identifier)?.sourceIdentifier ?? identifier
  );
}

/** Returns the weight that an item ref defines with an identifier, 1 when it defines none (INFO §7.47.2, §7.50). */
export function weightOf(ref: AssessmentItemRef, weightIdentifier: string): number {
  return ref.weights.find((weight) => weight.identifier === weightIdentifier)?.value ?? DEFAULT_WEIGHT;
}

/**
 * Returns a value times a weight: an integer or float value becomes a float, and a value of any other base type is
 * returned as it is (INFO §7.47.2).
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
