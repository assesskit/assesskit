import { drawIndex, drawUniform } from "../random.js";
import type { Value } from "../values/index.js";
import type { Environment } from "./context.js";
import { floatResult, integerResult } from "./operands.js";

/**
 * The `min` of `qti-random-integer` and `qti-random-float` when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-random-integer}
 */
export const DEFAULT_RANDOM_MIN = 0;

/**
 * The `step` of `qti-random-integer` when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-random-integer}
 */
export const DEFAULT_RANDOM_STEP = 1;

/**
 * `qti-random-integer`: min + k × step for an integer k with the result at most max, each equally likely, drawn as an
 * index over the floor((max − min) / step) + 1 admissible values.
 *
 * @remarks
 * NULL when an attribute is NULL, min > max or step ≤ 0.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-random-integer}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function randomInteger(
  min: number | null,
  max: number | null,
  step: number | null,
  environment: Environment,
): Value | null {
  if (min === null || max === null || step === null || min > max || step <= 0) return null;
  const count = Math.floor((max - min) / step) + 1;
  return integerResult(min + drawIndex(environment.random, count) * step);
}

/**
 * `qti-random-float`: min + u × (max − min) for a uniform u in [0, 1), so that the result is in [min, max) rather than
 * [min, max], a deviation of measure zero.
 *
 * @remarks
 * NULL when an attribute is NULL, min > max or the result is not finite.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-random-float}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function randomFloat(min: number | null, max: number | null, environment: Environment): Value | null {
  if (min === null || max === null || min > max) return null;
  const value = min + drawUniform(environment.random) * (max - min);
  return Number.isFinite(value) ? floatResult(value) : null;
}
