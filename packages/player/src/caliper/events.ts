import type { DeliveryEvent, DeliveryEventType, ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { checkArray, checkNonEmptyString, checkPositiveInteger, checkRecord, describe } from "../checks.js";
import { buildEvent, type EventParts } from "./build.js";
import { type CaliperContext, checkContext, START_STEP } from "./context.js";
import { assessmentOf, itemAttempt, itemOf, person, sectionOf, testAttempt } from "./entities.js";
import type { CaliperEntity, CaliperEvent } from "./model.js";
import { caliperTime } from "./time.js";

/**
 * The index of the event that the start step adds, which reports no event of the runtime: the AssessmentEvent Started. It comes
 * before the first event of the step.
 */
const STARTED_INDEX = -1;

/** How one event of the runtime becomes the parts of a Caliper event. */
type Rule = (event: DeliveryEvent, context: CaliperContext) => EventParts;

/** Reads the time of an event of the runtime as Caliper writes it. */
function timeOf(event: DeliveryEvent): string {
  return caliperTime(event.at, `The time of the event ${event.type}`);
}

/** Reads the item instance that an event names. */
function itemOfEvent(event: DeliveryEvent): ItemKey {
  const { item } = event;
  checkRecord(item, `The event ${event.type} must name its item as an object`);
  checkNonEmptyString(item.ref, `The ref of the item of the event ${event.type}`);
  checkPositiveInteger(item.instance, `The instance of the item of the event ${event.type}`);
  return { ref: item.ref, instance: item.instance };
}

/** Builds the parts of an AssessmentEvent: the candidate acts on the test and the action makes the attempt at it. */
function assessmentEvent(
  action: "Started" | "Paused" | "Resumed" | "Submitted",
  event: DeliveryEvent,
  context: CaliperContext,
): EventParts {
  const time = timeOf(event);
  // Caliper 1.2 §3.2: Started opens the attempt and Submitted closes it; Paused and Resumed leave it as it is.
  const times = action === "Started" ? { startedAtTime: time } : action === "Submitted" ? { endedAtTime: time } : {};
  return {
    type: "AssessmentEvent",
    action,
    actor: person(context.actor),
    object: assessmentOf(context),
    generated: testAttempt(context, times),
    time,
  };
}

/** The AssessmentEvent Started of the start step, dated by the first event of the step. */
const started: Rule = (event, context) => assessmentEvent("Started", event, context);

/** Builds the parts of a NavigationEvent: the candidate went to a section or to an item. */
function navigatedTo(event: DeliveryEvent, object: CaliperEntity, context: CaliperContext): EventParts {
  return { type: "NavigationEvent", action: "NavigatedTo", actor: person(context.actor), object, time: timeOf(event) };
}

const itemPresented: Rule = (event, context) => {
  const key = itemOfEvent(event);
  const time = timeOf(event);
  return {
    type: "AssessmentItemEvent",
    action: "Started",
    actor: person(context.actor),
    object: itemOf(context, key),
    generated: itemAttempt(context, key, { startedAtTime: time }),
    time,
  };
};

/**
 * An attempt ends in one of four ways, which `detail` names (the runtime's `DeliveryEventType`): `skip` is Skipped, and a
 * submission, an end-attempt interaction and a close are Completed. Skipped generates the attempt (Caliper 1.2 §3.2). The
 * events hold no response, and an answer is not analytics data, so Completed generates no Response.
 */
const itemAttemptEnded: Rule = (event, context) => {
  const key = itemOfEvent(event);
  const time = timeOf(event);
  const parts = {
    type: "AssessmentItemEvent",
    actor: person(context.actor),
    object: itemOf(context, key),
    time,
  } as const;
  if (event.detail !== "skip") return { ...parts, action: "Completed" };
  return { ...parts, action: "Skipped", generated: itemAttempt(context, key, { endedAtTime: time }) };
};

const movedToItem: Rule = (event, context) => navigatedTo(event, itemOf(context, itemOfEvent(event)), context);

const enteredSection: Rule = (event, context) => {
  checkNonEmptyString(event.scope, `The scope of the event ${event.type}`);
  return navigatedTo(event, sectionOf(context, event.scope), context);
};

/**
 * What each type of the runtime's `DeliveryEventType` becomes (Caliper 1.2 §3.2), or `null` when Caliper has no event for it. A
 * record over the whole type, so that a new type of the runtime fails the type check here until someone decides.
 */
const RULES_BY_TYPE: Readonly<Record<DeliveryEventType, Rule | null>> = {
  presented: itemPresented,
  "responses-set": null,
  "attempt-ended": itemAttemptEnded,
  "response-processed": null,
  "processing-failed": null,
  "outcome-processed": null,
  moved: movedToItem,
  "section-entered": enteredSection,
  "part-ended": null,
  "test-ended": (event, context) => assessmentEvent("Submitted", event, context),
  "time-limit-passed": null,
  "time-out": null,
  "late-submission": null,
  suspended: (event, context) => assessmentEvent("Paused", event, context),
  resumed: (event, context) => assessmentEvent("Resumed", event, context),
  "support-changed": null,
  "variant-selected": null,
  "hazard-unavoidable": null,
  "scoring-requested": null,
  "scores-applied": null,
  "scores-replaced": null,
  "cat-requested": null,
  "cat-stage-added": null,
};

/** The rules by type name; a map, so that a type named `__proto__` is data. */
const RULES = new Map<string, Rule | null>(Object.entries(RULES_BY_TYPE));

/** Checks that a value is an event of a type the runtime has. Its other properties are checked where a rule reads them. */
function checkEvent(value: unknown, at: number): asserts value is DeliveryEvent {
  checkRecord(value, `The event ${at} must be an object`);
  if (typeof value.type !== "string" || !RULES.has(value.type)) {
    throw new DataError(
      `The type of the event ${at} must be one of ${[...RULES.keys()].map((type) => JSON.stringify(type)).join(", ")}, found ${describe(value.type)}.`,
    );
  }
}

/**
 * Maps the events of one step of a session to Caliper 1.2 events of the Assessment Profile (Caliper 1.2 §3.2).
 *
 * | runtime | Caliper |
 * | --- | --- |
 * | the step of `Engine.start` | AssessmentEvent Started |
 * | `suspended`, `resumed` | AssessmentEvent Paused, Resumed |
 * | `test-ended` | AssessmentEvent Submitted |
 * | `presented` | AssessmentItemEvent Started |
 * | `attempt-ended` with the detail `skip` | AssessmentItemEvent Skipped |
 * | `attempt-ended` otherwise | AssessmentItemEvent Completed |
 * | `moved`, `section-entered` | NavigationEvent NavigatedTo |
 *
 * The other types have no Caliper event and give none. An event keeps the order of its source, and its identifier is the
 * UUIDv5 of the session, the step and the index of the source event, so that mapping a step again gives the same events.
 *
 * @param events - The events of the step, as `Step.events` gives them.
 * @param context - The session, the step and the parties.
 * @throws `DataError` when an argument has the wrong type, an event has an unknown type, or an event lacks what its
 * Caliper event needs: a valid time, an item instance or a scope.
 */
export function caliperEvents(events: readonly DeliveryEvent[], context: CaliperContext): readonly CaliperEvent[] {
  checkContext(context);
  checkArray(events, "The events must be an array");
  events.forEach(checkEvent);
  const planned: CaliperEvent[] = [];
  const first = events[0];
  if (context.step === START_STEP && first !== undefined) {
    planned.push(buildEvent(STARTED_INDEX, started(first, context), context));
  }
  events.forEach((event, index) => {
    const rule = RULES.get(event.type);
    if (rule) planned.push(buildEvent(index, rule(event, context), context));
  });
  return planned;
}
