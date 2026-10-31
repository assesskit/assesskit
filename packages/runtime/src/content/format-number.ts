import type { Conversion, FormatSpecification } from "./format-specification.js";

/** The conversions that write `INF`, `NAN` and the exponent letter in capitals. */
const CAPITAL_CONVERSIONS: readonly Conversion[] = ["E", "G", "R"];

/**
 * The precision of the float conversions when the specifier gives none.
 *
 * @see {@link https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf | ISO/IEC 9899:2011, formatted output}
 */
const DEFAULT_PRECISION = 6;

/**
 * The smallest decimal exponent that `g` and `G` write in the fixed form.
 *
 * @see {@link https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf | ISO/IEC 9899:2011, formatted output}
 */
const MIN_FIXED_EXPONENT = -4;

/** The fewest digits of the exponent that `e` and `g` write, as in `e+03`. */
const EXPONENT_DIGITS = 2;
/** The bits of the fraction of an IEEE 754 binary64 number. */
const BITS_OF_FRACTION = 52n;
/** The mask of the 11 bits of the exponent of an IEEE 754 binary64 number. */
const EXPONENT_MASK = 0x7ffn;
/** The mask of the fraction bits. */
const FRACTION_MASK = (1n << BITS_OF_FRACTION) - 1n;
/** The bit that a normal number has before its fraction and does not store. */
const IMPLICIT_BIT = 1n << BITS_OF_FRACTION;
/** The exponent of a double's integer mantissa: 1023 for the bias and 52 for the fraction bits. */
const EXPONENT_OFFSET = 1075;

/** A non-negative number as an integer times a power of ten: `digits × 10^−scale`, exactly. */
interface Exact {
  readonly digits: bigint;
  readonly scale: number;
}

/** Returns the exact value of a finite, non-negative double: its mantissa times a power of 2 is a finite decimal. */
function exactValue(magnitude: number): Exact {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, magnitude);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> BITS_OF_FRACTION) & EXPONENT_MASK);
  const fraction = bits & FRACTION_MASK;
  const mantissa = exponentBits === 0 ? fraction : fraction | IMPLICIT_BIT;
  const exponent = Math.max(exponentBits, 1) - EXPONENT_OFFSET;
  if (exponent >= 0) return { digits: mantissa << BigInt(exponent), scale: 0 };
  // mantissa / 2^k = mantissa × 5^k / 10^k.
  return { digits: mantissa * 5n ** BigInt(-exponent), scale: -exponent };
}

/** Divides by 10^power and rounds to the nearest integer, a tie to the even one, as the C library rounds. */
function divideRounded(value: bigint, power: number): bigint {
  const divisor = 10n ** BigInt(power);
  const quotient = value / divisor;
  const twice = (value % divisor) * 2n;
  return twice > divisor || (twice === divisor && quotient % 2n === 1n) ? quotient + 1n : quotient;
}

/** Returns the digits of the value with `places` digits after the point, as the integer and the fraction text. */
function fixedDigits(exact: Exact, places: number): { readonly whole: string; readonly fraction: string } {
  const scaled =
    places >= exact.scale
      ? exact.digits * 10n ** BigInt(places - exact.scale)
      : divideRounded(exact.digits, exact.scale - places);
  const text = scaled.toString().padStart(places + 1, "0");
  return { whole: text.slice(0, text.length - places), fraction: text.slice(text.length - places) };
}

/** Returns the `count` significant digits of the value and the decimal exponent of the first of them. */
function significantDigits(exact: Exact, count: number): { readonly digits: string; readonly exponent: number } {
  if (exact.digits === 0n) return { digits: "0".repeat(count), exponent: 0 };
  const text = exact.digits.toString();
  const exponent = text.length - 1 - exact.scale;
  if (text.length <= count) return { digits: text.padEnd(count, "0"), exponent };
  const rounded = divideRounded(exact.digits, text.length - count).toString();
  // Rounding 9.99… up gives 10…0, one digit too many: the exponent grows instead.
  return rounded.length > count
    ? { digits: rounded.slice(0, count), exponent: exponent + 1 }
    : { digits: rounded, exponent };
}

function exponentText(exponent: number, upper: boolean): string {
  const magnitude = String(Math.abs(exponent)).padStart(EXPONENT_DIGITS, "0");
  return `${upper ? "E" : "e"}${exponent < 0 ? "-" : "+"}${magnitude}`;
}

function scientific(exact: Exact, places: number, upper: boolean, alternate: boolean): string {
  const { digits, exponent } = significantDigits(exact, places + 1);
  const point = places > 0 || alternate ? "." : "";
  return `${digits.slice(0, 1)}${point}${digits.slice(1)}${exponentText(exponent, upper)}`;
}

function fixed(exact: Exact, places: number, alternate: boolean): string {
  const { whole, fraction } = fixedDigits(exact, places);
  return `${whole}${places > 0 || alternate ? "." : ""}${fraction}`;
}

/** Removes the zeros at the end of the fraction, and the point when no fraction is left (`g` without `#`). */
function trimZeros(text: string): string {
  const exponentAt = text.search(/[eE]/);
  const mantissa = exponentAt < 0 ? text : text.slice(0, exponentAt);
  const rest = exponentAt < 0 ? "" : text.slice(exponentAt);
  return mantissa.includes(".") ? `${mantissa.replace(/\.?0+$/, "")}${rest}` : text;
}

/**
 * Writes `g`, `G`, `r` and `R`: P significant digits, in the fixed form unless the exponent X after rounding is P or
 * more, which `g` also does when X is below −4. `r` and `R` never leave the fixed form for a small number: scientific
 * form is only used when the requested number of significant figures is less than the number of digits to the left of
 * the decimal point.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-printed-variable}
 */
function general(exact: Exact, specification: FormatSpecification): string {
  const { conversion, precision = DEFAULT_PRECISION, alternate } = specification;
  const places = Math.max(precision, 1);
  const upper = conversion === "G" || conversion === "R";
  const lowerLimit = conversion === "g" || conversion === "G" ? MIN_FIXED_EXPONENT : Number.NEGATIVE_INFINITY;
  const { exponent } = significantDigits(exact, places);
  const useFixed = places > exponent && exponent >= lowerLimit;
  const text = useFixed
    ? fixed(exact, places - 1 - exponent, alternate)
    : scientific(exact, places - 1, upper, alternate);
  return alternate ? text : trimZeros(text);
}

function pad(specification: FormatSpecification, prefix: string, body: string, mayZeroPad: boolean): string {
  const fill = specification.width - prefix.length - body.length;
  if (fill <= 0) return prefix + body;
  if (specification.leftAlign) return prefix + body + " ".repeat(fill);
  return specification.zeroPad && mayZeroPad ? prefix + "0".repeat(fill) + body : " ".repeat(fill) + prefix + body;
}

function signOf(specification: FormatSpecification, negative: boolean): string {
  if (negative) return "-";
  if (specification.plus) return "+";
  return specification.space ? " " : "";
}

/** Writes a number that has no digits: `inf` and `nan`, in capitals for the capital conversions, as C writes them. */
function nonFinite(specification: FormatSpecification, value: number): string {
  const word = Number.isNaN(value) ? "nan" : "inf";
  const text = CAPITAL_CONVERSIONS.includes(specification.conversion) ? word.toUpperCase() : word;
  return pad(specification, signOf(specification, value < 0), text, false);
}

function integerDigits(specification: FormatSpecification, magnitude: bigint, base: number): string {
  const { conversion, precision, alternate } = specification;
  const radix = conversion === "o" ? 8 : conversion === "x" || conversion === "X" ? 16 : base;
  let digits = magnitude.toString(radix);
  if (precision !== undefined) digits = precision === 0 && magnitude === 0n ? "" : digits.padStart(precision, "0");
  if (conversion === "o" && alternate && !digits.startsWith("0")) digits = `0${digits}`;
  return conversion === "X" ? digits.toUpperCase() : digits;
}

function integerText(specification: FormatSpecification, value: number, base: number): string {
  const { conversion, alternate, precision } = specification;
  const integer = Math.trunc(value);
  const magnitude = BigInt(Math.abs(integer));
  const hexadecimal = conversion === "x" || conversion === "X";
  const sign = integer < 0 ? "-" : conversion === "i" ? signOf(specification, false) : "";
  const prefix = alternate && hexadecimal && magnitude !== 0n ? `0${conversion}` : "";
  return pad(specification, sign + prefix, integerDigits(specification, magnitude, base), precision === undefined);
}

function floatText(specification: FormatSpecification, value: number): string {
  const { conversion, precision = DEFAULT_PRECISION, alternate } = specification;
  const exact = exactValue(Math.abs(value));
  const upper = conversion === "E";
  let body: string;
  if (conversion === "f") body = fixed(exact, precision, alternate);
  else if (conversion === "e" || conversion === "E") body = scientific(exact, precision, upper, alternate);
  else body = general(exact, specification);
  return pad(specification, signOf(specification, value < 0 || Object.is(value, -0)), body, true);
}

/**
 * Formats a number by a conversion specifier, as the C library's `printf` does.
 *
 * @remarks
 * The value is rounded from its exact binary value, a tie to the even digit, so that `%.0f` of 2.5 is `2`. `i` writes
 * in the given base and truncates a float; `o`, `x` and `X` write the magnitude with a minus sign for a negative
 * number, where C leaves it undefined.
 *
 * @param specification - The parsed specifier.
 * @param value - The number: a float, a duration in seconds or an integer.
 * @param base - The number base of the conversion `i`, from 2 to 36. It is not used by the others.
 * @returns The text.
 * @see {@link https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf | ISO/IEC 9899:2011, formatted output}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-printed-variable}
 */
export function formatNumber(specification: FormatSpecification, value: number, base: number): string {
  if (!Number.isFinite(value)) return nonFinite(specification, value);
  return "ioXx".includes(specification.conversion)
    ? integerText(specification, value, base)
    : floatText(specification, value);
}
