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
import { PLAYER_RULES } from "./rules/player.ts";
import { REPOSITORY_RULES } from "./rules/repository.ts";
import type { Rule } from "./rules/rule.ts";
import { RUNTIME_RULES } from "./rules/runtime.ts";

export type { Rule };

/**
 * The security-critical rules of the player, of the runtime and of the CAT binding, and the rule that keeps member-only material
 * out of the repository, each with the test that guards it.
 */
export const RULES: readonly Rule[] = [...PLAYER_RULES, ...RUNTIME_RULES, ...CAT_REST_RULES, ...REPOSITORY_RULES];

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

/** What checking one rule found. */
export interface Verdict {
  readonly guarded: boolean;
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

/** Runs one test file of a copy with Vitest and returns what it reported. */
function runTest(
  root: string,
  scratch: string,
  test: string,
  browser: boolean,
): { readonly failed: number | undefined; readonly report: string } {
  const vitest = join(root, "node_modules/vitest/vitest.mjs");
  const limit = `--testTimeout=${browser ? BROWSER_TEST_TIMEOUT_MS : TEST_TIMEOUT_MS}`;
  const where = browser ? ["--project", "player-browser"] : [];
  const run = spawnSync(process.execPath, [vitest, "run", "--maxWorkers=2", limit, ...where, test], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", BROWSERS: "chromium" },
    timeout: 300_000,
  });
  const report = `${run.stdout}${run.stderr}`;
  return { failed: failedTests(report), report };
}

/**
 * Checks that the test of a rule passes on the code, and fails on a copy of the code without the rule.
 *
 * @param root - The repository.
 * @param rule - The rule.
 * @param passing - The test files that already passed on the unchanged code, which a run of many rules does not run again.
 */
export function checkRule(root: string, rule: Rule, passing: Set<string> = new Set()): Verdict {
  const scratch = mkdtempSync(join(tmpdir(), "assesskit-rule-"));
  try {
    copyRepository(root, scratch);
    const baseline = passing.has(rule.test)
      ? { failed: 0, report: "" }
      : runTest(root, scratch, rule.test, rule.browser === true);
    if (baseline.failed === 0) passing.add(rule.test);
    if (baseline.failed !== 0)
      return {
        guarded: false,
        message: `${rule.test} does not pass on the unchanged code; fix it first.\n${baseline.report}`,
      };
    const path = join(scratch, rule.file);
    writeFileSync(path, removeRule(readFileSync(path, "utf8"), rule));
    const mutated = runTest(root, scratch, rule.test, rule.browser === true);
    if (mutated.failed === undefined)
      return {
        guarded: false,
        message: `${rule.test} did not run on the copy without the rule; the replacement may be invalid code.\n${mutated.report}`,
      };
    if (mutated.failed === 0)
      return {
        guarded: false,
        message: `${rule.test} passes without the rule: add a test that fails when "${rule.rule}" is broken.`,
      };
    return {
      guarded: true,
      message: `${mutated.failed} ${mutated.failed === 1 ? "test fails" : "tests fail"} without the rule.`,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Checks every rule, or the rules of the given files, and returns the exit code. */
function main(paths: readonly string[]): number {
  const root = resolve(dirname(import.meta.dirname));
  const rules = RULES.filter(({ file }) => paths.length === 0 || paths.some((path) => file.startsWith(path)));
  let unguarded = 0;
  const passing = new Set<string>();
  for (const rule of rules) {
    const { guarded, message } = checkRule(root, rule, passing);
    if (!guarded) unguarded += 1;
    console.log(`${guarded ? "guarded  " : "UNGUARDED"} ${rule.rule} ${message}`);
  }
  console.log(
    unguarded === 0 ? `Every one of ${rules.length} rules is guarded.` : `${unguarded} rules are not guarded.`,
  );
  return unguarded === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
