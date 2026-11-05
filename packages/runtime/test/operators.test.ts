// cspell:ignore answr Jakrta
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { readAsi, writeAsi } from "../src/asi/index.js";
import { DataError, ProcessingError, SecurityError } from "../src/errors.js";
import { createRandom } from "../src/index.js";
import { DEFAULT_KEY_LIMITS, type Key } from "../src/keys/index.js";
import {
  buildOperatorCall,
  compareMathSteps,
  countLength,
  createScoringOperators,
  DEFAULT_OPERATOR_LIMITS,
  OPERATOR_DEFINITIONS,
  OPERATOR_NAMESPACE,
  type OperatorCall,
} from "../src/operators/index.js";
import {
  asin,
  boundedEditDistance,
  complex,
  evaluate,
  fnv1a32,
  isVariableName,
  listGraphemes,
  maximumMatching,
  readStatement,
  writeCanonicalJson,
} from "../src/operators/internal.js";
import type { CustomOperatorExpression } from "../src/processing/index.js";
import { createItemVariables, runResponseProcessing } from "../src/processing/index.js";
import { validateAsi } from "../src/validate/index.js";
import { buildSingle, type Value } from "../src/values/index.js";
import { lineOf, pointsOf, shapeOf, textOf } from "./arbitraries/operators.js";
import { readFixture } from "./fixtures.js";
import { FUZZ } from "./fuzz.js";

const OPERATORS = createScoringOperators();

/** Scores operands with the operator of a call. */
function score(call: CustomOperatorExpression, ...operands: (Value | null)[]): Value | null {
  const operator = OPERATORS.get(call.definition ?? "");
  if (operator === undefined) throw new Error(`No operator for ${call.definition}.`);
  return operator(operands, call);
}

const text = (value: string): Value => ({ cardinality: "single", baseType: "string", value });
const share = (value: Value | null): number | boolean | null =>
  value === null ? null : value.cardinality === "single" ? (value.value as number | boolean) : null;
const call = (value: OperatorCall, response = "RESPONSE"): CustomOperatorExpression =>
  buildOperatorCall(value, response);
const expression = (key: Omit<Extract<Key, { kind: "expression" }>, "kind">): CustomOperatorExpression =>
  call({ operator: "expression-equivalent", key: { kind: "expression", ...key } });
/** Reads JSON, as a caller from JavaScript passes input of any type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

/** A pair of `operators-expressions.json`: a key, a response and SymPy's verdict. */
interface ExpressionCase {
  readonly form: "expression" | "equation" | "solution-set";
  readonly key: string;
  readonly response: string;
  readonly variables: Readonly<Record<string, { readonly min: number; readonly max: number }>>;
  readonly decimalSeparator: "." | ",";
  readonly equivalent: boolean;
}

/** `operators-expressions.json`, which `validation/operators/expressions.py` writes from SymPy. */
interface ExpressionsFixture {
  readonly sympy: string;
  readonly cases: readonly ExpressionCase[];
  readonly values: readonly {
    readonly latex: string;
    readonly points: readonly {
      readonly point: Readonly<Record<string, number>>;
      readonly value: readonly [number, number];
    }[];
  }[];
}

/** `operators-numbers.json` and `operators-texts.json`: keys, responses and the shares that Python computes. */
interface SharesFixture {
  readonly cases: readonly {
    readonly key: Key;
    readonly response: string | readonly string[];
    readonly share: number | null;
  }[];
}

/** `grapheme-break-test.json`, the cases of Unicode's `GraphemeBreakTest.txt` that `pnpm unicode` writes. */
interface GraphemeFixture {
  readonly cases: readonly { readonly clusters: readonly (readonly number[])[] }[];
}

describe("buildOperatorCall", () => {
  it("writes the class, the definition, the operands and the canonical options", () => {
    const built = call({
      operator: "expression-equivalent",
      key: { kind: "expression", expression: "x^2", variables: { x: { min: 1, max: 2 } } },
      followThrough: { from: "PART1", expression: "r^2" },
    });
    expect(built).toStrictEqual({
      kind: "custom-operator",
      class: "expression-equivalent",
      definition: OPERATOR_DEFINITIONS["expression-equivalent"],
      operands: [
        { kind: "variable", identifier: "RESPONSE" },
        { kind: "variable", identifier: "PART1" },
      ],
      extensions: [
        {
          namespace: OPERATOR_NAMESPACE,
          prefix: "operator",
          name: "options",
          value:
            '{"followThrough":{"expression":"r^2","variable":"r"},"key":{"decimalSeparator":".","expression":"x^2","form":"expression","kind":"expression","variables":{"x":{"max":2,"min":1}}}}',
        },
      ],
      extensionElements: [],
    });
  });

  it("writes every default of a key resolved, so that the same key always gives the same text", () => {
    const text = call({ operator: "text-equivalent", key: { kind: "text", answers: [{ texts: ["a"] }] } }).extensions[0]
      ?.value;
    expect(JSON.parse(text ?? "")).toStrictEqual({
      key: {
        kind: "text",
        answers: [{ texts: ["a"], points: 1, patterns: [] }],
        count: 1,
        scheme: "forms",
        normalization: {
          form: "NFKC",
          foldWidth: true,
          ignoreMarks: false,
          caseSensitive: false,
          collapseWhitespace: true,
        },
        spelling: "exact",
        numericEquivalence: false,
        credit: [],
        length: null,
      },
    });
    const areas = call({
      operator: "hotspot-matching",
      key: { kind: "areas", scheme: "keyed", areas: [{ id: "A", shape: "rect", coords: [0, 0, 1, 1] }] },
    }).extensions[0]?.value;
    expect(areas).toBe(
      '{"key":{"areas":[{"coords":[0,0,1,1],"id":"A","points":1,"shape":"rect"}],"kind":"areas","scheme":"keyed","select":1}}',
    );
  });

  it("writes a call that the item's XML keeps and the schema of QTI accepts", () => {
    const built = call({ operator: "number-equivalent", key: { kind: "number", value: 2 } });
    const item =
      readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="i"
        time-dependent="false"><qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
      <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
      <qti-response-processing><qti-set-outcome-value identifier="SCORE"><qti-null/></qti-set-outcome-value></qti-response-processing>
      </qti-assessment-item>`);
    if (item.kind !== "item") throw new Error("The test reads an item.");
    const [rule] = item.item.responseProcessing?.rules ?? [];
    if (rule?.kind !== "set-outcome-value") throw new Error("The test reads a rule.");
    const withCall = {
      ...item,
      item: {
        ...item.item,
        responseProcessing: { ...item.item.responseProcessing, rules: [{ ...rule, expression: built }] },
      },
    };
    const written = writeAsi(withCall as typeof item);
    expect(written).toContain(`xmlns:operator="${OPERATOR_NAMESPACE}"`);
    const read = readAsi(written);
    expect(
      validateAsi(read, { customOperators: OPERATORS }).filter((issue) => issue.severity === "error"),
    ).toStrictEqual([]);
    if (read.kind !== "item") throw new Error("The test reads an item.");
    const variables = createItemVariables(read.item);
    const answered = {
      ...variables,
      responses: new Map(variables.responses).set("RESPONSE", buildSingle("string", "2.0")),
    };
    const outcomes = runResponseProcessing(read.item, answered, {
      random: createRandom(1),
      customOperators: OPERATORS,
    });
    expect(outcomes.outcomes.get("SCORE")).toStrictEqual(buildSingle("float", 1));
  });

  it("refuses a key that its operator refuses, with the path of its part", () => {
    expect(() => expression({ expression: "\\frac{x}{" })).toThrow(DataError);
    expect(() => expression({ expression: "x=x", form: "equation" })).toThrow("residual");
    expect(() => expression({ expression: "x", variables: { "a b": { min: 0, max: 1 } } })).toThrow('variables["a b"]');
    expect(() => expression({ expression: "\\frac{1}{x-x}" })).toThrow("fewer than 12");
    expect(() =>
      call({ operator: "text-equivalent", key: { kind: "text", answers: [{ texts: ["a"], patterns: ["("] }] } }),
    ).toThrow("key.answers[0].patterns[0]");
    expect(() =>
      call({ operator: "text-equivalent", key: { kind: "text", answers: [{ texts: ["a"] }], spelling: "variants" } }),
    ).toThrow("key.spelling");
    expect(() =>
      call({
        operator: "hotspot-matching",
        key: { kind: "areas", scheme: "keyed", select: 2, areas: [{ id: "A", shape: "rect", coords: [0, 0, 1, 1] }] },
      }),
    ).toThrow("select 2 is above the 1 areas");
    expect(() =>
      call({ operator: "number-equivalent", key: { kind: "number", value: 0, significantFigures: 2 } }),
    ).toThrow("0 has no significant figures");
  });

  it("refuses identifiers, a follow-through and operators that the convention does not take", () => {
    const key: Key = { kind: "number", value: 1 };
    expect(() => call({ operator: "number-equivalent", key }, "1A")).toThrow("The response must be a QTI identifier");
    expect(() =>
      call({ operator: "number-equivalent", key, followThrough: { from: "RESPONSE", expression: "r" } }),
    ).toThrow("never the response itself");
    expect(() =>
      buildOperatorCall(
        json('{"operator":"text-equivalent","key":{"kind":"text","answers":[{"texts":["a"]}]},"followThrough":{}}'),
        "R",
      ),
    ).toThrow("followThrough is for expression-equivalent and number-equivalent alone");
    expect(() => buildOperatorCall(json('{"operator":"mystery","key":{}}'), "R")).toThrow(
      "The call is invalid at operator: expected",
    );
    expect(() => buildOperatorCall(json("null"), "R")).toThrow("The call is invalid: expected an object, found null.");
    expect(() => buildOperatorCall(json("[]"), "R")).toThrow(
      "The call is invalid: expected an object, found an array.",
    );
    const text = '{"operator":"text-equivalent","key":{"kind":"text","answers":[{"texts":["a"]}]}';
    expect(() => buildOperatorCall(json(`${text},"followThru":{}}`), "R")).toThrow(
      'The call is invalid: unexpected property "followThru".',
    );
    const number = '{"operator":"number-equivalent","key":{"kind":"number","value":1}';
    expect(() => buildOperatorCall(json(`${number},"followThrough":[]}`), "R")).toThrow(
      "The option followThrough is invalid: expected an object, found an array.",
    );
    expect(() =>
      buildOperatorCall(json(`${number},"followThrough":{"from":"A","expression":"r","bogus":1}}`), "R"),
    ).toThrow('The option followThrough is invalid: unexpected property "bogus".');
    for (const name of ["__proto__", "prototype", "constructor"]) {
      const problem = `holds a property "${name}", a name that reaches the prototype.`;
      expect(() => buildOperatorCall(json(`${text},"${name}":1}`), "R")).toThrow(`The call is invalid: ${problem}`);
      expect(() =>
        buildOperatorCall(json(`${number},"followThrough":{"from":"A","expression":"r","${name}":1}}`), "R"),
      ).toThrow(`The option followThrough is invalid: ${problem}`);
    }
    expect(() => call({ operator: "number-equivalent", key: json('{"kind":"number","value":"1"}') })).toThrow(
      "The call of number-equivalent is invalid at key.value",
    );
    expect(() => call({ operator: "number-equivalent", key: json('{"kind":"number","value":1,"extra":1}') })).toThrow(
      "unexpected property",
    );
  });

  it("refuses a key past a limit of a key with a SecurityError", () => {
    const answers = Array.from({ length: DEFAULT_KEY_LIMITS.entries + 1 }, (_, index) => ({ texts: [`a${index}`] }));
    expect(() => call({ operator: "text-equivalent", key: { kind: "text", answers } })).toThrow(SecurityError);
    const pattern = "a".repeat(DEFAULT_KEY_LIMITS.patternLength + 1);
    const error = (() => {
      try {
        call({ operator: "text-equivalent", key: { kind: "text", answers: [{ texts: [], patterns: [pattern] }] } });
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("patternLength");
    expect(() => expression({ expression: "x+".repeat(1000).concat("x") })).toThrow(SecurityError);
  });
});

describe("writeCanonicalJson", () => {
  it("sorts the properties by their UTF-16 code units, as RFC 8785 does", () => {
    expect(writeCanonicalJson({ b: 1, a: [true, null], "\u{10000}": 1, "\uffff": 2, "\u00e9": 1e21 })).toBe(
      '{"a":[true,null],"b":1,"\u00e9":1e+21,"\u{10000}":1,"\uffff":2}',
    );
    expect(
      writeCanonicalJson(
        new Map([
          ["z", 1],
          ["a", 2],
        ]),
      ),
    ).toBe('{"a":2,"z":1}');
  });

  it("refuses what JSON does not hold", () => {
    expect(() => writeCanonicalJson(Number.NaN)).toThrow(DataError);
    expect(() => writeCanonicalJson(() => 1)).toThrow(DataError);
  });
});

describe("the comparator", () => {
  const fixture = readFixture<ExpressionsFixture>("operators-expressions.json");

  it(`gives SymPy ${fixture.sympy}'s verdict on every pair of the reference`, () => {
    const differ = fixture.cases.filter((pair) => {
      const built = expression({
        expression: pair.key,
        form: pair.form,
        variables: pair.variables,
        decimalSeparator: pair.decimalSeparator,
      });
      return share(score(built, text(pair.response))) !== (pair.equivalent ? 1 : 0);
    });
    expect(differ).toStrictEqual([]);
    expect(fixture.cases.length).toBeGreaterThan(700);
  });

  it("reads and evaluates each expression of the reference to SymPy's value at 30 digits, branch cuts included", () => {
    for (const { latex, points } of fixture.values) {
      const statement = readStatement(latex, ".", DEFAULT_OPERATOR_LIMITS);
      if (statement.kind !== "entry" || statement.entry.kind !== "expression")
        throw new Error(`${latex} is no expression.`);
      for (const { point, value } of points) {
        const { value: got } = evaluate(statement.entry.node, {
          value: (name) => ({
            value: complex(point[name] ?? Number.NaN),
            magnitude: Math.abs(point[name] ?? Number.NaN),
          }),
          sign: () => 1,
        });
        // The points include cancellations of doubles, such as tanh(x) + 1 near x = -9: 1e-6 tells every branch and base apart.
        expect(Math.hypot(got.re - value[0], got.im - value[1])).toBeLessThanOrEqual(
          1e-6 * Math.max(1, Math.hypot(...value)),
        );
      }
    }
  });

  it("takes SymPy's side of each branch cut", () => {
    expect(asin(complex(2))).toStrictEqual(complex(Math.PI / 2, -Math.acosh(2)));
    expect(asin(complex(-2))).toStrictEqual(complex(-Math.PI / 2, Math.acosh(2)));
  });

  it("agrees where the terms of a sum cancel, by the magnitude of what cancels", () => {
    const key = expression({ expression: "1" });
    expect(share(score(key, text("\\cosh^2x-\\sinh^2x")))).toBe(1);
    expect(share(score(key, text("\\cosh^2x-\\sinh^2x+10^{-6}")))).toBe(0);
  });

  it("evaluates each function of the subset by its definition, off the real line too", () => {
    const identities: [string, string][] = [
      ["\\sec x", "\\frac{1}{\\cos x}"],
      ["\\csc x", "\\frac{1}{\\sin x}"],
      ["\\cot x", "\\frac{\\cos x}{\\sin x}"],
      ["\\tanh x", "\\frac{\\sinh x}{\\cosh x}"],
      ["\\operatorname{lb}\\left(x\\right)", "\\frac{\\ln x}{\\ln 2}"],
      ["\\log_3 x", "\\frac{\\ln x}{\\ln 3}"],
      ["\\exp x", "e^x"],
      ["50\\%x", "\\frac{x}{2}"],
      ["\\tan\\sqrt{x}", "\\frac{\\sin\\sqrt{x}}{\\cos\\sqrt{x}}"],
      ["\\tanh\\sqrt{x}", "\\frac{\\sinh\\sqrt{x}}{\\cosh\\sqrt{x}}"],
      ["\\cosh\\sqrt{x}", "\\frac{e^{\\sqrt{x}}+e^{-\\sqrt{x}}}{2}"],
      ["\\arccos\\sqrt{x}", "\\frac{\\pi}{2}-\\arcsin\\sqrt{x}"],
      ["\\left|\\sqrt{x}\\right|^2", "\\left|x\\right|"],
      ["\\sqrt{x}^{4}", "x^2"],
      ["\\sec^{-1}x", "\\cos x"],
      ["\\sin^2 x", "1-\\cos^2x"],
    ];
    for (const [key, response] of identities)
      expect(share(score(expression({ expression: key }), text(response))), key).toBe(1);
  });

  it("leaves a response undecided when fewer than 12 points are finite", () => {
    const key = expression({ expression: "x", variables: { x: { min: 1, max: 2 } } });
    expect(score(key, text("x+\\frac{1}{x-x}"))).toBeNull();
  });

  it("draws a variable's values from its name alone, so that no call changes another", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
    const key = expression({ expression: "a+b" });
    expect(share(score(key, text("b+a")))).toBe(1);
    expect(share(score(key, text("a+c")))).toBe(0);
  });
});

describe("the reader", () => {
  const limits = DEFAULT_OPERATOR_LIMITS;
  const reads = (line: string, separator: "." | "," = "."): boolean => {
    try {
      readStatement(line, separator, limits);
      return true;
    } catch (error) {
      if (error instanceof DataError || error instanceof SecurityError) return false;
      throw error;
    }
  };

  it("reads what MathLive writes and refuses what lies outside the subset", () => {
    for (const line of [
      "\\ln|x|+1",
      "\\ln\\left|x\\right|",
      "\\frac12",
      "\\sin^{-1}x",
      "3{,}5x",
      "\\left\\lbrace2,3\\right\\rbrace",
      "x=2\\lor x=3",
      "abs\\left(x\\right)",
    ]) {
      expect(reads(line, line.includes("{,}") ? "," : "."), line).toBe(true);
    }
    for (const line of [
      "\\placeholder{}",
      "x!",
      "\\infty",
      "\\text{or}",
      "x^2^3",
      "x=1=2",
      "2 3",
      "\\imaginaryI",
      "\\",
    ]) {
      expect(reads(line), line).toBe(false);
    }
  });

  it("names variables as the reader gives them", () => {
    expect(["x", "x_1", "x_12", "alpha", "Gamma_a1"].every(isVariableName)).toBe(true);
    expect(["e", "pi", "ab", "x_", "x_123456789", "1"].some(isVariableName)).toBe(false);
  });

  it("reads to the depth limit and refuses one level past it", () => {
    const depth = limits.maxExpressionDepth;
    expect(reads(`${"(".repeat(depth - 1)}x${")".repeat(depth - 1)}`)).toBe(true);
    expect(() => readStatement(`${"(".repeat(depth)}x${")".repeat(depth)}`, ".", limits)).toThrow(SecurityError);
    expect(reads(`${"\\sqrt{".repeat(depth - 1)}x${"}".repeat(depth - 1)}`)).toBe(true);
    expect(reads(`${"\\frac{1}{".repeat(depth - 1)}x${"}".repeat(depth - 1)}`)).toBe(true);
    expect(reads(`x${"^{x".repeat(depth - 1)}${"}".repeat(depth - 1)}`)).toBe(true);
    expect(reads(`${"\\sqrt{".repeat(depth)}x${"}".repeat(depth)}`)).toBe(false);
  });

  it("reads to the length limit and refuses one character past it", () => {
    const at = "x+".repeat(limits.maxInputLength / 2 - 1).concat("x1");
    expect(at.length).toBe(limits.maxInputLength);
    expect(reads(at)).toBe(true);
    expect(() => readStatement(`${at}1`, ".", limits)).toThrow(SecurityError);
  });

  it("reads the worst inputs of 2,000 characters within its limits, or refuses them, in linear time", () => {
    const worst = [
      "(".repeat(2000),
      "{".repeat(2000),
      "|".repeat(2000),
      "\\frac".repeat(400),
      "x".repeat(2000),
      "1+".repeat(999).concat("1"),
      "-".repeat(1999).concat("x"),
      "\\sqrt".repeat(400),
      "2^".repeat(999).concat("2"),
      "\\left(".repeat(333),
    ];
    for (const line of worst) {
      expect(line.length).toBeLessThanOrEqual(2000);
      const started = performance.now();
      reads(line);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});

describe("expression-equivalent", () => {
  it("credits a follow-through from the earlier response", () => {
    const built = call({
      operator: "expression-equivalent",
      key: { kind: "expression", expression: "x^2" },
      followThrough: { from: "PART1", expression: "x^r" },
    });
    expect(share(score(built, text("x^3"), text("3")))).toBe(1);
    expect(share(score(built, text("x^3"), { cardinality: "single", baseType: "integer", value: 3 }))).toBe(1);
    expect(share(score(built, text("x^3"), text("\\placeholder")))).toBe(0);
    expect(share(score(built, text("x^3"), null))).toBe(0);
  });

  it("reads a decimal comma with the separator ,", () => {
    const built = expression({ expression: "2{,}5x", decimalSeparator: "," });
    expect(share(score(built, text("2,5x")))).toBe(1);
    expect(score(built, text("2.5x"))).toBeNull();
  });

  it("scores a blank, unreadable or oversized response NULL, and never throws for it", () => {
    const built = expression({ expression: "x" });
    const deep = `${"(".repeat(64)}x${")".repeat(64)}`;
    for (const response of [null, text("  \\, \\quad~"), text("\\text{x}"), text("x".repeat(2001)), text(deep)]) {
      expect(score(built, response)).toBeNull();
    }
    const roots = expression({ expression: "x=1", form: "solution-set" });
    expect(score(roots, text(Array.from({ length: 17 }, () => "\\pm1").join(",")))).toBeNull();
  });

  it("throws for an item whose operands or options it does not read", () => {
    const built = expression({ expression: "x" });
    expect(() => score(built, { cardinality: "single", baseType: "integer", value: 1 })).toThrow(
      "does not read its operand 1",
    );
    expect(() => score(built, text("x"), text("y"))).toThrow("takes 1 operand");
    const broken = { ...built, extensions: [{ ...built.extensions[0], value: "{" }] } as CustomOperatorExpression;
    expect(() => score(broken, text("x"))).toThrow("options are invalid at options: the attribute is not JSON");
    const missing = { ...built, extensions: [] } as CustomOperatorExpression;
    expect(() => score(missing, text("x"))).toThrow("has no attribute options");
  });

  it("reads an attribute that leaves fields out at their defaults, as buildOperatorCall writes them", () => {
    // Each case: a call, the attribute an item may carry for it with every field that has a default left out, and the
    // operands it is scored on.
    const cases: readonly [OperatorCall, string, readonly (readonly (Value | null)[])[]][] = [
      [
        { operator: "expression-equivalent", key: { kind: "expression", expression: "x" } },
        '{"key":{"expression":"x","kind":"expression"}}',
        [[text("x")], [text("x+1")], [text("x=1")]],
      ],
      [
        {
          operator: "expression-equivalent",
          key: { kind: "expression", expression: "x^2" },
          followThrough: { from: "PART1", expression: "x^r" },
        },
        '{"followThrough":{"expression":"x^r"},"key":{"expression":"x^2","kind":"expression"}}',
        [
          [text("x^3"), text("3")],
          [text("x^3"), text("2")],
        ],
      ],
      [
        { operator: "number-equivalent", key: { kind: "number", value: 2, tolerance: { absolute: 0.5 } } },
        '{"key":{"kind":"number","tolerance":{"absolute":0.5},"value":2}}',
        [[text("2.4")], [text("2.6")], [text("2 m")]],
      ],
      [
        {
          operator: "text-equivalent",
          key: {
            kind: "text",
            answers: [{ texts: ["Ab"] }],
            normalization: { form: "NFC" },
            length: { unit: "words", max: 1, effects: [{ when: "above", effect: "zero" }] },
          },
        },
        '{"key":{"answers":[{"texts":["Ab"]}],"kind":"text","length":{"effects":[{"effect":"zero","when":"above"}],"max":1,"unit":"words"},"normalization":{"form":"NFC"}}}',
        [[text("ab")], [text("ab ab")], [text("b")]],
      ],
      [
        {
          operator: "hotspot-matching",
          key: { kind: "areas", scheme: "keyed", areas: [{ id: "A", shape: "rect", coords: [0, 0, 1, 1] }] },
        },
        '{"key":{"areas":[{"coords":[0,0,1,1],"id":"A","shape":"rect"}],"kind":"areas","scheme":"keyed"}}',
        [[{ cardinality: "single", baseType: "point", value: [1, 1] }]],
      ],
      [
        { operator: "readable", key: { kind: "number", value: 2 } },
        '{"key":{"kind":"number","value":2}}',
        [[text("2")], [text("two")]],
      ],
    ];
    for (const [built, value, operands] of cases) {
      const full = call(built);
      const short = { ...full, extensions: [{ ...full.extensions[0], value }] } as CustomOperatorExpression;
      for (const each of operands) expect(score(short, ...each)).toStrictEqual(score(full, ...each));
    }
  });

  it("writes the attribute of every kind of key with each default resolved, byte for byte", () => {
    const values = [
      call({ operator: "expression-equivalent", key: { kind: "expression", expression: "x" } }),
      call({ operator: "number-equivalent", key: { kind: "number", value: 2 } }),
      call({ operator: "readable", key: { kind: "number", value: 2 } }),
    ].map((built) => built.extensions[0]?.value);
    const number =
      '{"components":null,"credit":[],"decimalSeparator":".","fractions":false,"intervals":null,"kind":"number","significantFigures":null,"tolerance":{"absolute":null,"relative":null},"units":{},"value":2}';
    expect(values).toStrictEqual([
      '{"followThrough":null,"key":{"decimalSeparator":".","expression":"x","form":"expression","kind":"expression","variables":{}}}',
      `{"followThrough":null,"key":${number}}`,
      `{"key":${number}}`,
    ]);
  });

  it("is reported by processing as a ProcessingError of the item when it throws", () => {
    const document =
      readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="i"
        time-dependent="false"><qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
      <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
      <qti-response-processing><qti-set-outcome-value identifier="SCORE">
        <qti-custom-operator class="expression-equivalent" definition="${OPERATOR_DEFINITIONS["expression-equivalent"]}">
          <qti-variable identifier="RESPONSE"/></qti-custom-operator>
      </qti-set-outcome-value></qti-response-processing></qti-assessment-item>`);
    if (document.kind !== "item") throw new Error("The test reads an item.");
    const context = { random: createRandom(1), customOperators: OPERATORS };
    expect(() => runResponseProcessing(document.item, createItemVariables(document.item), context)).toThrow(
      ProcessingError,
    );
  });
});

describe("hotspot-matching", () => {
  const built = call({
    operator: "hotspot-matching",
    key: {
      kind: "areas",
      scheme: "keyed",
      select: 2,
      areas: [
        { id: "A", shape: "rect", coords: [0, 0, 10, 10] },
        { id: "B", shape: "rect", coords: [5, 5, 15, 15] },
        { id: "C", shape: "poly", coords: [20, 20, 30, 20, 25, 30] },
      ],
    },
  });
  const points = (...values: [number, number][]): Value => ({ cardinality: "multiple", baseType: "point", values });

  it("matches each point to one area at most, by a maximum matching", () => {
    expect(share(score(built, points([7, 7], [7, 7])))).toBe(1);
    expect(share(score(built, points([7, 7])))).toBe(0.5);
    expect(share(score(built, points([1, 1], [2, 2])))).toBe(0.5);
    expect(share(score(built, points([25, 20], [10, 10], [12, 12])))).toBe(1);
    expect(share(score(built, points([50, 50])))).toBe(0);
  });

  it("reads more points than areas as unreadable", () => {
    expect(score(built, points([1, 1], [2, 2], [3, 3], [4, 4]))).toBeNull();
    expect(score(built, null)).toBeNull();
  });
});

describe("compareMathSteps", () => {
  it("checks each step against the nearest earlier line that reads", () => {
    expect(compareMathSteps(["x^2-5x+6=0", "(x-2)(x-3)=0", "\\text{so}", "x=2 \\lor x=3", "x=2,x=4"])).toStrictEqual([
      { step: 0, equivalent: null, from: null },
      { step: 1, equivalent: true, from: 0 },
      { step: 2, equivalent: null, from: 1 },
      { step: 3, equivalent: true, from: 1 },
      { step: 4, equivalent: false, from: 3 },
    ]);
    expect(compareMathSteps(["(x+1)^2", "x^2+2x+1", "x^2+1"]).map((check) => check.equivalent)).toStrictEqual([
      null,
      true,
      false,
    ]);
    expect(compareMathSteps(["x>2", "x>3"]).map((check) => check.equivalent)).toStrictEqual([null, null]);
    expect(compareMathSteps(["2x=4", "x+1"]).map((check) => check.equivalent)).toStrictEqual([null, false]);
  });

  it("takes the options of the reader and the limits", () => {
    expect(compareMathSteps(["2{,}5x=5", "x=2"], { decimalSeparator: "," })[1]?.equivalent).toBe(true);
    expect(compareMathSteps(["\\sqrt{x^2}", "x"], { variables: { x: { min: 1, max: 5 } } })[1]?.equivalent).toBe(true);
    expect(compareMathSteps(["\\sqrt{x^2}", "x"])[1]?.equivalent).toBe(false);
    expect(compareMathSteps(["x", "x+x+x"], { limits: { maxInputLength: 2 } })[1]?.equivalent).toBeNull();
    expect(compareMathSteps(["x", "((x))"], { limits: { maxExpressionDepth: 2 } })[1]?.equivalent).toBeNull();
    expect(() => compareMathSteps(["x", "x"], { maxSteps: 1 })).toThrow(SecurityError);
  });

  it("refuses input of other types", () => {
    expect(() => compareMathSteps(json('"x"'))).toThrow("The steps must be an array of strings");
    expect(() => compareMathSteps(json("[1]"))).toThrow("The step 0 must be a string");
    expect(() => compareMathSteps([], json("null"))).toThrow("The options object is invalid: expected an object");
    expect(() => compareMathSteps([], json('{"other":1}'))).toThrow(
      'The options object is invalid: unexpected property "other"',
    );
    expect(() => compareMathSteps([], json('{"decimalSeparator":";"}'))).toThrow("decimalSeparator");
    expect(() => compareMathSteps([], json('{"maxSteps":0}'))).toThrow("maxSteps");
    expect(() => compareMathSteps([], json('{"variables":{"x":{"min":2,"max":1}}}'))).toThrow("variables");
  });
});

describe("number-equivalent", () => {
  const fixture = readFixture<SharesFixture>("operators-numbers.json");

  it("gives the share that Python's fractions and decimal give on every case of the reference", () => {
    const differ = fixture.cases.filter(({ key, response, share: expected }) => {
      const built = call({ operator: "number-equivalent", key } as OperatorCall);
      const operand: Value = Array.isArray(response)
        ? { cardinality: "ordered", baseType: "string", values: response }
        : text(response as string);
      return share(score(built, operand)) !== expected;
    });
    expect(differ).toStrictEqual([]);
  });

  it("reads a response past maxInputLength as unreadable", () => {
    const built = call({ operator: "number-equivalent", key: { kind: "number", value: 1 } });
    expect(score(built, text("1".repeat(2001)))).toBeNull();
    expect(share(score(built, text("1".repeat(2000))))).toBe(0);
  });

  it("reads an integer or a float through its shortest decimal form", () => {
    const built = call({ operator: "number-equivalent", key: { kind: "number", value: 1e21, decimalSeparator: "," } });
    expect(share(score(built, { cardinality: "single", baseType: "float", value: 1e21 }))).toBe(1);
    expect(share(score(built, { cardinality: "single", baseType: "integer", value: 7 }))).toBe(0);
  });

  it("credits a follow-through from the value of the earlier response", () => {
    const built = call({
      operator: "number-equivalent",
      key: { kind: "number", value: 10, tolerance: { absolute: 0.01 } },
      followThrough: { from: "A", expression: "\\frac{2r}{3}+\\sqrt{r^2}-r" },
    });
    expect(share(score(built, text("2"), text("3")))).toBe(1);
    expect(share(score(built, text("2"), text("x")))).toBe(0);
    expect(share(score(built, text("2"), text("\\sqrt{-1}")))).toBe(0);
  });

  it("refuses a follow-through beside intervals, or with another variable", () => {
    const key: Key = { kind: "number", value: 1, intervals: [{ min: 0, max: 2 }] };
    expect(() => call({ operator: "number-equivalent", key, followThrough: { from: "A", expression: "r" } })).toThrow(
      "intervals and components",
    );
    expect(() =>
      call({
        operator: "number-equivalent",
        key: { kind: "number", value: 1 },
        followThrough: { from: "A", expression: "r+y" },
      }),
    ).toThrow("of r alone, found y");
  });
});

describe("readable", () => {
  it("tells a response that reads from one that does not, for each kind of key", () => {
    const expressionKey = call({ operator: "readable", key: { kind: "expression", expression: "x" } });
    expect(share(score(expressionKey, text("x^2")))).toBe(true);
    expect(share(score(expressionKey, text("x=")))).toBe(false);
    expect(share(score(expressionKey, { cardinality: "ordered", baseType: "string", values: ["x", "2x"] }))).toBe(true);
    const numberKey = call({ operator: "readable", key: { kind: "number", value: 1, units: { m: 1 } } });
    expect(share(score(numberKey, text("3 km")))).toBe(true);
    expect(share(score(numberKey, text("1,000")))).toBe(false);
    expect(share(score(numberKey, { cardinality: "single", baseType: "float", value: 2 }))).toBe(true);
    const textKey = call({ operator: "readable", key: { kind: "text", answers: [{ texts: ["a"] }] } });
    expect(share(score(textKey, text("anything")))).toBe(true);
    expect(share(score(textKey, text("   ")))).toBe(false);
    expect(share(score(textKey, null))).toBe(false);
    expect(share(score(textKey, text("x".repeat(2001))))).toBe(false);
  });
});

describe("text-equivalent", () => {
  const fixture = readFixture<SharesFixture>("operators-texts.json");

  it("gives the share that Python computes on every case of the reference", () => {
    const differ = fixture.cases.filter(({ key, response, share: expected }) => {
      const built = call({ operator: "text-equivalent", key } as OperatorCall);
      const operand: Value = { cardinality: "multiple", baseType: "string", values: response as readonly string[] };
      const got = share(score(built, operand));
      return !(
        got === expected ||
        (typeof got === "number" && typeof expected === "number" && Math.abs(got - expected) < 1e-12)
      );
    });
    expect(differ).toStrictEqual([]);
  });

  it("matches the patterns of an answer as XSD regular expressions", () => {
    const built = call({
      operator: "text-equivalent",
      key: {
        kind: "text",
        answers: [{ texts: [], patterns: ["\\p{Lu}[a-z]+"] }],
        normalization: { caseSensitive: true },
      },
    });
    expect(share(score(built, text("Jakarta")))).toBe(1);
    expect(share(score(built, text("jakarta")))).toBe(0);
  });

  it("refuses a key whose patterns need more than maxStates states together, as one pattern may", () => {
    const keyOf = (patterns: readonly string[]): OperatorCall => ({
      operator: "text-equivalent",
      key: { kind: "text", answers: patterns.map((pattern) => ({ texts: [], patterns: [pattern] })) },
    });
    // `a{49999}` takes 49,999 states and `.`, 1: two of them fill the 100,000 states of one pattern.
    expect(() => call(keyOf(["a{49999}", "a{49999}", "a", "."]))).not.toThrow();
    for (const patterns of [["a{49999}", "a{49999}", "a", ".", "b"], ["a{100001}"]]) {
      expect(() => call(keyOf(patterns))).toThrow(
        expect.objectContaining({ name: "SecurityError", limit: "maxStates", maximum: 100_000 }),
      );
    }
  });

  it("measures a credit tier's edit distance within maxEditBand, and a response within maxInputLength", () => {
    const built = call({
      operator: "text-equivalent",
      key: {
        kind: "text",
        answers: [{ texts: ["a".repeat(80)] }],
        credit: [{ tolerance: { absolute: 100 }, share: 0.5 }],
      },
    });
    const response = text("b".repeat(70).concat("a".repeat(10)));
    expect(share(score(built, response))).toBe(0);
    const wide = createScoringOperators({ limits: { maxEditBand: 128 } }).get(OPERATOR_DEFINITIONS["text-equivalent"]);
    expect(share(wide?.([response], built) ?? null)).toBe(0.5);
    expect(score(built, text("a".repeat(2001)))).toBeNull();
  });

  it("applies the effects of a length rule after the share", () => {
    const built = call({
      operator: "text-equivalent",
      key: {
        kind: "text",
        answers: [{ texts: [], patterns: [".*"] }],
        length: {
          unit: "words",
          min: 3,
          max: 5,
          effects: [
            { when: "below", effect: "zero" },
            { when: "above", effect: { deduct: 0.25 } },
          ],
        },
      },
    });
    expect(share(score(built, text("one two three")))).toBe(1);
    expect(share(score(built, text("one two")))).toBe(0);
    expect(share(score(built, text("one two three four five six")))).toBe(0.75);
    expect(() =>
      call({
        operator: "text-equivalent",
        key: {
          kind: "text",
          answers: [{ texts: ["a"] }],
          length: { unit: "words", effects: [{ when: "below", effect: "zero" }] },
        },
      }),
    ).toThrow("needs the rule's min");
  });
});

describe("countLength", () => {
  it("splits every case of Unicode's GraphemeBreakTest.txt into its clusters", () => {
    const { cases } = readFixture<GraphemeFixture>("grapheme-break-test.json");
    for (const { clusters } of cases) {
      const expected = clusters.map((cluster) => String.fromCodePoint(...cluster));
      expect(listGraphemes(expected.join(""))).toStrictEqual(expected);
    }
    expect(cases.length).toBeGreaterThan(700);
  });

  it("counts in each unit", () => {
    const sample = "Ini  ibu\u3000Budi.\r\n\u{1F1EE}\u{1F1E9}";
    expect(countLength(sample, "words")).toBe(4);
    expect(countLength(sample, "characters")).toBe(16);
    expect(countLength(sample, "characters-without-spaces")).toBe(12);
    expect(countLength(sample, "manuscript-squares")).toBe(15);
    expect(countLength("", "characters")).toBe(0);
  });

  it("refuses input of other types", () => {
    expect(() => countLength(json("1"), "words")).toThrow("The text must be a string");
    expect(() => countLength("a", json('"lines"'))).toThrow("The unit must be");
  });
});

describe("createScoringOperators", () => {
  it("registers the five definitions, which name no brand", () => {
    expect([...OPERATORS.keys()]).toStrictEqual(Object.values(OPERATOR_DEFINITIONS));
    const all = [...Object.values(OPERATOR_DEFINITIONS), OPERATOR_NAMESPACE];
    expect(
      all.every((uri) => /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uri)),
    ).toBe(true);
    expect(new Set(all).size).toBe(6);
  });

  it("takes limits up to their caps", () => {
    const wide = createScoringOperators({ limits: { maxInputLength: 20_000 } });
    const built = expression({ expression: "x" });
    const long = text("x+".repeat(1500).concat("x"));
    expect(wide.get(OPERATOR_DEFINITIONS["expression-equivalent"])?.([long], built)).toStrictEqual(
      buildSingle("float", 0),
    );
    expect(OPERATORS.get(OPERATOR_DEFINITIONS["expression-equivalent"])?.([long], built)).toBeNull();
  });

  it("refuses options of other types, and limits past their caps", () => {
    expect(() => createScoringOperators(json("null"))).toThrow("The options object is invalid: expected an object");
    expect(() => createScoringOperators(json('{"other":1}'))).toThrow(
      'The options object is invalid: unexpected property "other"',
    );
    expect(() => createScoringOperators(json('{"limits":[]}'))).toThrow(
      "The options object is invalid at limits: expected an object, found an array",
    );
    expect(() => createScoringOperators(json('{"limits":{"maxSolutions":"2"}}'))).toThrow(
      'The options object is invalid at limits.maxSolutions: expected a number, found "2"',
    );
    expect(() => createScoringOperators({ limits: { maxExpressionDepth: 129 } })).toThrow("at most 128");
    expect(() => createScoringOperators(json('{"limits":{"maxFindings":1}}'))).toThrow(
      'The options object is invalid at limits: unexpected property "maxFindings"',
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/operators.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/runtime": await import("../src/index.js"),
      "@assesskit/runtime/asi": await import("../src/asi/index.js"),
      "@assesskit/runtime/operators": await import("../src/operators/index.js"),
      "@assesskit/runtime/processing": await import("../src/processing/index.js"),
      "@assesskit/runtime/values": await import("../src/values/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("never throws for a response, whatever its text", () => {
    const calls: CustomOperatorExpression[] = [
      expression({ expression: "x^2" }),
      expression({ expression: "x=2,x=3", form: "solution-set" }),
      call({ operator: "number-equivalent", key: { kind: "number", value: 2.5, fractions: true, units: { m: 1 } } }),
      call({
        operator: "text-equivalent",
        key: {
          kind: "text",
          answers: [{ texts: ["a b"] }],
          scheme: "words",
          credit: [{ tolerance: { absolute: 2 }, share: 0.5 }],
        },
      }),
      call({ operator: "readable", key: { kind: "expression", expression: "x" } }),
    ];
    fc.assert(
      fc.property(textOf, (value) => {
        for (const built of calls) {
          const result = score(built, text(value));
          expect(result === null || result.cardinality === "single").toBe(true);
        }
      }),
      FUZZ,
    );
  });

  it("reads every line that the arbitrary writes, or refuses it with a DataError or a SecurityError alone", () => {
    fc.assert(
      fc.property(lineOf, (line) => {
        try {
          readStatement(line, ".", DEFAULT_OPERATOR_LIMITS);
        } catch (error) {
          expect(error instanceof DataError || error instanceof SecurityError).toBe(true);
        }
      }),
      FUZZ,
    );
  });

  it("gives every expression the same verdict against itself and against a sum in another order", () => {
    fc.assert(
      fc.property(shapeOf, ([first, second]) => {
        const built = expression({ expression: `${first}+${second}` });
        const verdict = share(score(built, text(`${second}+${first}`)));
        expect(verdict === 1 || verdict === null).toBe(true);
      }),
      FUZZ,
    );
  });

  it("matches as many hotspot points as brute force, up to six points and six areas", () => {
    fc.assert(
      fc.property(pointsOf, ({ edges, targets }) => {
        let best = 0;
        const visit = (source: number, used: Set<number>, count: number): void => {
          best = Math.max(best, count);
          if (source === edges.length) return;
          visit(source + 1, used, count);
          for (const target of edges[source] ?? []) {
            if (used.has(target)) continue;
            used.add(target);
            visit(source + 1, used, count + 1);
            used.delete(target);
          }
        };
        visit(0, new Set(), 0);
        expect(maximumMatching(edges, targets)).toBe(best);
      }),
      FUZZ,
    );
  });

  it("gives the banded edit distance of the full table, or none past the band", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 12 }),
        fc.string({ maxLength: 12 }),
        fc.integer({ min: 0, max: 6 }),
        (a, b, band) => {
          const first = Array.from(a, (c) => c.codePointAt(0) ?? 0);
          const second = Array.from(b, (c) => c.codePointAt(0) ?? 0);
          const table = Array.from({ length: first.length + 1 }, (_, i) =>
            Array.from({ length: second.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
          );
          for (let i = 1; i <= first.length; i += 1)
            for (let j = 1; j <= second.length; j += 1) {
              const row = table[i] ?? [];
              const above = table[i - 1] ?? [];
              row[j] = Math.min(
                (above[j - 1] ?? 0) + (first[i - 1] === second[j - 1] ? 0 : 1),
                (above[j] ?? 0) + 1,
                (row[j - 1] ?? 0) + 1,
              );
            }
          const full = table[first.length]?.[second.length] ?? 0;
          expect(boundedEditDistance(first, second, band)).toBe(full <= band ? full : undefined);
        },
      ),
      FUZZ,
    );
  });
});
