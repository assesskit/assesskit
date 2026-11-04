// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.
import type { Caller, ViewEnvelope } from "@assesskit/player/protocol";
import {
  createToolScoreIntake,
  type ToolScore,
  type ToolScoreIntake,
  type ToolScoreStore,
} from "@assesskit/player/server";
import type { ItemKey } from "@assesskit/runtime/delivery";
import { type CandidateAction, writeCandidateAction } from "@assesskit/runtime/delivery/wire";
import { type LtiLink, readLtiLink } from "@assesskit/runtime/package";
import { buildSingle } from "@assesskit/runtime/values";
import { createCryptoKeySigner, type Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { createJwksCache, type LtiMessage, SCOPES } from "@interopkit/tool-integration";
import {
  buildPlatformEndpoints,
  handlePlatformRequest,
  type LaunchStore,
  type MessageInput,
  type PlatformConfig,
  type PlatformLoginOptions,
  type PlatformRequestOptions,
  prepareToolFrame,
  type ToolMessageOptions,
} from "@interopkit/tool-integration/platform";
import { handleLaunch, handleLogin, type PlatformRegistration } from "@interopkit/tool-integration/tool";
import {
  checkBrowser,
  checkSession,
  createGradebook,
  createProctoring,
  type MemoryOutbox,
  memoryOutbox,
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
  DRAWING,
  type FakeTool,
  type KeySet,
  PROCTOR,
  readInitiation,
  tokenRequest,
  toolRegistration,
} from "./fake-tool.ts";
import { createClock, generateKeyPair, request, textOf, unescapeHtml } from "./fixture.ts";

/**
 * Three LTI relationships around one exam. A learning platform launches the exam as a tool, and the exam's results go back to its
 * line item (the tool role). The exam holds a link to a drawing tool, which the host launches as a platform, and whose scores
 * reach the session through the gradebook; a proctoring tool starts the candidate's session and controls it (the platform
 * role). The learning platform, the drawing tool and the proctoring tool are fakes written from the specifications.
 */

const PLATFORM_ISSUER = "https://platform.example";
const PLATFORM_ORIGIN = "https://lti.platform.example";
export const START_ASSESSMENT_URL = "https://player.platform.example/proctoring/start";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const ESSAY: ItemKey = { ref: "essay", instance: 1 };
export const DRAW: ItemKey = { ref: "draw", instance: 1 };
export const CANDIDATE: Caller = { session: "exam-1", principal: SUBJECT };
const SECOND = 1000;
/** Returns the user of the session that the cookie `session` of a request names, or `undefined` when it names none. */
const sessionOf = (httpRequest: HttpRequest): string | undefined =>
  /(?:^|;\s*)session=([^;]*)/u.exec(httpRequest.headers.cookie ?? "")?.[1];
/** The IRIs of the parties of the events, which are the host's to name. */
export const PARTIES = {
  actor: "urn:uuid:0b9c4c4e-0d3c-4f8e-9a53-6d1b6f0d9a11",
  assessment: "https://exam.example/tests/42",
  edApp: "https://exam.example",
};
const SCORER = DRAWING.launchUrl;
const CALIPER_ENDPOINT = "https://lrs.example/caliper";
/** The resource link of the exam that the proctoring tool is launched for. */
export const EXAM_LINK = "exam-42";

const platformKeys = await generateKeyPair("platform-1");
const lmsKeys = await generateKeyPair("lms-1");
const examKeys = await generateKeyPair("exam-1");
export const toolKeys = await generateKeyPair("tool-key-1");
export const proctorKeys = await generateKeyPair("proctor-key-1");
const hintKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const config: PlatformConfig = {
  issuer: PLATFORM_ISSUER,
  origin: PLATFORM_ORIGIN,
  frameOrigin: "https://player.platform.example",
  reservedOrigins: ["https://assets.platform.example"],
  keys: {
    signer: createCryptoKeySigner(platformKeys.privateKey, { algorithm: "RS256", keyId: platformKeys.kid }),
    publicKeys: [platformKeys.publicJwk],
  },
  hintKey,
};
export const endpoints = buildPlatformEndpoints(config);

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

/** The launches in progress, in memory: a real host keeps them where every process can reach them, for 300 seconds. */
function launchStore(): LaunchStore {
  const kept = new Map<string, MessageInput>();
  return {
    put: async (id, message) => void kept.set(id, message),
    take: async (id) => {
      const message = kept.get(id);
      kept.delete(id);
      return message;
    },
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
      envelopes.push(JSON.parse(textOf(init.body)));
      return new Response("", { status: 200 });
    },
  };
}

/** The exam with its LTI relationships and the jobs, wired as a host would wire them. */
export async function rig(files: Readonly<Record<string, string>> = examFiles({ maximum: 20 })) {
  const clock = createClock();
  const scores = toolScoreStore();
  const outbox: MemoryOutbox = memoryOutbox();
  const pkg = packageOf(files);
  const host = await sessionHostOver(pkg, clock, { log: outboxLog(outbox) });
  const intake: ToolScoreIntake = createToolScoreIntake({ host, scores, scoredBy: async () => SCORER });

  // The tools of the platform role: the registrations, the ledger of single-use identifiers and the cache of key sets.
  const tool = toolRegistration(DRAWING, new Map([[toolKeys.kid, toolKeys.publicKey]]), [
    SCOPES.score,
    SCOPES.lineitemReadonly,
  ]);
  const proctor = toolRegistration(PROCTOR, new Map([[proctorKeys.kid, proctorKeys.publicKey]]), [
    SCOPES.assessmentControl,
  ]);
  const tools = async (clientId: string) => [tool, proctor].find((each) => each.clientId === clientId);
  const used = new Set<string>();
  const once = async (id: string): Promise<boolean> => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
  const jwks = createJwksCache({ fetch: async () => new Response("", { status: 404 }) });
  const launches = launchStore();
  const toolMessage: ToolMessageOptions = { config, clock, client: tools, jwks, once };
  const gradebook = createGradebook({
    host,
    intake,
    linkOf: async (session, item) =>
      session === CANDIDATE.session && item.ref === DRAW.ref
        ? { clientId: tool.clientId, label: "Drawing tool", scoreMaximum: 10 }
        : undefined,
  });
  const proctoring = createProctoring({ host, tool: toolMessage });
  /** The options of the login for the request of the browser whose user is `principal`. */
  const loginFor = (principal = CANDIDATE.principal): PlatformLoginOptions => ({
    config,
    clock,
    registration: tools,
    check: checkSession(host, principal),
    launches,
  });
  /** The options of the handler, which serve every browser: the request says whose session it belongs to. */
  const requests: PlatformRequestOptions = {
    config,
    clock,
    client: tools,
    launches,
    once,
    jwks,
    checkLaunch: checkBrowser(sessionOf),
    services: { gradebook, control: proctoring.control },
  };
  /** Answers a request to the platform's origin, as the host's route does for the browser of `principal`, whose cookie names its session. */
  const handle = (httpRequest: HttpRequest, principal = CANDIDATE.principal): Promise<HttpResponse> =>
    handlePlatformRequest(
      { ...httpRequest, headers: { ...httpRequest.headers, cookie: `session=${principal}` } },
      requests,
    );
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
  const started = await handleLogin(lmsPlatform.initiation(), toolOptions);
  const auth = await lmsPlatform.authenticate(started.headers.location ?? "", { claims: { sub: SUBJECT } });
  const launched = await handleLaunch(auth.post({ cookie: cookieOf(started.headers["set-cookie"]) }), toolOptions);
  if (!("messageType" in launched)) throw new Error("The launch is a page.");
  const launch: LtiMessage = launched;

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
    return host.handle(CANDIDATE, { seq, action: writeCandidateAction(action) });
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
    loginFor,
    handle,
    gradebook,
    proctoring,
    tool,
    proctor,
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
  for (const [, name = "", value = ""] of textOf(response.body).matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/gu,
  )) {
    inputs.set(name, unescapeHtml(value));
  }
  return { action: "", idToken: inputs.get("id_token") ?? "", state: inputs.get("state") ?? "" };
}

/** What a tool has after its launch: the id_token of the message and a token of the service it asked for. */
export interface Launched {
  readonly claims: Record<string, unknown>;
  readonly storageTarget: string;
  /** The bearer token of the service, for the scope asked for. */
  readonly accessToken: string;
}

/**
 * Takes a tool through the launch as a conformant tool does: the login, the authentication request, the id_token and a token for
 * a scope. `browser` is the user of the browser's session at the platform.
 */
export async function takeThrough(
  ctx: Rig,
  message: MessageInput,
  options: {
    tool: FakeTool;
    keys: typeof toolKeys;
    scope: string;
    browser?: string;
    messageType?: "LtiStartProctoring";
  },
): Promise<Launched> {
  const { tool, keys, scope, browser = CANDIDATE.principal, messageType } = options;
  const frame = await prepareToolFrame(message, ctx.loginFor(browser));
  const initiation = readInitiation(frame.url, tool);
  const parameters = authenticationParameters(initiation, tool);
  const page = await ctx.handle(authenticationRequest(endpoints.authorization, parameters), browser);
  if (page.status !== 200) throw new Error(`The platform refused the authentication request: ${textOf(page.body)}`);
  const delivered = readPost(page);
  const keySet: KeySet = JSON.parse(textOf((await ctx.handle(request({ url: endpoints.jwks }))).body));
  const claims = await acceptIdToken(delivered.idToken, keySet, {
    issuer: PLATFORM_ISSUER,
    nonce: parameters.get("nonce") ?? "",
    clock: ctx.clock,
    tool,
    ...(messageType === undefined ? {} : { messageType }),
  });
  const assertion = await clientAssertion(keys, endpoints.token, ctx.clock, {}, tool);
  const granted = await ctx.handle(tokenRequest(endpoints.token, assertion, scope));
  if (granted.status !== 200) throw new Error(`The platform refused the token request: ${textOf(granted.body)}`);
  const accessToken: string = JSON.parse(textOf(granted.body)).access_token;
  return { claims, storageTarget: initiation.storageTarget, accessToken };
}

/** The drawing tool after its launch: it posts scores to the line item as the specification says a tool may. */
export interface LaunchedTool {
  readonly storageTarget: string;
  /** The address of the line item that the launch offered. */
  readonly lineItem: string;
  /** Reads the line item, as a tool does to learn its maximum. */
  read(): Promise<HttpResponse>;
  post(body: Record<string, unknown>): Promise<HttpResponse>;
}

/** Launches the drawing tool in an item as a conformant tool does, and returns what it can do with the line item. */
export async function launchTool(ctx: Rig, item: ItemKey): Promise<LaunchedTool> {
  const launched = await takeThrough(ctx, toolLaunch(CANDIDATE, item, ctx.link, DRAWING), {
    tool: DRAWING,
    keys: toolKeys,
    scope: `${SCOPES.score} ${SCOPES.lineitemReadonly}`,
  });
  const { lineitem } = agsClaim(launched.claims);
  return {
    storageTarget: launched.storageTarget,
    lineItem: lineitem,
    read: () =>
      ctx.handle(
        request({
          url: lineitem,
          headers: { authorization: `Bearer ${launched.accessToken}`, accept: LINE_ITEM_TYPE },
        }),
      ),
    post: (body) =>
      ctx.handle(
        request({
          method: "POST",
          url: `${lineitem}/scores`,
          headers: { authorization: `Bearer ${launched.accessToken}`, "content-type": SCORE_TYPE },
          body: JSON.stringify({ userId: SUBJECT, ...body }),
        }),
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
    responses: new Map([["RESPONSE", buildSingle("string", "An essay.")]]),
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
      { type: "supply-scores", request: "item:essay:1:SCORE", value: buildSingle("float", score), scorer: "human" },
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
