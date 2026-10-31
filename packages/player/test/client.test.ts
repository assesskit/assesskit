import type { CandidateAction, DeliveryEvent, HostAction } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetResolver,
  BROWSER_CLOCK,
  createLocalSession,
  type LocalStore,
  UNSIGNED_URL,
} from "../src/client/index.js";
import { ServiceError } from "../src/index.js";
import { isOfficialResult } from "../src/protocol/index.js";
import { untilAborted } from "../src/protocol/internal.js";
import { adaptiveDefinition, adaptiveFiles, type ScriptedPort, scriptedPort } from "./adaptive-fixture.js";
import { examDefinition, examFiles, packageOf } from "./exam-fixture.js";
import { answer, localOptions, localStore, SECOND, statusOfQ1 } from "./local-fixture.js";
import { essay, fail, pick } from "./scoring-fixture.js";
import { waitFor } from "./wait.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("untilAborted", () => {
  it("gives the promise itself when the caller has no signal", async () => {
    const promise = Promise.resolve(7);
    expect(untilAborted(promise, undefined)).toBe(promise);
    await expect(untilAborted(promise, undefined)).resolves.toBe(7);
  });

  it("gives what the promise gives and leaves no listener on the signal", async () => {
    const signal = new AbortController().signal;
    const removed = vi.spyOn(signal, "removeEventListener");
    await expect(untilAborted(Promise.resolve(7), signal)).resolves.toBe(7);
    await expect(untilAborted(Promise.reject(new Error("The promise fails.")), signal)).rejects.toThrow(
      "The promise fails.",
    );
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it("rejects with the reason as soon as the signal aborts, and the promise goes on", async () => {
    const controller = new AbortController();
    let finish: (value: number) => void = () => undefined;
    const promise = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const waiting = untilAborted(promise, controller.signal);
    const reason = new Error("The caller left.");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    finish(3);
    await expect(promise).resolves.toBe(3);
  });

  it("rejects at once for a signal that has aborted", async () => {
    const reason = new Error("Too late.");
    await expect(untilAborted(new Promise(() => undefined), AbortSignal.abort(reason))).rejects.toBe(reason);
  });
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
  value: single("float", value),
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
    client.dispatch({ type: "set-responses", item, responses: new Map([["RESPONSE", single("string", "My essay.")]]) });
  const submit = () => client.dispatch({ type: "submit", item });
  return { ...setup, client, item, write, submit };
}

/** A local session over the fixture test whose first item has a time limit of ten minutes. */
async function timedSession() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const files = examFiles({ limits: '<qti-time-limits max-time="600"/>' });
  const setup = localOptions({ definition: examDefinition(packageOf(files)) });
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
    expect(step.refusal?.code).toBe("unknown-request");
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
    expect((await client.host.apply({ type: "time" })).refusal?.code).toBe("ended");
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
      responses: new Map([["RESPONSE", single("identifier", "A")]]),
    });
    await client.dispatch({ type: "submit", item });
    const [request] = (await client.host.pending()).scoring;
    const view = await client.host.scorerView(request?.id ?? fail("A request waits."));
    expect(view.request).toEqual(request);
    expect(view.items[0]?.correctResponses.get("RESPONSE")).toEqual(single("identifier", "B"));
    expect(view.items[0]?.responses.get("RESPONSE")).toEqual(single("identifier", "A"));
    expect(view.items[0]?.templateValues.get("N")).toEqual(single("integer", 4));
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
      responses: new Map([["RESPONSE", single("string", "Text.")]]),
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

describe("the option cat of a local session", () => {
  const item = (ref: string) => ({ ref, instance: 1 });
  const choose = (ref: string): CandidateAction => ({
    type: "set-responses",
    item: item(ref),
    responses: new Map([["RESPONSE", single("identifier", "A")]]),
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
      save: async (session, state, callOptions) => {
        if (holding) await gate;
        return base.save(session, state, callOptions);
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
      save: async (session, state, callOptions) => {
        await store.save(session, state, callOptions);
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
    expect(result.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "A"));
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
      "The option scoredBy must be a string, found 5.",
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
