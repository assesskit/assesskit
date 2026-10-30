import type { CreateSessionRequest } from "../cat/index.js";
import type { AssessmentResult } from "../results/index.js";
import { type CatSession, catRequestId } from "./cat-session.js";
import type { Course } from "./course.js";
import type { DeliveryState } from "./delivery-state.js";
import { catReport } from "./results-assembly.js";
import type { ScoringRequest } from "./scoring.js";

/** What every CAT request names: the adaptive section of the test and where its CAT engine is (C1). */
export interface CatRequestBase {
  /** The identifier of the request; the `cat-response` action that answers it names it. */
  readonly id: string;
  /** The identifier of the adaptive section in the test. */
  readonly section: string;
  /** The URL prefix of the CAT engine. */
  readonly prefix: string;
  /** The identifier that Create Section returned for the section. */
  readonly sectionIdentifier: string;
}

/**
 * A request that the engine makes of a CAT engine and waits on (E18): Create Session when the candidate enters an adaptive
 * section; Submit Results with the results of the items to report, per the policy of C4, and the state the engine handed
 * over; End Session when the candidate leaves before the engine ends the session. The host makes the request through its
 * `CatPort`, or `drainCat` does, and answers with a `cat-response` action.
 */
export type CatRequest =
  | (CatRequestBase & {
      /** Create Session (CAT §3.3). */
      readonly kind: "create-session";
      /** The body of the request: the candidate's PNP as `writePnp` writes it, in base64, when the session has one (C3). */
      readonly body: CreateSessionRequest;
    })
  | (CatRequestBase & {
      /** Submit Results (CAT §3.4). */
      readonly kind: "submit-results";
      /** The identifier of the session. */
      readonly sessionIdentifier: string;
      /** The minimal results report of the items presented since the last request (C10), with their earlier results again when they changed (B98). */
      readonly assessmentResult: AssessmentResult;
      /** The state the engine handed over with its last answer; absent when it sent none. */
      readonly sessionState?: string;
    })
  | (CatRequestBase & {
      /** End Session (CAT §3.5). */
      readonly kind: "end-session";
      /** The identifier of the session. */
      readonly sessionIdentifier: string;
    });

/** What the engine waits on the host for (E13, E18): scoring requests with no value yet, and CAT requests. */
export interface PendingWork {
  /** The scoring requests whose value has not been supplied, in the order they were made. */
  readonly scoring: readonly ScoringRequest[];
  /** The CAT requests that wait for an answer, in the order the sessions began. */
  readonly cat: readonly CatRequest[];
}

/** Returns the request that a session waits for, `undefined` when none waits. */
function catRequestOf(course: Course, state: DeliveryState, session: CatSession): CatRequest | undefined {
  const { request } = session;
  const where = course.catSections.get(session.section);
  if (request === undefined || where === undefined) return undefined;
  const base: CatRequestBase = {
    id: catRequestId(session),
    section: session.section,
    prefix: where.prefix,
    sectionIdentifier: where.sectionIdentifier,
  };
  const { sessionIdentifier, sessionState } = session;
  switch (request.kind) {
    case "create-session": {
      const { personalNeeds } = state.needs;
      return {
        ...base,
        kind: request.kind,
        body: personalNeeds === undefined ? {} : { personalNeedsAndPreferences: personalNeeds },
      };
    }
    case "submit-results":
      if (sessionIdentifier === undefined) return undefined;
      return {
        ...base,
        kind: request.kind,
        sessionIdentifier,
        assessmentResult: catReport(course, state, session, request.items),
        ...(sessionState === undefined ? {} : { sessionState }),
      };
    case "end-session":
      return sessionIdentifier === undefined ? undefined : { ...base, kind: request.kind, sessionIdentifier };
  }
}

/** Returns what the engine waits on the host for in a state (E13, E18). */
export function pendingWork(course: Course, state: DeliveryState): PendingWork {
  return {
    scoring: state.scoring.filter((request) => request.supplied === undefined),
    cat: state.cat.flatMap((session) => catRequestOf(course, state, session) ?? []),
  };
}
