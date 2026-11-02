import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseQtiXml } from "@longsightgroup/qti3-core";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { type AsiDocument, describeInteractions, ReadError, readAsi } from "../src/index.js";
import { ACCEPTED_DIFFERENCES, showsIn } from "./differential/accepted.js";
import { ACCEPTED_AMP_UP_DIFFERENCES } from "./differential/accepted-amp-up.js";
import { ampUp, UNSUPPORTED } from "./differential/amp-up.js";
import { corpusCases, SESSION_TURNS, sessionCases } from "./differential/cases.js";
import { compare, compareSessions, isAccepted } from "./differential/compare.js";
import { longsight } from "./differential/longsight.js";
import { runtime } from "./differential/runtime.js";

// The 1EdTech examples through the comparison of `differential.test.ts`.

const examples = resolve(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const itemCases = corpusCases(examples);
const itemReport = compare(itemCases, longsight, runtime, ACCEPTED_DIFFERENCES);
const sessions = sessionCases(examples);
const sessionReport = compareSessions(sessions, longsight, runtime, ACCEPTED_DIFFERENCES);

// Amp-up qti3-item-player on the items it knows every element of; the other cases are outside what it supports.
const ampUpRuns = itemCases.map((testCase) => ({ testCase, run: ampUp.run(testCase) }));
const outsideAmpUp = ampUpRuns.flatMap(({ testCase, run }) =>
  !run.accepted && run.reason.startsWith(UNSUPPORTED) ? [{ name: testCase.name, reason: run.reason }] : [],
);
const outsideNames = new Set(outsideAmpUp.map(({ name }) => name));
const ampUpCases = itemCases.filter(({ name }) => !outsideNames.has(name));
const ampUpReport = compare(ampUpCases, ampUp, runtime, ACCEPTED_AMP_UP_DIFFERENCES);

/** The interactions that Amp-up does not have, as the comparator study lists them. */
const AMP_UP_LACKS = [
  "qti-associate-interaction",
  "qti-drawing-interaction",
  "qti-graphic-associate-interaction",
  "qti-graphic-order-interaction",
  "qti-position-object-interaction",
  "qti-slider-interaction",
  "qti-upload-interaction",
];

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
    const listed = ACCEPTED_DIFFERENCES.filter(({ variable }) => variable === undefined).flatMap(
      ({ items }) => items ?? [],
    );
    expect(listed.filter((item) => !reported.some((name) => showsIn(item, name)))).toEqual([]);
    expect(reported.every((name) => listed.some((item) => showsIn(item, name)))).toBe(true);
  });
});

describe("the second oracle on the corpus items", () => {
  it("leaves out only the documents of tests and the items with an interaction that it lacks", () => {
    expect(outsideAmpUp.length).toBe(50);
    for (const { name, reason } of outsideAmpUp) {
      expect(
        reason.includes("qti-assessment-test") || AMP_UP_LACKS.some((element) => reason.includes(element)),
        name,
      ).toBe(true);
    }
    const interactions = new Set(
      outsideAmpUp.flatMap(({ reason }) => AMP_UP_LACKS.filter((name) => reason.includes(name))),
    );
    expect([...interactions].sort()).toEqual(AMP_UP_LACKS);
  });

  it("repeats what it accepts", () => {
    for (const { testCase, run } of ampUpRuns.slice(0, 40)) {
      if (run.accepted) expect(ampUp.run(testCase), testCase.name).toEqual(run);
    }
  });

  it("is compared on the items that it knows every element of, apart from the items that both reject", () => {
    expect(ampUpReport.compared).toBe(442);
    expect(ampUpReport.rejected.map(({ item }) => item)).toEqual([
      "packaging/maxfiles/example/adaptive.xml (no responses)",
      "packaging/test_package_minfiles/example/adaptive.xml (no responses)",
    ]);
  });

  it("gives the outcome and template values of the runtime on every item both accept, but for the accepted differences", () => {
    expect(ampUpReport.differences).toEqual([]);
  });

  it("has each accepted difference show in every item it lists, or in some item when it lists none", () => {
    for (const entry of ACCEPTED_AMP_UP_DIFFERENCES) {
      if (entry.items === undefined) expect(entry.values, entry.reason).toBeDefined();
      for (const item of entry.items ?? [undefined]) {
        const shows = ampUpReport.accepted.some(
          (difference) => (item === undefined || showsIn(item, difference.item)) && isAccepted([entry], difference),
        );
        expect(shows, `${entry.reason} (${item ?? "every item"})`).toBe(true);
      }
    }
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
