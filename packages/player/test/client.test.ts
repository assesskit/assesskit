import type { DeliveryEvent, HostAction } from "@assesskit/runtime/delivery";
import type { CandidateAction, CandidateView } from "@assesskit/runtime/delivery/wire";
import { DataError, ServiceError } from "@assesskit/runtime/errors";
import { buildSingle } from "@assesskit/runtime/values";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_CLOCK } from "../src/client/index.js";
import { assetResolver, UNSIGNED_URL } from "../src/client/internal.js";
import { createLocalSession, type LocalStore } from "../src/client/local/index.js";
import { isOfficialResult } from "../src/protocol/index.js";
import {
  abandonedFiles,
  adaptiveDefinition,
  adaptiveFiles,
  type ScriptedPort,
  scriptedPort,
} from "./adaptive-fixture.js";
import { examDefinition, examFiles, packageOf } from "./exam-fixture.js";
import { answer, localOptions, localStore, SECOND, statusOfQ1 } from "./local-fixture.js";
import { essay, fail, pick } from "./scoring-fixture.js";
import { waitFor } from "./wait.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("assetResolver", () => {
  const assets = {
    "items/q1/": "https://assets.example/g/one/",
    "items/q1/media/": "https://assets.example/g/two/",
    "modules/": "https://assets.example/g/three/",
  };

  it("joins the base of the longest prefix that holds the path with the whole path", () => {
    const resolve = assetResolver(assets);
    expect(resolve("items/q1/images/map.png")).toBe("https://assets.example/g/one/items/q1/images/map.png");
    expect(resolve("items/q1/media/clip.mp3")).toBe("https://assets.example/g/two/items/q1/media/clip.mp3");
    expect(resolve("modules/pci/main.js")).toBe("https://assets.example/g/three/modules/pci/main.js");
  });

  it("gives a path that no prefix holds a URL that loads nothing", () => {
    const resolve = assetResolver(assets);
    expect(resolve("items/q2/image.png")).toBe(UNSIGNED_URL);
    expect(resolve("items/q1")).toBe(UNSIGNED_URL);
    expect(assetResolver({})("items/q1/a.png")).toBe(UNSIGNED_URL);
  });

  it("lets the empty prefix hold every path", () => {
    const resolve = assetResolver({ "": "https://assets.example/g/root/", "a/": "https://assets.example/g/a/" });
    expect(resolve("b/c.png")).toBe("https://assets.example/g/root/b/c.png");
    expect(resolve("a/c.png")).toBe("https://assets.example/g/a/a/c.png");
  });

  it("keeps a path that looks like a prototype property as data", () => {
    const resolve = assetResolver(JSON.parse('{"__proto__/":"https://assets.example/g/p/"}'));
    expect(resolve("__proto__/x.png")).toBe("https://assets.example/g/p/__proto__/x.png");
    expect(resolve("constructor/x.png")).toBe(UNSIGNED_URL);
  });
});

describe("BROWSER_CLOCK", () => {
  it("gives the time of the device in whole epoch milliseconds", () => {
    const before = Date.now();
    const now = BROWSER_CLOCK.now();
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

const REQUEST = "item:e1:1:SCORE";

/** The action that gives a score to the request, by default that of the essay. */
const supply = (value: number, request = REQUEST): HostAction => ({
  type: "supply-scores",
  request,
  value: buildSingle("float", value),
  scorer: "human",
});

/** The statuses of the item results in the report of the session. */
const statuses = async (client: Awaited<ReturnType<typeof createLocalSession>>): Promise<string[]> =>
  (await client.host.results()).itemResults.map(({ sessionStatus }) => sessionStatus);

/** A local session over one essay that a person scores, before the candidate has written anything. */
async function essaySession(overrides: Parameters<typeof localOptions>[0] = {}) {
  const setup = localOptions({ definition: { kind: "item", item: essay("e1"), base: "items/e1.xml" }, ...overrides });
  const client = await createLocalSession(setup.options);
  const item = client.view.current?.key ?? fail("The essay is presented.");
  const write = () =>
    client.dispatch({
      type: "set-responses",
      item,
      responses: new Map([["RESPONSE", buildSingle("string", "My essay.")]]),
    });
  const submit = () => client.dispatch({ type: "submit", item });
  return { ...setup, client, item, write, submit };
}

/** A local session over the fixture test whose first item has a time limit of ten minutes. */
async function timedSession(overrides: Parameters<typeof localOptions>[0] = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const files = examFiles({ limits: '<qti-time-limits max-time="600"/>' });
  const setup = localOptions({ definition: examDefinition(packageOf(files)), ...overrides });
  const client = await createLocalSession(setup.options);
  return { ...setup, client };
}

describe("the host side of a local session", () => {
  it("moves a rated item from pending external scoring to final when the host supplies the score, and saves it", async () => {
    const { client, store, options, write, submit } = await essaySession();
    await write();
    await submit();
    expect((await client.host.pending()).scoring.map(({ id }) => id)).toEqual([REQUEST]);
    expect(await statuses(client)).toEqual(["pendingExternalScoring"]);
    const saves = store.saved.get("practice-1")?.length;

    const step = await client.host.apply(supply(7));
    expect(step.refusal).toBeUndefined();
    expect(step.events.map(({ type }) => type)).toEqual(["scores-applied", "outcome-processed"]);
    expect((await client.host.pending()).scoring).toEqual([]);
    expect(await statuses(client)).toEqual(["final"]);
    expect(store.saved.get("practice-1")).toHaveLength((saves ?? 0) + 1);

    const resumed = await createLocalSession({ ...options, seed: 99 });
    expect(await statuses(resumed)).toEqual(["final"]);
    client.close();
    resumed.close();
  });

  it("replaces a score that the host supplied before", async () => {
    const { client, write, submit } = await essaySession();
    await write();
    await submit();
    await client.host.apply(supply(7));
    const again = await client.host.apply(supply(8));
    expect(again.events.map(({ type }) => type)).toEqual(["scores-replaced", "outcome-processed"]);
    client.close();
  });

  it("answers a refusal of the engine as a value, saves nothing and calls no step listener, while the view listeners run", async () => {
    const { client, store } = await essaySession();
    const steps: unknown[] = [];
    const views: unknown[] = [];
    client.host.subscribeSteps((events) => steps.push(events));
    client.subscribe((view) => views.push(view));
    const saves = store.saved.get("practice-1")?.length;

    const step = await client.host.apply(supply(7, "nope"));
    expect(step.events).toEqual([]);
    expect(step.refusal?.reason).toBe("unknown-request");
    expect(store.saved.get("practice-1")).toHaveLength(saves ?? 0);
    expect(steps).toEqual([]);
    expect(views).toHaveLength(1);
    client.close();
  });

  it("accepts a time action with nothing to do, saves it and calls no step listener", async () => {
    const { client, store } = await essaySession();
    const steps: unknown[] = [];
    client.host.subscribeSteps((events) => steps.push(events));
    const saves = store.saved.get("practice-1")?.length;
    expect(await client.host.apply({ type: "time" })).toEqual({ events: [] });
    expect(store.saved.get("practice-1")).toHaveLength((saves ?? 0) + 1);
    expect(steps).toEqual([]);
    client.close();
  });

  it("refuses a time action after the test ended", async () => {
    const { client } = await essaySession();
    await client.dispatch({ type: "end-test" });
    expect((await client.host.apply({ type: "time" })).refusal?.reason).toBe("ended");
    client.close();
  });

  it("gives the events of the candidate's steps and the host's steps to the step listeners in order, without a step that has none", async () => {
    const { client, write, submit } = await essaySession();
    const steps: string[][] = [];
    const stop = client.host.subscribeSteps((events) => steps.push(events.map(({ type }) => type)));
    const views: string[] = [];
    client.subscribe(() => views.push("view"));
    client.host.subscribeSteps(() => views.push("steps"));
    await write();
    await submit();
    await client.host.apply({ type: "time" });
    await client.host.apply(supply(7));
    expect(steps).toEqual([
      ["responses-set"],
      ["attempt-ended", "response-processed", "outcome-processed", "scoring-requested"],
      ["scores-applied", "outcome-processed"],
    ]);
    expect(views).toEqual(["view", "steps", "view", "steps", "view", "view", "steps"]);
    stop();
    await client.host.apply(supply(8));
    expect(steps).toHaveLength(3);
    client.close();
  });

  it("gives the events of the step of the timer to the step listeners", async () => {
    const { client, clock } = await timedSession();
    const steps: DeliveryEvent[][] = [];
    client.host.subscribeSteps((events) => steps.push([...events]));
    clock.advance(600 * SECOND);
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    await client.host.pending();
    expect(statusOfQ1(client.view)).toBe("closed");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.length).toBeGreaterThan(0);
    client.close();
  });

  it("calls no listener of a step that finishes after the client closed", async () => {
    const { client, write } = await essaySession();
    const views: unknown[] = [];
    const steps: unknown[] = [];
    client.subscribe((view) => views.push(view));
    client.host.subscribeSteps((events) => steps.push(events));
    const writing = write();
    client.close();
    expect((await writing).refusal).toBeUndefined();
    expect(views).toEqual([]);
    expect(steps).toEqual([]);
  });

  it("reports an error of a listener and still calls the others", async () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const { client, write } = await essaySession();
    const failure = new Error("The listener fails.");
    const seen: unknown[] = [];
    client.host.subscribeSteps(() => {
      throw failure;
    });
    client.host.subscribeSteps((events) => seen.push(events));
    await client.host.apply({ type: "time" });
    expect(seen).toEqual([]);
    await write();
    expect(reported).toHaveBeenCalledWith(failure);
    expect(seen).toHaveLength(1);
    client.close();
  });

  it("gives the scorer the correct responses and the template values of the request", async () => {
    const { client, item } = await (async () => {
      const setup = localOptions({ definition: { kind: "item", item: pick("p1"), base: "items/p1.xml" } });
      const session = await createLocalSession(setup.options);
      return { ...setup, client: session, item: session.view.current?.key ?? fail("The item is presented.") };
    })();
    await client.dispatch({
      type: "set-responses",
      item,
      responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
    });
    await client.dispatch({ type: "submit", item });
    const [request] = (await client.host.pending()).scoring;
    const view = await client.host.scorerView(request?.id ?? fail("A request waits."));
    expect(view.request).toEqual(request);
    expect(view.items[0]?.correctResponses.get("RESPONSE")).toEqual(buildSingle("identifier", "B"));
    expect(view.items[0]?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    expect(view.items[0]?.templateValues.get("N")).toEqual(buildSingle("integer", 4));
    client.close();
  });

  it("never brands the results of practice as official", async () => {
    const { client } = await essaySession();
    expect(isOfficialResult(await client.host.results())).toBe(false);
    client.close();
  });

  it("reads the state that the calls before it left", async () => {
    const { client, item } = await essaySession();
    void client.dispatch({
      type: "set-responses",
      item,
      responses: new Map([["RESPONSE", buildSingle("string", "Text.")]]),
    });
    void client.dispatch({ type: "submit", item });
    expect((await client.host.pending()).scoring).toHaveLength(1);
    client.close();
  });

  it("rejects an action of the candidate, and after close rejects apply and subscribeSteps while the reads still work", async () => {
    const { client } = await essaySession();
    await expect(client.host.apply(JSON.parse('{"type":"move","to":"next"}'))).rejects.toThrow(
      'The type of a host action must be "time", "supply-scores" or "cat-response", found "move".',
    );
    client.close();
    await expect(client.host.apply({ type: "time" })).rejects.toThrow(new DataError("The session client is closed."));
    expect(() => client.host.subscribeSteps(() => undefined)).toThrow(new DataError("The session client is closed."));
    expect((await client.host.pending()).scoring).toEqual([]);
    expect(await statuses(client)).toEqual(["pendingSubmission"]);
  });
});

describe("refresh of a local session", () => {
  it("builds the view of the state at the time of the call and calls the listeners with it", async () => {
    const { options, clock } = localOptions();
    const client = await createLocalSession(options);
    const seen: CandidateView[] = [];
    client.subscribe((view) => void seen.push(view));
    clock.advance(4 * SECOND);
    expect(client.age()).toBe(4 * SECOND);
    const view = await client.refresh();
    expect(client.view).toBe(view);
    expect(seen).toEqual([view]);
    expect(client.age()).toBe(0);
    client.close();
  });

  it("waits for the actions before it, and rejects a closed client, an aborted signal and options of another type", async () => {
    const { options, store } = localOptions();
    const client = await createLocalSession(options);
    const saved = store.saved.get("practice-1")?.length;
    const moving = client.dispatch({ type: "move", to: "next" });
    const refreshed = client.refresh();
    expect((await refreshed).current?.key.ref).toBe("q2");
    await moving;
    expect(store.saved.get("practice-1")?.length).toBe((saved ?? 0) + 1);
    const reason = new Error("The caller left.");
    await expect(client.refresh({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    await expect(client.refresh(JSON.parse("5"))).rejects.toThrow(DataError);
    client.close();
    await expect(client.refresh()).rejects.toThrow("The session client is closed.");
  });
});

describe("the option cat of a local session", () => {
  const item = (ref: string) => ({ ref, instance: 1 });
  const choose = (ref: string): CandidateAction => ({
    type: "set-responses",
    item: item(ref),
    responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
  });

  /** A local session over the adaptive test whose CAT engine is behind the port. */
  function adaptive(port: ScriptedPort, limits = "") {
    return localOptions({ definition: adaptiveDefinition(adaptiveFiles(limits)), cat: port });
  }

  async function finishStage(client: Awaited<ReturnType<typeof createLocalSession>>): Promise<void> {
    await client.dispatch(choose("i1"));
    await client.dispatch({ type: "submit", item: item("i1") });
    await client.dispatch({ type: "move", to: "next" });
    await client.dispatch(choose("i2"));
    await client.dispatch({ type: "submit", item: item("i2") });
  }

  it("answers Create Session while it creates the session, and presents the first item", async () => {
    const port = scriptedPort();
    const client = await createLocalSession(adaptive(port).options);
    expect(port.calls).toEqual(["createSession"]);
    expect(client.view.current?.key).toEqual(item("i1"));
    client.close();
  });

  it("sends Submit Results when the candidate finishes a stage, so that the candidate can go on", async () => {
    const port = scriptedPort();
    const client = await createLocalSession(adaptive(port).options);
    await finishStage(client);
    expect(port.calls).toEqual(["createSession", "submitResults"]);
    expect((await client.host.pending()).cat).toEqual([]);
    const moved = await client.dispatch({ type: "move", to: "next" });
    expect(moved.refusal).toBeUndefined();
    expect(moved.view.current?.key).toEqual(item("i3"));
    client.close();
  });

  it("sends Submit Results and End Session when the timer ends the adaptive section", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const port = scriptedPort();
    const { options, clock } = adaptive(port, '<qti-time-limits max-time="600"/>');
    const client = await createLocalSession(options);
    clock.advance(600 * SECOND);
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    await waitFor(() => expect(port.calls).toEqual(["createSession", "submitResults", "endSession"]));
    client.close();
  });

  it("sends End Session when the host ends the test, and reports the failure as a value", async () => {
    const port = scriptedPort();
    const client = await createLocalSession(adaptive(port).options);
    port.fail("endSession", 2);
    const ended = await client.dispatch({ type: "end-test" });
    expect(ended.refusal).toBeUndefined();
    const step = await client.host.apply({ type: "time" });
    expect(step.catFailure).toMatchObject({ message: "The CAT engine is down." });
    expect((await client.host.pending()).cat).toHaveLength(1);
    expect((await client.host.apply({ type: "time" })).catFailure).toBeUndefined();
    expect(port.calls).toEqual(["createSession", "submitResults", "endSession", "endSession", "endSession"]);
    client.close();
  });

  it("goes on in the next part and applies a rater's score while End Session fails for the section that was left", async () => {
    const port = scriptedPort();
    const setup = localOptions({ definition: adaptiveDefinition(abandonedFiles()), cat: port });
    const client = await createLocalSession(setup.options);
    port.fail("endSession", 100);
    const b1 = item("b1");
    const left = await client.dispatch({ type: "end-part" });
    expect(left.refusal).toBeUndefined();
    expect(left.view.current?.key).toEqual(b1);
    expect((await client.host.pending()).cat.map(({ kind }) => kind)).toEqual(["end-session"]);

    const saves = setup.store.saved.get("practice-1")?.length ?? 0;
    const text = new Map([["RESPONSE", buildSingle("string", "An essay.")]]);
    const entered = await client.dispatch({ type: "set-responses", item: b1, responses: text });
    expect(entered.refusal).toBeUndefined();
    expect(setup.store.saved.get("practice-1")).toHaveLength(saves + 1);
    await client.dispatch({ type: "submit", item: b1 });
    expect((await client.host.apply({ type: "time" })).catFailure).toMatchObject({
      message: "The CAT engine is down.",
    });

    const [request] = (await client.host.pending()).scoring;
    const step = await client.host.apply({
      type: "supply-scores",
      request: request?.id ?? "",
      value: buildSingle("float", 5),
      scorer: "human",
    });
    expect(step.events.map(({ type }) => type)).toContain("scores-applied");
    expect(step.catFailure).toMatchObject({ message: "The CAT engine is down." });
    expect((await client.host.pending()).scoring).toEqual([]);
    client.close();
  });

  it("rejects the creation when Create Session fails and no item is presented, and a new call resumes the session", async () => {
    const port = scriptedPort();
    const setup = adaptive(port);
    port.fail("createSession");
    await expect(createLocalSession(setup.options)).rejects.toThrow(ServiceError);
    expect(setup.store.saved.get("practice-1")).toHaveLength(1);
    const resumed = await createLocalSession(setup.options);
    expect(resumed.view.current?.key).toEqual(item("i1"));
    expect(port.calls).toEqual(["createSession", "createSession"]);
    resumed.close();
  });

  it("returns a host call at once while the answer loop runs, and finishes the loop", async () => {
    const port = scriptedPort();
    const client = await createLocalSession(adaptive(port).options);
    await client.dispatch(choose("i1"));
    await client.dispatch({ type: "submit", item: item("i1") });
    await client.dispatch({ type: "move", to: "next" });
    await client.dispatch(choose("i2"));
    const release = port.hold("submitResults");
    const submitting = client.dispatch({ type: "submit", item: item("i2") });
    await waitFor(() => expect(port.calls).toContain("submitResults"));
    expect(await client.host.apply({ type: "time" })).toEqual({ events: [] });
    release();
    await submitting;
    expect((await client.host.pending()).cat).toEqual([]);
    client.close();
  });

  it("ends the wait of a call at its abort, and the loop goes on", async () => {
    const port = scriptedPort();
    const client = await createLocalSession(adaptive(port).options);
    await client.dispatch(choose("i1"));
    await client.dispatch({ type: "submit", item: item("i1") });
    await client.dispatch({ type: "move", to: "next" });
    await client.dispatch(choose("i2"));
    const release = port.hold("submitResults");
    const controller = new AbortController();
    const reason = new Error("The caller left.");
    const submitting = client.dispatch({ type: "submit", item: item("i2") }, { signal: controller.signal });
    const rejected = expect(submitting).rejects.toBe(reason);
    await waitFor(() => expect(port.calls).toContain("submitResults"));
    controller.abort(reason);
    await rejected;
    release();
    await waitFor(async () => expect((await client.host.pending()).cat).toEqual([]));
    client.close();
  });
});

describe("saving before applying", () => {
  it("leaves the state, the view and the timer as they were when the save of a candidate action fails", async () => {
    const { client, store } = await timedSession();
    const before = client.view;
    const timers = vi.getTimerCount();
    const views: unknown[] = [];
    client.subscribe((view) => views.push(view));

    store.failNext(1, new Error("The disk is full."));
    await expect(client.dispatch(answer("A"))).rejects.toThrow("The disk is full.");
    expect(client.view).toBe(before);
    expect(views).toEqual([]);
    expect(vi.getTimerCount()).toBe(timers);
    expect(store.saved.get("practice-1")).toHaveLength(1);

    // The state in memory is the saved one: a later step does not carry the answer that was never saved.
    const moved = await client.dispatch({ type: "move", to: "next" });
    expect(moved.view.current?.key.ref).toBe("q2");
    const back = await client.dispatch({ type: "move", to: "previous" });
    expect(back.view.current?.responses.get("RESPONSE")).toBeNull();
    client.close();
  });

  it("saves the events of a step in the same write as its state, and nothing of a step whose save fails", async () => {
    const { client, store, write } = await essaySession();
    const steps: (readonly DeliveryEvent[])[] = [];
    client.host.subscribeSteps((events) => steps.push(events));
    const lengths = (): number[] => [
      store.saved.get("practice-1")?.length ?? -1,
      store.savedEvents.get("practice-1")?.length ?? -1,
    ];
    expect(lengths()[0]).toBe(lengths()[1]);
    await write();
    expect(lengths()[0]).toBe(lengths()[1]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.length).toBeGreaterThan(0);
    expect(store.savedEvents.get("practice-1")?.at(-1)).toEqual(steps[0]);

    const saved = lengths();
    store.failNext(1);
    await expect(client.dispatch({ type: "suspend" })).rejects.toThrow("The disk is full.");
    expect(lengths()).toEqual(saved);
    expect(steps).toHaveLength(1);
    client.close();
  });

  it("leaves the state as it was when the save of a host action fails", async () => {
    const { client, store, write, submit } = await essaySession();
    await write();
    await submit();
    const steps: unknown[] = [];
    client.host.subscribeSteps((events) => steps.push(events));

    store.failNext(1);
    await expect(client.host.apply(supply(7))).rejects.toThrow("The disk is full.");
    expect(steps).toEqual([]);
    expect((await client.host.pending()).scoring.map(({ id }) => id)).toEqual([REQUEST]);
    expect(await statuses(client)).toEqual(["pendingExternalScoring"]);

    expect((await client.host.apply(supply(7))).refusal).toBeUndefined();
    expect(await statuses(client)).toEqual(["final"]);
    client.close();
  });

  it("goes on with the next call after a save failed", async () => {
    const { client, store, write } = await essaySession();
    store.failNext(1);
    const failed = write();
    const next = client.dispatch({ type: "suspend" });
    await expect(failed).rejects.toThrow("The disk is full.");
    expect((await next).view.status).toBe("suspended");
    client.close();
  });

  it("arms no timer when the save of the time action of the timer fails, and applies the expiry with the next action", async () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const { client, clock, store } = await timedSession();
    expect(vi.getTimerCount()).toBe(1);

    store.failNext(1);
    clock.advance(600 * SECOND);
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    await client.host.pending();
    expect(reported).toHaveBeenCalledWith(new Error("The disk is full."));
    expect(vi.getTimerCount()).toBe(0);
    expect(statusOfQ1(client.view)).not.toBe("closed");

    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(events.map(({ type }) => type)));
    const next = await client.dispatch({ type: "move", to: "next" });
    expect(next.refusal).toBeUndefined();
    expect(steps).toHaveLength(1);
    expect(steps[0]?.[0]).toBe("time-out");
    expect(store.saved.get("practice-1")).toHaveLength(2);
    client.close();
  });
});

describe("maxIdleMs of a local session", () => {
  const Hour = 3600 * SECOND;
  const Day = 24 * Hour;
  const typesOf = (events: readonly DeliveryEvent[]): string[] => events.map(({ type }) => type);

  it("counts a gap above it as suspended, so that the time limit that would have passed has not run", async () => {
    const without = await timedSession();
    without.clock.advance(3 * Day);
    expect((await without.client.dispatch(answer("A"))).refusal?.reason).toBe("time-over");
    without.client.close();

    const { client, clock } = await timedSession({ maxIdleMs: Hour });
    clock.advance(3 * Day);
    const reply = await client.dispatch(answer("A"));
    expect(reply.refusal).toBeUndefined();
    expect(client.view.timers.map(({ remaining }) => remaining)).toEqual([600 * SECOND]);
    client.close();
  });

  it("gives the durations that an explicit suspension gives", async () => {
    const explicit = await timedSession();
    await explicit.client.dispatch({ type: "suspend" });
    explicit.clock.advance(3 * Day);
    await explicit.client.dispatch({ type: "resume" });
    await explicit.client.dispatch(answer("A"));
    const expected = await explicit.client.host.results();
    explicit.client.close();

    const { client, clock } = await timedSession({ maxIdleMs: Hour });
    clock.advance(3 * Day);
    await client.dispatch(answer("A"));
    expect(await client.host.results()).toEqual(expected);
    client.close();
  });

  it("saves the gap and the action once, and gives the step listeners the events of the three in order", async () => {
    const { client, clock, store } = await timedSession({ maxIdleMs: Hour });
    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(typesOf(events)));
    const saves = store.saved.get("practice-1")?.length ?? 0;
    clock.advance(3 * Day);
    await client.dispatch(answer("A"));
    expect(store.saved.get("practice-1")).toHaveLength(saves + 1);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.slice(0, 3)).toEqual(["suspended", "resumed", "presented"]);
    expect(steps[0]?.length).toBeGreaterThan(3);
    client.close();
  });

  it("treats a gap no longer than it as time on task, so that the timer ends the item at its limit", async () => {
    const { client, clock } = await timedSession({ maxIdleMs: 700 * SECOND });
    clock.advance(600 * SECOND);
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    await client.host.pending();
    expect(statusOfQ1(client.view)).toBe("closed");
    client.close();
  });

  it("drops the time action of the timer that finds a gap above it: nothing is saved, no timer is armed, and the next action closes the gap", async () => {
    const { client, clock, store } = await timedSession({ maxIdleMs: 5 * 60 * SECOND });
    expect(vi.getTimerCount()).toBe(1);
    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(typesOf(events)));
    clock.advance(600 * SECOND);
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    await client.host.pending();
    expect(store.saved.get("practice-1")).toHaveLength(1);
    expect(steps).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(statusOfQ1(client.view)).not.toBe("closed");

    const reply = await client.dispatch(answer("A"));
    expect(reply.refusal).toBeUndefined();
    expect(steps[0]?.slice(0, 2)).toEqual(["suspended", "resumed"]);
    expect(vi.getTimerCount()).toBe(1);
    client.close();
  });

  it("answers a time action of the host that it drops with no events and no refusal", async () => {
    const { client, clock, store } = await timedSession({ maxIdleMs: Hour });
    clock.advance(Day);
    expect(await client.host.apply({ type: "time" })).toEqual({ events: [] });
    expect(store.saved.get("practice-1")).toHaveLength(1);
    client.close();
  });

  it("drops the time action of the timer of a session that the store returns after days", async () => {
    const { client, clock, store, options } = await timedSession({ maxIdleMs: Hour });
    client.close();
    clock.advance(3 * Day);
    const resumed = await createLocalSession(options);
    await vi.advanceTimersByTimeAsync(0);
    await resumed.host.pending();
    expect(store.saved.get("practice-1")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect((await resumed.dispatch(answer("A"))).refusal).toBeUndefined();
    resumed.close();
  });

  it("closes the gap for an action of the host as for one of the candidate", async () => {
    const { client, clock, write, submit } = await essaySession({ maxIdleMs: Hour });
    await write();
    await submit();
    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(typesOf(events)));
    clock.advance(3 * Day);
    expect((await client.host.apply(supply(7))).refusal).toBeUndefined();
    expect(steps[0]?.slice(0, 2)).toEqual(["suspended", "resumed"]);
    expect(steps[0]?.slice(-2)).toEqual(["scores-applied", "outcome-processed"]);
    client.close();
  });

  it("closes a gap once for calls made together: the second call sees the latest step of the first", async () => {
    const { client, clock } = await timedSession({ maxIdleMs: Hour });
    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(typesOf(events)));
    clock.advance(3 * Day);
    await Promise.all([client.dispatch(answer("A")), client.dispatch(answer("B"))]);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.slice(0, 2)).toEqual(["suspended", "resumed"]);
    expect(steps[1]).not.toContain("suspended");
    client.close();
  });

  it("closes no gap of a session that is suspended", async () => {
    const { client, clock } = await timedSession({ maxIdleMs: Hour });
    await client.dispatch({ type: "suspend" });
    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(typesOf(events)));
    clock.advance(3 * Day);
    expect((await client.dispatch({ type: "resume" })).refusal).toBeUndefined();
    expect(steps).toEqual([["resumed", "presented"]]);
    client.close();
  });

  it("saves nothing for a refused action, so that the next action still closes the gap", async () => {
    const { client, clock, store } = await timedSession({ maxIdleMs: Hour });
    clock.advance(3 * Day);
    const saves = store.saved.get("practice-1")?.length;
    const refused = await client.dispatch({ type: "submit", item: { ref: "q2", instance: 1 } });
    expect(refused.refusal?.reason).toBe("not-current");
    expect(store.saved.get("practice-1")).toHaveLength(saves ?? 0);
    const steps: string[][] = [];
    client.host.subscribeSteps((events) => steps.push(typesOf(events)));
    await client.dispatch(answer("A"));
    expect(steps[0]?.slice(0, 2)).toEqual(["suspended", "resumed"]);
    client.close();
  });

  it("leaves the state, the view and the timer as they were when the save of the gap and the action fails", async () => {
    const { client, clock, store } = await timedSession({ maxIdleMs: Hour });
    const before = client.view;
    clock.advance(3 * Day);
    store.failNext(1, new Error("The disk is full."));
    await expect(client.dispatch(answer("A"))).rejects.toThrow("The disk is full.");
    expect(client.view).toBe(before);
    expect(store.saved.get("practice-1")).toHaveLength(1);
    expect((await client.dispatch(answer("A"))).refusal).toBeUndefined();
    client.close();
  });
});

describe("signals", () => {
  it("drops a call whose signal aborted before its turn, whether it is an action or a read", async () => {
    const base = localStore();
    let holding = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: LocalStore = {
      load: base.load,
      save: async (session, record, callOptions) => {
        if (holding) await gate;
        return base.save(session, record, callOptions);
      },
    };
    const { client } = await essaySession({ store: held });
    holding = true;
    const first = client.dispatch({ type: "suspend" });
    const controller = new AbortController();
    const reason = new Error("The caller left.");
    const signal = { signal: controller.signal };
    const dropped = [
      client.dispatch({ type: "resume" }, signal),
      client.host.apply({ type: "time" }, signal),
      client.host.pending(signal),
      client.host.scorerView(REQUEST, signal),
      client.host.results(signal),
    ].map((call) => expect(call).rejects.toBe(reason));
    controller.abort(reason);
    release();
    await first;
    await Promise.all(dropped);
    expect(client.view.status).toBe("suspended");
    expect(base.saved.get("practice-1")).toHaveLength(2);
    client.close();
  });

  it("passes the signal of a call to the store", async () => {
    const { options, store } = localOptions();
    const client = await createLocalSession(options);
    const controller = new AbortController();
    await client.dispatch(answer("A"), { signal: controller.signal });
    expect(store.received.save.at(-1)?.signal).toBe(controller.signal);
    await client.host.apply({ type: "time" }, { signal: controller.signal });
    expect(store.received.save.at(-1)?.signal).toBe(controller.signal);
    client.close();
  });

  it("stops creating the session when the signal aborted before the load", async () => {
    const { options, store } = localOptions();
    const reason = new Error("The page closed.");
    await expect(createLocalSession({ ...options, signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(store.received).toEqual({ load: [], save: [] });
  });

  it("stops creating the session when the signal aborts during the load, and a new call creates it", async () => {
    const { options, store } = localOptions();
    const controller = new AbortController();
    const reason = new Error("The page closed.");
    const aborting: LocalStore = {
      load: async (session, callOptions) => {
        controller.abort(reason);
        return store.load(session, callOptions);
      },
      save: store.save,
    };
    await expect(createLocalSession({ ...options, store: aborting, signal: controller.signal })).rejects.toBe(reason);
    expect(store.received.save).toEqual([]);
    const client = await createLocalSession(options);
    expect(client.view.current?.key.ref).toBe("q1");
    expect(store.saved.get("practice-1")).toHaveLength(1);
    client.close();
  });

  it("passes the signal of the creation to the load and the first save", async () => {
    const { options, store } = localOptions();
    const controller = new AbortController();
    const client = await createLocalSession({ ...options, signal: controller.signal });
    expect(store.received.load[0]?.signal).toBe(controller.signal);
    expect(store.received.save[0]?.signal).toBe(controller.signal);
    client.close();
  });

  it("ignores an abort that comes after the save: the step applies and the listeners run", async () => {
    const { options, store } = localOptions();
    const controller = new AbortController();
    let aborting = false;
    const aborts: LocalStore = {
      load: store.load,
      save: async (session, record, callOptions) => {
        await store.save(session, record, callOptions);
        if (aborting) controller.abort();
      },
    };
    const client = await createLocalSession({ ...options, store: aborts });
    aborting = true;
    const views: unknown[] = [];
    const steps: unknown[] = [];
    client.subscribe((view) => views.push(view));
    client.host.subscribeSteps((events) => steps.push(events));
    const result = await client.dispatch(answer("A"), { signal: controller.signal });
    expect(result.view.current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    expect(views).toHaveLength(1);
    expect(steps).toHaveLength(1);
    client.close();
  });
});

describe("input of other types", () => {
  it("checks the options of a call", async () => {
    const { client } = await essaySession();
    const options = (text: string): { readonly signal?: never } => JSON.parse(text);
    const calls = [
      (given: ReturnType<typeof options>) => client.dispatch({ type: "suspend" }, given),
      (given: ReturnType<typeof options>) => client.host.apply({ type: "time" }, given),
      (given: ReturnType<typeof options>) => client.host.pending(given),
      (given: ReturnType<typeof options>) => client.host.scorerView(REQUEST, given),
      (given: ReturnType<typeof options>) => client.host.results(given),
    ];
    for (const call of calls) {
      await expect(call(options("null"))).rejects.toThrow("The options must be an object, found null.");
      await expect(call(options("[]"))).rejects.toThrow("The options must be an object, found an array.");
      await expect(call(options('{"signal":5}'))).rejects.toThrow("The option signal must be an AbortSignal, found 5.");
      await expect(call(options('{"signal":{}}'))).rejects.toThrow(
        "The option signal must be an AbortSignal, found an object.",
      );
      await expect(call(options('{"extra":1}'))).rejects.toThrow('found "extra".');
    }
    await expect(client.host.apply({ type: "time" }, JSON.parse('{"scoredBy":5}'))).rejects.toThrow(
      "The option scoredBy must be a non-empty string, found 5.",
    );
    client.close();
  });

  it("checks the action of the host", async () => {
    const { client } = await essaySession();
    const action = (text: string): HostAction => JSON.parse(text);
    await expect(client.host.apply(action("null"))).rejects.toThrow(
      "The action must be an object with a type, found null.",
    );
    await expect(client.host.apply(action("5"))).rejects.toThrow("The action must be an object with a type, found 5.");
    await expect(client.host.apply(action("{}"))).rejects.toThrow(
      'The type of a host action must be "time", "supply-scores" or "cat-response", found undefined.',
    );
    await expect(client.host.apply(action('{"type":"supply-scores"}'))).rejects.toThrow(
      "The request of supply-scores must be a string, found undefined.",
    );
    client.close();
  });

  it("checks the request of a scorer view and the listener of the steps", async () => {
    const { client } = await essaySession();
    await expect(client.host.scorerView(JSON.parse("5"))).rejects.toThrow("The request must be a string, found 5.");
    await expect(client.host.scorerView("nope")).rejects.toThrow('The state has no scoring request "nope".');
    expect(() => client.host.subscribeSteps(JSON.parse("null"))).toThrow(
      "The listener must be a function, found null.",
    );
    client.close();
  });

  it("checks the option maxIdleMs", async () => {
    const { options } = localOptions();
    const make = (changes: string): Promise<unknown> => createLocalSession({ ...options, ...JSON.parse(changes) });
    await expect(make('{"maxIdleMs":0}')).rejects.toThrow("The option maxIdleMs must be a positive integer, found 0.");
    await expect(make('{"maxIdleMs":1.5}')).rejects.toThrow(
      "The option maxIdleMs must be a positive integer, found 1.5.",
    );
    await expect(make('{"maxIdleMs":"5"}')).rejects.toThrow(
      'The option maxIdleMs must be a positive integer, found "5".',
    );
    await expect(make('{"maxIdleMs":null}')).rejects.toThrow(
      "The option maxIdleMs must be a positive integer, found null.",
    );
  });

  it("checks the signal and the clock of the creation", async () => {
    const { options } = localOptions();
    const make = (changes: string): Promise<unknown> => createLocalSession({ ...options, ...JSON.parse(changes) });
    await expect(make('{"signal":5}')).rejects.toThrow("The option signal must be an AbortSignal, found 5.");
    await expect(make('{"signal":null}')).rejects.toThrow("The option signal must be an AbortSignal, found null.");
    await expect(createLocalSession({ ...options, clock: { now: () => 1.5 } })).rejects.toThrow(
      "The time of the clock must be a non-negative integer, found 1.5.",
    );
  });
});

type Local = Awaited<ReturnType<typeof createLocalSession>>;

/** The calls of a candidate and a host that a property makes, by name. */
const CALLS = {
  "answer A": (client: Local) => client.dispatch(answer("A")),
  "answer B": (client: Local) => client.dispatch(answer("B")),
  next: (client: Local) => client.dispatch({ type: "move", to: "next" }),
  previous: (client: Local) => client.dispatch({ type: "move", to: "previous" }),
  time: (client: Local) => client.host.apply({ type: "time" }),
} as const;

const NAMES = ["answer A", "answer B", "next", "previous", "time"] as const satisfies readonly (keyof typeof CALLS)[];

/** The states that a session saves for the calls, made all at once or one after the other. */
async function savedBy(
  names: readonly (keyof typeof CALLS)[],
  together: boolean,
): Promise<readonly string[] | undefined> {
  const { options, store } = localOptions();
  const client = await createLocalSession(options);
  if (together) await Promise.all(names.map((name) => CALLS[name](client)));
  else for (const name of names) await CALLS[name](client);
  client.close();
  return store.saved.get("practice-1");
}

describe("properties", () => {
  it("applies the calls made together in the order of the calls", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 8 }), async (calls) => {
        expect(await savedBy(calls, true)).toEqual(await savedBy(calls, false));
      }),
      { numRuns: 30 },
    );
  });

  it("gives each path the base of its longest prefix", () => {
    const directory = fc.stringMatching(/^([a-z]{1,3}\/){0,3}$/u);
    fc.assert(
      fc.property(
        fc.uniqueArray(directory, { minLength: 1, maxLength: 5 }),
        fc.stringMatching(/^[a-z/]{1,12}$/u),
        (prefixes, path) => {
          const assets = Object.fromEntries(
            prefixes.map((prefix, index) => [prefix, `https://assets.example/g/${index}/`]),
          );
          const holding = prefixes.filter((prefix) => path.startsWith(prefix));
          const longest = holding.reduce((a, b) => (b.length > a.length ? b : a), "");
          const url = assetResolver(assets)(path);
          if (holding.length === 0) expect(url).toBe(UNSIGNED_URL);
          else expect(url).toBe(`${assets[longest]}${path}`);
        },
      ),
    );
  });
});
