import { bigGcd } from "../processing/internal.js";

/** An exact rational number, its denominator above 0, so that a number's verdicts equal Python's `fractions` and `decimal`. */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const ZERO: Rational = { numerator: 0n, denominator: 1n };

/** The power of ten 10^n, for n from 0. */
function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** A decimal number with a power of ten: `digits` with `fraction` digits after the mark, times 10^exponent. */
export function fromDecimal(negative: boolean, whole: string, fraction: string, exponent: number): Rational {
  const digits = BigInt(`${whole}${fraction}` || "0");
  const scale = exponent - fraction.length;
  const signed = negative ? -digits : digits;
  return scale >= 0
    ? { numerator: signed * powerOfTen(scale), denominator: 1n }
    : { numerator: signed, denominator: powerOfTen(-scale) };
}

/** The exact value of a double, read from its shortest decimal form, so that 1.1 is 11/10. */
export function fromNumber(value: number): Rational {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (match === null) return ZERO;
  const [, sign = "", whole = "0", fraction = "", exponent = "0"] = match;
  return fromDecimal(sign === "-", whole, fraction, Number(exponent));
}

export function subtract(a: Rational, b: Rational): Rational {
  return {
    numerator: a.numerator * b.denominator - b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  };
}

export function multiply(a: Rational, b: Rational): Rational {
  return { numerator: a.numerator * b.numerator, denominator: a.denominator * b.denominator };
}

export function add(a: Rational, b: Rational): Rational {
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  };
}

export function absolute(a: Rational): Rational {
  return a.numerator < 0n ? { numerator: -a.numerator, denominator: a.denominator } : a;
}

/** Compares two rationals: negative, 0 or positive, as `a` is below, equal to or above `b`. */
export function compare(a: Rational, b: Rational): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** The number of decimal digits of a positive integer. */
function digitCount(value: bigint): number {
  return value.toString().length;
}

/**
 * Rounds to a number of significant figures, half away from zero, as Python's `decimal` with `ROUND_HALF_UP`.
 *
 * @param figures - At least 1.
 */
export function roundSignificant(value: Rational, figures: number): Rational {
  const magnitude = absolute(value);
  if (magnitude.numerator === 0n) return ZERO;
  // The exponent k with 10^k ≤ |value| < 10^(k+1), from the digit counts, corrected by one comparison.
  let exponent = digitCount(magnitude.numerator) - digitCount(magnitude.denominator);
  if (compare(magnitude, powerTen(exponent)) < 0) exponent -= 1;
  const shift = figures - 1 - exponent;
  const scaled = multiply(magnitude, powerTen(shift));
  const rounded = (2n * scaled.numerator + scaled.denominator) / (2n * scaled.denominator);
  const result = multiply({ numerator: rounded, denominator: 1n }, powerTen(-shift));
  return value.numerator < 0n ? { numerator: -result.numerator, denominator: result.denominator } : result;
}

/** The text of a rational in lowest terms, `numerator/denominator`, so that equal values have equal texts. */
export function canonicalText(value: Rational): string {
  const divisor = bigGcd(value.numerator < 0n ? -value.numerator : value.numerator, value.denominator);
  return `${value.numerator / divisor}/${value.denominator / divisor}`;
}

/** 10^n as a rational, for any integer n. */
function powerTen(exponent: number): Rational {
  return exponent >= 0
    ? { numerator: powerOfTen(exponent), denominator: 1n }
    : { numerator: 1n, denominator: powerOfTen(-exponent) };
}
