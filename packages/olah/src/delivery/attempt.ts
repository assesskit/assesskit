import { type AssessmentItem, descendantNodes, type EndAttemptInteraction, type ModelNode } from "../asi/index.js";
import { OlahError } from "../errors.js";
import { describeInteractions, initialResponse } from "../interactions/index.js";
import { COMPLETION_STATUS, DURATION, NOT_ATTEMPTED, NUM_ATTEMPTS } from "../processing/built-ins.js";
import { type ItemVariables, runResponseProcessing } from "../processing/index.js";
import { initialOutcome } from "../processing/variables.js";
import { single, type Value } from "../values/index.js";
import type { DeliveryEvent } from "./events.js";
import type { ItemSession, ItemSessionContext } from "./item-session.js";

/** The value of `completionStatus` from the start of the first attempt (INFO §2.2.2.3). */
const UNKNOWN = "unknown";

/** The value of `completionStatus` with which an adaptive item ends its session (INFO §2.2.2.3, §2.5). */
const COMPLETED = "completed";

/** The milliseconds in a second, the unit of `duration` and of time limits. */
export const MILLISECONDS_PER_SECOND = 1000;

/** The maximum number of attempts of a non-adaptive item when no control sets one (INFO §7.19.1). */
export const DEFAULT_MAX_ATTEMPTS = 1;

/** How an attempt ends: a submission, a skip, an end attempt interaction, or the engine closing the session. */
export type Ending =
  | { readonly by: "submit" | "skip" | "close" }
  | { readonly by: "end-attempt"; readonly interaction: string };

/** Whether an item is adaptive: its outcomes persist between attempts and completion ends its session (INFO §2.5). */
export function isAdaptive(item: AssessmentItem): boolean {
  return item.adaptive === true;
}

const isEndAttempt = (node: ModelNode): node is EndAttemptInteraction => node.kind === "end-attempt-interaction";

/**
 * Returns the response variables that end attempt interactions bind, each with whether the attempt it ends counts toward
 * `max-attempts`: `count-attempt` absent means true (D8, G16).
 */
export function endAttemptInteractions(item: AssessmentItem): ReadonlyMap<string, boolean> {
  const nodes = item.body?.children.flatMap((node) => [node, ...descendantNodes(node)]) ?? [];
  return new Map(nodes.filter(isEndAttempt).map((node) => [node.responseIdentifier, node.countAttempt !== false]));
}

/** Returns the number of attempts that `numAttempts` holds. */
export function attemptsOf(variables: ItemVariables): number {
  const value = variables.responses.get(NUM_ATTEMPTS);
  return value?.cardinality === "single" && typeof value.value === "number" ? value.value : 0;
}

/** Returns the identifier that `completionStatus` holds. */
function completionOf(variables: ItemVariables): string | undefined {
  const value = variables.outcomes.get(COMPLETION_STATUS);
  return value?.cardinality === "single" && typeof value.value === "string" ? value.value : undefined;
}

/**
 * Returns the variables with each declared outcome at the value that response processing of a non-adaptive item starts
 * from: its default value, as template processing may have set it, else 0 for a single integer or float, else NULL
 * (INFO §2.2.2.3, §2.5). `completionStatus` keeps its value, which stays until response processing sets it.
 */
export function resetOutcomes(item: AssessmentItem, variables: ItemVariables): ItemVariables {
  const outcomes = new Map(variables.outcomes);
  for (const declaration of item.outcomeDeclarations) {
    const { identifier } = declaration;
    outcomes.set(identifier, initialOutcome(declaration, variables.defaults.get(identifier) ?? null));
  }
  return { ...variables, outcomes };
}

/** Returns the variables with one response variable set. */
function withResponse(variables: ItemVariables, identifier: string, value: Value | null): ItemVariables {
  return { ...variables, responses: new Map(variables.responses).set(identifier, value) };
}

/**
 * Returns the session brought to time `at`: the time of a running candidate session counts toward what it spent, and
 * `duration` shows the total in seconds, truncated to the millisecond (INFO §2.2.2.2, G20). Suspended time never runs.
 */
export function timed(session: ItemSession, at: number): ItemSession {
  if (session.since === null) return { ...session, updatedAt: at };
  const spent = session.spent + (at - session.since);
  const duration = single("duration", Math.floor(spent) / MILLISECONDS_PER_SECOND);
  return {
    ...session,
    spent,
    since: at,
    updatedAt: at,
    variables: withResponse(session.variables, DURATION, duration),
  };
}

/**
 * Starts an attempt (INFO §2.2.2.2–3): `numAttempts` goes up by 1. The first attempt also sets each response variable to
 * its default value, and the drafts to the responses the interactions start with (B6, B55); the default of an end attempt
 * interaction is ignored (INFO §2.4.5). It changes `completionStatus` from `not_attempted` to `unknown` (B5).
 */
export function startAttempt(session: ItemSession, item: AssessmentItem): ItemSession {
  const numAttempts = attemptsOf(session.variables) + 1;
  const variables = withResponse(session.variables, NUM_ATTEMPTS, single("integer", numAttempts));
  if (numAttempts > 1) return { ...session, attempting: true, variables };
  const endAttempts = endAttemptInteractions(item);
  const interactions = new Map(
    describeInteractions(item).map((descriptor) => [descriptor.responseIdentifier, descriptor]),
  );
  const responses = new Map(variables.responses);
  const drafts = new Map<string, Value | null>();
  for (const { identifier } of item.responseDeclarations) {
    const start = endAttempts.has(identifier) ? null : (variables.defaults.get(identifier) ?? null);
    responses.set(identifier, start);
    const descriptor = interactions.get(identifier);
    drafts.set(identifier, descriptor === undefined ? start : initialResponse(descriptor, start));
  }
  const outcomes =
    completionOf(variables) === NOT_ATTEMPTED
      ? new Map(variables.outcomes).set(COMPLETION_STATUS, single("identifier", UNKNOWN))
      : variables.outcomes;
  return { ...session, attempting: true, drafts, variables: { ...variables, responses, outcomes } };
}

/** Returns an event of the session's item. */
export function itemEvent(
  session: ItemSession,
  type: DeliveryEvent["type"],
  at: number,
  detail?: string,
): DeliveryEvent {
  return { type, at, item: session.key, ...(detail === undefined ? {} : { detail }) };
}

/** Runs response processing; a failure leaves the variables as they were given, with the message (E26). */
function processResponses(
  variables: ItemVariables,
  context: ItemSessionContext,
): { readonly variables: ItemVariables; readonly failure?: string } {
  try {
    return { variables: runResponseProcessing(context.item, variables, context) };
  } catch (error) {
    if (!(error instanceof OlahError)) throw error;
    return { variables, failure: error.message };
  }
}

/** Whether the session closes after an attempt: no attempt is left, or an adaptive item completed (INFO §2.5, §7.19.1). */
function isLast(session: ItemSession, ending: Ending, context: ItemSessionContext): boolean {
  if (ending.by === "close") return true;
  if (isAdaptive(context.item)) return completionOf(session.variables) === COMPLETED;
  const maxAttempts = context.control.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return maxAttempts > 0 && session.countedAttempts >= maxAttempts;
}

/**
 * Ends the open attempt at time `at` (INFO §2.5). The drafts become the submitted responses, and the variable of each end
 * attempt interaction is true when that interaction ended the attempt and false otherwise (INFO §2.4.5). The outcomes
 * of a non-adaptive item are reset first, and those of an adaptive item kept. Response processing runs; when it fails,
 * the outcomes stay as it found them and the session records the failure (E26). The attempt counts toward
 * `max-attempts` unless an end attempt interaction with `count-attempt="false"` ended it (D8). The session closes when
 * no attempt is left, when an adaptive item completed, or when the engine closes it; else it stays interacting with no
 * attempt open, and the candidate sees the feedback.
 */
export function endAttempt(
  session: ItemSession,
  at: number,
  ending: Ending,
  context: ItemSessionContext,
): { readonly session: ItemSession; readonly events: readonly DeliveryEvent[] } {
  const { item } = context;
  const current = timed(session, at);
  const endAttempts = endAttemptInteractions(item);
  const responses = new Map(current.variables.responses);
  for (const { identifier } of item.responseDeclarations) {
    const ended = ending.by === "end-attempt" && ending.interaction === identifier;
    responses.set(
      identifier,
      endAttempts.has(identifier) ? single("boolean", ended) : (current.drafts.get(identifier) ?? null),
    );
  }
  const submitted = { ...current.variables, responses };
  const processed = processResponses(isAdaptive(item) ? submitted : resetOutcomes(item, submitted), context);
  const counts = ending.by !== "end-attempt" || endAttempts.get(ending.interaction) !== false;
  const after: ItemSession = {
    ...current,
    attempting: false,
    countedAttempts: current.countedAttempts + (counts ? 1 : 0),
    variables: processed.variables,
    processingFailed: processed.failure !== undefined,
  };
  const closed = isLast(after, ending, context);
  const events = [
    itemEvent(after, "attempt-ended", at, ending.by),
    processed.failure === undefined
      ? itemEvent(after, "response-processed", at)
      : itemEvent(after, "processing-failed", at, processed.failure),
  ];
  return { session: closed ? { ...after, status: "closed", since: null } : after, events };
}
