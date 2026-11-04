import { checkArray, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "./identifier.js";
import { parseInteger } from "./lexical.js";
import { xmlTokens } from "./xml-tokens.js";

/** The range of `xs:int`, the item type of `IntegerList` in the ASI schema. */
const INT_RANGE = [-(2 ** 31), 2 ** 31 - 1] as const;

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

function checkInt(value: number, source: string): number {
  if (value < INT_RANGE[0] || value > INT_RANGE[1]) {
    throw new DataError(`The item ${source} of an integer list is outside ${INT_RANGE[0]} to ${INT_RANGE[1]}.`);
  }
  return value;
}

/**
 * Reads an `IntegerList`: integers separated by whitespace, each an `xs:int`.
 *
 * @param text - The text of the attribute. An empty text is an empty list.
 * @returns The integers.
 * @throws `DataError` when `text` is not a string or an item is not an integer from -2147483648 to 2147483647.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, IntegerList}
 */
export function parseIntegerList(text: string): readonly number[] {
  checkString(text, "The text");
  return xmlTokens(text).map((token) => checkInt(parseInteger(token), token));
}

/**
 * Writes an `IntegerList`.
 *
 * @param integers - The integers.
 * @returns The integers separated by one space.
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
