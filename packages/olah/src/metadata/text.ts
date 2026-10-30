import { checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { ElementReader } from "../xml/index.js";

/** Replaces tab, line feed and carriage return with a space, which is what `xs:normalizedString` does. */
export function parseString(text: string): string {
  return text.replace(/[\t\n\r]/g, " ");
}

/**
 * Converts the text of an element to an `xs:boolean`, which is `true`, `false`, `1` or `0` with white space around it ignored.
 *
 * @throws `DataError` for any other text.
 */
export function parseBoolean(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  throw new DataError(`The text must be true or false, found ${describe(trimmed)}.`);
}

/** A term outside a vocabulary that an extension defines: `ext:` and a name (DRD XSD, `ExtensionString.Type`). */
export type ExtensionTerm = `ext:${string}`;

/** Returns whether a string is an extension term; the characters after `ext:` are those the pattern of the DRD XSD lists. */
function isExtensionTerm(text: string): text is ExtensionTerm {
  return /^ext:[ a-zA-Z0-9.|_]+$/.test(text);
}

/** The longest value of the QTI metadata strings `toolName`, `toolVersion` and `toolVendor` (MD §2.5.1, `String256`). */
export const MAX_TOOL_STRING_LENGTH = 256;

/**
 * Checks that a value to write is one of the terms of a vocabulary or an extension term.
 *
 * @throws `DataError` when it is not.
 */
export function checkOpenTerm<T extends string>(
  value: unknown,
  label: string,
  vocabulary: readonly T[],
): asserts value is T | ExtensionTerm {
  if (!(vocabulary.some((term) => term === value) || (typeof value === "string" && isExtensionTerm(value)))) {
    throw new DataError(
      `${label} must be one of ${vocabulary.join(", ")} or an extension term such as ext:name, found ${describe(value)}.`,
    );
  }
}

/**
 * Checks the arguments of a reader of the metadata: an element and the path of its document.
 *
 * @throws `DataError` when the element is not an object or the path is not a string.
 */
export function checkReadArguments(element: unknown, path: unknown): void {
  checkRecord(element, "The element must be an element");
  if (path !== undefined) checkString(path, "The path");
}

/** Returns a conversion of the text of an element to a term of a vocabulary or an extension term, for `ElementReader.text`. */
export function openTermOf<T extends string>(vocabulary: readonly T[]): (text: string) => T | ExtensionTerm {
  return (text) => {
    checkOpenTerm(text, "The text", vocabulary);
    return text;
  };
}

/** Returns a conversion of the text of an element to a string of at most `maxLength` characters, for `ElementReader.text`. */
export function boundedStringOf(maxLength: number): (text: string) => string {
  return (text) => {
    if ([...text].length > maxLength) throw new DataError(`The text must have at most ${maxLength} characters.`);
    return text;
  };
}

/** Reads the next child if it is the element `name`, as `ElementReader.leaf` does; `undefined` when it is not. */
export function takeLeaf<T>(reader: ElementReader, name: string, parse: (text: string) => T): T | undefined {
  const child = reader.take(name);
  return child?.leaf(parse);
}

/** Reads the run of children that are the element `name`, as `ElementReader.leaf` does. */
export function takeLeaves<T>(reader: ElementReader, name: string, parse: (text: string) => T): T[] {
  return reader.takeAll(name).map((child) => child.leaf(parse));
}

/**
 * Checks that the element of a reader is the element `name` of a namespace.
 *
 * @throws `ReadError` when it is not.
 */
export function expectRoot(reader: ElementReader, namespace: string, name: string): void {
  if (reader.element.namespace !== namespace || reader.name !== name) {
    const message = `The element must be ${name} of the namespace ${namespace}, found ${reader.qualifiedName}.`;
    throw reader.fail("unexpected-element", message);
  }
}
