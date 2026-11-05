import * as v from "valibot";
import {
  finiteSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  type Schema,
  transformWith,
} from "../checks.js";
import { DataError } from "../errors.js";
import type { InteractionKind } from "../interactions/index.js";
import { INTERACTION_KINDS } from "../interactions/internal.js";
import type { ResultContext } from "../results/index.js";
import { writeWireValue } from "../values/index.js";
import { baseTypeSchema, cardinalitySchema } from "../values/internal.js";
import { CAT_STATUSES, type CatOutcome, type CatSession, type CatWait, type ReportedItem } from "./cat-session.js";
import { valueJsonSchema } from "./entries-json.js";
import { itemKeySchema } from "./item-key.js";
import type { Scorer, ScoringCover, ScoringDeclaration, ScoringRequest, SuppliedScore } from "./scoring.js";

/** The scorers, for the checks. */
const SCORERS: readonly Scorer[] = ["human", "externalMachine"];

/** Whether a value is the kind of an interaction. */
const isInteractionKind = (value: unknown): value is InteractionKind =>
  typeof value === "string" && INTERACTION_KINDS.has(value);

const optionalString = v.optional(v.string());
const optionalNumber = v.optional(finiteSchema);

function coverToJson(cover: ScoringCover): unknown {
  const { item, responseIdentifier, label, presented, interaction, response } = cover;
  return {
    item,
    responseIdentifier,
    ...(label === undefined ? {} : { label }),
    presented,
    ...(interaction === undefined ? {} : { interaction }),
    response: response === null ? null : writeWireValue(response),
  };
}

const coverSchema: Schema<ScoringCover> = v.object({
  item: itemKeySchema,
  responseIdentifier: v.string(),
  label: optionalString,
  presented: v.boolean(),
  interaction: v.optional(
    v.custom<InteractionKind>(isInteractionKind, "The interaction of a cover must be the kind of an interaction."),
  ),
  response: valueJsonSchema,
});

const declarationSchema: Schema<ScoringDeclaration> = v.object({
  cardinality: cardinalitySchema,
  baseType: v.optional(baseTypeSchema),
  normalMinimum: optionalNumber,
  normalMaximum: optionalNumber,
  masteryValue: optionalNumber,
  interpretation: optionalString,
  longInterpretation: optionalString,
});

const suppliedSchema: Schema<SuppliedScore> = v.object({
  value: valueJsonSchema,
  at: finiteSchema,
  scorer: v.picklist(SCORERS),
});

/** Writes scoring requests as plain data that `JSON.stringify` keeps whole: values as wire values. */
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
      ...(supplied === undefined
        ? {}
        : { supplied: { ...supplied, value: supplied.value === null ? null : writeWireValue(supplied.value) } }),
    };
  });
}

/** The schema of scoring requests that {@link scoringToJson} wrote. */
export const scoringSchema: Schema<ScoringRequest[]> = v.array(
  v.object({
    id: v.string(),
    scope: v.picklist(["item", "test"]),
    item: v.optional(itemKeySchema),
    outcome: v.string(),
    mode: v.picklist(SCORERS),
    variableIdentifierRef: optionalString,
    lti: v.optional(v.literal(true)),
    declaration: declarationSchema,
    covers: v.array(coverSchema),
    requestedAt: finiteSchema,
    supplied: v.optional(suppliedSchema),
  }),
);

function waitToJson(wait: CatWait): unknown {
  return wait.kind === "submit-results" ? { kind: wait.kind, items: wait.items } : { kind: wait.kind };
}

const waitSchema: Schema<CatWait> = v.variant("kind", [
  v.object({ kind: v.picklist(["create-session", "end-session"]) }),
  v.object({ kind: v.literal("submit-results"), items: v.array(itemKeySchema) }),
]);

function outcomeToJson(outcome: CatOutcome): unknown {
  const { item, variableIdentifierRef } = outcome;
  return {
    ...(item === undefined ? {} : { item }),
    identifier: outcome.identifier,
    value: writeWireValue(outcome.value),
    declared: outcome.declared,
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
  };
}

const outcomeSchema: Schema<CatOutcome> = v.object({
  item: v.optional(itemKeySchema),
  identifier: v.string(),
  value: v.pipe(
    valueJsonSchema,
    transformWith((value) => {
      if (value === null) throw new DataError("The value of an outcome of a CAT session must not be NULL.");
      return value;
    }),
  ),
  declared: v.boolean(),
  variableIdentifierRef: optionalString,
});

const reportedSchema: Schema<ReportedItem> = v.object({ key: itemKeySchema, attempts: nonNegativeIntegerSchema });

/** Writes CAT sessions as plain data that `JSON.stringify` keeps whole. */
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

/** The schema of CAT sessions that {@link catToJson} wrote. */
export const catSchema: Schema<CatSession[]> = v.array(
  v.object({
    section: v.string(),
    instance: positiveIntegerSchema,
    status: v.picklist(CAT_STATUSES),
    requests: nonNegativeIntegerSchema,
    request: v.optional(waitSchema),
    sessionIdentifier: optionalString,
    sessionState: optionalString,
    stage: v.array(itemKeySchema),
    stageLength: nonNegativeIntegerSchema,
    reported: v.array(reportedSchema),
    outcomes: v.array(outcomeSchema),
    moving: v.optional(v.literal(true)),
  }),
);

/** The schema of the context of the results that the state keeps. */
export const reportSchema: Schema<ResultContext> = v.object({
  sourcedId: optionalString,
  sessionIdentifiers: v.array(v.object({ sourceId: v.string(), identifier: v.string() })),
});
