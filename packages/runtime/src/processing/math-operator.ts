import { ProcessingError } from "../errors.js";
import type { Value } from "../values/index.js";
import { asNumber, floatResult, integerResult, primitiveOf } from "./operands.js";

/**
 * The names of `qti-math-operator`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-math-operator}
 */
export type MathOperatorName =
  | "abs"
  | "acos"
  | "acot"
  | "acsc"
  | "asec"
  | "asin"
  | "atan"
  | "atan2"
  | "ceil"
  | "cos"
  | "cosh"
  | "cot"
  | "coth"
  | "csc"
  | "csch"
  | "exp"
  | "floor"
  | "ln"
  | "log"
  | "sec"
  | "sech"
  | "signum"
  | "sin"
  | "sinh"
  | "tan"
  | "tanh"
  | "toDegrees"
  | "toRadians";

const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * The functions of `qti-math-operator`. The reciprocal functions are 1/f, so that f = ±INF gives 0 and f = 0 gives an
 * infinity, which is NULL; the inverse reciprocal ones are the inverse of 1/x.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-math-operator}
 */
const FUNCTIONS: ReadonlyMap<MathOperatorName, (x: number, y: number) => number> = new Map<
  MathOperatorName,
  (x: number, y: number) => number
>([
  ["abs", Math.abs],
  ["acos", Math.acos],
  ["acot", (x) => Math.atan(1 / x)],
  ["acsc", (x) => Math.asin(1 / x)],
  ["asec", (x) => Math.acos(1 / x)],
  ["asin", Math.asin],
  ["atan", Math.atan],
  ["atan2", Math.atan2],
  ["ceil", Math.ceil],
  ["cos", Math.cos],
  ["cosh", Math.cosh],
  ["cot", (x) => 1 / Math.tan(x)],
  ["coth", (x) => 1 / Math.tanh(x)],
  ["csc", (x) => 1 / Math.sin(x)],
  ["csch", (x) => 1 / Math.sinh(x)],
  ["exp", Math.exp],
  ["floor", Math.floor],
  ["ln", Math.log],
  ["log", Math.log10],
  ["sec", (x) => 1 / Math.cos(x)],
  ["sech", (x) => 1 / Math.cosh(x)],
  ["signum", Math.sign],
  ["sin", Math.sin],
  ["sinh", Math.sinh],
  ["tan", Math.tan],
  ["tanh", Math.tanh],
  ["toDegrees", (x) => x * DEGREES_PER_RADIAN],
  ["toRadians", (x) => x / DEGREES_PER_RADIAN],
]);

/**
 * The functions whose result is an integer.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const INTEGER_FUNCTIONS: ReadonlySet<MathOperatorName> = new Set(["signum", "floor", "ceil"]);

/**
 * The functions of two arguments; the others take one.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const BINARY_FUNCTIONS: ReadonlySet<MathOperatorName> = new Set(["atan2"]);

/**
 * `qti-math-operator`: a float, or an integer for `signum`, `floor` and `ceil`.
 *
 * @remarks
 * NULL when an operand is NULL or NaN, or the argument is outside the natural domain, which includes `ln` and `log` of
 * 0 and the reciprocal functions where the function is 0. A finite argument whose result overflows to an infinity is
 * NULL, as a result outside the float range is for `qti-divide`; an infinite argument keeps the infinite results of
 * Table 8.21, such as `exp(INF) = INF`. `floor` and `ceil` of ±INF are NULL.
 *
 * @throws `ProcessingError` when the number of operands is not the function's.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-math-operator}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function mathOperator(name: MathOperatorName, operands: readonly (Value | null)[]): Value | null {
  const compute = FUNCTIONS.get(name);
  if (compute === undefined) {
    throw new ProcessingError(
      `qti-math-operator has the name ${JSON.stringify(name)}, which Table 8.21 does not define.`,
    );
  }
  const arity = BINARY_FUNCTIONS.has(name) ? 2 : 1;
  if (operands.length !== arity) {
    throw new ProcessingError(
      `The function ${name} of qti-math-operator takes ${arity === 1 ? "one operand" : "two operands"}, found ${operands.length}.`,
    );
  }
  // A NULL operand is NaN here, since both give NULL.
  const numbers = operands.map((operand) => (operand === null ? Number.NaN : asNumber(primitiveOf(operand))));
  if (numbers.some(Number.isNaN)) return null;
  const [x = 0, y = 0] = numbers;
  const result = compute(x, y);
  if (INTEGER_FUNCTIONS.has(name)) return Number.isFinite(result) ? integerResult(result) : null;
  if (Number.isNaN(result)) return null;
  return Number.isFinite(result) || !numbers.every(Number.isFinite) ? floatResult(result) : null;
}
