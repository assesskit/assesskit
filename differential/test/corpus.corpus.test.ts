import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAcceptedDifferences } from "../../conformance/accepted.ts";
import { requireCorpus } from "../../scripts/corpus.ts";
import { compare, corpusCases, longsight, olah } from "../src/index.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(requireCorpus(root), "qti-examples/qtiv3-examples");
const accepted = loadAcceptedDifferences(resolve(root, "conformance/accepted-differences.json"));

describe("the oracle on the corpus items", () => {
  const cases = corpusCases(examples);

  it("builds cases from every item of the examples, named by their paths", () => {
    expect(cases.length).toBeGreaterThan(400);
    expect(cases.map(({ name }) => name)).toContain("packaging/items/choice.xml (correct responses)");
  });

  it("accepts or rejects every case with a reason, and repeats what it accepts", () => {
    for (const testCase of cases) {
      const first = longsight.run(testCase);
      if (first.accepted) expect(longsight.run(testCase), testCase.name).toEqual(first);
      else expect(first.reason, testCase.name).not.toBe("");
    }
  });
});

describe("olah against the oracle on the corpus items", () => {
  const cases = corpusCases(examples);
  const report = compare(cases, longsight, olah, accepted);
  const names = new Set(cases.map(({ name }) => name));

  it("[B11][B45][B47][B48][B76][B77][B84][D] gives the outcome and template values of the oracle on every item both accept", () => {
    expect(report.differences).toEqual([]);
    expect(report.compared).toBe(446);
  });

  it("[D] differs only as the accepted differences say, each of which still applies", () => {
    const applying = accepted.filter(({ item }) => names.has(item)).map(({ item }) => item);
    expect(report.accepted.map(({ item }) => item).sort()).toEqual(applying.sort());
  });
});
