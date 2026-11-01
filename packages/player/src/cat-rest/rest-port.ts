import type { CatPort } from "@assesskit/runtime/cat";
import {
  checkNonEmptyString,
  checkString,
  describe,
  functionSchema,
  parseWith,
  positiveSchema,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import * as v from "valibot";
import { httpsUrlSchema } from "../checks.js";
import {
  readCreateSectionAnswer,
  readCreateSessionAnswer,
  readGetSectionAnswer,
  readSubmitResultsAnswer,
  writeCreateSessionBody,
  writeResultsBody,
  writeSectionBody,
} from "./binding.js";
import { type CatFetch, createRestClient, type OAuthClientCredentials, oauthCredentialsSchema } from "./rest-client.js";

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
  /**
   * The milliseconds after which a request is aborted.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * Whether Create Session sends the candidate's personal needs and preferences to the engine.
   *
   * @defaultValue `false`
   */
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

/**
 * Returns a CAT engine that speaks the REST/JSON binding of CAT 1.0 to one remote service.
 *
 * @remarks
 * The port talks HTTPS with OAuth 2.0 client credentials. It serves the `prefix` of `endpoint` only: the
 * `qti-adaptive-engine-ref` of a package is the package's word, and the host trusts the engine it configured, so a
 * request for another prefix is refused before any candidate data or token leaves.
 *
 * - **Authorization.** The port asks the token endpoint for a bearer token and keeps it until the engine answers `401`,
 *   then asks again and repeats the request once. It reads no clock.
 * - **Requests.** Redirects are errors, and every request, the token request included, is aborted after `timeoutMs`. A
 *   network error or a timeout rejects with the error of `fetch`.
 * - **Personal data.** Create Session sends the personal needs and preferences only with `sharePnp`.
 * - **Binding.** The bodies are those of the binding's OpenAPI file, and the port sends no other shape. The `qtiMetadata`
 *   of the binding is one QTI metadata record, which the metadata file of the section data is not, so Create Section
 *   does not send the metadata file, and Get Section does not return an object as section data. The assessment result
 *   drops what the binding has no field for.
 *
 * @param options - The `fetch` function, the engine, its credentials, the timeout and whether to share the personal
 * needs and preferences.
 * @returns The engine, as the runtime's `CatPort`.
 * @throws `DataError` when an option has the wrong type, or a URL is not an `https` URL.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding}
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
      const body = await client.send("POST", url(prefix, "sections"), writeSectionBody(data));
      return readCreateSectionAnswer(body);
    },

    async getSection(prefix, sectionIdentifier) {
      return readGetSectionAnswer(await client.send("GET", section(prefix, sectionIdentifier)));
    },

    async createSession(prefix, sectionIdentifier, request) {
      const target = `${section(prefix, sectionIdentifier)}/sessions`;
      return readCreateSessionAnswer(await client.send("POST", target, writeCreateSessionBody(request, sharePnp)));
    },

    async submitResults(prefix, sectionIdentifier, sessionIdentifier, request) {
      const body = writeResultsBody(request);
      const target = `${session(prefix, sectionIdentifier, sessionIdentifier)}/results`;
      return readSubmitResultsAnswer(await client.send("POST", target, body));
    },

    async endSession(prefix, sectionIdentifier, sessionIdentifier) {
      await client.send("DELETE", session(prefix, sectionIdentifier, sessionIdentifier));
    },

    async endSection(prefix, sectionIdentifier) {
      await client.send("DELETE", section(prefix, sectionIdentifier));
    },
  };
}
