import type { Value } from "../values/index.js";
import {
  allIntegers,
  asNumber,
  baseTypeOf,
  bigIntegerResult,
  floatResult,
  integerResult,
  primitiveOf,
  primitivesOf,
} from "./operands.js";

/** The operators that sum or multiply all their numbers. */
export type Aggregate = "sum" | "product";

/** Returns the numbers of every operand and whether every operand is an integer, `undefined` when one is NULL. */
function allNumbers(operands: readonly (Value | null)[]): { integers: boolean; numbers: number[] } | undefined {
  const numbers: number[] = [];
  let integers = true;
  for (const operand of operands) {
    if (operand === null) return undefined;
    if (baseTypeOf(operand) !== "integer") integers = false;
    for (const primitive of primitivesOf(operand)) numbers.push(asNumber(primitive));
  }
  return { integers, numbers };
}

/** Returns the number of a single operand, `undefined` when it is NULL. */
function numberOf(operand: Value | null): number | undefined {
  return operand === null ? undefined : asNumber(primitiveOf(operand));
}

/**
 * `qti-sum` and `qti-product`: the sum or product of the numbers of every operand, single or container.
 *
 * @remarks
 * An integer when every operand is one, computed exactly and NULL outside the safe integers; else a float. NULL when an
 * operand is NULL.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-sum}
 */
export function aggregate(operator: Aggregate, operands: readonly (Value | null)[]): Value | null {
  const all = allNumbers(operands);
  if (all === undefined) return null;
  if (all.integers) {
    const integers = all.numbers.map(BigInt);
    return bigIntegerResult(
      operator === "sum" ? integers.reduce((a, b) => a + b, 0n) : integers.reduce((a, b) => a * b, 1n),
    );
  }
  return floatResult(
    operator === "sum" ? all.numbers.reduce((a, b) => a + b, 0) : all.numbers.reduce((a, b) => a * b, 1),
  );
}

/**
 * `qti-subtract`: the first number minus the second, an integer when both are (exactly, NULL outside the safe integers)
 * and else a float; NULL when either is NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-subtract}
 */
export function subtract(a: Value | null, b: Value | null): Value | null {
  if (a === null || b === null) return null;
  const [x, y] = [asNumber(primitiveOf(a)), asNumber(primitiveOf(b))];
  return allIntegers([a, b]) ? bigIntegerResult(BigInt(x) - BigInt(y)) : floatResult(x - y);
}

/**
 * Returns a float, NULL when it is not finite: outside the value set of float.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function finiteFloat(value: number): Value | null {
  return Number.isFinite(value) ? floatResult(value) : null;
}

/**
 * `qti-divide`: the first number divided by the second, a float; NULL when either is NULL, the divisor is zero or the
 * result is not a finite float.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-divide}
 */
export function divide(a: Value | null, b: Value | null): Value | null {
  const [x, y] = [numberOf(a), numberOf(b)];
  return x === undefined || y === undefined || y === 0 ? null : finiteFloat(x / y);
}

/**
 * `qti-power`: the first number to the power of the second, a float; NULL when either is NULL or the result is not a
 * finite float.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-power}
 */
export function power(a: Value | null, b: Value | null): Value | null {
  const [x, y] = [numberOf(a), numberOf(b)];
  return x === undefined || y === undefined ? null : finiteFloat(x ** y);
}

/** Returns the quotient of two integers rounded down, exactly. */
function floorDivide(x: bigint, y: bigint): bigint {
  const quotient = x / y;
  return x % y !== 0n && x < 0n !== y < 0n ? quotient - 1n : quotient;
}

/**
 * `qti-integer-divide` and `qti-integer-modulus`: z, the greatest integer at most x/y, and x − z·y; NULL when either is
 * NULL or y is zero.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-integer-divide}
 */
export function integerDivision(
  operator: "integer-divide" | "integer-modulus",
  a: Value | null,
  b: Value | null,
): Value | null {
  const [x, y] = [numberOf(a), numberOf(b)];
  if (x === undefined || y === undefined || y === 0) return null;
  const quotient = floorDivide(BigInt(x), BigInt(y));
  return bigIntegerResult(operator === "integer-divide" ? quotient : BigInt(x) - quotient * BigInt(y));
}

function bigGcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a, b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function gcdOf(a: number, b: number): number {
  let [x, y] = [Math.abs(a), Math.abs(b)];
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/**
 * `qti-gcd`: the greatest common divisor of the integers of every operand; 0 when all are 0, and the gcd of the others
 * when some are.
 *
 * @remarks
 * NULL when an operand is NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-gcd}
 */
export function gcd(operands: readonly (Value | null)[]): Value | null {
  const all = allNumbers(operands);
  return all === undefined ? null : integerResult(all.numbers.reduce(gcdOf, 0));
}

/**
 * `qti-lcm`: the least common multiple of the integers of every operand, 0 when any is 0, exactly and NULL outside the
 * safe integers.
 *
 * @remarks
 * NULL when an operand is NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-lcm}
 */
export function lcm(operands: readonly (Value | null)[]): Value | null {
  const all = allNumbers(operands);
  if (all === undefined) return null;
  if (all.numbers.includes(0)) return integerResult(0);
  let multiple = 1n;
  for (const number of all.numbers) {
    const value = BigInt(Math.abs(number));
    multiple = (multiple / bigGcd(multiple, value)) * value;
  }
  return bigIntegerResult(multiple);
}

/**
 * `qti-min` and `qti-max`: the least or greatest number of every operand, an integer when every operand is one, else a
 * float.
 *
 * @remarks
 * NULL when an operand is NULL or a number is not a numerical value (NaN).
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-min}
 */
export function extremum(operator: "min" | "max", operands: readonly (Value | null)[]): Value | null {
  const all = allNumbers(operands);
  if (all === undefined || all.numbers.some(Number.isNaN)) return null;
  let value = operator === "min" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (const number of all.numbers) value = operator === "min" ? Math.min(value, number) : Math.max(value, number);
  return all.integers ? integerResult(value) : floatResult(value);
}

/**
 * `qti-round` and `qti-truncate`: the integer n with the number in [n − 0.5, n + 0.5), or the number truncated toward
 * zero.
 *
 * @remarks
 * NULL for NULL and NaN; NULL for ±INF and outside the safe integers.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-round}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function toInteger(operator: "round" | "truncate", operand: Value | null): Value | null {
  const x = numberOf(operand);
  if (x === undefined || !Number.isFinite(x)) return null;
  // Math.round rounds a half up toward +∞, which is the rule [n − 0.5, n + 0.5) of `qti-round`.
  return integerResult(operator === "round" ? Math.round(x) : Math.trunc(x));
}

/**
 * `qti-integer-to-float`: the integer as a float, NULL for NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-integer-to-float}
 */
export function integerToFloat(operand: Value | null): Value | null {
  const x = numberOf(operand);
  return x === undefined ? null : floatResult(x);
}
