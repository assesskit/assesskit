import { checkArray, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { formatPrimitive, isIdentifier } from "../values/index.js";
import { parsePrimitive, xmlTokens } from "../values/internal.js";
import type { AttributeType } from "./table.js";

/** The prefix of a term that extends a vocabulary. */
const EXTENSION_PREFIX = "ext:";

/** `xs:integer`: an optional sign and digits (XML Schema Part 2, 3.3.13). */
const INTEGER_TEXT = /^[+-]?[0-9]+$/;

type NumberBaseType = "integer" | "float";

/** The words of `xs:double` that are valid identifiers too; they read as numbers, as the first member of the union does. */
const NUMERIC_WORDS: ReadonlySet<string> = new Set(["INF", "NaN"]);

function invalid(text: string, expected: string): never {
  throw new DataError(`The text ${describe(text)} is not ${expected}.`);
}

function parseNumber(text: string, baseType: NumberBaseType): number {
  const value = parsePrimitive(text, baseType);
  if (typeof value !== "number") throw new DataError(`The text ${describe(text)} is not a number.`);
  return value;
}

function isTerm(type: Extract<AttributeType, { kind: "enum" }>, text: string): boolean {
  if (type.terms.includes(text)) return true;
  return type.extension === true && text.startsWith(EXTENSION_PREFIX) && text.length > EXTENSION_PREFIX.length;
}

function parseEnum(type: Extract<AttributeType, { kind: "enum" }>, text: string): string {
  if (isTerm(type, text)) return text;
  const terms = type.terms.map((term) => JSON.stringify(term)).join(", ");
  return invalid(text, `one of ${terms}${type.extension === true ? " or an ext: term" : ""}`);
}

/** Returns the identifier inside the braces of `{identifier}`, or `undefined` for text that is not of that form. */
function unbrace(token: string): string | undefined {
  const name = token.startsWith("{") && token.endsWith("}") ? token.slice(1, -1) : undefined;
  return name !== undefined && isIdentifier(name) ? name : undefined;
}

function parseReference(type: Extract<AttributeType, { kind: "reference" }>, text: string): number | string {
  const token = xmlTokens(text).join(" ");
  const named = type.braced === true ? unbrace(token) : undefined;
  if (named !== undefined) return named;
  const baseType = type.value === "integer" ? "integer" : "float";
  const isNumber =
    baseType === "integer"
      ? INTEGER_TEXT.test(token)
      : token !== "" && (!isIdentifier(token) || NUMERIC_WORDS.has(token));
  if (isNumber) return parseNumber(token, baseType);
  return isIdentifier(token) ? token : invalid(text, "a number or the identifier of a variable");
}

/**
 * Reads the text of an attribute, or of an element with text content, as its type says. A
 * reference is a number when the text is one and otherwise the identifier of a variable, which no number can be.
 *
 * @param type - The type from the element table.
 * @param text - The text as written.
 * @returns A string, boolean, number or array; for a `reference`, a number or a string that names a variable.
 * @throws `DataError` when the text is not in the lexical form of the type.
 */
export function parseAttributeValue(type: AttributeType, text: string): unknown {
  switch (type.kind) {
    case "string":
      return text;
    case "boolean":
      return parsePrimitive(text, "boolean");
    case "integer":
      return parseNumber(text, "integer");
    case "double":
      return parseNumber(text, "float");
    case "enum":
      return parseEnum(type, text);
    case "list":
      return xmlTokens(text).map((token) => parseAttributeValue(type.item, token));
    case "reference":
      return parseReference(type, text);
  }
}

function formatNumber(value: unknown, baseType: NumberBaseType): string {
  if (typeof value !== "number") throw new DataError(`A value must be a number, found ${describe(value)}.`);
  return formatPrimitive(value, baseType);
}

function formatReference(type: Extract<AttributeType, { kind: "reference" }>, value: unknown): string {
  if (typeof value === "number") return formatNumber(value, type.value === "integer" ? "integer" : "float");
  if (type.braced === true && isIdentifier(value)) return `{${value}}`;
  if (isIdentifier(value) && !(type.value === "double" && NUMERIC_WORDS.has(value))) return value;
  throw new DataError(`A value must be a number or the identifier of a variable, found ${describe(value)}.`);
}

function formatItem(type: AttributeType, item: unknown): string {
  const text = formatAttributeValue(type, item);
  if (xmlTokens(text).length !== 1 || xmlTokens(text)[0] !== text) {
    throw new DataError(`The item ${describe(text)} of a list must be text without white space.`);
  }
  return text;
}

/**
 * Writes a value as the text of an attribute, so that {@link parseAttributeValue} reads it back.
 *
 * @param type - The type from the element table.
 * @param value - The value of the model.
 * @returns The text of the value.
 * @throws `DataError` when the value is not a value of the type.
 */
export function formatAttributeValue(type: AttributeType, value: unknown): string {
  switch (type.kind) {
    case "string":
      checkString(value, "A value");
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new DataError(`A value must be a boolean, found ${describe(value)}.`);
      return String(value);
    case "integer":
      return formatNumber(value, "integer");
    case "double":
      return formatNumber(value, "float");
    case "enum":
      checkString(value, "A value");
      return parseEnum(type, value);
    case "list":
      checkArray(value, "A value must be an array");
      return value.map((item) => formatItem(type.item, item)).join(" ");
    case "reference":
      return formatReference(type, value);
  }
}
