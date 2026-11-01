import type { CatPort } from "@assesskit/runtime/cat";
import {
  checkNonEmptyString,
  checkString,
  describe,
  functionSchema,
  guardSchema,
  parseWith,
  positiveSchema,
  type Schema,
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

/** An engine that the port reaches: where it is, how to authorize at it, and what it may be told about the candidate. */
export interface CatEngine {
  /**
   * The URL prefix of the engine, an `https` URL such as `https://cat.example/ims/cat/v1p0`. It may differ from the
   * reference that a package names, such as when a gateway stands in front of the engine.
   */
  readonly endpoint: string;
  /** The OAuth 2.0 client credentials for the engine. */
  readonly credentials: OAuthClientCredentials;
  /**
   * Whether Create Session sends the candidate's personal needs and preferences to this engine.
   *
   * @defaultValue `false`
   */
  readonly sharePnp?: boolean;
}

/**
 * The engines that a port reaches, by the reference that a package names (its `qti-adaptive-engine-ref`, which is the
 * `prefix` of every request): a map from references to engines, or a function that returns the engine of a reference, or
 * `undefined` for a reference that the host did not configure.
 *
 * @remarks
 * The package's word is not trusted: a reference only selects among the engines that the host configured. A function is an
 * allowlist from known references to configured engines. It never derives an address or a token URL from the reference,
 * and never returns shared credentials for any reference, because the port sends the client secret and the candidate's
 * data to the engine it returns. A `Map` is read once, when the port is created, and a later change to it is not seen: a
 * secret that rotates needs the function, which the port calls for every request.
 */
export type CatEngines = ReadonlyMap<string, CatEngine> | CatEngineResolver;

/** A function from the reference that a package names to the engine it stands for, or `undefined` for an unknown reference. */
export type CatEngineResolver = (reference: string) => CatEngine | undefined | Promise<CatEngine | undefined>;

/** Options of {@link createRestCatPort}. */
export interface RestCatPortOptions {
  /** Sends the requests: `fetch`, or a replacement. */
  readonly fetch: CatFetch;
  /** The engines that the port reaches, by the reference that a package names. */
  readonly engines: CatEngines;
  /**
   * The milliseconds after which a request is aborted, the token request included.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
}

/** The milliseconds after which a request to the engine is aborted, unless the host says otherwise. */
const DEFAULT_TIMEOUT_MS = 10_000;

const engineSchema: Schema<CatEngine> = v.strictObject({
  endpoint: httpsUrlSchema,
  credentials: oauthCredentialsSchema,
  sharePnp: v.optional(v.boolean()),
});

const enginesSchema = v.union([
  guardSchema((value): value is ReadonlyMap<string, CatEngine> => value instanceof Map, "a Map"),
  functionSchema<CatEngineResolver>(),
]);

const optionsSchema = v.strictObject({
  fetch: functionSchema<CatFetch>(),
  engines: enginesSchema,
  timeoutMs: v.optional(positiveSchema, DEFAULT_TIMEOUT_MS),
});

/** Removes the slashes that end a URL, so that a reference and an endpoint with and without one are the same. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/** Checks the engines of a map, and keys them by their reference without trailing slashes. */
function checkedMap(engines: ReadonlyMap<string, CatEngine>): ReadonlyMap<string, CatEngine> {
  const keyed = new Map<string, CatEngine>();
  for (const [reference, engine] of engines) {
    checkNonEmptyString(reference, "A reference of the option engines");
    const key = withoutTrailingSlashes(reference);
    if (keyed.has(key)) {
      throw new DataError(
        `The option engines has the reference ${describe(key)} twice, with and without a trailing slash; give each engine one reference.`,
      );
    }
    keyed.set(key, parseWith(engineSchema, engine, `The engine of the reference ${describe(reference)}`));
  }
  return keyed;
}

/**
 * Returns a CAT engine that speaks the REST/JSON binding of CAT 1.0 to the remote engines that the host configured.
 *
 * @remarks
 * The port talks HTTPS with OAuth 2.0 client credentials. The `prefix` of a request is the reference that the package names
 * (`qti-adaptive-engine-ref`), and `engines` says which engine it stands for: where it is and with which credentials. A
 * reference that `engines` does not know is refused before any candidate data or token leaves, because the package's word
 * is not trusted. One port serves many engines, and a gateway maps its public reference to the upstream endpoint.
 *
 * - **Authorization.** The port asks the token endpoint of the engine for a bearer token and keeps one for each token URL,
 *   client and scope until the engine answers `401`, then asks again with the credentials that `engines` gives for the
 *   request and repeats it once. A `403` is a failure and is not repeated. It reads no clock. A failed token request is a
 *   `ServiceError` that `createCatRestHandler` answers as a fault, whatever its status.
 * - **Requests.** Redirects are errors, and every request, the token request included, is aborted after `timeoutMs`. A
 *   network error or a timeout rejects with the error of `fetch`.
 * - **Personal data.** Create Session sends the personal needs and preferences only to an engine with `sharePnp`.
 * - **Binding.** The bodies are those of the binding's OpenAPI file, and the port sends no other shape. The `qtiMetadata`
 *   of the binding is one QTI metadata record, which `qtiMetadataRecord` of the section data carries; the metadata file of
 *   the section data has no field in the binding, so Create Section does not send it. The assessment result drops what the
 *   binding has no field for.
 *
 * @param options - The `fetch` function, the engines and the timeout.
 * @returns The engine, as the runtime's `CatPort`.
 * @throws `DataError` when an option has the wrong type, an engine is malformed or an endpoint is not an `https` URL.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding}
 */
export function createRestCatPort(options: RestCatPortOptions): CatPort {
  const { fetch, engines, timeoutMs } = parseWith(optionsSchema, options, "The options object");

  const known = typeof engines === "function" ? undefined : checkedMap(engines);
  const resolve = typeof engines === "function" ? engines : undefined;
  const client = createRestClient({ fetch, timeoutMs });

  /** Finds the engine that a reference stands for; a reference that the host did not configure is refused. */
  const engineOf = async (prefix: unknown): Promise<CatEngine> => {
    checkString(prefix, "The prefix");
    const reference = withoutTrailingSlashes(prefix);
    const found = resolve === undefined ? known?.get(reference) : await resolve(reference);
    if (found === undefined) {
      throw new DataError(
        `The reference ${describe(prefix)} is not an engine that the host configured; the port sends nothing to another engine.`,
      );
    }
    return resolve === undefined
      ? found
      : parseWith(engineSchema, found, `The engine of the reference ${describe(prefix)}`);
  };

  /** Where a path is at an engine, and the engine. */
  const at = async (
    prefix: string,
    ...path: readonly string[]
  ): Promise<{ readonly engine: CatEngine; readonly url: string }> => {
    const engine = await engineOf(prefix);
    return { engine, url: [withoutTrailingSlashes(engine.endpoint), ...path.map(encodeURIComponent)].join("/") };
  };
  const section = (prefix: string, sectionIdentifier: string): ReturnType<typeof at> => {
    checkNonEmptyString(sectionIdentifier, "The section identifier");
    return at(prefix, "sections", sectionIdentifier);
  };
  const session = (prefix: string, sectionIdentifier: string, sessionIdentifier: string): ReturnType<typeof at> => {
    checkNonEmptyString(sessionIdentifier, "The session identifier");
    checkNonEmptyString(sectionIdentifier, "The section identifier");
    return at(prefix, "sections", sectionIdentifier, "sessions", sessionIdentifier);
  };

  return {
    async createSection(prefix, data) {
      const { engine, url } = await at(prefix, "sections");
      const body = await client.send(engine.credentials, "POST", url, writeSectionBody(data));
      return readCreateSectionAnswer(body);
    },

    async getSection(prefix, sectionIdentifier) {
      const { engine, url } = await section(prefix, sectionIdentifier);
      return readGetSectionAnswer(await client.send(engine.credentials, "GET", url));
    },

    async createSession(prefix, sectionIdentifier, request) {
      checkNonEmptyString(sectionIdentifier, "The section identifier");
      const { engine, url } = await at(prefix, "sections", sectionIdentifier, "sessions");
      const body = writeCreateSessionBody(request, engine.sharePnp ?? false);
      return readCreateSessionAnswer(await client.send(engine.credentials, "POST", url, body));
    },

    async submitResults(prefix, sectionIdentifier, sessionIdentifier, request) {
      const body = writeResultsBody(request);
      checkNonEmptyString(sessionIdentifier, "The session identifier");
      checkNonEmptyString(sectionIdentifier, "The section identifier");
      const { engine, url } = await at(prefix, "sections", sectionIdentifier, "sessions", sessionIdentifier, "results");
      return readSubmitResultsAnswer(await client.send(engine.credentials, "POST", url, body));
    },

    async endSession(prefix, sectionIdentifier, sessionIdentifier) {
      const { engine, url } = await session(prefix, sectionIdentifier, sessionIdentifier);
      await client.send(engine.credentials, "DELETE", url);
    },

    async endSection(prefix, sectionIdentifier) {
      const { engine, url } = await section(prefix, sectionIdentifier);
      await client.send(engine.credentials, "DELETE", url);
    },
  };
}
