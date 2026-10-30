import {
  assessmentResultFromJson,
  assessmentResultToJson,
  type CatPort,
  type CreateSessionRequest,
  type CreateSessionResponse,
  itemStageFromJson,
  type SectionData,
  type SubmitResultsResponse,
} from "@luthfanwakan/olah/cat";
import {
  checkArray,
  checkBoolean,
  checkFunction,
  checkHttpsUrl,
  checkNonEmptyString,
  checkPositive,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { DataError } from "../errors.js";
import { type CatFetch, checkCredentials, createRestClient, type OAuthClientCredentials } from "./rest-client.js";
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

const OPTIONS = ["fetch", "endpoint", "credentials", "timeoutMs", "sharePnp"];

/** The milliseconds after which a request to the engine is aborted, unless the host says otherwise. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Removes the slashes that end a URL, so that a prefix with and without one is the same prefix. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/** Returns the body of Create Session in the binding (§5.2.4): the prior data are key and value pairs of text. */
function sessionBody(request: CreateSessionRequest, sharePnp: boolean): unknown {
  checkRecord(request, "The request to create a session must be an object");
  const { personalNeedsAndPreferences, demographics, priorData } = request;
  if (personalNeedsAndPreferences !== undefined) {
    checkString(personalNeedsAndPreferences, "The personalNeedsAndPreferences of the request");
  }
  if (demographics !== undefined) checkString(demographics, "The demographics of the request");
  if (priorData !== undefined) checkArray(priorData, "The priorData of the request must be an array");
  return {
    ...(sharePnp && personalNeedsAndPreferences !== undefined ? { personalNeedsAndPreferences } : {}),
    ...(demographics === undefined ? {} : { demographics }),
    ...(priorData === undefined
      ? {}
      : {
          priorData: priorData.map((entry) => {
            checkRecord(entry, "An entry of the priorData must be an object");
            checkString(entry.name, "The name of an entry of the priorData");
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

function optionalText(
  body: Readonly<Record<string, unknown>>,
  name: string,
  label: string,
): { readonly [key: string]: string } {
  const value = body[name];
  if (value === undefined) return {};
  checkString(value, `The ${name} of ${label}`);
  return { [name]: value };
}

/**
 * Reads the `section` of a Get Section answer. The binding allows a `qtiMetadata` object there; it is a QTI metadata
 * record, not the metadata file that `SectionData` holds, so it is checked and not returned.
 */
function readBindingSection(section: unknown): SectionData {
  checkRecord(section, "The section of the answer to Get Section must be an object");
  const { qtiMetadata, ...files } = section;
  if (qtiMetadata !== undefined)
    checkRecord(qtiMetadata, "The qtiMetadata of the answer to Get Section must be an object");
  return readSectionData(files);
}

function readCreateSession(body: unknown): CreateSessionResponse {
  const label = "the answer to Create Session";
  checkRecord(body, `The answer to Create Session must be an object`);
  checkNonEmptyString(body.sessionIdentifier, `The sessionIdentifier of ${label}`);
  return {
    sessionIdentifier: body.sessionIdentifier,
    // A missing stage ends the session (CAT §4.2).
    nextItems:
      body.nextItems === undefined
        ? { itemIdentifiers: [], stageLength: 0 }
        : itemStageFromJson(body.nextItems, `nextItems of ${label}`),
    ...optionalText(body, "sessionState", label),
  };
}

function readSubmitResults(body: unknown): SubmitResultsResponse {
  const label = "the answer to Submit Results";
  checkRecord(body, `The answer to Submit Results must be an object`);
  const { nextItems, assessmentResult } = body;
  return {
    ...(nextItems === undefined
      ? {}
      : { nextItems: nextItems === null ? null : itemStageFromJson(nextItems, `nextItems of ${label}`) }),
    ...(assessmentResult === undefined ? {} : { assessmentResult: assessmentResultFromJson(assessmentResult) }),
    ...optionalText(body, "sessionState", label),
  };
}

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
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTIONS);
  const { fetch, endpoint, credentials, timeoutMs = DEFAULT_TIMEOUT_MS, sharePnp = false } = options;
  checkFunction(fetch, "The option fetch must be a function of a URL and a request");
  checkHttpsUrl(endpoint, "The option endpoint");
  checkCredentials(credentials);
  checkPositive(timeoutMs, "The option timeoutMs");
  checkBoolean(sharePnp, "The option sharePnp");

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
      checkRecord(body, "The answer to Create Section must be an object");
      checkNonEmptyString(body.sectionIdentifier, "The sectionIdentifier of the answer to Create Section");
      return { sectionIdentifier: body.sectionIdentifier };
    },

    async getSection(prefix, sectionIdentifier) {
      const body = await client.send("GET", section(prefix, sectionIdentifier));
      checkRecord(body, "The answer to Get Section must be an object");
      return {
        sectionData: readBindingSection(body.section),
        items: itemStageFromJson(body.items, "items of the answer to Get Section"),
      };
    },

    async createSession(prefix, sectionIdentifier, request) {
      const target = `${section(prefix, sectionIdentifier)}/sessions`;
      return readCreateSession(await client.send("POST", target, sessionBody(request, sharePnp)));
    },

    async submitResults(prefix, sectionIdentifier, sessionIdentifier, request) {
      checkRecord(request, "The request to submit results must be an object");
      const { assessmentResult, sessionState } = request;
      if (sessionState !== undefined) checkString(sessionState, "The sessionState of the request");
      const body = {
        assessmentResult: assessmentResultToJson(assessmentResult),
        ...(sessionState === undefined ? {} : { sessionState }),
      };
      const target = `${session(prefix, sectionIdentifier, sessionIdentifier)}/results`;
      return readSubmitResults(await client.send("POST", target, body));
    },

    async endSession(prefix, sectionIdentifier, sessionIdentifier) {
      await client.send("DELETE", session(prefix, sectionIdentifier, sessionIdentifier));
    },

    async endSection(prefix, sectionIdentifier) {
      await client.send("DELETE", section(prefix, sectionIdentifier));
    },
  };
}
