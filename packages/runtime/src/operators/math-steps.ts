import * as v from "valibot";
import {
  checkArray,
  checkString,
  finiteSchema,
  mapSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import type { VariableRange } from "../keys/index.js";
import { agree, compareShapes, residualAt, type Shape, shapeOf } from "./compare.js";
import { complex } from "./complex.js";
import { collectVariables, evaluate, measured } from "./evaluate.js";
import { checkVariableName } from "./expression-equivalent.js";
import { type OperatorLimits, operatorLimitsSchema } from "./limits.js";
import { isBlank } from "./operands.js";
import { readStatement } from "./read.js";
import { MIN_POINTS, POINT_COUNT, type Ranges, Sample } from "./sample.js";
import type { DecimalSeparator } from "./tokens.js";
import type { Node, Statement } from "./tree.js";

/** The check of one line of worked steps against the nearest earlier line that reads. */
export interface StepCheck {
  /** The index of the line in the steps. */
  readonly step: number;
  /** Whether the line follows from line `from`; `null` when it cannot be read, holds an inequality, or no earlier line reads. */
  readonly equivalent: boolean | null;
  /** The index of the nearest earlier line that reads, or `null` when none does. */
  readonly from: number | null;
}

/** The options of {@link compareMathSteps}. */
export interface CompareMathStepsOptions {
  /**
   * The decimal mark of the steps.
   *
   * @defaultValue `"."`
   */
  readonly decimalSeparator?: "." | ",";
  /**
   * The sample range of each variable, by its name, as an `expression` key gives it.
   *
   * @defaultValue none: each variable is drawn from -10 to 10
   */
  readonly variables?: Readonly<Record<string, VariableRange>>;
  /**
   * The limits of what a line may hold; a line past one is a null check.
   *
   * @defaultValue the values of `DEFAULT_OPERATOR_LIMITS`
   */
  readonly limits?: Partial<OperatorLimits>;
  /**
   * The most lines of the steps.
   *
   * @defaultValue `200`
   */
  readonly maxSteps?: number;
}

/** The most lines of worked steps by default: a worked solution of a school exercise holds tens of lines. */
const DEFAULT_MAX_STEPS = 200;

const rangesSchema = mapSchema(
  v.pipe(
    v.strictObject({ min: finiteSchema, max: finiteSchema }),
    v.check(({ min, max }) => min < max, "a range has its min below its max"),
  ),
);

const compareMathStepsOptionsSchema = strictRecord({
  decimalSeparator: v.optional(v.picklist([".", ","]), "."),
  variables: v.optional(rangesSchema, {}),
  limits: v.optional(operatorLimitsSchema, {}),
  maxSteps: v.optional(positiveIntegerSchema, DEFAULT_MAX_STEPS),
});

/** A line as the steps use it: an expression, an equation, or the values that solve an earlier line. */
type Line =
  | { readonly kind: "expression"; readonly shape: Extract<Shape, { form: "expression" }> }
  | { readonly kind: "equation"; readonly shape: Extract<Shape, { form: "equation" }> }
  | { readonly kind: "solutions"; readonly variable: string | null; readonly values: readonly Node[] };

/** Whether a tree has no variable. */
function isConstant(node: Node): boolean {
  const names = new Set<string>();
  collectVariables(node, names);
  return names.size === 0;
}

/** Reads one line, or returns `undefined` for a line that is blank, past a limit, not of the subset, or an inequality. */
function readLine(text: string, separator: DecimalSeparator, limits: OperatorLimits): Line | undefined {
  if (isBlank(text) || text.length > limits.maxInputLength) return undefined;
  let statement: Statement;
  try {
    statement = readStatement(text, separator, limits);
  } catch (error) {
    if (error instanceof DataError || error instanceof SecurityError) return undefined;
    throw error;
  }
  if (statement.kind === "entry" && statement.entry.signs === 0) {
    const { entry } = statement;
    if (entry.kind === "expression") return { kind: "expression", shape: { form: "expression", node: entry.node } };
    if (entry.relation !== "=") return undefined;
    if (entry.left.kind !== "variable" || !isConstant(entry.right))
      return { kind: "equation", shape: { form: "equation", left: entry.left, right: entry.right } };
  }
  return solutionsOf(statement, limits.maxSolutions);
}

/** The constant values of a solution set, or of `v = c`, with their variable; `undefined` for any other line. */
function solutionsOf(statement: Statement, maxSolutions: number): Line | undefined {
  const shape = shapeOf(statement, "solution-set", maxSolutions);
  if (shape.form !== "solution-set") return undefined;
  const values: Node[] = [];
  for (const { node, signs } of shape.solutions) {
    if (!isConstant(node)) return undefined;
    // The signs of a value's `\pm` are fixed by evaluating it once at the point that takes them.
    const value = evaluate(node, {
      value: () => measured(complex(Number.NaN)),
      sign: (bit) => ((signs >> bit) & 1 ? -1 : 1),
    });
    values.push({ kind: "number", value: value.value.im === 0 ? value.value.re : Number.NaN });
  }
  const variable = shape.solutions.find((solution) => solution.variable !== null)?.variable ?? null;
  return { kind: "solutions", variable, values };
}

/** The one variable of an earlier line, or `undefined` when it has none or several. */
function onlyVariable(line: Line): string | undefined {
  if (line.kind === "solutions") return line.variable ?? "";
  const names = new Set<string>();
  if (line.kind === "expression") collectVariables(line.shape.node, names);
  else if (line.kind === "equation") {
    collectVariables(line.shape.left, names);
    collectVariables(line.shape.right, names);
  }
  const [only] = names;
  return names.size === 1 ? only : undefined;
}

/**
 * Whether each value, put in for the variable, makes the earlier line's residual (an expression's value) agree with 0 at
 * every sample point of its other variables; after a solution set, whether each value is one of its values.
 */
function solves(values: readonly Node[], variable: string, earlier: Line, ranges: Ranges): boolean | null {
  const sample = new Sample(ranges);
  const zero = measured(complex(0));
  if (earlier.kind === "solutions") {
    const at = (node: Node) => evaluate(node, sample.point(0));
    return values.every((value) => earlier.values.some((other) => agree(at(value), at(other))));
  }
  let decided = true;
  for (const value of values) {
    const bindings = new Map([[variable, value]]);
    const residuals: ReturnType<typeof residualAt>[] = [];
    for (let index = 0; index < POINT_COUNT; index += 1)
      residuals.push(residualAt(earlier.shape, sample, index, bindings));
    const used = residuals.filter((residual) => residual !== undefined);
    if (used.length < MIN_POINTS) decided = false;
    else if (!used.every((residual) => agree(residual, zero))) return false;
  }
  return decided ? true : null;
}

/** Whether a line follows from an earlier one, by the rule of the steps. */
function follows(line: Line, earlier: Line, ranges: Ranges): boolean | null {
  if (line.kind === "solutions") {
    const variable =
      line.variable ?? (earlier.kind === "solutions" ? earlier.variable : undefined) ?? onlyVariable(earlier);
    if (variable === undefined) return null;
    return solves(line.values, variable, earlier, ranges);
  }
  if (earlier.kind !== line.kind) return false;
  return compareShapes(line.shape, { shape: earlier.shape }, ranges);
}

/**
 * Checks each line of worked steps against the nearest earlier line that reads: a step is equivalent when it and that line
 * are expressions that agree, or equations that agree as an equation does (the same equation rearranged or scaled), or when
 * the step is a solution set or `v = c` of constant values, each of which makes that line's residual, or an expression line's
 * value, agree with 0. The comparator is the one `expression-equivalent` runs.
 *
 * @remarks
 * A step that cannot be read, holds an inequality, which the comparator does not check, or has no earlier line that reads
 * has a null check, as a step past a limit has. A lost root is not a failed check: the rubric judges what the checks leave.
 *
 * @param steps - The lines of the working, each a LaTeX line of the subset, as the steps of a math entry give them.
 * @param options - The decimal mark, the sample ranges, the limits of a line and the most lines.
 * @returns One check for each line, in order.
 * @throws `DataError` for steps that are not an array of strings, or invalid options.
 * @throws `SecurityError` for more lines than `maxSteps`.
 */
export function compareMathSteps(
  steps: readonly string[],
  options: CompareMathStepsOptions = {},
): readonly StepCheck[] {
  checkArray(steps, "The steps must be an array of strings");
  const {
    decimalSeparator: separator,
    variables: ranges,
    limits,
    maxSteps,
  } = parseWith(compareMathStepsOptionsSchema, options, "The options object");
  for (const name of ranges.keys()) checkVariableName(name, `variables[${JSON.stringify(name)}]`);
  if (steps.length > maxSteps)
    throw new SecurityError(
      `The steps hold ${steps.length} lines, over the limit maxSteps of ${maxSteps}.`,
      "maxSteps",
      maxSteps,
    );
  const lines: (Line | undefined)[] = [];
  return steps.map((text, step) => {
    checkString(text, `The step ${step}`);
    const line = readLine(text, separator, limits);
    let from: number | null = null;
    for (let index = lines.length - 1; index >= 0 && from === null; index -= 1)
      if (lines[index] !== undefined) from = index;
    lines.push(line);
    const earlier = from === null ? undefined : lines[from];
    if (line === undefined || earlier === undefined) return { step, equivalent: null, from };
    return { step, equivalent: follows(line, earlier, ranges), from };
  });
}
