import { ProcessingError } from "../errors.js";
import { type BaseType, matchValues, type Primitive, type Value } from "../values/index.js";
import { NUM_ATTEMPTS } from "./built-ins.js";
import { checkContainerSize, type Environment } from "./context.js";
import { itemIdentifier, itemValue, weightOf } from "./item-session.js";
import { asNumber, integerResult, primitiveOf } from "./operands.js";
import type { Scope } from "./scope.js";
import type { ItemSessionFilter, ItemSessionView, TestScope } from "./test-scope.js";

/**
 * The base types that `qti-test-variables` reads without a `base-type`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-test-variables}
 */
const NUMERIC: readonly BaseType[] = ["integer", "float"];

/**
 * The expressions that count item sessions.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type Count = "number-correct" | "number-incorrect" | "number-presented" | "number-responded" | "number-selected";

/**
 * Returns the test of a scope, which only outcome processing has.
 *
 * @throws `ProcessingError` in an item.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function testOf(scope: Scope, kind: string): TestScope {
  if (scope.test === undefined) {
    throw new ProcessingError(
      `The expression qti-${kind} reads the item sessions of a test, so only outcome processing may use it.`,
    );
  }
  return scope.test;
}

/**
 * The attributes that choose item sessions.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
interface Subset {
  readonly sectionIdentifier?: string;
  readonly includeCategory?: readonly string[];
  readonly excludeCategory?: readonly string[];
}

/** Returns the filter that the attributes of an expression give. */
export function filterOf({ sectionIdentifier, includeCategory, excludeCategory }: Subset): ItemSessionFilter {
  return {
    ...(sectionIdentifier === undefined ? {} : { sectionIdentifier }),
    ...(includeCategory === undefined ? {} : { includeCategories: includeCategory }),
    ...(excludeCategory === undefined ? {} : { excludeCategories: excludeCategory }),
  };
}

/**
 * The number of attempts of a session.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function attempts(view: ItemSessionView): number {
  const value = view.variables.responses.get(NUM_ATTEMPTS) ?? null;
  return value === null ? 0 : asNumber(primitiveOf(value));
}

/** Returns whether two values, either NULL, are the same. */
function same(a: Value | null, b: Value | null): boolean {
  return a === null || b === null ? a === b : matchValues(a, b);
}

/**
 * Returns whether each response variable of a session matches its correct response, `undefined` when the item has no
 * response variable or one without a correct response, which the counts of correct and incorrect items leave out.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function correctness(view: ItemSessionView): boolean | undefined {
  const { item, variables } = view;
  if (item.responseDeclarations.length === 0) return undefined;
  let correct = true;
  for (const { identifier } of item.responseDeclarations) {
    const key = variables.correctResponses.get(identifier) ?? null;
    if (key === null) return undefined;
    correct &&= same(variables.responses.get(identifier) ?? null, key);
  }
  return correct;
}

/**
 * Returns whether a session gave a response other than a declared default.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function responded(view: ItemSessionView): boolean {
  const { item, variables } = view;
  return item.responseDeclarations.some(
    ({ identifier }) => !same(variables.responses.get(identifier) ?? null, variables.defaults.get(identifier) ?? null),
  );
}

const COUNTED: ReadonlyMap<Count, (view: ItemSessionView) => boolean> = new Map<
  Count,
  (view: ItemSessionView) => boolean
>([
  ["number-selected", () => true],
  ["number-presented", (view) => attempts(view) > 0],
  ["number-responded", (view) => attempts(view) > 0 && responded(view)],
  ["number-correct", (view) => correctness(view) === true],
  ["number-incorrect", (view) => attempts(view) > 0 && correctness(view) === false],
]);

/**
 * The `qti-number-*` expressions: the item sessions of the subset that were selected; presented, that is attempted at
 * least once; responded, attempted with a response other than a declared default; correct, every response variable
 * matching its correct response; or incorrect, attempted with one that does not.
 *
 * @remarks
 * Correct and incorrect consider only items with response variables that all have correct responses.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function count(kind: Count, sessions: Iterable<ItemSessionView>): Value | null {
  const counted = COUNTED.get(kind) ?? (() => false);
  let total = 0;
  for (const view of sessions) if (counted(view)) total++;
  return integerResult(total);
}

/**
 * `qti-outcome-minimum` and `qti-outcome-maximum`: the `normal-minimum` or `normal-maximum` of the outcome in each
 * session of the subset, weighted, as a multiple float.
 *
 * @remarks
 * Items without the outcome, or with one that is not single, are left out. `outcome-minimum` leaves out items that
 * declare no minimum; `outcome-maximum` is NULL when an item declares no maximum. NULL when no value is left.
 *
 * @throws `SecurityError` when the container would hold more than `maxContainerSize` values.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-outcome-minimum}
 */
export function outcomeBound(
  bound: "minimum" | "maximum",
  sessions: Iterable<ItemSessionView>,
  outcomeIdentifier: string,
  weightIdentifier: string | undefined,
  environment: Environment,
): Value | null {
  const values: number[] = [];
  for (const view of sessions) {
    const identifier = itemIdentifier(view.ref, outcomeIdentifier);
    const declaration = view.item.outcomeDeclarations.find((each) => each.identifier === identifier);
    if (declaration === undefined || declaration.cardinality !== "single") continue;
    const value = bound === "minimum" ? declaration.normalMinimum : declaration.normalMaximum;
    if (value === undefined) {
      if (bound === "maximum") return null;
      continue;
    }
    values.push(value * (weightIdentifier === undefined ? 1 : weightOf(view.ref, weightIdentifier)));
  }
  checkContainerSize(environment, values.length, `qti-outcome-${bound}`);
  return values.length === 0 ? null : { cardinality: "multiple", baseType: "float", values };
}

/**
 * `qti-test-variables`: the values of the variable in each session of the subset, as a multiple container.
 *
 * @remarks
 * Only single values are considered and NULL ones are left out. With `base-type`, only values of that base type count,
 * and the result has it; without, integers and floats count, and the result is an integer container when every value is
 * an integer, else a float one. A weight makes integers and floats floats; it applies only without `base-type` or with
 * `float`, and is ignored with `integer`. NULL when no value is left.
 *
 * @throws `SecurityError` when the container would hold more than `maxContainerSize` values.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-test-variables}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function testVariables(
  sessions: Iterable<ItemSessionView>,
  variableIdentifier: string,
  baseType: BaseType | undefined,
  weightIdentifier: string | undefined,
  environment: Environment,
): Value | null {
  const accepted: readonly BaseType[] = baseType === undefined ? NUMERIC : [baseType];
  const weight = baseType === undefined || baseType === "float" ? weightIdentifier : undefined;
  const values: Primitive[] = [];
  const weighted: number[] = [];
  let integers = true;
  for (const view of sessions) {
    const value = itemValue(view.variables, itemIdentifier(view.ref, variableIdentifier));
    if (value?.cardinality !== "single" || !accepted.includes(value.baseType)) continue;
    values.push(value.value);
    if (value.baseType !== "integer") integers = false;
    if (weight !== undefined) weighted.push(asNumber(value.value) * weightOf(view.ref, weight));
  }
  checkContainerSize(environment, values.length, "qti-test-variables");
  if (values.length === 0) return null;
  if (weight !== undefined) return { cardinality: "multiple", baseType: "float", values: weighted };
  return { cardinality: "multiple", baseType: baseType ?? (integers ? "integer" : "float"), values };
}
