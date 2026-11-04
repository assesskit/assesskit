import type { Expression, NumericExpression, ResponseRule } from "../asi/index.js";
import { AssesskitError } from "../errors.js";

// Builders of the models of the expressions and rules that compileScoring writes, so that the schemes read as QTI does.

/** The models of the rules of a response condition, as a response processing holds them. */
export type Rules = readonly ResponseRule[];

/** `qti-variable`: the value of a variable. */
export function variable(identifier: string): NumericExpression {
  return { kind: "variable", identifier };
}

/** `qti-base-value` of the base type `float`, written as JavaScript writes a number, which is a valid `xs:double`. */
export function float(value: number): NumericExpression {
  return { kind: "base-value", baseType: "float", value: String(value) };
}

/** `qti-base-value` of the base type `integer`. */
export function integer(value: number): NumericExpression {
  return { kind: "base-value", baseType: "integer", value: String(value) };
}

/** `qti-base-value` of the base type `identifier`. */
export function identifier(value: string): NumericExpression {
  return { kind: "base-value", baseType: "identifier", value };
}

/** `qti-sum` of its operands. */
export function sum(operands: readonly NumericExpression[]): NumericExpression {
  return { kind: "sum", operands };
}

/** `qti-product` of its operands. */
export function product(operands: readonly NumericExpression[]): NumericExpression {
  return { kind: "product", operands };
}

/** `qti-max` of its operands, NULL when one is NULL. */
export function max(operands: readonly NumericExpression[]): NumericExpression {
  return { kind: "max", operands };
}

/** `qti-subtract` of two numbers. */
export function subtract(first: NumericExpression, second: NumericExpression): NumericExpression {
  return { kind: "subtract", operands: [first, second] };
}

/** `qti-divide` of two numbers. */
export function divide(first: NumericExpression, second: NumericExpression): NumericExpression {
  return { kind: "divide", operands: [first, second] };
}

/** `qti-ordered` of its operands: an ordered container. */
export function ordered(operands: readonly Expression[]): NumericExpression {
  return { kind: "ordered", operands };
}

/** `qti-multiple` of its operands: a container that leaves out NULL. */
export function multiple(operands: readonly Expression[]): NumericExpression {
  return { kind: "multiple", operands };
}

/** `qti-and` of its operands. */
export function and(operands: readonly Expression[]): Expression {
  return { kind: "and", operands };
}

/** `qti-or` of its operands. */
export function or(operands: readonly Expression[]): Expression {
  return { kind: "or", operands };
}

/** `qti-gte`, `qti-gt`, `qti-match` or `qti-contains` of two operands. */
export function compare(
  kind: "gte" | "gt" | "match" | "contains",
  first: NumericExpression,
  second: NumericExpression,
): Expression {
  return { kind, operands: [first, second] };
}

/** `qti-is-null`: whether a value is NULL. */
export function isNull(operand: Expression): Expression {
  return { kind: "is-null", operand };
}

/** `qti-map-response` of a response with a `qti-mapping`. */
export function mapResponse(response: string): NumericExpression {
  return { kind: "map-response", identifier: response };
}

/** `qti-map-response-point` of a response of points with a `qti-area-mapping`. */
export function mapResponsePoint(response: string): NumericExpression {
  return { kind: "map-response-point", identifier: response };
}

/** `qti-correct`: the correct response of a response. */
export function correct(response: string): NumericExpression {
  return { kind: "correct", identifier: response };
}

/** `qti-index`: the nth value of an ordered container, from 1; NULL past its end. */
export function index(operand: NumericExpression, n: number): NumericExpression {
  return { kind: "index", n, operand };
}

/** `qti-container-size`: the count of a container's values, 0 for NULL. */
export function containerSize(operand: Expression): NumericExpression {
  return { kind: "container-size", operand };
}

/**
 * `qti-equal` of a key's value, first, and a response, second: QTI builds the tolerance's range around the first operand,
 * `absolute` as [x − t, x + t] and `relative` as [x(1 − t/100), x(1 + t/100)], in percent.
 */
export function equal(
  value: NumericExpression,
  response: NumericExpression,
  mode: "exact" | "absolute" | "relative",
  amount = 0,
): Expression {
  return mode === "exact"
    ? { kind: "equal", toleranceMode: "exact", operands: [value, response] }
    : { kind: "equal", toleranceMode: mode, tolerance: [amount, amount], operands: [value, response] };
}

/** `qti-set-outcome-value`. */
export function setOutcome(outcome: string, expression: Expression): ResponseRule {
  return { kind: "set-outcome-value", identifier: outcome, expression };
}

/** `qti-response-condition` of several tests in order: the first that holds sets its rules, else the last rules. */
export function chain(branches: readonly (readonly [Expression, Rules])[], otherwise: Rules = []): ResponseRule {
  const [first, ...rest] = branches;
  if (first === undefined) throw new AssesskitError("A condition has at least one branch.");
  return {
    kind: "response-condition",
    responseIf: { kind: "response-if", condition: first[0], rules: [...first[1]] },
    responseElseIfs: rest.map(([test, rules]) => ({ kind: "response-else-if", condition: test, rules: [...rules] })),
    ...(otherwise.length === 0 ? {} : { responseElse: { kind: "response-else", rules: [...otherwise] } }),
  };
}

/** Rules that set an outcome to an expression, and to 0 where the expression is NULL, as for a blank response. */
export function setPoints(outcome: string, expression: Expression): Rules {
  return [setOutcome(outcome, expression), chain([[isNull(variable(outcome)), [setOutcome(outcome, integer(0))]]])];
}
