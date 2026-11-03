/**
 * The session client of exam mode: the remote session, which talks to a session host with autosave. The local session of
 * practice, which runs the runtime's engine on the device, is `@assesskit/player/client/local`.
 *
 * @module @assesskit/player/client
 */

export type { Clock } from "../protocol/index.js";
export { BROWSER_CLOCK } from "./clock.js";
export {
  AUTOSAVE_MS,
  createRemoteSession,
  FLUSH_BEFORE_DEADLINE_MS,
  type RemoteSessionOptions,
  type Transport,
} from "./remote.js";
