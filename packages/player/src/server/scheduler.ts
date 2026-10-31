/**
 * The host's scheduler of time-outs, such as a job queue.
 *
 * @remarks
 * A job calls `SessionHost.host` with a `time` action at the time it was scheduled for. A queue that is not durable
 * loses its jobs with a restart, so a durable one is the host's choice.
 */
export interface Scheduler {
  /**
   * Schedules a `time` action for a session at an epoch millisecond. Calling it again for the same pair changes nothing.
   *
   * @param session - The identifier of the session.
   * @param at - The time in epoch milliseconds.
   */
  schedule(session: string, at: number): Promise<void>;
}
