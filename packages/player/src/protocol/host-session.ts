import {
  type CallOptions,
  checkAbortSignal,
  checkNonEmptyString,
  checkOptional,
  checkProperties,
  checkRecord,
} from "@assesskit/runtime/checks";
import type { DeliveryEvent, HostAction, PendingWork, Refusal, ScorerView } from "@assesskit/runtime/delivery";
import type { AssessmentResult } from "@assesskit/runtime/results";

/** The options of {@link HostSession.apply}. */
export interface HostApplyOptions extends CallOptions {
  /**
   * Who supplies a score, such as the rater or the scoring service: a non-empty string that a session host passes to its
   * log with the step of a `supply-scores` action. A local session ignores it.
   *
   * @defaultValue none
   */
  readonly scoredBy?: string;
}

/** A failure of the answer loop of the option `cat`, reported as a value. */
export interface CatFailure {
  /** The identifier of the CAT request that got no answer; empty when the pending work could not be read. */
  readonly request: string;
  /** What went wrong, as the error says it. */
  readonly message: string;
}

/** What the host side answers to an action: the events of the step, and the engine's refusal when it did not apply. */
export interface HostStep {
  /** The events of the step, in order; empty when the action was refused or changed nothing. */
  readonly events: readonly DeliveryEvent[];
  /**
   * Why the engine refused the action.
   *
   * @defaultValue none, the action was applied
   */
  readonly refusal?: Refusal;
  /**
   * Why CAT requests still wait after the step, when the option `cat` failed to answer one. The step stands.
   *
   * @defaultValue none
   */
  readonly catFailure?: CatFailure;
}

/** The host side of one candidate session, which a session host on a server and a local session on a device both offer. */
export interface HostSession<TResult extends AssessmentResult = AssessmentResult> {
  /**
   * Applies an action of the host, `time`, `supply-scores` or `cat-response`, stamped by the session's clock and never
   * before the latest step, and saves the state when the engine accepts it. A `time` that finds nothing to do is accepted
   * with no events; it is refused only as `ended` or `suspended`.
   *
   * @returns The events of the step, or the engine's refusal, which changes nothing, and `catFailure` when the option
   * `cat` failed after the step.
   * @throws `DataError` when the action is not an action of the host or is malformed, or the session does not exist.
   * @throws `ServiceError` when a session host cannot save after its retries; a local session rejects with the store's
   * error.
   * @throws `signal.reason` when the signal aborts.
   * @remarks On a session host, forwarding runs after the save. When it throws, the step stays saved and the call rejects,
   * so a retried `supply-scores` reports `scores-replaced` and reaches the log a second time.
   */
  apply(action: HostAction, options?: HostApplyOptions): Promise<HostStep>;
  /** Returns what the engine waits on the host for: scoring requests without a value, and CAT requests. */
  pending(options?: CallOptions): Promise<PendingWork>;
  /**
   * Returns what a scorer needs to rate a request: the correct responses, and the scoring rubric of the request when it
   * has one.
   *
   * @throws `DataError` when the session or the request does not exist.
   * @remarks In exam mode, call it only from a rater's endpoint, never from a candidate's. A local session holds the keys
   * by design, for practice.
   */
  scorerView(request: string, options?: CallOptions): Promise<ScorerView>;
  /** Returns the results report of the session; it is provisional while scoring requests are pending. */
  results(options?: CallOptions): Promise<TResult>;
}

const HOST_APPLY_OPTIONS = ["signal", "scoredBy"] as const;

/**
 * Checks the options of {@link HostSession.apply}.
 *
 * @throws `DataError` when they are not absent or an object with a `signal` that is an `AbortSignal`, a `scoredBy` that is
 * a non-empty string, and no other property.
 */
export function checkHostApplyOptions(options: unknown): asserts options is HostApplyOptions | undefined {
  if (options === undefined) return;
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", HOST_APPLY_OPTIONS);
  checkOptional(options.signal, (value) => checkAbortSignal(value, "The option signal"));
  checkOptional(options.scoredBy, (value) => checkNonEmptyString(value, "The option scoredBy"));
}
