import { checkRecord, checkString } from "../checks.js";
import type { ElementReader } from "../xml/index.js";

/**
 * Checks the arguments of a reader of the metadata: an element and the path of its document.
 *
 * @param element - The element to read.
 * @param path - The path of the document, when it has one.
 * @throws `DataError` when the element is not an object or the path is not a string.
 */
export function checkReadArguments(element: unknown, path: unknown): void {
  checkRecord(element, "The element must be an element");
  if (path !== undefined) checkString(path, "The path");
}

/**
 * Reads the next child if it is the element `name`, as `ElementReader.leaf` does.
 *
 * @param reader - The reader of the parent.
 * @param name - The local name of the child.
 * @param parse - Converts the text of the child.
 * @returns The converted text, or `undefined` when the next child is another element.
 * @throws `ReadError` when the child has attributes or elements, or `parse` fails.
 */
export function takeLeaf<T>(reader: ElementReader, name: string, parse: (text: string) => T): T | undefined {
  const child = reader.take(name);
  return child?.leaf(parse);
}

/**
 * Reads the run of children that are the element `name`, as `ElementReader.leaf` does.
 *
 * @param reader - The reader of the parent.
 * @param name - The local name of the children.
 * @param parse - Converts the text of each child.
 * @returns The converted texts; an empty array when none follows.
 * @throws `ReadError` when a child has attributes or elements, or `parse` fails.
 */
export function takeLeaves<T>(reader: ElementReader, name: string, parse: (text: string) => T): T[] {
  return reader.takeAll(name).map((child) => child.leaf(parse));
}

/**
 * Checks that the element of a reader is the element `name` of a namespace.
 *
 * @param reader - The reader of the element.
 * @param namespace - The namespace the element must be in.
 * @param name - The local name the element must have.
 * @throws `ReadError` when it is not.
 */
export function expectRoot(reader: ElementReader, namespace: string, name: string): void {
  if (reader.element.namespace !== namespace || reader.name !== name) {
    const message = `The element must be ${name} of the namespace ${namespace}, found ${reader.qualifiedName}.`;
    throw reader.fail("unexpected-element", message);
  }
}
