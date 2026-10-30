import { checkNonEmptyString, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** The step of a session that made the events: its start, or the action with this sequence number. */
export type CaliperStep = "start" | number;

/** The step of `Engine.start`, which has no action and so no sequence number. */
export const START_STEP = "start" satisfies CaliperStep;

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

/** What `caliperEvents` and `caliperGrade` need besides the events: the place of the step, and the parties. */
export interface CaliperContext extends CaliperParties {
  /** The identifier of the candidate session, the `session` of a `Caller`. */
  readonly session: string;
  /**
   * The step of the session that made the events: `"start"` for `Engine.start`, else the sequence number of the action
   * that the session host stored.
   */
  readonly step: CaliperStep;
}

/**
 * Checks that a value is an absolute IRI: Caliper requires one for every entity (Caliper 1.2 §4.2).
 *
 * @param label - Names the value in the error message, such as `The actor of the context`.
 * @throws `DataError` when it is not.
 */
export function checkIri(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!URL.canParse(value)) {
    throw new DataError(`${label} must be an absolute IRI, found ${describe(value)}.`);
  }
}

/**
 * Checks the parties of a session, as a host passes them from JavaScript.
 *
 * @throws `DataError` when they are not an object whose `actor`, `assessment` and `edApp` are absolute IRIs.
 */
function checkParties(value: unknown): asserts value is CaliperParties {
  checkRecord(value, "The Caliper parties must be an object");
  checkIri(value.actor, "The actor of the Caliper parties");
  checkIri(value.assessment, "The assessment of the Caliper parties");
  checkIri(value.edApp, "The edApp of the Caliper parties");
}

/**
 * Checks a context, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a non-empty `session`, a `step` that is `"start"` or a non-negative
 * integer, and the parties.
 */
export function checkContext(value: unknown): asserts value is CaliperContext {
  checkRecord(value, "The Caliper context must be an object");
  checkNonEmptyString(value.session, "The session of the Caliper context");
  const { step } = value;
  if (step !== START_STEP && !(typeof step === "number" && Number.isSafeInteger(step) && step >= 0)) {
    throw new DataError(
      `The step of the Caliper context must be "start" or a non-negative integer, found ${describe(step)}.`,
    );
  }
  checkParties(value);
}
