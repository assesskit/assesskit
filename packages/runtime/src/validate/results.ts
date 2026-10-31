import { checkArray, checkRecord } from "../checks.js";
import type { Issue } from "../errors.js";
import type { AssessmentResult, ItemResult, ResultVariable, SupportUse, TestResult } from "../results/index.js";
import { Findings } from "./findings.js";
import { checkStandardOutcome } from "./standard-outcomes.js";

const ROOT = "assessmentResult";

/** Checks the variables of an item or test result: each identifier once, the standard outcomes, and `normal-maximum`. */
function checkVariables(variables: readonly ResultVariable[], owner: string, findings: Findings): void {
  const seen = new Set<string>();
  for (const variable of variables) {
    const here = `${ROOT}/${owner}/${variable.kind}Variable`;
    if (seen.has(variable.identifier)) {
      const message = `The ${owner} reports the variable ${JSON.stringify(variable.identifier)} twice; the identifiers of its variables must be unique.`;
      findings.error("assesskit/validate/duplicate-identifier", message, here);
    }
    seen.add(variable.identifier);
    if (variable.kind !== "outcome") continue;
    checkStandardOutcome(findings, variable.identifier, variable.baseType, here);
    if (variable.normalMaximum !== undefined && variable.normalMaximum <= 0) {
      const message = `The outcome ${variable.identifier} has the normal-maximum ${variable.normalMaximum}, which must be a positive value.`;
      findings.error("assesskit/validate/normal-maximum", message, here);
    }
  }
}

/** Checks that a support reports no setting when it was prohibited. */
function checkSupports(supports: readonly SupportUse[], owner: string, findings: Findings): void {
  for (const support of supports) {
    if (support.assignment !== "prohibited" || support.value === undefined) continue;
    const message = `The support ${support.name} is prohibited, so the ${owner} must not report a value for it.`;
    findings.error("assesskit/validate/support-value", message, `${ROOT}/${owner}/support`);
  }
}

/**
 * Checks the item results of a test: each has a `sequenceIndex` that places its item instance in the session,
 * and no two item instances share one. The item results of one instance, such as its attempts, share it.
 */
function checkSequence(itemResults: readonly ItemResult[], findings: Findings): void {
  const places = new Map<number, string>();
  for (const { identifier, sequenceIndex } of itemResults) {
    const here = `${ROOT}/itemResult`;
    if (sequenceIndex === undefined) {
      const message = `The item result ${JSON.stringify(identifier)} is part of a test result, so it must have a sequenceIndex, the position of the item in the session.`;
      findings.error("assesskit/validate/sequence-index", message, here);
      continue;
    }
    const earlier = places.get(sequenceIndex);
    if (earlier !== undefined && earlier !== identifier) {
      const message = `The item result ${JSON.stringify(identifier)} has the sequenceIndex ${sequenceIndex}, which the item result ${JSON.stringify(earlier)} has; each item instance of the session has its own position.`;
      findings.error("assesskit/validate/sequence-index", message, here);
    }
    places.set(sequenceIndex, earlier ?? identifier);
  }
}

function checkTestResult(testResult: TestResult, itemResults: readonly ItemResult[], findings: Findings): void {
  checkVariables(testResult.variables, "testResult", findings);
  checkSupports(testResult.supports, "testResult", findings);
  checkSequence(itemResults, findings);
}

/** Checks the parts of a report that the checks read: the arrays of results, variables and supports. */
function checkShape(result: AssessmentResult): void {
  checkRecord(result, "The result must be an object of the model of an assessment result");
  checkArray(result.itemResults, "The item results of the result must be an array");
  const results: unknown[] = [...result.itemResults, ...(result.testResult === undefined ? [] : [result.testResult])];
  for (const each of results) {
    checkRecord(each, "An item result and a test result must be objects");
    checkArray(each.variables, "The variables of a result must be an array");
    checkArray(each.supports, "The supports of a result must be an array");
    for (const variable of [...each.variables, ...each.supports]) {
      checkRecord(variable, "A variable and a support of a result must be objects");
    }
  }
}

/**
 * Validates a results report beyond its schema: in a test result each item result has its own `sequenceIndex`; the
 * variables of a result have unique identifiers, `SCORE`, `MAXSCORE` and `PASSED` the base types the specification gives
 * them as a warning, and an outcome a positive `normal-maximum`; and a prohibited support reports no value.
 *
 * @param result - The report, as `readResults` reads it.
 * @returns The issues in document order; none when the report is valid.
 * @throws `DataError` when `result` is not an object of the model of `AssessmentResult`.
 */
export function validateResults(result: AssessmentResult): readonly Issue[] {
  checkShape(result);
  const findings = new Findings();
  if (result.testResult !== undefined) checkTestResult(result.testResult, result.itemResults, findings);
  for (const item of result.itemResults) {
    checkVariables(item.variables, "itemResult", findings);
    checkSupports(item.supports, "itemResult", findings);
  }
  return findings.issues;
}
