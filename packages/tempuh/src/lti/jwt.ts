import type { webcrypto } from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "@luthfanwakan/olah/values";
import { describe, isRecord } from "../checks.js";
import { LtiError } from "../errors.js";

const RS256 = { name: "RSASSA-PKCS1-v1_5" };

/** A JSON Web Token split into its parts. Its signature has not been verified. */
export interface DecodedJwt {
  /** The JOSE header. */
  readonly header: Readonly<Record<string, unknown>>;
  /** The claims. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The header and the payload as they were signed: the two base64url parts joined by a dot. */
  readonly signedPart: string;
  /** The signature bytes. */
  readonly signature: Uint8Array<ArrayBuffer>;
}

/** Decodes one part of a token as a JSON object. */
function decodeObject(part: string, name: string): Readonly<Record<string, unknown>> {
  const bytes = decodeBase64Url(part);
  if (bytes === undefined) {
    throw new LtiError(`The ${name} of the token is not base64url (RFC 7515 §2).`, "token-malformed");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new LtiError(`The ${name} of the token is not JSON in UTF-8 (RFC 7515 §7.1).`, "token-malformed");
  }
  if (!isRecord(value)) {
    throw new LtiError(`The ${name} of the token must be a JSON object, found ${describe(value)}.`, "token-malformed");
  }
  return value;
}

/**
 * Splits a compact JWS into its parts and reads the header and the payload (RFC 7515 §7.1). It verifies nothing.
 *
 * @throws `LtiError` (`token-malformed`) when the token does not have three base64url parts, or the first two are not
 * JSON objects.
 */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  const [header, payload, signature] = parts;
  if (parts.length !== 3 || header === undefined || payload === undefined || signature === undefined) {
    throw new LtiError(
      `The token must have three parts separated by dots (RFC 7515 §7.1), found ${parts.length}.`,
      "token-malformed",
    );
  }
  const signatureBytes = decodeBase64Url(signature);
  if (signatureBytes === undefined) {
    throw new LtiError("The signature of the token is not base64url (RFC 7515 §2).", "token-malformed");
  }
  return {
    header: decodeObject(header, "header"),
    payload: decodeObject(payload, "payload"),
    signedPart: `${header}.${payload}`,
    signature: signatureBytes,
  };
}

/**
 * Reads the `kid` of a header whose algorithm is RS256, the only algorithm the tool accepts: `none` and the HMAC
 * algorithms are refused, so that a token cannot choose a weaker check than the platform's public key (Security
 * Framework §5.1.3, §5.4).
 *
 * @throws `LtiError` (`algorithm-unsupported`) when `alg` is not `RS256`, (`token-malformed`) when the header has `crit`,
 * which names extensions the tool does not support (RFC 7515 §4.1.11), and (`key-unknown`) when it has no `kid`
 * (Security Framework §6.3).
 */
export function readKeyId(header: Readonly<Record<string, unknown>>): string {
  if (header.alg !== "RS256") {
    throw new LtiError(`The token must be signed with RS256, found ${describe(header.alg)}.`, "algorithm-unsupported");
  }
  if (header.crit !== undefined) {
    throw new LtiError("The token has the header crit, whose extensions the tool does not support.", "token-malformed");
  }
  if (typeof header.kid !== "string" || header.kid === "") {
    throw new LtiError("The token must name its key with the header kid (Security Framework §6.3).", "key-unknown");
  }
  return header.kid;
}

/** Returns whether the signature of a token is valid for a public key. */
export function verifyJwt(jwt: DecodedJwt, key: webcrypto.CryptoKey): Promise<boolean> {
  return crypto.subtle.verify(RS256, key, jwt.signature, new TextEncoder().encode(jwt.signedPart));
}

/** Signs claims with RS256 and returns the compact JWS, with `kid` in its header. */
export async function signJwt(
  claims: Readonly<Record<string, unknown>>,
  key: webcrypto.CryptoKey,
  keyId: string,
): Promise<string> {
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId })));
  const signedPart = `${header}.${encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign(RS256, key, new TextEncoder().encode(signedPart));
  return `${signedPart}.${encodeBase64Url(new Uint8Array(signature))}`;
}
