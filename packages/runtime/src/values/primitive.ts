import { describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { BaseType } from "./base-type.js";
import { isIdentifier } from "./identifier.js";

/** A point of the base type `point`: the horizontal and vertical position, integers (INFO §8.13). */
export type Point = readonly [x: number, y: number];

/** A pair of the base types `pair` and `directedPair`: two identifiers; a directed pair is source and destination. */
export type Pair = readonly [first: string, second: string];

/**
 * A value of the base type `file` (INFO §8.13): a reference to the bytes, which the host stores, with their content
 * type and optional name. The bytes are never part of a value.
 */
export interface FileValue {
  /** The host's reference to the stored bytes. */
  readonly reference: string;
  /** The content type, one of the MIME types of RFC 2045. */
  readonly mimeType: string;
  /** The name given to the file, such as the name of the uploaded file. */
  readonly fileName?: string;
}

/** The value of one base type: what a single value holds and a container holds many of. */
export type Primitive = boolean | number | string | Point | Pair | FileValue;

/** Returns whether a primitive is a `Point` or a `Pair`. */
export function isTuple(primitive: Primitive): primitive is Point | Pair {
  return Array.isArray(primitive);
}

/** Returns whether a primitive is a `FileValue`. */
export function isFileValue(primitive: Primitive): primitive is FileValue {
  return typeof primitive === "object" && !Array.isArray(primitive);
}

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
 * a caller's later changes and extra properties do not reach the copy. An integer of `-0` becomes `0`, as integers have
 * no sign of zero. The empty string is a string here; whether it is NULL is up to the caller.
 *
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
