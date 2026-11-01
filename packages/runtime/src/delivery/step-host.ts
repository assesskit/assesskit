import { describe } from "../checks.js";
import { describeType } from "../processing/index.js";
import { normalizeValue } from "../values/index.js";
import type { HostAction } from "./action.js";
import { answerCat } from "./cat-flow.js";
import { findCat, withCat } from "./cat-session.js";
import { findDelivered } from "./delivery-state.js";
import { destinationAfter, destinationAfterSection } from "./navigation.js";
import { type Refusal, refusal } from "./refusal.js";
import { dueRequests, fitScore } from "./scoring.js";
import { applyCat, requestCat, waitsForCat } from "./step-adaptive.js";
import { placementOf, type StepContext, store } from "./step-context.js";
import { enter } from "./step-entry.js";
import { processOutcomes } from "./step-outcomes.js";
import { go, leaveSectionOf, navigate } from "./step-walk.js";

/**
 * Makes the scoring requests that are due: item outcomes whose session is over, and test outcomes whose covers are
 * over or whose test has ended. The CAT requests that the submissions call for are made with them.
 */
export function reconcile(step: StepContext, at: number): void {
  requestCat(step, at);
  const due = dueRequests(step.course, step.state, at);
  if (due.length === 0) return;
  step.state = { ...step.state, scoring: [...step.state.scoring, ...due] };
  const test = step.course.structure.test.model.identifier;
  for (const request of due) {
    const where = request.item === undefined ? { scope: test } : { item: request.item };
    step.events.push({ type: "scoring-requested", at, ...where, detail: request.id });
  }
}

/**
 * Takes the value that the host supplied for a scoring request: it must fit the declaration; a second supply replaces
 * the first. An item outcome is set in the session without running response processing again; the outcome processing
 * of the test runs again, with the supplied values as the starting values of the external-scored outcomes.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function supply(
  step: StepContext,
  action: HostAction & { readonly type: "supply-scores"; readonly at: number },
): Refusal | undefined {
  const { at } = action;
  const request = step.state.scoring.find(({ id }) => id === action.request);
  if (request === undefined) {
    return refusal("unknown-request", `The state has no scoring request ${describe(action.request)}.`);
  }
  const value = fitScore(request, action.value === null ? null : normalizeValue(action.value));
  if (value === undefined) {
    return refusal(
      "score-type-mismatch",
      `The outcome ${request.outcome} is ${describeType(request.declaration)}, found ${describe(action.value)}.`,
    );
  }
  const replaced = request.supplied !== undefined;
  const supplied = { ...request, supplied: { value, at, scorer: action.scorer } };
  step.state = { ...step.state, scoring: step.state.scoring.map((each) => (each === request ? supplied : each)) };
  const where =
    request.item === undefined ? { scope: step.course.structure.test.model.identifier } : { item: request.item };
  step.events.push({ type: replaced ? "scores-replaced" : "scores-applied", at, ...where, detail: request.id });
  const delivered = request.item === undefined ? undefined : findDelivered(step.state, request.item);
  if (delivered !== undefined) {
    const { variables } = delivered.session;
    const outcomes = new Map(variables.outcomes).set(request.outcome, value);
    store(step, { ...delivered, session: { ...delivered.session, variables: { ...variables, outcomes } } });
  }
  step.submitted = true;
  processOutcomes(step, at);
  return undefined;
}

/**
 * Moves a candidate on who waited for the CAT engine, once nothing is awaited: to the first item of the stage when
 * none was presented, else where the walk leads from the item left. A candidate who is suspended moves on at
 * resuming.
 */
export function continueCat(step: StepContext, at: number): Refusal | undefined {
  const session = step.state.cat.find((each) => each.moving === true && each.request === undefined);
  if (session === undefined || step.state.status !== "in-progress") return undefined;
  const { current } = step.state;
  const first = session.status === "running" ? session.stage[0] : undefined;
  let refused: Refusal | undefined;
  if (current === undefined && first !== undefined) {
    refused = enter(step, first, at);
  } else if (current === undefined) {
    const { structure } = step.course;
    const destination = navigate(step, at, (rules) =>
      destinationAfterSection(structure, step.state.plan, session.section, session.instance, rules),
    );
    refused = go(step, destination, at);
  } else {
    const here = placementOf(step, current);
    const { structure } = step.course;
    const destination = navigate(step, at, (rules) =>
      destinationAfter(structure, step.state.plan, current, current.ref, rules),
    );
    leaveSectionOf(step, here, destination, at);
    if (waitsForCat(step, here)) return undefined;
    refused = go(step, destination, at);
  }
  const still = findCat(step.state, session.section, session.instance);
  if (still !== undefined && still.moving === true) {
    const { moving: _moved, ...rest } = still;
    step.state = withCat(step.state, rest);
  }
  return refused;
}

/** Takes the answer of the CAT engine to a request; a candidate who waited for it moves on. */
export function catResponse(
  step: StepContext,
  action: HostAction & { readonly type: "cat-response"; readonly at: number },
): Refusal | undefined {
  const { at } = action;
  const refused = applyCat(step, answerCat(step.course, step.state, action.request, action.response, at));
  if (refused !== undefined) return refused;
  processOutcomes(step, at);
  return continueCat(step, at);
}
