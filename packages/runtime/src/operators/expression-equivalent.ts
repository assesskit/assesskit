import { DataError, SecurityError } from "../errors.js";
import type { Value } from "../values/index.js";
import { checkKeyShape, compareShapes, type Form, type KeySide, type Shape, shapeOf } from "./compare.js";
import type { OperatorLimits } from "./limits.js";
import { readNumberText } from "./number-text.js";
import { checkOperandCount, isBlank, share, stringsOf } from "./operands.js";
import { atPath, type EarlierReading, memberPath, type OptionsOf, optionsError, pathOf } from "./options.js";
import { toNumber } from "./rational.js";
import { isVariableName, readStatement } from "./read.js";
import type { Ranges } from "./sample.js";
import type { ExpressionKeyData } from "./schemas.js";
import type { DecimalSeparator } from "./tokens.js";
import type { Node } from "./tree.js";

/** A key's expression read and checked once a call, with its follow-through. */
export interface PreparedExpression {
  readonly form: Form;
  readonly ranges: Ranges;
  readonly separator: DecimalSeparator;
  readonly key: KeySide["shape"];
  readonly followThrough: {
    readonly shape: KeySide["shape"];
    readonly variable: string;
    readonly reading: EarlierReading | null;
  } | null;
}

/**
 * Reads a line of the subset as an operator reads a response: `undefined` when it is blank, past a limit, or not of the
 * subset. A candidate's input never makes an operator throw.
 */
function readResponseShape(
  text: string,
  separator: DecimalSeparator,
  form: Form,
  limits: OperatorLimits,
): Shape | undefined {
  if (isBlank(text)) return undefined;
  try {
    const shape = shapeOf(readStatement(text, separator, limits), form, limits.maxSolutions);
    return shape.form === "unreadable" ? undefined : shape;
  } catch (error) {
    if (error instanceof DataError || error instanceof SecurityError) return undefined;
    throw error;
  }
}

/** Reads and checks a key's expression under its form; an error names the path of the expression. */
function prepareKeyShape(
  text: string,
  key: Pick<ExpressionKeyData, "form" | "decimalSeparator" | "variables">,
  limits: OperatorLimits,
  path: string,
): KeySide["shape"] {
  try {
    const shape = shapeOf(readStatement(text, key.decimalSeparator, limits), key.form, limits.maxSolutions);
    return checkKeyShape(shape, key.variables);
  } catch (error) {
    throw atPath(error, path);
  }
}

/**
 * Checks the name of a key's sample range or of a follow-through's variable.
 *
 * @throws `DataError` naming the path of a name that no variable of the subset has.
 */
export function checkVariableName(name: string, path: string): void {
  if (!isVariableName(name))
    throw optionsError(
      path,
      `${JSON.stringify(name)} is not a variable of the subset: a Latin letter but e, or a Greek letter's name, with a subscript of up to 8 letters or digits after _.`,
    );
}

/** Reads and checks the options of `expression-equivalent`. */
export function prepareExpression(
  options: OptionsOf<"expression-equivalent">,
  limits: OperatorLimits,
  prefix: string,
): PreparedExpression {
  const { key, followThrough } = options;
  for (const name of key.variables.keys()) checkVariableName(name, memberPath(pathOf(prefix, "key.variables"), name));
  const shape = prepareKeyShape(key.expression, key, limits, pathOf(prefix, "key.expression"));
  let prepared: PreparedExpression["followThrough"] = null;
  if (followThrough !== null) {
    checkVariableName(followThrough.variable, pathOf(prefix, "followThrough.variable"));
    const path = pathOf(prefix, "followThrough.expression");
    prepared = {
      shape: prepareKeyShape(followThrough.expression, key, limits, path),
      variable: followThrough.variable,
      reading: followThrough.reading,
    };
  }
  return {
    form: key.form,
    ranges: key.variables,
    separator: key.decimalSeparator,
    key: shape,
    followThrough: prepared,
  };
}

/**
 * The earlier response of a follow-through, read as its own key reads it: a number with that key's decimal mark and fractions,
 * or an expression of the subset with that key's decimal mark; with no reading, an expression with the decimal mark of the
 * call's key. An integer or a float is its value. `undefined` when it is NULL, blank, past a limit, a number with a unit, or
 * no expression: the key then stands alone.
 */
export function readEarlierResponse(
  operand: Value | null | undefined,
  reading: EarlierReading | null,
  separator: DecimalSeparator,
  limits: OperatorLimits,
): Node | undefined {
  const [text] = stringsOf(operand, 1, { containers: false, numbers: true }) ?? [];
  if (text === undefined || text.length > limits.maxInputLength) return undefined;
  if (operand?.cardinality === "single" && typeof operand.value === "number")
    return Number.isFinite(operand.value) ? { kind: "number", value: operand.value } : undefined;
  if (reading?.kind === "number") {
    const written = isBlank(text)
      ? undefined
      : readNumberText(text, { separator: reading.decimalSeparator, fractions: reading.fractions });
    return written === undefined || written.unit !== ""
      ? undefined
      : { kind: "number", value: toNumber(written.value) };
  }
  const shape = readResponseShape(text, reading?.decimalSeparator ?? separator, "expression", limits);
  return shape?.form === "expression" ? shape.node : undefined;
}

/**
 * `expression-equivalent`: 1 when the response is equivalent to the key, or to the follow-through's expression with the
 * earlier response in its variable; 0 when it is not; NULL when it is blank, unreadable or undecided.
 */
export function scoreExpression(
  prepared: PreparedExpression,
  operands: readonly (Value | null)[],
  limits: OperatorLimits,
): Value | null {
  checkOperandCount(operands, prepared.followThrough === null ? 1 : 2);
  const [text] = stringsOf(operands[0], 0, { containers: false, numbers: false }) ?? [];
  if (text === undefined || text.length > limits.maxInputLength) return null;
  const response = readResponseShape(text, prepared.separator, prepared.form, limits);
  if (response === undefined) return null;
  const verdicts = [compareShapes(response, { shape: prepared.key }, prepared.ranges)];
  const earlier =
    prepared.followThrough === null
      ? undefined
      : readEarlierResponse(operands[1], prepared.followThrough.reading, prepared.separator, limits);
  if (prepared.followThrough !== null && earlier !== undefined) {
    const bindings = new Map([[prepared.followThrough.variable, earlier]]);
    verdicts.push(compareShapes(response, { shape: prepared.followThrough.shape, bindings }, prepared.ranges));
  }
  if (verdicts.includes(true)) return share(1);
  return verdicts.includes(null) ? null : share(0);
}

/** Whether every string of a response reads under the key's form, within the limits. */
export function readsAsExpression(strings: readonly string[], key: ExpressionKeyData, limits: OperatorLimits): boolean {
  return strings.every((text) => readResponseShape(text, key.decimalSeparator, key.form, limits) !== undefined);
}
