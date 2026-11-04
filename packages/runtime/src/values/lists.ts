import { checkArray, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "./identifier.js";
import { xmlTokens } from "./xml-tokens.js";

/**
 * Reads an `IdentifierList`: identifiers separated by whitespace.
 *
 * @param text - The text of the attribute. An empty text is an empty list.
 * @returns The identifiers.
 * @throws `DataError` when `text` is not a string or an item is not an identifier.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, IdentifierList}
 */
export function parseIdentifierList(text: string): readonly string[] {
  checkString(text, "The text");
  return xmlTokens(text).map((token) => {
    if (!isIdentifier(token))
      throw new DataError(`The item ${describe(token)} of an identifier list is not an identifier.`);
    return token;
  });
}

/**
 * Writes an `IdentifierList`.
 *
 * @param identifiers - The identifiers.
 * @returns The identifiers separated by one space.
 * @throws `DataError` when `identifiers` is not an array of identifiers.
 */
export function formatIdentifierList(identifiers: readonly string[]): string {
  checkArray(identifiers, "The identifiers must be an array");
  for (const identifier of identifiers) {
    if (!isIdentifier(identifier))
      throw new DataError(`The item ${describe(identifier)} of an identifier list is not an identifier.`);
  }
  return identifiers.join(" ");
}
