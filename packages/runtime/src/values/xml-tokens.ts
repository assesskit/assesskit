const XML_WHITESPACE = /[ \t\n\r]+/;

/**
 * Splits a text at runs of XML whitespace, as the `collapse` rule of XML Schema reads a list.
 *
 * @param text - The text.
 * @returns The parts between the runs of space, tab, line feed and carriage return. A text of whitespace alone has none.
 */
export function xmlTokens(text: string): string[] {
  return text.split(XML_WHITESPACE).filter((token) => token !== "");
}
