import {
  buildEvent,
  type CaliperEvent,
  type CaliperEventType,
  type CaliperProfile,
  type EventInput,
  mintUrn,
} from "@interopkit/learning-analytics";
import type { CaliperContext } from "./context.ts";

/** What one event says, before it is given its identifier, its profile and the context's application. */
export type EventParts = EventInput extends infer TEvent
  ? TEvent extends EventInput
    ? Omit<TEvent, "id" | "profile" | "edApp">
    : never
  : never;

/** Returns the profile that governs an event: the Grading Profile for a GradeEvent, else the Assessment Profile. */
function profileOf(type: CaliperEventType): CaliperProfile {
  return type === "GradeEvent" ? "GradingProfile" : "AssessmentProfile";
}

/**
 * Builds an event with its identifier: the URN of the session, the step and the index of the event, the position in
 * `Step.events` of the event that it reports, so that reporting a step again gives the same identifier.
 */
export function assemble(index: number, parts: EventParts, context: CaliperContext): CaliperEvent {
  return buildEvent({
    ...parts,
    id: mintUrn(["event", context.session, context.step, index]),
    profile: profileOf(parts.type),
    edApp: context.edApp,
  });
}
