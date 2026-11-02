import { type CatChange, leaveCat as leaveSessions, startCat, submitDue } from "./cat-flow.js";
import { type CatSession, findCat, sectionKeys, withCat } from "./cat-session.js";
import { findDelivered } from "./delivery-state.js";
import { sameKey } from "./plan.js";
import type { Placement } from "./plan-index.js";
import type { Refusal } from "./refusal.js";
import type { StepContext } from "./step-context.js";

/** Returns the CAT session of the adaptive section that holds the placement, `undefined` when none does. */
export function catOf(step: StepContext, placement: Placement): CatSession | undefined {
  for (const section of placement.sections) {
    const session = findCat(step.state, section.identifier, section.instance);
    if (session !== undefined) return session;
  }
  return undefined;
}

/**
 * Whether the adaptive section of the placement waits for the CAT engine, so that the candidate cannot go on: a
 * request waits and the next item of the section has not been presented, or there is none.
 */
export function waitsForCat(step: StepContext, here: Placement): boolean {
  const session = catOf(step, here);
  if (session?.request === undefined) return false;
  const keys = sectionKeys(step.state.plan, session.section, session.instance);
  const next = keys[keys.findIndex((key) => sameKey(key, here.key)) + 1];
  return next === undefined || findDelivered(step.state, next) === undefined;
}

/** Notes that the candidate asked to move on while the session of the placement waits. */
export function markMoving(step: StepContext, here: Placement): void {
  const session = catOf(step, here);
  if (session !== undefined) step.state = withCat(step.state, { ...session, moving: true });
}

/** Applies a step of the CAT flow to the state. */
export function applyCat(step: StepContext, change: CatChange): Refusal | undefined {
  if (!change.ok) return change.refusal;
  step.state = change.state;
  for (const event of change.events) step.events.push(event);
  if (change.outcomes) step.submitted = true;
  return undefined;
}

/** Makes the Submit Results requests that the reporting policy of the section calls for. */
export function requestCat(step: StepContext, at: number): void {
  applyCat(step, submitDue(step.state, at));
}

/** Ends the CAT sessions that the candidate leaves: the sessions for which `leaves` is true. */
export function leaveCat(step: StepContext, at: number, leaves: (session: CatSession) => boolean): void {
  applyCat(step, leaveSessions(step.state, at, leaves));
}

/**
 * Starts the CAT session of an adaptive section the candidate enters: the candidate has no item to see until the
 * engine sends the first stage, so the session presents none.
 */
export function startAdaptive(step: StepContext, section: string, instance: number, at: number): undefined {
  applyCat(step, startCat(step.state, section, instance, at));
  const { current: _left, ...state } = step.state;
  step.state = state;
  return undefined;
}
