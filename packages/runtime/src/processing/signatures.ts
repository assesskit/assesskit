import type { Expression } from "../asi/index.js";
import { BASE_TYPES, type BaseType, CARDINALITIES, type Cardinality } from "../values/index.js";

/** What one operand of an operator takes. */
export interface OperandSignature {
  /** The cardinalities the operand may have. */
  readonly cardinalities: readonly Cardinality[];
  /** The base types the operand may have; `undefined` for any, and a record has none. */
  readonly baseTypes?: readonly BaseType[];
}

/**
 * The type of the result of an operator.
 *
 * @remarks
 * | Cardinality   | Meaning                                                      |
 * | ------------- | ------------------------------------------------------------ |
 * | a cardinality | that cardinality                                             |
 * | `operand`     | that of the container operand                                |
 * | `declared`    | that of the declaration of the variable the expression names |
 * | `unknown`     | known only from the value                                    |
 *
 * | Base type   | Meaning                                                                                                     |
 * | ----------- | ----------------------------------------------------------------------------------------------------------- |
 * | a base type | that base type                                                                                              |
 * | `numeric`   | integer when every operand is an integer, else float                                                        |
 * | `operand`   | that of the operands                                                                                        |
 * | `declared`  | that of the declaration of the variable the expression names                                                |
 * | `attribute` | that of the `base-type` attribute; for `qti-test-variables` without one, `numeric`, and float with a weight |
 * | `name`      | integer for the `name`s `signum`, `floor` and `ceil`, float for the others                                  |
 * | `unknown`   | known only from the value                                                                                   |
 */
export interface ResultSignature {
  /** The cardinality of the result. */
  readonly cardinality: Cardinality | "operand" | "declared" | "unknown";
  /** The base type of the result. */
  readonly baseType: BaseType | "numeric" | "operand" | "declared" | "attribute" | "name" | "unknown";
}

/** The operands and the result of an operator, as the Information Model defines them. */
export interface OperatorSignature {
  /** The fewest operands. */
  readonly minOperands: number;
  /** The most operands; `Infinity` when there is no limit. */
  readonly maxOperands: number;
  /** What the operands take, by position; operands after the last entry take what it says. */
  readonly operands: readonly OperandSignature[];
  /** Whether the operands that are not NULL share one base type. */
  readonly sameBaseType: boolean;
  /** Whether the operands that are not NULL share one cardinality. */
  readonly sameCardinality: boolean;
  /** The type of the result. */
  readonly result: ResultSignature;
}

const SINGLE: readonly Cardinality[] = ["single"];
const CONTAINER: readonly Cardinality[] = ["multiple", "ordered"];
const SINGLE_OR_CONTAINER: readonly Cardinality[] = ["single", "multiple", "ordered"];
const NUMERIC: readonly BaseType[] = ["integer", "float"];
/**
 * The base types `qti-match`, `qti-member`, `qti-delete` and `qti-contains` must not compare: duration.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-match}
 */
const COMPARABLE: readonly BaseType[] = BASE_TYPES.filter((baseType) => baseType !== "duration");

const operand = (cardinalities: readonly Cardinality[], baseTypes?: readonly BaseType[]): OperandSignature =>
  baseTypes === undefined ? { cardinalities } : { cardinalities, baseTypes };

const result = (
  cardinality: ResultSignature["cardinality"],
  baseType: ResultSignature["baseType"],
): ResultSignature => ({
  cardinality,
  baseType,
});

interface Shape {
  readonly count: readonly [number, number];
  readonly operands?: readonly OperandSignature[];
  readonly same?: "base-type" | "both";
  readonly result: ResultSignature;
}

function signature({ count: [minOperands, maxOperands], operands = [], same, result: type }: Shape): OperatorSignature {
  return {
    minOperands,
    maxOperands,
    operands,
    sameBaseType: same !== undefined,
    sameCardinality: same === "both",
    result: type,
  };
}

/** The `maxOperands` of an operator that takes any number of operands. */
export const MANY = Number.POSITIVE_INFINITY;
const BOOLEAN = result("single", "boolean");
const LOGIC = [operand(SINGLE, ["boolean"])];
const NUMBERS = [operand(SINGLE, NUMERIC)];
const NUMBERS_OR_CONTAINERS = [operand(SINGLE_OR_CONTAINER, NUMERIC)];
const INTEGERS = [operand(SINGLE, ["integer"])];
const STRINGS = [operand(SINGLE, ["string"])];
const DURATIONS = [operand(SINGLE, ["duration"])];
const MEMBERSHIP = [operand(SINGLE, COMPARABLE), operand(CONTAINER, COMPARABLE)];

const COMPARISON: Shape = { count: [2, 2], operands: NUMBERS, result: BOOLEAN };
const none = (type: ResultSignature): Shape => ({ count: [0, 0], result: type });

/**
 * The operands and result of every expression of QTI 3.0, by its `kind`: what static checks infer types from, and what
 * evaluation checks the operands against.
 */
export const OPERATOR_SIGNATURES: ReadonlyMap<Expression["kind"], OperatorSignature> = new Map(
  (
    [
      ["and", { count: [1, MANY], operands: LOGIC, result: BOOLEAN }],
      ["any-n", { count: [1, MANY], operands: LOGIC, result: BOOLEAN }],
      ["base-value", none(result("single", "attribute"))],
      [
        "container-size",
        {
          count: [1, 1],
          operands: [operand(CONTAINER)],
          result: result("single", "integer"),
        },
      ],
      [
        "contains",
        {
          count: [2, 2],
          operands: [operand(CONTAINER, COMPARABLE)],
          same: "both",
          result: BOOLEAN,
        },
      ],
      ["correct", none(result("declared", "declared"))],
      [
        "custom-operator",
        {
          count: [0, MANY],
          operands: [operand(CARDINALITIES)],
          result: result("unknown", "unknown"),
        },
      ],
      ["default", none(result("declared", "declared"))],
      [
        "delete",
        {
          count: [2, 2],
          operands: MEMBERSHIP,
          same: "base-type",
          result: result("operand", "operand"),
        },
      ],
      ["divide", { count: [2, 2], operands: NUMBERS, result: result("single", "float") }],
      ["duration-gte", { count: [2, 2], operands: DURATIONS, result: BOOLEAN }],
      ["duration-lt", { count: [2, 2], operands: DURATIONS, result: BOOLEAN }],
      ["equal", COMPARISON],
      ["equal-rounded", COMPARISON],
      [
        "field-value",
        {
          count: [1, 1],
          operands: [operand(["record"])],
          result: result("single", "unknown"),
        },
      ],
      [
        "gcd",
        {
          count: [1, MANY],
          operands: [operand(SINGLE_OR_CONTAINER, ["integer"])],
          result: result("single", "integer"),
        },
      ],
      ["gt", COMPARISON],
      ["gte", COMPARISON],
      [
        "index",
        {
          count: [1, 1],
          operands: [operand(["ordered"])],
          result: result("single", "operand"),
        },
      ],
      [
        "inside",
        {
          count: [1, 1],
          operands: [operand(SINGLE_OR_CONTAINER, ["point"])],
          result: BOOLEAN,
        },
      ],
      ["integer-divide", { count: [2, 2], operands: INTEGERS, result: result("single", "integer") }],
      ["integer-modulus", { count: [2, 2], operands: INTEGERS, result: result("single", "integer") }],
      ["integer-to-float", { count: [1, 1], operands: INTEGERS, result: result("single", "float") }],
      ["is-null", { count: [1, 1], operands: [operand(CARDINALITIES)], result: BOOLEAN }],
      [
        "lcm",
        {
          count: [1, MANY],
          operands: [operand(SINGLE_OR_CONTAINER, ["integer"])],
          result: result("single", "integer"),
        },
      ],
      ["lt", COMPARISON],
      ["lte", COMPARISON],
      ["map-response", none(result("single", "float"))],
      ["map-response-point", none(result("single", "float"))],
      [
        "match",
        {
          count: [2, 2],
          operands: [operand(CARDINALITIES, COMPARABLE)],
          same: "both",
          result: BOOLEAN,
        },
      ],
      ["math-constant", none(result("single", "float"))],
      ["math-operator", { count: [1, 2], operands: NUMBERS, result: result("single", "name") }],
      [
        "max",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
        },
      ],
      ["member", { count: [2, 2], operands: MEMBERSHIP, same: "base-type", result: BOOLEAN }],
      [
        "min",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
        },
      ],
      [
        "multiple",
        {
          count: [0, MANY],
          operands: [operand(["single", "multiple"])],
          same: "base-type",
          result: result("multiple", "operand"),
        },
      ],
      ["not", { count: [1, 1], operands: LOGIC, result: BOOLEAN }],
      ["null", none(result("unknown", "unknown"))],
      ["number-correct", none(result("single", "integer"))],
      ["number-incorrect", none(result("single", "integer"))],
      ["number-presented", none(result("single", "integer"))],
      ["number-responded", none(result("single", "integer"))],
      ["number-selected", none(result("single", "integer"))],
      ["or", { count: [1, MANY], operands: LOGIC, result: BOOLEAN }],
      [
        "ordered",
        {
          count: [0, MANY],
          operands: [operand(["single", "ordered"])],
          same: "base-type",
          result: result("ordered", "operand"),
        },
      ],
      ["outcome-maximum", none(result("multiple", "float"))],
      ["outcome-minimum", none(result("multiple", "float"))],
      ["pattern-match", { count: [1, 1], operands: STRINGS, result: BOOLEAN }],
      ["power", { count: [2, 2], operands: NUMBERS, result: result("single", "float") }],
      [
        "product",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
        },
      ],
      [
        "random",
        {
          count: [1, 1],
          operands: [operand(CONTAINER)],
          result: result("single", "operand"),
        },
      ],
      ["random-float", none(result("single", "float"))],
      ["random-integer", none(result("single", "integer"))],
      [
        "repeat",
        {
          count: [1, MANY],
          operands: [operand(["single", "ordered"])],
          same: "base-type",
          result: result("ordered", "operand"),
        },
      ],
      ["round", { count: [1, 1], operands: NUMBERS, result: result("single", "integer") }],
      ["round-to", { count: [1, 1], operands: NUMBERS, result: result("single", "float") }],
      [
        "stats-operator",
        {
          count: [1, 1],
          operands: [operand(CONTAINER, NUMERIC)],
          result: result("single", "float"),
        },
      ],
      ["string-match", { count: [2, 2], operands: STRINGS, result: BOOLEAN }],
      ["substring", { count: [2, 2], operands: STRINGS, result: BOOLEAN }],
      ["subtract", { count: [2, 2], operands: NUMBERS, result: result("single", "numeric") }],
      [
        "sum",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
        },
      ],
      ["test-variables", none(result("multiple", "attribute"))],
      ["truncate", { count: [1, 1], operands: NUMBERS, result: result("single", "integer") }],
      ["variable", none(result("declared", "declared"))],
    ] satisfies readonly (readonly [Expression["kind"], Shape])[]
  ).map(([kind, shape]) => [kind, signature(shape)]),
);
