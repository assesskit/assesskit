// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { createCryptoKeySigner, type Fetch } from "@interopkit/core";
import type { HttpRequest } from "@interopkit/core/http";
import type { LoginRecord, LtiStore, PlatformRegistration } from "@interopkit/tool-integration/tool";
import { expect } from "vitest";
import { type KeyPair, readToken, request, signToken, type TestClock, textOf, verifyToken } from "./fixture.ts";

/**
 * A conformant LTI 1.3 platform for the tests of the tool role. It is written from the specifications, not from the code
 * under test: Security Framework section 5.1 (the authentication request and the id_token), section 4.1.1 (the token endpoint), section 6.3
 * (the key set), LTI 1.3 Core section 5 (the claims) and Deep Linking 2.0 (the request and the response).
 */

export const ISSUER = "https://lms.example.edu";
const CLIENT_ID = "962fa4d8-bcbf-49a0-94b2-2de05ad274af";
const DEPLOYMENT_ID = "07940580-b309-415e-a37c-914d387c1150";
const AUTHENTICATION_URL = `${ISSUER}/auth`;
const JWKS_URL = `${ISSUER}/jwks`;
const ACCESS_TOKEN_URL = `${ISSUER}/token`;
const TOOL_ORIGIN = "https://tool.example.com";
const LOGIN_URL = `${TOOL_ORIGIN}/lti/login`;
const REDIRECT_URI = `${TOOL_ORIGIN}/lti/launch`;
const TARGET_LINK_URI = `${TOOL_ORIGIN}/lti/48320/tryout`;
const RETURN_URL = `${ISSUER}/deep_links`;

const AGS_SCOPES = [
  "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
  "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
  "https://purl.imsglobal.org/spec/lti-ags/scope/score",
];

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const DL_CLAIM = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const AGS_CLAIM = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";

/** The claims of a resource link launch, as LTI 1.3 Core Appendix E gives them. */
function resourceLinkClaims(nonce: string, nowSeconds: number): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a",
    aud: [CLIENT_ID],
    exp: nowSeconds + 300,
    iat: nowSeconds,
    azp: CLIENT_ID,
    nonce,
    name: "Ms Jane Marie Doe",
    email: "jane@platform.example.edu",
    [`${CLAIM}deployment_id`]: DEPLOYMENT_ID,
    [`${CLAIM}message_type`]: "LtiResourceLinkRequest",
    [`${CLAIM}version`]: "1.3.0",
    [`${CLAIM}roles`]: [
      "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student",
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
    ],
    [`${CLAIM}context`]: { id: "c1d887f0-a1a3-4bca-ae25-c375edcc131a", label: "ECON 1010" },
    [`${CLAIM}resource_link`]: {
      id: "200d101f-2c14-434a-a0f3-57c2a42369fd",
      description: "Assignment to introduce who you are",
      title: "Introduction Assignment",
    },
    [`${CLAIM}tool_platform`]: { guid: "ex/48bbb541-ce55-456e-8b7d-ebc59a38d435", name: "Example Tool Platform" },
    [`${CLAIM}target_link_uri`]: TARGET_LINK_URI,
    [`${CLAIM}launch_presentation`]: { document_target: "iframe", height: 320, width: 240 },
    [`${CLAIM}custom`]: { exam: "tryout-1", attempt: "2" },
    [AGS_CLAIM]: {
      scope: AGS_SCOPES,
      lineitems: "https://lms.example.edu/2344/lineitems/",
      lineitem: "https://lms.example.edu/2344/lineitems/1234/lineitem",
    },
  };
}

/** The claims of a Deep Linking request, as Deep Linking 2.0 Appendix A gives them. */
function deepLinkingClaims(nonce: string, nowSeconds: number): Record<string, unknown> {
  const { [AGS_CLAIM]: _ags, [`${CLAIM}resource_link`]: _link, ...claims } = resourceLinkClaims(nonce, nowSeconds);
  return {
    ...claims,
    [`${CLAIM}message_type`]: "LtiDeepLinkingRequest",
    [`${CLAIM}roles`]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
    [`${DL_CLAIM}deep_linking_settings`]: {
      deep_link_return_url: RETURN_URL,
      accept_types: ["link", "file", "html", "ltiResourceLink", "image"],
      accept_presentation_document_targets: ["iframe", "window", "embed"],
      accept_multiple: true,
      auto_create: true,
      data: "deep-link-data-1",
    },
  };
}

/** What `authenticate` returns: the id_token the platform issued and the post that carries it. */
export interface Authenticated {
  readonly state: string;
  readonly nonce: string;
  readonly idToken: string;
  readonly claims: Record<string, unknown>;
  /** The form post to the redirect URI, with the given headers. */
  post(headers?: Readonly<Record<string, string>>): HttpRequest;
}

/** What `authenticate` can change in the token it issues. */
export interface Issue {
  /** Claims that replace those of the launch; a value of `undefined` removes the claim. */
  readonly claims?: Readonly<Record<string, unknown>>;
  /** The message to issue; default: a resource link launch. */
  readonly message?: "resource-link" | "deep-linking";
  /** Fields that replace those of the header. */
  readonly header?: Readonly<Record<string, unknown>>;
  /** The key to sign with; default: the platform's. */
  readonly signer?: KeyPair;
}

/** Builds the form post of the platform to the tool's redirect URI. */
function formPost(
  fields: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): HttpRequest {
  return request({
    method: "POST",
    url: REDIRECT_URI,
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(Object.entries(fields)).toString(),
  });
}

/** The platform's side of a launch, of the key set and of the token endpoint. */
export class FakePlatform {
  /** The keys the key set publishes. */
  published: KeyPair[];
  /** The key that signs tokens. */
  signer: KeyPair;
  /** The tool's key, with which the token endpoint and the Deep Linking return check the tool's JWTs. */
  toolKey: KeyPair | undefined;
  /** The requests that reached the key set and the token endpoint, as `METHOD url`. */
  readonly requests: string[] = [];
  /** The assertions the token endpoint accepted, as header and payload. */
  readonly grants: { header: Record<string, unknown>; payload: Record<string, unknown>; scope: string }[] = [];
  /** Replaces the key set response while set. */
  keySetResponse: (() => Response | Promise<Response>) | undefined;
  /** Replaces the token response while set. */
  tokenResponse: (() => Response | Promise<Response>) | undefined;
  private readonly usedJti = new Set<string>();
  private readonly clock: TestClock;

  constructor(clock: TestClock, signer: KeyPair) {
    this.clock = clock;
    this.signer = signer;
    this.published = [signer];
  }

  /** The `fetch` of the tool: it serves the key set and the token endpoint. */
  readonly fetch: Fetch = async (url, init) => {
    this.requests.push(`${init.method} ${url}`);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (url === JWKS_URL) {
      expect(init.method).toBe("GET");
      return this.keySetResponse?.() ?? Response.json({ keys: this.published.map((key) => key.publicJwk) });
    }
    if (url === ACCESS_TOKEN_URL) return this.tokenResponse?.() ?? this.grant(init);
    return new Response("not found", { status: 404 });
  };

  /** A third-party initiated login (Security Framework section 5.1.1.1) to the tool's login URL. */
  initiation(
    options: { storageTarget?: string; method?: "GET" | "POST"; clientId?: boolean; messageHint?: string } = {},
  ): HttpRequest {
    const { storageTarget, method = "GET", clientId = false, messageHint = "opaque-message-hint" } = options;
    const fields: [string, string][] = [
      ["iss", ISSUER],
      ["login_hint", "24400320"],
      ["target_link_uri", TARGET_LINK_URI],
      ["lti_message_hint", messageHint],
      ["lti_deployment_id", DEPLOYMENT_ID],
    ];
    if (clientId) fields.push(["client_id", CLIENT_ID]);
    if (storageTarget !== undefined) fields.push(["lti_storage_target", storageTarget]);
    const parameters = new URLSearchParams(fields);
    return method === "GET"
      ? request({ url: `${LOGIN_URL}?${parameters}` })
      : request({
          method: "POST",
          url: LOGIN_URL,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: parameters.toString(),
        });
  }

  /**
   * Answers the tool's authentication request (Security Framework sections 5.1.1.2 and 5.1.1.3): it checks every parameter that
   * the request must carry, and issues the id_token with the request's nonce.
   */
  async authenticate(location: string, issue: Issue = {}): Promise<Authenticated> {
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(AUTHENTICATION_URL);
    const parameters = url.searchParams;
    expect(parameters.get("scope")).toBe("openid");
    expect(parameters.get("response_type")).toBe("id_token");
    expect(parameters.get("client_id")).toBe(CLIENT_ID);
    expect(parameters.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(parameters.get("login_hint")).toBe("24400320");
    expect(parameters.get("response_mode")).toBe("form_post");
    expect(parameters.get("prompt")).toBe("none");
    expect(parameters.get("lti_message_hint")).toBe("opaque-message-hint");
    const state = parameters.get("state") ?? "";
    const nonce = parameters.get("nonce") ?? "";
    expect(state).not.toBe("");
    expect(nonce).not.toBe("");
    const nowSeconds = Math.floor(this.clock.now() / 1000);
    const launch =
      issue.message === "deep-linking" ? deepLinkingClaims(nonce, nowSeconds) : resourceLinkClaims(nonce, nowSeconds);
    const claims = { ...launch, ...issue.claims };
    const idToken = await signToken(claims, issue.signer ?? this.signer, issue.header);
    return {
      state,
      nonce,
      idToken,
      claims,
      post: (headers = {}) => formPost({ id_token: idToken, state }, headers),
    };
  }

  /** The tool's token request (Security Framework section 4.1.1): checks the assertion and answers a token. */
  private async grant(init: Parameters<Fetch>[1]): Promise<Response> {
    expect(init.method).toBe("POST");
    // The media type may carry parameters, such as the charset that RFC 6749 section 3.2 has the form use.
    expect(init.headers["content-type"]?.split(";")[0]).toBe("application/x-www-form-urlencoded");
    expect(init.headers.authorization).toBeUndefined();
    const form = new URLSearchParams(textOf(init.body));
    // RFC 7521 section 4.2 makes `client_id` optional, since the assertion names the client; a tool may send it.
    expect([...form.keys()].filter((name) => name !== "client_id").sort()).toEqual([
      "client_assertion",
      "client_assertion_type",
      "grant_type",
      "scope",
    ]);
    expect(form.get("client_id") ?? CLIENT_ID).toBe(CLIENT_ID);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const assertion = form.get("client_assertion") ?? "";
    const { header, payload } = readToken(assertion);
    expect(this.toolKey).toBeDefined();
    if (!this.toolKey || !(await verifyToken(assertion, this.toolKey)))
      return Response.json({ error: "invalid_client" }, { status: 400 });
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: this.toolKey.kid });
    expect(payload.iss).toBe(CLIENT_ID);
    expect(payload.sub).toBe(CLIENT_ID);
    expect(payload.aud).toBe(ACCESS_TOKEN_URL);
    const nowSeconds = Math.floor(this.clock.now() / 1000);
    expect(payload.iat).toBe(nowSeconds);
    expect(payload.exp).toBe(nowSeconds + 300);
    const jti = String(payload.jti);
    expect(jti).not.toBe("");
    if (this.usedJti.has(jti)) return Response.json({ error: "invalid_client" }, { status: 400 });
    this.usedJti.add(jti);
    const scope = form.get("scope") ?? "";
    this.grants.push({ header, payload, scope });
    const granted = scope.split(" ").filter((item) => AGS_SCOPES.includes(item));
    if (granted.length === 0) return Response.json({ error: "invalid_scope" }, { status: 400 });
    return Response.json({
      access_token: "access-token-1",
      token_type: "Bearer",
      expires_in: 3600,
      scope: granted.join(" "),
    });
  }

  /**
   * The platform's check of the tool's Deep Linking response (Security Framework section 5.2.3, Deep Linking 2.0 section 4.5): it
   * returns the claims when the response is acceptable.
   */
  async acceptDeepLinking(jwt: string, data: string | undefined): Promise<Record<string, unknown>> {
    expect(this.toolKey).toBeDefined();
    expect(this.toolKey && (await verifyToken(jwt, this.toolKey))).toBe(true);
    const { header, payload } = readToken(jwt);
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe(this.toolKey?.kid);
    expect(payload.iss).toBe(CLIENT_ID);
    expect(payload.aud).toBe(ISSUER);
    expect(payload.exp).toBeGreaterThan(this.clock.now() / 1000);
    expect(typeof payload.nonce).toBe("string");
    expect(payload[`${CLAIM}message_type`]).toBe("LtiDeepLinkingResponse");
    expect(payload[`${CLAIM}version`]).toBe("1.3.0");
    expect(payload[`${CLAIM}deployment_id`]).toBe(DEPLOYMENT_ID);
    expect(payload[`${DL_CLAIM}data`]).toBe(data);
    return payload;
  }
}

/** Returns the `name=value` of the cookie that a response sets, to send back as a `cookie` header. */
export function cookieOf(setCookie: string | undefined): string {
  return (setCookie ?? "").split(";")[0] ?? "";
}

/** An in-memory store of logins, with counters. */
export class MemoryStore implements LtiStore {
  readonly records = new Map<string, LoginRecord>();
  gets = 0;
  /** Makes `delete` answer `false`, as when another request deleted the login first. */
  lose = false;

  async put(state: string, record: LoginRecord): Promise<void> {
    this.records.set(state, record);
  }

  async get(state: string): Promise<LoginRecord | undefined> {
    this.gets += 1;
    return this.records.get(state);
  }

  async delete(state: string): Promise<boolean> {
    const had = this.records.delete(state);
    return had && !this.lose;
  }
}

/** The registration of the tool at the platform. */
export function registrationOf(tool: KeyPair, overrides: Partial<PlatformRegistration> = {}): PlatformRegistration {
  return {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    deploymentIds: [DEPLOYMENT_ID],
    authenticationUrl: AUTHENTICATION_URL,
    jwksUrl: JWKS_URL,
    accessTokenUrl: ACCESS_TOKEN_URL,
    redirectUri: REDIRECT_URI,
    signer: createCryptoKeySigner(tool.privateKey, { algorithm: "RS256", keyId: tool.kid }),
    ...overrides,
  };
}
