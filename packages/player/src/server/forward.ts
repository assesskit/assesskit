import type { DeliveryEvent } from "@assesskit/runtime/delivery";
import type { Value } from "@assesskit/runtime/values";

/** The score that a `supply-scores` action supplied: the runtime's events name the request and not the value, so the step carries it. */
export interface SuppliedGrade {
  /** The value of the action. */
  readonly value: Value | null;
  /** Whether a person or a scoring service scored, as the action says. */
  readonly scorer: "human" | "externalMachine";
  /**
   * Who scored, as `HostApplyOptions.scoredBy` gave it.
   *
   * @defaultValue none
   */
  readonly scoredBy?: string;
}

/** The events that one step of a session made, and the place of the step in the session. */
export interface StepEvents {
  /** The identifier of the candidate session. */
  readonly session: string;
  /** `"start"` for the step of `Engine.start`, else the version of the session record that the step saved. */
  readonly step: "start" | number;
  /** The events of the step, as the runtime's `Step.events` gives them. */
  readonly events: readonly DeliveryEvent[];
  /**
   * The score of the step, on every step of a `supply-scores` action.
   *
   * @defaultValue none
   */
  readonly supplied?: SuppliedGrade;
}

/**
 * Receives one step of a session, after the step is saved.
 *
 * @remarks
 * A step sink bounds its own time and calls only `session(id)` of the session host: `handle`, `view` and `start` join the
 * answer loop that waits for the sink, so they would never return. When it rejects, the step stays saved and the call that
 * made the step rejects; inside the answer loop the loop stops, and a sink failure reads as `catFailure`. Nothing repeats the
 * step by itself, so a host that needs every step makes its sink durable. The same step reaches the sink once per call that
 * made it: a candidate's retry replays the stored answer and forwards nothing.
 */
export type StepSink = (step: StepEvents) => void | Promise<void>;

/** The options of {@link SessionHostOptions.forward}. */
export interface ForwardOptions {
  /**
   * The host's log: every step that has events, as the runtime gave them. A host composes its event sink and its score sink here.
   */
  readonly log: StepSink;
}
