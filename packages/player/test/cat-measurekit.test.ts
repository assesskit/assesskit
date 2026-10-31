// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and JSON fields are those of their specifications.

import { type CatPort, isSessionEnd, type SectionData } from "@assesskit/runtime/cat";
import {
  createEngine,
  type DeliveryState,
  deserializeState,
  drainCat,
  type Engine,
  serializeState,
  stamp,
} from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { packageResolvers, type QtiPackage } from "@assesskit/runtime/package";
import type { AssessmentResult, ResultVariable } from "@assesskit/runtime/results";
import { single, type Value } from "@assesskit/runtime/values";
import { createRandom, DataError as MeasurekitDataError } from "@measurekit/psychometrics";
import {
  adaptiveTest,
  multistageTest,
  type PoolItem,
  simulateAdaptiveTest,
  type TestState,
  testLength,
} from "@measurekit/psychometrics/cat";
import {
  generalizedPartialCredit,
  type LogisticParameters,
  type TestItem,
  threeParameterLogistic,
  twoParameterLogistic,
} from "@measurekit/psychometrics/irt";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type DeployedCatSection, deployCatSections } from "../src/cat/index.js";
import { measurekitCatPort, measurekitPanelPort, type SectionStore } from "../src/cat/measurekit/index.js";
import { DEFAULT_SCALING_CONSTANT, poolOf } from "../src/cat/measurekit/pool.js";
import { responseTo, scoreCategory } from "../src/cat/measurekit/response.js";
import { readAdaptiveSection, readPanelSection, sectionIdentifier } from "../src/cat/measurekit/section.js";
import { checkSessionSeed, parseSessionState, readProgress, stepSeed } from "../src/cat/measurekit/session-state.js";
import { readItems } from "../src/cat/measurekit/usage.js";
import {
  ASI,
  adaptiveSection,
  BANK,
  type Bank,
  base64,
  DEPLOYABLE,
  drive,
  IDS,
  memoryStore,
  PREFIX,
  packageOf,
  resultsOf,
  SETTINGS_REF,
  sectionDataOf,
  selectionXml,
  testXml,
  USAGE_REF,
  usageXml,
} from "./cat-fixture.js";
import { fuzzJson } from "./fuzz.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = <T = never>(text: string): T => JSON.parse(text);

/** Passes a value through JSON, which drops what JSON does not carry. */
const viaJson = <T = never>(value: unknown): T => JSON.parse(JSON.stringify(value));

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Returns the message of the error a promise rejects with, after checking that it is a DataError of the player. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("The promise did not reject.");
}

/** The same items as measurekit's three-parameter logistic items, to compare with measurekit without the code of the port. */
const measurekitPool: readonly TestItem<LogisticParameters>[] = BANK.map(({ id, a = 1, b, c = 0 }) => ({
  id,
  model: threeParameterLogistic,
  parameters: { a, b, c, d: 1 },
}));

/** Item ids of the administered items of a measurekit state. */
const itemsOf = (state: TestState): readonly string[] => state.items;

/** Answers of a candidate that alternate, so that the estimate moves both ways. */
const alternating = (_item: string, position: number): number => (position % 2 === 0 ? 1 : 0);

/** The items that measurekit administers for the same bank and answers, with the seeds of the steps as the port documents them. */
function measurekitItems(length: number, answers: (item: string, position: number) => number, seed = 12345): string[] {
  const test = adaptiveTest({ pool: measurekitPool, stopping: testLength(length) });
  let state = test.start(createRandom(seed * 2 ** 21));
  while (state.next !== null) {
    state = test.answer(
      state,
      answers(state.next, state.items.length),
      createRandom(seed * 2 ** 21 + state.items.length + 1),
    );
  }
  return [...itemsOf(state)];
}

describe("usage", () => {
  it("[T99] reads A-Param, B-Param, C-Param and D-Param of a 4PL item, in the order of the usage data", () => {
    const items = readItems(
      bytes(
        usageXml([
          { id: "x", a: 1.3, b: -0.4, c: 0.2, d: 0.97 },
          { id: "y", b: 1 },
        ]),
      ),
    );
    expect(items).toEqual([
      { id: "x", a: 1.3, b: -0.4, c: 0.2, d: 0.97 },
      { id: "y", a: 1, b: 1, c: 0, d: 1 },
    ]);
  });

  it("[T99] leaves other statistics alone: p-values, parameters of a part, of another object and categorized ones", () => {
    const xml = `<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0">
      <ordinaryStatistic name="P-value" context="http://example.org/c"><targetObject identifier="x"/><value>0.6</value></ordinaryStatistic>
      <ordinaryStatistic name="B-Param" context="http://example.org/c"><targetObject identifier="x"/><value>0.5</value></ordinaryStatistic>
      <ordinaryStatistic name="B-Param" context="http://example.org/c"><targetObject identifier="x" partIdentifier="step1"/><value>9</value></ordinaryStatistic>
      <ordinaryStatistic name="B-Param" context="http://example.org/c"><targetObject identifier="t" objectType="test"/><value>9</value></ordinaryStatistic>
      <categorizedStatistic name="B-Param" context="http://example.org/c"><targetObject identifier="z"/><mapping><mapEntry mapKey="1" mappedValue="1"/></mapping></categorizedStatistic>
    </usageData>`;
    expect(readItems(bytes(xml))).toEqual([{ id: "x", a: 1, b: 0.5, c: 0, d: 1 }]);
  });

  it("[T99] rejects a parameter that is given twice, that is not a number, or that has no B-Param", () => {
    const statistic = (name: string, value: string, baseType = ""): string =>
      `<ordinaryStatistic name="${name}" context="http://example.org/c"><targetObject identifier="x"/><value ${baseType}>${value}</value></ordinaryStatistic>`;
    const usage = (...statistics: string[]): Uint8Array =>
      bytes(`<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0">${statistics.join("")}</usageData>`);
    expect(() => readItems(usage(statistic("B-Param", "1"), statistic("B-Param", "2")))).toThrow(
      new DataError('The usage data gives B-Param for the item "x" more than once; the item needs one value.'),
    );
    expect(() => readItems(usage(statistic("B-Param", "yes", 'baseType="string"')))).toThrow(
      new DataError(
        'The statistic B-Param must be a number of the base type float or integer, found "yes" of the base type string.',
      ),
    );
    expect(() => readItems(usage(statistic("A-Param", "1")))).toThrow(
      new DataError('The usage data gives parameters for the item "x" but no B-Param.'),
    );
  });
});

describe("pool", () => {
  // Oracle: Python 3, math.erf and math.exp. The item has a = 1.2, b = 0.3, c = 0.2, d = 1 on the normal-ogive metric.
  // Per theta: the normal ogive c + (d - c) Φ(a (θ - b)), and the logistic c + (d - c) / (1 + exp(-1.702 a (θ - b))).
  const Ogive: readonly (readonly [theta: number, ogive: number, logistic: number])[] = [
    [-2, 0.20231205446098094, 0.2072283817229077],
    [-1, 0.24750395247583445, 0.25253931313840905],
    [0, 0.4875388534256071, 0.48115118328420614],
    [0.3, 0.6000000000000001, 0.6000000000000001],
    [1, 0.8396366453916402, 0.8454811609309787],
    [2, 0.9834598697071439, 0.9759062679872346],
  ];
  /** Haley (1952): the logistic with D = 1.702 is within 0.01 of the normal ogive for every theta. */
  const HaleyBound = 0.01;

  const probability = (item: ReturnType<typeof poolOf>[number], theta: number): number => {
    const out = new Float64Array(2);
    item.model.probabilities(item.parameters, theta, out);
    return out[1] ?? Number.NaN;
  };

  it("[T99] multiplies a by 1.702 so that a bank on the normal-ogive metric is on measurekit's scale", () => {
    const [item] = poolOf([{ id: "x", a: 1.2, b: 0.3, c: 0.2, d: 1 }], [], 1.702);
    if (item === undefined) throw new Error("The pool has no item.");
    for (const [theta, ogive, logistic] of Ogive) {
      expect(probability(item, theta)).toBeCloseTo(logistic, 12);
      expect(Math.abs(probability(item, theta) - ogive)).toBeLessThan(HaleyBound);
    }
  });

  it("[T99] takes a as it is with the default constant 1, measurekit's scale D = 1", () => {
    expect(DEFAULT_SCALING_CONSTANT).toBe(1);
    const [item] = poolOf([{ id: "x", a: 1.2, b: 0.3, c: 0.2, d: 1 }], [], DEFAULT_SCALING_CONSTANT);
    expect(item?.parameters).toEqual({ a: 1.2, b: 0.3, c: 0.2, d: 1 });
    // Oracle: Python, 0.2 + 0.8 / (1 + exp(-1.2 (θ - 0.3))).
    expect(item && probability(item, -1)).toBeCloseTo(0.33891731761520405, 12);
    expect(item && probability(item, 2)).toBeCloseTo(0.9079466143635602, 12);
  });

  it("[T99] lets a host item replace the item of the usage data in its place and adds the others at the end", () => {
    const host: TestItem<LogisticParameters>[] = [
      { id: "y", model: twoParameterLogistic, parameters: { a: 2, b: 2, c: 0, d: 1 } },
      { id: "z", model: twoParameterLogistic, parameters: { a: 1, b: 3, c: 0, d: 1 } },
    ];
    const pool = poolOf(
      [
        { id: "x", a: 1, b: 0, c: 0, d: 1 },
        { id: "y", a: 1, b: 1, c: 0, d: 1 },
      ],
      host,
      1.702,
    );
    expect(pool.map(({ id }) => id)).toEqual(["x", "y", "z"]);
    expect(pool[1]?.parameters).toEqual({ a: 2, b: 2, c: 0, d: 1 });
  });
});

describe("session-state", () => {
  it("[T99] gives every step of every session its own seed", () => {
    expect(stepSeed(0, 0)).toBe(0);
    expect(stepSeed(1, 0)).toBe(2 ** 21);
    expect(stepSeed(2 ** 32 - 1, 2 ** 21 - 1)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("[T99] rejects a seed or a step out of range", () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => checkSessionSeed(seed), String(seed)).toThrow(
        /^A session seed must be an integer from 0 to 4294967295/,
      );
    }
    expect(() => checkSessionSeed(json("5"))).not.toThrow();
    expect(() => checkSessionSeed(json('"5"'))).toThrow(DataError);
    expect(() => stepSeed(1, 2 ** 21)).toThrow(DataError);
    expect(() => stepSeed(1, -1)).toThrow(DataError);
  });

  it("[T99] parses the sessionState and reads the progress of a state", () => {
    expect(parseSessionState('{"seed":3}')).toEqual({ seed: 3 });
    expect(readProgress({ items: ["a", "b"], next: "c" })).toEqual({ administered: 2, next: "c" });
  });

  it("[T99] rejects a sessionState that is not the JSON text of an object and a state that has ended", () => {
    for (const state of [undefined, 5, "{", "[]", "null"]) {
      expect(() => parseSessionState(state), String(state)).toThrow(DataError);
    }
    expect(() => readProgress({ items: [], next: null })).toThrow(
      new DataError("The session presents nothing to take a response, found the next null; it has ended."),
    );
    expect(() => readProgress({ next: "a" })).toThrow(DataError);
    expect(() => readProgress(json("[]"))).toThrow(DataError);
  });
});

describe("response", () => {
  const item: TestItem = { id: "q", model: generalizedPartialCredit, parameters: { a: 1, b: [-1, 0.5] } };

  it("[T99] takes the SCORE of the item as its category", () => {
    expect(scoreCategory("q", new Map<string, Value | null>([["SCORE", single("float", 2)]]))).toBe(2);
    expect(responseTo(item, resultsOf(new Map([["q", 2]])), scoreCategory)).toBe(2);
  });

  it("[T99] uses the last result of the item, and a category function of the host", () => {
    const result: AssessmentResult = {
      context: { sessionIdentifiers: [] },
      itemResults: [...resultsOf(new Map([["q", 0]])).itemResults, ...resultsOf(new Map([["q", 1]])).itemResults],
    };
    expect(responseTo(item, result, scoreCategory)).toBe(1);
    expect(responseTo(item, result, (id, outcomes) => (outcomes.has("SCORE") && id === "q" ? 2 : 0))).toBe(2);
  });

  it("[T99] takes an item submitted without a response, with the status initial and no SCORE, as category 0", () => {
    const blank: AssessmentResult = {
      context: { sessionIdentifiers: [] },
      itemResults: [
        {
          ...resultsOf(new Map([["q", 1]])).itemResults[0],
          identifier: "q",
          sessionStatus: "initial",
          variables: [],
        } as never,
      ],
    };
    let asked = false;
    expect(
      responseTo(item, blank, () => {
        asked = true;
        return 2;
      }),
    ).toBe(0);
    expect(asked).toBe(false);
    expect(() => responseTo(item, resultsOf(new Map([["q", 1]])), () => 0)).not.toThrow();
  });

  it("[T99] rejects a score that is no number, a category that is no category of the model, and a missing result", () => {
    const withScore = (value: Value | null): AssessmentResult => ({
      context: { sessionIdentifiers: [] },
      itemResults: [
        {
          identifier: "q",
          datestamp: "2026-10-30T10:00:00",
          sessionStatus: "final",
          variables: [{ kind: "outcome", identifier: "SCORE", cardinality: "single", baseType: "float", value }],
          supports: [],
        },
      ],
    });
    expect(() => responseTo(item, withScore(null), scoreCategory)).toThrow(
      new DataError(
        'The outcome SCORE of the item "q" must be a single number to serve as its response category, found null.',
      ),
    );
    expect(() => scoreCategory("q", new Map())).toThrow(/response category, found none\.$/);
    expect(() => responseTo(item, withScore(single("string", "a")), scoreCategory)).toThrow(DataError);
    expect(() => responseTo(item, withScore(single("float", 0.5)), scoreCategory)).toThrow(
      new DataError('The response category of the item "q" must be a whole number from 0 to 2, found 0.5.'),
    );
    expect(() => responseTo(item, withScore(single("float", 3)), scoreCategory)).toThrow(/from 0 to 2, found 3\.$/);
    expect(() => responseTo(item, resultsOf(new Map([["other", 1]])), scoreCategory)).toThrow(
      new DataError('The assessmentResult has no result for the item "q", which the session presented.'),
    );
    expect(() => responseTo(item, json("null"), scoreCategory)).toThrow(DataError);
    expect(() => responseTo(item, json('{"itemResults":"x"}'), scoreCategory)).toThrow(DataError);
    expect(() => responseTo(item, resultsOf(new Map([["q", 1]])), () => Number.NaN)).toThrow(DataError);
  });
});

describe("section", () => {
  // Oracle: Python 3, SHA-256 of json.dumps([sectionConfiguration, qtiUsagedata, qtiMetadata], separators=(",", ":")).
  it("[T99] names a section by the SHA-256 of its section data", async () => {
    expect(await sectionIdentifier({ sectionConfiguration: "e30=" })).toBe(
      "28060e29a1c5b94c4039614a24665958cd666923375e398890cc81eaa689d696",
    );
    expect(
      await sectionIdentifier({ sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: "bWV0YQ==" }),
    ).toBe("2b3ede3102a21d370eaa8403c531b682e757bb42816599298d5f9a79daf64ecf");
    expect(await sectionIdentifier({ sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" })).toBe(
      "c3482cf15c56b0c00f8ab409211313e287066f7aa80f64f31c678d28ae8bd73b",
    );
  });

  it("[T99] reads the settings and the usage data of an adaptive section", async () => {
    const data = sectionDataOf(
      { length: 4, contentTargets: { algebra: 0.6, geometry: 0.4 }, enemies: [["q1", "q2"]] },
      BANK.slice(0, 2),
    );
    const { identifier, section } = await readAdaptiveSection(data);
    expect(identifier).toBe(await sectionIdentifier(data));
    expect(section).toEqual({
      kind: "adaptive",
      data,
      items: [
        { id: "q1", a: 1.2, b: -1.5, c: 0.2, d: 1 },
        { id: "q2", a: 0.9, b: -0.6, c: 0.15, d: 1 },
      ],
      length: 4,
      contentTargets: [
        ["algebra", 0.6],
        ["geometry", 0.4],
      ],
      enemies: [["q1", "q2"]],
    });
  });

  it("[T99] defaults the content targets and the enemies to none, and keeps the area __proto__ as data", async () => {
    const { section } = await readAdaptiveSection(sectionDataOf({ length: 2 }, BANK));
    expect(section.contentTargets).toEqual([]);
    expect(section.enemies).toEqual([]);
    const text = '{"length":2,"contentTargets":{"__proto__":1}}';
    const { section: odd } = await readAdaptiveSection({ sectionConfiguration: base64(text) });
    expect(odd.contentTargets).toEqual([["__proto__", 1]]);
  });

  it("[T99] rejects section data and settings of the wrong form", async () => {
    const rejects = async (data: unknown, message: RegExp): Promise<void> => {
      await expect(readAdaptiveSection(data), JSON.stringify(data)).rejects.toThrow(message);
    };
    await rejects(json("null"), /^The section data is invalid: expected an object, found null/);
    await rejects(
      { sectionConfiguration: 5 },
      /^The section data is invalid at sectionConfiguration: expected a string, found 5/,
    );
    await rejects(
      { sectionConfiguration: "e30=", qtiUsagedata: null },
      /^The section data is invalid at qtiUsagedata: expected a string, found null/,
    );
    await rejects(
      { sectionConfiguration: "e30=", extra: 1 },
      /^The section data is invalid: unexpected property "extra"/,
    );
    await rejects(sectionDataOf({}), /^The settings of an adaptive section is invalid: missing the property "length"/);
    await rejects(
      sectionDataOf({ length: 0 }),
      /^The settings of an adaptive section is invalid at length: expected a value of at least 1, found 0/,
    );
    await rejects(
      sectionDataOf({ length: 2, speed: 1 }),
      /^The settings of an adaptive section is invalid: unexpected property "speed"/,
    );
    await rejects(
      sectionDataOf({ length: 2, contentTargets: { a: "x" } }),
      /^The settings of an adaptive section is invalid at contentTargets: the property "a" is invalid: expected a number, found "x"/,
    );
    await rejects(
      sectionDataOf({ length: 2, contentTargets: [] }),
      /^The settings of an adaptive section is invalid at contentTargets: expected an object, found an array/,
    );
    await rejects(
      sectionDataOf({ length: 2, enemies: [["a", 5]] }),
      /^The settings of an adaptive section is invalid at enemies\[0\]\[1\]: expected a string, found 5/,
    );
    await rejects(
      sectionDataOf({ length: 2, enemies: "a" }),
      /^The settings of an adaptive section is invalid at enemies: expected an array, found "a"/,
    );
    await rejects(
      sectionDataOf([]),
      /^The settings of an adaptive section is invalid at length: expected a value of at least 1, found 0/,
    );
  });

  it("[T100] reads the stages and modules of a panel, and checks that the usage data has the items", async () => {
    const settings = {
      stages: [{ modules: [{ id: "m1", items: ["q1", "q2"] }] }, { modules: [{ id: "m2", items: ["q3"] }] }],
    };
    const { section } = await readPanelSection(sectionDataOf(settings, BANK));
    expect(section.kind).toBe("panel");
    expect(section.stages).toEqual([[{ id: "m1", items: ["q1", "q2"] }], [{ id: "m2", items: ["q3"] }]]);
    await expect(
      readPanelSection(sectionDataOf({ stages: [{ modules: [{ id: "m1", items: ["q1", "nope"] }] }] }, BANK)),
    ).rejects.toThrow(
      new DataError('The module "m1" lists the item "nope", which the usage data gives no parameters for.'),
    );
    for (const bad of [{}, { stages: "x" }, { stages: [{}] }, { stages: [{ modules: [{ id: "", items: [] }] }] }]) {
      await expect(readPanelSection(sectionDataOf(bad, BANK)), JSON.stringify(bad)).rejects.toThrow(DataError);
    }
  });

  it("[T99] rejects files that are not base64, not the canonical base64 of RFC 4648 §3.5, not UTF-8 or not JSON", async () => {
    const withSettings = (sectionConfiguration: string): unknown => ({ sectionConfiguration });
    expect(await rejection(readAdaptiveSection(withSettings("not base64!")))).toBe(
      "The sectionConfiguration of the section data must be base64 text (RFC 4648), found text that is not.",
    );
    // Without the padding, and with bits after the last byte that are not zero: the text is no encoding of bytes.
    for (const text of [base64("{}").replace(/=+$/u, ""), "e30\n", "e31="]) {
      expect(await rejection(readAdaptiveSection(withSettings(text))), text).toMatch(/must be base64 text/);
    }
    expect(await rejection(readAdaptiveSection(withSettings("/w==")))).toBe(
      "The sectionConfiguration of the section data must be UTF-8 text, found bytes that are not.",
    );
    expect(await rejection(readAdaptiveSection(withSettings(base64("{"))))).toBe(
      "The sectionConfiguration of the section data must be JSON text, found text that is not.",
    );
    expect(
      await rejection(readAdaptiveSection({ sectionConfiguration: base64('{"length":1}'), qtiUsagedata: "~" })),
    ).toBe("The qtiUsagedata of the section data must be base64 text (RFC 4648), found text that is not.");
  });
});

/** Creates a port over a store, with the section in it, and returns the section's identifier. */
async function deployed(port: CatPort, data: SectionData): Promise<string> {
  return (await port.createSection(PREFIX, data)).sectionIdentifier;
}

describe("measurekitCatPort", () => {
  const settings = { length: 4 };
  const data = sectionDataOf(settings, BANK);
  const seeds = (): number => 12345;

  it("[T99] presents the items that measurekit's adaptive test selects, one item to a stage", async () => {
    const sections = memoryStore();
    const port = measurekitCatPort({ sections, seeds });
    const section = await deployed(port, data);
    const run = await drive(port, section, alternating);
    expect(run.items).toEqual(measurekitItems(4, alternating));
    expect(run.items).toHaveLength(4);
    expect(run.stages.every((stage) => stage.length === 1)).toBe(true);
  });

  it("[T99] answers Create Session with a one-item stage, the session seed as identifier and the state in sessionState", async () => {
    const port = measurekitCatPort({ sections: memoryStore(), seeds });
    const section = await deployed(port, data);
    const created = await port.createSession(PREFIX, section, {});
    expect(created.sessionIdentifier).toBe("12345");
    expect(created.nextItems.stageLength).toBe(1);
    expect(created.nextItems.itemIdentifiers).toHaveLength(1);
    const state = JSON.parse(created.sessionState ?? "null");
    expect(state.seed).toBe(12345);
    expect(state.state.next).toBe(created.nextItems.itemIdentifiers?.[0]);
    expect(state.state.items).toEqual([]);
  });

  it("[T99] ends the session with the empty stage after the length of the test", async () => {
    const port = measurekitCatPort({ sections: memoryStore(), seeds });
    const section = await deployed(port, sectionDataOf({ length: 1 }, BANK));
    const created = await port.createSession(PREFIX, section, {});
    const [first] = created.nextItems.itemIdentifiers ?? [];
    const answered = await port.submitResults(PREFIX, section, created.sessionIdentifier, {
      assessmentResult: resultsOf(new Map([[first ?? "", 1]])),
      ...(created.sessionState === undefined ? {} : { sessionState: created.sessionState }),
    });
    expect(answered.nextItems).toEqual({ itemIdentifiers: [], stageLength: 0 });
    expect(isSessionEnd(answered.nextItems)).toBe(true);
    expect(JSON.parse(answered.sessionState ?? "null").state.next).toBeNull();
  });

  it("[T99] keeps no session: another port over the same store continues a session, and a repeated request gives the same answer", async () => {
    const sections = memoryStore();
    const first = measurekitCatPort({ sections, seeds });
    const second = measurekitCatPort({ sections, seeds: () => 999 });
    const section = await deployed(first, data);
    const created = await first.createSession(PREFIX, section, {});
    const item = created.nextItems.itemIdentifiers?.[0] ?? "";
    const request = {
      assessmentResult: resultsOf(new Map([[item, 1]])),
      ...(created.sessionState === undefined ? {} : { sessionState: created.sessionState }),
    };
    const byFirst = await first.submitResults(PREFIX, section, created.sessionIdentifier, request);
    const bySecond = await second.submitResults(PREFIX, section, created.sessionIdentifier, request);
    expect(bySecond).toEqual(byFirst);
    expect(await second.submitResults(PREFIX, section, created.sessionIdentifier, request)).toEqual(byFirst);
  });

  it("[T99] stores a section once under the SHA-256 of its data, as JSON, and creates it again without change", async () => {
    const sections = memoryStore();
    const port = measurekitCatPort({ sections, seeds });
    const section = await deployed(port, data);
    expect(section).toBe(await sectionIdentifier(data));
    const stored = sections.kept.get(section);
    expect(await deployed(port, data)).toBe(section);
    expect(sections.kept.size).toBe(1);
    expect(sections.kept.get(section)).toBe(stored);
    expect(JSON.parse(stored ?? "null")).toMatchObject({ kind: "adaptive", length: 4, data });
  });

  it("[T99] returns the section data and the pool from Get Section, so that CAT 1.0's checks on the pool can run", async () => {
    const port = measurekitCatPort({ sections: memoryStore(), seeds });
    const section = await deployed(port, data);
    expect(await port.getSection(PREFIX, section)).toEqual({
      sectionData: data,
      items: { itemIdentifiers: BANK.map(({ id }) => id) },
    });
  });

  it("[T99] ends a session and a section without change, because the port holds no session and sections are shared", async () => {
    const sections = memoryStore();
    const port = measurekitCatPort({ sections, seeds });
    const section = await deployed(port, data);
    await expect(port.endSession(PREFIX, section, "12345")).resolves.toBeUndefined();
    await expect(port.endSection(PREFIX, section)).resolves.toBeUndefined();
    expect(sections.kept.has(section)).toBe(true);
    expect((await port.getSection(PREFIX, section)).sectionData).toEqual(data);
  });

  it("[T99] multiplies the discrimination with scalingConstant, which changes which item is the most informative", async () => {
    // Oracle: Python, information a² P (1 - P) at theta 0 of A (a = 2, b = 1) and B (a = 1, b = 0.2).
    // With D = 1 A has 0.420 and B 0.248; with every a times 1.702 A has 0.361 and B 0.704.
    const bank: readonly Bank[] = [
      { id: "A", a: 2, b: 1 },
      { id: "B", a: 1, b: 0.2 },
    ];
    const first = async (scalingConstant?: number): Promise<string | undefined> => {
      const port = measurekitCatPort({
        sections: memoryStore(),
        seeds,
        ...(scalingConstant === undefined ? {} : { scalingConstant }),
      });
      const section = await deployed(port, sectionDataOf({ length: 1 }, bank));
      return (await port.createSession(PREFIX, section, {})).nextItems.itemIdentifiers?.[0];
    };
    expect(await first()).toBe("A");
    expect(await first(1)).toBe("A");
    expect(await first(1.702)).toBe("B");
  });

  it("[T99] adds the host's items, such as a partial credit item, and maps its SCORE to a category", async () => {
    const polytomous: TestItem = { id: "p1", model: generalizedPartialCredit, parameters: { a: 1.3, b: [-0.5, 0.8] } };
    const port = measurekitCatPort({
      sections: memoryStore(),
      seeds,
      pool: (section) => (section === "" ? [] : [polytomous]),
    });
    const section = await deployed(port, sectionDataOf({ length: 7 }, BANK));
    expect((await port.getSection(PREFIX, section)).items.itemIdentifiers).toEqual([...BANK.map(({ id }) => id), "p1"]);
    const run = await drive(port, section, (item) => (item === "p1" ? 2 : 1));
    expect(run.items).toContain("p1");
    expect(run.items).toHaveLength(7);
  });

  it("[T99] maps the outcomes to a category with the host's function", async () => {
    const port = measurekitCatPort({ sections: memoryStore(), seeds, category: () => 0 });
    const section = await deployed(port, data);
    const run = await drive(port, section, () => 5);
    expect(run.items).toEqual(measurekitItems(4, () => 0));
  });

  it("[T99] draws exposure control and content balancing from createRandom seeded per step", async () => {
    const pool = BANK.map(
      (item, index): PoolItem => ({
        id: item.id,
        model: twoParameterLogistic,
        parameters: { a: item.a ?? 1, b: item.b, c: 0, d: 1 },
        contentArea: index % 2 === 0 ? "algebra" : "geometry",
        ...(index === 2 ? { exposure: 0.5 } : {}),
      }),
    );
    const port = measurekitCatPort({ sections: memoryStore(), seeds, pool: () => pool });
    const section = await deployed(
      port,
      sectionDataOf({ length: 5, contentTargets: { algebra: 0.5, geometry: 0.5 } }, BANK),
    );
    const run = await drive(port, section, alternating);
    const test = adaptiveTest({
      pool,
      stopping: testLength(5),
      contentTargets: { algebra: 0.5, geometry: 0.5 },
    });
    let state = test.start(createRandom(12345 * 2 ** 21));
    while (state.next !== null) {
      state = test.answer(
        state,
        alternating(state.next, state.items.length),
        createRandom(12345 * 2 ** 21 + state.items.length + 1),
      );
    }
    expect(run.items).toEqual(state.items);
  });

  it("[T99] calls seeds once for each session and rejects a seed out of range", async () => {
    let calls = 0;
    const port = measurekitCatPort({
      sections: memoryStore(),
      seeds: () => {
        calls += 1;
        return calls;
      },
    });
    const section = await deployed(port, data);
    await drive(port, section, alternating);
    expect(calls).toBe(1);
    await drive(port, section, alternating);
    expect(calls).toBe(2);
    const bad = measurekitCatPort({ sections: memoryStore(), seeds: () => json("-1") });
    const other = await deployed(bad, data);
    expect(await rejection(bad.createSession(PREFIX, other, {}))).toMatch(
      /^A session seed must be an integer from 0 to 4294967295/,
    );
  });

  it("[T99] refuses requests it cannot answer: unknown or wrong sections, a missing or altered sessionState, a missing result", async () => {
    const sections = memoryStore();
    const port = measurekitCatPort({ sections, seeds });
    const section = await deployed(port, data);
    const panel = measurekitPanelPort({ sections, panels: () => ({ cuts: new Map() }) });
    const created = await port.createSession(PREFIX, section, {});
    const item = created.nextItems.itemIdentifiers?.[0] ?? "";
    const state = created.sessionState ?? "";
    const submit = (request: unknown, id = section): Promise<unknown> =>
      port.submitResults(PREFIX, id, "12345", viaJson(request));

    expect(await rejection(port.getSection(PREFIX, "nope"))).toMatch(/^The section store has no section "nope"/);
    expect(await rejection(port.createSession(PREFIX, json("5"), {}))).toMatch(
      /^The section identifier must be a string/,
    );
    expect(await rejection(submit({ assessmentResult: resultsOf(new Map([[item, 1]])) }))).toMatch(
      /^The sessionState must be the text/,
    );
    expect(await rejection(submit({ assessmentResult: resultsOf(new Map([[item, 1]])), sessionState: "{" }))).toMatch(
      /not JSON/,
    );
    const altered = JSON.stringify({ ...JSON.parse(state), state: { ...JSON.parse(state).state, next: "nope" } });
    expect(
      await rejection(submit({ assessmentResult: resultsOf(new Map([[item, 1]])), sessionState: altered })),
    ).toMatch(/^The session waits for the item "nope"/);
    expect(
      await rejection(submit({ assessmentResult: resultsOf(new Map([["other", 1]])), sessionState: state })),
    ).toMatch(/^The assessmentResult has no result for the item/);
    expect(await rejection(submit({ assessmentResult: resultsOf(new Map([[item, 2]])), sessionState: state }))).toMatch(
      /from 0 to 1, found 2\.$/,
    );
    expect(await rejection(submit(null))).toMatch(/^The request to submit results must be an object/);
    const noSeed = JSON.stringify({ state: JSON.parse(state).state });
    expect(
      await rejection(submit({ assessmentResult: resultsOf(new Map([[item, 1]])), sessionState: noSeed })),
    ).toMatch(/^A session seed must be an integer/);

    const wrong = await panel.createSection(
      PREFIX,
      sectionDataOf({ stages: [{ modules: [{ id: "m", items: ["q1"] }] }] }, BANK),
    );
    expect(await rejection(port.getSection(PREFIX, wrong.sectionIdentifier))).toMatch(/is a "panel" section/);
    expect(await rejection(port.createSession(PREFIX, section, json("null")))).toMatch(
      /^The request to create a session must be an object/,
    );
  });

  it("[T99] fails at createSection, not in the first session, for sections that cannot run", async () => {
    const port = measurekitCatPort({ sections: memoryStore(), seeds });
    expect(await rejection(port.createSection(PREFIX, sectionDataOf({ length: 2 })))).toBe(
      "A section needs items: the usage data and the option pool give none.",
    );
    await expect(
      port.createSection(PREFIX, sectionDataOf({ length: 2, contentTargets: { algebra: 1 } }, BANK)),
    ).rejects.toThrow(MeasurekitDataError);
    await expect(
      port.createSection(PREFIX, sectionDataOf({ length: 2, enemies: [["q1", "nope"]] }, BANK)),
    ).rejects.toThrow(MeasurekitDataError);
    expect(await rejection(port.createSection(PREFIX, json('{"qtiUsagedata":"x"}')))).toMatch(
      /^The section data is invalid: missing the property "sectionConfiguration"/,
    );
    const wrongPool = measurekitCatPort({ sections: memoryStore(), seeds, pool: () => json('"x"') });
    expect(await rejection(wrongPool.createSection(PREFIX, data))).toMatch(
      /^The option pool must return an array of items/,
    );
  });

  it("[T99] checks its options", () => {
    const sections = memoryStore();
    expect(() => measurekitCatPort(json("null"))).toThrow(
      new DataError("The options object is invalid: expected an object, found null."),
    );
    expect(() => measurekitCatPort({ sections, seeds: 1 } as never)).toThrow(
      /^The options object is invalid at seeds: expected a function, found 1/,
    );
    expect(() => measurekitCatPort({ seeds } as never)).toThrow(
      /^The options object is invalid: missing the property "sections"/,
    );
    expect(() => measurekitCatPort({ sections: {} as SectionStore, seeds })).toThrow(DataError);
    expect(() => measurekitCatPort({ sections, seeds, pool: null as never })).toThrow(
      /^The options object is invalid at pool: expected a function, found null/,
    );
    expect(() => measurekitCatPort({ sections, seeds, category: null as never })).toThrow(
      /^The options object is invalid at category: expected a function, found null/,
    );
    expect(() => measurekitCatPort({ sections, seeds, scalingConstant: 0 })).toThrow(
      new DataError("The options object is invalid at scalingConstant: expected a positive number, found 0."),
    );
    expect(() => measurekitCatPort({ sections, seeds, scalingConstant: null as never })).toThrow(DataError);
    expect(() => measurekitCatPort({ sections, seeds, speed: 1 } as never)).toThrow(
      /^The options object is invalid: unexpected property "speed"/,
    );
  });

  it("[T99] reads or refuses arbitrary JSON as options with a DataError, and nothing else", () => {
    fuzzJson((options) => measurekitCatPort(options as never));
    fuzzJson((options) => measurekitPanelPort(options as never));
  });
});

// A routing module of four items, then an easy, a medium and a hard module of three.
const PANEL_BANK: readonly Bank[] = [
  ...["r1", "r2", "r3", "r4"].map((id, index) => ({ id, a: 1.2, b: -1 + index * 0.66 })),
  ...["e1", "e2", "e3"].map((id, index) => ({ id, a: 1.1, b: -1.5 + index * 0.5 })),
  ...["m1", "m2", "m3"].map((id, index) => ({ id, a: 1.1, b: -0.5 + index * 0.5 })),
  ...["h1", "h2", "h3"].map((id, index) => ({ id, a: 1.1, b: 0.5 + index * 0.5 })),
];
const PANEL_SETTINGS = {
  stages: [
    { modules: [{ id: "routing", items: ["r1", "r2", "r3", "r4"] }] },
    {
      modules: [
        { id: "easy", items: ["e1", "e2", "e3"] },
        { id: "medium", items: ["m1", "m2", "m3"] },
        { id: "hard", items: ["h1", "h2", "h3"] },
      ],
    },
  ],
};
const PANEL_CUTS = new Map([["routing", [-0.4, 0.4]]]);
const PANEL_DATA = sectionDataOf(PANEL_SETTINGS, PANEL_BANK);

/** measurekit's multistage test of the same panel, built with measurekit's own models. */
function measurekitModules(scale = 1, answers: (item: string) => number): string[] {
  const items = (ids: string[]): TestItem<LogisticParameters>[] =>
    ids.map((id) => {
      const item = PANEL_BANK.find((candidate) => candidate.id === id) ?? { id, b: 0 };
      return { id, model: twoParameterLogistic, parameters: { a: (item.a ?? 1) * scale, b: item.b, c: 0, d: 1 } };
    });
  const test = multistageTest({
    stages: [
      [{ id: "routing", items: items(["r1", "r2", "r3", "r4"]), cuts: [-0.4, 0.4] }],
      [
        { id: "easy", items: items(["e1", "e2", "e3"]) },
        { id: "medium", items: items(["m1", "m2", "m3"]) },
        { id: "hard", items: items(["h1", "h2", "h3"]) },
      ],
    ],
    routing: "theta",
  });
  let state = test.start();
  while (state.next !== null) {
    const module = test.stages.flat().find(({ id }) => id === state.next);
    state = test.answer(
      state,
      (module?.items ?? []).map(({ id }) => answers(id)),
    );
  }
  return [...state.modules];
}

/** The modules of a run: the stage of a module has all its items, which the first of them names. */
const modulesOf = (run: { readonly stages: readonly (readonly string[])[] }): string[] =>
  run.stages.map(([first]) =>
    first?.startsWith("r") ? "routing" : first?.startsWith("e") ? "easy" : first?.startsWith("m") ? "medium" : "hard",
  );

describe("measurekitPanelPort", () => {
  it("[T100] routes a candidate by the estimate of theta, as measurekit's multistage test does", async () => {
    const port = measurekitPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    for (const answers of [() => 1, () => 0, (item: string) => (item.startsWith("r") ? 1 : 0)]) {
      const run = await drive(port, section, answers);
      expect(modulesOf(run)).toEqual(measurekitModules(1, answers));
    }
    expect(modulesOf(await drive(port, section, () => 1))).toEqual(["routing", "hard"]);
    expect(modulesOf(await drive(port, section, () => 0))).toEqual(["routing", "easy"]);
  });

  it("[T100] presents a module as one stage with all its items, in order, and keeps no session", async () => {
    const sections = memoryStore();
    const port = measurekitPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    const created = await port.createSession(PREFIX, section, {});
    expect(created.sessionIdentifier).toBe(section);
    expect(created.nextItems).toEqual({ itemIdentifiers: ["r1", "r2", "r3", "r4"], stageLength: 4 });
    const request = {
      assessmentResult: resultsOf(new Map(["r1", "r2", "r3", "r4"].map((id) => [id, 1]))),
      ...(created.sessionState === undefined ? {} : { sessionState: created.sessionState }),
    };
    const other = measurekitPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) });
    const answered = await other.submitResults(PREFIX, section, section, request);
    expect(answered.nextItems).toEqual({ itemIdentifiers: ["h1", "h2", "h3"], stageLength: 3 });
    expect(await other.submitResults(PREFIX, section, section, request)).toEqual(answered);
  });

  it("[T100] ends the session with the empty stage after the last stage", async () => {
    const port = measurekitPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    const run = await drive(port, section, () => 1);
    const last = JSON.parse(run.sessionState ?? "null");
    expect(last.next).toBeNull();
    expect(last.modules).toEqual(["routing", "hard"]);
  });

  it("[T100] returns the section data and every item of the panel from Get Section", async () => {
    const port = measurekitPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    expect(await port.getSection(PREFIX, section)).toEqual({
      sectionData: PANEL_DATA,
      items: { itemIdentifiers: PANEL_BANK.map(({ id }) => id) },
    });
    await expect(port.endSession(PREFIX, section, section)).resolves.toBeUndefined();
    await expect(port.endSection(PREFIX, section)).resolves.toBeUndefined();
  });

  it("[T100] multiplies the discrimination with scalingConstant", async () => {
    const port = measurekitPanelPort({
      sections: memoryStore(),
      panels: () => ({ cuts: PANEL_CUTS }),
      scalingConstant: 1.702,
    });
    const section = await deployed(port, PANEL_DATA);
    const answers = (item: string): number => (item.startsWith("r") ? (item === "r1" ? 0 : 1) : 1);
    expect(modulesOf(await drive(port, section, answers))).toEqual(measurekitModules(1.702, answers));
  });

  it("[T100] fails at createSection for a panel that cannot run: wrong cut points, an item twice", async () => {
    const wrongCuts = measurekitPanelPort({
      sections: memoryStore(),
      panels: () => ({ cuts: new Map([["routing", [0]]]) }),
    });
    await expect(wrongCuts.createSection(PREFIX, PANEL_DATA)).rejects.toThrow(MeasurekitDataError);
    const repeated = sectionDataOf(
      {
        stages: [
          {
            modules: [
              { id: "a", items: ["r1"] },
              { id: "b", items: ["r1"] },
            ],
          },
        ],
      },
      PANEL_BANK,
    );
    const port = measurekitPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    await expect(port.createSection(PREFIX, repeated)).rejects.toThrow();
  });

  it("[T100] refuses requests it cannot answer and checks its options", async () => {
    const sections = memoryStore();
    const port = measurekitPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    const created = await port.createSession(PREFIX, section, {});
    const submit = (request: unknown): Promise<unknown> =>
      port.submitResults(PREFIX, section, section, viaJson(request));
    expect(
      await rejection(submit({ assessmentResult: resultsOf(new Map()), sessionState: created.sessionState })),
    ).toMatch(/^The assessmentResult has no result for the item "r1"/);
    expect(
      await rejection(submit({ assessmentResult: resultsOf(new Map()), sessionState: '{"items":[],"next":"nope"}' })),
    ).toMatch(/^The session waits for the module "nope"/);
    expect(await rejection(submit({ sessionState: '{"items":[],"next":null}' }))).toMatch(/presents nothing/);
    const noCuts = measurekitPanelPort({ sections, panels: () => json("{}") });
    expect(await rejection(noCuts.getSection(PREFIX, section))).toMatch(/^The cuts of the panel of the section/);
    const noPanel = measurekitPanelPort({ sections, panels: () => json("null") });
    expect(await rejection(noPanel.getSection(PREFIX, section))).toMatch(/^The option panels must return an object/);
    expect(() => measurekitPanelPort(json("null"))).toThrow(DataError);
    expect(() => measurekitPanelPort({ sections, panels: 3 as never })).toThrow(
      /^The options object is invalid at panels: expected a function, found 3/,
    );
    expect(() => measurekitPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }), scalingConstant: -1 })).toThrow(
      DataError,
    );
    expect(() =>
      measurekitPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }), seeds: () => 1 } as never),
    ).toThrow(DataError);
    const adaptive = measurekitCatPort({ sections, seeds: () => 1 });
    const adaptiveSection = await deployed(adaptive, sectionDataOf({ length: 2 }, BANK));
    expect(await rejection(port.getSection(PREFIX, adaptiveSection))).toMatch(/is a "adaptive" section/);
  });
});

describe("deployCatSections over measurekit", () => {
  it("[T102] gives the engine a section that a delivery can run: over measurekit, the identifier is the SHA-256 of the data", async () => {
    const sections = memoryStore();
    const port = measurekitCatPort({ sections, seeds: () => 7 });
    const deployedSections = await deployCatSections(DEPLOYABLE, () => port);
    const entry = deployedSections.get("cat");
    const data = sectionDataOf({ length: 3 }, BANK);
    expect(entry).toEqual({ prefix: PREFIX, sectionIdentifier: await sectionIdentifier(data) });
    expect(sections.kept.size).toBe(1);
    const run = await drive(port, entry?.sectionIdentifier ?? "", alternating);
    expect(run.items).toHaveLength(3);
  });

  it("[T102] fails over measurekit for a selection without settings, because measurekit needs the length of the test", async () => {
    const pkg = packageOf({ "test.xml": testXml(adaptiveSection(selectionXml("", ""), IDS)) });
    await expect(
      deployCatSections(pkg, () => measurekitCatPort({ sections: memoryStore(), seeds: () => 1 })),
    ).rejects.toThrow(DataError);
  });
});

/** A choice item whose answer `B` the standard template scores 1 (INFO §5.4, `match_correct`). */
const examItemXml = (id: string): string =>
  `<qti-assessment-item xmlns="${ASI}" identifier="${id}" title="Item ${id}" adaptive="false" time-dependent="false"><qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>B</qti-value></qti-correct-response></qti-response-declaration><qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/><qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice></qti-choice-interaction></qti-item-body><qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/></qti-assessment-item>`;

/** A linear test of one adaptive section whose pool is the items given, and a test outcome that sums their scores. */
const examTestXml = (ids: readonly string[]): string =>
  `<qti-assessment-test xmlns="${ASI}" identifier="exam" title="Exam"><qti-outcome-declaration identifier="TOTAL" cardinality="single" base-type="float"/><qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual">${adaptiveSection(
    selectionXml(SETTINGS_REF, USAGE_REF),
    ids,
  )}</qti-test-part><qti-outcome-processing><qti-set-outcome-value identifier="TOTAL"><qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum></qti-set-outcome-value></qti-outcome-processing></qti-assessment-test>`;

/** A package of an exam with an adaptive section: the items, the settings and the usage data of the bank. */
function examPackage(bank: readonly Bank[], settings: unknown): QtiPackage {
  const ids = bank.map(({ id }) => id);
  return packageOf({
    "test.xml": examTestXml(ids),
    "cat/settings.json": JSON.stringify(settings),
    "cat/usage.xml": usageXml(bank),
    ...Object.fromEntries(ids.map((id) => [`items/${id}.xml`, examItemXml(id)])),
  });
}

/** Deploys the adaptive sections of a package and creates the engine of its test. */
async function examEngine(
  pkg: QtiPackage,
  port: CatPort,
): Promise<{ engine: Engine; catSections: ReadonlyMap<string, DeployedCatSection> }> {
  const catSections = await deployCatSections(pkg, () => port);
  const document = pkg.document("test.xml");
  if (document.kind !== "test") throw new Error(`Expected a test, found ${document.kind}.`);
  const engine = createEngine({
    kind: "test",
    test: document.test,
    base: "test.xml",
    resolvers: packageResolvers(pkg),
    catSections,
  });
  return { engine, catSections };
}

/** A port that records the requests it serves, as `name method`. */
function spied(name: string, port: CatPort, log: string[]): CatPort {
  const through =
    <TArgs extends unknown[], TResult>(method: string, call: (...args: TArgs) => TResult) =>
    (...args: TArgs): TResult => {
      log.push(`${name} ${method}`);
      return call(...args);
    };
  return {
    createSection: through("createSection", port.createSection.bind(port)),
    getSection: through("getSection", port.getSection.bind(port)),
    createSession: through("createSession", port.createSession.bind(port)),
    submitResults: through("submitResults", port.submitResults.bind(port)),
    endSession: through("endSession", port.endSession.bind(port)),
    endSection: through("endSection", port.endSection.bind(port)),
  };
}

/** What a candidate did in a sitting. */
interface Sitting {
  /** The state at the end. */
  readonly state: DeliveryState;
  /** The item references in the order the candidate was presented them. */
  readonly refs: readonly string[];
}

/**
 * Plays a candidate through the engine and a CAT engine. The host stores the state between steps as JSON, and answers the
 * requests of the CAT engine with `ports` in turn, so that no step can rely on what an earlier port held. The candidate
 * answers with the identifier of a choice, or `null` to skip, and leaves the test after `leaveAfter` items.
 */
async function sit(
  engine: Engine,
  ports: readonly CatPort[],
  answer: (ref: string, position: number) => string | null,
  leaveAfter = Number.POSITIVE_INFINITY,
): Promise<Sitting> {
  let clock = 0;
  const tick = (): number => (clock += 10);
  const act = (state: DeliveryState, action: Parameters<typeof stamp>[1]): DeliveryState => {
    const step = engine.apply(state, stamp(state, action, tick()));
    if (!step.ok)
      throw new Error(`The action ${action.type} was refused: ${step.refusal.code}: ${step.refusal.message}`);
    return step.state;
  };
  const started = engine.start({ seed: 1, at: 0 });
  if (!started.ok) throw new Error(`The start was refused: ${started.refusal.code}.`);
  let state = started.state;
  let turn = 0;
  const drain = async (): Promise<void> => {
    const port = ports[turn++ % ports.length] ?? fail("A sitting needs a port.");
    state = deserializeState(serializeState(await drainCat(engine, state, port, tick)));
  };
  await drain();
  const refs: string[] = [];
  while (state.current !== undefined) {
    const item = state.current;
    refs.push(item.ref);
    const choice = answer(item.ref, refs.length - 1);
    if (choice === null) {
      state = act(state, { type: "skip", item });
    } else {
      state = act(state, {
        type: "set-responses",
        item,
        responses: new Map([["RESPONSE", single("identifier", choice)]]),
      });
      state = act(state, { type: "submit", item });
    }
    await drain();
    if (refs.length >= leaveAfter) break;
    state = act(state, { type: "move", to: "next" });
  }
  if (state.status !== "ended") {
    state = act(state, { type: "end-test" });
    await drain();
  }
  return { state, refs };
}

const fail = (message: string): never => {
  throw new Error(message);
};

/** The `SCORE` of each item result, by item reference, and the `TOTAL` of the test. */
function scoresOf(engine: Engine, state: DeliveryState): { scores: Map<string, number>; total: number | undefined } {
  const results = engine.results(state);
  const numberOf = (variables: readonly ResultVariable[], identifier: string): number | undefined => {
    const variable = variables.find((candidate) => candidate.identifier === identifier);
    return variable?.kind === "outcome" &&
      variable.value?.cardinality === "single" &&
      typeof variable.value.value === "number"
      ? variable.value.value
      : undefined;
  };
  return {
    scores: new Map(
      results.itemResults.map(({ identifier, variables }) => [identifier, numberOf(variables, "SCORE") ?? Number.NaN]),
    ),
    total: numberOf(results.testResult?.variables ?? [], "TOTAL"),
  };
}

describe("an adaptive section through the runtime's engine", () => {
  const EXAM_LENGTH = 4;
  const settings = { length: EXAM_LENGTH };
  /** The candidate answers right at the even positions of the test and wrong at the odd ones. */
  const alternatingChoice = (_ref: string, position: number): string => (position % 2 === 0 ? "B" : "A");

  /** Two ports of two host processes over one store: the first deploys, and the sittings alternate between them. */
  async function twoProcesses(pkg: QtiPackage, log: string[] = []) {
    const sections = memoryStore();
    const first = spied("first", measurekitCatPort({ sections, seeds: () => 12345 }), log);
    const second = spied("second", measurekitCatPort({ sections, seeds: () => 999 }), log);
    const { engine, catSections } = await examEngine(pkg, first);
    return { engine, catSections, sections, ports: [first, second] as const, log };
  }

  it("[T99] deploys the section, and presents the items that measurekit selects, the ports of two processes taking turns", async () => {
    const { engine, catSections, sections, ports, log } = await twoProcesses(examPackage(BANK, settings));
    expect(catSections).toEqual(
      new Map([["cat", { prefix: PREFIX, sectionIdentifier: await sectionIdentifier(sectionDataOf(settings, BANK)) }]]),
    );
    expect(sections.kept.size).toBe(1);

    const { state, refs } = await sit(engine, ports, alternatingChoice);
    expect(refs).toEqual(measurekitItems(EXAM_LENGTH, (_item, position) => (position % 2 === 0 ? 1 : 0)));
    expect(refs).toHaveLength(EXAM_LENGTH);
    expect(state.status).toBe("ended");

    // Create Session once, then Submit Results after each item, each request to the other process; the engine of the runtime
    // ends the session on the empty stage, so it never asks for End Session.
    expect(log).toEqual([
      "first createSection",
      "first getSection",
      "first createSession",
      "second submitResults",
      "first submitResults",
      "second submitResults",
      "first submitResults",
    ]);
  });

  it("[T99] reports the items in the order they were presented, scored by response processing, and sums them", async () => {
    const { engine, ports } = await twoProcesses(examPackage(BANK, settings));
    const { state, refs } = await sit(engine, ports, alternatingChoice);
    const { scores, total } = scoresOf(engine, state);
    expect([...scores.keys()]).toEqual(refs);
    expect([...scores.values()]).toEqual([1, 0, 1, 0]);
    expect(total).toBe(2);
  });

  it("[T99] keeps the session of the candidate in the state of the engine, and the port keeps none", async () => {
    const { engine, ports, sections } = await twoProcesses(examPackage(BANK, settings));
    const { state } = await sit(engine, ports, alternatingChoice);
    const [session] = state.cat;
    expect(session).toMatchObject({ section: "cat", status: "ended", sessionIdentifier: "12345" });
    expect(JSON.parse(session?.sessionState ?? "null")).toMatchObject({ seed: 12345, state: { next: null } });
    expect([...sections.kept.keys()]).toHaveLength(1);
  });

  it("[T99] takes an item that the candidate skipped as category 0, as the report without a SCORE says", async () => {
    const { engine, ports } = await twoProcesses(examPackage(BANK, settings));
    const answers = (_ref: string, position: number): string | null => (position === 1 ? null : "B");
    const { state, refs } = await sit(engine, ports, answers);
    expect(refs).toEqual(measurekitItems(EXAM_LENGTH, (_item, position) => (position === 1 ? 0 : 1)));
    expect(scoresOf(engine, state).total).toBe(3);
  });

  it("[T99] ends the session at the engine when the candidate leaves before the CAT engine ended it", async () => {
    const { engine, ports, log } = await twoProcesses(examPackage(BANK, settings));
    const { state, refs } = await sit(engine, ports, () => "B", 2);
    expect(refs).toEqual(measurekitItems(EXAM_LENGTH, () => 1).slice(0, 2));
    expect(state.status).toBe("ended");
    expect(log.at(-1)).toMatch(/ endSession$/);
    expect(log.filter((entry) => entry.endsWith("endSession"))).toHaveLength(1);
    expect(scoresOf(engine, state).scores.size).toBe(2);
  });

  it("[T99] presents a module of a panel as a stage of its length, and routes by the estimate", async () => {
    const sections = memoryStore();
    const log: string[] = [];
    const panel = (name: string) =>
      spied(name, measurekitPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) }), log);
    const first = panel("first");
    const second = panel("second");
    const { engine } = await examEngine(examPackage(PANEL_BANK, PANEL_SETTINGS), first);
    const { state, refs } = await sit(engine, [first, second], () => "B");
    expect(refs).toEqual(["r1", "r2", "r3", "r4", "h1", "h2", "h3"]);
    expect(refs).toEqual(
      measurekitModules(1, () => 1).flatMap(
        (id) => PANEL_SETTINGS.stages.flatMap(({ modules }) => modules).find((module) => module.id === id)?.items ?? [],
      ),
    );
    expect(scoresOf(engine, state).total).toBe(7);
    // The module is the stage: Submit Results is made when its last item is submitted, not after each item.
    expect(log.filter((entry) => entry.endsWith("submitResults"))).toHaveLength(2);
    const wrong = await sit(engine, [first, second], () => "A");
    expect(wrong.refs).toEqual(["r1", "r2", "r3", "r4", "e1", "e2", "e3"]);
  });
});

describe("properties", () => {
  const bank = fc
    .array(
      fc.record({
        a: fc.double({ min: 0.4, max: 2.5, noNaN: true }),
        b: fc.double({ min: -3, max: 3, noNaN: true }),
        c: fc.double({ min: 0, max: 0.3, noNaN: true }),
      }),
      { minLength: 3, maxLength: 10 },
    )
    .map((items): Bank[] => items.map((item, index) => ({ id: `q${index + 1}`, ...item })));

  it("[T99] presents the stages of measurekit's simulateAdaptiveTest at the same responses", async () => {
    await fc.assert(
      fc.asyncProperty(
        bank,
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        async (items, length, theta, seed) => {
          const pool = items.map(
            ({ id, a = 1, b, c = 0 }): TestItem<LogisticParameters> => ({
              id,
              model: threeParameterLogistic,
              parameters: { a, b, c, d: 1 },
            }),
          );
          const simulated = simulateAdaptiveTest(
            adaptiveTest({ pool, stopping: testLength(length) }),
            [theta],
            createRandom(seed),
          ).persons[0]?.state;
          if (simulated === undefined) throw new Error("The simulation has no person.");
          const port = measurekitCatPort({ sections: memoryStore(), seeds: () => seed });
          const section = (await port.createSection(PREFIX, sectionDataOf({ length }, items))).sectionIdentifier;
          const answers = new Map(simulated.items.map((id, index) => [id, simulated.responses[index] ?? 0]));
          const run = await drive(port, section, (item) => answers.get(item) ?? 0);
          expect(run.items).toEqual(simulated.items);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("[T99] gives the same stages for the same seed and responses, in any process", async () => {
    await fc.assert(
      fc.asyncProperty(
        bank,
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 12, maxLength: 12 }),
        async (items, seed, responses) => {
          const sections = memoryStore();
          const section = (
            await measurekitCatPort({ sections, seeds: () => seed }).createSection(
              PREFIX,
              sectionDataOf({ length: 6 }, items),
            )
          ).sectionIdentifier;
          const answers = (_item: string, position: number): number => responses[position] ?? 0;
          const one = await drive(measurekitCatPort({ sections, seeds: () => seed }), section, answers);
          const two = await drive(measurekitCatPort({ sections, seeds: () => seed }), section, answers);
          expect(two).toEqual(one);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("[T99] gives no two steps of any two sessions the same seed", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 0, max: 2 ** 21 - 1 })),
        fc.tuple(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 0, max: 2 ** 21 - 1 })),
        ([seed, step], [otherSeed, otherStep]) => {
          fc.pre(seed !== otherSeed || step !== otherStep);
          expect(stepSeed(seed, step)).not.toBe(stepSeed(otherSeed, otherStep));
          expect(Number.isSafeInteger(stepSeed(seed, step))).toBe(true);
        },
      ),
    );
  });

  it("[T99] writes usage data and reads back the parameters of the bank", () => {
    fc.assert(
      fc.property(bank, (items) => {
        expect(readItems(bytes(usageXml(items)))).toEqual(
          items.map(({ id, a = 1, b, c = 0, d = 1 }) => ({ id, a, b, c, d })),
        );
      }),
    );
  });

  it("[T99] gives the identifier of a section that depends on its data only", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.option(fc.string(), { nil: undefined }), async (configuration, usage) => {
        const data: SectionData = {
          sectionConfiguration: configuration,
          ...(usage === undefined ? {} : { qtiUsagedata: usage }),
        };
        const identifier = await sectionIdentifier(data);
        expect(identifier).toMatch(/^[0-9a-f]{64}$/);
        expect(await sectionIdentifier({ ...data })).toBe(identifier);
        expect(await sectionIdentifier({ ...data, sectionConfiguration: `${configuration}=` })).not.toBe(identifier);
      }),
    );
  });
});
