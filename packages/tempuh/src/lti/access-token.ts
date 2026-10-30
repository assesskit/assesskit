import { SignJWT } from "jose";
import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  describe,
} from "../checks.js";
import { DataError } from "../errors.js";
import { CLAIM } from "./claims.js";
import { readClock } from "./clock.js";
import { rs256Header } from "./jwt.js";
import type { LtiDeployment } from "./launch-model.js";
import { type AccessTokenOptions, checkToolOptions, findDeployment } from "./options.js";
import { randomToken } from "./random.js";
import { callService, DEFAULT_TIMEOUT_MS } from "./service.js";

// Security Framework §4.1.1: the assertion expires "typically five minutes after the iat timestamp".
const ASSERTION_TTL_SECONDS = 300;
const GRANT_TYPE = "client_credentials";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** An access token for the services of a platform. */
export interface AccessToken {
  /** The token. A request to a service carries it as `Authorization: Bearer <value>`. */
  readonly value: string;
  /** The time in milliseconds since 1970-01-01T00:00:00Z at which the token expires; request a new one after it. */
  readonly expiresAt: number;
  /** The scopes that the platform granted: all of those requested, or a subset (Security Framework §4.1). */
  readonly scopes: readonly string[];
}

/** Reads the token response of RFC 6749 §5.1 and Security Framework §4.1. */
function readToken(body: string, requested: readonly string[], now: number): AccessToken {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new DataError("The token response must be JSON.");
  }
  checkRecord(payload, "The token response must be an object");
  checkNonEmptyString(payload.access_token, "The property access_token of the token response");
  if (typeof payload.token_type !== "string" || payload.token_type.toLowerCase() !== "bearer") {
    throw new DataError(
      `The property token_type of the token response must be "Bearer", found ${describe(payload.token_type)}.`,
    );
  }
  checkPositiveInteger(payload.expires_in, "The property expires_in of the token response");
  // RFC 6749 §5.1: the response names the scope when it differs from the request.
  const scope = payload.scope;
  if (scope !== undefined) checkNonEmptyString(scope, "The property scope of the token response");
  return {
    value: payload.access_token,
    expiresAt: now + payload.expires_in * 1000,
    scopes: scope === undefined ? requested : scope.split(" "),
  };
}

/** Checks the scopes the host asks for. */
function checkScopes(scopes: unknown): asserts scopes is readonly string[] {
  checkArray(scopes, "The scopes must be an array");
  if (scopes.length === 0) throw new DataError("The scopes must have at least one scope.");
  for (const scope of scopes) {
    if (typeof scope !== "string" || scope === "" || scope.includes(" ")) {
      throw new DataError(`A scope must be a non-empty string without spaces, found ${describe(scope)}.`);
    }
  }
}

/**
 * Requests an access token for the services of a platform with the OAuth 2.0 client-credentials grant and a JWT
 * assertion (Security Framework §4.1.1, LTI 1.3 Core §6.2, RFC 7523).
 *
 * The assertion has `iss` and `sub` equal to the client identifier, `aud` equal to the token endpoint, `iat`, `exp`,
 * a `jti` and the deployment (LTI 1.3 Core §6.2.1), and is signed with the key of the registration (RS256). The request
 * is a form POST to the token endpoint of the registration. The tool may reuse the token until `expiresAt`.
 *
 * @param deployment - The platform, client and deployment of the launch that the token is for.
 * @param scopes - The scopes to ask for, such as the AGS scopes that the launch's `ags.scopes` offers.
 * @throws `DataError` when an argument has the wrong type, or the platform's answer is not a token response.
 * @throws `LtiError` (`platform-unknown`, `deployment-unknown`) when the registration is gone or no longer lists the
 * deployment.
 * @throws `ServiceError` when the token endpoint does not answer with a success; `status` is `0` when it did not answer.
 */
export async function ltiAccessToken(
  deployment: LtiDeployment,
  scopes: readonly string[],
  options: AccessTokenOptions,
): Promise<AccessToken> {
  checkToolOptions(options);
  checkRecord(deployment, "The deployment must be an object");
  checkNonEmptyString(deployment.issuer, "The issuer of the deployment");
  checkNonEmptyString(deployment.clientId, "The client identifier of the deployment");
  checkNonEmptyString(deployment.deploymentId, "The deployment of the deployment");
  checkScopes(scopes);
  const { fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  checkFunction(fetch, "The option fetch must be a function");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  const registration = await findDeployment(options, deployment);
  const iat = Math.floor(readClock(options.clock) / 1000);
  const assertion = await new SignJWT({ [CLAIM.deploymentId]: deployment.deploymentId })
    .setProtectedHeader(rs256Header(registration.keyId))
    .setIssuer(registration.clientId)
    .setSubject(registration.clientId)
    .setAudience(registration.accessTokenUrl)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ASSERTION_TTL_SECONDS)
    .setJti(randomToken())
    .sign(registration.signingKey);
  const body = await callService(
    { fetch, timeoutMs },
    `The token endpoint ${registration.accessTokenUrl}`,
    registration.accessTokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams([
        ["grant_type", GRANT_TYPE],
        ["client_assertion_type", ASSERTION_TYPE],
        ["client_assertion", assertion],
        ["scope", scopes.join(" ")],
      ]).toString(),
    },
  );
  return readToken(body, scopes, readClock(options.clock));
}
