import { maximumAt, type RunningScope, runningScopes } from "./deadlines.js";
import type { Expiry, ScopeClock } from "./delivery-state.js";
import { closeItem } from "./item-lifecycle.js";
import { destinationAfter, PART_END, TEST_END } from "./navigation.js";
import { sameKey } from "./plan.js";
import { liesIn } from "./plan-index.js";
import type { Refusal } from "./refusal.js";
import {
  currentPlacement,
  deliveredOf,
  itemContextOf,
  placementOf,
  type StepContext,
  settle,
  store,
} from "./step-context.js";
import { reconcile } from "./step-host.js";
import { processOutcomes } from "./step-outcomes.js";
import { go, navigate } from "./step-walk.js";

/** Counts the time from the latest step to `at` in the test, the test part and the sections of the item presented. */
export function advance(step: StepContext, at: number): void {
  const { state } = step;
  if (state.status !== "in-progress" || state.current === undefined) {
    step.state = { ...state, at };
    return;
  }
  const elapsed = at - state.at;
  const here = currentPlacement(step);
  const runs = (clock: ScopeClock): boolean =>
    clock.scope === "test" ||
    (clock.scope === "part"
      ? clock.identifier === here.part
      : here.sections.some((section) => section.identifier === clock.identifier));
  step.state = {
    ...state,
    at,
    clocks: state.clocks.map((clock) => (runs(clock) ? { ...clock, spent: clock.spent + elapsed } : clock)),
  };
}

/** What passed first: the maximum time of a running scope, or the close of the session, at the time it was reached. */
type Due =
  | { readonly close: false; readonly scope: RunningScope; readonly at: number }
  | { readonly close: true; readonly at: number };

/**
 * Returns what passed first up to `at`, with the time it was reached: the maximum time of a running scope, or the close of the
 * session, which comes also while the session is suspended and wins a tie with a maximum time, so that the step reports one
 * time-out.
 */
function due(step: StepContext, at: number): Due | undefined {
  let first: Due | undefined;
  for (const scope of runningScopes(step.course, step.state)) {
    const deadline = scope.expired === undefined ? maximumAt(scope, step.state.at) : undefined;
    if (deadline !== undefined && deadline <= at && (first === undefined || deadline < first.at)) {
      first = { close: false, scope, at: Math.max(deadline, step.state.at) };
    }
  }
  const { closeAt, status } = step.state;
  if (closeAt !== undefined && closeAt <= at && status !== "ended" && (first === undefined || closeAt <= first.at)) {
    first = { close: true, at: Math.max(closeAt, step.state.at) };
  }
  return first;
}

/** Records what a maximum time did, and reports it. */
function mark(step: StepContext, scope: Pick<RunningScope, "scope" | "identifier">, expiry: Expiry, at: number): void {
  const type = expiry === "late" ? "time-limit-passed" : "time-out";
  if (scope.scope === "item") {
    const { key } = currentPlacement(step);
    store(step, { ...deliveredOf(step, key), expired: expiry });
    step.events.push({ type, at, item: key });
    return;
  }
  const clocks = step.state.clocks.map((clock) =>
    clock.scope === scope.scope && clock.identifier === scope.identifier ? { ...clock, expired: expiry } : clock,
  );
  step.state = { ...step.state, clocks };
  step.events.push({ type, at, scope: scope.identifier });
}

/**
 * Closes the item presented, or a section that holds it, at its maximum time: the open attempts end with the drafts
 * received before it, and the candidate goes on as after leaving the scope.
 */
function close(step: StepContext, scope: RunningScope, at: number): Refusal | undefined {
  const here = currentPlacement(step);
  for (const item of step.state.items) {
    const placement = placementOf(step, item.session.key);
    const inside = scope.scope === "item" ? sameKey(placement.key, here.key) : liesIn(placement, scope);
    if (!inside) continue;
    const refused = settle(step, item, closeItem(item.session, at, itemContextOf(step, item.session.key)));
    if (refused !== undefined) return refused;
  }
  processOutcomes(step, at);
  const { structure } = step.course;
  const destination = navigate(step, at, (rules) =>
    destinationAfter(structure, step.state.plan, here.key, scope.identifier, rules),
  );
  return go(step, destination, at);
}

/**
 * Applies a maximum time that passed. With late submission the scope stays open and the step reports
 * `time-limit-passed`. Without, the step reports `time-out`, and the scope closes.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function expire(step: StepContext, scope: RunningScope, at: number): Refusal | undefined {
  const late = scope.limits.allowLateSubmission;
  mark(step, scope, late ? "late" : "closed", at);
  if (late) return undefined;
  switch (scope.scope) {
    case "test":
      return go(step, TEST_END, at);
    case "part":
      return go(step, PART_END, at);
    default:
      return close(step, scope, at);
  }
}

/** Ends the session at its close: the test is timed out whatever its limits allow, and the candidate goes to its end. */
function closeSession(step: StepContext, at: number): Refusal | undefined {
  mark(step, { scope: "test", identifier: step.course.structure.test.model.identifier }, "closed", at);
  return go(step, TEST_END, at);
}

/** Applies the maximum times that passed and the close, up to `at`, earliest first, each at its own time. */
export function expireUntil(step: StepContext, at: number): Refusal | undefined {
  for (let next = due(step, at); next !== undefined; next = due(step, at)) {
    advance(step, next.at);
    const refused = next.close ? closeSession(step, next.at) : expire(step, next.scope, next.at);
    if (refused !== undefined) return refused;
    reconcile(step, next.at);
  }
  return undefined;
}
