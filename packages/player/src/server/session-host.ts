import type { CatSessionPort } from "@assesskit/runtime/cat";
import type { ActionLimits, Engine, StartOptions } from "@assesskit/runtime/delivery";
import type { QtiPackage } from "@assesskit/runtime/package";
import type {
  Caller,
  CallOptions,
  Clock,
  HostSession,
  HostStep,
  OfficialResult,
  ViewEnvelope,
} from "../protocol/index.js";
import type { ForwardOptions } from "./forward.js";
import type { AssetGate } from "./gate/index.js";
import type { CandidateActionType } from "./policy.js";
import type { Scheduler } from "./scheduler.js";
import type { SessionStore } from "./session-store.js";

/** How many times a request is handled again after another request saved the session first, before it fails. */
export const MAX_SAVE_RETRIES = 3;

/** The actions the proctor takes on the host's authority: the break and the ends that a candidate must not force on a clock. */
export const PROCTOR_ACTIONS = ["suspend", "resume", "end-part", "end-test"] as const;

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
  /** Returns the package that a session delivers; the gate takes the same function. It may ignore the options. */
  readonly packages: (session: string, options?: CallOptions) => Promise<QtiPackage>;
  /**
   * The types of action a client may send, `suspend` and `resume` among them only if the host lets candidates pause.
   *
   * @defaultValue `EXAM_CLIENT_ACTIONS`, every type but `suspend` and `resume`
   */
  readonly clientActions?: readonly CandidateActionType[];
  /**
   * Whether a candidate whose profile has breaks may send `suspend` and `resume` beside `clientActions`, so that the candidate
   * takes a break without a proctor and comes back to every response, with the clocks stopped meanwhile.
   *
   * @remarks
   * The support is `environment` with `breaks`, on. Without it the breaks of such a candidate go through the proctor too.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/conf/ | QTI 3.0 Conformance and Certification, A-11}
   * @defaultValue `true`
   */
  readonly profileBreaks?: boolean;
  /**
   * The longest gap between steps, in milliseconds, that counts as time on task, as on `createLocalSession`: a gap above
   * it counts as suspended, from the latest step to the next action of the candidate or of the host, while the session is in
   * progress.
   *
   * @remarks
   * Never set it for an exam: it suspends on behalf of the candidate, which the policy of an exam does not allow
   * (`createSessionHost` throws `DataError` unless `clientActions` has `suspend`). A `time` action that finds a gap above it
   * is dropped: nothing is saved or scheduled, and the next action closes the gap.
   *
   * @defaultValue none, so that every gap counts
   */
  readonly maxIdleMs?: number;
  /**
   * The limits on the size of an action, which replace the defaults of the runtime's `readCandidateAction` field by field.
   *
   * @defaultValue the runtime's limits
   */
  readonly limits?: Partial<ActionLimits>;
  /**
   * Where the events of each step go: the host's log.
   *
   * @defaultValue nowhere
   */
  readonly forward?: ForwardOptions;
  /**
   * The port of the CAT engines of the adaptive sections. Each call then answers the CAT requests that wait, one at a time,
   * saving each answer before the next request.
   *
   * @defaultValue none, so that the host answers with `cat-response` actions itself
   */
  readonly cat?: CatSessionPort;
}

/** The server side of a delivery session in exam mode. */
export interface SessionHost {
  /**
   * Starts a session at the time of the clock and binds it to `caller.principal`. The state, the principal and the first
   * envelope are stored, the deadlines scheduled and the events of the start forwarded. The seed stays on the server.
   *
   * @param caller - The session to start and the principal to bind it to.
   * @param options - What `Engine.start` takes but the time, and the `signal` of the call, which does not reach the engine.
   * @returns The first envelope, with the sequence number 0.
   * @throws `AccessError` (`session-exists`) when the session exists: a session is never started again or rebound.
   * @throws `DataError` when an argument has the wrong type, or the engine cannot start.
   * @throws `signal.reason` when the signal aborts before the store or the scheduler is called. A call that waits on one
   * rejects when the service does.
   */
  start(caller: Caller, options: Omit<StartOptions, "at"> & CallOptions): Promise<ViewEnvelope>;
  /**
   * Checks that the session is bound to the caller's principal.
   *
   * @param caller - The session and the authenticated principal.
   * @param options - See {@link CallOptions}.
   * @throws `AccessError` (`not-bound`) when it is not, or the session does not exist.
   * @throws `signal.reason` when the signal aborts before the session is loaded.
   */
  check(caller: Caller, options?: CallOptions): Promise<void>;
  /**
   * Returns the current view of the session as an envelope with fresh asset tokens and the sequence number of the latest
   * request answered: what a page needs after a reload, or after the proctor acted. The client's next request carries
   * that number plus one.
   *
   * @param caller - The session and the authenticated principal.
   * @param options - See {@link CallOptions}.
   * @returns The envelope.
   * @throws `AccessError` (`not-bound`) as {@link SessionHost.check} does.
   * @throws `signal.reason` when the signal aborts before the session is loaded.
   */
  view(caller: Caller, options?: CallOptions): Promise<ViewEnvelope>;
  /**
   * Handles a request of the client: checks the caller, answers a repeated sequence number with the stored answer,
   * refuses a stale one, applies the client-action policy, stamps and applies the action, saves, and answers with the
   * view. A refusal of the engine is in the envelope. When another request saved first, it is handled again, up to
   * {@link MAX_SAVE_RETRIES} times.
   *
   * @remarks
   * A `ViewRequest` of `@assesskit/player/protocol` (`{ "type": "view" }`) applies nothing and saves nothing: it is answered as {@link SessionHost.view}
   * answers, so that a client with no action to send, a candidate whom a proctor paused, learns the latest view through the
   * route that carries its actions.
   *
   * @param caller - The session and the authenticated principal.
   * @param envelope - The request as it arrived, parsed from JSON: an `ActionEnvelope` or a `ViewRequest`, both of `@assesskit/player/protocol`.
   * @param options - See {@link CallOptions}.
   * @returns The envelope that answers it.
   * @throws `AccessError` (`not-bound`) when the session is not bound to the caller's principal.
   * @throws `DataError` when the envelope or the action is not valid, the action is outside the policy, or the sequence number is stale.
   * @throws `SecurityError` when the action is above a limit of `limits`.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   * @throws `signal.reason` when the signal aborts before a load, including the load of a retry. Nothing was applied.
   */
  handle(caller: Caller, envelope: unknown, options?: CallOptions): Promise<ViewEnvelope>;
  /**
   * Applies an action on the proctor's authority, such as a break or the end of a part. A refusal of the engine is in the
   * step and changes nothing.
   *
   * @param session - The identifier of the session.
   * @param action - The action.
   * @param options - See {@link CallOptions}.
   * @returns The events of the step, or the refusal.
   * @throws `DataError` when the session does not exist or the action is not valid.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   * @throws `signal.reason` when the signal aborts before a load. Nothing was applied.
   */
  proctor(
    session: string,
    action: { readonly type: (typeof PROCTOR_ACTIONS)[number] },
    options?: CallOptions,
  ): Promise<HostStep>;
  /**
   * Returns the host side of a session: the actions of the host, its pending work, its scorer views and its official
   * results. Each method loads the session when it is called.
   *
   * @param session - The identifier of the session.
   * @returns The host side of the session, with results branded as official.
   * @throws `DataError` when `session` is not a non-empty string. Each method of the result rejects with `DataError` when
   * the session does not exist.
   * @remarks It gives full host powers and the correct responses for a bare session id. Call it only from the host's
   * rater and service endpoints, and never with an identifier that a candidate supplies. A `time` action, which the
   * scheduler's job sends, is idempotent. A `supply-scores` action reaches the host's log with the score it supplied and the
   * `scoredBy` option of `apply`, when the host gave one.
   */
  session(session: string): HostSession<OfficialResult>;
}
