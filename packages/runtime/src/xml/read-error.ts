import { checkOptions } from "../checks.js";
import { type Issue, type IssueLocation, ReadError } from "../errors.js";
import type { XmlElement } from "./tree.js";

/**
 * Returns how messages name a document: "The document" or, with a path, the document by its path.
 *
 * @param path - The path of the document, when it has one.
 * @returns The noun phrase that opens a message.
 */
export function documentName(path: string | undefined): string {
  return path === undefined ? "The document" : `The document ${JSON.stringify(path)}`;
}

/** The options of {@link createReadError}. */
export interface CreateReadErrorOptions {
  /**
   * Where the problem is, when known.
   *
   * @defaultValue none
   */
  readonly location?: IssueLocation;
}

/**
 * Builds the `ReadError` for one problem. The issue carries the message as given; the error's message adds the position.
 *
 * @param code - The issue code, `assesskit/xml/<name>`.
 * @param message - A full sentence that says what is wrong and what is expected.
 * @param options - See {@link CreateReadErrorOptions}.
 * @returns The error, with one issue.
 */
export function createReadError(code: string, message: string, options: CreateReadErrorOptions = {}): ReadError {
  checkOptions(options);
  const { location } = options;
  const issue: Issue = { severity: "error", code, message, ...(location ? { location } : {}) };
  const position = location?.line === undefined ? "" : ` (line ${location.line}, column ${location.column ?? 1})`;
  return new ReadError(`${message}${position}`, [issue]);
}

/** The options of {@link locateElement}. */
export interface LocateElementOptions {
  /**
   * The element names that lead to the element, `/`-separated.
   *
   * @defaultValue none
   */
  readonly trail?: string;
}

/**
 * Returns the location of an element: its path in the document, the position of its start tag and, when the caller tracks it,
 * the path of element names that leads to it.
 *
 * @param element - The element.
 * @param path - The path of the document of the element, when it has one.
 * @param options - See {@link LocateElementOptions}.
 * @returns The location for an issue.
 */
export function locateElement(
  element: XmlElement,
  path: string | undefined,
  options: LocateElementOptions = {},
): IssueLocation {
  checkOptions(options);
  const { trail } = options;
  return { path, line: element.line, column: element.column, ...(trail === undefined ? {} : { element: trail }) };
}
