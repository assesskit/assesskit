/**
 * What other modules and the tests of the runtime use of `package` and the package does not export.
 *
 * @module
 */
export { checkSynchronous } from "./check-synchronous.js";
export { normalizeEntryName } from "./paths.js";
export { resolveZipLimits } from "./zip-limits.js";
export { type ByteSource, DIRECTORY_BYTES_PER_ENTRY, memorySource, openZip } from "./zip-reader.js";
