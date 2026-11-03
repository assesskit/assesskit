/**
 * The session client of practice: the local session, which runs the runtime's engine on the device and loads it with
 * `import()` at its first call on a page. It is a subpath of its own so that an exam page, which imports
 * `@assesskit/player/client`, holds none of it, and a practice page holds none of the remote session, in every bundler.
 *
 * @module @assesskit/player/client/local
 */

export {
  createLocalSession,
  type LocalHostSession,
  type LocalSave,
  type LocalSession,
  type LocalSessionOptions,
  type LocalStore,
} from "./session.js";
