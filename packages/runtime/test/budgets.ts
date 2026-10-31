import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/**
 * The budgets of the benchmarks, from the first measurements with the headroom that docs/runtime/architecture.md#performance
 * gives. A time is the most that the fastest sample of a benchmark may take, in milliseconds.
 */
export const BUDGETS = {
  /** Reading the manifest of a package of 1,000 items. */
  packageRead: 300,
  /** The first use of 3 items of a package that has parsed none. */
  packageFirstUse: 9,
  /** Starting a session of a test of 100 sections. */
  planStart: 2,
  /** A submission with the outcome processing of a test of 100 sections, halfway through its session. */
  outcomeSubmit: 80,
  /** Reading a stored state and replaying 1,000 actions. */
  replay: 2000,
  /** Writing and reading the state of a session of 100 items. */
  stateRoundTrip: 5,
  /** The size of the state of a session of 100 items that has ended, in bytes. */
  stateBytes: 150_000,
} as const;

/**
 * Reports the median and the fastest sample of a benchmark with its budget, and fails the test when the fastest sample is
 * above the budget. The fastest sample is the least affected by the other work of a shared machine.
 */
export async function expectWithin(
  annotate: TestContext["annotate"],
  name: string,
  result: { readonly latency: { readonly min: number; readonly p50: number } },
  budget: number,
): Promise<void> {
  const { min, p50 } = result.latency;
  await annotate(`${name}: fastest ${min.toFixed(2)} ms, median ${p50.toFixed(2)} ms, budget ${budget} ms`);
  expect(min, `The fastest sample of "${name}" in milliseconds`).toBeLessThan(budget);
}
