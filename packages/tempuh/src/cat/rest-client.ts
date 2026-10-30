// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and the OAuth protocol are those of their specifications.
import { checkHttpsUrl, checkNonEmptyString, checkProperties, checkRecord, describe } from "../checks.js";
import { ServiceError } from "../errors.js";

/** A request of the REST client: the part of `RequestInit` that it uses. */
export interface CatFetchRequest {
  /** The HTTP method. */
  readonly method: string;
  /** The request headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** The request body; absent for a request without one. */
  readonly body?: string;
  /** Always `error`: a redirect would send the bearer token to another address, or from HTTPS to HTTP. */
  readonly redirect: "error";
  /** Aborts the request when it takes longer than the timeout. */
  readonly signal: AbortSignal;
}

/** The answer to a request of the REST client: the part of `Response` that it uses. */
export interface CatFetchResponse {
  /** Whether the status is from 200 to 299. */
  readonly ok: boolean;
  /** The HTTP status. */
  readonly status: number;
  /** Returns the body as text. */
  text(): Promise<string>;
}

/** The part of the `fetch` function that the REST client uses, so that a host can pass `fetch`, or a replacement. */
export type CatFetch = (url: string, request: CatFetchRequest) => Promise<CatFetchResponse>;

/** The OAuth 2.0 client credentials with which the REST client asks for a bearer token (CAT binding §4.2, RFC 6749 §4.4). */
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

const CREDENTIALS = ["tokenUrl", "clientId", "clientSecret", "scope"];

/**
 * Checks OAuth client credentials, as a host passes them from JavaScript.
 *
 * @throws `DataError` when they are not an object with an `https` token URL and non-empty client identifier, secret and scope.
 */
export function checkCredentials(value: unknown): asserts value is OAuthClientCredentials {
  checkRecord(value, "The option credentials must be an object");
  checkProperties(value, "The option credentials", CREDENTIALS);
  checkHttpsUrl(value.tokenUrl, "The tokenUrl of the credentials");
  checkNonEmptyString(value.clientId, "The clientId of the credentials");
  checkNonEmptyString(value.clientSecret, "The clientSecret of the credentials");
  checkNonEmptyString(value.scope, "The scope of the credentials");
}

/** A client of a REST service that authorizes with OAuth 2.0 client credentials. */
export interface RestClient {
  /**
   * Sends a request with the bearer token and returns the JSON of the answer, or `undefined` for an answer without a body.
   * A `401` makes the client ask for a new token and send the request once more.
   *
   * @throws `ServiceError` when the service answers with another status than 2xx after that, or with a body that is not JSON.
   */
  send(method: string, url: string, body?: unknown): Promise<unknown>;
}

/** The options of {@link createRestClient}. */
export interface RestClientOptions {
  /** Sends the requests. */
  readonly fetch: CatFetch;
  /** Asks for the bearer token. */
  readonly credentials: OAuthClientCredentials;
  /** The milliseconds after which a request, the token request included, is aborted. */
  readonly timeoutMs: number;
}

/** Encodes a value as `application/x-www-form-urlencoded` does (RFC 6749 §2.3.1 asks for it in a Basic credential). */
function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice("v=".length);
}

function parseBody(text: string, what: string, status: number): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError(`${what} answered with a body that is not JSON.`, status, text);
  }
}

/**
 * Creates the client of a REST service. It keeps the bearer token it was given, so that a run of requests asks once; it
 * keeps no clock, so it learns that a token expired from the service's `401`, not from `expires_in`.
 */
export function createRestClient({ fetch, credentials, timeoutMs }: RestClientOptions): RestClient {
  const { tokenUrl, clientId, clientSecret, scope } = credentials;
  const basic = btoa(`${formEncode(clientId)}:${formEncode(clientSecret)}`);
  let token: Promise<string> | undefined;

  const requestToken = async (): Promise<string> => {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const what = `The token endpoint ${tokenUrl}`;
    if (!response.ok)
      throw new ServiceError(`${what} answered with the status ${response.status}.`, response.status, text);
    const grant = parseBody(text, what, response.status);
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

  const bearer = (): Promise<string> => {
    token ??= requestToken().catch((error: unknown) => {
      token = undefined;
      throw error;
    });
    return token;
  };

  const attempt = async (method: string, url: string, body: string | undefined): Promise<CatFetchResponse> =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await bearer()}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });

  return {
    async send(method, url, body) {
      const text = body === undefined ? undefined : JSON.stringify(body);
      let response = await attempt(method, url, text);
      if (response.status === 401) {
        token = undefined;
        response = await attempt(method, url, text);
      }
      const answer = await response.text();
      const what = `The CAT engine at ${url}`;
      if (!response.ok)
        throw new ServiceError(
          `${what} answered ${method} with the status ${response.status}.`,
          response.status,
          answer,
        );
      return answer === "" ? undefined : parseBody(answer, what, response.status);
    },
  };
}
