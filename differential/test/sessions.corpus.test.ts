import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAcceptedDifferences } from "../../conformance/accepted.ts";
import { requireCorpus } from "../../scripts/corpus.ts";
import { compareSessions, longsight, olah, SESSION_TURNS, sessionCases } from "../src/index.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(requireCorpus(root), "qti-examples/qtiv3-examples");
const accepted = loadAcceptedDifferences(resolve(root, "conformance/accepted-differences.json"));

describe("olah against the oracle on sessions of the corpus items", () => {
  const cases = sessionCases(examples);
  const report = compareSessions(cases, longsight, olah, accepted);

  it("builds sessions of the items with interactions that choose identifiers, the adaptive ones included", () => {
    expect(cases.length).toBeGreaterThan(100);
    expect(cases.every(({ turns }) => turns.length === SESSION_TURNS)).toBe(true);
    expect(cases.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["packaging/items/adaptive.xml (turns)", "packaging/items/hint.xml (turns)"]),
    );
  });

  it("[E10][B3][B5][B8][B9][B10][D] gives the outcomes, numAttempts and closing of the oracle after every turn", () => {
    expect(report.differences).toEqual([]);
    expect(report.compared).toBe(99);
    expect(report.rejected.map(({ item }) => item)).toEqual([
      "packaging/items/choice_ruby.xml (turns)",
      "packaging/items/feedback_adaptive.xml (turns)",
      "packaging/maxfiles/example/adaptive.xml (turns)",
      "packaging/test_package_minfiles/example/adaptive.xml (turns)",
    ]);
    const rejected = new Set(report.rejected.map(({ item }) => item));
    const adaptive = cases.filter(({ name, xml }) => xml.includes('adaptive="true"') && !rejected.has(name));
    expect(adaptive.map(({ name }) => name)).toEqual([
      "packaging/basicFeedbackTest/id-692fc07cc3e2/Example05-feedbackBlock-adaptive.xml (turns)",
      "packaging/feedbackTest/id-9c33d141576e/Example05-feedbackBlock-adaptive.xml (turns)",
      "packaging/items/Example05-feedbackBlock-adaptive.xml (turns)",
      "packaging/items/adaptive.xml (turns)",
      "packaging/items/adaptive_template.xml (turns)",
      "packaging/items/hint.xml (turns)",
    ]);
  });

  it("[D] differs only as the accepted differences say, each of which still applies", () => {
    const names = new Set(cases.map(({ name }) => name));
    const applying = accepted.filter(({ item }) => names.has(item)).map(({ item }) => item);
    expect(report.accepted.map(({ item }) => item).sort()).toEqual(applying.sort());
  });
});
