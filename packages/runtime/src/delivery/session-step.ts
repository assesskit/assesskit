import type { Action } from "./action.js";
import type { Course } from "./course.js";
import type { DeliveryState, Step } from "./delivery-state.js";
import { PART_END, startDestination, TEST_END } from "./navigation.js";
import { type Refusal, refusal } from "./refusal.js";
import { createStepContext, type StepContext } from "./step-context.js";
import { enter } from "./step-entry.js";
import { catResponse, reconcile, supply } from "./step-host.js";
import { act, move } from "./step-moves.js";
import { resume, suspend, toggle } from "./step-session.js";
import { advance, expireUntil } from "./step-time.js";
import { arrive, end, navigate } from "./step-walk.js";

/**
 * One step of a candidate session: it starts from a state, applies a start or an action, and gives the new state with
 * the events, or a refusal.
 *
 * @remarks
 * It is the reducer of the engine, and the only place that changes a state; the state it starts from is never changed.
 * The rules are functions of the `step-*.ts` files on the {@link StepContext} that it holds.
 */
export class SessionStep {
  private readonly step: StepContext;

  constructor(course: Course, state: DeliveryState) {
    this.step = createStepContext(course, state);
  }

  /** Returns the step that the state reached and the events. */
  done(): Step {
    const { state, random, events } = this.step;
    return { ok: true, state: { ...state, random: random.state() }, events };
  }

  /** Starts the session at its first item, or ends a test that has none. */
  begin(at: number): Refusal | undefined {
    const { step } = this;
    const { structure } = step.course;
    const first = navigate(step, at, (rules) => startDestination(structure, step.state.plan, rules));
    const refused = first.to === "item" ? enter(step, first.key, at, false) : arrive(step, first, at);
    reconcile(step, at);
    return refused;
  }

  /**
   * Applies an action: first the maximum times that passed before it, each at its time, then the action. The refusals
   * of a test that ended, of a time before the latest step and of a suspended session come first.
   *
   * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
   */
  apply(action: Action): Refusal | undefined {
    const { step } = this;
    const { at } = action;
    // The host answers scoring and CAT requests in any state, also after the test ended.
    const answer = action.type === "supply-scores" || action.type === "cat-response";
    if (this.ended() && !answer) return refusal("ended", "The test has ended.");
    if (at < step.state.at) {
      const message = `The action at ${at} is earlier than the latest step of the session at ${step.state.at}.`;
      return refusal("clock-regression", message);
    }
    if (step.state.status === "suspended" && action.type !== "resume" && !answer) {
      return refusal("suspended", "The candidate session is suspended; it goes on when it is resumed.");
    }
    const expired = expireUntil(step, at);
    if (expired !== undefined) return expired;
    advance(step, at);
    if (this.ended() && !answer) {
      if (action.type !== "time") return refusal("time-over", "The test ended when a maximum time passed.");
      reconcile(step, at);
      return undefined;
    }
    const refused = this.perform(action);
    if (refused === undefined) reconcile(step, at);
    return refused;
  }

  private ended(): boolean {
    return this.step.state.status === "ended";
  }

  private perform(action: Action): Refusal | undefined {
    const { step } = this;
    const { at } = action;
    switch (action.type) {
      case "supply-scores":
        return supply(step, action);
      case "cat-response":
        return catResponse(step, action);
    }
    if (step.state.current === undefined) return this.idle(action);
    switch (action.type) {
      case "time":
        return undefined;
      case "move":
        return move(step, action.to, at);
      case "support":
        return toggle(step, action.name, action.active, at);
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
   * Applies an action of the candidate while no item is presented, because the first stage of an adaptive section is
   * awaited: time passes without effect, a support can be turned on or off, the session can be suspended and resumed,
   * and the part or the test can be ended. Anything else waits for the CAT engine.
   */
  private idle(action: Action): Refusal | undefined {
    const { step } = this;
    const { at } = action;
    switch (action.type) {
      case "time":
        return undefined;
      case "support":
        return toggle(step, action.name, action.active, at);
      case "suspend":
        return suspend(step, at);
      case "resume":
        return resume(step, at);
      case "end-part":
        return end(step, PART_END, at);
      case "end-test":
        return end(step, TEST_END, at);
      default:
        return refusal("awaiting-cat", "The adaptive section waits for the CAT engine to send its first items.");
    }
  }
}
