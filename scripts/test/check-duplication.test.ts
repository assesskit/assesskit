import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Clone, clonesOf, findClones, judge, readRepeats } from "../check-duplication.ts";

const ROOT = join(import.meta.dirname, "../..");
const AGENTS = `# AGENTS.md

## Repeats left on purpose

Text.

| Repeat | Where | Why it stays |
| ------ | ----- | ------------ |
| Option checks | \`core/{answer,json}.ts\`, \`a/b/c.ts\` | Three lines |
| One file | \`a/own.ts\` | Twice in a file |

## Next section

| Not | A | Row |
`;

/** A function of more than 40 tokens and 4 lines, whose name is a parameter. */
const body = (name: string): string =>
  `export function ${name}(values: readonly number[]): number {\n  let total = 0;\n  for (const value of values) {\n    if (value > 0) total += value * 2;\n    else total -= value / 3;\n  }\n  return total + values.length;\n}\n`;

describe("readRepeats", () => {
  it("reads the files of each row of the table under the heading, with the braces of a folder expanded", () => {
    const repeats = readRepeats(AGENTS);
    expect(repeats.map(({ name }) => name)).toStrictEqual(["Option checks", "One file"]);
    expect([...(repeats[0]?.files ?? [])]).toStrictEqual(["core/answer.ts", "core/json.ts", "a/b/c.ts"]);
  });

  it("refuses a file without the section and a section without rows", () => {
    expect(() => readRepeats("# Nothing\n")).toThrow('no section "## Repeats left on purpose"');
    expect(() => readRepeats("## Repeats left on purpose\n\n| A | B | C |\n| - | - | - |\n")).toThrow("has no rows");
  });

  it("reads the table of the repository", () => {
    const repeats = readRepeats(readFileSync(join(ROOT, "AGENTS.md"), "utf8"));
    expect(repeats.length).toBeGreaterThan(0);
    for (const { name, files } of repeats) {
      expect(files.size, name).toBeGreaterThan(0);
      for (const file of files) expect(file, name).toMatch(/^[a-z-]+\/.+\.ts$/u);
    }
  });
});

describe("clonesOf", () => {
  const packages = "/work/packages";
  const clone = (first: string, second: string, lines: number) => ({
    firstFile: { name: `${packages}/${first}` },
    secondFile: { name: `${packages}/${second}` },
    lines,
  });

  it("names a file by its package and its path below src, and keeps the longest clone of a pair once", () => {
    const report = JSON.stringify({
      duplicates: [
        clone("b/src/x/y.ts", "a/src/x/y.ts", 5),
        clone("a/src/x/y.ts", "b/src/x/y.ts", 9),
        clone("a/src/own.ts", "a/src/own.ts", 6),
      ],
    });
    expect(clonesOf(report, packages)).toStrictEqual([
      { files: ["a/own.ts"], lines: 6 },
      { files: ["a/x/y.ts", "b/x/y.ts"], lines: 9 },
    ]);
  });
});

describe("judge", () => {
  const repeats = readRepeats(AGENTS);
  const clones: Clone[] = [
    { files: ["core/answer.ts", "core/json.ts"], lines: 7 },
    { files: ["a/b/c.ts", "core/json.ts"], lines: 5 },
    { files: ["a/own.ts"], lines: 6 },
  ];

  it("passes when a row holds the files of every clone and every file of a row repeats", () => {
    expect(judge([...clones, { files: ["a/b/c.ts", "core/answer.ts"], lines: 4 }], repeats)).toStrictEqual([]);
  });

  it("names a clone that no row holds, and says what to do", () => {
    const problems = judge([...clones, { files: ["a/own.ts", "z/new.ts"], lines: 8 }], repeats);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("a/own.ts and z/new.ts repeat 8 lines that no row");
    expect(problems[0]).toContain("merge them into a helper");
  });

  it("names a clone within one file that no row holds", () => {
    expect(judge([{ files: ["z/own.ts"], lines: 5 }], repeats)[0]).toContain("z/own.ts twice repeat 5 lines");
  });

  it("names a file of a row that repeats nothing now, so that a merged repeat leaves the table", () => {
    const problems = judge(clones.slice(0, 2), repeats);
    expect(problems).toStrictEqual([
      'a/own.ts is in the row "One file" of "Repeats left on purpose" and repeats nothing now: take it out of the row.',
    ]);
  });

  it("does not list a clone whose files are in two rows but in no one row", () => {
    expect(judge([{ files: ["a/own.ts", "core/answer.ts"], lines: 4 }], repeats)).not.toStrictEqual([]);
  });
});

describe("findClones", () => {
  let repository = "";

  beforeAll(() => {
    repository = mkdtempSync(join(tmpdir(), "assesskit-duplication-test-"));
    const files: Readonly<Record<string, string>> = {
      "packages/a/src/one.ts": body("sumOfFirst"),
      "packages/b/src/folder/two.ts": body("sumOfSecond"),
      "packages/b/src/other.ts": "export const other = (n: number): string => String(n).padStart(4, '0');\n",
      "packages/a/test/skipped.ts": body("sumOfThird"),
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repository, path)), { recursive: true });
      writeFileSync(join(repository, path), text);
    }
  });

  afterAll(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  it("finds a clone across two packages by the names of the table, and leaves tests out", () => {
    const found = findClones(repository, join(ROOT, "node_modules/.bin/jscpd"));
    expect(found.map(({ files }) => files)).toStrictEqual([["a/one.ts", "b/folder/two.ts"]]);
  });
});
