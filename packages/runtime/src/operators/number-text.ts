import { add, fromDecimal, type Rational } from "./rational.js";
import { collapseWhiteSpace, trimWhiteSpace } from "./white-space.js";

/** A number as a response writes it: its exact value, the significant digits it shows, and the unit after it. */
export interface WrittenNumber {
  readonly value: Rational;
  /** The significant digits shown, or `null` for a fraction, which shows none. */
  readonly significant: number | null;
  /** The text after the number, its white space collapsed; empty for a bare number. */
  readonly unit: string;
}

/** How a number is read: its decimal mark, and whether `a/b` and `a b/c` read. */
export interface NumberReading {
  readonly separator: "." | ",";
  readonly fractions: boolean;
}

/** The largest power of ten a number may write, |n| at most 400, so that its exact value stays small. */
const MAX_EXPONENT = 400;
const SIGN = /^[+\-\u2212]/;
const MIXED =
  /^(\d+)[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+(\d+)[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*\/[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*(\d+)/u;
const FRACTION =
  /^(\d+)[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*\/[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*(\d+)/u;
const DECIMAL: Readonly<Record<NumberReading["separator"], RegExp>> = {
  ".": /^(?:(\d+)(?:\.(\d+))?|\.(\d+))/,
  ",": /^(?:(\d+)(?:,(\d+))?|,(\d+))/,
};
const E_POWER = /^[eE]([+\-\u2212]?\d+)/;
const TIMES_POWER =
  /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*(?:\\times|\u00d7)[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*10[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*\^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*(?:\{[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*([+\-\u2212]?\d+)[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*\}|([+\-\u2212]?\d+))/u;
/** What a unit cannot start with: a digit, a mark or a group separator, so that `1,000` and `1 000` are unreadable. */
const NOT_A_UNIT = /^[0-9.,'\\]/;

/** The significant digits that a decimal shows: from its first non-zero digit; a whole number's trailing zeros do not count. */
function significantDigits(whole: string, fraction: string | undefined): number {
  const digits = `${whole}${fraction ?? ""}`.replace(/^0+/, "");
  return fraction === undefined ? digits.replace(/0+$/, "").length : digits.length;
}

/** Reads a power of ten after a decimal: `e` and `n`, or `\times` or `×` and `10^n`; `undefined` past |n| of 400. */
function readPower(text: string): { exponent: number; length: number } | undefined | null {
  const match = E_POWER.exec(text) ?? TIMES_POWER.exec(text);
  if (match === null) return null;
  const exponent = Number((match[1] ?? match[2] ?? "").replace("\u2212", "-"));
  return Math.abs(exponent) > MAX_EXPONENT ? undefined : { exponent, length: match[0].length };
}

/** A number read without its sign and its unit, and the characters it took. */
interface Magnitude {
  readonly value: Rational;
  readonly significant: number | null;
  readonly length: number;
}

/** Reads `a b/c` or `a/b`; `null` when neither stands there, `undefined` for a zero denominator. */
function readFraction(text: string): Magnitude | null | undefined {
  const mixed = MIXED.exec(text);
  const match = mixed ?? FRACTION.exec(text);
  if (match === null) return null;
  const [whole = "0", numerator = "0", denominator = "0"] = mixed === null ? ["0", match[1], match[2]] : mixed.slice(1);
  if (BigInt(denominator) === 0n) return undefined;
  const value = add(fromDecimal(false, whole, "", 0), {
    numerator: BigInt(numerator),
    denominator: BigInt(denominator),
  });
  return { value, significant: null, length: match[0].length };
}

/** Reads a decimal and its power of ten; `undefined` when none reads, or past a power of 400. */
function readDecimal(text: string, separator: NumberReading["separator"]): Magnitude | undefined {
  const decimal = DECIMAL[separator].exec(text);
  if (decimal === null) return undefined;
  const whole = decimal[1] ?? "";
  const digits = decimal[2] ?? decimal[3];
  const power = readPower(text.slice(decimal[0].length));
  if (power === undefined) return undefined;
  return {
    value: fromDecimal(false, whole, digits ?? "", power?.exponent ?? 0),
    significant: significantDigits(whole, digits),
    length: decimal[0].length + (power?.length ?? 0),
  };
}

/** Reads the value of a number without its sign and its unit; `undefined` when none reads. */
function readMagnitude(text: string, reading: NumberReading): Magnitude | undefined {
  const fraction = reading.fractions ? readFraction(text) : null;
  return fraction === null ? readDecimal(text, reading.separator) : fraction;
}

/**
 * Reads a number as `number-equivalent` reads a response: a leading sign; digits with at most one decimal mark, and with
 * `fractions` `a/b` and a mixed `a b/c`; a power of ten as `e` and `n`, `\times10^{n}` or `×10^n`, |n| at most 400; then
 * a unit, the rest of the text.
 *
 * @returns `undefined` when it does not read: no number, a power past 400, a group separator, or a zero denominator.
 */
export function readNumberText(text: string, reading: NumberReading): WrittenNumber | undefined {
  const trimmed = trimWhiteSpace(text);
  const sign = SIGN.exec(trimmed)?.[0];
  const body = sign === undefined ? trimmed : trimmed.slice(sign.length);
  const magnitude = readMagnitude(body, reading);
  if (magnitude === undefined) return undefined;
  const rest = trimWhiteSpace(body.slice(magnitude.length));
  if (NOT_A_UNIT.test(rest)) return undefined;
  const negative = sign === "-" || sign === "\u2212";
  const value = negative ? { ...magnitude.value, numerator: -magnitude.value.numerator } : magnitude.value;
  return { value, significant: magnitude.significant, unit: collapseWhiteSpace(rest) };
}

/** Collapses the white space of a unit's name, as a response's unit is collapsed before it is looked up. */
export function collapseUnit(name: string): string {
  return collapseWhiteSpace(name);
}
