import type { DeliveryEvent } from "@assesskit/runtime/delivery";
import type { Value } from "@assesskit/runtime/values";
import {
  type CaliperEvent,
  type CaliperGrade,
  type CaliperParties,
  type CaliperSender,
  type CaliperStep,
  caliperEvents,
  caliperGrade,
  sendCaliper,
} from "../caliper/index.js";
import { checkArray, checkFunction, checkNonEmptyString, checkRecord } from "../checks.js";
import { type Clock, checkClock, readClock } from "../lti/internal.js";

/** The score that a `supply-scores` action supplied: the runtime's events name the request and not the value, so the step carries it. */
export interface SuppliedGrade {
  /** The value of the action; only a number gives a GradeEvent. */
  readonly value: Value | null;
  /** Whether a person or a scoring service scored, as the action says. */
  readonly scorer: CaliperGrade["scorer"];
  /** The IRI of the rater or of the service: the authenticated caller of the host's rater endpoint. */
  readonly scoredBy: string;
}

/** The events that one step of a session made, and the place of the step in the session. */
export interface StepEvents {
  /** The identifier of the candidate session. */
  readonly session: string;
  /** `"start"` for the step of `Engine.start`, else the version of the session record that the step saved, which the session host passes. */
  readonly step: CaliperStep;
  /** The events of the step, as the runtime's `Step.events` gives them. */
  readonly events: readonly DeliveryEvent[];
  /**
   * The score of the step when a `supply-scores` action made it.
   *
   * @defaultValue none, so that no GradeEvent is made
   */
  readonly supplied?: SuppliedGrade;
}

/** Where the events of a step go to become Caliper events. */
export interface CaliperForwarding {
  /** Returns the parties of a session: the candidate's IRI, the test's and the application's. */
  readonly parties: (session: string) => CaliperParties | Promise<CaliperParties>;
  /** The endpoint, the token, `fetch` and the sensor. */
  readonly sender: CaliperSender;
  /** Gives the time of sending. */
  readonly clock: Clock;
}

/** The options of {@link forwardEvents}. */
export interface ForwardOptions {
  /**
   * The host's log. It receives the step with every event, as the runtime gave them. Its calls for the same step repeat the
   * step, so a log that must not hold a step twice keeps it by the session and the step.
   */
  readonly log: (step: StepEvents) => void | Promise<void>;
  /**
   * Sends the events that Caliper has a counterpart for.
   *
   * @defaultValue none, so that the events go to the log only
   */
  readonly caliper?: CaliperForwarding;
}

function checkStep(value: unknown): asserts value is StepEvents {
  checkRecord(value, "The step must be an object");
  checkNonEmptyString(value.session, "The session of the step");
  checkArray(value.events, "The events of the step must be an array");
  if (value.supplied !== undefined) checkRecord(value.supplied, "The supplied score of the step must be an object");
}

/** The number a value is, when it is a single number: the one kind of value that a score can be. */
function scoreOf(value: Value | null): number | undefined {
  return value?.cardinality === "single" && typeof value.value === "number" ? value.value : undefined;
}

/**
 * Returns the grades of a step that supplied a score: one for each event that applied or replaced a score. The event gives
 * the time, the item and the position, and the supplied value the score.
 */
function gradesOf(events: readonly DeliveryEvent[], supplied: SuppliedGrade): CaliperGrade[] {
  const scoreGiven = scoreOf(supplied.value);
  if (scoreGiven === undefined) return [];
  return events.flatMap((event, index) =>
    event.type === "scores-applied" || event.type === "scores-replaced"
      ? [
          {
            index,
            at: event.at,
            ...(event.item === undefined ? {} : { item: event.item }),
            scoreGiven,
            scorer: supplied.scorer,
            scoredBy: supplied.scoredBy,
          },
        ]
      : [],
  );
}

function checkForwardOptions(value: unknown): asserts value is ForwardOptions {
  checkRecord(value, "The options must be an object");
  checkFunction(value.log, "The option log must be a function");
  const { caliper } = value;
  if (caliper === undefined) return;
  checkRecord(caliper, "The option caliper must be an object");
  checkFunction(caliper.parties, "The parties of the option caliper must be a function");
  checkRecord(caliper.sender, "The sender of the option caliper must be an object");
  checkClock(caliper.clock);
}

/**
 * Forwards the events of one step of a session: every one of them to the host's log, in the order the runtime gave them and
 * whatever their type, and the ones that Caliper has a counterpart for to the Caliper endpoint.
 *
 * @remarks
 * The log goes first, so that a Caliper failure never loses a log entry. A step without events calls nothing. Calling it
 * again for the same step repeats the log call and sends the same Caliper identifiers, so an endpoint holds each event
 * once.
 *
 * The runtime's `scores-applied` and `scores-replaced` carry the request and not the score, so they map to no event of the
 * Assessment Profile. When the step has `supplied`, each of them also gives a GradeEvent Graded of the Grading Profile
 * (`caliperGrade`), after the mapped events: the score is the supplied value, the scorer and the IRI are the supplied ones,
 * and the item is that of the event.
 *
 * @param step - The events of the step and its place in the session.
 * @param options - The log, and Caliper when the events go there.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ServiceError` when the Caliper endpoint does not accept the events.
 */
export async function forwardEvents(step: StepEvents, options: ForwardOptions): Promise<void> {
  checkStep(step);
  checkForwardOptions(options);
  const { session, events } = step;
  if (events.length === 0) return;
  await options.log(step);
  const { caliper } = options;
  if (caliper === undefined) return;
  const parties = await caliper.parties(session);
  const context = { ...parties, session, step: step.step };
  const graded: CaliperEvent[] = await Promise.all(
    (step.supplied === undefined ? [] : gradesOf(events, step.supplied)).map((grade) => caliperGrade(grade, context)),
  );
  const mapped = [...(await caliperEvents(events, context)), ...graded];
  if (mapped.length > 0) await sendCaliper(mapped, { ...caliper.sender, sendTime: readClock(caliper.clock) });
}
