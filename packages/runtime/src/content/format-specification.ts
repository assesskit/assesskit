/**
 * A conversion type code of the `format` of a printed variable.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type Conversion = "E" | "e" | "f" | "G" | "g" | "i" | "o" | "R" | "r" | "X" | "x";

/**
 * A format conversion specifier, parsed: `%`, flags, a width, a precision and a conversion.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export interface FormatSpecification {
  /** The flag `-`: align left. */
  readonly leftAlign: boolean;
  /** The flag `+`: a sign on every number. */
  readonly plus: boolean;
  /** The flag space: a space in place of the sign of a positive number. */
  readonly space: boolean;
  /** The flag `#`: the alternate form. */
  readonly alternate: boolean;
  /** The flag `0`: pad with zeros. */
  readonly zeroPad: boolean;
  /** The minimum width; 0 when the specifier gives none. */
  readonly width: number;
  /** The precision; absent when the specifier gives none. */
  readonly precision: number | undefined;
  /** The conversion type code. */
  readonly conversion: Conversion;
}

const FLAGS = "-+ #0";
const CONVERSIONS: readonly Conversion[] = ["E", "e", "f", "G", "g", "i", "o", "R", "r", "X", "x"];

/**
 * The largest width and precision accepted: a double has at most 1074 digits after the point (the exact value of
 * 5e-324), so a larger precision adds only zeros, and a limit keeps a hostile format from asking for gigabytes.
 */
const MAX_FIELD = 1100;

function readDigits(format: string, from: number): { readonly digits: string; readonly end: number } {
  let end = from;
  while (end < format.length && format.charAt(end) >= "0" && format.charAt(end) <= "9") end++;
  return { digits: format.slice(from, end), end };
}

/**
 * Returns the specifier with no flags, width or precision for a conversion, such as `%i` or `%G`.
 *
 * @param conversion - The conversion type code.
 * @returns The specification.
 */
export function plainSpecification(conversion: Conversion): FormatSpecification {
  return {
    leftAlign: false,
    plus: false,
    space: false,
    alternate: false,
    zeroPad: false,
    width: 0,
    precision: undefined,
    conversion,
  };
}

/**
 * Parses a format conversion specifier: `%`, zero or more of the flags `-`, `+`, space, `#` and `0`, an optional width,
 * an optional precision (a point and zero or more digits) and one of the conversions `E e f G g r R i o X x`.
 *
 * @remarks
 * Returns `undefined` when the text is anything else, such as text around the specifier or a width above 1100.
 *
 * @param format - The text of the `format` attribute.
 * @returns The specification, or `undefined` when `format` is not exactly one specifier.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-printed-variable}
 */
export function parseFormat(format: string): FormatSpecification | undefined {
  if (!format.startsWith("%")) return undefined;
  let at = 1;
  const flags = new Set<string>();
  while (at < format.length && FLAGS.includes(format.charAt(at))) flags.add(format.charAt(at++));
  const width = readDigits(format, at);
  at = width.end;
  let precision: number | undefined;
  if (format.charAt(at) === ".") {
    const digits = readDigits(format, at + 1);
    precision = digits.digits === "" ? 0 : Number(digits.digits);
    at = digits.end;
  }
  const conversion = CONVERSIONS.find((candidate) => candidate === format.charAt(at));
  const widthValue = width.digits === "" ? 0 : Number(width.digits);
  if (at + 1 !== format.length || conversion === undefined) return undefined;
  if (widthValue > MAX_FIELD || (precision !== undefined && precision > MAX_FIELD)) return undefined;
  return {
    leftAlign: flags.has("-"),
    plus: flags.has("+"),
    space: flags.has(" "),
    alternate: flags.has("#"),
    zeroPad: flags.has("0"),
    width: widthValue,
    precision,
    conversion,
  };
}
