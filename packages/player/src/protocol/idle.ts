import type { Action, DeliveryState, Engine, HostAction, Step } from "@assesskit/runtime/delivery";
import type { CandidateAction } from "@assesskit/runtime/delivery/wire";

/** What {@link stepAfterIdle} needs of the runtime, which the caller passes because the shared folders never load the engine. */
export interface IdleRuntime {
  /** Applies a stamped action: `Engine.apply`. */
  readonly engine: Pick<Engine, "apply">;
  /** Stamps an action with the time: the runtime's `stamp`. */
  readonly stamp: (state: DeliveryState, action: CandidateAction | HostAction, now: number) => Action;
}

/** The inputs of {@link stepAfterIdle}. */
export interface IdleInput<TAction extends CandidateAction | HostAction = CandidateAction | HostAction> {
  /** The state the action applies to. */
  readonly state: DeliveryState;
  /** The action. */
  readonly action: TAction;
  /** The time of the host's clock, in epoch milliseconds. */
  readonly now: number;
  /** The longest gap between steps that counts as time on task, in milliseconds, or `undefined` for none. */
  readonly maxIdleMs: number | undefined;
}

/** The step that {@link stepAfterIdle} took, with the time its action was stamped with. */
export interface IdleStep {
  /** The step: accepted with the state after the action, or the refusal of the first application that refused. */
  readonly step: Step;
  /** The time of the action, which is `now`, or the latest step when that is later. */
  readonly at: number;
}

/**
 * Applies an action to a session, counting a gap above `maxIdleMs` as suspended: the session suspends at the latest step,
 * resumes at `now`, and then the action runs, as one step.
 *
 * @remarks
 * The suspension runs at `state.at`, which `Engine.apply` accepts because it is not before the latest step, so every
 * duration and every running maximum time leaves the gap out as if the session had been suspended during it. The events of
 * the three applications come in order in one step, and the caller saves the state it returns once, so that a crash
 * leaves all of it or none. A refusal of any of the three leaves the state as it was.
 *
 * A session that is not in progress has no gap to close. A `time` action that finds one is dropped, since the deadlines it
 * would apply move with the gap: the caller saves nothing and schedules nothing, and the next action closes the gap.
 *
 * @param runtime - See {@link IdleRuntime}.
 * @param input - See {@link IdleInput}.
 * @returns The step and the time of the action, or `undefined` when the action is dropped, which only a host action can be.
 */
export function stepAfterIdle(runtime: IdleRuntime, input: IdleInput<CandidateAction>): IdleStep;
export function stepAfterIdle(runtime: IdleRuntime, input: IdleInput): IdleStep | undefined;
export function stepAfterIdle(runtime: IdleRuntime, input: IdleInput): IdleStep | undefined {
  const { engine, stamp } = runtime;
  const { state, action, now, maxIdleMs } = input;
  const stamped = stamp(state, action, now);
  const { at } = stamped;
  if (maxIdleMs === undefined || state.status !== "in-progress" || now - state.at <= maxIdleMs) {
    return { step: engine.apply(state, stamped), at };
  }
  if (action.type === "time") return undefined;
  const suspended = engine.apply(state, stamp(state, { type: "suspend" }, state.at));
  if (!suspended.ok) return { step: suspended, at };
  const resumed = engine.apply(suspended.state, stamp(suspended.state, { type: "resume" }, now));
  if (!resumed.ok) return { step: resumed, at };
  // The state after the resumption is at `at`, so the stamp of the action is not before it.
  const acted = engine.apply(resumed.state, stamped);
  if (!acted.ok) return { step: acted, at };
  const events = [...suspended.events, ...resumed.events, ...acted.events];
  return { step: { ok: true, state: acted.state, events }, at };
}
