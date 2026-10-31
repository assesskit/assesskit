import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadAcceptedDifferences } from "../../conformance/accepted.ts";
import { compare, compareSessions, type ItemCase, longsight, runtime, type Turn } from "../src/index.ts";
import { sessionItem } from "./items.ts";

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
function agree(cases: fc.Arbitrary<ItemCase>): void {
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
  it("[B82][D] agree on integer and float arithmetic", () => {
    const binary = fc.constantFrom("sum", "product", "subtract", "min", "max");
    agree(
      fc.tuple(binary, integer, integer, fc.boolean()).map(([operator, a, b, floats]) => {
        const type = floats ? "float" : "integer";
        return itemCase(
          `${operator}`,
          `cardinality="single" base-type="${type}"`,
          `<qti-${operator}>${bv(type, a)}${bv("integer", b)}</qti-${operator}>`,
        );
      }),
    );
    agree(
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
    agree(
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

  it("[B72][B73][D] agree on rounding to integers, decimal places and significant figures", () => {
    agree(
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
    agree(
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

  it("[B75][D] agree on equality within absolute and relative tolerances", () => {
    const relativeSafe = fc
      .tuple(decimal, decimal, tolerances)
      .filter(([x, , [mode]]) => mode === "absolute" || x >= 0);
    agree(
      relativeSafe.map(([x, y, [mode, tolerance, lower, upper]]) => equalCase(x, y, mode, tolerance, lower, upper)),
    );
  });

  it("[B75][G4][D] differ only for a negative x in relative mode, where the oracle's range is empty and the runtime's lies between its ends", () => {
    const report = compare([equalCase(-10, -10.5, "relative", 10, true, true)], longsight, runtime, []);
    expect(report.differences).toEqual([
      { item: "equal", kind: "outcome", variable: "OUT", reference: false, subject: true },
    ]);
  });

  it("[B83][D] agree on three-valued logic", () => {
    const operand = fc.constantFrom(bv("boolean", true), bv("boolean", false), "<qti-null/>");
    agree(
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

  it("[B84][D] agree on membership, containment and deletion", () => {
    const values = fc.array(fc.constantFrom("A", "B", "C"), { minLength: 1, maxLength: 5 });
    const container = (cardinality: string, items: readonly string[]) =>
      `<qti-${cardinality}>${items.map((item) => bv("identifier", item)).join("")}</qti-${cardinality}>`;
    agree(
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
    agree(
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

  it("[B76][D] agree on mapping responses with defaults and bounds", () => {
    const entry = fc.tuple(fc.constantFrom("A", "B", "C", "D"), fc.integer({ min: -4, max: 4 }));
    agree(
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

  it("[B12][G15][D] agree on template values drawn from the same generator", () => {
    agree(
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

  it("[E10][B3][B8][B9][B10][D] agree turn by turn on sessions of adaptive and non-adaptive items, hints included", () => {
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

  it("[B3][D] counts every attempt of a non-adaptive item that completed, which the oracle stops counting", () => {
    const accepted = loadAcceptedDifferences(
      resolve(import.meta.dirname, "../../conformance/accepted-differences.json"),
    );
    const turns: Turn[] = [{ responses: { RESPONSE: "B" } }, { responses: { RESPONSE: "A" } }];
    const testCase = {
      name: "a non-adaptive item that completes (turns)",
      xml: sessionItem(false, true),
      turns,
      seed: 1,
    };
    const report = compareSessions([testCase], longsight, runtime, accepted);
    expect(report.differences).toEqual([]);
    expect(report.accepted).toEqual([
      { item: `${testCase.name} turn 2`, kind: "session", variable: "numAttempts", reference: 1, subject: 2 },
    ]);
  });
});
