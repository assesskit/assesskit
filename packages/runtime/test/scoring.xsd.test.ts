import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { type AssessmentItem, writeAsi } from "../src/index.js";
import type { ScoredResponse } from "../src/keys/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { type CompileScoringOptions, compileScoring } from "../src/scoring/index.js";
import { readFixture } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../../..");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(root));
});

afterAll(() => {
  schemas.close();
});

/** The XML of an item that holds the scoring of some keys and no body. */
function itemXml(responses: readonly ScoredResponse[], options?: CompileScoringOptions): string {
  const scoring = compileScoring(responses, options);
  const item: AssessmentItem = {
    kind: "assessment-item",
    identifier: "item",
    title: "Item",
    timeDependent: false,
    adaptive: false,
    extensions: [],
    modalFeedback: [],
    stylesheets: [],
    stimulusRefs: [],
    templateDeclarations: [],
    contextDeclarations: [],
    responseDeclarations: scoring.responseDeclarations,
    outcomeDeclarations: scoring.outcomeDeclarations,
    responseProcessing: scoring.responseProcessing,
  };
  return writeAsi({ kind: "item", item });
}

/** Every kind and scheme of key, with follow-through, in one item. */
const EVERY_KEY: readonly ScoredResponse[] = [
  { identifier: "CHOICE", key: { kind: "choice", keys: ["A", "B"] } },
  { identifier: "PARTIAL", key: { kind: "choice", keys: ["A"], scheme: "partial" }, maxPoints: 2 },
  { identifier: "PER_KEY", key: { kind: "choice", keys: ["A", "B"], scheme: "per-key", maxChoices: 3 }, weight: 0.5 },
  { identifier: "MAPPED", key: { kind: "choice-mapping", points: { A: 5, B: 1, C: -1 }, maxChoices: 2 } },
  { identifier: "MARKED", key: { kind: "choice-marking", keys: ["A"], correct: 4, wrong: -1, blank: 0 } },
  {
    identifier: "PAIRS",
    key: { kind: "pairs", pairs: [["S", "T"]], directed: false, scheme: "per-pair", maxPairs: 3, surplus: 1 },
  },
  {
    identifier: "MATCH",
    key: {
      kind: "pairs",
      pairs: [
        ["S", "T"],
        ["U", "V"],
      ],
      scheme: "mapping",
      points: [2, 1],
      none: "N",
    },
  },
  { identifier: "ORDER", key: { kind: "order", order: ["A", "B", "C"] } },
  { identifier: "POSITIONS", key: { kind: "order", order: ["A", "B", "C"], scheme: "per-position" } },
  { identifier: "ADJACENT", key: { kind: "order", order: ["A", "B", "C"], scheme: "adjacent-pairs" } },
  {
    identifier: "AREAS",
    key: {
      kind: "areas",
      scheme: "mapping",
      areas: [{ id: "A", shape: "poly", coords: [0, 0, 10, 0, 5, 9], points: 2 }],
    },
  },
  {
    identifier: "KEYED",
    key: { kind: "areas", scheme: "keyed", areas: [{ id: "A", shape: "circle", coords: [5, 5, 3] }] },
  },
  { identifier: "PLAIN", key: { kind: "number", value: 1.5, tolerance: { absolute: 0.1, relative: 0.01 } } },
  { identifier: "EXACT", key: { kind: "number", value: -2 } },
  { identifier: "UNITS", key: { kind: "number", value: 1.5, units: { m: 1 }, decimalSeparator: "," } },
  { identifier: "POINT", key: { kind: "number", value: 0, components: [1, 2] } },
  { identifier: "TEXT", key: { kind: "text", answers: [{ texts: ["a"] }, { texts: ["b"] }], count: 2 } },
  {
    identifier: "EXPRESSION",
    key: { kind: "expression", expression: "2x" },
    followThrough: { from: "PLAIN", expression: "r" },
  },
];

/** `scoring-schemes.json`: the items of the reference. */
interface SchemesFixture {
  readonly cases: readonly { readonly responses: readonly ScoredResponse[]; readonly options: CompileScoringOptions }[];
}

describe("compileScoring", () => {
  it("writes items that the QTI 3.0 schema accepts, with every kind of key and every option", async () => {
    const items = [
      itemXml(EVERY_KEY, { limits: { responses: 64 } }),
      itemXml(EVERY_KEY, { feedback: false, allParts: true, floor: -1 }),
      itemXml(EVERY_KEY, { portable: true }),
      itemXml([EVERY_KEY[4] as ScoredResponse]),
      itemXml([EVERY_KEY[16] as ScoredResponse], { portable: true, feedback: false }),
    ];
    expect(
      await validateXmlFiles(
        schemas,
        items.map((content, at) => ({ path: `item-${at}.xml`, content })),
      ),
    ).toStrictEqual([]);
  });

  it("writes every item of the reference so that the schema accepts it", async () => {
    const { cases } = readFixture<SchemesFixture>("scoring-schemes.json");
    const files = cases.map(({ responses, options }, at) => ({
      path: `case-${at}.xml`,
      content: itemXml(responses, options),
    }));
    expect(await validateXmlFiles(schemas, files)).toStrictEqual([]);
  });
});
