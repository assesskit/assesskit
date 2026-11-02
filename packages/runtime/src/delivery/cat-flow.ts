import type { CatResponse, ItemStage } from "../cat/index.js";
import { isSessionEnd } from "../cat/index.js";
import { describe } from "../checks.js";
import type { AssessmentResult, ItemResult, OutcomeVariable, ResultVariable } from "../results/index.js";
import { type Declared, heldByOther, otherIdentifiers, outcomeFate } from "./cat-outcomes.js";
import {
  answered,
  appendedStage,
  type CatOutcome,
  type CatSession,
  type CatWait,
  catRequestId,
  planSize,
  poolOf,
  requested,
  stageLengthOf,
  stageSubmitted,
  startedCat,
  unreported,
  withCat,
  withoutUnpresented,
  withReported,
} from "./cat-session.js";
import { type Course, candidateOf } from "./course.js";
import { type DeliveredItem, type DeliveryState, findDelivered } from "./delivery-state.js";
import type { DeliveryEvent } from "./events.js";
import { type ItemKey, sameKey } from "./plan.js";
import { planIndex } from "./plan-index.js";
import { type Refusal, refusal } from "./refusal.js";

/** What a step of a CAT session changed: the state, what happened, and whether outcomes that processing reads changed. */
export type CatChange =
  | {
      /** The step is accepted. */
      readonly ok: true;
      /** The state after the step. */
      readonly state: DeliveryState;
      /** What happened, in order. */
      readonly events: readonly DeliveryEvent[];
      /** Whether outcomes changed that the outcome processing of the test reads. */
      readonly outcomes: boolean;
    }
  | {
      /** The step is refused. */
      readonly ok: false;
      /** Why. */
      readonly refusal: Refusal;
    };

function changed(state: DeliveryState, events: readonly DeliveryEvent[] = [], outcomes = false): CatChange {
  return { ok: true, state, events, outcomes };
}

function refused(code: Refusal["code"], message: string): CatChange {
  return { ok: false, refusal: refusal(code, message) };
}

/** The event that reports the request a session has just made. */
function requestEvent(session: CatSession, at: number): DeliveryEvent {
  const kind = session.request?.kind ?? "none";
  return { type: "cat-requested", at, scope: session.section, detail: `${kind} ${catRequestId(session)}` };
}

/** Starts the CAT session of an adaptive section the candidate enters: Create Session waits for the engine. */
export function startCat(state: DeliveryState, section: string, instance: number, at: number): CatChange {
  const session = startedCat(section, instance);
  return changed(withCat(state, session), [requestEvent(session, at)]);
}

/**
 * Makes the Submit Results request of each running session that waits for none and whose candidate has submitted the
 * first `stageLength` items of the stage.
 *
 * @remarks
 * The request carries the item instances not yet reported, so that results deferred earlier and results that changed in
 * a nonlinear part go with it.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function submitDue(state: DeliveryState, at: number): CatChange {
  let next = state;
  const events: DeliveryEvent[] = [];
  for (const session of state.cat) {
    if (session.status !== "running" || session.request !== undefined || !stageSubmitted(state, session)) continue;
    const items = unreported(state, session);
    const made = requested(withReported(state, session, items), { kind: "submit-results", items });
    next = withCat(next, made);
    events.push(requestEvent(made, at));
  }
  return changed(next, events);
}

/** The request that follows when the candidate has left and the engine has answered or has nothing to answer. */
function farewell(state: DeliveryState, session: CatSession): CatWait {
  const items = unreported(state, session);
  return items.length > 0 ? { kind: "submit-results", items } : { kind: "end-session" };
}

/**
 * Ends the sessions the candidate leaves: the section is left, or the part or the test ends.
 *
 * @remarks
 * A running session stops being one; the items of its stage that were not presented leave the plan; the results not yet
 * reported go in a last Submit Results request and, unless the engine ends the session by its answer, End Session
 * follows.
 *
 * @param leaves - Whether the session is one the candidate leaves.
 */
export function leaveCat(state: DeliveryState, at: number, leaves: (session: CatSession) => boolean): CatChange {
  let next = state;
  const events: DeliveryEvent[] = [];
  for (const session of state.cat) {
    if (session.status !== "running" || !leaves(session)) continue;
    const plan = withoutUnpresented(
      next.plan,
      session.section,
      session.instance,
      (key) => findDelivered(next, key) !== undefined,
    );
    next = { ...next, plan };
    const left: CatSession = { ...session, status: "leaving", stage: [], stageLength: 0 };
    // A session that waits for an answer goes on when the answer comes; the answer decides what follows.
    const made =
      left.request === undefined
        ? requested(withReported(next, left, unreported(next, left)), farewell(next, left))
        : left;
    next = withCat(next, made);
    if (left.request === undefined) events.push(requestEvent(made, at));
  }
  return changed(next, events);
}

/**
 * Resolves the identifier of an item result to an item instance: the plain identifier of a single instance, or `ref.n`.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function itemOf(state: DeliveryState, identifier: string): ItemKey | undefined {
  const index = planIndex(state.plan);
  const own = index.instances(identifier);
  if (own.length === 1 && own[0] !== undefined) return own[0].key;
  const dot = identifier.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const key = { ref: identifier.slice(0, dot), instance: Number(identifier.slice(dot + 1)) };
  return index.placement(key)?.key;
}

/** The outcomes of one scope, replaced by those that a new report gives. */
function mergedOutcomes(held: readonly CatOutcome[], added: readonly CatOutcome[]): CatOutcome[] {
  const replaces = (outcome: CatOutcome): boolean =>
    added.some(
      (each) =>
        each.identifier === outcome.identifier &&
        (each.item === undefined
          ? outcome.item === undefined
          : outcome.item !== undefined && sameKey(each.item, outcome.item)),
    );
  return [...held.filter((outcome) => !replaces(outcome)), ...added];
}

/**
 * Returns the outcome to keep for a variable the engine reported, `undefined` when it is ignored.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function accepted(
  state: DeliveryState,
  session: CatSession,
  variable: OutcomeVariable,
  declared: Declared,
  item?: ItemKey,
): CatOutcome | undefined {
  const fate = outcomeFate(variable, declared);
  if (fate.fate === "ignored" || variable.value === null) return undefined;
  const identifier = fate.fate === "declared" ? fate.identifier : variable.identifier;
  if (heldByOther(state, session, identifier, item)) return undefined;
  const ref = variable.variableIdentifierRef;
  return {
    ...(item === undefined ? {} : { item }),
    identifier,
    value: fate.fate === "declared" ? fate.value : variable.value,
    declared: fate.fate === "declared",
    ...(ref === undefined ? {} : { variableIdentifierRef: ref }),
  };
}

/** The outcomes among the variables of a report. */
function outcomesOf(variables: readonly ResultVariable[]): OutcomeVariable[] {
  return variables.flatMap((variable) => (variable.kind === "outcome" ? [variable] : []));
}

/**
 * Merges the outcomes that the report gives an item instance: the declared ones go into the session of the instance, so
 * that the processing of the test reads them. An instance that was not presented takes none.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function mergeItem(
  course: Course,
  state: DeliveryState,
  session: CatSession,
  result: ItemResult,
): { readonly state: DeliveryState; readonly kept: readonly CatOutcome[] } {
  const key = itemOf(state, result.identifier);
  const delivered = key === undefined ? undefined : findDelivered(state, key);
  const entry = key === undefined ? undefined : course.items.get(key.ref);
  if (key === undefined || delivered === undefined || entry === undefined) return { state, kept: [] };
  const item = candidateOf(entry, delivered.variant).item;
  const declared = {
    outcomes: item.outcomeDeclarations,
    others: otherIdentifiers([item.responseDeclarations, item.templateDeclarations, item.contextDeclarations]),
  };
  const kept = outcomesOf(result.variables).flatMap(
    (variable) => accepted(state, session, variable, declared, key) ?? [],
  );
  const outcomes = new Map(delivered.session.variables.outcomes);
  for (const outcome of kept) if (outcome.declared) outcomes.set(outcome.identifier, outcome.value);
  const { variables } = delivered.session;
  const replaced: DeliveredItem = {
    ...delivered,
    session: { ...delivered.session, variables: { ...variables, outcomes } },
  };
  return { state: { ...state, items: state.items.map((each) => (each === delivered ? replaced : each)) }, kept };
}

/** The result of merging a CAT report: the state and session with its outcomes, and whether processing reads any. */
interface Merged {
  readonly state: DeliveryState;
  readonly session: CatSession;
  readonly outcomes: boolean;
}

/**
 * Merges the report of a CAT engine into the state: the session identifiers join the context of the results; each
 * outcome goes into the declaration that takes it, or is kept as if it were declared, or is ignored; an outcome that
 * another CAT engine set is not overwritten.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function mergeReport(
  course: Course,
  state: DeliveryState,
  session: CatSession,
  report: AssessmentResult | undefined,
): Merged {
  if (report === undefined) return { state, session, outcomes: false };
  const known = state.report.sessionIdentifiers;
  const added = (report.context?.sessionIdentifiers ?? []).filter(
    ({ sourceId, identifier }) => !known.some((each) => each.sourceId === sourceId && each.identifier === identifier),
  );
  let next: DeliveryState = { ...state, report: { ...state.report, sessionIdentifiers: [...known, ...added] } };
  const { model } = course.structure.test;
  const declared = { outcomes: model.outcomeDeclarations, others: otherIdentifiers([model.contextDeclarations]) };
  const kept = outcomesOf(report.testResult?.variables ?? []).flatMap(
    (variable) => accepted(state, session, variable, declared) ?? [],
  );
  for (const result of report.itemResults) {
    const merged = mergeItem(course, next, session, result);
    next = merged.state;
    for (const each of merged.kept) kept.push(each);
  }
  return {
    state: next,
    session: { ...session, outcomes: mergedOutcomes(session.outcomes, kept) },
    outcomes: kept.length > 0,
  };
}

/**
 * Applies the stage that an answer gives to a session. A session the candidate has left ignores it. A running session
 * drops the items of the old stage that were not presented, then ends when the stage ends the session, else appends the
 * items at the end of its section, each an instance as in a selection with replacement.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function applyStage(
  course: Course,
  state: DeliveryState,
  session: CatSession,
  stage: ItemStage | null | undefined,
  at: number,
): CatChange {
  const settled = answered(session);
  const ends = isSessionEnd(stage);
  if (session.status === "leaving") {
    const next = ends ? { ...settled, status: "ended" as const } : requested(settled, farewell(state, settled));
    return changed(withCat(state, next), ends ? [] : [requestEvent(next, at)]);
  }
  const trimmed = withoutUnpresented(
    state.plan,
    session.section,
    session.instance,
    (key) => findDelivered(state, key) !== undefined,
  );
  if (ends || stage === null || stage === undefined) {
    return changed(withCat({ ...state, plan: trimmed }, { ...settled, status: "ended", stage: [], stageLength: 0 }));
  }
  const refs = stage.itemIdentifiers ?? [];
  const section = course.structure.section(session.section);
  const pool = section === undefined ? new Set<string>() : poolOf(section.model);
  const stranger = refs.find((ref) => !pool.has(ref));
  if (stranger !== undefined) {
    return refused(
      "unknown-item",
      `The stage names the item ${describe(stranger)}, which the adaptive section ${describe(session.section)} does not list.`,
    );
  }
  const grown = appendedStage(trimmed, session.section, session.instance, refs);
  if (planSize(grown.plan) > course.limits.maxPlanNodes) {
    return refused(
      "invalid-response",
      `The stage would make the plan hold more than the ${course.limits.maxPlanNodes} sections and items that the limit maxPlanNodes allows.`,
    );
  }
  const next: CatSession = { ...settled, stage: grown.keys, stageLength: stageLengthOf(stage, grown.keys.length) };
  const event: DeliveryEvent = { type: "cat-stage-added", at, scope: session.section, detail: refs.join(" ") };
  return changed(withCat({ ...state, plan: grown.plan }, next), [event]);
}

/** The fields of an answer that the kinds of request read. */
interface Answer {
  readonly sessionIdentifier?: string;
  readonly sessionState?: string;
  readonly nextItems?: ItemStage | null;
  readonly assessmentResult?: AssessmentResult;
  readonly ended?: true;
}

/**
 * Applies the answer of the CAT engine to the request that waits.
 *
 * @remarks
 * Create Session stores the session identifier and state and gives the first stage. Submit Results merges the outcomes,
 * stores the state it returns (an absent state clears it) and gives the next stage, or ends the session. End Session
 * ends the session.
 */
export function answerCat(
  course: Course,
  state: DeliveryState,
  requestId: string,
  response: CatResponse,
  at: number,
): CatChange {
  const session = state.cat.find((each) => each.request !== undefined && catRequestId(each) === requestId);
  if (session?.request === undefined) {
    return refused("unknown-request", `The state has no CAT request ${describe(requestId)} that waits for an answer.`);
  }
  const answer: Answer = response;
  const wait = session.request;
  if (wait.kind === "end-session") {
    if (answer.ended !== true) return refused("invalid-response", "The answer to End Session must be { ended: true }.");
    return changed(withCat(state, { ...answered(session), status: "ended" }));
  }
  if (answer.ended === true)
    return refused(
      "invalid-response",
      `The answer to ${wait.kind === "create-session" ? "Create Session" : "Submit Results"} must not be { ended: true }.`,
    );
  if (wait.kind === "create-session") {
    if (answer.sessionIdentifier === undefined || answer.nextItems === undefined) {
      return refused(
        "invalid-response",
        "The answer to Create Session must give a sessionIdentifier and the first stage in nextItems.",
      );
    }
    const started: CatSession = {
      ...session,
      sessionIdentifier: answer.sessionIdentifier,
      ...(answer.sessionState === undefined ? {} : { sessionState: answer.sessionState }),
    };
    return applyStage(course, state, started, answer.nextItems, at);
  }
  const merged = mergeReport(course, state, session, answer.assessmentResult);
  const { sessionState: _previous, ...rest } = merged.session;
  const updated: CatSession = {
    ...rest,
    ...(answer.sessionState === undefined ? {} : { sessionState: answer.sessionState }),
  };
  const staged = applyStage(course, merged.state, updated, answer.nextItems, at);
  return staged.ok ? { ...staged, outcomes: merged.outcomes } : staged;
}
