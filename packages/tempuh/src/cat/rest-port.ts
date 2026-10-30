import {
  assessmentResultFromJson,
  assessmentResultToJson,
  type CatPort,
  type CreateSessionRequest,
  itemStageFromJson,
  type SectionData,
} from "@luthfanwakan/olah/cat";
import * as v from "valibot";
import {
  checkNonEmptyString,
  checkString,
  describe,
  functionSchema,
  httpsUrlSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveSchema,
  recordSchema,
  type Schema,
} from "../checks.js";
import { DataError } from "../errors.js";
import { type CatFetch, createRestClient, type OAuthClientCredentials, oauthCredentialsSchema } from "./rest-client.js";
import { readSectionData } from "./section-data.js";

/** Options of {@link restCatPort}. */
export interface RestCatPortOptions {
  /** Sends the requests: `fetch`, or a replacement. */
  readonly fetch: CatFetch;
  /**
   * The URL prefix of the one engine that the port serves, an `https` URL such as `https://cat.example/ims/cat/v1p0`. It is
   * the `qti-adaptive-engine-ref` of the sections, which the port compares with the `prefix` of every request.
   */
  readonly endpoint: string;
  /** The OAuth 2.0 client credentials for the engine. */
  readonly credentials: OAuthClientCredentials;
  /** The milliseconds after which a request is aborted. Default: `10000`. */
  readonly timeoutMs?: number;
  /** Whether Create Session sends the candidate's personal needs and preferences to the engine. Default: `false`. */
  readonly sharePnp?: boolean;
}

/** The milliseconds after which a request to the engine is aborted, unless the host says otherwise. */
const DEFAULT_TIMEOUT_MS = 10_000;

const optionsSchema = v.strictObject({
  fetch: functionSchema<CatFetch>(),
  endpoint: httpsUrlSchema,
  credentials: oauthCredentialsSchema,
  timeoutMs: v.optional(positiveSchema, DEFAULT_TIMEOUT_MS),
  sharePnp: v.optional(v.boolean(), false),
});

/** Removes the slashes that end a URL, so that a prefix with and without one is the same prefix. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

const sessionRequestSchema: Schema<CreateSessionRequest> = v.object({
  personalNeedsAndPreferences: v.optional(v.string()),
  demographics: v.optional(v.string()),
  priorData: v.optional(v.array(v.object({ name: v.string(), value: v.unknown() }))),
});

/** Returns the body of Create Session in the binding (§5.2.4): the prior data are key and value pairs of text. */
function sessionBody(request: CreateSessionRequest, sharePnp: boolean): unknown {
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
            return { key: entry.name, value };
          }),
        }),
  };
}

// olah reads the stage and the assessment result, and its errors pass through unchanged, so the schemas leave them whole.
// The binding allows a `qtiMetadata` object in the section of a Get Section answer. It is a QTI metadata record, not the
// metadata file that `SectionData` holds, so it is checked and not returned.
const bindingSectionSchema: Schema<SectionData> = v.pipe(
  v.strictObject({
    sectionConfiguration: v.string(),
    qtiUsagedata: v.optional(v.string()),
    qtiMetadata: v.optional(recordSchema),
  }),
  v.transform(({ sectionConfiguration, qtiUsagedata }) => ({
    sectionConfiguration,
    ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }),
  })),
);

const getSectionSchema = v.object({ section: bindingSectionSchema, items: v.optional(v.unknown()) });

const createSectionSchema = v.object({ sectionIdentifier: nonEmptyStringSchema });

const createSessionSchema = v.object({
  sessionIdentifier: nonEmptyStringSchema,
  nextItems: v.optional(v.unknown()),
  sessionState: v.optional(v.string()),
});

const submitResultsSchema = v.object({
  nextItems: v.optional(v.unknown()),
  assessmentResult: v.optional(v.unknown()),
  sessionState: v.optional(v.string()),
});

const submitRequestSchema = v.pipe(recordSchema, v.object({ sessionState: v.optional(v.string()) }));

/**
 * Returns a CAT engine that speaks the REST/JSON binding of CAT 1.0 (https://www.imsglobal.org/spec/cat/v1p0/bind) to one
 * remote service, over HTTPS with OAuth 2.0 client credentials. It serves the `prefix` of `endpoint` only: the
 * `qti-adaptive-engine-ref` of a package is the package's word, and the host trusts the engine it configured, so a
 * request for another prefix is refused before any candidate data or token leaves.
 *
 * - **Authorization.** The port asks the token endpoint for a bearer token and keeps it until the engine answers `401`,
 *   then asks again and repeats the request once. It reads no clock.
 * - **Requests.** Redirects are errors, and every request, the token request included, is aborted after `timeoutMs`. A
 *   network error or a timeout rejects with the error of `fetch`.
 * - **Personal data.** Create Session sends the personal needs and preferences only with `sharePnp`.
 * - **Binding.** The bodies are those of the binding's OpenAPI file, and the port sends no other shape. The `qtiMetadata`
 *   of the binding is one QTI metadata record, which the metadata file of the section data (CAT §4.1, App. B) is not, so
 *   Create Section does not send the metadata file, and Get Section does not return an object as section data. The
 *   assessment result drops what the binding has no field for.
 *
 * @throws `DataError` when an option has the wrong type, or an URL is not an `https` URL.
 */
export function restCatPort(options: RestCatPortOptions): CatPort {
  const { fetch, endpoint, credentials, timeoutMs, sharePnp } = parseWith(optionsSchema, options, "The options object");

  const base = withoutTrailingSlashes(endpoint);
  const client = createRestClient({ fetch, credentials, timeoutMs });
  const url = (prefix: string, ...path: readonly string[]): string => {
    checkString(prefix, "The prefix");
    if (withoutTrailingSlashes(prefix) !== base) {
      throw new DataError(
        `The prefix ${describe(prefix)} is not the engine ${describe(endpoint)} that this port serves; the port sends nothing to another engine.`,
      );
    }
    return [base, ...path.map(encodeURIComponent)].join("/");
  };
  const section = (prefix: string, sectionIdentifier: string): string => {
    checkNonEmptyString(sectionIdentifier, "The section identifier");
    return url(prefix, "sections", sectionIdentifier);
  };
  const session = (prefix: string, sectionIdentifier: string, sessionIdentifier: string): string => {
    checkNonEmptyString(sessionIdentifier, "The session identifier");
    return `${section(prefix, sectionIdentifier)}/sessions/${encodeURIComponent(sessionIdentifier)}`;
  };

  return {
    async createSection(prefix, data) {
      // The binding's qtiMetadata is one QTI metadata record, and the metadata file is not (see the TSDoc above).
      const { sectionConfiguration, qtiUsagedata } = readSectionData(data);
      const section = { sectionConfiguration, ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }) };
      const body = await client.send("POST", url(prefix, "sections"), section);
      return parseWith(createSectionSchema, body, "The answer to Create Section");
    },

    async getSection(prefix, sectionIdentifier) {
      const body = await client.send("GET", section(prefix, sectionIdentifier));
      const { section: sectionData, items } = parseWith(getSectionSchema, body, "The answer to Get Section");
      return { sectionData, items: itemStageFromJson(items, "items of the answer to Get Section") };
    },

    async createSession(prefix, sectionIdentifier, request) {
      const target = `${section(prefix, sectionIdentifier)}/sessions`;
      const body = await client.send("POST", target, sessionBody(request, sharePnp));
      const { sessionIdentifier, nextItems, sessionState } = parseWith(
        createSessionSchema,
        body,
        "The answer to Create Session",
      );
      return {
        sessionIdentifier,
        // A missing stage ends the session (CAT §4.2).
        nextItems:
          nextItems === undefined
            ? { itemIdentifiers: [], stageLength: 0 }
            : itemStageFromJson(nextItems, "nextItems of the answer to Create Session"),
        ...(sessionState === undefined ? {} : { sessionState }),
      };
    },

    async submitResults(prefix, sectionIdentifier, sessionIdentifier, request) {
      const { sessionState } = parseWith(submitRequestSchema, request, "The request to submit results");
      const body = {
        assessmentResult: assessmentResultToJson(request.assessmentResult),
        ...(sessionState === undefined ? {} : { sessionState }),
      };
      const target = `${session(prefix, sectionIdentifier, sessionIdentifier)}/results`;
      const answer = parseWith(
        submitResultsSchema,
        await client.send("POST", target, body),
        "The answer to Submit Results",
      );
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
    },

    async endSession(prefix, sectionIdentifier, sessionIdentifier) {
      await client.send("DELETE", session(prefix, sectionIdentifier, sessionIdentifier));
    },

    async endSection(prefix, sectionIdentifier) {
      await client.send("DELETE", section(prefix, sectionIdentifier));
    },
  };
}
