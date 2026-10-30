import type { InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import {
  type Cardinality,
  container,
  type Pair,
  type Point,
  type Primitive,
  single,
  type Value,
} from "@luthfanwakan/olah/values";

/**
 * Returns the cardinality that the response variable of an interaction has: the declared one, else the first that the
 * interaction accepts, which is `single` where a single value fits (INFO §2.4).
 */
export function cardinalityOf(descriptor: InteractionDescriptor): Cardinality {
  return descriptor.declaration?.cardinality ?? descriptor.bindings[0]?.cardinality ?? "multiple";
}

/** Returns the primitives of a value: none for NULL and for a record, the value for a single value. */
export function primitivesOf(value: Value | null): readonly Primitive[] {
  if (value === null || value.cardinality === "record") return [];
  return value.cardinality === "single" ? [value.value] : value.values;
}

/** Returns the strings of a value, such as the identifiers that a choice interaction selected. */
export function stringsOf(value: Value | null): string[] {
  return primitivesOf(value).filter((primitive) => typeof primitive === "string");
}

/** Returns the pairs of a value, such as the associations that a match interaction holds. */
export function pairsOf(value: Value | null): Pair[] {
  return primitivesOf(value).filter(
    (primitive): primitive is Pair =>
      Array.isArray(primitive) && typeof primitive[0] === "string" && typeof primitive[1] === "string",
  );
}

/** Returns the points of a value, such as those that a select point interaction holds. */
export function pointsOf(value: Value | null): Point[] {
  return primitivesOf(value).filter(
    (primitive): primitive is Point =>
      Array.isArray(primitive) && typeof primitive[0] === "number" && typeof primitive[1] === "number",
  );
}

/**
 * Builds the response from values of one base type. Several values need a container; one value is `single` where the
 * variable is declared `single`, so that a candidate who selects one choice of a multiple variable still gives a
 * container. No values are NULL.
 *
 * @param ordered - Whether the container is `ordered`, as an order interaction's is. Default: `false`.
 */
export function responseOf(
  descriptor: InteractionDescriptor,
  baseType: "directedPair" | "identifier" | "pair" | "point",
  values: readonly Primitive[],
  ordered = false,
): Value | null {
  if (values.length === 0) return null;
  const [first] = values;
  if (!ordered && first !== undefined && values.length === 1 && cardinalityOf(descriptor) === "single") {
    return single(baseType, first);
  }
  return container(ordered ? "ordered" : "multiple", baseType, values);
}
