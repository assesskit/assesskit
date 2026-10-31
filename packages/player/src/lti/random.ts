import { encodeBase64Url } from "@assesskit/runtime/values";

// RFC 6749 §10.10: the probability of guessing a credential must be at most 2^-128 and should be at most 2^-160.
const RANDOM_BYTES = 20;

/** Returns a random token of 160 bits in base64url, for a `state`, a `nonce` or a `jti`. */
export function randomToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));
}
