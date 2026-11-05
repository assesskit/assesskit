// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and the OAuth protocol are those of their specifications.

import {
  checkJsonInput,
  checkRecord,
  describe,
  nonEmptyStringSchema,
  raceAbort,
  type Schema,
} from "@assesskit/runtime/checks";
import { ServiceError } from "@assesskit/runtime/errors";
import { encodeBase64 } from "@assesskit/runtime/values";
import * as v from "valibot";
import { httpsUrlSchema } from "./https-url.js";
import { hasMoreTokensThan } from "./json-tokens.js";

/** A request of the REST client: the part of `RequestInit` that it uses. */
export interface CatFetchRequest {
  /** The HTTP method. */
  readonly method: string;
  /** The request headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** The request body; absent for a request without one. */
  readonly body?: string;
  /** Always `manual`: a redirect would send the bearer token to another address, or from HTTPS to HTTP, so the client refuses the 3xx answer. */
  readonly redirect: "manual";
  /** Aborts the request when it takes longer than the timeout, or when the caller of the port stops waiting. */
  readonly signal: AbortSignal;
}

/** The answer to a request of the REST client: the part of `Response` that it uses. */
export interface CatFetchResponse {
  /** Whether the status is from 200 to 299. */
  readonly ok: boolean;
  /** `opaqueredirect` when a browser withholds the answer to a redirect; a runtime that returns the 3xx answer leaves it as it is. */
  readonly type?: string;
  /** The HTTP status. */
  readonly status: number;
  /** Returns the body as text. */
  text(): Promise<string>;
}

/** The part of the `fetch` function that the REST client uses, so that a host can pass `fetch`, or a replacement. */
export type CatFetch = (url: string, request: CatFetchRequest) => Promise<CatFetchResponse>;

/**
 * The OAuth 2.0 client credentials with which the REST client asks for a bearer token.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, security}
 * @see {@link https://www.rfc-editor.org/rfc/rfc6749#section-4.4 | RFC 6749, client credentials grant}
 */
export interface OAuthClientCredentials {
  /** The token endpoint of the authorization server, an `https` URL. */
  readonly tokenUrl: string;
  /** The client identifier. */
  readonly clientId: string;
  /** The client secret. */
  readonly clientSecret: string;
  /**
   * The scopes to request, separated by spaces. The binding recommends `https://purl.imsglobal.org/cat/v1p0/scope/api`
   * for every endpoint, or `.../scope/configure` for sections and `.../scope/deliver` for sessions; an engine may define
   * other scopes, or none.
   */
  readonly scope: string;
}

/** The schema of OAuth client credentials. */
export const oauthCredentialsSchema: Schema<OAuthClientCredentials> = v.strictObject({
  tokenUrl: httpsUrlSchema,
  clientId: nonEmptyStringSchema,
  clientSecret: nonEmptyStringSchema,
  scope: nonEmptyStringSchema,
});

/** What a request of the REST client sends besides its method and URL. */
interface RestRequest {
  /** The JSON body; none for a request without one. */
  readonly body?: unknown;
  /**
   * Ends the wait of the caller and aborts the request. The request for a token, which the requests of other callers share,
   * goes on to its timeout.
   */
  readonly signal?: AbortSignal | undefined;
}

/** A client of REST services that authorize with OAuth 2.0 client credentials. */
export interface RestClient {
  /**
   * Sends a request with the bearer token of the credentials and returns the JSON of the answer, or `undefined` for an answer
   * without a body. A `401` makes the client ask for a new token and send the request once more.
   *
   * @param credentials - The credentials of the service: the client keeps one token for each token URL, client and scope.
   * @param method - The HTTP method.
   * @param url - The URL.
   * @param request - The body and the signal of the caller.
   * @returns The parsed JSON of the answer.
   * @throws `ServiceError` when the service answers with another status than 2xx after that, or with a body that is not JSON;
   *   `TokenEndpointError`, a `ServiceError`, when the request for a token fails.
   * @throws `signal.reason` when the signal aborts before the answer is read.
   */
  send(credentials: OAuthClientCredentials, method: string, url: string, request?: RestRequest): Promise<unknown>;
}

/** The options of {@link createRestClient}. */
export interface RestClientOptions {
  /** Sends the requests. */
  readonly fetch: CatFetch;
  /** The milliseconds after which a request, the token request included, is aborted. */
  readonly timeoutMs: number;
  /** The most tokens of the JSON of an answer, the answer of the token endpoint included, counted before it is parsed. */
  readonly maxTokens: number;
}

/**
 * The failure of a request to the token endpoint, with the status and the body that the endpoint answered.
 *
 * @remarks
 * The status describes the token request and not the request of the caller, so a gateway must not pass it on: a token
 * endpoint that answers 400 or 404 means that the credentials or the token URL of the host are wrong, which is a fault of the
 * host. `cause` is the error that the request raised.
 */
export class TokenEndpointError extends ServiceError {
  /** Error class name. */
  override name = "TokenEndpointError";

  /** @param failure - The error that the token request raised, which becomes the `cause`. */
  constructor(failure: ServiceError) {
    super(failure.message, failure.status, failure.body, { cause: failure });
  }
}

/** Encodes a value as `application/x-www-form-urlencoded` does, which RFC 6749 section 2.3.1 asks for in a Basic credential. */
function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice("v=".length);
}

/**
 * Parses the JSON body of an answer, or throws the `ServiceError` that names who sent it. The tokens are counted first,
 * since the memory of a parse follows them; the error of an answer above the limit does not hold its body. A property at any
 * depth named `__proto__`, `prototype` or `constructor` is a `DataError`, as a malformed answer is: the schemas that read an
 * answer leave out what they do not name, and would drop it unseen.
 */
function parseBody(text: string, what: string, status: number, maxTokens: number): unknown {
  if (hasMoreTokensThan(text, maxTokens)) {
    throw new ServiceError(
      `${what} answered with more than ${maxTokens} tokens of JSON, the limit of maxTokens.`,
      status,
      "",
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ServiceError(`${what} answered with a body that is not JSON.`, status, text, { cause: error });
  }
  checkJsonInput(json, `${what} answered with JSON that`);
  return json;
}

/**
 * Refuses an answer that redirects. With `redirect: "manual"` a runtime returns the 3xx answer, or, in a browser, an opaque
 * redirect with status 0 that has no body to read; neither is followed, so that the bearer token stays with the address
 * that was configured. The check is a function and not the option `error` of `fetch`, which throws in some runtimes
 * before the request is sent.
 */
function refuseRedirect(response: CatFetchResponse, what: string): void {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new ServiceError(
      `${what} answered with a redirect, which the client does not follow, because the bearer token would go to another address.`,
      response.status,
      "",
    );
  }
}

/**
 * Creates the client of REST services.
 *
 * @remarks
 * It keeps the bearer token of each token URL, client and scope, so that a run of requests asks once, and the requests that
 * need a token at the same time share one request for it, as do those that meet the `401` of one token. It keeps no clock, so it learns that a token expired from the
 * service's `401`, not from `expires_in`; the new token is asked for with the credentials of the call that met the `401`,
 * so that the current secret of the host is used. A failure of the token request is a `TokenEndpointError`.
 *
 * @param options - The `fetch` function, the timeout and the limit on the tokens of an answer.
 * @returns The client.
 */
export function createRestClient({ fetch, timeoutMs, maxTokens }: RestClientOptions): RestClient {
  const tokens = new Map<string, Promise<string>>();

  const requestToken = async ({ tokenUrl, clientId, clientSecret, scope }: OAuthClientCredentials): Promise<string> => {
    // The form-encoded identifier and secret are ASCII (RFC 6749 section 2.3.1), so their UTF-8 bytes are their characters.
    const basic = encodeBase64(new TextEncoder().encode(`${formEncode(clientId)}:${formEncode(clientSecret)}`));
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const what = `The token endpoint ${tokenUrl}`;
    refuseRedirect(response, what);
    const text = await response.text();
    if (!response.ok)
      throw new ServiceError(`${what} answered with the status ${response.status}.`, response.status, text);
    const grant = parseBody(text, what, response.status, maxTokens);
    checkRecord(grant, `${what} must answer with an object`);
    if (typeof grant.access_token !== "string" || grant.access_token === "") {
      throw new ServiceError(`${what} gave no access_token.`, response.status, text);
    }
    if (typeof grant.token_type !== "string" || grant.token_type.toLowerCase() !== "bearer") {
      throw new ServiceError(
        `${what} gave the token type ${describe(grant.token_type)}, and bearer is expected.`,
        response.status,
        text,
      );
    }
    return grant.access_token;
  };

  const keyOf = (credentials: OAuthClientCredentials): string =>
    JSON.stringify([credentials.tokenUrl, credentials.clientId, credentials.scope]);

  const bearer = (credentials: OAuthClientCredentials): Promise<string> => {
    const key = keyOf(credentials);
    let token = tokens.get(key);
    if (token === undefined) {
      token = requestToken(credentials).catch((error: unknown) => {
        tokens.delete(key);
        throw error instanceof ServiceError ? new TokenEndpointError(error) : error;
      });
      tokens.set(key, token);
    }
    return token;
  };

  /**
   * Forgets the token that the service refused. A request that met the `401` after another one asked for a new token leaves
   * that one, so that the requests under way when a token expires ask for one token together.
   */
  const forget = (credentials: OAuthClientCredentials, refused: Promise<string>): void => {
    const key = keyOf(credentials);
    if (tokens.get(key) === refused) tokens.delete(key);
  };

  const attempt = async (
    credentials: OAuthClientCredentials,
    method: string,
    url: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ readonly response: CatFetchResponse; readonly token: Promise<string> }> => {
    const token = bearer(credentials);
    // The token is shared, so the caller's signal ends only the wait for it; the request is the caller's own.
    const bearerToken = await raceAbort(token, { signal });
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    refuseRedirect(response, `The CAT engine at ${url}`);
    return { response, token };
  };

  const sendText = async (
    credentials: OAuthClientCredentials,
    method: string,
    url: string,
    text: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    let { response, token } = await attempt(credentials, method, url, text, signal);
    if (response.status === 401) {
      forget(credentials, token);
      ({ response } = await attempt(credentials, method, url, text, signal));
    }
    const answer = await response.text();
    const what = `The CAT engine at ${url}`;
    if (!response.ok)
      throw new ServiceError(`${what} answered ${method} with the status ${response.status}.`, response.status, answer);
    return answer === "" ? undefined : parseBody(answer, what, response.status, maxTokens);
  };

  return {
    async send(credentials, method, url, { body, signal } = {}) {
      signal?.throwIfAborted();
      // A fetch that a host passes may not honour the signal, so the wait ends on it whatever the fetch does.
      return raceAbort(
        sendText(credentials, method, url, body === undefined ? undefined : JSON.stringify(body), signal),
        { signal },
      );
    },
  };
}
