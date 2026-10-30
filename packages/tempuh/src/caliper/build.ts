import type { CaliperContext } from "./context.js";
import {
  CALIPER_CONTEXT,
  type CaliperAction,
  type CaliperEntity,
  type CaliperEvent,
  type CaliperEventType,
  type CaliperProfile,
} from "./model.js";
import { mintUrn } from "./uuid.js";

/** What one event says, before it is given its identifier and the context's application. */
export interface EventParts {
  /** The term of the event's type. */
  readonly type: CaliperEventType;
  /** What the actor did. */
  readonly action: CaliperAction;
  /** The agent who acted. */
  readonly actor: CaliperEntity;
  /** What the actor acted on. */
  readonly object: CaliperEntity;
  /** What the action made. */
  readonly generated?: CaliperEntity;
  /** When it happened, in the form Caliper requires. */
  readonly time: string;
}

/** Returns the profile that governs an event: the Grading Profile for a GradeEvent (Caliper 1.2 §3.6), else the Assessment Profile (§3.2). */
function profileOf(type: CaliperEventType): CaliperProfile {
  return type === "GradeEvent" ? "GradingProfile" : "AssessmentProfile";
}

/**
 * Builds an event. Its identifier is the URN of the session, the step and the index of the event: the position in
 * `Step.events` of the event that it reports, so that reporting a step again gives the same identifier (F-m16).
 */
export function buildEvent(index: number, parts: EventParts, context: CaliperContext): CaliperEvent {
  const { type, action, actor, object, generated, time } = parts;
  return {
    "@context": CALIPER_CONTEXT,
    id: mintUrn(["event", context.session, context.step, index]),
    type,
    profile: profileOf(type),
    actor,
    action,
    object,
    ...(generated === undefined ? {} : { generated }),
    eventTime: time,
    edApp: context.edApp,
  };
}
