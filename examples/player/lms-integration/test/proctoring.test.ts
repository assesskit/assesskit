// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of AGS scores are camelCase or snake_case by the specifications.

import { AccessError } from "@assesskit/player";
import type { HttpRequest } from "@interopkit/core/http";
import { LtiError, SCOPES } from "@interopkit/tool-integration";
import { describe, expect, it } from "vitest";
import { proctoringLaunch } from "../src/index.ts";
import { SUBJECT } from "./fake-lms.ts";
import { acsClaim, controlRequest, PROCTOR, sessionDataOf, startAssessmentRequest } from "./fake-tool.ts";
import { textOf } from "./fixture.ts";
import { CANDIDATE, EXAM_LINK, proctorKeys, type Rig, rig, START_ASSESSMENT_URL, takeThrough, typesOf } from "./rig.ts";

const ISSUER = "https://platform.example";
const ATTEMPT = 1;

/** The proctoring tool after its launch: the message that starts the assessment, and the calls to the control service. */
async function launchProctor(ctx: Rig, attemptNumber = ATTEMPT) {
  const message = proctoringLaunch(
    CANDIDATE,
    { clientId: PROCTOR.clientId, deploymentId: PROCTOR.deploymentId, targetLinkUri: PROCTOR.launchUrl },
    { id: EXAM_LINK, attemptNumber },
    START_ASSESSMENT_URL,
  );
  const launched = await takeThrough(ctx, message, {
    tool: PROCTOR,
    keys: proctorKeys,
    scope: SCOPES.assessmentControl,
    messageType: "LtiStartProctoring",
  });
  const sessionData = sessionDataOf(launched.claims);
  const acs = acsClaim(launched.claims);
  return {
    acs,
    /** The form that sends the candidate back to start the assessment. */
    startRequest: (change: { attemptNumber?: number; nonce?: string } = {}): Promise<HttpRequest> =>
      startAssessmentRequest(PROCTOR, proctorKeys, ctx.clock, {
        url: START_ASSESSMENT_URL,
        issuer: ISSUER,
        sessionData,
        resourceLinkId: EXAM_LINK,
        attemptNumber,
        ...change,
      }),
    /** Sends an action to the Assessment Control Service and returns the status code and the status of the attempt. */
    async control(action: string, attempt = attemptNumber) {
      const answer = await ctx.handle(
        controlRequest(acs.url, launched.accessToken, {
          issuer: ISSUER,
          subject: SUBJECT,
          resourceLinkId: EXAM_LINK,
          attemptNumber: attempt,
          action,
        }),
      );
      return {
        code: answer.status,
        status: answer.status === 200 ? JSON.parse(textOf(answer.body)).status : undefined,
      };
    },
  };
}

/** An exam whose proctoring tool has sent the candidate back, so that the session runs. */
async function started() {
  const ctx = await rig();
  const proctor = await launchProctor(ctx);
  await ctx.proctoring.start(await proctor.startRequest(), CANDIDATE, 7);
  return { ctx, proctor };
}

describe("the launch of a proctoring tool", () => {
  it("offers the actions that the host maps to its proctor, and nothing else", async () => {
    const ctx = await rig();
    const proctor = await launchProctor(ctx);
    expect(proctor.acs.actions).toEqual(["pause", "resume", "terminate"]);
    expect(proctor.acs.url).toBe("https://lti.platform.example/assessment-control");
  });
});

describe("the start of an attempt", () => {
  it("starts the session of the candidate when the tool sends them back, and not before", async () => {
    const ctx = await rig();
    const proctor = await launchProctor(ctx);
    await expect(ctx.host.check(CANDIDATE)).rejects.toBeInstanceOf(AccessError);
    await ctx.proctoring.start(await proctor.startRequest(), CANDIDATE, 7);
    await expect(ctx.host.check(CANDIDATE)).resolves.toBeUndefined();
    expect(await typesOf(ctx)).toContain("presented");
  });

  it("refuses a browser whose user is not the candidate of the Start Proctoring message, and starts nothing", async () => {
    const ctx = await rig();
    const proctor = await launchProctor(ctx);
    const elsewhere = { session: "exam-2", principal: "someone-else" };
    const refused = await ctx.proctoring.start(await proctor.startRequest(), elsewhere, 7).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(LtiError);
    expect(refused).toMatchObject({ reason: "launch-refused", status: 403 });
    await expect(ctx.host.check(elsewhere)).rejects.toBeInstanceOf(AccessError);
    await expect(ctx.host.check(CANDIDATE)).rejects.toBeInstanceOf(AccessError);
  });

  it("refuses a message that is sent twice, and the session of the first stands", async () => {
    const ctx = await rig();
    const proctor = await launchProctor(ctx);
    const message = await proctor.startRequest();
    await ctx.proctoring.start(message, CANDIDATE, 7);
    const refused = await ctx.proctoring.start(message, CANDIDATE, 7).catch((e: unknown) => e);
    expect(refused).toMatchObject({ reason: "nonce-replayed", status: 403 });
    await expect(ctx.host.check(CANDIDATE)).resolves.toBeUndefined();
  });

  it("refuses session data that was sealed for another attempt", async () => {
    const ctx = await rig();
    const proctor = await launchProctor(ctx);
    const refused = await ctx.proctoring
      .start(await proctor.startRequest({ attemptNumber: 2 }), CANDIDATE, 7)
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ reason: "session-data-invalid", status: 403 });
    await expect(ctx.host.check(CANDIDATE)).rejects.toBeInstanceOf(AccessError);
  });
});

describe("the control of an attempt", () => {
  it("pauses the session, resumes it and terminates it, and answers the status after each action", async () => {
    const { ctx, proctor } = await started();
    expect(await proctor.control("update")).toEqual({ code: 200, status: "running" });
    expect(await proctor.control("pause")).toEqual({ code: 200, status: "paused" });
    expect(await typesOf(ctx)).toContain("suspended");
    expect(await proctor.control("resume")).toEqual({ code: 200, status: "running" });
    expect(await typesOf(ctx)).toContain("resumed");
    expect(await proctor.control("terminate")).toEqual({ code: 200, status: "terminated" });
    expect(await typesOf(ctx)).toContain("test-ended");
  });

  it("answers the status as it is to an action that the session does not allow, and changes nothing", async () => {
    const { ctx, proctor } = await started();
    expect(await proctor.control("resume")).toEqual({ code: 200, status: "running" });
    await proctor.control("pause");
    const before = (await ctx.outbox.steps(CANDIDATE.session)).length;
    expect(await proctor.control("pause")).toEqual({ code: 200, status: "paused" });
    expect((await ctx.outbox.steps(CANDIDATE.session)).length).toBe(before);
  });

  it("keeps terminated for a terminated attempt, and answers complete for one that the candidate finished", async () => {
    const { proctor } = await started();
    await proctor.control("terminate");
    expect(await proctor.control("terminate")).toEqual({ code: 200, status: "terminated" });
    expect(await proctor.control("resume")).toEqual({ code: 200, status: "terminated" });
  });

  it("answers complete for an attempt that ended without the tool", async () => {
    const { ctx, proctor } = await started();
    await ctx.host.proctor(CANDIDATE.session, { type: "end-test" });
    expect(await proctor.control("update")).toEqual({ code: 200, status: "complete" });
  });

  it("leaves what the host does not map to the host: a flag changes nothing", async () => {
    const { ctx, proctor } = await started();
    const before = (await ctx.outbox.steps(CANDIDATE.session)).length;
    expect(await proctor.control("flag")).toEqual({ code: 200, status: "running" });
    expect((await ctx.outbox.steps(CANDIDATE.session)).length).toBe(before);
  });

  it("answers 404 for an attempt that the host does not know", async () => {
    const { proctor } = await started();
    expect((await proctor.control("pause", 2)).code).toBe(404);
  });

  it("answers 404 to a tool that did not start the attempt, though the attempt exists", async () => {
    const { ctx } = await started();
    const request = {
      user: { issuer: ISSUER, subject: SUBJECT },
      resourceLink: { id: EXAM_LINK },
      attemptNumber: ATTEMPT,
      action: "terminate",
    } as const;
    expect(await ctx.proctoring.control.control({ clientId: "another-proctor" }, request)).toBeUndefined();
    expect(await ctx.proctoring.control.control({ clientId: PROCTOR.clientId }, request)).toEqual({
      status: "terminated",
    });
  });
});
