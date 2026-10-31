import { isRecord } from "@assesskit/runtime/checks";
import { decodeBase64Url } from "@assesskit/runtime/values";
import { CompactSign, type CryptoKey, compactVerify } from "jose";

const ALGORITHM = "HS256";

/** Returns whether a value is an HMAC key with SHA-256 that signs and verifies. */
export function isHmacKey(key: unknown): boolean {
  if (!isRecord(key)) return false;
  const { algorithm, usages } = key;
  return (
    isRecord(algorithm) &&
    algorithm.name === "HMAC" &&
    isRecord(algorithm.hash) &&
    algorithm.hash.name === "SHA-256" &&
    Array.isArray(usages) &&
    usages.includes("sign") &&
    usages.includes("verify")
  );
}

/**
 * Returns whether a compact JWS has three parts that are each the one canonical base64url of some bytes. jose decodes
 * more loosely, as `atob` does: it takes white space and bits that the encoding ignores, so that one signature has many
 * spellings.
 */
function hasCanonicalParts(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => decodeBase64Url(part) !== undefined);
}

/**
 * Seals claims as a compact JWS signed with HMAC-SHA-256 (RFC 7515). The sealed token is signed and not encrypted, so
 * whoever holds it can read it. The `use` is the `typ` header, and a token of one use is refused for another (RFC 8725
 * section 3.11). The claims are the host's: their times, if any, are checked by whoever opens the token.
 */
export function sealToken(use: string, claims: Readonly<Record<string, unknown>>, key: CryptoKey): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: ALGORITHM, typ: use })
    .sign(key);
}

/**
 * Opens a sealed token: returns its claims when the signature is valid for the key and the token is for the given use,
 * else `undefined`.
 */
export async function openToken(
  token: string,
  use: string,
  key: CryptoKey,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  if (!hasCanonicalParts(token)) return undefined;
  try {
    const { payload, protectedHeader } = await compactVerify(token, key, { algorithms: [ALGORITHM] });
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    return protectedHeader.typ === use && isRecord(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}
