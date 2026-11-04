import type { Value } from "../values/index.js";
import { agree, shapeOf } from "./compare.js";
import { complex } from "./complex.js";
import { collectVariables, evaluate, type Measured, measured } from "./evaluate.js";
import { checkVariableName, readEarlierResponse } from "./expression-equivalent.js";
import type { OperatorLimits } from "./limits.js";
import { collapseUnit, type NumberReading, readNumberText, type WrittenNumber } from "./number-text.js";
import { checkOperandCount, isBlank, share, stringsOf } from "./operands.js";
import { atPath, memberPath, type OptionsOf, optionsError, pathOf } from "./options.js";
import { absolute, compare, fromNumber, multiply, type Rational, roundSignificant, subtract } from "./rational.js";
import { readStatement } from "./read.js";
import type { NumberKeyData } from "./schemas.js";
import type { Node } from "./tree.js";

/** A tolerance in exact rationals; neither bound means exact. */
interface ExactTolerance {
  readonly absolute: Rational | null;
  readonly relative: Rational | null;
}

/** A number key read once a call, in exact rationals. */
export interface PreparedNumber {
  readonly key: NumberKeyData;
  readonly value: Rational;
  readonly tolerance: ExactTolerance;
  readonly units: ReadonlyMap<string, Rational>;
  /** The credit tiers, highest share first. */
  readonly tiers: readonly { readonly tolerance: ExactTolerance; readonly share: number }[];
  readonly components: readonly Rational[] | null;
  readonly followThrough: { readonly node: Node; readonly variable: string } | null;
}

function exactTolerance(tolerance: NumberKeyData["tolerance"]): ExactTolerance {
  return {
    absolute: tolerance.absolute === null ? null : fromNumber(tolerance.absolute),
    relative: tolerance.relative === null ? null : fromNumber(tolerance.relative),
  };
}

/**
 * Reads and checks the options of `number-equivalent`.
 *
 * @throws `DataError` for units whose names collapse to one, significant figures of 0 or past what a response can hold, a
 *   follow-through beside intervals or components, or a follow-through whose expression is not one of its variable alone.
 */
export function prepareNumber(
  options: OptionsOf<"number-equivalent">,
  limits: OperatorLimits,
  prefix: string,
): PreparedNumber {
  const { key, followThrough } = options;
  const units = new Map<string, Rational>();
  for (const [name, factor] of key.units) {
    const collapsed = collapseUnit(name);
    if (collapsed === "" || units.has(collapsed))
      throw optionsError(
        memberPath(pathOf(prefix, "key.units"), name),
        "the unit is empty, or repeats another once white space is collapsed.",
      );
    units.set(collapsed, fromNumber(factor));
  }
  checkSignificantFigures(key, limits, prefix);
  const tiers = key.credit
    .map((tier) => ({ tolerance: exactTolerance(tier.tolerance), share: tier.share }))
    .sort((a, b) => b.share - a.share);
  return {
    key,
    value: fromNumber(key.value),
    tolerance: exactTolerance(key.tolerance),
    units,
    tiers,
    components: key.components?.map(fromNumber) ?? null,
    followThrough: followThrough === null ? null : prepareFollowThrough(key, followThrough, limits, prefix),
  };
}

function checkSignificantFigures(key: NumberKeyData, limits: OperatorLimits, prefix: string): void {
  const figures = key.significantFigures;
  if (figures === null) return;
  const path = pathOf(prefix, "key.significantFigures");
  if (figures > limits.maxInputLength)
    throw optionsError(
      path,
      `${figures} significant figures are more than a response of ${limits.maxInputLength} characters shows.`,
    );
  if (key.value === 0 && key.components === null)
    throw optionsError(
      path,
      "0 has no significant figures; give the key a value that is not 0, or no significant figures.",
    );
}

function prepareFollowThrough(
  key: NumberKeyData,
  followThrough: NonNullable<OptionsOf<"number-equivalent">["followThrough"]>,
  limits: OperatorLimits,
  prefix: string,
): NonNullable<PreparedNumber["followThrough"]> {
  const path = pathOf(prefix, "followThrough.expression");
  if (key.intervals !== null || key.components !== null)
    throw optionsError(
      pathOf(prefix, "followThrough"),
      "a follow-through gives one value, which intervals and components do not compare with.",
    );
  checkVariableName(followThrough.variable, pathOf(prefix, "followThrough.variable"));
  let shape: ReturnType<typeof shapeOf>;
  try {
    shape = shapeOf(readStatement(followThrough.expression, key.decimalSeparator, limits), "expression", 1);
  } catch (error) {
    throw atPath(error, path);
  }
  if (shape.form !== "expression")
    throw optionsError(path, "a number's follow-through is an expression, with no relation, list or \\pm.");
  const names = new Set<string>();
  collectVariables(shape.node, names);
  names.delete(followThrough.variable);
  if (names.size > 0)
    throw optionsError(
      path,
      `a number's follow-through is an expression of ${followThrough.variable} alone, found ${[...names].join(", ")}.`,
    );
  return { node: shape.node, variable: followThrough.variable };
}

/** Whether a value lies within a tolerance of a target: within either bound when both are given; exactly with neither. */
function within(value: Rational, target: Rational, tolerance: ExactTolerance): boolean {
  if (tolerance.absolute === null && tolerance.relative === null) return compare(value, target) === 0;
  const distance = absolute(subtract(value, target));
  if (tolerance.absolute !== null && compare(distance, tolerance.absolute) <= 0) return true;
  return tolerance.relative !== null && compare(distance, multiply(tolerance.relative, absolute(target))) <= 0;
}

/** A response's value in the key's unit: times its unit's factor; `undefined` for a unit the key does not name. */
function inKeyUnit(written: WrittenNumber, prepared: PreparedNumber): Rational | undefined {
  if (written.unit === "") return written.value;
  const factor = prepared.units.get(written.unit);
  return factor === undefined ? undefined : multiply(written.value, factor);
}

/** Whether a response is right against a target: the significant figures and the tolerance of the key. */
function isRight(written: WrittenNumber, value: Rational, target: Rational, prepared: PreparedNumber): boolean {
  const figures = prepared.key.significantFigures;
  if (figures === null) return within(value, target, prepared.tolerance);
  return written.significant === figures && within(value, roundSignificant(target, figures), prepared.tolerance);
}

/** The share a response earns against a target: 1 when right, else the first credit tier whose tolerance holds. */
function shareAgainst(written: WrittenNumber, value: Rational, target: Rational, prepared: PreparedNumber): number {
  if (isRight(written, value, target, prepared)) return 1;
  return prepared.tiers.find((tier) => within(value, target, tier.tolerance))?.share ?? 0;
}

/** Whether a value lies in one of the key's intervals. */
function inIntervals(value: Rational, intervals: NonNullable<NumberKeyData["intervals"]>): boolean {
  return intervals.some((interval) => {
    const above =
      interval.min === null ||
      (interval.minIncluded
        ? compare(value, fromNumber(interval.min)) >= 0
        : compare(value, fromNumber(interval.min)) > 0);
    const below =
      interval.max === null ||
      (interval.maxIncluded
        ? compare(value, fromNumber(interval.max)) <= 0
        : compare(value, fromNumber(interval.max)) < 0);
    return above && below;
  });
}

/** The value of a follow-through with the earlier response in its variable, when it is a finite real number. */
function followThroughValue(
  prepared: PreparedNumber,
  operand: Value | null | undefined,
  limits: OperatorLimits,
): Rational | undefined {
  const followThrough = prepared.followThrough;
  if (followThrough === null) return undefined;
  const earlier = readEarlierResponse(operand, prepared.key.decimalSeparator, limits);
  if (earlier === undefined) return undefined;
  const none: Measured = measured(complex(Number.NaN));
  const outside = { value: (): Measured => none, sign: (): 1 => 1 };
  const value = evaluate(followThrough.node, {
    value: (name) => (name === followThrough.variable ? evaluate(earlier, outside) : none),
    sign: () => 1,
  });
  const real = measured(complex(value.value.re));
  if (!Number.isFinite(value.value.re) || !Number.isFinite(value.value.im) || !agree(value, real)) return undefined;
  return fromNumber(value.value.re);
}

/** How a response is read: by the key, or, for an integer or a float, as its shortest decimal form. */
function readingOf(prepared: PreparedNumber, numeric = false): NumberReading {
  return numeric
    ? { separator: ".", fractions: false }
    : { separator: prepared.key.decimalSeparator, fractions: prepared.key.fractions };
}

/** Whether an operand is an integer or a float, which reads through its shortest decimal form. */
export function isNumeric(operand: Value | null | undefined): boolean {
  return operand?.cardinality === "single" && (operand.baseType === "integer" || operand.baseType === "float");
}

/** The share of one written number, or `undefined` when it does not read. */
function scoreWritten(
  text: string,
  reading: NumberReading,
  prepared: PreparedNumber,
  followThrough: Rational | undefined,
): number | undefined {
  if (isBlank(text)) return undefined;
  const written = readNumberText(text, reading);
  if (written === undefined) return undefined;
  const value = inKeyUnit(written, prepared);
  if (value === undefined) return 0;
  const { intervals } = prepared.key;
  if (intervals !== null) return inIntervals(value, intervals) ? 1 : 0;
  const own = shareAgainst(written, value, prepared.value, prepared);
  return followThrough === undefined ? own : Math.max(own, shareAgainst(written, value, followThrough, prepared));
}

/** The share of the components: each string against the component in its position, right over all. */
function scoreComponents(
  strings: readonly string[],
  prepared: PreparedNumber,
  components: readonly Rational[],
): number | null {
  if (strings.length > components.length) return null;
  let right = 0;
  let read = 0;
  strings.forEach((text, index) => {
    const written = isBlank(text) ? undefined : readNumberText(text, readingOf(prepared));
    const component = components[index];
    if (written === undefined || component === undefined) return;
    read += 1;
    const value = inKeyUnit(written, prepared);
    if (value !== undefined && isRight(written, value, component, prepared)) right += 1;
  });
  return read === 0 ? null : right / components.length;
}

/**
 * `number-equivalent`: the share a response earns against a `number` key, computed in exact rationals: 1 within the
 * tolerance, else the first credit tier that holds; 1 inside any interval; right components over all; with a follow-through,
 * the larger of its shares against the key's value and the follow-through's. NULL when blank or unreadable.
 */
export function scoreNumber(
  prepared: PreparedNumber,
  operands: readonly (Value | null)[],
  limits: OperatorLimits,
): Value | null {
  checkOperandCount(operands, prepared.followThrough === null ? 1 : 2);
  const components = prepared.components;
  const strings = stringsOf(operands[0], 0, { containers: components !== null, numbers: true });
  if (strings === null || strings.reduce((total, text) => total + text.length, 0) > limits.maxInputLength) return null;
  if (components !== null) {
    const result = scoreComponents(strings, prepared, components);
    return result === null ? null : share(result);
  }
  const [text] = strings;
  if (text === undefined) return null;
  const reading = readingOf(prepared, isNumeric(operands[0]));
  const result = scoreWritten(text, reading, prepared, followThroughValue(prepared, operands[1], limits));
  return result === undefined ? null : share(result);
}

/** Whether every string of a response reads as a number of the key, within the limits. */
export function readsAsNumber(strings: readonly string[], key: NumberKeyData): boolean {
  if (key.components !== null && strings.length > key.components.length) return false;
  const reading = { separator: key.decimalSeparator, fractions: key.fractions };
  return strings.every((text) => !isBlank(text) && readNumberText(text, reading) !== undefined);
}
