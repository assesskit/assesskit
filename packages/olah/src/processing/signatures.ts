import type { Expression } from "../asi/index.js";
import { ProcessingError } from "../errors.js";
import { BASE_TYPES, type BaseType, CARDINALITIES, type Cardinality, type Value } from "../values/index.js";
import { describeType } from "./assign.js";
import { baseTypeOf } from "./operands.js";

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
 * | Cardinality | Meaning |
 * | --- | --- |
 * | a cardinality | that cardinality |
 * | `operand` | that of the container operand |
 * | `declared` | that of the declaration of the variable the expression names |
 * | `unknown` | known only from the value |
 *
 * | Base type | Meaning |
 * | --- | --- |
 * | a base type | that base type |
 * | `numeric` | integer when every operand is an integer, else float |
 * | `operand` | that of the operands |
 * | `declared` | that of the declaration of the variable the expression names |
 * | `attribute` | that of the `base-type` attribute; for `qti-test-variables` without one, `numeric`, and float with a weight |
 * | `name` | integer for the `name`s `signum`, `floor` and `ceil`, float for the others |
 * | `unknown` | known only from the value |
 */
export interface ResultSignature {
  /** The cardinality of the result. */
  readonly cardinality: Cardinality | "operand" | "declared" | "unknown";
  /** The base type of the result. */
  readonly baseType: BaseType | "numeric" | "operand" | "declared" | "attribute" | "name" | "unknown";
}

/** The operands and the result of an operator, as the Information Model defines them (INFO §2.11). */
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
  /** The section of the Information Model that defines the operator. */
  readonly source: string;
}

const SINGLE: readonly Cardinality[] = ["single"];
const CONTAINER: readonly Cardinality[] = ["multiple", "ordered"];
const SINGLE_OR_CONTAINER: readonly Cardinality[] = ["single", "multiple", "ordered"];
const NUMERIC: readonly BaseType[] = ["integer", "float"];
/** The base types `qti-match`, `qti-member`, `qti-delete` and `qti-contains` must not compare: duration (INFO §2.11.3.28). */
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
  readonly source: string;
}

function signature({
  count: [minOperands, maxOperands],
  operands = [],
  same,
  result: type,
  source,
}: Shape): OperatorSignature {
  return {
    minOperands,
    maxOperands,
    operands,
    sameBaseType: same !== undefined,
    sameCardinality: same === "both",
    result: type,
    source,
  };
}

const MANY = Number.POSITIVE_INFINITY;
const BOOLEAN = result("single", "boolean");
const LOGIC = [operand(SINGLE, ["boolean"])];
const NUMBERS = [operand(SINGLE, NUMERIC)];
const NUMBERS_OR_CONTAINERS = [operand(SINGLE_OR_CONTAINER, NUMERIC)];
const INTEGERS = [operand(SINGLE, ["integer"])];
const STRINGS = [operand(SINGLE, ["string"])];
const DURATIONS = [operand(SINGLE, ["duration"])];
const MEMBERSHIP = [operand(SINGLE, COMPARABLE), operand(CONTAINER, COMPARABLE)];

const compare = (source: string): Shape => ({ count: [2, 2], operands: NUMBERS, result: BOOLEAN, source });
const none = (type: ResultSignature, source: string): Shape => ({ count: [0, 0], result: type, source });

/**
 * The operands and result of every expression of QTI 3.0, by its `kind`: what static checks infer types from, and what
 * evaluation checks the operands against.
 */
export const OPERATOR_SIGNATURES: ReadonlyMap<Expression["kind"], OperatorSignature> = new Map(
  (
    [
      ["and", { count: [1, MANY], operands: LOGIC, result: BOOLEAN, source: "INFO §2.11.3.10" }],
      ["any-n", { count: [1, MANY], operands: LOGIC, result: BOOLEAN, source: "INFO §2.11.3.1" }],
      ["base-value", none(result("single", "attribute"), "INFO §2.11.1.1")],
      [
        "container-size",
        {
          count: [1, 1],
          operands: [operand(CONTAINER)],
          result: result("single", "integer"),
          source: "INFO §2.11.3.32",
        },
      ],
      [
        "contains",
        {
          count: [2, 2],
          operands: [operand(CONTAINER, COMPARABLE)],
          same: "both",
          result: BOOLEAN,
          source: "INFO §2.11.3.17",
        },
      ],
      ["correct", none(result("declared", "declared"), "INFO §2.11.1.4")],
      [
        "custom-operator",
        {
          count: [0, MANY],
          operands: [operand(CARDINALITIES)],
          result: result("unknown", "unknown"),
          source: "INFO §2.11.3.2",
        },
      ],
      ["default", none(result("declared", "declared"), "INFO §2.11.1.3")],
      [
        "delete",
        {
          count: [2, 2],
          operands: MEMBERSHIP,
          same: "base-type",
          result: result("operand", "operand"),
          source: "INFO §2.11.3.18",
        },
      ],
      ["divide", { count: [2, 2], operands: NUMBERS, result: result("single", "float"), source: "INFO §2.11.3.19" }],
      ["duration-gte", { count: [2, 2], operands: DURATIONS, result: BOOLEAN, source: "INFO §2.11.3.20" }],
      ["duration-lt", { count: [2, 2], operands: DURATIONS, result: BOOLEAN, source: "INFO §2.11.3.21" }],
      ["equal", compare("INFO §2.11.3.3")],
      ["equal-rounded", compare("INFO §2.11.3.4")],
      [
        "field-value",
        {
          count: [1, 1],
          operands: [operand(["record"])],
          result: result("single", "unknown"),
          source: "INFO §2.11.3.5",
        },
      ],
      [
        "gcd",
        {
          count: [1, MANY],
          operands: [operand(SINGLE_OR_CONTAINER, ["integer"])],
          result: result("single", "integer"),
          source: "INFO §2.11.3.11",
        },
      ],
      ["gt", compare("INFO §2.11.3.22")],
      ["gte", compare("INFO §2.11.3.23")],
      [
        "index",
        {
          count: [1, 1],
          operands: [operand(["ordered"])],
          result: result("single", "operand"),
          source: "INFO §2.11.3.6",
        },
      ],
      [
        "inside",
        {
          count: [1, 1],
          operands: [operand(SINGLE_OR_CONTAINER, ["point"])],
          result: BOOLEAN,
          source: "INFO §2.11.3.7",
        },
      ],
      [
        "integer-divide",
        { count: [2, 2], operands: INTEGERS, result: result("single", "integer"), source: "INFO §2.11.3.24" },
      ],
      [
        "integer-modulus",
        { count: [2, 2], operands: INTEGERS, result: result("single", "integer"), source: "INFO §2.11.3.25" },
      ],
      [
        "integer-to-float",
        { count: [1, 1], operands: INTEGERS, result: result("single", "float"), source: "INFO §2.11.3.33" },
      ],
      ["is-null", { count: [1, 1], operands: [operand(CARDINALITIES)], result: BOOLEAN, source: "INFO §2.11.3.34" }],
      [
        "lcm",
        {
          count: [1, MANY],
          operands: [operand(SINGLE_OR_CONTAINER, ["integer"])],
          result: result("single", "integer"),
          source: "INFO §2.11.3.12",
        },
      ],
      ["lt", compare("INFO §2.11.3.26")],
      ["lte", compare("INFO §2.11.3.27")],
      ["map-response", none(result("single", "float"), "INFO §2.11.1.5")],
      ["map-response-point", none(result("single", "float"), "INFO §2.11.1.6")],
      [
        "match",
        {
          count: [2, 2],
          operands: [operand(CARDINALITIES, COMPARABLE)],
          same: "both",
          result: BOOLEAN,
          source: "INFO §2.11.3.28",
        },
      ],
      ["math-constant", none(result("single", "float"), "INFO §2.11.1.7")],
      [
        "math-operator",
        { count: [1, 2], operands: NUMBERS, result: result("single", "name"), source: "INFO §2.11.3.39" },
      ],
      [
        "max",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
          source: "INFO §2.11.3.14",
        },
      ],
      [
        "member",
        { count: [2, 2], operands: MEMBERSHIP, same: "base-type", result: BOOLEAN, source: "INFO §2.11.3.29" },
      ],
      [
        "min",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
          source: "INFO §2.11.3.13",
        },
      ],
      [
        "multiple",
        {
          count: [0, MANY],
          operands: [operand(["single", "multiple"])],
          same: "base-type",
          result: result("multiple", "operand"),
          source: "INFO §2.11.3.8",
        },
      ],
      ["not", { count: [1, 1], operands: LOGIC, result: BOOLEAN, source: "INFO §2.11.3.35" }],
      ["null", none(result("unknown", "unknown"), "INFO §6.9.19")],
      ["number-correct", none(result("single", "integer"), "INFO §2.11.2.1")],
      ["number-incorrect", none(result("single", "integer"), "INFO §2.11.2.2")],
      ["number-presented", none(result("single", "integer"), "INFO §2.11.2.3")],
      ["number-responded", none(result("single", "integer"), "INFO §2.11.2.4")],
      ["number-selected", none(result("single", "integer"), "INFO §2.11.2.5")],
      ["or", { count: [1, MANY], operands: LOGIC, result: BOOLEAN, source: "INFO §2.11.3.15" }],
      [
        "ordered",
        {
          count: [0, MANY],
          operands: [operand(["single", "ordered"])],
          same: "base-type",
          result: result("ordered", "operand"),
          source: "INFO §2.11.3.9",
        },
      ],
      ["outcome-maximum", none(result("multiple", "float"), "INFO §2.11.2.7")],
      ["outcome-minimum", none(result("multiple", "float"), "INFO §2.11.2.6")],
      ["pattern-match", { count: [1, 1], operands: STRINGS, result: BOOLEAN, source: "INFO §2.11.3.41" }],
      ["power", { count: [2, 2], operands: NUMBERS, result: result("single", "float"), source: "INFO §2.11.3.30" }],
      [
        "product",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
          source: "INFO §2.11.3.16",
        },
      ],
      [
        "random",
        {
          count: [1, 1],
          operands: [operand(CONTAINER)],
          result: result("single", "operand"),
          source: "INFO §2.11.3.36",
        },
      ],
      ["random-float", none(result("single", "float"), "INFO §7.33")],
      ["random-integer", none(result("single", "integer"), "INFO §7.34")],
      [
        "repeat",
        {
          count: [1, MANY],
          operands: [operand(["single", "ordered"])],
          same: "base-type",
          result: result("ordered", "operand"),
          source: "INFO §2.11.3.42",
        },
      ],
      ["round", { count: [1, 1], operands: NUMBERS, result: result("single", "integer"), source: "INFO §2.11.3.37" }],
      ["round-to", { count: [1, 1], operands: NUMBERS, result: result("single", "float"), source: "INFO §2.11.3.43" }],
      [
        "stats-operator",
        {
          count: [1, 1],
          operands: [operand(CONTAINER, NUMERIC)],
          result: result("single", "float"),
          source: "INFO §2.11.3.44",
        },
      ],
      ["string-match", { count: [2, 2], operands: STRINGS, result: BOOLEAN, source: "INFO §2.11.3.45" }],
      ["substring", { count: [2, 2], operands: STRINGS, result: BOOLEAN, source: "INFO §2.11.3.46" }],
      [
        "subtract",
        { count: [2, 2], operands: NUMBERS, result: result("single", "numeric"), source: "INFO §2.11.3.31" },
      ],
      [
        "sum",
        {
          count: [1, MANY],
          operands: NUMBERS_OR_CONTAINERS,
          result: result("single", "numeric"),
          source: "INFO §2.11.3.40",
        },
      ],
      ["test-variables", none(result("multiple", "attribute"), "INFO §2.11.2.8")],
      [
        "truncate",
        { count: [1, 1], operands: NUMBERS, result: result("single", "integer"), source: "INFO §2.11.3.38" },
      ],
      ["variable", none(result("declared", "declared"), "INFO §2.11.1.2")],
    ] satisfies readonly (readonly [Expression["kind"], Shape])[]
  ).map(([kind, shape]) => [kind, signature(shape)]),
);

/** The signatures by any string, so that a kind from untrusted data can be looked up. */
const BY_KIND: ReadonlyMap<string, OperatorSignature> = OPERATOR_SIGNATURES;

function describeCount({ minOperands, maxOperands }: OperatorSignature): string {
  if (maxOperands === MANY) return `${minOperands} or more`;
  return minOperands === maxOperands ? String(minOperands) : `${minOperands} to ${maxOperands}`;
}

function mismatch(kind: string, signature: OperatorSignature, problem: string): ProcessingError {
  return new ProcessingError(`The operator qti-${kind} ${problem}.`, signature.source);
}

function describeOperand(expected: OperandSignature): string {
  const cardinalities = expected.cardinalities.join(" or ");
  return expected.baseTypes === undefined ? cardinalities : `${cardinalities} ${expected.baseTypes.join(" or ")}`;
}

/** Checks one operand that is not NULL against what its position takes. */
function checkOperand(kind: string, signature: OperatorSignature, value: Value, index: number): void {
  const expected = signature.operands[Math.min(index, signature.operands.length - 1)];
  if (expected === undefined) return;
  const baseType = baseTypeOf(value);
  const fits =
    expected.cardinalities.includes(value.cardinality) &&
    (expected.baseTypes === undefined || baseType === undefined || expected.baseTypes.includes(baseType));
  if (!fits) {
    throw mismatch(kind, signature, `takes ${describeOperand(expected)} operands, found ${describeType(value)}`);
  }
}

/**
 * Returns the signature of an expression's kind.
 *
 * @throws `ProcessingError` when the kind is not an expression of QTI 3.0.
 */
function signatureOf(kind: string): OperatorSignature {
  const found = BY_KIND.get(kind);
  if (found !== undefined) return found;
  throw new ProcessingError(
    `The model has the expression kind ${JSON.stringify(kind)}, which QTI 3.0 does not define.`,
    "INFO §2.11",
  );
}

/**
 * Checks the operands of an operator against its signature: their number, and the cardinality and base type of each
 * that is not NULL.
 *
 * @throws `ProcessingError` when they do not fit.
 */
export function checkOperands(kind: string, operands: readonly (Value | null)[]): void {
  const signature = signatureOf(kind);
  if (operands.length < signature.minOperands || operands.length > signature.maxOperands) {
    throw mismatch(kind, signature, `takes ${describeCount(signature)} operands, found ${operands.length}`);
  }
  const present = operands.filter((value) => value !== null);
  operands.forEach((value, index) => {
    if (value !== null) checkOperand(kind, signature, value, index);
  });
  if (signature.sameBaseType && new Set(present.map(baseTypeOf).filter((type) => type !== undefined)).size > 1) {
    throw mismatch(
      kind,
      signature,
      `takes operands of one base type, found ${present.map(describeType).join(" and ")}`,
    );
  }
  if (signature.sameCardinality && new Set(present.map((value) => value.cardinality)).size > 1) {
    throw mismatch(
      kind,
      signature,
      `takes operands of one cardinality, found ${present.map(describeType).join(" and ")}`,
    );
  }
}
