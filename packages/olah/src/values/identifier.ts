import { contains } from "./code-point-set.js";
import { NC_NAME_CHARS, NC_NAME_START_CHARS } from "./xml-names.js";

/**
 * Returns whether a value is an identifier (INFO §4.1.1): a string that starts with a letter or an underscore and holds
 * only letters, digits, underscores, hyphens, periods, combining characters and extenders, never a colon. That is the
 * `NCName` of XML Namespaces, which the ASI schema uses for `Identifier`, with the character classes of XML 1.0, fifth
 * edition. Identifiers are compared case-sensitively. The recommended length of 32 characters and the reservation of the
 * period for prefixes are style rules that `isIdentifier` does not check.
 */
export function isIdentifier(text: unknown): text is string {
  if (typeof text !== "string" || text === "") return false;
  let start = true;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!contains(start ? NC_NAME_START_CHARS : NC_NAME_CHARS, codePoint)) return false;
    start = false;
  }
  return true;
}
