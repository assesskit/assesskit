// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { createHmac } from "node:crypto";
import { DataError } from "@assesskit/runtime/errors";
import fc from "fast-check";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import ltiGuide from "../../../docs/player/lti.md?raw";
import { ServiceError } from "../src/index.js";
import {
  type AccessTokenOptions,
  createJwksCache,
  type DeepLinkItem,
  type DeepLinkingLaunch,
  deepLinkResponse,
  type HttpRequest,
  type HttpResponse,
  type LtiLaunch,
  type LtiLaunchOptions,
  ltiAccessToken,
  ltiLaunch,
  ltiLogin,
  type PlatformRegistration,
} from "../src/lti/index.js";
import { randomToken } from "../src/lti/internal.js";
import { runGuideSamples } from "./guide-samples.js";
import {
  ACCESS_TOKEN_URL,
  AGS_SCOPES,
  AUTHENTICATION_URL,
  type Authenticated,
  CLIENT_ID,
  cookieOf,
  DEPLOYMENT_ID,
  FakePlatform,
  formPost,
  ISSUER,
  type Issue,
  JWKS_URL,
  LOGIN_URL,
  MemoryStore,
  REDIRECT_URI,
  RETURN_URL,
  registrationOf,
  TARGET_LINK_URI,
  TOOL_ORIGIN,
} from "./lti-fake-platform.js";
import {
  base64url,
  createClock,
  generateKeyPair,
  type KeyPair,
  NOW,
  readPage,
  readToken,
  request,
  signToken,
  type TestClock,
  verifyToken,
} from "./lti-fixture.js";

afterEach(() => vi.useRealTimers());

const platformKey = await generateKeyPair("platform-1");
const rotatedKey = await generateKeyPair("platform-2");
const attackerKey = await generateKeyPair("platform-1");
const toolKey = await generateKeyPair("tool-1");

type Options = LtiLaunchOptions & AccessTokenOptions;

interface Setup {
  readonly clock: TestClock;
  readonly platform: FakePlatform;
  readonly store: MemoryStore;
  readonly options: Options;
  readonly registration: PlatformRegistration;
  /** The arguments the lookup received, as `issuer client`. */
  readonly lookups: string[];
}

/** A tool with its registration, store and key set cache, against a platform. */
function setup(overrides: Partial<PlatformRegistration> = {}): Setup {
  const clock = createClock();
  const platform = new FakePlatform(clock, platformKey);
  platform.toolKey = toolKey;
  const store = new MemoryStore();
  const registration = registrationOf(toolKey, overrides);
  const lookups: string[] = [];
  const options: Options = {
    registration: async (issuer, clientId) => {
      lookups.push(`${issuer} ${clientId}`);
      return issuer === ISSUER && (clientId === undefined || clientId === CLIENT_ID) ? registration : undefined;
    },
    clock,
    store,
    jwks: createJwksCache({ fetch: platform.fetch }),
    fetch: platform.fetch,
  };
  return { clock, platform, store, options, registration, lookups };
}

const SECONDS = NOW / 1000;

/** Returns the launch of a result that must be one. */
function launchOf(result: LtiLaunch | HttpResponse): LtiLaunch {
  if ("messageType" in result) return result;
  throw new Error("The result is a page, not a launch.");
}

/** Returns the Deep Linking request of a result that must be one. */
function deepLinkingOf(result: LtiLaunch | HttpResponse): DeepLinkingLaunch {
  const launch = launchOf(result);
  if (launch.messageType === "LtiDeepLinkingRequest") return launch;
  throw new Error("The launch is not a Deep Linking request.");
}

/** The login on the cookie path, and the platform's answer to it. */
async function cookieLogin(
  ctx: Setup,
  issue: Issue = {},
): Promise<{ auth: Authenticated; cookie: string; request: HttpRequest; response: HttpResponse }> {
  const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
  const auth = await ctx.platform.authenticate(response.headers.location ?? "", issue);
  const cookie = cookieOf(response.headers["set-cookie"]);
  return { auth, cookie, request: auth.post({ cookie }), response };
}

/** The platform's storage for the tool, as LTI Client Side OIDC 0.1 section 4.1 sketches it: a bucket for each origin. */
class PlatformStorage {
  private readonly buckets = new Map<string, Map<string, string>>();

  put(origin: string, key: string, value: string): void {
    this.buckets.set(origin, (this.buckets.get(origin) ?? new Map()).set(key, value));
  }

  get(origin: string, key: string): string | undefined {
    return this.buckets.get(origin)?.get(key);
  }
}

/** The login on the storage path: what the page stores, and the platform's answer. */
async function storageLogin(
  ctx: Setup,
  issue: Issue = {},
): Promise<{ auth: Authenticated; config: Record<string, string>; storage: PlatformStorage; response: HttpResponse }> {
  const response = await ltiLogin(ctx.platform.initiation({ storageTarget: "lti-storage" }), ctx.options);
  const { config } = readPage(response);
  const storage = new PlatformStorage();
  storage.put(TOOL_ORIGIN, `state_${config.state}`, config.state ?? "");
  storage.put(TOOL_ORIGIN, `nonce_${config.nonce}`, config.nonce ?? "");
  const auth = await ctx.platform.authenticate(config.authenticationRequest ?? "", issue);
  return { auth, config, storage, response };
}

/** The post of the verification page: the token and state again, with what the page fetched from the storage. */
function verificationPost(
  auth: Authenticated,
  storage: PlatformStorage,
  headers: Readonly<Record<string, string>> = { origin: TOOL_ORIGIN },
): HttpRequest {
  return formPost(
    {
      id_token: auth.idToken,
      state: auth.state,
      stored_state: storage.get(TOOL_ORIGIN, `state_${auth.state}`) ?? "",
      stored_nonce: storage.get(TOOL_ORIGIN, `nonce_${auth.nonce}`) ?? "",
    },
    headers,
  );
}

describe("ltiAccessToken", () => {
  const deployment = { issuer: ISSUER, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID };
  const [lineitem, , score] = AGS_SCOPES;
  const scopes = [lineitem ?? "", score ?? ""];

  it("requests a token with a signed client assertion, as the Security Framework describes", async () => {
    const { options, platform } = setup();
    const token = await ltiAccessToken(deployment, scopes, options);
    expect(token).toEqual({ value: "access-token-1", expiresAt: NOW + 3_600_000, scopes });
    expect(platform.requests).toEqual([`POST ${ACCESS_TOKEN_URL}`]);
    const [grant] = platform.grants;
    expect(grant?.scope).toBe(scopes.join(" "));
    expect(grant?.payload["https://purl.imsglobal.org/spec/lti/claim/deployment_id"]).toBe(DEPLOYMENT_ID);
  });

  it("uses a new jti for each request", async () => {
    const { options, platform } = setup();
    await ltiAccessToken(deployment, scopes, options);
    await ltiAccessToken(deployment, scopes, options);
    const ids = platform.grants.map((grant) => grant.payload.jti);
    expect(new Set(ids).size).toBe(2);
  });

  it("returns the scopes that the platform grants, a subset of those requested", async () => {
    const { options } = setup();
    const token = await ltiAccessToken(deployment, [score ?? "", "https://example.org/scope/other"], options);
    expect(token.scopes).toEqual([score]);
  });

  it("takes the requested scopes when the response names none, and accepts the token type in any case", async () => {
    const { options, platform } = setup();
    platform.tokenResponse = () => Response.json({ access_token: "t1", token_type: "bearer", expires_in: 60 });
    expect(await ltiAccessToken(deployment, scopes, options)).toEqual({
      value: "t1",
      expiresAt: NOW + 60_000,
      scopes,
    });
  });

  it("sends the request to the token endpoint of the registration within the time limit", async () => {
    const { options } = setup();
    let seen: { url: string; signal: AbortSignal | undefined } | undefined;
    const fetch: AccessTokenOptions["fetch"] = async (url, init) => {
      seen = { url, signal: init.signal };
      return Response.json({ access_token: "t", token_type: "Bearer", expires_in: 1 });
    };
    await ltiAccessToken(deployment, scopes, { ...options, fetch, timeoutMs: 5000 });
    expect(seen?.url).toBe(ACCESS_TOKEN_URL);
    expect(seen?.signal?.aborted).toBe(false);
  });

  it("throws ServiceError with the status and the body when the platform refuses", async () => {
    const { options } = setup();
    const error = await ltiAccessToken(deployment, ["https://example.org/scope/other"], options).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 400, body: '{"error":"invalid_scope"}' });
  });

  it("throws ServiceError with status 0 when the platform does not answer", async () => {
    const { options, platform } = setup();
    platform.tokenResponse = () => {
      throw new TypeError("network down");
    };
    const error = await ltiAccessToken(deployment, scopes, options).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ServiceError", status: 0 });
    expect(String(error)).toContain("network down");
  });

  it("throws ServiceError with status 0 when the platform is slower than the time limit", async () => {
    const { options } = setup();
    const fetch: AccessTokenOptions["fetch"] = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    await expect(ltiAccessToken(deployment, scopes, { ...options, fetch, timeoutMs: 20 })).rejects.toMatchObject({
      name: "ServiceError",
      status: 0,
    });
  });

  it("throws DataError for an answer that is not a token response", async () => {
    const { options, platform } = setup();
    const answers: readonly [string, () => Response][] = [
      ["The token response must be JSON.", () => new Response("<html>")],
      ["The token response is invalid: expected an object, found an array.", () => Response.json([])],
      [
        'The token response is invalid: missing the property "access_token".',
        () => Response.json({ token_type: "Bearer", expires_in: 60 }),
      ],
      [
        'The token response is invalid at token_type: expected "Bearer", found "mac".',
        () => Response.json({ access_token: "t", token_type: "mac", expires_in: 60 }),
      ],
      [
        'The token response is invalid: missing the property "expires_in".',
        () => Response.json({ access_token: "t", token_type: "Bearer" }),
      ],
      [
        'The token response is invalid at expires_in: expected a number, found "3600".',
        () => Response.json({ access_token: "t", token_type: "Bearer", expires_in: "3600" }),
      ],
      [
        "The token response is invalid at scope: expected a string, found 5.",
        () => Response.json({ access_token: "t", token_type: "Bearer", expires_in: 60, scope: 5 }),
      ],
    ];
    for (const [message, answer] of answers) {
      platform.tokenResponse = answer;
      await expect(ltiAccessToken(deployment, scopes, options), message).rejects.toThrow(new DataError(message));
    }
  });

  it("throws LtiError when the registration is gone or no longer lists the deployment", async () => {
    const { options } = setup();
    await expect(
      ltiAccessToken({ ...deployment, issuer: "https://other.example" }, scopes, options),
    ).rejects.toMatchObject({ name: "LtiError", reason: "platform-unknown" });
    await expect(ltiAccessToken({ ...deployment, deploymentId: "other" }, scopes, options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "deployment-unknown",
    });
  });

  it("throws DataError for arguments and options of other types", async () => {
    const { options } = setup();
    const calls: readonly [string, () => Promise<unknown>][] = [
      ["The deployment must be an object, found null.", () => ltiAccessToken(JSON.parse("null"), scopes, options)],
      [
        'The issuer of the deployment must be a non-empty string, found "".',
        () => ltiAccessToken({ ...deployment, issuer: "" }, scopes, options),
      ],
      ['The scopes must be an array, found "a".', () => ltiAccessToken(deployment, JSON.parse('"a"'), options)],
      ["The scopes must have at least one scope.", () => ltiAccessToken(deployment, [], options)],
      [
        'A scope must be a non-empty string without spaces, found "a b".',
        () => ltiAccessToken(deployment, ["a b"], options),
      ],
      [
        "A scope must be a non-empty string without spaces, found 5.",
        () => ltiAccessToken(deployment, JSON.parse("[5]"), options),
      ],
      ["The options must be an object, found null.", () => ltiAccessToken(deployment, scopes, JSON.parse("null"))],
      [
        'The option fetch must be a function, found "x".',
        () => ltiAccessToken(deployment, scopes, { ...options, fetch: JSON.parse('"x"') }),
      ],
      [
        'The option timeoutMs must be a positive integer, found "5".',
        () => ltiAccessToken(deployment, scopes, { ...options, timeoutMs: JSON.parse('"5"') }),
      ],
      [
        "The option timeoutMs must be a positive integer, found null.",
        () => ltiAccessToken(deployment, scopes, { ...options, timeoutMs: JSON.parse("null") }),
      ],
      [
        "The option clock must be an object, found null.",
        () => ltiAccessToken(deployment, scopes, { ...options, clock: JSON.parse("null") }),
      ],
    ];
    for (const [message, call] of calls) await expect(call(), message).rejects.toThrow(new DataError(message));
  });
});

describe("deepLinkResponse", () => {
  const exam = new Map([["exam", "tryout-1"]]);

  /** A Deep Linking request through the whole login, as the platform sends it. */
  async function deepLinkingRequest(ctx: Setup, claims: Issue["claims"] = {}): Promise<DeepLinkingLaunch> {
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking", claims });
    return deepLinkingOf(await ltiLaunch(post, ctx.options));
  }

  it("signs a response that places a test, which the platform accepts", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const jwt = await deepLinkResponse(
      launch,
      [
        {
          title: "Tryout 1",
          text: "A timed tryout",
          url: `${TOOL_ORIGIN}/lti/tests/tryout-1`,
          custom: exam,
          lineItem: { scoreMaximum: 100, label: "Tryout 1", resourceId: "tryout-1", tag: "exam" },
        },
      ],
      ctx.options,
    );
    const claims = await ctx.platform.acceptDeepLinking(jwt, "deep-link-data-1");
    expect(claims).toMatchObject({
      iss: CLIENT_ID,
      aud: ISSUER,
      iat: SECONDS,
      exp: SECONDS + 300,
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
      "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": DEPLOYMENT_ID,
      "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": [
        {
          type: "ltiResourceLink",
          title: "Tryout 1",
          text: "A timed tryout",
          url: `${TOOL_ORIGIN}/lti/tests/tryout-1`,
          custom: { exam: "tryout-1" },
          lineItem: { scoreMaximum: 100, label: "Tryout 1", resourceId: "tryout-1", tag: "exam" },
        },
      ],
    });
    expect(readToken(jwt).header).toEqual({ alg: "RS256", typ: "JWT", kid: "tool-1" });
  });

  it("places no item with an empty list, and leaves out the data when the request had none", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, {
      "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings": {
        deep_link_return_url: RETURN_URL,
        accept_types: ["ltiResourceLink"],
        accept_presentation_document_targets: ["iframe"],
      },
    });
    const claims = await ctx.platform.acceptDeepLinking(await deepLinkResponse(launch, [], ctx.options), undefined);
    expect(claims["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toEqual([]);
    expect("https://purl.imsglobal.org/spec/lti-dl/claim/data" in claims).toBe(false);
  });

  it("gives each response its own nonce and writes only the properties that the item has", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const first = readToken(await deepLinkResponse(launch, [{ url: TARGET_LINK_URI }], ctx.options)).payload;
    const second = readToken(await deepLinkResponse(launch, [{ url: TARGET_LINK_URI }], ctx.options)).payload;
    expect(first.nonce).not.toBe(second.nonce);
    expect(first["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toEqual([
      { type: "ltiResourceLink", url: TARGET_LINK_URI },
    ]);
  });

  it("places several items only when the platform accepts several", async () => {
    const ctx = setup();
    const several = await deepLinkingRequest(ctx);
    const jwt = await deepLinkResponse(several, [{ title: "a" }, { title: "b" }], ctx.options);
    expect(readToken(jwt).payload["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toHaveLength(2);
    for (const accept of [{ accept_multiple: false }, {}]) {
      const one = await deepLinkingRequest(ctx, {
        "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings": {
          deep_link_return_url: RETURN_URL,
          accept_types: ["ltiResourceLink"],
          accept_presentation_document_targets: ["iframe"],
          ...accept,
        },
      });
      await expect(deepLinkResponse(one, [{ title: "a" }], ctx.options)).resolves.toEqual(expect.any(String));
      await expect(deepLinkResponse(one, [{ title: "a" }, { title: "b" }], ctx.options)).rejects.toThrow(
        new DataError("The platform does not say that it accepts several items, and 2 were given."),
      );
    }
  });

  it("refuses items of a type that the platform does not accept", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, {
      "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings": {
        deep_link_return_url: RETURN_URL,
        accept_types: ["link", "file"],
        accept_presentation_document_targets: ["iframe"],
      },
    });
    await expect(deepLinkResponse(launch, [{ title: "a" }], ctx.options)).rejects.toThrow(
      new DataError('The platform accepts the types "link, file", and not ltiResourceLink.'),
    );
    await expect(deepLinkResponse(launch, [], ctx.options)).resolves.toEqual(expect.any(String));
  });

  it("refuses a launch that is not a Deep Linking request, or whose registration changed", async () => {
    const ctx = setup();
    const resourceLink = launchOf(await ltiLaunch((await cookieLogin(ctx)).request, ctx.options));
    await expect(deepLinkResponse(JSON.parse(JSON.stringify(resourceLink)), [], ctx.options)).rejects.toThrow(
      new DataError('The launch must be a LtiDeepLinkingRequest, found the message type "LtiResourceLinkRequest".'),
    );
    const launch = await deepLinkingRequest(ctx);
    await expect(deepLinkResponse({ ...launch, deploymentId: "other" }, [], ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "deployment-unknown",
    });
    await expect(
      deepLinkResponse({ ...launch, issuer: "https://other.example" }, [], ctx.options),
    ).rejects.toMatchObject({ name: "LtiError", reason: "platform-unknown" });
  });

  it("throws DataError for an item that is malformed", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const properties = '"title", "text", "url", "custom" and "lineItem"';
    const bad: readonly [string, DeepLinkItem][] = [
      [`A Deep Linking item has the properties ${properties}, found "type".`, JSON.parse('{"type":"link"}')],
      ["The title of a Deep Linking item must be a string, found 5.", JSON.parse('{"title":5}')],
      ["The text of a Deep Linking item must be a string, found null.", JSON.parse('{"text":null}')],
      [
        'The url of a Deep Linking item must be an absolute https URL, found "http://tool.example/t".',
        { url: "http://tool.example/t" },
      ],
      [
        "The custom properties of a Deep Linking item must be a Map of strings, found an object.",
        JSON.parse('{"custom":{"exam":"t"}}'),
      ],
      [
        "The custom properties of a Deep Linking item must be a Map of strings, found an object.",
        { custom: new Map([["exam", JSON.parse("1")]]) },
      ],
      ["The line item of a Deep Linking item must be an object, found 5.", JSON.parse('{"lineItem":5}')],
      ["The scoreMaximum of a line item must be a number above 0, found 0.", { lineItem: { scoreMaximum: 0 } }],
      ["The scoreMaximum of a line item must be a number above 0, found -1.", { lineItem: { scoreMaximum: -1 } }],
      [
        "The scoreMaximum of a line item must be a number above 0, found NaN.",
        { lineItem: { scoreMaximum: Number.NaN } },
      ],
      [
        'The scoreMaximum of a line item must be a number above 0, found "100".',
        JSON.parse('{"lineItem":{"scoreMaximum":"100"}}'),
      ],
      ["The label of a line item must be a string, found 1.", JSON.parse('{"lineItem":{"scoreMaximum":1,"label":1}}')],
      [
        'A line item has the properties "scoreMaximum", "label", "resourceId" and "tag", found "gradesReleased".',
        JSON.parse('{"lineItem":{"scoreMaximum":1,"gradesReleased":true}}'),
      ],
      ["A Deep Linking item must be an object, found null.", JSON.parse("null")],
    ];
    for (const [message, item] of bad) {
      await expect(deepLinkResponse(launch, [item], ctx.options), message).rejects.toThrow(new DataError(message));
    }
  });

  it("throws DataError for arguments of other types", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    await expect(deepLinkResponse(JSON.parse("null"), [], ctx.options)).rejects.toThrow(
      new DataError("The launch must be an object, found null."),
    );
    await expect(deepLinkResponse(launch, JSON.parse('{"length":0}'), ctx.options)).rejects.toThrow(
      new DataError("The items must be an array, found an object."),
    );
    await expect(deepLinkResponse(launch, [], JSON.parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
    await expect(deepLinkResponse({ ...launch, settings: JSON.parse("5") }, [], ctx.options)).rejects.toThrow(
      new DataError("The settings of the launch must be an object, found 5."),
    );
    await expect(
      deepLinkResponse(
        { ...launch, settings: { ...launch.settings, acceptTypes: JSON.parse('"x"') } },
        [],
        ctx.options,
      ),
    ).rejects.toThrow(new DataError('The accepted types of the launch must be an array, found "x".'));
  });
});

describe("createJwksCache", () => {
  /** Resolves the key that a token with the header resolves with from the key set at `JWKS_URL`. */
  const key = (cache: ReturnType<typeof createJwksCache>, kid: string | undefined) =>
    cache.keySet(JWKS_URL)({ alg: "RS256", kid }, { payload: "", signature: "" });
  const NO_KEY = { code: "ERR_JWKS_NO_MATCHING_KEY" };

  it("fetches a key set once and serves its keys from the cache", async () => {
    const { platform } = setup();
    const cache = createJwksCache({ fetch: platform.fetch });
    const first = await key(cache, "platform-1");
    expect(first).toBeDefined();
    expect(await key(cache, "platform-1")).toBe(first);
    expect(platform.requests).toEqual([`GET ${JWKS_URL}`]);
  });

  it("follows a rotation: a kid that the cached set lacks fetches the set again after the refresh time", async () => {
    const { platform, clock } = setup();
    const cache = createJwksCache({ fetch: platform.fetch });
    await key(cache, "platform-1");
    platform.published = [rotatedKey, platformKey];
    await expect(key(cache, "platform-2")).rejects.toMatchObject(NO_KEY);
    expect(platform.requests).toHaveLength(1);
    clock.advance(60);
    expect(await key(cache, "platform-2")).toBeDefined();
    expect(await key(cache, "platform-1")).toBeDefined();
    expect(platform.requests).toHaveLength(2);
  });

  it("does not fetch on every request that names an invented kid", async () => {
    const { platform, clock } = setup();
    const cache = createJwksCache({ fetch: platform.fetch });
    for (let i = 0; i < 50; i += 1) await expect(key(cache, `invented-${i}`)).rejects.toMatchObject(NO_KEY);
    expect(platform.requests).toHaveLength(1);
    clock.advance(59);
    await expect(key(cache, "invented-x")).rejects.toMatchObject(NO_KEY);
    expect(platform.requests).toHaveLength(1);
    clock.advance(1);
    await expect(key(cache, "invented-y")).rejects.toMatchObject(NO_KEY);
    expect(platform.requests).toHaveLength(2);
  });

  it("fetches a set again when it is older than the time to live", async () => {
    const { platform, clock } = setup();
    const cache = createJwksCache({ fetch: platform.fetch, ttlSeconds: 100, refreshSeconds: 10 });
    await key(cache, "platform-1");
    clock.advance(99);
    await key(cache, "platform-1");
    expect(platform.requests).toHaveLength(1);
    clock.advance(1);
    await key(cache, "platform-1");
    expect(platform.requests).toHaveLength(2);
  });

  it("shares one fetch among the requests that wait for it", async () => {
    const { platform } = setup();
    const cache = createJwksCache({ fetch: platform.fetch });
    const keys = await Promise.all(Array.from({ length: 5 }, () => key(cache, "platform-1")));
    expect(new Set(keys).size).toBe(1);
    expect(platform.requests).toHaveLength(1);
  });

  it("serves the keys of one URL from one set, and a set for each URL", () => {
    const { platform } = setup();
    const cache = createJwksCache({ fetch: platform.fetch });
    expect(cache.keySet(JWKS_URL)).toBe(cache.keySet(JWKS_URL));
    expect(cache.keySet(`${JWKS_URL}?other`)).not.toBe(cache.keySet(JWKS_URL));
  });

  it("keeps the RSA keys that are meant for signing with RS256, and refuses a kid that two keys share", async () => {
    const { platform } = setup();
    platform.keySetResponse = () =>
      Response.json({
        keys: [
          { ...platformKey.publicJwk, kid: "encryption", use: "enc" },
          { ...platformKey.publicJwk, kid: "other-alg", alg: "RS512" },
          { ...platformKey.publicJwk, kid: "encrypt-only", key_ops: ["encrypt"] },
          { kty: "EC", crv: "P-256", x: "a", y: "b", kid: "elliptic" },
          { ...platformKey.publicJwk, kid: undefined },
          platformKey.publicJwk,
          { ...rotatedKey.publicJwk, kid: "shared" },
          { ...attackerKey.publicJwk, kid: "shared" },
        ],
      });
    const cache = createJwksCache({ fetch: platform.fetch });
    for (const kid of ["encryption", "other-alg", "encrypt-only", "elliptic", "absent"]) {
      await expect(key(cache, kid), kid).rejects.toMatchObject(NO_KEY);
    }
    await expect(key(cache, "shared")).rejects.toMatchObject({ code: "ERR_JWKS_MULTIPLE_MATCHING_KEYS" });
    const token = await signToken({ a: 1 }, platformKey);
    const kept = await key(cache, "platform-1");
    expect(await jwtVerify(token, kept, { algorithms: ["RS256"] })).toMatchObject({ payload: { a: 1 } });
    await expect(jwtVerify(token, attackerKey.publicKey, { algorithms: ["RS256"] })).rejects.toMatchObject({
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
  });

  it("throws ServiceError with the status and the body when the platform refuses", async () => {
    const { platform } = setup();
    platform.keySetResponse = () => new Response("down", { status: 503 });
    const cache = createJwksCache({ fetch: platform.fetch });
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ name: "ServiceError", status: 503, body: "down" });
    platform.keySetResponse = undefined;
    expect(await key(cache, "platform-1")).toBeDefined();
  });

  it("throws ServiceError with status 0 when the fetch fails, as it does for a redirect", async () => {
    const { platform } = setup();
    platform.keySetResponse = () => {
      throw new TypeError("redirect mode is set to error");
    };
    const cache = createJwksCache({ fetch: platform.fetch });
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ name: "ServiceError", status: 0 });
  });

  it("throws ServiceError for an answer larger than 64 KiB", async () => {
    const { platform } = setup();
    platform.keySetResponse = () => new Response("x".repeat(65_537));
    const cache = createJwksCache({ fetch: platform.fetch });
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ name: "ServiceError", status: 200 });
  });

  it("throws DataError for arguments and options of other types", () => {
    const { platform } = setup();
    const cache = createJwksCache({ fetch: platform.fetch });
    expect(() => cache.keySet("http://lms.example.edu/jwks")).toThrow(
      new DataError('The URL of a key set must be an absolute https URL, found "http://lms.example.edu/jwks".'),
    );
    const options = { fetch: platform.fetch };
    const bad: readonly [string, () => unknown][] = [
      ["The options must be an object, found null.", () => createJwksCache(JSON.parse("null"))],
      [
        'The option fetch must be a function, found "f".',
        () => createJwksCache({ ...options, fetch: JSON.parse('"f"') }),
      ],
      [
        "The option ttlSeconds must be a positive integer, found 0.",
        () => createJwksCache({ ...options, ttlSeconds: 0 }),
      ],
      [
        'The option refreshSeconds must be a positive integer, found "1".',
        () => createJwksCache({ ...options, refreshSeconds: JSON.parse('"1"') }),
      ],
      [
        "The option timeoutMs must be a positive integer, found null.",
        () => createJwksCache({ ...options, timeoutMs: JSON.parse("null") }),
      ],
    ];
    for (const [message, call] of bad) expect(call, message).toThrow(new DataError(message));
  });
});

describe("ltiLaunch", () => {
  describe("on the cookie path", () => {
    it("returns the launch of a resource link, with the claims that the platform sent", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      expect(launchOf(await ltiLaunch(post, ctx.options))).toEqual({
        messageType: "LtiResourceLinkRequest",
        issuer: ISSUER,
        clientId: CLIENT_ID,
        deploymentId: DEPLOYMENT_ID,
        targetLinkUri: TARGET_LINK_URI,
        subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a",
        roles: [
          "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student",
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
        ],
        custom: new Map([
          ["exam", "tryout-1"],
          ["attempt", "2"],
        ]),
        resourceLink: {
          id: "200d101f-2c14-434a-a0f3-57c2a42369fd",
          title: "Introduction Assignment",
          description: "Assignment to introduce who you are",
        },
        ags: {
          scopes: AGS_SCOPES,
          lineitems: "https://lms.example.edu/2344/lineitems/",
          lineitem: "https://lms.example.edu/2344/lineitems/1234/lineitem",
        },
      });
    });

    it("returns the settings of a Deep Linking request", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
      const launch = deepLinkingOf(await ltiLaunch(post, ctx.options));
      expect(launch.settings).toEqual({
        returnUrl: RETURN_URL,
        acceptTypes: ["link", "file", "html", "ltiResourceLink", "image"],
        acceptMultiple: true,
        data: "deep-link-data-1",
      });
      expect(launch.roles).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]);
    });

    it("accepts an anonymous launch, a blank line item, an audience string and an azp that is absent", async () => {
      const ctx = setup();
      const claims = {
        sub: undefined,
        azp: undefined,
        aud: CLIENT_ID,
        "https://purl.imsglobal.org/spec/lti/claim/roles": [],
        "https://purl.imsglobal.org/spec/lti/claim/custom": undefined,
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": { scope: [AGS_SCOPES[2]], lineitem: "" },
      };
      const { request: post } = await cookieLogin(ctx, { claims });
      const launch = launchOf(await ltiLaunch(post, ctx.options));
      expect(launch).toMatchObject({ roles: [], custom: new Map(), ags: { scopes: [AGS_SCOPES[2]] } });
      expect(launch.subject).toBeUndefined();
      expect(launch.messageType === "LtiResourceLinkRequest" && launch.ags?.lineitem).toBeUndefined();
    });

    it("keeps an identifier such as __proto__ as data in the custom properties", async () => {
      const ctx = setup();
      const claims = {
        "https://purl.imsglobal.org/spec/lti/claim/custom": JSON.parse('{"__proto__":"x","constructor":"y"}'),
      };
      const { request: post } = await cookieLogin(ctx, { claims });
      const launch = launchOf(await ltiLaunch(post, ctx.options));
      expect(launch.custom.get("__proto__")).toBe("x");
      expect(launch.custom.get("constructor")).toBe("y");
    });

    it("completes a login once: the same post fails the second time", async () => {
      const ctx = setup();
      const { request: post, auth } = await cookieLogin(ctx);
      launchOf(await ltiLaunch(post, ctx.options));
      expect(ctx.store.records.has(auth.state)).toBe(false);
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ name: "LtiError", reason: "state-unknown" });
    });

    it("lets one of two launches that race with one login complete", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      ctx.store.lose = true;
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ name: "LtiError", reason: "state-reused" });
    });

    it("refuses a token that answers another login", async () => {
      const ctx = setup();
      const first = await cookieLogin(ctx);
      const second = await cookieLogin(ctx);
      const crossed = formPost({ id_token: first.auth.idToken, state: second.auth.state }, { cookie: second.cookie });
      await expect(ltiLaunch(crossed, ctx.options)).rejects.toMatchObject({ reason: "nonce-mismatch" });
      expect(ctx.store.records.has(second.auth.state)).toBe(true);
    });

    it("refuses a launch whose browser did not log in: the state cookie is missing or differs", async () => {
      const ctx = setup();
      const first = await cookieLogin(ctx);
      const second = await cookieLogin(ctx);
      const withCookie = (cookie: string): HttpRequest => first.auth.post(cookie === "" ? {} : { cookie });
      for (const cookie of [
        "",
        `__Host-lti_state_${first.auth.state}=other`,
        second.cookie,
        `lti_state_${first.auth.state}=${first.auth.state}`,
        `x=1; ${second.cookie}`,
      ]) {
        await expect(ltiLaunch(withCookie(cookie), ctx.options), cookie).rejects.toMatchObject({
          name: "LtiError",
          reason: "state-cookie",
        });
      }
      const accepted = withCookie(`other=1; ${first.cookie}; more=2`);
      expect(launchOf(await ltiLaunch(accepted, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    });

    it("refuses a state that no login of the tool has, without asking the store for a malformed one", async () => {
      const ctx = setup();
      const { auth } = await cookieLogin(ctx);
      const gets = ctx.store.gets;
      for (const state of ["../etc/passwd", "a".repeat(65), "with space", "ünï"]) {
        const post = formPost({ id_token: auth.idToken, state });
        await expect(ltiLaunch(post, ctx.options), state).rejects.toMatchObject({ reason: "state-unknown" });
      }
      expect(ctx.store.gets).toBe(gets);
      const unknown = formPost({ id_token: auth.idToken, state: randomToken() });
      await expect(ltiLaunch(unknown, ctx.options)).rejects.toMatchObject({ reason: "state-unknown" });
    });

    it("refuses a login after ten minutes", async () => {
      const ctx = setup();
      const finish = async (seconds: number): Promise<LtiLaunch | HttpResponse> => {
        const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
        ctx.clock.advance(seconds);
        const auth = await ctx.platform.authenticate(response.headers.location ?? "");
        return ltiLaunch(auth.post({ cookie: cookieOf(response.headers["set-cookie"]) }), ctx.options);
      };
      expect(launchOf(await finish(599)).messageType).toBe("LtiResourceLinkRequest");
      await expect(finish(600)).rejects.toMatchObject({ name: "LtiError", reason: "state-expired" });
    });

    it("refuses a token that is not signed with RS256", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const header = (alg: string): string => base64url(JSON.stringify({ alg, typ: "JWT", kid: "platform-1" }));
      const payload = base64url(JSON.stringify(auth.claims));
      const secret = String(platformKey.publicJwk.n);
      const hmac = createHmac("sha256", secret)
        .update(`${header("HS256")}.${payload}`)
        .digest("base64url");
      const forged = [
        ["none", `${header("none")}.${payload}.`],
        ["HS256 with the modulus of the public key as the secret", `${header("HS256")}.${payload}.${hmac}`],
        ["RS384", signToken(auth.claims, platformKey, { alg: "RS384" })],
        ["ES256", `${header("ES256")}.${payload}.${hmac}`],
      ] as const;
      for (const [name, token] of forged) {
        const post = formPost({ id_token: await token, state: auth.state }, { cookie });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({
          name: "LtiError",
          reason: "algorithm-unsupported",
        });
      }
    });

    it("refuses another spelling of a signature that has the same bytes", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const [header = "", payload = "", signature = ""] = auth.idToken.split(".");
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      // The 256 bytes of an RS256 signature of 2,048 bits end in the middle of the last character: its lowest bit is padding.
      const respelled = `${signature.slice(0, -1)}${alphabet[alphabet.indexOf(signature.at(-1) ?? "A") ^ 1]}`;
      const post = formPost({ id_token: `${header}.${payload}.${respelled}`, state: auth.state }, { cookie });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ name: "LtiError", reason: "token-malformed" });
      expect(launchOf(await ltiLaunch(auth.post({ cookie }), ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    });

    it("refuses a token whose signature is not the platform's", async () => {
      const ctx = setup();
      const forged = await cookieLogin(ctx, { signer: attackerKey });
      await expect(ltiLaunch(forged.request, ctx.options)).rejects.toMatchObject({ reason: "signature-invalid" });
      const tampered = await cookieLogin(ctx);
      const [header = "", , signature = ""] = tampered.auth.idToken.split(".");
      const claims = { ...tampered.auth.claims, sub: "someone-else" };
      const post = formPost(
        { id_token: `${header}.${base64url(JSON.stringify(claims))}.${signature}`, state: tampered.auth.state },
        { cookie: tampered.cookie },
      );
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "signature-invalid" });
    });

    it("refuses a token whose key the platform's key set does not hold", async () => {
      const ctx = setup();
      await expect(
        ltiLaunch((await cookieLogin(ctx, { signer: rotatedKey })).request, ctx.options),
      ).rejects.toMatchObject({ reason: "key-unknown" });
      const noKid = await cookieLogin(ctx, { header: { kid: undefined } });
      await expect(ltiLaunch(noKid.request, ctx.options)).rejects.toMatchObject({ reason: "key-unknown" });
    });

    it("refuses a token signed with a key that cannot verify with RS256, as a key the set does not hold", async () => {
      const ctx = setup();
      const weak = await generateKeyPair("weak", 1024);
      const cases: readonly [string, KeyPair, Record<string, unknown>][] = [
        ["a key of 1,024 bits", weak, weak.publicJwk],
        ["a modulus that is not base64url", platformKey, { ...platformKey.publicJwk, n: "!!" }],
        ["a kid that two keys share", platformKey, platformKey.publicJwk],
      ];
      for (const [name, signer, jwk] of cases) {
        ctx.platform.signer = signer;
        ctx.platform.keySetResponse = () => Response.json({ keys: [jwk, { ...attackerKey.publicJwk, kid: jwk.kid }] });
        const { request: post } = await cookieLogin(ctx);
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({
          name: "LtiError",
          reason: "key-unknown",
        });
        ctx.clock.advance(60);
      }
    });

    it("throws DataError when what the platform serves as its key set is not a key set", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      for (const body of ["<html>", "[]", '{"keys":{}}', '{"key":[]}']) {
        ctx.platform.keySetResponse = () => new Response(body);
        await expect(ltiLaunch(post, ctx.options), body).rejects.toMatchObject({ name: "DataError" });
        ctx.clock.advance(60);
      }
    });

    it("accepts a token signed with a key that the platform added by rotation", async () => {
      const ctx = setup();
      launchOf(await ltiLaunch((await cookieLogin(ctx)).request, ctx.options));
      ctx.platform.published = [rotatedKey, platformKey];
      ctx.platform.signer = rotatedKey;
      ctx.clock.advance(60);
      const { request: post } = await cookieLogin(ctx);
      expect(launchOf(await ltiLaunch(post, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      expect(ctx.platform.requests).toHaveLength(2);
    });

    it("refuses a token with a critical header, which names extensions the tool does not support", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { header: { crit: ["exp"] } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "token-malformed" });
    });

    it("refuses a token that is not a JWT", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const [header = "", payload = "", signature = ""] = auth.idToken.split(".");
      const tokens = [
        "not-a-jwt",
        `${header}.${payload}`,
        `${header}.${payload}.${signature}.extra`,
        `!!!.${payload}.${signature}`,
        `${header}.${payload}.!!!`,
        `${base64url("not json")}.${payload}.${signature}`,
        `${header}.${base64url("[1]")}.${signature}`,
        `${header}.${base64url("null")}.${signature}`,
        `${base64url(Buffer.from([0xff, 0xfe]).buffer)}.${payload}.${signature}`,
      ];
      for (const token of tokens) {
        const post = formPost({ id_token: token, state: auth.state }, { cookie });
        await expect(ltiLaunch(post, ctx.options), token).rejects.toMatchObject({
          name: "LtiError",
          reason: "token-malformed",
        });
      }
    });

    it("refuses a token of another issuer", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { claims: { iss: "https://evil.example" } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "issuer-mismatch" });
    });

    it("refuses a token whose audience is not the tool alone", async () => {
      const ctx = setup();
      const audiences: readonly unknown[] = [
        "another-client",
        ["another-client"],
        [CLIENT_ID, "another-client"],
        [],
        undefined,
        5,
      ];
      for (const aud of audiences) {
        const { request: post } = await cookieLogin(ctx, { claims: { aud } });
        await expect(ltiLaunch(post, ctx.options), JSON.stringify(aud)).rejects.toMatchObject({
          reason: "audience-mismatch",
        });
      }
      const sole = await cookieLogin(ctx, { claims: { aud: [CLIENT_ID, CLIENT_ID] } });
      expect(launchOf(await ltiLaunch(sole.request, ctx.options)).clientId).toBe(CLIENT_ID);
    });

    it("refuses a token whose authorized party is not the tool", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { claims: { azp: "another-client" } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "authorized-party-mismatch" });
      const invalid = await cookieLogin(ctx, { claims: { azp: 5 } });
      await expect(ltiLaunch(invalid.request, ctx.options)).rejects.toMatchObject({ reason: "claim-invalid" });
    });

    it("refuses a token at its expiry, allowing a minute of clock skew", async () => {
      const ctx = setup();
      const inSkew = await cookieLogin(ctx, { claims: { exp: SECONDS - 59 } });
      expect(launchOf(await ltiLaunch(inSkew.request, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      const expired = await cookieLogin(ctx, { claims: { exp: SECONDS - 60 } });
      await expect(ltiLaunch(expired.request, ctx.options)).rejects.toMatchObject({ reason: "token-expired" });
    });

    it("refuses a token issued in the future, allowing a minute of clock skew", async () => {
      const ctx = setup();
      const inSkew = await cookieLogin(ctx, { claims: { iat: SECONDS + 60 } });
      expect(launchOf(await ltiLaunch(inSkew.request, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      const future = await cookieLogin(ctx, { claims: { iat: SECONDS + 61 } });
      await expect(ltiLaunch(future.request, ctx.options)).rejects.toMatchObject({ reason: "issued-in-future" });
    });

    it("refuses a token without a valid exp, iat, nonce or sub", async () => {
      const ctx = setup();
      const cases: readonly [string, Record<string, unknown>, string][] = [
        ["exp", { exp: undefined }, "claim-missing"],
        ["exp as a string", { exp: "1700000300" }, "claim-invalid"],
        ["iat", { iat: undefined }, "claim-missing"],
        ["iat as null", { iat: null }, "claim-invalid"],
        ["nonce", { nonce: undefined }, "claim-missing"],
        ["nonce as a number", { nonce: 5 }, "claim-invalid"],
        ["sub of 256 characters", { sub: "u".repeat(256) }, "claim-invalid"],
        ["empty sub", { sub: "" }, "claim-invalid"],
      ];
      for (const [name, claims, reason] of cases) {
        const { request: post } = await cookieLogin(ctx, { claims });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({ name: "LtiError", reason });
      }
    });

    it("refuses a token whose nonce is not the login's", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { claims: { nonce: "another-nonce" } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "nonce-mismatch" });
    });

    it("refuses a message that is not a launch of this tool", async () => {
      const ctx = setup();
      const claim = "https://purl.imsglobal.org/spec/lti/claim/";
      const cases: readonly [string, Record<string, unknown>, string][] = [
        ["another deployment", { [`${claim}deployment_id`]: "other" }, "deployment-unknown"],
        ["no deployment", { [`${claim}deployment_id`]: undefined }, "claim-missing"],
        ["a long deployment", { [`${claim}deployment_id`]: "d".repeat(256) }, "claim-invalid"],
        [
          "another message type",
          { [`${claim}message_type`]: "LtiSubmissionReviewRequest" },
          "message-type-unsupported",
        ],
        ["no message type", { [`${claim}message_type`]: undefined }, "claim-missing"],
        ["another version", { [`${claim}version`]: "1.2.0" }, "version-unsupported"],
        ["roles that are not an array", { [`${claim}roles`]: "Learner" }, "claim-invalid"],
        ["no roles", { [`${claim}roles`]: undefined }, "claim-missing"],
        ["an http target link", { [`${claim}target_link_uri`]: "http://tool.example/t" }, "claim-invalid"],
        ["no target link", { [`${claim}target_link_uri`]: undefined }, "claim-missing"],
        ["no resource link", { [`${claim}resource_link`]: undefined }, "claim-missing"],
        ["a resource link without an id", { [`${claim}resource_link`]: {} }, "claim-missing"],
        ["a long resource link id", { [`${claim}resource_link`]: { id: "r".repeat(256) } }, "claim-invalid"],
        ["custom values that are not strings", { [`${claim}custom`]: { a: 1 } }, "claim-invalid"],
        [
          "a grade services endpoint that is http",
          { "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": { lineitem: "http://lms.example/l" } },
          "claim-invalid",
        ],
      ];
      for (const [name, claims, reason] of cases) {
        const { request: post } = await cookieLogin(ctx, { claims });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({ name: "LtiError", reason });
      }
    });

    it("refuses a Deep Linking request without valid settings", async () => {
      const ctx = setup();
      const settings = "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";
      const cases: readonly [string, unknown, string][] = [
        ["none", undefined, "claim-missing"],
        [
          "a return URL that is http",
          { deep_link_return_url: "http://lms.example/r", accept_types: [] },
          "claim-invalid",
        ],
        ["no return URL", { accept_types: [] }, "claim-missing"],
        ["no accepted types", { deep_link_return_url: RETURN_URL }, "claim-missing"],
        [
          "multiple as a string",
          { deep_link_return_url: RETURN_URL, accept_types: [], accept_multiple: "yes" },
          "claim-invalid",
        ],
      ];
      for (const [name, value, reason] of cases) {
        const { request: post } = await cookieLogin(ctx, { message: "deep-linking", claims: { [settings]: value } });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({ reason });
      }
    });

    it("refuses a launch of a platform that the tool no longer has", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      const options: Options = { ...ctx.options, registration: async () => undefined };
      await expect(ltiLaunch(post, options)).rejects.toMatchObject({ reason: "platform-unknown" });
    });

    it("refuses an LTI 1.1 launch, which is an OAuth 1.0a form without an id_token", async () => {
      const ctx = setup();
      const legacy = formPost({
        oauth_consumer_key: "key",
        oauth_signature: "x",
        lti_message_type: "basic-lti-launch-request",
        lti_version: "LTI-1p0",
        resource_link_id: "r1",
      });
      await expect(ltiLaunch(legacy, ctx.options)).rejects.toMatchObject({
        name: "LtiError",
        reason: "legacy-launch",
      });
    });

    it("throws DataError for a request that is not a launch", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const form = { "content-type": "application/x-www-form-urlencoded" };
      const cases: readonly [string, HttpRequest][] = [
        ['A launch must be a POST request, found "GET".', { ...auth.post({ cookie }), method: "GET" }],
        [
          'The content type of the request must be application/x-www-form-urlencoded, found "application/json".',
          { ...auth.post({ cookie }), headers: { "content-type": "application/json", cookie } },
        ],
        [
          "The content type of the request must be application/x-www-form-urlencoded, found undefined.",
          { ...auth.post(), headers: {} },
        ],
        [
          'The launch must have the form parameter "id_token", found undefined.',
          request({ method: "POST", url: REDIRECT_URI, headers: form, body: `state=${auth.state}` }),
        ],
        [
          'The launch must have the form parameter "state", found "".',
          request({ method: "POST", url: REDIRECT_URI, headers: form, body: `id_token=${auth.idToken}&state=` }),
        ],
        [
          'The form of the request has the parameter "state" more than once.',
          request({ method: "POST", url: REDIRECT_URI, headers: form, body: `id_token=a&state=${auth.state}&state=x` }),
        ],
      ];
      for (const [message, post] of cases)
        await expect(ltiLaunch(post, ctx.options), message).rejects.toThrow(new DataError(message));
    });

    it("throws DataError for a request and options of other types", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      const cases: readonly [string, () => Promise<unknown>][] = [
        ["The request must be an object, found null.", () => ltiLaunch(JSON.parse("null"), ctx.options)],
        [
          "The URL of the request must be a string, found 5.",
          () => ltiLaunch({ ...post, url: JSON.parse("5") }, ctx.options),
        ],
        [
          'The URL of the request must be an absolute URL, found "/lti/launch".',
          () => ltiLaunch({ ...post, url: "/lti/launch" }, ctx.options),
        ],
        [
          "The body of the request must be a string, found null.",
          () => ltiLaunch({ ...post, body: JSON.parse("null") }, ctx.options),
        ],
        [
          "The headers of the request must be an object, found an array.",
          () => ltiLaunch({ ...post, headers: JSON.parse("[]") }, ctx.options),
        ],
        [
          'The header "cookie" of the request must be a string, found 5.',
          () => ltiLaunch({ ...post, headers: JSON.parse('{"cookie":5}') }, ctx.options),
        ],
        [
          'The header names of the request must be in lower case, found "Cookie".',
          () => ltiLaunch({ ...post, headers: { Cookie: "a=b" } }, ctx.options),
        ],
        ["The options must be an object, found null.", () => ltiLaunch(post, JSON.parse("null"))],
        [
          "The option registration must be a function, found null.",
          () => ltiLaunch(post, { ...ctx.options, registration: JSON.parse("null") }),
        ],
        [
          "The option store is invalid: expected an object with the functions put, get and delete, found null.",
          () => ltiLaunch(post, { ...ctx.options, store: JSON.parse("null") }),
        ],
        [
          "The option store is invalid: expected an object with the functions put, get and delete, found an object.",
          () =>
            ltiLaunch(post, {
              ...ctx.options,
              store: { put: ctx.store.put, get: ctx.store.get, delete: JSON.parse("null") },
            }),
        ],
        [
          "The option jwks must be an object, found null.",
          () => ltiLaunch(post, { ...ctx.options, jwks: JSON.parse("null") }),
        ],
      ];
      for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
    });

    it("throws DataError when the store returns a login that is not one, or the lookup a registration that is not one", async () => {
      const ctx = setup();
      const { request: post, auth } = await cookieLogin(ctx);
      const record = ctx.store.records.get(auth.state);
      const store = {
        put: ctx.store.put.bind(ctx.store),
        delete: ctx.store.delete.bind(ctx.store),
        get: async () => JSON.parse(JSON.stringify({ ...record, nonce: 5 })),
      };
      await expect(ltiLaunch(post, { ...ctx.options, store })).rejects.toThrow(
        new DataError("The login record is invalid at nonce: expected a string, found 5."),
      );
      const http = { ...ctx.registration, jwksUrl: "http://lms.example.edu/jwks" };
      await expect(ltiLaunch(post, { ...ctx.options, registration: async () => http })).rejects.toThrow(
        new DataError(
          'The registration is invalid at jwksUrl: expected an absolute https URL, found "http://lms.example.edu/jwks".',
        ),
      );
      const other = { ...ctx.registration, issuer: "https://other.example" };
      await expect(ltiLaunch(post, { ...ctx.options, registration: async () => other })).rejects.toMatchObject({
        reason: "platform-unknown",
      });
    });
  });

  describe("on the client-side storage path", () => {
    it("answers the post of the platform with a page that fetches the values from the platform's storage", async () => {
      const ctx = setup();
      const { auth, config, response } = await storageLogin(ctx);
      const page = await ltiLaunch(auth.post(), ctx.options);
      expect("status" in page).toBe(true);
      const view = readPage(page as HttpResponse);
      expect(view.config).toEqual({
        frame: "lti-storage",
        state: auth.state,
        nonce: config.nonce,
        origin: ISSUER,
        stateField: "stored_state",
        nonceField: "stored_nonce",
        timeoutMs: 10_000,
      });
      expect(Object.fromEntries(view.inputs)).toEqual({
        id_token: auth.idToken,
        state: auth.state,
        stored_state: "",
        stored_nonce: "",
      });
      expect(view.action).toBe(REDIRECT_URI);
      expect(ctx.store.records.has(auth.state)).toBe(true);
      expect(response.headers["set-cookie"]).toBeUndefined();
    });

    it("sends the verification page with a CSP that names its script and nothing else", async () => {
      const ctx = setup();
      const { auth } = await storageLogin(ctx);
      const page = (await ltiLaunch(auth.post(), ctx.options)) as HttpResponse;
      const view = readPage(page);
      expect(page).toMatchObject({ status: 200 });
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(page.headers["cache-control"]).toBe("no-store");
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["content-security-policy"]).toBe(
        `default-src 'none'; script-src 'sha256-${view.hash}'; base-uri 'none'; form-action 'self'`,
      );
      expect(view.scripts).toBe(1);
    });

    it("writes the token and the state into the page as text, whatever they hold", async () => {
      const ctx = setup();
      const { auth } = await storageLogin(ctx);
      const hostile = `"><script>alert('x')</script>&amp;`;
      const post = formPost({ id_token: hostile, state: auth.state });
      const view = readPage((await ltiLaunch(post, ctx.options)) as HttpResponse);
      expect(view.scripts).toBe(1);
      expect(view.inputs.get("id_token")).toBe(hostile);
    });

    it("completes the launch when the platform's storage returns the values of the login", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const launch = launchOf(await ltiLaunch(verificationPost(auth, storage), ctx.options));
      expect(launch).toMatchObject({
        messageType: "LtiResourceLinkRequest",
        subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a",
      });
      expect(ctx.store.records.size).toBe(0);
    });

    it("completes the launch without any cookie", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const post = verificationPost(auth, storage);
      expect(post.headers.cookie).toBeUndefined();
      expect(launchOf(await ltiLaunch(post, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    });

    it("completes a login once", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      launchOf(await ltiLaunch(verificationPost(auth, storage), ctx.options));
      await expect(ltiLaunch(verificationPost(auth, storage), ctx.options)).rejects.toMatchObject({
        reason: "state-unknown",
      });
    });

    it("refuses a post of the verification that does not come from the tool's own origin", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const foreign: readonly Record<string, string>[] = [
        {},
        { origin: ISSUER },
        { origin: "https://evil.example" },
        { origin: "null" },
        { origin: `${TOOL_ORIGIN}/` },
      ];
      for (const headers of foreign) {
        await expect(
          ltiLaunch(verificationPost(auth, storage, headers), ctx.options),
          JSON.stringify(headers),
        ).rejects.toMatchObject({
          name: "LtiError",
          reason: "origin-mismatch",
        });
      }
    });

    it("refuses values from the platform's storage that are not the login's", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const fields = { id_token: auth.idToken, state: auth.state };
      const origin = { origin: TOOL_ORIGIN };
      const posts: readonly [string, HttpRequest][] = [
        ["another state", formPost({ ...fields, stored_state: "other", stored_nonce: auth.nonce }, origin)],
        ["another nonce", formPost({ ...fields, stored_state: auth.state, stored_nonce: "other" }, origin)],
        ["no nonce", formPost({ ...fields, stored_state: auth.state }, origin)],
        ["no state", formPost({ ...fields, stored_nonce: auth.nonce }, origin)],
        ["empty values", formPost({ ...fields, stored_state: "", stored_nonce: "" }, origin)],
        [
          "the state for the nonce",
          formPost({ ...fields, stored_state: auth.state, stored_nonce: auth.state }, origin),
        ],
      ];
      for (const [name, post] of posts) {
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({
          name: "LtiError",
          reason: "storage-mismatch",
        });
      }
      expect(launchOf(await ltiLaunch(verificationPost(auth, storage), ctx.options)).messageType).toBe(
        "LtiResourceLinkRequest",
      );
    });

    it("checks the token on this path as on the cookie path", async () => {
      const ctx = setup();
      const forged = await storageLogin(ctx, { signer: attackerKey });
      await expect(ltiLaunch(verificationPost(forged.auth, forged.storage), ctx.options)).rejects.toMatchObject({
        reason: "signature-invalid",
      });
      const wrongNonce = await storageLogin(ctx, { claims: { nonce: "another" } });
      await expect(ltiLaunch(verificationPost(wrongNonce.auth, wrongNonce.storage), ctx.options)).rejects.toMatchObject(
        {
          reason: "nonce-mismatch",
        },
      );
    });

    it("does not let the values of the storage stand in for the cookie of a login that used a cookie", async () => {
      const ctx = setup();
      const { auth } = await cookieLogin(ctx);
      const post = formPost(
        { id_token: auth.idToken, state: auth.state, stored_state: auth.state, stored_nonce: auth.nonce },
        { origin: TOOL_ORIGIN },
      );
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "state-cookie" });
    });
  });
});

describe("ltiLogin", () => {
  it("answers the initiation with the authentication request and a state cookie", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.location ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(AUTHENTICATION_URL);
    expect([...location.searchParams.keys()]).toEqual([
      "scope",
      "response_type",
      "client_id",
      "redirect_uri",
      "login_hint",
      "state",
      "response_mode",
      "nonce",
      "prompt",
      "lti_message_hint",
    ]);
    const state = location.searchParams.get("state") ?? "";
    const nonce = location.searchParams.get("nonce") ?? "";
    expect(response.headers["set-cookie"]).toBe(
      `__Host-lti_state_${state}=${state}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=None`,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("");
    expect(state).not.toBe(nonce);
    expect(ctx.store.records.get(state)).toEqual({
      nonce,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      storageTarget: undefined,
      expiresAt: NOW + 600_000,
    });
  });

  it("returns lti_message_hint unaltered and accepts the initiation as a POST", async () => {
    const ctx = setup();
    const hint = "a b&c=d/é?";
    for (const method of ["GET", "POST"] as const) {
      const response = await ltiLogin(ctx.platform.initiation({ method, messageHint: hint }), ctx.options);
      expect(new URL(response.headers.location ?? "").searchParams.get("lti_message_hint"), method).toBe(hint);
    }
  });

  it("leaves out lti_message_hint when the platform sends none", async () => {
    const ctx = setup();
    const initiation = request({
      url: `${LOGIN_URL}?iss=${encodeURIComponent(ISSUER)}&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`,
    });
    const response = await ltiLogin(initiation, ctx.options);
    expect(new URL(response.headers.location ?? "").searchParams.has("lti_message_hint")).toBe(false);
  });

  it("looks up the registration by the issuer, and the client when the platform names one", async () => {
    const ctx = setup();
    await ltiLogin(ctx.platform.initiation(), ctx.options);
    await ltiLogin(ctx.platform.initiation({ clientId: true }), ctx.options);
    expect(ctx.lookups).toEqual([`${ISSUER} undefined`, `${ISSUER} ${CLIENT_ID}`]);
  });

  it("gives each login its own state and nonce", async () => {
    const ctx = setup();
    const locations = await Promise.all(
      Array.from({ length: 20 }, async () => (await ltiLogin(ctx.platform.initiation(), ctx.options)).headers.location),
    );
    const params = locations.map((location) => new URL(location ?? "").searchParams);
    expect(new Set(params.map((p) => p.get("state"))).size).toBe(20);
    expect(new Set(params.map((p) => p.get("nonce"))).size).toBe(20);
    expect(ctx.store.records.size).toBe(20);
  });

  it("keeps a query that the authentication endpoint already has", async () => {
    const ctx = setup({ authenticationUrl: `${AUTHENTICATION_URL}?tenant=7` });
    const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
    const location = new URL(response.headers.location ?? "");
    expect(location.searchParams.get("tenant")).toBe("7");
    expect(location.searchParams.get("scope")).toBe("openid");
  });

  it("answers an initiation with lti_storage_target with a page that stores state and nonce in the platform", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation({ storageTarget: "_parent" }), ctx.options);
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    const view = readPage(response);
    const request = new URL(view.config.authenticationRequest ?? "");
    expect(view.config).toEqual({
      frame: "_parent",
      state: request.searchParams.get("state"),
      nonce: request.searchParams.get("nonce"),
      origin: ISSUER,
      authenticationRequest: request.href,
      timeoutMs: 10_000,
    });
    expect(`${request.origin}${request.pathname}`).toBe(AUTHENTICATION_URL);
    expect(ctx.store.records.get(view.config.state ?? "")).toEqual({
      nonce: view.config.nonce,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      storageTarget: "_parent",
      expiresAt: NOW + 600_000,
    });
  });

  it("sends the storage page with a CSP that names its script and nothing else", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation({ storageTarget: "frame" }), ctx.options);
    const view = readPage(response);
    expect(response.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${view.hash}'; base-uri 'none'; form-action 'self'`,
    );
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(view.scripts).toBe(1);
  });

  it("writes the name of the target frame into the page as text, whatever it holds", async () => {
    const ctx = setup();
    const hostile = `"><script>alert(1)</script>'&`;
    const response = await ltiLogin(ctx.platform.initiation({ storageTarget: hostile }), ctx.options);
    const view = readPage(response);
    expect(view.scripts).toBe(1);
    expect(view.config.frame).toBe(hostile);
  });

  it("throws LtiError when the tool has no registration for the platform", async () => {
    const ctx = setup();
    const initiation = request({
      url: `${LOGIN_URL}?iss=${encodeURIComponent("https://unknown.example")}&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`,
    });
    await expect(ltiLogin(initiation, ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "platform-unknown",
    });
    expect(ctx.store.records.size).toBe(0);
    const other = request({
      url: `${LOGIN_URL}?iss=${encodeURIComponent(ISSUER)}&client_id=other&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`,
    });
    await expect(ltiLogin(other, ctx.options)).rejects.toMatchObject({ reason: "platform-unknown" });
    const mismatch = { ...ctx.options, registration: async () => ({ ...ctx.registration, clientId: "another" }) };
    await expect(ltiLogin(ctx.platform.initiation({ clientId: true }), mismatch)).rejects.toMatchObject({
      reason: "platform-unknown",
    });
  });

  it("throws DataError for an initiation that lacks a parameter or repeats one", async () => {
    const ctx = setup();
    const query = (text: string): HttpRequest => request({ url: `${LOGIN_URL}?${text}` });
    const hint = `iss=${encodeURIComponent(ISSUER)}&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`;
    const cases: readonly [string, HttpRequest][] = [
      [
        'The login initiation must have the parameter "iss", found undefined.',
        query("login_hint=1&target_link_uri=https%3A%2F%2Ft.example"),
      ],
      [
        'The login initiation must have the parameter "login_hint", found undefined.',
        query(`iss=${encodeURIComponent(ISSUER)}&target_link_uri=https%3A%2F%2Ft.example`),
      ],
      [
        'The login initiation must have the parameter "target_link_uri", found undefined.',
        query(`iss=${encodeURIComponent(ISSUER)}&login_hint=1`),
      ],
      [
        'The login initiation must have the parameter "iss", found "".',
        query("iss=&login_hint=1&target_link_uri=https%3A%2F%2Ft.example"),
      ],
      [
        'The login initiation must have the parameter "lti_storage_target", found "".',
        query(`${hint}&lti_storage_target=`),
      ],
      ['The login initiation must have the parameter "client_id", found "".', query(`${hint}&client_id=`)],
      ['The query of the request has the parameter "login_hint" more than once.', query(`${hint}&login_hint=2`)],
      ['A login initiation must be a GET or a POST request, found "PUT".', { ...query(hint), method: "PUT" }],
      [
        'The content type of the request must be application/x-www-form-urlencoded, found "text/plain".',
        request({ method: "POST", url: LOGIN_URL, headers: { "content-type": "text/plain" }, body: hint }),
      ],
    ];
    for (const [message, initiation] of cases)
      await expect(ltiLogin(initiation, ctx.options), message).rejects.toThrow(new DataError(message));
  });

  it("throws DataError for a request and options of other types", async () => {
    const ctx = setup();
    const initiation = ctx.platform.initiation();
    const cases: readonly [string, () => Promise<unknown>][] = [
      ['The request must be an object, found "GET".', () => ltiLogin(JSON.parse('"GET"'), ctx.options)],
      [
        "The method of the request must be a string, found 5.",
        () => ltiLogin({ ...initiation, method: JSON.parse("5") }, ctx.options),
      ],
      ["The options must be an object, found null.", () => ltiLogin(initiation, JSON.parse("null"))],
      [
        'The option registration must be a function, found "r".',
        () => ltiLogin(initiation, { ...ctx.options, registration: JSON.parse('"r"') }),
      ],
      [
        "The option clock must be an object, found 5.",
        () => ltiLogin(initiation, { ...ctx.options, clock: JSON.parse("5") }),
      ],
      [
        "The option store is invalid: expected an object with the functions put, get and delete, found null.",
        () =>
          ltiLogin(initiation, {
            registration: ctx.options.registration,
            clock: ctx.clock,
            store: JSON.parse("null"),
          }),
      ],
    ];
    for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
  });

  it("throws DataError when the registration is not one", async () => {
    const ctx = setup();
    const { registration } = ctx;
    const key =
      "The registration is invalid at signingKey: expected a private RSASSA-PKCS1-v1_5 key with SHA-256 for signing";
    const bad: readonly [string, PlatformRegistration][] = [
      ["The registration is invalid: expected an object, found null.", JSON.parse("null")],
      [
        'The registration is invalid at issuer: expected an absolute https URL, found "http://lms.example.edu".',
        { ...registration, issuer: "http://lms.example.edu" },
      ],
      [
        'The registration is invalid at issuer: expected an issuer without a query or a fragment, found "https://lms.example.edu/?a=1".',
        { ...registration, issuer: `${ISSUER}/?a=1` },
      ],
      [
        "The registration is invalid at clientId: expected a length of at least 1, found 0.",
        { ...registration, clientId: "" },
      ],
      [
        "The registration is invalid at deploymentIds: expected a length of at least 1, found 0.",
        { ...registration, deploymentIds: [] },
      ],
      [
        "The registration is invalid at deploymentIds[0]: expected a string, found 5.",
        { ...registration, deploymentIds: [JSON.parse("5")] },
      ],
      [
        'The registration is invalid at authenticationUrl: expected an absolute https URL, found "/auth".',
        { ...registration, authenticationUrl: "/auth" },
      ],
      [
        "The registration is invalid at accessTokenUrl: expected a string, found 5.",
        { ...registration, accessTokenUrl: JSON.parse("5") },
      ],
      [
        'The registration is invalid at redirectUri: expected an absolute https URL, found "http://tool.example/l".',
        { ...registration, redirectUri: "http://tool.example/l" },
      ],
      [
        "The registration is invalid at keyId: expected a string, found null.",
        { ...registration, keyId: JSON.parse("null") },
      ],
      [`${key}, found CryptoKey.`, { ...registration, signingKey: toolKey.publicKey }],
      [`${key}, found "key".`, { ...registration, signingKey: JSON.parse('"key"') }],
    ];
    for (const [message, found] of bad) {
      const options = { ...ctx.options, registration: async () => found };
      await expect(ltiLogin(ctx.platform.initiation(), options), message).rejects.toThrow(new DataError(message));
    }
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const modules = { "@assesskit/player/lti": await import("../src/lti/index.js") };
    expect(await runGuideSamples(ltiGuide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("signs the response to any Deep Linking text so that its claims decode and its signature verifies with the key of the tool, and with no other", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    const launch = deepLinkingOf(await ltiLaunch(post, ctx.options));
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (title) => {
        const jwt = await deepLinkResponse(launch, [{ title }], ctx.options);
        const { header, payload } = readToken(jwt);
        expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "tool-1" });
        expect(payload["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toEqual([
          { type: "ltiResourceLink", title },
        ]);
        expect(await verifyToken(jwt, toolKey)).toBe(true);
        expect(await verifyToken(jwt, platformKey)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  it("makes tokens of 160 random bits in base64url that do not repeat", () => {
    const tokens = Array.from({ length: 500 }, () => randomToken());
    expect(new Set(tokens).size).toBe(500);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{27}$/u);
  });

  it("puts any frame name into the storage page as text that decodes to the name", async () => {
    const ctx = setup();
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 60, unit: "binary" }), async (name) => {
        const response = await ltiLogin(ctx.platform.initiation({ storageTarget: name }), ctx.options);
        const view = readPage(response);
        expect(view.config.frame).toBe(name);
        expect(view.scripts).toBe(1);
        expect(view.inputs.size).toBe(0);
      }),
      { numRuns: 60 },
    );
  });
});
