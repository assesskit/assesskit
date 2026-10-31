import { ProcessingError } from "../errors.js";
import { matchValues, type Value } from "../values/index.js";
import { asNumber, booleanResult, primitiveOf } from "./operands.js";
import { figuresInRange, type RoundingMode, rounded, sameDecimal } from "./rounding.js";

/** The relations of the comparison operators. */
export type Relation = "gt" | "gte" | "lt" | "lte" | "duration-lt" | "duration-gte";

const RELATIONS: ReadonlyMap<Relation, (a: number, b: number) => boolean> = new Map([
  ["gt", (a, b) => a > b],
  ["gte", (a, b) => a >= b],
  ["lt", (a, b) => a < b],
  ["lte", (a, b) => a <= b],
  ["duration-lt", (a, b) => a < b],
  ["duration-gte", (a, b) => a >= b],
]);

/** Returns the numbers of two single operands, `undefined` when either is NULL. */
function pairOf(a: Value | null, b: Value | null): readonly [number, number] | undefined {
  return a === null || b === null ? undefined : [asNumber(primitiveOf(a)), asNumber(primitiveOf(b))];
}

/**
 * `qti-gt`, `qti-gte`, `qti-lt`, `qti-lte`, `qti-duration-lt` and `qti-duration-gte`: the relation between two numbers or
 * durations, NULL when either is NULL (INFO §2.11.3.20–23, §2.11.3.26–27).
 */
export function compare(relation: Relation, a: Value | null, b: Value | null): Value | null {
  const pair = pairOf(a, b);
  const holds = RELATIONS.get(relation);
  return pair === undefined || holds === undefined ? null : booleanResult(holds(...pair));
}

/** The tolerance of `qti-equal`: its mode, the two amounts and whether each bound is included (INFO §5.46). */
export interface Tolerance {
  readonly mode: "exact" | "absolute" | "relative";
  readonly lower: number;
  readonly upper: number;
  readonly includeLower: boolean;
  readonly includeUpper: boolean;
}

/**
 * `qti-equal`: whether y, the second number, lies in the range around x, the first: x itself in `exact` mode, [x − t0,
 * x + t1] in `absolute` mode and [x(1 − t0/100), x(1 + t1/100)] in `relative` mode, each bound included unless excluded
 * (INFO §5.46). For a negative x the relative range is the one between its two ends (G4). NULL when either number, or a
 * tolerance, is NULL.
 */
export function equal(a: Value | null, b: Value | null, tolerance: Tolerance | null): Value | null {
  const pair = pairOf(a, b);
  if (pair === undefined || tolerance === null) return null;
  const [x, y] = pair;
  if (tolerance.mode === "exact") return booleanResult(x === y);
  const ends =
    tolerance.mode === "absolute"
      ? [x - tolerance.lower, x + tolerance.upper]
      : [x * (1 - tolerance.lower / 100), x * (1 + tolerance.upper / 100)];
  const low = Math.min(...ends);
  const high = Math.max(...ends);
  const aboveLow = tolerance.includeLower ? y >= low : y > low;
  const belowHigh = tolerance.includeUpper ? y <= high : y < high;
  return booleanResult(aboveLow && belowHigh);
}

/**
 * `qti-equal-rounded`: whether two numbers are equal once both are rounded as `qti-round-to` rounds them, compared as
 * decimals (INFO §2.11.3.4, §5.47). NULL when either is NULL or NaN, or `figures` is NULL or out of range.
 */
export function equalRounded(
  a: Value | null,
  b: Value | null,
  mode: RoundingMode,
  figures: number | null,
): Value | null {
  const pair = pairOf(a, b);
  if (pair === undefined || figures === null || !figuresInRange(mode, figures)) return null;
  const [x, y] = pair.map((value) => rounded(value, mode, figures));
  if (x === undefined || y === undefined) return null;
  if (typeof x === "number" || typeof y === "number") return booleanResult(x === y);
  return booleanResult(sameDecimal(x, y));
}

/**
 * `qti-match`: whether two values of one cardinality and base type are the same value, as `matchValues` compares them;
 * NULL when either is NULL (INFO §2.11.3.28).
 */
export function match(a: Value | null, b: Value | null): Value | null {
  return a === null || b === null ? null : booleanResult(matchValues(a, b));
}

/**
 * Builds the tolerance of `qti-equal` from its attributes, with the amounts resolved.
 *
 * @param amounts - The one or two amounts, NULL where a variable is NULL.
 * @returns NULL when an amount is NULL or negative.
 * @throws `ProcessingError` when the mode is absolute or relative and there are not one or two amounts.
 */
export function toleranceOf(
  mode: Tolerance["mode"],
  amounts: readonly (number | null)[],
  includeLower: boolean,
  includeUpper: boolean,
): Tolerance | null {
  if (mode === "exact") return { mode, lower: 0, upper: 0, includeLower, includeUpper };
  const [lower, upper = lower, ...rest] = amounts;
  if (lower === undefined || rest.length > 0) {
    throw new ProcessingError(
      `The operator qti-equal in ${mode} mode needs one or two tolerances, found ${amounts.length}.`,
    );
  }
  if (lower === null || upper === null || upper === undefined || lower < 0 || upper < 0) return null;
  return { mode, lower, upper, includeLower, includeUpper };
}
