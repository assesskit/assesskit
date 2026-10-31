// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.
import type { Caller, ViewEnvelope } from "@assesskit/player/protocol";
import {
  createToolScoreIntake,
  type ToolScore,
  type ToolScoreIntake,
  type ToolScoreStore,
} from "@assesskit/player/server";
import { actionToJson, type CandidateAction, type ItemKey } from "@assesskit/runtime/delivery";
import { type LtiLink, readLtiLink } from "@assesskit/runtime/package";
import { single } from "@assesskit/runtime/values";
import type { Fetch } from "@interopkit/core";
import { createJwksCache, type HttpResponse } from "@interopkit/tool-integration";
import {
  agsScores,
  ltiPlatformAuthorize,
  ltiPlatformFrame,
  type PlatformConfig,
  platformEndpoints,
  platformJwks,
  platformToken,
  type ToolRegistration,
} from "@interopkit/tool-integration/platform";
import { type LtiLaunch, ltiLaunch, ltiLogin, type PlatformRegistration } from "@interopkit/tool-integration/tool";
import {
  launchHooks,
  type MemoryOutbox,
  memoryOutbox,
  onToolScore,
  outboxLog,
  runEventJob,
  runPublishJob,
  runSettleJob,
  toolLaunch,
} from "../src/index.ts";
import { examFiles, packageOf, sessionHostOver } from "./exam.ts";
import { FakeLms, SUBJECT } from "./fake-lms.ts";
import { cookieOf, FakePlatform, MemoryStore, registrationOf } from "./fake-platform.ts";
import {
  acceptIdToken,
  agsClaim,
  authenticationParameters,
  authenticationRequest,
  clientAssertion,
  type Delivered,
  type KeySet,
  readInitiation,
  tokenRequest,
  toolRegistration,
} from "./fake-tool.ts";
import { createClock, generateKeyPair, request, unescapeHtml } from "./fixture.ts";

/**
 * Two LTI relationships around one exam. A learning platform launches the exam as a tool, and the exam's results go back to its
 * line item (the tool role). The exam holds a link to a drawing tool, which the host launches as a platform, and whose scores
 * reach the session (the platform role). The learning platform and the drawing tool are fakes written from the specifications.
 */

const PLATFORM_ISSUER = "https://platform.example";
const PLATFORM_ORIGIN = "https://lti.platform.example";
const SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const ESSAY: ItemKey = { ref: "essay", instance: 1 };
export const DRAW: ItemKey = { ref: "draw", instance: 1 };
export const CANDIDATE: Caller = { session: "exam-1", principal: SUBJECT };
const SECOND = 1000;
/** The IRIs of the parties of the events, which are the host's to name. */
export const PARTIES = {
  actor: "urn:uuid:0b9c4c4e-0d3c-4f8e-9a53-6d1b6f0d9a11",
  assessment: "https://exam.example/tests/42",
  edApp: "https://exam.example",
};
const SCORER = "https://tool.example.com/lti/tools/drawing";
const CALIPER_ENDPOINT = "https://lrs.example/caliper";

const platformKeys = await generateKeyPair("unused");
const lmsKeys = await generateKeyPair("lms-1");
const examKeys = await generateKeyPair("exam-1");
const toolKeys = await generateKeyPair("tool-key-1");
const hintKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const config: PlatformConfig = {
  issuer: PLATFORM_ISSUER,
  origin: PLATFORM_ORIGIN,
  frameOrigin: "https://player.platform.example",
  reservedOrigins: ["https://assets.platform.example"],
  keys: { privateKey: platformKeys.privateKey, publicKey: platformKeys.publicKey },
  hintKey,
};
const endpoints = platformEndpoints(config);

/** An in-memory store of the latest score of each item instance that compares times as the contract says. */
function toolScoreStore(): ToolScoreStore & { readonly kept: Map<string, ToolScore> } {
  const kept = new Map<string, ToolScore>();
  const keyOf = (session: string, item: ItemKey): string => JSON.stringify([session, item.ref, item.instance]);
  return {
    kept,
    keep: async (session, item, score) => {
      const before = kept.get(keyOf(session, item));
      if (before !== undefined && before.timestampMs > score.timestampMs) return false;
      kept.set(keyOf(session, item), score);
      return true;
    },
    latest: async (session, item) => kept.get(keyOf(session, item)),
  };
}

/** The fake Caliper endpoint: it keeps the envelopes it received. */
export interface FakeEndpoint {
  readonly envelopes: { readonly sendTime: string; readonly data: Record<string, unknown>[] }[];
  readonly fetch: Fetch;
}

/** Creates the fake Caliper endpoint, which accepts every envelope. */
function fakeEndpoint(): FakeEndpoint {
  const envelopes: FakeEndpoint["envelopes"] = [];
  return {
    envelopes,
    fetch: async (url, init) => {
      if (url !== CALIPER_ENDPOINT) return new Response("", { status: 404 });
      envelopes.push(JSON.parse(init.body ?? ""));
      return new Response("", { status: 200 });
    },
  };
}

/** The exam with its two LTI relationships and the jobs, wired as a host would wire them. */
export async function rig(files: Readonly<Record<string, string>> = examFiles({ maximum: 20 })) {
  const clock = createClock();
  const scores = toolScoreStore();
  const outbox: MemoryOutbox = memoryOutbox();
  const pkg = packageOf(files);
  const host = await sessionHostOver(pkg, clock, { log: outboxLog(outbox) });
  const intake: ToolScoreIntake = createToolScoreIntake({ host, scores, scoredBy: async () => SCORER });

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
  const hooks = launchHooks(host);
  const common = { config, clock };
  const login = { ...common, registration: async () => tool, check: hooks.check };
  const authorize = { ...common, client: async () => tool, once, checkLaunch: hooks.checkLaunch };
  const token = {
    ...common,
    client: async () => tool,
    once,
    jwks: createJwksCache({ fetch: async () => new Response("", { status: 404 }) }),
  };
  const scoring = { ...common, onScore: onToolScore(intake) };
  const link: LtiLink = readLtiLink(pkg.file("lti/draw.xml") ?? new Uint8Array());

  // The learning platform that launched the exam, and the launch.
  const lmsPlatform = new FakePlatform(clock, lmsKeys);
  lmsPlatform.toolKey = examKeys;
  const lms = new FakeLms(lmsPlatform);
  const registration: PlatformRegistration = registrationOf(examKeys);
  const toolOptions = {
    registration: async () => registration,
    clock,
    store: new MemoryStore(),
    jwks: createJwksCache({ fetch: lmsPlatform.fetch }),
    fetch: lms.fetch,
  };
  const started = await ltiLogin(lmsPlatform.initiation(), toolOptions);
  const auth = await lmsPlatform.authenticate(started.headers.location ?? "", { claims: { sub: SUBJECT } });
  const launched = await ltiLaunch(auth.post({ cookie: cookieOf(started.headers["set-cookie"]) }), toolOptions);
  if (!("messageType" in launched)) throw new Error("The launch is a page.");
  const launch: LtiLaunch = launched;

  const endpoint = fakeEndpoint();
  const jobs = {
    settle: { outbox, intake },
    events: {
      outbox,
      parties: () => PARTIES,
      sender: {
        endpoint: CALIPER_ENDPOINT,
        token: "token-123",
        sensor: "https://exam.example/sensors/1",
        fetch: endpoint.fetch,
      },
      clock,
    },
    publish: { outbox, host, launchOf: async () => launch, tool: toolOptions },
  };

  let seq = 0;
  const send = async (action: CandidateAction): Promise<ViewEnvelope> => {
    seq += 1;
    return host.handle(CANDIDATE, { seq, action: actionToJson(action) });
  };
  /** Runs the three jobs of the session, in the order a queue would. */
  const runJobs = async () => {
    await runSettleJob(CANDIDATE.session, jobs.settle);
    await runEventJob(CANDIDATE.session, jobs.events);
    return runPublishJob(CANDIDATE.session, jobs.publish);
  };

  return {
    host,
    pkg,
    clock,
    scores,
    outbox,
    intake,
    login,
    authorize,
    token,
    scoring,
    tool,
    link,
    lms,
    launch,
    endpoint,
    jobs,
    send,
    runJobs,
  };
}

export type Rig = Awaited<ReturnType<typeof rig>>;

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
export interface LaunchedTool {
  readonly storageTarget: string;
  post(body: Record<string, unknown>): Promise<HttpResponse>;
}

/** Launches the drawing tool in an item as a conformant tool does: the login, the authentication request and the id_token. */
export async function launchTool(ctx: Rig, item: ItemKey): Promise<LaunchedTool> {
  const frame = await ltiPlatformFrame(toolLaunch(CANDIDATE, item, ctx.link, 10), ctx.login);
  const initiation = readInitiation(frame.url);
  const parameters = authenticationParameters(initiation);
  const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
  if (page.status !== 200) throw new Error(`The platform refused the authentication request: ${page.body}`);
  const delivered = readPost(page);
  const keys: KeySet = JSON.parse((await platformJwks(ctx.login)).body);
  const claims = await acceptIdToken(delivered.idToken, keys, {
    issuer: PLATFORM_ISSUER,
    nonce: parameters.get("nonce") ?? "",
    clock: ctx.clock,
  });
  const ags = agsClaim(claims);
  const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
  const granted = await platformToken(tokenRequest(endpoints.token, assertion, SCORE_SCOPE), ctx.token);
  if (granted.status !== 200) throw new Error(`The platform refused the token request: ${granted.body}`);
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
export const drawing = (ctx: Rig, seconds: number, change: Record<string, unknown> = {}): Record<string, unknown> => ({
  timestamp: new Date(ctx.clock.now() + seconds * SECOND).toISOString(),
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  scoreGiven: 6,
  scoreMaximum: 10,
  ...change,
});

/** The candidate answers the essay and opens the drawing tool, which the tool has launched. */
export async function openDrawing(ctx: Rig): Promise<LaunchedTool> {
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

export const requestsOf = async (ctx: Rig): Promise<string[]> =>
  (await ctx.host.session(CANDIDATE.session).pending()).scoring.map(({ id }) => id);

/** The types of the events of every step that the host's log saw, in order. */
export async function typesOf(ctx: Rig): Promise<string[]> {
  return (await ctx.outbox.steps(CANDIDATE.session)).flatMap(({ events }) => events.map(({ type }) => type));
}

export const supplyEssay = (ctx: Rig, score: number) =>
  ctx.host
    .session(CANDIDATE.session)
    .apply(
      { type: "supply-scores", request: "item:essay:1:SCORE", value: single("float", score), scorer: "human" },
      { scoredBy: "https://rater.example/raters/17" },
    );

/** The `SCORE` of the test in the results report. */
export async function totalOf(ctx: Rig): Promise<unknown> {
  const { testResult } = await ctx.host.session(CANDIDATE.session).results();
  const score = testResult?.variables.find((variable) => variable.identifier === "SCORE");
  return score?.kind === "outcome" ? score.value : undefined;
}

/** A promise that a test settles from outside, to hold a worker at a chosen point. */
export function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
