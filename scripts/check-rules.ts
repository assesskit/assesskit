// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the entries quote source code, which holds template strings.
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

/**
 * A rule of the code that a test must guard. Replacing `find` with `replace` in `file` removes the rule and leaves valid
 * code, and the test file `test` must then fail: a test that still passes does not guard the rule.
 */
export interface Rule {
  /** What the rule says, as a sentence. */
  readonly rule: string;
  /** The source file that holds the rule, relative to the repository root. */
  readonly file: string;
  /** The text of the file that implements the rule. It occurs once. */
  readonly find: string;
  /** The text that stands in its place without the rule, and does the rest. */
  readonly replace: string;
  /** The test file that guards the rule, relative to the repository root. */
  readonly test: string;
  /** Whether the test runs in a browser: it then runs in Chromium alone, and the run needs the browser installed. */
  readonly browser?: boolean;
}

/** The security-critical rules of the player, each with the test that guards it. */
export const RULES: readonly Rule[] = [
  {
    rule: "A page, a drawing or a script of a package is served in a sandbox, so that a hostile package runs no script on the asset origin.",
    file: "packages/player/src/server/gate/gate.ts",
    find: "const headers = type === PDF_TYPE ? BASE_HEADERS : SANDBOXED_HEADERS;",
    replace: "const headers = BASE_HEADERS;",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A page of a package that a browser opens as a document runs no script.",
    file: "packages/player/src/server/gate/gate.ts",
    find: "const headers = type === PDF_TYPE ? BASE_HEADERS : SANDBOXED_HEADERS;",
    replace: "const headers = BASE_HEADERS;",
    test: "packages/player/test/exam.browser.test.ts",
    browser: true,
  },
  {
    rule: "A file of a candidate is served in a sandbox.",
    file: "packages/player/src/server/gate/gate.ts",
    find: 'headers: { ...SANDBOXED_HEADERS, "Content-Type": mimeType }',
    replace: 'headers: { ...BASE_HEADERS, "Content-Type": mimeType }',
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A request outside the prefix of its token is refused.",
    file: "packages/player/src/server/gate/gate.ts",
    find: "if (path === undefined || !path.startsWith(prefix)) return refused(403);",
    replace: "if (path === undefined) return refused(403);",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A token that has expired is refused.",
    file: "packages/player/src/server/gate/gate.ts",
    find: " && now <= expires ? claims : undefined",
    replace: " ? claims : undefined",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A token of a file serves the one file that it names.",
    file: "packages/player/src/server/gate/gate.ts",
    find: "if (named !== reference) return refused(403);",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A file with an extension that is not a web asset is not served, which keeps every QTI document out by its type.",
    file: "packages/player/src/server/gate/gate.ts",
    find: "bytes === undefined || type === undefined || ",
    replace: "bytes === undefined || ",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A document that the manifest declares as QTI, and the files that it includes, are not served.",
    file: "packages/player/src/server/gate/gate.ts",
    find: "deniedPaths(pkg).has(path) || ",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A file that holds QTI data is not served under the name of a web asset.",
    file: "packages/player/src/server/gate/gate.ts",
    find: " || isQtiData(bytes)",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "The sniff for QTI data reads the namespaces of QTI.",
    file: "packages/player/src/server/gate/deny.ts",
    find: " || NAMESPACE_MARKERS.some((marker) => text.includes(marker))",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "The sniff for QTI data skips white space of any length before the bytes it reads.",
    file: "packages/player/src/server/gate/deny.ts",
    find: "XML_SPACE.has(width === 1 ? (bytes[offset] ?? 0) : unit(offset))",
    replace: "false",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "The sniff for QTI data tells UTF-16 without a byte order mark by the zero byte.",
    file: "packages/player/src/server/gate/deny.ts",
    find: 'if (first !== undefined && first !== 0 && second === 0) return "utf-16le";',
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A request for a session that is not bound to the principal is refused.",
    file: "packages/player/src/server/host.ts",
    find: "if (stored?.principal !== caller.principal) throw notBound();",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A request is applied only for the principal that the session is bound to, inside the save.",
    file: "packages/player/src/server/host.ts",
    find: "if (stored.principal !== caller.principal) throw notBound();",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "An action of a client is checked against the policy of actions.",
    file: "packages/player/src/server/host.ts",
    find: "checkClientAction(policy, action.type);",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A client of an exam may not suspend or resume.",
    file: "packages/player/src/server/policy.ts",
    find: '(type) => type !== "suspend" && type !== "resume",',
    replace: "() => true,",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A stale sequence number is refused.",
    file: "packages/player/src/server/host.ts",
    find: "if (envelope.seq < stored.seq) {",
    replace: "if (false) {",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A repeated sequence number gets the answer already given.",
    file: "packages/player/src/server/host.ts",
    find: "if (envelope.seq === stored.seq) return { result: await replay(caller.session, stored, now, signal) };",
    replace: "",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A step of the host never waits for a running answer loop, which could wait for the step.",
    file: "packages/player/src/server/host.ts",
    find: "cat === undefined || loops.wake(session)",
    replace: "cat === undefined",
    test: "packages/player/test/server.test.ts",
  },
  {
    rule: "A loop that a step joined after its last read reads the pending work once more before it ends.",
    file: "packages/player/src/protocol/answer-cat-requests.ts",
    find: "if (marks.dirty) continue;",
    replace: "",
    test: "packages/player/test/protocol.test.ts",
  },
  {
    rule: "A frame of a portable custom interaction has an opaque origin: it may run script and nothing else.",
    file: "packages/player/src/player/pci/host.ts",
    find: 'frame.setAttribute("sandbox", "allow-scripts");',
    replace: 'frame.setAttribute("sandbox", "allow-scripts allow-same-origin");',
    test: "packages/player/test/pci.browser.test.ts",
    browser: true,
  },
  {
    rule: "A message from a window other than the frame of the interaction is ignored.",
    file: "packages/player/src/player/pci/host.ts",
    find: "if (event.source !== frame.contentWindow) return;",
    replace: "",
    test: "packages/player/test/pci.browser.test.ts",
    browser: true,
  },
  {
    rule: "The frame of a portable custom interaction may open no connection.",
    file: "packages/player/src/player/pci/csp.ts",
    find: `"connect-src 'none'",`,
    replace: `"connect-src *",`,
    test: "packages/player/test/pci.test.ts",
  },
  {
    rule: "A message of an LTI frame that comes from an opaque origin is ignored.",
    file: "packages/player/src/player/lti-frame/frame.ts",
    find: ' || event.origin === "null"',
    replace: "",
    test: "packages/player/test/lti-frame.browser.test.ts",
    browser: true,
  },
  {
    rule: "A message from a window other than the frame of the tool is ignored.",
    file: "packages/player/src/player/lti-frame/frame.ts",
    find: "event.source !== target || ",
    replace: "",
    test: "packages/player/test/lti-frame.browser.test.ts",
    browser: true,
  },
  {
    rule: "A tool of an LTI item is never loaded from the origin of the player or of the asset gate.",
    file: "packages/player/src/player/lti-frame/frame.ts",
    find: "if (refused.includes(origin)) {",
    replace: "if (false) {",
    test: "packages/player/test/lti-frame.browser.test.ts",
    browser: true,
  },
];

/** The folders that a scratch copy leaves out: generated output and installed packages, which it links instead. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage", ".cache", ".vitest"]);
/** The generated API reference, which no test reads. */
const API_DOCS = "docs/api";
/** The longest a test of a mutated copy may take, in milliseconds: a removed deadline makes a test wait for ever. */
const TEST_TIMEOUT_MS = 5_000;
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

/** Returns the number of failed tests in the report of a Vitest run, or `undefined` when the run did not run tests. */
export function failedTests(report: string): number | undefined {
  const summary = /^\s*Tests\s+(.*)$/m.exec(report)?.[1];
  if (summary === undefined || !/\d+ (?:failed|passed)/.test(summary)) return undefined;
  return Number(/(\d+) failed/.exec(summary)?.[1] ?? 0);
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
