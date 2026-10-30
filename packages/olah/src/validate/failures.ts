import { type Issue, OlahError, ReadError } from "../errors.js";

/**
 * Returns the issues for a reference that could not be resolved or a document that could not be read: the issues of a
 * `ReadError`, and one issue for any other error olah throws, such as a `SecurityError` or a resolver's `DataError`.
 *
 * @param error - What was thrown.
 * @param path - The path of the document that holds the reference.
 * @throws The error itself when it is not one of olah's, which is a defect and not a finding.
 */
export function failureIssues(error: unknown, path: string | undefined): readonly Issue[] {
  if (error instanceof ReadError) return error.issues;
  if (!(error instanceof OlahError)) throw error;
  return [
    {
      severity: "error",
      code: "olah/validate/unresolved-reference",
      message: error.message,
      source: "BIND §8",
      ...(path === undefined ? {} : { location: { path } }),
    },
  ];
}
