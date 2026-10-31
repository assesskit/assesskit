import { checkString } from "../checks.js";
import { DataError } from "../errors.js";
import { type RecordValue, record, type SingleValue, single } from "../values/index.js";

/** The smallest and the largest number base that a numeric text can be read in: the digits are 0–9 and a–z (INFO §5.162.2). */
const MIN_BASE = 2;
const MAX_BASE = 36;
const DECIMAL = 10;

/** A decimal number as typed: a sign, the digits left and right of the point, and an exponent (INFO §2.4.2.2). */
const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** An integer in a base other than 10: a sign and digits, which are checked against the base afterward. */
const INTEGER_TEXT = /^([+-]?)([0-9a-zA-Z]+)$/;

/** What the text says about a number: the parts that the fields of the record count. */
interface Digits {
  readonly value: number;
  readonly left: string;
  readonly right: string;
  readonly isInteger: boolean;
  readonly exponent: number | undefined;
}

/** Reads a decimal number, or returns `undefined` when the text is not one. */
function readDecimal(text: string): Digits | undefined {
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return undefined;
  const [, , left = "", right = "", exponentText] = match;
  if (left === "" && right === "") return undefined;
  const exponent = exponentText === undefined ? undefined : Number(exponentText);
  if (exponent !== undefined && !Number.isSafeInteger(exponent)) return undefined;
  return { value: Number(text), left, right, isInteger: right === "" && exponent === undefined, exponent };
}

/** Reads an integer in the base, or returns `undefined` when the text is not one. */
function readInteger(text: string, base: number): Digits | undefined {
  const match = INTEGER_TEXT.exec(text);
  const [, sign = "", digits = ""] = match ?? [];
  if (match === null || [...digits].some((digit) => Number.parseInt(digit, MAX_BASE) >= base)) return undefined;
  const magnitude = Number.parseInt(digits, base);
  return {
    value: sign === "-" ? -magnitude : magnitude,
    left: digits,
    right: "",
    isInteger: true,
    exponent: undefined,
  };
}

/** Counts the digits from the first that is not 0; a number made of zeros has one significant digit. */
function significantDigits(digits: string): number {
  return Math.max(1, digits.replace(/^0+/, "").length);
}

/** A field of the record: its identifier and its value. */
type Field = readonly [identifier: string, value: SingleValue];

function integerField(value: number): SingleValue {
  return single("integer", value);
}

/**
 * Reads the text of a candidate's numeric entry into the record that a text interaction bound to a record gives (INFO
 * §2.4.2.2, §2.4.2.3). The fields, each present only when the text has a number:
 *
 * | Field          | Value                                                                                          |
 * | -------------- | ---------------------------------------------------------------------------------------------- |
 * | `stringValue`  | the text, as typed                                                                             |
 * | `floatValue`   | the number, as a float                                                                         |
 * | `integerValue` | the number, when the text has no fractional digits and no exponent and the number is a safe integer |
 * | `leftDigits`   | the digits left of the point, as typed                                                         |
 * | `rightDigits`  | the digits right of the point, as typed                                                        |
 * | `ndp`          | the fractional digits specified: `rightDigits` less the exponent, never below 0                |
 * | `nsf`          | the significant digits specified: the digits from the first that is not 0 to the last, at least 1 |
 * | `exponent`     | the exponent, when the text has one                                                            |
 *
 * White space around the number is ignored. In base 10 the text is a decimal with an optional sign, point and exponent
 * (`12.50e-3`); in another base it is an integer with an optional sign, and `floatValue` is that integer. A text that is
 * not a number in the base, or that is too large to be a finite float, has `stringValue` only.
 *
 * @param text - The text the candidate typed.
 * @param base - The number base, from 2 to 36. Default: `10`.
 * @returns The record, or `null` for the empty string, which is NULL (INFO §2.2.2).
 * @throws `DataError` when `text` is not a string or `base` is not an integer from 2 to 36.
 */
export function numericRecord(text: string, base = DECIMAL): RecordValue | null {
  checkString(text, "The text");
  if (!(Number.isInteger(base) && base >= MIN_BASE && base <= MAX_BASE)) {
    throw new DataError(`The base must be an integer from ${MIN_BASE} to ${MAX_BASE}, found ${String(base)}.`);
  }
  const stringValue = single("string", text);
  if (stringValue === null) return null;
  const trimmed = text.trim();
  const number = base === DECIMAL ? readDecimal(trimmed) : readInteger(trimmed, base);
  if (number === undefined || !Number.isFinite(number.value)) return record([["stringValue", stringValue]]);
  const { value, left, right, isInteger, exponent } = number;
  const fields: Field[] = [
    ["stringValue", stringValue],
    ["floatValue", single("float", value)],
  ];
  if (isInteger && Number.isSafeInteger(value)) fields.push(["integerValue", integerField(value)]);
  fields.push(
    ["leftDigits", integerField(left.length)],
    ["rightDigits", integerField(right.length)],
    ["ndp", integerField(Math.max(0, right.length - (exponent ?? 0)))],
    ["nsf", integerField(significantDigits(left + right))],
  );
  if (exponent !== undefined) fields.push(["exponent", integerField(exponent)]);
  return record(fields);
}
