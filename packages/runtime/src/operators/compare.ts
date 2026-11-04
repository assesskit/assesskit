import { DataError, SecurityError } from "../errors.js";
import { complex, divide, isFiniteComplex, multiply, subtract } from "./complex.js";
import { evaluate, type Measured, measured, sizeOf } from "./evaluate.js";
import { MIN_POINTS, POINT_COUNT, type Ranges, Sample } from "./sample.js";
import type { Entry, Node, Statement } from "./tree.js";

/** How a key's expression is compared: as an expression, an equation, or the list of an equation's solutions. */
export type Form = "expression" | "equation" | "solution-set";

/** The absolute bound of agreement, which holds near 0. */
const ABSOLUTE_AGREEMENT = 1e-12;
/**
 * The relative bound of agreement, against the larger magnitude of the two values. `Math`'s functions may differ in their
 * last bit between JavaScript engines, and this bound is about 10^6 times wider, so a verdict is the same on each.
 */
const RELATIVE_AGREEMENT = 1e-9;
const ZERO = measured(complex(0));
/** The stand-in for a value that is missing, which no value agrees with. */
const MISSING: Measured = { value: complex(Number.NaN, Number.NaN), magnitude: Number.NaN };

/** Whether a value and its magnitude are finite: a pole, an overflow or an undefined value makes a point unusable. */
function isUsable(a: Measured): boolean {
  return isFiniteComplex(a.value) && Number.isFinite(a.magnitude);
}

/**
 * Whether two values agree: |a − b| at most 1e-12, or at most 1e-9 times the larger magnitude of the two, the size of what
 * each computation cancelled, so that `\cosh^2x-\sinh^2x` agrees with 1 where its terms are near 10^8.
 */
export function agree(a: Measured, b: Measured): boolean {
  const distance = sizeOf(subtract(a.value, b.value));
  return distance <= ABSOLUTE_AGREEMENT || distance <= RELATIVE_AGREEMENT * Math.max(a.magnitude, b.magnitude);
}

/** A value of a solution set, with the variable it names and the mask of the sides its `\pm` signs take. */
interface Solution {
  readonly variable: string | null;
  readonly node: Node;
  readonly signs: number;
}

/** What a line is under a form, or why it is no such thing: `unreadable` scores NULL, `different` scores 0. */
export type Shape =
  | { readonly form: "expression"; readonly node: Node }
  | { readonly form: "equation"; readonly left: Node; readonly right: Node }
  | { readonly form: "solution-set"; readonly solutions: readonly Solution[] }
  | { readonly form: "unreadable"; readonly reason: string; readonly maxSolutions?: number }
  | { readonly form: "different"; readonly reason: string };

/**
 * Reads a statement under a form. A list or a `\pm` outside a solution set is unreadable; a relation where an expression is
 * expected, an expression or another relation where an equation is, and an entry of a solution set that is neither a value
 * nor `v = value`, are different. More solutions than `maxSolutions` once `\pm` is expanded is unreadable.
 */
export function shapeOf(statement: Statement, form: Form, maxSolutions: number): Shape {
  if (form === "solution-set") return solutionsOf(statement, maxSolutions);
  if (statement.kind === "list" || statement.entry.signs > 0)
    return { form: "unreadable", reason: "A list or a \\pm belongs to a solution set alone." };
  const { entry } = statement;
  if (form === "expression") {
    return entry.kind === "expression"
      ? { form, node: entry.node }
      : { form: "different", reason: "A relation is not an expression." };
  }
  return entry.kind === "relation" && entry.relation === "="
    ? { form, left: entry.left, right: entry.right }
    : { form: "different", reason: "An equation is two sides joined by =." };
}

function solutionsOf(statement: Statement, maxSolutions: number): Shape {
  const entries = statement.kind === "list" ? statement.entries : [statement.entry];
  const count = entries.reduce((total, entry) => total + 2 ** Math.min(entry.signs, 31), 0);
  if (count > maxSolutions) {
    const reason = `The solution set holds ${count} values once \\pm is expanded, over its limit maxSolutions of ${maxSolutions}.`;
    return { form: "unreadable", reason, maxSolutions };
  }
  const solutions: Solution[] = [];
  for (const entry of entries) {
    const value = solutionOf(entry);
    if (value === undefined) return { form: "different", reason: "A solution is a value or v = value." };
    for (let signs = 0; signs < 2 ** entry.signs; signs += 1) solutions.push({ ...value, signs });
  }
  const named = new Set(solutions.flatMap(({ variable }) => (variable === null ? [] : [variable])));
  if (named.size > 1) return { form: "different", reason: "The solutions name more than one variable." };
  return { form: "solution-set", solutions };
}

function solutionOf(entry: Entry): Omit<Solution, "signs"> | undefined {
  if (entry.kind === "expression") return { variable: null, node: entry.node };
  if (entry.relation !== "=" || entry.left.kind !== "variable") return undefined;
  return { variable: entry.left.name, node: entry.right };
}

/** A key's shape with what its follow-through binds: the variable that the earlier response's tree replaces. */
export interface KeySide {
  readonly shape: Exclude<Shape, { form: "unreadable" | "different" }>;
  readonly bindings?: ReadonlyMap<string, Node>;
}

/**
 * Compares a response's shape with a key's at the sample points, by the rule of the key's form.
 *
 * @returns `true` when equivalent, `false` when not, `null` when fewer than 12 points leave both sides finite.
 */
export function compareShapes(response: Shape, key: KeySide, ranges: Ranges): boolean | null {
  if (response.form === "unreadable") return null;
  if (response.form === "different" || response.form !== key.shape.form) return false;
  const sample = new Sample(ranges);
  if (response.form === "solution-set" && key.shape.form === "solution-set")
    return compareSolutions(response.solutions, key.shape.solutions, sample, key.bindings);
  const pairs: [Measured, Measured][] = [];
  for (let index = 0; index < POINT_COUNT; index += 1) {
    const responseValue = residualAt(response, sample, index);
    const keyValue = residualAt(key.shape, sample, index, key.bindings);
    if (responseValue !== undefined && keyValue !== undefined) pairs.push([responseValue, keyValue]);
  }
  if (pairs.length < MIN_POINTS) return null;
  return response.form === "equation" ? isMultiple(pairs) : pairs.every(([a, b]) => agree(a, b));
}

/**
 * The value of an expression, or the residual (left minus right) of an equation, at a point, with its magnitude;
 * `undefined` unless both are finite.
 */
export function residualAt(
  shape: Shape,
  sample: Sample,
  index: number,
  bindings?: ReadonlyMap<string, Node>,
): Measured | undefined {
  const point = sample.point(index, bindings);
  if (shape.form === "expression") {
    const value = evaluate(shape.node, point);
    return isUsable(value) ? value : undefined;
  }
  if (shape.form !== "equation") return undefined;
  const left = evaluate(shape.left, point);
  const right = evaluate(shape.right, point);
  const residual = { value: subtract(left.value, right.value), magnitude: left.magnitude + right.magnitude };
  return isUsable(left) && isUsable(right) && isUsable(residual) ? residual : undefined;
}

/**
 * Whether the response's residual is one non-zero constant times the key's at every point, so the same equation rearranged
 * or scaled. The constant is taken where the key's residual is largest.
 */
function isMultiple(pairs: readonly [Measured, Measured][]): boolean | null {
  let largest: [Measured, Measured] | undefined;
  for (const pair of pairs) {
    if (largest === undefined || sizeOf(pair[1].value) > sizeOf(largest[1].value)) largest = pair;
  }
  if (largest === undefined || agree(largest[1], ZERO)) return null;
  if (agree(largest[0], ZERO)) return false;
  const factor = divide(largest[0].value, largest[1].value);
  const scale = sizeOf(factor);
  return pairs.every(([response, key]) =>
    agree(response, { value: multiply(factor, key.value), magnitude: scale * key.magnitude }),
  );
}

/**
 * Whether two solution sets are equivalent: values that agree are one value, each response value agrees with exactly one key
 * value, and every key value is met. When both name their variable, it is the same.
 */
function compareSolutions(
  response: readonly Solution[],
  key: readonly Solution[],
  sample: Sample,
  bindings?: ReadonlyMap<string, Node>,
): boolean | null {
  const responseName = response.find(({ variable }) => variable !== null)?.variable;
  const keyName = key.find(({ variable }) => variable !== null)?.variable;
  if (responseName !== undefined && keyName !== undefined && responseName !== keyName) return false;
  const responseRows = valuesAtPoints(response, sample);
  const keyRows = valuesAtPoints(key, sample, bindings);
  const used: number[] = [];
  for (let index = 0; index < POINT_COUNT; index += 1) {
    if ([...responseRows, ...keyRows].every((row) => isUsable(row[index] ?? MISSING))) used.push(index);
  }
  if (used.length < MIN_POINTS) return null;
  const responseValues = responseRows.map((row) => used.map((index) => row[index] ?? MISSING));
  const keyValues = keyRows.map((row) => used.map((index) => row[index] ?? MISSING));
  const responseSet = distinct(responseValues);
  const keySet = distinct(keyValues);
  const met = new Set<number>();
  for (const value of responseSet) {
    const agreeing = keySet.flatMap((other, at) => (agreesEverywhere(value, other) ? [at] : []));
    const [only] = agreeing;
    if (agreeing.length !== 1 || only === undefined) return false;
    met.add(only);
  }
  return met.size === keySet.length;
}

/** The values of each solution at every sample point. */
function valuesAtPoints(
  solutions: readonly Solution[],
  sample: Sample,
  bindings?: ReadonlyMap<string, Node>,
): readonly (readonly Measured[])[] {
  return solutions.map(({ node, signs }) =>
    Array.from({ length: POINT_COUNT }, (_, index) => evaluate(node, sample.point(index, bindings, signs))),
  );
}

function agreesEverywhere(a: readonly Measured[], b: readonly Measured[]): boolean {
  return a.every((value, index) => {
    const other = b[index];
    return other !== undefined && agree(value, other);
  });
}

/** The values that do not agree with an earlier one: values that agree are one value. */
function distinct(values: readonly (readonly Measured[])[]): readonly (readonly Measured[])[] {
  const kept: (readonly Measured[])[] = [];
  for (const value of values) if (!kept.some((other) => agreesEverywhere(value, other))) kept.push(value);
  return kept;
}

/**
 * Checks a key's shape: an expression, an equation or a solution set its form takes, defined at enough sample points, and
 * for an equation a residual that is not 0 at every point.
 *
 * @throws `SecurityError` past `maxSolutions`; `DataError` for a key whose form it is not, or that the comparator cannot use.
 */
export function checkKeyShape(shape: Shape, ranges: Ranges): KeySide["shape"] {
  if (shape.form === "unreadable") {
    if (shape.maxSolutions !== undefined) throw new SecurityError(shape.reason, "maxSolutions", shape.maxSolutions);
    throw new DataError(shape.reason);
  }
  if (shape.form === "different") throw new DataError(`The key is not of its form: ${shape.reason}`);
  const sample = new Sample(ranges);
  const values: Measured[] = [];
  for (let index = 0; index < POINT_COUNT; index += 1) {
    const value =
      shape.form === "solution-set" ? solutionsAt(shape.solutions, sample, index) : residualAt(shape, sample, index);
    if (value !== undefined) values.push(value);
  }
  if (values.length < MIN_POINTS)
    throw new DataError(
      `The key is finite at ${values.length} of its ${POINT_COUNT} sample points, fewer than ${MIN_POINTS}; narrow the ranges of its variables.`,
    );
  if (shape.form === "equation" && values.every((value) => agree(value, ZERO)))
    throw new DataError("The key's equation holds at every point: its residual, left side minus right, is 0.");
  return shape;
}

/** A finite stand-in for the values of a solution set at a point, or `undefined` when one of them is not finite. */
function solutionsAt(solutions: readonly Solution[], sample: Sample, index: number): Measured | undefined {
  for (const { node, signs } of solutions) {
    if (!isUsable(evaluate(node, sample.point(index, undefined, signs)))) return undefined;
  }
  return ZERO;
}
