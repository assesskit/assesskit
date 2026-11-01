import { describe } from "../checks.js";
import type { Action } from "./action.js";
import { type RunningScope, runningScopes } from "./deadlines.js";
import { applyItemAction, type ItemAction } from "./item-action.js";
import { suspendItem } from "./item-lifecycle.js";
import { type Destination, destinationAfter, previousItem } from "./navigation.js";
import { type ItemKey, sameKey } from "./plan.js";
import { liesIn, type Placement, planIndex } from "./plan-index.js";
import { type Refusal, refusal } from "./refusal.js";
import { markMoving, requestCat, waitsForCat } from "./step-adaptive.js";
import {
  currentPlacement,
  deliveredOf,
  expiriesAt,
  isLinear,
  itemContextOf,
  placementOf,
  type StepContext,
  settle,
  submissionModeAt,
} from "./step-context.js";
import { enter } from "./step-entry.js";
import { processOutcomes } from "./step-outcomes.js";
import { go, leave, leaveSectionOf, minimumNotReached, navigate, targetOf } from "./step-walk.js";

/** The actions on an item that end its attempt, which a test part with simultaneous submission does at its end. */
const SUBMISSIONS: ReadonlySet<Action["type"]> = new Set(["submit", "skip", "end-attempt"]);

/**
 * Whether going from the item presented to a destination leaves a running scope: the test at its end; the test part and
 * its sections for another part; a section that the item of the same part does not lie in. The item itself is left
 * before the walk.
 */
function leaves(
  scope: RunningScope,
  here: Placement,
  destination: Destination,
  target: Pick<Placement, "part" | "sections"> | undefined,
): boolean {
  if (scope.scope === "test") return destination.to === "test-end";
  if (scope.scope === "item") return false;
  if (target === undefined || target.part !== here.part) return true;
  return scope.scope === "section" && !liesIn(target, scope);
}

function timeOver(key: ItemKey): Refusal {
  const message = `The item instance ${describe(key.ref)} ${key.instance} was closed when a maximum time passed.`;
  return refusal("time-over", message);
}

function backward(): Refusal {
  return refusal("linear-backward", "The test part is linear, so the candidate moves forward only.");
}

/** Applies an action on an item: its session takes it, and outcome processing follows an attempt that ended. */
export function act(step: StepContext, action: ItemAction & { readonly at: number }): Refusal | undefined {
  const { item: key, at } = action;
  const placement = planIndex(step.state.plan).placement(key);
  if (placement === undefined) {
    return refusal("unknown-item", `The test has no item instance ${describe(key.ref)} ${key.instance}.`);
  }
  if (expiriesAt(step, placement).includes("closed")) return timeOver(key);
  const { current } = step.state;
  if (current === undefined || !sameKey(key, current)) {
    return refusal("not-current", "The action names an item that is not the one presented.");
  }
  if (SUBMISSIONS.has(action.type) && submissionModeAt(step, placement) === "simultaneous") {
    const message = "The test part submits its items together at its end, so an item is not submitted alone.";
    return refusal("wrong-submission-mode", message);
  }
  const item = deliveredOf(step, key);
  const refused = settle(step, item, applyItemAction(item.session, action, itemContextOf(step, key)));
  if (refused !== undefined) return refused;
  processOutcomes(step, at);
  return undefined;
}

/** Moves within a nonlinear test part: the item presented is suspended, with its attempt open. */
function goTo(step: StepContext, here: Placement, key: ItemKey, at: number): Refusal | undefined {
  if (expiriesAt(step, placementOf(step, key)).includes("closed")) return timeOver(key);
  const item = deliveredOf(step, here.key);
  const refused = settle(step, item, suspendItem(item.session, at));
  return refused ?? enter(step, key, at);
}

/**
 * Leaves the item presented for what follows it: the minimum time of the item must be reached; the item is left; the
 * walk decides where to go, and the minimum times of the sections, part and test that this leaves must be reached. In
 * an adaptive section the candidate waits where the next item depends on the CAT engine: it is refused `awaiting-cat`
 * while a request waits, and when leaving makes the engine send one, the move goes on when the answer has come.
 */
function next(step: StepContext, here: Placement, at: number): Refusal | undefined {
  const running = runningScopes(step.course, step.state);
  const early = minimumNotReached(running.filter((scope) => scope.scope === "item"));
  if (early !== undefined) return early;
  if (waitsForCat(step, here)) {
    return refusal("awaiting-cat", "The adaptive section waits for the CAT engine to send the next items.");
  }
  const refused = leave(step, here, at);
  if (refused !== undefined) return refused;
  processOutcomes(step, at);
  requestCat(step, at);
  const { structure } = step.course;
  const destination = navigate(step, at, (rules) =>
    destinationAfter(structure, step.state.plan, here.key, here.key.ref, rules),
  );
  const left = running.filter((scope) => leaves(scope, here, destination, targetOf(step, destination)));
  const tooEarly = minimumNotReached(left);
  if (tooEarly !== undefined) return tooEarly;
  leaveSectionOf(step, here, destination, at);
  if (waitsForCat(step, here)) {
    markMoving(step, here);
    return undefined;
  }
  return go(step, destination, at);
}

/** Moves the candidate to the next or previous item, or to an item instance of the test part presented. */
export function move(step: StepContext, to: "next" | "previous" | ItemKey, at: number): Refusal | undefined {
  const here = currentPlacement(step);
  if (to === "next") return next(step, here, at);
  const linear = isLinear(step, here);
  if (to === "previous") {
    if (linear) return backward();
    const previous = previousItem(step.course.structure, step.state.plan, here.key);
    if (previous === undefined) {
      return refusal("unknown-item", "The test part has no item before the one presented.");
    }
    return goTo(step, here, previous, at);
  }
  const target = planIndex(step.state.plan).placement(to);
  if (target === undefined) {
    return refusal("unknown-item", `The test has no item instance ${describe(to.ref)} ${to.instance}.`);
  }
  if (target.part !== here.part) {
    const message = "The candidate moves within the test part presented; a test part is left at its end.";
    return refusal("not-current", message);
  }
  if (sameKey(target.key, here.key)) return undefined;
  if (!linear) return goTo(step, here, target.key, at);
  if (target.order < here.order) return backward();
  const refused = next(step, here, at);
  if (refused !== undefined) return refused;
  const { current } = step.state;
  if (current !== undefined && sameKey(current, target.key)) return undefined;
  return refusal("not-current", "In a linear test part the candidate moves to the next item only.");
}
