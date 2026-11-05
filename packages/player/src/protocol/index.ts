/**
 * The messages between the player in a browser and the session host on a server: the envelopes around the runtime's JSON
 * forms of actions and views, the caller that the host's authentication gives to a request, the session client that the
 * player mounts against, the host side of a session and the results report that only a session host marks official.
 *
 * @module @assesskit/player/protocol
 */
export type { ActionEnvelope } from "./action-envelope.js";
export type { Caller } from "./caller.js";
export type { Clock } from "./clock.js";
export type { ViewDocuments } from "./documents.js";
export type { CatFailure, HostApplyOptions, HostSession, HostStep } from "./host-session.js";
export { LTI_STORAGE_FRAME, LTI_TOOL_FRAME, type LtiFrame } from "./lti-frame.js";
export type { OfficialResult } from "./official.js";
export type { DispatchResult, SessionClient } from "./session-client.js";
export type {
  Submission,
  SubmissionItem,
  SubmissionPart,
  SubmissionSupplied,
  SubmissionValue,
  SubmissionVariable,
} from "./submission.js";
export type { ViewEnvelope } from "./view-envelope.js";
export type { ViewRequest } from "./view-request.js";
