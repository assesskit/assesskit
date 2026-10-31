import type { AssessmentTest, Expression } from "../asi/index.js";
import { checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import { checkContext, type ProcessingContext } from "./context.js";
import { evaluateIn } from "./evaluate.js";
import { runOutcomeRules } from "./outcome-rules.js";
import { OutcomeScope } from "./outcome-scope.js";
import type { TestScope } from "./test-scope.js";

/** The kind of the model of `qti-assessment-test`. */
const TEST_KIND = "assessment-test";

/**
 * Checks a test and a test scope shallowly.
 *
 * @throws `DataError` when they are not.
 */
function checkTest(test: AssessmentTest, scope: TestScope): void {
  checkRecord(test, "The test must be an object of the model of qti-assessment-test");
  if (test.kind !== TEST_KIND) {
    throw new DataError(`The test must be the model of a qti-assessment-test, found the kind ${describe(test.kind)}.`);
  }
  checkRecord(scope, "The test scope must be an object");
  for (const method of ["itemSessions", "itemSession", "variable"] as const) {
    if (typeof scope[method] !== "function") {
      throw new DataError(`The test scope must have a function ${method}, found ${describe(scope[method])}.`);
    }
  }
}

/**
 * Runs the outcome processing of a test.
 *
 * @remarks
 * The outcomes start from the values given, and an outcome left out starts from its default value, else 0 for a single
 * integer or float, else NULL; the specification resets them to their defaults before each run, so the delivery engine
 * gives only the values that a reset keeps, such as supplied external scores. The rules run in order:
 * `qti-set-outcome-value` and `qti-lookup-outcome-value` set outcomes, a condition runs its first true branch, a
 * fragment its rules, and `qti-exit-test` ends processing.
 *
 * Expressions read the test's outcomes, and through the scope its other variables, item variables as `ITEM.VAR` and
 * `ITEM.n.VAR` with the item ref's variable mappings and weights, and the item sessions that `qti-number-*`,
 * `qti-outcome-minimum`, `qti-outcome-maximum` and `qti-test-variables` read.
 *
 * @param test - The test, as `readAsi` reads it, with its includes resolved.
 * @param outcomes - The values the outcomes start from, by identifier.
 * @param scope - The item sessions and the other variables of the test.
 * @param context - The source of random draws, the custom operators and the limits.
 * @returns The value of every outcome of the test.
 * @throws `DataError` when an argument has the wrong type, or an outcome given is not declared or does not fit.
 * @throws `ProcessingError` when an include is left, a rule sets something other than an outcome of the test or with a
 * value of another type, or an expression fails.
 * @throws `SecurityError` when a container would exceed `maxContainerSize`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-set-outcome-value}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function runOutcomeProcessing(
  test: AssessmentTest,
  outcomes: ReadonlyMap<string, Value | null>,
  scope: TestScope,
  context: ProcessingContext,
): ReadonlyMap<string, Value | null> {
  checkTest(test, scope);
  const target = new OutcomeScope(test, outcomes, scope, checkContext(context));
  runOutcomeRules(test.outcomeProcessing?.rules ?? [], target);
  return target.values();
}

/**
 * Evaluates an expression of a test: a pre-condition, a branch rule or a template default.
 *
 * @remarks
 * It reads what outcome processing reads; outcomes left out of `outcomes` have their starting values, as in
 * {@link runOutcomeProcessing}.
 *
 * @param expression - The expression, as `readAsi` reads it.
 * @param test - The test.
 * @param outcomes - The values of the outcomes of the test, by identifier.
 * @param scope - The item sessions and the other variables of the test.
 * @param context - The source of random draws, the custom operators and the limits.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when an argument has the wrong type, or an outcome given is not declared or does not fit.
 * @throws `ProcessingError` when the expression reads a variable that does not exist, gives an operator an operand of
 * the wrong type, or uses a custom operator that is not registered.
 * @throws `SecurityError` when a container would exceed `maxContainerSize`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function evaluateTestExpression(
  expression: Expression,
  test: AssessmentTest,
  outcomes: ReadonlyMap<string, Value | null>,
  scope: TestScope,
  context: ProcessingContext,
): Value | null {
  checkRecord(expression, "The expression must be an object of the model");
  checkTest(test, scope);
  return evaluateIn(expression, new OutcomeScope(test, outcomes, scope, checkContext(context)));
}
