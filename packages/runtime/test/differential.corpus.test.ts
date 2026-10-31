import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseQtiXml } from "@longsightgroup/qti3-core";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { type AsiDocument, describeInteractions, ReadError, readAsi } from "../src/index.js";
import { ACCEPTED_DIFFERENCES, showsIn } from "./differential/accepted.js";
import { corpusCases, SESSION_TURNS, sessionCases } from "./differential/cases.js";
import { compare, compareSessions } from "./differential/compare.js";
import { longsight } from "./differential/longsight.js";
import { runtime } from "./differential/runtime.js";

// The 1EdTech examples through the comparison of `differential.test.ts`.

const examples = resolve(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const itemCases = corpusCases(examples);
const itemReport = compare(itemCases, longsight, runtime, ACCEPTED_DIFFERENCES);
const sessions = sessionCases(examples);
const sessionReport = compareSessions(sessions, longsight, runtime, ACCEPTED_DIFFERENCES);

describe("the oracle on the corpus items", () => {
  it("builds cases from every item of the examples, named by their paths", () => {
    expect(itemCases.length).toBeGreaterThan(400);
    expect(itemCases.map(({ name }) => name)).toContain("packaging/items/choice.xml (correct responses)");
  });

  it("accepts or rejects every case with a reason, and repeats what it accepts", () => {
    for (const testCase of itemCases) {
      const first = longsight.run(testCase);
      if (first.accepted) expect(longsight.run(testCase), testCase.name).toEqual(first);
      else expect(first.reason, testCase.name).not.toBe("");
    }
  });
});

describe("runtime against the oracle on the corpus items", () => {
  it("gives the outcome and template values of the oracle on every item both accept", () => {
    expect(itemReport.differences).toEqual([]);
    expect(itemReport.compared).toBe(446);
  });
});

describe("runtime against the oracle on sessions of the corpus items", () => {
  it("builds sessions of the items with interactions that choose identifiers, the adaptive ones included", () => {
    expect(sessions.length).toBeGreaterThan(100);
    expect(sessions.every(({ turns }) => turns.length === SESSION_TURNS)).toBe(true);
    expect(sessions.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["packaging/items/adaptive.xml (turns)", "packaging/items/hint.xml (turns)"]),
    );
  });

  it("gives the outcomes, numAttempts and closing of the oracle after every turn", () => {
    expect(sessionReport.differences).toEqual([]);
    expect(sessionReport.compared).toBe(99);
    expect(sessionReport.rejected.map(({ item }) => item)).toEqual([
      "packaging/items/choice_ruby.xml (turns)",
      "packaging/items/feedback_adaptive.xml (turns)",
      "packaging/maxfiles/example/adaptive.xml (turns)",
      "packaging/test_package_minfiles/example/adaptive.xml (turns)",
    ]);
    const rejected = new Set(sessionReport.rejected.map(({ item }) => item));
    const adaptive = sessions.filter(({ name, xml }) => xml.includes('adaptive="true"') && !rejected.has(name));
    expect(adaptive.map(({ name }) => name)).toEqual([
      "packaging/basicFeedbackTest/id-692fc07cc3e2/Example05-feedbackBlock-adaptive.xml (turns)",
      "packaging/feedbackTest/id-9c33d141576e/Example05-feedbackBlock-adaptive.xml (turns)",
      "packaging/items/Example05-feedbackBlock-adaptive.xml (turns)",
      "packaging/items/adaptive.xml (turns)",
      "packaging/items/adaptive_template.xml (turns)",
      "packaging/items/hint.xml (turns)",
    ]);
  });
});

describe("the accepted differences", () => {
  it("are the only ones that the comparison finds, and each listed item of the examples shows its difference", () => {
    const reported = [...itemReport.accepted, ...sessionReport.accepted].map(({ item }) => item);
    const listed = ACCEPTED_DIFFERENCES.filter(({ variable }) => variable === undefined).flatMap(({ items }) => items);
    expect(listed.filter((item) => !reported.some((name) => showsIn(item, name)))).toEqual([]);
    expect(reported.every((name) => listed.some((item) => showsIn(item, name)))).toBe(true);
  });
});

/** What both implementations say about an interaction. */
interface Summary {
  readonly responseIdentifier: string;
  readonly shuffle: boolean;
  readonly choices: readonly string[];
}

/** The interactions of every item that both implementations accept, by path. */
function summaries(): Map<string, { readonly oracle: Summary[]; readonly subject: Summary[] }> {
  const found = new Map<string, { oracle: Summary[]; subject: Summary[] }>();
  for (const path of readdirSync(examples, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".xml"),
  )) {
    const xml = readFileSync(resolve(examples, path), "utf8");
    if (!xml.includes("<qti-assessment-item")) continue;
    const parsed = parseQtiXml(xml);
    if (!parsed.ok || parsed.document === undefined) continue;
    let document: AsiDocument;
    try {
      document = readAsi(xml, { path });
    } catch (error) {
      if (error instanceof ReadError) continue;
      throw error;
    }
    if (document.kind !== "item") continue;
    found.set(path, {
      oracle: parsed.document.item.interactions.map((interaction) => ({
        responseIdentifier: interaction.responseIdentifier ?? "",
        shuffle: interaction.attributes.shuffle === "true",
        choices: interaction.choices.map(({ identifier }) => identifier),
      })),
      subject: describeInteractions(document.item).map((descriptor) => ({
        responseIdentifier: descriptor.responseIdentifier,
        shuffle: descriptor.shuffle,
        choices: descriptor.choices.map(({ identifier }) => identifier),
      })),
    });
  }
  return found;
}

describe("runtime against the oracle on the interactions of the corpus items", () => {
  const found = summaries();

  it("list the same interactions in the same order, with the same response variables", () => {
    expect(found.size).toBeGreaterThan(200);
    for (const [path, { oracle, subject }] of found) {
      expect(
        subject.map((entry) => entry.responseIdentifier),
        path,
      ).toEqual(oracle.map((entry) => entry.responseIdentifier));
    }
  });

  it("shuffle the same interactions", () => {
    for (const [path, { oracle, subject }] of found) {
      expect(
        subject.map((entry) => entry.shuffle),
        path,
      ).toEqual(oracle.map((entry) => entry.shuffle));
    }
  });

  it("list the same choices, in the same order, for every interaction but those that differ in what they call a choice", () => {
    const differing: string[] = [];
    for (const [path, { oracle, subject }] of found) {
      oracle.forEach((entry, place) => {
        if (JSON.stringify(entry.choices) !== JSON.stringify(subject[place]?.choices)) {
          differing.push(
            `${path} ${entry.responseIdentifier}: ${JSON.stringify(entry.choices)} ${JSON.stringify(subject[place]?.choices)}`,
          );
        }
      });
    }
    expect(differing).toEqual([]);
  });
});
