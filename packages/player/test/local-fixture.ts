import type { CandidateAction, CandidateView, DeliveryEvent } from "@assesskit/runtime/delivery";
import { buildSingle } from "@assesskit/runtime/values";
import type { createLocalSession, LocalStore } from "../src/client/local/index.js";
import type { CallOptions } from "../src/protocol/index.js";
import { examDefinition, fakeClock } from "./exam-fixture.js";

/** A second in milliseconds. */
export const SECOND = 1000;

/** The first item of the fixture test. */
export const Q1 = { ref: "q1", instance: 1 };

/** An action that answers the first item of the fixture test with the choice. */
export const answer = (identifier: string): CandidateAction => ({
  type: "set-responses",
  item: Q1,
  responses: new Map([["RESPONSE", buildSingle("identifier", identifier)]]),
});

/** The state of q1 in the navigation of a view. */
export const statusOfQ1 = (view: CandidateView): string | undefined => {
  const entry = view.navigation.find((each) => each.kind === "item" && each.key.ref === "q1");
  return entry?.kind === "item" ? entry.status : undefined;
};

/** A store for the state of a local session that keeps what was saved, and that a test can make fail. */
export interface TestLocalStore extends LocalStore {
  /** The states that were saved, by session, in order. */
  readonly saved: Map<string, string[]>;
  /** The events saved with each of those states, by session, in order. */
  readonly savedEvents: Map<string, (readonly DeliveryEvent[])[]>;
  /** The options of each call of `load` and of `save`, in order. */
  readonly received: {
    readonly load: (CallOptions | undefined)[];
    readonly save: (CallOptions | undefined)[];
  };
  /** Makes the next saves reject with the error. */
  failNext(times: number, error?: Error): void;
}

/** Creates a store in memory. */
export function localStore(): TestLocalStore {
  const saved = new Map<string, string[]>();
  const savedEvents = new Map<string, (readonly DeliveryEvent[])[]>();
  const received: TestLocalStore["received"] = { load: [], save: [] };
  let failures = 0;
  let failure = new Error("The disk is full.");
  return {
    saved,
    savedEvents,
    received,
    failNext: (times, error = new Error("The disk is full.")) => {
      failures = times;
      failure = error;
    },
    load: async (session, options) => {
      received.load.push(options);
      return saved.get(session)?.at(-1);
    },
    save: async (session, { state, events }, options) => {
      received.save.push(options);
      if (failures > 0) {
        failures -= 1;
        throw failure;
      }
      saved.set(session, [...(saved.get(session) ?? []), state]);
      savedEvents.set(session, [...(savedEvents.get(session) ?? []), events]);
    },
  };
}

/** The options of a local session over the fixture test, with the clock and the store that a test uses. */
export function localOptions(overrides: Partial<Parameters<typeof createLocalSession>[0]> = {}) {
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
