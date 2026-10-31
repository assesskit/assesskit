// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.
import { actionToJson, type CandidateAction, type ItemKey, viewFromJson } from "@assesskit/runtime/delivery";
import { readLtiLink } from "@assesskit/runtime/package";
import { single } from "@assesskit/runtime/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgsScore,
  agsScores,
  createJwksCache,
  type HttpResponse,
  type LtiLaunch,
  ltiLaunch,
  ltiLogin,
  ltiPlatformAuthorize,
  ltiPlatformFrame,
  type PlatformConfig,
  platformEndpoints,
  platformJwks,
  platformToken,
  publishScore,
  type ToolRegistration,
} from "../src/lti/index.js";
import type { ViewEnvelope } from "../src/protocol/index.js";
import { type AgsScoreStore, createLtiScoreIntake, type LtiScoreIntake, type StepEvents } from "../src/server/index.js";
import { examHost } from "./exam-fixture.js";
import { ltiExamFiles } from "./lti-exam-fixture.js";
import { FakeLms, LINE_ITEM_URL, SUBJECT } from "./lti-fake-lms.js";
import { cookieOf, FakePlatform, MemoryStore, registrationOf } from "./lti-fake-platform.js";
import {
  acceptIdToken,
  authenticationParameters,
  authenticationRequest,
  clientAssertion,
  type Delivered,
  type KeySet,
  readInitiation,
  tokenRequest,
  toolRegistration,
} from "./lti-fake-tool.js";
import { createClock, generateKeyPair, request, unescapeHtml } from "./lti-fixture.js";

/**
 * Two LTI relationships around one exam. A learning platform launches the exam as a tool, and the exam's results go back to
 * its line item (the tool role). The exam holds a link to a drawing tool, which the player launches as a platform, and whose
 * scores reach the session (the platform role). The learning platform and the drawing tool are fakes written from the
 * specifications.
 */

const PLATFORM_ISSUER = "https://platform.example";
const PLATFORM_ORIGIN = "https://lti.platform.example";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/scope/";
const SCORE_SCOPE = `${AGS}score`;
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const ESSAY: ItemKey = { ref: "essay", instance: 1 };
const DRAW: ItemKey = { ref: "draw", instance: 1 };
const CANDIDATE = { session: "exam-1", principal: SUBJECT };
const SECOND = 1000;

afterEach(() => vi.useRealTimers());

const platformKeys = await generateKeyPair("unused");
const lmsKeys = await generateKeyPair("lms-1");
const examKeys = await generateKeyPair("exam-1");
const toolKeys = await generateKeyPair("tool-key-1");
const hintKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const config: PlatformConfig = {
  issuer: PLATFORM_ISSUER,
  origin: PLATFORM_ORIGIN,
  playerOrigin: "https://player.platform.example",
  assetOrigin: "https://assets.platform.example",
  keys: { privateKey: platformKeys.privateKey, publicKey: platformKeys.publicKey },
  hintKey,
};
const endpoints = platformEndpoints(config);

/** An in-memory store of the latest score of each line item that compares times as the specification says. */
function scoreStore(): AgsScoreStore & { readonly kept: Map<string, AgsScore> } {
  const kept = new Map<string, AgsScore>();
  const keyOf = (session: string, item: ItemKey): string => JSON.stringify([session, item.ref, item.instance]);
  return {
    kept,
    keep: async (session, item, score) => {
      const before = kept.get(keyOf(session, item));
      if (before !== undefined && before.timestampMs >= score.timestampMs) return false;
      kept.set(keyOf(session, item), score);
      return true;
    },
    latest: async (session, item) => kept.get(keyOf(session, item)),
  };
}

/** The exam with its two LTI relationships, wired as a host would wire them. */
async function rig(files: Readonly<Record<string, string>> = ltiExamFiles({ maximum: 20 })) {
  const clock = createClock();
  const scores = scoreStore();
  const logged: StepEvents[] = [];
  let intake: LtiScoreIntake | undefined;
  const base = await examHost(
    {
      clock,
      forward: {
        log: async (step) => {
          logged.push(step);
          await intake?.settle(step);
        },
      },
    },
    files,
  );
  const { host } = base;
  intake = createLtiScoreIntake({ host, scores });

  // The drawing tool's registration and the platform's handlers.
  const tool: ToolRegistration = toolRegistration({
    jwksUrl: undefined,
    keys: new Map([[toolKeys.kid, toolKeys.publicKey]]),
  });
  const used = new Set<string>();
  const once = async (id: string): Promise<boolean> => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
  const common = { config, clock };
  const login = {
    ...common,
    registration: async () => tool,
    check: (who: { session: string; principal: string }) => host.check(who),
    scoreMaximum: async () => 10,
  };
  const authorize = { ...common, client: async () => tool, once };
  const token = {
    ...common,
    client: async () => tool,
    once,
    jwks: createJwksCache({ fetch: async () => new Response("", { status: 404 }) }),
  };
  const scoring = { ...common, onScore: intake.onScore };
  const link = readLtiLink(base.pkg.file("lti/draw.xml") ?? new Uint8Array());

  // The learning platform that launched the exam, and the launch.
  const lmsClock = clock;
  const lmsPlatform = new FakePlatform(lmsClock, lmsKeys);
  lmsPlatform.toolKey = examKeys;
  const lms = new FakeLms(lmsPlatform);
  const registration = registrationOf(examKeys);
  const lmsStore = new MemoryStore();
  const toolOptions = {
    registration: async () => registration,
    clock,
    store: lmsStore,
    jwks: createJwksCache({ fetch: lmsPlatform.fetch }),
    fetch: lms.fetch,
  };
  const started = await ltiLogin(lmsPlatform.initiation(), toolOptions);
  const auth = await lmsPlatform.authenticate(started.headers.location ?? "", { claims: { sub: SUBJECT } });
  const launched = await ltiLaunch(auth.post({ cookie: cookieOf(started.headers["set-cookie"]) }), toolOptions);
  if (!("messageType" in launched)) throw new Error("The launch is a page.");
  const launch: LtiLaunch = launched;

  let seq = 0;
  const send = async (action: CandidateAction): Promise<ViewEnvelope> => {
    seq += 1;
    return host.handle(CANDIDATE, { seq, action: actionToJson(action) });
  };
  const publish = async (): Promise<void> =>
    publishScore(
      await host.session(CANDIDATE.session).results(),
      launch,
      await host.session(CANDIDATE.session).pending(),
      toolOptions,
    );

  return {
    ...base,
    logged,
    clock,
    scores,
    intake,
    login,
    authorize,
    token,
    scoring,
    tool,
    link,
    lms,
    launch,
    send,
    publish,
  };
}

type Rig = Awaited<ReturnType<typeof rig>>;

const viewOf = (envelope: ViewEnvelope) => viewFromJson(envelope.view);

/** Reads the form that the platform's page posts to the tool. */
function readPost(response: HttpResponse): Delivered {
  const inputs = new Map<string, string>();
  for (const [, name = "", value = ""] of response.body.matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/gu,
  )) {
    inputs.set(name, unescapeHtml(value));
  }
  return { action: "", idToken: inputs.get("id_token") ?? "", state: inputs.get("state") ?? "" };
}

/** The drawing tool after its launch: it posts scores to the line item as the specification says a tool may. */
interface LaunchedTool {
  readonly storageTarget: string;
  post(body: Record<string, unknown>): Promise<HttpResponse>;
}

/** Launches the drawing tool in an item as a conformant tool does: the login, the authentication request and the id_token. */
async function launchTool(ctx: Rig, item: ItemKey): Promise<LaunchedTool> {
  const frame = await ltiPlatformFrame(CANDIDATE, item, ctx.link, ctx.login);
  const initiation = readInitiation(frame.url);
  const parameters = authenticationParameters(initiation);
  const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
  expect(page.status).toBe(200);
  const delivered = readPost(page);
  const keys: KeySet = JSON.parse((await platformJwks(ctx.login)).body);
  const claims = await acceptIdToken(delivered.idToken, keys, {
    issuer: PLATFORM_ISSUER,
    nonce: parameters.get("nonce") ?? "",
    clock: ctx.clock,
  });
  const ags = claims["https://purl.imsglobal.org/spec/lti-ags/claim/endpoint"] as { scope: string[]; lineitem: string };
  const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
  const granted = await platformToken(tokenRequest(endpoints.token, assertion, SCORE_SCOPE), ctx.token);
  expect(granted.status, granted.body).toBe(200);
  const accessToken = JSON.parse(granted.body).access_token as string;
  return {
    storageTarget: initiation.storageTarget,
    post: (body) =>
      agsScores(
        request({
          method: "POST",
          url: `${ags.lineitem}/scores`,
          headers: { authorization: `Bearer ${accessToken}`, "content-type": SCORE_TYPE },
          body: JSON.stringify({ userId: claims.sub, ...body }),
        }),
        ctx.scoring,
      ),
  };
}

/** The score of the drawing tool as the specification's examples write one, for the time `seconds` after the start. */
const drawing = (ctx: Rig, seconds: number, change: Record<string, unknown> = {}): Record<string, unknown> => ({
  timestamp: new Date(ctx.clock.now() + seconds * SECOND).toISOString(),
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  scoreGiven: 6,
  scoreMaximum: 10,
  ...change,
});

/** The candidate answers the essay and opens the drawing tool, which the tool has launched. */
async function openDrawing(ctx: Rig): Promise<LaunchedTool> {
  await ctx.host.start(CANDIDATE, { seed: 7 });
  await ctx.send({
    type: "set-responses",
    item: ESSAY,
    responses: new Map([["RESPONSE", single("string", "An essay.")]]),
  });
  await ctx.send({ type: "submit", item: ESSAY });
  await ctx.send({ type: "move", to: DRAW });
  return launchTool(ctx, DRAW);
}

const requestsOf = async (ctx: Rig): Promise<string[]> =>
  (await ctx.host.session(CANDIDATE.session).pending()).scoring.map(({ id }) => id);

const supplyEssay = (ctx: Rig, score: number) =>
  ctx.host.session(CANDIDATE.session).apply({
    type: "supply-scores",
    request: "item:essay:1:SCORE",
    value: single("float", score),
    scorer: "human",
  });

/** The `SCORE` of the test in the results report. */
async function totalOf(ctx: Rig): Promise<unknown> {
  const { testResult } = await ctx.host.session(CANDIDATE.session).results();
  const score = testResult?.variables.find((variable) => variable.identifier === "SCORE");
  return score?.kind === "outcome" ? score.value : undefined;
}

describe("an exam with an essay and a link to a tool", () => {
  it("launches the tool of an LTI item through the platform's handshake, with its storage in the frame the player names", async () => {
    const ctx = await rig();
    await ctx.host.start(CANDIDATE, { seed: 7 });
    const reply = await ctx.send({ type: "move", to: DRAW });
    expect(viewOf(reply).current?.lti?.title).toBe("Drawing tool");
    const launched = await launchTool(ctx, DRAW);
    expect(launched.storageTarget).toBe("lti-storage");
    expect(reply.documents).toEqual({ test: "tests/exam.xml", item: "", stimuli: [], lexicons: [] });
    expect(Object.keys(reply.assets)).toEqual([]);
  });

  it("keeps interim progress, and supplies a final score to the requests that the item makes when the candidate leaves it", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    expect(
      (
        await tool.post(
          drawing(ctx, 10, {
            gradingProgress: "NotReady",
            activityProgress: "Started",
            scoreGiven: undefined,
            scoreMaximum: undefined,
          }),
        )
      ).status,
    ).toBe(204);
    expect((await tool.post(drawing(ctx, 30))).status).toBe(204);
    // The tool graded while the candidate was still in the item: the runtime has made no request for it yet.
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE"]);
    expect(ctx.scores.kept.size).toBe(1);
    ctx.clock.advance(60);
    await ctx.send({ type: "submit", item: DRAW });
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE"]);
    expect(await totalOf(ctx)).toEqual(single("float", 6));
    expect(ctx.logged.flatMap(({ events }) => events.map(({ type }) => type))).toContain("scores-applied");
  });

  it("ignores a score whose time is not later than the kept one, and keeps a later one", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await tool.post(drawing(ctx, 30, { scoreGiven: 6 }));
    await tool.post(drawing(ctx, 20, { scoreGiven: 9 }));
    await tool.post(drawing(ctx, 30, { scoreGiven: 8 }));
    expect([...ctx.scores.kept.values()].map(({ scoreGiven }) => scoreGiven)).toEqual([6]);
    await tool.post(drawing(ctx, 40, { scoreGiven: 7 }));
    expect([...ctx.scores.kept.values()].map(({ scoreGiven }) => scoreGiven)).toEqual([7]);
  });

  it("does not supply a score that is not final", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE", "item:draw:1:SCORE", "item:draw:1:MAXSCORE"]);
    await tool.post(
      drawing(ctx, 10, { gradingProgress: "PendingManual", scoreGiven: undefined, scoreMaximum: undefined }),
    );
    await tool.post(drawing(ctx, 20, { gradingProgress: "Pending" }));
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE", "item:draw:1:SCORE", "item:draw:1:MAXSCORE"]);
  });

  it("replaces the values of the requests when a later final score arrives", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10, { scoreGiven: 6 }));
    expect(await totalOf(ctx)).toEqual(single("float", 6));
    await tool.post(drawing(ctx, 20, { scoreGiven: 9 }));
    expect(await totalOf(ctx)).toEqual(single("float", 9));
    const types = ctx.logged.flatMap(({ events }) => events.map(({ type }) => type));
    expect(types.filter((type) => type === "scores-applied")).toHaveLength(2);
    expect(types.filter((type) => type === "scores-replaced")).toHaveLength(2);
  });
});

describe("the results of the exam go back to the learning platform", () => {
  it("publishes PendingManual, then Pending with the score so far, then FullyGraded, as the requests are resolved", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    ctx.clock.advance(60);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });

    // A person must score the essay, and the tool the drawing: the report is provisional.
    const provisional = await ctx.host.session(CANDIDATE.session).results();
    expect(provisional.itemResults.map(({ identifier, sessionStatus }) => [identifier, sessionStatus])).toEqual([
      ["essay", "pendingExternalScoring"],
      ["draw", "pendingExternalScoring"],
    ]);
    await ctx.publish();
    expect(ctx.lms.accepted.at(-1)).toEqual({
      userId: SUBJECT,
      timestamp: new Date(ctx.clock.now()).toISOString(),
      activityProgress: "Completed",
      gradingProgress: "PendingManual",
    });

    // The person scores the essay; only the tool is left.
    ctx.clock.advance(60);
    expect((await supplyEssay(ctx, 8)).refusal).toBeUndefined();
    await ctx.publish();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({
      gradingProgress: "Pending",
      activityProgress: "Completed",
      scoreGiven: 8,
      scoreMaximum: 20,
    });

    // The tool posts its final score, which resolves the last requests.
    ctx.clock.advance(60);
    expect((await tool.post(drawing(ctx, 0, { scoreGiven: 6, scoreMaximum: 10 }))).status).toBe(204);
    expect(await requestsOf(ctx)).toEqual([]);
    await ctx.publish();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14, scoreMaximum: 20 });
    expect(ctx.lms.accepted.map(({ gradingProgress }) => gradingProgress)).toEqual([
      "PendingManual",
      "Pending",
      "FullyGraded",
    ]);
    const stamps = ctx.lms.accepted.map(({ timestamp }) => Date.parse(String(timestamp)));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(3);
  });

  it("sends a negative SCORE as 0, with the raw score in the comment, and publishes a regrade with a later time", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10, { scoreGiven: 6 }));
    await supplyEssay(ctx, 8);
    ctx.clock.advance(60);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    await ctx.publish();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14 });
    // A penalty makes the total negative.
    ctx.clock.advance(60);
    await supplyEssay(ctx, -20);
    expect(await totalOf(ctx)).toEqual(single("float", -14));
    await ctx.publish();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({
      gradingProgress: "FullyGraded",
      scoreGiven: 0,
      scoreMaximum: 20,
      comment: "Raw score: -14",
    });
  });

  it("reads the scoreMaximum from the line item when the results have no MAXSCORE", async () => {
    const ctx = await rig(ltiExamFiles());
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10, { scoreGiven: 6 }));
    await supplyEssay(ctx, 8);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    ctx.lms.scoreMaximum = 40;
    await ctx.publish();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14, scoreMaximum: 40 });
    expect(ctx.lms.calls).toEqual([`GET ${LINE_ITEM_URL}`, `POST ${LINE_ITEM_URL}/scores`]);
  });

  it("refuses to publish a copy of the results that the session host returned", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    const results = await ctx.host.session(CANDIDATE.session).results();
    const pending = await ctx.host.session(CANDIDATE.session).pending();
    const toolOptions = {
      registration: async () => registrationOf(examKeys),
      clock: ctx.clock,
      fetch: ctx.lms.fetch,
    };
    await expect(publishScore({ ...results } as never, ctx.launch, pending, toolOptions)).rejects.toThrow(
      "not official",
    );
    expect(ctx.lms.received).toEqual([]);
  });
});
