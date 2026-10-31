import type { PrintedVariable } from "../asi/index.js";
import { checkRecord } from "../checks.js";
import type { Primitive, SingleValue, Value } from "../values/index.js";
import { formatNumber } from "./format-number.js";
import { type Conversion, type FormatSpecification, parseFormat, plainSpecification } from "./format-specification.js";
import type { ContentVariables } from "./variables.js";

/**
 * The number base of the conversion `i` when `base` is absent or not usable.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_BASE = 10;
const MIN_BASE = 2;
const MAX_BASE = 36;

/**
 * The `delimiter` between values when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_DELIMITER = ";";

/**
 * The `mapping-indicator` between a field and its value when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_MAPPING_INDICATOR = "=";

/** The superscript digits 0 to 9, for the power form. */
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUPERSCRIPT_MINUS = "⁻";

/**
 * The conversion that writes an integer when the printed variable gives no `format`, and the one for a float or
 * duration.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const INTEGER_CONVERSION: Conversion = "i";
const FLOAT_CONVERSION: Conversion = "G";

/** Matches the exponent that `e`, `E`, `g` and `G` write: the letter, a sign and the digits. */
const EXPONENT = /[eE]([+-])(\d+)/;

/** Returns the integer a reference stands for: itself, or the value of the single integer variable it names. */
function integerOf(reference: number | string | undefined, variables: ContentVariables): number | undefined {
  if (typeof reference !== "string") return reference;
  const value = variables.outcomes.get(reference) ?? variables.templates.get(reference);
  return value?.cardinality === "single" && value.baseType === "integer" && typeof value.value === "number"
    ? value.value
    : undefined;
}

/** Rewrites `e+03` as ` × 10³`, which is how the specification says to show the form e+n. */
function powerForm(text: string): string {
  return text.replace(EXPONENT, (_, sign: string, digits: string) => {
    const power = [...String(Number(digits))].map((digit) => SUPERSCRIPT_DIGITS.charAt(Number(digit))).join("");
    return ` × 10${sign === "-" ? SUPERSCRIPT_MINUS : ""}${power}`;
  });
}

/** What a single value is written with: the conversion specifier, the base of `i`, and whether to use the power form. */
interface Notation {
  readonly specification: FormatSpecification | undefined;
  readonly base: number;
  readonly powerForm: boolean;
}

function primitiveText(baseType: string, primitive: Primitive, notation: Notation): string {
  if (typeof primitive === "number") {
    const conversion = baseType === "integer" ? INTEGER_CONVERSION : FLOAT_CONVERSION;
    const text = formatNumber(notation.specification ?? plainSpecification(conversion), primitive, notation.base);
    return notation.powerForm ? powerForm(text) : text;
  }
  if (typeof primitive === "string") return primitive;
  if (typeof primitive === "boolean") return String(primitive);
  return "reference" in primitive ? (primitive.fileName ?? "") : primitive.join(" ");
}

/**
 * Writes a single value as text, the way a printed variable does when it has no `format`.
 *
 * @remarks
 * An integer is written by `%i`, a float or a duration by `%G`, a boolean as `true` or `false`, a point as `x y`, a
 * pair as `a b`, a file as its name, and a string, identifier or uri as it is.
 *
 * @param value - The single value.
 * @param notation - How to write numbers; the default has no format specifier, the base 10 and no power form.
 * @returns The text.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-printed-variable}
 */
export function singleText(value: SingleValue, notation: Notation = NO_NOTATION): string {
  return primitiveText(value.baseType, value.value, notation);
}

const NO_NOTATION: Notation = { specification: undefined, base: DEFAULT_BASE, powerForm: false };

function containerText(
  printed: PrintedVariable,
  value: Value,
  notation: Notation,
  variables: ContentVariables,
): string {
  const delimiter = printed.delimiter ?? DEFAULT_DELIMITER;
  const text = (baseType: string, primitive: Primitive): string => primitiveText(baseType, primitive, notation);
  if (value.cardinality === "record") {
    if (printed.field !== undefined) {
      const field = value.fields.get(printed.field);
      return field === undefined ? "" : text(field.baseType, field.value);
    }
    const mapping = printed.mappingIndicator ?? DEFAULT_MAPPING_INDICATOR;
    return [...value.fields]
      .map(([name, field]) => `${name}${mapping}${text(field.baseType, field.value)}`)
      .join(delimiter);
  }
  if (value.cardinality === "single") return text(value.baseType, value.value);
  const index = value.cardinality === "ordered" ? integerOf(printed.index, variables) : undefined;
  const chosen = index === undefined ? value.values : value.values.slice(index - 1, index);
  return chosen.map((primitive) => text(value.baseType, primitive)).join(delimiter);
}

/**
 * Writes the value of a variable as the text of a `qti-printed-variable`.
 *
 * @remarks
 * - `format` is one conversion specifier of the C `printf`: `%`, the flags `-`, `+`, space, `#` and `0`, a width, a
 *   precision, and one of `E e f G g r R i o X x`. Numbers are rounded from their exact binary value, as the C library
 *   does. `i` writes in `base`, an integer or the identifier of a variable that holds one; `r` and `R` round to the
 *   precision as `g` and `G` do but leave the fixed form only for large numbers. Without a format an integer is written
 *   by `%i` and a float or a duration by `%G`. A `format` that is not one specifier is ignored.
 * - `power-form` writes the exponent of a number as ` × 10` and a superscript: `1.5e+03` becomes `1.5 × 10³`.
 * - A container writes its values with `delimiter` between them, `;` by default. An ordered container writes only the
 *   value at `index`, counting from 1, and nothing when there is none. A record writes `field`, else every field as its
 *   name, `mapping-indicator` (`=` by default) and its value.
 * - NULL is the empty string.
 *
 * @param printed - The `qti-printed-variable`.
 * @param value - The value of its variable, which the caller finds among the outcomes and template variables: response
 * variables cannot be printed.
 * @param variables - The variables that `base` and `index` may name.
 * @returns The text; the empty string for NULL.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-printed-variable}
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, qti-printed-variable}
 */
export function formatPrintedVariable(
  printed: PrintedVariable,
  value: Value | null,
  variables: ContentVariables,
): string {
  checkRecord(printed, "The printed variable must be an object of the model of qti-printed-variable");
  checkRecord(variables, "The variables must be an object with the maps outcomes and templates");
  if (value === null) return "";
  const declared = integerOf(printed.base, variables);
  const base =
    declared !== undefined && Number.isInteger(declared) && declared >= MIN_BASE && declared <= MAX_BASE
      ? declared
      : DEFAULT_BASE;
  const notation: Notation = {
    specification: printed.format === undefined ? undefined : parseFormat(printed.format),
    base,
    powerForm: printed.powerForm === true,
  };
  return containerText(printed, value, notation, variables);
}
