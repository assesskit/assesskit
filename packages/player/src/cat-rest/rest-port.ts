import type { CatPort } from "@assesskit/runtime/cat";
import {
  type CallOptions,
  checkCallOptions,
  checkNonEmptyString,
  checkString,
  describe,
  functionSchema,
  parseWith,
  positiveIntegerSchema,
  positiveSchema,
  raceAbort,
  type Schema,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import * as v from "valibot";
import {
  readCreateSectionAnswer,
  readCreateSessionAnswer,
  readGetSectionAnswer,
  readSubmitResultsAnswer,
  writeCreateSessionBody,
  writeResultsBody,
  writeSectionBody,
} from "./binding.js";
import { httpsUrlSchema } from "./https-url.js";
import { DEFAULT_MAX_TOKENS } from "./json-tokens.js";
import { type CatFetch, createRestClient, type OAuthClientCredentials, oauthCredentialsSchema } from "./rest-client.js";
import { withoutTrailingSlashes } from "./route.js";

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
 * The engines that a port reaches: a function from the reference that a package names (its `qti-adaptive-engine-ref`, the
 * `prefix` of every request, without trailing slashes) to the engine it stands for, or `undefined` for a reference that the
 * host did not configure. It gets the options of the call of the port, whose `signal` ends the wait for it whether or not it
 * honours the signal.
 *
 * @remarks
 * The package's word is not trusted: a reference only selects among the engines that the host configured, so the function
 * is an allowlist from known references to configured engines, such as `(reference) => engines.get(reference)` over a
 * `Map`. It never derives an address or a token URL from the reference, and never returns shared credentials for any
 * reference, because the port sends the client secret and the candidate's data to the engine it returns. The port calls it
 * for every request, so a secret that rotates is read as it changes.
 */
export type CatEngineResolver = (
  reference: string,
  options?: CallOptions,
) => CatEngine | undefined | Promise<CatEngine | undefined>;

/** Options of {@link createRestCatPort}. */
export interface RestCatPortOptions {
  /** Sends the requests: `fetch`, or a replacement. */
  readonly fetch: CatFetch;
  /** The engines that the port reaches, by the reference that a package names. */
  readonly engines: CatEngineResolver;
  /**
   * The milliseconds after which a request is aborted, the token request included.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most tokens of the JSON of an answer of an engine or of its token endpoint, counted before it is parsed: a
   * structural character, a string, a number or a literal each count one. An answer with more is a `ServiceError`. The
   * memory of a parse follows its tokens, not its bytes: 32 MiB of empty objects parse into more than a gigabyte.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
}

/** The milliseconds after which a request to the engine is aborted, unless the host says otherwise. */
const DEFAULT_TIMEOUT_MS = 10_000;

const engineSchema: Schema<CatEngine> = v.strictObject({
  endpoint: httpsUrlSchema,
  credentials: oauthCredentialsSchema,
  sharePnp: v.optional(v.boolean()),
});

const optionsSchema = v.strictObject({
  fetch: functionSchema<CatFetch>(),
  engines: functionSchema<CatEngineResolver>(),
  timeoutMs: v.optional(positiveSchema, DEFAULT_TIMEOUT_MS),
  maxTokens: v.optional(positiveIntegerSchema, DEFAULT_MAX_TOKENS),
});

/**
 * The segments of a path that a URL takes as a step to another path, written as they are or with escapes: an identifier that
 * is one cannot be sent, since `sections/..` is the endpoint itself.
 *
 * @see {@link https://url.spec.whatwg.org/#single-dot-path-segment | URL Standard, dot segments}
 */
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

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
 *   network error or a timeout rejects with the error of `fetch`. An answer is read whole, and its JSON has at most
 *   `maxTokens` tokens.
 * - **Signals.** The `signal` of a call ends its wait, for the engine that `engines` looks up too, and aborts its request;
 *   the token request, which the calls share, goes on to its timeout. A call whose signal has aborted sends nothing.
 * - **Personal data.** Create Session sends the personal needs and preferences only to an engine with `sharePnp`.
 * - **Binding.** The bodies are those of the binding's OpenAPI file, and the port sends no other shape. The `qtiMetadata`
 *   of the binding is one QTI metadata record, which `qtiMetadataRecord` of the section data carries; the metadata file of
 *   the section data has no field in the binding, so Create Section does not send it. The assessment result drops what the
 *   binding has no field for.
 *
 * @param options - The `fetch` function, the engines, the timeout and the limit on the tokens of an answer.
 * @returns The engine, as the runtime's `CatPort`.
 * @throws `DataError` when an option has the wrong type, an engine is malformed or an endpoint is not an `https` URL.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding}
 */
export function createRestCatPort(options: RestCatPortOptions): CatPort {
  const { fetch, engines, timeoutMs, maxTokens } = parseWith(optionsSchema, options, "The options object");

  const client = createRestClient({ fetch, timeoutMs, maxTokens });

  /** Finds the engine that a reference stands for; a reference that the host did not configure is refused. */
  const engineOf = async (prefix: unknown, signal: AbortSignal | undefined): Promise<CatEngine> => {
    checkString(prefix, "The prefix");
    const reference = withoutTrailingSlashes(prefix);
    const found = await raceAbort(Promise.resolve(engines(reference, { signal })), { signal });
    if (found === undefined) {
      throw new DataError(
        `The reference ${describe(prefix)} is not an engine that the host configured; the port sends nothing to another engine.`,
      );
    }
    return parseWith(engineSchema, found, `The engine of the reference ${describe(prefix)}`);
  };

  /** Where a path is at an engine, and the engine. */
  const at = async (
    prefix: string,
    path: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<{ readonly engine: CatEngine; readonly url: string }> => {
    const step = path.find((segment) => DOT_SEGMENTS.has(segment));
    if (step !== undefined) {
      throw new DataError(
        `The identifier ${describe(step)} cannot be sent in the path of a URL, which takes it as a step to another path.`,
      );
    }
    const engine = await engineOf(prefix, signal);
    return { engine, url: [withoutTrailingSlashes(engine.endpoint), ...path.map(encodeURIComponent)].join("/") };
  };
  const section = (
    prefix: string,
    sectionIdentifier: string,
    signal: AbortSignal | undefined,
  ): ReturnType<typeof at> => {
    checkNonEmptyString(sectionIdentifier, "The section identifier");
    return at(prefix, ["sections", sectionIdentifier], signal);
  };
  const session = (
    prefix: string,
    sectionIdentifier: string,
    sessionIdentifier: string,
    signal: AbortSignal | undefined,
  ): ReturnType<typeof at> => {
    checkNonEmptyString(sessionIdentifier, "The session identifier");
    checkNonEmptyString(sectionIdentifier, "The section identifier");
    return at(prefix, ["sections", sectionIdentifier, "sessions", sessionIdentifier], signal);
  };
  /** Reads the signal of the options of a call, which a caller from JavaScript may pass with the wrong type. */
  const signalOf = (options: CallOptions | undefined): AbortSignal | undefined => {
    checkCallOptions(options);
    options?.signal?.throwIfAborted();
    return options?.signal;
  };

  return {
    async createSection(prefix, data, options) {
      const signal = signalOf(options);
      const { engine, url } = await at(prefix, ["sections"], signal);
      const body = await client.send(engine.credentials, "POST", url, { body: writeSectionBody(data), signal });
      return readCreateSectionAnswer(body);
    },

    async getSection(prefix, sectionIdentifier, options) {
      const signal = signalOf(options);
      const { engine, url } = await section(prefix, sectionIdentifier, signal);
      return readGetSectionAnswer(await client.send(engine.credentials, "GET", url, { signal }));
    },

    async createSession(prefix, sectionIdentifier, request, options) {
      const signal = signalOf(options);
      checkNonEmptyString(sectionIdentifier, "The section identifier");
      const { engine, url } = await at(prefix, ["sections", sectionIdentifier, "sessions"], signal);
      const body = writeCreateSessionBody(request, engine.sharePnp ?? false);
      return readCreateSessionAnswer(await client.send(engine.credentials, "POST", url, { body, signal }));
    },

    async submitResults(prefix, sectionIdentifier, sessionIdentifier, request, options) {
      const signal = signalOf(options);
      const body = writeResultsBody(request);
      checkNonEmptyString(sessionIdentifier, "The session identifier");
      checkNonEmptyString(sectionIdentifier, "The section identifier");
      const path = ["sections", sectionIdentifier, "sessions", sessionIdentifier, "results"];
      const { engine, url } = await at(prefix, path, signal);
      return readSubmitResultsAnswer(await client.send(engine.credentials, "POST", url, { body, signal }));
    },

    async endSession(prefix, sectionIdentifier, sessionIdentifier, options) {
      const signal = signalOf(options);
      const { engine, url } = await session(prefix, sectionIdentifier, sessionIdentifier, signal);
      await client.send(engine.credentials, "DELETE", url, { signal });
    },

    async endSection(prefix, sectionIdentifier, options) {
      const signal = signalOf(options);
      const { engine, url } = await section(prefix, sectionIdentifier, signal);
      await client.send(engine.credentials, "DELETE", url, { signal });
    },
  };
}
