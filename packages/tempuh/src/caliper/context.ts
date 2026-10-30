import * as v from "valibot";
import {
  checkString,
  describe,
  looseRecord,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
} from "../checks.js";
import { DataError } from "../errors.js";

/** The step of a session that made the events: its start, or the version of the session record that the step saved. */
export type CaliperStep = "start" | number;

/** The step of `Engine.start`, which has no earlier record and so no version. */
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
   * The step of the session that made the events: `"start"` for `Engine.start`, else the version of the session record
   * that the step saved. The version counts the steps of the host too (a proctor's action, a time-out), which a client's
   * sequence number does not.
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

/** The schema of an absolute IRI. */
export const iriSchema = v.pipe(
  v.string(),
  v.check(
    (text) => URL.canParse(text),
    (issue) => `expected an absolute IRI, found ${issue.received}`,
  ),
);

const contextSchema = looseRecord({
  session: nonEmptyStringSchema,
  step: v.union(
    [v.literal(START_STEP), nonNegativeIntegerSchema],
    (issue) => `expected "start" or a non-negative integer, found ${issue.received}`,
  ),
  actor: iriSchema,
  assessment: iriSchema,
  edApp: iriSchema,
});

/**
 * Checks a context, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a non-empty `session`, a `step` that is `"start"` or a non-negative
 * integer, and the parties.
 */
export function checkContext(value: unknown): asserts value is CaliperContext {
  parseWith(contextSchema, value, "The Caliper context");
}
