import { drawIndex, drawUniform } from "../random.js";
import type { Value } from "../values/index.js";
import type { Environment } from "./context.js";
import { floatResult, integerResult } from "./operands.js";

/** The `min` of `qti-random-integer` and `qti-random-float` when the attribute is absent (INFO §7.33.1, §7.34.1). */
export const DEFAULT_RANDOM_MIN = 0;

/** The `step` of `qti-random-integer` when the attribute is absent (INFO §7.34.3). */
export const DEFAULT_RANDOM_STEP = 1;

/**
 * `qti-random-integer` (INFO §7.34): min + k × step for an integer k with the result at most max, each equally likely,
 * drawn as an index over the floor((max − min) / step) + 1 admissible values. NULL when an attribute is NULL, min > max
 * or step ≤ 0 (G32).
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
 * `qti-random-float` (INFO §7.33): min + u × (max − min) for a uniform u in [0, 1), so that the result is in [min, max)
 * rather than [min, max], a deviation of measure zero (G15). NULL when an attribute is NULL, min > max (G33) or the
 * result is not finite.
 */
export function randomFloat(min: number | null, max: number | null, environment: Environment): Value | null {
  if (min === null || max === null || min > max) return null;
  const value = min + drawUniform(environment.random) * (max - min);
  return Number.isFinite(value) ? floatResult(value) : null;
}
