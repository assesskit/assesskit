import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkFinite,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { DataError } from "../errors.js";
import { BINDING_SOURCES } from "../interactions/bindings.js";
import type { InteractionKind } from "../interactions/index.js";
import type { ResultContext } from "../results/index.js";
import { BASE_TYPES, CARDINALITIES, fromWireValue } from "../values/index.js";
import { CAT_STATUSES, type CatOutcome, type CatSession, type CatWait, type ReportedItem } from "./cat-session.js";
import { valueFromJson, valueToJson } from "./entries-json.js";
import { checkKey, type ItemKey } from "./plan.js";
import type { Scorer, ScoringCover, ScoringDeclaration, ScoringRequest, SuppliedScore } from "./scoring.js";

/** The scorers, for the checks. */
const SCORERS: readonly Scorer[] = ["human", "externalMachine"];

/** The kinds of request of a CAT session, for the checks. */
/** Whether a value is the kind of an interaction. */
const isInteractionKind = (value: unknown): value is InteractionKind =>
  typeof value === "string" && Object.hasOwn(BINDING_SOURCES, value);

const CAT_WAITS: readonly CatWait["kind"][] = ["create-session", "submit-results", "end-session"];

function readKey(json: unknown): ItemKey {
  checkKey(json);
  return { ref: json.ref, instance: json.instance };
}

function readKeys(json: unknown, label: string): ItemKey[] {
  checkArray(json, `${label} must be an array of item instances`);
  return json.map(readKey);
}

function optionalString(json: Readonly<Record<string, unknown>>, field: string, label: string): string | undefined {
  const value = json[field];
  if (value === undefined) return undefined;
  checkString(value, label);
  return value;
}

function optionalNumber(json: Readonly<Record<string, unknown>>, field: string, label: string): number | undefined {
  const value = json[field];
  if (value === undefined) return undefined;
  checkFinite(value, label);
  return value;
}

function coverToJson(cover: ScoringCover): unknown {
  const { item, responseIdentifier, label, presented, interaction, response } = cover;
  return {
    item,
    responseIdentifier,
    ...(label === undefined ? {} : { label }),
    presented,
    ...(interaction === undefined ? {} : { interaction }),
    response: valueToJson(response),
  };
}

function readCover(json: unknown): ScoringCover {
  checkRecord(json, "A cover of a scoring request must be an object");
  checkString(json.responseIdentifier, "The responseIdentifier of a cover");
  checkBoolean(json.presented, "The presented of a cover");
  const label = optionalString(json, "label", "The label of a cover");
  const { interaction } = json;
  if (interaction !== undefined && !isInteractionKind(interaction)) {
    throw new DataError(
      `The interaction of a cover must be the kind of an interaction, found ${describe(interaction)}.`,
    );
  }
  return {
    item: readKey(json.item),
    responseIdentifier: json.responseIdentifier,
    ...(label === undefined ? {} : { label }),
    presented: json.presented,
    ...(interaction === undefined ? {} : { interaction }),
    response: valueFromJson(json.response),
  };
}

function readDeclaration(json: unknown): ScoringDeclaration {
  checkRecord(json, "The declaration of a scoring request must be an object");
  checkChoice(json.cardinality, "The cardinality of a scoring request", CARDINALITIES);
  const { baseType } = json;
  if (baseType !== undefined) checkChoice(baseType, "The baseType of a scoring request", BASE_TYPES);
  const normalMinimum = optionalNumber(json, "normalMinimum", "The normalMinimum of a scoring request");
  const normalMaximum = optionalNumber(json, "normalMaximum", "The normalMaximum of a scoring request");
  const masteryValue = optionalNumber(json, "masteryValue", "The masteryValue of a scoring request");
  const interpretation = optionalString(json, "interpretation", "The interpretation of a scoring request");
  const longInterpretation = optionalString(json, "longInterpretation", "The longInterpretation of a scoring request");
  return {
    cardinality: json.cardinality,
    ...(baseType === undefined ? {} : { baseType }),
    ...(normalMinimum === undefined ? {} : { normalMinimum }),
    ...(normalMaximum === undefined ? {} : { normalMaximum }),
    ...(masteryValue === undefined ? {} : { masteryValue }),
    ...(interpretation === undefined ? {} : { interpretation }),
    ...(longInterpretation === undefined ? {} : { longInterpretation }),
  };
}

function readSupplied(json: unknown): SuppliedScore {
  checkRecord(json, "The supplied of a scoring request must be an object");
  checkFinite(json.at, "The at of the supplied of a scoring request");
  checkChoice(json.scorer, "The scorer of the supplied of a scoring request", SCORERS);
  return { value: valueFromJson(json.value), at: json.at, scorer: json.scorer };
}

/** Writes scoring requests as plain data that `JSON.stringify` keeps whole: values as wire values (E2, E30). */
export function scoringToJson(requests: readonly ScoringRequest[]): unknown {
  return requests.map((request) => {
    const { supplied, item, variableIdentifierRef, lti } = request;
    return {
      id: request.id,
      scope: request.scope,
      ...(item === undefined ? {} : { item }),
      outcome: request.outcome,
      mode: request.mode,
      ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
      ...(lti === undefined ? {} : { lti }),
      declaration: request.declaration,
      covers: request.covers.map(coverToJson),
      requestedAt: request.requestedAt,
      ...(supplied === undefined ? {} : { supplied: { ...supplied, value: valueToJson(supplied.value) } }),
    };
  });
}

/**
 * Reads scoring requests that {@link scoringToJson} wrote.
 *
 * @throws `DataError` when the data is not such requests.
 */
export function scoringFromJson(json: unknown): ScoringRequest[] {
  checkArray(json, "The scoring of the state must be an array");
  return json.map((request): ScoringRequest => {
    checkRecord(request, "A scoring request of the state must be an object");
    checkString(request.id, "The id of a scoring request");
    checkChoice(request.scope, "The scope of a scoring request", ["item", "test"]);
    checkString(request.outcome, "The outcome of a scoring request");
    checkChoice(request.mode, "The mode of a scoring request", SCORERS);
    checkArray(request.covers, "The covers of a scoring request must be an array");
    checkFinite(request.requestedAt, "The requestedAt of a scoring request");
    const variableIdentifierRef = optionalString(
      request,
      "variableIdentifierRef",
      "The variableIdentifierRef of a scoring request",
    );
    if (request.lti !== undefined && request.lti !== true) {
      throw new DataError(`The lti of a scoring request must be true, found ${describe(request.lti)}.`);
    }
    return {
      id: request.id,
      scope: request.scope,
      ...(request.item === undefined ? {} : { item: readKey(request.item) }),
      outcome: request.outcome,
      mode: request.mode,
      ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
      ...(request.lti === undefined ? {} : { lti: true as const }),
      declaration: readDeclaration(request.declaration),
      covers: request.covers.map(readCover),
      requestedAt: request.requestedAt,
      ...(request.supplied === undefined ? {} : { supplied: readSupplied(request.supplied) }),
    };
  });
}

function waitToJson(wait: CatWait): unknown {
  return wait.kind === "submit-results" ? { kind: wait.kind, items: wait.items } : { kind: wait.kind };
}

function readWait(json: unknown): CatWait {
  checkRecord(json, "The request of a CAT session must be an object");
  checkChoice(json.kind, "The kind of the request of a CAT session", CAT_WAITS);
  if (json.kind === "submit-results") {
    return { kind: json.kind, items: readKeys(json.items, "The items of a submit-results request") };
  }
  return { kind: json.kind };
}

function outcomeToJson(outcome: CatOutcome): unknown {
  const { item, variableIdentifierRef } = outcome;
  return {
    ...(item === undefined ? {} : { item }),
    identifier: outcome.identifier,
    value: valueToJson(outcome.value),
    declared: outcome.declared,
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
  };
}

function readOutcome(json: unknown): CatOutcome {
  checkRecord(json, "An outcome of a CAT session must be an object");
  checkString(json.identifier, "The identifier of an outcome of a CAT session");
  checkBoolean(json.declared, "The declared of an outcome of a CAT session");
  const variableIdentifierRef = optionalString(
    json,
    "variableIdentifierRef",
    "The variableIdentifierRef of an outcome of a CAT session",
  );
  const value = fromWireValue(json.value);
  if (value === null) throw new DataError("The value of an outcome of a CAT session must not be NULL.");
  return {
    ...(json.item === undefined ? {} : { item: readKey(json.item) }),
    identifier: json.identifier,
    value,
    declared: json.declared,
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
  };
}

function readReported(json: unknown): ReportedItem {
  checkRecord(json, "A reported item of a CAT session must be an object");
  checkNonNegativeInteger(json.attempts, "The attempts of a reported item of a CAT session");
  return { key: readKey(json.key), attempts: json.attempts };
}

/** Writes CAT sessions as plain data that `JSON.stringify` keeps whole (E2, E30). */
export function catToJson(sessions: readonly CatSession[]): unknown {
  return sessions.map((session) => {
    const { request, sessionIdentifier, sessionState, moving } = session;
    return {
      section: session.section,
      instance: session.instance,
      status: session.status,
      requests: session.requests,
      ...(request === undefined ? {} : { request: waitToJson(request) }),
      ...(sessionIdentifier === undefined ? {} : { sessionIdentifier }),
      ...(sessionState === undefined ? {} : { sessionState }),
      stage: session.stage,
      stageLength: session.stageLength,
      reported: session.reported,
      outcomes: session.outcomes.map(outcomeToJson),
      ...(moving === undefined ? {} : { moving }),
    };
  });
}

/**
 * Reads CAT sessions that {@link catToJson} wrote.
 *
 * @throws `DataError` when the data is not such sessions.
 */
export function catFromJson(json: unknown): CatSession[] {
  checkArray(json, "The cat of the state must be an array");
  return json.map((session): CatSession => {
    checkRecord(session, "A CAT session of the state must be an object");
    checkString(session.section, "The section of a CAT session");
    checkPositiveInteger(session.instance, "The instance of a CAT session");
    checkChoice(session.status, "The status of a CAT session", CAT_STATUSES);
    checkNonNegativeInteger(session.requests, "The requests of a CAT session");
    checkNonNegativeInteger(session.stageLength, "The stageLength of a CAT session");
    checkArray(session.reported, "The reported of a CAT session must be an array");
    checkArray(session.outcomes, "The outcomes of a CAT session must be an array");
    const sessionIdentifier = optionalString(session, "sessionIdentifier", "The sessionIdentifier of a CAT session");
    const sessionState = optionalString(session, "sessionState", "The sessionState of a CAT session");
    if (session.moving !== undefined && session.moving !== true) {
      throw new DataError(`The moving of a CAT session must be true, found ${describe(session.moving)}.`);
    }
    return {
      section: session.section,
      instance: session.instance,
      status: session.status,
      requests: session.requests,
      ...(session.request === undefined ? {} : { request: readWait(session.request) }),
      ...(sessionIdentifier === undefined ? {} : { sessionIdentifier }),
      ...(sessionState === undefined ? {} : { sessionState }),
      stage: readKeys(session.stage, "The stage of a CAT session"),
      stageLength: session.stageLength,
      reported: session.reported.map(readReported),
      outcomes: session.outcomes.map(readOutcome),
      ...(session.moving === undefined ? {} : { moving: true as const }),
    };
  });
}

/**
 * Reads the context of the results that the state keeps.
 *
 * @throws `DataError` when the data is not such a context.
 */
export function reportFromJson(json: unknown): ResultContext {
  checkRecord(json, "The report of the state must be an object");
  checkArray(json.sessionIdentifiers, "The sessionIdentifiers of the report of the state must be an array");
  const sourcedId = optionalString(json, "sourcedId", "The sourcedId of the report of the state");
  return {
    ...(sourcedId === undefined ? {} : { sourcedId }),
    sessionIdentifiers: json.sessionIdentifiers.map((each) => {
      checkRecord(each, "A session identifier of the report of the state must be an object");
      checkString(each.sourceId, "The sourceId of a session identifier of the report of the state");
      checkString(each.identifier, "The identifier of a session identifier of the report of the state");
      return { sourceId: each.sourceId, identifier: each.identifier };
    }),
  };
}
