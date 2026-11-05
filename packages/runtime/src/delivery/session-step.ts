import type { Action } from "./action.js";
import type { Course } from "./course.js";
import type { DeliveryState, Step } from "./delivery-state.js";
import { PART_END, startDestination, TEST_END } from "./navigation.js";
import { type Refusal, refusal } from "./refusal.js";
import { createStepContext, type StepContext } from "./step-context.js";
import { enter } from "./step-entry.js";
import { catResponse, reconcile, supply } from "./step-host.js";
import { act, move } from "./step-moves.js";
import { isReview, reviewEnded } from "./step-review.js";
import { adjust, mark, resume, suspend, toggle } from "./step-session.js";
import { advance, expireUntil } from "./step-time.js";
import { arrive, end, navigate } from "./step-walk.js";

/**
 * The actions that a session takes while no item is presented, because the first stage of an adaptive section is awaited.
 * Anything else waits for the CAT engine.
 */
const WHILE_AWAITING_CAT: ReadonlySet<Action["type"]> = new Set([
  "supply-scores",
  "cat-response",
  "time",
  "mark",
  "support",
  "support-settings",
  "suspend",
  "resume",
  "end-part",
  "end-test",
]);

function ended(step: StepContext): boolean {
  return step.state.status === "ended";
}

/** Returns the step that the state reached with the events, or the refusal. */
function finish(step: StepContext, refused: Refusal | undefined): Step {
  if (refused !== undefined) return { ok: false, refusal: refused };
  const { state, random, events } = step;
  return { ok: true, state: { ...state, random: random.state() }, events };
}

function perform(step: StepContext, action: Action): Refusal | undefined {
  const { at } = action;
  if (step.state.current === undefined && !WHILE_AWAITING_CAT.has(action.type)) {
    return refusal("awaiting-cat", "The adaptive section waits for the CAT engine to send its first items.");
  }
  switch (action.type) {
    case "supply-scores":
      return supply(step, action);
    case "cat-response":
      return catResponse(step, action);
    case "time":
      return undefined;
    case "mark":
      return mark(step, action.item, action.marked);
    case "move":
      return move(step, action.to, at);
    case "support":
      return toggle(step, action.name, action.active, at);
    case "support-settings":
      return adjust(step, action.settings, at);
    case "end-part":
      return end(step, PART_END, at);
    case "end-test":
      return end(step, TEST_END, at);
    case "suspend":
      return suspend(step, at);
    case "resume":
      return resume(step, at);
    default:
      return act(step, action);
  }
}

/**
 * Whether a suspended session refuses an action until it is resumed: all but `resume` and the host's answers. Once the close
 * has come, none: the close ends the session at its instant, whether it runs or not, and the action then meets the end.
 */
function waitsForResume(step: StepContext, action: Action, answer: boolean): boolean {
  const { status, closeAt } = step.state;
  return (
    status === "suspended" && action.type !== "resume" && !answer && (closeAt === undefined || closeAt > action.at)
  );
}

/**
 * Applies an action to a step: first the maximum times that passed before it, each at its time, then the action. The
 * refusals of a test that ended, of a time before the latest step and of a suspended session come first.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function applyAction(step: StepContext, action: Action): Refusal | undefined {
  const { at } = action;
  // The host answers scoring and CAT requests in any state, also after the test ended.
  const answer = action.type === "supply-scores" || action.type === "cat-response";
  // An ended session takes `review` and `solution` when the engine allows a review after the end.
  const reviewing = ended(step) && isReview(action) && step.course.reviewAfterEnd;
  if (ended(step) && !answer && !reviewing) return refusal("ended", "The test has ended.");
  if (at < step.state.at) {
    const message = `The action at ${at} is earlier than the latest step of the session at ${step.state.at}.`;
    return refusal("clock-regression", message);
  }
  if (waitsForResume(step, action, answer)) {
    return refusal("suspended", "The candidate session is suspended; it goes on when it is resumed.");
  }
  if (reviewing && isReview(action)) return reviewEnded(step, action);
  const expired = expireUntil(step, at);
  if (expired !== undefined) return expired;
  advance(step, at);
  if (ended(step) && !answer) {
    if (action.type !== "time") return refusal("time-over", "The test ended when a maximum time passed.");
    reconcile(step, at);
    return undefined;
  }
  const refused = perform(step, action);
  if (refused === undefined) reconcile(step, at);
  return refused;
}

/**
 * Starts a candidate session from its first state: at its first item, or at the end of a test that has none. It is the
 * reducer's first step; see {@link applyStep}.
 */
export function beginStep(course: Course, state: DeliveryState, at: number): Step {
  const step = createStepContext(course, state);
  const first = navigate(step, at, (rules) => startDestination(course.structure, step.state.plan, rules));
  const refused = first.to === "item" ? enter(step, first.key, at, false) : arrive(step, first, at);
  reconcile(step, at);
  return finish(step, refused);
}

/**
 * Applies an action to a candidate session, and gives the new state with the events, or a refusal.
 *
 * @remarks
 * It is the reducer of the engine, and the only place that changes a state; the state it starts from is never changed.
 * The rules are functions of the `step-*.ts` files on a {@link StepContext}.
 */
export function applyStep(course: Course, state: DeliveryState, action: Action): Step {
  const step = createStepContext(course, state);
  return finish(step, applyAction(step, action));
}
