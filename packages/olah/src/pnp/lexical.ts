import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { PnpExtensionTerm } from "./vocabularies.js";

/** `xs:float` and `xs:double` apart from `INF`, `-INF` and `NaN`, which a support has no use for. */
const FLOAT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** `xs:integer`. */
const INTEGER = /^[+-]?\d+$/;
/** `HexDType`: `#` and three or six hexadecimal digits (PNP XSD). */
const HEX_COLOR = /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
/** `ExtensionStringDType`: `ext:` and one or more letters, `|`, `.` or `_` (PNP XSD). */
const EXTENSION_TERM = /^ext:[A-Za-z|._]+$/;
/** The greatest `VolumeDType` (PNP XSD). */
const MAX_VOLUME = 1;

function isExtensionTerm(text: string): text is PnpExtensionTerm {
  return EXTENSION_TERM.test(text);
}

/** Adding 0 turns -0 into 0, which no support distinguishes. */
const withoutNegativeZero = (value: number): number => value + 0;

/**
 * Reads a decimal number, as `xs:float` writes it, with white space around it dropped.
 *
 * @throws `DataError` when the text is not a finite decimal number.
 */
export function toFloat(text: string): number {
  const token = text.trim();
  const value = Number(token);
  if (!(FLOAT.test(token) && Number.isFinite(value))) {
    throw new DataError(`The text ${describe(text)} is not a finite decimal number such as 1.5.`);
  }
  return withoutNegativeZero(value);
}

/**
 * Reads an integer, as `xs:integer` writes it, with white space around it dropped.
 *
 * @throws `DataError` when the text is not an integer, or one beyond the safe integers (D3).
 */
export function toInteger(text: string): number {
  const token = text.trim();
  const value = Number(token);
  if (!(INTEGER.test(token) && Number.isSafeInteger(value))) {
    throw new DataError(
      `The text ${describe(text)} is not an integer from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}.`,
    );
  }
  return withoutNegativeZero(value);
}

/**
 * Reads `true`, `false`, `1` or `0`, as `xs:boolean` writes it, with white space around it dropped.
 *
 * @throws `DataError` when the text is none of these.
 */
export function toBoolean(text: string): boolean {
  const token = text.trim();
  if (token === "true" || token === "1") return true;
  if (token === "false" || token === "0") return false;
  throw new DataError(`The text ${describe(text)} is not true, false, 1 or 0.`);
}

/**
 * Reads a color as `#RGB` or `#RRGGBB`.
 *
 * @throws `DataError` when the text is not one.
 */
export function toHexColor(text: string): string {
  const token = text.trim();
  if (!HEX_COLOR.test(token)) throw new DataError(`The text ${describe(text)} is not a color such as #336699 or #369.`);
  return token;
}

/**
 * Reads a volume: a decimal number of at most 1 (PNP XSD `VolumeDType`).
 *
 * @throws `DataError` when the text is not a finite decimal number, or is above 1.
 */
export function toVolume(text: string): number {
  const value = toFloat(text);
  if (value > MAX_VOLUME) throw new DataError(`The volume ${describe(text)} is above ${MAX_VOLUME}.`);
  return value;
}

/**
 * Returns a function that reads one of some terms or an extension term, with white space around it dropped.
 *
 * @param terms - The terms.
 * @param label - Names what the text is, such as `A hazard`, for the message.
 */
export function termOrExtension<T extends string>(
  terms: readonly T[],
  label: string,
): (text: string) => T | PnpExtensionTerm {
  return (text) => {
    const token = text.trim();
    const term = terms.find((candidate) => candidate === token);
    if (term !== undefined) return term;
    if (isExtensionTerm(token)) return token;
    const list = terms.map((candidate) => JSON.stringify(candidate)).join(", ");
    throw new DataError(`${label} must be one of ${list}, or ext: and letters, found ${describe(text)}.`);
  };
}

/**
 * Writes a finite number as a decimal.
 *
 * @param label - Names the value in the message, such as `The pitch`.
 * @throws `DataError` when `value` is not a finite number.
 */
export function floatText(value: unknown, label: string): string {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    throw new DataError(`${label} must be a finite number, found ${describe(value)}.`);
  }
  return String(withoutNegativeZero(value));
}

/**
 * Writes a safe integer.
 *
 * @param label - Names the value in the message, such as `The fixed minutes`.
 * @throws `DataError` when `value` is not a safe integer.
 */
export function integerText(value: unknown, label: string): string {
  if (!Number.isSafeInteger(value)) throw new DataError(`${label} must be a safe integer, found ${describe(value)}.`);
  return String(withoutNegativeZero(Number(value)));
}

/**
 * Writes `true` or `false`.
 *
 * @throws `DataError` when `value` is not a boolean.
 */
export function booleanText(value: unknown, label: string): string {
  if (typeof value !== "boolean") throw new DataError(`${label} must be a boolean, found ${describe(value)}.`);
  return String(value);
}

/**
 * Writes a color as it is.
 *
 * @throws `DataError` when `value` is not `#RGB` or `#RRGGBB`.
 */
export function hexColorText(value: unknown, label: string): string {
  if (!(typeof value === "string" && HEX_COLOR.test(value))) {
    throw new DataError(`${label} must be a color such as #336699 or #369, found ${describe(value)}.`);
  }
  return value;
}

/**
 * Writes a volume.
 *
 * @throws `DataError` when `value` is not a finite number of at most 1.
 */
export function volumeText(value: unknown, label: string): string {
  const text = floatText(value, label);
  if (Number(text) > MAX_VOLUME) throw new DataError(`${label} must be at most ${MAX_VOLUME}, found ${text}.`);
  return text;
}

/**
 * Writes one of some terms or an extension term, as the converter of {@link termOrExtension} reads it.
 *
 * @throws `DataError` when `value` is neither.
 */
export function termText<T extends string>(value: unknown, terms: readonly T[], label: string): string {
  if (typeof value !== "string") throw new DataError(`${label} must be a string, found ${describe(value)}.`);
  if (value !== value.trim())
    throw new DataError(`${label} must not have white space around it, found ${describe(value)}.`);
  return termOrExtension(terms, label)(value);
}
