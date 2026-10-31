/**
 * The messages between the player in a browser and the session host on a server: the envelopes around the runtime's JSON
 * forms of actions and views, the caller that the host's authentication gives to a request, the session client that the
 * player mounts against, the host side of a session and the results report that only a session host marks official.
 *
 * @module @assesskit/player/protocol
 */
export { type ActionEnvelope, checkActionEnvelope } from "./action-envelope.js";
export { type Caller, checkCaller } from "./caller.js";
export type { Clock } from "./clock.js";
export { type DocumentSource, type ItemDocuments, type ViewDocuments, viewDocuments } from "./documents.js";
export type { HostApplyOptions, HostSession, HostStep, SessionCallOptions } from "./host-session.js";
export {
  checkAllowList,
  checkLtiFrame,
  LTI_STORAGE_FRAME,
  LTI_TOOL_FRAME,
  type LtiFrame,
} from "./lti-frame.js";
export { isOfficialResult, type OfficialResult } from "./official.js";
export { checkRefusal, REFUSAL_CODES } from "./refusal.js";
export type { DispatchResult, SessionClient } from "./session-client.js";
export {
  checkSubmission,
  type Submission,
  type SubmissionItem,
  type SubmissionPart,
  type SubmissionSupplied,
  type SubmissionValue,
  type SubmissionVariable,
} from "./submission.js";
export { checkViewEnvelope, type ViewEnvelope } from "./view-envelope.js";
