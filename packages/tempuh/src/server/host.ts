import {
  type ActionLimits,
  actionToJson,
  type CandidateAction,
  type CandidateView,
  type DeliveryEvent,
  type DeliveryState,
  deserializeState,
  type Engine,
  type HostAction,
  type PendingWork,
  parseCandidateAction,
  type ScorerView,
  type StartOptions,
  type Step,
  serializeState,
  stamp,
  viewToJson,
} from "@luthfanwakan/olah/delivery";
import type { QtiPackage } from "@luthfanwakan/olah/package";
import { checkIri } from "../caliper/context.js";
import { checkChoice, checkFunction, checkNonEmptyString, checkProperties, checkRecord, describe } from "../checks.js";
import { AccessError, DataError, ServiceError } from "../errors.js";
import { type Clock, checkClock, readClock } from "../lti/clock.js";
import {
  type ActionEnvelope,
  type Caller,
  checkActionEnvelope,
  checkCaller,
  checkViewEnvelope,
  type OfficialResult,
  type ViewEnvelope,
} from "../protocol/index.js";
import { markOfficial } from "../protocol/official.js";
import { type ForwardOptions, forwardEvents, type SuppliedGrade } from "./forward.js";
import { locateDocuments } from "./gate/documents.js";
import type { AssetGate } from "./gate/gate.js";
import { collectAssetPrefixes } from "./gate/prefixes.js";
import { type CandidateActionType, checkClientAction, EXAM_CLIENT_ACTIONS, readClientActions } from "./policy.js";
import type { Scheduler, SessionStore, StoredSession } from "./stores.js";

/** How many times a request is handled again after another request saved the session first, before it fails (tempuh design §2.3). */
export const MAX_SAVE_RETRIES = 3;

/** The actions the proctor takes on the host's authority: the break and the ends that a candidate must not force on a clock. */
const PROCTOR_ACTIONS = ["suspend", "resume", "end-part", "end-test"] as const;

/** The actions of the host (E22), which a candidate never sends. */
const HOST_ACTIONS = ["time", "supply-scores", "cat-response"] as const;

/** The options of {@link createSessionHost}. */
export interface SessionHostOptions {
  /** The delivery engine of the test. One engine serves every session. */
  readonly engine: Engine;
  /** The storage of sessions. */
  readonly store: SessionStore;
  /** The scheduler of time-outs. */
  readonly scheduler: Scheduler;
  /** The clock of the server, such as `SYSTEM_CLOCK`. */
  readonly clock: Clock;
  /** The asset gate that signs the prefixes of each envelope. */
  readonly gate: AssetGate;
  /** Returns the package that a session delivers; the gate takes the same function. */
  readonly packages: (session: string) => Promise<QtiPackage>;
  /** The types of action a client may send, `suspend` and `resume` among them only if the host lets candidates pause. Default: every type but `suspend` and `resume`. */
  readonly clientActions?: readonly CandidateActionType[];
  /** The limits on the size of an action, which replace the defaults of olah's `parseCandidateAction` field by field. Default: olah's. */
  readonly limits?: Partial<ActionLimits>;
  /** Where the events of each step go: the host's log and Caliper. Default: nowhere. */
  readonly forward?: ForwardOptions;
}

/** The server side of a delivery session in exam mode (tempuh design §2.3). */
export interface SessionHost {
  /**
   * Starts a session at the time of the clock and binds it to `caller.principal`. The state, the principal and the first
   * envelope are stored, the deadlines scheduled and the events of the start forwarded. The seed stays on the server.
   *
   * @param options - What `Engine.start` takes but the time.
   * @returns The first envelope, with the sequence number 0.
   * @throws `AccessError` (`session-exists`) when the session exists: a session is never started again or rebound.
   * @throws `DataError` when an argument has the wrong type, or the engine cannot start.
   */
  start(caller: Caller, options: Omit<StartOptions, "at">): Promise<ViewEnvelope>;
  /**
   * Checks that the session is bound to the caller's principal.
   *
   * @throws `AccessError` (`not-bound`) when it is not, or the session does not exist.
   */
  check(caller: Caller): Promise<void>;
  /**
   * Returns the current view of the session as an envelope with fresh asset tokens and the sequence number of the latest
   * request answered: what a page needs after a reload, or after the proctor acted. The client's next request carries
   * that number plus one.
   *
   * @throws `AccessError` (`not-bound`) as {@link SessionHost.check} does.
   */
  view(caller: Caller): Promise<ViewEnvelope>;
  /**
   * Handles a request of the client: checks the caller, answers a repeated sequence number with the stored answer,
   * refuses a stale one, applies the client-action policy, stamps and applies the action, saves, and answers with the
   * view. A refusal of the engine is in the envelope. When another request saved first, it is handled again, up to
   * {@link MAX_SAVE_RETRIES} times.
   *
   * @throws `AccessError` (`not-bound`) when the session is not bound to the caller's principal.
   * @throws `DataError` when the envelope or the action is not valid, the action is outside the policy, or the sequence number is stale.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   */
  handle(caller: Caller, envelope: unknown): Promise<ViewEnvelope>;
  /**
   * Applies an action on the host's authority, such as a break (PNP A-11) or the end of a part. A refusal of the engine
   * is returned as the step and changes nothing.
   *
   * @throws `DataError` when the session does not exist or the action is not valid.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   */
  proctor(session: string, action: { readonly type: (typeof PROCTOR_ACTIONS)[number] }): Promise<Step>;
  /**
   * Applies an action of the host: `time`, which the scheduler's job sends and which is idempotent, `supply-scores` or
   * `cat-response`. A refusal of the engine, such as a `time` that finds nothing to apply, is returned as the step.
   * When Caliper is configured, a `supply-scores` action that applies or replaces a score also forwards a GradeEvent of
   * the Grading Profile, scored by `scoredBy`.
   *
   * @param scoredBy - The IRI of the rater or the scoring service that supplies the score, the authenticated caller of the
   * host's rater endpoint. Needed for `supply-scores` when Caliper is configured. Default: none.
   * @throws `DataError` when the session does not exist, the action is not valid, or `scoredBy` is missing or not an
   * absolute IRI where it is needed.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   */
  host(session: string, action: HostAction, scoredBy?: string): Promise<Step>;
  /**
   * Returns what the engine waits on the host for.
   *
   * @throws `DataError` when the session does not exist.
   */
  pending(session: string): Promise<PendingWork>;
  /**
   * Returns what a scorer needs to rate a request, the correct responses included. Only the host's endpoints for raters
   * call it, never a candidate's.
   *
   * @throws `DataError` when the session or the request does not exist.
   */
  scorerView(session: string, request: string): Promise<ScorerView>;
  /**
   * Returns the results report of the session, marked official: the one object that `publishScore` accepts. It is
   * provisional while scoring requests are pending.
   *
   * @throws `DataError` when the session does not exist.
   */
  results(session: string): Promise<OfficialResult>;
}

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

function checkHostOptions(options: unknown): asserts options is SessionHostOptions {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", [
    "engine",
    "store",
    "scheduler",
    "clock",
    "gate",
    "packages",
    "clientActions",
    "limits",
    "forward",
  ]);
  checkRecord(options.engine, "The option engine must be an object");
  for (const name of ["start", "apply", "view", "deadlines", "pending", "scorerView", "results"]) {
    checkFunction(options.engine[name], `The function ${name} of the option engine must be a function`);
  }
  checkRecord(options.store, "The option store must be an object");
  for (const name of ["create", "load", "save"]) {
    checkFunction(options.store[name], `The function ${name} of the option store must be a function`);
  }
  checkRecord(options.scheduler, "The option scheduler must be an object");
  checkFunction(options.scheduler.schedule, "The function schedule of the option scheduler must be a function");
  checkClock(options.clock);
  checkRecord(options.gate, "The option gate must be an object");
  checkFunction(options.gate.sign, "The function sign of the option gate must be a function");
  checkFunction(options.packages, "The option packages must be a function");
  if (options.limits !== undefined) checkRecord(options.limits, "The option limits must be an object");
}

/** Returns the action as the log of a session keeps it: candidate actions in olah's JSON form, host actions without their payloads. */
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
 * Creates the session host of exam mode (tempuh design §2.3): the one place where the engine runs for a candidate who
 * is not trusted with its keys.
 *
 * - **Caller binding.** An envelope carries no session identifier. The host's authentication gives the session and the
 *   principal, and a session belongs to the principal that started it.
 * - **Idempotence.** A repeated sequence number gets the stored answer, with fresh asset tokens; a stale one is refused.
 * - **Time.** An action is stamped with the server's clock (olah's `stamp` never goes back), the deadlines of the new
 *   state are scheduled before it is saved so that a failure of the scheduler loses no time-out, and the scheduler's job
 *   calls {@link SessionHost.host} with `time`.
 * - **Saving.** The store saves by version; a conflict reloads and handles the request again.
 * - **Events.** After the save, the events of the step go to {@link SessionHostOptions.forward}. If forwarding throws,
 *   the step stays saved and the error reaches the caller; `forwardEvents` is idempotent for the same step, so a host
 *   that needs every event reports the step again.
 *
 * @param options - See {@link SessionHostOptions}.
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
      checkRecord(action, "The action must be an object with a type");
      checkChoice(action.type, "The type of a host action", HOST_ACTIONS);
      if (action.type !== "supply-scores" || forward?.caliper === undefined) return authority(session, action);
      checkIri(scoredBy, "The scoredBy of a supply-scores action");
      return authority(session, action, { value: action.value, scorer: action.scorer, scoredBy });
    },
    pending: async (session) => engine.pending(await stateOf(session)),
    scorerView: async (session, request) => engine.scorerView(await stateOf(session), request),
    results: async (session) => markOfficial(engine.results(await stateOf(session))),
  };
}
