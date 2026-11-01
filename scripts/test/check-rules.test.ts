import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRule, failedTests, RULES, type Rule, removeRule } from "../check-rules.ts";

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

  it("answers undefined for a run that ran no tests, whether it reported them or not", () => {
    expect(failedTests("Error: Transform failed with 1 error")).toBeUndefined();
    expect(failedTests(" Test Files  1 failed (1)\n      Tests  no tests\n")).toBeUndefined();
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
      join(repository, "test/failing.test.ts"),
      'import { expect, it } from "vitest";\nit("fails", () => { expect(1).toBe(2); });\n',
    );
  });

  afterAll(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  it("reports a rule as guarded when its test fails without it", () => {
    const verdict = checkRule(repository, rule);
    expect(verdict).toStrictEqual({ guarded: true, message: "1 test fails without the rule." });
  });

  it("reports a rule as unguarded when its test still passes without it, and says what to add", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/weak.test.ts" });
    expect(verdict.guarded).toBe(false);
    expect(verdict.message).toContain(
      'passes without the rule: add a test that fails when "A limit is above 3." is broken.',
    );
  });

  it("reports a rule as unguarded when its test fails on the unchanged code", () => {
    const verdict = checkRule(repository, { ...rule, test: "test/failing.test.ts" });
    expect(verdict.guarded).toBe(false);
    expect(verdict.message).toContain("does not pass on the unchanged code");
  });

  it("reports a replacement that is not valid code, and not a guard", () => {
    const verdict = checkRule(repository, { ...rule, replace: "}{" });
    expect(verdict.guarded).toBe(false);
    expect(verdict.message).toContain("did not run on the copy without the rule");
  });
});
