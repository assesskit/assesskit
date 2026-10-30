import { describe } from "../checks.js";
import { LtiError } from "../errors.js";
import { type Claims, NUMBER, optional, required, STRING } from "./claims.js";
import { CLOCK_SKEW_SECONDS } from "./clock.js";
import type { JwksCache } from "./jwks.js";
import { decodeJwt, readKeyId, verifyJwt } from "./jwt.js";
import type { PlatformRegistration } from "./registration.js";

/** Checks the audience of a token: only the tool's client identifier (Security Framework §5.1.3). */
function checkAudience(claims: Claims, clientId: string): void {
  const { aud } = claims;
  const audiences: readonly unknown[] = Array.isArray(aud) ? aud : [aud];
  const isTool = audiences.length > 0 && audiences.every((item) => item === clientId);
  if (!isTool) {
    throw new LtiError(
      `The audience of the token must be the client identifier ${describe(clientId)} alone, found ${describe(aud)}.`,
      "audience-mismatch",
    );
  }
  const azp = optional(claims, "azp", "The id_token", STRING);
  if (azp !== undefined && azp !== clientId) {
    throw new LtiError(
      `The authorized party of the token must be ${describe(clientId)}, found ${describe(azp)}.`,
      "authorized-party-mismatch",
    );
  }
}

/** Checks the times of a token: not expired, not issued in the future (Security Framework §5.1.2, §5.1.3). */
function checkTimes(claims: Claims, nowSeconds: number): void {
  const exp = required(claims, "exp", "The id_token", NUMBER);
  const iat = required(claims, "iat", "The id_token", NUMBER);
  if (nowSeconds - CLOCK_SKEW_SECONDS >= exp) {
    throw new LtiError(`The token expired at ${exp}, and the time is ${nowSeconds}.`, "token-expired");
  }
  if (iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new LtiError(`The token was issued at ${iat}, after the time ${nowSeconds}.`, "issued-in-future");
  }
}

/**
 * Verifies an `id_token` as the platform issued it: the signature against the platform's key set, then the issuer, the
 * audience, the authorized party and the times (Security Framework §5.1.3). The `nonce` and the LTI claims are the
 * caller's to check.
 *
 * @param nowSeconds - The time in seconds since 1970-01-01T00:00:00Z.
 * @returns The claims, with a `nonce`.
 * @throws `LtiError` with the reason of the failed check.
 */
export async function verifyIdToken(
  token: string,
  registration: PlatformRegistration,
  jwks: JwksCache,
  nowSeconds: number,
): Promise<Claims> {
  const jwt = decodeJwt(token);
  const keyId = readKeyId(jwt.header);
  const key = await jwks.key(registration.jwksUrl, keyId);
  if (key === undefined) {
    throw new LtiError(`The key set of the platform has no usable key with the kid ${describe(keyId)}.`, "key-unknown");
  }
  if (!(await verifyJwt(jwt, key))) {
    throw new LtiError("The signature of the token is not valid for the key of the platform.", "signature-invalid");
  }
  const claims = jwt.payload;
  const issuer = required(claims, "iss", "The id_token", STRING);
  if (issuer !== registration.issuer) {
    throw new LtiError(
      `The issuer of the token must be ${describe(registration.issuer)}, found ${describe(issuer)}.`,
      "issuer-mismatch",
    );
  }
  checkAudience(claims, registration.clientId);
  checkTimes(claims, nowSeconds);
  required(claims, "nonce", "The id_token", STRING);
  return claims;
}
