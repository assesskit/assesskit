/**
 * What the tests of the runtime use of `cli` and the package does not export.
 *
 * @module
 */
export { pathIssues } from "./check-path.js";
export {
  DownloadStatusError,
  downloadBytes,
  fetchSchemas,
  mapConcurrently,
  sha256,
  withRetries,
} from "./fetch-schemas.js";
export { resolveOptions } from "./options.js";
export { packageVersion } from "./package-version.js";
export { buildReport, EXIT_CODES, exitCodeOf, formatJson, formatText } from "./report.js";
export { parseCommand, USAGE, UsageError } from "./usage.js";
