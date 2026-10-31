import type { AssessmentResult } from "../results/index.js";

/**
 * The configuration of an adaptive section, as the CAT engine receives it (CAT §4.1). Every file is base64-encoded
 * (RFC 4648).
 */
export interface SectionData {
  /** The settings file of the section, the one `qti-adaptive-settings-ref` references. */
  readonly sectionConfiguration: string;
  /** The usage data file, the one `qti-usagedata-ref` references; absent when the section has no such reference. */
  readonly qtiUsagedata?: string;
  /** The metadata file, the one `qti-metadata-ref` references; absent when the section has no such reference. */
  readonly qtiMetadata?: string;
}

/**
 * A list of items of the item pool (CAT §4.2): the next stage of a session, or, in the answer to Get Section, the whole
 * pool.
 */
export interface ItemStage {
  /**
   * The identifiers of the items, in the order in which they are presented. An identifier may occur more than once; the
   * delivery engine then instances the item. Absent, `null` or empty when the stage ends the session.
   */
  readonly itemIdentifiers?: readonly string[] | null;
  /**
   * The number of items of the stage that the candidate should answer before the delivery engine sends the results, at
   * most the number of identifiers. A hint: the delivery engine may send the results sooner or later. Absent, `null` or
   * `0` when the stage ends the session.
   */
  readonly stageLength?: number | null;
}

/** The answer to Create Section (CAT §3.1). */
export interface CreateSectionResponse {
  /** The identifier of the new section, which every later request about it names. */
  readonly sectionIdentifier: string;
}

/** The answer to Get Section (CAT §3.2): the section as the engine has deployed it. */
export interface GetSectionResponse {
  /** The data from which the section could be created again. */
  readonly sectionData: SectionData;
  /** The item pool of the section, as one stage. */
  readonly items: ItemStage;
}

/** One name and value of the prior data of a candidate; the engine defines the names and the values (CAT §3.3, §7.1). */
export interface PriorDataEntry {
  /** The name of the datum. */
  readonly name: string;
  /** The value of the datum. */
  readonly value: unknown;
}

/** The body of Create Session (CAT §3.3). Every field is optional, and a CAT engine may require some of them. */
export interface CreateSessionRequest {
  /** The personal needs and preferences of the candidate, an AfA 3.0 profile (`writePnp`) in base64. */
  readonly personalNeedsAndPreferences?: string;
  /** The demographics of the candidate in the format of OneRoster 1.1, in base64. */
  readonly demographics?: string;
  /** Results of the candidate before this session, in the form that the engine defines. */
  readonly priorData?: readonly PriorDataEntry[];
}

/** The answer to Create Session (CAT §3.3). */
export interface CreateSessionResponse {
  /** The identifier of the session, which every later request about it names. */
  readonly sessionIdentifier: string;
  /** The first stage to present. */
  readonly nextItems: ItemStage;
  /** The state that a stateless engine hands to the delivery engine; the next Submit Results request returns it. */
  readonly sessionState?: string;
}

/** The body of Submit Results (CAT §3.4). */
export interface SubmitResultsRequest {
  /**
   * The results of the items presented since the last request, with at least one `SCORE` for each item the candidate
   * answered (CAT §4.3.1). The REST binding is the adapter's concern: its field names are not public.
   */
  readonly assessmentResult: AssessmentResult;
  /** The `sessionState` of the previous answer; required when the engine sent one. */
  readonly sessionState?: string;
}

/** The answer to Submit Results (CAT §3.4). */
export interface SubmitResultsResponse {
  /**
   * The outcome variables that the engine computed (CAT §4.3.2). An engine may leave out the context, which the report
   * requires; the adapter then supplies an empty one.
   */
  readonly assessmentResult?: AssessmentResult;
  /** The next stage. Absent, `null` or without items, it ends the session; `isSessionEnd` tells. */
  readonly nextItems?: ItemStage | null;
  /** The state to send with the next Submit Results request. */
  readonly sessionState?: string;
}

/**
 * What the host answers to a request that the delivery engine has made of the CAT engine: the answer to Create Session,
 * the answer to Submit Results, or `{ ended: true }` for End Session.
 */
export type CatResponse =
  | CreateSessionResponse
  | SubmitResultsResponse
  | {
      /** Marks the answer to End Session. */
      readonly ended: true;
    };
