import type { CandidateAction, CandidateView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { single } from "@assesskit/runtime/values";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import {
  AUTOSAVE_MS,
  createLocalSession,
  createRemoteSession,
  FLUSH_BEFORE_DEADLINE_MS,
  type LocalStore,
} from "../src/client/index.js";
import { ServiceError } from "../src/index.js";
import type { ActionEnvelope } from "../src/protocol/index.js";
import { examDefinition, examFiles, examHost, fakeClock, packageOf } from "./exam-fixture.js";

const ALICE = { session: "exam-1", principal: "alice" };
const SECOND = 1000;
const Q1 = { ref: "q1", instance: 1 };
const answer = (identifier: string): CandidateAction => ({
  type: "set-responses",
  item: Q1,
  responses: new Map([["RESPONSE", single("identifier", identifier)]]),
});

const realSetTimeout = globalThis.setTimeout;
/** Waits on the real clock, for the host's own asynchronous work, while the timers of the client are fake. */
const real = (milliseconds: number): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, milliseconds));

/** The state of q1 in the navigation of a view. */
const statusOfQ1 = (view: CandidateView): string | undefined => {
  const entry = view.navigation.find((each) => each.kind === "item" && each.key.ref === "q1");
  return entry?.kind === "item" ? entry.status : undefined;
};

afterEach(() => {
  vi.useRealTimers();
});

/** A remote session over a session host in the page, with the wire in between: every envelope goes through JSON. */
async function remote(
  options: {
    readonly files?: Readonly<Record<string, string | Uint8Array>>;
    readonly fail?: (envelope: ActionEnvelope, call: number) => "before" | "after" | undefined;
  } = {},
) {
  const setup = await examHost({}, options.files, inject("fixtures").asset);
  const calls: ActionEnvelope[] = [];
  const transport = async (envelope: ActionEnvelope) => {
    calls.push(envelope);
    const sent = JSON.parse(JSON.stringify(envelope));
    const failure = options.fail?.(envelope, calls.length);
    if (failure === "before") throw new ServiceError("The host could not be reached.", 0, "");
    const reply: unknown = JSON.parse(JSON.stringify(await setup.host.handle(ALICE, sent)));
    if (failure === "after") throw new ServiceError("The answer was lost.", 0, "");
    return JSON.parse(JSON.stringify(reply));
  };
  const initial = JSON.parse(JSON.stringify(await setup.host.start(ALICE, { seed: 1 })));
  const client = createRemoteSession(transport, initial, { clock: setup.clock });
  return { ...setup, client, calls, transport, initial };
}

const typesOf = (calls: readonly ActionEnvelope[]): string[] =>
  calls.map(({ action }) => (action as { type: string }).type);

describe("createRemoteSession", () => {
  it("[T67] shows the first view, resolves paths through the signed prefixes and reads the documents of the content", async () => {
    const { client, initial } = await remote();
    expect(client.view.current?.key).toEqual(Q1);
    expect(client.documents).toEqual({ test: "tests/exam.xml", item: "items/q1/item.xml", stimuli: [], lexicons: [] });
    const url = client.assets("items/q1/images/map.png");
    expect(url).toBe(`${initial.assets["items/q1/"]}items/q1/images/map.png`);
    expect(client.assets("items/q2/other.png")).toBe("about:blank");
    expect(client.age()).toBe(0);
    client.close();
  });

  it("[T67] sends each action as an envelope with the next sequence number and gives the view after it", async () => {
    const { client, calls, clock } = await remote();
    clock.advance(4 * SECOND);
    expect(client.age()).toBe(4 * SECOND);
    const moved = await client.dispatch({ type: "move", to: "next" });
    expect(moved.refusal).toBeUndefined();
    expect(moved.view.current?.key.ref).toBe("q2");
    expect(client.view).toBe(moved.view);
    expect(client.age()).toBe(0);
    expect(client.documents.item).toBe("items/q2/item.xml");
    await client.dispatch({ type: "move", to: "previous" });
    expect(calls.map(({ seq }) => seq)).toEqual([1, 2]);
    client.close();
  });

  it("[T67] gives the refusal of the engine with the view as it was", async () => {
    const { client } = await remote();
    const before = client.view;
    const refused = await client.dispatch({ type: "submit", item: { ref: "q2", instance: 1 } });
    expect(refused.refusal?.code).toBe("not-current");
    expect(refused.view.current?.key).toEqual(before.current?.key);
    client.close();
  });

  it("[T67] holds back responses and sends them together after the pause of the autosave", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { client, calls } = await remote();
    const first = client.dispatch(answer("A"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    const second = client.dispatch(answer("B"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const [one, two] = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.seq).toBe(1);
    expect(one).toBe(two);
    expect(one.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "B"));
    client.close();
  });

  it("[T67] sends the held responses before any other action", async () => {
    const { client, calls } = await remote();
    const saved = client.dispatch(answer("A"));
    const moved = await client.dispatch({ type: "move", to: "next" });
    expect((await saved).view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "A"));
    expect(typesOf(calls)).toEqual(["set-responses", "move"]);
    expect(moved.view.current?.key.ref).toBe("q2");
    client.close();
  });

  it("[T67] sends the held responses of one item before those of another", async () => {
    const { client, calls } = await remote();
    const first = client.dispatch(answer("A"));
    const other = client.dispatch({
      type: "set-responses",
      item: { ref: "q2", instance: 1 },
      responses: new Map([["RESPONSE", single("identifier", "B")]]),
    });
    await Promise.all([first, other]);
    expect(calls.map(({ action }) => (action as { item: { ref: string } }).item.ref)).toEqual(["q1", "q2"]);
    client.close();
  });

  it("[T67] sends the held responses when the page is hidden", async () => {
    const { client, calls } = await remote();
    const saved = client.dispatch(answer("A"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await saved;
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
    expect(calls).toHaveLength(1);
    client.close();
  });

  it("[T67] sends the held responses before the nearest timer reaches 0, and asks the host for the view at 0", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const limit = 11;
    const { client, calls, clock } = await remote({
      files: examFiles({ limits: `<qti-time-limits max-time="${limit}"/>` }),
    });
    expect(client.view.timers.map(({ remaining }) => remaining)).toEqual([limit * SECOND]);
    const seen: CandidateView[] = [];
    client.subscribe((view) => seen.push(view));
    const saved = client.dispatch(answer("A"));
    clock.advance(limit * SECOND - FLUSH_BEFORE_DEADLINE_MS);
    await vi.advanceTimersByTimeAsync(limit * SECOND - FLUSH_BEFORE_DEADLINE_MS);
    await saved;
    expect(typesOf(calls)).toEqual(["set-responses"]);
    clock.advance(FLUSH_BEFORE_DEADLINE_MS);
    await vi.advanceTimersByTimeAsync(FLUSH_BEFORE_DEADLINE_MS);
    await real(200);
    expect(typesOf(calls)).toEqual(["set-responses", "set-responses"]);
    expect(calls[1]?.action).toMatchObject({ type: "set-responses", responses: [] });
    expect(statusOfQ1(seen.at(-1) ?? client.view)).toBe("closed");
    client.close();
  });

  it("[T67] sends a request again, unchanged, before the next one when its answer was lost", async () => {
    const { client, calls, store } = await remote({ fail: (_envelope, call) => (call === 1 ? "after" : undefined) });
    await expect(client.dispatch({ type: "move", to: "next" })).rejects.toThrow(ServiceError);
    const answered = await client.dispatch({ type: "move", to: "next" });
    expect(calls.map(({ seq }) => seq)).toEqual([1, 1, 2]);
    expect(typesOf(calls)).toEqual(["move", "move", "move"]);
    expect(answered.refusal).toBeUndefined();
    expect(client.view.current?.key.ref).toBe("q3");
    expect(store.records.get("exam-1")?.version).toBe(2);
    client.close();
  });

  it("[T67] sends a request that never reached the host as it was", async () => {
    const { client, calls, store } = await remote({ fail: (_envelope, call) => (call === 1 ? "before" : undefined) });
    await expect(client.dispatch({ type: "move", to: "next" })).rejects.toThrow(ServiceError);
    expect((await client.dispatch({ type: "move", to: "next" })).view.current?.key.ref).toBe("q3");
    expect(calls.map(({ seq }) => seq)).toEqual([1, 1, 2]);
    expect(store.records.get("exam-1")?.version).toBe(2);
    client.close();
  });

  it("[T67] does not send a request again that the host rejected", async () => {
    const { client, calls } = await remote();
    await expect(client.dispatch({ type: "suspend" })).rejects.toMatchObject({ name: "DataError" });
    const moved = await client.dispatch({ type: "move", to: "next" });
    expect(calls.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(typesOf(calls)).toEqual(["suspend", "move"]);
    expect(moved.view.current?.key.ref).toBe("q2");
    client.close();
  });

  it("[T67] fails when the host answers another sequence number", async () => {
    const { initial } = await remote();
    const client = createRemoteSession(async (envelope) => ({ ...initial, seq: envelope.seq + 1 }), initial);
    await expect(client.dispatch({ type: "move", to: "next" })).rejects.toThrow(
      new DataError("The host answered the sequence number 2 to the request 1."),
    );
    client.close();
  });

  it("[T67] tells the listeners of each view until they leave, and a listener that throws does not stop the others", async () => {
    const { client } = await remote();
    const seen: string[] = [];
    const stop = client.subscribe((view) => seen.push(`a ${view.current?.key.ref}`));
    const stopFailing = client.subscribe(() => {
      throw new Error("The listener fails.");
    });
    client.subscribe((view) => seen.push(`c ${view.current?.key.ref}`));
    const ignore = (event: ErrorEvent): void => event.preventDefault();
    window.addEventListener("error", ignore);
    try {
      await client.dispatch({ type: "move", to: "next" });
      stop();
      stopFailing();
      await client.dispatch({ type: "move", to: "previous" });
    } finally {
      window.removeEventListener("error", ignore);
    }
    expect(seen).toEqual(["a q2", "c q2", "c q1"]);
    client.close();
  });

  it("[T67] stops at close: no timers, no listeners and no more actions", async () => {
    const { client, calls } = await remote();
    const seen: unknown[] = [];
    client.subscribe((view) => seen.push(view));
    client.close();
    await expect(client.dispatch({ type: "move", to: "next" })).rejects.toThrow(
      new DataError("The session client is closed."),
    );
    expect(calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("[T67] checks its arguments", async () => {
    const { initial, transport } = await remote();
    const options = (text: string): { readonly clock?: never } => JSON.parse(text);
    expect(() => createRemoteSession(JSON.parse("null"), initial)).toThrow("The transport must be a function");
    expect(() => createRemoteSession(transport, JSON.parse('{"seq":1}'))).toThrow("A view envelope");
    expect(() => createRemoteSession(transport, initial, options("null"))).toThrow(
      "The options object is invalid: expected an object, found null.",
    );
    expect(() => createRemoteSession(transport, initial, options('{"timers":1}'))).toThrow(
      'The options object is invalid: unexpected property "timers".',
    );
    expect(() => createRemoteSession(transport, initial, options('{"clock":{}}'))).toThrow(
      "The options object is invalid at clock: expected an object with the function now, found an object.",
    );
    const client = createRemoteSession(transport, initial);
    expect(() => client.subscribe(JSON.parse("5"))).toThrow("The listener must be a function");
    await expect(client.dispatch(JSON.parse('{"type":"nope"}'))).rejects.toThrow("The type of the action");
    client.close();
  });
});

/** A store for the state of a local session that keeps what was saved. */
function localStore(): LocalStore & { readonly saved: Map<string, string[]> } {
  const saved = new Map<string, string[]>();
  return {
    saved,
    load: async (session) => saved.get(session)?.at(-1),
    save: async (session, state) => {
      saved.set(session, [...(saved.get(session) ?? []), state]);
    },
  };
}

/** The options of a local session over the fixture test. */
function localOptions(overrides: Partial<Parameters<typeof createLocalSession>[0]> = {}) {
  const clock = fakeClock();
  const store = localStore();
  return {
    clock,
    store,
    options: {
      definition: examDefinition(),
      store,
      session: "practice-1",
      seed: 1,
      assets: (path: string) => `/assets/${path}`,
      clock,
      ...overrides,
    },
  };
}

describe("createLocalSession", () => {
  it("[T70] runs the engine on the device behind the interface of the remote session", async () => {
    const { options, store, clock } = localOptions();
    const client = await createLocalSession(options);
    expect(client.view.current?.key).toEqual(Q1);
    expect(client.assets("items/q1/images/map.png")).toBe("/assets/items/q1/images/map.png");
    expect(client.documents).toEqual({ test: "tests/exam.xml", item: "items/q1/item.xml", stimuli: [], lexicons: [] });
    expect(client.view.actions).toContain("suspend");
    clock.advance(2 * SECOND);
    expect(client.age()).toBe(2 * SECOND);
    const answered = await client.dispatch(answer("A"));
    expect(answered.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "A"));
    const submitted = await client.dispatch({ type: "submit", item: Q1 });
    expect(statusOfQ1(submitted.view)).toBe("closed");
    expect(store.saved.get("practice-1")).toHaveLength(3);
    client.close();
  });

  it("[T70] lets the candidate suspend and resume, which an exam does not", async () => {
    const { options } = localOptions();
    const client = await createLocalSession(options);
    expect((await client.dispatch({ type: "suspend" })).view.status).toBe("suspended");
    expect((await client.dispatch({ type: "resume" })).view.status).toBe("in-progress");
    client.close();
  });

  it("[T69][T70] resumes a session from its store, with its answers", async () => {
    const { options, store } = localOptions();
    const first = await createLocalSession(options);
    await first.dispatch(answer("B"));
    await first.dispatch({ type: "move", to: "next" });
    first.close();
    const second = await createLocalSession({ ...options, seed: 99 });
    expect(second.view.current?.key.ref).toBe("q2");
    await second.dispatch({ type: "move", to: "previous" });
    expect(second.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "B"));
    expect(store.saved.get("practice-1")).toHaveLength(4);
    second.close();
  });

  it("[T70] gives the refusal of the engine and saves nothing for it", async () => {
    const { options, store } = localOptions();
    const client = await createLocalSession(options);
    const refused = await client.dispatch({ type: "submit", item: { ref: "q2", instance: 1 } });
    expect(refused.refusal?.code).toBe("not-current");
    expect(store.saved.get("practice-1")).toHaveLength(1);
    client.close();
  });

  it("[T65] fires a time action at each maximum time with a timer of the browser", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const files = examFiles({ limits: '<qti-time-limits max-time="600"/>' });
    const { options, clock, store } = localOptions({ definition: examDefinition(packageOf(files)) });
    const client = await createLocalSession(options);
    const seen: CandidateView[] = [];
    client.subscribe((view) => seen.push(view));
    expect(client.view.timers.map(({ remaining }) => remaining)).toEqual([600 * SECOND]);
    clock.advance(599 * SECOND);
    await vi.advanceTimersByTimeAsync(599 * SECOND);
    expect(seen).toEqual([]);
    clock.advance(SECOND);
    await vi.advanceTimersByTimeAsync(SECOND);
    await real(50);
    expect(statusOfQ1(seen.at(-1) ?? client.view)).toBe("closed");
    expect(store.saved.get("practice-1")).toHaveLength(2);
    client.close();
  });

  it("[T65] sets a timer again when its time is far off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const files = examFiles({ limits: '<qti-time-limits max-time="3000000"/>' });
    const { options } = localOptions({ definition: examDefinition(packageOf(files)) });
    const client = await createLocalSession(options);
    expect(vi.getTimerCount()).toBe(1);
    client.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[T70] previews one item with the definition of an item", async () => {
    const pkg = packageOf(examFiles());
    const document = pkg.document("items/q1/item.xml");
    if (document.kind !== "item") throw new Error("The fixture item is an item.");
    const { options } = localOptions({ definition: { kind: "item", item: document.item, base: "items/q1/item.xml" } });
    const client = await createLocalSession(options);
    expect(client.view.current?.key.ref).toBe("q1");
    expect(client.documents).toEqual({ test: "", item: "items/q1/item.xml", stimuli: [], lexicons: [] });
    const answered = await client.dispatch({
      type: "set-responses",
      item: client.view.current?.key ?? Q1,
      responses: new Map([["RESPONSE", single("identifier", "A")]]),
    });
    expect(answered.refusal).toBeUndefined();
    client.close();
  });

  it("[T70][T85] names the lexicons that the host gives for the item presented", async () => {
    const asked: string[] = [];
    const { options } = localOptions({
      lexicons: (item) => {
        asked.push(item);
        return item === "items/q1/item.xml" ? ["items/q1/words.pls"] : [];
      },
    });
    const client = await createLocalSession(options);
    expect(client.documents.lexicons).toEqual(["items/q1/words.pls"]);
    const moved = await client.dispatch({ type: "move", to: "next" });
    expect(moved.view.current?.key.ref).toBe("q2");
    expect(client.documents.lexicons).toEqual([]);
    expect(asked).toContain("items/q2/item.xml");
    client.close();
  });

  it("[T70] checks its options", async () => {
    const { options } = localOptions();
    const make = (changes: string): Promise<unknown> => createLocalSession({ ...options, ...JSON.parse(changes) });
    await expect(createLocalSession(JSON.parse("null"))).rejects.toThrow(
      "The options object is invalid: expected an object, found null.",
    );
    await expect(make('{"store":null}')).rejects.toThrow(
      "The options object is invalid at store: expected an object with the functions load and save, found null.",
    );
    await expect(make('{"store":{"load":1,"save":1}}')).rejects.toThrow(
      "The options object is invalid at store: expected an object with the functions load and save",
    );
    await expect(make('{"session":""}')).rejects.toThrow(
      "The options object is invalid at session: expected a length of at least 1, found 0.",
    );
    await expect(make('{"assets":null}')).rejects.toThrow(
      "The options object is invalid at assets: expected a function, found null.",
    );
    await expect(make('{"lexicons":[]}')).rejects.toThrow(
      "The options object is invalid at lexicons: expected a function, found an array.",
    );
    await expect(make('{"clock":{}}')).rejects.toThrow(
      "The options object is invalid at clock: expected an object with the function now",
    );
    await expect(make('{"definition":5}')).rejects.toThrow(
      "The options object is invalid at definition: expected an object, found 5.",
    );
    await expect(make('{"extra":1}')).rejects.toThrow('The options object is invalid: unexpected property "extra".');
    await expect(make('{"seed":1.5}')).rejects.toThrow("seed");
    const client = await createLocalSession(options);
    await expect(client.dispatch(JSON.parse('{"type":"nope"}'))).rejects.toThrow("The type of the action");
    client.close();
    await expect(client.dispatch({ type: "move", to: "next" })).rejects.toThrow("The session client is closed.");
  });
});
