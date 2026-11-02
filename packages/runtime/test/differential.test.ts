import {
  captureQtiTextResponse,
  parseQtiXml,
  type QtiInteraction,
  validateQtiResponseVariables,
} from "@longsightgroup/qti3-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkResponse,
  container,
  describeInteractions,
  numericRecord,
  readAsi,
  single,
  type Value,
} from "../src/index.js";
import { ACCEPTED_DIFFERENCES } from "./differential/accepted.js";
import { ampUp, UNSUPPORTED } from "./differential/amp-up.js";
import { compare, compareSessions, sameValue } from "./differential/compare.js";
import { CHOICE_ITEM, sessionItem, TEMPLATE_ITEM } from "./differential/items.js";
import { correctResponses, longsight, longsightRandom } from "./differential/longsight.js";
import type {
  Implementation,
  ItemCase,
  Observation,
  Play,
  Run,
  SessionCase,
  Turn,
  TurnObservation,
} from "./differential/model.js";
import { runtime } from "./differential/runtime.js";

// The runtime against Longsight qti3-core, the one other implementation of the item processing of QTI 3. `differential.corpus.test.ts`
// runs the 1EdTech examples through the same comparison.

const NAMESPACE = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/** The oracle needs an item body. */
const BODY = "<qti-item-body><p>Generated.</p></qti-item-body>";

/** An item that sets the outcome OUT, of a type, to an expression, after the responses it declares. */
function itemCase(
  name: string,
  outcome: string,
  expression: string,
  declarations = "",
  responses: ItemCase["responses"] = {},
): ItemCase {
  const xml = `<qti-assessment-item xmlns="${NAMESPACE}" identifier="generated" title="Generated" time-dependent="false">
    ${declarations}
    <qti-outcome-declaration identifier="OUT" ${outcome}/>
    ${BODY}
    <qti-response-processing><qti-set-outcome-value identifier="OUT">${expression}</qti-set-outcome-value></qti-response-processing>
  </qti-assessment-item>`;
  return { name, xml, responses, seed: 1 };
}

const bv = (baseType: string, value: string | number | boolean): string =>
  `<qti-base-value base-type="${baseType}">${value}</qti-base-value>`;
const integer = fc.integer({ min: -1000, max: 1000 });
const decimal = fc.integer({ min: -100_000, max: 100_000 }).map((value) => value / 100);

/** Runs both implementations on generated cases and expects them to agree on every one both accept. */
function agreeOnItems(cases: fc.Arbitrary<ItemCase>): void {
  fc.assert(
    fc.property(cases, (testCase) => {
      const report = compare([testCase], longsight, runtime, []);
      expect(report.differences, testCase.xml).toEqual([]);
      expect(report.compared, testCase.xml).toBe(1);
    }),
    { numRuns: 200 },
  );
}

describe("runtime against the oracle on generated items", () => {
  it("agree on integer and float arithmetic", () => {
    const binary = fc.constantFrom("sum", "product", "subtract", "min", "max");
    agreeOnItems(
      fc.tuple(binary, integer, integer, fc.boolean()).map(([operator, a, b, floats]) => {
        const type = floats ? "float" : "integer";
        return itemCase(
          `${operator}`,
          `cardinality="single" base-type="${type}"`,
          `<qti-${operator}>${bv(type, a)}${bv("integer", b)}</qti-${operator}>`,
        );
      }),
    );
    agreeOnItems(
      fc
        .tuple(fc.constantFrom("integer-divide", "integer-modulus"), integer, integer)
        .map(([operator, a, b]) =>
          itemCase(
            operator,
            `cardinality="single" base-type="integer"`,
            `<qti-${operator}>${bv("integer", a)}${bv("integer", b)}</qti-${operator}>`,
          ),
        ),
    );
    agreeOnItems(
      fc
        .tuple(fc.constantFrom("divide", "power"), decimal, fc.integer({ min: -4, max: 4 }))
        .map(([operator, a, b]) =>
          itemCase(
            operator,
            `cardinality="single" base-type="float"`,
            `<qti-${operator}>${bv("float", a)}${bv("integer", b)}</qti-${operator}>`,
          ),
        ),
    );
  });

  it("agree on rounding to integers, decimal places and significant figures", () => {
    agreeOnItems(
      fc
        .tuple(fc.constantFrom("round", "truncate"), decimal)
        .map(([operator, a]) =>
          itemCase(
            operator,
            `cardinality="single" base-type="integer"`,
            `<qti-${operator}>${bv("float", a)}</qti-${operator}>`,
          ),
        ),
    );
    agreeOnItems(
      fc
        .tuple(decimal, fc.constantFrom("decimalPlaces", "significantFigures"), fc.integer({ min: 1, max: 4 }))
        .map(([a, mode, figures]) =>
          itemCase(
            "round-to",
            `cardinality="single" base-type="float"`,
            `<qti-round-to rounding-mode="${mode}" figures="${figures}">${bv("float", a)}</qti-round-to>`,
          ),
        ),
    );
  });

  const equalCase = (x: number, y: number, mode: string, tolerance: number, lower: boolean, upper: boolean): ItemCase =>
    itemCase(
      "equal",
      `cardinality="single" base-type="boolean"`,
      `<qti-equal tolerance-mode="${mode}" tolerance="${tolerance}" include-lower-bound="${lower}" include-upper-bound="${upper}">${bv("float", x)}${bv("float", y)}</qti-equal>`,
    );
  const tolerances = fc.tuple(
    fc.constantFrom("absolute", "relative"),
    fc.integer({ min: 0, max: 50 }),
    fc.boolean(),
    fc.boolean(),
  );

  it("agree on equality within absolute and relative tolerances", () => {
    const relativeSafe = fc
      .tuple(decimal, decimal, tolerances)
      .filter(([x, , [mode]]) => mode === "absolute" || x >= 0);
    agreeOnItems(
      relativeSafe.map(([x, y, [mode, tolerance, lower, upper]]) => equalCase(x, y, mode, tolerance, lower, upper)),
    );
  });

  it("differ only for a negative x in relative mode, where the oracle's range is empty and the runtime's lies between its ends", () => {
    const report = compare([equalCase(-10, -10.5, "relative", 10, true, true)], longsight, runtime, []);
    expect(report.differences).toEqual([
      { item: "equal", kind: "outcome", variable: "OUT", reference: false, subject: true },
    ]);
  });

  it("agree on three-valued logic", () => {
    const operand = fc.constantFrom(bv("boolean", true), bv("boolean", false), "<qti-null/>");
    agreeOnItems(
      fc
        .tuple(fc.constantFrom("and", "or"), fc.array(operand, { minLength: 1, maxLength: 4 }))
        .map(([operator, operands]) =>
          itemCase(
            operator,
            `cardinality="single" base-type="boolean"`,
            `<qti-${operator}>${operands.join("")}</qti-${operator}>`,
          ),
        ),
    );
  });

  it("agree on membership, containment and deletion", () => {
    const values = fc.array(fc.constantFrom("A", "B", "C"), { minLength: 1, maxLength: 5 });
    const container = (cardinality: string, items: readonly string[]) =>
      `<qti-${cardinality}>${items.map((item) => bv("identifier", item)).join("")}</qti-${cardinality}>`;
    agreeOnItems(
      fc
        .tuple(fc.constantFrom("multiple", "ordered"), values, values)
        .map(([cardinality, whole, part]) =>
          itemCase(
            "contains",
            `cardinality="single" base-type="boolean"`,
            `<qti-contains>${container(cardinality, whole)}${container(cardinality, part)}</qti-contains>`,
          ),
        ),
    );
    agreeOnItems(
      fc
        .tuple(fc.constantFrom("A", "B", "C"), values)
        .map(([value, whole]) =>
          itemCase(
            "member",
            `cardinality="single" base-type="boolean"`,
            `<qti-member>${bv("identifier", value)}${container("ordered", whole)}</qti-member>`,
          ),
        ),
    );
  });

  it("agree on mapping responses with defaults and bounds", () => {
    const entry = fc.tuple(fc.constantFrom("A", "B", "C", "D"), fc.integer({ min: -4, max: 4 }));
    agreeOnItems(
      fc
        .tuple(
          fc.uniqueArray(entry, { selector: ([key]) => key, minLength: 1 }),
          fc.integer({ min: -2, max: 2 }),
          fc.option(fc.integer({ min: -3, max: 0 })),
          fc.option(fc.integer({ min: 1, max: 5 })),
        )
        .chain(([entries, defaultValue, lower, upper]) =>
          fc.array(fc.constantFrom("A", "B", "C", "D", "E"), { minLength: 1, maxLength: 5 }).map((response) => {
            const bounds = `${lower === null ? "" : ` lower-bound="${lower}"`}${upper === null ? "" : ` upper-bound="${upper}"`}`;
            const mapping = `<qti-mapping default-value="${defaultValue}"${bounds}>${entries.map(([key, value]) => `<qti-map-entry map-key="${key}" mapped-value="${value}"/>`).join("")}</qti-mapping>`;
            return itemCase(
              "map-response",
              `cardinality="single" base-type="float"`,
              `<qti-map-response identifier="RESPONSE"/>`,
              `<qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier">${mapping}</qti-response-declaration>`,
              { RESPONSE: [...response] },
            );
          }),
        ),
    );
  });

  it("agree on template values drawn from the same generator", () => {
    agreeOnItems(
      fc
        .tuple(
          fc.integer({ min: 0, max: 2 ** 31 }),
          fc.integer({ min: -10, max: 10 }),
          fc.integer({ min: 0, max: 30 }),
          fc.integer({ min: 1, max: 4 }),
        )
        .map(([seed, min, span, step]) => {
          const xml = `<qti-assessment-item xmlns="${NAMESPACE}" identifier="generated" title="Generated" time-dependent="false">
            <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
            <qti-template-declaration identifier="X" cardinality="single" base-type="float"/>
            <qti-template-processing>
              <qti-set-template-value identifier="N"><qti-random-integer min="${min}" max="${min + span}" step="${step}"/></qti-set-template-value>
              <qti-set-template-value identifier="X"><qti-random-float min="${min}" max="${min + span}"/></qti-set-template-value>
            </qti-template-processing>
            ${BODY}
          </qti-assessment-item>`;
          return { name: "random", xml, responses: {}, seed };
        }),
    );
  });

  it("agree turn by turn on sessions of adaptive and non-adaptive items, hints included", () => {
    const turns = fc.array(
      fc
        .record({ choice: fc.constantFrom("A", "B", "C"), hint: fc.boolean() })
        .map(
          ({ choice, hint }): Turn =>
            hint ? { responses: { RESPONSE: choice }, endAttempt: "HINT" } : { responses: { RESPONSE: choice } },
        ),
      { minLength: 1, maxLength: 6 },
    );
    fc.assert(
      fc.property(fc.boolean(), turns, (adaptive, played) => {
        const report = compareSessions(
          [{ name: "session", xml: sessionItem(adaptive), turns: played, seed: 1 }],
          longsight,
          runtime,
          [],
        );
        expect(report.differences).toEqual([]);
        expect(report.compared).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  it("counts every attempt of a non-adaptive item that completed, which the oracle stops counting", () => {
    const turns: Turn[] = [{ responses: { RESPONSE: "B" } }, { responses: { RESPONSE: "A" } }];
    const testCase = {
      name: "a non-adaptive item that completes (turns)",
      xml: sessionItem(false, true),
      turns,
      seed: 1,
    };
    const report = compareSessions([testCase], longsight, runtime, ACCEPTED_DIFFERENCES);
    expect(report.differences).toEqual([]);
    expect(report.accepted).toEqual([
      { item: `${testCase.name} turn 2`, kind: "session", variable: "numAttempts", reference: 1, subject: 2 },
    ]);
  });
});

/** An item with one response declaration and the markup as its body. */
function itemXml(declaration: string, body: string): string {
  return `<qti-assessment-item xmlns="${NAMESPACE}" identifier="generated" title="Generated" time-dependent="false">${declaration}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`;
}

/** A case: an item, and a response in the form each implementation takes. */
interface ValidityCase {
  readonly xml: string;
  readonly oracle: unknown;
  readonly subject: Value | null;
}

/** Whether the oracle takes the response as valid, or `undefined` when it does not accept the item. */
function oracleValid(testCase: ValidityCase): boolean | undefined {
  const parsed = parseQtiXml(testCase.xml);
  if (!parsed.ok || parsed.document === undefined) return undefined;
  return validateQtiResponseVariables({ item: parsed.document.item, responses: { R: testCase.oracle } }).ok;
}

/** Whether the runtime takes the response as valid. */
function subjectValid(testCase: ValidityCase): boolean {
  const document = readAsi(testCase.xml);
  if (document.kind !== "item") throw new Error("The case is no item.");
  const [descriptor] = describeInteractions(document.item);
  if (descriptor === undefined) throw new Error("The case has no interaction.");
  return checkResponse(descriptor, testCase.subject).reasons.length === 0;
}

function agreeOnValidity(cases: fc.Arbitrary<ValidityCase>): void {
  fc.assert(
    fc.property(cases, (testCase) => {
      const oracle = oracleValid(testCase);
      expect(oracle, `the oracle accepts ${testCase.xml}`).toBeDefined();
      expect(subjectValid(testCase), `${testCase.xml} with ${JSON.stringify(testCase.oracle)}`).toBe(oracle);
    }),
    { numRuns: 300 },
  );
}

const IDENTIFIERS = ["A", "B", "C", "D", "E"];
const choiceMarkup = (identifiers: readonly string[], tag: string, attributes = ""): string =>
  identifiers.map((identifier) => `<${tag} identifier="${identifier}"${attributes}>${identifier}</${tag}>`).join("");
const declare = (cardinality: string, baseType: string): string =>
  `<qti-response-declaration identifier="R" cardinality="${cardinality}" base-type="${baseType}"/>`;
const attribute = (name: string, value: number | undefined): string =>
  value === undefined ? "" : ` ${name}="${value}"`;

/** Identifiers picked from the choices, and sometimes one that is no choice. */
const pickedFrom = (choices: readonly string[]): fc.Arbitrary<string[]> =>
  fc.uniqueArray(fc.constantFrom(...choices, "Z"), { maxLength: choices.length + 1 });

describe("runtime against the oracle on the validity of responses", () => {
  it("agree on min-choices, max-choices and the choices of a choice interaction", () => {
    agreeOnValidity(
      fc
        .record({
          size: fc.integer({ min: 2, max: 5 }),
          min: fc.option(fc.integer({ min: 0, max: 2 }), { nil: undefined }),
          max: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
        })
        .filter(({ min, max }) => min === undefined || max === undefined || min <= max)
        .chain(({ size, min, max }) =>
          pickedFrom(IDENTIFIERS.slice(0, size)).map((picked): ValidityCase => {
            const xml = itemXml(
              declare("multiple", "identifier"),
              `<qti-choice-interaction response-identifier="R"${attribute("min-choices", min)}${attribute("max-choices", max ?? 4)}>${choiceMarkup(IDENTIFIERS.slice(0, size), "qti-simple-choice")}</qti-choice-interaction>`,
            );
            return { xml, oracle: picked, subject: container("multiple", "identifier", picked) };
          }),
        ),
    );
  });

  it("agree on the choices an order interaction needs: all of them, or between min-choices and max-choices", () => {
    agreeOnValidity(
      fc
        .record({
          size: fc.integer({ min: 2, max: 5 }),
          subset: fc.boolean(),
          min: fc.integer({ min: 1, max: 3 }),
          extra: fc.integer({ min: 0, max: 2 }),
        })
        .chain(({ size, subset, min, extra }) =>
          pickedFrom(IDENTIFIERS.slice(0, size)).map((picked): ValidityCase => {
            const limits = subset
              ? attribute("min-choices", Math.min(min, size)) + attribute("max-choices", Math.min(min + extra, size))
              : "";
            const xml = itemXml(
              declare("ordered", "identifier"),
              `<qti-order-interaction response-identifier="R"${limits}>${choiceMarkup(IDENTIFIERS.slice(0, size), "qti-simple-choice")}</qti-order-interaction>`,
            );
            return { xml, oracle: picked, subject: container("ordered", "identifier", picked) };
          }),
        ),
    );
  });

  it("agree on max-associations, match-max and the choices of an associate interaction", () => {
    const pairOf = fc.tuple(
      fc.constantFrom(...IDENTIFIERS.slice(0, 4), "Z"),
      fc.constantFrom(...IDENTIFIERS.slice(0, 4)),
    );
    agreeOnValidity(
      fc
        .record({
          max: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
          matchMax: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 4, maxLength: 4 }),
          pairs: fc.array(pairOf, { maxLength: 4 }),
        })
        .map(({ max, matchMax, pairs }): ValidityCase => {
          const choices = IDENTIFIERS.slice(0, 4)
            .map(
              (identifier, place) =>
                `<qti-simple-associable-choice identifier="${identifier}" match-max="${matchMax[place]}">${identifier}</qti-simple-associable-choice>`,
            )
            .join("");
          const xml = itemXml(
            declare("multiple", "pair"),
            `<qti-associate-interaction response-identifier="R"${attribute("max-associations", max ?? 3)}>${choices}</qti-associate-interaction>`,
          );
          return { xml, oracle: pairs.map(([a, b]) => `${a} ${b}`), subject: container("multiple", "pair", pairs) };
        }),
    );
  });

  it("agree on an inline choice interaction that is required, and on the choice made", () => {
    agreeOnValidity(
      fc.tuple(fc.boolean(), fc.constantFrom(undefined, "A", "B", "Z")).map(([required, picked]): ValidityCase => {
        const xml = itemXml(
          declare("single", "identifier"),
          `<p><qti-inline-choice-interaction response-identifier="R" required="${required}">${choiceMarkup(["A", "B"], "qti-inline-choice")}</qti-inline-choice-interaction></p>`,
        );
        return { xml, oracle: picked ?? null, subject: picked === undefined ? null : single("identifier", picked) };
      }),
    );
  });
});

/** The interaction the oracle takes the typed text of: a text entry bound to a record, in a base. */
function recordInteraction(base: number): QtiInteraction {
  const parsed = parseQtiXml(
    itemXml(
      '<qti-response-declaration identifier="R" cardinality="record"/>',
      `<p><qti-text-entry-interaction response-identifier="R" base="${base}"/></p>`,
    ),
  );
  const [interaction] = parsed.document?.item.interactions ?? [];
  if (interaction === undefined) throw new Error("The oracle reads no interaction.");
  return interaction;
}

/** The fields of the record that the oracle makes for a text, by name, without those that are NULL. */
function oracleFields(text: string, base: number): Record<string, unknown> {
  const captured = captureQtiTextResponse(recordInteraction(base), text);
  return Object.fromEntries(Object.entries(captured ?? {}).filter(([, value]) => value !== null));
}

/** The fields that are floats; the others are integers. */
const FLOAT_FIELDS = new Set(["stringValue", "floatValue"]);

/**
 * The fields of the record that the runtime makes for a text, by name, and those of the oracle that are not NULL. An integer has
 * no sign of zero in the runtime (T2), and the oracle's `integerValue` and `exponent` are `-0` for the text `-0` and `e-0`, so
 * the integers of the oracle are compared without it.
 */
function numericFields(
  text: string,
  base: number,
): {
  readonly subject: Record<string, unknown>;
  readonly oracle: Record<string, unknown>;
} {
  const made = numericRecord(text, base);
  const subject = Object.fromEntries([...(made?.fields ?? [])].map(([name, field]) => [name, field.value]));
  const oracle = Object.fromEntries(
    Object.entries(oracleFields(text, base)).map(([name, value]) => [
      name,
      typeof value === "number" && !FLOAT_FIELDS.has(name) ? value + 0 : value,
    ]),
  );
  return { subject, oracle };
}

describe("runtime against the oracle on numeric text", () => {
  const digits = fc.stringMatching(/^[0-9]{0,5}$/);
  const decimalText = fc
    .record({
      sign: fc.constantFrom("", "-", "+"),
      left: digits,
      point: fc.boolean(),
      right: digits,
      exponent: fc.option(fc.integer({ min: -30, max: 30 }), { nil: undefined }),
    })
    .map(
      ({ sign, left, point, right, exponent }) =>
        `${sign}${left}${point ? "." : ""}${right}${exponent === undefined ? "" : `e${exponent}`}`,
    )
    .filter((text) => text !== "");

  /** A number whose point has no digits after it and no exponent follows, such as `5.`. */
  const endsInPoint = (text: string): boolean => /^[+-]?[0-9]*\.$/.test(text);

  it("agree on the fields of the record that a typed decimal makes", () => {
    fc.assert(
      fc.property(
        decimalText.filter((text) => !endsInPoint(text)),
        (text) => {
          const { subject, oracle } = numericFields(text, 10);
          expect(subject, text).toEqual(oracle);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("differ for a number that ends in its point: the specification gives an integerValue when no fractional digits were specified, and the oracle gives none", () => {
    for (const [text, value] of [
      ["5.", 5],
      ["-12.", -12],
    ] as const) {
      const { subject, oracle } = numericFields(text, 10);
      expect(subject, text).toEqual({ ...oracle, integerValue: value });
    }
  });

  it("differ in the sign of a zero integer: the runtime has none for an integer, and the oracle gives -0 for the integerValue of `-0` and the exponent of `1e-0`", () => {
    expect(Object.is(oracleFields("-0", 10).integerValue, -0)).toBe(true);
    expect(Object.is(oracleFields("1e-0", 10).exponent, -0)).toBe(true);
    const { subject } = numericFields("-0", 10);
    expect(Object.is(subject.floatValue, -0)).toBe(true);
    expect(Object.is(subject.integerValue, 0)).toBe(true);
    expect(Object.is(numericFields("1e-0", 10).subject.exponent, 0)).toBe(true);
    for (const text of ["-0", "-00", "+0", "-.0e5", "1e-0", "-0e-0"]) {
      const { subject: made, oracle } = numericFields(text, 10);
      expect(made, text).toEqual(oracle);
    }
  });

  it("agree on integers in the bases from 2 to 36", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), fc.integer({ min: 2, max: 36 }), (value, base) => {
        const text = value.toString(base);
        const { subject, oracle } = numericFields(text, base);
        expect(subject, `${text} in base ${base}`).toEqual(oracle);
      }),
    );
  });
});

// The harness ---------------------------------------------------------------------------------------------------------------

const testCase = (name: string): ItemCase => ({ name, xml: "<qti-assessment-item/>", responses: {}, seed: 1 });
const accepts = (observation: Partial<Observation>): Run => ({
  accepted: true,
  observation: { outcomes: {}, templateValues: {}, ...observation },
});
const rejects = (reason: string): Run & Play => ({ accepted: false, reason });
const implementation = (name: string, runs: Record<string, Run>, plays: Record<string, Play> = {}): Implementation => ({
  name,
  run: (item) => runs[item.name] ?? rejects("unknown"),
  play: (session) => plays[session.name] ?? rejects("unknown"),
});
const sessionCase = (name: string): SessionCase => ({ name, xml: "<qti-assessment-item/>", turns: [], seed: 1 });
const turn = (observation: Partial<TurnObservation>): TurnObservation => ({
  accepted: true,
  outcomes: {},
  numAttempts: 1,
  closed: false,
  ...observation,
});

describe("sameValue", () => {
  it("compares scalars, lists and records element by element", () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue(1, "1")).toBe(false);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue(["A", "B"], ["A", "B"])).toBe(true);
    expect(sameValue(["A", "B"], ["B", "A"])).toBe(false);
    expect(sameValue(["A"], ["A", "B"])).toBe(false);
    expect(sameValue({ x: 1, y: "a" }, { y: "a", x: 1 })).toBe(true);
    expect(sameValue({ x: 1 }, { x: 1, y: 2 })).toBe(false);
    expect(sameValue(["A"], { 0: "A" })).toBe(false);
  });
});

describe("compare", () => {
  it("reports the outcome and template values that differ", () => {
    const reference = implementation("ref", {
      a: accepts({ outcomes: { SCORE: 1, FEEDBACK: "ok" }, templateValues: { N: 5 } }),
    });
    const subject = implementation("sub", {
      a: accepts({ outcomes: { SCORE: 0, FEEDBACK: "ok" }, templateValues: { N: 6, M: 1 } }),
    });
    const report = compare([testCase("a")], reference, subject, []);
    expect(report.compared).toBe(1);
    expect(report.differences).toEqual([
      { item: "a", kind: "outcome", variable: "SCORE", reference: 1, subject: 0 },
      { item: "a", kind: "template", variable: "M", reference: undefined, subject: 1 },
      { item: "a", kind: "template", variable: "N", reference: 5, subject: 6 },
    ]);
  });

  it("reports an item that only one implementation accepts, and lists the items both reject", () => {
    const reference = implementation("ref", { a: accepts({}), b: rejects("not an item") });
    const subject = implementation("sub", { a: rejects("unsupported"), b: rejects("not an item either") });
    const report = compare([testCase("a"), testCase("b")], reference, subject, []);
    expect(report.compared).toBe(0);
    expect(report.rejected).toEqual([{ item: "b", reason: "not an item" }]);
    expect(report.differences).toEqual([
      { item: "a", kind: "acceptance", variable: "", reference: true, subject: false },
    ]);
  });

  it("sets aside the accepted differences", () => {
    const reference = implementation("ref", { a: accepts({ outcomes: { SCORE: 1 } }) });
    const subject = implementation("sub", { a: accepts({ outcomes: { SCORE: 0 } }) });
    const accepted = [{ items: ["a"], variable: "SCORE", reason: "The specification says 0." }];
    const report = compare([testCase("a")], reference, subject, accepted);
    expect(report.differences).toEqual([]);
    expect(report.accepted).toHaveLength(1);
  });

  it("sets aside the differences of one kind of variable on the items it lists", () => {
    const reference = implementation("ref", {
      a: accepts({ templateValues: { N: 5, M: 1 }, outcomes: { SCORE: 1 } }),
      b: accepts({ templateValues: { N: 5 } }),
    });
    const subject = implementation("sub", {
      a: accepts({ templateValues: { N: 6, M: 2 }, outcomes: { SCORE: 0 } }),
      b: accepts({ templateValues: { N: 6 } }),
    });
    const accepted = [{ items: ["a"], kind: "template" as const, reason: "The draws differ." }];
    const report = compare([testCase("a"), testCase("b")], reference, subject, accepted);
    expect(report.accepted.map(({ item, variable }) => `${item} ${variable}`)).toEqual(["a M", "a N"]);
    expect(report.differences.map(({ item, variable }) => `${item} ${variable}`)).toEqual(["a SCORE", "b N"]);
  });

  it("sets aside a difference in every item when the entry names the values and no items", () => {
    const reference = implementation("ref", {
      a: accepts({ outcomes: { SCORE: 0 } }),
      b: accepts({ outcomes: { SCORE: 3 } }),
    });
    const subject = implementation("sub", { a: accepts({ outcomes: {} }), b: accepts({ outcomes: {} }) });
    const accepted = [
      { variable: "SCORE", values: { reference: 0, subject: undefined }, reason: "The reference declares SCORE." },
    ];
    const report = compare([testCase("a"), testCase("b")], reference, subject, accepted);
    expect(report.accepted.map(({ item }) => item)).toEqual(["a"]);
    expect(report.differences.map(({ item }) => item)).toEqual(["b"]);
  });

  it("sets aside an item that only one implementation accepts when the entry names neither a variable nor a kind", () => {
    const reference = implementation("ref", { a: accepts({}), b: accepts({ outcomes: { SCORE: 1 } }) });
    const subject = implementation("sub", { a: rejects("unsupported"), b: accepts({ outcomes: { SCORE: 0 } }) });
    const report = compare([testCase("a"), testCase("b")], reference, subject, [{ items: ["a", "b"], reason: "No." }]);
    expect(report.accepted.map(({ item }) => item)).toEqual(["a"]);
    expect(report.differences.map(({ item }) => item)).toEqual(["b"]);
  });
});

describe("compareSessions", () => {
  it("reports what differs turn by turn: acceptance, outcomes, numAttempts and closing", () => {
    const reference = implementation(
      "ref",
      {},
      {
        a: { accepted: true, turns: [turn({ outcomes: { SCORE: 0 } }), turn({ numAttempts: 2, closed: true })] },
        b: { accepted: true, turns: [turn({}), turn({ accepted: false })] },
      },
    );
    const subject = implementation(
      "sub",
      {},
      {
        a: { accepted: true, turns: [turn({ outcomes: { SCORE: 1 } }), turn({ numAttempts: 3, closed: true })] },
        b: { accepted: true, turns: [turn({}), turn({})] },
      },
    );
    const report = compareSessions([sessionCase("a"), sessionCase("b")], reference, subject, []);
    expect(report.compared).toBe(2);
    expect(report.differences).toEqual([
      { item: "a turn 1", kind: "outcome", variable: "SCORE", reference: 0, subject: 1 },
      { item: "a turn 2", kind: "session", variable: "numAttempts", reference: 2, subject: 3 },
      { item: "b turn 2", kind: "acceptance", variable: "", reference: false, subject: true },
    ]);
  });

  it("reports a session that only one implementation plays, and lists those both reject", () => {
    const reference = implementation("ref", {}, { a: { accepted: true, turns: [] }, b: rejects("not an item") });
    const subject = implementation("sub", {}, { a: rejects("processing failed"), b: rejects("no") });
    const report = compareSessions([sessionCase("a"), sessionCase("b")], reference, subject, []);
    expect(report.rejected).toEqual([{ item: "b", reason: "not an item" }]);
    expect(report.differences).toEqual([
      { item: "a", kind: "acceptance", variable: "", reference: true, subject: false },
    ]);
  });
});

describe("longsight", () => {
  it("scores a response with the item's response processing", () => {
    const run = (response: string) =>
      longsight.run({ name: "choice", xml: CHOICE_ITEM, responses: { RESPONSE: response }, seed: 1 });
    expect(run("B")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 1 } } });
    expect(run("A")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 0 } } });
  });

  it("draws template values from the seed", () => {
    const run = (seed: number) => longsight.run({ name: "template", xml: TEMPLATE_ITEM, responses: {}, seed });
    expect(run(7)).toMatchObject({ accepted: true });
    expect(run(7)).toEqual(run(7));
    const values = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(run(seed))));
    expect(values.size).toBeGreaterThan(1);
  });

  it("reports why it does not accept a document", () => {
    const run = longsight.run({ name: "broken", xml: "<qti-assessment-item", responses: {}, seed: 1 });
    expect(run.accepted).toBe(false);
    expect(run).toHaveProperty("reason");
  });
});

describe("correctResponses", () => {
  it("reads the correct responses of the response declarations", () => {
    expect(correctResponses(CHOICE_ITEM, 1)).toEqual({ RESPONSE: "B" });
  });

  it("is undefined for a document the oracle does not accept", () => {
    expect(correctResponses("<nothing/>", 1)).toBeUndefined();
  });
});

describe("ampUp", () => {
  it("scores a response with the item's response processing, as the player restores it", () => {
    const run = (response: string) =>
      ampUp.run({ name: "choice", xml: CHOICE_ITEM, responses: { RESPONSE: response }, seed: 1 });
    expect(run("B")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 1 } } });
    expect(run("A")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 0 } } });
  });

  it("scores the same item again after another, whether the document is the same or not", () => {
    const choice = { name: "choice", xml: CHOICE_ITEM, responses: { RESPONSE: "B" }, seed: 1 };
    const first = ampUp.run(choice);
    ampUp.run({ name: "template", xml: TEMPLATE_ITEM, responses: {}, seed: 1 });
    expect(ampUp.run(choice)).toEqual(first);
    expect(ampUp.run(choice)).toEqual(first);
  });

  it("restores the template values it drew and scores a response against them", () => {
    const run = (responses: ItemCase["responses"]) =>
      ampUp.run({ name: "template", xml: TEMPLATE_ITEM, responses, seed: 3 });
    const drawn = run({});
    if (!drawn.accepted) throw new Error(drawn.reason);
    const { N } = drawn.observation.templateValues;
    if (typeof N !== "number") throw new Error("The template value N is not a number.");
    expect(run({ RESPONSE: N })).toMatchObject({ observation: { outcomes: { SCORE: 1 }, templateValues: { N } } });
    expect(run({ RESPONSE: N + 1 })).toMatchObject({
      observation: { outcomes: { SCORE: 0 }, templateValues: { N } },
    });
  });

  it("scores the responses of a multiple variable as a list", () => {
    const item = `<qti-assessment-item xmlns="${NAMESPACE}" identifier="multiple" title="Multiple" time-dependent="false">
      <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier">
        <qti-correct-response><qti-value>A</qti-value><qti-value>C</qti-value></qti-correct-response>
      </qti-response-declaration>
      <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
      <qti-item-body>
        <qti-choice-interaction response-identifier="RESPONSE" max-choices="2">
          <qti-simple-choice identifier="A">A</qti-simple-choice>
          <qti-simple-choice identifier="B">B</qti-simple-choice>
          <qti-simple-choice identifier="C">C</qti-simple-choice>
        </qti-choice-interaction>
      </qti-item-body>
      <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
    </qti-assessment-item>`;
    const run = (response: string[]) =>
      ampUp.run({ name: "multiple", xml: item, responses: { RESPONSE: response }, seed: 1 });
    expect(run(["C", "A"])).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 1 } } });
    expect(run(["A", "B"])).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 0 } } });
  });

  it("draws template values from the seed with the generator of the other oracle", () => {
    const run = (seed: number) => ampUp.run({ name: "template", xml: TEMPLATE_ITEM, responses: {}, seed });
    expect(run(7)).toMatchObject({ accepted: true });
    expect(run(7)).toEqual(run(7));
    expect(new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(run(seed)))).size).toBeGreaterThan(1);
  });

  it("does not accept an item with a qti element that it does not know", () => {
    const slider = `<qti-assessment-item xmlns="${NAMESPACE}" identifier="slider" title="Slider" time-dependent="false">
      <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
      <qti-item-body><qti-slider-interaction response-identifier="RESPONSE" lower-bound="0" upper-bound="10"/></qti-item-body>
    </qti-assessment-item>`;
    expect(ampUp.run({ name: "slider", xml: slider, responses: {}, seed: 1 })).toEqual({
      accepted: false,
      reason: `${UNSUPPORTED} qti-slider-interaction.`,
    });
  });

  it("does not accept a document that does not load, or that throws when it is scored", () => {
    expect(ampUp.run({ name: "broken", xml: "<qti-assessment-item", responses: {}, seed: 1 })).toMatchObject({
      accepted: false,
    });
    const record = `<qti-assessment-item xmlns="${NAMESPACE}" identifier="record" title="Record" time-dependent="false">
      <qti-outcome-declaration identifier="OUT" cardinality="record"/>
      ${BODY}
      <qti-response-processing/>
    </qti-assessment-item>`;
    expect(ampUp.run({ name: "record", xml: record, responses: {}, seed: 1 })).toMatchObject({ accepted: false });
  });
});

describe("runtime", () => {
  it("scores a response as the oracle does", () => {
    const run = (response: string) =>
      runtime.run({ name: "choice", xml: CHOICE_ITEM, responses: { RESPONSE: response }, seed: 1 });
    expect(run("B")).toMatchObject({
      accepted: true,
      observation: { outcomes: { SCORE: 1, completionStatus: "unknown" } },
    });
    expect(run("A")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 0 } } });
  });

  it("draws the template values of the oracle from the oracle's generator", () => {
    const cases = [1, 2, 3].map((seed) => ({ name: `template ${seed}`, xml: TEMPLATE_ITEM, responses: {}, seed }));
    const report = compare(cases, longsight, runtime, []);
    expect(report).toMatchObject({ compared: 3, differences: [] });
  });

  it("reports why it does not accept a document", () => {
    expect(runtime.run({ name: "broken", xml: "<qti-assessment-item", responses: {}, seed: 1 })).toMatchObject({
      accepted: false,
    });
    const test = `<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="t" title="t"/>`;
    expect(runtime.run({ name: "test", xml: test, responses: {}, seed: 1 })).toEqual({
      accepted: false,
      reason: "The document is a test.",
    });
  });
});

describe("longsightRandom", () => {
  it("is the oracle's linear congruential generator for a numeric seed", () => {
    const random = longsightRandom(1);
    const first = (1664525 * 1 + 1013904223) >>> 0;
    expect(random.uniform()).toBe(first / 2 ** 32);
    expect(random.uniform()).toBe(((1664525 * first + 1013904223) >>> 0) / 2 ** 32);
  });
});
