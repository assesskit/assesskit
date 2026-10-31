/**
 * The terms of `SessionStatusEnum`.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting, SessionStatusEnum}
 */
export const SESSION_STATUSES = [
  "initial",
  "pendingSubmission",
  "pendingResponseProcessing",
  "pendingExternalScoring",
  "final",
] as const;

/** The state of an item session when its result is reported: a term of `SessionStatusEnum`. */
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * The terms of `AnsweredStatusEnum`.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting, AnsweredStatusEnum}
 */
export const ANSWERED_STATUSES = ["answered", "attempted", "presented", "notpresented"] as const;

/** Whether the candidate answered, attempted or was presented the interaction of a response variable: a term of `AnsweredStatusEnum`. */
export type AnsweredStatus = (typeof ANSWERED_STATUSES)[number];

/**
 * The terms of `ScoreStatusEnum`.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting, ScoreStatusEnum}
 */
export const SCORE_STATUSES = ["notscored", "scored"] as const;

/** Whether a response variable has been scored: a term of `ScoreStatusEnum`. */
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

/**
 * The terms of `AssignmentEnum`.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting, AssignmentEnum}
 */
export const SUPPORT_ASSIGNMENTS = ["assigned", "inherit", "prohibited", "universal"] as const;

/** How a support came to be used: a term of `AssignmentEnum`. */
export type SupportAssignment = (typeof SUPPORT_ASSIGNMENTS)[number];

/** The terms of `ViewEnum` that the `view` of an outcome variable lists. */
export const OUTCOME_VIEWS = ["author", "candidate", "proctor", "scorer", "testConstructor", "tutor"] as const;

/** Who an outcome is for: a term of `ViewEnum`. */
export type OutcomeView = (typeof OUTCOME_VIEWS)[number];

/** The terms of `external-scored` of an outcome variable. */
export const OUTCOME_SCORERS = ["externalMachine", "human"] as const;

/** Who scores an outcome that processing does not set: a term of `external-scored`. */
export type OutcomeScorer = (typeof OUTCOME_SCORERS)[number];
