import { checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { type BaseType, checkBaseType } from "./base-type.js";
import { isIdentifier } from "./identifier.js";
import {
  type FileValue,
  isFileValue,
  isTuple,
  normalizePrimitive,
  type Pair,
  type Point,
  type Primitive,
} from "./primitive.js";
import { xmlTokens } from "./whitespace.js";

/** `xs:integer`: an optional sign and digits (XML Schema Part 2, 3.3.13). */
const INTEGER_LEXICAL = /^[+-]?[0-9]+$/;

/** `xs:double` apart from `INF`, `-INF` and `NaN`: a decimal number with an optional exponent (3.2.5). */
const DOUBLE_LEXICAL = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/**
 * The content type of a `file` value read from XML. The XML form of a file is its reference alone (G10), so the content
 * type is the one that RFC 2046, 4.5.1, gives to bytes of an unknown type.
 */
const UNKNOWN_MIME_TYPE = "application/octet-stream";

function invalid(text: string, baseType: BaseType, expected: string): never {
  const article = baseType === "integer" || baseType === "identifier" ? "an" : "a";
  throw new DataError(`The text ${describe(text)} is not ${article} ${baseType}: expected ${expected}.`);
}

function readInteger(token: string, baseType: BaseType): number {
  if (!INTEGER_LEXICAL.test(token)) invalid(token, baseType, "an optional sign and digits");
  const value = Number(token);
  if (!Number.isSafeInteger(value)) {
    invalid(token, baseType, `an integer from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}`);
  }
  // Adding 0 turns -0 into 0.
  return value + 0;
}

function parseDouble(token: string, baseType: BaseType): number {
  if (token === "INF") return Number.POSITIVE_INFINITY;
  if (token === "-INF") return Number.NEGATIVE_INFINITY;
  if (token === "NaN") return Number.NaN;
  if (!DOUBLE_LEXICAL.test(token))
    invalid(token, baseType, "a decimal number with an optional exponent, INF, -INF or NaN");
  return Number(token);
}

function parseIdentifier(token: string, baseType: BaseType): string {
  return isIdentifier(token) ? token : invalid(token, baseType, "an identifier");
}

/** Reads the two whitespace-separated parts of a point or a pair. */
function twoTokens(tokens: readonly string[], text: string, baseType: BaseType): readonly [string, string] {
  const [first, second, ...rest] = tokens;
  return first !== undefined && second !== undefined && rest.length === 0
    ? [first, second]
    : invalid(text, baseType, "two parts separated by whitespace");
}

/**
 * Reads the lexical form of a value of a base type, as a document writes it (INFO §8.13, BIND §2.9). Whitespace around
 * a value is dropped and runs of whitespace inside it count as one space, as XML Schema's `collapse` rule says, except
 * for a `string`, which stays as it is.
 *
 * | Base type | Lexical form |
 * | --- | --- |
 * | `boolean` | `true`, `false`, `1` or `0` |
 * | `integer` | `xs:integer` within the safe integers (G2) |
 * | `float`, `duration` | `xs:double` with `INF`, `-INF` and `NaN`; a duration is in seconds |
 * | `string`, `uri` | the text |
 * | `identifier` | an identifier |
 * | `point` | two integers, `x y` |
 * | `pair`, `directedPair` | two identifiers, `a b` |
 * | `file` | the reference alone; its content type is `application/octet-stream` (G10) |
 *
 * The empty string is NULL (INFO §2.2.2); this function returns it as a string, and `single` turns it into `null`.
 *
 * @param text - The text of the value.
 * @param baseType - The base type.
 * @throws `DataError` when `text` is not a string, `baseType` is not a base type or the text is not in the lexical form.
 */
export function parsePrimitive(text: string, baseType: "boolean"): boolean;
export function parsePrimitive(text: string, baseType: "integer" | "float" | "duration"): number;
export function parsePrimitive(text: string, baseType: "string" | "identifier" | "uri"): string;
export function parsePrimitive(text: string, baseType: "point" | "pair" | "directedPair"): Point | Pair;
export function parsePrimitive(text: string, baseType: "file"): FileValue;
export function parsePrimitive(text: string, baseType: BaseType): Primitive;
export function parsePrimitive(text: string, baseType: BaseType): Primitive {
  checkString(text, "The text");
  checkBaseType(baseType);
  if (baseType === "string") return text;
  const tokens = xmlTokens(text);
  const token = tokens.join(" ");
  switch (baseType) {
    case "boolean":
      if (token === "true" || token === "1") return true;
      return token === "false" || token === "0" ? false : invalid(text, baseType, "true, false, 1 or 0");
    case "integer":
      return readInteger(token, baseType);
    case "float":
    case "duration":
      return parseDouble(token, baseType);
    case "uri":
      return token;
    case "identifier":
      return parseIdentifier(token, baseType);
    case "point": {
      const [x, y] = twoTokens(tokens, text, baseType);
      return [readInteger(x, baseType), readInteger(y, baseType)];
    }
    case "pair":
    case "directedPair": {
      const [first, second] = twoTokens(tokens, text, baseType);
      return [parseIdentifier(first, baseType), parseIdentifier(second, baseType)];
    }
    case "file":
      return token === "" ? invalid(text, baseType, "a reference") : { reference: token, mimeType: UNKNOWN_MIME_TYPE };
  }
}

/**
 * Reads an integer in the lexical form of `xs:integer`, with whitespace around it dropped; see {@link parsePrimitive}.
 *
 * @throws `DataError` when `text` is not a string, is not an integer or is outside the safe integers.
 */
export function parseInteger(text: string): number {
  checkString(text, "The text");
  return readInteger(xmlTokens(text).join(" "), "integer");
}

/**
 * Writes a number in the lexical form of `xs:double`: `INF`, `-INF`, `NaN`, `-0` and otherwise the shortest decimal
 * that reads back as the same number, which has an exponent for very large and very small numbers.
 */
export function formatDouble(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "INF";
  if (value === Number.NEGATIVE_INFINITY) return "-INF";
  return Object.is(value, -0) ? "-0" : String(value);
}

/**
 * Writes a value of a base type in its lexical form, so that `parsePrimitive` reads it back. A `file` is written as its
 * reference alone (G10), so its content type and name are not part of the text.
 *
 * @param value - A value of the base type, as `single` takes it.
 * @param baseType - The base type.
 * @throws `DataError` when `baseType` is not a base type or `value` is not a value of it.
 */
export function formatPrimitive(value: Primitive, baseType: BaseType): string {
  checkBaseType(baseType);
  const primitive = normalizePrimitive(baseType, value);
  if (typeof primitive === "boolean") return String(primitive);
  if (typeof primitive === "number") return formatDouble(primitive);
  if (typeof primitive === "string") return primitive;
  if (isTuple(primitive)) return primitive.join(" ");
  return isFileValue(primitive) ? primitive.reference : "";
}
