import type { ReadError } from "../errors.js";
import { createReadError, locateElement, type XmlElement } from "../xml/index.js";

/** Where the reader is: the path of the document and the names of the elements around the one it reads. */
export interface ReadContext {
  /** The path of the document in its package or directory. */
  readonly path: string | undefined;
  /** The names of the open elements, from the root. */
  readonly trail: string[];
}

/**
 * Builds the `ReadError` for one problem in an element, as `createReadError` of `xml` does for every reader: the issue carries
 * the message as given and the position of the element; the error's message adds the position.
 *
 * @param context - Where the reader is.
 * @param element - The element the problem is in.
 * @param rule - The rule that the element breaks, `assesskit/asi/<name>`.
 * @param message - A full sentence that says what is wrong and what is expected.
 * @param options - The `cause`: the error that this one reports.
 * @returns The error.
 */
export function asiError(
  context: ReadContext,
  element: XmlElement,
  rule: string,
  message: string,
  options: ErrorOptions = {},
): ReadError {
  return createReadError(rule, message, {
    location: locateElement(element, context.path, { trail: context.trail.join("/") }),
    ...options,
  });
}
