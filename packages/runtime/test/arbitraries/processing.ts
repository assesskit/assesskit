import fc from "fast-check";
import { OPERATOR_SIGNATURES, type OperandSignature } from "../../src/processing/internal.js";
import { BASE_TYPES, type BaseType, type Cardinality } from "../../src/values/index.js";

/**
 * The text of a base value of a base type: forms it accepts, its limits (the edges of the safe integers, the infinities)
 * and forms it refuses.
 */
const LITERALS: ReadonlyMap<BaseType, readonly string[]> = new Map([
  ["boolean", ["true", "false", "1", "0", "TRUE"]],
  ["integer", ["0", "1", "-1", "2", "3", "9007199254740991", "-9007199254740991", "9007199254740992", "1e3", "+5"]],
  ["float", ["0", "-0", "1.5", "-2.25", "0.5", "1e308", "1e-324", "INF", "-INF", "NaN", "1e999"]],
  ["string", ["a", "abc", "[a-c]+", "😀", "A"]],
  ["identifier", ["A", "B", "x1", "_a", "1a"]],
  ["duration", ["PT0S", "PT1.5S", "PT1H", "P1D", "P1Y", "PT"]],
  ["point", ["1 2", "0 0", "1", "a b"]],
  ["pair", ["A B", "A", "A A"]],
  ["directedPair", ["A B", "B A"]],
  ["uri", ["a.png", "http://example.com/"]],
]);

/** The base types that have literals. */
const LITERAL_TYPES: readonly BaseType[] = BASE_TYPES.filter((baseType) => LITERALS.has(baseType));

/** The variables of the item that `processing.test.ts` declares, with the cardinality and base type of each. */
const VARIABLES: readonly (readonly [string, Cardinality, BaseType])[] = [
  ["RESPONSE", "single", "identifier"],
  ["SCORE", "single", "float"],
  ["N", "single", "integer"],
  ["T", "single", "float"],
  ["EMPTY", "single", "integer"],
  ["NOTHING", "single", "string"],
  ["PATTERN", "single", "string"],
  ["K", "single", "integer"],
  ["NONE", "single", "integer"],
];

/** A leaf expression with the cardinality and base type it has when it has a value. */
interface Leaf {
  readonly xml: string;
  readonly cardinality: Cardinality;
  readonly baseType: BaseType | undefined;
}

/** A base value of a base type. */
function literal(baseType: BaseType): fc.Arbitrary<string> {
  return fc
    .constantFrom(...(LITERALS.get(baseType) ?? []))
    .map((text) => `<qti-base-value base-type="${baseType}">${text}</qti-base-value>`);
}

const leaves: fc.Arbitrary<Leaf> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc
      .constantFrom(...LITERAL_TYPES)
      .chain((baseType) => literal(baseType).map((xml) => ({ xml, cardinality: "single" as const, baseType }))),
  },
  {
    weight: 3,
    arbitrary: fc
      .constantFrom(...VARIABLES)
      .map(([name, cardinality, baseType]) => ({ xml: `<qti-variable identifier="${name}"/>`, cardinality, baseType })),
  },
  { weight: 1, arbitrary: fc.constant({ xml: "<qti-null/>", cardinality: "single" as const, baseType: undefined }) },
);

/** A base value without text: NULL for a string, an error for any other base type. */
const emptyBaseValue = fc
  .constantFrom(...BASE_TYPES)
  .map((baseType) => `<qti-base-value base-type="${baseType}"></qti-base-value>`);

/** The value of an attribute that names a number: an edge of the range, a variable, or one that is not declared. */
const count = fc.constantFrom("0", "1", "2", "3", "4294967296", "9007199254740991", "-1", "N", "K", "EMPTY", "NOPE");
const roundingMode = fc.constantFrom("decimalPlaces", "significantFigures");
const identifierOf = fc.constantFrom("RESPONSE", "SCORE", "NOPE");

/** The attributes that an operator needs or takes, as text; an operator that is not here takes none. */
const ATTRIBUTES: ReadonlyMap<string, fc.Arbitrary<string>> = new Map([
  ["any-n", fc.tuple(count, count).map(([min, max]) => ` min="${min}" max="${max}"`)],
  [
    "equal",
    fc
      .tuple(fc.constantFrom("exact", "absolute", "relative"), fc.constantFrom("", "0 1", "0.5", "-1", "T"))
      .map(([toleranceMode, tolerance]) => ` tolerance-mode="${toleranceMode}" tolerance="${tolerance}"`),
  ],
  [
    "equal-rounded",
    fc.tuple(roundingMode, count).map(([mode, figures]) => ` rounding-mode="${mode}" figures="${figures}"`),
  ],
  ["round-to", fc.tuple(roundingMode, count).map(([mode, figures]) => ` rounding-mode="${mode}" figures="${figures}"`)],
  ["index", count.map((n) => ` n="${n}"`)],
  ["repeat", count.map((times) => ` number-repeats="${times}"`)],
  [
    "random-integer",
    fc.tuple(count, count, count).map(([min, max, step]) => ` min="${min}" max="${max}" step="${step}"`),
  ],
  ["random-float", fc.tuple(count, count).map(([min, max]) => ` min="${min}" max="${max}"`)],
  ["field-value", fc.constantFrom(' field-identifier="a"', ' field-identifier="b"')],
  [
    "inside",
    fc.constantFrom(
      ' shape="rect" coords="0,0,10,10"',
      ' shape="circle" coords="1,1,5"',
      ' shape="poly" coords="0,0,10,0,5,5"',
      ' shape="default" coords=""',
    ),
  ],
  [
    "math-operator",
    fc
      .constantFrom(
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "sinh",
        "log",
        "ln",
        "exp",
        "abs",
        "signum",
        "floor",
        "ceil",
        "toDegrees",
        "toRadians",
        "NOPE",
      )
      .map((name) => ` name="${name}"`),
  ],
  [
    "stats-operator",
    fc.constantFrom("mean", "sampleVariance", "sampleSD", "popVariance", "popSD").map((name) => ` name="${name}"`),
  ],
  [
    "string-match",
    fc
      .tuple(fc.boolean(), fc.boolean())
      .map(([sensitive, inside]) => ` case-sensitive="${sensitive}" substring="${inside}"`),
  ],
  ["substring", fc.boolean().map((sensitive) => ` case-sensitive="${sensitive}"`)],
  [
    "pattern-match",
    fc
      .constantFrom("[a-c]+", "(a|b)*", "a{3}", "\\d+", "[", "(a+)+$", "a{100001}", "")
      .map((pattern) => ` pattern="${pattern}"`),
  ],
  ["default", identifierOf.map((identifier) => ` identifier="${identifier}"`)],
  ["correct", identifierOf.map((identifier) => ` identifier="${identifier}"`)],
  ["map-response", identifierOf.map((identifier) => ` identifier="${identifier}"`)],
  ["map-response-point", identifierOf.map((identifier) => ` identifier="${identifier}"`)],
]);

/** The operators that evaluating an item can reach, without the leaves above and those that read a test. */
const OPERATORS = [...OPERATOR_SIGNATURES]
  .filter(
    ([kind]) =>
      !/^(number-|outcome-m|test-variables|custom-operator|base-value|variable$|null$|math-constant)/.test(kind),
  )
  .map(([kind, signature]) => ({ kind, signature }));

/** Whether a leaf may stand where an operand is taken, by cardinality and base type. */
function fits({ cardinality, baseType }: Leaf, operand: OperandSignature | undefined): boolean {
  if (operand === undefined || baseType === undefined) return true;
  return operand.cardinalities.includes(cardinality) && (operand.baseTypes?.includes(baseType) ?? true);
}

/** A container of values of one base type, written by `qti-multiple` or `qti-ordered`. */
const containers: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom("multiple", "ordered"), fc.constantFrom(...LITERAL_TYPES))
  .chain(([kind, baseType]) =>
    fc
      .array(literal(baseType), { minLength: 1, maxLength: 4 })
      .map((items) => `<qti-${kind}>${items.join("")}</qti-${kind}>`),
  );

/** An operand for the place a signature describes: a leaf that fits when one is drawn, otherwise whatever is drawn. */
function operandFor(operand: OperandSignature | undefined): fc.Arbitrary<string> {
  const wantsContainer = operand?.cardinalities.some((cardinality) => cardinality !== "single") === true;
  return fc.oneof(
    { weight: 16, arbitrary: leaves.filter((leaf) => fits(leaf, operand)).map(({ xml }) => xml) },
    { weight: wantsContainer ? 16 : 2, arbitrary: containers },
    { weight: 3, arbitrary: leaves.map(({ xml }) => xml) },
    { weight: 1, arbitrary: emptyBaseValue },
  );
}

/** An operator over the operands that its signature describes, with the attributes it needs. */
function operatorOver(
  operandArbitrary: (place: OperandSignature | undefined) => fc.Arbitrary<string>,
): fc.Arbitrary<string> {
  return fc
    .constantFrom(...OPERATORS)
    .chain(({ kind, signature: { minOperands, maxOperands, operands } }) =>
      fc
        .integer({ min: minOperands, max: Math.min(maxOperands, minOperands + 2) })
        .chain((number) =>
          fc
            .tuple(
              fc.tuple(
                ...Array.from({ length: number }, (_, index) =>
                  operandArbitrary(operands[Math.min(index, operands.length - 1)]),
                ),
              ),
              ATTRIBUTES.get(kind) ?? fc.constant(""),
            )
            .map(([inner, attributes]) => `<qti-${kind}${attributes}>${inner.join("")}</qti-${kind}>`),
        ),
    );
}

const shallow = operatorOver(operandFor);

/**
 * The XML of an expression over the variables of the item of `processing.test.ts`: an operator over leaves and containers
 * that fit its signature, or over such operators, with the limits of each type among the literals.
 */
export const expressions: fc.Arbitrary<string> = fc.oneof(
  shallow,
  operatorOver((place) => fc.oneof(operandFor(place), shallow)),
);
