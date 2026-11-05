import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { ASI_NAMESPACE, type AssessmentItem, readAsi, writeAsi } from "../src/asi/index.js";
import { DataError, SecurityError } from "../src/errors.js";
import { createRandom } from "../src/index.js";
import { DEFAULT_KEY_LIMITS, type Key, type ScoredResponse } from "../src/keys/index.js";
import { createScoringOperators, OPERATOR_DEFINITIONS } from "../src/operators/index.js";
import { createItemVariables, runResponseProcessing } from "../src/processing/index.js";
import {
  type CompileScoringOptions,
  compileScoring,
  type InteractionAttributes,
  type ItemScoring,
} from "../src/scoring/index.js";
import { validateAsi } from "../src/validate/index.js";
import { buildContainer, buildSingle, type Value } from "../src/values/index.js";
import { scoredResponsesOf } from "./arbitraries/scoring.js";
import { readFixture } from "./fixtures.js";
import { FUZZ } from "./fuzz.js";

const OPERATORS = createScoringOperators();

/** An item of the scoring's declarations and response processing, with no body. */
function itemOf(scoring: ItemScoring): AssessmentItem {
  return {
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
}

/** The outcomes of an item's response processing, after the item is written as XML and read back. */
function outcomesOf(
  scoring: ItemScoring,
  answers: Readonly<Record<string, Value | null>>,
): ReadonlyMap<string, Value | null> {
  const read = readAsi(writeAsi({ kind: "item", item: itemOf(scoring) }));
  if (read.kind !== "item") throw new Error("The test reads an item.");
  const variables = createItemVariables(read.item);
  const responses = new Map(variables.responses);
  for (const [identifier, value] of Object.entries(answers)) responses.set(identifier, value);
  return runResponseProcessing(
    read.item,
    { ...variables, responses },
    { random: createRandom(1), customOperators: OPERATORS },
  ).outcomes;
}

/** The number of a float outcome. */
function numberOf(value: Value | null | undefined): number | null {
  return value === null || value === undefined || value.cardinality !== "single" ? null : Number(value.value);
}

/** The values of `FEEDBACK`, sorted. */
function feedbackOf(outcomes: ReadonlyMap<string, Value | null>): string[] {
  const value = outcomes.get("FEEDBACK");
  if (value === null || value === undefined) return [];
  if (value.cardinality === "record") return [];
  return value.cardinality === "single" ? [String(value.value)] : value.values.map(String).sort();
}

/** The score of one response under its key: compiles it, answers it and reads `SCORE`. */
function scoreOne(response: ScoredResponse, answer: Value | null, options?: CompileScoringOptions): number | null {
  return numberOf(outcomesOf(compileScoring([response], options), { [response.identifier]: answer }).get("SCORE"));
}

/** A value, never NULL: an empty container is NULL, which a test passes as `null`. */
function present(value: Value | null): Value {
  if (value === null) throw new Error("The test builds a value that is not NULL.");
  return value;
}
const one = (baseType: "identifier" | "string" | "float", value: string | number): Value =>
  present(buildSingle(baseType, value));
const many = (baseType: "identifier" | "directedPair" | "pair" | "point", values: unknown[]): Value =>
  present(buildContainer("multiple", baseType, values as never));
const ordered = (values: string[]): Value => present(buildContainer("ordered", "identifier", values));
const respond = (key: Key, rest: Partial<ScoredResponse> = {}): ScoredResponse => ({ identifier: "R", key, ...rest });
/** Reads JSON, as a caller from JavaScript passes input of any type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

/** `scoring-schemes.json`, which `validation/scoring.py` writes from the rules of the guide. */
interface SchemesFixture {
  readonly cases: readonly {
    readonly item: number;
    readonly responses: readonly ScoredResponse[];
    readonly options: CompileScoringOptions;
    readonly answers: Readonly<Record<string, Value | null>>;
    readonly score: number;
    readonly maxScore: number;
    readonly parts: Readonly<Record<string, number>>;
    readonly feedback: readonly string[];
  }[];
}

/** Three choices of an interaction, A to C. */
const choices = (element: string): string =>
  ["A", "B", "C"].map((id) => `<qti-${element} identifier="${id}">${id}</qti-${element}>`).join("");
const PICTURE = '<object data="a.png" type="image/png" width="100" height="100">A picture</object>';
const TEXT_ENTRY = '<p><qti-text-entry-interaction response-identifier="R"/></p>';

/** Whether two scores agree: exactly, or within 1e-12 of their size for sums of floats. */
function agrees(actual: number | null, expected: number): boolean {
  return actual !== null && Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected));
}

describe("compileScoring", () => {
  it("scores every item of the reference as the rules of the guide compute it", () => {
    const { cases } = readFixture<SchemesFixture>("scoring-schemes.json");
    expect(cases.length).toBeGreaterThan(500);
    const differing = cases.filter((entry) => {
      const outcomes = outcomesOf(compileScoring(entry.responses, entry.options), entry.answers);
      const parts = Object.entries(entry.parts).every(([id, score]) =>
        agrees(numberOf(outcomes.get(`SCORE_${id}`)), score),
      );
      return !(
        agrees(numberOf(outcomes.get("SCORE")), entry.score) &&
        numberOf(outcomes.get("MAXSCORE")) === entry.maxScore &&
        parts &&
        JSON.stringify(feedbackOf(outcomes)) === JSON.stringify(entry.feedback)
      );
    });
    expect(differing.map(({ item }) => item)).toStrictEqual([]);
  });

  it("validates every item it writes, with the operators it names", () => {
    const { cases } = readFixture<SchemesFixture>("scoring-schemes.json");
    for (const entry of cases.slice(0, 100)) {
      const scoring = compileScoring(entry.responses, entry.options);
      const issues = validateAsi({ kind: "item", item: itemOf(scoring) }, { customOperators: OPERATORS });
      expect(issues.filter(({ rule }) => rule !== "assesskit/validate/unbound-response")).toStrictEqual([]);
    }
  });

  it("declares each response so that the interaction of its key binds it, with the attributes that it gives", () => {
    const interactions: readonly (readonly [Key, (attributes: InteractionAttributes) => string])[] = [
      [
        { kind: "choice", keys: ["A", "B"] },
        ({ maxChoices }) =>
          `<qti-choice-interaction response-identifier="R" max-choices="${maxChoices}">${choices("simple-choice")}</qti-choice-interaction>`,
      ],
      [
        { kind: "choice-mapping", points: { A: 2, B: 1 } },
        ({ maxChoices }) =>
          `<qti-choice-interaction response-identifier="R" max-choices="${maxChoices}">${choices("simple-choice")}</qti-choice-interaction>`,
      ],
      [
        { kind: "choice-marking", keys: ["A"], correct: 4, wrong: -1 },
        ({ maxChoices }) =>
          `<qti-choice-interaction response-identifier="R" max-choices="${maxChoices}">${choices("simple-choice")}</qti-choice-interaction>`,
      ],
      [
        { kind: "pairs", pairs: [["S", "T"]], reuse: true },
        ({
          maxAssociations,
          matchMax,
        }) => `<qti-match-interaction response-identifier="R" max-associations="${maxAssociations}">
          <qti-simple-match-set><qti-simple-associable-choice identifier="S" match-max="${matchMax?.source}">s</qti-simple-associable-choice></qti-simple-match-set>
          <qti-simple-match-set><qti-simple-associable-choice identifier="T" match-max="${matchMax?.target}">t</qti-simple-associable-choice></qti-simple-match-set>
        </qti-match-interaction>`,
      ],
      [
        { kind: "pairs", pairs: [["S", "T"]], directed: false },
        ({
          maxAssociations,
          matchMax,
        }) => `<qti-associate-interaction response-identifier="R" max-associations="${maxAssociations}">
          <qti-simple-associable-choice identifier="S" match-max="${matchMax?.source}">s</qti-simple-associable-choice>
          <qti-simple-associable-choice identifier="T" match-max="${matchMax?.target}">t</qti-simple-associable-choice>
        </qti-associate-interaction>`,
      ],
      [
        { kind: "order", order: ["A", "B", "C"], scheme: "adjacent-pairs" },
        () => `<qti-order-interaction response-identifier="R">${choices("simple-choice")}</qti-order-interaction>`,
      ],
      [
        { kind: "areas", scheme: "mapping", areas: [{ id: "A", shape: "rect", coords: [0, 0, 5, 5] }] },
        ({ maxChoices }) =>
          `<qti-select-point-interaction response-identifier="R" max-choices="${maxChoices}">${PICTURE}</qti-select-point-interaction>`,
      ],
      [
        { kind: "areas", scheme: "keyed", areas: [{ id: "A", shape: "rect", coords: [0, 0, 5, 5] }] },
        ({ maxChoices }) =>
          `<qti-select-point-interaction response-identifier="R" max-choices="${maxChoices}">${PICTURE}</qti-select-point-interaction>`,
      ],
      [{ kind: "number", value: 2.5, tolerance: { absolute: 0.1 } }, () => TEXT_ENTRY],
      [{ kind: "number", value: 2.5, units: { m: 1 } }, () => TEXT_ENTRY],
      [
        { kind: "number", value: 0, components: [1, 2] },
        ({ maxStrings }) => `<qti-extended-text-interaction response-identifier="R" max-strings="${maxStrings}"/>`,
      ],
      [{ kind: "text", answers: [{ texts: ["a"] }] }, () => TEXT_ENTRY],
      [
        { kind: "text", answers: [{ texts: ["a"] }, { texts: ["b"] }], count: 2 },
        ({ maxStrings }) => `<qti-extended-text-interaction response-identifier="R" max-strings="${maxStrings}"/>`,
      ],
      [{ kind: "expression", expression: "2x" }, () => TEXT_ENTRY],
    ];
    for (const [key, body] of interactions) {
      const scoring = compileScoring([respond(key)]);
      const read =
        readAsi(`<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="item" title="Item" time-dependent="false">
        <qti-item-body>${body(scoring.interactions.get("R") ?? {})}</qti-item-body></qti-assessment-item>`);
      if (read.kind !== "item") throw new Error("The test reads an item.");
      const { responseDeclarations, outcomeDeclarations, responseProcessing } = scoring;
      const item = { ...read.item, responseDeclarations, outcomeDeclarations, responseProcessing };
      expect(validateAsi({ kind: "item", item }, { customOperators: OPERATORS })).toStrictEqual([]);
    }
  });

  it("scores a choice all or nothing, partly, or per key", () => {
    const keys = ["A", "B"];
    expect(scoreOne(respond({ kind: "choice", keys }), many("identifier", ["B", "A"]))).toBe(1);
    expect(scoreOne(respond({ kind: "choice", keys }), many("identifier", ["A"]))).toBe(0);
    expect(scoreOne(respond({ kind: "choice", keys }), null)).toBe(0);
    const partial = respond({ kind: "choice", keys: ["A", "B", "C"], scheme: "partial", maxChoices: 5 });
    expect(scoreOne(partial, many("identifier", ["A", "B", "C"]))).toBe(3);
    expect(scoreOne(partial, many("identifier", ["A", "B", "D"]))).toBe(1);
    expect(scoreOne(partial, many("identifier", ["A", "D", "E"]))).toBe(0);
    const single = respond({ kind: "choice", keys: ["A"], scheme: "partial" });
    expect(scoreOne(single, one("identifier", "B"))).toBe(0);
    const perKey = respond({ kind: "choice", keys: ["A", "B"], scheme: "per-key", maxChoices: 3 });
    expect(scoreOne(perKey, many("identifier", ["A", "D", "E"]))).toBe(1);
    expect(compileScoring([single]).responseDeclarations[0]?.cardinality).toBe("single");
  });

  it("maps the points of options, floored at 0, up to the best sum within maxChoices", () => {
    const key: Key = { kind: "choice-mapping", points: { A: 5, B: 3, C: 1, D: -2 } };
    expect(scoreOne(respond(key), one("identifier", "B"))).toBe(3);
    expect(scoreOne(respond(key), one("identifier", "D"))).toBe(0);
    const two = respond({ ...key, maxChoices: 2 });
    expect(scoreOne(two, many("identifier", ["A", "B"]))).toBe(8);
    expect(scoreOne(two, many("identifier", ["C", "D"]))).toBe(0);
    expect(compileScoring([two]).outcomeDeclarations.find(({ identifier }) => identifier === "MAXSCORE")).toMatchObject(
      {
        defaultValue: { values: [{ value: "8" }] },
      },
    );
    expect(
      compileScoring([two]).responseDeclarations[0]?.correctResponse?.values.map(({ value }) => value),
    ).toStrictEqual(["A", "B"]);
  });

  it("marks a choice per option, below 0 without a floor, and the blank", () => {
    const marking = respond({ kind: "choice-marking", keys: ["A"], correct: 4, wrong: -1, blank: 0 });
    expect(scoreOne(marking, one("identifier", "A"))).toBe(4);
    expect(scoreOne(marking, one("identifier", "B"))).toBe(-1);
    expect(scoreOne(marking, null)).toBe(0);
    expect(scoreOne(marking, one("identifier", "B"), { floor: 0 })).toBe(0);
    const declarations = compileScoring([marking]).outcomeDeclarations;
    expect(declarations.find(({ identifier }) => identifier === "SCORE")).toMatchObject({
      normalMaximum: 4,
      normalMinimum: -1,
    });
    const several = respond({ kind: "choice-marking", keys: ["A", "B"], correct: 1, wrong: -0.5, blank: 0.25 });
    expect(scoreOne(several, many("identifier", ["A", "C"]))).toBe(0.5);
    expect(scoreOne(several, null)).toBe(0.25);
  });

  it("scores pairs all or nothing, per pair or by their points, less the surplus pairs", () => {
    const pairs: [string, string][] = [
      ["S1", "T1"],
      ["S2", "T2"],
    ];
    expect(
      scoreOne(
        respond({ kind: "pairs", pairs }),
        many("directedPair", [
          ["S2", "T2"],
          ["S1", "T1"],
        ]),
      ),
    ).toBe(1);
    expect(
      scoreOne(
        respond({ kind: "pairs", pairs }),
        many("directedPair", [
          ["T1", "S1"],
          ["S2", "T2"],
        ]),
      ),
    ).toBe(0);
    const undirected = respond({ kind: "pairs", pairs, directed: false });
    expect(
      scoreOne(
        undirected,
        many("pair", [
          ["T1", "S1"],
          ["S2", "T2"],
        ]),
      ),
    ).toBe(1);
    const perPair = respond({ kind: "pairs", pairs, scheme: "per-pair", maxPairs: 4, surplus: 0.5 });
    expect(
      scoreOne(
        perPair,
        many("directedPair", [
          ["S1", "T1"],
          ["S2", "T1"],
        ]),
      ),
    ).toBe(1);
    expect(
      scoreOne(
        perPair,
        many("directedPair", [
          ["S1", "T1"],
          ["S2", "T2"],
          ["S3", "T3"],
        ]),
      ),
    ).toBe(1.5);
    expect(
      scoreOne(
        perPair,
        many("directedPair", [
          ["S1", "T2"],
          ["S2", "T1"],
          ["S3", "T3"],
          ["S4", "T4"],
        ]),
      ),
    ).toBe(0);
    const mapped = respond({ kind: "pairs", pairs, scheme: "mapping", points: [2, 1] });
    expect(scoreOne(mapped, many("directedPair", [["S1", "T1"]]))).toBe(2);
    expect(compileScoring([perPair]).interactions.get("R")).toStrictEqual({
      maxAssociations: 4,
      matchMax: { source: 0, target: 1 },
    });
    const reused = compileScoring([respond({ kind: "pairs", pairs, reuse: true, none: "NONE" })]);
    expect(reused.interactions.get("R")).toStrictEqual({
      maxAssociations: 2,
      matchMax: { source: 0, target: 0, none: 0 },
    });
    const limited = compileScoring([respond({ kind: "pairs", pairs, maxPerSource: 1, maxPerTarget: 2, reuse: true })]);
    expect(limited.interactions.get("R")?.matchMax).toStrictEqual({ source: 1, target: 2 });
  });

  it("scores an order all or nothing, per position, or by adjacent pairs", () => {
    const order = ["A", "B", "C", "D"];
    expect(scoreOne(respond({ kind: "order", order }), ordered(order))).toBe(1);
    expect(scoreOne(respond({ kind: "order", order }), ordered(["A", "B", "D", "C"]))).toBe(0);
    const positions = respond({ kind: "order", order, scheme: "per-position" });
    expect(scoreOne(positions, ordered(["A", "B", "D", "C"]))).toBe(2);
    expect(scoreOne(positions, ordered(["A", "B"]))).toBe(2);
    const adjacent = respond({ kind: "order", order, scheme: "adjacent-pairs" });
    // The format proof of PTE's reordering: right 3, the last two swapped 1, rotated 2, reversed 0.
    expect(scoreOne(adjacent, ordered(["A", "B", "C", "D"]))).toBe(3);
    expect(scoreOne(adjacent, ordered(["A", "B", "D", "C"]))).toBe(1);
    expect(scoreOne(adjacent, ordered(["B", "C", "D", "A"]))).toBe(2);
    expect(scoreOne(adjacent, ordered(["D", "C", "B", "A"]))).toBe(0);
    expect(scoreOne(adjacent, null)).toBe(0);
  });

  it("maps the points of areas: each point to the first area that holds it, each area once, edges inside", () => {
    const key: Key = {
      kind: "areas",
      scheme: "mapping",
      select: 2,
      areas: [
        { id: "A", shape: "rect", coords: [0, 0, 10, 10], points: 2 },
        { id: "B", shape: "circle", coords: [50, 50, 5] },
        { id: "C", shape: "poly", coords: [20, 20, 30, 20, 25, 30], points: 0.5 },
      ],
    };
    expect(scoreOne(respond(key), many("point", [[10, 10]]))).toBe(2);
    expect(
      scoreOne(
        respond(key),
        many("point", [
          [1, 1],
          [2, 2],
        ]),
      ),
    ).toBe(2);
    expect(
      scoreOne(
        respond(key),
        many("point", [
          [1, 1],
          [55, 50],
        ]),
      ),
    ).toBe(3);
    expect(scoreOne(respond(key), many("point", [[90, 90]]))).toBe(0);
    const overlapping: Key = {
      kind: "areas",
      scheme: "mapping",
      areas: [
        { id: "A", shape: "rect", coords: [0, 0, 10, 10] },
        { id: "B", shape: "rect", coords: [5, 5, 15, 15], points: 3 },
      ],
    };
    expect(scoreOne(respond(overlapping), many("point", [[7, 7]]))).toBe(1);
    expect(
      scoreOne(
        respond(overlapping),
        many("point", [
          [7, 7],
          [12, 12],
        ]),
      ),
    ).toBe(4);
    expect(compileScoring([respond(key)]).interactions.get("R")).toStrictEqual({ maxChoices: 2 });
  });

  it("matches areas by hotspot-matching under keyed", () => {
    const key: Key = {
      kind: "areas",
      scheme: "keyed",
      areas: [
        { id: "A", shape: "rect", coords: [0, 0, 10, 10] },
        { id: "B", shape: "rect", coords: [5, 5, 15, 15] },
      ],
    };
    const scoring = compileScoring([respond(key)]);
    expect(scoring.operators).toStrictEqual([OPERATOR_DEFINITIONS["hotspot-matching"]]);
    expect(
      numberOf(
        outcomesOf(scoring, {
          R: many("point", [
            [7, 7],
            [8, 8],
          ]),
        }).get("SCORE"),
      ),
    ).toBe(2);
    expect(numberOf(outcomesOf(scoring, { R: many("point", [[7, 7]]) }).get("SCORE"))).toBe(1);
  });

  it("scores a plain number by qti-equal, and any other by number-equivalent", () => {
    const plain = respond({ kind: "number", value: 2.5, tolerance: { absolute: 0.1, relative: 0.1 } });
    const scoring = compileScoring([plain]);
    expect(scoring.operators).toStrictEqual([]);
    expect(scoring.responseDeclarations[0]).toMatchObject({ baseType: "float", cardinality: "single" });
    expect(scoreOne(plain, one("float", 2.74))).toBe(1);
    expect(scoreOne(plain, one("float", 2.8))).toBe(0);
    expect(scoreOne(respond({ kind: "number", value: 2.5 }), one("float", 2.5))).toBe(1);
    expect(scoreOne(respond({ kind: "number", value: -2, tolerance: { relative: 0.05 } }), one("float", -2.09))).toBe(
      1,
    );
    const units = respond({ kind: "number", value: 1.5, units: { m: 1, cm: 0.01 } });
    expect(compileScoring([units]).operators).toStrictEqual([OPERATOR_DEFINITIONS["number-equivalent"]]);
    expect(scoreOne(units, one("string", "150 cm"))).toBe(1);
    const comma = respond({ kind: "number", value: 1.5, decimalSeparator: "," });
    expect(compileScoring([comma]).responseDeclarations[0]?.correctResponse?.values[0]?.value).toBe("1,5");
    const point = respond({ kind: "number", value: 0, components: [3, -4] });
    expect(compileScoring([point]).responseDeclarations[0]).toMatchObject({
      cardinality: "ordered",
      baseType: "string",
    });
    expect(compileScoring([point]).interactions.get("R")).toStrictEqual({ maxStrings: 2 });
    expect(scoreOne(point, present(buildContainer("ordered", "string", ["3", "4"])))).toBe(0.5);
  });

  it("scores a text by text-equivalent, as a share of the points of its best answers", () => {
    const key: Key = {
      kind: "text",
      answers: [{ texts: ["Saturday mornings"], points: 2 }, { texts: ["Saturday morning"] }],
    };
    expect(scoreOne(respond(key), one("string", "saturday  MORNINGS"))).toBe(2);
    expect(scoreOne(respond(key), one("string", "Saturday morning"))).toBe(1);
    expect(scoreOne(respond(key), one("string", "   "))).toBe(0);
    expect(scoreOne(respond(key, { maxPoints: 1 }), one("string", "Saturday morning"))).toBe(0.5);
    const several = compileScoring([
      respond({ kind: "text", answers: [{ texts: ["a"] }, { texts: ["b"] }], count: 2 }),
    ]);
    expect(several.responseDeclarations[0]).toMatchObject({ cardinality: "multiple" });
    expect(several.interactions.get("R")).toStrictEqual({ maxStrings: 2 });
    const patterns = compileScoring([respond({ kind: "text", answers: [{ texts: [], patterns: ["[a-z]+"] }] })]);
    expect(patterns.responseDeclarations[0]?.correctResponse).toBeUndefined();
  });

  it("matches a text in any notation of a number with numericEquivalence", () => {
    // The format proof of numeric entry (SAT, GRE): .5, 0.50, 5e-1 and the key 1/2 are right; 0.6 and 1/3 are wrong.
    const key: Key = { kind: "text", answers: [{ texts: ["0.5", "1/2"] }], numericEquivalence: true };
    for (const text of [".5", "0.50", "5e-1", "1/2", "2/4", "+0.5", "０.５"])
      expect(scoreOne(respond(key), one("string", text))).toBe(1);
    for (const text of ["0.6", "1/3", "0.5 kg", "1,5", "half"])
      expect(scoreOne(respond(key), one("string", text))).toBe(0);
    const words: Key = {
      kind: "text",
      answers: [{ texts: ["3"] }, { texts: ["4"] }],
      count: 2,
      scheme: "words",
      numericEquivalence: true,
    };
    expect(scoreOne(respond(words), one("string", "3.0 and 4.00"))).toBe(2);
    expect(scoreOne(respond({ ...key, numericEquivalence: false }), one("string", ".5"))).toBe(0);
  });

  it("scores an expression by expression-equivalent, with follow-through from an earlier response", () => {
    const scoring = compileScoring([
      { identifier: "R1", key: { kind: "number", value: 4 } },
      {
        identifier: "R2",
        key: { kind: "expression", expression: "8" },
        followThrough: { from: "R1", expression: "2r" },
      },
    ]);
    expect(scoring.operators).toStrictEqual([OPERATOR_DEFINITIONS["expression-equivalent"]]);
    const outcomes = outcomesOf(scoring, { R1: one("float", 5), R2: one("string", "10") });
    expect([
      numberOf(outcomes.get("SCORE_R1")),
      numberOf(outcomes.get("SCORE_R2")),
      numberOf(outcomes.get("SCORE")),
    ]).toStrictEqual([0, 1, 1]);
    expect(numberOf(outcomesOf(scoring, { R1: null, R2: one("string", "10") }).get("SCORE_R2"))).toBe(0);
    expect(numberOf(outcomesOf(scoring, { R1: null, R2: one("string", "2\\cdot4") }).get("SCORE_R2"))).toBe(1);
  });

  it("totals several responses, with maxPoints, weight, all parts and the floor", () => {
    const responses: ScoredResponse[] = [
      { identifier: "R1", key: { kind: "choice", keys: ["A"] }, maxPoints: 2 },
      { identifier: "R2", key: { kind: "order", order: ["A", "B", "C"], scheme: "per-position" }, weight: 2 },
    ];
    const answers = { R1: one("identifier", "A"), R2: ordered(["A", "C", "B"]) };
    const outcomes = outcomesOf(compileScoring(responses), answers);
    expect([
      numberOf(outcomes.get("SCORE_R1")),
      numberOf(outcomes.get("SCORE_R2")),
      numberOf(outcomes.get("SCORE")),
    ]).toStrictEqual([2, 2, 4]);
    expect(numberOf(outcomes.get("MAXSCORE"))).toBe(8);
    expect(feedbackOf(outcomes)).toStrictEqual(["R1-correct", "R2-partial"]);
    expect(numberOf(outcomesOf(compileScoring(responses, { allParts: true }), answers).get("SCORE"))).toBe(0);
    const right = { R1: one("identifier", "A"), R2: ordered(["A", "B", "C"]) };
    expect(numberOf(outcomesOf(compileScoring(responses, { allParts: true }), right).get("SCORE"))).toBe(8);
    expect(numberOf(outcomesOf(compileScoring(responses, { floor: 5 }), answers).get("SCORE"))).toBe(5);
    expect(feedbackOf(outcomesOf(compileScoring(responses), { R1: null, R2: ordered(["C", "A", "B"]) }))).toStrictEqual(
      ["R1-blank", "R2-incorrect"],
    );
  });

  it("writes the operators' outcomes for a host with portable", () => {
    const responses: ScoredResponse[] = [
      { identifier: "R1", key: { kind: "choice", keys: ["A"] } },
      { identifier: "R2", key: { kind: "text", answers: [{ texts: ["x"] }] } },
    ];
    expect(compileScoring(responses).outcomeDeclarations.map(({ identifier }) => identifier)).toStrictEqual([
      "SCORE",
      "MAXSCORE",
      "SCORE_R1",
      "SCORE_R2",
      "FEEDBACK",
    ]);
    const portable = compileScoring(responses, { portable: true });
    expect(portable.operators).toStrictEqual([]);
    expect(
      portable.outcomeDeclarations
        .filter(({ externalScored }) => externalScored === "externalMachine")
        .map(({ identifier }) => identifier),
    ).toStrictEqual(["SCORE", "SCORE_R2"]);
    expect(writeAsi({ kind: "item", item: itemOf(portable) })).not.toContain("qti-custom-operator");
    const outcomes = outcomesOf(portable, { R1: one("identifier", "A"), R2: null });
    expect(numberOf(outcomes.get("SCORE_R1"))).toBe(1);
    expect(feedbackOf(outcomes)).toStrictEqual(["R1-correct", "R2-blank"]);
    const alone = compileScoring([responses[1] as ScoredResponse], { portable: true });
    expect(alone.responseProcessing.rules).toHaveLength(1);
    expect(alone.outcomeDeclarations[0]).toMatchObject({ identifier: "SCORE", externalScored: "externalMachine" });
  });

  it("refuses a key or an item past the limits of keys", () => {
    const order = Array.from({ length: DEFAULT_KEY_LIMITS.entries + 1 }, (_, at) => `C${at}`);
    expect(() => compileScoring([respond({ kind: "order", order })])).toThrow(SecurityError);
    expect(() => compileScoring([respond({ kind: "order", order: order.slice(1) })])).not.toThrow();
    const many = (count: number) =>
      Array.from(
        { length: count },
        (_, at): ScoredResponse => ({ identifier: `R${at}`, key: { kind: "choice", keys: ["A"] } }),
      );
    expect(DEFAULT_KEY_LIMITS.responses).toBe(256);
    expect(compileScoring(many(256)).outcomeDeclarations).toHaveLength(259);
    const error = (() => {
      try {
        compileScoring(many(257));
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(SecurityError);
    expect(error).toMatchObject({ limit: "responses", maximum: 256 });
    const text = respond({ kind: "text", answers: Array.from({ length: 1_001 }, (_, at) => ({ texts: [`t${at}`] })) });
    expect(() => compileScoring([text])).toThrow(SecurityError);
    const pattern = (length: number) =>
      respond({ kind: "text", answers: [{ texts: [], patterns: ["a".repeat(length)] }] });
    expect(() => compileScoring([pattern(DEFAULT_KEY_LIMITS.patternLength + 1)])).toThrow(
      "over the limit patternLength of 1000",
    );
    expect(compileScoring([pattern(DEFAULT_KEY_LIMITS.patternLength)]).operators).toHaveLength(1);
  });

  it("refuses identifiers that are taken, reserved or too long beside others", () => {
    const choice: Key = { kind: "choice", keys: ["A"] };
    expect(() => compileScoring([{ identifier: "SCORE", key: choice }])).toThrow(
      "an outcome of the item or a built-in",
    );
    expect(() => compileScoring([{ identifier: "numAttempts", key: choice }])).toThrow(DataError);
    expect(() =>
      compileScoring([
        { identifier: "R", key: choice },
        { identifier: "R", key: choice },
      ]),
    ).toThrow("which another response has");
    expect(() =>
      compileScoring([
        { identifier: "A", key: choice },
        { identifier: "SCORE_A", key: choice },
      ]),
    ).toThrow("the outcome of another response");
    const long = "R".repeat(27);
    expect(compileScoring([{ identifier: long, key: choice }]).responseDeclarations).toHaveLength(1);
    expect(() =>
      compileScoring([
        { identifier: long, key: choice },
        { identifier: "B", key: choice },
      ]),
    ).toThrow("at most 26");
    expect(() => compileScoring([{ identifier: "1R", key: choice }])).toThrow("QTI identifier");
  });

  it("refuses a follow-through that reads no expression or is not earlier", () => {
    const number: Key = { kind: "number", value: 1 };
    const follow = (from: string, earlier: Key = number): ScoredResponse[] => [
      { identifier: "R1", key: earlier },
      { identifier: "R2", key: { kind: "number", value: 2 }, followThrough: { from, expression: "2r" } },
    ];
    expect(() => compileScoring(follow("R3"))).toThrow("no earlier response");
    expect(() => compileScoring(follow("R2"))).toThrow("no earlier response");
    expect(() => compileScoring(follow("R1", { kind: "number", value: 1, units: { m: 1 } }))).toThrow("without units");
    expect(() => compileScoring(follow("R1", { kind: "choice", keys: ["A"] }))).toThrow("without units");
    expect(() =>
      compileScoring([
        { identifier: "R1", key: number },
        { identifier: "R2", key: { kind: "choice", keys: ["A"] }, followThrough: { from: "R1", expression: "r" } },
      ]),
    ).toThrow("a number or an expression key alone");
  });

  it("refuses a key that its scheme or its operator refuses, naming the response", () => {
    const refused = (key: unknown, message: string | RegExp) =>
      expect(() => compileScoring([{ identifier: "R", key: json(JSON.stringify(key)) }])).toThrow(message);
    refused({ kind: "choice", keys: ["A", "B"], maxChoices: 1 }, "below the 2 keys");
    refused({ kind: "choice", keys: ["A", "A"] }, "each identifier once");
    refused({ kind: "choice", keys: [] }, "length of at least 1");
    refused({ kind: "choice-mapping", points: { A: 0, B: -1 } }, "no response earns points");
    refused({ kind: "choice-mapping", points: { "1A": 1 } }, "QTI identifier");
    refused({ kind: "choice-marking", keys: ["A"], correct: 0, wrong: 0 }, "positive number");
    refused({ kind: "choice-marking", keys: ["A", "B"], correct: 1, wrong: -1, blank: 2.5 }, "above the 2 that");
    refused({ kind: "pairs", pairs: [["A", "A"]] }, "two choices");
    refused(
      {
        kind: "pairs",
        pairs: [
          ["A", "B"],
          ["B", "A"],
        ],
        directed: false,
      },
      "given twice",
    );
    refused({ kind: "pairs", pairs: [["A", "B"]], scheme: "mapping" }, "with the scheme mapping");
    refused({ kind: "pairs", pairs: [["A", "B"]], points: [1] }, "with the scheme mapping");
    refused({ kind: "pairs", pairs: [["A", "B"]], scheme: "mapping", points: [1, 2] }, "found 2");
    refused(
      {
        kind: "pairs",
        pairs: [
          ["A", "B"],
          ["C", "D"],
        ],
        maxPairs: 1,
      },
      "below the 2 pairs",
    );
    refused({ kind: "order", order: ["A"], scheme: "adjacent-pairs" }, "at least two choices");
    refused(
      { kind: "areas", scheme: "mapping", areas: [{ id: "A", shape: "rect", coords: [0, 0, 1] }] },
      "fit the shape",
    );
    refused(
      { kind: "areas", scheme: "mapping", select: 2, areas: [{ id: "A", shape: "rect", coords: [0, 0, 1, 1] }] },
      "above the 1 areas",
    );
    refused(
      { kind: "areas", scheme: "mapping", areas: [{ id: "A", shape: "rect", coords: [0, 0, 1, 1], points: 0 }] },
      "no response earns",
    );
    refused(
      { kind: "text", answers: [{ texts: ["a"] }], spelling: "variants" },
      /responses\[0\].*key\.spelling.*each accepted variant/,
    );
    refused({ kind: "expression", expression: "\\frac{" }, /The response R at responses\[0\]/);
    refused({ kind: "unknown" }, "kind");
    expect(() => compileScoring([{ identifier: "R", key: { kind: "choice", keys: ["A"] } }], { floor: 2 })).toThrow(
      "above the item's maximum of 1",
    );
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "refuses a key of any kind that has a property named %s, as it refuses any other unknown property",
    (name) => {
      const keys = [
        '"kind":"choice","keys":["A"]',
        '"kind":"choice-mapping","points":{"A":1}',
        '"kind":"choice-marking","keys":["A"],"correct":4,"wrong":-1',
        '"kind":"pairs","pairs":[["A","B"]]',
        '"kind":"order","order":["A","B"]',
        '"kind":"areas","scheme":"mapped","areas":[{"shape":"circle","coords":[1,1,1],"points":1}]',
        '"kind":"text","answers":[{"texts":["a"]}]',
        '"kind":"number","value":1',
        '"kind":"expression","expression":"x"',
      ];
      for (const key of keys) {
        expect(() => compileScoring([json(`{"identifier":"R","key":{${key},"${name}":1}}`)]), key).toThrow(
          `holds a property "${name}", a name that reaches the prototype`,
        );
      }
    },
  );

  it.each(["__proto__", "prototype", "constructor"])("keeps %s as the identifier of an option in points", (name) => {
    const key: Key = json(`{"kind":"choice-mapping","points":{"${name}":2}}`);
    const answer = present(buildContainer("multiple", "identifier", [name]));
    expect(scoreOne(respond(key), answer)).toBe(2);
  });

  it("refuses input of other types", () => {
    const choice = { identifier: "R", key: { kind: "choice", keys: ["A"] } };
    expect(() => compileScoring(json("null"))).toThrow("The responses must be an array");
    expect(() => compileScoring(json("{}"))).toThrow("The responses must be an array");
    expect(() => compileScoring([])).toThrow("at least one response");
    expect(() => compileScoring([json("null")])).toThrow("The response at responses[0]");
    expect(() => compileScoring([json(JSON.stringify({ ...choice, other: 1 }))])).toThrow(
      'unexpected property "other"',
    );
    expect(() => compileScoring([json(JSON.stringify({ ...choice, maxPoints: "2" }))])).toThrow("maxPoints");
    expect(() => compileScoring([json(JSON.stringify({ ...choice, weight: 0 }))])).toThrow("weight");
    expect(() => compileScoring([json(JSON.stringify(choice))], json("null"))).toThrow("The options of compileScoring");
    expect(() => compileScoring([json(JSON.stringify(choice))], json('{"other":1}'))).toThrow(
      'unexpected property "other"',
    );
    expect(() => compileScoring([json(JSON.stringify(choice))], json('{"floor":"0"}'))).toThrow("floor");
    expect(() => compileScoring([json(JSON.stringify(choice))], json('{"limits":{"entries":10}}'))).toThrow(
      'unexpected property "limits"',
    );
    expect(() => compileScoring([json(JSON.stringify(choice))], json('{"feedback":false}'))).toThrow(
      'unexpected property "feedback"',
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/scoring.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/runtime": await import("../src/index.js"),
      "@assesskit/runtime/asi": await import("../src/asi/index.js"),
      "@assesskit/runtime/keys": await import("../src/keys/index.js"),
      "@assesskit/runtime/operators": await import("../src/operators/index.js"),
      "@assesskit/runtime/processing": await import("../src/processing/index.js"),
      "@assesskit/runtime/scoring": await import("../src/scoring/index.js"),
      "@assesskit/runtime/values": await import("../src/values/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("scores every response of a compiled item between its minimum and its maximum, and SCORE as their sum", () => {
    fc.assert(
      fc.property(scoredResponsesOf(), ({ responses, answers }) => {
        const scoring = compileScoring(responses);
        const outcomes = outcomesOf(scoring, answers);
        const declared = new Map(
          scoring.outcomeDeclarations.map((declaration) => [declaration.identifier, declaration]),
        );
        const parts = responses.length === 1 ? ["SCORE"] : responses.map(({ identifier }) => `SCORE_${identifier}`);
        let total = 0;
        for (const part of parts) {
          const score = numberOf(outcomes.get(part)) ?? Number.NaN;
          const declaration = declared.get(part);
          expect(score).toBeLessThanOrEqual((declaration?.normalMaximum ?? 0) * (1 + 1e-12));
          expect(score).toBeGreaterThanOrEqual(Math.min(0, declaration?.normalMinimum ?? 0) - 1e-12);
          total += score;
        }
        expect(Math.abs((numberOf(outcomes.get("SCORE")) ?? Number.NaN) - total)).toBeLessThanOrEqual(1e-9);
        expect(feedbackOf(outcomes)).toHaveLength(responses.length);
      }),
      FUZZ,
    );
  });

  it("compiles the same keys to the same item", () => {
    fc.assert(
      fc.property(scoredResponsesOf(), ({ responses }) => {
        const first = writeAsi({ kind: "item", item: itemOf(compileScoring(responses)) });
        expect(writeAsi({ kind: "item", item: itemOf(compileScoring(structuredClone(responses))) })).toBe(first);
      }),
      FUZZ,
    );
  });
});
