import fc from "fast-check";
import { type Issue, ReadError, SecurityError } from "../src/index.js";

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

/**
 * An arbitrary damage to a document: the text with one character replaced, one cut out, or the end cut off, at any
 * position. Most damaged documents are not valid, and a reader must say so with a `ReadError`.
 */
export const damage = (text: string): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.integer({ min: 0, max: Math.max(0, text.length - 1) }),
      fc.constantFrom("replace", "cut", "truncate"),
      fc.constantFrom("<", ">", "&", '"', "x", " ", "/"),
    )
    .map(([at, how, character]) => {
      if (how === "truncate") return text.slice(0, at);
      return `${text.slice(0, at)}${how === "replace" ? character : ""}${text.slice(at + 1)}`;
    });

/** Returns whether reading the text either succeeds or fails with a `ReadError` or a `SecurityError`, as a reader must. */
export function failsOnlyAsRead(read: (text: string) => unknown, text: string): boolean {
  try {
    read(text);
    return true;
  } catch (error) {
    return error instanceof ReadError || error instanceof SecurityError;
  }
}
