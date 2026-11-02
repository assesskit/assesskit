import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { ProcessingContext } from "../processing/index.js";
import { restoreRandom, type SeededRandom } from "../random.js";
import { findCat } from "./cat-session.js";
import { type Course, type CourseItem, candidateOf } from "./course.js";
import { expiriesOf } from "./deadlines.js";
import { type DeliveredItem, type DeliveryState, type Expiry, findDelivered } from "./delivery-state.js";
import type { DeliveryEvent } from "./events.js";
import type { ItemSessionContext, ItemStep } from "./item-session.js";
import { partModel, submissionModeOf } from "./modes.js";
import type { RuleContext } from "./navigation.js";
import { type ItemKey, sameKey } from "./plan.js";
import { type Placement, planIndex } from "./plan-index.js";
import type { Refusal } from "./refusal.js";
import { SessionScope } from "./session-scope.js";

/**
 * What one step of a candidate session works on: the course it delivers, the generator, the events made so far, the
 * state that the step changes, and whether an attempt ended since outcome processing last ran.
 *
 * @remarks
 * The state it starts from is never changed: every change replaces `state` with a new object.
 */
export interface StepContext {
  /** What every session of the engine shares. */
  readonly course: Course;
  /** The generator of the session, restored from the state the step starts from. */
  readonly random: SeededRandom;
  /** What happened in the step, in order. */
  readonly events: DeliveryEvent[];
  /** The state as the step has changed it so far. */
  state: DeliveryState;
  /** Whether an attempt ended since outcome processing last ran. */
  submitted: boolean;
}

/** Returns the context of a step that starts from a state. */
export function createStepContext(course: Course, state: DeliveryState): StepContext {
  return { course, random: restoreRandom(state.random), events: [], state, submitted: false };
}

/** Returns the place of an item instance in the plan. */
export function placementOf(step: StepContext, key: ItemKey): Placement {
  const placement = planIndex(step.state.plan).placement(key);
  if (placement === undefined)
    throw new DataError(`The plan has no item instance ${describe(key.ref)} ${key.instance}.`);
  return placement;
}

/** Returns the place of the item presented. */
export function currentPlacement(step: StepContext): Placement {
  const { current } = step.state;
  if (current === undefined) throw new DataError("The state presents no item, though its test has not ended.");
  return placementOf(step, current);
}

/** Returns the item reference of the course that has the identifier. */
export function courseItem(step: StepContext, ref: string): CourseItem {
  const item = step.course.items.get(ref);
  if (item === undefined) throw new DataError(`The state names ${describe(ref)}, which the test does not have.`);
  return item;
}

/** Returns the item instance that was presented. */
export function deliveredOf(step: StepContext, key: ItemKey): DeliveredItem {
  const item = findDelivered(step.state, key);
  if (item === undefined)
    throw new DataError(`The item instance ${describe(key.ref)} ${key.instance} was not presented.`);
  return item;
}

/** Returns what processing reads: the generator, the custom operators, the resolver of templates and the limits. */
export function processingOf(step: StepContext): ProcessingContext {
  const { customOperators, resolveTemplate, limits } = step.course;
  return { random: step.random, customOperators, resolveTemplate, limits };
}

/** Returns what an item session reads: the item it presents, its session control and what processing reads. */
export function itemContextOf(step: StepContext, key: ItemKey): ItemSessionContext {
  const entry = courseItem(step, key.ref);
  const item = candidateOf(entry, findDelivered(step.state, key)?.variant).item;
  return { ...processingOf(step), item, control: entry.control, eventOutcomes: step.course.eventOutcomes };
}

/** Returns what the rules of navigation read. */
export function rulesOf(step: StepContext): RuleContext {
  return {
    outcomes: step.state.outcomes,
    scope: new SessionScope(step.course, step.state),
    context: processingOf(step),
    catStarted: (section, instance) => findCat(step.state, section, instance) !== undefined,
  };
}

/** Returns how the test part of a place submits. */
export function submissionModeAt(step: StepContext, placement: Placement): "individual" | "simultaneous" {
  return submissionModeOf(step.course.structure, placement);
}

/** Whether the test part of a place is linear. */
export function isLinear(step: StepContext, placement: Placement): boolean {
  return partModel(step.course.structure, placement).navigationMode === "linear";
}

/** Returns the expiries of the scopes of an instance: its own, then those of its test, test part and sections. */
export function expiriesAt(step: StepContext, placement: Placement): (Expiry | undefined)[] {
  return expiriesOf(step.course.structure, step.state, placement);
}

/** Puts an item instance in the state, in place of its earlier form or after the others. */
export function store(step: StepContext, item: DeliveredItem): void {
  const { items } = step.state;
  const at = items.findIndex((each) => sameKey(each.session.key, item.session.key));
  step.state = { ...step.state, items: at < 0 ? [...items, item] : items.map((each, i) => (i === at ? item : each)) };
}

/**
 * Takes the result of a step of an item session: stores the session with its events, and notes an attempt that ended,
 * which is late after a maximum time that allows late submission passed.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function settle(step: StepContext, item: DeliveredItem, result: ItemStep): Refusal | undefined {
  if (!result.ok) return result.refusal;
  const { session, events } = result;
  for (const event of events) step.events.push(event);
  const ended = events.find((event) => event.type === "attempt-ended");
  store(step, { ...item, session, ...(ended === undefined ? {} : { submittedAt: ended.at }) });
  if (ended !== undefined) {
    step.submitted = true;
    if (expiriesAt(step, placementOf(step, session.key)).includes("late")) {
      step.events.push({ type: "late-submission", at: ended.at, item: session.key });
    }
  }
  return undefined;
}

/** Reports a processing failure of an item, or of the test when no item is given, as an event. */
export function failed(step: StepContext, at: number, message: string, item?: ItemKey): void {
  const where = item === undefined ? { scope: step.course.structure.test.model.identifier } : { item };
  step.events.push({ type: "processing-failed", at, ...where, detail: message });
}
