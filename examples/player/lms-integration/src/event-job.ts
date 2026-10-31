import type { StepEvents, SuppliedGrade } from "@assesskit/player/server";
import { type CallOptions, type Clock, DataError } from "@interopkit/core";
import { type CaliperEvent, type CaliperSender, checkIri, sendCaliper } from "@interopkit/learning-analytics";
import type { CaliperContext, CaliperParties } from "./context.ts";
import { caliperEvents } from "./events.ts";
import { type CaliperGrade, caliperGrade } from "./grade.ts";
import type { Outbox } from "./outbox.ts";

/** What the event job needs. */
export interface EventJobOptions {
  /** The host's store, from which the job reads the steps that the `log` appended. */
  readonly outbox: Outbox;
  /** Returns the parties of a session: the candidate's IRI, the test's and the application's. */
  readonly parties: (session: string, options?: CallOptions) => CaliperParties | Promise<CaliperParties>;
  /** The endpoint, the token, `fetch` and the sensor. */
  readonly sender: CaliperSender;
  /** Gives the time of sending. */
  readonly clock: Clock;
}

/** A step that the job refused, and why. */
export interface RefusedStep {
  readonly step: StepEvents["step"];
  readonly reason: string;
}

/** What one run of the event job did. */
export interface EventJobResult {
  /** How many envelopes it sent. */
  readonly sent: number;
  /** The steps whose score it did not report, because the step named no scorer by an IRI. */
  readonly refused: readonly RefusedStep[];
}

/** The number a value is, when it is a single number: the one kind of value that a score can be. */
function scoreOf({ value }: SuppliedGrade): number | undefined {
  return value?.cardinality === "single" && typeof value.value === "number" ? value.value : undefined;
}

/**
 * Returns the grades of a step that supplied a score: one for each event that applied or replaced a score. The event gives the
 * time, the item and the position, and the supplied value the score. The scorer is left to the caller.
 */
function gradesOf({ events, supplied }: StepEvents): Omit<CaliperGrade, "scorer" | "scoredBy">[] {
  const scoreGiven = supplied === undefined ? undefined : scoreOf(supplied);
  if (scoreGiven === undefined) return [];
  return events.flatMap((event, index) =>
    event.type === "scores-applied" || event.type === "scores-replaced"
      ? [{ index, at: event.at, ...(event.item === undefined ? {} : { item: event.item }), scoreGiven }]
      : [],
  );
}

/** Returns the scorer of a supplied score, or why the step cannot say: the player passes `scoredBy` as the host gave it. */
function scorerOf({ scorer, scoredBy }: SuppliedGrade): Pick<CaliperGrade, "scorer" | "scoredBy"> | string {
  try {
    checkIri(scoredBy, "The scoredBy of a supply-scores step");
    return { scorer, scoredBy };
  } catch (error) {
    if (error instanceof DataError) return error.message;
    throw error;
  }
}

/** Maps a step to its Caliper events; a step whose grades cannot be reported gives its other events and the reason. */
function eventsOf(step: StepEvents, context: CaliperContext): { events: CaliperEvent[]; refusal?: string } {
  const events = [...caliperEvents(step.events, context)];
  const grades = gradesOf(step);
  if (grades.length === 0 || step.supplied === undefined) return { events };
  const scorer = scorerOf(step.supplied);
  if (typeof scorer === "string") return { events, refusal: scorer };
  return { events: [...events, ...grades.map((grade) => caliperGrade({ ...grade, ...scorer }, context))] };
}

/**
 * Sends the Caliper events of the steps that the `log` appended and the job has not handled, one envelope for each step.
 *
 * @remarks
 * The job runs outside any step, and the host's queue retries it after a failure. A step is marked handled once its events
 * are sent, so a retry sends the steps that failed and no others; a step that is sent twice, such as after a crash between
 * the send and the mark, gives the same event identifiers. A `supply-scores` step without a scorer by an IRI is marked with
 * the reason, and its other events go out. Caliper defines no deduplication, so an endpoint may hold both copies of a
 * resent event.
 *
 * @param session - The identifier of the session.
 * @param options - See {@link EventJobOptions}.
 * @param call - The `signal` that ends this job's wait.
 * @returns What it sent and what it refused.
 * @throws `ServiceError` when the endpoint does not accept the events, and `DataError` for a step the mapping cannot read.
 */
export async function runEventJob(
  session: string,
  options: EventJobOptions,
  call: CallOptions = {},
): Promise<EventJobResult> {
  const { outbox, parties, sender, clock } = options;
  let sent = 0;
  const refused: RefusedStep[] = [];
  for (const step of await outbox.unhandled(session, call)) {
    const context = { ...(await parties(session, call)), session, step: step.step };
    const { events, refusal } = eventsOf(step, context);
    if (events.length > 0) {
      await sendCaliper(events, { ...sender, sendTime: clock.now(), ...call });
      sent += 1;
    }
    if (refusal !== undefined) refused.push({ step: step.step, reason: refusal });
    await outbox.markHandled(session, step.step, refusal, call);
  }
  return { sent, refused };
}
