// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.
import { createHash } from "node:crypto";
import type { HttpRequest, HttpResponse } from "../src/lti/index.js";

/** The fixed time of the tests of LTI: 2023-11-14T22:13:20Z. */
export const NOW = 1_700_000_000_000;
const encoder = new TextEncoder();
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** A time that the tests move. */
export interface TestClock {
  now(): number;
  /** Moves the time forward by whole seconds. */
  advance(seconds: number): void;
}

/** Creates a clock at `NOW`. */
export function createClock(): TestClock {
  let time = NOW;
  return {
    now: () => time,
    advance(seconds) {
      time += seconds * 1000;
    },
  };
}

/** An RSA key pair with its `kid`. */
export interface KeyPair {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly publicJwk: Record<string, unknown>;
}

/** Generates an RSA key pair for RS256. */
export async function generateKeyPair(kid: string, modulusLength = 2048): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    { ...RSA, modulusLength, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicJwk: { ...jwk, kid, use: "sig", alg: "RS256" },
  };
}

/** Encodes a string or bytes as base64url. */
export function base64url(data: string | ArrayBuffer): string {
  return (typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)).toString("base64url");
}

/** Signs claims as a compact JWS; `header` replaces fields of the default header. */
export async function signToken(
  claims: object,
  key: KeyPair,
  header: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const part = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid, ...header }))}.${base64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(RSA, key.privateKey, encoder.encode(part));
  return `${part}.${base64url(signature)}`;
}

/** Reads the header and the payload of a compact JWS without checking the signature. */
export function readToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header = "", payload = ""] = token.split(".");
  const parse = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return { header: parse(header), payload: parse(payload) };
}

/** Returns whether the signature of a compact JWS verifies with the public key. */
export async function verifyToken(token: string, key: KeyPair): Promise<boolean> {
  const [header = "", payload = "", signature = ""] = token.split(".");
  return crypto.subtle.verify(
    RSA,
    key.publicKey,
    Buffer.from(signature, "base64url"),
    encoder.encode(`${header}.${payload}`),
  );
}

/** Builds a request. */
export function request(init: Partial<HttpRequest> & { readonly url: string }): HttpRequest {
  return { method: "GET", headers: {}, body: "", ...init };
}

/** Decodes the text of an HTML attribute value. */
export function unescapeHtml(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** What a page of the storage path holds: its configuration, its script, its inputs and its CSP. */
export function readPage(response: HttpResponse): {
  config: Record<string, string>;
  script: string;
  scripts: number;
  inputs: Map<string, string>;
  action: string | undefined;
  hash: string;
} {
  const config = /data-config="([^"]*)"/u.exec(response.body)?.[1] ?? "";
  const script = /<script>([\s\S]*)<\/script>/u.exec(response.body)?.[1] ?? "";
  const inputs = new Map<string, string>();
  for (const [, name = "", value = ""] of response.body.matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/gu,
  )) {
    inputs.set(name, unescapeHtml(value));
  }
  return {
    config: JSON.parse(unescapeHtml(config)),
    script,
    scripts: response.body.split("<script").length - 1,
    inputs,
    action: /<form id="form" method="post" action="([^"]*)">/u.exec(response.body)?.[1],
    hash: createHash("sha256").update(script).digest("base64"),
  };
}
