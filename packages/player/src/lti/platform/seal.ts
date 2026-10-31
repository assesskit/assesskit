import type { webcrypto } from "node:crypto";
import { CompactSign, compactVerify } from "jose";
import { isRecord } from "../../checks.js";
import { type Claims, hasCanonicalParts } from "../internal.js";

const ALGORITHM = "HS256";

/**
 * Seals claims as a compact JWS signed with HMAC-SHA-256 (RFC 7515). The sealed token is signed and not encrypted, so
 * whoever holds it can read it. The `use` is the `typ` header, and a token of one use is refused for another (RFC 8725
 * section 3.11). The claims are the host's: their times, if any, are checked by whoever opens the token.
 */
export function sealToken(use: string, claims: Claims, key: webcrypto.CryptoKey): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: ALGORITHM, typ: use })
    .sign(key);
}

/**
 * Opens a sealed token: returns its claims when the signature is valid for the key and the token is for the given use,
 * else `undefined`.
 */
export async function openToken(token: string, use: string, key: webcrypto.CryptoKey): Promise<Claims | undefined> {
  if (!hasCanonicalParts(token)) return undefined;
  try {
    const { payload, protectedHeader } = await compactVerify(token, key, { algorithms: [ALGORITHM] });
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    return protectedHeader.typ === use && isRecord(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}
