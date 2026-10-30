/**
 * The session clients that the player mounts against: the remote session of exam mode, which talks to a session host
 * with autosave, and the local session of practice, which runs olah's engine on the device.
 *
 * @module @luthfanwakan/tempuh/client
 */
export { assetResolver, UNSIGNED_URL } from "./assets.js";
export { BROWSER_CLOCK, type Clock } from "./clock.js";
export { createLocalSession, type LocalSessionOptions, type LocalStore } from "./local.js";
export {
  AUTOSAVE_MS,
  createRemoteSession,
  FLUSH_BEFORE_DEADLINE_MS,
  type RemoteSessionOptions,
  type Transport,
} from "./remote.js";
