import {
  checkChoice,
  checkNonEmptyString,
  checkRecord,
  describe,
  functionSchema,
  methodsSchema,
  parseWith,
  recordSchema,
} from "@assesskit/runtime/checks";
import {
  actionToJson,
  type CandidateAction,
  type CandidateView,
  type DeliveryEvent,
  type DeliveryState,
  deserializeState,
  type Engine,
  type HostAction,
  parseCandidateAction,
  type Step,
  serializeState,
  stamp,
  viewToJson,
} from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { QtiPackage } from "@assesskit/runtime/package";
import * as v from "valibot";
import { checkIri } from "../caliper/internal.js";
import { AccessError, ServiceError } from "../errors.js";
import {
  type ActionEnvelope,
  type Caller,
  checkActionEnvelope,
  checkCaller,
  checkViewEnvelope,
  type ViewEnvelope,
} from "../protocol/index.js";
import { checkClock, checkHostAction, markOfficial, readClock } from "../protocol/internal.js";
import { forwardEvents, type SuppliedGrade } from "./forward.js";
import { type AssetGate, collectAssetPrefixes, locateDocuments } from "./gate/index.js";
import { checkClientAction, EXAM_CLIENT_ACTIONS, readClientActions } from "./policy.js";
import type { Scheduler } from "./scheduler.js";
import { MAX_SAVE_RETRIES, PROCTOR_ACTIONS, type SessionHost, type SessionHostOptions } from "./session-host.js";
import type { SessionStore, StoredSession } from "./session-store.js";

/** What one attempt at a change gives: the answer, and the new record when the attempt changes the session. */
interface Attempt<T> {
  readonly result: T;
  readonly change?: {
    readonly state: DeliveryState;
    readonly seq: number;
    readonly envelope: string;
    readonly action: string;
    readonly events: readonly DeliveryEvent[];
    readonly supplied?: SuppliedGrade;
  };
}

const notBound = (): AccessError =>
  new AccessError("The session does not belong to the caller, or does not exist.", "not-bound");

// The clock, the client actions and the forward options are checked by the functions that read them.
const hostOptionsSchema = v.strictObject({
  engine: methodsSchema<Engine>("start", "apply", "view", "deadlines", "pending", "scorerView", "results"),
  store: methodsSchema<SessionStore>("create", "load", "save"),
  scheduler: methodsSchema<Scheduler>("schedule"),
  clock: v.unknown(),
  gate: methodsSchema<AssetGate>("sign"),
  packages: functionSchema<(session: string) => Promise<QtiPackage>>(),
  clientActions: v.optional(v.unknown()),
  limits: v.optional(recordSchema),
  forward: v.optional(v.unknown()),
});

function checkHostOptions(options: unknown): asserts options is SessionHostOptions {
  checkClock(parseWith(hostOptionsSchema, options, "The options object").clock);
}

/** Returns the action as the log of a session keeps it: candidate actions in the runtime's JSON form, host actions without their payloads. */
function loggedAction(action: CandidateAction | HostAction, at: number): string {
  switch (action.type) {
    case "time":
      return JSON.stringify({ at, action: { type: action.type } });
    case "supply-scores":
      return JSON.stringify({ at, action: { type: action.type, request: action.request, scorer: action.scorer } });
    case "cat-response":
      return JSON.stringify({ at, action: { type: action.type, request: action.request } });
    default:
      return JSON.stringify({ at, action: actionToJson(action) });
  }
}

/**
 * Creates the session host of exam mode: the one place where the engine runs for a candidate who is not trusted with its
 * keys.
 *
 * @remarks
 * - **Caller binding.** An envelope carries no session identifier. The host's authentication gives the session and the
 *   principal, and a session belongs to the principal that started it.
 * - **Idempotence.** A repeated sequence number gets the stored answer, with fresh asset tokens; a stale one is refused.
 * - **Time.** An action is stamped with the server's clock (the runtime's `stamp` never goes back), the deadlines of the new
 *   state are scheduled before it is saved so that a failure of the scheduler loses no time-out, and the scheduler's job
 *   calls {@link SessionHost.host} with `time`.
 * - **Saving.** The store saves by version; a conflict reloads and handles the request again.
 * - **Events.** After the save, the events of the step go to {@link SessionHostOptions.forward}. If forwarding throws,
 *   the step stays saved and the error reaches the caller; `forwardEvents` is idempotent for the same step, so a host
 *   that needs every event reports the step again.
 *
 * @param options - See {@link SessionHostOptions}.
 * @returns The session host.
 * @throws `DataError` when an option has the wrong type.
 */
export function createSessionHost(options: SessionHostOptions): SessionHost {
  checkHostOptions(options);
  const { engine, store, scheduler, clock, gate, packages, limits = {}, forward } = options;
  const policy = readClientActions(options.clientActions ?? EXAM_CLIENT_ACTIONS);

  /** Builds the envelope of a state: the view the policy lets the client act on, with fresh tokens and the documents of its content. */
  const envelopeOf = async (
    session: string,
    state: DeliveryState,
    now: number,
    seq: number,
    refusal?: ViewEnvelope["refusal"],
  ): Promise<ViewEnvelope> => {
    const pkg = await packages(session);
    const full = engine.view(state, now);
    const view: CandidateView = { ...full, actions: full.actions.filter((type) => policy.has(type)) };
    return {
      seq,
      view: viewToJson(view),
      assets: await gate.sign(session, collectAssetPrefixes(view, pkg), now),
      documents: locateDocuments(view, pkg),
      ...(refusal === undefined ? {} : { refusal }),
    };
  };

  /** Schedules the maximum times of a state. The queue ignores a time it has for the session. */
  const scheduleDeadlines = async (session: string, state: DeliveryState): Promise<void> => {
    for (const deadline of engine.deadlines(state)) {
      if (deadline.kind === "max-time") await scheduler.schedule(session, Math.ceil(deadline.at));
    }
  };

  /** Gives the events of a saved step, and the score it supplied, to the host's forwarding. */
  const forwardStep = async (
    session: string,
    step: number,
    { events, supplied }: Pick<NonNullable<Attempt<unknown>["change"]>, "events" | "supplied">,
  ): Promise<void> => {
    if (forward === undefined) return;
    await forwardEvents({ session, step, events, ...(supplied === undefined ? {} : { supplied }) }, forward);
  };

  /**
   * Loads the session and runs an attempt at changing it, saving the change by version. The deadlines are scheduled
   * before the save, and the events forwarded after it.
   */
  const transact = async <T>(
    session: string,
    missing: () => Error,
    attempt: (stored: StoredSession, now: number) => Promise<Attempt<T>>,
  ): Promise<T> => {
    for (let retries = 0; retries <= MAX_SAVE_RETRIES; retries += 1) {
      const stored = await store.load(session);
      if (stored === undefined) throw missing();
      const { result, change } = await attempt(stored, readClock(clock));
      if (change === undefined) return result;
      await scheduleDeadlines(session, change.state);
      const saved = await store.save(session, {
        state: serializeState(change.state),
        principal: stored.principal,
        version: stored.version,
        seq: change.seq,
        envelope: change.envelope,
        action: change.action,
      });
      if (!saved) continue;
      await forwardStep(session, stored.version + 1, change);
      return result;
    }
    throw new ServiceError(
      `The session ${describe(session)} was saved by another request ${MAX_SAVE_RETRIES + 1} times in a row; the request was not applied.`,
      409,
      "",
    );
  };

  /** Applies an action on the authority of the host: no caller, no sequence number, and the stored answer stays. */
  const authority = (session: string, action: CandidateAction | HostAction, supplied?: SuppliedGrade): Promise<Step> =>
    transact<Step>(
      session,
      () => new DataError(`The session ${describe(session)} does not exist.`),
      async (stored, now) => {
        const state = deserializeState(stored.state);
        const stamped = stamp(state, action, now);
        const step = engine.apply(state, stamped);
        if (!step.ok) return { result: step };
        return {
          result: step,
          change: {
            state: step.state,
            seq: stored.seq,
            envelope: stored.envelope,
            action: loggedAction(action, stamped.at),
            events: step.events,
            ...(supplied === undefined ? {} : { supplied }),
          },
        };
      },
    );

  const stateOf = async (session: string): Promise<DeliveryState> => {
    const stored = await store.load(session);
    if (stored === undefined) throw new DataError(`The session ${describe(session)} does not exist.`);
    return deserializeState(stored.state);
  };

  const boundTo = async (caller: Caller): Promise<StoredSession> => {
    checkCaller(caller);
    const stored = await store.load(caller.session);
    if (stored?.principal !== caller.principal) throw notBound();
    return stored;
  };

  /** Answers a request again: the stored envelope, with tokens that have not expired. */
  const replay = async (session: string, stored: StoredSession, now: number): Promise<ViewEnvelope> => {
    const answer: unknown = JSON.parse(stored.envelope);
    checkViewEnvelope(answer);
    return { ...answer, assets: await gate.sign(session, Object.keys(answer.assets), now) };
  };

  /** Applies the action of a request to the stored state and builds the change and the answer. */
  const applyRequest = async (
    caller: Caller,
    envelope: ActionEnvelope,
    stored: StoredSession,
    now: number,
  ): Promise<Attempt<ViewEnvelope>> => {
    const action = parseCandidateAction(envelope.action, limits);
    checkClientAction(policy, action.type);
    const state = deserializeState(stored.state);
    const stamped = stamp(state, action, now);
    const step = engine.apply(state, stamped);
    const next = step.ok ? step.state : state;
    const reply = await envelopeOf(caller.session, next, now, envelope.seq, step.ok ? undefined : step.refusal);
    return {
      result: reply,
      change: {
        state: next,
        seq: envelope.seq,
        envelope: JSON.stringify(reply),
        action: JSON.stringify({ at: stamped.at, action: envelope.action }),
        events: step.ok ? step.events : [],
      },
    };
  };

  const handleRequest = (caller: Caller, envelope: ActionEnvelope): Promise<ViewEnvelope> =>
    transact(caller.session, notBound, async (stored, now) => {
      if (stored.principal !== caller.principal) throw notBound();
      if (envelope.seq === stored.seq) return { result: await replay(caller.session, stored, now) };
      if (envelope.seq < stored.seq) {
        throw new DataError(
          `The sequence number ${envelope.seq} is stale: the latest request answered has ${stored.seq}.`,
        );
      }
      return applyRequest(caller, envelope, stored, now);
    });

  return {
    start: async (caller, startOptions) => {
      checkCaller(caller);
      checkRecord(startOptions, "The options of start must be an object");
      const { session, principal } = caller;
      const exists = (): AccessError =>
        new AccessError(
          `The session ${describe(session)} exists already; a session is never started again or bound to another principal.`,
          "session-exists",
        );
      if ((await store.load(session)) !== undefined) throw exists();
      const now = readClock(clock);
      const step = engine.start({ ...startOptions, at: now });
      if (!step.ok) throw new DataError(`The session cannot start: ${step.refusal.message}`);
      const reply = await envelopeOf(session, step.state, now, 0);
      await scheduleDeadlines(session, step.state);
      const created = await store.create(session, {
        state: serializeState(step.state),
        principal,
        envelope: JSON.stringify(reply),
      });
      if (!created) throw exists();
      if (forward !== undefined) await forwardEvents({ session, step: "start", events: step.events }, forward);
      return reply;
    },
    check: async (caller) => {
      await boundTo(caller);
    },
    view: async (caller) => {
      const stored = await boundTo(caller);
      return envelopeOf(caller.session, deserializeState(stored.state), readClock(clock), stored.seq);
    },
    handle: async (caller, envelope) => {
      checkCaller(caller);
      checkActionEnvelope(envelope);
      return handleRequest(caller, envelope);
    },
    proctor: async (session, action) => {
      checkNonEmptyString(session, "The session");
      checkRecord(action, "The action must be an object with a type");
      checkChoice(action.type, "The type of a proctor action", PROCTOR_ACTIONS);
      return authority(session, { type: action.type });
    },
    host: async (session, action, scoredBy) => {
      checkNonEmptyString(session, "The session");
      checkHostAction(action);
      if (action.type !== "supply-scores" || forward?.caliper === undefined) return authority(session, action);
      checkIri(scoredBy, "The scoredBy of a supply-scores action");
      return authority(session, action, { value: action.value, scorer: action.scorer, scoredBy });
    },
    pending: async (session) => engine.pending(await stateOf(session)),
    scorerView: async (session, request) => engine.scorerView(await stateOf(session), request),
    results: async (session) => markOfficial(engine.results(await stateOf(session))),
  };
}
