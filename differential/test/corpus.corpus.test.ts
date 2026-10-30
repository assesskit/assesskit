import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../scripts/corpus.ts";
import { corpusCases, longsight } from "../src/index.ts";

const items = resolve(
  requireCorpus(resolve(import.meta.dirname, "../..")),
  "qti-examples/qtiv3-examples/packaging/items",
);

describe("the oracle on the corpus items", () => {
  const cases = corpusCases(items);

  it("builds cases from the items of the packages", () => {
    expect(cases.length).toBeGreaterThan(90);
  });

  it("accepts or rejects every case with a reason, and repeats what it accepts", () => {
    for (const testCase of cases) {
      const first = longsight.run(testCase);
      if (first.accepted) expect(longsight.run(testCase), testCase.name).toEqual(first);
      else expect(first.reason, testCase.name).not.toBe("");
    }
  });
});
