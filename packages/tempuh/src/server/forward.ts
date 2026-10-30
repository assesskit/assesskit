import type { DeliveryEvent } from "@luthfanwakan/olah/delivery";
import {
  type CaliperParties,
  type CaliperSender,
  type CaliperStep,
  caliperEvents,
  sendCaliper,
} from "../caliper/index.js";
import { checkArray, checkFunction, checkNonEmptyString, checkRecord } from "../checks.js";
import { type Clock, checkClock, readClock } from "../lti/clock.js";

/** The events that one step of a session made, and the place of the step in the session. */
export interface StepEvents {
  /** The identifier of the candidate session. */
  readonly session: string;
  /** `"start"` for the step of `Engine.start`, else the sequence number of the action that made the step. */
  readonly step: CaliperStep;
  /** The events of the step, as olah's `Step.events` gives them. */
  readonly events: readonly DeliveryEvent[];
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
   * The host's log. It receives the step with every event, as olah gave them. Its calls for the same step repeat the
   * step, so a log that must not hold a step twice keeps it by the session and the step.
   */
  readonly log: (step: StepEvents) => void | Promise<void>;
  /** Sends the events that Caliper has a counterpart for. Default: none. */
  readonly caliper?: CaliperForwarding;
}

function checkStep(value: unknown): asserts value is StepEvents {
  checkRecord(value, "The step must be an object");
  checkNonEmptyString(value.session, "The session of the step");
  checkArray(value.events, "The events of the step must be an array");
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
 * Forwards the events of one step of a session: every one of them to the host's log, in the order olah gave them and
 * whatever their type, and the ones that Caliper has a counterpart for to the Caliper endpoint.
 *
 * The log goes first, so that a Caliper failure never loses a log entry. A step without events calls nothing. Calling it
 * again for the same step repeats the log call and sends the same Caliper identifiers, so an endpoint holds each event
 * once.
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
  const mapped = await caliperEvents(events, { ...parties, session, step: step.step });
  if (mapped.length > 0) await sendCaliper(mapped, { ...caliper.sender, sendTime: readClock(caliper.clock) });
}
