import { describe } from "../checks.js";
import { DataError } from "../errors.js";

/**
 * The longest value of the QTI metadata strings `toolName`, `toolVersion` and `toolVendor`: the length of `String256`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/md-bind/ | QTI 3.0 Metadata Binding}
 */
export const MAX_TOOL_STRING_LENGTH = 256;

/**
 * Replaces tab, line feed and carriage return with a space, which is what `xs:normalizedString` does.
 *
 * @param text - The text of an element.
 * @returns The normalized string.
 */
export function parseString(text: string): string {
  return text.replace(/[\t\n\r]/g, " ");
}

/**
 * Converts the text of an element to an `xs:boolean`, which is `true`, `false`, `1` or `0` with white space around it ignored.
 *
 * @param text - The text of an element.
 * @returns The boolean.
 * @throws `DataError` for any other text.
 */
export function parseBoolean(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  throw new DataError(`The text must be true or false, found ${describe(trimmed)}.`);
}

/**
 * Returns a conversion of the text of an element to a string of at most `maxLength` characters, for `ElementReader.text`.
 *
 * @param maxLength - The most characters, counted as code points, that the text may have.
 * @returns A function that returns the text, or throws a `DataError` when it is longer.
 */
export function boundedStringOf(maxLength: number): (text: string) => string {
  return (text) => {
    if ([...text].length > maxLength) throw new DataError(`The text must have at most ${maxLength} characters.`);
    return text;
  };
}
