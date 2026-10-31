import { checkArray, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "./identifier.js";
import { parseInteger } from "./lexical.js";
import { xmlTokens } from "./whitespace.js";

/** The range of `xs:int`, the item type of `IntegerList` in the ASI schema (INFO §9.1.2). */
const INT_RANGE = [-(2 ** 31), 2 ** 31 - 1] as const;

/**
 * Reads an `IdentifierList` (INFO §9.1.1): identifiers separated by whitespace. An empty text is an empty list.
 *
 * @param text - The text of the attribute.
 * @throws `DataError` when `text` is not a string or an item is not an identifier.
 */
export function parseIdentifierList(text: string): string[] {
  checkString(text, "The text");
  return xmlTokens(text).map((token) => {
    if (!isIdentifier(token))
      throw new DataError(`The item ${describe(token)} of an identifier list is not an identifier.`);
    return token;
  });
}

/**
 * Writes an `IdentifierList`: the identifiers separated by one space.
 *
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

function checkInt(value: number, source: string): number {
  if (value < INT_RANGE[0] || value > INT_RANGE[1]) {
    throw new DataError(`The item ${source} of an integer list is outside ${INT_RANGE[0]} to ${INT_RANGE[1]}.`);
  }
  return value;
}

/**
 * Reads an `IntegerList` (INFO §9.1.2): integers separated by whitespace, each an `xs:int`. An empty text is an empty
 * list.
 *
 * @param text - The text of the attribute.
 * @throws `DataError` when `text` is not a string or an item is not an integer from -2147483648 to 2147483647.
 */
export function parseIntegerList(text: string): number[] {
  checkString(text, "The text");
  return xmlTokens(text).map((token) => checkInt(parseInteger(token), token));
}

/**
 * Writes an `IntegerList`: the integers separated by one space.
 *
 * @throws `DataError` when `integers` is not an array of integers from -2147483648 to 2147483647.
 */
export function formatIntegerList(integers: readonly number[]): string {
  checkArray(integers, "The integers must be an array");
  return integers
    .map((integer) => {
      if (!Number.isSafeInteger(integer))
        throw new DataError(`The item ${describe(integer)} of an integer list is not an integer.`);
      return String(checkInt(integer, String(integer)));
    })
    .join(" ");
}
