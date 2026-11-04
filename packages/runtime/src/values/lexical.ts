import { checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { type BaseType, checkBaseType } from "./base-type.js";
import { isIdentifier } from "./identifier.js";
import { normalizePrimitive } from "./normalize-primitive.js";
import { type FileValue, isFileValue, isTuple, type Pair, type Point, type Primitive } from "./primitive.js";
import { xmlTokens } from "./xml-tokens.js";

/** `xs:integer`: an optional sign and digits. */
const INTEGER_LEXICAL = /^[+-]?[0-9]+$/;

/** `xs:double` apart from `INF`, `-INF` and `NaN`: a decimal number with an optional exponent. */
const DOUBLE_LEXICAL = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/**
 * The content type of a `file` read from XML. A document writes the reference alone, so the content type is the one that
 * RFC 2046 gives to bytes of an unknown type.
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
 * Reads the lexical form of a value of a base type, as a document writes it.
 *
 * @remarks
 * Whitespace around a value is dropped and runs of whitespace inside it count as one space, as the `collapse` rule of XML
 * Schema says, except for a `string`, which stays as it is.
 *
 * | Base type | Lexical form |
 * | --- | --- |
 * | `boolean` | `true`, `false`, `1` or `0` |
 * | `integer` | `xs:integer` within the safe integers: a larger integer is refused |
 * | `float`, `duration` | `xs:double` with `INF`, `-INF` and `NaN`; a duration is in seconds |
 * | `string`, `uri` | the text |
 * | `identifier` | an identifier |
 * | `point` | two integers, `x y` |
 * | `pair`, `directedPair` | two identifiers, `a b` |
 * | `file` | the reference alone; its content type is `application/octet-stream` |
 *
 * The empty string is NULL; this function returns it as a string, and {@link buildSingle} turns it into `null`.
 *
 * @param text - The text of the value.
 * @param baseType - The base type.
 * @returns The value, with the JavaScript type that the base type has.
 * @throws `DataError` when `text` is not a string, `baseType` is not a base type or the text is not in the lexical form.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, base types}
 * @see {@link https://www.w3.org/TR/xmlschema-2/ | XML Schema Part 2: Datatypes}
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
 * Writes a number in the lexical form of `xs:double`.
 *
 * @param value - The number.
 * @returns `INF`, `-INF`, `NaN`, `-0`, and otherwise the shortest decimal that reads back as the same number, with an
 * exponent for very large and very small numbers.
 */
export function formatDouble(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "INF";
  if (value === Number.NEGATIVE_INFINITY) return "-INF";
  return Object.is(value, -0) ? "-0" : String(value);
}

/**
 * Writes a value of a base type in its lexical form, so that reading the text gives the value back.
 *
 * @remarks
 * A `file` is written as its reference alone, so its content type and name are not part of the text.
 *
 * @param value - A value of the base type, as {@link buildSingle} takes it.
 * @param baseType - The base type.
 * @returns The text.
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

/**
 * Writes a field of a base type that may be absent: `undefined` is absent, and every other value is written by
 * {@link formatPrimitive}, which checks it.
 */
export function optionalText(value: Primitive | undefined, baseType: BaseType): string | undefined {
  return value === undefined ? undefined : formatPrimitive(value, baseType);
}
