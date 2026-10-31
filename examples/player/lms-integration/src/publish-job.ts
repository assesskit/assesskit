import type { SessionScore } from "@assesskit/player/scoring";
import { sessionScore } from "@assesskit/player/scoring";
import type { SessionHost, StepEvents } from "@assesskit/player/server";
import { DataError } from "@assesskit/runtime/errors";
import type { CallOptions } from "@interopkit/core";
import type { LtiLaunch } from "@interopkit/tool-integration/tool";
import { type AccessTokenOptions, type AgsScoreInput, publishAgsScore } from "@interopkit/tool-integration/tool";
import type { Outbox } from "./outbox.ts";

/** What the publish job needs. */
export interface PublishJobOptions {
  /** The host's store, in which the job reads the steps and records its attempts. */
  readonly outbox: Outbox;
  /** The session host, of which the job reads `results()` and `pending()`. */
  readonly host: Pick<SessionHost, "session">;
  /** Returns the launch of the learning platform that started the session, or `undefined` when none is on record. */
  readonly launchOf: (session: string, options?: CallOptions) => Promise<LtiLaunch | undefined>;
  /** The registration of the learning platform, the clock, `fetch` and `timeoutMs` of the tool role. */
  readonly tool: AccessTokenOptions;
}

/**
 * What a run of the publish job did.
 *
 * - `published`: the grade reached the learning platform.
 * - `idle`: nothing has changed that the learning platform should hear.
 * - `busy`: another job holds the session; the host's queue retries it.
 * - `failed`: the session cannot be published, and no retry follows.
 */
export type PublishOutcome = "published" | "idle" | "busy" | "failed";

const GRADING_PROGRESS = {
  complete: "FullyGraded",
  "awaiting-service": "Pending",
  "awaiting-person": "PendingManual",
} as const satisfies Record<SessionScore["progress"], AgsScoreInput["gradingProgress"]>;

/**
 * Turns the score of a session into the score of the learning platform: `complete` is `FullyGraded`, `awaiting-service` is
 * `Pending` and `awaiting-person` is `PendingManual`, a negative `SCORE` that was raised to 0 is told in the `comment`, and the
 * session is always `Completed`. A maximum goes with a score and not alone.
 */
export function toAgsScore(score: SessionScore, timestamp: string): AgsScoreInput {
  return {
    activityProgress: "Completed",
    gradingProgress: GRADING_PROGRESS[score.progress],
    timestamp,
    ...(score.score === undefined ? {} : { scoreGiven: score.score }),
    // A maximum belongs to a score: while a person must score, there are no points to be out of.
    ...(score.score === undefined || score.maximum === undefined ? {} : { scoreMaximum: score.maximum }),
    ...(score.rawScore === undefined ? {} : { comment: `Raw score: ${score.rawScore}` }),
  };
}

/**
 * Tells whether a grade is due: the test has ended, and a step that the last publish did not cover ends the test or applies
 * or replaces a score. A score that arrives before the test ends waits for it, because the end is when the first grade goes.
 *
 * @param steps - The steps of the session, in order.
 * @param through - How many steps the last successful publish covered.
 */
export function isDue(steps: readonly StepEvents[], through: number): boolean {
  const has = (step: StepEvents, ...types: readonly string[]): boolean =>
    step.events.some(({ type }) => types.includes(type));
  if (!steps.some((step) => has(step, "test-ended"))) return false;
  return steps.slice(through).some((step) => has(step, "test-ended", "scores-applied", "scores-replaced"));
}

/**
 * Publishes the grade of a session to the learning platform that launched it: reads the state when it runs, never from a step,
 * and sends the latest score with a time later than any attempt before it.
 *
 * @remarks
 * One job runs for a session at a time. The outbox's claim keeps two workers from reading two states and taking their times in
 * the other order, which would leave the older score on the platform. The time is recorded before the request goes out
 * (`Outbox.nextAttempt`), so a resend after a timeout, an abort or a crash before `markSent` takes a later time, as the score
 * service requires: its timestamps strictly increase, and the first request may have arrived even if its answer did not.
 * `results` and `pending` are two loads, so a step in another process can land between them and one send can mix two versions;
 * that step's own run then sends the right pair.
 *
 * @param session - The identifier of the session.
 * @param options - See {@link PublishJobOptions}.
 * @param call - The `signal` that ends this job's wait.
 * @returns What the run did.
 * @throws `ServiceError` when the token or the score request fails, `LtiError` when the launch refuses the scope, and the
 * error of the outbox or of the session host.
 */
export async function runPublishJob(
  session: string,
  options: PublishJobOptions,
  call: CallOptions = {},
): Promise<PublishOutcome> {
  const { outbox, host, launchOf, tool } = options;
  const release = await outbox.claim(session, call);
  if (release === undefined) return "busy";
  try {
    const { through, failed } = await outbox.progress(session, call);
    if (failed !== undefined) return "failed";
    const steps = await outbox.steps(session, call);
    if (!isDue(steps, through)) return "idle";
    const launch = await launchOf(session, call);
    if (launch?.messageType !== "LtiResourceLinkRequest" || launch.ags?.lineitem === undefined) {
      await outbox.markFailed(session, "The session has no launch with a line item to publish to.", call);
      return "failed";
    }
    const state = host.session(session);
    let score: SessionScore;
    try {
      score = sessionScore(await state.results(call), await state.pending(call));
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      await outbox.markFailed(session, error.message, call);
      return "failed";
    }
    const timestamp = await outbox.nextAttempt(session, score.timestamp, steps.length, call);
    await publishAgsScore(toAgsScore(score, timestamp), launch, { ...tool, ...call });
    await outbox.markSent(session, call);
    return "published";
  } finally {
    await release();
  }
}
