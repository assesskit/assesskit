import { AssesskitError } from "../errors.js";
import { runOutcomeProcessing } from "../processing/index.js";
import type { Value } from "../values/index.js";
import { catTestOutcomes } from "./cat-outcomes.js";
import { suppliedTestOutcomes } from "./scoring.js";
import { SessionScope } from "./session-scope.js";
import { failed, processingOf, type StepContext } from "./step-context.js";

/**
 * Returns the values that outcome processing starts the external-scored outcomes of the test from: those a scorer
 * supplied, and those a CAT engine reported, which the reset of test outcomes before each run would otherwise erase.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function keptOutcomes(step: StepContext): Map<string, Value | null> {
  return new Map<string, Value | null>([...catTestOutcomes(step.state), ...suppliedTestOutcomes(step.state)]);
}

/**
 * Runs the outcome processing of the test once after the attempts that ended, the submission of an item in individual
 * mode or of a group in simultaneous mode, before the engine decides where to go. The outcomes start from their
 * defaults; when processing fails, they keep them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function processOutcomes(step: StepContext, at: number): void {
  if (!step.submitted) return;
  step.submitted = false;
  const { test } = step.course.structure;
  const kept = keptOutcomes(step);
  try {
    const outcomes = runOutcomeProcessing(
      test.model,
      kept,
      new SessionScope(step.course, step.state),
      processingOf(step),
    );
    step.state = { ...step.state, outcomes };
    step.events.push({ type: "outcome-processed", at, scope: test.model.identifier });
  } catch (error) {
    if (!(error instanceof AssesskitError)) throw error;
    step.state = { ...step.state, outcomes: new Map([...step.course.outcomes, ...kept]) };
    failed(step, at, error.message);
  }
}
