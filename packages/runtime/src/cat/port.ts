import type {
  CreateSectionResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetSectionResponse,
  SectionData,
  SubmitResultsRequest,
  SubmitResultsResponse,
} from "./model.js";

/**
 * The six requests of a CAT engine.
 *
 * @remarks
 * The host implements it, for example over an IRT library or over the REST API of CAT 1.0; the runtime calls no network
 * and never implements it. `prefix` is the URL prefix of the engine that `qti-adaptive-engine-ref` gives, so a host
 * checks it against the engines it trusts before it sends a candidate's results there. The deployment of a section
 * (`createSection`, `getSection`, `endSection`) is the host's concern; the delivery of a session (`createSession`,
 * `submitResults`, `endSession`) is the delivery engine's.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, requests}
 */
export interface CatPort {
  /**
   * Creates a section from its configuration: `POST {prefix}/sections`.
   *
   * @remarks
   * The request is not idempotent, so the host makes it once, when it deploys the test, and gives the identifier to the
   * delivery definition.
   *
   * @param prefix - The URL prefix of the engine.
   * @param data - The configuration of the section.
   * @returns The identifier of the new section.
   */
  createSection(prefix: string, data: SectionData): Promise<CreateSectionResponse>;
  /**
   * Returns the section as the engine has deployed it and its item pool: `GET {prefix}/sections/{sectionIdentifier}`.
   *
   * @remarks
   * `checkPool` compares the pool with the section of the test.
   *
   * @param prefix - The URL prefix of the engine.
   * @param sectionIdentifier - The identifier that `createSection` returned.
   * @returns The section data and the item pool.
   */
  getSection(prefix: string, sectionIdentifier: string): Promise<GetSectionResponse>;
  /**
   * Starts the session of a candidate in a section and returns the first stage:
   * `POST {prefix}/sections/{sectionIdentifier}/sessions`.
   *
   * @param prefix - The URL prefix of the engine.
   * @param sectionIdentifier - The identifier of the section.
   * @param request - What is known of the candidate.
   * @returns The identifier of the session and the first stage.
   */
  createSession(
    prefix: string,
    sectionIdentifier: string,
    request: CreateSessionRequest,
  ): Promise<CreateSessionResponse>;
  /**
   * Sends the results of a stage and returns the engine's outcomes and the next stage:
   * `POST {prefix}/sections/{sectionIdentifier}/sessions/{sessionIdentifier}/results`.
   *
   * @param prefix - The URL prefix of the engine.
   * @param sectionIdentifier - The identifier of the section.
   * @param sessionIdentifier - The identifier of the session.
   * @param request - The results of the items presented since the last request.
   * @returns The outcomes and the next stage.
   */
  submitResults(
    prefix: string,
    sectionIdentifier: string,
    sessionIdentifier: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse>;
  /**
   * Aborts the session of a candidate: `DELETE {prefix}/sections/{sectionIdentifier}/sessions/{sessionIdentifier}`.
   *
   * @remarks
   * The delivery engine makes it only when the candidate leaves before the engine ends the session.
   *
   * @param prefix - The URL prefix of the engine.
   * @param sectionIdentifier - The identifier of the section.
   * @param sessionIdentifier - The identifier of the session.
   */
  endSession(prefix: string, sectionIdentifier: string, sessionIdentifier: string): Promise<void>;
  /**
   * Ends a section and all its sessions: `DELETE /sections/{sectionIdentifier}` under the prefix.
   *
   * @remarks
   * The request is not repeated once it has succeeded.
   *
   * @param prefix - The URL prefix of the engine.
   * @param sectionIdentifier - The identifier of the section.
   */
  endSection(prefix: string, sectionIdentifier: string): Promise<void>;
}

/**
 * The three requests of a CAT engine that the delivery of a session makes: Create Session, Submit Results and End Session.
 *
 * @remarks
 * A host that delivers sessions needs these and not the deployment of sections, so it can pass a port that has no
 * `createSection`, `getSection` or `endSection`, such as the client of an engine that someone else deployed.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, requests}
 */
export type CatSessionPort = Pick<CatPort, "createSession" | "submitResults" | "endSession">;
