import type { StepEvents } from "@assesskit/player/server";

/** Who, what and where an event is about, as IRIs. They are the host's, because only it can name them. */
export interface CaliperParties {
  /**
   * The IRI of the candidate. It is the host's opaque identifier, such as `urn:uuid:` followed by a UUID, never an email
   * address or a name.
   */
  readonly actor: string;
  /** The IRI of the test. */
  readonly assessment: string;
  /** The IRI of the application that delivers the test. */
  readonly edApp: string;
}

/** What the mapping of a step needs besides its events: the place of the step, and the parties. */
export interface CaliperContext extends CaliperParties {
  /** The identifier of the candidate session. */
  readonly session: string;
  /**
   * The step of the session that made the events: `"start"` for `Engine.start`, else the version of the session record
   * that the step saved. The version counts the steps of the host too (a proctor's action, a time-out), which a client's
   * sequence number does not.
   */
  readonly step: StepEvents["step"];
}
