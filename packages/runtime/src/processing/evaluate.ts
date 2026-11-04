import type { AssessmentItem, Expression } from "../asi/index.js";
import { checkRecord } from "../checks.js";
import type { Value } from "../values/index.js";
import {
  aggregate,
  divide,
  extremum,
  gcd,
  integerDivision,
  integerToFloat,
  lcm,
  power,
  subtract,
  toInteger,
} from "./arithmetic.js";
import { checkOperands } from "./check-operands.js";
import { compare, equal, equalRounded, match, toleranceOf } from "./comparison.js";
import {
  collect,
  containerSize,
  contains,
  deleteValue,
  fieldValue,
  index,
  isNull,
  member,
  random,
  repeat,
} from "./containers.js";
import { checkContext, type ProcessingContext } from "./context.js";
import { customOperator } from "./custom-operator.js";
import { readSingle } from "./declared-value.js";
import { ItemScope } from "./item-scope.js";
import { and, anyN, not, or } from "./logic.js";
import { mapResponse, mapResponsePoint } from "./mapping.js";
import { mathOperator } from "./math-operator.js";
import { floatResult } from "./operands.js";
import { DEFAULT_RANDOM_MIN, DEFAULT_RANDOM_STEP, randomFloat, randomInteger } from "./random-values.js";
import { floatAttribute, integerAttribute, stringAttribute } from "./references.js";
import { roundTo } from "./rounding.js";
import type { Scope } from "./scope.js";
import { inside } from "./shapes.js";
import { statsOperator } from "./stats-operator.js";
import { patternMatch, stringMatch, substring } from "./strings.js";
import { count, filterOf, outcomeBound, testOf, testVariables } from "./test-expressions.js";
import { checkItem, checkVariables, type ItemVariables } from "./variables.js";

/**
 * The constants of `qti-math-constant`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-math-constant}
 */
const MATH_CONSTANTS: ReadonlyMap<string, number> = new Map([
  ["pi", Math.PI],
  ["e", Math.E],
]);

/**
 * The rounding mode of `qti-equal-rounded` when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-equal-rounded}
 */
const DEFAULT_ROUNDING_MODE = "significantFigures";

/**
 * The tolerance mode of `qti-equal` when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-equal}
 */
const DEFAULT_TOLERANCE_MODE = "exact";

/**
 * Whether `qti-equal` includes a bound when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-equal}
 */
const DEFAULT_INCLUDE_BOUND = true;

/**
 * Returns the expressions of the operands of an expression, in order.
 *
 * @param expression - The expression.
 * @returns The expressions of its operands; none when it has none.
 */
export function listOperands(expression: Expression): readonly Expression[] {
  if ("operands" in expression) return expression.operands;
  return "operand" in expression ? [expression.operand] : [];
}

/** The values of the `qti-base-value` elements read so far: an expression never changes, so its text is read once. */
const BASE_VALUES = new WeakMap<Expression, Value | null>();

/**
 * Returns the value of a `qti-base-value`.
 *
 * @throws `ProcessingError` when its text is not in the lexical form of its base type.
 */
function baseValue(expression: Extract<Expression, { readonly kind: "base-value" }>): Value | null {
  const known = BASE_VALUES.get(expression);
  if (known !== undefined) return known;
  const value = readSingle(expression.value, expression.baseType, "The base value");
  BASE_VALUES.set(expression, value);
  return value;
}

/** Applies an operator to the values of its operands, which fit its signature. */
function apply(expression: Expression, operands: readonly (Value | null)[], scope: Scope): Value | null {
  const a = operands[0] ?? null;
  const b = operands[1] ?? null;
  const { environment } = scope;
  // The switch compares the kind with each case in turn, so the leaves, which are most of the nodes of a tree, come first.
  switch (expression.kind) {
    case "base-value":
      return baseValue(expression);
    case "null":
      return null;
    case "variable":
      return scope.variable(expression.identifier, expression.weightIdentifier);
    case "and":
      return and(operands);
    case "or":
      return or(operands);
    case "not":
      return not(a);
    case "any-n":
      return anyN(
        operands,
        integerAttribute(expression.min, scope, "min"),
        integerAttribute(expression.max, scope, "max"),
      );
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "duration-lt":
    case "duration-gte":
      return compare(expression.kind, a, b);
    case "equal": {
      const amounts = (expression.tolerance ?? []).map((amount) => floatAttribute(amount, scope, "tolerance"));
      const tolerance = toleranceOf(
        expression.toleranceMode ?? DEFAULT_TOLERANCE_MODE,
        amounts,
        expression.includeLowerBound ?? DEFAULT_INCLUDE_BOUND,
        expression.includeUpperBound ?? DEFAULT_INCLUDE_BOUND,
      );
      return equal(a, b, tolerance);
    }
    case "equal-rounded":
      return equalRounded(
        a,
        b,
        expression.roundingMode ?? DEFAULT_ROUNDING_MODE,
        integerAttribute(expression.figures, scope, "figures"),
      );
    case "match":
      return match(a, b);
    case "sum":
    case "product":
      return aggregate(expression.kind, operands);
    case "subtract":
      return subtract(a, b);
    case "divide":
      return divide(a, b);
    case "power":
      return power(a, b);
    case "integer-divide":
    case "integer-modulus":
      return integerDivision(expression.kind, a, b);
    case "gcd":
      return gcd(operands);
    case "lcm":
      return lcm(operands);
    case "min":
    case "max":
      return extremum(expression.kind, operands);
    case "round":
    case "truncate":
      return toInteger(expression.kind, a);
    case "round-to":
      return roundTo(a, expression.roundingMode, integerAttribute(expression.figures, scope, "figures"));
    case "integer-to-float":
      return integerToFloat(a);
    case "math-operator":
      return mathOperator(expression.name, operands);
    case "math-constant":
      return floatResult(MATH_CONSTANTS.get(expression.name) ?? Number.NaN);
    case "stats-operator":
      return statsOperator(expression.name, a);
    case "multiple":
    case "ordered":
      return collect(expression.kind, operands, environment);
    case "repeat":
      return repeat(operands, integerAttribute(expression.numberRepeats, scope, "number-repeats"), environment);
    case "container-size":
      return containerSize(a);
    case "is-null":
      return isNull(a);
    case "member":
      return member(a, b);
    case "delete":
      return deleteValue(a, b);
    case "contains":
      return contains(a, b);
    case "index":
      return index(a, integerAttribute(expression.n, scope, "n"));
    case "random":
      return random(a, environment);
    case "field-value":
      return fieldValue(a, expression.fieldIdentifier);
    case "inside":
      return inside(a, expression.shape, expression.coords);
    case "string-match":
      return stringMatch(a, b, expression.caseSensitive, expression.substring ?? false);
    case "substring":
      return substring(a, b, expression.caseSensitive);
    case "pattern-match":
      return patternMatch(a, stringAttribute(expression.pattern, scope, "pattern"));
    case "custom-operator":
      return customOperator(expression, operands, environment);
    case "default":
      return scope.defaultValue(expression.identifier);
    case "correct":
      return scope.correctResponse(expression.identifier);
    case "map-response":
      return mapResponse(scope.response(expression.identifier));
    case "map-response-point":
      return mapResponsePoint(scope.response(expression.identifier));
    case "random-integer":
      return randomInteger(
        integerAttribute(expression.min ?? DEFAULT_RANDOM_MIN, scope, "min"),
        integerAttribute(expression.max, scope, "max"),
        integerAttribute(expression.step ?? DEFAULT_RANDOM_STEP, scope, "step"),
        environment,
      );
    case "random-float":
      return randomFloat(
        floatAttribute(expression.min ?? DEFAULT_RANDOM_MIN, scope, "min"),
        floatAttribute(expression.max, scope, "max"),
        environment,
      );
    case "number-correct":
    case "number-incorrect":
    case "number-presented":
    case "number-responded":
    case "number-selected":
      return count(expression.kind, testOf(scope, expression.kind).itemSessions(filterOf(expression)));
    case "outcome-minimum":
    case "outcome-maximum": {
      const sessions = testOf(scope, expression.kind).itemSessions(filterOf(expression));
      const bound = expression.kind === "outcome-minimum" ? "minimum" : "maximum";
      return outcomeBound(bound, sessions, expression.outcomeIdentifier, expression.weightIdentifier, environment);
    }
    case "test-variables": {
      const sessions = testOf(scope, expression.kind).itemSessions(filterOf(expression));
      const { variableIdentifier, baseType, weightIdentifier } = expression;
      return testVariables(sessions, variableIdentifier, baseType, weightIdentifier, environment);
    }
  }
}

/**
 * Evaluates an expression in a scope: its operands first, checked against its signature, then the operator.
 *
 * @throws `ProcessingError` when the expression is not one of QTI 3.0, an operand does not fit the operator, or the
 * operator fails.
 */
export function evaluateIn(expression: Expression, scope: Scope): Value | null {
  checkRecord(expression, "An expression must be an object of the model");
  const expressions = listOperands(expression);
  const operands: (Value | null)[] = [];
  for (const operand of expressions) operands.push(evaluateIn(operand, scope));
  checkOperands(expression.kind, operands);
  return apply(expression, operands, scope);
}

/**
 * Evaluates an expression with the variables of an item session: a tree interpreter with the semantics of the
 * Information Model, NULL as `null`.
 *
 * @remarks
 * Every variable of the item is in reach; the expressions of outcome processing are not, as they read the sessions of a
 * test (use `evaluateTestExpression`).
 *
 * @param expression - The expression, as `readAsi` reads it.
 * @param variables - The variables, as `createItemVariables` and the processing functions return them.
 * @param item - The item that declares them.
 * @param context - The source of random draws, the custom operators and the limits.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ProcessingError` when the expression reads a variable the item does not declare, gives an operator an
 * operand of the wrong type, or uses a custom operator that is not registered: conditions the specification does not
 * define as NULL.
 * @throws `SecurityError` when a container would exceed `maxContainerSize`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function evaluate(
  expression: Expression,
  variables: ItemVariables,
  item: AssessmentItem,
  context: ProcessingContext,
): Value | null {
  checkRecord(expression, "The expression must be an object of the model");
  checkVariables(variables);
  checkItem(item);
  return evaluateIn(expression, new ItemScope(item, variables, checkContext(context), "item"));
}
