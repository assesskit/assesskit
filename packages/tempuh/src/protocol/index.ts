/**
 * The messages between the player in a browser and the session host on a server: the envelopes around olah's JSON
 * forms of actions and views, and the caller that the host's authentication gives to a request.
 *
 * @module @luthfanwakan/tempuh/protocol
 */
export { type ActionEnvelope, checkActionEnvelope } from "./action-envelope.js";
export { type Caller, checkCaller } from "./caller.js";
export { checkViewEnvelope, type ViewEnvelope } from "./view-envelope.js";
