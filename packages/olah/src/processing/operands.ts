import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { BaseType, Point, Primitive, SingleValue, Value } from "../values/index.js";

/** Returns the primitives of a single value or a container; a record has none. */
export function primitivesOf(value: Value): readonly Primitive[] {
  if (value.cardinality === "single") return [value.value];
  return value.cardinality === "record" ? [] : value.values;
}

/** Returns the base type of a single value or a container, `undefined` for a record. */
export function baseTypeOf(value: Value): BaseType | undefined {
  return value.cardinality === "record" ? undefined : value.baseType;
}

function malformed(value: Primitive, expected: string): never {
  throw new DataError(`A value holds ${describe(value)} where ${expected} belongs.`);
}

/**
 * Returns a primitive as a number.
 *
 * @throws `DataError` when it is not one, which a value of a numeric base type always is.
 */
export function asNumber(primitive: Primitive): number {
  return typeof primitive === "number" ? primitive : malformed(primitive, "a number");
}

/**
 * Returns a primitive as a string.
 *
 * @throws `DataError` when it is not one.
 */
export function asString(primitive: Primitive): string {
  return typeof primitive === "string" ? primitive : malformed(primitive, "a string");
}

/**
 * Returns a primitive as a boolean.
 *
 * @throws `DataError` when it is not one.
 */
export function asBoolean(primitive: Primitive): boolean {
  return typeof primitive === "boolean" ? primitive : malformed(primitive, "a boolean");
}

/**
 * Returns a primitive as a point.
 *
 * @throws `DataError` when it is not one.
 */
export function asPoint(primitive: Primitive): Point {
  if (Array.isArray(primitive) && typeof primitive[0] === "number" && typeof primitive[1] === "number") {
    return [primitive[0], primitive[1]];
  }
  return malformed(primitive, "a point");
}

/** Returns the numbers of a single value or a container. */
export function numbersOf(value: Value): number[] {
  return primitivesOf(value).map(asNumber);
}

/** Returns the one primitive of a single value. */
export function primitiveOf(value: Value): Primitive {
  const [primitive] = primitivesOf(value);
  if (primitive === undefined) throw new DataError("A record holds no primitive.");
  return primitive;
}

/** Returns whether every value has the base type integer, so that arithmetic on them gives an integer. */
export function allIntegers(values: readonly Value[]): boolean {
  return values.every((value) => baseTypeOf(value) === "integer");
}

/** Builds a single boolean, NULL for `null`. */
export function booleanResult(value: boolean | null): SingleValue | null {
  return value === null ? null : { cardinality: "single", baseType: "boolean", value };
}

/** Builds a single integer, NULL when the number is not a safe integer (D3). */
export function integerResult(value: number): SingleValue | null {
  // Adding 0 turns -0 into 0, as integers have no sign of zero.
  return Number.isSafeInteger(value) ? { cardinality: "single", baseType: "integer", value: value + 0 } : null;
}

/** Builds a single float. */
export function floatResult(value: number): SingleValue {
  return { cardinality: "single", baseType: "float", value };
}

/** Builds a single integer, NULL when the exact result is outside the safe integers (D3). */
export function bigIntegerResult(value: bigint): SingleValue | null {
  const safe = value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER);
  return safe ? integerResult(Number(value)) : null;
}
