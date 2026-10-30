import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFeatures } from "../features.ts";
import { type Inventory, loadInventory, parseInventory, TABLES } from "../inventory.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const row = {
  id: "A1",
  construct: "`qti-assessment-item`",
  source: "INFO §4.1",
  modules: ["asi"],
  evidence: ["R", "X"],
  unit: "OB4",
};
const inventory = (rows: readonly unknown[], merged: readonly string[] = ["OB1"]): unknown => ({
  units: ["OB1", "OB4"],
  merged,
  rows,
});

describe("the shipped inventory", () => {
  const shipped = loadInventory(resolve(ROOT, "conformance/olah-inventory.json"));

  it("numbers the rows of every table without gaps", () => {
    for (const { letter } of TABLES) {
      const numbers = shipped.rows.filter((r) => r.id.startsWith(letter)).map((r) => Number(r.id.slice(1)));
      expect(numbers.length, letter).toBeGreaterThan(0);
      expect(numbers, letter).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it("gives every row of a table that olah implements a unit, and every other row an owner", () => {
    const out: Inventory["rows"] = shipped.rows.filter((r) => "owner" in r);
    expect(out.map((r) => r.id).sort()).toEqual(
      ["C12", "C13", "J10", ...Array.from({ length: 15 }, (_, i) => `N${i + 1}`)].sort(),
    );
  });

  it("claims differential evidence for no row of a test session, as the oracle processes items only", () => {
    const differential = shipped.rows.filter(
      (r) =>
        "evidence" in r &&
        r.evidence.includes("D") &&
        r.modules.some((module) => module === "delivery" || module === "cat"),
    );
    // E10 is the session of an adaptive item, which the oracle runs.
    expect(differential.map((r) => r.id)).toEqual(["E10"]);
  });

  it("lists the features of CERT Appendix A and maps only rows that exist", () => {
    const features = loadFeatures(
      resolve(ROOT, "conformance/cert-features.json"),
      new Set(shipped.rows.map((r) => r.id)),
    );
    expect(features).toHaveLength(150);
    expect(features.find((feature) => feature.id === "T-4")?.levels).toEqual(["basic", "advanced"]);
  });
});

describe("parseInventory", () => {
  it("accepts rows that olah implements and rows it leaves to others", () => {
    const parsed = parseInventory(inventory([row, { id: "N1", construct: "Rendering", owner: "Item renderer" }]));
    expect(parsed.rows).toHaveLength(2);
  });

  it("rejects what is not an inventory", () => {
    expect(() => parseInventory(JSON.parse("[]"))).toThrow("must be an object with the arrays units, merged and rows");
  });

  it("reports every problem of the rows", () => {
    const bad = [
      row,
      { ...row },
      { ...row, id: "Z1" },
      { ...row, id: "A2", unit: "OB99" },
      { ...row, id: "A3", evidence: [] },
      { ...row, id: "A4", evidence: ["Q"] },
      { ...row, id: "A5", modules: [] },
      { ...row, id: "A6", construct: "" },
      { id: "N1", construct: "x", owner: "y", unit: "OB4" },
    ];
    expect(() => parseInventory(inventory(bad, ["OB1", "OB7"]))).toThrow(
      [
        "merged: OB7 is not one of the units.",
        "A1: the id occurs twice.",
        "Z1: id should be the letter of a table and a number.",
        "A2: unit should be one of the units.",
        "A3: evidence should be a non-empty array of R, X, S, P, D, C, N, V, U.",
        "A4: evidence should be a non-empty array of R, X, S, P, D, C, N, V, U.",
        "A5: modules should be a non-empty array of strings.",
        "A6: construct should be a non-empty string.",
        "N1: unit should be absent, as the row is out of scope.",
      ].join("\n- "),
    );
  });
});
