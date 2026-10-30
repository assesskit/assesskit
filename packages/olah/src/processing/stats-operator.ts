import type { Value } from "../values/index.js";
import { floatResult, numbersOf } from "./operands.js";

/** The names of `qti-stats-operator` (INFO §8.31). */
export type StatsOperatorName = "mean" | "popSD" | "popVariance" | "sampleSD" | "sampleVariance";

/**
 * `qti-stats-operator` (INFO §2.11.3.44, §8.31): the mean, or the variance or standard deviation of a sample (divided by
 * n − 1) or of a population (divided by n), as a float. NULL when the container is NULL or holds NaN, and for a variance
 * or standard deviation of fewer than two values, which Table 8.31 requires of both kinds (G13).
 */
export function statsOperator(name: StatsOperatorName, operand: Value | null): Value | null {
  if (operand === null) return null;
  const numbers = numbersOf(operand);
  if (numbers.some(Number.isNaN)) return null;
  const count = numbers.length;
  const mean = numbers.reduce((total, number) => total + number, 0) / count;
  if (name === "mean") return Number.isNaN(mean) ? null : floatResult(mean);
  if (count < 2) return null;
  const squares = numbers.reduce((total, number) => total + (number - mean) ** 2, 0);
  const variance = squares / (name === "sampleVariance" || name === "sampleSD" ? count - 1 : count);
  const result = name === "popSD" || name === "sampleSD" ? Math.sqrt(variance) : variance;
  return Number.isNaN(result) ? null : floatResult(result);
}
