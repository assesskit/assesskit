import type { CatPort } from "@assesskit/runtime/cat";
import {
  checkAbortSignal,
  checkChoice,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  describe,
  functionSchema,
  methodsSchema,
  optional,
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
  sendCatRequest,
  serializeState,
  stamp,
  viewToJson,
} from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { QtiPackage } from "@assesskit/runtime/package";
import * as v from "valibot";
import { AccessError, ServiceError } from "../errors.js";
import {
  type ActionEnvelope,
  type Caller,
  checkActionEnvelope,
  checkCaller,
  checkViewEnvelope,
  type HostStep,
  type SessionCallOptions,
  type ViewEnvelope,
} from "../protocol/index.js";
import {
  type CatAnswerer,
  type CatLoopFailure,
  checkCallOptions,
  checkClock,
  checkHostAction,
  checkHostApplyOptions,
  createCatLoops,
  markOfficial,
  readClock,
  stepAfterIdle,
  untilAborted,
} from "../protocol/internal.js";
import type { StepSink, SuppliedGrade } from "./forward.js";
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

// The clock and the client actions are checked by the functions that read them.
const hostOptionsSchema = v.strictObject({
  engine: methodsSchema<Engine>("start", "apply", "view", "deadlines", "pending", "scorerView", "results"),
  store: methodsSchema<SessionStore>("create", "load", "save"),
  scheduler: methodsSchema<Scheduler>("schedule"),
  clock: v.unknown(),
  gate: methodsSchema<AssetGate>("sign"),
  packages: functionSchema<(session: string, options?: SessionCallOptions) => Promise<QtiPackage>>(),
  clientActions: v.optional(v.unknown()),
  maxIdle: v.optional(v.unknown()),
  limits: v.optional(recordSchema),
  forward: v.optional(v.strictObject({ log: functionSchema<StepSink>() })),
  cat: v.optional(methodsSchema<CatPort>("createSession", "submitResults", "endSession")),
});

function checkHostOptions(options: unknown): asserts options is SessionHostOptions {
  const { clock, maxIdle } = parseWith(hostOptionsSchema, options, "The options object");
  checkClock(clock);
  optional(maxIdle, (value) => checkPositiveInteger(value, "The option maxIdle"));
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
 *   calls `session(id).apply` with `time`. With {@link SessionHostOptions.maxIdle}, a gap above it counts as suspended, and
 *   the job's `time` action that finds one is dropped.
 * - **Saving.** The store saves by version; a conflict reloads and handles the request again.
 * - **Signals.** A call with an aborted `signal` stops before its next load and applies nothing. The signal reaches the
 *   store, the scheduler and `packages`. After the save it is ignored, so that forwarding completes.
 * - **Events.** After the save, the events of the step go to the `log` of {@link SessionHostOptions.forward}. If it
 *   throws, the step stays saved and the error reaches the caller. Nothing repeats the step by itself, so a host that needs
 *   every event makes its `log` durable.
 *
 * @param options - See {@link SessionHostOptions}.
 * @returns The session host.
 * @throws `DataError` when an option has the wrong type, or `maxIdle` is set and `clientActions` omit `suspend`.
 */
export function createSessionHost(options: SessionHostOptions): SessionHost {
  checkHostOptions(options);
  const { engine, store, scheduler, clock, gate, packages, limits = {}, forward, cat, maxIdle } = options;
  const policy = readClientActions(options.clientActions ?? EXAM_CLIENT_ACTIONS);
  if (maxIdle !== undefined && !policy.has("suspend")) {
    throw new DataError(
      'The option maxIdle counts a long gap as a suspension, which the option clientActions does not let a client take: it has no "suspend". Add "suspend" to clientActions for a host where candidates may pause, and leave maxIdle out for an exam.',
    );
  }
  const idle = { engine, stamp };
  const loops = createCatLoops();

  /** Loads the record of a session, unless the call was aborted before. */
  const load = (session: string, signal: AbortSignal | undefined): Promise<StoredSession | undefined> => {
    signal?.throwIfAborted();
    return store.load(session, { signal });
  };

  /** Builds the envelope of a state: the view the policy lets the client act on, with fresh tokens and the documents of its content. */
  const envelopeOf = async (
    session: string,
    state: DeliveryState,
    now: number,
    seq: number,
    signal: AbortSignal | undefined,
    refusal?: ViewEnvelope["refusal"],
  ): Promise<ViewEnvelope> => {
    const pkg = await packages(session, { signal });
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
  const scheduleDeadlines = async (
    session: string,
    state: DeliveryState,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    for (const deadline of engine.deadlines(state)) {
      if (deadline.kind === "max-time") await scheduler.schedule(session, Math.ceil(deadline.at), { signal });
    }
  };

  /** Gives the events of a saved step, and the score it supplied, to the host's log. A step without events calls nothing. */
  const forwardStep = async (
    session: string,
    step: "start" | number,
    { events, supplied }: Pick<NonNullable<Attempt<unknown>["change"]>, "events" | "supplied">,
  ): Promise<void> => {
    if (forward === undefined || events.length === 0) return;
    await forward.log({ session, step, events, ...(supplied === undefined ? {} : { supplied }) });
  };

  /**
   * Replaces the stored answer of the latest request with the view after an answer of the CAT engine, keeping its sequence
   * number and its refusal, so that a request that is sent again gets the view the candidate needs. When the envelope cannot
   * be built, the answer is saved with the old one, and `view` gives the current view.
   */
  const refreshed = async (
    session: string,
    state: DeliveryState,
    stored: StoredSession,
    now: number,
  ): Promise<string> => {
    try {
      const previous: unknown = JSON.parse(stored.envelope);
      checkViewEnvelope(previous);
      return JSON.stringify(await envelopeOf(session, state, now, stored.seq, undefined, previous.refusal));
    } catch {
      return stored.envelope;
    }
  };

  /**
   * Loads the session and runs an attempt at changing it, saving the change by version. The deadlines are scheduled
   * before the save, and the events forwarded after it. A signal that aborted stops the call before each load, a retry's
   * included, and the save is the last point it reaches.
   */
  const transact = async <T>(
    session: string,
    signal: AbortSignal | undefined,
    missing: () => Error,
    attempt: (stored: StoredSession, now: number) => Promise<Attempt<T>>,
  ): Promise<T> => {
    for (let retries = 0; retries <= MAX_SAVE_RETRIES; retries += 1) {
      const stored = await load(session, signal);
      if (stored === undefined) throw missing();
      const { result, change } = await attempt(stored, readClock(clock));
      if (change === undefined) return result;
      await scheduleDeadlines(session, change.state, signal);
      const saved = await store.save(
        session,
        {
          state: serializeState(change.state),
          principal: stored.principal,
          version: stored.version,
          seq: change.seq,
          envelope: change.envelope,
          action: change.action,
        },
        { signal },
      );
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
  const authority = (
    session: string,
    action: CandidateAction | HostAction,
    signal: AbortSignal | undefined,
    supplied?: SuppliedGrade,
  ): Promise<HostStep> =>
    transact<HostStep>(
      session,
      signal,
      () => new DataError(`The session ${describe(session)} does not exist.`),
      async (stored, now) => {
        const state = deserializeState(stored.state);
        const taken = stepAfterIdle(idle, { state, action, now, maxIdle });
        if (taken === undefined) return { result: { events: [] } };
        const { step, at } = taken;
        if (!step.ok) return { result: { events: [], refusal: step.refusal } };
        return {
          result: { events: step.events },
          change: {
            state: step.state,
            seq: stored.seq,
            envelope:
              action.type === "cat-response" ? await refreshed(session, step.state, stored, now) : stored.envelope,
            action: loggedAction(action, at),
            events: step.events,
            ...(supplied === undefined ? {} : { supplied }),
          },
        };
      },
    );

  const stateOf = async (session: string, signal: AbortSignal | undefined): Promise<DeliveryState> => {
    const stored = await load(session, signal);
    if (stored === undefined) throw new DataError(`The session ${describe(session)} does not exist.`);
    return deserializeState(stored.state);
  };

  const boundTo = async (caller: Caller, signal: AbortSignal | undefined): Promise<StoredSession> => {
    checkCaller(caller);
    const stored = await load(caller.session, signal);
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
    signal: AbortSignal | undefined,
  ): Promise<Attempt<ViewEnvelope>> => {
    const action = parseCandidateAction(envelope.action, limits);
    checkClientAction(policy, action.type);
    const state = deserializeState(stored.state);
    const { step, at } = stepAfterIdle(idle, { state, action, now, maxIdle });
    const next = step.ok ? step.state : state;
    const reply = await envelopeOf(caller.session, next, now, envelope.seq, signal, step.ok ? undefined : step.refusal);
    return {
      result: reply,
      change: {
        state: next,
        seq: envelope.seq,
        envelope: JSON.stringify(reply),
        action: JSON.stringify({ at, action: envelope.action }),
        events: step.ok ? step.events : [],
      },
    };
  };

  const handleRequest = (
    caller: Caller,
    envelope: ActionEnvelope,
    signal: AbortSignal | undefined,
  ): Promise<ViewEnvelope> =>
    transact(caller.session, signal, notBound, async (stored, now) => {
      if (stored.principal !== caller.principal) throw notBound();
      if (envelope.seq === stored.seq) return { result: await replay(caller.session, stored, now) };
      if (envelope.seq < stored.seq) {
        throw new DataError(
          `The sequence number ${envelope.seq} is stale: the latest request answered has ${stored.seq}.`,
        );
      }
      return applyRequest(caller, envelope, stored, now, signal);
    });

  /** What the answer loop of a session uses: the pending requests, the port, and the saved `cat-response` action. */
  const answererOf = (session: string, port: CatPort): CatAnswerer => ({
    waiting: async () => engine.pending(await stateOf(session, undefined)).cat,
    ask: (request) => sendCatRequest(port, request),
    answer: (request, response) =>
      authority(session, { type: "cat-response", request: request.id, response }, undefined),
  });

  /**
   * Waits as a call that serves a candidate: joins the answer loop of the session or starts it, and returns its failure as a
   * value. The loop takes no signal, so an abort ends this wait and never the loop.
   */
  const serve = async (session: string, signal: AbortSignal | undefined): Promise<CatLoopFailure | undefined> =>
    cat === undefined ? undefined : untilAborted(loops.join(session, answererOf(session, cat)), signal);

  /**
   * Runs the answer loop after a step of the host, unless one runs: that loop reads the pending work again, and a `log` that
   * awaits a call of the host from inside a step of the loop must not wait for the loop that waits for it.
   */
  const finish = async (session: string, step: HostStep): Promise<HostStep> => {
    if (cat === undefined || loops.running(session)) return step;
    const failed = await loops.join(session, answererOf(session, cat));
    return failed === undefined ? step : { ...step, catFailure: failed.failure };
  };

  /** Tells whether the candidate has nothing to do: the session is in progress and presents no item. */
  const stranded = (stored: StoredSession, now: number): boolean => {
    const view = engine.view(deserializeState(stored.state), now);
    return view.status === "in-progress" && view.current === undefined;
  };

  /** Answers a call that serves a candidate with the view the loop left, or rejects with its failure when nothing is left to do. */
  const settled = async (
    session: string,
    answer: ViewEnvelope,
    failure: CatLoopFailure | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ViewEnvelope> => {
    const stored = await load(session, signal);
    if (stored === undefined) return answer;
    const now = readClock(clock);
    if (failure !== undefined && stranded(stored, now)) throw failure.error;
    return stored.seq === answer.seq ? replay(session, stored, now) : answer;
  };

  return {
    start: async (caller, startOptions) => {
      checkCaller(caller);
      checkRecord(startOptions, "The options of start must be an object");
      const { signal, ...engineOptions } = startOptions;
      optional(signal, (value) => checkAbortSignal(value, "The option signal"));
      const { session, principal } = caller;
      const exists = (): AccessError =>
        new AccessError(
          `The session ${describe(session)} exists already; a session is never started again or bound to another principal.`,
          "session-exists",
        );
      if ((await load(session, signal)) !== undefined) throw exists();
      const now = readClock(clock);
      const step = engine.start({ ...engineOptions, at: now });
      if (!step.ok) throw new DataError(`The session cannot start: ${step.refusal.message}`);
      const reply = await envelopeOf(session, step.state, now, 0, signal);
      await scheduleDeadlines(session, step.state, signal);
      const created = await store.create(
        session,
        { state: serializeState(step.state), principal, envelope: JSON.stringify(reply) },
        { signal },
      );
      if (!created) throw exists();
      await forwardStep(session, "start", { events: step.events });
      return cat === undefined ? reply : settled(session, reply, await serve(session, signal), signal);
    },
    check: async (caller, callOptions) => {
      checkCallOptions(callOptions);
      await boundTo(caller, callOptions?.signal);
    },
    view: async (caller, callOptions) => {
      checkCallOptions(callOptions);
      const signal = callOptions?.signal;
      let stored = await boundTo(caller, signal);
      if (cat !== undefined) {
        await serve(caller.session, signal);
        stored = (await load(caller.session, signal)) ?? stored;
      }
      return envelopeOf(caller.session, deserializeState(stored.state), readClock(clock), stored.seq, signal);
    },
    handle: async (caller, envelope, callOptions) => {
      checkCaller(caller);
      checkActionEnvelope(envelope);
      checkCallOptions(callOptions);
      const signal = callOptions?.signal;
      if (cat === undefined) return handleRequest(caller, envelope, signal);
      const bound = await boundTo(caller, signal);
      const before = await serve(caller.session, signal);
      const repeated = envelope.seq === bound.seq;
      const answer = await handleRequest(caller, envelope, signal);
      const after = repeated || before !== undefined ? undefined : await serve(caller.session, signal);
      return settled(caller.session, answer, before ?? after, signal);
    },
    proctor: async (session, action, callOptions) => {
      checkNonEmptyString(session, "The session");
      checkRecord(action, "The action must be an object with a type");
      checkChoice(action.type, "The type of a proctor action", PROCTOR_ACTIONS);
      checkCallOptions(callOptions);
      return finish(session, await authority(session, { type: action.type }, callOptions?.signal));
    },
    session: (session) => {
      checkNonEmptyString(session, "The session");
      return {
        apply: async (action, applyOptions) => {
          checkHostApplyOptions(applyOptions);
          checkHostAction(action);
          const signal = applyOptions?.signal;
          if (action.type !== "supply-scores") return finish(session, await authority(session, action, signal));
          const scoredBy = applyOptions?.scoredBy;
          const supplied = {
            value: action.value,
            scorer: action.scorer,
            ...(scoredBy === undefined ? {} : { scoredBy }),
          };
          return finish(session, await authority(session, action, signal, supplied));
        },
        pending: async (callOptions) => {
          checkCallOptions(callOptions);
          return engine.pending(await stateOf(session, callOptions?.signal));
        },
        scorerView: async (request, callOptions) => {
          checkCallOptions(callOptions);
          return engine.scorerView(await stateOf(session, callOptions?.signal), request);
        },
        results: async (callOptions) => {
          checkCallOptions(callOptions);
          return markOfficial(engine.results(await stateOf(session, callOptions?.signal)));
        },
      };
    },
  };
}
