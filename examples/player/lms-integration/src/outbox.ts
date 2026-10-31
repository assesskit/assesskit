import type { StepEvents, StepSink } from "@assesskit/player/server";
import type { CallOptions } from "@interopkit/core";

/** What the grade of a session has done so far. */
export interface GradeProgress {
  /** How many steps of the session the last successful publish covered. */
  readonly through: number;
  /**
   * Why the session cannot be published, when it cannot: no retry follows.
   *
   * @defaultValue none
   */
  readonly failed?: string;
}

/** Ends the claim of a session. */
export type Release = () => Promise<void>;

/**
 * The host's durable store between the session host and the jobs: its database, with the table of steps and the record of what
 * each job did. The session host's `log` only appends to it, and the jobs read it outside any step.
 *
 * @remarks
 * Every method takes the `signal` of the job that waits for it, and a store that waits on a service bounds its own time.
 */
export interface Outbox {
  /** Keeps a step by its session and step. Appending the same step again changes nothing. */
  append(step: StepEvents, options?: CallOptions): Promise<void>;
  /** Returns the steps of a session in the order they were saved. */
  steps(session: string, options?: CallOptions): Promise<readonly StepEvents[]>;
  /** Returns the steps of a session whose events the event job has not handled. */
  unhandled(session: string, options?: CallOptions): Promise<readonly StepEvents[]>;
  /** Records that the event job handled a step: it sent the events, or it refused the step for the reason given. */
  markHandled(session: string, step: StepEvents["step"], refusal?: string, options?: CallOptions): Promise<void>;
  /** Returns what the grade of a session has done. */
  progress(session: string, options?: CallOptions): Promise<GradeProgress>;
  /**
   * Takes the time of the next attempt to publish and records it before the request is sent: the later of `floor` and one
   * millisecond after the last attempt, whether or not that attempt succeeded. A resend after a timeout or a crash then takes
   * a later time, as the score service requires. It also records that the attempt covers `covers` steps.
   *
   * @returns The time in ISO 8601 UTC with milliseconds.
   */
  nextAttempt(session: string, floor: string, covers: number, options?: CallOptions): Promise<string>;
  /** Records that the last attempt reached the learning platform: the steps it covered are published. */
  markSent(session: string, options?: CallOptions): Promise<void>;
  /** Records that a session cannot be published, so that no job retries it. */
  markFailed(session: string, reason: string, options?: CallOptions): Promise<void>;
  /**
   * Claims a session for one job. Returns `undefined` when another job holds it: the caller stops and the host's queue
   * retries it later. A claim must be exclusive across the host's processes, such as a row lock or a lease.
   */
  claim(session: string, options?: CallOptions): Promise<Release | undefined>;
}

/**
 * Returns the `log` of the session host: it appends each step to the outbox and does nothing else, so that nothing in a step
 * reaches the network, an outage never delays a candidate, and a failure never reads as a failure of the CAT engine.
 */
export function outboxLog(outbox: Outbox): StepSink {
  return (step) => outbox.append(step);
}
