import { describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { BaseType } from "./base-type.js";
import { isIdentifier } from "./identifier.js";
import type { FileValue, Pair, Point, Primitive } from "./primitive.js";

function fail(baseType: BaseType, expected: string, found: unknown): never {
  throw new DataError(`A value of base type ${baseType} must be ${expected}, found ${describe(found)}.`);
}

/** Returns the two items of an array of two, or two `undefined` for any other value. */
function twoItems(value: unknown): readonly [unknown, unknown] {
  return Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : [undefined, undefined];
}

const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/**
 * Checks that a value is a value of a base type and returns a copy that holds only the properties of the type, so that
 * a caller's later changes and extra properties do not reach the copy.
 *
 * @remarks
 * An integer of `-0` becomes `0`, as integers have no sign of zero. The empty string is a string here: whether it is
 * NULL is up to the caller.
 *
 * @param baseType - The base type.
 * @param value - Untrusted data that should be a value of `baseType`.
 * @returns The copy.
 * @throws `DataError` when the value is not of the base type.
 */
export function normalizePrimitive(baseType: BaseType, value: unknown): Primitive {
  switch (baseType) {
    case "point":
      return normalizePoint(value);
    case "pair":
    case "directedPair":
      return normalizePair(baseType, value);
    case "file":
      return normalizeFile(value);
    default:
      return normalizeScalar(baseType, value);
  }
}

function normalizeScalar(
  baseType: Exclude<BaseType, "point" | "pair" | "directedPair" | "file">,
  value: unknown,
): Primitive {
  switch (baseType) {
    case "boolean":
      return typeof value === "boolean" ? value : fail(baseType, "a boolean", value);
    case "integer":
      // Adding 0 turns -0 into 0.
      return isSafeInteger(value) ? value + 0 : fail(baseType, "a safe integer", value);
    case "float":
      return typeof value === "number" ? value : fail(baseType, "a number", value);
    case "duration":
      return typeof value === "number" ? value : fail(baseType, "a number of seconds", value);
    case "identifier":
      return isIdentifier(value) ? value : fail(baseType, "an identifier", value);
    case "string":
    case "uri":
      return typeof value === "string" ? value : fail(baseType, "a string", value);
  }
}

function normalizePoint(value: unknown): Point {
  const [x, y] = twoItems(value);
  return isSafeInteger(x) && isSafeInteger(y) ? [x + 0, y + 0] : fail("point", "an array of two safe integers", value);
}

function normalizePair(baseType: "pair" | "directedPair", value: unknown): Pair {
  const [first, second] = twoItems(value);
  return isIdentifier(first) && isIdentifier(second)
    ? [first, second]
    : fail(baseType, "an array of two identifiers", value);
}

function normalizeFile(value: unknown): FileValue {
  const expected = "an object with a reference, a mimeType and optionally a fileName, all strings";
  if (!isRecord(value)) return fail("file", expected, value);
  const { reference, mimeType, fileName } = value;
  if (typeof reference !== "string" || reference === "" || typeof mimeType !== "string" || mimeType === "") {
    return fail("file", expected, value);
  }
  if (fileName === undefined) return { reference, mimeType };
  return typeof fileName === "string" ? { reference, mimeType, fileName } : fail("file", expected, value);
}
