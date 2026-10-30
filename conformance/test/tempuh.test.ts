import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadInventory } from "../inventory.ts";
import { checkTempuhCoverage, loadTempuhInventory, TEMPUH_SCHEME } from "../tempuh.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const directory = mkdtempSync(join(tmpdir(), "tempuh-conformance-"));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Writes JSON to a file of the temporary directory and returns its path. */
function file(name: string, data: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

const OLAH_ROWS = new Set(["A1", "A2", "A3", "P3"]);
const row = {
  id: "T1",
  construct: "Bodies",
  olah: ["A1", "A2"],
  modules: ["player"],
  evidence: ["R", "A"],
  unit: "TB6",
};
const criterion = { id: "1.1.1", name: "Non-text Content", level: "A", part: "alt text", evidence: "axe", unit: "TB6" };
const inventory = (
  rows: readonly unknown[],
  criteria: readonly unknown[],
  merged: readonly string[] = ["TB1"],
): unknown => ({
  units: ["TB1", "TB6"],
  merged,
  rows,
  criteria,
});

describe("the shipped inventory", () => {
  const shipped = loadTempuhInventory(
    resolve(ROOT, "conformance/tempuh-inventory.json"),
    new Set(loadInventory(resolve(ROOT, "conformance/olah-inventory.json")).rows.map((r) => r.id)),
  );

  it("numbers the rows from T1 to T122 without gaps", () => {
    const numbers = shipped.inventory.rows.map((r) => Number(r.id.slice(1)));
    expect(numbers).toEqual(Array.from({ length: 122 }, (_, i) => i + 1));
  });

  it("gives every row a unit, except the host's T98 and the unsupported T107", () => {
    const out = shipped.inventory.rows.filter((r) => "owner" in r);
    expect(out.map((r) => r.id)).toEqual(["T98", "T107"]);
  });

  it("lists the 55 success criteria of WCAG 2.2 at levels A and AA: 31 at A and 24 at AA", () => {
    expect(shipped.criteria).toHaveLength(55);
    expect(shipped.criteria.filter(({ level }) => level === "A")).toHaveLength(31);
    expect(shipped.criteria.filter(({ level }) => level === "AA")).toHaveLength(24);
    expect(shipped.criteria.map(({ id }) => id)).not.toContain("4.1.1");
  });

  it("has merged TB1, TB2, TB3, TB13a, TB5, TB4, TB13c, TB6 and TB14, with their rows", () => {
    expect(shipped.inventory.merged).toEqual(["TB1", "TB2", "TB3", "TB13a", "TB5", "TB4", "TB13c", "TB6", "TB14"]);
    const rowsOf = (unit: string): string[] =>
      shipped.inventory.rows.filter((r) => "unit" in r && r.unit === unit).map((r) => r.id);
    expect(rowsOf("TB1")).toEqual(["T97"]);
    expect(rowsOf("TB2")).toEqual(["T13", "T87", "T88", "T89", "T90", "T91", "T116", "T117", "T118"]);
    expect(rowsOf("TB3")).toEqual(["T63", "T86", "T92", "T93", "T94"]);
    expect(rowsOf("TB13a")).toEqual(["T103", "T104", "T121"]);
    expect(rowsOf("TB5")).toEqual(["T9", "T10", "T11", "T16", "T85", "T115"]);
    expect(rowsOf("TB4")).toEqual(["T49", "T50", "T51", "T52", "T53"]);
    expect(rowsOf("TB13c")).toEqual(["T120"]);
    expect(rowsOf("TB6")).toEqual([
      ...["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T12", "T14", "T15"],
      ...["T17", "T18", "T19", "T20", "T21", "T22", "T23", "T24", "T25", "T95"],
    ]);
    expect(rowsOf("TB14")).toEqual(["T108", "T109", "T114"]);
  });
});

describe("loadTempuhInventory", () => {
  it("reads rows that cite olah's rows, and criteria of every kind", () => {
    const criteria = [
      criterion,
      { ...criterion, id: "1.3.3", unit: "TB6", manual: "review of the catalog" },
      { ...criterion, id: "1.2.4", unit: undefined, notApplicable: "no live media" },
    ];
    const loaded = loadTempuhInventory(
      file("ok.json", inventory([row, { ...row, id: "T2", olah: [] }], criteria)),
      OLAH_ROWS,
    );
    expect(loaded.inventory.rows).toHaveLength(2);
    expect(loaded.criteria.map(({ id, unit, manual, notApplicable }) => ({ id, unit, manual, notApplicable }))).toEqual(
      [
        { id: "1.1.1", unit: "TB6", manual: undefined, notApplicable: undefined },
        { id: "1.3.3", unit: "TB6", manual: "review of the catalog", notApplicable: undefined },
        { id: "1.2.4", unit: undefined, manual: undefined, notApplicable: "no live media" },
      ],
    );
  });

  it("expands the ranges of cited rows and rejects rows that olah does not have", () => {
    expect(() =>
      loadTempuhInventory(file("range.json", inventory([{ ...row, olah: ["A1–A3"] }], [])), OLAH_ROWS),
    ).not.toThrow();
    expect(() =>
      loadTempuhInventory(file("missing.json", inventory([{ ...row, olah: ["A1–A4", "Q1"] }], [])), OLAH_ROWS),
    ).toThrow(
      "T1: olah has A4, which is not in olah's inventory.\n- T1: olah has Q1, which is not in olah's inventory.",
    );
  });

  it("reports every problem of the rows", () => {
    const rows = [row, { ...row, id: "A9" }, { ...row, id: "T3", evidence: ["S"] }];
    expect(() => loadTempuhInventory(file("bad.json", inventory(rows, [])), OLAH_ROWS)).toThrow(
      [
        "A9: id should be the letter of a table and a number.",
        `T3: evidence should be a non-empty array of ${TEMPUH_SCHEME.evidence.join(", ")}.`,
      ].join("\n- "),
    );
  });

  it("reports the problems of the citations and of the criteria", () => {
    const criteria = [
      criterion,
      { ...criterion },
      { ...criterion, id: "1.4" },
      { ...criterion, id: "1.1.2", level: "AAA" },
      { ...criterion, id: "1.1.3", unit: "TB99" },
      { ...criterion, id: "1.1.4", notApplicable: "x" },
    ];
    const rows = [
      { ...row, id: "T4", olah: "A1" },
      { ...row, id: "T5", olah: ["D7 (olah)"] },
    ];
    expect(() => loadTempuhInventory(file("bad-criteria.json", inventory(rows, criteria)), OLAH_ROWS)).toThrow(
      [
        "T4: olah should be an array of olah's rows, empty for none.",
        "T5: olah has D7 (olah), which is not a row or a range of rows.",
        "1.1.1: the id occurs twice.",
        "1.4: id should be the number of a success criterion, such as 1.4.3.",
        "1.1.2: level should be A or AA.",
        "1.1.3: unit should be one of the units.",
        "1.1.4: unit should be absent, as the criterion does not apply.",
      ].join("\n- "),
    );
  });

  it("rejects criteria that are not an array", () => {
    expect(() => loadTempuhInventory(file("none.json", { units: ["TB1"], merged: [], rows: [] }), OLAH_ROWS)).toThrow(
      "criteria should be an array.",
    );
  });
});

describe("checkTempuhCoverage", () => {
  const loaded = loadTempuhInventory(
    file(
      "coverage.json",
      inventory(
        [row, { ...row, id: "T2", unit: "TB1" }, { ...row, id: "T3", unit: "TB1" }],
        [
          criterion,
          { ...criterion, id: "1.3.3", unit: "TB1", manual: "review of the catalog" },
          { ...criterion, id: "1.3.2", unit: "TB1" },
          { ...criterion, id: "1.3.1", unit: "TB1" },
          { ...criterion, id: "1.2.4", unit: undefined, notApplicable: "no live media" },
        ],
      ),
    ),
    OLAH_ROWS,
  );

  it("requires a test for every row and criterion of a merged unit that is not manual or inapplicable", () => {
    const coverage = checkTempuhCoverage(loaded, [{ file: "t.test.ts", ids: ["T2"], criteria: ["1.3.1"] }]);
    expect(coverage.missing).toEqual(["T3"]);
    expect(coverage.missingCriteria).toEqual(["1.3.2"]);
  });

  it("does not require tests for units that are not merged", () => {
    const coverage = checkTempuhCoverage(loaded, [
      { file: "t.test.ts", ids: ["T2", "T3"], criteria: ["1.3.1", "1.3.2"] },
    ]);
    expect(coverage).toEqual({ missing: [], unknown: [], missingCriteria: [], unknownCriteria: [] });
  });

  it("reports identifiers and criteria that the inventory does not have", () => {
    const coverage = checkTempuhCoverage(loaded, [
      { file: "t.test.ts", ids: ["T2", "T3", "T99"], criteria: ["1.3.1", "1.3.2", "9.9.9"] },
    ]);
    expect(coverage.unknown).toEqual([{ id: "T99", file: "t.test.ts" }]);
    expect(coverage.unknownCriteria).toEqual([{ criterion: "9.9.9", file: "t.test.ts" }]);
  });
});
