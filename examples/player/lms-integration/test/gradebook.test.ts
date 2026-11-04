// biome-ignore-all lint/style/useNamingConvention: the names of AGS scores are camelCase by the specification.

import { AccessError } from "@assesskit/player";
import { DataError } from "@assesskit/runtime/errors";
import type { ReceivedScore } from "@interopkit/tool-integration/platform";
import { describe, expect, it } from "vitest";
import { createGradebook, itemId } from "../src/index.ts";
import { SUBJECT } from "./fake-lms.ts";
import { textOf } from "./fixture.ts";
import { CANDIDATE, DRAW, drawing, openDrawing, rig } from "./rig.ts";

const TOOL = { clientId: "tool-client-1" };
const OTHER = { clientId: "another-tool" };
const MS_PER_SECOND = 1000;

const received = (change: Partial<ReceivedScore> = {}): ReceivedScore => ({
  userId: SUBJECT,
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  scoreGiven: 6,
  scoreMaximum: 10,
  timestamp: "2023-11-14T22:13:50.000Z",
  timestampMs: 1_700_000_030 * MS_PER_SECOND,
  ...change,
});

describe("the line item of a launch", () => {
  it("tells the tool its name and its maximum, from the host's record of the link", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    const answer = await tool.read();
    expect(answer.status).toBe(200);
    expect(JSON.parse(textOf(answer.body))).toEqual({
      id: tool.lineItem,
      label: "Drawing tool",
      scoreMaximum: 10,
    });
  });

  it("is the item instance of the session, and no other tool has it", async () => {
    const ctx = await rig();
    expect(await ctx.gradebook.lineItem(TOOL, CANDIDATE.session, itemId(DRAW))).toMatchObject({ scoreMaximum: 10 });
    expect(await ctx.gradebook.lineItem(OTHER, CANDIDATE.session, itemId(DRAW))).toBeUndefined();
    expect(await ctx.gradebook.lineItem(TOOL, "another-session", itemId(DRAW))).toBeUndefined();
    expect(
      await ctx.gradebook.lineItem(TOOL, CANDIDATE.session, itemId({ ref: "essay", instance: 1 })),
    ).toBeUndefined();
    expect(await ctx.gradebook.lineItem(TOOL, CANDIDATE.session, "not an item")).toBeUndefined();
  });

  it("has no method for the container, the changes of a line item or the results, so the platform does not offer them", async () => {
    const ctx = await rig();
    expect(Object.keys(ctx.gradebook).sort()).toEqual(["keepScore", "lineItem"]);
  });
});

describe("a score that a tool posts", () => {
  it("reaches the intake as the score of the item instance of the session, and the platform answers 204", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    expect((await tool.post(drawing(ctx, 30))).status).toBe(204);
    expect(ctx.scores.kept.get(JSON.stringify([CANDIDATE.session, DRAW.ref, DRAW.instance]))).toEqual({
      scoreGiven: 6,
      scoreMaximum: 10,
      final: true,
      timestampMs: ctx.clock.now() + 30 * MS_PER_SECOND,
    });
  });

  it("is refused with 404 when it is for another user than the session's, and nothing is kept", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    const answer = await tool.post({ ...drawing(ctx, 30), userId: "someone-else" });
    expect(answer.status).toBe(404);
    expect(ctx.scores.kept.size).toBe(0);
  });

  it("is refused with 404 when the line item is another session's or an item that is no link", async () => {
    const ctx = await rig();
    const tool = await openDrawing(ctx);
    const post = (url: string) => ctx.gradebook.keepScore(TOOL, url, itemId(DRAW), received());
    expect(await post("another-session")).toBeUndefined();
    expect(
      await ctx.gradebook.keepScore(TOOL, CANDIDATE.session, itemId({ ref: "essay", instance: 1 }), received()),
    ).toBeUndefined();
    expect(await ctx.gradebook.keepScore(TOOL, CANDIDATE.session, "not an item", received())).toBeUndefined();
    expect((await tool.post(drawing(ctx, 30))).status).toBe(204);
    expect(ctx.scores.kept.size).toBe(1);
  });

  it("is refused for a tool that does not hold the link, though the session and the user are right", async () => {
    const ctx = await rig();
    await openDrawing(ctx);
    expect(await ctx.gradebook.keepScore(OTHER, CANDIDATE.session, itemId(DRAW), received())).toBeUndefined();
    expect(ctx.scores.kept.size).toBe(0);
    expect(await ctx.gradebook.keepScore(TOOL, CANDIDATE.session, itemId(DRAW), received())).toBe("kept");
  });

  it("passes on a failure of the session host that is not a refusal, and the failure of the intake", async () => {
    const link = { clientId: TOOL.clientId, label: "Drawing tool", scoreMaximum: 10 };
    const failing = createGradebook({
      host: {
        check: async () => {
          throw new Error("The store is down.");
        },
      },
      intake: { onScore: async () => undefined },
      linkOf: async () => link,
    });
    await expect(failing.keepScore(TOOL, CANDIDATE.session, itemId(DRAW), received())).rejects.toThrow(
      "The store is down.",
    );
    const refusing = createGradebook({
      host: { check: async () => undefined },
      intake: {
        onScore: async () => {
          throw new DataError("The session refuses the score.");
        },
      },
      linkOf: async () => link,
    });
    await expect(refusing.keepScore(TOOL, CANDIDATE.session, itemId(DRAW), received())).rejects.toThrow(DataError);
    const unbound = createGradebook({
      host: {
        check: async () => {
          throw new AccessError("The session does not belong to the caller.", "not-bound");
        },
      },
      intake: { onScore: async () => undefined },
      linkOf: async () => link,
    });
    expect(await unbound.keepScore(TOOL, CANDIDATE.session, itemId(DRAW), received())).toBeUndefined();
  });
});
