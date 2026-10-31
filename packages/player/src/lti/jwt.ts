import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { decodeBase64Url } from "@assesskit/runtime/values";
import { decodeJwt, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { describe } from "../checks.js";
import { LtiError } from "../errors.js";
import type { Claims } from "./claims.js";
import { CLOCK_SKEW_SECONDS } from "./clock.js";

// The only algorithm the tool and the platform sign and accept: `none` and the HMAC algorithms are refused, so that a token
// cannot choose a weaker check than the public key (Security Framework §5.1.3, §5.4).
const ALGORITHM = "RS256";

/** The protected header of a token that the tool or the platform signs with an RSA key: RS256 and the `kid` of the key set. */
export function rs256Header(keyId: string): { readonly alg: "RS256"; readonly typ: "JWT"; readonly kid: string } {
  return { alg: ALGORITHM, typ: "JWT", kid: keyId };
}

/** What a verified token must say about itself. */
export interface JwtExpectation {
  /** The `iss` claim. */
  readonly issuer: string;
  /** The `aud` claim: the one party the token is for. */
  readonly audience: string;
  /** The `sub` claim, when the token must have one. */
  readonly subject?: string;
  /** The claims that must be present besides `iss`, `aud` and `sub`, such as `exp`. */
  readonly requiredClaims: string[];
}

/**
 * Returns whether a compact JWS has three parts that are each the one canonical base64url of some bytes. jose decodes
 * more loosely, as `atob` does: it takes white space and bits that the encoding ignores, so that one signature has many
 * spellings.
 */
export function hasCanonicalParts(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => decodeBase64Url(part) !== undefined);
}

/**
 * Reads the claims of a token whose signature has not been verified, after it has the shape of a token: three canonical
 * base64url parts and a payload that is a JSON object. The tool uses them to find the key that verifies the token, and they
 * decide nothing until `verifyJwt` has accepted it.
 *
 * @throws `LtiError` (`token-malformed`) when the token does not have the shape.
 */
export function unverifiedClaims(token: string): Claims {
  if (!hasCanonicalParts(token)) {
    throw new LtiError(
      "The token must have three parts separated by dots, each in base64url without padding (RFC 7515 §2, §7.1).",
      "token-malformed",
    );
  }
  try {
    return decodeJwt(token);
  } catch {
    throw new LtiError("The payload of the token must be a JSON object in UTF-8 (RFC 7519 §7.2).", "token-malformed");
  }
}

/** Says what is wrong with a claim that jose rejected, as an `LtiError` with the reason of the failed check. */
function claimError(error: errors.JWTClaimValidationFailed | errors.JWTExpired, expected: JwtExpectation): LtiError {
  const { claim, reason, payload } = error;
  if (error instanceof errors.JWTExpired) {
    return new LtiError(`The token expired at ${describe(payload.exp)} (Security Framework §5.1.3).`, "token-expired");
  }
  if (claim === "aud") {
    const found = describe(payload.aud);
    return new LtiError(
      `The audience of the token must be ${describe(expected.audience)}, found ${found}.`,
      "audience-mismatch",
    );
  }
  if (reason === "missing" || reason === "invalid") {
    return new LtiError(`The token has no valid ${JSON.stringify(claim)} claim: ${error.message}.`, `claim-${reason}`);
  }
  switch (claim) {
    case "iss":
      return new LtiError(
        `The issuer of the token must be ${describe(expected.issuer)}, found ${describe(payload.iss)}.`,
        "issuer-mismatch",
      );
    case "sub":
      return new LtiError(
        `The subject of the token must be ${describe(expected.subject)}, found ${describe(payload.sub)}.`,
        "subject-mismatch",
      );
    default:
      return new LtiError(`The token is not valid yet: ${error.message}.`, "issued-in-future");
  }
}

/**
 * Turns what jose throws into what the module throws: an `LtiError` with the reason of the failed check, and a `DataError`
 * for a key set that is not one. The errors of the key function that are `AssesskitError`s, such as a failed fetch, pass.
 */
function refuse(error: unknown, expected: JwtExpectation): never {
  if (error instanceof AssesskitError) throw error;
  if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) {
    throw claimError(error, expected);
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    throw new LtiError(
      `The token must be signed with ${ALGORITHM} (Security Framework §5.1.3, §5.4).`,
      "algorithm-unsupported",
    );
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    throw new LtiError("The signature of the token is not valid for the key of its issuer.", "signature-invalid");
  }
  // jose throws a TypeError for a key that cannot verify with RS256, such as one of fewer than 2,048 bits (RFC 7518 §3.3).
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof TypeError
  ) {
    throw new LtiError(`The key set has no usable key for the token: ${error.message}.`, "key-unknown");
  }
  if (
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JOSENotSupported
  ) {
    throw new LtiError(
      `The token is malformed, or it names extensions the tool does not support: ${error.message}.`,
      "token-malformed",
    );
  }
  if (error instanceof errors.JOSEError) {
    throw new DataError(`The key set must be a JWK Set (RFC 7517 §5): ${error.message}.`);
  }
  throw error;
}

/**
 * Verifies a compact JWS as the JWT of an LTI message or a client assertion: RS256 only, a `kid` that the key function
 * resolves, the signature, the parties that `expected` names, the times with the leeway for clock skew, and the audience
 * as the one party (Security Framework §5.1.3, §4.1.1; RFC 7523 §3).
 *
 * @param keys - Resolves the public key from the header of the token, such as a key set of `createJwksCache`.
 * @param expected - What the token must say about itself. A present `exp` or `iat` must be a number.
 * @param nowMilliseconds - The time in milliseconds since 1970-01-01T00:00:00Z.
 * @returns The claims.
 * @throws `LtiError` with the reason of the failed check: `token-malformed`, `algorithm-unsupported`, `key-unknown`,
 * `signature-invalid`, `issuer-mismatch`, `audience-mismatch`, `subject-mismatch`, `token-expired`, `issued-in-future`,
 * `claim-missing` or `claim-invalid`.
 * @throws `ServiceError` when the key set cannot be fetched, and `DataError` when what the platform serves is not a JWK Set.
 */
export async function verifyJwt(
  token: string,
  keys: JWTVerifyGetKey,
  expected: JwtExpectation,
  nowMilliseconds: number,
): Promise<Claims> {
  // A token that is not one is refused before any key is fetched.
  unverifiedClaims(token);
  // Security Framework §6.3: every key of a key set has a `kid`, and a token names the one it is signed with.
  const keyOf: JWTVerifyGetKey = (header, jws) => {
    if (typeof header.kid !== "string" || header.kid === "") {
      throw new LtiError("The token must name its key with the header kid (Security Framework §6.3).", "key-unknown");
    }
    return keys(header, jws);
  };
  let claims: Claims;
  try {
    ({ payload: claims } = await jwtVerify(token, keyOf, {
      ...expected,
      algorithms: [ALGORITHM],
      clockTolerance: CLOCK_SKEW_SECONDS,
      currentDate: new Date(nowMilliseconds),
    }));
  } catch (error) {
    return refuse(error, expected);
  }
  checkSoleAudience(claims, expected.audience);
  checkIssuedAt(claims, nowMilliseconds / 1000);
  return claims;
}

/** Checks that the audience is the one party: the token is for it alone, and no other party the tool does not trust is named. */
function checkSoleAudience(claims: Claims, audience: JwtExpectation["audience"]): void {
  const audiences: readonly unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.every((item) => item === audience)) {
    throw new LtiError(
      `The audience of the token must be ${describe(audience)} alone, found ${describe(claims.aud)}.`,
      "audience-mismatch",
    );
  }
}

/** Checks that a token is not issued in the future (Security Framework §5.1.3), allowing the leeway for clock skew. */
function checkIssuedAt(claims: Claims, nowSeconds: number): void {
  const { iat } = claims;
  if (typeof iat === "number" && iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new LtiError(`The token was issued at ${iat}, after the time ${nowSeconds}.`, "issued-in-future");
  }
}
