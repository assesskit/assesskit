import { type Issue, type IssueLocation, ReadError } from "../errors.js";
import type { XmlElement } from "./tree.js";

/** Returns how messages name a document: "The document" or, with a path, the document by its path. */
export function documentName(path: string | undefined): string {
  return path === undefined ? "The document" : `The document ${JSON.stringify(path)}`;
}

/**
 * Builds the `ReadError` for one problem. The issue carries the message as given; the error's message adds the position.
 *
 * @param code - The issue code, `assesskit/xml/<name>`.
 * @param message - A full sentence that says what is wrong and what is expected.
 * @param source - The specification reference that defines the rule.
 * @param location - Where the problem is, when known.
 */
export function readError(code: string, message: string, source: string, location?: IssueLocation): ReadError {
  const issue: Issue = { severity: "error", code, message, source, ...(location ? { location } : {}) };
  const position = location?.line === undefined ? "" : ` (line ${location.line}, column ${location.column ?? 1})`;
  return new ReadError(`${message}${position}`, [issue]);
}

/**
 * Returns the location of an element: its path in the document, the position of its start tag and, when the caller tracks it,
 * the path of element names that leads to it.
 */
export function locationOf(element: XmlElement, path: string | undefined, trail?: string): IssueLocation {
  return { path, line: element.line, column: element.column, ...(trail === undefined ? {} : { element: trail }) };
}
