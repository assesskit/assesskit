import type { StepEvents } from "@assesskit/player/server";
import { describe, expect, it } from "vitest";
import { memoryOutbox, outboxLog } from "../src/index.ts";

const step = (number: number | "start", ...types: string[]): StepEvents => ({
  session: "s1",
  step: number,
  events: types.map((type) => ({ type, at: 1 }) as StepEvents["events"][number]),
});

describe("the log", () => {
  it("appends the step to the outbox and does nothing else", async () => {
    const outbox = memoryOutbox();
    await outboxLog(outbox)(step("start", "presented"));
    expect(await outbox.steps("s1")).toEqual([step("start", "presented")]);
    expect(await outbox.unhandled("s1")).toHaveLength(1);
  });
});

describe("memoryOutbox", () => {
  it("keeps a step once by its session and step, in the order they were saved", async () => {
    const outbox = memoryOutbox();
    await outbox.append(step("start"));
    await outbox.append(step(2));
    await outbox.append(step(1));
    await outbox.append(step(2, "moved"));
    expect((await outbox.steps("s1")).map((each) => each.step)).toEqual(["start", 2, 1]);
    expect(await outbox.steps("s2")).toEqual([]);
  });

  it("hands out the steps that no job has handled, and none again after a job marked them", async () => {
    const outbox = memoryOutbox();
    for (const number of [1, 2, 3]) await outbox.append(step(number));
    await outbox.markHandled("s1", 1);
    await outbox.markHandled("s1", 3, "The scorer is no IRI.");
    expect((await outbox.unhandled("s1")).map((each) => each.step)).toEqual([2]);
  });

  it("gives times that never go back and never repeat, whether or not the attempt succeeded", async () => {
    const outbox = memoryOutbox();
    const floor = "2023-11-14T22:13:20.000Z";
    const first = await outbox.nextAttempt("s1", floor, 3);
    const second = await outbox.nextAttempt("s1", floor, 3);
    const third = await outbox.nextAttempt("s1", "2023-11-14T22:13:20.001Z", 3);
    const fourth = await outbox.nextAttempt("s1", "2023-11-14T22:14:00.000Z", 3);
    expect([first, second, third, fourth]).toEqual([
      "2023-11-14T22:13:20.000Z",
      "2023-11-14T22:13:20.001Z",
      "2023-11-14T22:13:20.002Z",
      "2023-11-14T22:14:00.000Z",
    ]);
    expect(outbox.attempts.get("s1")).toHaveLength(4);
    // Another session has its own time.
    expect(await outbox.nextAttempt("s2", floor, 0)).toBe(floor);
  });

  it("counts the steps of an attempt as published only once it is marked sent", async () => {
    const outbox = memoryOutbox();
    expect((await outbox.progress("s1")).through).toBe(0);
    await outbox.nextAttempt("s1", "2023-11-14T22:13:20.000Z", 4);
    expect((await outbox.progress("s1")).through).toBe(0);
    await outbox.markSent("s1");
    expect((await outbox.progress("s1")).through).toBe(4);
    await outbox.nextAttempt("s1", "2023-11-14T22:13:20.000Z", 2);
    await outbox.markSent("s1");
    expect((await outbox.progress("s1")).through).toBe(4);
  });

  it("records why a session cannot be published", async () => {
    const outbox = memoryOutbox();
    expect(await outbox.progress("s1")).toEqual({ through: 0 });
    await outbox.markFailed("s1", "No launch.");
    expect(await outbox.progress("s1")).toEqual({ through: 0, failed: "No launch." });
  });

  it("lets one holder claim a session at a time, and another claim it after the release", async () => {
    const outbox = memoryOutbox();
    const release = await outbox.claim("s1");
    expect(release).toBeDefined();
    expect(await outbox.claim("s1")).toBeUndefined();
    expect(await outbox.claim("s2")).toBeDefined();
    await release?.();
    expect(await outbox.claim("s1")).toBeDefined();
  });
});
