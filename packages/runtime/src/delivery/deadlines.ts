import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { MILLISECONDS_PER_SECOND } from "./attempt.js";
import type { Course } from "./course.js";
import { type DeliveryState, type Expiry, findDelivered } from "./delivery-state.js";
import { type Placement, planIndex } from "./plan-index.js";
import type { StructureNode, TestStructure } from "./structure.js";
import { type EffectiveTimeLimits, timeLimits } from "./time-limits.js";

/**
 * A time at which a time limit is reached, which the host schedules a `time` action for: the maximum or minimum time of
 * the item presented, of a section that holds it, of its test part or of the test, as an absolute time.
 */
export interface Deadline {
  /** The kind of the scope. */
  readonly scope: "item" | "section" | "part" | "test";
  /** The identifier of the item reference, section, test part or test. */
  readonly identifier: string;
  /** Whether the time is the maximum or the minimum. */
  readonly kind: "max-time" | "min-time";
  /** When the time is reached, in epoch milliseconds, with the candidate's extra time and without suspended time. */
  readonly at: number;
  /** Whether a submission after the maximum time is still accepted. */
  readonly lateSubmission: boolean;
}

/** A scope whose time runs in a state: the test, the test part and the sections of the item presented, and the item. */
export interface RunningScope {
  /** The kind of the scope. */
  readonly scope: Deadline["scope"];
  /** The identifier of the item reference, section, test part or test. */
  readonly identifier: string;
  /** The occurrence of the item or section in the plan, from 1; 1 for the test and a part. */
  readonly instance: number;
  /** The time limits, with the candidate's extra time. */
  readonly limits: EffectiveTimeLimits;
  /** The milliseconds spent in the scope up to the time of the state. */
  readonly spent: number;
  /** What the maximum time did when it passed; absent before it passed. */
  readonly expired?: Expiry;
}

function notInTest(identifier: string): DataError {
  return new DataError(`The state names ${describe(identifier)}, which the test does not have.`);
}

/**
 * Returns the scopes whose time runs, outermost first: none unless the session is in progress.
 *
 * @remarks
 * The time of the test, the test part and the sections runs while the candidate is in them, navigation included; the
 * time of the item while its session is interacting.
 *
 * @throws `DataError` when the state names what the test does not have.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function runningScopes(course: Course, state: DeliveryState): RunningScope[] {
  const { current } = state;
  if (state.status !== "in-progress" || current === undefined) return [];
  const placement = planIndex(state.plan).placement(current);
  if (placement === undefined) throw notInTest(current.ref);
  const { structure } = course;
  const extra = state.needs.testingTime;
  const scope = (
    kind: "test" | "part" | "section",
    node: StructureNode | undefined,
    identifier: string,
    instance = 1,
  ): RunningScope => {
    if (node === undefined) throw notInTest(identifier);
    const clock = state.clocks.find((each) => each.scope === kind && each.identifier === identifier);
    const expired = clock?.expired;
    return {
      scope: kind,
      identifier,
      instance,
      limits: timeLimits(node, { extra }),
      spent: clock?.spent ?? 0,
      ...(expired === undefined ? {} : { expired }),
    };
  };
  const scopes = [
    scope("test", structure.test, structure.test.model.identifier),
    scope("part", structure.part(placement.part), placement.part),
    ...placement.sections.map((section) =>
      scope("section", structure.section(section.identifier), section.identifier, section.instance),
    ),
  ];
  const item = findDelivered(state, current);
  const node = structure.itemRef(current.ref);
  if (item === undefined || item.session.since === null) return scopes;
  if (node === undefined) throw notInTest(current.ref);
  const { expired } = item;
  return [
    ...scopes,
    {
      scope: "item",
      identifier: current.ref,
      instance: current.instance,
      limits: timeLimits(node, { extra }),
      spent: item.session.spent + (state.at - item.session.since),
      ...(expired === undefined ? {} : { expired }),
    },
  ];
}

/** Returns when the maximum time of a running scope is reached, in epoch milliseconds; `undefined` when it has none. */
export function maximumAt(scope: RunningScope, at: number): number | undefined {
  const { maxTime } = scope.limits;
  return maxTime === undefined ? undefined : at + maxTime * MILLISECONDS_PER_SECOND - scope.spent;
}

/** Returns when the minimum time of a running scope is reached, `undefined` when it has none or was reached. */
export function minimumAt(scope: RunningScope, at: number): number | undefined {
  const { minTime } = scope.limits;
  if (minTime === undefined || scope.spent >= minTime * MILLISECONDS_PER_SECOND) return undefined;
  return at + minTime * MILLISECONDS_PER_SECOND - scope.spent;
}

/**
 * Returns what the maximum times did in the scopes of an item instance: its own, then those of the test, its test part
 * and its sections; `undefined` for a scope whose maximum time did not pass.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function expiriesOf(
  structure: TestStructure,
  state: DeliveryState,
  placement: Placement,
): (Expiry | undefined)[] {
  const expiry = (scope: "test" | "part" | "section", identifier: string): Expiry | undefined =>
    state.clocks.find((clock) => clock.scope === scope && clock.identifier === identifier)?.expired;
  return [
    findDelivered(state, placement.key)?.expired,
    expiry("test", structure.test.model.identifier),
    expiry("part", placement.part),
    ...placement.sections.map((section) => expiry("section", section.identifier)),
  ];
}

/**
 * Returns the deadlines of a state: for each running scope whose maximum time has not passed, the time it is reached,
 * and its minimum time while that is not reached; none while the session is suspended or has ended, as time does not
 * run then.
 *
 * @throws `DataError` when the state names what the test does not have.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function deadlinesOf(course: Course, state: DeliveryState): Deadline[] {
  const deadlines: Deadline[] = [];
  for (const scope of runningScopes(course, state)) {
    if (scope.expired !== undefined) continue;
    const { identifier } = scope;
    const lateSubmission = scope.limits.allowLateSubmission;
    const maximum = maximumAt(scope, state.at);
    const minimum = minimumAt(scope, state.at);
    if (maximum !== undefined) {
      deadlines.push({ scope: scope.scope, identifier, kind: "max-time", at: maximum, lateSubmission });
    }
    if (minimum !== undefined) {
      deadlines.push({ scope: scope.scope, identifier, kind: "min-time", at: minimum, lateSubmission });
    }
  }
  return deadlines;
}
