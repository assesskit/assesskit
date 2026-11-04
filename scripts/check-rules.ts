import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CAT_REST_RULES } from "./rules/cat-rest.ts";
import { CUSTOM_INTERACTION_RULES } from "./rules/custom-interactions.ts";
import { PLAYER_RULES } from "./rules/player.ts";
import { REPOSITORY_RULES } from "./rules/repository.ts";
import type { Rule } from "./rules/rule.ts";
import { RUNTIME_RULES } from "./rules/runtime.ts";

export type { Rule };

/**
 * The security-critical rules of the player, of the runtime and of the CAT binding, and the rule that keeps member-only material
 * out of the repository, each with the test that guards it.
 */
export const RULES: readonly Rule[] = [
  ...PLAYER_RULES,
  ...RUNTIME_RULES,
  ...CAT_REST_RULES,
  ...CUSTOM_INTERACTION_RULES,
  ...REPOSITORY_RULES,
];

/** The folders that a scratch copy leaves out: generated output and installed packages, which it links instead. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage", ".cache", ".vitest"]);
/** The generated API reference, which no test reads. */
const API_DOCS = "docs/api";
/**
 * The longest a test of a mutated copy may take, in milliseconds: a removed deadline makes a test wait for ever. The slowest test
 * that a rule runs takes 0.7 s on a quiet machine, in a fresh copy as well, and 4.2 s on a shared laptop with 6 runnable
 * processes for each core. Five times that, rounded up to one significant digit, is 30 s, the rule of the benchmark budgets.
 */
const TEST_TIMEOUT_MS = 30_000;
/** The same for a test in a browser, which starts a page, waits for messages between frames and keeps quiet to see none. */
const BROWSER_TEST_TIMEOUT_MS = 30_000;
/** The longest a run of one test file may take in all, in milliseconds, before it is stopped. */
const RUN_TIMEOUT_MS = 300_000;
/**
 * The most that a run may print, in bytes. Node.js stops a run at 1 MiB of output by default and cuts the summary off, and a
 * copy without a rule can fail every test of a file with a long message each.
 */
const REPORT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * What checking one rule found: the rule is guarded, it is not, or a run took longer than its limit and nothing is known.
 * A run that is only slow, on a host with other work to do, says nothing about the rule.
 */
export interface Verdict {
  readonly outcome: "guarded" | "unguarded" | "timed-out";
  /** A sentence that says what happened and, when the rule is not guarded, what to do. */
  readonly message: string;
}

/**
 * Removes a rule from the text of its file.
 *
 * @throws `Error` when the text to replace does not occur exactly once.
 */
export function removeRule(source: string, rule: Rule): string {
  const count = source.split(rule.find).length - 1;
  if (count !== 1)
    throw new Error(`${rule.file} holds ${JSON.stringify(rule.find)} ${count} times; the rule needs it exactly once.`);
  return source.replace(rule.find, () => rule.replace);
}

/**
 * Returns the number of tests of a Vitest run that failed, or `undefined` when the run did not run tests.
 *
 * @remarks
 * A test that did not finish counts as failed, and so does an error of the run. A removed rule can make the worker crash, and
 * the summary then says "29 passed (80)" without a word about the 51 tests that never ran.
 */
export function failedTests(report: string): number | undefined {
  const summary = /^\s*Tests\s+(.*)$/m.exec(report)?.[1];
  if (summary === undefined || !/\d+ (?:failed|passed)/.test(summary)) return undefined;
  const count = (state: string): number => Number(new RegExp(`(\\d+) ${state}`).exec(summary)?.[1] ?? 0);
  const total = Number(/\((\d+)\)\s*$/.exec(summary)?.[1] ?? 0);
  const finished = count("failed") + count("passed") + count("skipped") + count("todo");
  const errors = Number(/^\s*Errors\s+(\d+)/m.exec(report)?.[1] ?? 0);
  return count("failed") + Math.max(0, total - finished) + errors;
}

/**
 * Returns how many of the failed tests of a report of a Vitest run ran out of time. A failed test has one block, which starts
 * with `FAIL`, and the message may be printed again outside it (the reporter of GitHub Actions annotates it), so the blocks
 * are counted and not the messages.
 */
export function timedOutTests(report: string): number {
  return report
    .split(/^ FAIL /m)
    .slice(1)
    .filter((block) => /(?:Test|Hook) timed out in \d+ms/.test(block)).length;
}

/** The folders directly below a folder of the repository, if it exists. */
function foldersIn(root: string, folder: string): string[] {
  const parent = join(root, folder);
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name));
}

/** Copies the repository into a scratch directory without generated output, and links the installed packages. */
function copyRepository(root: string, scratch: string): void {
  cpSync(root, scratch, {
    recursive: true,
    filter: (path) => !SKIPPED.has(basename(path)) && relative(root, path) !== API_DOCS,
  });
  const examples = foldersIn(root, "examples").flatMap((folder) => foldersIn(root, relative(root, folder)));
  for (const directory of [root, ...foldersIn(root, "packages"), ...examples]) {
    const modules = join(directory, "node_modules");
    if (existsSync(modules)) symlinkSync(modules, join(scratch, directory.slice(root.length), "node_modules"));
  }
}

/** What a run of one test file reported. */
interface TestRun {
  /** The number of failed tests, or `undefined` when no tests ran. */
  readonly failed: number | undefined;
  readonly report: string;
  /** Whether the run was stopped at its limit, with tests that had not finished. */
  readonly stopped: boolean;
  /** Whether every failed test ran out of time. */
  readonly onlyTimeouts: boolean;
}

/** Runs one test file of a copy with Vitest and returns what it reported. */
function runTest(root: string, scratch: string, test: string, browser: boolean, limit: number): TestRun {
  const vitest = join(root, "node_modules/vitest/vitest.mjs");
  const testTimeout = `--testTimeout=${browser ? BROWSER_TEST_TIMEOUT_MS : TEST_TIMEOUT_MS}`;
  // A browser test runs in the browser project of its package: packages/<package>/test/ is in <package>-browser.
  const where = browser ? ["--project", `${/^packages\/([^/]+)\//.exec(test)?.[1] ?? "player"}-browser`] : [];
  const run = spawnSync(
    process.execPath,
    [vitest, "run", "--reporter=default", "--maxWorkers=2", testTimeout, ...where, test],
    {
      cwd: scratch,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", BROWSERS: "chromium" },
      timeout: limit,
      maxBuffer: REPORT_MAX_BYTES,
    },
  );
  const report = `${run.stdout}${run.stderr}`;
  const failed = failedTests(report);
  return {
    failed,
    report,
    stopped: run.error !== undefined && "code" in run.error && run.error.code === "ETIMEDOUT",
    onlyTimeouts: failed !== undefined && failed > 0 && timedOutTests(report) >= failed,
  };
}

/** Says that a run took longer than its limit and that this is not a verdict on the rule. */
function timedOut(test: string, where: string, run: TestRun, limit: number): Verdict {
  const what = run.stopped
    ? `was stopped after ${limit / 1000} s`
    : `has ${timedOutTests(run.report)} ${timedOutTests(run.report) === 1 ? "test" : "tests"} that ran out of time`;
  return {
    outcome: "timed-out",
    message: `${test} ${what} ${where}, so nothing is known of the rule; run it again on a host with less work.`,
  };
}

/**
 * Checks that the test of a rule passes on the code, and fails on a copy of the code without the rule. A run that takes longer
 * than its limit on the unchanged code, or is stopped on the copy, is a timeout and not a verdict: the host may be busy.
 *
 * @param root - The repository.
 * @param rule - The rule.
 * @param passing - The test files that already passed on the unchanged code, which a run of many rules does not run again.
 * @param runLimit - The longest a run of the test file may take in all, in milliseconds.
 */
export function checkRule(
  root: string,
  rule: Rule,
  passing: Set<string> = new Set(),
  runLimit: number = RUN_TIMEOUT_MS,
): Verdict {
  const scratch = mkdtempSync(join(tmpdir(), "assesskit-rule-"));
  try {
    copyRepository(root, scratch);
    const baseline = passing.has(rule.test)
      ? { failed: 0, report: "", stopped: false, onlyTimeouts: false }
      : runTest(root, scratch, rule.test, rule.browser === true, runLimit);
    if (baseline.failed === 0) passing.add(rule.test);
    if (baseline.stopped || baseline.onlyTimeouts)
      return timedOut(rule.test, "on the unchanged code", baseline, runLimit);
    if (baseline.failed !== 0)
      return {
        outcome: "unguarded",
        message: `${rule.test} does not pass on the unchanged code; fix it first.\n${baseline.report}`,
      };
    const path = join(scratch, rule.file);
    writeFileSync(path, removeRule(readFileSync(path, "utf8"), rule));
    const mutated = runTest(root, scratch, rule.test, rule.browser === true, runLimit);
    if (mutated.stopped) return timedOut(rule.test, "on the copy without the rule", mutated, runLimit);
    if (mutated.failed === undefined)
      return {
        outcome: "unguarded",
        message: `${rule.test} did not run on the copy without the rule; the replacement may be invalid code.\n${mutated.report}`,
      };
    if (mutated.failed === 0)
      return {
        outcome: "unguarded",
        message: `${rule.test} passes without the rule: add a test that fails when "${rule.rule}" is broken.`,
      };
    return {
      outcome: "guarded",
      message: `${mutated.failed} ${mutated.failed === 1 ? "test fails" : "tests fail"} without the rule.`,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The labels of the outcomes in the report, of one width. */
const LABELS = { guarded: "guarded   ", unguarded: "UNGUARDED ", "timed-out": "TIMED OUT " } as const;

/** Checks every rule, or the rules of the given files, and returns the exit code: 1 when a rule is not guarded, 2 when none is not but a run timed out. */
function main(paths: readonly string[]): number {
  const root = resolve(dirname(import.meta.dirname));
  const rules = RULES.filter(({ file }) => paths.length === 0 || paths.some((path) => file.startsWith(path)));
  const counts = { guarded: 0, unguarded: 0, "timed-out": 0 };
  const passing = new Set<string>();
  for (const rule of rules) {
    const { outcome, message } = checkRule(root, rule, passing);
    counts[outcome] += 1;
    console.log(`${LABELS[outcome]}${rule.rule} ${message}`);
  }
  console.log(
    counts.guarded === rules.length
      ? `Every one of ${rules.length} rules is guarded.`
      : `${counts.guarded} of ${rules.length} rules are guarded, ${counts.unguarded} are not, and ${counts["timed-out"]} could not be judged because a run timed out.`,
  );
  if (counts.unguarded > 0) return 1;
  return counts["timed-out"] > 0 ? 2 : 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
