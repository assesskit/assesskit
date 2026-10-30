// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and JSON fields are those of their specifications.
import type { AdaptiveSelection } from "@luthfanwakan/olah/asi";
import { type CatPort, isSessionEnd, type SectionData } from "@luthfanwakan/olah/cat";
import {
  createEngine,
  type DeliveryState,
  deserializeState,
  drainCat,
  type Engine,
  serializeState,
  stamp,
} from "@luthfanwakan/olah/delivery";
import { CP_NAMESPACE } from "@luthfanwakan/olah/metadata";
import { openPackage, packageResolvers, type QtiPackage } from "@luthfanwakan/olah/package";
import type { AssessmentResult, ResultVariable } from "@luthfanwakan/olah/results";
import { container, record, single, type Value } from "@luthfanwakan/olah/values";
import { createRandom, DataError as TakarDataError } from "@luthfanwakan/takar";
import {
  adaptiveTest,
  multistageTest,
  type PoolItem,
  simulateAdaptiveTest,
  type TestState,
  testLength,
} from "@luthfanwakan/takar/cat";
import {
  generalizedPartialCredit,
  type LogisticParameters,
  type TestItem,
  threeParameterLogistic,
  twoParameterLogistic,
} from "@luthfanwakan/takar/irt";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64, readJson, toHex } from "../src/cat/encoding.js";
import {
  type CatFetch,
  type CatFetchRequest,
  type DeployedCatSection,
  deployCatSections,
  type OAuthClientCredentials,
  restCatPort,
  type SectionStore,
  takarCatPort,
  takarPanelPort,
} from "../src/cat/index.js";
import { DEFAULT_SCALING_CONSTANT, poolOf } from "../src/cat/pool.js";
import { responseTo, scoreCategory } from "../src/cat/response.js";
import { assessmentResultFromJson, assessmentResultToJson, readStage } from "../src/cat/rest-json.js";
import { readAdaptiveSection, readPanelSection, sectionIdentifier } from "../src/cat/section.js";
import { checkSessionSeed, parseSessionState, readProgress, stepSeed } from "../src/cat/session-state.js";
import { readItems } from "../src/cat/usage.js";
import { DataError, ServiceError } from "../src/index.js";
import { type Bank, base64, drive, memoryStore, PREFIX, resultsOf, sectionDataOf, usageXml } from "./cat-fixture.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = <T = never>(text: string): T => JSON.parse(text);

/** Passes a value through JSON, which drops what JSON does not carry. */
const viaJson = <T = never>(value: unknown): T => JSON.parse(JSON.stringify(value));

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Returns the message of the error a promise rejects with, after checking that it is a DataError of tempuh. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("The promise did not reject.");
}

const BANK: readonly Bank[] = [
  { id: "q1", a: 1.2, b: -1.5, c: 0.2 },
  { id: "q2", a: 0.9, b: -0.6, c: 0.15 },
  { id: "q3", a: 1.5, b: 0, c: 0.2 },
  { id: "q4", a: 1.1, b: 0.7, c: 0.25 },
  { id: "q5", a: 1.4, b: 1.4, c: 0.1 },
  { id: "q6", a: 1, b: 2 },
];

/** The same items as takar's three-parameter logistic items, to compare with takar without the code of the port. */
const takarPool: readonly TestItem<LogisticParameters>[] = BANK.map(({ id, a = 1, b, c = 0 }) => ({
  id,
  model: threeParameterLogistic,
  parameters: { a, b, c, d: 1 },
}));

/** Item ids of the administered items of a takar state. */
const itemsOf = (state: TestState): readonly string[] => state.items;

/** Answers of a candidate that alternate, so that the estimate moves both ways. */
const alternating = (_item: string, position: number): number => (position % 2 === 0 ? 1 : 0);

/** The items that takar administers for the same bank and answers, with the seeds of the steps as the port documents them. */
function takarItems(length: number, answers: (item: string, position: number) => number, seed = 12345): string[] {
  const test = adaptiveTest({ pool: takarPool, stopping: testLength(length) });
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

describe("encoding", () => {
  it("[T99] writes bytes as two lowercase hexadecimal digits each", () => {
    expect(toHex(Uint8Array.from([0, 15, 16, 255]))).toBe("000f10ff");
    expect(toHex(new Uint8Array())).toBe("");
  });

  it("[T99] reads base64 text of a UTF-8 JSON file", () => {
    expect(readJson(base64('{"length":3,"note":"é"}'), "The file")).toEqual({ length: 3, note: "é" });
    expect(decodeBase64("AAH/", "The file")).toEqual(Uint8Array.from([0, 1, 255]));
  });

  it("[T99] rejects text that is not base64, bytes that are not UTF-8 and text that is not JSON", () => {
    expect(() => decodeBase64("not base64!", "The file")).toThrow(
      new DataError("The file must be base64 text (RFC 4648), found text that is not."),
    );
    expect(() => readJson("/w==", "The file")).toThrow(
      new DataError("The file must be UTF-8 text, found bytes that are not."),
    );
    expect(() => readJson(base64("{"), "The file")).toThrow(
      new DataError("The file must be JSON text, found text that is not."),
    );
    expect(() => readJson("", "The file")).toThrow(DataError);
  });
});

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

  it("[T99] multiplies a by 1.702 so that a bank on the normal-ogive metric is on takar's scale", () => {
    const [item] = poolOf([{ id: "x", a: 1.2, b: 0.3, c: 0.2, d: 1 }], [], 1.702);
    if (item === undefined) throw new Error("The pool has no item.");
    for (const [theta, ogive, logistic] of Ogive) {
      expect(probability(item, theta)).toBeCloseTo(logistic, 12);
      expect(Math.abs(probability(item, theta) - ogive)).toBeLessThan(HaleyBound);
    }
  });

  it("[T99] takes a as it is with the default constant 1, takar's scale D = 1", () => {
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
    await rejects(json("null"), /^The section data must be an object, found null\.$/);
    await rejects({ sectionConfiguration: 5 }, /^The sectionConfiguration of the section data must be a string/);
    await rejects(
      { sectionConfiguration: "e30=", qtiUsagedata: null },
      /^The qtiUsagedata of the section data must be a string/,
    );
    await rejects({ sectionConfiguration: "e30=", extra: 1 }, /^The section data has the properties/);
    await rejects(sectionDataOf({}), /^The length of the settings must be a positive integer, found undefined\.$/);
    await rejects(sectionDataOf({ length: 0 }), /^The length of the settings must be a positive integer, found 0\.$/);
    await rejects(sectionDataOf({ length: 2, speed: 1 }), /^The settings of an adaptive section has the properties/);
    await rejects(
      sectionDataOf({ length: 2, contentTargets: { a: "x" } }),
      /^The content target of the area "a" must be a number/,
    );
    await rejects(
      sectionDataOf({ length: 2, contentTargets: [] }),
      /^The contentTargets of the settings must be an object/,
    );
    await rejects(
      sectionDataOf({ length: 2, enemies: [["a", 5]] }),
      /^An item identifier of an enemy set must be a non-empty string/,
    );
    await rejects(sectionDataOf({ length: 2, enemies: "a" }), /^The enemies of the settings must be an array/);
    await rejects(sectionDataOf([]), /^The settings of an adaptive section must be a JSON object/);
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
});

/** Creates a port over a store, with the section in it, and returns the section's identifier. */
async function deployed(port: CatPort, data: SectionData): Promise<string> {
  return (await port.createSection(PREFIX, data)).sectionIdentifier;
}

describe("takarCatPort", () => {
  const settings = { length: 4 };
  const data = sectionDataOf(settings, BANK);
  const seeds = (): number => 12345;

  it("[T99] presents the items that takar's adaptive test selects, one item to a stage", async () => {
    const sections = memoryStore();
    const port = takarCatPort({ sections, seeds });
    const section = await deployed(port, data);
    const run = await drive(port, section, alternating);
    expect(run.items).toEqual(takarItems(4, alternating));
    expect(run.items).toHaveLength(4);
    expect(run.stages.every((stage) => stage.length === 1)).toBe(true);
  });

  it("[T99] answers Create Session with a one-item stage, the session seed as identifier and the state in sessionState", async () => {
    const port = takarCatPort({ sections: memoryStore(), seeds });
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
    const port = takarCatPort({ sections: memoryStore(), seeds });
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
    const first = takarCatPort({ sections, seeds });
    const second = takarCatPort({ sections, seeds: () => 999 });
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
    const port = takarCatPort({ sections, seeds });
    const section = await deployed(port, data);
    expect(section).toBe(await sectionIdentifier(data));
    const stored = sections.kept.get(section);
    expect(await deployed(port, data)).toBe(section);
    expect(sections.kept.size).toBe(1);
    expect(sections.kept.get(section)).toBe(stored);
    expect(JSON.parse(stored ?? "null")).toMatchObject({ kind: "adaptive", length: 4, data });
  });

  it("[T99] returns the section data and the pool from Get Section, so that CAT 1.0's checks on the pool can run", async () => {
    const port = takarCatPort({ sections: memoryStore(), seeds });
    const section = await deployed(port, data);
    expect(await port.getSection(PREFIX, section)).toEqual({
      sectionData: data,
      items: { itemIdentifiers: BANK.map(({ id }) => id) },
    });
  });

  it("[T99] ends a session and a section without change, because the port holds no session and sections are shared", async () => {
    const sections = memoryStore();
    const port = takarCatPort({ sections, seeds });
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
      const port = takarCatPort({
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
    const port = takarCatPort({
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
    const port = takarCatPort({ sections: memoryStore(), seeds, category: () => 0 });
    const section = await deployed(port, data);
    const run = await drive(port, section, () => 5);
    expect(run.items).toEqual(takarItems(4, () => 0));
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
    const port = takarCatPort({ sections: memoryStore(), seeds, pool: () => pool });
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
    const port = takarCatPort({
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
    const bad = takarCatPort({ sections: memoryStore(), seeds: () => json("-1") });
    const other = await deployed(bad, data);
    expect(await rejection(bad.createSession(PREFIX, other, {}))).toMatch(
      /^A session seed must be an integer from 0 to 4294967295/,
    );
  });

  it("[T99] refuses requests it cannot answer: unknown or wrong sections, a missing or altered sessionState, a missing result", async () => {
    const sections = memoryStore();
    const port = takarCatPort({ sections, seeds });
    const section = await deployed(port, data);
    const panel = takarPanelPort({ sections, panels: () => ({ cuts: new Map() }) });
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
    const port = takarCatPort({ sections: memoryStore(), seeds });
    expect(await rejection(port.createSection(PREFIX, sectionDataOf({ length: 2 })))).toBe(
      "A section needs items: the usage data and the option pool give none.",
    );
    await expect(
      port.createSection(PREFIX, sectionDataOf({ length: 2, contentTargets: { algebra: 1 } }, BANK)),
    ).rejects.toThrow(TakarDataError);
    await expect(
      port.createSection(PREFIX, sectionDataOf({ length: 2, enemies: [["q1", "nope"]] }, BANK)),
    ).rejects.toThrow(TakarDataError);
    expect(await rejection(port.createSection(PREFIX, json('{"qtiUsagedata":"x"}')))).toMatch(
      /^The sectionConfiguration/,
    );
    const wrongPool = takarCatPort({ sections: memoryStore(), seeds, pool: () => json('"x"') });
    expect(await rejection(wrongPool.createSection(PREFIX, data))).toMatch(
      /^The option pool must return an array of items/,
    );
  });

  it("[T99] checks its options", () => {
    const sections = memoryStore();
    expect(() => takarCatPort(json("null"))).toThrow(new DataError("The options must be an object, found null."));
    expect(() => takarCatPort({ sections, seeds: 1 } as never)).toThrow(/^The option seeds must be a function/);
    expect(() => takarCatPort({ seeds } as never)).toThrow(
      /^The option sections must be an object with the methods put and get/,
    );
    expect(() => takarCatPort({ sections: {} as SectionStore, seeds })).toThrow(DataError);
    expect(() => takarCatPort({ sections, seeds, pool: null as never })).toThrow(/^The option pool must be a function/);
    expect(() => takarCatPort({ sections, seeds, category: null as never })).toThrow(
      /^The option category must be a function/,
    );
    expect(() => takarCatPort({ sections, seeds, scalingConstant: 0 })).toThrow(
      new DataError("The option scalingConstant must be a positive number, found 0."),
    );
    expect(() => takarCatPort({ sections, seeds, scalingConstant: null as never })).toThrow(DataError);
    expect(() => takarCatPort({ sections, seeds, speed: 1 } as never)).toThrow(
      /^The options has the properties "sections", "seeds"/,
    );
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

/** takar's multistage test of the same panel, built with takar's own models. */
function takarModules(scale = 1, answers: (item: string) => number): string[] {
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

describe("takarPanelPort", () => {
  it("[T100] routes a candidate by the estimate of theta, as takar's multistage test does", async () => {
    const port = takarPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    for (const answers of [() => 1, () => 0, (item: string) => (item.startsWith("r") ? 1 : 0)]) {
      const run = await drive(port, section, answers);
      expect(modulesOf(run)).toEqual(takarModules(1, answers));
    }
    expect(modulesOf(await drive(port, section, () => 1))).toEqual(["routing", "hard"]);
    expect(modulesOf(await drive(port, section, () => 0))).toEqual(["routing", "easy"]);
  });

  it("[T100] presents a module as one stage with all its items, in order, and keeps no session", async () => {
    const sections = memoryStore();
    const port = takarPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    const created = await port.createSession(PREFIX, section, {});
    expect(created.sessionIdentifier).toBe(section);
    expect(created.nextItems).toEqual({ itemIdentifiers: ["r1", "r2", "r3", "r4"], stageLength: 4 });
    const request = {
      assessmentResult: resultsOf(new Map(["r1", "r2", "r3", "r4"].map((id) => [id, 1]))),
      ...(created.sessionState === undefined ? {} : { sessionState: created.sessionState }),
    };
    const other = takarPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) });
    const answered = await other.submitResults(PREFIX, section, section, request);
    expect(answered.nextItems).toEqual({ itemIdentifiers: ["h1", "h2", "h3"], stageLength: 3 });
    expect(await other.submitResults(PREFIX, section, section, request)).toEqual(answered);
  });

  it("[T100] ends the session with the empty stage after the last stage", async () => {
    const port = takarPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    const run = await drive(port, section, () => 1);
    const last = JSON.parse(run.sessionState ?? "null");
    expect(last.next).toBeNull();
    expect(last.modules).toEqual(["routing", "hard"]);
  });

  it("[T100] returns the section data and every item of the panel from Get Section", async () => {
    const port = takarPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    const section = await deployed(port, PANEL_DATA);
    expect(await port.getSection(PREFIX, section)).toEqual({
      sectionData: PANEL_DATA,
      items: { itemIdentifiers: PANEL_BANK.map(({ id }) => id) },
    });
    await expect(port.endSession(PREFIX, section, section)).resolves.toBeUndefined();
    await expect(port.endSection(PREFIX, section)).resolves.toBeUndefined();
  });

  it("[T100] multiplies the discrimination with scalingConstant", async () => {
    const port = takarPanelPort({
      sections: memoryStore(),
      panels: () => ({ cuts: PANEL_CUTS }),
      scalingConstant: 1.702,
    });
    const section = await deployed(port, PANEL_DATA);
    const answers = (item: string): number => (item.startsWith("r") ? (item === "r1" ? 0 : 1) : 1);
    expect(modulesOf(await drive(port, section, answers))).toEqual(takarModules(1.702, answers));
  });

  it("[T100] fails at createSection for a panel that cannot run: wrong cut points, an item twice", async () => {
    const wrongCuts = takarPanelPort({
      sections: memoryStore(),
      panels: () => ({ cuts: new Map([["routing", [0]]]) }),
    });
    await expect(wrongCuts.createSection(PREFIX, PANEL_DATA)).rejects.toThrow(TakarDataError);
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
    const port = takarPanelPort({ sections: memoryStore(), panels: () => ({ cuts: PANEL_CUTS }) });
    await expect(port.createSection(PREFIX, repeated)).rejects.toThrow();
  });

  it("[T100] refuses requests it cannot answer and checks its options", async () => {
    const sections = memoryStore();
    const port = takarPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) });
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
    const noCuts = takarPanelPort({ sections, panels: () => json("{}") });
    expect(await rejection(noCuts.getSection(PREFIX, section))).toMatch(/^The cuts of the panel of the section/);
    const noPanel = takarPanelPort({ sections, panels: () => json("null") });
    expect(await rejection(noPanel.getSection(PREFIX, section))).toMatch(/^The option panels must return an object/);
    expect(() => takarPanelPort(json("null"))).toThrow(DataError);
    expect(() => takarPanelPort({ sections, panels: 3 as never })).toThrow(/^The option panels must be a function/);
    expect(() => takarPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }), scalingConstant: -1 })).toThrow(
      DataError,
    );
    expect(() => takarPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }), seeds: () => 1 } as never)).toThrow(
      DataError,
    );
    const adaptive = takarCatPort({ sections, seeds: () => 1 });
    const adaptiveSection = await deployed(adaptive, sectionDataOf({ length: 2 }, BANK));
    expect(await rejection(port.getSection(PREFIX, adaptiveSection))).toMatch(/is a "adaptive" section/);
  });
});

const DATESTAMP = "2026-10-30T10:05:00";

/** A result as the delivery engine reports it (RR §2.3.1), with every kind of variable the binding has a place for. */
const RESULT: AssessmentResult = {
  context: {
    sourcedId: "candidate1",
    sessionIdentifiers: [{ sourceId: "https://delivery.example", identifier: "session1" }],
  },
  testResult: {
    identifier: "test1",
    datestamp: DATESTAMP,
    variables: [
      { kind: "outcome", identifier: "TOTAL", cardinality: "single", baseType: "float", value: single("float", 1) },
      { kind: "context", identifier: "LEVEL", cardinality: "single", baseType: "integer", value: single("integer", 2) },
    ],
    supports: [{ name: "spoken", assignment: "assigned" }],
  },
  itemResults: [
    {
      identifier: "i1",
      sequenceIndex: 1,
      datestamp: DATESTAMP,
      sessionStatus: "final",
      variables: [
        {
          kind: "response",
          identifier: "RESPONSE",
          cardinality: "single",
          baseType: "identifier",
          candidateResponse: single("identifier", "B"),
          correctResponse: { interpretation: "The capital", value: single("identifier", "A") },
          choiceSequence: ["B", "A"],
          scoreStatus: "scored",
          answeredStatus: "answered",
          extensions: [],
        },
        { kind: "template", identifier: "N", cardinality: "single", baseType: "integer", value: single("integer", 4) },
        {
          kind: "outcome",
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          value: single("float", 0),
          view: ["candidate", "scorer"],
          normalMaximum: 1,
          externalScored: "human",
          variableIdentifierRef: "RESPONSE",
        },
      ],
      candidateComment: "Unsure",
      supports: [{ name: "spoken", assignment: "assigned" }],
    },
    {
      identifier: "i2",
      sequenceIndex: 2,
      datestamp: DATESTAMP,
      sessionStatus: "pendingExternalScoring",
      variables: [
        {
          kind: "response",
          identifier: "PAIRS",
          cardinality: "multiple",
          baseType: "pair",
          candidateResponse: container("multiple", "pair", [
            ["A", "B"],
            ["C", "D"],
          ]),
          extensions: [],
        },
        {
          kind: "response",
          identifier: "NOTHING",
          cardinality: "single",
          baseType: "string",
          candidateResponse: null,
          extensions: [],
        },
        {
          kind: "outcome",
          identifier: "DETAIL",
          cardinality: "record",
          value: record([
            ["points", single("float", 1.5)],
            ["label", { cardinality: "single", baseType: "string", value: "ok" }],
          ]),
        },
      ],
      supports: [],
    },
  ],
};

/** The same result in the JSON of the binding (https://www.imsglobal.org/spec/cat/v1p0/bind, §5.2.8, §5.3, §6.11). */
const RESULT_JSON = {
  context: {
    sourcedId: "candidate1",
    sessionIdentifiers: [{ sourceID: "https://delivery.example", identifier: "session1" }],
  },
  testResult: {
    identifier: "test1",
    datestamp: DATESTAMP,
    responseVariables: [],
    templateVariables: [],
    outcomeVariables: [{ identifier: "TOTAL", cardinality: "single", baseType: "float", value: [{ value: "1" }] }],
  },
  itemResult: [
    {
      identifier: "i1",
      sequenceIndex: 1,
      datestamp: DATESTAMP,
      sessionStatus: "final",
      responseVariables: [
        {
          identifier: "RESPONSE",
          cardinality: "single",
          baseType: "identifier",
          choiceSequence: ["B", "A"],
          correctResponse: { interpretation: "The capital", value: [{ value: "A" }] },
          candidateResponse: { value: [{ value: "B" }] },
        },
      ],
      templateVariables: [{ identifier: "N", cardinality: "single", baseType: "integer", value: [{ value: "4" }] }],
      outcomeVariables: [
        {
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          view: ["candidate", "scorer"],
          normalMaximum: 1,
          value: [{ value: "0" }],
        },
      ],
      candidateComment: "Unsure",
    },
    {
      identifier: "i2",
      sequenceIndex: 2,
      datestamp: DATESTAMP,
      sessionStatus: "pendingResponseProcessing",
      responseVariables: [
        {
          identifier: "PAIRS",
          cardinality: "multiple",
          baseType: "pair",
          candidateResponse: { value: [{ value: "A B" }, { value: "C D" }] },
        },
        { identifier: "NOTHING", cardinality: "single", baseType: "string", candidateResponse: { value: [] } },
      ],
      templateVariables: [],
      outcomeVariables: [
        {
          identifier: "DETAIL",
          cardinality: "record",
          value: [
            { fieldIdentifier: "points", baseType: "float", value: "1.5" },
            { fieldIdentifier: "label", baseType: "string", value: "ok" },
          ],
        },
      ],
    },
  ],
};

describe("rest-json", () => {
  it("[T101] writes an assessment result in the JSON of the binding: itemResult, sourceID, and the three lists of variables", () => {
    expect(JSON.parse(JSON.stringify(assessmentResultToJson(RESULT)))).toEqual(RESULT_JSON);
  });

  it("[T101] writes NULL as the absence of a value, and the status that waits for external scoring as pending processing", () => {
    const written = JSON.parse(JSON.stringify(assessmentResultToJson(RESULT)));
    expect(written.itemResult[1].responseVariables[1].candidateResponse).toEqual({ value: [] });
    expect(written.itemResult[1].sessionStatus).toBe("pendingResponseProcessing");
    expect(JSON.stringify(written)).not.toContain("externalScored");
    expect(JSON.stringify(written)).not.toContain("LEVEL");
  });

  it("[T101] reads the assessment result of an engine, with the lists of variables joined, and no context as no sessions", () => {
    const read = assessmentResultFromJson({
      testResult: {
        identifier: "t",
        datestamp: DATESTAMP,
        outcomeVariables: [
          {
            identifier: "THETA",
            cardinality: "single",
            baseType: "float",
            value: [{ value: "0.42" }],
            interpretation: "Ability",
            normalMinimum: -4,
            view: ["tutor"],
          },
          { identifier: "SE", cardinality: "single", baseType: "float", value: [] },
        ],
      },
      itemResult: [
        {
          identifier: "i1",
          sequenceIndex: 3,
          datestamp: DATESTAMP,
          sessionStatus: "initial",
          responseVariables: [
            {
              identifier: "R",
              cardinality: "ordered",
              baseType: "identifier",
              candidateResponse: { value: [{ value: "B" }, { value: "A" }] },
              correctResponse: { value: [{ value: "A" }, { value: "B" }] },
              choiceSequence: ["B", "A"],
            },
          ],
          templateVariables: [
            {
              identifier: "T",
              cardinality: "record",
              value: [{ fieldIdentifier: "f", baseType: "point", value: "1 2" }],
            },
          ],
          candidateComment: "hi",
        },
      ],
    });
    expect(read).toEqual({
      context: { sessionIdentifiers: [] },
      testResult: {
        identifier: "t",
        datestamp: DATESTAMP,
        variables: [
          {
            kind: "outcome",
            identifier: "THETA",
            cardinality: "single",
            baseType: "float",
            value: single("float", 0.42),
            interpretation: "Ability",
            normalMinimum: -4,
            view: ["tutor"],
          },
          { kind: "outcome", identifier: "SE", cardinality: "single", baseType: "float", value: null },
        ],
        supports: [],
      },
      itemResults: [
        {
          identifier: "i1",
          sequenceIndex: 3,
          datestamp: DATESTAMP,
          sessionStatus: "initial",
          variables: [
            {
              kind: "response",
              identifier: "R",
              cardinality: "ordered",
              baseType: "identifier",
              candidateResponse: container("ordered", "identifier", ["B", "A"]),
              correctResponse: { value: container("ordered", "identifier", ["A", "B"]) },
              choiceSequence: ["B", "A"],
              extensions: [],
            },
            {
              kind: "template",
              identifier: "T",
              cardinality: "record",
              value: record([["f", single("point", [1, 2])]]),
            },
          ],
          candidateComment: "hi",
          supports: [],
        },
      ],
    });
  });

  it("[T101] reads the context of an engine with its source identifiers", () => {
    const read = assessmentResultFromJson({
      context: { sourcedId: "c1", sessionIdentifiers: [{ sourceID: "https://engine.example", identifier: "s1" }] },
    });
    expect(read).toEqual({
      context: { sourcedId: "c1", sessionIdentifiers: [{ sourceId: "https://engine.example", identifier: "s1" }] },
      itemResults: [],
    });
  });

  it("[T101] rejects a result of the wrong form", () => {
    const variable = { identifier: "V", cardinality: "single", baseType: "float", value: [{ value: "1" }] };
    const itemResult = { identifier: "i", datestamp: DATESTAMP, sessionStatus: "final" };
    const withOutcome = (outcome: unknown): unknown => ({
      itemResult: [{ ...itemResult, outcomeVariables: [outcome] }],
    });
    const rejects: readonly (readonly [unknown, RegExp])[] = [
      [json("null"), /^The assessmentResult must be an object/],
      [{ itemResult: "x" }, /^The itemResult of a result must be an array/],
      [
        { itemResult: [{ ...itemResult, sessionStatus: "done" }] },
        /^The sessionStatus of an itemResult must be one of/,
      ],
      [
        { itemResult: [{ ...itemResult, sequenceIndex: -1 }] },
        /^The sequenceIndex of an itemResult must be a non-negative integer/,
      ],
      [{ itemResult: [{ identifier: "", datestamp: DATESTAMP }] }, /^The identifier of an itemResult/],
      [{ testResult: { identifier: "t" } }, /^The datestamp of the testResult/],
      [{ context: { sessionIdentifiers: [{ identifier: "s" }] } }, /^The sourceID of a session identifier/],
      [withOutcome({ ...variable, cardinality: "many" }), /^The cardinality of the outcome variable "V" must be/],
      [
        withOutcome({ ...variable, baseType: "number" }),
        /^The baseType of the outcome variable "V" must be a base type/,
      ],
      [withOutcome({ ...variable, baseType: undefined }), /is required unless its cardinality is record/],
      [
        withOutcome({ ...variable, value: [{ value: "1" }, { value: "2" }] }),
        /has the cardinality single and 2 values/,
      ],
      [withOutcome({ ...variable, value: [{ value: "one" }] }), /is not a float/],
      [withOutcome({ ...variable, value: [{ value: 1 }] }), /^A value of the outcome variable "V" must be a string/],
      [withOutcome({ ...variable, value: "1" }), /^The value of the outcome variable "V" must be an array/],
      [withOutcome({ ...variable, view: ["everyone"] }), /^A view of the outcome variable "V" must be one of/],
      [
        withOutcome({ ...variable, normalMaximum: "1" }),
        /^The normalMaximum of the outcome variable "V" must be a number/,
      ],
      [withOutcome({ ...variable, cardinality: "record", value: [{ value: "1" }] }), /^The fieldIdentifier of a field/],
      [
        withOutcome({ ...variable, cardinality: "record", value: [{ fieldIdentifier: "f", value: "1" }] }),
        /^The baseType of a field/,
      ],
      [
        withOutcome({
          ...variable,
          cardinality: "record",
          value: [{ fieldIdentifier: "f", baseType: "string", value: "" }],
        }),
        /cannot be an empty string/,
      ],
      [withOutcome(5), /^The outcome variables must be objects/],
      [
        { itemResult: [{ ...itemResult, responseVariables: [{ ...variable, candidateResponse: 5 }] }] },
        /^The candidateResponse of the response variable "V"/,
      ],
      [
        {
          itemResult: [
            { ...itemResult, responseVariables: [{ ...variable, candidateResponse: {}, choiceSequence: [5] }] },
          ],
        },
        /^A choice of the response variable "V" must be a string/,
      ],
      [
        {
          itemResult: [
            { ...itemResult, responseVariables: [{ ...variable, candidateResponse: {}, correctResponse: 5 }] },
          ],
        },
        /^The correctResponse of the response variable/,
      ],
    ];
    for (const [result, message] of rejects) {
      expect(() => assessmentResultFromJson(result), JSON.stringify(result)).toThrow(message);
    }
    expect(() => assessmentResultToJson(json("null"))).toThrow(DataError);
    expect(() => assessmentResultToJson(json('{"context":{},"itemResults":"x"}'))).toThrow(DataError);
  });

  it("[T101] reads an item stage with absent or null fields as the stage that ends the session", () => {
    expect(readStage({}, "stage")).toEqual({ itemIdentifiers: null, stageLength: null });
    expect(readStage({ itemIdentifiers: null, stageLength: null }, "stage")).toEqual({
      itemIdentifiers: null,
      stageLength: null,
    });
    expect(readStage({ itemIdentifiers: ["a"], stageLength: 1 }, "stage")).toEqual({
      itemIdentifiers: ["a"],
      stageLength: 1,
    });
    expect(() => readStage({ stageLength: -1 }, "stage")).toThrow(/^The stageLength of the stage/);
    expect(() => readStage(json("[]"), "stage")).toThrow(DataError);
  });
});

/** A request that the fake service received. */
interface Call {
  readonly url: string;
  readonly request: CatFetchRequest;
}

/** What the fake service answers: a status and the JSON of the body, or text, or none. */
interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const DEMOGRAPHICS = base64("demographics");
const PNP = base64("pnp");
const TOKEN_URL = "https://auth.example/oauth2/token";
const SCOPE = "https://purl.imsglobal.org/cat/v1p0/scope/api";
const CREDENTIALS: OAuthClientCredentials = {
  tokenUrl: TOKEN_URL,
  clientId: "tempuh",
  clientSecret: "secret/+",
  scope: SCOPE,
};
const TOKEN: Reply = {
  status: 200,
  body: { access_token: "tok1", token_type: "Bearer", expires_in: 3600, scope: SCOPE },
};

/** A service that records its requests, answers the token endpoint itself and leaves the rest to `reply`. */
function fakeService(reply: (call: Call, calls: readonly Call[]) => Reply = () => ({ status: 200, body: {} })): {
  readonly fetch: CatFetch;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    async fetch(url, request) {
      const call = { url, request };
      calls.push(call);
      const { status, body } = url === TOKEN_URL ? TOKEN : reply(call, calls);
      const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
      return { ok: status >= 200 && status < 300, status, text: async () => text };
    },
  };
}

/** The requests that went to the engine, without the token requests. */
const engineCalls = (calls: readonly Call[]): Call[] => calls.filter(({ url }) => url !== TOKEN_URL);

const bodyOf = (call: Call | undefined): unknown => JSON.parse(call?.request.body ?? "null");

describe("restCatPort", () => {
  const sectionData: SectionData = { sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: "bWV0YQ==" };

  it("[T101] asks the token endpoint for a bearer token with the client credentials of RFC 6749 §4.4", async () => {
    const service = fakeService(() => ({
      status: 200,
      body: { sectionData: {}, items: {}, section: { sectionConfiguration: "e30=" } },
    }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.getSection(PREFIX, "sec1");
    const [token, get] = service.calls;
    expect(token?.url).toBe(TOKEN_URL);
    expect(token?.request.method).toBe("POST");
    // The client identifier and secret are form-encoded before they are Basic credentials (RFC 6749 §2.3.1).
    expect(token?.request.headers).toEqual({
      Authorization: `Basic ${btoa("tempuh:secret%2F%2B")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    expect(token?.request.body).toBe(`grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`);
    expect(token?.request.redirect).toBe("error");
    expect(token?.request.signal).toBeInstanceOf(AbortSignal);
    expect(get?.request.headers).toEqual({ Authorization: "Bearer tok1", Accept: "application/json" });
  });

  it("[T101] creates a section: POST /sections with the configuration and usage data of SectionDType, and returns the identifier", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    expect(await port.createSection(PREFIX, sectionData)).toEqual({ sectionIdentifier: "sec1" });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections`);
    expect(call?.request.method).toBe("POST");
    expect(call?.request.headers["Content-Type"]).toBe("application/json");
    // SectionDType (binding §5.2.1): qtiMetadata is one QTI metadata record, and the metadata file is not sent.
    expect(bodyOf(call)).toEqual({ sectionConfiguration: "e30=", qtiUsagedata: "PD94" });
  });

  it("[T101] sends a section without usage data as the configuration alone, never a shape the binding lacks", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.createSection(PREFIX, { sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" });
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ sectionConfiguration: "e30=" });
  });

  it("[T101] gets a section: GET /sections/{id}, with the binding's section and items as section data and pool", async () => {
    const service = fakeService(() => ({
      status: 200,
      body: {
        items: { itemIdentifiers: ["i1", "i2"] },
        section: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
      },
    }));
    const port = restCatPort({ fetch: service.fetch, endpoint: `${PREFIX}/`, credentials: CREDENTIALS });
    expect(await port.getSection(PREFIX, "sec 1")).toEqual({
      sectionData: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
      items: { itemIdentifiers: ["i1", "i2"], stageLength: null },
    });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections/sec%201`);
    expect(call?.request.method).toBe("GET");
    expect(call?.request.body).toBeUndefined();
  });

  it("[T101] creates a session: POST /sections/{id}/sessions without the PNP unless sharePnp, prior data as key and value", async () => {
    const reply: Reply = {
      status: 201,
      body: {
        sessionIdentifier: "s1",
        nextItems: { itemIdentifiers: ["i1", "i2"], stageLength: 2 },
        sessionState: "st0",
      },
    };
    const request = {
      personalNeedsAndPreferences: PNP,
      demographics: DEMOGRAPHICS,
      priorData: [
        { name: "level", value: "B2" },
        { name: "attempts", value: 3 },
        { name: "tags", value: ["a", "b"] },
      ],
    };
    const priorData = [
      { key: "level", value: "B2" },
      { key: "attempts", value: "3" },
      { key: "tags", value: '["a","b"]' },
    ];
    for (const sharePnp of [undefined, false, true]) {
      const service = fakeService(() => reply);
      const port = restCatPort({
        fetch: service.fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
        ...(sharePnp === undefined ? {} : { sharePnp }),
      });
      expect(await port.createSession(PREFIX, "sec1", request)).toEqual({
        sessionIdentifier: "s1",
        nextItems: { itemIdentifiers: ["i1", "i2"], stageLength: 2 },
        sessionState: "st0",
      });
      const [call] = engineCalls(service.calls);
      expect(call?.url).toBe(`${PREFIX}/sections/sec1/sessions`);
      expect(bodyOf(call), String(sharePnp)).toEqual({
        ...(sharePnp === true ? { personalNeedsAndPreferences: PNP } : {}),
        demographics: DEMOGRAPHICS,
        priorData,
      });
    }
  });

  it("[T101] reads a Create Session answer without a stage as the end of the session, and needs the identifier", async () => {
    const answer = (body: unknown): Promise<unknown> =>
      restCatPort({
        fetch: fakeService(() => ({ status: 201, body })).fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      }).createSession(PREFIX, "sec1", {});
    expect(await answer({ sessionIdentifier: "s1" })).toEqual({
      sessionIdentifier: "s1",
      nextItems: { itemIdentifiers: [], stageLength: 0 },
    });
    expect(await rejection(answer({ nextItems: { itemIdentifiers: ["i1"] } }))).toMatch(
      /^The sessionIdentifier of the answer to Create Session/,
    );
    expect(await rejection(answer({ sessionIdentifier: "s1", nextItems: { itemIdentifiers: [1] } }))).toMatch(
      /^An item identifier of the nextItems/,
    );
    expect(await rejection(answer({ sessionIdentifier: "s1", sessionState: 5 }))).toMatch(
      /^The sessionState of the answer/,
    );
  });

  it("[T101] submits results: POST .../results with the assessment result of the binding and the sessionState", async () => {
    const service = fakeService(() => ({
      status: 201,
      body: {
        nextItems: { itemIdentifiers: ["i3"], stageLength: 1 },
        sessionState: "st2",
        assessmentResult: {
          testResult: {
            identifier: "test1",
            datestamp: "2026-10-30T10:06:00",
            outcomeVariables: [
              { identifier: "THETA", cardinality: "single", baseType: "float", value: [{ value: "0.42" }] },
            ],
          },
        },
      },
    }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const answered = await port.submitResults(PREFIX, "sec1", "s1", { assessmentResult: RESULT, sessionState: "st1" });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections/sec1/sessions/s1/results`);
    expect(call?.request.method).toBe("POST");
    expect(bodyOf(call)).toEqual({ assessmentResult: RESULT_JSON, sessionState: "st1" });
    expect(answered).toEqual({
      nextItems: { itemIdentifiers: ["i3"], stageLength: 1 },
      sessionState: "st2",
      assessmentResult: {
        context: { sessionIdentifiers: [] },
        testResult: {
          identifier: "test1",
          datestamp: "2026-10-30T10:06:00",
          variables: [
            {
              kind: "outcome",
              identifier: "THETA",
              cardinality: "single",
              baseType: "float",
              value: single("float", 0.42),
            },
          ],
          supports: [],
        },
        itemResults: [],
      },
    });
  });

  it("[T101] reads an answer without next items and without a state as the end of the session", async () => {
    const service = fakeService(() => ({ status: 201, body: {} }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const answered = await port.submitResults(PREFIX, "sec1", "s1", { assessmentResult: RESULT });
    expect(answered).toEqual({});
    expect(isSessionEnd(answered.nextItems)).toBe(true);
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ assessmentResult: RESULT_JSON });
  });

  it("[T101] ends a session and a section: DELETE, with an answer without a body", async () => {
    const service = fakeService(() => ({ status: 204 }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await expect(port.endSession(PREFIX, "sec1", "s1")).resolves.toBeUndefined();
    await expect(port.endSection(PREFIX, "sec1")).resolves.toBeUndefined();
    expect(engineCalls(service.calls).map(({ url, request }) => `${request.method} ${url}`)).toEqual([
      `DELETE ${PREFIX}/sections/sec1/sessions/s1`,
      `DELETE ${PREFIX}/sections/sec1`,
    ]);
  });

  it("[T101] keeps the token for the requests that follow, and asks again after a 401, then repeats the request once", async () => {
    let issued = 0;
    let expired = false;
    const calls: Call[] = [];
    const respond = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      text: async () => JSON.stringify(body),
    });
    const port = restCatPort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      async fetch(url, request) {
        calls.push({ url, request });
        if (url === TOKEN_URL) {
          issued += 1;
          return respond(200, { access_token: `tok${issued}`, token_type: "bearer" });
        }
        return expired && request.headers.Authorization === "Bearer tok1"
          ? respond(401, { imsx_codeMajor: "failure", imsx_severity: "error" })
          : respond(201, { sectionIdentifier: "sec1" });
      },
    });
    await port.createSection(PREFIX, sectionData);
    await port.createSection(PREFIX, sectionData);
    expect(issued).toBe(1);
    // The token has expired: the engine answers 401, and the request goes out again with a new token.
    expired = true;
    await port.createSection(PREFIX, sectionData);
    expect(issued).toBe(2);
    expect(
      engineCalls(calls)
        .slice(-2)
        .map(({ request }) => request.headers.Authorization),
    ).toEqual(["Bearer tok1", "Bearer tok2"]);
  });

  it("[T101] fails with a ServiceError that carries the status and the body of the answer", async () => {
    const status = { imsx_codeMajor: "failure", imsx_severity: "error", imsx_description: "Unknown Object" };
    const port = restCatPort({
      fetch: fakeService(() => ({ status: 404, body: status })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    const error = await port.getSection(PREFIX, "nope").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 404, body: JSON.stringify(status) });
    expect((error as ServiceError).message).toBe(
      `The CAT engine at ${PREFIX}/sections/nope answered GET with the status 404.`,
    );
  });

  it("[T101] fails with a ServiceError for a 401 after the new token, for a body that is not JSON and for a bad token answer", async () => {
    const denied = restCatPort({
      fetch: fakeService(() => ({ status: 401, body: {} })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    await expect(denied.endSection(PREFIX, "sec1")).rejects.toMatchObject({ status: 401 });
    const html = restCatPort({
      fetch: fakeService(() => ({ status: 200, body: "<html>" })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    await expect(html.getSection(PREFIX, "sec1")).rejects.toThrow(/answered with a body that is not JSON/);

    const badToken = async (reply: Reply): Promise<unknown> => {
      const calls: Call[] = [];
      const port = restCatPort({
        endpoint: PREFIX,
        credentials: CREDENTIALS,
        async fetch(url, request) {
          calls.push({ url, request });
          const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
          return { ok: reply.status < 300, status: reply.status, text: async () => text };
        },
      });
      return port.endSection(PREFIX, "sec1").catch((caught: unknown) => caught);
    };
    expect(await badToken({ status: 500, body: "oops" })).toMatchObject({ status: 500, body: "oops" });
    expect(await badToken({ status: 200, body: { token_type: "bearer" } })).toBeInstanceOf(ServiceError);
    expect(await badToken({ status: 200, body: { access_token: "t", token_type: "mac" } })).toBeInstanceOf(
      ServiceError,
    );
    expect(await badToken({ status: 200, body: "{" })).toBeInstanceOf(ServiceError);
    expect(await badToken({ status: 200, body: "[]" })).toBeInstanceOf(DataError);
  });

  it("[T101] asks for a token again after a failed token request, and passes on the error of fetch", async () => {
    let attempts = 0;
    const port = restCatPort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      async fetch(url) {
        if (url === TOKEN_URL) {
          attempts += 1;
          if (attempts === 1) throw new TypeError("network down");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ access_token: "t", token_type: "bearer" }),
          };
        }
        return { ok: true, status: 204, text: async () => "" };
      },
    });
    await expect(port.endSection(PREFIX, "sec1")).rejects.toThrow(new TypeError("network down"));
    await expect(port.endSection(PREFIX, "sec1")).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("[T101] aborts a request that takes longer than timeoutMs", async () => {
    const port = restCatPort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      timeoutMs: 20,
      fetch: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    });
    await expect(port.endSection(PREFIX, "sec1")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("[T101] sends nothing to another engine than the endpoint, and nothing over http", async () => {
    const service = fakeService();
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const message = `The prefix "https://evil.example/ims/cat/v1p0" is not the engine "${PREFIX}" that this port serves; the port sends nothing to another engine.`;
    for (const call of [
      () => port.createSection("https://evil.example/ims/cat/v1p0", sectionData),
      () => port.getSection("https://evil.example/ims/cat/v1p0", "sec1"),
      () => port.createSession("https://evil.example/ims/cat/v1p0", "sec1", {}),
      () => port.submitResults("https://evil.example/ims/cat/v1p0", "sec1", "s1", { assessmentResult: RESULT }),
      () => port.endSession("https://evil.example/ims/cat/v1p0", "sec1", "s1"),
      () => port.endSection("https://evil.example/ims/cat/v1p0", "sec1"),
    ]) {
      expect(await rejection(call())).toBe(message);
    }
    expect(service.calls).toEqual([]);
    expect(() =>
      restCatPort({ fetch: service.fetch, endpoint: "http://cat.example/ims/cat/v1p0", credentials: CREDENTIALS }),
    ).toThrow(
      new DataError('The option endpoint must be an absolute https URL, found "http://cat.example/ims/cat/v1p0".'),
    );
    expect(() =>
      restCatPort({
        fetch: service.fetch,
        endpoint: PREFIX,
        credentials: { ...CREDENTIALS, tokenUrl: "http://auth.example/token" },
      }),
    ).toThrow(/^The tokenUrl of the credentials must be an absolute https URL/);
  });

  it("[T101] takes the global fetch as it is", () => {
    expect(() => restCatPort({ fetch, endpoint: PREFIX, credentials: CREDENTIALS })).not.toThrow();
  });

  it("[T101] checks its options and its requests", async () => {
    const service = fakeService();
    const options = { fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS };
    const port = restCatPort(options);
    expect(() => restCatPort(json("null"))).toThrow(new DataError("The options must be an object, found null."));
    expect(() => restCatPort({ ...options, fetch: json("5") })).toThrow(/^The option fetch must be a function/);
    expect(() => restCatPort({ ...options, endpoint: json("5") })).toThrow(/^The option endpoint must be a string/);
    expect(() => restCatPort({ ...options, credentials: json("null") })).toThrow(
      /^The option credentials must be an object/,
    );
    for (const property of ["clientId", "clientSecret", "scope"]) {
      expect(() => restCatPort({ ...options, credentials: { ...CREDENTIALS, [property]: "" } }), property).toThrow(
        new DataError(`The ${property} of the credentials must be a non-empty string, found "".`),
      );
    }
    expect(() => restCatPort({ ...options, credentials: { ...CREDENTIALS, extra: 1 } as never })).toThrow(DataError);
    expect(() => restCatPort({ ...options, timeoutMs: 0 })).toThrow(
      new DataError("The option timeoutMs must be a positive number, found 0."),
    );
    expect(() => restCatPort({ ...options, timeoutMs: json("null") })).toThrow(DataError);
    expect(() => restCatPort({ ...options, sharePnp: json('"yes"') })).toThrow(
      new DataError('The option sharePnp must be true or false, found "yes".'),
    );
    expect(() => restCatPort({ ...options, speed: 1 } as never)).toThrow(/^The options has the properties/);
    expect(await rejection(port.createSection(PREFIX, json('{"sectionConfiguration":5}')))).toMatch(
      /^The sectionConfiguration/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json("null")))).toMatch(
      /^The request to create a session must be an object/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json('{"priorData":{}}')))).toMatch(
      /^The priorData of the request must be an array/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json('{"demographics":5}')))).toMatch(
      /^The demographics of the request/,
    );
    expect(
      await rejection(port.createSession(PREFIX, "sec1", { priorData: [{ name: "x", value: undefined }] })),
    ).toMatch(/^The value of the prior data "x" must be JSON/);
    expect(await rejection(port.createSession(PREFIX, "", {}))).toMatch(
      /^The section identifier must be a non-empty string/,
    );
    expect(await rejection(port.submitResults(PREFIX, "sec1", "", { assessmentResult: RESULT }))).toMatch(
      /^The session identifier must be a non-empty string/,
    );
    expect(await rejection(port.submitResults(PREFIX, "sec1", "s1", json('{"sessionState":5}')))).toMatch(
      /^The sessionState of the request/,
    );
    expect(await rejection(port.getSection(json("5"), "sec1"))).toMatch(/^The prefix must be a string/);
    expect(service.calls).toEqual([]);
  });

  it("[T101] accepts the qtiMetadata object of Get Section, the binding's QTI metadata record, and does not return it as section data", async () => {
    const answer = (section: unknown): Promise<unknown> =>
      restCatPort({
        fetch: fakeService(() => ({ status: 200, body: { items: { itemIdentifiers: ["i1"] }, section } })).fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      }).getSection(PREFIX, "sec1");
    expect(
      await answer({ sectionConfiguration: "e30=", qtiMetadata: { composite: false, scoringMode: ["human"] } }),
    ).toEqual({
      sectionData: { sectionConfiguration: "e30=" },
      items: { itemIdentifiers: ["i1"], stageLength: null },
    });
    expect(await rejection(answer({ sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" }))).toBe(
      'The qtiMetadata of the answer to Get Section must be an object, found "bWV0YQ==".',
    );
    expect(await rejection(answer({ qtiUsagedata: "PD94" }))).toMatch(/^The sectionConfiguration of the section data/);
    expect(await rejection(answer(json("null")))).toBe(
      "The section of the answer to Get Section must be an object, found null.",
    );
  });
});

const ASI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const resource = (identifier: string, type: string, href: string): string =>
  `<resource identifier="${identifier}" type="${type}" href="${href}"><file href="${href}"/></resource>`;

/** The resource type of a document, by its root element. */
const DOCUMENT_TYPES: readonly (readonly [root: string, type: string])[] = [
  ["<qti-assessment-test", "imsqti_test_xmlv3p0"],
  ["<qti-assessment-section", "imsqti_section_xmlv3p0"],
  ["<qti-assessment-item", "imsqti_item_xmlv3p0"],
];

/** A package in memory: its files, and a manifest that lists the QTI documents among them. */
function packageOf(files: Readonly<Record<string, string>>): QtiPackage {
  const documents = Object.entries(files).flatMap(([path, text], index) => {
    const type = DOCUMENT_TYPES.find(([root]) => text.startsWith(root))?.[1];
    return type === undefined ? [] : [resource(`r${index}`, type, path)];
  });
  const manifest = `<manifest xmlns="${CP_NAMESPACE}" identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources>${documents.join("")}</resources></manifest>`;
  const all = new Map([
    ["imsmanifest.xml", bytes(manifest)],
    ...Object.entries(files).map(([path, text]): [string, Uint8Array] => [path, bytes(text)]),
  ]);
  return openPackage({ paths: [...all.keys()].sort(), read: (path) => all.get(path) });
}

const itemRefs = (ids: readonly string[]): string =>
  ids.map((id) => `<qti-assessment-item-ref identifier="${id}" href="items/${id}.xml"/>`).join("");

const selectionXml = (settings: string, usage: string): string =>
  `<qti-adaptive-selection><qti-adaptive-engine-ref identifier="engine" href="${PREFIX}"/>${settings}${usage}</qti-adaptive-selection>`;

const SETTINGS_REF = '<qti-adaptive-settings-ref identifier="settings" href="cat/settings.json"/>';
const USAGE_REF = '<qti-usagedata-ref identifier="usage" href="cat/usage.xml"/>';

const testXml = (sections: string): string =>
  `<qti-assessment-test xmlns="${ASI}" identifier="exam" title="Exam"><qti-test-part identifier="part" navigation-mode="nonlinear" submission-mode="individual">${sections}</qti-test-part></qti-assessment-test>`;

const adaptiveSection = (selection: string, ids: readonly string[]): string =>
  `<qti-assessment-section identifier="cat" title="Adaptive" visible="true">${selection}${itemRefs(ids)}</qti-assessment-section>`;

const IDS = BANK.map(({ id }) => id);
const FILES = {
  "cat/settings.json": '{"length":3}',
  "cat/usage.xml": usageXml(BANK),
};

/** A CAT engine that records Create Section and Get Section, and reports the pool it was told to. */
function recordingEngine(pool: (sectionIdentifier: string) => readonly string[] = () => IDS): {
  readonly port: CatPort;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("Deployment makes only Create Section and Get Section.");
  };
  const port: CatPort = {
    async createSection(prefix, data) {
      calls.push(`create ${prefix} ${JSON.stringify(data)}`);
      return { sectionIdentifier: `engine-${calls.length}` };
    },
    async getSection(prefix, sectionIdentifier) {
      calls.push(`get ${prefix} ${sectionIdentifier}`);
      return { sectionData: { sectionConfiguration: "" }, items: { itemIdentifiers: [...pool(sectionIdentifier)] } };
    },
    createSession: unused,
    submitResults: unused,
    endSession: unused,
    endSection: unused,
  };
  return { port, calls };
}

describe("deployCatSections", () => {
  const deployable = packageOf({
    "test.xml": testXml(
      `${adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)}<qti-assessment-section identifier="fixed" title="Fixed" visible="true">${itemRefs(["f1"])}</qti-assessment-section>`,
    ),
    ...FILES,
  });

  it("[T102] creates the section of an adaptive selection from the files it references, and checks the pool", async () => {
    const engine = recordingEngine();
    const picked: AdaptiveSelection[] = [];
    const deployedSections = await deployCatSections(deployable, (selection) => {
      picked.push(selection);
      return engine.port;
    });
    const data = {
      sectionConfiguration: base64(FILES["cat/settings.json"]),
      qtiUsagedata: base64(FILES["cat/usage.xml"]),
    };
    expect(engine.calls).toEqual([`create ${PREFIX} ${JSON.stringify(data)}`, `get ${PREFIX} engine-1`]);
    expect(deployedSections).toEqual(new Map([["cat", { prefix: PREFIX, sectionIdentifier: "engine-1" }]]));
    expect(picked).toHaveLength(1);
    expect(picked[0]?.adaptiveEngineRef.href).toBe(PREFIX);
  });

  it("[T102] gives the engine a section that a delivery can run: over takar, the identifier is the SHA-256 of the data", async () => {
    const sections = memoryStore();
    const port = takarCatPort({ sections, seeds: () => 7 });
    const deployedSections = await deployCatSections(deployable, () => port);
    const entry = deployedSections.get("cat");
    const data = sectionDataOf({ length: 3 }, BANK);
    expect(entry).toEqual({ prefix: PREFIX, sectionIdentifier: await sectionIdentifier(data) });
    expect(sections.kept.size).toBe(1);
    const run = await drive(port, entry?.sectionIdentifier ?? "", alternating);
    expect(run.items).toHaveLength(3);
  });

  it("[T102] reads the files against the document that holds the section: a section in a document of its own", async () => {
    const pkg = packageOf({
      "test.xml": testXml('<qti-assessment-section-ref identifier="cat" href="sections/section-cat.xml"/>'),
      "sections/section-cat.xml": `<qti-assessment-section xmlns="${ASI}" identifier="cat" title="Adaptive" visible="true">${selectionXml(
        '<qti-adaptive-settings-ref identifier="settings" href="settings.json"/>',
        '<qti-usagedata-ref identifier="usage" href="../cat/usage.xml"/>',
      )}${itemRefs(IDS)}</qti-assessment-section>`,
      "sections/settings.json": '{"length":2}',
      "cat/usage.xml": usageXml(BANK),
    });
    const engine = recordingEngine();
    await deployCatSections(pkg, () => engine.port);
    expect(engine.calls[0]).toBe(
      `create ${PREFIX} ${JSON.stringify({ sectionConfiguration: base64('{"length":2}'), qtiUsagedata: base64(usageXml(BANK)) })}`,
    );
  });

  it("[T102] sends an empty settings file for a selection without qti-adaptive-settings-ref, and no usage data", async () => {
    const pkg = packageOf({ "test.xml": testXml(adaptiveSection(selectionXml("", ""), IDS)) });
    const engine = recordingEngine();
    await deployCatSections(pkg, () => engine.port);
    expect(engine.calls[0]).toBe(`create ${PREFIX} ${JSON.stringify({ sectionConfiguration: "" })}`);
    await expect(
      deployCatSections(pkg, () => takarCatPort({ sections: memoryStore(), seeds: () => 1 })),
    ).rejects.toThrow(DataError);
  });

  it("[T102] deploys each adaptive section of each test, in document order, and nothing for a package without one", async () => {
    const second = `<qti-assessment-section identifier="cat2" title="Second" visible="true">${selectionXml(SETTINGS_REF, USAGE_REF)}${itemRefs(["x1", "x2"])}</qti-assessment-section>`;
    // Create Section is the first request of the engine, Get Section the second: the second section is engine-3.
    const engine = recordingEngine((section) => (section === "engine-3" ? ["x1", "x2"] : IDS));
    const deployedSections = await deployCatSections(
      packageOf({
        "test.xml": testXml(`${adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)}${second}`),
        ...FILES,
      }),
      () => engine.port,
    );
    expect([...deployedSections.keys()]).toEqual(["cat", "cat2"]);
    expect(deployedSections.get("cat2")?.sectionIdentifier).toBe("engine-3");
    const none = recordingEngine();
    const plain = packageOf({
      "test.xml": testXml(
        `<qti-assessment-section identifier="s" title="S" visible="true">${itemRefs(["f1"])}</qti-assessment-section>`,
      ),
    });
    expect(await deployCatSections(plain, () => none.port)).toEqual(new Map());
    expect(none.calls).toEqual([]);
  });

  it("[T102] fails when the pool of the engine and the item references disagree, and names the section at the engine", async () => {
    const engine = recordingEngine(() => [...IDS.slice(1), "stranger"]);
    const message = await rejection(deployCatSections(deployable, () => engine.port));
    expect(message).toMatch(
      /^The engine's section "engine-1" at "https:\/\/cat\.example\/ims\/cat\/v1p0" does not agree with the adaptive section "cat": /,
    );
    expect(message).toContain('lists the item "q1", which the item pool of the CAT engine does not contain');
    expect(message).toContain('contains the item "stranger", which the adaptive section "cat" does not list');
    expect(engine.calls).toHaveLength(2);
  });

  it("[T102] fails when a referenced file is not in the package, or two tests name a section alike", async () => {
    const missing = packageOf({
      "test.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      "cat/settings.json": "{}",
    });
    expect(await rejection(deployCatSections(missing, () => recordingEngine().port))).toBe(
      'The adaptive section "cat" references the usage data "cat/usage.xml", which is not a file of the package.',
    );
    const outside = packageOf({
      "test.xml": testXml(
        adaptiveSection(
          selectionXml('<qti-adaptive-settings-ref identifier="settings" href="../outside.json"/>', ""),
          IDS,
        ),
      ),
    });
    expect(await rejection(deployCatSections(outside, () => recordingEngine().port))).toMatch(
      /which is not a file of the package\.$/,
    );
    const twice = packageOf({
      "test.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      "test2.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      ...FILES,
    });
    expect(await rejection(deployCatSections(twice, () => recordingEngine().port))).toBe(
      'Two tests of the package have the adaptive section "cat"; the sections of the engine are named by it.',
    );
  });

  it("[T102] checks its arguments", async () => {
    await expect(deployCatSections(json("null"), () => recordingEngine().port)).rejects.toThrow(
      new DataError("The package must be an object, found null."),
    );
    await expect(deployCatSections(deployable, json("5"))).rejects.toThrow(
      new DataError("The port must be a function of an adaptive selection, found 5."),
    );
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

describe("an adaptive section through olah's engine", () => {
  const EXAM_LENGTH = 4;
  const settings = { length: EXAM_LENGTH };
  /** The candidate answers right at the even positions of the test and wrong at the odd ones. */
  const alternatingChoice = (_ref: string, position: number): string => (position % 2 === 0 ? "B" : "A");

  /** Two ports of two host processes over one store: the first deploys, and the sittings alternate between them. */
  async function twoProcesses(pkg: QtiPackage, log: string[] = []) {
    const sections = memoryStore();
    const first = spied("first", takarCatPort({ sections, seeds: () => 12345 }), log);
    const second = spied("second", takarCatPort({ sections, seeds: () => 999 }), log);
    const { engine, catSections } = await examEngine(pkg, first);
    return { engine, catSections, sections, ports: [first, second] as const, log };
  }

  it("[T99] deploys the section, and presents the items that takar selects, the ports of two processes taking turns", async () => {
    const { engine, catSections, sections, ports, log } = await twoProcesses(examPackage(BANK, settings));
    expect(catSections).toEqual(
      new Map([["cat", { prefix: PREFIX, sectionIdentifier: await sectionIdentifier(sectionDataOf(settings, BANK)) }]]),
    );
    expect(sections.kept.size).toBe(1);

    const { state, refs } = await sit(engine, ports, alternatingChoice);
    expect(refs).toEqual(takarItems(EXAM_LENGTH, (_item, position) => (position % 2 === 0 ? 1 : 0)));
    expect(refs).toHaveLength(EXAM_LENGTH);
    expect(state.status).toBe("ended");

    // Create Session once, then Submit Results after each item, each request to the other process; the engine of olah
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
    expect(refs).toEqual(takarItems(EXAM_LENGTH, (_item, position) => (position === 1 ? 0 : 1)));
    expect(scoresOf(engine, state).total).toBe(3);
  });

  it("[T99] ends the session at the engine when the candidate leaves before the CAT engine ended it", async () => {
    const { engine, ports, log } = await twoProcesses(examPackage(BANK, settings));
    const { state, refs } = await sit(engine, ports, () => "B", 2);
    expect(refs).toEqual(takarItems(EXAM_LENGTH, () => 1).slice(0, 2));
    expect(state.status).toBe("ended");
    expect(log.at(-1)).toMatch(/ endSession$/);
    expect(log.filter((entry) => entry.endsWith("endSession"))).toHaveLength(1);
    expect(scoresOf(engine, state).scores.size).toBe(2);
  });

  it("[T99] presents a module of a panel as a stage of its length, and routes by the estimate", async () => {
    const sections = memoryStore();
    const log: string[] = [];
    const panel = (name: string) =>
      spied(name, takarPanelPort({ sections, panels: () => ({ cuts: PANEL_CUTS }) }), log);
    const first = panel("first");
    const second = panel("second");
    const { engine } = await examEngine(examPackage(PANEL_BANK, PANEL_SETTINGS), first);
    const { state, refs } = await sit(engine, [first, second], () => "B");
    expect(refs).toEqual(["r1", "r2", "r3", "r4", "h1", "h2", "h3"]);
    expect(refs).toEqual(
      takarModules(1, () => 1).flatMap(
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

  it("[T99] presents the stages of takar's simulateAdaptiveTest at the same responses", async () => {
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
          const port = takarCatPort({ sections: memoryStore(), seeds: () => seed });
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
            await takarCatPort({ sections, seeds: () => seed }).createSection(
              PREFIX,
              sectionDataOf({ length: 6 }, items),
            )
          ).sectionIdentifier;
          const answers = (_item: string, position: number): number => responses[position] ?? 0;
          const one = await drive(takarCatPort({ sections, seeds: () => seed }), section, answers);
          const two = await drive(takarCatPort({ sections, seeds: () => seed }), section, answers);
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
