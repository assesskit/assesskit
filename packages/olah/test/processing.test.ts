// cspell:ignore Shell İSTANBUL i̇stanbul ΣΊΣΥΦΟΣ σίσυφος Kleene
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASI_NAMESPACE,
  type AssessmentItem,
  type AssessmentItemRef,
  type AssessmentTest,
  type BaseType,
  type CustomOperator,
  container,
  createItemVariables,
  createRandom,
  DataError,
  DEFAULT_PROCESSING_LIMITS,
  DEFAULT_XML_LIMITS,
  type Expression,
  evaluate,
  evaluateTestExpression,
  type ItemSessionFilter,
  type ItemSessionView,
  type ItemVariables,
  normalizeValue,
  OPERATOR_SIGNATURES,
  type Primitive,
  type ProcessingContext,
  ProcessingError,
  type Random,
  ReadError,
  readAsi,
  record,
  runOutcomeProcessing,
  runResponseProcessing,
  runTemplateProcessing,
  SecurityError,
  type SingleValue,
  STANDARD_TEMPLATES,
  single,
  standardTemplateUri,
  type TestScope,
  type Value,
  writeAsi,
} from "../src/index.js";
import { expressions } from "./arbitraries/processing.js";
import rounding from "./fixtures/rounding.json" with { type: "json" };
import { FUZZ } from "./fuzz.js";

// Helpers ---------------------------------------------------------------------------------------------------------------

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const NS = `xmlns="${ASI_NAMESPACE}"`;

const int = (value: number): SingleValue => single("integer", value);
const float = (value: number): SingleValue => single("float", value);
const bool = (value: boolean): SingleValue => single("boolean", value);
const id = (value: string): SingleValue => single("identifier", value);
const duration = (value: number): SingleValue => single("duration", value);
function str(value: string): SingleValue {
  const built = single("string", value);
  if (built === null) throw new Error("The test builds an empty string.");
  return built;
}
function list(cardinality: "multiple" | "ordered", baseType: BaseType, values: readonly Primitive[]): Value {
  const built = container(cardinality, baseType, values);
  if (built === null) throw new Error("The test builds an empty container.");
  return built;
}

/** The XML of a base value. */
const bv = (baseType: string, text: string | number): string =>
  `<qti-base-value base-type="${baseType}">${text}</qti-base-value>`;
const v = (identifier: string): string => `<qti-variable identifier="${identifier}"/>`;
const NULL = "<qti-null/>";

/** Reads an item from its declarations and processing. */
function itemOf(content: string, attributes = ""): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"${attributes}>${content}</qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("The test reads an item.");
  return document.item;
}

/** Reads an expression from its XML, as the reader gives it. */
function expressionOf(xml: string): Expression {
  const document = readAsi(
    `<qti-response-processing ${NS}><qti-set-outcome-value identifier="X">${xml}</qti-set-outcome-value></qti-response-processing>`,
  );
  const [rule] = document.kind === "response-processing" ? document.processing.rules : [];
  if (rule === undefined || rule.kind !== "set-outcome-value") throw new Error("The test reads an expression.");
  return rule.expression;
}

const random = (): Random => createRandom(7);
const CONTEXT: ProcessingContext = { random: createRandom(1) };

/** An item that declares the variables the expression tests read. */
const DECLARATIONS = `
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-outcome-declaration identifier="N" cardinality="single" base-type="integer"><qti-default-value><qti-value>3</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-outcome-declaration identifier="T" cardinality="single" base-type="float"><qti-default-value><qti-value>0.5</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-outcome-declaration identifier="EMPTY" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="NOTHING" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="PATTERN" cardinality="single" base-type="string"><qti-default-value><qti-value>[a-c]+</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-template-declaration identifier="K" cardinality="single" base-type="integer"><qti-default-value><qti-value>2</qti-value></qti-default-value></qti-template-declaration>
  <qti-template-declaration identifier="NONE" cardinality="single" base-type="integer"/>`;
const ITEM = itemOf(DECLARATIONS);

/** Evaluates the XML of an expression with the variables of {@link ITEM}. */
function run(xml: string, context: ProcessingContext = CONTEXT, item: AssessmentItem = ITEM): Value | null {
  return evaluate(expressionOf(xml), createItemVariables(item), item, context);
}

/** Evaluates an operator over the XML of its operands. */
const op = (name: string, operands: readonly string[], attributes = ""): Value | null =>
  run(`<qti-${name}${attributes}>${operands.join("")}</qti-${name}>`);

/** The primitive of a single value, for short expectations. */
function primitive(value: Value | null): Primitive | null {
  if (value === null) return null;
  if (value.cardinality !== "single") throw new Error(`The test expects a single value, found ${value.cardinality}.`);
  return value.value;
}

const runPrimitive = (xml: string): Primitive | null => primitive(run(xml));
const opPrimitive = (name: string, operands: readonly string[], attributes = ""): Primitive | null =>
  primitive(op(name, operands, attributes));

/** Runs the response processing of an item made of declarations and rules, from its new variables. */
function processed(
  declarations: string,
  rules: string,
  variables?: (item: AssessmentItem) => ItemVariables,
): ItemVariables {
  const item = itemOf(`${declarations}<qti-response-processing>${rules}</qti-response-processing>`);
  return runResponseProcessing(item, variables?.(item) ?? createItemVariables(item), CONTEXT);
}

/** Expects a ProcessingError with a message that contains the text. */
function expectProcessingError(action: () => unknown, text: string): void {
  expect(action).toThrow(ProcessingError);
  expect(action).toThrow(text);
}

describe("arithmetic", () => {
  it("[B82][A120][A109] sums and multiplies the numbers of single and container operands", () => {
    expect(
      op("sum", [
        bv("integer", 2),
        bv("integer", 3),
        `<qti-multiple>${bv("integer", 4)}${bv("integer", 5)}</qti-multiple>`,
      ]),
    ).toEqual(int(14));
    expect(op("product", [bv("integer", 2), bv("integer", 3), bv("integer", 4)])).toEqual(int(24));
    expect(op("sum", [bv("integer", 2), bv("float", 0.5)])).toEqual(float(2.5));
    expect(op("product", [bv("float", 2), bv("integer", 3)])).toEqual(float(6));
  });

  it("[B82][A119] subtracts: an integer when both operands are, else a float (INFO §2.11.3.31)", () => {
    expect(op("subtract", [bv("integer", 2), bv("integer", 5)])).toEqual(int(-3));
    expect(op("subtract", [bv("integer", 2), bv("float", 0.5)])).toEqual(float(1.5));
  });

  it("[B82][T2] gives NULL for an integer result outside the safe integers, computed exactly (D3)", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(op("sum", [bv("integer", max), bv("integer", 1)])).toBeNull();
    expect(op("sum", [bv("integer", max), bv("integer", 2), bv("integer", -3)])).toEqual(int(max - 1));
    expect(op("product", [bv("integer", 2 ** 30), bv("integer", 2 ** 30)])).toBeNull();
    expect(op("subtract", [bv("integer", -max), bv("integer", 1)])).toBeNull();
  });

  it("[B74][A76][A108] divides and raises to a power as floats, NULL for a zero divisor or a result beyond float (INFO §2.11.3.19, §2.11.3.30)", () => {
    expect(op("divide", [bv("integer", 7), bv("integer", 2)])).toEqual(float(3.5));
    expect(op("divide", [bv("integer", 7), bv("integer", 0)])).toBeNull();
    expect(op("divide", [bv("float", 0), bv("float", 0)])).toBeNull();
    expect(op("divide", [bv("float", "1e308"), bv("float", "1e-308")])).toBeNull();
    expect(op("power", [bv("integer", 2), bv("integer", 10)])).toEqual(float(1024));
    expect(op("power", [bv("integer", 0), bv("integer", -1)])).toBeNull();
    expect(op("power", [bv("float", -8), bv("float", 0.5)])).toBeNull();
    expect(op("power", [bv("float", 10), bv("float", 400)])).toBeNull();
  });

  it("[B82][A87][A88] divides integers rounding down, and takes the modulus x − z·y; NULL for a zero divisor (INFO §2.11.3.24–25)", () => {
    expect(op("integer-divide", [bv("integer", 7), bv("integer", 2)])).toEqual(int(3));
    expect(op("integer-divide", [bv("integer", -7), bv("integer", 2)])).toEqual(int(-4));
    expect(op("integer-modulus", [bv("integer", -7), bv("integer", 2)])).toEqual(int(1));
    expect(op("integer-modulus", [bv("integer", 7), bv("integer", -2)])).toEqual(int(-1));
    expect(op("integer-divide", [bv("integer", 7), bv("integer", 0)])).toBeNull();
    expect(op("integer-modulus", [bv("integer", 7), bv("integer", 0)])).toBeNull();
  });

  it("[B82][A82][A91] takes the gcd and lcm with the zero rules of INFO §2.11.3.11–12", () => {
    expect(op("gcd", [bv("integer", 12), bv("integer", -18)])).toEqual(int(6));
    expect(op("gcd", [bv("integer", 0), bv("integer", 0)])).toEqual(int(0));
    expect(op("gcd", [bv("integer", 0), bv("integer", 5)])).toEqual(int(5));
    expect(
      op("lcm", [bv("integer", 4), `<qti-multiple>${bv("integer", 6)}${bv("integer", -10)}</qti-multiple>`]),
    ).toEqual(int(60));
    expect(op("lcm", [bv("integer", 0), bv("integer", 5)])).toEqual(int(0));
    expect(
      op("lcm", [bv("integer", 2 ** 31 - 1), bv("integer", 2 ** 31 - 19), bv("integer", 2 ** 31 - 61)]),
    ).toBeNull();
  });

  it("[B82][A99][A101] takes the minimum and maximum, an integer only when every operand is one (INFO §2.11.3.13–14)", () => {
    expect(op("min", [bv("integer", 3), `<qti-ordered>${bv("integer", -1)}${bv("integer", 7)}</qti-ordered>`])).toEqual(
      int(-1),
    );
    expect(op("max", [bv("integer", 3), bv("float", 2.5)])).toEqual(float(3));
    expect(op("max", [bv("float", 3), bv("float", "NaN")])).toBeNull();
  });

  it("[B72][A114][A121] rounds to n for [n − 0.5, n + 0.5) and truncates toward zero: INFO §2.11.3.37–38's examples", () => {
    expect([6.8, 6.5, 6.49, -6.5].map((x) => opPrimitive("round", [bv("float", x)]))).toEqual([7, 7, 6, -6]);
    expect([6.8, -6.8].map((x) => opPrimitive("truncate", [bv("float", x)]))).toEqual([6, -6]);
    expect(op("round", [bv("integer", 4)])).toEqual(int(4));
  });

  it("[B72][G1][T2] gives NULL for rounding or truncating NaN, ±INF (D4) and numbers beyond the safe integers (D3)", () => {
    for (const name of ["round", "truncate"]) {
      for (const text of ["NaN", "INF", "-INF", "1e300"])
        expect(op(name, [bv("float", text)]), `${name} ${text}`).toBeNull();
    }
    expect(op("round", [bv("float", -0.4)])).toEqual(int(0));
  });

  it("[A89] converts an integer to a float (INFO §2.11.3.33)", () => {
    expect(op("integer-to-float", [bv("integer", 3)])).toEqual(float(3));
  });

  it("[T16] gives NULL when an operand is NULL", () => {
    for (const name of ["sum", "product", "gcd", "lcm", "min", "max"])
      expect(op(name, [bv("integer", 1), NULL]), name).toBeNull();
    for (const name of ["subtract", "divide", "power", "integer-divide", "integer-modulus"]) {
      expect(op(name, [NULL, bv("integer", 1)]), name).toBeNull();
    }
    for (const name of ["round", "truncate", "integer-to-float"]) expect(op(name, [NULL]), name).toBeNull();
  });
});

describe("assignment", () => {
  const Declared = `
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-outcome-declaration identifier="TIME" cardinality="single" base-type="duration"/>
    <qti-outcome-declaration identifier="COUNT" cardinality="single" base-type="integer"/>
    <qti-outcome-declaration identifier="SET" cardinality="multiple" base-type="identifier"/>`;
  const set = (identifier: string, expression: string) => () =>
    processed(Declared, `<qti-set-outcome-value identifier="${identifier}">${expression}</qti-set-outcome-value>`)
      .outcomes;

  it("[B48][G3][T17] promotes an integer to a float or duration variable (D5)", () => {
    expect(set("SCORE", bv("integer", 2))().get("SCORE")).toEqual(float(2));
    expect(set("TIME", bv("integer", 30))().get("TIME")).toEqual(duration(30));
    expect(set("SET", NULL)().get("SET")).toBeNull();
  });

  it("[B48][G3] refuses a float for an integer variable, and a value of another cardinality or base type (INFO §5.130.2)", () => {
    expectProcessingError(
      set("COUNT", bv("float", 2)),
      "The variable COUNT is a single integer and cannot be set to a single float.",
    );
    expectProcessingError(
      set("SET", bv("identifier", "A")),
      "is a multiple identifier and cannot be set to a single identifier",
    );
    expectProcessingError(set("SCORE", bv("string", "x")), "cannot be set to a single string");
  });
});

describe("comparison", () => {
  it("[A83][A84][A92][A93] compares numbers, integers with floats (INFO §2.11.3.22–27)", () => {
    expect(opPrimitive("gt", [bv("integer", 3), bv("float", 2.5)])).toBe(true);
    expect(opPrimitive("gte", [bv("integer", 3), bv("integer", 3)])).toBe(true);
    expect(opPrimitive("lt", [bv("float", 3), bv("integer", 3)])).toBe(false);
    expect(opPrimitive("lte", [bv("float", 3), bv("integer", 3)])).toBe(true);
    expect(op("lt", [NULL, bv("integer", 3)])).toBeNull();
  });

  it("[A77][A78][T10] compares durations with lt and gte only (INFO §2.11.3.20–21)", () => {
    expect(opPrimitive("duration-lt", [bv("duration", 9.5), bv("duration", 10)])).toBe(true);
    expect(opPrimitive("duration-gte", [bv("duration", 10), bv("duration", 10)])).toBe(true);
    expect(op("duration-gte", [NULL, bv("duration", 10)])).toBeNull();
    expectProcessingError(
      () => op("duration-lt", [bv("float", 1), bv("duration", 2)]),
      "qti-duration-lt takes single duration operands",
    );
  });

  it("[B75][A79][W38] compares exactly, or within an absolute or relative range that includes its bounds by default (INFO §5.46)", () => {
    const equal = (x: number, y: number, attributes: string) =>
      opPrimitive("equal", [bv("float", x), bv("float", y)], attributes);
    expect(equal(10, 10, "")).toBe(true);
    expect(equal(10, 10.5, ' tolerance-mode="exact" tolerance="1"')).toBe(false);
    expect(equal(10, 11, ' tolerance-mode="absolute" tolerance="1"')).toBe(true);
    expect(equal(10, 8.5, ' tolerance-mode="absolute" tolerance="1 2"')).toBe(false);
    expect(equal(10, 12, ' tolerance-mode="absolute" tolerance="1 2"')).toBe(true);
    expect(equal(10, 9, ' tolerance-mode="relative" tolerance="10"')).toBe(true);
    expect(equal(10, 11.5, ' tolerance-mode="relative" tolerance="10 20"')).toBe(true);
    expect(equal(10, 11, ' tolerance-mode="absolute" tolerance="1" include-upper-bound="false"')).toBe(false);
    expect(equal(10, 9, ' tolerance-mode="absolute" tolerance="1" include-lower-bound="false"')).toBe(false);
  });

  it("[B75][G4] uses the range between the two ends of a relative tolerance when x is negative", () => {
    const equal = (y: number, attributes = "") =>
      opPrimitive(
        "equal",
        [bv("float", -10), bv("float", y)],
        ` tolerance-mode="relative" tolerance="10 20"${attributes}`,
      );
    expect([-12, -11, -9, -8.9, -12.1].map((y) => equal(y))).toEqual([true, true, true, false, false]);
    expect(equal(-12, ' include-lower-bound="false"')).toBe(false);
    expect(equal(-9, ' include-upper-bound="false"')).toBe(false);
  });

  it("[B75][W47] needs one or two tolerances in absolute and relative mode", () => {
    expectProcessingError(
      () => op("equal", [bv("float", 1), bv("float", 1)], ' tolerance-mode="absolute"'),
      "needs one or two tolerances, found 0",
    );
    expectProcessingError(
      () => op("equal", [bv("float", 1), bv("float", 1)], ' tolerance-mode="relative" tolerance="1 2 3"'),
      "found 3",
    );
    expect(op("equal", [bv("float", 1), bv("float", 1)], ' tolerance-mode="absolute" tolerance="-1"')).toBeNull();
  });

  it("[B73][A80][W26] compares numbers after rounding: INFO §5.47.2's examples", () => {
    const equalRounded = (a: string, b: string, attributes: string) =>
      opPrimitive("equal-rounded", [bv("float", a), bv("float", b)], attributes);
    expect(equalRounded("3.175", "3.183", ' figures="3"')).toBe(true);
    expect(equalRounded("3.175", "3.1749", ' rounding-mode="significantFigures" figures="3"')).toBe(false);
    expect(equalRounded("1.68572", "1.69", ' rounding-mode="decimalPlaces" figures="2"')).toBe(true);
    expect(equalRounded("1.68572", "1.68432", ' rounding-mode="decimalPlaces" figures="2"')).toBe(false);
  });

  it("[B73] rounds NaN to NULL and keeps infinities in qti-equal-rounded, and gives NULL for figures out of range", () => {
    const equalRounded = (a: string, b: string, attributes = ' figures="2"') =>
      op("equal-rounded", [bv("float", a), bv("float", b)], attributes);
    expect(equalRounded("NaN", "1")).toBeNull();
    expect(primitive(equalRounded("INF", "INF"))).toBe(true);
    expect(primitive(equalRounded("INF", "-INF"))).toBe(false);
    expect(primitive(equalRounded("-0.001", "0.001", ' rounding-mode="decimalPlaces" figures="2"'))).toBe(true);
    expect(equalRounded("1", "1", ' figures="0"')).toBeNull();
    expect(primitive(equalRounded("1.4", "1", ' rounding-mode="decimalPlaces" figures="0"'))).toBe(true);
    expect(equalRounded("1", "1", ' rounding-mode="decimalPlaces" figures="-1"')).toBeNull();
  });

  it("[W26][W38] reads every term of RoundingModeEnum and ToleranceModeEnum, and no other (INFO §8.26, §8.38)", () => {
    const operands = `${bv("float", 1)}${bv("float", 1)}`;
    for (const mode of ["exact", "absolute", "relative"]) {
      expect(primitive(run(`<qti-equal tolerance-mode="${mode}" tolerance="1">${operands}</qti-equal>`)), mode).toBe(
        true,
      );
    }
    for (const mode of ["decimalPlaces", "significantFigures"]) {
      expect(
        primitive(run(`<qti-equal-rounded rounding-mode="${mode}" figures="1">${operands}</qti-equal-rounded>`)),
        mode,
      ).toBe(true);
    }
    expect(() => expressionOf(`<qti-equal tolerance-mode="approximate">${operands}</qti-equal>`)).toThrow(ReadError);
    expect(() =>
      expressionOf(`<qti-round-to rounding-mode="places" figures="1">${bv("float", 1)}</qti-round-to>`),
    ).toThrow(ReadError);
  });

  it("[B86][A96] matches values of one cardinality and base type, a pair unordered (INFO §2.11.3.28)", () => {
    expect(opPrimitive("match", [bv("identifier", "A"), bv("identifier", "A")])).toBe(true);
    expect(opPrimitive("match", [bv("pair", "A B"), bv("pair", "B A")])).toBe(true);
    expect(opPrimitive("match", [bv("directedPair", "A B"), bv("directedPair", "B A")])).toBe(false);
    const multiple = (...items: string[]) =>
      `<qti-multiple>${items.map((item) => bv("identifier", item)).join("")}</qti-multiple>`;
    expect(opPrimitive("match", [multiple("A", "B", "B"), multiple("B", "A", "B")])).toBe(true);
    expect(op("match", [NULL, bv("identifier", "A")])).toBeNull();
  });

  it("[B86][N] refuses durations and operands of different base types or cardinalities in qti-match", () => {
    expectProcessingError(() => op("match", [bv("duration", 1), bv("duration", 1)]), "qti-match takes");
    expectProcessingError(() => op("match", [bv("integer", 1), bv("float", 1)]), "takes operands of one base type");
    expectProcessingError(
      () => op("match", [bv("identifier", "A"), `<qti-multiple>${bv("identifier", "A")}</qti-multiple>`]),
      "takes operands of one cardinality",
    );
  });
});

describe("conditions", () => {
  const Declared = `<qti-outcome-declaration identifier="X" cardinality="single" base-type="identifier"/>`;
  const branch = (condition: string) =>
    processed(
      Declared,
      `<qti-response-condition>
        <qti-response-if>${condition}<qti-set-outcome-value identifier="X">${bv("identifier", "if")}</qti-set-outcome-value></qti-response-if>
        <qti-response-else-if>${bv("boolean", "true")}<qti-set-outcome-value identifier="X">${bv("identifier", "elseIf")}</qti-set-outcome-value></qti-response-else-if>
      </qti-response-condition>`,
    ).outcomes.get("X");

  it("[B47][A51][A53][A54] runs the first branch whose condition is true, a NULL or false condition skipping its branch", () => {
    expect(branch(bv("boolean", "true"))).toEqual(id("if"));
    expect(branch(bv("boolean", "false"))).toEqual(id("elseIf"));
    expect(branch(NULL)).toEqual(id("elseIf"));
  });

  it("[B47] refuses a condition that is not a single boolean (INFO §5.117)", () => {
    expectProcessingError(
      () => branch(bv("integer", 1)),
      "The expression of qti-response-if must be a single boolean, found a single integer.",
    );
  });
});

describe("containers", () => {
  const ids = (cardinality: "multiple" | "ordered", ...items: string[]) =>
    `<qti-${cardinality}>${items.map((item) => (item === "NULL" ? NULL : bv("identifier", item))).join("")}</qti-${cardinality}>`;

  it("[B84][A102][A106] flattens operands into a container and leaves out NULL: INFO §2.11.3.8's example", () => {
    expect(
      run(`<qti-multiple>${bv("identifier", "A")}${bv("identifier", "B")}${ids("multiple", "C", "D")}</qti-multiple>`),
    ).toEqual(list("multiple", "identifier", ["A", "B", "C", "D"]));
    expect(run(ids("ordered", "A", "NULL", "B"))).toEqual(list("ordered", "identifier", ["A", "B"]));
    expect(run(ids("multiple"))).toBeNull();
    expect(run(ids("ordered", "NULL"))).toBeNull();
  });

  it("[B84][N] refuses operands of different base types, and a multiple operand of qti-ordered", () => {
    expectProcessingError(
      () => run(`<qti-multiple>${bv("identifier", "A")}${bv("string", "B")}</qti-multiple>`),
      "one base type",
    );
    expectProcessingError(
      () => run(`<qti-ordered>${ids("multiple", "A")}</qti-ordered>`),
      "qti-ordered takes single or ordered operands",
    );
  });

  it("[B84][A70] counts the values of a container, 0 for NULL (INFO §2.11.3.32)", () => {
    expect(run(`<qti-container-size>${ids("multiple", "A", "B", "A")}</qti-container-size>`)).toEqual(int(3));
    expect(run(`<qti-container-size>${NULL}</qti-container-size>`)).toEqual(int(0));
  });

  it("[B84][A90][T16] tells whether a value is NULL, empty strings and containers included (INFO §2.11.3.34)", () => {
    expect(runPrimitive(`<qti-is-null>${NULL}</qti-is-null>`)).toBe(true);
    expect(runPrimitive(`<qti-is-null>${bv("string", "")}</qti-is-null>`)).toBe(true);
    expect(runPrimitive(`<qti-is-null>${ids("multiple")}</qti-is-null>`)).toBe(true);
    expect(runPrimitive(`<qti-is-null>${bv("integer", 0)}</qti-is-null>`)).toBe(false);
  });

  it("[B84][A100][A75] tests membership and deletes every instance: INFO §2.11.3.18's example", () => {
    expect(opPrimitive("member", [bv("identifier", "C"), ids("ordered", "A", "C")])).toBe(true);
    expect(opPrimitive("member", [bv("identifier", "D"), ids("ordered", "A", "C")])).toBe(false);
    expect(op("delete", [bv("identifier", "A"), ids("multiple", "B", "A", "C", "A")])).toEqual(
      list("multiple", "identifier", ["B", "C"]),
    );
    expect(op("delete", [bv("identifier", "A"), ids("ordered", "A", "A")])).toBeNull();
    expect(op("member", [NULL, ids("ordered", "A")])).toBeNull();
    expect(op("delete", [bv("identifier", "A"), NULL])).toBeNull();
  });

  it("[B84][A71] tells whether a multiple container holds another with repeats: INFO §2.11.3.17's examples", () => {
    expect(opPrimitive("contains", [ids("multiple", "A", "B", "C"), ids("multiple", "C", "A")])).toBe(true);
    expect(opPrimitive("contains", [ids("multiple", "A", "B", "C"), ids("multiple", "B", "B")])).toBe(false);
    expect(opPrimitive("contains", [ids("multiple", "A", "B", "B", "C"), ids("multiple", "B", "B")])).toBe(true);
  });

  it("[B84][A71][G30] tells whether an ordered container holds another as a contiguous run", () => {
    expect(opPrimitive("contains", [ids("ordered", "A", "B", "C"), ids("ordered", "C", "A")])).toBe(false);
    expect(opPrimitive("contains", [ids("ordered", "A", "B", "C"), ids("ordered", "B", "C")])).toBe(true);
    expect(opPrimitive("contains", [ids("ordered", "A", "B", "C"), ids("ordered", "A", "C")])).toBe(false);
    expect(op("contains", [ids("ordered", "A"), NULL])).toBeNull();
    expectProcessingError(() => op("contains", [ids("ordered", "A"), ids("multiple", "A")]), "one cardinality");
  });

  it("[B84][A85][G31] takes the nth value from 1, NULL beyond the container and for n ≤ 0", () => {
    const at = (n: string) => run(`<qti-index n="${n}">${ids("ordered", "A", "B", "C")}</qti-index>`);
    expect(at("1")).toEqual(id("A"));
    expect(at("3")).toEqual(id("C"));
    expect([at("4"), at("0"), at("-1")]).toEqual([null, null, null]);
    expect(at("K")).toEqual(id("B"));
    expect(run(`<qti-index n="1">${NULL}</qti-index>`)).toBeNull();
  });

  it("[B84][A113] repeats its operands in order number-repeats times, NULL below 1 (INFO §2.11.3.42)", () => {
    const repeat = (times: string, operands: string) =>
      run(`<qti-repeat number-repeats="${times}">${operands}</qti-repeat>`);
    expect(repeat("2", bv("identifier", "A") + ids("ordered", "B", "C") + NULL)).toEqual(
      list("ordered", "identifier", ["A", "B", "C", "A", "B", "C"]),
    );
    expect(repeat("K", bv("integer", 5))).toEqual(list("ordered", "integer", [5, 5]));
    expect(repeat("0", bv("integer", 5))).toBeNull();
    expect(repeat("2", NULL)).toBeNull();
  });

  it("[B84][A81] reads a field of a record, NULL when there is none (INFO §2.11.3.5)", () => {
    const item = itemOf(`<qti-context-declaration identifier="R" cardinality="record"><qti-default-value>
      <qti-value field-identifier="x" base-type="integer">4</qti-value></qti-default-value></qti-context-declaration>`);
    expect(run(`<qti-field-value field-identifier="x">${v("R")}</qti-field-value>`, CONTEXT, item)).toEqual(int(4));
    expect(run(`<qti-field-value field-identifier="y">${v("R")}</qti-field-value>`, CONTEXT, item)).toBeNull();
    expect(run(`<qti-field-value field-identifier="x">${NULL}</qti-field-value>`, CONTEXT, item)).toBeNull();
  });

  it("[B84][A110] draws a value of a container as the value at floor(u × n)", () => {
    const draws = (u: number) =>
      run(`<qti-random>${ids("ordered", "A", "B", "C", "D")}</qti-random>`, { random: { uniform: () => u } });
    expect([0, 0.24, 0.25, 0.99].map((u) => primitive(draws(u)))).toEqual(["A", "A", "B", "D"]);
    expect(run(`<qti-random>${NULL}</qti-random>`)).toBeNull();
  });

  it.each([
    ["qti-multiple", `<qti-multiple>${bv("integer", 1)}${bv("integer", 2)}${bv("integer", 3)}</qti-multiple>`],
    ["qti-ordered", `<qti-ordered>${bv("integer", 1)}${bv("integer", 2)}${bv("integer", 3)}</qti-ordered>`],
    ["qti-repeat", `<qti-repeat number-repeats="3">${bv("integer", 1)}</qti-repeat>`],
  ])(
    "[B84][B94][N] builds a container of exactly maxContainerSize values with %s, and refuses one more",
    (name, xml) => {
      const limits = (maxContainerSize: number): ProcessingContext => ({
        random: createRandom(1),
        limits: { maxContainerSize },
      });
      expect(run(xml, limits(3))).toMatchObject({ values: [1, expect.anything(), expect.anything()] });
      expect(() => run(xml, limits(2))).toThrow(expect.objectContaining({ limit: "maxContainerSize", value: 2 }));
      expect(() => run(xml, limits(2))).toThrow(`The operator ${name} builds a container of 3 values`);
    },
  );

  it("[B84][B94] gives NULL for qti-repeat of NULL, however many repeats, without building anything", () => {
    for (const times of ["3", "4294967296", "9007199254740991"]) {
      expect(run(`<qti-repeat number-repeats="${times}">${NULL}${NULL}</qti-repeat>`)).toBeNull();
    }
    const refused = (times: string) => () =>
      run(`<qti-repeat number-repeats="${times}">${bv("integer", 1)}</qti-repeat>`);
    expect(refused("9007199254740991")).toThrow(SecurityError);
    expect(refused("4294967296")).toThrow(SecurityError);
  });

  it("[B84] refuses a container above maxContainerSize with a SecurityError", () => {
    const repeat = `<qti-repeat number-repeats="3">${bv("integer", 1)}${bv("integer", 2)}</qti-repeat>`;
    const limited = { random: createRandom(1), limits: { maxContainerSize: 5 } };
    expect(() => run(repeat, limited)).toThrow(SecurityError);
    expect(() => run(repeat, limited)).toThrow(
      "builds a container of 6 values, more than the limit maxContainerSize of 5",
    );
    expect(run(`<qti-repeat number-repeats="2">${bv("integer", 1)}</qti-repeat>`, limited)).toEqual(
      list("ordered", "integer", [1, 1]),
    );
  });
});

describe("processing context", () => {
  const sum = expressionOf(`<qti-sum>${bv("integer", 1)}</qti-sum>`);
  const evaluateWith = (context: unknown) => () =>
    evaluate(sum, createItemVariables(ITEM), ITEM, json(JSON.stringify(context)));

  it("has the limits of DEFAULT_PROCESSING_LIMITS by default", () => {
    expect(DEFAULT_PROCESSING_LIMITS).toEqual({ maxContainerSize: 10_000 });
  });

  it("refuses a context of the wrong shape with a DataError", () => {
    expect(() => evaluate(sum, createItemVariables(ITEM), ITEM, json("null"))).toThrow(
      "The processing context must be an object, found null.",
    );
    expect(evaluateWith({ random: null })).toThrow(
      "The option random must be an object with a function uniform, found null.",
    );
    expect(evaluateWith({ random: {} })).toThrow("must be an object with a function uniform, found undefined.");
    const uniform = { uniform: () => 0 };
    expect(() =>
      evaluate(sum, createItemVariables(ITEM), ITEM, { random: uniform, customOperators: json("{}") }),
    ).toThrow("The option customOperators must be a Map from a definition or class to a function, found an object.");
    const notFunction: ReadonlyMap<string, CustomOperator> = new Map(json<[string, CustomOperator][]>('[["x", 1]]'));
    expect(() =>
      evaluate(sum, createItemVariables(ITEM), ITEM, { random: uniform, customOperators: notFunction }),
    ).toThrow('The custom operator "x" must be a function, found 1.');
    expect(() =>
      evaluate(sum, createItemVariables(ITEM), ITEM, { random: uniform, resolveTemplate: json("1") }),
    ).toThrow("The option resolveTemplate must be a function, found 1.");
    expect(() => evaluate(sum, createItemVariables(ITEM), ITEM, { random: uniform, limits: json("null") })).toThrow(
      "The option limits must be an object, found null.",
    );
    expect(() =>
      evaluate(sum, createItemVariables(ITEM), ITEM, { random: uniform, limits: { maxContainerSize: 0 } }),
    ).toThrow("The limit maxContainerSize must be a positive integer, found 0.");
  });

  it("refuses a random source that returns anything but a number in [0, 1)", () => {
    for (const draw of [1, -0.1, Number.NaN, "0.5"]) {
      expect(() =>
        run(`<qti-random-integer max="3"/>`, { random: { uniform: () => json(JSON.stringify(draw)) } }),
      ).toThrow(DataError);
    }
    expect(() => run(`<qti-random-integer max="3"/>`, { random: { uniform: () => 1 } })).toThrow(
      "The function uniform of the option random must return a number in [0, 1), found 1.",
    );
  });
});

describe("custom operators", () => {
  const add: CustomOperator = (operands) =>
    int(operands.reduce((total, operand) => total + Number(primitive(operand) ?? 0), 0));
  const custom = (attributes: string, operators: ReadonlyMap<string, CustomOperator>) =>
    run(`<qti-custom-operator${attributes}>${bv("integer", 2)}${NULL}${bv("integer", 3)}</qti-custom-operator>`, {
      random: random(),
      customOperators: operators,
    });

  it("[B64][A73] calls the operator registered for the definition, else for the class, with the operands and the expression", () => {
    let seen: Expression | undefined;
    const spy: CustomOperator = (operands, expression) => {
      seen = expression;
      expect(operands).toEqual([int(2), null, int(3)]);
      return add(operands, expression);
    };
    expect(custom(' definition="urn:add" class="adder"', new Map([["urn:add", spy]]))).toEqual(int(5));
    expect(seen?.kind).toBe("custom-operator");
    expect(custom(' definition="urn:other" class="adder"', new Map([["adder", add]]))).toEqual(int(5));
    expect(
      custom(
        ' class="adder"',
        new Map([
          ["urn:add", add],
          ["adder", () => null],
        ]),
      ),
    ).toBeNull();
  });

  it("[B64][G7][N] raises a ProcessingError for an operator that is not registered", () => {
    expectProcessingError(
      () => custom(' definition="urn:x" class="y"', new Map()),
      'No custom operator is registered for qti-custom-operator with the definition or class "urn:x" or "y".',
    );
    expectProcessingError(() => custom("", new Map([["y", add]])), "with no definition or class");
  });

  it("[B64] checks what an operator returns as untrusted input", () => {
    const returns = (value: unknown) => () => custom(' class="c"', new Map([["c", () => json(JSON.stringify(value))]]));
    expect(returns({ cardinality: "single", baseType: "integer", value: 1.5 })).toThrow(DataError);
    expect(returns({ cardinality: "single", baseType: "integer", value: 1.5 })).toThrow(
      'The custom operator "c" returned an object, which is not a value:',
    );
    expect(returns(1)).toThrow("returned 1, which is not a value");
    const big = (): Value =>
      list(
        "multiple",
        "integer",
        Array.from({ length: 11 }, (_, index) => index),
      );
    expect(() =>
      run(`<qti-custom-operator class="c"/>`, {
        random: random(),
        customOperators: new Map([["c", big]]),
        limits: { maxContainerSize: 10 },
      }),
    ).toThrow(SecurityError);
  });
});

describe("declared values", () => {
  it("[A30][A40] reads default values of each cardinality, a record's fields with their base types (INFO §7.46)", () => {
    const item = itemOf(`
      <qti-outcome-declaration identifier="S" cardinality="single" base-type="point"><qti-default-value><qti-value>3 4</qti-value></qti-default-value></qti-outcome-declaration>
      <qti-outcome-declaration identifier="M" cardinality="multiple" base-type="string"><qti-default-value><qti-value>a</qti-value><qti-value></qti-value><qti-value>b</qti-value></qti-default-value></qti-outcome-declaration>
      <qti-outcome-declaration identifier="R" cardinality="record"><qti-default-value><qti-value field-identifier="n" base-type="integer">1</qti-value><qti-value field-identifier="s" base-type="string"></qti-value></qti-default-value></qti-outcome-declaration>`);
    const { outcomes } = createItemVariables(item);
    expect(outcomes.get("S")).toEqual(single("point", [3, 4]));
    expect(outcomes.get("M")).toEqual(list("multiple", "string", ["a", "b"]));
    expect(outcomes.get("R")).toEqual(record([["n", single("integer", 1)]]));
  });

  it("[N] raises a ProcessingError for a value that is not in its lexical form or a single variable with two values", () => {
    const declare = (content: string) => () =>
      createItemVariables(itemOf(`<qti-outcome-declaration identifier="X" ${content}</qti-outcome-declaration>`));
    expectProcessingError(
      declare(
        `cardinality="single" base-type="integer"><qti-default-value><qti-value>1.5</qti-value></qti-default-value>`,
      ),
      'The default value of X has the text "1.5", which is not a value of base type integer.',
    );
    expectProcessingError(
      declare(
        `cardinality="single" base-type="integer"><qti-default-value><qti-value>1</qti-value><qti-value>2</qti-value></qti-default-value>`,
      ),
      "The default value of X has 2 values, but its variable is single.",
    );
    expectProcessingError(
      declare(`cardinality="record"><qti-default-value><qti-value>1</qti-value></qti-default-value>`),
      "each of its values needs a field-identifier and a base-type",
    );
  });

  it("[A69] reads a base value as its base type, NULL for an empty string (INFO §2.11.1.1)", () => {
    expect(run(bv("pair", "A B"))).toEqual(single("pair", ["A", "B"]));
    expect(run(bv("boolean", "1"))).toEqual(bool(true));
    expect(run(bv("float", "INF"))).toEqual(float(Number.POSITIVE_INFINITY));
    expect(run(bv("string", ""))).toBeNull();
    expectProcessingError(
      () => run(bv("integer", "x")),
      'The base value has the text "x", which is not a value of base type integer.',
    );
  });
});

describe("evaluate", () => {
  it("[A122][A72][A74] reads variables, correct responses and default values of the item (INFO §2.11.1.2–4)", () => {
    expect(run(v("N"))).toEqual(int(3));
    expect(run(v("K"))).toEqual(int(2));
    expect(run(`<qti-correct identifier="RESPONSE"/>`)).toEqual(id("B"));
    expect(run(`<qti-default identifier="N"/>`)).toEqual(int(3));
    expect(run(`<qti-default identifier="SCORE"/>`)).toBeNull();
    expect(run(`<qti-default identifier="numAttempts"/>`)).toBeNull();
  });

  it("[B85][N] raises a ProcessingError for a variable the item does not declare (INFO §2.2.2)", () => {
    expectProcessingError(() => run(v("MISSING")), "The item declares no variable MISSING.");
    expectProcessingError(
      () => run(`<qti-correct identifier="SCORE"/>`),
      "The item declares no response variable SCORE.",
    );
    expectProcessingError(() => run(`<qti-default identifier="MISSING"/>`), "The item declares no variable MISSING.");
  });

  it("[A104][A97][W20] gives NULL for qti-null and the constants pi and e (INFO §2.11.1.7, §8.20)", () => {
    expect(run(NULL)).toBeNull();
    expect(run(`<qti-math-constant name="pi"/>`)).toEqual(float(Math.PI));
    expect(run(`<qti-math-constant name="e"/>`)).toEqual(float(Math.E));
    expect(() => expressionOf(`<qti-math-constant name="tau"/>`)).toThrow(ReadError);
  });

  it("[A67][N] refuses operands that do not fit the operator, and the expressions of outcome processing", () => {
    expectProcessingError(
      () => op("and", [bv("integer", 1)]),
      "The operator qti-and takes single boolean operands, found a single integer.",
    );
    expectProcessingError(
      () => op("sum", [bv("string", "1")]),
      "qti-sum takes single or multiple or ordered integer or float operands",
    );
    expectProcessingError(
      () => run(`<qti-number-correct/>`),
      "The expression qti-number-correct reads the item sessions of a test",
    );
    expectProcessingError(
      () => run(`<qti-test-variables variable-identifier="SCORE"/>`),
      "only outcome processing may use it",
    );
  });

  it("[N] refuses an expression model that is not one of QTI 3.0, or has the wrong number of operands", () => {
    const evaluateModel = (model: unknown) => () =>
      evaluate(json(JSON.stringify(model)), createItemVariables(ITEM), ITEM, CONTEXT);
    expectProcessingError(
      evaluateModel({ kind: "__proto__" }),
      'The model has the expression kind "__proto__", which QTI 3.0 does not define.',
    );
    expectProcessingError(
      evaluateModel({ kind: "and", operands: [] }),
      "The operator qti-and takes 1 or more operands, found 0.",
    );
    expectProcessingError(
      evaluateModel({ kind: "math-operator", name: "atan2", operands: [{ kind: "null" }] }),
      "The function atan2 of qti-math-operator takes two operands, found 1.",
    );
  });

  it("[B94][N] evaluates an expression nested to the default depth of a document, and refuses a deeper one when it is read", () => {
    const nested = (levels: number): string =>
      `${"<qti-not>".repeat(levels)}${bv("boolean", "true")}${"</qti-not>".repeat(levels)}`;
    // The rule, its set-outcome-value and the base value take three of the 256 levels.
    const deepest = DEFAULT_XML_LIMITS.maxDepth - 3;
    expect(runPrimitive(nested(deepest))).toBe(deepest % 2 === 0);
    const document = readAsi(
      `<qti-response-processing ${NS}><qti-set-outcome-value identifier="X">${nested(deepest)}</qti-set-outcome-value></qti-response-processing>`,
    );
    expect(readAsi(writeAsi(document))).toEqual(document);
    expect(() => run(nested(deepest + 1))).toThrow(expect.objectContaining({ limit: "maxDepth", value: 256 }));
  });

  it("[B94] keeps variables named like members of Object as data, and reads none that the item does not declare", () => {
    const item = itemOf(
      ["__proto__", "constructor", "toString"]
        .map(
          (name, index) =>
            `<qti-outcome-declaration identifier="${name}" cardinality="single" base-type="integer"><qti-default-value><qti-value>${index + 1}</qti-value></qti-default-value></qti-outcome-declaration>`,
        )
        .join(""),
    );
    expect(["__proto__", "constructor", "toString"].map((name) => primitive(run(v(name), CONTEXT, item)))).toEqual([
      1, 2, 3,
    ]);
    for (const name of ["__proto__", "hasOwnProperty", "valueOf", "__defineGetter__"]) {
      expectProcessingError(() => run(v(name)), `The item declares no variable ${name}.`);
    }
    expect(Reflect.get({}, "polluted")).toBeUndefined();
  });

  it("refuses arguments of other types with a DataError", () => {
    const expression = expressionOf(NULL);
    const variables = createItemVariables(ITEM);
    expect(() => evaluate(json("null"), variables, ITEM, CONTEXT)).toThrow(
      "The expression must be an object of the model, found null.",
    );
    expect(() => evaluate(expression, json("[]"), ITEM, CONTEXT)).toThrow(
      "The item variables must be an object, found an array.",
    );
    expect(() => evaluate(expression, { ...variables, outcomes: json("{}") }, ITEM, CONTEXT)).toThrow(
      "The outcomes of the item variables must be a Map, found an object.",
    );
    expect(() => evaluate(expression, variables, json('{"kind":"assessment-test"}'), CONTEXT)).toThrow(
      'The item must be the model of a qti-assessment-item, found the kind "assessment-test".',
    );
  });
});

describe("item variables in reach", () => {
  const template = (rules: string) =>
    runTemplateProcessing(
      itemOf(`${DECLARATIONS}<qti-template-processing>${rules}</qti-template-processing>`),
      createItemVariables(ITEM),
      CONTEXT,
    );

  it("[A60][N] lets template processing read only template and context variables (INFO §6.50)", () => {
    expectProcessingError(
      () => template(`<qti-set-template-value identifier="K">${v("N")}</qti-set-template-value>`),
      "Template processing reads the outcome variable N, but it may read only template and context variables.",
    );
    expectProcessingError(
      () =>
        template(
          `<qti-set-template-value identifier="K"><qti-map-response identifier="RESPONSE"/></qti-set-template-value>`,
        ),
      "reads the response variable RESPONSE",
    );
    expect(
      template(`<qti-set-template-value identifier="K">${bv("integer", 9)}</qti-set-template-value>`).templates.get(
        "K",
      ),
    ).toEqual(int(9));
  });

  it("[A57][A58][A60][N] sets only the variables of a rule's kind", () => {
    expectProcessingError(
      () => template(`<qti-set-template-value identifier="N">${bv("integer", 1)}</qti-set-template-value>`),
      "The rule qti-set-template-value sets N, which is not a template variable of the item.",
    );
    expectProcessingError(
      () => template(`<qti-set-correct-response identifier="K">${bv("integer", 1)}</qti-set-correct-response>`),
      "which is not a response variable of the item",
    );
    expectProcessingError(
      () => template(`<qti-set-default-value identifier="K">${bv("integer", 1)}</qti-set-default-value>`),
      "which is not a response or outcome variable of the item",
    );
    expectProcessingError(
      () =>
        processed(
          DECLARATIONS,
          `<qti-set-outcome-value identifier="RESPONSE">${bv("identifier", "A")}</qti-set-outcome-value>`,
        ),
      "The rule qti-set-outcome-value sets RESPONSE, which is not an outcome variable of the item.",
    );
  });
});

describe("logic", () => {
  const t = bv("boolean", "true");
  const f = bv("boolean", "false");

  it("[B83][A67][A105][A103] follows three-valued logic (INFO §2.11.3.10, .15, .35)", () => {
    expect([opPrimitive("and", [t, t]), opPrimitive("and", [t, f]), opPrimitive("and", [NULL, f])]).toEqual([
      true,
      false,
      false,
    ]);
    expect(op("and", [t, NULL])).toBeNull();
    expect([opPrimitive("or", [f, t]), opPrimitive("or", [f, f]), opPrimitive("or", [NULL, t])]).toEqual([
      true,
      false,
      true,
    ]);
    expect(op("or", [f, NULL])).toBeNull();
    expect([opPrimitive("not", [t]), opPrimitive("not", [f])]).toEqual([false, true]);
    expect(op("not", [NULL])).toBeNull();
  });

  it("[B83][A68] counts true operands between min and max, NULL when undecided: INFO §2.11.3.1's examples", () => {
    const anyN = (...operands: string[]) => op("any-n", operands, ' min="3" max="4"');
    expect(anyN(t, t, f, NULL)).toBeNull();
    expect(primitive(anyN(t, f, f, NULL))).toBe(false);
    expect(primitive(anyN(t, t, t, NULL))).toBe(true);
    expect(primitive(op("any-n", [t, t, t], ' min="1" max="2"'))).toBe(false);
    expect(primitive(op("any-n", [t, f], ' min="N" max="K"'))).toBe(false);
    expect(op("any-n", [t], ' min="NONE" max="2"')).toBeNull();
  });
});

describe("lookup tables", () => {
  const Grades = `
    <qti-outcome-declaration identifier="GRADE" cardinality="single" base-type="identifier">
      <qti-interpolation-table default-value="F">
        <qti-interpolation-table-entry source-value="90" target-value="A"/>
        <qti-interpolation-table-entry source-value="80" include-boundary="false" target-value="B"/>
        <qti-interpolation-table-entry source-value="70" target-value="C"/>
      </qti-interpolation-table>
    </qti-outcome-declaration>
    <qti-outcome-declaration identifier="TYPE" cardinality="single" base-type="identifier">
      <qti-match-table><qti-match-table-entry source-value="1" target-value="integer"/><qti-match-table-entry source-value="2" target-value="float"/></qti-match-table>
    </qti-outcome-declaration>`;
  const look = (identifier: string, expression: string) =>
    processed(
      Grades,
      `<qti-lookup-outcome-value identifier="${identifier}">${expression}</qti-lookup-outcome-value>`,
    ).outcomes.get(identifier);

  it("[B49][A44][A31][A32] takes the first interpolation entry at or below the value, above it without the boundary (INFO §5.78, §7.18)", () => {
    expect(look("GRADE", bv("float", 95))).toEqual(id("A"));
    expect(look("GRADE", bv("integer", 90))).toEqual(id("A"));
    expect(look("GRADE", bv("float", 85))).toEqual(id("B"));
    expect(look("GRADE", bv("integer", 80))).toEqual(id("C"));
    expect(look("GRADE", bv("float", 10))).toEqual(id("F"));
    expect(look("GRADE", NULL)).toEqual(id("F"));
  });

  it("[B49][A35][A36] takes the match entry of the exact integer, else the default or NULL (INFO §5.90)", () => {
    expect(look("TYPE", bv("integer", 2))).toEqual(id("float"));
    expect(look("TYPE", bv("integer", 3))).toBeNull();
  });

  it("[B49][N] refuses a match table for a float and an outcome without a table (INFO §5.87.2)", () => {
    expectProcessingError(() => look("TYPE", bv("float", 2)), "needs a single integer, found a single float");
    expectProcessingError(
      () =>
        processed(
          `${Grades}${DECLARATIONS}`,
          `<qti-lookup-outcome-value identifier="SCORE">${bv("float", 1)}</qti-lookup-outcome-value>`,
        ),
      "The rule qti-lookup-outcome-value sets SCORE, which is not a single outcome with a lookup table.",
    );
  });
});

describe("mapping", () => {
  const Mapped = `
    <qti-response-declaration identifier="R" cardinality="multiple" base-type="identifier">
      <qti-mapping lower-bound="-1" default-value="-0.25">
        <qti-map-entry map-key="A" mapped-value="0"/><qti-map-entry map-key="B" mapped-value="1"/>
        <qti-map-entry map-key="C" mapped-value="0.5"/><qti-map-entry map-key="D" mapped-value="0"/>
      </qti-mapping>
    </qti-response-declaration>
    <qti-response-declaration identifier="S" cardinality="single" base-type="identifier">
      <qti-mapping lower-bound="0" default-value="-1"><qti-map-entry map-key="A" mapped-value="0"/><qti-map-entry map-key="B" mapped-value="1"/>
      <qti-map-entry map-key="C" mapped-value="0.5"/><qti-map-entry map-key="D" mapped-value="0"/></qti-mapping>
    </qti-response-declaration>
    <qti-response-declaration identifier="W" cardinality="multiple" base-type="string">
      <qti-mapping><qti-map-entry map-key="Paris" mapped-value="1"/><qti-map-entry map-key="Rome" mapped-value="2" case-sensitive="true"/></qti-mapping>
    </qti-response-declaration>
    <qti-response-declaration identifier="P" cardinality="multiple" base-type="point">
      <qti-area-mapping default-value="-1" upper-bound="2.5">
        <qti-area-map-entry shape="circle" coords="10,10,5" mapped-value="1"/>
        <qti-area-map-entry shape="rect" coords="0,0,20,20" mapped-value="2"/>
      </qti-area-mapping>
    </qti-response-declaration>
    <qti-response-declaration identifier="Q" cardinality="single" base-type="point">
      <qti-area-mapping default-value="0.5"><qti-area-map-entry shape="circle" coords="10,10,5" mapped-value="1"/></qti-area-mapping>
    </qti-response-declaration>
    <qti-response-declaration identifier="U" cardinality="single" base-type="identifier"/>`;
  const item = itemOf(Mapped);
  const mapped = (expression: string, responses: Record<string, Value | null>): Value | null => {
    const variables = createItemVariables(item);
    return evaluate(
      expressionOf(expression),
      { ...variables, responses: new Map([...variables.responses, ...Object.entries(responses)]) },
      item,
      CONTEXT,
    );
  };
  const mapR = (values: readonly string[]) =>
    primitive(mapped(`<qti-map-response identifier="R"/>`, { R: container("multiple", "identifier", values) }));

  it("[B76][A94][A33][A34] maps a single value, and sums the distinct values of a container: INFO §2.11.1.5's example", () => {
    expect(primitive(mapped(`<qti-map-response identifier="S"/>`, { S: id("C") }))).toBe(0.5);
    expect(mapR(["C", "B"])).toBe(1.5);
    expect(mapR(["B", "B", "C"])).toBe(1.5);
    expect(mapR(["A", "D"])).toBe(0);
  });

  it("[B76][G5] applies the default value to unmapped keys, and the bounds to containers only", () => {
    expect(mapR(["E", "F"])).toBe(-0.5);
    expect(mapR(["B", "E"])).toBe(0.75);
    expect(mapR(["E", "F", "G", "H", "I"])).toBe(-1);
    expect(primitive(mapped(`<qti-map-response identifier="S"/>`, { S: id("E") }))).toBe(-1);
  });

  it("[B76][G5] gives NULL for a NULL response", () => {
    expect(mapped(`<qti-map-response identifier="R"/>`, { R: null })).toBeNull();
  });

  it("[B76][G6] matches string keys case-insensitively unless the entry is case-sensitive (INFO §7.21.3)", () => {
    const mapW = (values: readonly string[]) =>
      primitive(mapped(`<qti-map-response identifier="W"/>`, { W: container("multiple", "string", values) }));
    expect(mapW(["PARIS"])).toBe(1);
    expect(mapW(["rome"])).toBe(0);
    expect(mapW(["Rome", "paris"])).toBe(3);
  });

  it("[B77][A95][A26][A27] maps each point to the first area that holds it, each area counted once (INFO §2.11.1.6)", () => {
    const mapP = (points: readonly (readonly [number, number])[]) =>
      primitive(mapped(`<qti-map-response-point identifier="P"/>`, { P: container("multiple", "point", points) }));
    expect(mapP([[10, 10]])).toBe(1);
    expect(
      mapP([
        [10, 10],
        [11, 11],
      ]),
    ).toBe(1);
    expect(
      mapP([
        [10, 10],
        [1, 1],
      ]),
    ).toBe(2.5);
    expect(
      mapP([
        [50, 50],
        [60, 60],
      ]),
    ).toBe(-2);
    expect(primitive(mapped(`<qti-map-response-point identifier="Q"/>`, { Q: single("point", [40, 40]) }))).toBe(0.5);
    expect(mapped(`<qti-map-response-point identifier="Q"/>`, { Q: null })).toBeNull();
  });

  it("[B76][B77][N] refuses a response without a mapping", () => {
    expectProcessingError(
      () => mapped(`<qti-map-response identifier="U"/>`, {}),
      "The response variable U has no qti-mapping to map its value with.",
    );
    expectProcessingError(
      () => mapped(`<qti-map-response-point identifier="S"/>`, {}),
      "has no qti-area-mapping of points",
    );
    expectProcessingError(
      () => mapped(`<qti-map-response identifier="X"/>`, {}),
      "The item declares no response variable X.",
    );
  });
});

describe("math operators", () => {
  const math = (name: string, ...operands: string[]) => op("math-operator", operands, ` name="${name}"`);
  const of = (name: string, x: string | number) => primitive(math(name, bv("float", x)));

  it("[B71][A98][W21] computes every function of Table 8.21", () => {
    const x = 0.5;
    const expected: Record<string, number> = {
      sin: Math.sin(x),
      cos: Math.cos(x),
      tan: Math.tan(x),
      sec: 1 / Math.cos(x),
      csc: 1 / Math.sin(x),
      cot: 1 / Math.tan(x),
      asin: Math.asin(x),
      acos: Math.acos(x),
      atan: Math.atan(x),
      asec: Math.acos(1 / 2),
      acsc: Math.asin(1 / 2),
      acot: Math.atan(1 / 2),
      sinh: Math.sinh(x),
      cosh: Math.cosh(x),
      tanh: Math.tanh(x),
      sech: 1 / Math.cosh(x),
      csch: 1 / Math.sinh(x),
      coth: 1 / Math.tanh(x),
      log: Math.log10(x),
      ln: Math.log(x),
      exp: Math.exp(x),
      abs: x,
      toDegrees: (x * 180) / Math.PI,
      toRadians: (x * Math.PI) / 180,
    };
    for (const [name, value] of Object.entries(expected)) {
      const argument = name === "asec" || name === "acsc" || name === "acot" ? 2 : x;
      expect(of(name, argument), name).toBeCloseTo(value, 15);
    }
    expect(math("signum", bv("float", -2.5))).toEqual(int(-1));
    expect(math("floor", bv("float", -2.5))).toEqual(int(-3));
    expect(math("ceil", bv("float", -2.5))).toEqual(int(-2));
    expect(primitive(math("atan2", bv("float", 1), bv("float", -1)))).toBe(Math.atan2(1, -1));
    expect(() => expressionOf(`<qti-math-operator name="sqrt">${bv("float", 1)}</qti-math-operator>`)).toThrow(
      ReadError,
    );
  });

  it("[B71] gives NULL outside a function's domain and for NaN: INFO §2.11.3.39 and Table 8.21", () => {
    expect([of("asin", 2), of("acos", -1.5), of("asec", 0.5), of("acsc", -0.5), of("ln", -1), of("log", -1)]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    for (const name of ["sin", "abs", "exp", "signum", "floor", "toDegrees"]) expect(of(name, "NaN"), name).toBeNull();
    expect(primitive(math("atan2", bv("float", "NaN"), bv("float", 1)))).toBeNull();
    expect(math("sin", NULL)).toBeNull();
  });

  it("[B71] gives NULL for a reciprocal function of 0 and 0 for one of an infinity (INFO §2.11.3.39)", () => {
    expect([of("csc", 0), of("cot", 0), of("cot", "-0"), of("csch", 0), of("coth", 0)]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect([of("sech", "INF"), of("csch", "INF"), of("coth", "INF")]).toEqual([0, 0, 1]);
  });

  it("[B71] keeps the infinite results of Table 8.21 for infinite arguments, and the special values it lists", () => {
    expect([
      of("abs", "-INF"),
      of("exp", "INF"),
      of("exp", "-INF"),
      of("ln", "INF"),
      of("cosh", "-INF"),
      of("sinh", "-INF"),
    ]).toEqual([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      0,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    expect([of("tanh", "INF"), of("tanh", "-INF"), of("toDegrees", "-INF"), of("abs", "-0")]).toEqual([
      1,
      -1,
      Number.NEGATIVE_INFINITY,
      0,
    ]);
    expect(primitive(math("signum", bv("float", "-0")))).toBe(0);
    expect(primitive(math("atan2", bv("float", "INF"), bv("float", "-INF")))).toBe((3 * Math.PI) / 4);
    expect(primitive(math("atan2", bv("float", 1), bv("float", "INF")))).toBe(0);
  });

  it("[B71][G28] gives NULL for ln and log of 0, the operator text winning over Table 8.21's −INF", () => {
    expect([of("ln", 0), of("ln", "-0"), of("log", 0)]).toEqual([null, null, null]);
  });

  it("[B71][B72][G29] gives NULL for floor and ceil of ±INF, which return integers (D4), and beyond the safe integers (D3)", () => {
    expect([of("floor", "INF"), of("ceil", "-INF"), of("floor", "1e300")]).toEqual([null, null, null]);
  });

  it("[B71] gives NULL for a finite argument whose result overflows, as a result beyond float is NULL for divide", () => {
    expect([of("exp", 1000), of("cosh", 1000), of("sinh", -1000)]).toEqual([null, null, null]);
  });

  it("[B71][N] needs one operand, or two for atan2", () => {
    expectProcessingError(
      () => math("sin", bv("float", 1), bv("float", 2)),
      "The function sin of qti-math-operator takes one operand, found 2.",
    );
    expectProcessingError(() => math("atan2", bv("float", 1)), "takes two operands, found 1");
  });
});

describe("outcome processing", () => {
  const ItemA = itemOf(`
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>B</qti-value></qti-correct-response></qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" normal-maximum="1" normal-minimum="0"/>
    <qti-outcome-declaration identifier="RAW" cardinality="single" base-type="integer"/>`);
  const ItemB = itemOf(`
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"><qti-default-value><qti-value>0</qti-value></qti-default-value><qti-correct-response><qti-value>7</qti-value></qti-correct-response></qti-response-declaration>
    <qti-response-declaration identifier="OPEN" cardinality="single" base-type="string"/>
    <qti-outcome-declaration identifier="POINTS" cardinality="single" base-type="integer" normal-maximum="2"/>`);
  const ItemC = itemOf(`<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>`);
  const testDocument = readAsi(`<qti-assessment-test ${NS} identifier="test" title="Test">
    <qti-outcome-declaration identifier="TOTAL" cardinality="single" base-type="float"/>
    <qti-outcome-declaration identifier="COUNT" cardinality="single" base-type="integer"/>
    <qti-outcome-declaration identifier="ALL" cardinality="multiple" base-type="float"/>
    <qti-outcome-declaration identifier="INTEGERS" cardinality="multiple" base-type="integer"/>
    <qti-outcome-declaration identifier="FLAG" cardinality="single" base-type="identifier"><qti-default-value><qti-value>start</qti-value></qti-default-value></qti-outcome-declaration>
    <qti-test-part identifier="P" navigation-mode="nonlinear" submission-mode="individual">
      <qti-assessment-section identifier="S" title="S" visible="true">
        <qti-assessment-item-ref identifier="Q1" href="a.xml" category="core"><qti-weight identifier="W" value="2"/></qti-assessment-item-ref>
        <qti-assessment-item-ref identifier="Q2" href="b.xml"><qti-variable-mapping source-identifier="POINTS" target-identifier="SCORE"/><qti-weight identifier="W" value="0.5"/></qti-assessment-item-ref>
        <qti-assessment-item-ref identifier="Q3" href="c.xml" category="core extra"/>
      </qti-assessment-section>
    </qti-test-part>
  </qti-assessment-test>`);
  if (testDocument.kind !== "test") throw new Error("The test reads a test.");
  const Test = testDocument.test;
  const refs = new Map<string, AssessmentItemRef>();
  const collect = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      if (typeof node !== "object" || node === null) continue;
      if (Reflect.get(node, "kind") === "assessment-item-ref")
        refs.set(String(Reflect.get(node, "identifier")), json(JSON.stringify(node)));
      const children = Reflect.get(node, "children") ?? Reflect.get(node, "sections");
      if (Array.isArray(children)) collect(children);
    }
  };
  collect(Test.testParts);
  const refOf = (identifier: string): AssessmentItemRef => {
    const ref = refs.get(identifier);
    if (ref === undefined) throw new Error(`The test has no item ref ${identifier}.`);
    return ref;
  };

  /** The variables of a session after it was attempted with the responses and outcomes given. */
  function session(
    item: AssessmentItem,
    responses: Record<string, Value | null>,
    outcomes: Record<string, Value | null>,
    attempts = 1,
  ): ItemVariables {
    const variables = createItemVariables(item);
    return {
      ...variables,
      responses: new Map([...variables.responses, ["numAttempts", int(attempts)], ...Object.entries(responses)]),
      outcomes: new Map([...variables.outcomes, ...Object.entries(outcomes)]),
    };
  }

  interface Entry {
    readonly view: ItemSessionView;
    readonly instance: number;
  }
  const entries: readonly Entry[] = [
    {
      view: {
        ref: refOf("Q1"),
        item: ItemA,
        variables: session(ItemA, { RESPONSE: id("B") }, { SCORE: float(1), RAW: int(3) }),
      },
      instance: 1,
    },
    {
      view: {
        ref: refOf("Q1"),
        item: ItemA,
        variables: session(ItemA, { RESPONSE: id("C") }, { SCORE: float(0), RAW: int(4) }),
      },
      instance: 2,
    },
    {
      view: { ref: refOf("Q2"), item: ItemB, variables: session(ItemB, { RESPONSE: int(0) }, { POINTS: int(2) }) },
      instance: 1,
    },
    { view: { ref: refOf("Q3"), item: ItemC, variables: session(ItemC, {}, { SCORE: null }, 0) }, instance: 1 },
  ];
  const filters: ItemSessionFilter[] = [];
  const Scope: TestScope = {
    itemSessions: (filter) => {
      filters.push(filter);
      return entries
        .map(({ view }) => view)
        .filter(
          ({ ref }) =>
            filter.includeCategories === undefined ||
            filter.includeCategories.some((category) => ref.category?.includes(category)),
        )
        .filter(
          ({ ref }) =>
            filter.excludeCategories === undefined ||
            !filter.excludeCategories.some((category) => ref.category?.includes(category)),
        );
    },
    itemSession: (identifier, instance) =>
      [...entries]
        .reverse()
        .find(
          (entry) =>
            entry.view.ref.identifier === identifier && (instance === undefined || entry.instance === instance),
        )?.view,
    variable: (identifier) =>
      new Map<string, Value | null>([
        ["duration", duration(600)],
        ["P.duration", duration(300)],
        ["Q9.SCORE", null],
      ]).get(identifier),
  };
  const testExpression = (xml: string, outcomes: ReadonlyMap<string, Value | null> = new Map()) =>
    evaluateTestExpression(expressionOf(xml), Test, outcomes, Scope, CONTEXT);
  const outcomesAfter = (rules: string, outcomes: ReadonlyMap<string, Value | null> = new Map()) =>
    runOutcomeProcessing({ ...Test, outcomeProcessing: outcomeProcessingOf(rules) }, outcomes, Scope, CONTEXT);
  function outcomeProcessingOf(rules: string): AssessmentTest["outcomeProcessing"] {
    const document = readAsi(`<qti-outcome-processing ${NS}>${rules}</qti-outcome-processing>`);
    if (document.kind !== "outcome-processing") throw new Error("The test reads outcome processing.");
    return document.processing;
  }

  it("[B37][A49][A43] runs the rules from the outcomes given, the others from their defaults, until qti-exit-test (INFO §2.9)", () => {
    const outcomes = outcomesAfter(
      `<qti-set-outcome-value identifier="COUNT">${bv("integer", 1)}</qti-set-outcome-value><qti-exit-test/>
       <qti-set-outcome-value identifier="FLAG">${bv("identifier", "late")}</qti-set-outcome-value>`,
      new Map([["TOTAL", float(5)]]),
    );
    expect(outcomes).toEqual(
      new Map<string, Value | null>([
        ["TOTAL", float(5)],
        ["COUNT", int(1)],
        ["ALL", null],
        ["INTEGERS", null],
        ["FLAG", id("start")],
      ]),
    );
  });

  it("[B38][B85][A122] reads item variables as ITEM.VAR, the last instance, and ITEM.n.VAR (INFO §2.11.1.2)", () => {
    expect(testExpression(v("Q1.RAW"))).toEqual(int(4));
    expect(testExpression(v("Q1.1.RAW"))).toEqual(int(3));
    expect(testExpression(v("Q1.2.RESPONSE"))).toEqual(id("C"));
    expect(testExpression(`<qti-correct identifier="Q1.RESPONSE"/>`)).toEqual(id("B"));
    expect(testExpression(`<qti-default identifier="Q2.RESPONSE"/>`)).toEqual(int(0));
    expect(testExpression(`<qti-default identifier="FLAG"/>`)).toEqual(id("start"));
    expect(testExpression(v("Q9.SCORE"))).toBeNull();
  });

  it("[T22] reads the test's other variables, such as durations, through the scope (INFO §2.8.5)", () => {
    expect(testExpression(v("duration"))).toEqual(duration(600));
    expect(testExpression(v("P.duration"))).toEqual(duration(300));
    expectProcessingError(() => testExpression(v("UNKNOWN")), "The test has no variable UNKNOWN.");
    expectProcessingError(
      () => testExpression(`<qti-correct identifier="TOTAL"/>`),
      "The test has no response variable TOTAL.",
    );
  });

  it("[B39][A122] weights a numeric item variable into a float, with 1 for a missing weight (INFO §7.47.2)", () => {
    expect(testExpression(`<qti-variable identifier="Q1.RAW" weight-identifier="W"/>`)).toEqual(float(8));
    expect(testExpression(`<qti-variable identifier="Q1.RAW" weight-identifier="NONE"/>`)).toEqual(float(4));
    expect(testExpression(`<qti-variable identifier="Q1.RESPONSE" weight-identifier="W"/>`)).toEqual(id("C"));
  });

  it("[B40] reads an item variable under the name its variable mapping gives it (INFO §7.48)", () => {
    expect(testExpression(v("Q2.SCORE"))).toEqual(int(2));
  });

  it("[B43][A123][A124][A125][A126][A127] counts selected, presented, responded, correct and incorrect items (INFO §2.11.2.1–5)", () => {
    const count = (name: string) => primitive(testExpression(`<qti-number-${name}/>`));
    expect(count("selected")).toBe(4);
    expect(count("presented")).toBe(3);
    expect(count("responded")).toBe(2);
    expect(count("correct")).toBe(1);
    expect(count("incorrect")).toBe(1);
  });

  it("[B42] passes the section and categories of the expression to the scope (INFO §7.27)", () => {
    filters.length = 0;
    expect(
      primitive(
        testExpression(
          `<qti-number-selected section-identifier="S" include-category="core" exclude-category="extra"/>`,
        ),
      ),
    ).toBe(2);
    expect(filters).toEqual([{ sectionIdentifier: "S", includeCategories: ["core"], excludeCategories: ["extra"] }]);
    testExpression(`<qti-number-selected/>`);
    expect(filters[1]).toEqual({});
  });

  it("[B44][A128][A129] looks up normal maxima and minima, weighted, as multiple floats (INFO §2.11.2.6–7, G11)", () => {
    expect(testExpression(`<qti-outcome-maximum outcome-identifier="SCORE" exclude-category="extra"/>`)).toEqual(
      list("multiple", "float", [1, 1, 2]),
    );
    expect(testExpression(`<qti-outcome-maximum outcome-identifier="SCORE" weight-identifier="W"/>`)).toBeNull();
    expect(testExpression(`<qti-outcome-minimum outcome-identifier="SCORE" weight-identifier="W"/>`)).toEqual(
      list("multiple", "float", [0, 0]),
    );
    expect(testExpression(`<qti-outcome-minimum outcome-identifier="MISSING"/>`)).toBeNull();
  });

  it("[B44][A130] collects the single values of a variable, skipping NULL, integer unless a float is among them (INFO §2.11.2.8, §7.39)", () => {
    expect(testExpression(`<qti-test-variables variable-identifier="SCORE"/>`)).toEqual(
      list("multiple", "float", [1, 0, 2]),
    );
    expect(testExpression(`<qti-test-variables variable-identifier="RAW"/>`)).toEqual(
      list("multiple", "integer", [3, 4]),
    );
    expect(testExpression(`<qti-test-variables variable-identifier="SCORE" base-type="integer"/>`)).toEqual(
      list("multiple", "integer", [2]),
    );
    expect(testExpression(`<qti-test-variables variable-identifier="RESPONSE" base-type="identifier"/>`)).toEqual(
      list("multiple", "identifier", ["B", "C"]),
    );
    expect(testExpression(`<qti-test-variables variable-identifier="SCORE" weight-identifier="W"/>`)).toEqual(
      list("multiple", "float", [2, 0, 1]),
    );
    expect(testExpression(`<qti-test-variables variable-identifier="OPEN"/>`)).toBeNull();
  });

  it("[B44][B94][N] refuses a container that qti-test-variables or qti-outcome-maximum builds above maxContainerSize", () => {
    const evaluated = (xml: string, maxContainerSize: number) =>
      evaluateTestExpression(expressionOf(xml), Test, new Map(), Scope, {
        random: createRandom(1),
        limits: { maxContainerSize },
      });
    for (const xml of [
      `<qti-test-variables variable-identifier="SCORE"/>`,
      `<qti-outcome-maximum outcome-identifier="SCORE" exclude-category="extra"/>`,
    ]) {
      expect(evaluated(xml, 3)).toMatchObject({ values: [expect.anything(), expect.anything(), expect.anything()] });
      expect(() => evaluated(xml, 2)).toThrow(expect.objectContaining({ limit: "maxContainerSize", value: 2 }));
    }
  });

  it("[B44][G35] ignores a weight with base-type integer", () => {
    expect(
      testExpression(`<qti-test-variables variable-identifier="RAW" base-type="integer" weight-identifier="W"/>`),
    ).toEqual(list("multiple", "integer", [3, 4]));
  });

  it("[A44] looks up a table of the test, and sums what test variables collect", () => {
    const outcomes = outcomesAfter(
      `<qti-set-outcome-value identifier="TOTAL"><qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum></qti-set-outcome-value>`,
    );
    expect(outcomes.get("TOTAL")).toEqual(float(3));
  });

  it("refuses arguments of other types, and outcomes that the test does not declare or that do not fit, with a DataError", () => {
    const empty = new Map<string, Value | null>();
    expect(() => runOutcomeProcessing(json("null"), empty, Scope, CONTEXT)).toThrow(
      "The test must be an object of the model of qti-assessment-test, found null.",
    );
    expect(() => runOutcomeProcessing({ ...Test, kind: json('"item"') }, empty, Scope, CONTEXT)).toThrow(
      'The test must be the model of a qti-assessment-test, found the kind "item".',
    );
    expect(() => runOutcomeProcessing(Test, empty, json('{"itemSessions":1}'), CONTEXT)).toThrow(
      "The test scope must have a function itemSessions, found 1.",
    );
    expect(() => runOutcomeProcessing(Test, json("{}"), Scope, CONTEXT)).toThrow(
      "The outcomes must be a Map from identifier to value, found an object.",
    );
    expect(() => runOutcomeProcessing(Test, new Map([["MISSING", null]]), Scope, CONTEXT)).toThrow(
      'The outcomes give "MISSING", which the test does not declare.',
    );
    expect(() => runOutcomeProcessing(Test, new Map([["COUNT", float(1.5)]]), Scope, CONTEXT)).toThrow(
      "The outcome COUNT is a single integer, found a single float.",
    );
    expect(() => runOutcomeProcessing(Test, new Map([["TOTAL", int(1)]]), Scope, CONTEXT)).not.toThrow();
  });

  it("[N] raises a ProcessingError for a rule that sets something other than an outcome of the test", () => {
    expectProcessingError(
      () => outcomesAfter(`<qti-set-outcome-value identifier="Q1.SCORE">${bv("float", 1)}</qti-set-outcome-value>`),
      "The rule qti-set-outcome-value sets Q1.SCORE, which is not an outcome of the test.",
    );
  });
});

describe("random values", () => {
  const draw = (xml: string, u: number) => primitive(run(xml, { random: { uniform: () => u } }));

  it("[A112][G15] draws min + k × step at index floor(u × n) of the admissible values: INFO §7.34's example", () => {
    const xml = `<qti-random-integer min="2" max="11" step="3"/>`;
    expect([0, 0.25, 0.5, 0.75, 0.999].map((u) => draw(xml, u))).toEqual([2, 5, 8, 11, 11]);
    expect(draw(`<qti-random-integer max="3"/>`, 0.99)).toBe(3);
    expect(draw(`<qti-random-integer min="K" max="N"/>`, 0.6)).toBe(3);
  });

  it("[A112][G32] gives NULL for min above max, step at most 0, or a NULL bound", () => {
    expect(draw(`<qti-random-integer min="5" max="4"/>`, 0)).toBeNull();
    expect(draw(`<qti-random-integer max="4" step="0"/>`, 0)).toBeNull();
    expect(draw(`<qti-random-integer max="4" step="-1"/>`, 0)).toBeNull();
    expect(draw(`<qti-random-integer max="NONE"/>`, 0)).toBeNull();
  });

  it("[A111][G15][G33] draws min + u × (max − min) in [min, max), NULL for min above max", () => {
    expect(draw(`<qti-random-float min="1" max="3"/>`, 0.25)).toBe(1.5);
    expect(draw(`<qti-random-float max="T"/>`, 0.5)).toBe(0.25);
    expect(draw(`<qti-random-float min="2" max="2"/>`, 0.7)).toBe(2);
    expect(draw(`<qti-random-float min="3" max="2"/>`, 0)).toBeNull();
    expect(draw(`<qti-random-float min="-1e308" max="1e308"/>`, 0.5)).toBeNull();
  });
});

describe("attribute references", () => {
  it("[B12][W51][W52] resolves an integer attribute named by a template or outcome variable", () => {
    expect(
      run(`<qti-index n="K"><qti-ordered>${bv("integer", 5)}${bv("integer", 6)}</qti-ordered></qti-index>`),
    ).toEqual(int(6));
    expect(
      primitive(run(`<qti-round-to rounding-mode="decimalPlaces" figures="K">${bv("float", 1.2345)}</qti-round-to>`)),
    ).toBe(1.23);
    expect(run(`<qti-index n="NONE"><qti-ordered>${bv("integer", 5)}</qti-ordered></qti-index>`)).toBeNull();
  });

  it("[B12][W50][W47][G34] resolves float attributes and tolerances named by variables, an integer promoted", () => {
    expect(primitive(op("equal", [bv("float", 1), bv("float", 1.4)], ' tolerance-mode="absolute" tolerance="T"'))).toBe(
      true,
    );
    expect(
      primitive(op("equal", [bv("float", 1), bv("float", 3.9)], ' tolerance-mode="absolute" tolerance="T N"')),
    ).toBe(true);
    expect(op("equal", [bv("float", 1), bv("float", 1)], ' tolerance-mode="absolute" tolerance="NONE"')).toBeNull();
  });

  it("[B12][W53][B79] takes {identifier} in a pattern as a string variable, and as the pattern itself when there is no such variable", () => {
    expect(primitive(op("pattern-match", [bv("string", "abc")], ' pattern="{PATTERN}"'))).toBe(true);
    expect(primitive(op("pattern-match", [bv("string", "{MISSING}")], ' pattern="\\{MISSING\\}"'))).toBe(true);
    expect(primitive(op("pattern-match", [bv("string", "aaa")], ' pattern="a{3}"'))).toBe(true);
    expect(op("pattern-match", [bv("string", "abc")], ' pattern="{NOTHING}"')).toBeNull();
  });

  it("[B12][N] raises a ProcessingError for a reference to a variable of the wrong type or out of reach", () => {
    expectProcessingError(
      () => run(`<qti-index n="T"><qti-ordered>${bv("integer", 5)}</qti-ordered></qti-index>`),
      "The attribute n names T, which is a single float, not a single integer.",
    );
    expectProcessingError(
      () => run(`<qti-index n="RESPONSE"><qti-ordered>${bv("integer", 5)}</qti-ordered></qti-index>`),
      "The attribute n names RESPONSE, which is no template or outcome variable in reach.",
    );
    expectProcessingError(
      () => op("pattern-match", [bv("string", "1")], ' pattern="{N}"'),
      "names N, which is a single integer, not a single string",
    );
  });
});

describe("response processing", () => {
  const Choice = `
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>B</qti-value></qti-correct-response></qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>`;
  const scored = (processing: string, response: Value | null, context: ProcessingContext = CONTEXT) => {
    const item = itemOf(`${Choice}${processing}`);
    const variables = createItemVariables(item);
    const responses = new Map(variables.responses).set("RESPONSE", response);
    return runResponseProcessing(item, { ...variables, responses }, context).outcomes.get("SCORE");
  };

  it("[B45][A55] runs a standard template that the item names: SCORE 1 for the correct response, else 0 (INFO §2.5.1)", () => {
    const template = `<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>`;
    expect(scored(template, id("B"))).toEqual(float(1));
    expect(scored(template, id("A"))).toEqual(float(0));
    expect(scored(template, null)).toEqual(float(0));
  });

  it("[B45][G43] reads every spelling of a template URI, and QTI 2.x URIs as the same algorithm", () => {
    for (const uri of [
      "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct",
      "http://www.imsglobal.org/question/qti_v3p0/rptemplates/match_correct.xml",
      "https://www.imsglobal.org/question/qti_v3p0/rptemplates/match_correct",
      "http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct",
      "http://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct.xml",
    ]) {
      expect(standardTemplateUri(uri), uri).toBe(
        "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml",
      );
      expect(scored(`<qti-response-processing template="${uri}"/>`, id("B")), uri).toEqual(float(1));
    }
    expect(standardTemplateUri("http://www.imsglobal.org/question/qti_v2p1/rptemplates/CC2_match")).toBeUndefined();
    expect(standardTemplateUri("https://example.com/rptemplates/match_correct.xml")).toBeUndefined();
  });

  it("[B45] prefers the item's own rules to its template, and treats an empty template as none", () => {
    const own = `<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml">
      <qti-set-outcome-value identifier="SCORE">${bv("float", 5)}</qti-set-outcome-value></qti-response-processing>`;
    expect(scored(own, id("A"))).toEqual(float(5));
    expect(scored(`<qti-response-processing template=""/>`, id("B"))).toEqual(float(0));
    expect(scored("", id("B"))).toEqual(float(0));
  });

  it("[B45] resolves other templates through the resolver, by template-location when the item gives one", () => {
    const uris: string[] = [];
    const resolveTemplate = (uri: string) => {
      uris.push(uri);
      const document = readAsi(
        `<qti-response-processing ${NS}><qti-set-outcome-value identifier="SCORE">${bv("float", 2)}</qti-set-outcome-value></qti-response-processing>`,
      );
      return document.kind === "response-processing" ? document.processing : undefined;
    };
    const context = { random: random(), resolveTemplate };
    expect(
      scored(`<qti-response-processing template="urn:mine" template-location="rp/mine.xml"/>`, id("A"), context),
    ).toEqual(float(2));
    expect(scored(`<qti-response-processing template="urn:mine"/>`, id("A"), context)).toEqual(float(2));
    expect(uris).toEqual(["rp/mine.xml", "urn:mine"]);
    expect(() =>
      scored(`<qti-response-processing template="urn:mine"/>`, id("A"), {
        random: random(),
        resolveTemplate: () => json("{}"),
      }),
    ).toThrow("The option resolveTemplate must return the model of qti-response-processing, found an object.");
  });

  it("[B45][G17][N] raises a ProcessingError for a template that is neither standard nor resolved", () => {
    expectProcessingError(
      () => scored(`<qti-response-processing template="urn:unknown"/>`, id("A")),
      'The response processing template "urn:unknown" is not a standard template and the option resolveTemplate does not resolve it.',
    );
  });

  it("[B46][A41][A56] ends processing at qti-exit-response, inside a fragment too (INFO §6.39.5)", () => {
    const processing = `<qti-response-processing>
      <qti-set-outcome-value identifier="SCORE">${bv("float", 1)}</qti-set-outcome-value>
      <qti-response-processing-fragment><qti-exit-response/></qti-response-processing-fragment>
      <qti-set-outcome-value identifier="SCORE">${bv("float", 2)}</qti-set-outcome-value></qti-response-processing>`;
    expect(scored(processing, id("A"))).toEqual(float(1));
  });

  it("[A59][T20] sets completionStatus, one of its four values (INFO §2.2.2.3)", () => {
    const status = (value: string) =>
      processed(
        Choice,
        `<qti-set-outcome-value identifier="completionStatus">${bv("identifier", value)}</qti-set-outcome-value>`,
      ).outcomes.get("completionStatus");
    expect(status("completed")).toEqual(id("completed"));
    expectProcessingError(
      () => status("done"),
      'The outcome completionStatus cannot be "done"; it is one of completed, incomplete, not_attempted, unknown.',
    );
  });

  it("[N] raises a ProcessingError for an include left in the rules", () => {
    const item = itemOf(
      `${Choice}<qti-response-processing><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="rules.xml"/></qti-response-processing>`,
    );
    expectProcessingError(
      () => runResponseProcessing(item, createItemVariables(item), CONTEXT),
      "The processing has an unresolved xi:include; resolve includes before processing.",
    );
  });

  it("leaves the variables given unchanged, and refuses arguments of other types", () => {
    const item = itemOf(
      `${Choice}<qti-response-processing><qti-set-outcome-value identifier="SCORE">${bv("float", 1)}</qti-set-outcome-value></qti-response-processing>`,
    );
    const variables = createItemVariables(item);
    runResponseProcessing(item, variables, CONTEXT);
    expect(variables.outcomes.get("SCORE")).toEqual(float(0));
    expect(() => runResponseProcessing(json("null"), variables, CONTEXT)).toThrow(
      "The item must be an object of the model of qti-assessment-item, found null.",
    );
    expect(() => runResponseProcessing(item, json("null"), CONTEXT)).toThrow(
      "The item variables must be an object, found null.",
    );
    expect(() => runResponseProcessing(item, variables, json("null"))).toThrow(
      "The processing context must be an object, found null.",
    );
  });
});

describe("rounding", () => {
  const roundTo = (value: number, mode: string, figures: number) =>
    run(
      `<qti-round-to rounding-mode="${mode}" figures="${figures}">${bv("float", String(value).replace("Infinity", "INF"))}</qti-round-to>`,
    );

  it("[B73][A115] rounds by the deciding digit as Python's decimal module does (validation/rounding.py)", () => {
    for (const { value, mode, figures, expected } of rounding.roundTo) {
      const nearest = Number(expected);
      expect(roundTo(value, mode, figures), `${value} ${mode} ${figures}`).toEqual(
        Number.isFinite(nearest) ? float(nearest) : null,
      );
    }
  });

  it("[B73][A80] compares rounded numbers as Python's decimal module does (validation/rounding.py)", () => {
    for (const { a, b, mode, figures, expected } of rounding.equalRounded) {
      const rounded = op(
        "equal-rounded",
        [bv("float", a), bv("float", b)],
        ` rounding-mode="${mode}" figures="${figures}"`,
      );
      expect(primitive(rounded), `${a} ${b} ${mode} ${figures}`).toBe(expected);
    }
  });

  it("[B73] rounds 2.675 to 2.68 by its decimal digits, not by the binary double below it (INFO §2.11.3.43)", () => {
    expect(roundTo(2.675, "decimalPlaces", 2)).toEqual(float(2.68));
    expect(roundTo(9.995, "decimalPlaces", 2)).toEqual(float(10));
    expect(roundTo(-0.04, "decimalPlaces", 1)).toEqual(float(-0));
    expect(roundTo(1234.5, "significantFigures", 2)).toEqual(float(1200));
  });

  it("[B73] keeps ±INF, gives NULL for NaN, NULL, figures out of range and a result beyond float", () => {
    expect(roundTo(Number.POSITIVE_INFINITY, "decimalPlaces", 2)).toEqual(float(Number.POSITIVE_INFINITY));
    expect(
      run(`<qti-round-to rounding-mode="decimalPlaces" figures="2">${bv("float", "NaN")}</qti-round-to>`),
    ).toBeNull();
    expect(run(`<qti-round-to rounding-mode="decimalPlaces" figures="2">${NULL}</qti-round-to>`)).toBeNull();
    expect(roundTo(1.5, "significantFigures", 0)).toBeNull();
    expect(roundTo(1.5, "decimalPlaces", -1)).toBeNull();
    expect(roundTo(1.7976931348623157e308, "significantFigures", 2)).toBeNull();
  });
});

describe("shapes", () => {
  const inside = (shape: string, coords: string, point: string) =>
    primitive(run(`<qti-inside shape="${shape}" coords="${coords}">${bv("point", point)}</qti-inside>`));

  it("[B78][A86][W29] tests a point against every shape, the edge included (INFO §5.75.2, §8.29)", () => {
    expect([inside("rect", "10,10,20,30", "10 30"), inside("rect", "10,10,20,30", "21 15")]).toEqual([true, false]);
    expect([inside("circle", "10,10,5", "13 14"), inside("circle", "10,10,5", "14 14")]).toEqual([true, false]);
    expect([inside("ellipse", "10,10,6,2", "16 10"), inside("ellipse", "10,10,6,2", "10 13")]).toEqual([true, false]);
    expect([
      inside("poly", "0,0,10,0,0,10", "2 2"),
      inside("poly", "0,0,10,0,0,10", "5 5"),
      inside("poly", "0,0,10,0,0,10", "6 6"),
    ]).toEqual([true, true, false]);
    expect(inside("poly", "0,0,10,0,10,10,0,10,0,0", "10 5")).toBe(true);
    expect(inside("default", "", "999 999")).toBe(true);
  });

  it("[B78] is true when any point of a container lies inside, and NULL for NULL (INFO §2.11.3.7)", () => {
    const points = `<qti-multiple>${bv("point", "0 0")}${bv("point", "12 12")}</qti-multiple>`;
    expect(runPrimitive(`<qti-inside shape="circle" coords="10,10,5">${points}</qti-inside>`)).toBe(true);
    expect(run(`<qti-inside shape="circle" coords="10,10,5">${NULL}</qti-inside>`)).toBeNull();
  });

  it("[B78][N] refuses percentages, which need the size of the image, and coordinates that do not fit the shape", () => {
    expectProcessingError(
      () => inside("circle", "50%,50%,10", "1 1"),
      'The coordinate "50%" of a circle is a percentage of the image, whose size processing does not know.',
    );
    expectProcessingError(() => inside("rect", "1,2,3", "1 1"), 'A rect cannot have the 3 coordinates "1,2,3".');
    expectProcessingError(() => inside("poly", "0,0,1,1", "1 1"), "A poly cannot have the 4 coordinates");
    expect(() => expressionOf(`<qti-inside shape="square" coords="1,1,1">${bv("point", "1 1")}</qti-inside>`)).toThrow(
      ReadError,
    );
  });
});

describe("OPERATOR_SIGNATURES", () => {
  it("[A67][A130] has a signature for each of the 64 expressions, citing its section", () => {
    expect(OPERATOR_SIGNATURES.size).toBe(64);
    for (const [kind, signature] of OPERATOR_SIGNATURES) {
      expect(signature.source, kind).toMatch(/^INFO §\d/);
      expect(signature.minOperands, kind).toBeLessThanOrEqual(signature.maxOperands);
    }
  });

  it("[B83][B84] states the operand and result types of INFO §2.11", () => {
    expect(OPERATOR_SIGNATURES.get("sum")).toEqual({
      minOperands: 1,
      maxOperands: Number.POSITIVE_INFINITY,
      operands: [{ cardinalities: ["single", "multiple", "ordered"], baseTypes: ["integer", "float"] }],
      sameBaseType: false,
      sameCardinality: false,
      result: { cardinality: "single", baseType: "numeric" },
      source: "INFO §2.11.3.40",
    });
    expect(OPERATOR_SIGNATURES.get("member")?.operands.map(({ cardinalities }) => cardinalities)).toEqual([
      ["single"],
      ["multiple", "ordered"],
    ]);
    expect(OPERATOR_SIGNATURES.get("match")?.operands[0]?.baseTypes).not.toContain("duration");
    expect(OPERATOR_SIGNATURES.get("contains")).toMatchObject({ sameBaseType: true, sameCardinality: true });
    expect(OPERATOR_SIGNATURES.get("variable")?.result).toEqual({ cardinality: "declared", baseType: "declared" });
    expect(OPERATOR_SIGNATURES.get("math-operator")?.result).toEqual({ cardinality: "single", baseType: "name" });
  });
});

describe("standard templates", () => {
  it("[B45][A55] holds the six templates of INFO §2.5.1 by their purl URIs", () => {
    expect(
      [...STANDARD_TEMPLATES.keys()].map((uri) =>
        uri.replace("https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/", ""),
      ),
    ).toEqual([
      "match_correct.xml",
      "map_response.xml",
      "map_response_point.xml",
      "CC2_match.xml",
      "CC2_match_basic.xml",
      "CC2_map_response.xml",
    ]);
  });

  it("[B45] maps a NULL response to 0 with map_response and map_response_point (INFO §2.5.1)", () => {
    for (const [name, mapping] of [
      ["map_response", `<qti-mapping><qti-map-entry map-key="A" mapped-value="2"/></qti-mapping>`],
      [
        "map_response_point",
        `<qti-area-mapping><qti-area-map-entry shape="default" coords="" mapped-value="2"/></qti-area-mapping>`,
      ],
    ]) {
      const baseType = name === "map_response" ? "identifier" : "point";
      const outcomes = processed(
        `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="${baseType}">${mapping}</qti-response-declaration>
         <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>9</qti-value></qti-default-value></qti-outcome-declaration>`,
        "",
      );
      expect(outcomes.outcomes.get("SCORE"), name).toEqual(float(9));
      const template = STANDARD_TEMPLATES.get(`https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/${name}.xml`);
      const item = itemOf(
        `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="${baseType}">${mapping}</qti-response-declaration>
         <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>`,
      );
      const scoredItem = { ...item, responseProcessing: template };
      expect(
        runResponseProcessing(scoredItem, createItemVariables(scoredItem), CONTEXT).outcomes.get("SCORE"),
        name,
      ).toEqual(float(0));
    }
  });
});

describe("stats operator", () => {
  const stats = (name: string, ...values: (number | string)[]) =>
    primitive(
      op(
        "stats-operator",
        [`<qti-ordered>${values.map((value) => bv("float", value)).join("")}</qti-ordered>`],
        ` name="${name}"`,
      ),
    );

  it("[B81][A116][W31] computes the mean and the sample and population variance and standard deviation (INFO §8.31)", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(stats("mean", ...values)).toBe(5);
    expect(stats("popVariance", ...values)).toBe(4);
    expect(stats("popSD", ...values)).toBe(2);
    expect(stats("sampleVariance", ...values)).toBeCloseTo(32 / 7, 15);
    expect(stats("sampleSD", ...values)).toBeCloseTo(Math.sqrt(32 / 7), 15);
    expect(stats("mean", 3)).toBe(3);
  });

  it("[B81][G13] gives NULL for a variance or standard deviation of one value, for NaN and for NULL", () => {
    for (const name of ["popVariance", "popSD", "sampleVariance", "sampleSD"]) expect(stats(name, 3), name).toBeNull();
    expect(stats("mean", 1, "NaN")).toBeNull();
    expect(op("stats-operator", [NULL], ' name="mean"')).toBeNull();
    expect(() => expressionOf(`<qti-stats-operator name="median">${NULL}</qti-stats-operator>`)).toThrow(ReadError);
  });
});

describe("strings", () => {
  const s = (text: string) => bv("string", text);

  it("[B80][A117] matches strings, case-insensitively unless case-sensitive, with the deprecated substring flag (INFO §5.138)", () => {
    expect(opPrimitive("string-match", [s("Paris"), s("paris")], ' case-sensitive="false"')).toBe(true);
    expect(opPrimitive("string-match", [s("Paris"), s("paris")], ' case-sensitive="true"')).toBe(false);
    expect(
      opPrimitive("string-match", [s("Paris, France"), s("france")], ' case-sensitive="false" substring="true"'),
    ).toBe(true);
    expect(op("string-match", [s("a"), NULL], ' case-sensitive="true"')).toBeNull();
  });

  it("[B80][A118] finds a substring: INFO §5.139.1's example", () => {
    expect(opPrimitive("substring", [s("Hell"), s("Shell")], ' case-sensitive="true"')).toBe(false);
    expect(opPrimitive("substring", [s("Hell"), s("Shell")], ' case-sensitive="false"')).toBe(true);
    expect(op("substring", [NULL, s("Shell")], ' case-sensitive="false"')).toBeNull();
  });

  it("[B80][G6] folds case by Unicode default case conversion, independent of locale", () => {
    expect(opPrimitive("string-match", [s("İSTANBUL"), s("i̇stanbul")], ' case-sensitive="false"')).toBe(true);
    expect(opPrimitive("string-match", [s("ΣΊΣΥΦΟΣ"), s("σίσυφος")], ' case-sensitive="false"')).toBe(true);
  });

  it("[B79][A107] matches the whole string with a regular expression of XML Schema (INFO §5.104.1)", () => {
    expect(opPrimitive("pattern-match", [s("abc")], ' pattern="[a-c]+"')).toBe(true);
    expect(opPrimitive("pattern-match", [s("abcd")], ' pattern="[a-c]+"')).toBe(false);
    expect(opPrimitive("pattern-match", [s("x^y$")], ' pattern="x^y$"')).toBe(true);
    expect(opPrimitive("pattern-match", [s("é")], ' pattern="\\p{L}"')).toBe(true);
    expect(op("pattern-match", [NULL], ' pattern="a"')).toBeNull();
    expectProcessingError(
      () => op("pattern-match", [s("a")], ' pattern="(a"'),
      "The operator qti-pattern-match cannot use its pattern:",
    );
  });
});

describe("template processing", () => {
  const Template = `
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-outcome-declaration identifier="LABEL" cardinality="single" base-type="identifier"/>
    <qti-template-declaration identifier="A" cardinality="single" base-type="integer"><qti-default-value><qti-value>-1</qti-value></qti-default-value></qti-template-declaration>
    <qti-template-declaration identifier="B" cardinality="single" base-type="integer"/>`;
  const instance = (
    rules: string,
    context: ProcessingContext = { random: random() },
    variables?: (item: AssessmentItem) => ItemVariables,
  ) => {
    const item = itemOf(`${Template}<qti-template-processing>${rules}</qti-template-processing>`);
    return runTemplateProcessing(item, variables?.(item) ?? createItemVariables(item), context);
  };
  /** A source that counts its draws and returns them in turn. */
  const counting = (...draws: number[]) => {
    let count = 0;
    return { draws: () => count, random: { uniform: () => draws[count++ % draws.length] ?? 0 } };
  };

  it("[B11][A60][A57][A58][A66] sets template variables, correct responses and default values; an outcome takes its new default", () => {
    const variables = instance(`
      <qti-set-template-value identifier="A"><qti-random-integer min="1" max="9"/></qti-set-template-value>
      <qti-set-template-value identifier="B"><qti-product>${v("A")}${bv("integer", 2)}</qti-product></qti-set-template-value>
      <qti-set-correct-response identifier="RESPONSE">${v("B")}</qti-set-correct-response>
      <qti-set-default-value identifier="SCORE">${bv("integer", 1)}</qti-set-default-value>`);
    const a = Number(primitive(variables.templates.get("A") ?? null));
    expect(a).toBeGreaterThanOrEqual(1);
    expect(variables.templates.get("B")).toEqual(int(2 * a));
    expect(variables.correctResponses.get("RESPONSE")).toEqual(int(2 * a));
    expect(variables.defaults.get("SCORE")).toEqual(float(1));
    expect(variables.outcomes.get("SCORE")).toEqual(float(1));
  });

  it("[B11][A62] restarts from the defaults until a constraint holds (INFO §5.150)", () => {
    const source = counting(0.1, 0.2, 0.9);
    const variables = instance(
      `<qti-set-template-value identifier="A"><qti-random-integer min="1" max="9"/></qti-set-template-value>
       <qti-template-constraint><qti-gt>${v("A")}${bv("integer", 5)}</qti-gt></qti-template-constraint>
       <qti-set-template-value identifier="B">${v("A")}</qti-set-template-value>`,
      source,
    );
    expect(source.draws()).toBe(3);
    expect(variables.templates.get("A")).toEqual(int(9));
    expect(variables.templates.get("B")).toEqual(int(9));
  });

  it("[B11][A62] keeps the default values after 100 runs, then goes on after the constraint (INFO §5.150)", () => {
    const source = counting(0.5);
    const variables = instance(
      `<qti-set-template-value identifier="A"><qti-random-integer max="9"/></qti-set-template-value>
       <qti-set-correct-response identifier="RESPONSE">${v("A")}</qti-set-correct-response>
       <qti-template-constraint>${NULL}</qti-template-constraint>
       <qti-set-template-value identifier="B">${bv("integer", 7)}</qti-set-template-value>`,
      source,
    );
    expect(source.draws()).toBe(100);
    expect(variables.templates.get("A")).toEqual(int(-1));
    expect(variables.correctResponses.get("RESPONSE")).toBeNull();
    expect(variables.templates.get("B")).toEqual(int(7));
  });

  it("[B11][B94] shares the 100 runs among all constraints, in a condition or not, so that none can make processing loop", () => {
    const source = counting(0.5);
    const variables = instance(
      `<qti-set-template-value identifier="A"><qti-random-integer max="9"/></qti-set-template-value>
       <qti-template-constraint>${bv("boolean", "false")}</qti-template-constraint>
       <qti-template-condition>
         <qti-template-if>${bv("boolean", "true")}
           <qti-template-constraint>${bv("boolean", "false")}</qti-template-constraint>
           <qti-template-constraint>${bv("boolean", "false")}</qti-template-constraint>
         </qti-template-if>
       </qti-template-condition>
       <qti-set-template-value identifier="B">${bv("integer", 7)}</qti-set-template-value>`,
      source,
    );
    expect(source.draws()).toBe(100);
    expect(variables.templates.get("A")).toEqual(int(-1));
    expect(variables.templates.get("B")).toEqual(int(7));
  });

  it("[B11][B41] starts template variables from the defaults given, as a test's template defaults set them (INFO §5.152)", () => {
    const variables = instance(
      `<qti-set-template-value identifier="B">${v("A")}</qti-set-template-value>`,
      CONTEXT,
      (item) => {
        const created = createItemVariables(item);
        return { ...created, defaults: new Map(created.defaults).set("A", int(42)) };
      },
    );
    expect(variables.templates.get("B")).toEqual(int(42));
    expect(variables.templates.get("A")).toEqual(int(42));
  });

  it("[B46][A42][A61][A63][A64][A65] runs the first true branch, and ends at qti-exit-template (INFO §6.50.2)", () => {
    const variables = instance(`
      <qti-template-condition>
        <qti-template-if>${bv("boolean", "false")}<qti-set-template-value identifier="B">${bv("integer", 1)}</qti-set-template-value></qti-template-if>
        <qti-template-else-if>${NULL}<qti-set-template-value identifier="B">${bv("integer", 2)}</qti-set-template-value></qti-template-else-if>
        <qti-template-else><qti-set-template-value identifier="B">${bv("integer", 3)}</qti-set-template-value><qti-exit-template/></qti-template-else>
      </qti-template-condition>
      <qti-set-template-value identifier="A">${bv("integer", 4)}</qti-set-template-value>`);
    expect(variables.templates.get("B")).toEqual(int(3));
    expect(variables.templates.get("A")).toEqual(int(-1));
  });

  it("[B11] reproduces the same instance from the same seed", () => {
    const rules = `<qti-set-template-value identifier="A"><qti-random-integer min="1" max="1000"/></qti-set-template-value>`;
    const draw = (seed: number) => instance(rules, { random: createRandom(seed) }).templates.get("A");
    expect(draw(11)).toEqual(draw(11));
    expect(new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(draw(seed)))).size).toBeGreaterThan(1);
  });

  it("[T21] reads QTI_CONTEXT and its fields, NULL when it is not given (INFO §2.2.2.1)", () => {
    const rules = `<qti-set-template-value identifier="LABEL"><qti-field-value field-identifier="testIdentifier">${v("QTI_CONTEXT")}</qti-field-value></qti-set-template-value>`;
    const item = itemOf(
      `<qti-template-declaration identifier="LABEL" cardinality="single" base-type="string"/><qti-template-processing>${rules}</qti-template-processing>`,
    );
    const context = new Map([["QTI_CONTEXT", record([["testIdentifier", str("test-1")]])]]);
    expect(runTemplateProcessing(item, createItemVariables(item, { context }), CONTEXT).templates.get("LABEL")).toEqual(
      str("test-1"),
    );
    expect(runTemplateProcessing(item, createItemVariables(item), CONTEXT).templates.get("LABEL")).toBeNull();
  });

  it("returns the variables when there is no template processing, and refuses arguments of other types", () => {
    const item = itemOf(Template);
    const variables = createItemVariables(item);
    expect(runTemplateProcessing(item, variables, CONTEXT)).toEqual(variables);
    expect(() => runTemplateProcessing(item, variables, json('{"random":1}'))).toThrow(
      "The option random must be an object with a function uniform, found 1.",
    );
  });
});

describe("createItemVariables", () => {
  const item = itemOf(`
    <qti-context-declaration identifier="TERM" cardinality="single" base-type="identifier"><qti-default-value><qti-value>spring</qti-value></qti-default-value></qti-context-declaration>
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
      <qti-default-value><qti-value>A</qti-value></qti-default-value><qti-correct-response><qti-value>B</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-outcome-declaration identifier="COUNT" cardinality="single" base-type="integer"/>
    <qti-outcome-declaration identifier="SET" cardinality="multiple" base-type="integer"/>
    <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"><qti-default-value><qti-value>none</qti-value></qti-default-value></qti-outcome-declaration>
    <qti-template-declaration identifier="X" cardinality="single" base-type="float"/>`);

  it("[B7][T18][T19][T20][T21] creates the variables of a new session: NULL responses, outcomes from their defaults or 0, the built-ins", () => {
    const variables = createItemVariables(item);
    expect(variables.responses).toEqual(
      new Map<string, Value | null>([
        ["numAttempts", int(0)],
        ["duration", duration(0)],
        ["RESPONSE", null],
      ]),
    );
    expect(variables.outcomes).toEqual(
      new Map<string, Value | null>([
        ["completionStatus", id("not_attempted")],
        ["SCORE", float(0)],
        ["COUNT", int(0)],
        ["SET", null],
        ["FEEDBACK", id("none")],
      ]),
    );
    expect(variables.contexts).toEqual(
      new Map<string, Value | null>([
        ["QTI_CONTEXT", null],
        ["TERM", id("spring")],
      ]),
    );
    expect(variables.templates).toEqual(new Map([["X", null]]));
    expect(variables.correctResponses).toEqual(new Map([["RESPONSE", id("B")]]));
    expect(variables.defaults).toEqual(
      new Map<string, Value | null>([
        ["TERM", id("spring")],
        ["RESPONSE", id("A")],
        ["SCORE", null],
        ["COUNT", null],
        ["SET", null],
        ["FEEDBACK", id("none")],
        ["X", null],
      ]),
    );
  });

  it("[B50][T21] takes the values of context variables from the option context", () => {
    const context = new Map<string, Value | null>([
      ["TERM", id("autumn")],
      [
        "QTI_CONTEXT",
        record([
          ["candidateIdentifier", str("c-7")],
          ["seat", int(4)],
        ]),
      ],
    ]);
    const { contexts } = createItemVariables(item, { context });
    expect(contexts.get("TERM")).toEqual(id("autumn"));
    expect(contexts.get("QTI_CONTEXT")).toEqual(
      record([
        ["candidateIdentifier", str("c-7")],
        ["seat", int(4)],
      ]),
    );
    expect(createItemVariables(item, { context: new Map([["TERM", null]]) }).contexts.get("TERM")).toBeNull();
  });

  it("refuses options of other types, undeclared context variables and values that do not fit", () => {
    expect(() => createItemVariables(item, json("null"))).toThrow("The options must be an object, found null.");
    expect(() => createItemVariables(item, { context: json("{}") })).toThrow(
      "The option context must be a Map from identifier to value, found an object.",
    );
    expect(() => createItemVariables(item, { context: new Map([["OTHER", null]]) })).toThrow(
      'The option context gives "OTHER", which the item declares no context variable for.',
    );
    expect(() => createItemVariables(item, { context: new Map([["TERM", str("x")]]) })).toThrow(
      "The context variable TERM is a single identifier, found a single string.",
    );
    expect(() =>
      createItemVariables(item, { context: new Map([["QTI_CONTEXT", record([["testIdentifier", int(1)]])]]) }),
    ).toThrow("The field testIdentifier of QTI_CONTEXT must be a single string, found a single integer.");
    expect(() => createItemVariables(item, { context: new Map([["TERM", json('{"cardinality":"single"}')]]) })).toThrow(
      DataError,
    );
    expect(() => createItemVariables(json("[]"))).toThrow(
      "The item must be an object of the model of qti-assessment-item, found an array.",
    );
  });
});

describe("properties", () => {
  const Variables = createItemVariables(ITEM);
  const evaluated = (expression: Expression, context: ProcessingContext = CONTEXT) =>
    evaluate(expression, Variables, ITEM, context);
  const numberText = (x: number): string => {
    if (Object.is(x, -0)) return "-0";
    return Number.isNaN(x) ? "NaN" : Number.isFinite(x) ? String(x) : x > 0 ? "INF" : "-INF";
  };
  const constant = (baseType: BaseType, value: string | number): Extract<Expression, { kind: "base-value" }> => ({
    kind: "base-value",
    baseType,
    value: typeof value === "number" ? numberText(value) : value,
  });
  const nul: Extract<Expression, { kind: "null" }> = { kind: "null" };
  const truth = (value: boolean | null): Expression => (value === null ? nul : constant("boolean", String(value)));
  const safeInteger = fc.integer({ min: -(2 ** 40), max: 2 ** 40 });
  const nonZero = safeInteger.filter((y) => y !== 0);
  const truths = fc.array(fc.constantFrom<boolean | null>(true, false, null), { minLength: 1, maxLength: 6 });

  it("[B84][B94][N] evaluate returns a value that normalizeValue accepts unchanged, or refuses with a ProcessingError or a SecurityError", () => {
    fc.assert(
      fc.property(expressions, fc.integer({ min: 1, max: 30 }), (xml, maxContainerSize) => {
        let value: Value | null = null;
        try {
          value = run(xml, { random: createRandom(1), limits: { maxContainerSize } });
        } catch (error) {
          expect(
            error instanceof ReadError || error instanceof ProcessingError || error instanceof SecurityError,
            String(error),
          ).toBe(true);
          return;
        }
        if (value !== null) expect(normalizeValue(value)).toEqual(value);
      }),
      FUZZ,
    );
  });

  it("[B83][T16] and, or and not follow Kleene's three-valued logic", () => {
    fc.assert(
      fc.property(truths, (values) => {
        const and = values.includes(false) ? false : values.includes(null) ? null : true;
        const or = values.includes(true) ? true : values.includes(null) ? null : false;
        expect(primitive(evaluated({ kind: "and", operands: values.map(truth) }))).toBe(and);
        expect(primitive(evaluated({ kind: "or", operands: values.map(truth) }))).toBe(or);
        const [first = null] = values;
        expect(primitive(evaluated({ kind: "not", operand: truth(first) }))).toBe(first === null ? null : !first);
      }),
    );
  });

  it("[B83] any-n agrees with a brute-force count over every completion of the NULL operands (INFO §2.11.3.1)", () => {
    fc.assert(
      fc.property(truths, fc.nat(6), fc.nat(6), (values, min, max) => {
        const unknown = values.filter((value) => value === null).length;
        const trues = values.filter((value) => value === true).length;
        const outcomes = new Set(
          Array.from({ length: 2 ** unknown }, (_, mask) => {
            let count = trues;
            for (let bit = 0; bit < unknown; bit++) count += (mask >> bit) & 1;
            return count >= min && count <= max;
          }),
        );
        const expected = outcomes.size === 1 ? [...outcomes][0] : null;
        expect(primitive(evaluated({ kind: "any-n", min, max, operands: values.map(truth) }))).toBe(expected);
      }),
    );
  });

  it("[B82] integer-divide and integer-modulus satisfy x = z·y + r with z = floor(x / y), exactly", () => {
    fc.assert(
      fc.property(safeInteger, nonZero, (x, y) => {
        const z = Number(
          primitive(evaluated({ kind: "integer-divide", operands: [constant("integer", x), constant("integer", y)] })),
        );
        const r = Number(
          primitive(evaluated({ kind: "integer-modulus", operands: [constant("integer", x), constant("integer", y)] })),
        );
        expect(BigInt(z) * BigInt(y) + BigInt(r)).toBe(BigInt(x));
        expect(z).toBe(Math.floor(x / y) + 0);
        expect(r === 0 || Math.sign(r) === Math.sign(y)).toBe(true);
      }),
    );
  });

  it("[B82] gcd divides every operand and gcd · lcm = |a · b|", () => {
    const small = fc.integer({ min: -(2 ** 20), max: 2 ** 20 });
    fc.assert(
      fc.property(small, small, (a, b) => {
        const operands = [constant("integer", a), constant("integer", b)];
        const gcd = Number(primitive(evaluated({ kind: "gcd", operands })));
        const lcm = Number(primitive(evaluated({ kind: "lcm", operands })));
        if (gcd !== 0) expect([a % gcd, b % gcd].map(Math.abs)).toEqual([0, 0]);
        expect(BigInt(gcd) * BigInt(lcm)).toBe(BigInt(Math.abs(a)) * BigInt(Math.abs(b)));
      }),
    );
  });

  it("[B82][T17] gives an integer exactly when every operand is an integer, and NULL outside the safe integers (D3)", () => {
    const operand = fc.oneof(
      safeInteger.map((x) => ({ value: x, baseType: "integer" as const })),
      fc.double({ noNaN: true, min: -1e6, max: 1e6 }).map((x) => ({ value: x, baseType: "float" as const })),
    );
    fc.assert(
      fc.property(
        fc.array(operand, { minLength: 1, maxLength: 4 }),
        fc.constantFrom("sum", "product", "min", "max"),
        (operands, kind) => {
          const result = evaluated({
            kind,
            operands: operands.map(({ value, baseType }) => constant(baseType, value)),
          });
          const integers = operands.every(({ baseType }) => baseType === "integer");
          if (result === null) {
            expect(integers).toBe(true);
            return;
          }
          expect(result.cardinality === "single" && result.baseType).toBe(integers ? "integer" : "float");
          if (integers) expect(Number.isSafeInteger(primitive(result))).toBe(true);
        },
      ),
    );
  });

  it("[B72] round gives n exactly when n − 0.5 ≤ x < n + 0.5, and truncate rounds toward zero", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e12, max: 1e12 }), (x) => {
        const n = Number(primitive(evaluated({ kind: "round", operand: constant("float", x) })));
        expect(n - 0.5 <= x && x < n + 0.5).toBe(true);
        const t = Number(primitive(evaluated({ kind: "truncate", operand: constant("float", x) })));
        expect(
          Math.abs(t) <= Math.abs(x) && Math.abs(x) < Math.abs(t) + 1 && (t === 0 || Math.sign(t) === Math.sign(x)),
        ).toBe(true);
      }),
    );
  });

  /** Rounds a number half away from zero with BigInt arithmetic on its shortest decimal: the oracle of round-to. */
  function exactRound(x: number, mode: "decimalPlaces" | "significantFigures", figures: number): number {
    const [mantissa = "", exponent = "0"] = String(Math.abs(x)).split("e");
    const [whole = "", fraction = ""] = mantissa.split(".");
    const digits = BigInt(whole + fraction);
    const scale = Number(exponent) - fraction.length;
    if (digits === 0n) return x;
    const length = (whole + fraction).replace(/^0+/, "").length;
    const keepScale = mode === "decimalPlaces" ? -figures : scale + length - figures;
    if (keepScale <= scale) return x;
    const divisor = 10n ** BigInt(keepScale - scale);
    const kept = (digits * 2n + divisor) / (divisor * 2n);
    const sign = x < 0 ? "-" : "";
    return Number(`${sign}${kept}e${keepScale}`);
  }

  it("[B73] round-to equals an exact decimal oracle that rounds the shortest decimal half away from zero", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e15, max: 1e15 }),
        fc.constantFrom<"decimalPlaces" | "significantFigures">("decimalPlaces", "significantFigures"),
        fc.integer({ min: 1, max: 12 }),
        (x, mode, figures) => {
          const result = evaluated({ kind: "round-to", roundingMode: mode, figures, operand: constant("float", x) });
          expect(primitive(result)).toBe(exactRound(x, mode, figures));
        },
      ),
    );
  });

  it("[B75] equal is monotone in its tolerances and is exact at zero tolerance", () => {
    const value = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 });
    const amount = fc.double({ noNaN: true, min: 0, max: 100 });
    fc.assert(
      fc.property(
        value,
        value,
        amount,
        amount,
        fc.constantFrom<"absolute" | "relative">("absolute", "relative"),
        (x, y, t0, t1, mode) => {
          const equal = (tolerance: readonly number[]) =>
            primitive(
              evaluated({
                kind: "equal",
                toleranceMode: mode,
                tolerance,
                operands: [constant("float", x), constant("float", y)],
              }),
            );
          if (equal([t0, t1])) expect(equal([t0 * 2, t1 * 2])).toBe(true);
          expect(equal([0, 0])).toBe(x === y || (mode === "relative" && x === 0 && y === 0));
        },
      ),
    );
  });

  const identifiers = fc.array(fc.constantFrom("A", "B", "C", "D"), { minLength: 1, maxLength: 8 });
  const containerOf = (cardinality: "multiple" | "ordered", values: readonly string[]): Expression => ({
    kind: cardinality,
    operands: values.map((value) => constant("identifier", value)),
  });

  it("[B84] delete removes every occurrence, member agrees with contains, and container-size counts the values", () => {
    fc.assert(
      fc.property(identifiers, fc.constantFrom("A", "B", "C", "D"), (values, sought) => {
        const deleted = evaluated({
          kind: "delete",
          operands: [constant("identifier", sought), containerOf("multiple", values)],
        });
        const left = values.filter((value) => value !== sought);
        expect(deleted).toEqual(left.length === 0 ? null : list("multiple", "identifier", left));
        const member = primitive(
          evaluated({ kind: "member", operands: [constant("identifier", sought), containerOf("multiple", values)] }),
        );
        const contains = primitive(
          evaluated({
            kind: "contains",
            operands: [containerOf("multiple", values), containerOf("multiple", [sought])],
          }),
        );
        expect(member).toBe(contains);
        expect(member).toBe(values.includes(sought));
        expect(primitive(evaluated({ kind: "container-size", operand: containerOf("ordered", values) }))).toBe(
          values.length,
        );
      }),
    );
  });

  it("[B84][G31] index is the nth value from 1 and NULL out of range", () => {
    fc.assert(
      fc.property(identifiers, fc.integer({ min: -3, max: 12 }), (values, n) => {
        const value = evaluated({ kind: "index", n, operand: containerOf("ordered", values) });
        const expected = values[n - 1];
        expect(value).toEqual(n >= 1 && expected !== undefined ? id(expected) : null);
      }),
    );
  });

  const MappingItem = itemOf(`
    <qti-response-declaration identifier="R" cardinality="multiple" base-type="identifier">
      <qti-mapping lower-bound="-0.5" upper-bound="2" default-value="-0.25">
        <qti-map-entry map-key="A" mapped-value="1"/><qti-map-entry map-key="B" mapped-value="0.5"/><qti-map-entry map-key="C" mapped-value="-1"/>
      </qti-mapping>
    </qti-response-declaration>
    <qti-response-declaration identifier="P" cardinality="multiple" base-type="point">
      <qti-area-mapping><qti-area-map-entry shape="rect" coords="0,0,9,9" mapped-value="1"/><qti-area-map-entry shape="circle" coords="20,20,5" mapped-value="2"/></qti-area-mapping>
    </qti-response-declaration>`);
  const mapped = (kind: "map-response" | "map-response-point", identifier: string, value: Value | null) => {
    const variables = createItemVariables(MappingItem);
    const responses = new Map(variables.responses).set(identifier, value);
    return primitive(evaluate({ kind, identifier }, { ...variables, responses }, MappingItem, CONTEXT));
  };

  it("[B76] map-response ignores order and repeated values, and stays within the bounds", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("A", "B", "C", "D", "E"), { minLength: 1, maxLength: 8 }), (values) => {
        const sum = Number(mapped("map-response", "R", list("multiple", "identifier", values)));
        const distinct = [...new Set(values)].sort();
        expect(mapped("map-response", "R", list("multiple", "identifier", [...distinct, ...distinct].reverse()))).toBe(
          sum,
        );
        expect(sum).toBeGreaterThanOrEqual(-0.5);
        expect(sum).toBeLessThanOrEqual(2);
      }),
    );
  });

  it("[B77] map-response-point counts each area once however many points fall in it", () => {
    const point = fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }));
    fc.assert(
      fc.property(fc.array(point, { minLength: 1, maxLength: 6 }), (points) => {
        const sum = Number(mapped("map-response-point", "P", list("multiple", "point", points)));
        const inRect = points.some(([x, y]) => x <= 9 && y <= 9);
        const inCircle = points.some(([x, y]) => !(x <= 9 && y <= 9) && (x - 20) ** 2 + (y - 20) ** 2 <= 25);
        expect(sum).toBe((inRect ? 1 : 0) + (inCircle ? 2 : 0));
      }),
    );
  });

  it("[B78] inside a convex polygon agrees with the signs of the cross products of its edges", () => {
    const polygon = fc
      .array(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), { minLength: 3, maxLength: 7 })
      .map((angles) => [...new Set(angles.map((angle) => Math.round(angle * 100) / 100))].sort((a, b) => a - b))
      .filter((angles) => angles.length >= 3)
      .map((angles) =>
        angles.map((angle) => [Math.round(50 + 40 * Math.cos(angle)), Math.round(50 + 40 * Math.sin(angle))] as const),
      );
    fc.assert(
      fc.property(polygon, fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (corners, x, y) => {
        const crosses = corners.map(([ax, ay], index) => {
          const [bx, by] = corners[(index + 1) % corners.length] ?? [ax, ay];
          return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        });
        const convex = corners.every((_, index) => {
          const [ax, ay] = corners[index] ?? [0, 0];
          const [bx, by] = corners[(index + 1) % corners.length] ?? [0, 0];
          const [cx, cy] = corners[(index + 2) % corners.length] ?? [0, 0];
          return (bx - ax) * (cy - by) - (by - ay) * (cx - bx) > 0;
        });
        fc.pre(convex);
        const coords = corners.flat().join(",");
        const inside = primitive(
          evaluated({ kind: "inside", shape: "poly", coords, operand: constant("point", `${x} ${y}`) }),
        );
        expect(inside).toBe(crosses.every((cross) => cross >= 0));
      }),
    );
  });

  it("[T16] gives NULL for a NULL operand of the operators whose definitions say so", () => {
    const numeric = constant("integer", 4);
    const operators: readonly Expression[] = [
      { kind: "sum", operands: [numeric, nul] },
      { kind: "subtract", operands: [nul, numeric] },
      { kind: "divide", operands: [numeric, nul] },
      { kind: "gt", operands: [nul, numeric] },
      { kind: "equal", operands: [numeric, nul] },
      { kind: "round", operand: nul },
      { kind: "match", operands: [nul, numeric] },
      { kind: "member", operands: [nul, containerOf("ordered", ["A"])] },
      { kind: "index", n: 1, operand: nul },
      { kind: "inside", shape: "default", coords: "", operand: nul },
      { kind: "math-operator", name: "sin", operands: [nul] },
      { kind: "stats-operator", name: "mean", operand: nul },
      { kind: "pattern-match", pattern: "a", operand: nul },
    ];
    for (const operator of operators) expect(evaluated(operator), operator.kind).toBeNull();
    expect(primitive(evaluated({ kind: "is-null", operand: nul }))).toBe(true);
    expect(primitive(evaluated({ kind: "container-size", operand: nul }))).toBe(0);
    expect(evaluated({ kind: "multiple", operands: [nul, constant("integer", 1)] })).toEqual(
      list("multiple", "integer", [1]),
    );
  });

  it("[A67][A130] gives every expression a result of the type its signature states", () => {
    const i = bv("integer", 3);
    const f = bv("float", 2.5);
    const t = bv("boolean", "true");
    const s = bv("string", "abc");
    const ids = `<qti-ordered>${bv("identifier", "A")}${bv("identifier", "B")}</qti-ordered>`;
    const samples: Record<Expression["kind"], string> = {
      and: `<qti-and>${t}</qti-and>`,
      "any-n": `<qti-any-n min="1" max="1">${t}</qti-any-n>`,
      "base-value": i,
      "container-size": `<qti-container-size>${ids}</qti-container-size>`,
      contains: `<qti-contains>${ids}${ids}</qti-contains>`,
      correct: `<qti-correct identifier="RESPONSE"/>`,
      "custom-operator": `<qti-custom-operator class="c"/>`,
      default: `<qti-default identifier="N"/>`,
      delete: `<qti-delete>${bv("identifier", "A")}${ids}</qti-delete>`,
      divide: `<qti-divide>${i}${f}</qti-divide>`,
      "duration-gte": `<qti-duration-gte>${bv("duration", 1)}${bv("duration", 2)}</qti-duration-gte>`,
      "duration-lt": `<qti-duration-lt>${bv("duration", 1)}${bv("duration", 2)}</qti-duration-lt>`,
      equal: `<qti-equal>${i}${f}</qti-equal>`,
      "equal-rounded": `<qti-equal-rounded figures="2">${i}${f}</qti-equal-rounded>`,
      "field-value": `<qti-field-value field-identifier="x">${v("QTI_CONTEXT")}</qti-field-value>`,
      gcd: `<qti-gcd>${i}</qti-gcd>`,
      gt: `<qti-gt>${i}${f}</qti-gt>`,
      gte: `<qti-gte>${i}${f}</qti-gte>`,
      index: `<qti-index n="1">${ids}</qti-index>`,
      inside: `<qti-inside shape="default" coords="">${bv("point", "1 1")}</qti-inside>`,
      "integer-divide": `<qti-integer-divide>${i}${i}</qti-integer-divide>`,
      "integer-modulus": `<qti-integer-modulus>${i}${i}</qti-integer-modulus>`,
      "integer-to-float": `<qti-integer-to-float>${i}</qti-integer-to-float>`,
      "is-null": `<qti-is-null>${i}</qti-is-null>`,
      lcm: `<qti-lcm>${i}</qti-lcm>`,
      lt: `<qti-lt>${i}${f}</qti-lt>`,
      lte: `<qti-lte>${i}${f}</qti-lte>`,
      "map-response": `<qti-map-response identifier="M"/>`,
      "map-response-point": `<qti-map-response-point identifier="P"/>`,
      match: `<qti-match>${ids}${ids}</qti-match>`,
      "math-constant": `<qti-math-constant name="pi"/>`,
      "math-operator": `<qti-math-operator name="floor">${f}</qti-math-operator>`,
      max: `<qti-max>${i}${f}</qti-max>`,
      member: `<qti-member>${bv("identifier", "A")}${ids}</qti-member>`,
      min: `<qti-min>${i}${i}</qti-min>`,
      multiple: `<qti-multiple>${i}${i}</qti-multiple>`,
      not: `<qti-not>${t}</qti-not>`,
      null: NULL,
      "number-correct": "<qti-number-correct/>",
      "number-incorrect": "<qti-number-incorrect/>",
      "number-presented": "<qti-number-presented/>",
      "number-responded": "<qti-number-responded/>",
      "number-selected": "<qti-number-selected/>",
      or: `<qti-or>${t}</qti-or>`,
      ordered: `<qti-ordered>${f}</qti-ordered>`,
      "outcome-maximum": `<qti-outcome-maximum outcome-identifier="SCORE"/>`,
      "outcome-minimum": `<qti-outcome-minimum outcome-identifier="SCORE"/>`,
      "pattern-match": `<qti-pattern-match pattern="a.c">${s}</qti-pattern-match>`,
      power: `<qti-power>${i}${i}</qti-power>`,
      product: `<qti-product>${i}${i}</qti-product>`,
      random: `<qti-random>${ids}</qti-random>`,
      "random-float": `<qti-random-float max="2"/>`,
      "random-integer": `<qti-random-integer max="2"/>`,
      repeat: `<qti-repeat number-repeats="2">${s}</qti-repeat>`,
      round: `<qti-round>${f}</qti-round>`,
      "round-to": `<qti-round-to rounding-mode="decimalPlaces" figures="0">${f}</qti-round-to>`,
      "stats-operator": `<qti-stats-operator name="mean"><qti-multiple>${f}${f}</qti-multiple></qti-stats-operator>`,
      "string-match": `<qti-string-match case-sensitive="true">${s}${s}</qti-string-match>`,
      substring: `<qti-substring case-sensitive="true">${s}${s}</qti-substring>`,
      subtract: `<qti-subtract>${i}${f}</qti-subtract>`,
      sum: `<qti-sum>${i}${i}</qti-sum>`,
      "test-variables": `<qti-test-variables variable-identifier="SCORE"/>`,
      truncate: `<qti-truncate>${f}</qti-truncate>`,
      variable: v("N"),
    };
    const item = itemOf(`${DECLARATIONS}
      <qti-response-declaration identifier="M" cardinality="single" base-type="identifier"><qti-mapping><qti-map-entry map-key="A" mapped-value="1"/></qti-mapping></qti-response-declaration>
      <qti-response-declaration identifier="P" cardinality="single" base-type="point"><qti-area-mapping><qti-area-map-entry shape="default" coords="" mapped-value="1"/></qti-area-mapping></qti-response-declaration>`);
    const variables = createItemVariables(item, { context: new Map([["QTI_CONTEXT", record([["x", int(1)]])]]) });
    const responses = new Map(variables.responses).set("M", id("A")).set("P", single("point", [1, 1]));
    const scope: TestScope = { itemSessions: () => [], itemSession: () => undefined, variable: () => undefined };
    const test = readAsi(
      `<qti-assessment-test ${NS} identifier="t" title="t"><qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="s" visible="true"/></qti-test-part></qti-assessment-test>`,
    );
    const context = { random: random(), customOperators: new Map([["c", () => int(1)]]) };
    for (const [kind, signature] of OPERATOR_SIGNATURES) {
      const expression = expressionOf(samples[kind]);
      const result =
        test.kind === "test" && expression.kind.match(/^(number|outcome|test)-/)
          ? evaluateTestExpression(expression, test.test, new Map(), scope, context)
          : evaluate(expression, { ...variables, responses }, item, context);
      if (result === null) continue;
      const { cardinality, baseType } = signature.result;
      if (!["operand", "declared", "unknown"].includes(cardinality)) expect(result.cardinality, kind).toBe(cardinality);
      const actual = result.cardinality === "record" ? undefined : result.baseType;
      if (baseType === "numeric" || baseType === "name") expect(["integer", "float"], kind).toContain(actual);
      else if (!["operand", "declared", "attribute", "unknown"].includes(baseType)) expect(actual, kind).toBe(baseType);
    }
  });
});
