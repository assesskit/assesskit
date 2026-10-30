import { describe, expect, it } from "vitest";
import { checkCoverage, criterionTags, rowTags, testTitles } from "../coverage.ts";
import { parseInventory } from "../inventory.ts";

const scoped = (id: string, unit: string): object => ({ id, construct: id, modules: ["asi"], evidence: ["S"], unit });
const inventory = parseInventory({
  units: ["OB1", "OB4", "OB5"],
  merged: ["OB1", "OB4"],
  rows: [scoped("A1", "OB4"), scoped("A2", "OB4"), scoped("A3", "OB5"), { id: "N1", construct: "x", owner: "y" }],
});

describe("testTitles", () => {
  it("returns the titles of tests and suites, however they are chained", () => {
    const text = `
      describe("suite", () => {
        it("plain", () => {});
        test("test", () => {});
        it.skipIf(flag)("conditional", () => {});
        it.each(table)("each %s", () => {});
        it.concurrent(\`template\`, () => {});
      });`;
    expect(testTitles("a.test.ts", text)).toEqual(["suite", "plain", "test", "conditional", "each %s", "template"]);
  });

  it("leaves out skipped tests, todo tests and titles that are not literals", () => {
    const text = `
      it.skip("skipped", () => {});
      describe.skip("skipped suite", () => {});
      it.todo("todo");
      it(name, () => {});
      it(\`built \${name}\`, () => {});
      other("not a test", () => {});`;
    expect(testTitles("a.test.ts", text)).toEqual([]);
  });

  it("ignores row tags in comments and strings that are not titles", () => {
    const text = `// [A1] in a comment\nconst note = "[A2]";\nit("[A3] real", () => { expect("[A4]").toBe("[A4]"); });`;
    expect(testTitles("a.test.ts", text).flatMap(rowTags)).toEqual(["A3"]);
  });
});

describe("rowTags", () => {
  it("returns the identifiers in brackets", () => {
    expect(rowTags("[A79] equal: tolerance")).toEqual(["A79"]);
    expect(rowTags("[A79][B12] both")).toEqual(["A79", "B12"]);
    expect(rowTags("[U] unverified, [a1], [A0], A1, [12]")).toEqual([]);
  });
});

describe("checkCoverage", () => {
  it("requires a test for every row of a merged unit", () => {
    expect(checkCoverage(inventory, [{ file: "t.test.ts", ids: ["A1"], criteria: [] }]).missing).toEqual(["A2"]);
  });

  it("does not require tests for rows of units that are not merged or for out-of-scope rows", () => {
    expect(checkCoverage(inventory, [{ file: "t.test.ts", ids: ["A1", "A2"], criteria: [] }]).missing).toEqual([]);
  });

  it("accepts tests that name rows of units that are not merged", () => {
    const coverage = checkCoverage(inventory, [{ file: "t.test.ts", ids: ["A1", "A2", "A3"], criteria: [] }]);
    expect(coverage).toEqual({ missing: [], unknown: [] });
  });

  it("reports identifiers that the inventory does not have", () => {
    const coverage = checkCoverage(inventory, [{ file: "t.test.ts", ids: ["A1", "A2", "A99"], criteria: [] }]);
    expect(coverage.unknown).toEqual([{ id: "A99", file: "t.test.ts" }]);
  });
});

describe("criterionTags", () => {
  it("returns the criteria in brackets", () => {
    expect(criterionTags("[SC 1.4.3] contrast")).toEqual(["1.4.3"]);
    expect(criterionTags("[T97][SC 3.2.4][SC 2.5.8] both")).toEqual(["3.2.4", "2.5.8"]);
    expect(criterionTags("[SC 1.4] [SC 1.4.3.1] [sc 1.4.3] [1.4.3] SC 1.4.3")).toEqual([]);
  });

  it("is not read as a row", () => {
    expect(rowTags("[SC 3.2.4] a catalog")).toEqual([]);
  });
});
