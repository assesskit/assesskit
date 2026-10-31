import type {
  ActionLimits,
  Engine,
  HostAction,
  PendingWork,
  ScorerView,
  StartOptions,
  Step,
} from "@assesskit/runtime/delivery";
import type { QtiPackage } from "@assesskit/runtime/package";
import type { Caller, Clock, OfficialResult, ViewEnvelope } from "../protocol/index.js";
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
  /** Returns the package that a session delivers; the gate takes the same function. */
  readonly packages: (session: string) => Promise<QtiPackage>;
  /**
   * The types of action a client may send, `suspend` and `resume` among them only if the host lets candidates pause.
   *
   * @defaultValue `EXAM_CLIENT_ACTIONS`, every type but `suspend` and `resume`
   */
  readonly clientActions?: readonly CandidateActionType[];
  /**
   * The limits on the size of an action, which replace the defaults of the runtime's `parseCandidateAction` field by field.
   *
   * @defaultValue the runtime's limits
   */
  readonly limits?: Partial<ActionLimits>;
  /**
   * Where the events of each step go: the host's log and Caliper.
   *
   * @defaultValue nowhere
   */
  readonly forward?: ForwardOptions;
}

/** The server side of a delivery session in exam mode. */
export interface SessionHost {
  /**
   * Starts a session at the time of the clock and binds it to `caller.principal`. The state, the principal and the first
   * envelope are stored, the deadlines scheduled and the events of the start forwarded. The seed stays on the server.
   *
   * @param caller - The session to start and the principal to bind it to.
   * @param options - What `Engine.start` takes but the time.
   * @returns The first envelope, with the sequence number 0.
   * @throws `AccessError` (`session-exists`) when the session exists: a session is never started again or rebound.
   * @throws `DataError` when an argument has the wrong type, or the engine cannot start.
   */
  start(caller: Caller, options: Omit<StartOptions, "at">): Promise<ViewEnvelope>;
  /**
   * Checks that the session is bound to the caller's principal.
   *
   * @param caller - The session and the authenticated principal.
   * @throws `AccessError` (`not-bound`) when it is not, or the session does not exist.
   */
  check(caller: Caller): Promise<void>;
  /**
   * Returns the current view of the session as an envelope with fresh asset tokens and the sequence number of the latest
   * request answered: what a page needs after a reload, or after the proctor acted. The client's next request carries
   * that number plus one.
   *
   * @param caller - The session and the authenticated principal.
   * @returns The envelope.
   * @throws `AccessError` (`not-bound`) as {@link SessionHost.check} does.
   */
  view(caller: Caller): Promise<ViewEnvelope>;
  /**
   * Handles a request of the client: checks the caller, answers a repeated sequence number with the stored answer,
   * refuses a stale one, applies the client-action policy, stamps and applies the action, saves, and answers with the
   * view. A refusal of the engine is in the envelope. When another request saved first, it is handled again, up to
   * {@link MAX_SAVE_RETRIES} times.
   *
   * @param caller - The session and the authenticated principal.
   * @param envelope - The request as it arrived, parsed from JSON.
   * @returns The envelope that answers it.
   * @throws `AccessError` (`not-bound`) when the session is not bound to the caller's principal.
   * @throws `DataError` when the envelope or the action is not valid, the action is outside the policy, or the sequence number is stale.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   */
  handle(caller: Caller, envelope: unknown): Promise<ViewEnvelope>;
  /**
   * Applies an action on the host's authority, such as a break or the end of a part. A refusal of the engine
   * is returned as the step and changes nothing.
   *
   * @param session - The identifier of the session.
   * @param action - The action.
   * @returns The step; its `ok` is false for a refusal.
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
   * @param session - The identifier of the session.
   * @param action - The action.
   * @param scoredBy - The IRI of the rater or the scoring service that supplies the score, the authenticated caller of the
   * host's rater endpoint. Needed for `supply-scores` when Caliper is configured.
   * @returns The step; its `ok` is false for a refusal.
   * @throws `DataError` when the session does not exist, the action is not valid, or `scoredBy` is missing or not an
   * absolute IRI where it is needed.
   * @throws `ServiceError` when the session cannot be saved after the retries.
   */
  host(session: string, action: HostAction, scoredBy?: string): Promise<Step>;
  /**
   * Returns what the engine waits on the host for.
   *
   * @param session - The identifier of the session.
   * @returns The pending work.
   * @throws `DataError` when the session does not exist.
   */
  pending(session: string): Promise<PendingWork>;
  /**
   * Returns what a scorer needs to rate a request, the correct responses included. Only the host's endpoints for raters
   * call it, never a candidate's.
   *
   * @param session - The identifier of the session.
   * @param request - The identifier of the scoring request.
   * @returns The scorer view.
   * @throws `DataError` when the session or the request does not exist.
   */
  scorerView(session: string, request: string): Promise<ScorerView>;
  /**
   * Returns the results report of the session, marked official: the one object that `publishScore` accepts. It is
   * provisional while scoring requests are pending.
   *
   * @param session - The identifier of the session.
   * @returns The report.
   * @throws `DataError` when the session does not exist.
   */
  results(session: string): Promise<OfficialResult>;
}
