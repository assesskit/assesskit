// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.
import { createHash } from "node:crypto";
import type { ItemKey } from "@luthfanwakan/olah/delivery";
import { type LtiLink, readLtiLink } from "@luthfanwakan/olah/package";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessError, DataError, ServiceError } from "../src/index.js";
import {
  type AgsScore,
  agsLineItem,
  agsScores,
  createJwksCache,
  type HttpRequest,
  type HttpResponse,
  LTI_HINT_TTL_SECONDS,
  ltiAccessToken,
  ltiLaunch,
  ltiLogin,
  ltiPlatformAuthorize,
  ltiPlatformFrame,
  ltiPlatformLogin,
  type PlatformConfig,
  type PlatformRegistration,
  platformEndpoints,
  platformJwks,
  platformStorage,
  platformToken,
  readAgsScore,
  type ToolRegistration,
} from "../src/lti/index.js";
import { MemoryStore } from "./lti-fake-platform.js";
import {
  acceptIdToken,
  agsClaim,
  authenticationParameters,
  authenticationRequest,
  clientAssertion,
  type Delivered,
  type Initiation,
  type KeySet,
  readInitiation,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  TOOL_JWKS_URL,
  TOOL_LAUNCH_URL,
  TOOL_LOGIN_URL,
  TOOL_ORIGIN,
  TOOL_REDIRECT_URI,
  tokenRequest,
  toolRegistration,
} from "./lti-fake-tool.js";
import {
  createClock,
  generateKeyPair,
  NOW,
  readPage,
  readToken,
  request,
  type TestClock,
  unescapeHtml,
} from "./lti-fixture.js";

const SECONDS = NOW / 1000;
const ISSUER = "https://platform.example";
const PLATFORM_ORIGIN = "https://lti.platform.example";
const PLAYER_ORIGIN = "https://player.platform.example";
const ASSET_ORIGIN = "https://assets.platform.example";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/scope/";
const LINEITEM_READONLY = `${AGS}lineitem.readonly`;
const LINEITEM = `${AGS}lineitem`;
const SCORE = `${AGS}score`;
const RESULT_READONLY = `${AGS}result.readonly`;
const OTHER_CLIENT_ID = "tool-client-2";
const OTHER_ORIGIN = "https://other.example.org";
const OTHER_LAUNCH_URL = `${OTHER_ORIGIN}/launch`;
const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";

const platformKeys = await generateKeyPair("unused");
const hintKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const toolKeys = await generateKeyPair("tool-key-1");
const otherToolKeys = await generateKeyPair("tool-key-2");
const attackerKeys = await generateKeyPair("tool-key-1");

const config: PlatformConfig = {
  issuer: ISSUER,
  origin: PLATFORM_ORIGIN,
  playerOrigin: PLAYER_ORIGIN,
  assetOrigin: ASSET_ORIGIN,
  keys: { privateKey: platformKeys.privateKey, publicKey: platformKeys.publicKey },
  hintKey,
};
const endpoints = platformEndpoints(config);

const caller = { session: "session-1", principal: "candidate-7" };
const item: ItemKey = { ref: "q-draw", instance: 1 };
const link: LtiLink = {
  title: "Drawing tool",
  custom: new Map([["exam", "tryout-1"]]),
  extensions: [],
  secureLaunchUrl: TOOL_LAUNCH_URL,
};
const otherLink: LtiLink = { ...link, secureLaunchUrl: OTHER_LAUNCH_URL };
const SCORE_MAXIMUM = 10;

/** The platform with its tools, its one-time ledger and the scores it received. */
interface Setup {
  readonly clock: TestClock;
  readonly used: Map<string, number>;
  readonly scores: { session: string; item: ItemKey; score: AgsScore }[];
  readonly checked: string[];
  readonly toolFetches: string[];
  /** Makes the key set of the first tool answer 503 while set. */
  failToolKeys: boolean;
  readonly login: Parameters<typeof ltiPlatformLogin>[3];
  readonly authorize: Parameters<typeof ltiPlatformAuthorize>[1];
  readonly token: Parameters<typeof platformToken>[1];
  readonly scoring: Parameters<typeof agsScores>[1];
}

/** A platform with two tools: the first publishes its key set, the second gives its key. */
function setup(overrides: { tools?: Map<string, ToolRegistration> } = {}): Setup {
  const clock = createClock();
  const used = new Map<string, number>();
  const tools =
    overrides.tools ??
    new Map([
      [TOOL_CLIENT_ID, toolRegistration()],
      [
        OTHER_CLIENT_ID,
        toolRegistration({
          clientId: OTHER_CLIENT_ID,
          loginUrl: `${OTHER_ORIGIN}/login`,
          redirectUris: [OTHER_LAUNCH_URL],
          jwksUrl: undefined,
          keys: new Map([[otherToolKeys.kid, otherToolKeys.publicKey]]),
        }),
      ],
    ]);
  const state: Setup = {
    clock,
    used,
    scores: [],
    checked: [],
    toolFetches: [],
    failToolKeys: false,
    login: undefined as never,
    authorize: undefined as never,
    token: undefined as never,
    scoring: undefined as never,
  };
  const jwks = createJwksCache({
    fetch: async (url) => {
      state.toolFetches.push(url);
      if (state.failToolKeys) return new Response("down", { status: 503 });
      return url === TOOL_JWKS_URL ? Response.json({ keys: [toolKeys.publicJwk] }) : new Response("", { status: 404 });
    },
  });
  const client = async (id: string): Promise<ToolRegistration | undefined> => tools.get(id);
  const once = async (id: string, expiresAt: number): Promise<boolean> => {
    if (used.has(id)) return false;
    used.set(id, expiresAt);
    return true;
  };
  const base = { config, clock };
  return Object.assign(state, {
    login: {
      ...base,
      registration: async (candidate: LtiLink) =>
        [...tools.values()].find((tool) =>
          (candidate.secureLaunchUrl ?? candidate.launchUrl ?? "").startsWith(new URL(tool.loginUrl).origin),
        ),
      check: async (who: { session: string; principal: string }) => {
        state.checked.push(`${who.session}/${who.principal}`);
      },
      scoreMaximum: async () => SCORE_MAXIMUM,
    },
    authorize: { ...base, client, once },
    token: { ...base, client, once, jwks },
    scoring: {
      ...base,
      onScore: async (session: string, key: ItemKey, score: AgsScore) => {
        state.scores.push({ session, item: key, score });
      },
    },
  });
}

/** The key set of the platform, as a tool reads it. */
async function keySet(ctx: Setup): Promise<KeySet> {
  const response = await platformJwks(ctx.login);
  return JSON.parse(response.body);
}

/** Reads the page that posts the id_token: the form's action and fields, the script and the hash of it. */
function readPost(response: HttpResponse): Delivered & { scripts: number; hash: string; inputs: Map<string, string> } {
  const inputs = new Map<string, string>();
  for (const [, name = "", value = ""] of response.body.matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/gu,
  )) {
    inputs.set(name, unescapeHtml(value));
  }
  const script = /<script>([\s\S]*)<\/script>/u.exec(response.body)?.[1] ?? "";
  return {
    action: unescapeHtml(/<form id="form" method="post" action="([^"]*)">/u.exec(response.body)?.[1] ?? ""),
    idToken: inputs.get("id_token") ?? "",
    state: inputs.get("state") ?? "",
    scripts: response.body.split("<script").length - 1,
    hash: createHash("sha256").update(script).digest("base64"),
    inputs,
  };
}

/** The initiation of a launch, and the tool's authentication request for it. */
async function begin(
  ctx: Setup,
  options: { link?: LtiLink; session?: string; principal?: string; item?: ItemKey } = {},
): Promise<{ initiation: Initiation; parameters: URLSearchParams; url: string }> {
  const who = { session: options.session ?? caller.session, principal: options.principal ?? caller.principal };
  const url = await ltiPlatformLogin(who, options.item ?? item, options.link ?? link, ctx.login);
  const initiation = readInitiation(url, options.link === otherLink ? `${OTHER_ORIGIN}/login` : TOOL_LOGIN_URL);
  return { initiation, parameters: authenticationParameters(initiation), url };
}

/** The platform's answer to the tool's authentication request for a new launch. */
async function authorize(
  ctx: Setup,
  change: (parameters: URLSearchParams) => void = () => undefined,
  method: "GET" | "POST" = "GET",
  options: { link?: LtiLink } = {},
): Promise<HttpResponse> {
  const { parameters } = await begin(ctx, options);
  change(parameters);
  return ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters, method), ctx.authorize);
}

/** A whole launch: the claims of the id_token that the tool accepted, with what the tool received. */
async function launch(ctx: Setup): Promise<{ claims: Record<string, unknown>; page: HttpResponse; nonce: string }> {
  const { parameters } = await begin(ctx);
  const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
  const delivered = readPost(page);
  const nonce = parameters.get("nonce") ?? "";
  const claims = await acceptIdToken(delivered.idToken, await keySet(ctx), {
    issuer: ISSUER,
    nonce,
    clock: ctx.clock,
  });
  return { claims, page, nonce };
}

/** Gets an access token for the first tool, or the second with `other`. */
async function accessToken(ctx: Setup, scope: string, other = false): Promise<string> {
  const assertion = other
    ? await clientAssertion(otherToolKeys, endpoints.token, ctx.clock, { iss: OTHER_CLIENT_ID, sub: OTHER_CLIENT_ID })
    : await clientAssertion(toolKeys, endpoints.token, ctx.clock);
  const response = await platformToken(tokenRequest(endpoints.token, assertion, scope), ctx.token);
  expect(response.status, response.body).toBe(200);
  return JSON.parse(response.body).access_token;
}

/** A request to a service of the platform with a bearer token. */
function service(
  url: string,
  token: string | undefined,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): HttpRequest {
  return request({
    url,
    method: init.method ?? "GET",
    headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...init.headers },
    body: init.body ?? "",
  });
}

/** The line item URL of a launch, and the claims of it. */
async function lineItemOf(ctx: Setup): Promise<string> {
  return agsClaim((await launch(ctx)).claims).lineitem;
}

/** Reads a sealed value as an independent reader does: the header, the payload and whether its HMAC verifies. */
async function openSealed(
  token: string,
): Promise<{ header: Record<string, unknown>; claims: Record<string, unknown>; valid: boolean }> {
  const [header = "", payload = "", mac = ""] = token.split(".");
  const valid = await crypto.subtle.verify(
    "HMAC",
    hintKey,
    Buffer.from(mac, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const parse = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return { header: parse(header), claims: parse(payload), valid };
}

/** A body of a score as the spec's example 3.4.3.1 gives it. */
function scoreBody(change: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2017-04-16T18:54:36.736+00:00",
    scoreGiven: 83,
    scoreMaximum: 100,
    comment: "This is exceptional work.",
    activityProgress: "Completed",
    gradingProgress: "FullyGraded",
    userId: caller.principal,
    ...change,
  });
}

/** Posts a score for the line item of a launch with a token that has the scope. */
async function postScore(
  ctx: Setup,
  body: string,
  change: { type?: string; token?: string | null; url?: (url: string) => string; method?: string } = {},
): Promise<HttpResponse> {
  const url = await lineItemOf(ctx);
  const token = change.token === undefined ? await accessToken(ctx, SCORE) : (change.token ?? undefined);
  return agsScores(
    service(change.url ? change.url(url) : `${url}/scores`, token, {
      method: change.method ?? "POST",
      headers: { "content-type": change.type ?? SCORE_TYPE },
      body,
    }),
    ctx.scoring,
  );
}

/** Converts an answer of a handler to a `Response`, as a host would. */
function toResponse({ status, headers, body }: HttpResponse): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

afterEach(() => vi.useRealTimers());

describe("readAgsScore", () => {
  const complete = {
    timestamp: "2017-04-16T18:54:36.736+00:00",
    scoreGiven: 83,
    scoreMaximum: 100,
    activityProgress: "Completed",
    gradingProgress: "FullyGraded",
    userId: "5323497",
  };

  it("[T120] reads the final score of LTI AGS 2.0 §3.4.3.1, ignoring the properties it does not use", () => {
    const body = { ...complete, comment: "This is exceptional work.", scoringUserId: "4567890" };
    expect(readAgsScore(JSON.parse(JSON.stringify(body)))).toEqual({
      userId: "5323497",
      scoreGiven: 83,
      scoreMaximum: 100,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: "2017-04-16T18:54:36.736+00:00",
      timestampMs: Date.UTC(2017, 3, 16, 18, 54, 36, 736),
    });
  });

  it("[T120] reads the score pending manual grading of §3.4.8.1 with no score", () => {
    const score = readAgsScore({
      timestamp: "2017-04-16T18:54:36.736+00:00",
      activityProgress: "Completed",
      gradingProgress: "PendingManual",
      userId: "5323497",
    });
    expect(score.gradingProgress).toBe("PendingManual");
    expect(score.scoreGiven).toBeUndefined();
    expect(score.scoreMaximum).toBeUndefined();
  });

  it("[T120] reads a null score as no score, which clears the previous one (§3.4.4)", () => {
    const score = readAgsScore({ ...complete, scoreGiven: null, scoreMaximum: null });
    expect(score.scoreGiven).toBeUndefined();
    expect(score.scoreMaximum).toBeUndefined();
  });

  it("[T120] accepts a scoreGiven higher than scoreMaximum and a scoreGiven of 0", () => {
    expect(readAgsScore({ ...complete, scoreGiven: 1.1, scoreMaximum: 1 }).scoreGiven).toBe(1.1);
    expect(readAgsScore({ ...complete, scoreGiven: 0 }).scoreGiven).toBe(0);
  });

  it("[T120] reads the timestamps of §3.4.9.1 and a time zone offset", () => {
    const utc = Date.UTC(2017, 3, 16, 18, 54, 36, 736);
    for (const text of [
      "2017-04-16T18:54:36.736+00:00",
      "2017-04-16T18:54:36.736Z",
      "2017-04-16T18:54:36.736+00",
      "2017-04-16T13:54:36.736-05:00",
      "2017-04-16T20:24:36.736+0130",
    ]) {
      expect(readAgsScore({ ...complete, timestamp: text }).timestampMs, text).toBe(utc);
    }
    expect(readAgsScore({ ...complete, timestamp: "2017-04-16T18:54:36Z" }).timestampMs).toBe(utc - 736);
    expect(readAgsScore({ ...complete, timestamp: "2017-04-16T18:54:36.7Z" }).timestampMs).toBe(utc - 36);
    expect(readAgsScore({ ...complete, timestamp: "2017-04-16T18:54:36.736999Z" }).timestampMs).toBe(utc);
  });

  it("[T120] orders the scores of a user by their timestamps in milliseconds, across time zones", () => {
    const earlier = readAgsScore({ ...complete, timestamp: "2017-04-16T18:54:36.736Z" });
    const later = readAgsScore({ ...complete, timestamp: "2017-04-16T13:54:36.737-05:00" });
    expect(later.timestampMs).toBeGreaterThan(earlier.timestampMs);
  });

  it("[T120] throws DataError for what is not a score", () => {
    const cases: readonly [string, unknown, string][] = [
      ["null", null, "A score must be an object, found null."],
      ["an array", [], "A score must be an object, found an array."],
      [
        "no userId",
        { ...complete, userId: undefined },
        "The userId of a score must be a non-empty string, found undefined.",
      ],
      ["an empty userId", { ...complete, userId: "" }, 'The userId of a score must be a non-empty string, found "".'],
      ["a number as userId", { ...complete, userId: 5 }, "The userId of a score must be a non-empty string, found 5."],
      [
        "no timestamp",
        { ...complete, timestamp: undefined },
        "The timestamp of a score must be ISO 8601 with a time zone, found undefined.",
      ],
      [
        "a timestamp without a zone",
        { ...complete, timestamp: "2017-04-16T18:54:36.736" },
        'The timestamp of a score must be ISO 8601 with a time zone, found "2017-04-16T18:54:36.736".',
      ],
      [
        "a date without a time",
        { ...complete, timestamp: "2017-04-16" },
        'The timestamp of a score must be ISO 8601 with a time zone, found "2017-04-16".',
      ],
      [
        "a day that does not exist",
        { ...complete, timestamp: "2017-02-30T10:00:00Z" },
        'The timestamp of a score must be ISO 8601 with a time zone, found "2017-02-30T10:00:00Z".',
      ],
      [
        "an hour of 24",
        { ...complete, timestamp: "2017-04-16T24:00:00Z" },
        'The timestamp of a score must be ISO 8601 with a time zone, found "2017-04-16T24:00:00Z".',
      ],
      [
        "an epoch number",
        { ...complete, timestamp: 1492368876 },
        "The timestamp of a score must be ISO 8601 with a time zone, found 1492368876.",
      ],
      [
        "an unknown activityProgress",
        { ...complete, activityProgress: "Done" },
        'The activityProgress of a score must be Initialized, Started, InProgress, Submitted, Completed, found "Done".',
      ],
      [
        "no gradingProgress",
        { ...complete, gradingProgress: undefined },
        "The gradingProgress of a score must be FullyGraded, Pending, PendingManual, Failed, NotReady, found undefined.",
      ],
      [
        "a negative scoreGiven",
        { ...complete, scoreGiven: -1 },
        "The scoreGiven of a score must be a number from 0, found -1.",
      ],
      [
        "a string scoreGiven",
        { ...complete, scoreGiven: "83" },
        'The scoreGiven of a score must be a number from 0, found "83".',
      ],
      [
        "a zero scoreMaximum",
        { ...complete, scoreMaximum: 0 },
        "The scoreMaximum of a score must be a number above 0, found 0.",
      ],
      [
        "a scoreGiven without a scoreMaximum",
        { ...complete, scoreMaximum: undefined },
        "A score with a scoreGiven must have a scoreMaximum.",
      ],
    ];
    for (const [name, body, message] of cases) {
      expect(() => readAgsScore(JSON.parse(JSON.stringify(body ?? null))), name).toThrow(new DataError(message));
    }
  });

  it("[T120] throws DataError for a timestamp that JSON cannot carry", () => {
    expect(() => readAgsScore({ ...complete, scoreGiven: Number.NaN })).toThrow(
      new DataError("The scoreGiven of a score must be a number from 0, found NaN."),
    );
    expect(() => readAgsScore({ ...complete, scoreGiven: Number.POSITIVE_INFINITY })).toThrow(DataError);
  });
});

describe("agsLineItem and agsScores", () => {
  it("[T120] answers the line item of the launch with the media type of §3.2.1", async () => {
    const ctx = setup();
    const { claims } = await launch(ctx);
    const url = agsClaim(claims).lineitem;
    const response = await agsLineItem(service(url, await accessToken(ctx, LINEITEM_READONLY)), ctx.token);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/vnd.ims.lis.v2.lineitem+json");
    expect(JSON.parse(response.body)).toEqual({
      id: url,
      label: "Drawing tool",
      scoreMaximum: SCORE_MAXIMUM,
      resourceLinkId: (claims[`${CLAIM}resource_link`] as { id: string }).id,
    });
  });

  it("[T120] puts the line item under the platform's origin and offers the scopes to read it and to score", async () => {
    const ctx = setup();
    const { claims } = await launch(ctx);
    const grade = agsClaim(claims);
    expect(grade.lineitem.startsWith(`${PLATFORM_ORIGIN}/ags/`)).toBe(true);
    expect(grade.scope).toEqual([LINEITEM_READONLY, SCORE]);
    expect(Object.keys(claims[`https://purl.imsglobal.org/spec/lti-ags/claim/endpoint`] ?? {})).toEqual([
      "scope",
      "lineitem",
    ]);
  });

  it("[T120] gives one line item for one item instance, and another for another", async () => {
    const ctx = setup();
    const first = await lineItemOf(ctx);
    const again = await lineItemOf(ctx);
    expect(again).toBe(first);
    const second = agsClaim((await launchFor(ctx, { ref: "q-draw", instance: 2 })).claims).lineitem;
    const third = agsClaim((await launchFor(ctx, undefined, "session-2")).claims).lineitem;
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("[T120] refuses a request to the line item without a usable token", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const none = await agsLineItem(service(url, undefined), ctx.token);
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toBe("Bearer");
    for (const token of ["not-a-token", `${await accessToken(ctx, SCORE)}x`, "a.b", "."]) {
      const response = await agsLineItem(service(url, token), ctx.token);
      expect(response.status, token).toBe(401);
      expect(response.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
    }
    const odd = await agsLineItem(request({ url, headers: { authorization: "Basic abc" } }), ctx.token);
    expect(odd.status).toBe(401);
  });

  it("[T120] refuses an access token after an hour", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const token = await accessToken(ctx, LINEITEM_READONLY);
    ctx.clock.advance(3599);
    expect((await agsLineItem(service(url, token), ctx.token)).status).toBe(200);
    ctx.clock.advance(1);
    expect((await agsLineItem(service(url, token), ctx.token)).status).toBe(401);
  });

  it("[T120] needs the scope lineitem.readonly to read the line item, and score to post a score", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const scoreOnly = await agsLineItem(service(url, await accessToken(ctx, SCORE)), ctx.token);
    expect(scoreOnly.status).toBe(403);
    expect(scoreOnly.headers["www-authenticate"]).toBe(
      `Bearer error="insufficient_scope", scope="${LINEITEM_READONLY} ${LINEITEM}"`,
    );
    const readOnly = await agsScores(
      service(`${url}/scores`, await accessToken(ctx, LINEITEM_READONLY), {
        method: "POST",
        headers: { "content-type": SCORE_TYPE },
        body: scoreBody(),
      }),
      ctx.scoring,
    );
    expect(readOnly.status).toBe(403);
    expect(ctx.scores).toEqual([]);
    const both = await accessToken(ctx, `${LINEITEM_READONLY} ${SCORE}`);
    expect((await agsLineItem(service(url, both), ctx.token)).status).toBe(200);
  });

  it("[T120] refuses the line item of another tool, even with a token of its own", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const response = await agsLineItem(service(url, await accessToken(ctx, LINEITEM_READONLY, true)), ctx.token);
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe("forbidden");
    const post = await postScoreWith(ctx, url, await accessToken(ctx, SCORE, true));
    expect(post.status).toBe(403);
    expect(ctx.scores).toEqual([]);
  });

  it("[T120] answers 404 for a path that names no line item of the platform", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const token = await accessToken(ctx, `${LINEITEM_READONLY} ${SCORE}`);
    const [head = "", id = ""] = url.split("/ags/");
    const forged = `${head}/ags/${corruptMac(id)}`;
    for (const bad of [
      forged,
      `${head}/ags/nothing`,
      `${head}/ags/`,
      `${head}/ags`,
      `${head}/other/${id}`,
      `${head}/ags/${id}/extra`,
      `${head}/ags/${id}/scores`,
    ]) {
      expect((await agsLineItem(service(bad, token), ctx.token)).status, bad).toBe(404);
    }
    expect((await postScoreWith(ctx, forged, token)).status).toBe(404);
    const direct = await agsScores(
      service(url, token, { method: "POST", headers: { "content-type": SCORE_TYPE }, body: scoreBody() }),
      ctx.scoring,
    );
    expect(direct.status).toBe(404);
  });

  it("[T120] refuses another spelling of a line item identifier or an access token that has the same bytes", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const token = await accessToken(ctx, `${LINEITEM_READONLY} ${SCORE}`);
    const [head = "", id = ""] = url.split("/ags/");
    expect(respell(token)).not.toBe(token);
    expect((await agsLineItem(service(url, token), ctx.token)).status).toBe(200);
    expect((await agsLineItem(service(`${head}/ags/${respell(id)}`, token), ctx.token)).status).toBe(404);
    expect((await agsLineItem(service(url, respell(token)), ctx.token)).status).toBe(401);
    expect((await postScoreWith(ctx, `${head}/ags/${respell(id)}`, token)).status).toBe(404);
    expect(ctx.scores).toEqual([]);
  });

  it("[T120] answers 405 for a method that the service does not offer", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const token = await accessToken(ctx, `${LINEITEM_READONLY} ${SCORE}`);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await agsLineItem(service(url, token, { method }), ctx.token);
      expect(response.status, method).toBe(405);
      expect(response.headers.allow).toBe("GET");
    }
    const get = await agsScores(service(`${url}/scores`, token), ctx.scoring);
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
  });

  it("[T120] receives a final score and hands it to onScore with the session and the item", async () => {
    const ctx = setup();
    const response = await postScore(ctx, scoreBody());
    expect(response.status).toBe(204);
    expect(response.body).toBe("");
    expect(ctx.scores).toEqual([
      {
        session: "session-1",
        item,
        score: {
          userId: caller.principal,
          scoreGiven: 83,
          scoreMaximum: 100,
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
          timestamp: "2017-04-16T18:54:36.736+00:00",
          timestampMs: Date.UTC(2017, 3, 16, 18, 54, 36, 736),
        },
      },
    ]);
  });

  it("[T120] receives a score pending manual grading, with no score", async () => {
    const ctx = setup();
    const body = scoreBody({ scoreGiven: undefined, scoreMaximum: undefined, gradingProgress: "PendingManual" });
    expect((await postScore(ctx, body)).status).toBe(204);
    expect(ctx.scores[0]?.score.gradingProgress).toBe("PendingManual");
    expect(ctx.scores[0]?.score.scoreGiven).toBeUndefined();
  });

  it("[T120] receives a scoreGiven higher than scoreMaximum", async () => {
    const ctx = setup();
    expect((await postScore(ctx, scoreBody({ scoreGiven: 1.1, scoreMaximum: 1 }))).status).toBe(204);
    expect(ctx.scores[0]?.score).toMatchObject({ scoreGiven: 1.1, scoreMaximum: 1 });
  });

  it("[T120] receives the media type with parameters and in any case", async () => {
    const ctx = setup();
    expect((await postScore(ctx, scoreBody(), { type: `${SCORE_TYPE.toUpperCase()}; charset=utf-8` })).status).toBe(
      204,
    );
  });

  it("[T120] refuses a score for a user other than the sub of the launch", async () => {
    const ctx = setup();
    const response = await postScore(ctx, scoreBody({ userId: "someone-else" }));
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: "forbidden",
      error_description: "The score is not for the user of the launch.",
    });
    expect(ctx.scores).toEqual([]);
  });

  it("[T120] refuses a score request with another media type", async () => {
    const ctx = setup();
    for (const type of ["application/json", "text/plain", "application/vnd.ims.lis.v2.lineitem+json"]) {
      const response = await postScore(ctx, scoreBody(), { type });
      expect(response.status, type).toBe(415);
      expect(response.headers.accept).toBe(SCORE_TYPE);
    }
    const none = await agsScores(
      service(`${await lineItemOf(ctx)}/scores`, await accessToken(ctx, SCORE), { method: "POST", body: scoreBody() }),
      ctx.scoring,
    );
    expect(none.status).toBe(415);
    expect(ctx.scores).toEqual([]);
  });

  it("[T120] refuses a body that is not a score with 400 and hands nothing on", async () => {
    const ctx = setup();
    const bad: readonly [string, string][] = [
      ["not JSON", "<score/>"],
      ["a JSON array", "[]"],
      ["a negative scoreGiven", scoreBody({ scoreGiven: -1 })],
      ["a scoreGiven without a scoreMaximum", scoreBody({ scoreMaximum: undefined })],
      ["a zero scoreMaximum", scoreBody({ scoreMaximum: 0 })],
      ["no timestamp", scoreBody({ timestamp: undefined })],
      ["a timestamp without a zone", scoreBody({ timestamp: "2017-04-16T18:54:36.736" })],
      ["no activityProgress", scoreBody({ activityProgress: undefined })],
      ["an unknown gradingProgress", scoreBody({ gradingProgress: "Done" })],
      ["no userId", scoreBody({ userId: undefined })],
    ];
    for (const [name, body] of bad) {
      const response = await postScore(ctx, body);
      expect(response.status, name).toBe(400);
      expect(JSON.parse(response.body).error).toBe("bad_request");
    }
    expect(ctx.scores).toEqual([]);
  });

  it("[T120] lets the failure of onScore reach the host", async () => {
    const ctx = setup();
    const failing = {
      ...ctx.scoring,
      onScore: async () => {
        throw new Error("The store is down.");
      },
    };
    const url = await lineItemOf(ctx);
    const token = await accessToken(ctx, SCORE);
    await expect(postScoreWith(ctx, url, token, failing)).rejects.toThrow("The store is down.");
  });

  it("[T120] refuses a request for another origin than the platform's", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const token = await accessToken(ctx, `${LINEITEM_READONLY} ${SCORE}`);
    for (const origin of [PLAYER_ORIGIN, ASSET_ORIGIN, "https://evil.example"]) {
      const moved = url.replace(PLATFORM_ORIGIN, origin);
      await expect(agsLineItem(service(moved, token), ctx.token), origin).rejects.toMatchObject({
        name: "AccessError",
        reason: "wrong-origin",
      });
      await expect(postScoreWith(ctx, moved, token), origin).rejects.toMatchObject({ reason: "wrong-origin" });
    }
  });

  it("throws DataError for requests and options of other types", async () => {
    const ctx = setup();
    const url = await lineItemOf(ctx);
    const get = service(url, undefined);
    const cases: readonly [string, () => Promise<unknown>][] = [
      ["The request must be an object, found null.", () => agsLineItem(JSON.parse("null"), ctx.token)],
      ["The options must be an object, found null.", () => agsLineItem(get, JSON.parse("null"))],
      [
        "The platform configuration must be an object, found null.",
        () => agsLineItem(get, { ...ctx.token, config: JSON.parse("null") }),
      ],
      [
        "The option clock must be an object, found 5.",
        () => agsLineItem(get, { ...ctx.token, clock: JSON.parse("5") }),
      ],
      ["The request must be an object, found an array.", () => agsScores(JSON.parse("[]"), ctx.scoring)],
      [
        "The option onScore must be a function, found null.",
        () => agsScores(get, { ...ctx.scoring, onScore: JSON.parse("null") }),
      ],
    ];
    for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
  });
});

/** Posts a score to a line item URL with a token. */
function postScoreWith(
  ctx: Setup,
  lineItem: string,
  token: string,
  options: Parameters<typeof agsScores>[1] = ctx.scoring,
): Promise<HttpResponse> {
  return agsScores(
    service(`${lineItem}/scores`, token, {
      method: "POST",
      headers: { "content-type": SCORE_TYPE },
      body: scoreBody(),
    }),
    options,
  );
}

/** A launch for another item instance or session. */
async function launchFor(
  ctx: Setup,
  key: ItemKey = item,
  session = caller.session,
): Promise<{ claims: Record<string, unknown> }> {
  const { parameters } = await begin(ctx, { item: key, session });
  const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
  const claims = await acceptIdToken(readPost(page).idToken, await keySet(ctx), {
    issuer: ISSUER,
    nonce: parameters.get("nonce") ?? "",
    clock: ctx.clock,
  });
  return { claims };
}

describe("ltiPlatformAuthorize", () => {
  it("[T120] answers the authentication request with the page that posts the id_token to the redirect URI", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
    const post = readPost(page);
    expect(page.status).toBe(200);
    expect(post.action).toBe(TOOL_REDIRECT_URI);
    expect(post.state).toBe("state-1");
    expect([...post.inputs.keys()]).toEqual(["id_token", "state"]);
    expect(post.scripts).toBe(1);
  });

  it("[T120] sends the page under a policy that allows its script by hash, forms to the tool and framing by the player", async () => {
    const ctx = setup();
    const page = await authorize(ctx);
    const post = readPost(page);
    expect(page.headers).toEqual({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src 'sha256-${post.hash}'; base-uri 'none'; form-action ${TOOL_ORIGIN}; frame-ancestors ${PLAYER_ORIGIN}`,
    });
  });

  it("[T120] writes every value of the page as text, whatever the tool sends", async () => {
    const ctx = setup({
      tools: new Map([[TOOL_CLIENT_ID, toolRegistration({ redirectUris: [`${TOOL_REDIRECT_URI}?a=1&b="2"`] })]]),
    });
    const hostile = `"><script>alert('x')</script>&amp;`;
    const { parameters } = await begin(ctx);
    parameters.set("state", hostile);
    parameters.set("redirect_uri", `${TOOL_REDIRECT_URI}?a=1&b="2"`);
    const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
    const post = readPost(page);
    expect(post.scripts).toBe(1);
    expect(post.state).toBe(hostile);
    expect(post.action).toBe(`${TOOL_REDIRECT_URI}?a=1&b="2"`);
    expect(page.body).not.toContain("<script>alert");
  });

  it("[T120] issues the id_token with the claims of Security Framework §5.1.2 and LTI 1.3 Core §5", async () => {
    const ctx = setup();
    const { claims } = await launch(ctx);
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: TOOL_CLIENT_ID,
      sub: "candidate-7",
      iat: SECONDS,
      exp: SECONDS + 300,
      nonce: "nonce-1",
      [`${CLAIM}message_type`]: "LtiResourceLinkRequest",
      [`${CLAIM}version`]: "1.3.0",
      [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
      [`${CLAIM}target_link_uri`]: TOOL_LAUNCH_URL,
      [`${CLAIM}roles`]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      [`${CLAIM}custom`]: { exam: "tryout-1" },
      [`${CLAIM}resource_link`]: { title: "Drawing tool" },
    });
  });

  it("[T120] names the resource link by a stable opaque identifier of at most 255 characters", async () => {
    const ctx = setup();
    const first = (await launch(ctx)).claims[`${CLAIM}resource_link`] as { id: string };
    const again = (await launch(ctx)).claims[`${CLAIM}resource_link`] as { id: string };
    const other = (await launchFor(ctx, { ref: "q-draw", instance: 2 })).claims[`${CLAIM}resource_link`] as {
      id: string;
    };
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(first.id.length).toBeLessThanOrEqual(255);
    expect(first.id).not.toContain("session-1");
  });

  it("[T120] signs the id_token with the key that the key set publishes", async () => {
    const ctx = setup();
    const { page } = await launch(ctx);
    const header = readToken(readPost(page).idToken).header;
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: await thumbprint(await publicJwk()) });
  });

  it("[T120] works with third-party cookies blocked: nothing but the hint binds the request", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const authentication = authenticationRequest(endpoints.authorization, parameters, "POST");
    expect(authentication.headers.cookie).toBeUndefined();
    const page = await ltiPlatformAuthorize(authentication, ctx.authorize);
    expect(readPost(page).idToken).toBeTruthy();
  });

  it("[T120] accepts the authentication request as a form POST as well as a GET", async () => {
    const ctx = setup();
    const page = await authorize(ctx, () => undefined, "POST");
    expect(readPost(page).action).toBe(TOOL_REDIRECT_URI);
  });

  it("[T120] checks the caller whose cookie arrived, and does not need one", async () => {
    const ctx = setup();
    const same = await begin(ctx);
    const request1 = authenticationRequest(endpoints.authorization, same.parameters);
    const page = await ltiPlatformAuthorize(request1, { ...ctx.authorize, caller: { ...caller } });
    expect(readPost(page).idToken).toBeTruthy();
    for (const other of [
      { session: "session-2", principal: caller.principal },
      { session: caller.session, principal: "candidate-8" },
    ]) {
      const { parameters } = await begin(ctx);
      await expect(
        ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), {
          ...ctx.authorize,
          caller: other,
        }),
      ).rejects.toMatchObject({ name: "AccessError", reason: "caller-mismatch" });
    }
  });

  it("[T120] refuses a request that is not the authentication request of the protocol", async () => {
    const ctx = setup();
    const cases: readonly [string, (parameters: URLSearchParams) => void, string][] = [
      ["another scope", (p) => p.set("scope", "openid profile"), "scope-invalid"],
      ["no scope", (p) => p.delete("scope"), "scope-invalid"],
      ["another response type", (p) => p.set("response_type", "code"), "response-type-invalid"],
      ["no response type", (p) => p.delete("response_type"), "response-type-invalid"],
      ["the query response mode", (p) => p.set("response_mode", "query"), "response-mode-invalid"],
      ["no response mode", (p) => p.delete("response_mode"), "response-mode-invalid"],
      ["a prompt of login", (p) => p.set("prompt", "login"), "prompt-invalid"],
      ["no prompt", (p) => p.delete("prompt"), "prompt-invalid"],
      ["no client_id", (p) => p.delete("client_id"), "client-unknown"],
      ["an unknown client", (p) => p.set("client_id", "unknown"), "client-unknown"],
      ["no redirect_uri", (p) => p.delete("redirect_uri"), "redirect-uri-mismatch"],
      ["another redirect_uri", (p) => p.set("redirect_uri", "https://evil.example/launch"), "redirect-uri-mismatch"],
      [
        "a redirect_uri with a path added",
        (p) => p.set("redirect_uri", `${TOOL_REDIRECT_URI}/x`),
        "redirect-uri-mismatch",
      ],
      [
        "a redirect_uri in other case",
        (p) => p.set("redirect_uri", TOOL_REDIRECT_URI.toUpperCase()),
        "redirect-uri-mismatch",
      ],
      ["no nonce", (p) => p.delete("nonce"), "nonce-missing"],
      ["an empty nonce", (p) => p.set("nonce", ""), "nonce-missing"],
      ["no state", (p) => p.delete("state"), "state-missing"],
    ];
    for (const [name, change, reason] of cases) {
      await expect(authorize(ctx, change), name).rejects.toMatchObject({ name: "LtiError", reason });
    }
  });

  it("[T120] refuses a request without a hint that this platform issued for this launch", async () => {
    const ctx = setup();
    const refused: readonly [string, (parameters: URLSearchParams) => Promise<void> | void, string][] = [
      ["no hint", (p) => p.delete("lti_message_hint"), "hint-missing"],
      ["an empty hint", (p) => p.set("lti_message_hint", ""), "hint-missing"],
      ["a hint that is not a token", (p) => p.set("lti_message_hint", "opaque"), "hint-invalid"],
      [
        "a hint with a changed claim",
        (p) => p.set("lti_message_hint", tamper(p.get("lti_message_hint") ?? "")),
        "hint-invalid",
      ],
      [
        "a hint with a changed MAC",
        (p) => p.set("lti_message_hint", corruptMac(p.get("lti_message_hint") ?? "")),
        "hint-invalid",
      ],
      [
        "a hint whose header says alg none",
        (p) => p.set("lti_message_hint", withHeader(p.get("lti_message_hint") ?? "", { alg: "none", typ: "hint" })),
        "hint-invalid",
      ],
      [
        "a hint whose header says RS256",
        (p) => p.set("lti_message_hint", withHeader(p.get("lti_message_hint") ?? "", { alg: "RS256", typ: "hint" })),
        "hint-invalid",
      ],
      [
        "a hint whose header says another use",
        (p) => p.set("lti_message_hint", withHeader(p.get("lti_message_hint") ?? "", { alg: "HS256", typ: "login" })),
        "hint-invalid",
      ],
      ["the login_hint as the hint", (p) => p.set("lti_message_hint", p.get("login_hint") ?? ""), "hint-invalid"],
      ["a hint of another platform", async (p) => p.set("lti_message_hint", await foreignHint()), "hint-invalid"],
      ["no login_hint", (p) => p.delete("login_hint"), "principal-mismatch"],
      ["a login_hint that is not a token", (p) => p.set("login_hint", "candidate-7"), "principal-mismatch"],
      [
        "the message hint as the login_hint",
        (p) => p.set("login_hint", p.get("lti_message_hint") ?? ""),
        "principal-mismatch",
      ],
      [
        "a login_hint with a changed MAC",
        (p) => p.set("login_hint", corruptMac(p.get("login_hint") ?? "")),
        "principal-mismatch",
      ],
    ];
    for (const [name, change, reason] of refused) {
      const { parameters } = await begin(ctx);
      await change(parameters);
      await expect(
        ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize),
        name,
      ).rejects.toMatchObject({ name: "AccessError", reason });
    }
  });

  it("[T120] refuses another spelling of a hint that has the same bytes", async () => {
    const ctx = setup();
    const message = await begin(ctx);
    message.parameters.set("lti_message_hint", respell(message.parameters.get("lti_message_hint") ?? ""));
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, message.parameters), ctx.authorize),
    ).rejects.toMatchObject({ name: "AccessError", reason: "hint-invalid" });
    const login = await begin(ctx);
    login.parameters.set("login_hint", respell(login.parameters.get("login_hint") ?? ""));
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, login.parameters), ctx.authorize),
    ).rejects.toMatchObject({ name: "AccessError", reason: "principal-mismatch" });
    expect(ctx.used.size).toBe(0);
  });

  it("[T120] refuses the login_hint of another candidate", async () => {
    const ctx = setup();
    const mine = await begin(ctx);
    const theirs = await begin(ctx, { principal: "candidate-8", session: "session-9" });
    mine.parameters.set("login_hint", theirs.parameters.get("login_hint") ?? "");
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, mine.parameters), ctx.authorize),
    ).rejects.toMatchObject({ name: "AccessError", reason: "principal-mismatch" });
  });

  it("[T120] refuses a hint that was issued for another tool", async () => {
    const ctx = setup();
    const other = await begin(ctx, { link: otherLink });
    const parameters = authenticationParameters({
      ...readInitiation(other.url, `${OTHER_ORIGIN}/login`),
      clientId: TOOL_CLIENT_ID,
    });
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize),
    ).rejects.toMatchObject({ name: "AccessError", reason: "client-mismatch" });
  });

  it("[T120] expires the hint after five minutes", async () => {
    const ctx = setup();
    expect(LTI_HINT_TTL_SECONDS).toBe(300);
    const { parameters } = await begin(ctx);
    ctx.clock.advance(299);
    const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
    expect(readPost(page).idToken).toBeTruthy();
    const late = await begin(ctx);
    ctx.clock.advance(300);
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, late.parameters), ctx.authorize),
    ).rejects.toMatchObject({ name: "AccessError", reason: "hint-expired" });
  });

  it("[T120] uses a hint once", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const authentication = authenticationRequest(endpoints.authorization, parameters);
    await ltiPlatformAuthorize(authentication, ctx.authorize);
    await expect(ltiPlatformAuthorize(authentication, ctx.authorize)).rejects.toMatchObject({
      name: "AccessError",
      reason: "hint-used",
    });
    const record = [...ctx.used];
    expect(record).toHaveLength(1);
    expect(record[0]?.[0]).toMatch(/^hint:/u);
    expect(record[0]?.[1]).toBe((SECONDS + 300) * 1000);
  });

  it("[T120] lets only one of two requests with one hint succeed", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const authentication = authenticationRequest(endpoints.authorization, parameters);
    const results = await Promise.allSettled([
      ltiPlatformAuthorize(authentication, ctx.authorize),
      ltiPlatformAuthorize(authentication, ctx.authorize),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("[T120] does not use the hint when another check fails first", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    parameters.set("nonce", "");
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize),
    ).rejects.toMatchObject({ reason: "nonce-missing" });
    expect(ctx.used.size).toBe(0);
    parameters.set("nonce", "nonce-2");
    await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
    expect(ctx.used.size).toBe(1);
  });

  it("[T120] refuses a request for the origin of the player, the assets or any origin but its own", async () => {
    const ctx = setup();
    for (const origin of [PLAYER_ORIGIN, ASSET_ORIGIN, "https://evil.example"]) {
      const { parameters } = await begin(ctx);
      await expect(
        ltiPlatformAuthorize(authenticationRequest(`${origin}/authorize`, parameters), ctx.authorize),
        origin,
      ).rejects.toMatchObject({ name: "AccessError", reason: "wrong-origin" });
    }
  });

  it("throws DataError for a request that is not a GET or a form POST, or repeats a parameter", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    const cases: readonly [string, HttpRequest][] = [
      ['An authentication request must be a GET or a POST request, found "PUT".', { ...get, method: "PUT" }],
      [
        'The content type of the request must be application/x-www-form-urlencoded, found "text/plain".',
        request({ method: "POST", url: endpoints.authorization, headers: { "content-type": "text/plain" } }),
      ],
      ['The query of the request has the parameter "state" more than once.', { ...get, url: `${get.url}&state=other` }],
    ];
    for (const [message, bad] of cases) {
      await expect(ltiPlatformAuthorize(bad, ctx.authorize), message).rejects.toThrow(new DataError(message));
    }
  });

  it("throws DataError for requests and options of other types", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    const cases: readonly [string, () => Promise<unknown>][] = [
      ["The request must be an object, found null.", () => ltiPlatformAuthorize(JSON.parse("null"), ctx.authorize)],
      ["The options must be an object, found null.", () => ltiPlatformAuthorize(get, JSON.parse("null"))],
      [
        "The option client must be a function, found null.",
        () => ltiPlatformAuthorize(get, { ...ctx.authorize, client: JSON.parse("null") }),
      ],
      [
        'The option once must be a function, found "x".',
        () => ltiPlatformAuthorize(get, { ...ctx.authorize, once: JSON.parse('"x"') }),
      ],
      [
        "The caller must be an object, found 5.",
        () => ltiPlatformAuthorize(get, { ...ctx.authorize, caller: JSON.parse("5") }),
      ],
    ];
    for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
  });

  it("throws DataError when the registration is not one, and LtiError when it is another tool's", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    const broken = { ...ctx.authorize, client: async () => JSON.parse('{"clientId":"tool-client-1"}') };
    await expect(ltiPlatformAuthorize(get, broken)).rejects.toThrow(DataError);
    const other = { ...ctx.authorize, client: async () => toolRegistration({ clientId: "someone-else" }) };
    await expect(ltiPlatformAuthorize(get, other)).rejects.toMatchObject({
      name: "LtiError",
      reason: "client-unknown",
    });
  });
});

/** Changes a claim of a sealed token and keeps the MAC, which then no longer fits. */
function tamper(token: string): string {
  const [header = "", payload = "", mac = ""] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const changed = Buffer.from(JSON.stringify({ ...claims, principal: "candidate-8" })).toString("base64url");
  return `${header}.${changed}.${mac}`;
}

/** Replaces the header of a sealed token and keeps the payload and the MAC, which then no longer fit. */
function withHeader(token: string, header: Record<string, unknown>): string {
  const [, payload = "", mac = ""] = token.split(".");
  return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${payload}.${mac}`;
}

/**
 * Spells the MAC of a sealed token another way without changing its bytes: it flips the lowest bit of the last character,
 * which base64url ignores because the 32 bytes of the MAC end in the middle of that character.
 */
function respell(token: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = token.at(-1) ?? "A";
  return `${token.slice(0, -1)}${alphabet[alphabet.indexOf(last) ^ 1]}`;
}

/**
 * Changes the first character of the MAC of a sealed token, which changes the bytes of the MAC. The last character would
 * not do: it holds two bits that base64url ignores, so that two spellings of one MAC are the same MAC.
 */
function corruptMac(token: string): string {
  const [header = "", payload = "", mac = ""] = token.split(".");
  return `${header}.${payload}.${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;
}

/** A hint that a platform with another hint key issued. */
async function foreignHint(): Promise<string> {
  const otherKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const ctx = setup();
  const url = await ltiPlatformLogin(caller, item, link, {
    ...ctx.login,
    config: { ...config, hintKey: otherKey },
  });
  return new URL(url).searchParams.get("lti_message_hint") ?? "";
}

/** The public key of the platform as a JWK. */
async function publicJwk(): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", platformKeys.publicKey);
}

/** The JWK thumbprint of RFC 7638 §3 for an RSA key: the SHA-256 of its required members in order, in base64url. */
async function thumbprint(jwk: JsonWebKey): Promise<string> {
  const json = `{"e":${JSON.stringify(jwk.e)},"kty":"RSA","n":${JSON.stringify(jwk.n)}}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Buffer.from(digest).toString("base64url");
}

describe("platformEndpoints and the configuration", () => {
  it("[T120] gives the URLs of the authorization endpoint, the key set and the token endpoint", () => {
    expect(endpoints).toEqual({
      authorization: `${PLATFORM_ORIGIN}/authorize`,
      jwks: `${PLATFORM_ORIGIN}/jwks`,
      token: `${PLATFORM_ORIGIN}/token`,
      storage: `${PLATFORM_ORIGIN}/storage`,
    });
  });

  it("[T120] refuses a configuration in which two of the platform, the player and the assets share an origin (D-M1)", () => {
    const pairs: readonly [string, Partial<PlatformConfig>, string][] = [
      [
        "the platform and the player",
        { origin: PLAYER_ORIGIN },
        `"${PLAYER_ORIGIN}", "${PLAYER_ORIGIN}" and "${ASSET_ORIGIN}"`,
      ],
      [
        "the platform and the assets",
        { origin: ASSET_ORIGIN },
        `"${ASSET_ORIGIN}", "${PLAYER_ORIGIN}" and "${ASSET_ORIGIN}"`,
      ],
      [
        "the player and the assets",
        { assetOrigin: PLAYER_ORIGIN },
        `"${PLATFORM_ORIGIN}", "${PLAYER_ORIGIN}" and "${PLAYER_ORIGIN}"`,
      ],
    ];
    for (const [name, change, found] of pairs) {
      expect(() => platformEndpoints({ ...config, ...change }), name).toThrow(
        new DataError(`The platform, the player and the assets must have three different origins, found ${found}.`),
      );
    }
  });

  it("[T120] refuses an origin that is not an https origin, and an issuer with a query or a fragment", () => {
    const cases: readonly [string, Partial<PlatformConfig>, string][] = [
      [
        "an http origin",
        { origin: "http://lti.platform.example" },
        'The origin of the platform must be an absolute https URL, found "http://lti.platform.example".',
      ],
      [
        "an origin with a path",
        { playerOrigin: `${PLAYER_ORIGIN}/app` },
        `The origin of the player must be an origin without a path, such as "https://platform.example", found "${PLAYER_ORIGIN}/app".`,
      ],
      [
        "an origin with a trailing slash",
        { assetOrigin: `${ASSET_ORIGIN}/` },
        `The origin of the assets must be an origin without a path, such as "https://platform.example", found "${ASSET_ORIGIN}/".`,
      ],
      [
        "an origin that is a number",
        { origin: JSON.parse("5") },
        "The origin of the platform must be a string, found 5.",
      ],
      [
        "an issuer with a fragment",
        { issuer: `${ISSUER}#x` },
        `The issuer of the platform must not have a query or a fragment, found "${ISSUER}#x".`,
      ],
      [
        "an issuer that is http",
        { issuer: "http://platform.example" },
        'The issuer of the platform must be an absolute https URL, found "http://platform.example".',
      ],
    ];
    for (const [name, change, message] of cases) {
      expect(() => platformEndpoints({ ...config, ...change }), name).toThrow(new DataError(message));
    }
  });

  it("[T120] refuses keys that are not what the configuration says", async () => {
    const spki = await crypto.subtle.exportKey("spki", platformKeys.publicKey);
    const hidden = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const encryption = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-1" }, false, ["sign", "verify"]);
    const signOnly = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const privateMessage = "The private key of the platform must be an RSASSA-PKCS1-v1_5 key with SHA-256 for signing.";
    const publicMessage =
      "The public key of the platform must be an extractable RSASSA-PKCS1-v1_5 key with SHA-256 for verifying.";
    const hintMessage = "The hint key of the platform must be an HMAC key with SHA-256 for signing and verifying.";
    const cases: readonly [string, Partial<PlatformConfig>, string][] = [
      [
        "a public key as the private key",
        { keys: { privateKey: platformKeys.publicKey, publicKey: platformKeys.publicKey } },
        privateMessage,
      ],
      [
        "a private key as the public key",
        { keys: { privateKey: platformKeys.privateKey, publicKey: platformKeys.privateKey } },
        publicMessage,
      ],
      [
        "a public key that cannot be exported",
        { keys: { privateKey: platformKeys.privateKey, publicKey: hidden } },
        publicMessage,
      ],
      ["an HMAC key with SHA-1", { hintKey: encryption }, hintMessage],
      ["an HMAC key that cannot verify", { hintKey: signOnly }, hintMessage],
      ["an RSA key as the hint key", { hintKey: platformKeys.privateKey }, hintMessage],
      ["a string as the hint key", { hintKey: JSON.parse('"key"') }, hintMessage],
    ];
    for (const [name, change, message] of cases) {
      expect(() => platformEndpoints({ ...config, ...change }), name).toThrow(new DataError(message));
    }
    expect(() => platformEndpoints({ ...config, keys: JSON.parse("5") })).toThrow(
      new DataError("The keys of the platform must be an object, found 5."),
    );
    expect(() => platformEndpoints(JSON.parse("null"))).toThrow(
      new DataError("The platform configuration must be an object, found null."),
    );
  });

  it("[T120] makes every handler refuse such a configuration", async () => {
    const ctx = setup();
    const bad = { ...config, assetOrigin: PLAYER_ORIGIN };
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    const calls: readonly (() => Promise<unknown>)[] = [
      () => platformJwks({ ...ctx.login, config: bad }),
      () => ltiPlatformLogin(caller, item, link, { ...ctx.login, config: bad }),
      () => ltiPlatformAuthorize(get, { ...ctx.authorize, config: bad }),
      () => platformToken(get, { ...ctx.token, config: bad }),
      () => agsLineItem(get, { ...ctx.token, config: bad }),
      () => agsScores(get, { ...ctx.scoring, config: bad }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(DataError);
  });
});

describe("platformJwks", () => {
  it("[T120] publishes the public key of the platform as an RSA signing key with a kid (Security Framework §6.3)", async () => {
    const ctx = setup();
    const response = await platformJwks(ctx.login);
    const jwk = await publicJwk();
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(response.headers["cache-control"]).toBe("public, max-age=3600");
    expect(JSON.parse(response.body)).toEqual({
      keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid: await thumbprint(jwk) }],
    });
  });

  it("[T120] names the key by its thumbprint, as RFC 7638 §3.1 computes it", async () => {
    const rfc = {
      kty: "RSA",
      e: "AQAB",
      n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
    };
    const publicKey = await crypto.subtle.importKey("jwk", rfc, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, [
      "verify",
    ]);
    const ctx = setup();
    const response = await platformJwks({ ...ctx.login, config: { ...config, keys: { ...config.keys, publicKey } } });
    expect(JSON.parse(response.body).keys[0].kid).toBe("NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs");
  });

  it("[T120] publishes nothing of the private key", async () => {
    const ctx = setup();
    const [key] = JSON.parse((await platformJwks(ctx.login)).body).keys;
    expect(Object.keys(key).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
  });

  it("[T120] publishes a key that verifies the id_token", async () => {
    const ctx = setup();
    const { claims } = await launch(ctx);
    expect(claims.iss).toBe(ISSUER);
  });

  it("throws DataError for options of other types", async () => {
    await expect(platformJwks(JSON.parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
  });
});

describe("ltiPlatformLogin", () => {
  it("[T120] builds the third-party initiated login for the tool of the link, with the parameters of LTI 1.3 Core §4.1", async () => {
    const ctx = setup();
    const { initiation, url } = await begin(ctx);
    expect(initiation).toMatchObject({
      iss: ISSUER,
      targetLinkUri: TOOL_LAUNCH_URL,
      clientId: TOOL_CLIENT_ID,
      deploymentId: TOOL_DEPLOYMENT_ID,
      storageTarget: "lti-storage",
    });
    expect([...new URL(url).searchParams.keys()]).toEqual([
      "iss",
      "login_hint",
      "lti_message_hint",
      "target_link_uri",
      "client_id",
      "lti_deployment_id",
      "lti_storage_target",
    ]);
  });

  it("[T120] signs a message hint that names the session, the item and the principal with a jti and a five minute expiry", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    const { header, claims, valid } = await openSealed(initiation.messageHint);
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: "HS256", typ: "hint" });
    expect(claims).toEqual({
      session: "session-1",
      item: { ref: "q-draw", instance: 1 },
      principal: "candidate-7",
      client: TOOL_CLIENT_ID,
      target: TOOL_LAUNCH_URL,
      custom: { exam: "tryout-1" },
      title: "Drawing tool",
      scoreMaximum: SCORE_MAXIMUM,
      jti: expect.any(String),
      exp: SECONDS + 300,
    });
  });

  it("[T120] signs the login_hint, which is the principal, with the same key", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    const { header, claims, valid } = await openSealed(initiation.loginHint);
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: "HS256", typ: "login" });
    expect(claims).toEqual({ principal: "candidate-7" });
  });

  it("[T120] gives every login its own jti", async () => {
    const ctx = setup();
    const ids = new Set<unknown>();
    for (let i = 0; i < 20; i += 1) ids.add((await openSealed((await begin(ctx)).initiation.messageHint)).claims.jti);
    expect(ids.size).toBe(20);
  });

  it("[T120] confirms the caller with the host before it looks for the tool", async () => {
    const ctx = setup();
    await begin(ctx);
    expect(ctx.checked).toEqual(["session-1/candidate-7"]);
    const refusing = {
      ...ctx.login,
      check: async () => {
        throw new AccessError("The session is not the caller's.", "session-not-bound");
      },
      registration: async () => {
        throw new Error("The registration must not be looked up.");
      },
    };
    await expect(ltiPlatformLogin(caller, item, link, refusing)).rejects.toMatchObject({
      name: "AccessError",
      reason: "session-not-bound",
    });
  });

  it("[T120] launches the secure launch URL of the link, else its launch URL, and keeps the query of the login URL", async () => {
    const ctx = setup();
    const both = { ...link, launchUrl: `${TOOL_ORIGIN}/plain` };
    expect(readInitiation(await ltiPlatformLogin(caller, item, both, ctx.login)).targetLinkUri).toBe(TOOL_LAUNCH_URL);
    const only = { ...link, secureLaunchUrl: undefined, launchUrl: `${TOOL_ORIGIN}/plain` };
    expect(readInitiation(await ltiPlatformLogin(caller, item, only, ctx.login)).targetLinkUri).toBe(
      `${TOOL_ORIGIN}/plain`,
    );
    const withQuery = setup({
      tools: new Map([[TOOL_CLIENT_ID, toolRegistration({ loginUrl: `${TOOL_LOGIN_URL}?tenant=7` })]]),
    });
    const url = new URL(await ltiPlatformLogin(caller, item, link, withQuery.login));
    expect(url.searchParams.get("tenant")).toBe("7");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
  });

  it("[T120] launches a link that olah read from a cartridge_basiclti_link document", async () => {
    const ctx = setup();
    const read = readLtiLink(`<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
  xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0" xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0">
  <blti:title>Drawing tool</blti:title>
  <blti:custom><lticm:property name="exam">tryout-1</lticm:property></blti:custom>
  <blti:secure_launch_url>${TOOL_LAUNCH_URL}</blti:secure_launch_url>
</cartridge_basiclti_link>`);
    const initiation = readInitiation(await ltiPlatformLogin(caller, item, read, ctx.login));
    expect(initiation.targetLinkUri).toBe(TOOL_LAUNCH_URL);
    expect((await openSealed(initiation.messageHint)).claims.custom).toEqual({ exam: "tryout-1" });
  });

  it("[T120] keeps an identifier such as __proto__ as data in the custom properties", async () => {
    const ctx = setup();
    const odd = { ...link, custom: new Map([["__proto__", "x"]]) };
    const { initiation } = await begin(ctx, { link: odd });
    const { claims } = await openSealed(initiation.messageHint);
    expect(Object.getOwnPropertyNames(claims.custom)).toEqual(["__proto__"]);
  });

  it("[T120] refuses a link whose tool is on the platform's own origin, the player's or the assets'", async () => {
    for (const origin of [PLATFORM_ORIGIN, PLAYER_ORIGIN, ASSET_ORIGIN]) {
      const target = `${origin}/tool`;
      const cases: readonly [string, ToolRegistration, LtiLink][] = [
        ["launch URL", toolRegistration(), { ...link, secureLaunchUrl: target }],
        ["login URL", toolRegistration({ loginUrl: target }), link],
        ["redirect URI", toolRegistration({ redirectUris: [TOOL_REDIRECT_URI, target] }), link],
      ];
      for (const [name, registration, candidate] of cases) {
        const ctx = setup({ tools: new Map([[TOOL_CLIENT_ID, registration]]) });
        const ours = { ...ctx.login, registration: async () => registration };
        await expect(ltiPlatformLogin(caller, item, candidate, ours), `${name} on ${origin}`).rejects.toMatchObject({
          name: "LtiError",
          reason: "origin-refused",
        });
      }
    }
  });

  it("[T120] refuses a link with no tool, without a launch URL, or with one that is not https", async () => {
    const ctx = setup();
    const unknown = { ...ctx.login, registration: async () => undefined };
    await expect(ltiPlatformLogin(caller, item, link, unknown)).rejects.toMatchObject({
      name: "LtiError",
      reason: "tool-unknown",
    });
    const noUrl: LtiLink = { title: "Drawing tool", custom: new Map(), extensions: [] };
    const byVendor = { ...ctx.login, registration: async () => toolRegistration() };
    await expect(ltiPlatformLogin(caller, item, noUrl, byVendor)).rejects.toThrow(
      new DataError("The LTI link must have a launch URL; a link that names only a vendor is not supported."),
    );
    await expect(
      ltiPlatformLogin(caller, item, { ...link, secureLaunchUrl: "http://tool.example.com/t" }, byVendor),
    ).rejects.toThrow(
      new DataError('The launch URL of the LTI link must be an absolute https URL, found "http://tool.example.com/t".'),
    );
  });

  it("[T120] refuses a registration that is not one", async () => {
    const ctx = setup();
    const cases: readonly [string, ToolRegistration, string][] = [
      [
        "no client",
        toolRegistration({ clientId: "" }),
        'The client identifier of a tool must be a non-empty string, found "".',
      ],
      [
        "a long deployment",
        toolRegistration({ deploymentId: "d".repeat(256) }),
        "The deployment of a tool must have at most 255 characters (LTI 1.3 Core §5.3.3), found 256.",
      ],
      [
        "a login URL that is http",
        toolRegistration({ loginUrl: "http://tool.example.com/login" }),
        'The login URL of a tool must be an absolute https URL, found "http://tool.example.com/login".',
      ],
      [
        "no redirect URI",
        toolRegistration({ redirectUris: [] }),
        "The redirect URIs of a tool must have at least one URI.",
      ],
      [
        "a redirect URI that is http",
        toolRegistration({ redirectUris: ["http://tool.example.com/l"] }),
        'A redirect URI of a tool must be an absolute https URL, found "http://tool.example.com/l".',
      ],
      [
        "a key set and keys",
        toolRegistration({ keys: new Map([[toolKeys.kid, toolKeys.publicKey]]) }),
        "A tool must have exactly one of the properties jwksUrl and keys.",
      ],
      [
        "neither",
        toolRegistration({ jwksUrl: undefined }),
        "A tool must have exactly one of the properties jwksUrl and keys.",
      ],
      [
        "an allow list with a quote of the other kind",
        toolRegistration({ allow: 'microphone "self"' }),
        'The allow list of a tool must be a Permissions Policy allow list of letters, digits, spaces and the characters ; * : / . \' -, found "microphone \\"self\\"".',
      ],
      [
        "an allow list that is not a string",
        toolRegistration({ allow: JSON.parse("5") }),
        "The allow list of a tool must be a string, found 5.",
      ],
      [
        "a key set URL that is http",
        toolRegistration({ jwksUrl: "http://tool.example.com/jwks" }),
        'The key set URL of a tool must be an absolute https URL, found "http://tool.example.com/jwks".',
      ],
      [
        "keys that are an object",
        toolRegistration({ jwksUrl: undefined, keys: JSON.parse("{}") }),
        "The keys of a tool must be a Map of public RSASSA-PKCS1-v1_5 keys with SHA-256 by kid, found an object.",
      ],
      [
        "a private key as a tool key",
        toolRegistration({ jwksUrl: undefined, keys: new Map([["k", toolKeys.privateKey]]) }),
        "The keys of a tool must be a Map of public RSASSA-PKCS1-v1_5 keys with SHA-256 by kid, found an object.",
      ],
    ];
    for (const [name, registration, message] of cases) {
      const ours = {
        ...ctx.login,
        registration: async () => JSON.parse(JSON.stringify(registration ?? null)) && registration,
      };
      await expect(ltiPlatformLogin(caller, item, link, JSON.parse("null") ?? ours), name).rejects.toThrow();
      await expect(ltiPlatformLogin(caller, item, link, ours as never), name).rejects.toThrow(new DataError(message));
    }
  });

  it("throws DataError for arguments and options of other types", async () => {
    const ctx = setup();
    const cases: readonly [string, () => Promise<unknown>][] = [
      ["The caller must be an object, found null.", () => ltiPlatformLogin(JSON.parse("null"), item, link, ctx.login)],
      [
        'The principal of a caller must be a non-empty string, found "".',
        () => ltiPlatformLogin({ ...caller, principal: "" }, item, link, ctx.login),
      ],
      [
        "The principal of the caller is the sub of the launch and must have at most 255 characters (LTI 1.3 Core §5.3.6), found 256.",
        () => ltiPlatformLogin({ ...caller, principal: "p".repeat(256) }, item, link, ctx.login),
      ],
      ['The item must be an object, found "q".', () => ltiPlatformLogin(caller, JSON.parse('"q"'), link, ctx.login)],
      [
        'The reference of the item must be a non-empty string, found "".',
        () => ltiPlatformLogin(caller, { ref: "", instance: 1 }, link, ctx.login),
      ],
      [
        "The instance of the item must be a positive integer, found 0.",
        () => ltiPlatformLogin(caller, { ref: "q", instance: 0 }, link, ctx.login),
      ],
      [
        "The LTI link must be an object, found an array.",
        () => ltiPlatformLogin(caller, item, JSON.parse("[]"), ctx.login),
      ],
      [
        'The title of the LTI link must be a non-empty string, found "".',
        () => ltiPlatformLogin(caller, item, { ...link, title: "" }, ctx.login),
      ],
      [
        "The custom properties of the LTI link must be a Map of strings, found an object.",
        () => ltiPlatformLogin(caller, item, { ...link, custom: JSON.parse('{"a":"b"}') }, ctx.login),
      ],
      [
        "The custom properties of the LTI link must be a Map of strings, found an object.",
        () => ltiPlatformLogin(caller, item, { ...link, custom: new Map([["a", JSON.parse("1")]]) }, ctx.login),
      ],
      ["The options must be an object, found null.", () => ltiPlatformLogin(caller, item, link, JSON.parse("null"))],
      [
        "The option registration must be a function, found null.",
        () => ltiPlatformLogin(caller, item, link, { ...ctx.login, registration: JSON.parse("null") }),
      ],
      [
        "The option check must be a function, found null.",
        () => ltiPlatformLogin(caller, item, link, { ...ctx.login, check: JSON.parse("null") }),
      ],
      [
        "The option scoreMaximum must be a function, found 5.",
        () => ltiPlatformLogin(caller, item, link, { ...ctx.login, scoreMaximum: JSON.parse("5") }),
      ],
      [
        "The highest score of the item must be a number above 0, found 0.",
        () => ltiPlatformLogin(caller, item, link, { ...ctx.login, scoreMaximum: async () => 0 }),
      ],
      [
        'The highest score of the item must be a number above 0, found "10".',
        () => ltiPlatformLogin(caller, item, link, { ...ctx.login, scoreMaximum: async () => JSON.parse('"10"') }),
      ],
    ];
    for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
  });
});

describe("platformStorage", () => {
  const response = (): Promise<HttpResponse> => platformStorage({ config, clock: { now: () => NOW } });

  it("[T122] serves the page that keeps the values of a tool, with a policy that names its one script by hash and the player as its only frame", async () => {
    const { status, headers, body } = await response();
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    const script = /<script>([\s\S]*)<\/script>/u.exec(body)?.[1] ?? "";
    expect(body.split("<script").length - 1).toBe(1);
    expect(headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors ${PLAYER_ORIGIN}`,
    );
  });

  it("[T122] names the frame of the tool and the limits of LTI postMessage Storage 0.1: 4096 bytes and 500 keys for an origin", async () => {
    const { body } = await response();
    const config = JSON.parse(unescapeHtml(/data-config="([^"]*)"/u.exec(body)?.[1] ?? ""));
    expect(config).toEqual({ tool: "lti-tool", maxBytes: 4096, maxKeys: 500 });
  });

  it("[T122] throws DataError for options of other types", async () => {
    await expect(async () => platformStorage(JSON.parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
  });
});

describe("ltiPlatformFrame", () => {
  it("[T122] gives the URL of the login, the URL of the storage page and the allow list of the registration", async () => {
    const tools = new Map([[TOOL_CLIENT_ID, toolRegistration({ allow: "microphone; camera 'self'" })]]);
    const ctx = setup({ tools });
    const frame = await ltiPlatformFrame(caller, item, link, ctx.login);
    expect(Object.keys(frame)).toEqual(["url", "storageUrl", "allow"]);
    expect(frame.storageUrl).toBe(endpoints.storage);
    expect(frame.allow).toBe("microphone; camera 'self'");
    expect(readInitiation(frame.url).storageTarget).toBe("lti-storage");
    expect(ctx.checked).toEqual([`${caller.session}/${caller.principal}`]);
  });

  it("[T122] leaves the allow list out when the registration has none", async () => {
    const ctx = setup();
    const frame = await ltiPlatformFrame(caller, item, link, ctx.login);
    expect(frame).not.toHaveProperty("allow");
    expect(Object.keys(frame)).toEqual(["url", "storageUrl"]);
  });

  it("[T122] refuses what ltiPlatformLogin refuses", async () => {
    const ctx = setup();
    await expect(
      ltiPlatformFrame(caller, item, otherLink, { ...ctx.login, registration: async () => undefined }),
    ).rejects.toMatchObject({
      reason: "tool-unknown",
    });
    await expect(ltiPlatformFrame(caller, item, link, JSON.parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
  });
});

describe("platformToken", () => {
  /** Posts a token request with an assertion of the first tool, changed as given. */
  async function token(
    ctx: Setup,
    change: Parameters<typeof clientAssertion>[3] = {},
    form: Record<string, string | undefined> = {},
    scope = SCORE,
  ): Promise<HttpResponse> {
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock, change);
    return platformToken(tokenRequest(endpoints.token, assertion, scope, form), ctx.token);
  }

  it("[T120] grants a bearer token for the scopes requested, as Security Framework §4.1.1 describes", async () => {
    const ctx = setup();
    const response = await token(ctx, {}, {}, `${LINEITEM_READONLY} ${SCORE}`);
    expect(response.status).toBe(200);
    expect(response.headers).toEqual({
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store",
      pragma: "no-cache",
    });
    expect(JSON.parse(response.body)).toEqual({
      access_token: expect.any(String),
      token_type: "Bearer",
      expires_in: 3600,
      scope: `${LINEITEM_READONLY} ${SCORE}`,
    });
  });

  it("[T120] grants a token with one scope, for either scope that a launch offers", async () => {
    const ctx = setup();
    for (const scope of [SCORE, LINEITEM_READONLY]) {
      expect(JSON.parse((await token(ctx, {}, {}, scope)).body).scope).toBe(scope);
    }
  });

  it("[T120] accepts the audience as an array that holds the token URL, and the assertion before the end of its leeway", async () => {
    const ctx = setup();
    expect((await token(ctx, { aud: [endpoints.token] })).status).toBe(200);
    expect((await token(ctx, { exp: SECONDS - 59 })).status).toBe(200);
    expect((await token(ctx, { exp: SECONDS + 3600 })).status).toBe(200);
    expect((await token(ctx, { iat: SECONDS + 60 })).status).toBe(200);
    expect((await token(ctx, { iat: undefined })).status).toBe(200);
  });

  it("[T120] remembers the jti of an assertion until its expiry", async () => {
    const ctx = setup();
    await token(ctx, { jti: "jti-1", exp: SECONDS + 100 });
    expect([...ctx.used]).toEqual([[`assertion:${TOOL_CLIENT_ID}:jti-1`, (SECONDS + 100) * 1000]]);
  });

  it("[T120] verifies the assertion against the key set of the tool, fetched once and cached", async () => {
    const ctx = setup();
    await token(ctx);
    await token(ctx);
    expect(ctx.toolFetches).toEqual([TOOL_JWKS_URL]);
  });

  it("[T120] verifies the assertion of a tool that gave its key and not a key set", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(otherToolKeys, endpoints.token, ctx.clock, {
      iss: OTHER_CLIENT_ID,
      sub: OTHER_CLIENT_ID,
    });
    const response = await platformToken(tokenRequest(endpoints.token, assertion, SCORE), ctx.token);
    expect(response.status).toBe(200);
    const unknown = await clientAssertion(otherToolKeys, endpoints.token, ctx.clock, {
      iss: OTHER_CLIENT_ID,
      sub: OTHER_CLIENT_ID,
      header: { kid: "tool-key-9" },
    });
    expect(JSON.parse((await platformToken(tokenRequest(endpoints.token, unknown, SCORE), ctx.token)).body).error).toBe(
      "invalid_client",
    );
  });

  it("[T120] lets two tools use the same jti", async () => {
    const ctx = setup();
    const first = await token(ctx, { jti: "shared" });
    const assertion = await clientAssertion(otherToolKeys, endpoints.token, ctx.clock, {
      iss: OTHER_CLIENT_ID,
      sub: OTHER_CLIENT_ID,
      jti: "shared",
    });
    const second = await platformToken(tokenRequest(endpoints.token, assertion, SCORE), ctx.token);
    expect([first.status, second.status]).toEqual([200, 200]);
  });

  it("[T120] refuses an assertion twice (RFC 7523 §3, Security Framework §4.1.1)", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const again = tokenRequest(endpoints.token, assertion, SCORE);
    expect((await platformToken(again, ctx.token)).status).toBe(200);
    const second = await platformToken(again, ctx.token);
    expect(second.status).toBe(400);
    expect(JSON.parse(second.body).error).toBe("invalid_client");
  });

  it("[T120] lets only one of two requests with one assertion succeed", async () => {
    const ctx = setup();
    const request2 = tokenRequest(endpoints.token, await clientAssertion(toolKeys, endpoints.token, ctx.clock), SCORE);
    const answers = await Promise.all([platformToken(request2, ctx.token), platformToken(request2, ctx.token)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 400]);
  });

  it("[T120] refuses a request that is not a token request, with invalid_request", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const cases: readonly [string, HttpResponse | Promise<HttpResponse>][] = [
      ["a GET", platformToken(request({ url: endpoints.token }), ctx.token)],
      [
        "a JSON body",
        platformToken(
          request({
            method: "POST",
            url: endpoints.token,
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
          ctx.token,
        ),
      ],
      [
        "another assertion type",
        token(ctx, {}, { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:saml2-bearer" }),
      ],
      ["no assertion type", token(ctx, {}, { client_assertion_type: undefined })],
      ["no assertion", token(ctx, {}, { client_assertion: undefined })],
      ["an empty assertion", token(ctx, {}, { client_assertion: "" })],
      [
        "a parameter twice",
        platformToken(
          request({
            method: "POST",
            url: endpoints.token,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: `grant_type=client_credentials&grant_type=x&client_assertion=${assertion}`,
          }),
          ctx.token,
        ),
      ],
    ];
    for (const [name, answer] of cases) {
      const response = await answer;
      expect(response.status, name).toBe(400);
      expect(JSON.parse(response.body).error, name).toBe("invalid_request");
      expect(typeof JSON.parse(response.body).error_description, name).toBe("string");
    }
  });

  it("[T120] refuses a grant other than client_credentials", async () => {
    const ctx = setup();
    for (const grant of ["authorization_code", "password", undefined]) {
      const response = await token(ctx, {}, { grant_type: grant });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body).error).toBe("unsupported_grant_type");
    }
  });

  it("[T120] refuses a scope that a launch does not offer, or none", async () => {
    const ctx = setup();
    for (const scope of ["", LINEITEM, RESULT_READONLY, `${SCORE} https://example.org/other`, "openid"]) {
      const response = await token(ctx, {}, {}, scope);
      expect(response.status, scope).toBe(400);
      expect(JSON.parse(response.body).error, scope).toBe("invalid_scope");
    }
    expect(JSON.parse((await token(ctx, {}, { scope: undefined })).body).error).toBe("invalid_scope");
  });

  it("[T120] refuses an assertion that is not what Security Framework §4.1.1 requires, with invalid_client", async () => {
    const ctx = setup();
    const iat = SECONDS;
    const cases: readonly [string, Promise<HttpResponse>][] = [
      ["not a JWT", token(ctx, {}, { client_assertion: "x.y" })],
      ["alg none", token(ctx, { header: { alg: "none" } })],
      ["an HMAC algorithm", token(ctx, { header: { alg: "HS256" } })],
      ["RS384", token(ctx, { header: { alg: "RS384" } })],
      ["a critical header", token(ctx, { header: { crit: ["exp"] } })],
      ["no kid", token(ctx, { header: { kid: undefined } })],
      ["a kid the tool does not have", token(ctx, { header: { kid: "tool-key-9" } })],
      ["a signature of another key", token(ctx, { signer: attackerKeys })],
      ["an unknown tool", token(ctx, { iss: "nobody", sub: "nobody" })],
      ["no iss", token(ctx, { iss: undefined })],
      ["a sub that is not the client", token(ctx, { sub: OTHER_CLIENT_ID })],
      ["no sub", token(ctx, { sub: undefined })],
      ["the issuer as the audience", token(ctx, { aud: ISSUER })],
      ["the platform origin as the audience", token(ctx, { aud: PLATFORM_ORIGIN })],
      ["the authorization endpoint as the audience", token(ctx, { aud: endpoints.authorization })],
      ["no audience", token(ctx, { aud: undefined })],
      ["an empty list of audiences", token(ctx, { aud: [] })],
      ["an audience beside the token URL", token(ctx, { aud: [endpoints.token, ISSUER] })],
      ["an assertion that has expired", token(ctx, { exp: iat - 60 })],
      ["no exp", token(ctx, { exp: undefined })],
      ["an exp that is a string", token(ctx, { exp: JSON.parse(`"${iat + 300}"`) })],
      ["an exp more than an hour away", token(ctx, { exp: iat + 3601 })],
      ["an iat in the future", token(ctx, { iat: iat + 61 })],
      ["no jti", token(ctx, { jti: undefined })],
      ["a jti that is a number", token(ctx, { jti: JSON.parse("5") })],
    ];
    for (const [name, answer] of cases) {
      const response = await answer;
      expect(response.status, name).toBe(400);
      expect(JSON.parse(response.body).error, name).toBe("invalid_client");
    }
    expect(ctx.used.size).toBe(0);
  });

  it("[T120] does not remember the jti of an assertion that fails another check", async () => {
    const ctx = setup();
    await token(ctx, { jti: "jti-9", signer: attackerKeys });
    await token(ctx, { jti: "jti-9", aud: ISSUER });
    expect(ctx.used.size).toBe(0);
    expect((await token(ctx, { jti: "jti-9" })).status).toBe(200);
  });

  it("[T120] lets the failure to fetch the key set of the tool reach the host, and does not burn the assertion", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const retry = tokenRequest(endpoints.token, assertion, SCORE);
    ctx.failToolKeys = true;
    await expect(platformToken(retry, ctx.token)).rejects.toBeInstanceOf(ServiceError);
    expect(ctx.used.size).toBe(0);
    ctx.failToolKeys = false;
    expect((await platformToken(retry, ctx.token)).status).toBe(200);
  });

  it("[T120] refuses a request for another origin than the platform's", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    await expect(
      platformToken(tokenRequest(`${PLAYER_ORIGIN}/token`, assertion, SCORE), ctx.token),
    ).rejects.toMatchObject({ name: "AccessError", reason: "wrong-origin" });
  });

  it("throws DataError for requests and options of other types", async () => {
    const ctx = setup();
    const post = tokenRequest(endpoints.token, "x", SCORE);
    const cases: readonly [string, () => Promise<unknown>][] = [
      ["The request must be an object, found null.", () => platformToken(JSON.parse("null"), ctx.token)],
      ["The options must be an object, found null.", () => platformToken(post, JSON.parse("null"))],
      [
        "The option jwks must be an object, found null.",
        () => platformToken(post, { ...ctx.token, jwks: JSON.parse("null") }),
      ],
      [
        "The option once must be a function, found null.",
        () => platformToken(post, { ...ctx.token, once: JSON.parse("null") }),
      ],
      [
        "The option client must be a function, found 5.",
        () => platformToken(post, { ...ctx.token, client: JSON.parse("5") }),
      ],
    ];
    for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
  });
});

describe("the tool role and the platform role together", () => {
  it("[T120] launches a tool built on the tool role of this package and takes its score", async () => {
    const ctx = setup();
    const store = new MemoryStore();
    const toolSide: PlatformRegistration = {
      issuer: ISSUER,
      clientId: TOOL_CLIENT_ID,
      deploymentIds: [TOOL_DEPLOYMENT_ID],
      authenticationUrl: endpoints.authorization,
      jwksUrl: endpoints.jwks,
      accessTokenUrl: endpoints.token,
      redirectUri: TOOL_REDIRECT_URI,
      keyId: toolKeys.kid,
      signingKey: toolKeys.privateKey,
    };
    const fetchPlatform = async (
      url: string,
      init: { method: string; headers: Readonly<Record<string, string>>; body?: string },
    ): Promise<Response> => {
      if (url === endpoints.jwks) return toResponse(await platformJwks(ctx.login));
      if (url === endpoints.token) {
        const answer = await platformToken(
          request({ url, method: init.method, headers: init.headers, body: init.body ?? "" }),
          ctx.token,
        );
        return toResponse(answer);
      }
      return new Response("", { status: 404 });
    };
    const tool = {
      registration: async () => toolSide,
      clock: ctx.clock,
      store,
      jwks: createJwksCache({ fetch: fetchPlatform }),
      fetch: fetchPlatform,
    };

    const initiation = await ltiPlatformLogin(caller, item, link, ctx.login);
    const login = await ltiLogin(request({ url: initiation }), tool);
    const { config: stored } = readPage(login);
    const page = await ltiPlatformAuthorize(request({ url: stored.authenticationRequest ?? "" }), ctx.authorize);
    const delivered = readPost(page);
    const form = (extra: Record<string, string>): string =>
      new URLSearchParams({ id_token: delivered.idToken, state: delivered.state, ...extra }).toString();
    const post = (body: string, headers: Record<string, string>): HttpRequest =>
      request({
        method: "POST",
        url: TOOL_REDIRECT_URI,
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body,
      });
    const verification = await ltiLaunch(post(form({}), {}), tool);
    expect("status" in verification).toBe(true);
    const launched = await ltiLaunch(
      post(form({ stored_state: stored.state ?? "", stored_nonce: stored.nonce ?? "" }), { origin: TOOL_ORIGIN }),
      tool,
    );
    if (!("messageType" in launched) || launched.messageType !== "LtiResourceLinkRequest") {
      throw new Error("The tool did not accept the launch.");
    }
    expect(launched).toMatchObject({
      issuer: ISSUER,
      clientId: TOOL_CLIENT_ID,
      deploymentId: TOOL_DEPLOYMENT_ID,
      targetLinkUri: TOOL_LAUNCH_URL,
      subject: "candidate-7",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      resourceLink: { title: "Drawing tool" },
      ags: { scopes: [LINEITEM_READONLY, SCORE] },
    });
    expect(launched.custom).toEqual(new Map([["exam", "tryout-1"]]));

    const lineitem = launched.ags?.lineitem ?? "";
    const granted = await ltiAccessToken(launched, launched.ags?.scopes ?? [], tool);
    expect(granted.scopes).toEqual([LINEITEM_READONLY, SCORE]);
    const read = await agsLineItem(service(lineitem, granted.value), ctx.token);
    expect(JSON.parse(read.body)).toMatchObject({ id: lineitem, label: "Drawing tool", scoreMaximum: SCORE_MAXIMUM });
    const body = scoreBody({ userId: launched.subject });
    const posted = await agsScores(
      service(`${lineitem}/scores`, granted.value, { method: "POST", headers: { "content-type": SCORE_TYPE }, body }),
      ctx.scoring,
    );
    expect(posted.status).toBe(204);
    expect(ctx.scores).toMatchObject([
      { session: "session-1", item, score: { userId: "candidate-7", scoreGiven: 83 } },
    ]);
  });
});

describe("properties", () => {
  const scoreFields = fc.record(
    {
      userId: fc.oneof(fc.string(), fc.constant(null), fc.integer()),
      timestamp: fc.oneof(
        fc.constant("2017-04-16T18:54:36.736+00:00"),
        fc.constant("2017-04-16T18:54:36Z"),
        fc.string(),
        fc.integer(),
      ),
      scoreGiven: fc.oneof(fc.double({ noNaN: false }), fc.string(), fc.constant(null)),
      scoreMaximum: fc.oneof(fc.double({ noNaN: false }), fc.string(), fc.constant(null)),
      activityProgress: fc.oneof(
        fc.constantFrom("Initialized", "Started", "InProgress", "Submitted", "Completed"),
        fc.string(),
      ),
      gradingProgress: fc.oneof(
        fc.constantFrom("FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"),
        fc.string(),
      ),
    },
    { requiredKeys: [] },
  );

  it("[T120] reads only scores that have a scoreGiven from 0 together with a scoreMaximum above 0", () => {
    fc.assert(
      fc.property(scoreFields, (body) => {
        let score: AgsScore;
        try {
          score = readAgsScore(body);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
          return;
        }
        if (score.scoreGiven !== undefined) {
          expect(score.scoreGiven).toBeGreaterThanOrEqual(0);
          expect(score.scoreMaximum).toBeGreaterThan(0);
        }
        expect(Number.isFinite(score.timestampMs)).toBe(true);
        expect(score.userId).not.toBe("");
      }),
      { numRuns: 500 },
    );
  });

  it("[T120] reads every ISO 8601 timestamp with a zone to the instant it names", () => {
    const instant = fc.date({ min: new Date(0), max: new Date(Date.UTC(2200, 0, 1)), noInvalidDate: true });
    fc.assert(
      fc.property(instant, fc.integer({ min: -14 * 60, max: 14 * 60 }), (date, minutes) => {
        const local = new Date(date.getTime() + minutes * 60_000);
        const sign = minutes < 0 ? "-" : "+";
        const zone = `${sign}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
        const text = `${local.toISOString().slice(0, -1)}${zone}`;
        const score = readAgsScore({
          userId: "u",
          timestamp: text,
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
        });
        expect(score.timestampMs, text).toBe(date.getTime());
      }),
      { numRuns: 300 },
    );
  });

  it("[T120] never accepts a hint that was changed", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    const hint = initiation.messageHint;
    const parts = hint.split(".");
    // The last character of a part holds bits that base64url ignores, so that two spellings can decode to one value.
    const positions = fc.oneof(
      ...parts.map((part, index) =>
        fc.record({ index: fc.constant(index), at: fc.integer({ min: 0, max: part.length - 2 }) }),
      ),
    );
    await fc.assert(
      fc.asyncProperty(positions, fc.nat(63), async ({ index, at }, shift) => {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const source = parts[index] ?? "";
        const replacement = alphabet[(alphabet.indexOf(source[at] ?? "A") + 1 + (shift % 63)) % 64] ?? "A";
        const changed = `${source.slice(0, at)}${replacement}${source.slice(at + 1)}`;
        const token = parts.map((part, position) => (position === index ? changed : part)).join(".");
        const { parameters } = await begin(ctx);
        parameters.set("lti_message_hint", token);
        await expect(
          ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize),
        ).rejects.toMatchObject({ name: "AccessError", reason: "hint-invalid" });
      }),
      { numRuns: 60 },
    );
  });
});
