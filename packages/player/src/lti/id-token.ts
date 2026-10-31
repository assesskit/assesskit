import { describe } from "@assesskit/runtime/checks";
import { LtiError } from "../errors.js";
import { type Claims, optional, required, STRING } from "./claims.js";
import type { JwksCache } from "./jwks.js";
import { verifyJwt } from "./jwt.js";
import type { PlatformRegistration } from "./registration.js";

/**
 * Verifies an `id_token` as the platform issued it: the signature against the platform's key set, then the issuer, the
 * audience, the authorized party and the times (Security Framework section 5.1.3). The `nonce` and the LTI claims are the
 * caller's to check.
 *
 * @param nowMilliseconds - The time in milliseconds since 1970-01-01T00:00:00Z.
 * @returns The claims, with a `nonce`.
 * @throws `LtiError` with the reason of the failed check.
 */
export async function verifyIdToken(
  token: string,
  registration: PlatformRegistration,
  jwks: JwksCache,
  nowMilliseconds: number,
): Promise<Claims> {
  const { issuer, clientId } = registration;
  const claims = await verifyJwt(
    token,
    jwks.keySet(registration.jwksUrl),
    { issuer, audience: clientId, requiredClaims: ["exp", "iat"] },
    nowMilliseconds,
  );
  const azp = optional(claims, "azp", "The id_token", STRING);
  if (azp !== undefined && azp !== clientId) {
    throw new LtiError(
      `The authorized party of the token must be ${describe(clientId)}, found ${describe(azp)}.`,
      "authorized-party-mismatch",
    );
  }
  required(claims, "nonce", "The id_token", STRING);
  return claims;
}
