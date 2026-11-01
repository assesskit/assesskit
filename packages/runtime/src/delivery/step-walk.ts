import { describe } from "../checks.js";
import { AssesskitError, DataError } from "../errors.js";
import { MILLISECONDS_PER_SECOND } from "./attempt.js";
import { type CatSession, partOfSection } from "./cat-session.js";
import { type RunningScope, runningScopes } from "./deadlines.js";
import { applyItemAction } from "./item-action.js";
import { closeItem, suspendItem } from "./item-lifecycle.js";
import { type Destination, destinationAfterPart, type RuleContext, TEST_END } from "./navigation.js";
import type { Placement } from "./plan-index.js";
import { type Refusal, refusal } from "./refusal.js";
import { catOf, leaveCat, startAdaptive } from "./step-adaptive.js";
import {
  currentPlacement,
  deliveredOf,
  failed,
  isLinear,
  itemContextOf,
  placementOf,
  rulesOf,
  type StepContext,
  settle,
  submissionModeAt,
} from "./step-context.js";
import { enter } from "./step-entry.js";
import { processOutcomes } from "./step-outcomes.js";

/**
 * Returns the refusal of the first scope whose minimum time is not reached.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function minimumNotReached(scopes: readonly RunningScope[]): Refusal | undefined {
  const early = scopes.find(
    ({ limits, spent }) => limits.minTime !== undefined && spent < limits.minTime * MILLISECONDS_PER_SECOND,
  );
  if (early === undefined) return undefined;
  const name = early.scope === "part" ? "test part" : early.scope;
  return refusal(
    "min-time-not-reached",
    `The ${name} ${describe(early.identifier)} has a minimum time of ${early.limits.minTime} s, of which ${early.spent / MILLISECONDS_PER_SECOND} s are spent.`,
  );
}

/** Runs a walk of the plan; when an expression of a rule fails, the failure is reported and the test ends. */
export function navigate(step: StepContext, at: number, walk: (rules: RuleContext) => Destination): Destination {
  try {
    return walk(rulesOf(step));
  } catch (error) {
    if (!(error instanceof AssesskitError)) throw error;
    failed(step, at, error.message);
    return TEST_END;
  }
}

/** Returns the place that a destination is in: the part and the sections that hold it; `undefined` when it is none. */
export function targetOf(
  step: StepContext,
  destination: Destination,
): Pick<Placement, "part" | "sections"> | undefined {
  if (destination.to === "item") return placementOf(step, destination.key);
  if (destination.to !== "adaptive") return undefined;
  const part = partOfSection(step.state.plan, destination.section, destination.instance);
  if (part === undefined) throw new DataError(`The plan has no section ${describe(destination.section)}.`);
  return { part, sections: [{ identifier: destination.section, instance: destination.instance }] };
}

/** Whether the destination lies in the adaptive section of a session. */
function staysIn(step: StepContext, destination: Destination, session: CatSession): boolean {
  const target = targetOf(step, destination);
  if (target === undefined) return false;
  return target.sections.some((each) => each.identifier === session.section && each.instance === session.instance);
}

/**
 * Ends the CAT session of the section that holds the placement when the candidate goes to a destination outside it
 * and the session waits for no answer: the results not yet reported are sent and the session ends. A session that
 * waits for an answer may still send more items, so it is left as it is.
 */
export function leaveSectionOf(step: StepContext, here: Placement, destination: Destination, at: number): void {
  const session = catOf(step, here);
  if (session === undefined || session.status !== "running" || session.request !== undefined) return;
  if (staysIn(step, destination, session)) return;
  leaveCat(step, at, (each) => each.section === session.section && each.instance === session.instance);
}

/**
 * Leaves the item presented. In a linear test part with individual submission the candidate cannot come back, so an
 * open attempt is submitted, with the checks of skipping and validity, and the session closes; otherwise the session
 * is suspended with its attempt open.
 */
export function leave(step: StepContext, here: Placement, at: number): Refusal | undefined {
  const item = deliveredOf(step, here.key);
  if (!isLinear(step, here) || submissionModeAt(step, here) !== "individual") {
    return settle(step, item, suspendItem(item.session, at));
  }
  const context = itemContextOf(step, here.key);
  if (item.session.attempting) {
    const submit = applyItemAction(item.session, { type: "submit", item: here.key, at }, context);
    const refused = settle(step, item, submit);
    if (refused !== undefined) return refused;
  }
  const left = deliveredOf(step, here.key);
  return settle(step, left, closeItem(left.session, at, context));
}

/**
 * Returns the test part the candidate is in: that of the item presented, else that of the adaptive section whose
 * first stage is awaited.
 */
function currentPart(step: StepContext): string {
  if (step.state.current !== undefined) return currentPlacement(step).part;
  const waiting = step.state.cat.find((session) => session.moving === true);
  const part = waiting === undefined ? undefined : partOfSection(step.state.plan, waiting.section, waiting.instance);
  if (part === undefined) throw new DataError("The state presents no item, though its test has not ended.");
  return part;
}

/** Ends the sessions of the adaptive sections that hold the item presented and not the destination. */
function leaveSectionsFor(step: StepContext, destination: Destination, at: number): void {
  const { current } = step.state;
  if (current === undefined) return;
  const here = placementOf(step, current);
  leaveCat(step, at, (session) => {
    const holds = here.sections.some(
      (each) => each.identifier === session.section && each.instance === session.instance,
    );
    return holds && !staysIn(step, destination, session);
  });
}

/**
 * Ends the test part of the item presented: every session of the part closes, so an open attempt ends with its
 * drafts, which in simultaneous mode submits the group; outcome processing follows. The CAT sessions of the part end,
 * with the results of the attempts that just closed.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function endPart(step: StepContext, at: number): Refusal | undefined {
  const part = currentPart(step);
  for (const item of step.state.items) {
    if (placementOf(step, item.session.key).part !== part) continue;
    const refused = settle(step, item, closeItem(item.session, at, itemContextOf(step, item.session.key)));
    if (refused !== undefined) return refused;
  }
  processOutcomes(step, at);
  leaveCat(step, at, (session) => partOfSection(step.state.plan, session.section, session.instance) === part);
  step.events.push({ type: "part-ended", at, scope: part });
  return undefined;
}

function endTest(step: StepContext, at: number): undefined {
  leaveCat(step, at, () => true);
  const { current: _left, ...state } = step.state;
  step.state = { ...state, status: "ended" };
  step.events.push({ type: "test-ended", at, scope: step.course.structure.test.model.identifier });
  return undefined;
}

/** Goes to an item, starts an adaptive section, or ends the test. */
export function arrive(step: StepContext, destination: Destination, at: number): Refusal | undefined {
  switch (destination.to) {
    case "item":
      return enter(step, destination.key, at);
    case "adaptive":
      return startAdaptive(step, destination.section, destination.instance, at);
    default:
      return endTest(step, at);
  }
}

/** Goes where a walk leads: to an item or an adaptive section, ending the test part when it is in another, or to the end of the part or test. */
export function go(step: StepContext, destination: Destination, at: number): Refusal | undefined {
  const part = currentPart(step);
  if (destination.to === "item" || destination.to === "adaptive") {
    if (targetOf(step, destination)?.part === part) {
      leaveSectionsFor(step, destination, at);
      return arrive(step, destination, at);
    }
    return endPart(step, at) ?? arrive(step, destination, at);
  }
  const refused = endPart(step, at);
  if (refused !== undefined) return refused;
  if (destination.to === "test-end") return endTest(step, at);
  const { structure } = step.course;
  const next = navigate(step, at, (rules) => destinationAfterPart(structure, step.state.plan, part, rules));
  return arrive(step, next, at);
}

/** Ends the test part or the test at the candidate's request, when the minimum times it leaves are reached. */
export function end(step: StepContext, destination: Destination, at: number): Refusal | undefined {
  const leaving = runningScopes(step.course, step.state).filter(
    (scope) => scope.scope !== "test" || destination.to === "test-end",
  );
  return minimumNotReached(leaving) ?? go(step, destination, at);
}
