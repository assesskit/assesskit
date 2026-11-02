// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of AGS scores are camelCase or snake_case by the specifications.

import { AccessError } from "@assesskit/player";
import type { ViewEnvelope } from "@assesskit/player/protocol";
import { viewFromJson } from "@assesskit/runtime/delivery";
import { single } from "@assesskit/runtime/values";
import { ltiPlatformFrame } from "@interopkit/tool-integration/platform";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSettleJob, toolLaunch } from "../src/index.ts";
import { examFiles } from "./exam.ts";
import { LINE_ITEM_URL, SUBJECT } from "./fake-lms.ts";
import { authenticationParameters, DRAWING, readInitiation } from "./fake-tool.ts";
import { request, textOf } from "./fixture.ts";
import {
  CANDIDATE,
  DRAW,
  drawing,
  endpoints,
  launchTool,
  openDrawing,
  requestsOf,
  rig,
  supplyEssay,
  totalOf,
  typesOf,
} from "./rig.ts";

/**
 * Two LTI relationships around one exam, wired as a host wires them: the platform role launches the drawing tool of an item and
 * takes its scores into the session, and the jobs publish the grade to the learning platform that launched the exam. The jobs
 * run when the test says, as a host's queue runs them after the steps.
 */

afterEach(() => vi.useRealTimers());

const viewOf = (envelope: ViewEnvelope) => viewFromJson(envelope.view);

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

  it("refuses the authentication request of another user's browser, and leaves the launch for the candidate's own", async () => {
    const ctx = await rig();
    await ctx.host.start(CANDIDATE, { seed: 7 });
    const frame = await ltiPlatformFrame(toolLaunch(CANDIDATE, DRAW, ctx.link, DRAWING), ctx.loginFor());
    const parameters = authenticationParameters(readInitiation(frame.url));
    const authenticate = (browser: string) =>
      ctx.handle(request({ url: `${endpoints.authorization}?${parameters}` }), browser);
    const refused = await authenticate("someone-else");
    expect(refused.status).toBe(403);
    expect(textOf(refused.body)).not.toContain("id_token");
    expect((await authenticate(CANDIDATE.principal)).status).toBe(200);
  });

  it("refuses to launch an item for a session that is not the browser's user's, before anything is kept", async () => {
    const ctx = await rig();
    await ctx.host.start(CANDIDATE, { seed: 7 });
    const message = toolLaunch({ ...CANDIDATE, session: "exam-2" }, DRAW, ctx.link, DRAWING);
    await expect(ltiPlatformFrame(message, ctx.loginFor())).rejects.toBeInstanceOf(AccessError);
    const other = toolLaunch({ ...CANDIDATE, principal: "someone-else" }, DRAW, ctx.link, DRAWING);
    await expect(ltiPlatformFrame(other, ctx.loginFor())).rejects.toBeInstanceOf(AccessError);
  });

  it("keeps interim progress, and supplies a final score to the requests that the item makes when the candidate leaves it", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    const interim = drawing(ctx, 10, {
      gradingProgress: "NotReady",
      activityProgress: "Started",
      scoreGiven: undefined,
      scoreMaximum: undefined,
    });
    expect((await tool.post(interim)).status).toBe(204);
    expect((await tool.post(drawing(ctx, 30))).status).toBe(204);
    // The tool graded while the candidate was still in the item: the runtime has made no request for it yet.
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE"]);
    expect(ctx.scores.kept.size).toBe(1);
    ctx.clock.advance(60);
    await ctx.send({ type: "submit", item: DRAW });
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE", "item:draw:1:SCORE", "item:draw:1:MAXSCORE"]);
    await runSettleJob(CANDIDATE.session, ctx.jobs.settle);
    expect(await requestsOf(ctx)).toEqual(["item:essay:1:SCORE"]);
    expect(await totalOf(ctx)).toEqual(single("float", 6));
    expect(await typesOf(ctx)).toContain("scores-applied");
  });

  it("settles again without a step, because the requests it would supply are answered", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await tool.post(drawing(ctx, 30));
    await ctx.send({ type: "submit", item: DRAW });
    await runSettleJob(CANDIDATE.session, ctx.jobs.settle);
    const before = (await ctx.outbox.steps(CANDIDATE.session)).length;
    await runSettleJob(CANDIDATE.session, ctx.jobs.settle);
    await runSettleJob(CANDIDATE.session, ctx.jobs.settle);
    expect((await ctx.outbox.steps(CANDIDATE.session)).length).toBe(before);
  });

  it("ignores a score that is earlier than the kept one, keeps one at the same time again, and keeps a later one", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await tool.post(drawing(ctx, 30, { scoreGiven: 6 }));
    await tool.post(drawing(ctx, 20, { scoreGiven: 9 }));
    expect([...ctx.scores.kept.values()].map(({ scoreGiven }) => scoreGiven)).toEqual([6]);
    await tool.post(drawing(ctx, 30, { scoreGiven: 8 }));
    expect([...ctx.scores.kept.values()].map(({ scoreGiven }) => scoreGiven)).toEqual([8]);
    await tool.post(drawing(ctx, 40, { scoreGiven: 7 }));
    expect([...ctx.scores.kept.values()].map(({ scoreGiven }) => scoreGiven)).toEqual([7]);
  });

  it("does not supply a score that is not final", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    const open = ["item:essay:1:SCORE", "item:draw:1:SCORE", "item:draw:1:MAXSCORE"];
    expect(await requestsOf(ctx)).toEqual(open);
    await tool.post(
      drawing(ctx, 10, { gradingProgress: "PendingManual", scoreGiven: undefined, scoreMaximum: undefined }),
    );
    await tool.post(drawing(ctx, 20, { gradingProgress: "Pending" }));
    expect(await requestsOf(ctx)).toEqual(open);
  });

  it("replaces the values of the requests when a later final score arrives", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10, { scoreGiven: 6 }));
    expect(await totalOf(ctx)).toEqual(single("float", 6));
    await tool.post(drawing(ctx, 20, { scoreGiven: 9 }));
    expect(await totalOf(ctx)).toEqual(single("float", 9));
    const types = await typesOf(ctx);
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
    expect(await ctx.runJobs()).toBe("published");
    expect(ctx.lms.accepted.at(-1)).toEqual({
      userId: SUBJECT,
      timestamp: new Date(ctx.clock.now()).toISOString(),
      activityProgress: "Completed",
      gradingProgress: "PendingManual",
    });

    // The person scores the essay; only the tool is left.
    ctx.clock.advance(60);
    expect((await supplyEssay(ctx, 8)).refusal).toBeUndefined();
    expect(await ctx.runJobs()).toBe("published");
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
    expect(await ctx.runJobs()).toBe("published");
    expect(ctx.lms.accepted.at(-1)).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14, scoreMaximum: 20 });
    expect(ctx.lms.accepted.map(({ gradingProgress }) => gradingProgress)).toEqual([
      "PendingManual",
      "Pending",
      "FullyGraded",
    ]);
    const stamps = ctx.lms.accepted.map(({ timestamp }) => Date.parse(String(timestamp)));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(3);
    // Nothing changed since: the job has nothing to send.
    expect(await ctx.runJobs()).toBe("idle");
    expect(ctx.lms.accepted).toHaveLength(3);
  });

  it("sends a negative SCORE as 0, with the raw score in the comment, and publishes a regrade with a later time", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10, { scoreGiven: 6 }));
    await supplyEssay(ctx, 8);
    ctx.clock.advance(60);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    await ctx.runJobs();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14 });
    // A penalty makes the total negative.
    ctx.clock.advance(60);
    await supplyEssay(ctx, -20);
    expect(await totalOf(ctx)).toEqual(single("float", -14));
    await ctx.runJobs();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({
      gradingProgress: "FullyGraded",
      scoreGiven: 0,
      scoreMaximum: 20,
      comment: "Raw score: -14",
    });
  });

  it("reads the scoreMaximum from the line item when the results have no MAXSCORE", async () => {
    const ctx = await rig(examFiles());
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10, { scoreGiven: 6 }));
    await supplyEssay(ctx, 8);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    ctx.lms.scoreMaximum = 40;
    await ctx.runJobs();
    expect(ctx.lms.accepted.at(-1)).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14, scoreMaximum: 40 });
    expect(ctx.lms.calls).toEqual([`GET ${LINE_ITEM_URL}`, `POST ${LINE_ITEM_URL}/scores`]);
  });

  it("holds the grade back until the test has ended, though scores arrive before", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10));
    await supplyEssay(ctx, 8);
    expect(await ctx.runJobs()).toBe("idle");
    expect(ctx.lms.received).toEqual([]);
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    expect(await ctx.runJobs()).toBe("published");
    expect(ctx.lms.accepted).toHaveLength(1);
  });
});
