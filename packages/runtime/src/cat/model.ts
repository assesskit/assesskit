import type { QtiMetadata } from "../metadata/index.js";
import type { AssessmentResult } from "../results/index.js";

/**
 * The configuration of an adaptive section, as the CAT engine receives it.
 *
 * @remarks
 * Every file is base64-encoded.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, section data}
 * @see {@link https://www.rfc-editor.org/rfc/rfc4648 | RFC 4648, base encodings}
 */
export interface SectionData {
  /** The settings file of the section, the one `qti-adaptive-settings-ref` references. */
  readonly sectionConfiguration: string;
  /** The usage data file, the one `qti-usagedata-ref` references; absent when the section has no such reference. */
  readonly qtiUsagedata?: string;
  /** The metadata file, the one `qti-metadata-ref` references; absent when the section has no such reference. */
  readonly qtiMetadata?: string;
  /**
   * The one QTI metadata record of the section, which the REST binding carries as `qtiMetadata` (its section 5.3.8); absent
   * when the section has none. It is not the metadata file of `qtiMetadata`: the implementation guide names a file with a
   * record for each item, and the binding a single record.
   *
   * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, SectionDType}
   */
  readonly qtiMetadataRecord?: QtiMetadata;
}

/**
 * A list of items of the item pool: the next stage of a session, or, in the answer to Get Section, the whole pool.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, item stage}
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

/**
 * The answer to Create Section.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, Create Section}
 */
export interface CreateSectionResponse {
  /** The identifier of the new section, which every later request about it names. */
  readonly sectionIdentifier: string;
}

/**
 * The answer to Get Section: the section as the engine has deployed it.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, Get Section}
 */
export interface GetSectionResponse {
  /** The data from which the section could be created again. */
  readonly sectionData: SectionData;
  /** The item pool of the section, as one stage. */
  readonly items: ItemStage;
}

/**
 * One name and value of the prior data of a candidate; the engine defines the names and the values.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, prior data}
 */
export interface PriorDataEntry {
  /** The name of the datum. */
  readonly name: string;
  /** The value of the datum. */
  readonly value: unknown;
  /**
   * The address of the glossary that defines the name, which the REST binding carries as `glossaryURI`; absent when the
   * entry names none.
   */
  readonly glossaryUri?: string;
}

/**
 * The body of Create Session.
 *
 * @remarks
 * Every field is optional, and a CAT engine may require some of them.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, Create Session}
 */
export interface CreateSessionRequest {
  /** The personal needs and preferences of the candidate, an AfA 3.0 profile (`writePnp`) in base64. */
  readonly personalNeedsAndPreferences?: string;
  /** The demographics of the candidate in the format of OneRoster 1.1, in base64. */
  readonly demographics?: string;
  /** Results of the candidate before this session, in the form that the engine defines. */
  readonly priorData?: readonly PriorDataEntry[];
}

/**
 * The answer to Create Session.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, Create Session}
 */
export interface CreateSessionResponse {
  /** The identifier of the session, which every later request about it names. */
  readonly sessionIdentifier: string;
  /** The first stage to present. */
  readonly nextItems: ItemStage;
  /** The state that a stateless engine hands to the delivery engine; the next Submit Results request returns it. */
  readonly sessionState?: string;
}

/**
 * The body of Submit Results.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, Submit Results}
 */
export interface SubmitResultsRequest {
  /**
   * The results of the items presented since the last request, with at least one `SCORE` for each item the candidate
   * answered. The REST binding is the adapter's concern: its field names are not public.
   */
  readonly assessmentResult: AssessmentResult;
  /** The `sessionState` of the previous answer; required when the engine sent one. */
  readonly sessionState?: string;
}

/**
 * The answer to Submit Results.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, Submit Results}
 */
export interface SubmitResultsResponse {
  /**
   * The outcome variables that the engine computed. An engine may leave out the context, which the report requires; the
   * adapter then supplies an empty one.
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
