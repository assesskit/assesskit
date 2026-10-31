/**
 * The JSON-LD context of Caliper 1.2. Every event names it as its `@context`, and an envelope names it as its
 * `dataVersion`.
 *
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export const CALIPER_CONTEXT = "http://purl.imsglobal.org/ctx/caliper/v1p2";

/** The terms of the Caliper events that the player writes (Caliper 1.2 sections 3.2 and 3.6). */
export type CaliperEventType = "AssessmentEvent" | "AssessmentItemEvent" | "NavigationEvent" | "GradeEvent";

/** The profile that governs an event (Caliper 1.2 section 2.1, Appendix E). */
export type CaliperProfile = "AssessmentProfile" | "GradingProfile";

/** The actions of the events that the player writes (Caliper 1.2 Appendix D). */
export type CaliperAction =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Submitted"
  | "Skipped"
  | "Completed"
  | "NavigatedTo"
  | "Graded";

/**
 * An entity of an event (Caliper 1.2 section 2.2). It always has an `id`, an IRI, and a `type`. The entities that it refers to are
 * named by their IRIs, which Caliper allows for any entity (section 4.3).
 */
export interface CaliperEntity {
  /** The IRI of the entity. */
  readonly id: string;
  /** The term of the entity's type. */
  readonly type: "Person" | "SoftwareApplication" | "Assessment" | "AssessmentItem" | "Attempt" | "Score";
  /** What the entity is called: the identifier of an item reference or of a section. */
  readonly name?: string;
  /** The assessment that an item or a section belongs to, and the attempt of the test that an attempt of an item belongs to. */
  readonly isPartOf?: string;
  /** The person who made an attempt. */
  readonly assignee?: string;
  /** The assessment or item that an attempt is of. */
  readonly assignable?: string;
  /** The time an attempt started, as `YYYY-MM-DDTHH:mm:ss.SSSZ`. */
  readonly startedAtTime?: string;
  /** The time an attempt ended, in the same form. */
  readonly endedAtTime?: string;
  /** The attempt that a score is for. */
  readonly attempt?: string;
  /** The greatest score possible. */
  readonly maxScore?: number;
  /** The score awarded. */
  readonly scoreGiven?: number;
  /** The IRI of the agent who scored the attempt. */
  readonly scoredBy?: string;
  /** The time a score was created, in the same form as `startedAtTime`. */
  readonly dateCreated?: string;
}

/** A Caliper event as JSON-LD (Caliper 1.2 section 2.1). */
export interface CaliperEvent {
  /** The Caliper context, {@link CALIPER_CONTEXT}. */
  readonly "@context": typeof CALIPER_CONTEXT;
  /** A name-based UUID as a URN: `urn:uuid:<UUID>`. */
  readonly id: string;
  /** The term of the event's type. */
  readonly type: CaliperEventType;
  /** The profile that governs the event. */
  readonly profile: CaliperProfile;
  /** The agent who acted: the candidate, or the one who scored. */
  readonly actor: CaliperEntity;
  /** What the actor did. */
  readonly action: CaliperAction;
  /** What the actor acted on. */
  readonly object: CaliperEntity;
  /** What the action made: an attempt, or a score. */
  readonly generated?: CaliperEntity;
  /** When it happened, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly eventTime: string;
  /** The IRI of the application that the event happened in. */
  readonly edApp: string;
}
