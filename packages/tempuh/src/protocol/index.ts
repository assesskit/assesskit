/**
 * The messages between the player in a browser and the session host on a server: the envelopes around olah's JSON
 * forms of actions and views, the caller that the host's authentication gives to a request, the session client that the
 * player mounts against and the results report that only a session host marks official.
 *
 * @module @luthfanwakan/tempuh/protocol
 */
export { type ActionEnvelope, checkActionEnvelope } from "./action-envelope.js";
export { type Caller, checkCaller } from "./caller.js";
export { type DocumentSource, type ItemDocuments, type ViewDocuments, viewDocuments } from "./documents.js";
export { isOfficialResult, type OfficialResult } from "./official.js";
export { checkRefusal, REFUSAL_CODES } from "./refusal.js";
export type { DispatchResult, SessionClient } from "./session-client.js";
export { checkViewEnvelope, type ViewEnvelope } from "./view-envelope.js";
