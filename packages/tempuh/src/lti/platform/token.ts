import { LtiError } from "../../errors.js";
import { AGS_SCOPE, NUMBER, required, STRING } from "../claims.js";
import { readClock } from "../clock.js";
import { checkHttpRequest, errorBody, type HttpRequest, type HttpResponse, jsonResponse, readForm } from "../http.js";
import { unverifiedClaims, verifyJwt } from "../jwt.js";
import { endpointsOf } from "./config.js";
import { checkRequestOrigin, checkTokenOptions, findClient, type PlatformTokenOptions } from "./options.js";
import { toolKeySet } from "./registration.js";
import { sealAccess } from "./tokens.js";

const GRANT_TYPE = "client_credentials";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
// Security Framework §4.1.1 and §7.1.1: the recommended lifetime of an access token is one hour.
const ACCESS_TOKEN_TTL_SECONDS = 3600;
// RFC 7523 §3 lets the authorization server refuse an assertion whose expiry is unreasonably far; the platform remembers a
// `jti` until then. Security Framework §4.1.1 has the assertion expire "typically five minutes" after `iat`.
const MAX_ASSERTION_LIFETIME_SECONDS = 3600;
/** The scopes that a launch offers, and so the only ones a token can have (LTI AGS 2.0 §3.1). */
const OFFERED_SCOPES: readonly string[] = [AGS_SCOPE.lineitemReadonly, AGS_SCOPE.score];
const OWNER = "The client assertion";

/** The error codes of RFC 6749 §5.2 that the endpoint answers with, by the reason of the check that failed. */
const OAUTH_ERRORS: ReadonlyMap<string, string> = new Map([
  ["unsupported-grant-type", "unsupported_grant_type"],
  ["request-invalid", "invalid_request"],
  ["scope-invalid", "invalid_scope"],
]);

/** Builds the answer of RFC 6749 §5.2 and Security Framework §4.1: status 400 and an error code. */
function refusal(error: string, description: string): HttpResponse {
  return jsonResponse(400, errorBody(error, description), { "cache-control": "no-store", pragma: "no-cache" });
}

/** Reads the form of the request: the grant, the assertion type, the assertion and the scopes. */
function readRequest(request: HttpRequest): { readonly assertion: string; readonly scopes: readonly string[] } {
  if (request.method !== "POST") throw new LtiError("The token request must be a POST.", "request-invalid");
  let form: ReadonlyMap<string, string>;
  try {
    form = readForm(request);
  } catch (error) {
    throw new LtiError(error instanceof Error ? error.message : String(error), "request-invalid");
  }
  if (form.get("grant_type") !== GRANT_TYPE) {
    throw new LtiError(`The grant_type must be ${GRANT_TYPE}.`, "unsupported-grant-type");
  }
  if (form.get("client_assertion_type") !== ASSERTION_TYPE) {
    throw new LtiError(`The client_assertion_type must be ${ASSERTION_TYPE}.`, "request-invalid");
  }
  const assertion = form.get("client_assertion");
  if (assertion === undefined || assertion === "") {
    throw new LtiError("The token request must have a client_assertion.", "request-invalid");
  }
  const scopes = (form.get("scope") ?? "").split(" ").filter((scope) => scope !== "");
  if (scopes.length === 0) throw new LtiError("The token request must have a scope.", "scope-invalid");
  const unknown = scopes.find((scope) => !OFFERED_SCOPES.includes(scope));
  if (unknown !== undefined)
    throw new LtiError(`The scope ${JSON.stringify(unknown)} is not offered.`, "scope-invalid");
  return { assertion, scopes };
}

/**
 * Verifies the client assertion (Security Framework §4.1.1, LTI 1.3 Core §6.2, RFC 7523 §3): the tool named by `iss` signed
 * it with RS256 and a key of its registration; `iss` and `sub` are its client identifier; `aud` is the token URL; it has
 * not expired and does not expire in too long; it has a `jti` that `options.once` has not seen.
 */
async function verifyAssertion(assertion: string, options: PlatformTokenOptions): Promise<string> {
  const iss = required(unverifiedClaims(assertion), "iss", OWNER, STRING);
  const registration = await findClient(options.client, iss);
  const { clientId } = registration;
  const nowMilliseconds = readClock(options.clock);
  const claims = await verifyJwt(
    assertion,
    toolKeySet(registration, options.jwks),
    { issuer: clientId, subject: clientId, audience: endpointsOf(options.config).token, requiredClaims: ["exp"] },
    nowMilliseconds,
  );
  const exp = required(claims, "exp", OWNER, NUMBER);
  if (exp - nowMilliseconds / 1000 > MAX_ASSERTION_LIFETIME_SECONDS) {
    throw new LtiError(
      `The assertion must expire within ${MAX_ASSERTION_LIFETIME_SECONDS} seconds.`,
      "assertion-lifetime",
    );
  }
  const jti = required(claims, "jti", OWNER, STRING);
  if (!(await options.once(`assertion:${clientId}:${jti}`, exp * 1000))) {
    throw new LtiError("The jti of the assertion has been used.", "assertion-replayed");
  }
  return clientId;
}

/**
 * Answers a token request: the OAuth 2.0 client-credentials grant with a JWT assertion (Security Framework §4.1.1, LTI 1.3
 * Core §6.2). It issues a bearer token that is HMAC-signed with the hint key, lasts one hour and holds the requested
 * scopes, which must be among `lineitem.readonly` and `score`: the scopes a launch offers.
 *
 * A request that fails a check gets status 400 with the error code of RFC 6749 §5.2 (`invalid_request`,
 * `unsupported_grant_type`, `invalid_scope`, and `invalid_client` for an assertion that fails). The checks, in order: the
 * method, the form, `grant_type`, `client_assertion_type`, the scopes, the tool, its key and the signature, `sub`, `aud`,
 * the times, and the single use of the `jti`.
 *
 * @throws `AccessError` (`wrong-origin`) when the request is for another origin than the platform's.
 * @throws `DataError` when the request or the options have the wrong type.
 * @throws `ServiceError` when the key set of the tool cannot be fetched.
 */
export async function platformToken(request: HttpRequest, options: PlatformTokenOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  checkTokenOptions(options);
  checkRequestOrigin(request, options.config);
  try {
    const { assertion, scopes } = readRequest(request);
    const client = await verifyAssertion(assertion, options);
    const exp = Math.floor(readClock(options.clock) / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    const token = await sealAccess({ client, scopes, exp }, options.config.hintKey);
    const body = Object.fromEntries([
      ["access_token", token],
      ["token_type", "Bearer"],
      ["expires_in", ACCESS_TOKEN_TTL_SECONDS],
      ["scope", scopes.join(" ")],
    ]);
    return jsonResponse(200, body, { "cache-control": "no-store", pragma: "no-cache" });
  } catch (error) {
    if (error instanceof LtiError) return refusal(OAUTH_ERRORS.get(error.reason) ?? "invalid_client", error.message);
    throw error;
  }
}
