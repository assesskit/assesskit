// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.

import {
  assessmentResultFromJson,
  assessmentResultToJson,
  type CreateSectionResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type GetSectionResponse,
  type ItemStage,
  isSessionEnd,
  itemStageFromJson,
  type SectionData,
  type SubmitResultsRequest,
  type SubmitResultsResponse,
} from "@assesskit/runtime/cat";
import {
  describe,
  nonEmptyStringSchema,
  parseWith,
  recordSchema,
  type Schema,
  strictRecord,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import * as v from "valibot";
import { metadataRecordSchema, writeMetadataRecord } from "./metadata-record.js";
import { readSectionData } from "./section-data.js";

// The JSON of the bodies of the binding (OpenAPI listing of the binding, Appendix B1.2), in both directions: the client
// writes the requests and reads the answers, the engine reads the requests and writes the answers. The runtime's `cat`
// module writes and reads the assessment result and the item stage; this file holds the rest.

const sessionKeyValueSchema = v.strictObject({
  glossaryURI: v.optional(v.string()),
  key: v.string(),
  value: v.string(),
});

const sessionBodySchema = strictRecord({
  personalNeedsAndPreferences: v.optional(v.string()),
  demographics: v.optional(v.string()),
  priorData: v.optional(v.array(sessionKeyValueSchema)),
});

const sessionRequestSchema: Schema<CreateSessionRequest> = v.pipe(
  recordSchema,
  v.object({
    personalNeedsAndPreferences: v.optional(v.string()),
    demographics: v.optional(v.string()),
    priorData: v.optional(
      v.array(v.object({ name: v.string(), value: v.unknown(), glossaryUri: v.optional(v.string()) })),
    ),
  }),
);

/** Returns the body of Create Session: the prior data are key and value pairs of text. */
export function writeCreateSessionBody(request: CreateSessionRequest, sharePnp: boolean): unknown {
  const { personalNeedsAndPreferences, demographics, priorData } = parseWith(
    sessionRequestSchema,
    request,
    "The request to create a session",
  );
  return {
    ...(sharePnp && personalNeedsAndPreferences !== undefined ? { personalNeedsAndPreferences } : {}),
    ...(demographics === undefined ? {} : { demographics }),
    ...(priorData === undefined
      ? {}
      : {
          priorData: priorData.map((entry) => {
            // The binding's value is text: a text stays as it is, and any other value is its JSON.
            const value = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
            if (value === undefined) {
              throw new DataError(
                `The value of the prior data ${describe(entry.name)} must be JSON, found ${describe(entry.value)}.`,
              );
            }
            return {
              key: entry.name,
              value,
              ...(entry.glossaryUri === undefined ? {} : { glossaryURI: entry.glossaryUri }),
            };
          }),
        }),
  };
}

/**
 * Reads the body of Create Session.
 *
 * @remarks
 * A value is text, as the binding has it, and the `glossaryURI` of an entry is its `glossaryUri`.
 */
export function readCreateSessionBody(json: unknown): CreateSessionRequest {
  const { personalNeedsAndPreferences, demographics, priorData } = parseWith(
    sessionBodySchema,
    json,
    "The request to Create Session",
  );
  return {
    ...(personalNeedsAndPreferences === undefined ? {} : { personalNeedsAndPreferences }),
    ...(demographics === undefined ? {} : { demographics }),
    ...(priorData === undefined
      ? {}
      : {
          priorData: priorData.map(({ key, value, glossaryURI }) => ({
            name: key,
            value,
            ...(glossaryURI === undefined ? {} : { glossaryUri: glossaryURI }),
          })),
        }),
  };
}

// The binding's `qtiMetadata` of a section is one QTI metadata record, which `qtiMetadataRecord` carries. It is not the
// metadata file that `qtiMetadata` of `SectionData` holds, which the binding has no field for and is not sent.
const bindingSectionSchema: Schema<SectionData> = v.pipe(
  v.strictObject({
    sectionConfiguration: v.string(),
    qtiUsagedata: v.optional(v.string()),
    qtiMetadata: v.optional(metadataRecordSchema),
  }),
  v.transform(({ sectionConfiguration, qtiUsagedata, qtiMetadata }) => ({
    sectionConfiguration,
    ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }),
    ...(qtiMetadata === undefined ? {} : { qtiMetadataRecord: qtiMetadata }),
  })),
);

/** Returns the body of Create Section, which is also the `section` of the answer to Get Section. */
export function writeSectionBody(data: SectionData): unknown {
  const { sectionConfiguration, qtiUsagedata, qtiMetadataRecord } = readSectionData(data);
  return {
    sectionConfiguration,
    ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }),
    ...(qtiMetadataRecord === undefined ? {} : { qtiMetadata: writeMetadataRecord(qtiMetadataRecord) }),
  };
}

/** Reads the body of Create Section. */
export function readSectionBody(json: unknown): SectionData {
  return parseWith(bindingSectionSchema, json, "The request to Create Section");
}

const createSectionSchema = v.object({ sectionIdentifier: nonEmptyStringSchema });

/** Returns the answer to Create Section. */
export function writeCreateSectionAnswer(response: CreateSectionResponse): unknown {
  const { sectionIdentifier } = parseWith(createSectionSchema, response, "The answer to Create Section");
  return { sectionIdentifier };
}

/** Reads the answer to Create Section. */
export function readCreateSectionAnswer(json: unknown): CreateSectionResponse {
  return parseWith(createSectionSchema, json, "The answer to Create Section");
}

const getSectionSchema = v.object({ section: bindingSectionSchema, items: v.optional(v.unknown()) });

const pooledSchema = v.object({ sectionData: v.unknown(), items: v.unknown() });

/** The stage that ends a session, and the pool of a section without items. */
const EMPTY_STAGE: ItemStage = { itemIdentifiers: [], stageLength: 0 };

/**
 * Returns the answer to Get Section: the section and its pool.
 *
 * @remarks
 * The binding's item set has at least one identifier and no stage length, so an empty pool leaves `items` out.
 */
export function writeGetSectionAnswer(response: GetSectionResponse): unknown {
  const { items } = parseWith(pooledSchema, response, "The answer to Get Section");
  const pool = itemStageFromJson(items, "items of the answer to Get Section").itemIdentifiers ?? [];
  return {
    section: writeSectionBody(response.sectionData),
    ...(pool.length === 0 ? {} : { items: { itemIdentifiers: pool } }),
  };
}

/** Reads the answer to Get Section; an `items` that is absent is an empty pool. */
export function readGetSectionAnswer(json: unknown): GetSectionResponse {
  const { section, items } = parseWith(getSectionSchema, json, "The answer to Get Section");
  return {
    sectionData: section,
    items: items === undefined ? EMPTY_STAGE : itemStageFromJson(items, "items of the answer to Get Section"),
  };
}

const sessionAnswerSchema = v.object({
  sessionIdentifier: nonEmptyStringSchema,
  nextItems: v.optional(v.unknown()),
  sessionState: v.optional(v.string()),
});

/** Returns `nextItems` of an answer, or nothing when the stage ends the session: the binding ends a session by sending no stage. */
function nextItemsToJson(stage: ItemStage): { readonly nextItems?: unknown } {
  if (isSessionEnd(stage)) return {};
  const { itemIdentifiers, stageLength } = stage;
  return {
    nextItems: { itemIdentifiers, ...(stageLength === null || stageLength === undefined ? {} : { stageLength }) },
  };
}

/** Returns the answer to Create Session. */
export function writeCreateSessionAnswer(response: CreateSessionResponse): unknown {
  const { sessionIdentifier, nextItems, sessionState } = parseWith(
    sessionAnswerSchema,
    response,
    "The answer to Create Session",
  );
  return {
    sessionIdentifier,
    ...nextItemsToJson(itemStageFromJson(nextItems, "nextItems of the answer to Create Session")),
    ...(sessionState === undefined ? {} : { sessionState }),
  };
}

/** Reads the answer to Create Session. */
export function readCreateSessionAnswer(json: unknown): CreateSessionResponse {
  const { sessionIdentifier, nextItems, sessionState } = parseWith(
    sessionAnswerSchema,
    json,
    "The answer to Create Session",
  );
  return {
    sessionIdentifier,
    nextItems:
      nextItems === undefined ? EMPTY_STAGE : itemStageFromJson(nextItems, "nextItems of the answer to Create Session"),
    ...(sessionState === undefined ? {} : { sessionState }),
  };
}

const resultsRequestSchema = v.pipe(recordSchema, v.object({ sessionState: v.optional(v.string()) }));

/** Returns the body of Submit Results. */
export function writeResultsBody(request: SubmitResultsRequest): unknown {
  const { sessionState } = parseWith(resultsRequestSchema, request, "The request to submit results");
  return {
    assessmentResult: assessmentResultToJson(request.assessmentResult),
    ...(sessionState === undefined ? {} : { sessionState }),
  };
}

const resultsBodySchema = strictRecord({ assessmentResult: v.unknown(), sessionState: v.optional(v.string()) });

/** Reads the body of Submit Results. */
export function readResultsBody(json: unknown): SubmitResultsRequest {
  const { assessmentResult, sessionState } = parseWith(resultsBodySchema, json, "The request to Submit Results");
  return {
    assessmentResult: assessmentResultFromJson(assessmentResult),
    ...(sessionState === undefined ? {} : { sessionState }),
  };
}

const submitAnswerSchema = v.pipe(
  recordSchema,
  v.object({
    nextItems: v.optional(v.unknown()),
    assessmentResult: v.optional(v.unknown()),
    sessionState: v.optional(v.string()),
  }),
);

/** Returns the answer to Submit Results; a stage that ends the session is left out. */
export function writeSubmitResultsAnswer(response: SubmitResultsResponse): unknown {
  const { nextItems, sessionState } = parseWith(submitAnswerSchema, response, "The answer to Submit Results");
  const { assessmentResult } = response;
  return {
    ...(nextItems === null || nextItems === undefined
      ? {}
      : nextItemsToJson(itemStageFromJson(nextItems, "nextItems of the answer to Submit Results"))),
    ...(assessmentResult === undefined ? {} : { assessmentResult: assessmentResultToJson(assessmentResult) }),
    ...(sessionState === undefined ? {} : { sessionState }),
  };
}

/** Reads the answer to Submit Results. */
export function readSubmitResultsAnswer(json: unknown): SubmitResultsResponse {
  const answer = parseWith(submitAnswerSchema, json, "The answer to Submit Results");
  const { nextItems } = answer;
  return {
    ...(nextItems === undefined
      ? {}
      : {
          nextItems:
            nextItems === null ? null : itemStageFromJson(nextItems, "nextItems of the answer to Submit Results"),
        }),
    ...(answer.assessmentResult === undefined
      ? {}
      : { assessmentResult: assessmentResultFromJson(answer.assessmentResult) }),
    ...(answer.sessionState === undefined ? {} : { sessionState: answer.sessionState }),
  };
}
