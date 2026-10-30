import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadAcceptedDifferences } from "../accepted.ts";
import { loadFeatures } from "../features.ts";

const directory = mkdtempSync(join(tmpdir(), "olah-conformance-"));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Writes JSON to a file of the temporary directory and returns its path. */
function file(name: string, data: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

const rows = new Set(["A1", "T1"]);
const feature = { id: "T-4", name: "Test Part", group: "tests", levels: ["basic"] };

describe("loadFeatures", () => {
  it("reads features, mapped or not", () => {
    const mapped = { ...feature, id: "T-5", capabilities: ["import", "delivery"], owner: "both", rows: ["A1"] };
    expect(loadFeatures(file("ok.json", { features: [feature, mapped] }), rows)).toEqual([feature, mapped]);
  });

  it("reports every problem", () => {
    const bad = [
      feature,
      feature,
      { ...feature, id: "T-6", group: "pages" },
      { ...feature, id: "T-7", levels: ["gold"] },
      { ...feature, id: "T-8", capabilities: ["print"], owner: "nobody" },
      { ...feature, id: "T-9", rows: ["A1", "Z9"] },
    ];
    expect(() => loadFeatures(file("bad.json", { features: bad }), rows)).toThrow(
      [
        "T-4: the id occurs twice.",
        "T-6: group should be one of tests, sections, items, interactions, accessibility, metadata, packaging.",
        "T-7: levels should be an array of basic, advanced, elevated-accessibility, pnp.",
        "T-8: capabilities should be an array of import, export, authoring, delivery, scoring.",
        "T-8: owner should be one of olah, tempuh, both.",
        "T-9: rows should be an array of inventory row identifiers.",
      ].join("\n- "),
    );
  });
});

describe("loadAcceptedDifferences", () => {
  it("reads the accepted differences", () => {
    const entry = { item: "choice.xml", variable: "SCORE", reason: "NULL gives NULL.", source: "INFO §2.11.1.5" };
    expect(loadAcceptedDifferences(file("accepted.json", [entry]))).toEqual([entry]);
    expect(loadAcceptedDifferences(file("none.json", []))).toEqual([]);
    const acceptance = { ...entry, variable: "" };
    expect(loadAcceptedDifferences(file("acceptance.json", [acceptance]))).toEqual([acceptance]);
  });

  it("rejects an entry without a field", () => {
    expect(() => loadAcceptedDifferences(file("bad-entry.json", [{ item: "choice.xml" }]))).toThrow(
      "[0]: variable should be a string.\n- [0]: reason should be a non-empty string.\n- [0]: source should be a non-empty string.",
    );
    expect(() => loadAcceptedDifferences(file("bad-list.json", {}))).toThrow("must be an array");
  });
});
