// biome-ignore-all lint/style/useNamingConvention: the names of AGS scores are camelCase by the specification.

import type { StepEvents } from "@assesskit/player/server";
import { DataError } from "@assesskit/runtime/errors";
import { type Fetch, ServiceError } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDue, type Outbox, runPublishJob, toAgsScore } from "../src/index.ts";
import { examFiles } from "./exam.ts";
import { CANDIDATE, DRAW, deferred, drawing, openDrawing, type Rig, rig, supplyEssay } from "./rig.ts";

afterEach(() => vi.useRealTimers());

const SESSION = CANDIDATE.session;

/** An exam whose test has ended, with a person's score and the tool's, so that the grade is complete. */
async function ended(): Promise<Rig> {
  const ctx = await rig();
  const tool = await openDrawing(ctx);
  await ctx.send({ type: "submit", item: DRAW });
  await tool.post(drawing(ctx, 10));
  await supplyEssay(ctx, 8);
  ctx.clock.advance(60);
  await ctx.host.proctor(SESSION, { type: "end-test" });
  return ctx;
}

/** The fetch of the tool role, which hands every score request to the platform and then never answers it. */
function withholdScores(ctx: Rig, arrived: () => void): Fetch {
  return async (url, init) => {
    const response = await ctx.lms.fetch(url, init);
    if (!url.endsWith("/scores")) return response;
    arrived();
    return new Promise<Response>(() => undefined);
  };
}

const times = (ctx: Rig): number[] => ctx.lms.received.map(({ timestamp }) => Date.parse(String(timestamp)));

/** An outbox over another one, with the methods that a test replaces. */
const wrapped = (outbox: Outbox, change: Partial<Outbox>): Outbox => ({
  append: (...args) => outbox.append(...args),
  steps: (...args) => outbox.steps(...args),
  unhandled: (...args) => outbox.unhandled(...args),
  markHandled: (...args) => outbox.markHandled(...args),
  progress: (...args) => outbox.progress(...args),
  nextAttempt: (...args) => outbox.nextAttempt(...args),
  markSent: (...args) => outbox.markSent(...args),
  markFailed: (...args) => outbox.markFailed(...args),
  claim: (...args) => outbox.claim(...args),
  ...change,
});

describe("runPublishJob", () => {
  it("sends the latest state, and a second run with nothing new sends nothing", async () => {
    const ctx = await ended();
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("published");
    expect(ctx.lms.accepted).toHaveLength(1);
    expect(ctx.lms.accepted[0]).toMatchObject({ gradingProgress: "FullyGraded", scoreGiven: 14, scoreMaximum: 20 });
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("idle");
    expect(ctx.lms.received).toHaveLength(1);
  });

  it("takes a later time for a resend after the request timed out, though the platform may have had the first", async () => {
    const ctx = await ended();
    const tool = { ...ctx.jobs.publish.tool, fetch: withholdScores(ctx, () => undefined), timeoutMs: 500 };
    const error = await runPublishJob(SESSION, { ...ctx.jobs.publish, tool }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 0 });
    // The platform had the score, and the job did not learn it: the outbox does not count the steps as published.
    expect(ctx.lms.accepted).toHaveLength(1);
    expect((await ctx.outbox.progress(SESSION)).through).toBe(0);
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("published");
    const [first, second] = times(ctx);
    expect(second).toBe((first ?? 0) + 1);
    // Both reached the platform with the same score and times that strictly increase, as the score service requires.
    expect(ctx.lms.accepted).toHaveLength(2);
    expect(ctx.lms.accepted.map(({ scoreGiven }) => scoreGiven)).toEqual([14, 14]);
  });

  it("takes a later time for a resend after the caller aborted the request in flight", async () => {
    const ctx = await ended();
    const controller = new AbortController();
    const arrived = deferred();
    const tool = { ...ctx.jobs.publish.tool, fetch: withholdScores(ctx, () => arrived.resolve()) };
    const running = runPublishJob(SESSION, { ...ctx.jobs.publish, tool }, { signal: controller.signal });
    const settled = running.catch((error: unknown) => error);
    await arrived.promise;
    const reason = new Error("The job was stopped.");
    controller.abort(reason);
    expect(await settled).toBe(reason);
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("published");
    const [first, second] = times(ctx);
    expect(second).toBeGreaterThan(first ?? 0);
    expect(ctx.lms.accepted).toHaveLength(2);
  });

  it("takes a later time for a resend after a crash between the request and the mark", async () => {
    const ctx = await ended();
    let crashes = 1;
    const outbox = wrapped(ctx.outbox, {
      markSent: async (...args) => {
        if (crashes-- > 0) throw new Error("The process was killed.");
        return ctx.outbox.markSent(...args);
      },
    });
    await expect(runPublishJob(SESSION, { ...ctx.jobs.publish, outbox })).rejects.toThrow("The process was killed.");
    expect(ctx.lms.accepted).toHaveLength(1);
    expect(await runPublishJob(SESSION, { ...ctx.jobs.publish, outbox })).toBe("published");
    const [first, second] = times(ctx);
    expect(second).toBe((first ?? 0) + 1);
    expect(ctx.lms.accepted).toHaveLength(2);
    expect(await runPublishJob(SESSION, { ...ctx.jobs.publish, outbox })).toBe("idle");
  });

  it("takes a later time for a retry after the platform refused the score", async () => {
    const ctx = await ended();
    ctx.lms.scoreStatus = 503;
    await expect(runPublishJob(SESSION, ctx.jobs.publish)).rejects.toMatchObject({ status: 503 });
    ctx.lms.scoreStatus = undefined;
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("published");
    const [first, second] = times(ctx);
    expect(second).toBe((first ?? 0) + 1);
    expect(ctx.lms.accepted).toHaveLength(1);
  });

  it("releases the claim when it fails, so that the retry can run", async () => {
    const ctx = await ended();
    ctx.lms.scoreStatus = 503;
    await expect(runPublishJob(SESSION, ctx.jobs.publish)).rejects.toThrow(ServiceError);
    ctx.lms.scoreStatus = undefined;
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("published");
  });

  it("marks the session failed when it has no launch, or a launch that offers no line item, and does not try again", async () => {
    const ctx = await ended();
    const none = { ...ctx.jobs.publish, launchOf: async () => undefined };
    expect(await runPublishJob(SESSION, none)).toBe("failed");
    expect((await ctx.outbox.progress(SESSION)).failed).toContain("no launch of a user with a line item");
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("failed");
    expect(ctx.lms.received).toEqual([]);

    const other = await ended();
    const bare = { ...other.launch, services: {} };
    expect(await runPublishJob(SESSION, { ...other.jobs.publish, launchOf: async () => bare })).toBe("failed");
    expect(other.lms.received).toEqual([]);

    const anonymous = await ended();
    const nobody = { ...anonymous.launch, user: {} };
    expect(await runPublishJob(SESSION, { ...anonymous.jobs.publish, launchOf: async () => nobody })).toBe("failed");
    expect(anonymous.lms.received).toEqual([]);
  });

  it("marks the session failed when the results have no maximum and the line item is gone, and does not try again", async () => {
    const ctx = await rig(examFiles());
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await tool.post(drawing(ctx, 10));
    await supplyEssay(ctx, 8);
    await ctx.host.proctor(SESSION, { type: "end-test" });
    ctx.lms.lineItemGone = true;
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("failed");
    expect((await ctx.outbox.progress(SESSION)).failed).toContain("no longer exists");
    ctx.lms.lineItemGone = false;
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("failed");
    expect(ctx.lms.received).toEqual([]);
  });

  it("marks the session failed when the report gives no score, and a rerun does not try again", async () => {
    const ctx = await ended();
    // A copy of the report is not the official one that the session host returned.
    const host = {
      session: (id: string) => ({
        ...ctx.host.session(id),
        results: async () => ({ ...(await ctx.host.session(id).results()) }),
      }),
    };
    const copying = { ...ctx.jobs.publish, host: host as never };
    expect(await runPublishJob(SESSION, copying)).toBe("failed");
    expect((await ctx.outbox.progress(SESSION)).failed).toContain("not official");
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("failed");
    expect(ctx.lms.received).toEqual([]);
  });

  it("lets only one worker run for a session, so that the platform keeps the latest score", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await ctx.host.proctor(SESSION, { type: "end-test" });
    await supplyEssay(ctx, 8);
    // The first worker has read the state in which only the tool is missing and waits to take its time.
    const reachedTime = deferred();
    const release = deferred();
    const stalled = wrapped(ctx.outbox, {
      nextAttempt: async (...args) => {
        reachedTime.resolve();
        await release.promise;
        return ctx.outbox.nextAttempt(...args);
      },
    });
    const first = runPublishJob(SESSION, { ...ctx.jobs.publish, outbox: stalled });
    await reachedTime.promise;
    // Meanwhile the tool posts its final score, and a second worker is started for the new step.
    await tool.post(drawing(ctx, 0));
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("busy");
    expect(ctx.lms.received).toEqual([]);
    release.resolve();
    expect(await first).toBe("published");
    expect(ctx.lms.accepted.map(({ gradingProgress }) => gradingProgress)).toEqual(["Pending"]);
    // The queue retries the second worker: it sends the state it missed, with a later time.
    expect(await runPublishJob(SESSION, ctx.jobs.publish)).toBe("published");
    expect(ctx.lms.accepted.map(({ gradingProgress }) => gradingProgress)).toEqual(["Pending", "FullyGraded"]);
    const stamps = times(ctx);
    expect(stamps[1]).toBeGreaterThan(stamps[0] ?? 0);
  });

  it("leaves the older score on the platform when two workers run at once, which is why one runs", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    await ctx.send({ type: "submit", item: DRAW });
    await ctx.host.proctor(SESSION, { type: "end-test" });
    await supplyEssay(ctx, 8);
    const reachedTime = deferred();
    const release = deferred();
    // Without the claim, both workers run.
    const unclaimed = (outbox: Outbox): Outbox => wrapped(outbox, { claim: async () => async () => undefined });
    const stalled = wrapped(unclaimed(ctx.outbox), {
      nextAttempt: async (...args) => {
        reachedTime.resolve();
        await release.promise;
        return ctx.outbox.nextAttempt(...args);
      },
    });
    const first = runPublishJob(SESSION, { ...ctx.jobs.publish, outbox: stalled });
    await reachedTime.promise;
    await tool.post(drawing(ctx, 0));
    expect(await runPublishJob(SESSION, { ...ctx.jobs.publish, outbox: unclaimed(ctx.outbox) })).toBe("published");
    release.resolve();
    expect(await first).toBe("published");
    expect(ctx.lms.accepted.map(({ gradingProgress }) => gradingProgress)).toEqual(["FullyGraded", "Pending"]);
  });
});

describe("isDue", () => {
  const step = (number: number, ...types: string[]): StepEvents => ({
    session: SESSION,
    step: number,
    events: types.map((type) => ({ type, at: number }) as StepEvents["events"][number]),
  });

  it("is not due before the test has ended, whatever else the steps hold", () => {
    expect(isDue([], 0)).toBe(false);
    expect(isDue([step(1, "presented"), step(2, "scores-applied", "scores-replaced")], 0)).toBe(false);
  });

  it("is due for the step that ends the test, and for a score that applies or replaces after it", () => {
    const steps = [step(1, "presented"), step(2, "test-ended")];
    expect(isDue(steps, 0)).toBe(true);
    expect(isDue(steps, 2)).toBe(false);
    expect(isDue([...steps, step(3, "scores-applied")], 2)).toBe(true);
    expect(isDue([...steps, step(3, "scores-replaced")], 2)).toBe(true);
    expect(isDue([...steps, step(3, "moved", "scoring-requested")], 2)).toBe(false);
  });

  it("is due for a score that applies before the step is covered, when the test ended in an earlier step", () => {
    expect(isDue([step(1, "test-ended"), step(2, "scores-applied")], 1)).toBe(true);
  });
});

describe("toAgsScore", () => {
  const at = "2023-11-14T22:13:20.000Z";

  it("maps the progress of the scoring to the grading progress, and always completes the activity", () => {
    expect(toAgsScore({ progress: "complete", timestamp: at, score: 3, maximum: 4 }, "u1", at)).toEqual({
      userId: "u1",
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: at,
      scoreGiven: 3,
      scoreMaximum: 4,
    });
    expect(
      toAgsScore({ progress: "awaiting-service", timestamp: at, score: 3, maximum: 4 }, "u1", at).gradingProgress,
    ).toBe("Pending");
    expect(toAgsScore({ progress: "awaiting-person", timestamp: at, maximum: 4 }, "u1", at)).toEqual({
      userId: "u1",
      activityProgress: "Completed",
      gradingProgress: "PendingManual",
      timestamp: at,
    });
  });

  it("tells a raised negative score in the comment, and takes the time that it is given and not the score's", () => {
    const later = "2023-11-14T22:13:21.000Z";
    expect(
      toAgsScore({ progress: "complete", timestamp: at, score: 0, maximum: 10, rawScore: -2.5 }, "u1", later),
    ).toMatchObject({ scoreGiven: 0, comment: "Raw score: -2.5", timestamp: later });
  });

  it("throws no error of its own for a report with neither score nor maximum", () => {
    expect(() => toAgsScore({ progress: "complete", timestamp: at }, "u1", at)).not.toThrow(DataError);
  });
});
