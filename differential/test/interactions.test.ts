import {
  captureQtiTextResponse,
  parseQtiXml,
  type QtiInteraction,
  validateQtiResponseVariables,
} from "@longsightgroup/qti3-core";
import {
  checkResponse,
  container,
  describeInteractions,
  numericRecord,
  readAsi,
  single,
  type Value,
} from "@luthfanwakan/olah";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const NAMESPACE = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

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

/** Whether olah takes the response as valid. */
function subjectValid(testCase: ValidityCase): boolean {
  const document = readAsi(testCase.xml);
  if (document.kind !== "item") throw new Error("The case is no item.");
  const [descriptor] = describeInteractions(document.item);
  if (descriptor === undefined) throw new Error("The case has no interaction.");
  return checkResponse(descriptor, testCase.subject).reasons.length === 0;
}

function agree(cases: fc.Arbitrary<ValidityCase>): void {
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

describe("olah against the oracle on the validity of responses", () => {
  it("[B56][D] agree on min-choices, max-choices and the choices of a choice interaction", () => {
    agree(
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

  it("[B56][D] agree on the choices an order interaction needs: all of them, or between min-choices and max-choices", () => {
    agree(
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

  it("[B56][D] agree on max-associations, match-max and the choices of an associate interaction", () => {
    const pairOf = fc.tuple(
      fc.constantFrom(...IDENTIFIERS.slice(0, 4), "Z"),
      fc.constantFrom(...IDENTIFIERS.slice(0, 4)),
    );
    agree(
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

  it("[B56][D] agree on an inline choice interaction that is required, and on the choice made", () => {
    agree(
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
 * The fields of the record that olah makes for a text, by name, and those of the oracle that are not NULL. An integer has
 * no sign of zero in olah (T2), and the oracle's `integerValue` and `exponent` are `-0` for the text `-0` and `e-0`, so
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

describe("olah against the oracle on numeric text", () => {
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

  it("[B53][D] agree on the fields of the record that a typed decimal makes", () => {
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

  it("[B53][D] differ for a number that ends in its point: INFO §2.4.2.2 gives an integerValue when no fractional digits were specified, and the oracle gives none", () => {
    for (const [text, value] of [
      ["5.", 5],
      ["-12.", -12],
    ] as const) {
      const { subject, oracle } = numericFields(text, 10);
      expect(subject, text).toEqual({ ...oracle, integerValue: value });
    }
  });

  it("[B53][D] differ in the sign of a zero integer: olah has none for an integer (T2), and the oracle gives -0 for the integerValue of `-0` and the exponent of `1e-0`", () => {
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

  it("[B53][D] agree on integers in the bases from 2 to 36", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), fc.integer({ min: 2, max: 36 }), (value, base) => {
        const text = value.toString(base);
        const { subject, oracle } = numericFields(text, base);
        expect(subject, `${text} in base ${base}`).toEqual(oracle);
      }),
    );
  });
});
