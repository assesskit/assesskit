import type { Value } from "../values/index.js";
import { asNumber, floatResult, primitiveOf } from "./operands.js";

/**
 * The rounding modes of `qti-round-to` and `qti-equal-rounded`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-round-to}
 */
export type RoundingMode = "decimalPlaces" | "significantFigures";

/**
 * A finite number as decimal digits: (−1 if `negative`) × 0.`digits` × 10^`point`.
 *
 * @remarks
 * `digits` has no leading or trailing zeros, so zero has none.
 */
export interface Decimal {
  readonly negative: boolean;
  readonly digits: string;
  readonly point: number;
}

/**
 * The smallest digit that rounds the digit before it up: half up, away from zero.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const ROUND_UP_FROM = "5";

function normalized(negative: boolean, digits: string, point: number): Decimal {
  const leading = digits.length - digits.replace(/^0+/, "").length;
  const trimmed = digits.slice(leading).replace(/0+$/, "");
  return { negative, digits: trimmed, point: trimmed === "" ? 0 : point - leading };
}

/**
 * Returns the decimal digits of a finite number: those of its shortest round-trip representation, which
 * `Number.prototype.toString` writes (ECMAScript, Number::toString), so that 2.675 has the digits 2675.
 */
function decimalOf(value: number): Decimal {
  const [mantissa = "", exponent = "0"] = String(Math.abs(value)).split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  return normalized(value < 0 || Object.is(value, -0), whole + fraction, whole.length + Number(exponent));
}

/** Adds one to the last digit of digits that start with a zero, carrying, so that the result has as many digits. */
function increment(digits: string): string {
  const values = [...digits].map(Number);
  let index = values.length - 1;
  while (values[index] === 9) values[index--] = 0;
  values[index] = (values[index] ?? 0) + 1;
  return values.join("");
}

/**
 * Rounds a decimal by its deciding digit: the (n+1)th digit from the first non-zero digit for n significant figures, or
 * the (n+1)th digit after the decimal point for n decimal places. A deciding digit of 5 or more increases the nth digit
 * by one, carrying; the digits after the nth are discarded. Zero keeps its sign.
 *
 * @param figures - At least 1 for significant figures, at least 0 for decimal places.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function roundDecimal(value: Decimal, mode: RoundingMode, figures: number): Decimal {
  const kept = mode === "significantFigures" ? figures : value.point + figures;
  if (kept >= value.digits.length) return value;
  if (kept < 0) return { negative: value.negative, digits: "", point: 0 };
  const digits = value.digits.slice(0, kept);
  if (value.digits.charAt(kept) < ROUND_UP_FROM) return normalized(value.negative, digits, value.point);
  // A leading zero takes the carry of 9.99… to 10.0…, one place further left.
  return normalized(value.negative, increment(`0${digits}`), value.point + 1);
}

/** Returns the number nearest to a decimal, which is infinite when the decimal is beyond the range of a float. */
function numberOf(value: Decimal): number {
  if (value.digits === "") return value.negative ? -0 : 0;
  return Number(`${value.negative ? "-" : ""}0.${value.digits}e${value.point}`);
}

/** Returns whether two decimals are equal numbers; zero equals negative zero. */
export function sameDecimal(a: Decimal, b: Decimal): boolean {
  if (a.digits === "" || b.digits === "") return a.digits === b.digits;
  return a.negative === b.negative && a.digits === b.digits && a.point === b.point;
}

/**
 * Rounds a number as `qti-round-to` does: an infinity stays as it is, and a finite number becomes its decimal rounded
 * by its deciding digit.
 *
 * @returns `undefined` for NaN, which rounds to NULL.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-round-to}
 */
export function rounded(value: number, mode: RoundingMode, figures: number): Decimal | number | undefined {
  if (Number.isNaN(value)) return undefined;
  return Number.isFinite(value) ? roundDecimal(decimalOf(value), mode, figures) : value;
}

/**
 * Returns whether figures are in range for the mode: at least 1 significant figure, or at least 0 decimal places.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function figuresInRange(mode: RoundingMode, figures: number): boolean {
  return figures >= (mode === "significantFigures" ? 1 : 0);
}

/**
 * `qti-round-to`: the float nearest to the number rounded by its deciding digit; an infinity stays as it is.
 *
 * @remarks
 * NULL for NULL and NaN, when `figures` is NULL or out of range, and when the rounded decimal is beyond the range of a
 * float.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-round-to}
 */
export function roundTo(operand: Value | null, mode: RoundingMode, figures: number | null): Value | null {
  if (operand === null || figures === null || !figuresInRange(mode, figures)) return null;
  const result = rounded(asNumber(primitiveOf(operand)), mode, figures);
  if (result === undefined) return null;
  if (typeof result === "number") return floatResult(result);
  const number = numberOf(result);
  return Number.isFinite(number) ? floatResult(number) : null;
}
