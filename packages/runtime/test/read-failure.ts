import { type Issue, ReadError } from "../src/errors.js";

/** Returns the `ReadError` that a function throws, so that a test can look at its issue. */
function readFailure(run: () => unknown): ReadError {
  try {
    run();
  } catch (error) {
    if (error instanceof ReadError) return error;
    throw new Error(`Expected a ReadError, found ${String(error)}.`);
  }
  throw new Error("The function did not throw.");
}

/** Returns the only issue of the `ReadError` that a function throws. */
export function issueOf(run: () => unknown): Issue {
  const { issues } = readFailure(run);
  const [issue] = issues;
  if (issue === undefined || issues.length !== 1) throw new Error(`Expected one issue, found ${issues.length}.`);
  return issue;
}
