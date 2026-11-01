import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/**
 * The budgets of the benchmarks. A time is the most that the fastest sample of a benchmark may take, in milliseconds: five
 * times the fastest sample that the CI runner took, rounded up to one significant digit, as docs/runtime/performance.md
 * explains. The size of a state is in bytes, which no machine changes.
 */
export const BUDGETS = {
  /** Reading the manifest of a package of 1,000 items. */
  packageRead: 500,
  /** The first use of 3 items of a package that has parsed none. */
  packageFirstUse: 20,
  /** Starting a session of a test of 100 sections. */
  planStart: 6,
  /** A submission with the outcome processing of a test of 100 sections, halfway through its session. */
  outcomeSubmit: 100,
  /** Reading a stored state and replaying 1,000 actions. */
  replay: 2000,
  /** Writing and reading the state of a session of 100 items. */
  stateRoundTrip: 30,
  /** The size of the state of a session of 100 items that has ended, in bytes. */
  stateBytes: 150_000,
} as const;

/**
 * The budgets of the rows against Longsight qti3-core: the most that the fastest sample of the runtime may take, in
 * milliseconds, set as the times of {@link BUDGETS} are, and the most it may take as a multiple of the fastest sample of
 * Longsight in the same run. The multiples hold on any machine, because both samples of a row come from one run; they stay
 * within 1.5 of the measured ratios, which docs/runtime/performance.md lists, so that a change which slows one path
 * against the reference fails.
 */
export const LONGSIGHT_BUDGETS = {
  /** Reading the 223 example items that both implementations read. */
  parse: { time: 500, ratio: 1.5 },
  /** Starting an item session of each of them, with the first presentation. */
  start: { time: 7, ratio: 2 },
  /** Starting the sessions of the items that have template processing, repeated. */
  startTemplated: { time: 40, ratio: 2 },
  /** Entering the correct responses and submitting them, in sessions that were presented. */
  submit: { time: 20, ratio: 2 },
  /** Reading each item, starting its session and scoring its correct responses. */
  score: { time: 400, ratio: 1.5 },
  /** Submitting the 51st item of a test of 100 items 100 times, with the sum of the scores of the items answered. */
  testSubmit: { time: 20, ratio: 3 },
} as const;

/** The budget of one row against Longsight. */
export interface LongsightBudget {
  /** The most the fastest sample of the runtime may take, in milliseconds. */
  readonly time: number;
  /** The most the fastest sample of the runtime may take, as a multiple of the fastest sample of Longsight. */
  readonly ratio: number;
}

/**
 * Reports the fastest and the median sample of a row for both implementations and their ratio, and fails the test when
 * the fastest sample of the runtime is above its time or above the ratio of the fastest sample of Longsight.
 */
export async function expectAgainst(
  annotate: TestContext["annotate"],
  name: string,
  subject: { readonly latency: { readonly min: number; readonly p50: number } },
  reference: { readonly latency: { readonly min: number; readonly p50: number } },
  budget: LongsightBudget,
): Promise<void> {
  const ratio = subject.latency.min / reference.latency.min;
  const medians = subject.latency.p50 / reference.latency.p50;
  await annotate(
    `${name}: runtime ${subject.latency.min.toFixed(3)} ms (median ${subject.latency.p50.toFixed(3)}), Longsight ${reference.latency.min.toFixed(3)} ms (median ${reference.latency.p50.toFixed(3)}); ratio ${ratio.toFixed(2)} (median ${medians.toFixed(2)}); budget ${budget.time} ms and ${budget.ratio}`,
  );
  expect(subject.latency.min, `The fastest sample of "${name}" in milliseconds`).toBeLessThan(budget.time);
  expect(ratio, `The fastest sample of "${name}" as a multiple of Longsight's`).toBeLessThan(budget.ratio);
}

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
