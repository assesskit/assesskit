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
  /**
   * Resolving the path of each of the 1,000 resources of a package: five times the fastest sample of a laptop (0.30 ms),
   * rounded up to one significant digit, until the CI runner's samples replace it.
   */
  resourcePaths: 2,
  // The engine's budgets are five times the fastest sample of the build on a laptop (0.38, 6.11, 91 and 1.59 ms), rounded up
  // to one significant digit, until the CI runner's samples replace them.
  /** Starting a session of a test of 100 sections. */
  planStart: 2,
  /** A submission with the outcome processing of a test of 100 sections, halfway through its session. */
  outcomeSubmit: 40,
  /** Reading a stored state and replaying 1,000 actions. */
  replay: 500,
  /** Writing and reading the state of a session of 100 items. */
  stateRoundTrip: 8,
  /** The size of the state of a session of 100 items that has ended, in bytes. */
  stateBytes: 150_000,
  // The operators' budgets are five times the fastest sample of the CI runner over five runs of main on 2026-11-05 (0.0273,
  // 3.86, 0.0051, 0.544 and 1.17 ms), rounded up to one significant digit; those runs timed the sources, and the samples of
  // the build, which the benchmarks now time, replace them at the next run of the bench job.
  /** Comparing an expression with its key by `expression-equivalent`, its options read on the call. */
  operatorExpression: 0.2,
  /** Comparing a sum of 1,000 terms with a key of as many, the most that a response holds. */
  operatorLongest: 20,
  /** Scoring a mixed fraction with a unit against a key with a tolerance and a tier. */
  operatorNumber: 0.03,
  /** Scoring a text of 200 words against 50 answers with credit tiers. */
  operatorText: 3,
  /** Checking 60 lines of worked steps. */
  mathSteps: 6,
  // The compiler's budgets are five times the fastest sample of the CI runner over the same runs (0.025 and 152 ms), rounded
  // up to one significant digit, of the sources likewise until the samples of the build replace them.
  /** Compiling the keys of an item of four responses. */
  compileItem: 0.2,
  /** Compiling 256 orders of 1,000 choices, scored per position: the limits of keys. */
  compileLimits: 800,
  // The budgets of the item formats are five times the fastest sample of a laptop (0.32, 0.56, 87.8, 0.26 and 0.69 ms),
  // rounded up to one significant digit, until the CI runner's samples replace them.
  /** Reading the edge cases of GIFT, 18 items and two questions that Moodle refuses. */
  giftRead: 2,
  /** Writing the 14 items of the written cases as GIFT, running their response processing. */
  giftWrite: 3,
  /** Reading 47 essays of the most tags of a text, to the limit of elements. */
  giftTags: 500,
  /** Reading the edge cases of Moodle XML, 9 items and a question of a type that does not convert. */
  moodleXmlRead: 2,
  /** Writing the 14 items of the written cases as Moodle XML, with an image. */
  moodleXmlWrite: 4,
} as const;

/**
 * The budgets of the rows against Longsight qti3-core: the most that the fastest sample of the runtime may take, in
 * milliseconds, set as the times of {@link BUDGETS} are, and the most it may take as a multiple of the fastest sample of
 * Longsight in the same run. The multiples hold on any machine, because both samples of a row come from one run; they stay
 * within 1.5 of the measured ratios, which docs/runtime/performance.md lists, so that a change which slows one path
 * against the reference fails. Every time is five times the fastest sample of the CI runner in the last four green runs of
 * `bench` on main (validate 11.2 ms, package 146 ms, start a test 0.42 ms), rounded up to one significant digit.
 */
export const LONGSIGHT_BUDGETS = {
  /** Reading the example items that both implementations read and score, 215 of them. */
  parse: { time: 500, ratio: 1.5 },
  /** Validating each of them. */
  validate: { time: 60, ratio: 4.5 },
  /** Starting an item session of each of them, with the first presentation. */
  start: { time: 7, ratio: 2 },
  /** Starting the sessions of the items that have template processing, repeated. */
  startTemplated: { time: 40, ratio: 2 },
  /** Entering the correct responses and submitting them, in sessions that were presented. */
  submit: { time: 20, ratio: 2 },
  /** Reading each item, starting its session and scoring its correct responses. */
  score: { time: 400, ratio: 1.5 },
  /** Reading a package of 200 generated items and parsing every item. */
  package: { time: 800, ratio: 1 },
  /** Starting the session of a test of 100 items 100 times. */
  testStart: { time: 3, ratio: 1 },
  /** Submitting the 51st item of a test of 100 items 100 times, with the sum of the scores of the items answered. */
  testSubmit: { time: 20, ratio: 3 },
} as const;

/**
 * The budget of rescoring a report of 200 items, the reading of its inputs and the outcome processing: the most that the
 * fastest sample may take, in milliseconds, five times the 0.42 ms of the build on a laptop until the CI runner's sample
 * replaces it, and the most as a multiple of the fastest sample of the outcome step of the engine on the same session. No
 * outside library rescores a stored report, so the engine is the reference.
 */
export const RESCORING_BUDGET = { time: 3, ratio: 2 } as const;

/**
 * The budget of parsing the 1EdTech example documents from their bytes, against libxml2 in WebAssembly
 * (`XmlDocument.fromBuffer` of libxml2-wasm), set as the rows against Longsight are: its time is five times the 28.1 ms that
 * the CI runner took.
 */
export const LIBXML2_BUDGET = { time: 200, ratio: 2.5 } as const;

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
