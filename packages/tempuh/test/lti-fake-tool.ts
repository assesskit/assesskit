// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.
import { expect } from "vitest";
import type { HttpRequest, ToolRegistration } from "../src/lti/index.js";
import { type KeyPair, readToken, request, signToken, type TestClock } from "./lti-fixture.js";

/**
 * A conformant LTI 1.3 tool for the tests of the platform role. It is written from the specifications, not from the code
 * under test: Security Framework §5.1.1 (the login and the authentication request), §5.1.3 (the validation of the
 * id_token), §4.1.1 (the client assertion) and LTI 1.3 Core §5 (the claims it relies on).
 */

export const TOOL_ORIGIN = "https://tool.example.com";
export const TOOL_CLIENT_ID = "tool-client-1";
export const TOOL_DEPLOYMENT_ID = "deployment-1";
export const TOOL_LOGIN_URL = `${TOOL_ORIGIN}/lti/login`;
export const TOOL_REDIRECT_URI = `${TOOL_ORIGIN}/lti/launch`;
export const TOOL_LAUNCH_URL = `${TOOL_ORIGIN}/lti/tools/drawing`;
export const TOOL_JWKS_URL = `${TOOL_ORIGIN}/.well-known/jwks.json`;

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const AGS_CLAIM = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";

/** The registration that the platform keeps of the tool. */
export function toolRegistration(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    clientId: TOOL_CLIENT_ID,
    deploymentId: TOOL_DEPLOYMENT_ID,
    loginUrl: TOOL_LOGIN_URL,
    redirectUris: [TOOL_REDIRECT_URI],
    jwksUrl: TOOL_JWKS_URL,
    ...overrides,
  };
}

/** The parameters of a third-party initiated login (Security Framework §5.1.1.1, LTI 1.3 Core §4.1). */
export interface Initiation {
  readonly iss: string;
  readonly loginHint: string;
  readonly targetLinkUri: string;
  readonly messageHint: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly storageTarget: string;
}

/** Reads the initiation URL as a tool does: the parameters that the specifications require must be there. */
export function readInitiation(url: string, loginUrl = TOOL_LOGIN_URL): Initiation {
  const parsed = new URL(url);
  expect(`${parsed.origin}${parsed.pathname}`).toBe(loginUrl);
  const parameters = parsed.searchParams;
  const get = (name: string): string => {
    const value = parameters.get(name);
    expect(value, name).toBeTruthy();
    return value ?? "";
  };
  return {
    iss: get("iss"),
    loginHint: get("login_hint"),
    targetLinkUri: get("target_link_uri"),
    messageHint: get("lti_message_hint"),
    clientId: get("client_id"),
    deploymentId: get("lti_deployment_id"),
    storageTarget: get("lti_storage_target"),
  };
}

/**
 * Builds the tool's authentication request (Security Framework §5.1.1.2) as the parameters of the table there: `scope`,
 * `response_type`, `client_id`, `redirect_uri`, `login_hint`, `state`, `response_mode`, `nonce`, `prompt`, and the
 * `lti_message_hint` that LTI 1.3 Core §4.1.1 has the tool return unaltered.
 */
export function authenticationParameters(
  initiation: Initiation,
  state = "state-1",
  nonce = "nonce-1",
): URLSearchParams {
  return new URLSearchParams([
    ["scope", "openid"],
    ["response_type", "id_token"],
    ["client_id", initiation.clientId],
    ["redirect_uri", TOOL_REDIRECT_URI],
    ["login_hint", initiation.loginHint],
    ["state", state],
    ["response_mode", "form_post"],
    ["nonce", nonce],
    ["prompt", "none"],
    ["lti_message_hint", initiation.messageHint],
  ]);
}

/** The request to the authorization endpoint: a GET with the parameters in the query, or a form POST. */
export function authenticationRequest(
  endpoint: string,
  parameters: URLSearchParams,
  method: "GET" | "POST" = "GET",
): HttpRequest {
  if (method === "GET") return request({ url: `${endpoint}?${parameters}` });
  return request({
    method: "POST",
    url: endpoint,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: parameters.toString(),
  });
}

/** What the tool reads from the page that the platform answers the authentication request with. */
export interface Delivered {
  readonly action: string;
  readonly idToken: string;
  readonly state: string;
}

/** The fields of a key set, as RFC 7517 §5 gives them. */
export interface KeySet {
  readonly keys: readonly Record<string, string>[];
}

/**
 * Validates an `id_token` as Security Framework §5.1.3 and LTI 1.3 Core §5.3 say a tool must: the signature against the
 * platform's key set by `kid`, `iss`, `aud` (the client id alone), `exp`, `iat`, `nonce`; and the claims of a resource link
 * launch. It returns the claims.
 */
export async function acceptIdToken(
  idToken: string,
  keySet: KeySet,
  expected: { issuer: string; nonce: string; clock: TestClock },
): Promise<Record<string, unknown>> {
  const { header, payload } = readToken(idToken);
  expect(header.alg).toBe("RS256");
  const jwk = keySet.keys.find((key) => key.kid === header.kid);
  expect(jwk, "the key set holds the kid of the token").toBeDefined();
  expect(jwk?.kty).toBe("RSA");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk?.n, e: jwk?.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const [signedHeader = "", signedPayload = "", signature = ""] = idToken.split(".");
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${signedHeader}.${signedPayload}`),
  );
  expect(valid, "the signature").toBe(true);
  expect(payload.iss).toBe(expected.issuer);
  expect([payload.aud].flat()).toEqual([TOOL_CLIENT_ID]);
  const now = expected.clock.now() / 1000;
  expect(Number(payload.exp)).toBeGreaterThan(now);
  expect(Number(payload.iat)).toBeLessThanOrEqual(now);
  expect(payload.nonce).toBe(expected.nonce);
  expect(payload[`${CLAIM}message_type`]).toBe("LtiResourceLinkRequest");
  expect(payload[`${CLAIM}version`]).toBe("1.3.0");
  expect(payload[`${CLAIM}deployment_id`]).toBe(TOOL_DEPLOYMENT_ID);
  expect(typeof payload.sub).toBe("string");
  expect(Array.isArray(payload[`${CLAIM}roles`])).toBe(true);
  expect(payload[`${CLAIM}target_link_uri`]).toBeTruthy();
  expect(payload[`${CLAIM}resource_link`]).toHaveProperty("id");
  return payload;
}

/** The grade services of a launch, as LTI AGS 2.0 §3.1 gives the claim. */
export function agsClaim(claims: Record<string, unknown>): { scope: string[]; lineitem: string } {
  const claim = claims[AGS_CLAIM];
  if (typeof claim === "object" && claim !== null && "scope" in claim && "lineitem" in claim) {
    const { scope, lineitem } = claim;
    if (Array.isArray(scope) && scope.every((item) => typeof item === "string") && typeof lineitem === "string") {
      return { scope, lineitem };
    }
  }
  throw new Error("The launch has no grade services claim with scope and lineitem.");
}

/** The options of a client assertion (Security Framework §4.1.1) that a test may change. */
export interface Assertion {
  readonly iss?: string;
  readonly sub?: string;
  readonly aud?: unknown;
  readonly iat?: number | undefined;
  readonly exp?: number | undefined;
  readonly jti?: string | undefined;
  readonly header?: Readonly<Record<string, unknown>>;
  readonly signer?: KeyPair;
}

/** Signs the client assertion that Security Framework §4.1.1 describes, with `exp` five minutes after `iat`. */
export function clientAssertion(
  tool: KeyPair,
  tokenUrl: string,
  clock: TestClock,
  change: Assertion = {},
): Promise<string> {
  const iat = Math.floor(clock.now() / 1000);
  const claims = {
    iss: TOOL_CLIENT_ID,
    sub: TOOL_CLIENT_ID,
    aud: tokenUrl,
    iat,
    exp: iat + 300,
    jti: crypto.randomUUID(),
    ...Object.fromEntries(Object.entries(change).filter(([name]) => name !== "header" && name !== "signer")),
  };
  return signToken(claims, change.signer ?? tool, change.header);
}

/** The token request of the client-credentials grant with a JWT assertion (Security Framework §4.1.1). */
export function tokenRequest(
  tokenUrl: string,
  assertion: string,
  scope: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): HttpRequest {
  const fields: Record<string, string | undefined> = {
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope,
    ...overrides,
  };
  const form = new URLSearchParams(
    Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return request({
    method: "POST",
    url: tokenUrl,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}
