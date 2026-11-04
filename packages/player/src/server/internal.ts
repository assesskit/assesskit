/**
 * What the asset gate of the session host and the tests of the package use of `server`, and the package does not export.
 *
 * @module
 */
export type { FileStore } from "./file-store.js";
export { collectAssetPrefixes, DEFAULT_TTL_SECONDS, DEFAULT_UPLOAD_TTL_SECONDS } from "./gate/index.js";
export { MAX_SAVE_RETRIES } from "./session-host.js";
