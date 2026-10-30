import { describe, expect, it } from "vitest";
import { parseInventory } from "../inventory.ts";
import { renderMatrix } from "../matrix.ts";

const inventory = parseInventory({
  units: ["OB1", "OB2"],
  merged: ["OB1"],
  rows: [
    { id: "T1", construct: "`a|b`", source: "INFO §8.13", modules: ["values"], evidence: ["S", "P"], unit: "OB2" },
    { id: "N1", construct: "Rendering", owner: "Item renderer: tempuh (browser)" },
  ],
});
const input = {
  inventory,
  features: [
    { id: "T-4", name: "Test Part", group: "tests", levels: ["basic", "advanced"] },
    { id: "T-3", name: "Stylesheet", group: "tests", levels: [], owner: "olah", rows: ["T1"] },
  ],
  accepted: [],
  references: [
    { file: "packages/olah/test/values.test.ts", ids: ["T1"], criteria: [] },
    { file: "differential/test/items.test.ts", ids: ["T1"], criteria: [] },
  ],
  directory: "packages/olah/docs",
} as const;

describe("renderMatrix", () => {
  const document = renderMatrix(input);

  it("renders a row with its evidence, unit and links to the tests that name it", () => {
    expect(document).toContain(
      "| T1 | `a\\|b` | INFO §8.13 | values | S P | OB2 | [items.test.ts](../../../differential/test/items.test.ts), [values.test.ts](../test/values.test.ts) |",
    );
  });

  it("lists the units with their status and the rows of each", () => {
    expect(document).toContain("| OB1 | merged | 0 |");
    expect(document).toContain("| OB2 | pending | 1 |");
  });

  it("lists the features with their levels, and elective ones as such", () => {
    expect(document).toContain("| T-4 | Test Part | Basic, Advanced |  |  |  |");
    expect(document).toContain("| T-3 | Stylesheet | elective |  | olah | T1 |");
  });

  it("lists the rows that are out of scope with their owner, and states that no difference is accepted", () => {
    expect(document).toContain("| N1 | Rendering |  | Item renderer: tempuh (browser) |");
    expect(document).toContain(
      "## Accepted differences\n\nDifferences between olah and Longsight qti3-core that the specification settles.\n\nNone.",
    );
  });

  it("lists accepted differences", () => {
    const accepted = [{ item: "choice.xml", variable: "SCORE", reason: "NULL gives NULL.", source: "INFO §2.11.1.5" }];
    expect(renderMatrix({ ...input, accepted })).toContain(
      "| choice.xml | SCORE | NULL gives NULL. | INFO §2.11.1.5 |",
    );
  });

  it("renders the same document for the same input", () => {
    expect(renderMatrix(input)).toBe(document);
  });
});
