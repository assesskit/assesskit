import type { webcrypto } from "node:crypto";
import { isRecord } from "../../checks.js";
import { decodeBase64Url, encodeBase64Url, encodeTextBase64Url } from "../base64url.js";
import type { Claims } from "../claims.js";

const HMAC = { name: "HMAC" };

/**
 * Seals claims with an HMAC-SHA-256: `<claims>.<mac>`, both in base64url. The sealed token is signed and not encrypted,
 * so whoever holds it can read it. The `use` names what the token is for, and a token of one use is refused for another.
 */
export async function sealToken(use: string, claims: Claims, key: webcrypto.CryptoKey): Promise<string> {
  const payload = encodeTextBase64Url(JSON.stringify({ ...claims, use }));
  const mac = await crypto.subtle.sign(HMAC, key, new TextEncoder().encode(payload));
  return `${payload}.${encodeBase64Url(new Uint8Array(mac))}`;
}

/**
 * Opens a sealed token: returns its claims when the MAC is valid for the key and the token is for the given use, else
 * `undefined`. The MAC is compared in constant time by the Web Crypto API.
 */
export async function openToken(token: string, use: string, key: webcrypto.CryptoKey): Promise<Claims | undefined> {
  const [payload, mac, ...rest] = token.split(".");
  if (payload === undefined || mac === undefined || rest.length > 0) return undefined;
  const macBytes = decodeBase64Url(mac);
  const payloadBytes = decodeBase64Url(payload);
  if (macBytes === undefined || payloadBytes === undefined) return undefined;
  if (!(await crypto.subtle.verify(HMAC, key, macBytes, new TextEncoder().encode(payload)))) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    return undefined;
  }
  return isRecord(claims) && claims.use === use ? claims : undefined;
}
