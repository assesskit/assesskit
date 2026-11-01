import { single } from "@assesskit/runtime/values";
import { type Fetch, ServiceError } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EventJobOptions, runEventJob } from "../src/index.ts";
import { textOf } from "./fixture.ts";
import { CANDIDATE, DRAW, openDrawing, PARTIES, type Rig, rig } from "./rig.ts";

afterEach(() => vi.useRealTimers());

const SESSION = CANDIDATE.session;
const RATER = "https://rater.example/raters/17";

/** The identifiers of the events in the envelopes that the fake endpoint received. */
const idsOf = (ctx: Rig): string[] => ctx.endpoint.envelopes.flatMap(({ data }) => data.map(({ id }) => String(id)));

const supply = (ctx: Rig, scoredBy?: string) =>
  ctx.host
    .session(SESSION)
    .apply(
      { type: "supply-scores", request: "item:essay:1:SCORE", value: single("float", 8), scorer: "human" },
      scoredBy === undefined ? {} : { scoredBy },
    );

/** The options of the job, with another `fetch` for the sender. */
const sendingWith = (ctx: Rig, fetch: Fetch): EventJobOptions => ({
  ...ctx.jobs.events,
  sender: { ...ctx.jobs.events.sender, fetch },
});

describe("runEventJob", () => {
  it("sends the Caliper events of each step in one envelope, and sends nothing for steps it has handled", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    const result = await runEventJob(SESSION, ctx.jobs.events);
    expect(result.refused).toEqual([]);
    // The start step, the move to the item and the first views carry events; the steps without a Caliper event send none.
    expect(result.sent).toBe(ctx.endpoint.envelopes.length);
    expect(result.sent).toBeGreaterThan(0);
    expect(ctx.endpoint.envelopes[0]?.sendTime).toBe(new Date(ctx.clock.now()).toISOString());
    expect(ctx.endpoint.envelopes[0]?.data.map(({ type, action }) => `${type} ${action}`)).toContain(
      "AssessmentEvent Started",
    );
    expect(await ctx.outbox.unhandled(SESSION)).toEqual([]);
    expect(await runEventJob(SESSION, ctx.jobs.events)).toEqual({ sent: 0, refused: [] });
    expect(ctx.endpoint.envelopes).toHaveLength(result.sent);
  });

  it("sends the steps that failed again, with the same identifiers, when the endpoint was down", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    const attempts: string[] = [];
    let down = true;
    const fetch: Fetch = async (url, init) => {
      attempts.push(
        JSON.parse(textOf(init.body))
          .data.map((event: { id: string }) => event.id)
          .join(),
      );
      return down ? new Response("unavailable", { status: 503 }) : ctx.endpoint.fetch(url, init);
    };
    const error = await runEventJob(SESSION, sendingWith(ctx, fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 503 });
    expect((await ctx.outbox.unhandled(SESSION)).length).toBeGreaterThan(0);
    down = false;
    await runEventJob(SESSION, sendingWith(ctx, fetch));
    expect(attempts[0]).toBe(attempts[1]);
    expect(await ctx.outbox.unhandled(SESSION)).toEqual([]);
  });

  it("sends a step again with the same identifiers after a crash between the send and the mark", async () => {
    const ctx = await rig();
    await ctx.host.start(CANDIDATE, { seed: 7 });
    let crashes = 1;
    const outbox = {
      ...ctx.outbox,
      markHandled: async (...args: Parameters<Rig["outbox"]["markHandled"]>) => {
        if (crashes-- > 0) throw new Error("The process was killed.");
        return ctx.outbox.markHandled(...args);
      },
    };
    await expect(runEventJob(SESSION, { ...ctx.jobs.events, outbox })).rejects.toThrow("The process was killed.");
    await runEventJob(SESSION, ctx.jobs.events);
    const ids = idsOf(ctx);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.slice(0, ids.length / 2)).toEqual(ids.slice(ids.length / 2));
  });

  it("reports the score that a rater supplied as a GradeEvent scored by the rater, for the attempt at the test", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    await runEventJob(SESSION, ctx.jobs.events);
    const before = ctx.endpoint.envelopes.length;
    await ctx.send({ type: "submit", item: DRAW });
    await supply(ctx, RATER);
    await runEventJob(SESSION, ctx.jobs.events);
    const grades = ctx.endpoint.envelopes
      .slice(before)
      .flatMap(({ data }) => data.filter(({ type }) => type === "GradeEvent"));
    expect(grades).toHaveLength(1);
    expect(grades[0]).toMatchObject({
      actor: { id: RATER, type: "Person" },
      generated: { type: "Score", scoreGiven: 8, scoredBy: RATER },
      edApp: PARTIES.edApp,
    });
  });

  it("reports a corrected score as a second GradeEvent with another identifier", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    await supply(ctx, RATER);
    await supply(ctx, RATER);
    await runEventJob(SESSION, ctx.jobs.events);
    const grades = ctx.endpoint.envelopes.flatMap(({ data }) => data.filter(({ type }) => type === "GradeEvent"));
    expect(grades).toHaveLength(2);
    expect(new Set(grades.map(({ id }) => id)).size).toBe(2);
  });

  it("refuses the grade of a step that names no scorer by an IRI, marks the step, and sends the other events", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    const bare = await supply(ctx);
    expect(bare.refusal).toBeUndefined();
    await supply(ctx, "rater-17");
    await ctx.send({ type: "move", to: DRAW });
    const result = await runEventJob(SESSION, ctx.jobs.events);
    expect(result.refused).toHaveLength(2);
    expect(result.refused[0]?.reason).toContain("scoredBy");
    expect(result.refused[1]?.reason).toContain("absolute IRI");
    expect(ctx.endpoint.envelopes.flatMap(({ data }) => data).filter(({ type }) => type === "GradeEvent")).toEqual([]);
    expect(ctx.endpoint.envelopes.flatMap(({ data }) => data.map(({ action }) => action))).toContain("NavigatedTo");
    // Marked: a retry does not refuse them again.
    expect(await runEventJob(SESSION, ctx.jobs.events)).toEqual({ sent: 0, refused: [] });
  });

  it("leaves the step unhandled and fails when an event cannot be mapped, so that the queue retries it", async () => {
    const ctx = await rig();
    await ctx.outbox.append({ session: SESSION, step: 1, events: [{ type: "presented", at: 1 }] });
    await expect(runEventJob(SESSION, ctx.jobs.events)).rejects.toThrow("must name its item");
    expect(await ctx.outbox.unhandled(SESSION)).toHaveLength(1);
    expect(ctx.endpoint.envelopes).toEqual([]);
  });

  it("ends its wait with the signal of the caller, which reaches the parties and the endpoint", async () => {
    const ctx = await rig();
    await ctx.host.start(CANDIDATE, { seed: 7 });
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const options: EventJobOptions = {
      ...ctx.jobs.events,
      parties: (_session, call) => {
        seen.push(call?.signal);
        return PARTIES;
      },
      sender: {
        ...ctx.jobs.events.sender,
        fetch: async (url, init) => {
          seen.push(init.signal);
          return ctx.endpoint.fetch(url, init);
        },
      },
    };
    await runEventJob(SESSION, options, { signal: controller.signal });
    expect(seen[0]).toBe(controller.signal);
    expect(seen[1]).not.toBe(undefined);
    controller.abort(new Error("Stopped."));
    await ctx.send({ type: "move", to: DRAW });
    await expect(runEventJob(SESSION, options, { signal: controller.signal })).rejects.toThrow("Stopped.");
  });

  it("sends nothing for a session that has no steps", async () => {
    const ctx = await rig();
    expect(await runEventJob("nobody", ctx.jobs.events)).toEqual({ sent: 0, refused: [] });
    expect(ctx.endpoint.envelopes).toEqual([]);
  });
});
