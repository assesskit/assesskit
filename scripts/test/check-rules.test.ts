import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkRule, failedTests, RULES, type Rule, removeRule, timedOutTests } from "../check-rules.ts";

const ROOT = join(import.meta.dirname, "../..");
const rule: Rule = {
  rule: "A limit is above 3.",
  file: "src/limit.ts",
  find: "n > 3",
  replace: "false",
  test: "test/guarded.test.ts",
};

describe("the rules of the repository", () => {
  it("each find a text that occurs once in a file, and name a test file that exists", () => {
    for (const entry of RULES) {
      expect(() => removeRule(readFileSync(join(ROOT, entry.file), "utf8"), entry), entry.rule).not.toThrow();
      expect(() => readFileSync(join(ROOT, entry.test)), entry.rule).not.toThrow();
    }
  });

  it("change their file when they are removed", () => {
    for (const entry of RULES) {
      const source = readFileSync(join(ROOT, entry.file), "utf8");
      expect(removeRule(source, entry), entry.rule).not.toBe(source);
    }
  });
});

describe("removeRule", () => {
  it("replaces the one occurrence of the text", () => {
    expect(removeRule("export const f = (n: number) => n > 3;", rule)).toBe("export const f = (n: number) => false;");
  });

  it("refuses a text that does not occur or occurs twice, and says how often", () => {
    expect(() => removeRule("const a = 1;", rule)).toThrow('holds "n > 3" 0 times');
    expect(() => removeRule("n > 3; n > 3;", rule)).toThrow('holds "n > 3" 2 times');
  });

  it("inserts the replacement as it is, whatever characters it holds", () => {
    expect(removeRule("n > 3", { ...rule, replace: "$&$1" })).toBe("$&$1");
  });
});

describe("failedTests", () => {
  it("reads the number of failed tests from the summary of a run", () => {
    expect(failedTests(" Test Files  1 failed (1)\n      Tests  2 failed | 38 passed (40)\n")).toBe(2);
    expect(failedTests(" Test Files  1 passed (1)\n      Tests  40 passed (40)\n")).toBe(0);
  });

  it("counts the tests that never finished and the errors of the run as failures, as a crashed worker leaves them", () => {
    expect(failedTests(" Test Files   (1)\n      Tests  29 passed (80)\n     Errors  1 error\n")).toBe(52);
    expect(failedTests(" Test Files  1 passed (1)\n      Tests  3 passed | 1 skipped (4)\n")).toBe(0);
    expect(failedTests(" Test Files  1 passed (1)\n      Tests  4 passed (4)\n     Errors  2 errors\n")).toBe(2);
  });

  it("answers undefined for a run that ran no tests, whether it reported them or not", () => {
    expect(failedTests("Error: Transform failed with 1 error")).toBeUndefined();
    expect(failedTests(" Test Files  1 failed (1)\n      Tests  no tests\n")).toBeUndefined();
  });
});

describe("timedOutTests", () => {
  it("counts the tests and the hooks that ran out of time", () => {
    const report =
      " FAIL a\nError: Test timed out in 30000ms.\n FAIL b\nError: Hook timed out in 10000ms.\n FAIL c\nError: x\n";
    expect(timedOutTests(report)).toBe(2);
    expect(timedOutTests(" Test Files  1 passed (1)\n      Tests  3 passed (3)\n")).toBe(0);
  });

  it("counts a test once when the message is printed again outside its block, as the reporter of GitHub Actions does", () => {
    const report =
      " FAIL a\nError: Test timed out in 50ms.\n\n::error file=a.test.ts,title=a::Error: Test timed out in 50ms.\n";
    expect(timedOutTests(report)).toBe(1);
  });
});

describe("checkRule", () => {
  let repository = "";

  beforeAll(() => {
    repository = mkdtempSync(join(tmpdir(), "assesskit-rules-test-"));
    mkdirSync(join(repository, "src"));
    mkdirSync(join(repository, "test"));
    symlinkSync(join(ROOT, "node_modules"), join(repository, "node_modules"));
    writeFileSync(
      join(repository, "vitest.config.ts"),
      'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n',
    );
    writeFileSync(join(repository, "src/limit.ts"), "export const above = (n: number): boolean => n > 3;\n");
    writeFileSync(
      join(repository, "test/guarded.test.ts"),
      'import { expect, it } from "vitest";\nimport { above } from "../src/limit.ts";\nit("is above 3", () => { expect(above(4)).toBe(true); });\n',
    );
    writeFileSync(
      join(repository, "test/weak.test.ts"),
      'import { expect, it } from "vitest";\nimport { above } from "../src/limit.ts";\nit("answers a boolean", () => { expect(typeof above(4)).toBe("boolean"); });\n',
    );
    writeFileSync(
      join(repository, "test/slow.test.ts"),
      'import { it } from "vitest";\nit("runs out of time", () => new Promise(() => undefined), 50);\n',
    );
    writeFileSync(
      join(repository, "test/mixed.test.ts"),
      'import { expect, it } from "vitest";\nit("runs out of time", () => new Promise(() => undefined), 50);\nit("fails", () => { expect(1).toBe(2); });\n',
    );
    writeFileSync(
      join(repository, "test/hangs.test.ts"),
      'import { expect, it } from "vitest";\nimport { above } from "../src/limit.ts";\nit("is above 3", async () => { if (!above(4)) await new Promise((resolve) => setTimeout(resolve, 120_000)); expect(true).toBe(true); }, 180_000);\n',
    );
    writeFileSync(
      join(repository, "test/stuck.test.ts"),
      'import { it } from "vitest";\nit("never ends", async () => { await new Promise((resolve) => setTimeout(resolve, 120_000)); }, 180_000);\n',
    );
    writeFileSync(
      join(repository, "test/loud.test.ts"),
      'import { expect, it } from "vitest";\nimport { above } from "../src/limit.ts";\nit("is above 3", () => { if (!above(4)) console.log("x".repeat(2_000_000)); expect(above(4)).toBe(true); });\n',
    );
    writeFileSync(
      join(repository, "test/failing.test.ts"),
      'import { expect, it } from "vitest";\nit("fails", () => { expect(1).toBe(2); });\n',
    );
  });

  afterAll(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports a rule as guarded when its test fails without it", () => {
    const verdict = checkRule(repository, rule);
    expect(verdict).toStrictEqual({ outcome: "guarded", message: "1 test fails without the rule." });
  });

  it("reads the verdict of a run that prints more than 1 MiB, as many failures with long messages do", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/loud.test.ts" });
    expect(verdict).toStrictEqual({ outcome: "guarded", message: "1 test fails without the rule." });
  });

  it("reports a rule as unguarded when its test still passes without it, and says what to add", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/weak.test.ts" });
    expect(verdict.outcome).toBe("unguarded");
    expect(verdict.message).toContain(
      'passes without the rule: add a test that fails when "A limit is above 3." is broken.',
    );
  });

  it("reports a rule as unguarded when its test fails on the unchanged code", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/failing.test.ts" });
    expect(verdict.outcome).toBe("unguarded");
    expect(verdict.message).toContain("does not pass on the unchanged code");
  });

  it("reports a test that runs out of time on the unchanged code as a timeout, and not as an unguarded rule", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/slow.test.ts" });
    expect(verdict.outcome).toBe("timed-out");
    expect(verdict.message).toContain("test/slow.test.ts has 1 test that ran out of time on the unchanged code");
  });

  it("counts the same in the environment of GitHub Actions, whose reporter prints a failure twice", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const verdict = checkRule(repository, { ...rule, test: "test/slow.test.ts" });
    expect(verdict.outcome).toBe("timed-out");
    expect(verdict.message).toContain("test/slow.test.ts has 1 test that ran out of time on the unchanged code");
  });

  it("reports a test that fails beside one that runs out of time as a rule that is not guarded, in that environment too", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const verdict = checkRule(repository, { ...rule, test: "test/mixed.test.ts" });
    expect(verdict.outcome).toBe("unguarded");
    expect(verdict.message).toContain("does not pass on the unchanged code");
  });

  it("reports a run that is stopped at its limit on the unchanged code as a timeout", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/stuck.test.ts" }, new Set(), 2000);
    expect(verdict.outcome).toBe("timed-out");
    expect(verdict.message).toContain("test/stuck.test.ts was stopped after 2 s on the unchanged code");
  }, 30_000);

  it("reports a run that is stopped at its limit on the copy without the rule as a timeout", () => {
    const verdict = checkRule(
      repository,
      { ...rule, test: "test/hangs.test.ts" },
      new Set(["test/hangs.test.ts"]),
      2000,
    );
    expect(verdict.outcome).toBe("timed-out");
    expect(verdict.message).toContain("test/hangs.test.ts was stopped after 2 s on the copy without the rule");
  }, 30_000);

  it("reports a replacement that is not valid code, and not a guard", () => {
    const verdict = checkRule(repository, { ...rule, replace: "}{" });
    expect(verdict.outcome).toBe("unguarded");
    expect(verdict.message).toContain("did not run on the copy without the rule");
  });
});
