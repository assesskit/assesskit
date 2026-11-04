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
  /**
   * The old generation of the heap of a worker, in megabytes, in which `readCandidateAction` refuses a `support-settings`
   * action of 1,000,000 font names. The worker needs 24 to 28 MB with that input, and the same action read without the limit
   * `maxSettingListLength` needs 192 to 256 MB. A heap is no time of a runner, so the budget is a little over twice the
   * measure, on any machine.
   */
  settingsHeap: 64,
} as const;

/**
 * The budgets of the rows against Longsight qti3-core: the most that the fastest sample of the runtime may take, in
 * milliseconds, set as the times of {@link BUDGETS} are, and the most it may take as a multiple of the fastest sample of
 * Longsight in the same run. The multiples hold on any machine, because both samples of a row come from one run; they stay
 * within 1.5 of the measured ratios, which docs/runtime/performance.md lists, so that a change which slows one path
 * against the reference fails. The rows of validation, of a package and of the start of a test have no sample of the
 * runner yet: their times are five times the sample of a laptop times 3, what the runner takes against the laptop on the
 * other rows, rounded up to one significant digit.
 */
export const LONGSIGHT_BUDGETS = {
  /** Reading the example items that both implementations read and score, 215 of them. */
  parse: { time: 500, ratio: 1.5 },
  /** Validating each of them. */
  validate: { time: 80, ratio: 4.5 },
  /** Starting an item session of each of them, with the first presentation. */
  start: { time: 7, ratio: 2 },
  /** Starting the sessions of the items that have template processing, repeated. */
  startTemplated: { time: 40, ratio: 2 },
  /** Entering the correct responses and submitting them, in sessions that were presented. */
  submit: { time: 20, ratio: 2 },
  /** Reading each item, starting its session and scoring its correct responses. */
  score: { time: 400, ratio: 1.5 },
  /** Reading a package of 200 generated items and parsing every item. */
  package: { time: 2000, ratio: 1 },
  /** Starting the session of a test of 100 items 100 times. */
  testStart: { time: 4, ratio: 1 },
  /** Submitting the 51st item of a test of 100 items 100 times, with the sum of the scores of the items answered. */
  testSubmit: { time: 20, ratio: 3 },
} as const;

/**
 * The budget of rescoring a report of 200 items, the reading of its inputs and the outcome processing: the most that the
 * fastest sample may take, in milliseconds, and the most as a multiple of the fastest sample of the outcome step of the
 * engine on the same session. No outside library rescores a stored report, so the engine is the reference.
 */
export const RESCORING_BUDGET = { time: 7, ratio: 2 } as const;

/**
 * The budget of parsing the 1EdTech example documents from their bytes, against libxml2 in WebAssembly
 * (`XmlDocument.fromBuffer` of libxml2-wasm), set as the new rows against Longsight are.
 */
export const LIBXML2_BUDGET = { time: 300, ratio: 2.5 } as const;

/** The budget of one row against a reference. */
interface ReferenceBudget {
  /** The most the fastest sample of the runtime may take, in milliseconds. */
  readonly time: number;
  /** The most the fastest sample of the runtime may take, as a multiple of the fastest sample of the reference. */
  readonly ratio: number;
}

/** One row against a reference: what each side does in a sample, and the hooks that prepare a sample outside the time. */
export interface Row {
  readonly name: string;
  readonly budget: ReferenceBudget;
  readonly runtime: () => void;
  readonly reference: () => void;
  readonly prepareRuntime?: () => void;
  readonly prepareReference?: () => void;
}

/**
 * The rounds in which a row takes turns between the runtime and its reference. Each round gives each side a fifth of the
 * window of {@link BENCH_OPTIONS}, so that a stretch of a busy host, which lasts a second or more on a shared runner, falls
 * on both sides and not on whichever ran then: the fastest sample of each side comes from the quietest of its rounds, and
 * the ratio of the two holds on a shared host as the budgets assume.
 */
const ROUNDS = 5;

/** The statistics of the fastest sample over several rounds, and the median of the medians. */
function overRounds(rounds: readonly { readonly min: number; readonly p50: number }[]): {
  readonly latency: { readonly min: number; readonly p50: number };
} {
  const medians = rounds.map(({ p50 }) => p50).sort((a, b) => a - b);
  return {
    latency: { min: Math.min(...rounds.map(({ min }) => min)), p50: medians[Math.floor(medians.length / 2)] ?? 0 },
  };
}

/** Times the runtime and its reference on a row, in turns, and holds the runtime to its budgets. */
export async function compareRow(context: Pick<TestContext, "annotate" | "bench">, row: Row): Promise<void> {
  const { annotate, bench } = context;
  const subject = bench(`${row.name}: runtime`, { beforeEach: row.prepareRuntime }, row.runtime);
  const reference = bench(`${row.name}: reference`, { beforeEach: row.prepareReference }, row.reference);
  const { time, iterations } = BENCH_OPTIONS;
  const round = { ...BENCH_OPTIONS, time: time / ROUNDS, iterations: Math.ceil(iterations / ROUNDS) };
  const runtimeRounds = [];
  const referenceRounds = [];
  for (let place = 0; place < ROUNDS; place++) {
    // The warm-up is once, in the first round: the later rounds find both sides warm.
    const options = { ...round, warmup: place === 0 };
    runtimeRounds.push((await subject.run(options)).latency);
    referenceRounds.push((await reference.run(options)).latency);
  }
  await expectAgainst(annotate, row.name, overRounds(runtimeRounds), overRounds(referenceRounds), row.budget);
}

/**
 * Reports the fastest and the median sample of a row for the runtime and its reference and their ratio, and fails the
 * test when the fastest sample of the runtime is above its time or above the ratio of the fastest sample of the reference.
 */
async function expectAgainst(
  annotate: TestContext["annotate"],
  name: string,
  subject: { readonly latency: { readonly min: number; readonly p50: number } },
  reference: { readonly latency: { readonly min: number; readonly p50: number } },
  budget: ReferenceBudget,
): Promise<void> {
  const ratio = subject.latency.min / reference.latency.min;
  const medians = subject.latency.p50 / reference.latency.p50;
  await annotate(
    `${name}: runtime ${subject.latency.min.toFixed(3)} ms (median ${subject.latency.p50.toFixed(3)}), reference ${reference.latency.min.toFixed(3)} ms (median ${reference.latency.p50.toFixed(3)}); ratio ${ratio.toFixed(2)} (median ${medians.toFixed(2)}); budget ${budget.time} ms and ${budget.ratio}`,
  );
  expect(subject.latency.min, `The fastest sample of "${name}" in milliseconds`).toBeLessThan(budget.time);
  expect(ratio, `The fastest sample of "${name}" as a multiple of the reference's`).toBeLessThan(budget.ratio);
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
