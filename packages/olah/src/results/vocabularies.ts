/** The terms of `SessionStatusEnum` (RR §2.7.7). */
export const SESSION_STATUSES = [
  "initial",
  "pendingSubmission",
  "pendingResponseProcessing",
  "pendingExternalScoring",
  "final",
] as const;

/** The state of an item session when its result is reported: a term of `SessionStatusEnum` (RR §2.7.7). */
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** The terms of `AnsweredStatusEnum` (RR §2.7.1). */
export const ANSWERED_STATUSES = ["answered", "attempted", "presented", "notpresented"] as const;

/** Whether the candidate answered, attempted or was presented the interaction of a response variable: a term of `AnsweredStatusEnum` (RR §2.7.1). */
export type AnsweredStatus = (typeof ANSWERED_STATUSES)[number];

/** The terms of `ScoreStatusEnum` (RR §2.7.6). */
export const SCORE_STATUSES = ["notscored", "scored"] as const;

/** Whether a response variable has been scored: a term of `ScoreStatusEnum` (RR §2.7.6). */
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

/** The terms of `AssignmentEnum` (RR §2.7.2). */
export const SUPPORT_ASSIGNMENTS = ["assigned", "inherit", "prohibited", "universal"] as const;

/** How a support came to be used: a term of `AssignmentEnum` (RR §2.7.2). */
export type SupportAssignment = (typeof SUPPORT_ASSIGNMENTS)[number];

/** The terms of `ViewEnum` that the `view` of an outcome variable lists (RR XSD). */
export const OUTCOME_VIEWS = ["author", "candidate", "proctor", "scorer", "testConstructor", "tutor"] as const;

/** Who an outcome is for: a term of `ViewEnum` (RR XSD). */
export type OutcomeView = (typeof OUTCOME_VIEWS)[number];

/** The terms of `external-scored` of an outcome variable (RR XSD). */
export const OUTCOME_SCORERS = ["externalMachine", "human"] as const;

/** Who scores an outcome that processing does not set: a term of `external-scored` (RR XSD). */
export type OutcomeScorer = (typeof OUTCOME_SCORERS)[number];
