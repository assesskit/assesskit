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
 * The six requests of a CAT engine (CAT §3). The host implements it, for example over an IRT library or over the REST API
 * of CAT 1.0; the runtime calls no network and never implements it. `prefix` is the URL prefix of the engine that
 * `qti-adaptive-engine-ref` gives, so a host checks it against the engines it trusts before it sends a candidate's
 * results there. The deployment of a section (`createSection`, `getSection`, `endSection`) is the host's concern; the
 * delivery of a session (`createSession`, `submitResults`, `endSession`) is the delivery engine's.
 */
export interface CatPort {
  /**
   * Creates a section from its configuration: `POST {prefix}/sections` (CAT §3.1). The request is not idempotent, so the
   * host makes it once, when it deploys the test, and gives the identifier to the delivery definition.
   */
  createSection(prefix: string, data: SectionData): Promise<CreateSectionResponse>;
  /**
   * Returns the section as the engine has deployed it and its item pool: `GET {prefix}/sections/{sectionIdentifier}`
   * (CAT §3.2). `checkPool` compares the pool with the section of the test.
   */
  getSection(prefix: string, sectionIdentifier: string): Promise<GetSectionResponse>;
  /**
   * Starts the session of a candidate in a section and returns the first stage:
   * `POST {prefix}/sections/{sectionIdentifier}/sessions` (CAT §3.3).
   */
  createSession(
    prefix: string,
    sectionIdentifier: string,
    request: CreateSessionRequest,
  ): Promise<CreateSessionResponse>;
  /**
   * Sends the results of a stage and returns the engine's outcomes and the next stage:
   * `POST {prefix}/sections/{sectionIdentifier}/sessions/{sessionIdentifier}/results` (CAT §3.4).
   */
  submitResults(
    prefix: string,
    sectionIdentifier: string,
    sessionIdentifier: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse>;
  /**
   * Aborts the session of a candidate: `DELETE {prefix}/sections/{sectionIdentifier}/sessions/{sessionIdentifier}`
   * (CAT §3.5). The delivery engine makes it only when the candidate leaves before the engine ends the session.
   */
  endSession(prefix: string, sectionIdentifier: string, sessionIdentifier: string): Promise<void>;
  /**
   * Ends a section and all its sessions: `DELETE /sections/{sectionIdentifier}` under the prefix (CAT §3.6). The request
   * is not repeated once it has succeeded.
   */
  endSection(prefix: string, sectionIdentifier: string): Promise<void>;
}
