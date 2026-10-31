import type { ToolScoreIntake } from "@assesskit/player/server";
import type { CallOptions } from "@interopkit/core";
import type { Outbox } from "./outbox.ts";

/** What the settle job needs. */
export interface SettleJobOptions {
  /** The host's store, from which the job reads the steps that the `log` appended. */
  readonly outbox: Outbox;
  /** The intake, of which the job uses `settle`. */
  readonly intake: Pick<ToolScoreIntake, "settle">;
}

/**
 * Supplies the scores that a tool gave before the session asked for them: gives each step of the session to `intake.settle`,
 * which supplies the kept final score of the items whose requests the step made.
 *
 * @remarks
 * The job runs outside any step, and the host's queue retries it after a failure. It is safe to repeat: `settle` supplies only
 * the requests that are still open, so a run that finds them answered makes no step. A host with long sessions keeps the steps
 * it settled and gives only the new ones.
 *
 * @param session - The identifier of the session.
 * @param options - See {@link SettleJobOptions}.
 * @param call - The `signal` that ends this job's wait.
 * @throws `DataError` when the session refuses a score, and the error of the outbox or of the session host.
 */
export async function runSettleJob(session: string, options: SettleJobOptions, call: CallOptions = {}): Promise<void> {
  for (const step of await options.outbox.steps(session, call)) await options.intake.settle(step);
}
